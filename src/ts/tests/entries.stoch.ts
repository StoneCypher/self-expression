/**
 * Stochastic property tests for the checklist series contract in channels/entries.ts.
 *
 * Validates the invariant issue #27 exists to protect: series identity lives in
 * `series_key` alone, so no matter how a checklist's display title wanders between
 * snapshots — rewordings, typo fixes, arbitrary strings — the percent history recorded
 * under one key always replays whole, in recording order, uncontaminated by any other
 * series. Also pins the validation edge: a percent snapshot without a `seriesKey` is
 * never accepted, whatever the percent, because unkeyed it could never be found again.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore }               from '../channels/store.js';
import type { Store }                          from '../channels/store.js';
import { recordEntry, validate, seriesPercents } from '../channels/entries.js';

const VERSION = '0.0.0-stoch';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-entries-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

const percentArb  = fc.integer({ min: 0, max: 100 });
const titleArb    = fc.string({ minLength: 0, maxLength: 40 });
const seriesArb   = fc.array(percentArb, { minLength: 1, maxLength: 8 });
const seriesSetArb = fc.array(seriesArb, { minLength: 1, maxLength: 4 });

describe('checklist series identity — stochastic invariants', () => {

  it('replays each key\'s percents whole and in order, however the titles wander', () => {
    withStore(s => {

      // One shared store across property runs — opening SQLite per run is too slow —
      // with the series keys namespaced by run so runs cannot contaminate each other.
      let run = 0;

      fc.assert(
        fc.property(seriesSetArb, fc.array(titleArb, { minLength: 1, maxLength: 40 }), (seriesSet, titles) => {

          run    += 1;
          const key     = (index: number): string => `r${String(run)}-series-${String(index)}`;
          const longest = Math.max(...seriesSet.map(percents => percents.length));
          let   written = 0;

          // Interleave the series round-robin, so consecutive snapshots of one series
          // are separated by rows from the others — the realistic write pattern.
          for (let step = 0; step < longest; step++) {
            for (const [index, percents] of seriesSet.entries()) {
              const percent = percents[step];
              if (percent === undefined) { continue; }
              recordEntry(s, {
                channel   : 'checklist',
                text      : 'snapshot',
                session   : 's1',
                seriesKey : key(index),
                title     : titles[written % titles.length],
                percent,
              }, VERSION);
              written += 1;
            }
          }

          for (const [index, percents] of seriesSet.entries()) {
            expect(seriesPercents(s, key(index))).toEqual(percents);
          }

        }),
        { numRuns: 25 }
      );

    });
  }, 30_000);

  it('never accepts a percent snapshot without a seriesKey', () => {
    fc.assert(
      fc.property(percentArb, titleArb, (percent, title) => {
        const problems = validate({ channel: 'checklist', text: 'x', session: 's', title, percent });
        expect(problems.some(p => p.includes('seriesKey'))).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('accepts every keyed integer snapshot in range, whatever the title', () => {
    fc.assert(
      fc.property(percentArb, titleArb, (percent, title) => {
        expect(validate({
          channel: 'checklist', text: 'x', session: 's',
          seriesKey: 'k', title, percent,
        })).toEqual([]);
      }),
      { numRuns: 200 }
    );
  });

});
