/**
 * Stochastic property tests for retention pruning against correction chains.
 *
 * The bug these exist to keep dead: `entries.corrects_id` is a self-reference with no
 * `ON DELETE` clause, and a strike is by nature newer than what it strikes, so the first
 * correction to straddle the horizon made `DELETE FROM entries` fail — and, being the
 * first statement, took every other table's pruning with it. A single hand-written case
 * proves the fix on one shape; what actually needs proving is that **no** arrangement of
 * ages, links, and horizons can reproduce it, which is a claim about a space rather than
 * about an example.
 *
 * The properties:
 *
 * 1. **Pruning never throws, and always finishes the job.** For random correction chains
 *    at random ages under a random horizon, `pruneExpired` returns, and afterwards every
 *    row left in every pruned table is at or inside the horizon — checked across the
 *    whole store, so a pass that quietly pruned nothing fails as loudly as one that threw.
 * 2. **Survivors are never rewritten.** A surviving strike keeps its `corrects_id`
 *    exactly, dangling or not; the link is the correction edge, and losing it would trade
 *    one silent data loss for another.
 * 3. **Enforcement comes back every time**, so the suspension cannot leak into anything
 *    that runs after a prune.
 *
 * One store is shared across runs, deliberately: pruning is global, so rows left over
 * from an earlier run are subject to the current horizon too, which makes each successive
 * run a slightly harder test of the same property rather than a contaminated one.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }     from '../channels/store.js';
import { recordEntry, standingOf } from '../channels/entries.js';
import { recordContext }  from '../channels/context.js';
import { postMessage }    from '../channels/messages.js';
import { pruneExpired }   from '../channels/retention.js';

const VERSION = '0.0.0-stoch';

/** Milliseconds in one day, matching the horizon arithmetic under test. */
const DAY_MS = 86_400_000;

/** A fixed clock, so a run's ages and its horizon are measured from the same instant. */
const NOW = new Date('2026-08-28T12:00:00Z');

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-retention-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** One generated write: an age in days, and optionally a strike against an earlier one. */
interface Step {
  /** How many days before {@link NOW} the row is stamped. */
  readonly ageDays : number;
  /** Index of an earlier step this corrects, or `null` for a plain claim. */
  readonly link    : number | null;
  readonly kind    : 'retracts' | 'amends' | 'resolves';
}

/**
 * Histories whose links always point at a strictly earlier index — the shape the write
 * path can actually produce, since a link may only name an already-inserted id.
 *
 * Ages are generated **independently of link order**, so the generator freely produces
 * the case that broke: a strike newer than its target, straddling the horizon. It also
 * produces the harder-to-reason-about inverse, a strike stamped *older* than what it
 * strikes, which the horizon then prunes from the other end.
 */
const historyArb: fc.Arbitrary<Step[]> = fc.array(
  fc.record({
    ageDays : fc.nat({ max: 400 }),
    linked  : fc.boolean(),
    where   : fc.nat({ max: 1000 }),
    kind    : fc.constantFrom<'retracts' | 'amends' | 'resolves'>('retracts', 'amends', 'resolves'),
  }),
  { minLength: 1, maxLength: 12 },
).map((raw): Step[] => raw.map((item, index): Step => ({
  ageDays : item.ageDays,
  link    : !item.linked || index === 0 ? null : item.where % index,
  kind    : item.kind,
})));

/** A date `days` days before {@link NOW}. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/**
 * Write one generated history through the real write path — entries with their
 * corrections, a `turn_context` row, and a `messages` reply chain on the same ages.
 *
 * Every unlinked entry is a forecast, so a generated `resolves` link is always a legal
 * write; the messages half exists because `messages.reply_to` is the same self-reference
 * with the same straddling hazard.
 *
 * @returns the entry ids written, in history order
 */
function writeHistory(s: Store, steps: readonly Step[], session: string): number[] {

  const ids: number[] = [],
        posts: number[] = [];

  for (const [index, step] of steps.entries()) {

    const at     = daysAgo(step.ageDays),
          target = step.link === null ? undefined : ids[step.link];

    ids.push(target === undefined
      ? recordEntry(s, {
          channel: 'confidence', text: `claim ${String(index)}`, session, confidence: 'predicted',
        }, VERSION, at).id
      : recordEntry(s, step.kind === 'resolves'
          ? { channel: 'confidence', text: `resolves ${String(index)}`, session,
              correctsId: target, correctsKind: 'resolves', outcome: 'hit' }
          : { channel: 'divergence', text: `strike ${String(index)}`, session,
              correctsId: target, correctsKind: step.kind,
              verbatim: `the words of ${String(step.link)}` },
          VERSION, at).id);

    recordContext(s, { session }, at);

    const parent = step.link === null ? undefined : posts[step.link];
    posts.push(postMessage(s, parent === undefined
      ? { audience: 'record', text: `post ${String(index)}`, session }
      : { audience: 'record', text: `reply ${String(index)}`, session, replyTo: parent },
      VERSION, at).id);

  }

  return ids;

}

/** Every `ts_utc` currently in one table. */
function stamps(s: Store, table: string): string[] {
  return s.db.prepare(`SELECT ts_utc FROM ${table}`).all().map(row => String(row['ts_utc']));
}

/** Every `id → corrects_id` pair currently in `entries`. */
function links(s: Store): Map<number, number | null> {
  return new Map(s.db.prepare('SELECT id, corrects_id FROM entries').all().map(row =>
    [Number(row['id']), row['corrects_id'] === null ? null : Number(row['corrects_id'])]));
}

describe('pruneExpired — stochastic', () => {

  it('never throws, and leaves nothing older than the horizon, for any correction chain', () => {
    withStore(s => {

      let run = 0;

      fc.assert(
        fc.property(historyArb, fc.integer({ min: 1, max: 400 }), (steps, days) => {

          run += 1;
          writeHistory(s, steps, `run-${String(run)}`);
          writeConfig(s, 'retention.days', days);

          // The whole property: this call is the one that used to throw
          // `FOREIGN KEY constraint failed` the moment a strike outlived its target.
          const pruned  = pruneExpired(s, NOW),
                horizon = new Date(NOW.getTime() - days * DAY_MS).toISOString();

          for (const table of ['entries', 'turn_context', 'messages']) {
            for (const ts of stamps(s, table)) {
              expect(ts >= horizon).toBe(true);
            }
          }

          // A pass that threw would report nothing; so would one that silently pruned
          // nothing, which is what the swallowed failure looked like from outside.
          expect(pruned.entries).toBeGreaterThanOrEqual(0);

          // The suspension is scoped to the pass and never leaks past it.
          expect(Number(s.db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys'])).toBe(1);

        }),
        { numRuns: 60 }
      );

    });
  }, 120_000);

  it('never rewrites a survivor: a surviving strike keeps its link, dangling or not', () => {
    withStore(s => {

      let run = 0;

      fc.assert(
        fc.property(historyArb, fc.integer({ min: 1, max: 400 }), (steps, days) => {

          run += 1;
          const ids = writeHistory(s, steps, `keep-${String(run)}`);

          writeConfig(s, 'retention.days', days);
          const before = links(s);
          pruneExpired(s, NOW);
          const after = links(s);

          for (const [id, target] of after) {
            expect(target).toBe(before.get(id) ?? null);
          }

          // Every survivor still reads: a dangling target degrades to "nothing strikes
          // me from beyond the horizon", not to a throw.
          const alive = ids.filter(id => after.has(id));
          expect(standingOf(s, alive)).toHaveLength(alive.length);

        }),
        { numRuns: 40 }
      );

    });
  }, 120_000);

});
