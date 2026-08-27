import {
  OUTCOMES,
  renderSparkline, renderBraille, renderWinLoss,
} from '../charts/series.js';
import { EIGHTHS, BRAILLE } from '../charts/scale.js';
import type { Outcome } from '../charts/series.js';

describe('renderSparkline', () => {

  test('absolute scale — the 0/12.5/25/100 boundary example', () => {
    expect(renderSparkline([0, 12.5, 25, 100], 'absolute')).toBe('▁▂▃█');
  });

  test('absolute scale — 95 floors to index 7, 5 floors to index 0', () => {
    // 95 → floor(95 / 12.5) = floor(7.6) = 7 → '█'; 5 → floor(0.4) = 0 → '▁'
    expect(renderSparkline([5, 95, 5, 95], 'absolute')).toBe('▁█▁█');
  });

  test('relative scale — pinned to the real relativeIndex arithmetic for [10,20,30,40]', () => {
    // min=10, max=40, steps=8: fractions 0, 1/3, 2/3, 1 → floor(*8) → 0, 2, 5, 7 (last clamped)
    expect(renderSparkline([10, 20, 30, 40], 'relative')).toBe('▁▃▆█');
  });

  test('every glyph in a sparkline comes from the EIGHTHS ramp', () => {
    const rendered = renderSparkline([0, 33, 66, 100], 'absolute');
    for (const glyph of rendered) {
      expect(EIGHTHS).toContain(glyph);
    }
  });

  test('fewer than 4 points throws RangeError pointing at the trend tag', () => {
    expect(() => renderSparkline([1, 2, 3], 'absolute')).toThrow(RangeError);
    try {
      renderSparkline([1, 2, 3], 'absolute');
    } catch (err) {
      expect((err as Error).message).toContain('trend tag');
    }
  });

  test('an empty series throws RangeError pointing at the trend tag', () => {
    expect(() => renderSparkline([], 'absolute')).toThrow(RangeError);
  });

  test('exactly 4 points is accepted', () => {
    expect(() => renderSparkline([1, 2, 3, 4], 'absolute')).not.toThrow();
  });

  test('a flat relative series renders every point as the first glyph', () => {
    expect(renderSparkline([5, 5, 5, 5], 'relative')).toBe('▁▁▁▁');
  });

});

describe('renderBraille', () => {

  test('absolute scale — same contract as renderSparkline, on the BRAILLE ramp', () => {
    // 0→floor(0/16.667)=0; 20→floor(1.2)=1; 50→floor(3.0)=3; 100→floor(6.0)=6 clamped to 5
    expect(renderBraille([0, 20, 50, 100], 'absolute')).toBe('⣀⣄⣶⣿');
  });

  test('relative scale — pinned to the real relativeIndex arithmetic for [10,20,30,40]', () => {
    // min=10, max=40, steps=6: fractions 0, 1/3, 2/3, 1 → floor(*6) → 0, 2, 4, 6 (last clamped to 5)
    expect(renderBraille([10, 20, 30, 40], 'relative')).toBe('⣀⣦⣾⣿');
  });

  test('every glyph in a braille microplot comes from the BRAILLE ramp', () => {
    const rendered = renderBraille([0, 33, 66, 100], 'absolute');
    for (const glyph of rendered) {
      expect(BRAILLE).toContain(glyph);
    }
  });

  test('fewer than 4 points throws RangeError pointing at the trend tag', () => {
    expect(() => renderBraille([1, 2, 3], 'absolute')).toThrow(RangeError);
    try {
      renderBraille([1, 2, 3], 'absolute');
    } catch (err) {
      expect((err as Error).message).toContain('trend tag');
    }
  });

});

describe('OUTCOMES', () => {

  test('matches the documented vocabulary and order', () => {
    expect(OUTCOMES).toEqual(['pass', 'flaky', 'fail', 'underway', 'queued', 'skipped']);
  });

});

describe('renderWinLoss', () => {

  test('the visuals.md example', () => {
    const outcomes: readonly Outcome[] = [
      'pass', 'pass', 'fail', 'flaky', 'pass', 'underway', 'queued', 'queued',
    ];
    expect(renderWinLoss(outcomes)).toBe('✅✅❌🟨✅🟦⬛⬛');
  });

  test('a single-outcome strip renders one glyph, no separators', () => {
    expect(renderWinLoss(['pass'])).toBe('✅');
  });

  test('an empty strip renders an empty string', () => {
    expect(renderWinLoss([])).toBe('');
  });

  test('every outcome in the vocabulary has a distinct glyph', () => {
    const rendered = OUTCOMES.map(o => renderWinLoss([o as Outcome]));
    expect(new Set(rendered).size).toBe(OUTCOMES.length);
  });

  test('skipped renders the orange square', () => {
    expect(renderWinLoss(['skipped'])).toBe('🟧');
  });

  test('rejects an outcome outside the closed vocabulary, naming the accepted domain', () => {
    // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
    expect(() => renderWinLoss(['draw'])).toThrow(RangeError);
    try {
      // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
      renderWinLoss(['draw']);
    } catch (err) {
      expect((err as Error).message).toContain("'pass'");
      expect((err as Error).message).toContain("'skipped'");
    }
  });

});
