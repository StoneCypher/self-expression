import {
  EIGHTHS, SHADES, BRAILLE,
  absoluteIndex, relativeIndex, boundaryGlyph, barCells,
} from '../charts/scale.js';

describe('EIGHTHS', () => {

  test('is the eight-step block ramp, lightest to darkest', () => {
    expect(EIGHTHS).toEqual(['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']);
  });

});

describe('SHADES', () => {

  test('is the four-step shade ramp, lightest to darkest', () => {
    expect(SHADES).toEqual(['░', '▒', '▓', '█']);
  });

});

describe('BRAILLE', () => {

  test('is the six-step braille-density ramp', () => {
    expect(BRAILLE).toEqual(['⣀', '⣄', '⣦', '⣶', '⣾', '⣿']);
  });

});

describe('absoluteIndex', () => {

  test('pins the normative 8-glyph threshold', () => {
    expect(absoluteIndex(12.5, 8)).toBe(1);
  });

  test('caps at steps - 1 rather than overflowing past the last glyph', () => {
    expect(absoluteIndex(100, 8)).toBe(7);
  });

  test('the lowest percent maps to the first glyph', () => {
    expect(absoluteIndex(0, 8)).toBe(0);
  });

  test('scales linearly between the pinned thresholds', () => {
    expect(absoluteIndex(25, 8)).toBe(2);
    expect(absoluteIndex(50, 8)).toBe(4);
    expect(absoluteIndex(87.5, 8)).toBe(7);
  });

});

describe('relativeIndex', () => {

  test('the lowest value in the series maps to the first glyph', () => {
    expect(relativeIndex(10, 10, 50, 8)).toBe(0);
  });

  test('the highest value in the series maps to the last glyph', () => {
    expect(relativeIndex(50, 10, 50, 8)).toBe(7);
  });

  test('a flat series (min === max) renders the first glyph, not NaN', () => {
    const index = relativeIndex(3, 3, 3, 8);
    expect(index).toBe(0);
    expect(Number.isNaN(index)).toBe(false);
  });

  test('a midpoint value lands proportionally between the ends', () => {
    expect(relativeIndex(30, 10, 50, 8)).toBe(4);
  });

});

describe('boundaryGlyph', () => {

  test('below the first threshold renders the lightest shade', () => {
    expect(boundaryGlyph(0.16)).toBe('░');
  });

  test('at the first threshold renders the second shade', () => {
    expect(boundaryGlyph(0.17)).toBe('▒');
  });

  test('at the midpoint threshold renders the third shade', () => {
    expect(boundaryGlyph(0.5)).toBe('▓');
  });

  test('at the top threshold renders the darkest shade', () => {
    expect(boundaryGlyph(0.83)).toBe('█');
  });

  test('a fraction of exactly 0 renders the lightest shade', () => {
    expect(boundaryGlyph(0)).toBe('░');
  });

  test('a fraction of exactly 1 renders the darkest shade', () => {
    expect(boundaryGlyph(1)).toBe('█');
  });

});

describe('barCells', () => {

  test('32% — the SKILL.md summary-line example', () => {
    expect(barCells(32)).toBe('███▒░░░░░░');
  });

  test('67% — the SKILL.md summary-line example', () => {
    expect(barCells(67)).toBe('██████▓░░░');
  });

  test('100% is entirely filled, with no boundary or padding cell', () => {
    expect(barCells(100)).toBe('██████████');
  });

  test('0% is entirely empty', () => {
    expect(barCells(0)).toBe('░░░░░░░░░░');
  });

  test('is always exactly 10 characters at the default width', () => {
    for (const percent of [0, 1, 32, 50, 67, 99, 100]) {
      expect([...barCells(percent)]).toHaveLength(10);
    }
  });

  test('honors a non-default cell count', () => {
    expect(barCells(50, 4)).toBe('██░░');
    expect(barCells(100, 4)).toBe('████');
    expect(barCells(0, 4)).toBe('░░░░');
  });

  test('rejects a negative percent', () => {
    expect(() => barCells(-1)).toThrow(RangeError);
  });

  test('rejects a percent above 100', () => {
    expect(() => barCells(101)).toThrow(RangeError);
  });

  test('rejects NaN', () => {
    expect(() => barCells(NaN)).toThrow(RangeError);
  });

  test('the rejection names the accepted domain', () => {
    expect(() => barCells(150)).toThrow(/100/);
  });

});
