/**
 * Stochastic property tests for the charts/scale.ts arithmetic.
 *
 * Validates the invariants the exact-string spec cannot fully exercise: `barCells`
 * always renders exactly `cells` characters and never gets visually darker as `percent`
 * drops, and `absoluteIndex` never escapes the `[0, steps - 1]` glyph range it promises.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { absoluteIndex, barCells } from '../charts/scale.js';

const percentArb = fc.float({ min: 0, max: 100, noNaN: true });
const cellsArb    = fc.integer({ min: 1, max: 40 });
const stepsArb    = fc.integer({ min: 1, max: 20 });

/** Counts the `█` glyphs in a rendered bar — the visual "how full" reading. */
function fullGlyphCount(bar: string): number {
  return [...bar].filter(ch => ch === '█').length;
}

describe('barCells — stochastic invariants', () => {

  it('always renders exactly `cells` characters, for any valid percent', () => {
    fc.assert(
      fc.property(percentArb, cellsArb, (percent, cells) => {
        expect([...barCells(percent, cells)]).toHaveLength(cells);
      }),
      { numRuns: 200 }
    );
  });

  it('fill is monotone nondecreasing as percent rises, for a fixed cell count', () => {
    fc.assert(
      fc.property(percentArb, percentArb, cellsArb, (a, b, cells) => {
        const lower = Math.min(a, b);
        const higher = Math.max(a, b);
        expect(fullGlyphCount(barCells(lower, cells)))
          .toBeLessThanOrEqual(fullGlyphCount(barCells(higher, cells)));
      }),
      { numRuns: 200 }
    );
  });

});

describe('absoluteIndex — stochastic invariants', () => {

  it('never escapes [0, steps - 1] for any percent in [0, 100]', () => {
    fc.assert(
      fc.property(percentArb, stepsArb, (percent, steps) => {
        const index = absoluteIndex(percent, steps);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(steps - 1);
      }),
      { numRuns: 200 }
    );
  });

});
