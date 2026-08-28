/**
 * Stochastic property tests for retraction (issue #16).
 *
 * The properties, matching the invariants the feature would be worthless without:
 *
 * 1. **Standing always matches the events that produced it.** Random correction DAGs —
 *    random targets, random kinds, random strike order — are built through the real write
 *    path, and the shipped {@link standingOf} is compared against an independent
 *    brute-force reference written in a deliberately different style (naive fixpoint
 *    iteration over the whole edge set, rather than a memoized walk of a fetched
 *    subgraph). Two implementations disagreeing on some history is the failure this
 *    exists to catch; one implementation checked against a hand-written expected value
 *    would be checking nothing at all.
 *
 * 2. **The register is exactly the standing strikes**, no more and no less, for every
 *    history — which is what makes "the register is the current state, the table is the
 *    history" a fact rather than a slogan.
 *
 * 3. **No sequence of operations mutates or deletes an existing row.** The whole trust
 *    posture is "the only verb is INSERT", and doctrine that is never tested is a
 *    promise. Every row's complete bytes are snapshotted and compared again after
 *    arbitrarily many later writes and after every marked read surface has run.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import {
  recordEntry, standingOf, register, recentEntries, seriesPercents, previousSignature,
} from '../channels/entries.js';
import type { EntryStatus } from '../channels/entries.js';

const VERSION = '0.0.0-stoch';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-retraction-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Which kinds a generated strike may carry. */
type StrikeKind = 'retracts' | 'amends' | 'resolves';

/** One generated write: a plain claim, or a strike against an earlier index. */
type Step =
  | { readonly link: null; readonly kind?: undefined }
  | { readonly link: number; readonly kind: StrikeKind };

/**
 * A history of writes in which every strike names a **strictly earlier** index.
 *
 * The target is generated as an arbitrary natural and reduced modulo the current index,
 * which is what keeps every link pointing backwards — the property the standing
 * computation's well-foundedness rests on, and one a bare `fc.integer` would break in
 * the first shrink.
 */
const historyArb: fc.Arbitrary<Step[]> = fc.array(
  fc.record({
    linked : fc.boolean(),
    where  : fc.nat({ max: 1000 }),
    kind   : fc.constantFrom<StrikeKind>('retracts', 'amends', 'resolves'),
  }),
  { minLength: 1, maxLength: 14 },
).map((raw): Step[] => raw.map((item, index): Step =>
  !item.linked || index === 0
    ? { link: null }
    : { link: item.where % index, kind: item.kind }));

/**
 * The reference standing computation: a naive fixpoint over the whole edge set.
 *
 * Deliberately a different algorithm from the shipped one — it re-derives every row from
 * the complete edge list until a full pass changes nothing, instead of walking a fetched
 * subgraph with memoization — so agreement between the two is evidence, not a tautology.
 *
 * @param steps the generated history; index `i` describes the (i+1)th row written
 * @returns each row's status, keyed by its 1-based position in the history
 */
function referenceStanding(steps: readonly Step[]): Map<number, EntryStatus> {

  const positions = steps.map((_, index) => index + 1),
        strikes   = new Map<number, { at: number; kind: 'retracts' | 'amends' }[]>();

  for (const [index, step] of steps.entries()) {
    if (step.link === null || step.kind === 'resolves') { continue; }
    const target = step.link + 1,
          bucket = strikes.get(target) ?? [];
    bucket.push({ at: index + 1, kind: step.kind });
    strikes.set(target, bucket);
  }

  const retracted = new Map<number, boolean>(positions.map(at => [at, false]));

  for (let pass = 0; pass <= positions.length + 1; pass++) {
    let changed = false;
    for (const at of [...positions].reverse()) {
      const verdict = (strikes.get(at) ?? [])
        .some(strike => strike.kind === 'retracts' && retracted.get(strike.at) === false);
      if (retracted.get(at) !== verdict) { retracted.set(at, verdict); changed = true; }
    }
    if (!changed) { break; }
  }

  const out = new Map<number, EntryStatus>();

  for (const at of positions) {
    const living = (strikes.get(at) ?? []).filter(strike => retracted.get(strike.at) === false);
    out.set(at,
      living.some(strike => strike.kind === 'retracts') ? 'retracted'
      : living.some(strike => strike.kind === 'amends') ? 'amended'
      : 'stands');
  }

  return out;

}

/**
 * Write one generated history through the real write path, returning the row ids in
 * history order.
 *
 * Every unlinked row is recorded as a forecast, so a generated `resolves` link is always
 * a legal write and the third kind can be exercised without the generator having to model
 * the tool layer's is-it-a-forecast rule.
 */
function writeHistory(s: Store, steps: readonly Step[], session: string): number[] {

  const ids: number[] = [];

  for (const [index, step] of steps.entries()) {

    if (step.link === null) {
      ids.push(recordEntry(s, {
        channel    : 'confidence',
        text       : `claim ${String(index)}`,
        session,
        confidence : 'predicted',
      }, VERSION).id);
      continue;
    }

    const target = ids[step.link];
    if (target === undefined) { throw new Error('the generator produced a forward link'); }

    ids.push(recordEntry(s, step.kind === 'resolves'
      ? { channel: 'confidence', text: `resolves ${String(index)}`, session,
          correctsId: target, correctsKind: 'resolves', outcome: 'hit' }
      : { channel: 'divergence', text: `strike ${String(index)}`, session,
          correctsId: target, correctsKind: step.kind,
          verbatim: `the words of ${String(step.link)}` },
      VERSION).id);

  }

  return ids;

}

describe('standing — stochastic agreement with a reference implementation', () => {

  it('computes the same standing as a naive fixpoint, for every generated history', () => {
    withStore(s => {

      // One shared store across property runs — opening SQLite per run is too slow — with
      // each run's rows fenced by their own session so runs cannot contaminate each other.
      let run = 0;

      fc.assert(
        fc.property(historyArb, (steps) => {

          run += 1;
          const ids = writeHistory(s, steps, `run-${String(run)}`);

          const expected = referenceStanding(steps),
                actual   = new Map(standingOf(s, ids).map(x => [x.id, x.status]));

          for (const [index, id] of ids.entries()) {
            expect(actual.get(id)).toBe(expected.get(index + 1));
          }

        }),
        { numRuns: 60 }
      );

    });
  }, 60_000);

  it('a `by` is named exactly when the row does not stand, and names a real strike', () => {
    withStore(s => {

      let run = 0;

      fc.assert(
        fc.property(historyArb, (steps) => {

          run += 1;
          const ids   = writeHistory(s, steps, `by-${String(run)}`),
                known = new Set(ids);

          for (const standing of standingOf(s, ids)) {
            if (standing.status === 'stands') {
              expect(standing.by).toBeNull();
            } else {
              expect(standing.by).not.toBeNull();
              expect(known.has(Number(standing.by))).toBe(true);
              // A link always points backwards, so the strike is strictly later.
              expect(Number(standing.by)).toBeGreaterThan(standing.id);
            }
          }

        }),
        { numRuns: 40 }
      );

    });
  }, 60_000);

  it('the register is exactly the standing retracts/amends strikes — no more, no less', () => {
    withStore(s => {

      let run = 0;

      fc.assert(
        fc.property(historyArb, (steps) => {

          run += 1;
          const session = `reg-${String(run)}`,
                ids     = writeHistory(s, steps, session);

          const expected = referenceStanding(steps),
                listed   = new Set(register(s, { session, limit: 1000 })
                                     .map(row => row.replacement.id));

          for (const [index, id] of ids.entries()) {
            const step    = steps[index],
                  strikes = step !== undefined && step.link !== null && step.kind !== 'resolves',
                  alive   = expected.get(index + 1) !== 'retracted';
            expect(listed.has(id)).toBe(strikes && alive);
          }

        }),
        { numRuns: 40 }
      );

    });
  }, 60_000);

  it('a resolution never marks anything, however tangled the history', () => {
    withStore(s => {

      let run = 0;

      fc.assert(
        fc.property(historyArb, (steps) => {

          run += 1;
          const ids = writeHistory(s, steps, `res-${String(run)}`);

          // Any row struck only by resolutions — or by nothing — must stand.
          const struck = new Set(steps
            .filter(step => step.link !== null && step.kind !== 'resolves')
            .map(step => step.link));

          const actual = new Map(standingOf(s, ids).map(x => [x.id, x.status]));

          for (const [index, id] of ids.entries()) {
            if (!struck.has(index)) { expect(actual.get(id)).toBe('stands'); }
          }

        }),
        { numRuns: 40 }
      );

    });
  }, 60_000);

});

describe('append-only — stochastic', () => {

  it('no later write and no read ever changes or removes a row that already exists', () => {
    withStore(s => {

      let run = 0;

      const snapshot = (id: number): string =>
        JSON.stringify(s.db.prepare('SELECT * FROM entries WHERE id = ?').get(id));

      fc.assert(
        fc.property(historyArb, historyArb, (first, second) => {

          run += 1;
          const session = `append-${String(run)}`;

          // Write the first history and freeze every row's complete bytes.
          const ids    = writeHistory(s, first, session),
                frozen = new Map(ids.map(id => [id, snapshot(id)]));

          // Then do more of everything: another whole history…
          writeHistory(s, second, session);

          // …and a strike against every single frozen row, which is the operation an
          // implementation would be most tempted to make a write on the original.
          for (const [index, id] of ids.entries()) {
            recordEntry(s, {
              channel      : 'divergence',
              text         : `late strike on ${String(id)}`,
              session,
              correctsId   : id,
              correctsKind : index % 2 === 0 ? 'retracts' : 'amends',
              verbatim     : `whatever row ${String(id)} said`,
            }, VERSION);
          }

          // …and every marked read surface there is, which is where an implementation
          // that quietly stamped a flag onto the original would give itself away.
          standingOf(s, ids);
          register(s, { session, limit: 1000 });
          recentEntries(s, 50);
          seriesPercents(s, 'nonesuch');
          previousSignature(s, session);

          for (const id of ids) {
            // Byte-for-byte, and still present: nothing was rewritten and nothing deleted.
            expect(snapshot(id)).toBe(frozen.get(id));
            expect(snapshot(id)).not.toBe('undefined');
          }

        }),
        { numRuns: 40 }
      );

    });
  }, 60_000);

});
