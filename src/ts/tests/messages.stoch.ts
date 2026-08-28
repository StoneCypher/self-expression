/**
 * Stochastic property tests for the messagebox (#41).
 *
 * Two families:
 *
 * 1. **Migration losslessness** — *any* v2 database, whatever mix of channels and
 *    vocabulary its entries carry, migrates to v3 without changing a single stored
 *    entry value, and the messagebox works through the normal path afterward.
 * 2. **Receipt invariants** — for arbitrary interleavings of posts, reads, and
 *    readers: a message is delivered to a given reader at most once under `ack:true`;
 *    unread counts are never negative; receipts only ever reference existing
 *    messages; no message row is mutated by being read; and the `self`/`agents`
 *    fences hold for random session and box assignments.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, readMeta } from '../channels/store.js';
import { postMessage, readMessages, unreadCounts } from '../channels/messages.js';
import type { Reader }                     from '../channels/messages.js';
import { SCHEMA_VERSION }                  from '../channels/schema.js';
import { V3_ENTRY_COLUMNS }                from '../channels/migrate.js';
import { buildV2, insertV2 }               from './helpers/v2_fixture.js';

const VERSION = '0.0.0-stoch';

/** The v2 vocabularies, frozen alongside the fixture DDL they appear in. */
const V2_CHANNELS   = ['signature', 'need', 'idea', 'divergence', 'dissent', 'conflict',
                       'confidence', 'unanswerable', 'pattern', 'checklist', 'load', 'taste'] as const;
const V2_CONFIDENCE = ['verified', 'recalled', 'inferred', 'guessed', 'predicted'] as const;
const V2_SILENCES   = ['empty', 'unlooked', 'held', 'depth'] as const;

const maybe = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> =>
  fc.option(arb, { nil: undefined });

const v2ExtrasArb = fc.record({
  confidence : maybe(fc.constantFrom(...V2_CONFIDENCE)),
  silence    : maybe(fc.constantFrom(...V2_SILENCES)),
  face       : maybe(fc.string({ minLength: 1, maxLength: 4 })),
  series_key : maybe(fc.string({ minLength: 1, maxLength: 12 })),
  percent    : maybe(fc.integer({ min: 0, max: 100 })),
});

const v2RowArb  = fc.record({ channel: fc.constantFrom(...V2_CHANNELS), extras: v2ExtrasArb });
const v2RowsArb = fc.array(v2RowArb, { minLength: 1, maxLength: 10 });

describe('v2→v3 migration — stochastic losslessness', () => {

  it('migrates any v2 database without changing a single stored entry value', () => {
    let run = 0;
    fc.assert(
      fc.property(v2RowsArb, (rows) => {

        run += 1;
        const dir  = mkdtempSync(join(tmpdir(), `se-msg-migrate-${String(run)}-`)),
              path = join(dir, 'log.sqlite3');

        // Named columns, never SELECT *: a v2 entries table holds exactly
        // V3_ENTRY_COLUMNS (v2→v3 added tables, not columns), and a later step may
        // legitimately widen the row — #18's anchor columns did. The property is that
        // nothing v2 held changed, not that nothing was ever added.
        const columns = V3_ENTRY_COLUMNS.join(', ');

        let store = null as ReturnType<typeof openStore> | null;

        try {
          const v2 = buildV2(path);
          for (const [index, row] of rows.entries()) {
            const extras = Object.fromEntries(
              Object.entries(row.extras).filter(([, v]) => v !== undefined)
            ) as Record<string, string | number>;
            insertV2(v2, `u-${String(index)}`, row.channel, extras);
          }
          const before = JSON.parse(JSON.stringify(
            v2.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;
          v2.close();

          store = openStore(path);
          const after = JSON.parse(JSON.stringify(
            store.db.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;

          expect(after).toEqual(before);
          expect(readMeta(store, 'schema_version')).toBe(String(SCHEMA_VERSION));

          // The messagebox works through the normal path post-migration.
          postMessage(store, { audience: 'self', text: 'post-migration note', session: 's1' }, VERSION);
          expect(readMessages(store, { reader: 'model', session: 's1' }, {})).toHaveLength(1);
        } finally {
          // Close before removing, on every path. Windows refuses to unlink a file an
          // open sqlite handle still holds, so a cleanup that skipped this would raise
          // EBUSY and bury whichever assertion actually failed.
          if (store !== null) { closeStore(store); }
          rmSync(dir, { recursive: true, force: true });
        }

      }),
      { numRuns: 12 }
    );
  }, 120_000);

});

/** One step of a random messagebox workload. */
type Op =
  | { readonly kind: 'post'; readonly audience: 'self' | 'agents' | 'user' | 'record';
      readonly session: string; readonly box: string; readonly text: string }
  | { readonly kind: 'read'; readonly reader: number; readonly ack: boolean;
      readonly audience: 'self' | 'agents' | 'user' | 'record' | undefined; readonly box: string };

const SESSIONS = ['sa', 'sb', 'sc'] as const;
const BOXES    = ['box-1', 'box-2'] as const;

/** The model readers the workload interleaves; index 2 has no agentId (session fallback). */
const READERS: readonly Reader[] = [
  { reader: 'model', session: 'sa', agentId: 'agent-a' },
  { reader: 'model', session: 'sb', agentId: 'agent-b' },
  { reader: 'model', session: 'sc' },
];

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind     : fc.constant('post' as const),
    audience : fc.constantFrom('self', 'agents', 'user', 'record'),
    session  : fc.constantFrom(...SESSIONS),
    box      : fc.constantFrom(...BOXES),
    text     : fc.string({ minLength: 1, maxLength: 24 }).filter(t => t.trim() !== ''),
  }),
  fc.record({
    kind     : fc.constant('read' as const),
    reader   : fc.integer({ min: 0, max: READERS.length - 1 }),
    ack      : fc.boolean(),
    audience : fc.constantFrom('self', 'agents', 'user', 'record', undefined),
    box      : fc.constantFrom(...BOXES),
  }),
);

const workloadArb = fc.array(opArb, { minLength: 1, maxLength: 40 });

/** Stable receipt key for a model reader: agentId, falling back to session. */
function readerKey(reader: Reader): string {
  return reader.agentId ?? reader.session ?? '';
}

describe('messagebox invariants — stochastic workloads', () => {

  it('holds every receipt and fencing invariant under arbitrary interleavings', () => {
    let run = 0;
    fc.assert(
      fc.property(workloadArb, (workload) => {

        run += 1;
        const dir = mkdtempSync(join(tmpdir(), `se-msg-inv-${String(run)}-`)),
              s   = openStore(join(dir, 'log.sqlite3'));

        try {

          // delivered[readerKey] = set of message ids acked to that reader via self/agents.
          const delivered = new Map<string, Set<number>>();
          for (const reader of READERS) { delivered.set(readerKey(reader), new Set()); }

          for (const op of workload) {

            if (op.kind === 'post') {
              postMessage(s, {
                audience : op.audience,
                text     : op.text,
                session  : op.session,
                ...(op.audience === 'agents' ? { box: op.box } : {}),
              }, VERSION);
              continue;
            }

            const reader = READERS[op.reader];
            if (reader === undefined) { continue; }

            const snapshot = JSON.parse(JSON.stringify(
              s.db.prepare('SELECT * FROM messages ORDER BY id').all())) as unknown;

            const rows = readMessages(s, reader, {
              audience : op.audience,
              box      : op.box,
              ack      : op.ack,
            });

            // Reading never mutates a message row — receipts are the only write.
            const after = JSON.parse(JSON.stringify(
              s.db.prepare('SELECT * FROM messages ORDER BY id').all())) as unknown;
            expect(after).toEqual(snapshot);

            // Fencing: self rows only ever from the reader's own session; agents rows
            // only from the requested box (delivery and peek alike).
            for (const row of rows) {
              if (row['audience'] === 'self')   { expect(row['session']).toBe(reader.session); }
              if (row['audience'] === 'agents') { expect(row['box']).toBe(op.box); }
            }

            // At-most-once: an acked self/agents delivery never repeats for this reader.
            if (op.ack) {
              const seen = delivered.get(readerKey(reader));
              for (const row of rows) {
                if (row['audience'] !== 'self' && row['audience'] !== 'agents') { continue; }
                const id = Number(row['id']);
                expect(seen?.has(id)).toBe(false);
                seen?.add(id);
              }
            }

          }

          // Receipts only ever reference existing messages.
          const orphan = s.db.prepare(
            'SELECT COUNT(*) AS n FROM message_reads WHERE message_id NOT IN (SELECT id FROM messages)').get();
          expect(Number(orphan?.['n'])).toBe(0);

          // Unread counts are never negative, for any session.
          for (const session of SESSIONS) {
            const counts = unreadCounts(s, session);
            expect(counts.forModel).toBeGreaterThanOrEqual(0);
            expect(counts.forUser).toBeGreaterThanOrEqual(0);
          }

          // The model never wrote a 'user' receipt, and nobody receipted 'record'.
          const crossed = s.db.prepare(
            `SELECT COUNT(*) AS n FROM message_reads r JOIN messages m ON r.message_id = m.id
              WHERE (m.audience = 'user' AND r.reader = 'model')
                 OR (m.audience = 'record')`).get();
          expect(Number(crossed?.['n'])).toBe(0);

        } finally {
          closeStore(s);
          rmSync(dir, { recursive: true, force: true });
        }

      }),
      { numRuns: 20 }
    );
  }, 120_000);

});
