/**
 * Stochastic property tests for answer cards (`src/ts/cards/answer.ts`).
 *
 * The unit tests pin named cases; these pin the invariants the mechanism exists for: a derived
 * id is always well-formed and length-bounded regardless of what title it comes from, a sequence
 * of renders always converges on exactly the newest `keep` of them *and leaves their ords rising
 * with their `answer.at` stamps*, and age-out never touches a card that was never an answer in
 * the first place, whatever `keep` is asked for.
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
  ANSWER_ORD_BASE, ANSWER_ORD_SPAN, CARD_ID_PATTERN, deriveCardId,
  listAnswerCards, writeAnswerCard, ageOutAnswers,
} from '../cards/answer.js';

const MINI = resolve(__dirname, 'fixtures', 'cardkit-mini');

/** Runs for property A (`deriveCardId`), which touches no filesystem. */
const RUNS = 60;

/**
 * Runs for properties B and C, which each write a real deck (up to ~720 card writes across a
 * run of B at RUNS=60) — `deskcards.stoch.ts` hit the same disk-cost ceiling and settled on 12
 * for its disk-heavy property; this file uses a slightly wider 16 to keep a bit more of the
 * `keep`/sequence-length space covered while staying well inside a real per-test timeout.
 */
const DISK_RUNS = 16;

/** Per-test timeout for the disk-heavy properties (B and C), in milliseconds. */
const DISK_TIMEOUT = 20_000;

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
          noInvalidDate: true,
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

  it('after any sequence of renders, exactly the newest `keep` survive, ords rising with `at`',
     { timeout: DISK_TIMEOUT }, () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.date({ min: new Date(2015, 0, 1), max: new Date(2035, 0, 1), noInvalidDate: true }),
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

            /* `listAnswerCards` returns rows sorted by `answer.at`, so this reads the survivors
               oldest-first and demands their ords rise with them. That is the whole point of the
               band: the desk sorts by `ord` and falls back to `id.localeCompare` on a tie, so
               equal ords silently hand the reading order to the ids. Every ord must also still
               be inside the band it was allocated from. */
            for (const [i, row] of rows.entries()) {
              expect(row.ord).toBeGreaterThanOrEqual(ANSWER_ORD_BASE);
              expect(row.ord).toBeLessThan(ANSWER_ORD_BASE + ANSWER_ORD_SPAN);
              if (i > 0) { expect(row.ord).toBeGreaterThan(rows[i - 1]!.ord); }
            }
          } finally {
            rmSync(deck, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: DISK_RUNS },
    );
  });

});

describe('ageOutAnswers — stochastic invariants', () => {

  it('never removes a hand-placed card (no `answer` field), whatever `keep` is', { timeout: DISK_TIMEOUT }, () => {
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
      { numRuns: DISK_RUNS },
    );
  });

});
