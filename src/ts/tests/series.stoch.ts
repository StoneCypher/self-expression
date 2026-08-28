/**
 * Stochastic property tests for the charts/series.ts renderers.
 *
 * Validates the invariants the exact-string spec cannot fully exercise: a sparkline or
 * braille microplot always emits exactly one glyph per data point, every glyph it emits
 * comes from the documented ramp, and any series shorter than four points always throws
 * — regardless of what the values are.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { OUTCOMES, renderSparkline, renderBraille, renderWinLoss } from '../charts/series.js';
import { EIGHTHS, BRAILLE } from '../charts/scale.js';
import type { Outcome } from '../charts/series.js';

const scaleArb  = fc.constantFrom<'absolute' | 'relative'>('absolute', 'relative');
const valueArb  = fc.float({ min: -1000, max: 1000, noNaN: true });
const seriesArb = fc.array(valueArb, { minLength: 4, maxLength: 40 });
const shortSeriesArb = fc.array(valueArb, { minLength: 0, maxLength: 3 });
const outcomeArb = fc.constantFrom(...(OUTCOMES as readonly Outcome[]));
const outcomesArb = fc.array(outcomeArb, { minLength: 0, maxLength: 30 });

describe('renderSparkline — stochastic invariants', () => {

  it('emits exactly one glyph per data point', () => {
    fc.assert(
      fc.property(seriesArb, scaleArb, (series, scale) => {
        const rendered = renderSparkline(series, scale);
        expect([...rendered]).toHaveLength(series.length);
      }),
      { numRuns: 200 }
    );
  });

  it('every glyph it emits belongs to the EIGHTHS ramp', () => {
    fc.assert(
      fc.property(seriesArb, scaleArb, (series, scale) => {
        const rendered = renderSparkline(series, scale);
        for (const glyph of rendered) { expect(EIGHTHS).toContain(glyph); }
      }),
      { numRuns: 200 }
    );
  });

  it('fewer than 4 points always throws RangeError', () => {
    fc.assert(
      fc.property(shortSeriesArb, scaleArb, (series, scale) => {
        expect(() => renderSparkline(series, scale)).toThrow(RangeError);
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderBraille — stochastic invariants', () => {

  it('emits exactly one glyph per data point', () => {
    fc.assert(
      fc.property(seriesArb, scaleArb, (series, scale) => {
        const rendered = renderBraille(series, scale);
        expect([...rendered]).toHaveLength(series.length);
      }),
      { numRuns: 200 }
    );
  });

  it('every glyph it emits belongs to the BRAILLE ramp', () => {
    fc.assert(
      fc.property(seriesArb, scaleArb, (series, scale) => {
        const rendered = renderBraille(series, scale);
        for (const glyph of rendered) { expect(BRAILLE).toContain(glyph); }
      }),
      { numRuns: 200 }
    );
  });

  it('fewer than 4 points always throws RangeError', () => {
    fc.assert(
      fc.property(shortSeriesArb, scaleArb, (series, scale) => {
        expect(() => renderBraille(series, scale)).toThrow(RangeError);
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderWinLoss — stochastic invariants', () => {

  it('emits exactly one glyph per outcome, no separators', () => {
    fc.assert(
      fc.property(outcomesArb, (outcomes) => {
        const rendered = renderWinLoss(outcomes);
        expect([...rendered]).toHaveLength(outcomes.length);
      }),
      { numRuns: 200 }
    );
  });

});
