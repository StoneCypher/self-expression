/**
 * Stochastic property tests for the pending-notice collector (#98).
 *
 * Three families:
 *
 * A. **Fingerprint order-independence.** For any set of pending items, shuffling them
 *    before fingerprinting never changes the result — the pending set is a set, not a
 *    sequence.
 * B. **Nag-epoch arithmetic.** For any nag interval and any elapsed time, {@link nagEpoch}
 *    agrees with `floor(elapsed / nagHours)` computed independently of the function
 *    under test, built from real `Date` arithmetic rather than mirrored logic.
 * C. **Notice-per-change, against a real desk.** For any sequence of desk edits (adding
 *    an intent, claiming one, or doing nothing), {@link pendingNotice} fires a non-null
 *    notice at exactly the steps where the *set* of open desk-question ids changed — no
 *    more, no fewer — with the nag interval held wide enough (168h) that no epoch ever
 *    moves during the run, isolating the property from time-based re-nagging.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import { openIntents, readQuestions, writeQuestions, claimIntent } from '../channels/desk_questions.js';
import type { DeskQuestion } from '../channels/desk_questions.js';
import { nagEpoch, fingerprint, pendingNotice } from '../channels/pending.js';
import type { PendingItem } from '../channels/pending.js';

const DATE_BOUNDS = {
  min: new Date('2000-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z'),
  noInvalidDate: true,
};

/** One arbitrary {@link PendingItem}; keys are unconstrained strings. */
const pendingItemArb: fc.Arbitrary<PendingItem> = fc.record({
  kind  : fc.constantFrom<PendingItem['kind']>('message', 'desk_intent'),
  key   : fc.string({ maxLength: 24 }),
  since : fc.date(DATE_BOUNDS).map(d => d.toISOString()),
});

/** An item array paired with a random full-length shuffle of the same items. */
const itemsAndShuffleArb = fc.array(pendingItemArb, { maxLength: 15 }).chain(items =>
  fc.tuple(
    fc.constant(items),
    fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length }),
  ));

describe('fingerprint — stochastic order-independence (property A)', () => {

  it('is invariant under any shuffle of the same items', () => {
    fc.assert(
      fc.property(
        itemsAndShuffleArb,
        fc.date(DATE_BOUNDS),
        fc.integer({ min: 1, max: 168 }),
        ([items, shuffled], now, nagHours) => {
          expect(fingerprint(shuffled, now, nagHours)).toBe(fingerprint(items, now, nagHours));
        },
      ),
      { numRuns: 60 },
    );
  });

});

describe('nagEpoch — stochastic arithmetic (property B)', () => {

  it('matches floor(elapsed / nagHours) for any nag interval and elapsed time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 168 }),
        fc.integer({ min: 0, max: 1000 }),
        (nagHours, elapsedHours) => {
          const now   = new Date('2026-08-30T00:00:00Z'),
                since = new Date(now.getTime() - elapsedHours * 3_600_000).toISOString();
          expect(nagEpoch(since, now, nagHours)).toBe(Math.floor(elapsedHours / nagHours));
        },
      ),
      { numRuns: 60 },
    );
  });

});

/** One step of a random desk workload. */
type Op = { readonly kind: 'add' } | { readonly kind: 'claim' } | { readonly kind: 'noop' };

const opArb: fc.Arbitrary<Op> = fc.constantFrom(
  { kind: 'add' } as const, { kind: 'claim' } as const, { kind: 'noop' } as const,
);
const workloadArb = fc.array(opArb, { minLength: 1, maxLength: 15 });

/** The open desk-intent ids, sorted, for comparing set membership between steps. */
function openIds(rows: readonly DeskQuestion[]): string[] {
  return openIntents(rows).map(r => r.id).sort();
}

describe('pendingNotice — notice fires exactly on open-id-set changes (property C)', () => {

  it('counts a non-null notice at exactly the steps where the open desk-id set changed', () => {
    let run = 0;
    fc.assert(
      fc.property(workloadArb, (workload) => {

        run += 1;
        const dbDir   = mkdtempSync(join(tmpdir(), `se-pending-stoch-db-${String(run)}-`)),
              deskDir = mkdtempSync(join(tmpdir(), `se-pending-stoch-desk-${String(run)}-`)),
              s       = openStore(join(dbDir, 'log.sqlite3'));

        try {

          writeConfig(s, 'desk.path', deskDir);
          writeConfig(s, 'pending.nag_hours', '168'); // wide enough that no epoch moves this run

          const now = new Date('2026-08-30T00:00:00Z');
          let rows: DeskQuestion[] = [],
              counter = 0,
              prevOpen = openIds(rows),
              expectedChanges = 0,
              actualNotices = 0;

          for (const op of workload) {

            if (op.kind === 'add') {
              counter += 1;
              rows = [...rows, {
                id: `q${String(counter)}`, text: `ask ${String(counter)}`,
                asked: now.toISOString(), queued: 'next', queuedAt: now.toISOString(),
              }];
              writeQuestions(deskDir, rows);
            } else if (op.kind === 'claim') {
              const target = openIntents(rows)[0]?.id;
              if (target !== undefined) {
                claimIntent(deskDir, target, 'sess-1', now);
                rows = readQuestions(deskDir);
              }
            }
            // 'noop': the desk is untouched this step.

            const nowOpen = openIds(rows);
            if (JSON.stringify(nowOpen) !== JSON.stringify(prevOpen)) { expectedChanges += 1; }
            prevOpen = nowOpen;

            if (pendingNotice(s, 'sess-1', now) !== null) { actualNotices += 1; }

          }

          expect(actualNotices).toBe(expectedChanges);

        } finally {
          closeStore(s);
          rmSync(dbDir, { recursive: true, force: true });
          rmSync(deskDir, { recursive: true, force: true });
        }

      }),
      { numRuns: 60 },
    );
  }, 60_000);

});
