/**
 * Stochastic property tests for the onboarding questionnaire (issue #40).
 *
 * Pins the ledger invariants the design rests on, through the real `onboard`
 * handler against a real store — never a hand-built expected object:
 *
 * - any interleaving of answer / skip / reset leaves the ledger a subset of known
 *   question ids plus whatever unknown ids were already present, never dropping one;
 * - hand-configured keys always count as answered, whatever else has happened;
 * - `skip` writes no config rows beyond the ledger;
 * - `reset` clears exactly the ledger and touches nothing else.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, writeConfig, allConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  ANSWERED_KEY, QUESTION_IDS, answeredIds, pendingQuestions, resolveQuestion,
} from '../channels/onboarding.js';
import { handleOnboard } from '../mcp/tools.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-onboarding-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** One randomized questionnaire operation, as fast-check generates them. */
type Op =
  | { readonly kind: 'answer'; readonly id: string; readonly value: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'reset' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind  : fc.constant('answer' as const),
    id    : fc.constantFrom(...QUESTION_IDS.filter(id => id !== 'dwelling' && id !== 'channels')),
    value : fc.constantFrom('true', 'false', 'TRUE', 'garbage'),
  }),
  fc.constant({ kind: 'skip' as const }),
  fc.constant({ kind: 'reset' as const }),
);

describe('ledger invariants under arbitrary op interleavings', () => {

  it('the ledger stays a subset of known ids plus preserved unknowns, and unknowns never drop', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.array(opArb, { maxLength: 12 }),
        fc.constantFrom('a-future-question', 'q-from-v9', 'zeta'),
        (ops, unknown) => {

          // A newer version left an id this version does not know.
          writeConfig(s, ANSWERED_KEY, unknown);

          let resetSeen = false;
          for (const op of ops) {
            if (op.kind === 'answer')      { handleOnboard(s, { op: 'answer', id: op.id, value: op.value }); }
            else if (op.kind === 'skip')   { handleOnboard(s, { op: 'skip' }); }
            else                           { handleOnboard(s, { op: 'reset' }); resetSeen = true; }
          }

          const ledger  = answeredIds(s),
                allowed = new Set([...QUESTION_IDS, unknown]);

          for (const id of ledger) { expect(allowed.has(id)).toBe(true); }
          expect(new Set(ledger).size).toBe(ledger.length);   // no duplicate appends

          // The unknown id survives every op except a deliberate reset, which clears
          // the whole ledger — including it — by design.
          if (!resetSeen) { expect(ledger).toContain(unknown); }

          // Restore a blank slate for the next property run.
          handleOnboard(s, { op: 'reset' });
          for (const key of Object.keys(allConfig(s))) {
            s.db.prepare('DELETE FROM config WHERE key = ?').run(key);
          }

        }));
    });
    // Store-backed property: 100 runs write through a real database file, so the
    // default 5s vitest timeout is a flake margin under a concurrent build.
  }, 60_000);

  it('a hand-configured key counts as answered no matter what the ledger went through', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.array(opArb, { maxLength: 8 }),
        fc.constantFrom('roster.enabled', 'forecast.enabled', 'revision.enabled',
                        'salience.enabled', 'gifts.enabled'),
        (ops, key) => {

          writeConfig(s, key, 'true');

          for (const op of ops) {
            if (op.kind === 'answer')      { handleOnboard(s, { op: 'answer', id: op.id, value: op.value }); }
            else if (op.kind === 'skip')   { handleOnboard(s, { op: 'skip' }); }
            else                           { handleOnboard(s, { op: 'reset' }); }
          }

          const pendingKeys = pendingQuestions(s).flatMap(q => q.keys);
          expect(pendingKeys).not.toContain(key);

          for (const k of Object.keys(allConfig(s))) {
            s.db.prepare('DELETE FROM config WHERE key = ?').run(k);
          }

        }));
    });
    // Store-backed like the property above; same flake margin, same widening.
  }, 60_000);

  it('skip writes no config rows beyond the ledger, whatever was already resolved', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.subarray([...QUESTION_IDS]),
        (preResolved) => {

          for (const id of preResolved) { resolveQuestion(s, id); }
          const before = allConfig(s);

          handleOnboard(s, { op: 'skip' });

          const after = allConfig(s);
          for (const [key, value] of Object.entries(after)) {
            if (key !== ANSWERED_KEY) { expect(before[key]).toBe(value); }
          }
          expect(Object.keys(after).filter(k => k !== ANSWERED_KEY))
            .toEqual(Object.keys(before).filter(k => k !== ANSWERED_KEY));
          expect(pendingQuestions(s)).toEqual([]);

          for (const k of Object.keys(allConfig(s))) {
            s.db.prepare('DELETE FROM config WHERE key = ?').run(k);
          }

        }));
    });
    // Store-backed like the property above; same flake margin, same widening.
  }, 60_000);

  it('reset clears exactly the ledger: every other row it did not own survives verbatim', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.dictionary(
          fc.constantFrom('roster.enabled', 'gifts.enabled', 'retention.days', 'someone.elses_key'),
          fc.constantFrom('true', 'false', '90', 'opaque'),
          { maxKeys: 4 }),
        fc.subarray([...QUESTION_IDS], { minLength: 1 }),
        (rows, resolved) => {

          for (const [key, value] of Object.entries(rows)) { writeConfig(s, key, value); }
          for (const id of resolved) { resolveQuestion(s, id); }

          handleOnboard(s, { op: 'reset' });

          const after = allConfig(s);
          expect(after[ANSWERED_KEY]).toBeUndefined();
          for (const [key, value] of Object.entries(rows)) { expect(after[key]).toBe(value); }

          for (const k of Object.keys(allConfig(s))) {
            s.db.prepare('DELETE FROM config WHERE key = ?').run(k);
          }

        }));
    });
    // Store-backed like the property above; same flake margin, same widening.
  }, 60_000);

});
