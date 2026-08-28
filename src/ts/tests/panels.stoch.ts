/**
 * Stochastic property tests for the dashboard panels.
 *
 * The load-bearing invariant: whatever rows a panel is fed — any stems, deltas,
 * timestamps, counts, or percents, valid-looking or garbage — it never paints a
 * single pixel outside the region it was handed, and it never throws.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { WHITE, fullRegion, makeSurface, subRegion } from '../raster/surface.js';
import type { Region } from '../raster/surface.js';
import {
  drawChecklistSeries, drawDeltaLane, drawNeedRate, drawStemPunch, drawUncertainStrip,
  rollingMean,
} from '../raster/panels.js';
import type { ChecklistSeriesRow, NeedWeekRow, SignatureRow } from '../raster/panels.js';

const END = '2026-08-27T21:00:00.000Z';

const stemArb  = fc.option(fc.constantFrom('flow', 'spark', 'drag', 'fog', 'strain', 'still', 'vibes'), { nil: null });
const deltaArb = fc.option(fc.constantFrom('up', 'down', 'steady', 'flat'), { nil: null });

const tsArb = fc.oneof(
  fc.integer({ min: 0, max: 120 }).map(daysBack =>
    new Date(Date.parse(END) - daysBack * 86_400_000).toISOString()),
  fc.constant('whenever'),   // unparseable on purpose
);

const signatureArb: fc.Arbitrary<SignatureRow> = fc.record({
  id        : fc.integer({ min: 1, max: 10_000 }),
  tsUtc     : tsArb,
  hourLocal : fc.option(fc.integer({ min: 0, max: 23 }), { nil: null }),
  stem      : stemArb,
  delta     : deltaArb,
  uncertain : fc.boolean(),
  project   : fc.option(fc.string({ maxLength: 8 }), { nil: null }),
});

const weekArb: fc.Arbitrary<NeedWeekRow> = fc.record({
  week  : fc.constantFrom('2026-W30', '2026-W31', '2026-W32', '2026-W33'),
  turns : fc.integer({ min: 0, max: 500 }),
  needs : fc.integer({ min: 0, max: 500 }),
});

const seriesArb: fc.Arbitrary<ChecklistSeriesRow> = fc.record({
  seriesKey : fc.string({ minLength: 1, maxLength: 24 }),
  percents  : fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 20 }),
});

/** A random panel region inside a 60×60 surface, leaving a border to check. */
const regionSetupArb = fc.record({
  x      : fc.integer({ min: 2, max: 10 }),
  y      : fc.integer({ min: 2, max: 10 }),
  width  : fc.integer({ min: 10, max: 40 }),
  height : fc.integer({ min: 10, max: 40 }),
});

/** Counts pixels outside `region` on its surface that are no longer white. */
function outsideViolations(region: Region): number {
  const { surface } = region;
  let violations = 0;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const inside = x >= region.x && x < region.x + region.width
                  && y >= region.y && y < region.y + region.height;
      if (!inside) {
        const i = 4 * (y * surface.width + x);
        if (surface.data[i] !== WHITE[0] || surface.data[i + 1] !== WHITE[1]
         || surface.data[i + 2] !== WHITE[2] || surface.data[i + 3] !== WHITE[3]) { violations++; }
      }
    }
  }
  return violations;
}

describe('panel confinement — stochastic invariants', () => {

  it('the signature panels never paint outside their region, for any rows', () => {
    fc.assert(
      fc.property(
        regionSetupArb,
        fc.array(signatureArb, { maxLength: 20 }),
        fc.integer({ min: 1, max: 120 }),
        (setup, rows, days) => {
          const region = subRegion(fullRegion(makeSurface(60, 60, WHITE)), setup.x, setup.y, setup.width, setup.height);
          drawStemPunch(region, rows, days, END);
          drawDeltaLane(region, rows);
          drawUncertainStrip(region, rows, days, END);
          expect(outsideViolations(region)).toBe(0);
        }
      ),
      { numRuns: 40 }
    );
  }, 30_000);

  it('the need and checklist panels never paint outside their region, for any data', () => {
    fc.assert(
      fc.property(
        regionSetupArb,
        fc.array(weekArb, { maxLength: 10 }),
        fc.array(seriesArb, { maxLength: 6 }),
        (setup, weeks, series) => {
          const region = subRegion(fullRegion(makeSurface(60, 60, WHITE)), setup.x, setup.y, setup.width, setup.height);
          drawNeedRate(region, weeks);
          drawChecklistSeries(region, series);
          expect(outsideViolations(region)).toBe(0);
        }
      ),
      { numRuns: 40 }
    );
  }, 30_000);

});

describe('rollingMean — stochastic invariants', () => {

  it('output length always matches input length, and values stay within input bounds', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(-1, 0, 1), { maxLength: 60 }),
        fc.integer({ min: 1, max: 30 }),
        (values, window) => {
          const means = rollingMean(values, window);
          expect(means).toHaveLength(values.length);
          for (const mean of means) {
            expect(mean).toBeGreaterThanOrEqual(-1);
            expect(mean).toBeLessThanOrEqual(1);
          }
        }
      ),
      { numRuns: 150 }
    );
  });

  it('a constant series has a constant mean, for any window', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(-1, 0, 1),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 30 }),
        (value, length, window) => {
          const means = rollingMean(new Array<number>(length).fill(value), window);
          for (const mean of means) { expect(mean).toBe(value); }
        }
      ),
      { numRuns: 150 }
    );
  });

});
