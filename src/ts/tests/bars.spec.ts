import {
  renderProgressBar, renderBullet, renderDiverging, renderStacked, renderRange, renderBoxWhisker,
} from '../charts/bars.js';
import type { BoxWhiskerStats } from '../charts/bars.js';

describe('renderProgressBar', () => {

  test('delegates to the shared barCells arithmetic at width 10 — 32%', () => {
    expect(renderProgressBar(32)).toBe('███▒░░░░░░');
  });

  test('67%', () => {
    expect(renderProgressBar(67)).toBe('██████▓░░░');
  });

  test('100% is entirely filled', () => {
    expect(renderProgressBar(100)).toBe('██████████');
  });

  test('0% is entirely empty', () => {
    expect(renderProgressBar(0)).toBe('░░░░░░░░░░');
  });

  test('is always exactly 10 characters', () => {
    for (const percent of [0, 1, 32, 50, 67, 99, 100]) {
      expect([...renderProgressBar(percent)]).toHaveLength(10);
    }
  });

  test('rejects a percent outside [0, 100]', () => {
    expect(() => renderProgressBar(-1)).toThrow(RangeError);
    expect(() => renderProgressBar(101)).toThrow(RangeError);
    expect(() => renderProgressBar(NaN)).toThrow(RangeError);
  });

});

describe('renderBullet', () => {

  test('the brief\'s pinned example: value=65, target=90, max=100, cells=10', () => {
    // cellWidth = max / cells = 10
    // full = floor(value / cellWidth) = floor(65 / 10) = 6 -> six '▉' cells (indices 0-5)
    // remainder = (65 - 6*10) / 10 = 0.5
    // nearest of the 7-glyph eighths ramp ▏▎▍▌▋▊▉ to 0.5: round(0.5*8) = 4 -> ramp[3] = '▌'
    // padding: cells - full - 1 = 3 cells of '░' at indices 7,8,9
    // tick index = floor(target / max * cells) clamped to cells-1 = floor(90/100*10) = 9
    // -> index 9 (last padding cell) becomes '│'
    // final cells: ▉▉▉▉▉▉ ▌ ░ ░ │
    expect(renderBullet(65, 90, 100)).toBe('▉▉▉▉▉▉▌░░│');
  });

  test('is always exactly `cells` characters', () => {
    expect([...renderBullet(65, 90, 100)]).toHaveLength(10);
    expect([...renderBullet(3, 8, 10, 5)]).toHaveLength(5);
  });

  test('a value equal to max renders all full cells before the tick overlay', () => {
    // full = floor(100/10) = 10 = cells -> all '▉', no boundary cell
    // tick index = floor(50/100*10) = 5 -> the sixth cell becomes '│'
    expect(renderBullet(100, 50, 100)).toBe('▉▉▉▉▉│▉▉▉▉');
  });

  test('a value of 0 renders the lightest boundary glyph, not empty padding', () => {
    // full = floor(0/10) = 0; remainder = 0 -> round(0*8) = 0 clamped to 1 -> ramp[0] = '▏'
    // padding indices 1..9 = '░' (9 cells); tick at floor(0/100*10)=0 overwrites index 0 with '│'
    expect(renderBullet(0, 0, 100)).toBe('│░░░░░░░░░');
  });

  test('honors a non-default cell count', () => {
    // cells=5, cellWidth=2, value=3 -> full=floor(3/2)=1, remainder=(3-2)/2=0.5 -> round(0.5*8)=4 -> '▌'
    // padding = 5-1-1=3 cells; tick = floor(8/10*5)=floor(4)=4 -> overwrites last padding cell
    expect(renderBullet(3, 8, 10, 5)).toBe('▉▌░░│');
  });

  test('rejects a value outside [0, max]', () => {
    expect(() => renderBullet(-1, 5, 10)).toThrow(RangeError);
    expect(() => renderBullet(11, 5, 10)).toThrow(RangeError);
  });

  test('rejects a target outside [0, max]', () => {
    expect(() => renderBullet(5, -1, 10)).toThrow(RangeError);
    expect(() => renderBullet(5, 11, 10)).toThrow(RangeError);
  });

  test('rejects a non-positive max', () => {
    expect(() => renderBullet(5, 5, 0)).toThrow(RangeError);
    expect(() => renderBullet(5, 5, -10)).toThrow(RangeError);
  });

  test('rejects a non-positive cell count', () => {
    expect(() => renderBullet(5, 5, 10, 0)).toThrow(RangeError);
  });

});

describe('renderDiverging', () => {

  test('the brief\'s pinned example: value=50, maxAbs=100, cellsPerSide=6', () => {
    // fraction = |50| / 100 = 0.5
    // rawFull = fraction * cellsPerSide = 0.5 * 6 = 3
    // full = floor(3) = 3 -> three '█' cells, adjacent to the center on the growing (right) side
    // remainder = rawFull - full = 0 -> boundaryGlyph(0) = '░'
    // padding = cellsPerSide - full - 1 = 6 - 3 - 1 = 2 cells of '░'
    // right side (growing, positive value) = '███' + '░' + '░░' = '███░░░'
    // left side (non-growing) = '░'.repeat(6) = '░░░░░░'
    // total length = 2*6 + 1 = 13
    expect(renderDiverging(50, 100, 6)).toBe('░░░░░░┃███░░░');
  });

  test('a negative value grows the left side, mirrored toward the center', () => {
    // same magnitude as the positive example, opposite side
    // left side (growing) = padding + boundary + full, full cells adjacent to the center
    // = '░░' + '░' + '███' = '░░░███'
    expect(renderDiverging(-50, 100, 6)).toBe('░░░███┃░░░░░░');
  });

  test('a value of 0 renders all padding on both sides', () => {
    expect(renderDiverging(0, 100, 6)).toBe('░░░░░░┃░░░░░░');
  });

  test('a value at maxAbs fills the entire growing side with no boundary cell', () => {
    expect(renderDiverging(100, 100, 6)).toBe('░░░░░░┃██████');
    expect(renderDiverging(-100, 100, 6)).toBe('██████┃░░░░░░');
  });

  test('total length is always 2*cellsPerSide + 1', () => {
    for (const cellsPerSide of [1, 3, 6, 8]) {
      expect([...renderDiverging(0, 100, cellsPerSide)]).toHaveLength(2 * cellsPerSide + 1);
    }
  });

  test('rejects a value outside [-maxAbs, maxAbs]', () => {
    expect(() => renderDiverging(150, 100)).toThrow(RangeError);
    expect(() => renderDiverging(-150, 100)).toThrow(RangeError);
  });

  test('rejects a non-positive maxAbs', () => {
    expect(() => renderDiverging(0, 0)).toThrow(RangeError);
    expect(() => renderDiverging(0, -5)).toThrow(RangeError);
  });

  test('rejects a non-positive or non-integer cellsPerSide', () => {
    expect(() => renderDiverging(0, 100, 0)).toThrow(RangeError);
    expect(() => renderDiverging(0, 100, 2.5)).toThrow(RangeError);
  });

});

describe('renderStacked', () => {

  test('the brief\'s pinned example: 1/1/2 over width 16', () => {
    expect(renderStacked(1, 1, 2, 16)).toBe('████▓▓▓▓▒▒▒▒▒▒▒▒');
  });

  test('is always exactly `width` characters, summed across the three segments', () => {
    const rendered = renderStacked(1, 1, 2, 16);
    expect([...rendered]).toHaveLength(16);
  });

  test('segment order is always success, then active+pending, then failure', () => {
    const rendered = renderStacked(1, 1, 2, 16);
    expect(rendered).toMatch(/^█*▓*▒*$/);
  });

  test('every nonzero bucket gets at least one cell even when its share rounds to 0', () => {
    // total=100, width=4: activePending's ideal share is 1/100*4=0.04, which floors to 0,
    // but it must still render at least one cell.
    const rendered = renderStacked(98, 1, 1, 4);
    expect((rendered.match(/█/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((rendered.match(/▓/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((rendered.match(/▒/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect([...rendered]).toHaveLength(4);
  });

  test('a single nonzero bucket fills the entire width', () => {
    expect(renderStacked(1, 0, 0, 3)).toBe('███');
    expect(renderStacked(0, 5, 0, 4)).toBe('▓▓▓▓');
    expect(renderStacked(0, 0, 2, 5)).toBe('▒▒▒▒▒');
  });

  test('rejects all-zero counts', () => {
    expect(() => renderStacked(0, 0, 0, 16)).toThrow(RangeError);
  });

  test('rejects a negative count', () => {
    expect(() => renderStacked(-1, 1, 1, 16)).toThrow(RangeError);
  });

  test('rejects a width smaller than the number of nonzero buckets', () => {
    expect(() => renderStacked(1, 1, 1, 2)).toThrow(RangeError);
  });

  test('rejects a non-positive or non-integer width', () => {
    expect(() => renderStacked(1, 1, 1, 0)).toThrow(RangeError);
    expect(() => renderStacked(1, 1, 1, 2.5)).toThrow(RangeError);
  });

});

describe('renderRange', () => {

  test('the vendored fill example (byte-normative)', () => {
    expect(renderRange(6, 0, 10, 'fill')).toBe('▕▓▓▓▓▓▓░░░░▏');
  });

  test('the vendored marker example (byte-normative)', () => {
    expect(renderRange(3, 0, 10, 'marker')).toBe('▕░░░●░░░░░░▏');
  });

  test('fill and marker forms are always exactly 12 characters (▕ + 10 inner + ▏)', () => {
    expect([...renderRange(6, 0, 10, 'fill')]).toHaveLength(12);
    expect([...renderRange(3, 0, 10, 'marker')]).toHaveLength(12);
  });

  test('the marker never appears at both ends unless the value hugs an edge', () => {
    expect(renderRange(0, 0, 10, 'marker')).toBe('▕●░░░░░░░░░▏');
    expect(renderRange(10, 0, 10, 'marker')).toBe('▕░░░░░░░░░●▏');
  });

  test('fill at the minimum is entirely empty; fill at the maximum is entirely full', () => {
    expect(renderRange(0, 0, 10, 'fill')).toBe('▕░░░░░░░░░░▏');
    expect(renderRange(10, 0, 10, 'fill')).toBe('▕▓▓▓▓▓▓▓▓▓▓▏');
  });

  test('rejects a value outside [min, max]', () => {
    expect(() => renderRange(-1, 0, 10, 'fill')).toThrow(RangeError);
    expect(() => renderRange(11, 0, 10, 'fill')).toThrow(RangeError);
  });

  test('rejects min >= max', () => {
    expect(() => renderRange(5, 10, 10, 'fill')).toThrow(RangeError);
    expect(() => renderRange(5, 10, 0, 'fill')).toThrow(RangeError);
  });

  test('rejects a style outside the closed vocabulary', () => {
    // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
    expect(() => renderRange(5, 0, 10, 'glow')).toThrow(RangeError);
  });

});

describe('renderBoxWhisker', () => {

  const stats: BoxWhiskerStats = { min: 0, q1: 25, median: 50, q3: 75, max: 100 };

  test('positions scaled to the default width of 16', () => {
    // span = 100; position(v) = round(v/100 * (16-1)) = round(v/100*15)
    // posMin = round(0)        = 0  -> '├'
    // posQ1  = round(3.75)     = 4  -> '┨'
    // posMed = round(7.5)      = 8  -> '┃'
    // posQ3  = round(11.25)    = 11 -> '┠'
    // posMax = round(15)       = 15 -> '┤'
    // indices 1-3 (between min and q1): whisker fill '─' (3 cells)
    // indices 5-7 (between q1 and median): box fill '▓' (3 cells)
    // indices 9-10 (between median and q3): box fill '▓' (2 cells)
    // indices 12-14 (between q3 and max): whisker fill '─' (3 cells)
    expect(renderBoxWhisker(stats)).toBe('├───┨▓▓▓┃▓▓┠───┤');
  });

  test('is always exactly `width` characters', () => {
    expect([...renderBoxWhisker(stats, 16)]).toHaveLength(16);
    expect([...renderBoxWhisker(stats, 20)]).toHaveLength(20);
  });

  test('throws RangeError when min > q1', () => {
    expect(() => renderBoxWhisker({ min: 10, q1: 5, median: 15, q3: 20, max: 30 })).toThrow(RangeError);
  });

  test('throws RangeError when q1 > median', () => {
    expect(() => renderBoxWhisker({ min: 0, q1: 20, median: 10, q3: 25, max: 30 })).toThrow(RangeError);
  });

  test('throws RangeError when median > q3', () => {
    expect(() => renderBoxWhisker({ min: 0, q1: 5, median: 25, q3: 10, max: 30 })).toThrow(RangeError);
  });

  test('throws RangeError when q3 > max', () => {
    expect(() => renderBoxWhisker({ min: 0, q1: 5, median: 10, q3: 25, max: 20 })).toThrow(RangeError);
  });

  test('accepts equal adjacent stats (non-strict ordering) and renders the coincident cells deterministically', () => {
    // span = 10; position(v) = round(v/10 * 15)
    // posMin=posQ1=round(0)=0 (coincide); posMedian=posQ3=round(7.5)=8 (coincide); posMax=round(15)=15
    // indices 1-7: box fill '▓' (between q1 and median)
    // index 8: median '┃' wins over the coincident q3 wall '┠'
    // indices 9-14: whisker fill '─' (between q3 and max)
    // index 0: the left whisker end '├' wins over the coincident q1 wall '┨'
    expect(renderBoxWhisker({ min: 0, q1: 0, median: 5, q3: 5, max: 10 })).toBe('├▓▓▓▓▓▓▓┃──────┤');
  });

  test('the degenerate min === max case collapses every position to 0; the left whisker end wins the five-way tie', () => {
    // span = 0, so fraction(v) = 0 for every stat -> every position is 0.
    // Assignment order (walls, median, right end, left end last) means '├' wins over
    // '┠', '┃', and '┤' at index 0; everything past it is untouched whisker fill.
    expect(renderBoxWhisker({ min: 5, q1: 5, median: 5, q3: 5, max: 5 })).toBe('├───────────────');
  });

  test('throws RangeError when a stat is non-finite', () => {
    expect(() => renderBoxWhisker({ min: 0, q1: 5, median: NaN, q3: 10, max: 20 })).toThrow(RangeError);
    expect(() => renderBoxWhisker({ min: 0, q1: 5, median: 10, q3: Infinity, max: 20 })).toThrow(RangeError);
  });

  test('rejects a width smaller than 2 or non-integer', () => {
    expect(() => renderBoxWhisker(stats, 1)).toThrow(RangeError);
    expect(() => renderBoxWhisker(stats, 4.5)).toThrow(RangeError);
  });

});
