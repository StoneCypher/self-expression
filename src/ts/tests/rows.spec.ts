import { renderComparison, renderTileGrid } from '../charts/rows.js';
import type { ComparisonRow, TileCell } from '../charts/rows.js';

describe('renderComparison', () => {

  test('the visuals.md example — three rows, shared max 100, bar form', () => {
    const rows: readonly ComparisonRow[] = [
      { label: 'schema', value: 80, max: 100 },
      { label: 'content', value: 55, max: 100 },
      { label: 'media', value: 20, max: 100 },
    ];
    expect(renderComparison(rows)).toBe(
      'schema   ████████████████░░░░  80%\n' +
      'content  ███████████░░░░░░░░░  55%\n' +
      'media    ████░░░░░░░░░░░░░░░░  20%'
    );
  });

  test('width defaults to 20 and form defaults to bar (explicit args match the defaults)', () => {
    const rows: readonly ComparisonRow[] = [
      { label: 'schema', value: 80, max: 100 },
      { label: 'content', value: 55, max: 100 },
      { label: 'media', value: 20, max: 100 },
    ];
    expect(renderComparison(rows)).toBe(renderComparison(rows, 20, 'bar'));
  });

  test('a custom width rescales the fill (round(value/max*width))', () => {
    const rows: readonly ComparisonRow[] = [{ label: 'x', value: 50, max: 100 }];
    // round(50/100*10) = 5
    expect(renderComparison(rows, 10)).toBe('x  █████░░░░░  50%');
  });

  test('dot form places a single ● at the fill position on a ░ track', () => {
    const rows: readonly ComparisonRow[] = [{ label: 'x', value: 50, max: 100 }];
    // fillCells = round(50/100*10) = 5, dot at index min(5, 10-1) = 5
    expect(renderComparison(rows, 10, 'dot')).toBe('x  ░░░░░●░░░░  50%');
  });

  test('dot form at value 0 places the dot at the leftmost cell', () => {
    const rows: readonly ComparisonRow[] = [{ label: 'x', value: 0, max: 100 }];
    expect(renderComparison(rows, 10, 'dot')).toBe('x  ●░░░░░░░░░  0%');
  });

  test('dot form at the max value places the dot at the rightmost cell (clamped)', () => {
    const rows: readonly ComparisonRow[] = [{ label: 'x', value: 100, max: 100 }];
    expect(renderComparison(rows, 10, 'dot')).toBe('x  ░░░░░░░░░●  100%');
  });

  test('raw value (no % suffix) when the shared max is not 100', () => {
    const rows: readonly ComparisonRow[] = [{ label: 'x', value: 40, max: 80 }];
    // round(40/80*20) = 10
    expect(renderComparison(rows)).toBe('x  ██████████░░░░░░░░░░  40');
  });

  test('the shared max defaults to the highest row maximum (own max, else own value)', () => {
    // one row states its own max (50); the other has none, so its own value (30) stands in.
    // sharedMax = max(50, 30) = 50, so the second row's bar is not full.
    const rows: readonly ComparisonRow[] = [
      { label: 'a', value: 25, max: 50 },
      { label: 'b', value: 30 },
    ];
    const rendered = renderComparison(rows, 10);
    // a: round(25/50*10) = 5; b: round(30/50*10) = 6
    expect(rendered).toBe('a  █████░░░░░  25\nb  ██████░░░░  30');
  });

  test('labels pad to the longest label plus two spaces', () => {
    const rows: readonly ComparisonRow[] = [
      { label: 'ab', value: 0, max: 10 },
      { label: 'abcdef', value: 0, max: 10 },
    ];
    const rendered = renderComparison(rows, 5);
    const lines = rendered.split('\n');
    expect(lines[0]?.slice(0, 8)).toBe('ab      ');
    expect(lines[1]?.slice(0, 8)).toBe('abcdef  ');
  });

  test('rejects an empty row list, naming the accepted domain', () => {
    expect(() => renderComparison([])).toThrow(RangeError);
    try {
      renderComparison([]);
    } catch (err) {
      expect((err as Error).message).toContain('at least one row');
    }
  });

  test('rejects a non-positive width', () => {
    expect(() => renderComparison([{ label: 'x', value: 1 }], 0)).toThrow(RangeError);
    expect(() => renderComparison([{ label: 'x', value: 1 }], -5)).toThrow(RangeError);
  });

  test('rejects a non-integer width', () => {
    expect(() => renderComparison([{ label: 'x', value: 1 }], 2.5)).toThrow(RangeError);
  });

  test('rejects a form outside bar/dot, naming the accepted domain', () => {
    // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
    expect(() => renderComparison([{ label: 'x', value: 1 }], 20, 'line')).toThrow(RangeError);
    try {
      // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
      renderComparison([{ label: 'x', value: 1 }], 20, 'line');
    } catch (err) {
      expect((err as Error).message).toContain("'bar'");
      expect((err as Error).message).toContain("'dot'");
    }
  });

  test('rejects a negative value', () => {
    expect(() => renderComparison([{ label: 'x', value: -1 }])).toThrow(RangeError);
  });

  test('rejects a value that exceeds its own max', () => {
    expect(() => renderComparison([{ label: 'x', value: 150, max: 100 }])).toThrow(RangeError);
  });

  test('rejects an all-zero comparison (shared max would be zero)', () => {
    expect(() => renderComparison([{ label: 'x', value: 0 }, { label: 'y', value: 0 }])).toThrow(RangeError);
  });

});

describe('renderTileGrid', () => {

  test('abbr-shade: label + absolute-scale SHADES glyph, cells space-joined, rows newline-joined', () => {
    const grid: readonly (TileCell | null)[][] = [
      [{ label: 'A', value: 20 }, { label: 'B', value: 40 }, { label: 'C', value: 60 }],
    ];
    // absoluteIndex(20, 4) = floor(20/25) = 0 -> '░'
    // absoluteIndex(40, 4) = floor(40/25) = 1 -> '▒'
    // absoluteIndex(60, 4) = floor(60/25) = 2 -> '▓'
    expect(renderTileGrid(grid, 'abbr-shade')).toBe('A░ B▒ C▓\n\nlow ░ ▒ ▓ █ high');
  });

  test('abbr-shade: a null cell renders as a gap, not a placeholder glyph', () => {
    const grid: readonly (TileCell | null)[][] = [
      [{ label: 'A', value: 20 }, null, { label: 'C', value: 60 }],
    ];
    expect(renderTileGrid(grid, 'abbr-shade')).toBe('A░  C▓\n\nlow ░ ▒ ▓ █ high');
  });

  test('abbr-shade: multiple rows join by newline before the blank line and legend', () => {
    const grid: readonly (TileCell | null)[][] = [
      [{ label: 'A', value: 0 }],
      [{ label: 'B', value: 100 }],
    ];
    // absoluteIndex(0,4)=0 -> '░'; absoluteIndex(100,4)=4 clamped to 3 -> '█'
    expect(renderTileGrid(grid, 'abbr-shade')).toBe('A░\nB█\n\nlow ░ ▒ ▓ █ high');
  });

  test('abbr-shade: a cell missing its label throws, naming the missing field', () => {
    const grid: readonly (TileCell | null)[][] = [[{ value: 10 }]];
    expect(() => renderTileGrid(grid, 'abbr-shade')).toThrow(RangeError);
    try {
      renderTileGrid(grid, 'abbr-shade');
    } catch (err) {
      expect((err as Error).message).toContain('label');
      expect((err as Error).message).toContain('abbr-shade');
    }
  });

  test('abbr-shade: a cell missing its value throws, naming the missing field', () => {
    const grid: readonly (TileCell | null)[][] = [[{ label: 'A' }]];
    expect(() => renderTileGrid(grid, 'abbr-shade')).toThrow(RangeError);
    try {
      renderTileGrid(grid, 'abbr-shade');
    } catch (err) {
      expect((err as Error).message).toContain('value');
    }
  });

  test('custom: each cell renders its glyph verbatim, no shading or labels', () => {
    const grid: readonly (TileCell | null)[][] = [[{ glyph: '##' }, null, { glyph: '@@' }]];
    expect(renderTileGrid(grid, 'custom')).toBe('##  @@');
  });

  test('custom: a cell missing its glyph throws', () => {
    const grid: readonly (TileCell | null)[][] = [[{ label: 'A' }]];
    expect(() => renderTileGrid(grid, 'custom')).toThrow(RangeError);
    try {
      renderTileGrid(grid, 'custom');
    } catch (err) {
      expect((err as Error).message).toContain('glyph');
    }
  });

  test('color-keyed: colored square by value quintile among the grid\'s present values, labels ignored', () => {
    const grid: readonly (TileCell | null)[][] = [[
      { label: 'w', value: 0 }, { label: 'x', value: 25 }, { label: 'y', value: 50 },
      { label: 'z', value: 75 }, { label: 'v', value: 100 },
    ]];
    // relativeIndex over min=0,max=100,steps=5: 0->0, 25->1, 50->2, 75->3, 100->4(clamped)
    expect(renderTileGrid(grid, 'color-keyed')).toBe('🟥 🟧 🟨 🟩 🟦');
  });

  test('color-keyed: a null cell is a plain gap (unlike pixel)', () => {
    const grid: readonly (TileCell | null)[][] = [[{ value: 0 }, null, { value: 100 }]];
    expect(renderTileGrid(grid, 'color-keyed')).toBe('🟥  🟦');
  });

  test('color-keyed: a cell missing its value throws', () => {
    const grid: readonly (TileCell | null)[][] = [[{ label: 'A' }]];
    expect(() => renderTileGrid(grid, 'color-keyed')).toThrow(RangeError);
  });

  test('pixel: same quintile squares as color-keyed, but a null cell renders the black square', () => {
    const grid: readonly (TileCell | null)[][] = [[{ value: 0 }, null, { value: 100 }]];
    expect(renderTileGrid(grid, 'pixel')).toBe('🟥 ⬛ 🟦');
  });

  test('pixel: a cell missing its value throws', () => {
    const grid: readonly (TileCell | null)[][] = [[{}]];
    expect(() => renderTileGrid(grid, 'pixel')).toThrow(RangeError);
  });

  test('a flat value distribution renders every cell at the first (lowest) quintile', () => {
    const grid: readonly (TileCell | null)[][] = [[{ value: 5 }, { value: 5 }, { value: 5 }]];
    expect(renderTileGrid(grid, 'pixel')).toBe('🟥 🟥 🟥');
  });

  test('a ragged grid (rows of different lengths) renders without error, each row its own width', () => {
    const grid: readonly (TileCell | null)[][] = [
      [{ glyph: 'a' }, { glyph: 'b' }, { glyph: 'c' }],
      [{ glyph: 'd' }],
      [],
    ];
    expect(renderTileGrid(grid, 'custom')).toBe('a b c\nd\n');
  });

  test('rejects an empty grid, naming the accepted domain', () => {
    expect(() => renderTileGrid([], 'abbr-shade')).toThrow(RangeError);
    try {
      renderTileGrid([], 'abbr-shade');
    } catch (err) {
      expect((err as Error).message).toContain('at least one row');
    }
  });

  test('rejects a fill outside the closed vocabulary, naming the accepted domain', () => {
    const grid: readonly (TileCell | null)[][] = [[{ glyph: '#' }]];
    // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
    expect(() => renderTileGrid(grid, 'rainbow')).toThrow(RangeError);
    try {
      // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
      renderTileGrid(grid, 'rainbow');
    } catch (err) {
      expect((err as Error).message).toContain("'abbr-shade'");
      expect((err as Error).message).toContain("'pixel'");
    }
  });

  test('an all-null grid renders all gaps for abbr-shade, no error', () => {
    const grid: readonly (TileCell | null)[][] = [[null, null]];
    expect(renderTileGrid(grid, 'abbr-shade')).toBe(' \n\nlow ░ ▒ ▓ █ high');
  });

  test('an all-null grid renders all black squares for pixel, no error', () => {
    const grid: readonly (TileCell | null)[][] = [[null, null]];
    expect(renderTileGrid(grid, 'pixel')).toBe('⬛ ⬛');
  });

});
