/**
 * Stochastic property tests for the desk's card deck (`src/scripts/desk/deskcards.mjs`).
 *
 * The unit tests pin named cases; these pin the invariants the mechanism exists for, over
 * randomly shaped decks written to a real filesystem: display order is total and stable, an
 * unfinished card is never on the desk, a card's assets appear in the page in the same order
 * as the card, removal takes exactly one card and everything it contributed, and nothing a
 * card contains is ever interpreted as a replacement pattern.
 *
 * Deliberately frugal with the disk. Each property checks several invariants against one
 * generated deck rather than regenerating a deck per invariant, and every deck is written
 * into one temp root removed once at the end — creating and recursively deleting a tree per
 * run costs enough on Windows to starve the workers running beside these.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { listCards, render, removeCard, assemble } from '../../scripts/desk/deskcards.mjs';

/** Runs per property. Each run writes a whole deck, so the cost is disk, not arithmetic. */
const RUNS = 12;

/** Runs for the one property that writes a single card rather than a whole deck. */
const TEXT_RUNS = 24;

/** One randomly generated card: a distinct number, a display order, and whether it is fixed. */
interface Gen { n: number; ord: number; fixed: boolean }

const cardArb = fc.record({
  n:     fc.integer({ min: 0, max: 999 }),
  ord:   fc.integer({ min: -50, max: 50 }),
  fixed: fc.boolean(),
});

/** Decks of one to six cards, every card's id distinct. */
const deckArb = fc.uniqueArray(cardArb, { selector: g => g.n, minLength: 1, maxLength: 6 });

/** Directory names for cards that are only half written — no `card.json` anywhere. */
const strayArb = fc.uniqueArray(fc.integer({ min: 1000, max: 1999 }), { maxLength: 3 });

/** Card source likely to contain the things `String.replace` treats specially. */
const sourceArb = fc.array(
  fc.constantFrom('$&', '$$', "$'", '$`', '$1', '$<x>', 'plain', '{}', '\n', '<b>'),
  { minLength: 1, maxLength: 10 },
).map(parts => parts.join(''));

/** One temp root for every deck this file writes, removed once when the file is done. */
const ROOT = mkdtempSync(join(tmpdir(), 'se-deskstoch-'));
let seq = 0;

afterAll(() => { rmSync(ROOT, { recursive: true, force: true }); });

const id = (n: number): string => `c${String(n)}`;

/**
 * Write one generated deck into the shared temp root and return its path.
 *
 * Marks are delimited on both sides because ids 12 and 123 share a prefix, and an
 * undelimited mark would let one card's marker be found inside another's.
 *
 * @param cards  the cards to write; each gets `card.json`, `card.html`, `card.css`, `card.js`
 * @param strays directory numbers to create with markup but no `card.json` at all
 * @returns the deck directory
 */
function writeDeck(cards: Gen[], strays: number[] = []): string {
  const deck = join(ROOT, `d${String(seq)}`, 'cards');
  seq += 1;
  mkdirSync(deck, { recursive: true });
  for (const g of cards) {
    const dir = join(deck, id(g.n));
    mkdirSync(dir);
    writeFileSync(join(dir, 'card.json'), JSON.stringify({ ord: g.ord, fixed: g.fixed }));
    writeFileSync(join(dir, 'card.html'), `<!--h:${String(g.n)}:-->`);
    writeFileSync(join(dir, 'card.css'),  `/*c:${String(g.n)}:*/`);
    writeFileSync(join(dir, 'card.js'),   `/*j:${String(g.n)}:*/`);
  }
  for (const s of strays) {
    const dir = join(deck, id(s));
    mkdirSync(dir);
    writeFileSync(join(dir, 'card.html'), `<!--h:${String(s)}:-->`);   // markup, no manifest
  }
  return deck;
}

const SHELL = '<style><!--CARD-CSS--></style><main><!--CARD-HTML--></main>'
            + '<script><!--CARD-JS--></script>';

describe('a deck on disk — stochastic invariants', () => {

  it('lists exactly the finished cards, in a total order, and lays each kind out to match', () => {
    fc.assert(
      fc.property(deckArb, strayArb, (cards, strays) => {
        const deck = writeDeck(cards, strays);
        const rows = listCards(deck);

        // Exactly the directories carrying a card.json: strays are skipped, not guessed at.
        expect(rows.map(c => c.id).sort()).toEqual(cards.map(g => id(g.n)).sort());

        // Total and stable: ord ascending, ties broken by id.
        for (let i = 1; i < rows.length; i += 1) {
          const prev = rows[i - 1], row = rows[i];
          if (!prev || !row) throw new Error('unreachable: index inside length');
          expect(prev.ord).toBeLessThanOrEqual(row.ord);
          if (prev.ord === row.ord) expect(prev.id < row.id).toBe(true);
        }

        // Every kind appears in the page in the same order as its card.
        const order = rows.map(c => c.id.slice(1));
        for (const [kind, mark] of [['html', 'h'], ['css', 'c'], ['js', 'j']] as const) {
          const text = render(deck, kind);
          let last = -1;
          for (const n of order) {
            const at = text.indexOf(`${mark}:${n}:`);
            expect(at).toBeGreaterThan(last);
            last = at;
          }
        }

        // An unfinished card contributes nothing, however much markup it has lying around.
        const html = render(deck, 'html');
        for (const s of strays) expect(html).not.toContain(`h:${String(s)}:`);

        // And the shell always comes back filled.
        expect(assemble(SHELL, deck)).not.toContain('<!--CARD-');
      }),
      { numRuns: RUNS },
    );
  });

});

describe('removeCard — stochastic invariants', () => {

  it('takes exactly one card, or none, and everything that card contributed goes with it', () => {
    fc.assert(
      fc.property(deckArb, fc.nat(), (cards, pick) => {
        const deck   = writeDeck(cards);
        const before = listCards(deck);
        const target = before[pick % before.length];
        if (!target) throw new Error('unreachable: decks have at least one card');

        const removed = removeCard(deck, target.id);
        const after   = listCards(deck);

        expect(removed).toBe(!target.fixed);
        expect(after.map(c => c.id)).toEqual(
          before.map(c => c.id).filter(x => !removed || x !== target.id));

        if (!removed) return;

        // Markup, styles and script leave together — the orphaned-script failure, ended.
        const n = target.id.slice(1);
        expect(render(deck, 'html')).not.toContain(`h:${n}:`);
        expect(render(deck, 'css')).not.toContain(`c:${n}:`);
        expect(render(deck, 'js')).not.toContain(`j:${n}:`);

        // And removing it again is a refusal, not a second removal.
        expect(removeCard(deck, target.id)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

});

describe('assemble — stochastic invariants', () => {

  it('carries card source through verbatim, replacement patterns and all', () => {
    fc.assert(
      fc.property(sourceArb, sourceArb, sourceArb, (css, html, js) => {
        const deck = join(ROOT, `t${String(seq)}`, 'cards'), dir = join(deck, 'only');
        seq += 1;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'card.json'), '{"ord":1}');
        writeFileSync(join(dir, 'card.css'),  css);
        writeFileSync(join(dir, 'card.html'), html);
        writeFileSync(join(dir, 'card.js'),   js);

        expect(assemble(SHELL, deck))
          .toBe(`<style>${css}</style><main>${html}</main><script>${js}</script>`);
      }),
      { numRuns: TEXT_RUNS },
    );
  });

});
