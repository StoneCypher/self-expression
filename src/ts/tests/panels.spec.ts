import {
  BLUE, GREY, ORANGE, VERMILLION, WHITE,
  fullRegion, makeSurface,
} from '../raster/surface.js';
import type { Rgba, Surface } from '../raster/surface.js';
import {
  DELTA_WINDOW, SERIES_COLORS, STEM_COLORS,
  dayColumn, deltaColor, drawChecklistSeries, drawDeltaLane, drawNeedRate,
  drawStemPunch, drawUncertainStrip, rollingMean, stemColor,
} from '../raster/panels.js';
import type { SignatureRow } from '../raster/panels.js';

const END = '2026-08-27T21:00:00.000Z';

/** A signature row with sensible defaults, overridable per test. */
function row(overrides: Partial<SignatureRow>): SignatureRow {
  return {
    id: 1, tsUtc: END, hourLocal: 9, stem: null, delta: null,
    uncertain: false, project: null,
    ...overrides,
  };
}

/** How many pixels of a surface carry exactly this color. */
function countColor(surface: Surface, color: Rgba): number {
  let count = 0;
  for (let i = 0; i < surface.data.length; i += 4) {
    if (surface.data[i] === color[0] && surface.data[i + 1] === color[1]
     && surface.data[i + 2] === color[2] && surface.data[i + 3] === color[3]) { count++; }
  }
  return count;
}

/** The smallest y at which this color appears, or null when absent. */
function minYOf(surface: Surface, color: Rgba): number | null {
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const i = 4 * (y * surface.width + x);
      if (surface.data[i] === color[0] && surface.data[i + 1] === color[1]
       && surface.data[i + 2] === color[2] && surface.data[i + 3] === color[3]) { return y; }
    }
  }
  return null;
}

describe('dayColumn', () => {

  test('the end day is the last column; each day back steps one column left', () => {
    expect(dayColumn(END, END, 7)).toBe(6);
    expect(dayColumn('2026-08-26T04:00:00Z', END, 7)).toBe(5);
    expect(dayColumn('2026-08-21T23:59:59Z', END, 7)).toBe(0);
  });

  test('a timestamp before the window returns null rather than a negative column', () => {
    expect(dayColumn('2026-08-20T12:00:00Z', END, 7)).toBeNull();
  });

  test('an unparseable timestamp returns null rather than NaN arithmetic', () => {
    expect(dayColumn('whenever', END, 7)).toBeNull();
  });

});

describe('rollingMean', () => {

  test('window 1 is the identity', () => {
    expect(rollingMean([1, -1, 0, 1], 1)).toEqual([1, -1, 0, 1]);
  });

  test('averages the trailing window, partial at the start', () => {
    expect(rollingMean([1, 1, -1, -1], 2)).toEqual([1, 1, 0, -1]);
  });

  test('an empty series stays empty', () => {
    expect(rollingMean([], DELTA_WINDOW)).toEqual([]);
  });

});

describe('category colors', () => {

  test('delta: up is blue, down is vermillion, everything else grey', () => {
    expect(deltaColor('up')).toEqual(BLUE);
    expect(deltaColor('down')).toEqual(VERMILLION);
    expect(deltaColor('steady')).toEqual(GREY);
    expect(deltaColor(null)).toEqual(GREY);
    expect(deltaColor('sideways')).toEqual(GREY);
  });

  test('every stem has a distinct non-grey color; unknown and null fall to grey', () => {
    const seen = new Set<string>();
    for (const [name] of STEM_COLORS) {
      const color = stemColor(name);
      expect(color).not.toEqual(GREY);
      seen.add(color.join(','));
    }
    expect(seen.size).toBe(STEM_COLORS.length);
    expect(stemColor(null)).toEqual(GREY);
    expect(stemColor('vibes')).toEqual(GREY);
  });

});

describe('drawStemPunch', () => {

  test("a 'flow' signature adds one 2×2 blue dot beyond the legend's fixed swatch", () => {
    const withFlow  = makeSurface(300, 200, WHITE);
    const withStill = makeSurface(300, 200, WHITE);
    drawStemPunch(fullRegion(withFlow),  [row({ stem: 'flow'  })], 30, END);
    drawStemPunch(fullRegion(withStill), [row({ stem: 'still' })], 30, END);
    // Identical layouts — legend, frame, gridlines — differing only in the dot's color.
    expect(countColor(withFlow, BLUE)).toBe(countColor(withStill, BLUE) + 4);
  });

  test('a row with an unparseable local hour draws no dot', () => {
    const withDot    = makeSurface(300, 200, WHITE);
    const withoutDot = makeSurface(300, 200, WHITE);
    drawStemPunch(fullRegion(withDot),    [row({ stem: 'flow', hourLocal: 9 })],    30, END);
    drawStemPunch(fullRegion(withoutDot), [row({ stem: 'flow', hourLocal: null })], 30, END);
    expect(countColor(withoutDot, BLUE)).toBe(countColor(withDot, BLUE) - 4);
  });

  test('empty rows render the frame plus a grey no-data message, no legend', () => {
    const surface = makeSurface(300, 200, WHITE);
    drawStemPunch(fullRegion(surface), [], 30, END);
    expect(countColor(surface, GREY)).toBeGreaterThan(0);          // the message text
    expect(countColor(surface, BLUE)).toBe(0);                     // no legend, no dots
    expect(countColor(surface, ORANGE)).toBe(0);
  });

});

describe('drawDeltaLane', () => {

  test('an all-up lane is blue with no vermillion; an all-down lane the reverse', () => {
    const up   = makeSurface(300, 200, WHITE);
    const down = makeSurface(300, 200, WHITE);
    const rowsUp   = [1, 2, 3, 4].map(id => row({ id, delta: 'up' }));
    const rowsDown = [1, 2, 3, 4].map(id => row({ id, delta: 'down' }));
    drawDeltaLane(fullRegion(up),   rowsUp);
    drawDeltaLane(fullRegion(down), rowsDown);
    expect(countColor(up, BLUE)).toBeGreaterThan(0);
    expect(countColor(up, VERMILLION)).toBe(0);
    expect(countColor(down, VERMILLION)).toBeGreaterThan(0);
    expect(countColor(down, BLUE)).toBe(0);
  });

  test('empty rows render the grey no-data message and no lane colors', () => {
    const surface = makeSurface(300, 200, WHITE);
    drawDeltaLane(fullRegion(surface), []);
    expect(countColor(surface, GREY)).toBeGreaterThan(0);
    expect(countColor(surface, BLUE)).toBe(0);
    expect(countColor(surface, VERMILLION)).toBe(0);
  });

});

describe('drawUncertainStrip', () => {

  test('uncertain days raise vermillion bars; a certain history raises none', () => {
    const spiky = makeSurface(300, 120, WHITE);
    const calm  = makeSurface(300, 120, WHITE);
    drawUncertainStrip(fullRegion(spiky), [row({ uncertain: true }), row({ uncertain: true })], 30, END);
    drawUncertainStrip(fullRegion(calm),  [row({ uncertain: false }), row({ uncertain: false })], 30, END);
    expect(countColor(spiky, VERMILLION)).toBeGreaterThan(0);
    expect(countColor(calm, VERMILLION)).toBe(0);
  });

  test('a half-uncertain day draws a shorter bar than a fully uncertain one', () => {
    const full = makeSurface(300, 120, WHITE);
    const half = makeSurface(300, 120, WHITE);
    drawUncertainStrip(fullRegion(full), [row({ uncertain: true }), row({ uncertain: true })], 30, END);
    drawUncertainStrip(fullRegion(half), [row({ uncertain: true }), row({ uncertain: false })], 30, END);
    expect(countColor(half, VERMILLION)).toBeLessThan(countColor(full, VERMILLION));
    expect(countColor(half, VERMILLION)).toBeGreaterThan(0);
  });

  test('empty rows render the grey no-data message', () => {
    const surface = makeSurface(300, 120, WHITE);
    drawUncertainStrip(fullRegion(surface), [], 30, END);
    expect(countColor(surface, GREY)).toBeGreaterThan(0);
    expect(countColor(surface, VERMILLION)).toBe(0);
  });

});

describe('drawNeedRate', () => {

  test('a 100% need week lifts the rate line far above a 0% week', () => {
    const all  = makeSurface(300, 200, WHITE);
    const none = makeSurface(300, 200, WHITE);
    drawNeedRate(fullRegion(all),  [{ week: '2026-W30', turns: 10, needs: 10 }]);
    drawNeedRate(fullRegion(none), [{ week: '2026-W30', turns: 10, needs: 0 }]);
    const allTop = minYOf(all, BLUE), noneTop = minYOf(none, BLUE);
    expect(allTop).not.toBeNull();
    expect(noneTop).not.toBeNull();
    expect(allTop ?? 0).toBeLessThan(noneTop ?? 0);
  });

  test('needs render as orange overlay bars; a needless history draws none', () => {
    const some = makeSurface(300, 200, WHITE);
    const zero = makeSurface(300, 200, WHITE);
    drawNeedRate(fullRegion(some), [{ week: '2026-W30', turns: 10, needs: 5 }]);
    drawNeedRate(fullRegion(zero), [{ week: '2026-W30', turns: 10, needs: 0 }]);
    expect(countColor(some, ORANGE)).toBeGreaterThan(0);
    expect(countColor(zero, ORANGE)).toBe(0);
  });

  test('empty weeks render the grey no-data message', () => {
    const surface = makeSurface(300, 200, WHITE);
    drawNeedRate(fullRegion(surface), []);
    expect(countColor(surface, ORANGE)).toBe(0);
    expect(countColor(surface, BLUE)).toBe(0);
  });

});

describe('drawChecklistSeries', () => {

  test('a constant-100% series touches the plot top; a constant-0% one sits at the bottom', () => {
    const high = makeSurface(300, 200, WHITE);
    const low  = makeSurface(300, 200, WHITE);
    drawChecklistSeries(fullRegion(high), [{ seriesKey: 'coverage', percents: [100, 100, 100] }]);
    drawChecklistSeries(fullRegion(low),  [{ seriesKey: 'coverage', percents: [0, 0, 0] }]);
    // panelFrame insets the plot to y=14+2; the 100% line lands at plot y 2 → surface y 16.
    expect(minYOf(high, BLUE)).toBe(16);
    expect(minYOf(low, BLUE) ?? 0).toBeGreaterThan(16);   // only the label swatch sits high
  });

  test('each series takes the next line color', () => {
    const surface = makeSurface(300, 200, WHITE);
    drawChecklistSeries(fullRegion(surface), [
      { seriesKey: 'one', percents: [50, 60] },
      { seriesKey: 'two', percents: [20, 30] },
    ]);
    expect(countColor(surface, SERIES_COLORS[0] ?? BLUE)).toBeGreaterThan(0);
    expect(countColor(surface, SERIES_COLORS[1] ?? ORANGE)).toBeGreaterThan(0);
  });

  test('empty series render the grey no-data message and no lines', () => {
    const surface = makeSurface(300, 200, WHITE);
    drawChecklistSeries(fullRegion(surface), []);
    expect(countColor(surface, GREY)).toBeGreaterThan(0);
    expect(countColor(surface, BLUE)).toBe(0);
  });

  test('a non-finite percent is skipped rather than clamped, and never hangs', () => {
    const surface = makeSurface(300, 200, WHITE);
    // Used to hang: Math.min(100, Math.max(0, NaN)) is still NaN, which fed a
    // never-terminating Bresenham walk in the surface layer.
    expect(() => drawChecklistSeries(fullRegion(surface), [
      { seriesKey: 'gappy', percents: [10, Number.NaN, 30, Infinity, -Infinity, 50] },
    ])).not.toThrow();
  });

});
