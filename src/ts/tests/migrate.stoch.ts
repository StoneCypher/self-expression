/**
 * Stochastic property tests for the v1→v2 migration in channels/migrate.ts.
 *
 * The property: **any** v1 database — whatever mix of channels, vocabulary values,
 * numbers, and free text its rows carry — migrates losslessly. Every v1 column of
 * every row reads back identical through the migrated store, the new columns arrive
 * NULL, and the writes the v1 CHECKs rejected now succeed.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, readMeta } from '../channels/store.js';
import { recordEntry }                     from '../channels/entries.js';
import { V1_ENTRY_COLUMNS }                from '../channels/migrate.js';
import { SCHEMA_VERSION }                  from '../channels/schema.js';
import { buildV1, insertV1 }               from './helpers/v1_fixture.js';

const VERSION = '0.0.0-stoch';

/** The v1 closed vocabularies, frozen alongside the fixture DDL they appear in. */
const V1_CHANNELS    = ['signature', 'need', 'idea', 'divergence', 'dissent', 'conflict',
                        'confidence', 'unanswerable', 'pattern', 'checklist'] as const;
const V1_POSITIONS   = ['open', 'close', 'mid'] as const;
const V1_DELTAS      = ['up', 'down', 'steady'] as const;
const V1_STEMS       = ['flow', 'spark', 'drag', 'fog', 'strain', 'still'] as const;
const V1_CONFIDENCE  = ['verified', 'recalled', 'inferred', 'guessed'] as const;
const V1_DIVERGENCE  = ['unverified', 'assumed', 'misread', 'overstated', 'stale'] as const;

const maybe = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> =>
  fc.option(arb, { nil: undefined });

/** One random v1 row's optional columns; undefined means "column not supplied". */
const extrasArb = fc.record({
  position        : maybe(fc.constantFrom(...V1_POSITIONS)),
  delta           : maybe(fc.constantFrom(...V1_DELTAS)),
  stem            : maybe(fc.constantFrom(...V1_STEMS)),
  confidence      : maybe(fc.constantFrom(...V1_CONFIDENCE)),
  divergence_kind : maybe(fc.constantFrom(...V1_DIVERGENCE)),
  face            : maybe(fc.string({ minLength: 1, maxLength: 4 })),
  model           : maybe(fc.string({ minLength: 1, maxLength: 24 })),
  series_key      : maybe(fc.string({ minLength: 1, maxLength: 12 })),
  title           : maybe(fc.string({ minLength: 0, maxLength: 24 })),
  percent         : maybe(fc.integer({ min: 0, max: 100 })),
  tool_calls      : maybe(fc.integer({ min: 0, max: 500 })),
  context_tokens  : maybe(fc.integer({ min: 0, max: 1_000_000 })),
});

const rowArb  = fc.record({ channel: fc.constantFrom(...V1_CHANNELS), extras: extrasArb });
const rowsArb = fc.array(rowArb, { minLength: 1, maxLength: 12 });

describe('v1→v2 migration — stochastic losslessness', () => {

  it('migrates any v1 database without changing a single stored value', () => {
    let run = 0;
    fc.assert(
      fc.property(rowsArb, (rows) => {

        run += 1;
        const dir  = mkdtempSync(join(tmpdir(), `se-migrate-stoch-${String(run)}-`)),
              path = join(dir, 'log.sqlite3');

        try {
          const v1 = buildV1(path);
          for (const [index, row] of rows.entries()) {
            const extras = Object.fromEntries(
              Object.entries(row.extras).filter(([, v]) => v !== undefined)
            ) as Record<string, string | number>;
            insertV1(v1, `u-${String(index)}`, row.channel, extras);
          }
          const columns = V1_ENTRY_COLUMNS.join(', '),
                before  = JSON.parse(JSON.stringify(
                  v1.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;
          v1.close();

          const s     = openStore(path),
                after = JSON.parse(JSON.stringify(
                  s.db.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;

          expect(after).toEqual(before);
          expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));

          const fresh = s.db.prepare(
            'SELECT COUNT(*) n FROM entries WHERE resolve_by IS NOT NULL OR outcome IS NOT NULL OR silence IS NOT NULL').get();
          expect(fresh?.n).toBe(0);

          // The vocabulary the v1 CHECKs rejected now writes cleanly.
          recordEntry(s, { channel: 'taste', text: 'post-migration taste', session: 's1' }, VERSION);
          recordEntry(s, { channel: 'confidence', text: 'post-migration forecast', session: 's1',
                           confidence: 'predicted', resolveBy: '2026-08-30' }, VERSION);
          recordEntry(s, { channel: 'divergence', text: 'post-migration faded', session: 's1',
                           divergenceKind: 'faded', silence: 'unlooked' }, VERSION);

          closeStore(s);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }

      }),
      { numRuns: 15 }
    );
  }, 120_000);

});
