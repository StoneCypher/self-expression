import {
  makeGrid, setCell, mergeLine, drawHline, drawVline, drawBox, drawText, drawPath, attach,
  expandWaypoints, usedExtent, renderGrid, renderLines,
} from '../diagrams/grid.js';
import type { CharGrid } from '../diagrams/grid.js';

/** Joins the raw buffer for direct cell assertions, independent of renderGrid. */
function raw(grid: CharGrid): string[] {
  return grid.cells.map(row => row.join(''));
}

describe('makeGrid', () => {

  test('allocates an all-space buffer of the requested size', () => {
    const g = makeGrid(4, 2);
    expect(raw(g)).toEqual(['    ', '    ']);
  });

  test('rejects non-positive and non-integer dimensions', () => {
    expect(() => makeGrid(0, 3)).toThrow(RangeError);
    expect(() => makeGrid(3, 0)).toThrow(RangeError);
    expect(() => makeGrid(2.5, 3)).toThrow(RangeError);
  });

});

describe('junction resolution', () => {

  test('a horizontal drawn across a vertical yields the crossing', () => {
    const g = makeGrid(5, 3);
    drawVline(g, 2, 0, 2);
    drawHline(g, 0, 4, 1);
    expect(raw(g)[1]).toBe('──┼──');
  });

  test('a full vertical across a box bottom border is a crossing; attach makes the tee', () => {
    const g = makeGrid(7, 5);
    drawBox(g, 0, 0, 7, 3);
    drawVline(g, 3, 2, 4);   // carries both up and down arms through the border
    expect(raw(g)[2]).toBe('└──┼──┘');
  });

  test('a drawPath turn produces the correct corner, not a crossing', () => {
    const g = makeGrid(5, 4);
    drawPath(g, expandWaypoints([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }]));
    // The turn cell has a left arm (toward the previous cell) and a down arm: ┐
    expect(raw(g)[1]).toBe(' ──┐ ');
    expect(raw(g)[2]).toBe('   │ ');
    expect(raw(g)[3]).toBe('   ▼ ');
  });

  test('all four arms accumulated in any order produce ┼', () => {
    const g1 = makeGrid(3, 3);
    drawHline(g1, 0, 2, 1);
    drawVline(g1, 1, 0, 2);
    const g2 = makeGrid(3, 3);
    drawVline(g2, 1, 0, 2);
    drawHline(g2, 0, 2, 1);
    expect(raw(g1)).toEqual(raw(g2));
    expect(raw(g1)[1]).toBe('─┼─');
  });

  test('mergeLine over a non-line character replaces it', () => {
    const g = makeGrid(3, 1);
    setCell(g, 1, 0, 'x');
    mergeLine(g, 1, 0, 0b1010);   // left|right
    expect(raw(g)[0]).toBe(' ─ ');
  });

});

describe('attach', () => {

  test('a single down stub on a border reads as ┬, not ┼', () => {
    const g = makeGrid(5, 3);
    drawBox(g, 0, 0, 5, 3);
    attach(g, 2, 2, 'down');
    expect(raw(g)[2]).toBe('└─┬─┘');
  });

});

describe('drawBox and drawText', () => {

  test('draws the documented 8×3 box', () => {
    const g = makeGrid(10, 3);
    drawBox(g, 0, 0, 8, 3);
    expect(raw(g)).toEqual(['┌──────┐  ', '│      │  ', '└──────┘  ']);
  });

  test('rejects degenerate boxes', () => {
    const g = makeGrid(5, 5);
    expect(() => { drawBox(g, 0, 0, 1, 3); }).toThrow(RangeError);
    expect(() => { drawBox(g, 0, 0, 3, 1); }).toThrow(RangeError);
  });

  test('drawText writes one character per cell and overwrites', () => {
    const g = makeGrid(6, 1);
    drawHline(g, 0, 5, 0);
    drawText(g, 1, 0, 'ab');
    expect(raw(g)[0]).toBe('─ab───');
  });

  test('writes off the edge are an Error, never silent corruption', () => {
    const g = makeGrid(3, 1);
    expect(() => { drawText(g, 2, 0, 'xy'); }).toThrow(Error);
    expect(() => { setCell(g, 3, 0, 'x'); }).toThrow(Error);
    expect(() => { setCell(g, 0, 1, 'x'); }).toThrow(Error);
  });

});

describe('expandWaypoints and drawPath', () => {

  test('expands corners into unit steps', () => {
    expect(expandWaypoints([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }])).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
    ]);
  });

  test('drops zero-length steps', () => {
    expect(expandWaypoints([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }])).toEqual([
      { x: 1, y: 1 }, { x: 1, y: 2 },
    ]);
  });

  test('rejects diagonal waypoints', () => {
    expect(() => expandWaypoints([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toThrow(Error);
  });

  test('a straight down path merges its start into a border and ends in ▼', () => {
    const g = makeGrid(7, 6);
    drawBox(g, 0, 0, 7, 3);
    drawPath(g, expandWaypoints([{ x: 3, y: 2 }, { x: 3, y: 4 }]));
    expect(raw(g)[2]).toBe('└──┬──┘');
    expect(raw(g)[3]).toBe('   │   ');
    expect(raw(g)[4]).toBe('   ▼   ');
  });

  test('each approach direction draws its own arrowhead', () => {
    const g = makeGrid(5, 5);
    drawPath(g, expandWaypoints([{ x: 2, y: 2 }, { x: 4, y: 2 }]));
    drawPath(g, expandWaypoints([{ x: 2, y: 2 }, { x: 0, y: 2 }]));
    drawPath(g, expandWaypoints([{ x: 2, y: 2 }, { x: 2, y: 0 }]));
    drawPath(g, expandWaypoints([{ x: 2, y: 2 }, { x: 2, y: 4 }]));
    expect(raw(g)[2]).toBe('◀─┼─▶');
    expect(raw(g)[0]).toBe('  ▲  ');
    expect(raw(g)[4]).toBe('  ▼  ');
  });

  test('a path of fewer than two points is an Error', () => {
    const g = makeGrid(3, 3);
    expect(() => { drawPath(g, [{ x: 1, y: 1 }]); }).toThrow(Error);
  });

});

describe('usedExtent', () => {

  test('reports the smallest extent containing every non-space cell', () => {
    const g = makeGrid(10, 6);
    setCell(g, 4, 2, 'x');
    expect(usedExtent(g)).toEqual({ width: 5, height: 3 });
  });

  test('an entirely blank grid is a RangeError', () => {
    expect(() => usedExtent(makeGrid(3, 3))).toThrow(RangeError);
  });

});

describe('renderLines', () => {

  test('frames to the widest line, padding shorter ones inside the frame', () => {
    expect(renderLines(['a', 'bb'])).toBe('┌────┐\n│ a  │\n│ bb │\n└────┘');
  });

  test('framed output is a perfect rectangle with no trailing whitespace', () => {
    const out = renderLines(['x', 'yy', 'z']);
    const lines = out.split('\n');
    const widths = new Set(lines.map(l => [...l].length));
    expect(widths.size).toBe(1);
    for (const line of lines) { expect(line).not.toMatch(/ $/); }
  });

  test('unframed output strips trailing whitespace from every line', () => {
    expect(renderLines(['a  ', 'bb '], { frame: false })).toBe('a\nbb');
  });

  test('zero lines is a RangeError', () => {
    expect(() => renderLines([])).toThrow(RangeError);
  });

});

describe('renderGrid', () => {

  test('crops to content before framing', () => {
    const g = makeGrid(20, 8);
    drawBox(g, 0, 1, 5, 3);   // a blank leading row, trailing blank rows and columns
    expect(renderGrid(g, { frame: false })).toBe('┌───┐\n│   │\n└───┘');
  });

  test('frames by default', () => {
    const g = makeGrid(10, 3);
    drawBox(g, 0, 0, 5, 3);
    expect(renderGrid(g)).toBe('┌───────┐\n│ ┌───┐ │\n│ │   │ │\n│ └───┘ │\n└───────┘');
  });

});
