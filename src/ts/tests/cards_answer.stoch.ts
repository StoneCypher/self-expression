/**
 * Stochastic property tests for answer cards (`src/ts/cards/answer.ts`).
 *
 * The unit tests pin named cases; these pin the invariants the mechanism exists for: a derived
 * id is always well-formed and length-bounded regardless of what title it comes from, a sequence
 * of renders always converges on exactly the newest `keep` of them, and age-out never touches a
 * card that was never an answer in the first place, whatever `keep` is asked for.
 *
 * The kit is loaded once in `beforeAll` (dynamic imports are the same fixture every run, so
 * nothing is gained by reloading it per property run) and every filesystem-touching run gets its
 * own `mkdtempSync` deck, removed before the run returns — the brief for this file specifically
 * calls for one deck per run rather than one shared root, since `writeAnswerCard` here is
 * exercised through its full path (build, audit, write, stamp, age-out) rather than through raw
 * `card.json` writes, so decks are not interchangeable across runs the way `deskcards.stoch.ts`'s
 * are.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadKit } from '../cards/kit.js';
import type { CardKit } from '../cards/kit.js';
import {
  ANSWER_ORD_BASE, CARD_ID_PATTERN, deriveCardId,
  listAnswerCards, writeAnswerCard, ageOutAnswers,
} from '../cards/answer.js';

const MINI = resolve(__dirname, 'fixtures', 'cardkit-mini');

/** Runs per property. Properties B and C each write a deck per run, so the cost is disk. */
const RUNS = 60;

let kit: CardKit;
beforeAll(async () => { kit = await loadKit(MINI); });

/** A fresh temp deck; the caller is responsible for `rmSync`-ing it when done. */
function tempDeck(): string {
  return mkdtempSync(join(tmpdir(), 'answer-stoch-'));
}

describe('deriveCardId — stochastic invariants', () => {

  it('always yields an id matching CARD_ID_PATTERN, at most 40 characters, for any title', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('tally', 'blurb'),
        fc.string({ maxLength: 300 }),
        fc.date({
          min: new Date(Date.now() - 50 * 365 * 24 * 60 * 60 * 1000),
          max: new Date(Date.now() + 50 * 365 * 24 * 60 * 60 * 1000),
        }),
        (type, title, now) => {
          const id = deriveCardId(type, title, now);
          expect(id).toMatch(CARD_ID_PATTERN);
          expect(id.length).toBeLessThanOrEqual(40);
        },
      ),
      { numRuns: RUNS },
    );
  });

});

describe('writeAnswerCard — stochastic invariants', () => {

  it('after any sequence of renders, exactly the newest `keep` survive', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.date({ min: new Date(2015, 0, 1), max: new Date(2035, 0, 1) }),
          { selector: d => d.getTime(), minLength: 1, maxLength: 12 },
        ),
        fc.integer({ min: 1, max: 12 }),
        (unsorted, keep) => {
          const dates = [...unsorted].sort((a, b) => a.getTime() - b.getTime());
          const deck  = tempDeck();
          try {
            dates.forEach((now, i) => {
              writeAnswerCard(
                kit, deck,
                { type: 'tally', title: `Answer ${String(i)}`, data: { value: i, target: dates.length } },
                keep, now,
              );
            });

            const rows          = listAnswerCards(deck);
            const expectedCount = Math.min(dates.length, keep);
            expect(rows.length).toBe(expectedCount);

            const survivingAt = rows.map(r => r.at).sort();
            const expectedAt  = dates.slice(dates.length - expectedCount).map(d => d.toISOString()).sort();
            expect(survivingAt).toEqual(expectedAt);
          } finally {
            rmSync(deck, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

});

describe('ageOutAnswers — stochastic invariants', () => {

  it('never removes a hand-placed card (no `answer` field), whatever `keep` is', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: -5, max: 10 }),
        (nHand, nAnswers, keep) => {
          const deck = tempDeck();
          try {
            const handDirs: string[] = [];
            for (let i = 0; i < nHand; i += 1) {
              const dir = join(deck, `hand-${String(i)}`);
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, 'card.json'), JSON.stringify({ ord: 10 + i }));
              handDirs.push(dir);
            }
            for (let i = 0; i < nAnswers; i += 1) {
              const dir = join(deck, `ans-${String(i)}`);
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, 'card.json'), JSON.stringify({
                ord: ANSWER_ORD_BASE + i,
                answer: { at: new Date(2020, 0, 1 + i).toISOString() },
              }));
            }

            ageOutAnswers(deck, keep);

            for (const dir of handDirs) { expect(existsSync(dir)).toBe(true); }
          } finally {
            rmSync(deck, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

});
