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
  ANSWER_ORD_BASE, CARD_ID_PATTERN, slugTitle, deriveCardId,
  listAnswerCards, nextAnswerOrd, writeAnswerCard, ageOutAnswers,
} from '../cards/answer.js';

const MINI = resolve(__dirname, 'fixtures', 'cardkit-mini');
const NOW  = new Date('2026-09-03T22:15:00Z');

/** A fresh deck directory for one test; always paired with `rmSync` in that test's `finally`. */
function tempDeck(): string {
  return mkdtempSync(join(tmpdir(), 'answer-'));
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
