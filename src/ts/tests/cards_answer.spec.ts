/**
 * Unit tests for answer cards (`src/ts/cards/answer.ts`): derived ids, the ord band, and age-out.
 *
 * Every filesystem-touching test writes into its own `mkdtempSync` deck and removes it in a
 * `finally`, so a failing assertion never leaves a stray temp directory behind. The fixture kit
 * (`fixtures/cardkit-mini/`, types `tally` and `blurb`) is loaded fresh per test that needs it —
 * loading it is cheap (two dynamic imports), unlike the real 88-type kit this suite never touches.
 */

import { describe, test, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { loadKit } from '../cards/kit.js';
import {
  ANSWER_ORD_BASE, ANSWER_ORD_SPAN, CARD_ID_PATTERN, slugTitle, deriveCardId,
  listAnswerCards, nextAnswerOrd, renumberAnswerCards, writeAnswerCard, ageOutAnswers,
} from '../cards/answer.js';

const MINI = resolve(__dirname, 'fixtures', 'cardkit-mini');
const NOW  = new Date('2026-09-03T22:15:00Z');

/** A fresh deck directory for one test; always paired with `rmSync` in that test's `finally`. */
function tempDeck(): string {
  return mkdtempSync(join(tmpdir(), 'answer-'));
}

/**
 * Hand-write one answer card straight onto a deck, bypassing the kit entirely, so a test can
 * put the band in a state that would otherwise take a thousand renders to reach.
 *
 * @param deck  the deck directory to write into
 * @param id    the card's directory name
 * @param ord   the ord to place it at
 * @param at    the ISO `answer.at` stamp that decides its reading order
 * @param fixed whether to pin it against age-out
 * @returns the card's directory
 */
function placeAnswer(deck: string, id: string, ord: number, at: string, fixed = false): string {
  const dir = join(deck, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'card.json'),
    JSON.stringify({ ord, type: 'tally', answer: { at }, ...(fixed ? { fixed: true } : {}) }, null, 2) + '\n');
  return dir;
}

describe('slugTitle', () => {
  test('lowercases, collapses non-alphanumeric runs to one hyphen, and trims the ends', () => {
    expect(slugTitle('Income vs. Spending — Q3')).toBe('income-vs-spending-q3');
    expect(slugTitle('!!!leading and trailing!!!')).toBe('leading-and-trailing');
    expect(slugTitle('!!!')).toBe('');
  });
});

describe('deriveCardId', () => {
  test('is a type, a slug of the title, and the minute', () => {
    const id = deriveCardId('hexbin', 'Income vs. Spending — Q3', new Date('2026-09-03T22:15:00Z'));
    expect(id).toBe('hexbin-income-vs-spending-q3-2609032215');
    expect(id).toMatch(CARD_ID_PATTERN);
  });

  test('truncates a long title so the id stays within 40 chars', () => {
    const id = deriveCardId('note', 'x'.repeat(200), new Date('2026-09-03T22:15:00Z'));
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id).toMatch(CARD_ID_PATTERN);
  });

  test('falls back to type-stamp when the title slugs to nothing', () => {
    const id = deriveCardId('blurb', '!!!', new Date('2026-09-03T22:15:00Z'));
    expect(id).toBe('blurb-2609032215');
    expect(id).toMatch(CARD_ID_PATTERN);
  });
});

describe('listAnswerCards / nextAnswerOrd on an empty or missing deck', () => {
  test('listAnswerCards is empty for a deck that does not exist yet', () => {
    expect(listAnswerCards(join(tmpdir(), 'answer-deck-never-created'))).toEqual([]);
  });

  test('nextAnswerOrd starts at the band base for an empty deck', () => {
    const deck = tempDeck();
    try {
      expect(nextAnswerOrd(deck)).toBe(ANSWER_ORD_BASE);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });
});

describe('nextAnswerOrd', () => {

  test('is one past the highest ord in the band, not one past the count', () => {
    const deck = tempDeck();
    try {
      // One survivor high in the band, as age-out leaves things: a count-derived ord would say 1001.
      placeAnswer(deck, 'survivor', ANSWER_ORD_BASE + 4, '2026-09-03T00:00:00.000Z');
      expect(nextAnswerOrd(deck)).toBe(ANSWER_ORD_BASE + 5);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('ignores an answer whose ord sits outside the band', () => {
    const deck = tempDeck();
    try {
      placeAnswer(deck, 'stray-high', ANSWER_ORD_BASE + ANSWER_ORD_SPAN + 50, '2026-09-03T00:00:00.000Z');
      placeAnswer(deck, 'stray-low',  10,                                     '2026-09-03T00:01:00.000Z');
      expect(nextAnswerOrd(deck)).toBe(ANSWER_ORD_BASE);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('reaches exactly one past the band when its last ord is taken', () => {
    const deck = tempDeck();
    try {
      placeAnswer(deck, 'topmost', ANSWER_ORD_BASE + ANSWER_ORD_SPAN - 1, '2026-09-03T00:00:00.000Z');
      expect(nextAnswerOrd(deck)).toBe(ANSWER_ORD_BASE + ANSWER_ORD_SPAN);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

});

describe('renumberAnswerCards', () => {

  test('packs answers down to the band base in `at` order and reports how many it rewrote', () => {
    const deck = tempDeck();
    try {
      placeAnswer(deck, 'card-c', 1998, '2026-09-03T00:00:00.000Z');
      placeAnswer(deck, 'card-a', 1990, '2026-09-01T00:00:00.000Z');
      placeAnswer(deck, 'card-b', 1994, '2026-09-02T00:00:00.000Z', true);

      expect(renumberAnswerCards(deck)).toBe(3);

      const rows = listAnswerCards(deck);
      expect(rows.map(c => c.id)).toEqual(['card-a', 'card-b', 'card-c']);
      expect(rows.map(c => c.ord)).toEqual([ANSWER_ORD_BASE, ANSWER_ORD_BASE + 1, ANSWER_ORD_BASE + 2]);
      expect(rows.map(c => c.fixed)).toEqual([false, true, false]);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('leaves a card that already sits on its new ord alone, and never touches a hand-placed card', () => {
    const deck = tempDeck();
    try {
      placeAnswer(deck, 'already', ANSWER_ORD_BASE, '2026-09-01T00:00:00.000Z');
      placeAnswer(deck, 'moves',   1500,            '2026-09-02T00:00:00.000Z');

      const handDir = join(deck, 'hand-placed');
      mkdirSync(handDir, { recursive: true });
      writeFileSync(join(handDir, 'card.json'), JSON.stringify({ ord: 20 }, null, 2) + '\n');

      expect(renumberAnswerCards(deck)).toBe(1);
      expect(JSON.parse(readFileSync(join(handDir, 'card.json'), 'utf8')).ord).toBe(20);
      expect(listAnswerCards(deck).map(c => c.ord)).toEqual([ANSWER_ORD_BASE, ANSWER_ORD_BASE + 1]);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('an empty deck needs nothing rewritten', () => {
    const deck = tempDeck();
    try {
      expect(renumberAnswerCards(deck)).toBe(0);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

});

describe('writeAnswerCard', () => {
  test('writes the four files, card.json last, with the answer stamp and the band ord', async () => {
    const deck = tempDeck();
    try {
      const kit = await loadKit(MINI);
      const r = writeAnswerCard(kit, deck, { type: 'tally', title: 'Done', data: { value: 3, target: 5 } }, 8, NOW);
      const meta = JSON.parse(readFileSync(join(r.dir, 'card.json'), 'utf8'));
      expect(meta.ord).toBe(ANSWER_ORD_BASE);
      expect(meta.answer.at).toBe(NOW.toISOString());
      expect(meta.spec).toEqual({ title: 'Done', data: { value: 3, target: 5 } });
      expect(meta.type).toBe('tally');
      expect(meta.category).toBe('ranking-and-comparison');
      expect(readFileSync(join(r.dir, 'card.html'), 'utf8')).toContain('3 / 5');
      expect(existsSync(join(r.dir, 'card.css'))).toBe(true);
      expect(existsSync(join(r.dir, 'card.js'))).toBe(true);
      expect(r.agedOut).toEqual([]);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('the second answer takes the next ord in the band', async () => {
    const deck = tempDeck();
    try {
      const kit = await loadKit(MINI);
      writeAnswerCard(kit, deck, { type: 'tally', title: 'First', data: { value: 1, target: 2 } }, 8, NOW);
      const r = writeAnswerCard(kit, deck, { type: 'tally', title: 'Second', data: { value: 2, target: 2 } }, 8, NOW);
      expect(r.ord).toBe(ANSWER_ORD_BASE + 1);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  // The regression this pins: ords used to be `base + (count of answers)`, and age-out caps that
  // count at `keep` — so from the `keep`-th render on, every answer landed on the same ord and the
  // desk fell back to its `id.localeCompare` tiebreak, which is not time order.
  test('ords keep rising once age-out has capped the count, so answers still read newest-last', async () => {
    const deck = tempDeck();
    const keep = 3;
    try {
      const kit = await loadKit(MINI);
      for (let i = 0; i < keep + 3; i += 1) {
        writeAnswerCard(
          kit, deck,
          { type: 'tally', title: `Answer ${String(i)}`, data: { value: i, target: 9 } },
          keep, new Date(NOW.getTime() + i * 60_000),
        );
      }

      const rows = listAnswerCards(deck);   // sorted by `answer.at`, oldest first
      expect(rows).toHaveLength(keep);

      // Six renders hand out 1000..1005; the three survivors are the last three of those.
      expect(rows.map(r => r.ord)).toEqual([ANSWER_ORD_BASE + 3, ANSWER_ORD_BASE + 4, ANSWER_ORD_BASE + 5]);
      expect(rows.map(r => r.at)).toEqual(
        [3, 4, 5].map(i => new Date(NOW.getTime() + i * 60_000).toISOString()));

      for (const [i, row] of rows.entries()) {
        if (i > 0) { expect(row.ord).toBeGreaterThan(rows[i - 1]!.ord); }
      }
      expect(rows.at(-1)!.ord).toBe(Math.max(...rows.map(r => r.ord)));
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('a render at the top of the band repacks it instead of spilling out of it', async () => {
    const deck = tempDeck();
    try {
      const kit  = await loadKit(MINI);
      const last = ANSWER_ORD_BASE + ANSWER_ORD_SPAN - 1;

      // Three hand-written answers crowded at the very top of the band, the middle one pinned.
      const oldDir   = placeAnswer(deck, 'old-answer',    last - 2, '2026-09-01T00:00:00.000Z');
      const fixedDir = placeAnswer(deck, 'pinned-answer', last - 1, '2026-09-02T00:00:00.000Z', true);
      const newDir   = placeAnswer(deck, 'new-answer',    last,     '2026-09-03T00:00:00.000Z');

      const r = writeAnswerCard(
        kit, deck, { type: 'tally', title: 'After', data: { value: 1, target: 2 } }, 10, NOW);

      // Inside the band, and specifically the next free ord after the three repacked survivors.
      expect(r.ord).toBeGreaterThanOrEqual(ANSWER_ORD_BASE);
      expect(r.ord).toBeLessThan(ANSWER_ORD_BASE + ANSWER_ORD_SPAN);
      expect(r.ord).toBe(ANSWER_ORD_BASE + 3);

      // Relative order preserved: the same four cards, still oldest-first, with rising ords.
      const rows = listAnswerCards(deck);
      expect(rows.map(c => c.id)).toEqual(['old-answer', 'pinned-answer', 'new-answer', r.id]);
      expect(rows.map(c => c.ord)).toEqual(
        [ANSWER_ORD_BASE, ANSWER_ORD_BASE + 1, ANSWER_ORD_BASE + 2, ANSWER_ORD_BASE + 3]);

      // The pinned card was renumbered, not removed, and is still pinned.
      expect(existsSync(oldDir)).toBe(true);
      expect(existsSync(newDir)).toBe(true);
      expect(existsSync(fixedDir)).toBe(true);
      const fixedMeta = JSON.parse(readFileSync(join(fixedDir, 'card.json'), 'utf8'));
      expect(fixedMeta.fixed).toBe(true);
      expect(fixedMeta.answer.at).toBe('2026-09-02T00:00:00.000Z');
      expect(fixedMeta.type).toBe('tally');
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('an explicit ord is honoured at both edges of the band and refused just outside either edge', async () => {
    const deck = tempDeck();
    try {
      const kit = await loadKit(MINI);

      const low = writeAnswerCard(kit, deck, { type: 'tally', title: 'Low', data: {}, ord: ANSWER_ORD_BASE }, 8, NOW);
      expect(low.ord).toBe(ANSWER_ORD_BASE);
      const lowMeta = JSON.parse(readFileSync(join(low.dir, 'card.json'), 'utf8'));
      expect(lowMeta.ord).toBe(ANSWER_ORD_BASE);

      const highOrd = ANSWER_ORD_BASE + ANSWER_ORD_SPAN - 1;
      const high = writeAnswerCard(kit, deck, { type: 'tally', title: 'High', data: {}, ord: highOrd }, 8, NOW);
      expect(high.ord).toBe(highOrd);
      const highMeta = JSON.parse(readFileSync(join(high.dir, 'card.json'), 'utf8'));
      expect(highMeta.ord).toBe(highOrd);

      expect(() => writeAnswerCard(
        kit, deck, { type: 'tally', title: 'TooHigh', data: {}, ord: ANSWER_ORD_BASE + ANSWER_ORD_SPAN }, 8, NOW,
      )).toThrow(RangeError);
      expect(() => writeAnswerCard(
        kit, deck, { type: 'tally', title: 'TooLow', data: {}, ord: ANSWER_ORD_BASE - 1 }, 8, NOW,
      )).toThrow(RangeError);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('a colliding id gets a numeric suffix that still matches the pattern', async () => {
    const deck = tempDeck();
    try {
      const kit = await loadKit(MINI);
      const first  = writeAnswerCard(kit, deck, { type: 'tally', title: 'Same', data: { value: 1, target: 2 } }, 8, NOW);
      const second = writeAnswerCard(kit, deck, { type: 'tally', title: 'Same', data: { value: 2, target: 2 } }, 8, NOW);
      expect(second.id).not.toBe(first.id);
      expect(second.id).toMatch(CARD_ID_PATTERN);
      expect(second.id.endsWith('-2')).toBe(true);
      expect(existsSync(first.dir)).toBe(true);
      expect(existsSync(second.dir)).toBe(true);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('an explicit ord outside the band is refused', async () => {
    const deck = tempDeck();
    try {
      const kit = await loadKit(MINI);
      expect(() => writeAnswerCard(
        kit, deck, { type: 'tally', title: 'Oops', data: {}, ord: 20 }, 8, NOW,
      )).toThrow(RangeError);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('an unknown type is refused by name', async () => {
    const deck = tempDeck();
    try {
      const kit = await loadKit(MINI);
      expect(() => writeAnswerCard(
        kit, deck, { type: 'nope', title: 'X', data: {} }, 8, NOW,
      )).toThrow(/unknown card type: nope/);
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });

  test('a type whose output fails audit is refused with the complaints', async () => {
    const deck    = tempDeck();
    const kitCopy = mkdtempSync(join(tmpdir(), 'answer-kit-'));
    try {
      cpSync(MINI, kitCopy, { recursive: true });
      writeFileSync(join(kitCopy, 'types', 'broken.mjs'),
        "export const meta = { name: 'broken', summary: 'always fails audit', shape: '{}', " +
        "category: 'text-and-code', defaults: {} };\n" +
        'export function build({ id, title }) {\n' +
        '  return {\n' +
        '    html: \'<section data-card="\' + id + \'"><h2>\' + String(title) + \'</h2></section>\',\n' +
        "    css: '',\n" +
        "    js: 'var f = () => 1;',\n" +
        '    json: {},\n' +
        '  };\n' +
        '}\n');

      const kit = await loadKit(kitCopy);
      expect(() => writeAnswerCard(
        kit, deck, { type: 'broken', title: 'Bad', data: {} }, 8, NOW,
      )).toThrow(/arrow function/);
      // Refused before any directory was written: no id derived from this title exists.
      const wouldBeId = deriveCardId('broken', 'Bad', NOW);
      expect(existsSync(join(deck, wouldBeId))).toBe(false);
    } finally {
      rmSync(deck, { recursive: true, force: true });
      rmSync(kitCopy, { recursive: true, force: true });
    }
  });
});

describe('ageOutAnswers', () => {
  test('keeps the newest N and never a fixed or hand-placed card', async () => {
    const deck = tempDeck();
    try {
      const kit = await loadKit(MINI);

      // Five answer cards, ascending `now` by a minute each — index 0 is oldest.
      const written = [0, 1, 2, 3, 4].map(i => writeAnswerCard(
        kit, deck,
        { type: 'tally', title: `Answer ${String(i)}`, data: { value: i, target: 5 } },
        100,   // keep everything for now; ageOutAnswers is called explicitly below
        new Date(NOW.getTime() + i * 60_000),
      ));

      // Pin the oldest one: without this it would be the first to go on age, which is exactly
      // what makes it a real test of the protection rather than an accident of recency.
      const fixedDir  = written[0]!.dir;
      const fixedMeta = JSON.parse(readFileSync(join(fixedDir, 'card.json'), 'utf8'));
      writeFileSync(join(fixedDir, 'card.json'), JSON.stringify({ ...fixedMeta, fixed: true }, null, 2) + '\n');

      // A hand-placed card: has a card.json, but no `answer` field at all.
      const handDir = join(deck, 'hand-placed');
      mkdirSync(handDir, { recursive: true });
      writeFileSync(join(handDir, 'card.json'), JSON.stringify({ ord: 20 }, null, 2) + '\n');

      const removed = ageOutAnswers(deck, 2);

      // Non-fixed answers are [1, 2, 3, 4] (4 rows); keep 2 newest → the 2 oldest of those go.
      expect([...removed].sort()).toEqual([written[1]!.id, written[2]!.id].sort());

      expect(existsSync(fixedDir)).toBe(true);              // fixed: protected despite being oldest
      expect(existsSync(handDir)).toBe(true);                // hand-placed: never an answer at all
      expect(existsSync(written[3]!.dir)).toBe(true);        // newest 2 of the non-fixed survive
      expect(existsSync(written[4]!.dir)).toBe(true);
      expect(existsSync(written[1]!.dir)).toBe(false);
      expect(existsSync(written[2]!.dir)).toBe(false);

      const remaining = listAnswerCards(deck).map(c => c.id).sort();
      expect(remaining).toEqual([written[0]!.id, written[3]!.id, written[4]!.id].sort());
    } finally {
      rmSync(deck, { recursive: true, force: true });
    }
  });
});
