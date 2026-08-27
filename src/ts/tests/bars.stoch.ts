/**
 * Stochastic property tests for the charts/bars.ts renderers.
 *
 * Validates the invariants the exact-string spec cannot fully exercise: every fixed-width
 * bar form renders the same length regardless of the value it draws, `renderStacked`'s
 * segments always sum to `width` and always appear in success/active+pending/failure
 * order, and `renderDiverging` always grows the side matching the sign of `value`.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  renderProgressBar, renderBullet, renderDiverging, renderStacked, renderRange, renderBoxWhisker,
} from '../charts/bars.js';
import type { BoxWhiskerStats } from '../charts/bars.js';

const percentArb = fc.float({ min: 0, max: 100, noNaN: true });
const cellsArb = fc.integer({ min: 1, max: 20 });
const cellsPerSideArb = fc.integer({ min: 1, max: 20 });
const widthArb = fc.integer({ min: 3, max: 40 });

describe('renderProgressBar — stochastic invariants', () => {

  it('always renders exactly 10 characters', () => {
    fc.assert(
      fc.property(percentArb, (percent) => {
        expect([...renderProgressBar(percent)]).toHaveLength(10);
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderBullet — stochastic invariants', () => {

  it('always renders exactly `cells` characters', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        cellsArb,
        (valueFraction, targetFraction, cells) => {
          const max = 100;
          const value = valueFraction * max;
          const target = targetFraction * max;
          expect([...renderBullet(value, target, max, cells)]).toHaveLength(cells);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('always contains exactly one target tick', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        cellsArb,
        (valueFraction, targetFraction, cells) => {
          const max = 100;
          const rendered = renderBullet(valueFraction * max, targetFraction * max, max, cells);
          expect((rendered.match(/│/g) ?? []).length).toBe(1);
        }
      ),
      { numRuns: 200 }
    );
  });

});

describe('renderDiverging — stochastic invariants', () => {

  it('always renders exactly 2*cellsPerSide + 1 characters', () => {
    fc.assert(
      fc.property(fc.float({ min: -100, max: 100, noNaN: true }), cellsPerSideArb, (value, cellsPerSide) => {
        expect([...renderDiverging(value, 100, cellsPerSide)]).toHaveLength(2 * cellsPerSide + 1);
      }),
      { numRuns: 200 }
    );
  });

  it('a positive value never fills any cell on the left of center', () => {
    fc.assert(
      fc.property(fc.float({ min: Math.fround(0.001), max: 100, noNaN: true }), cellsPerSideArb, (value, cellsPerSide) => {
        const rendered = renderDiverging(value, 100, cellsPerSide);
        const left = [...rendered].slice(0, cellsPerSide).join('');
        expect(left).toBe('░'.repeat(cellsPerSide));
      }),
      { numRuns: 200 }
    );
  });

  it('a negative value never fills any cell on the right of center', () => {
    fc.assert(
      fc.property(fc.float({ min: -100, max: Math.fround(-0.001), noNaN: true }), cellsPerSideArb, (value, cellsPerSide) => {
        const rendered = renderDiverging(value, 100, cellsPerSide);
        const right = [...rendered].slice(cellsPerSide + 1);
        expect(right.join('')).toBe('░'.repeat(cellsPerSide));
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderStacked — stochastic invariants', () => {

  const countsArb = fc.tuple(
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }),
  ).filter(([s, a, f]) => s + a + f > 0);

  it('segments always sum to exactly `width` cells', () => {
    fc.assert(
      fc.property(countsArb, widthArb, ([success, active, failure], width) => {
        const nonzero = [success, active, failure].filter(v => v > 0).length;
        fc.pre(width >= nonzero);
        const rendered = renderStacked(success, active, failure, width);
        expect([...rendered]).toHaveLength(width);
      }),
      { numRuns: 300 }
    );
  });

  it('segments always appear in success, active+pending, failure order', () => {
    fc.assert(
      fc.property(countsArb, widthArb, ([success, active, failure], width) => {
        const nonzero = [success, active, failure].filter(v => v > 0).length;
        fc.pre(width >= nonzero);
        const rendered = renderStacked(success, active, failure, width);
        expect(rendered).toMatch(/^█*▓*▒*$/);
      }),
      { numRuns: 300 }
    );
  });

  it('every nonzero bucket renders at least one cell', () => {
    fc.assert(
      fc.property(countsArb, widthArb, ([success, active, failure], width) => {
        const nonzero = [success, active, failure].filter(v => v > 0).length;
        fc.pre(width >= nonzero);
        const rendered = renderStacked(success, active, failure, width);
        const fullCount = (rendered.match(/█/g) ?? []).length;
        const pendingCount = (rendered.match(/▓/g) ?? []).length;
        const failCount = (rendered.match(/▒/g) ?? []).length;
        if (success > 0) { expect(fullCount).toBeGreaterThanOrEqual(1); }
        if (active > 0) { expect(pendingCount).toBeGreaterThanOrEqual(1); }
        if (failure > 0) { expect(failCount).toBeGreaterThanOrEqual(1); }
      }),
      { numRuns: 300 }
    );
  });

});

describe('renderRange — stochastic invariants', () => {

  it('always renders exactly 12 characters, for both styles', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom<'fill' | 'marker'>('fill', 'marker'),
        (fraction, style) => {
          const rendered = renderRange(fraction * 10, 0, 10, style);
          expect([...rendered]).toHaveLength(12);
        }
      ),
      { numRuns: 200 }
    );
  });

});

describe('renderBoxWhisker — stochastic invariants', () => {

  const orderedStatsArb: fc.Arbitrary<BoxWhiskerStats> = fc
    .tuple(
      fc.integer({ min: 0, max: 20 }),
      fc.integer({ min: 0, max: 20 }),
      fc.integer({ min: 0, max: 20 }),
      fc.integer({ min: 0, max: 20 }),
    )
    .map(([a, b, c, d]) => {
      const sorted = [a, b, c, d].sort((x, y) => x - y);
      return { min: sorted[0], q1: sorted[1], median: sorted[2], q3: sorted[3], max: sorted[3] + 1 };
    });

  it('always renders exactly `width` characters for ordered stats', () => {
    fc.assert(
      fc.property(orderedStatsArb, widthArb, (stats, width) => {
        expect([...renderBoxWhisker(stats, width)]).toHaveLength(width);
      }),
      { numRuns: 200 }
    );
  });

  it('unordered stats always throw RangeError', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 0, max: 20 }),
        ).filter(([min, q1, median, q3, max]) => !(min <= q1 && q1 <= median && median <= q3 && q3 <= max)),
        ([min, q1, median, q3, max]) => {
          expect(() => renderBoxWhisker({ min, q1, median, q3, max })).toThrow(RangeError);
        }
      ),
      { numRuns: 300 }
    );
  });

});
