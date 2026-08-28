/**
 * The character grid every diagram is drawn on: a mutable width×height cell buffer
 * with line, box, text, and path drawing, box-drawing junction resolution, and the
 * final framed-or-padded string render.
 *
 * Junction resolution is the one piece of cleverness the whole drawing layer shares:
 * each light box-drawing character is a bitmask of up/right/down/left arms, and
 * drawing a line across an existing line ORs the masks — `─` over `│` yields `┼`,
 * `│` descending into a box's `─` bottom border yields `┬` — so crossings and
 * junctions come out right regardless of drawing order (mask OR is commutative,
 * associative, and idempotent, which the stochastic suite pins).
 *
 * Pure and deterministic; the buffer is mutable but nothing here touches I/O, the
 * clock, or randomness.
 *
 * @see ./layout.js
 * @see ./renderers.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */

/** A mutable drawing surface: `cells[y][x]` is the single-width character at (x, y). */
export interface CharGrid {
  /** Total columns; x runs [0, width). */
  readonly width: number;
  /** Total rows; y runs [0, height). */
  readonly height: number;
  /** The cell buffer, row-major, every cell exactly one single-width character. */
  readonly cells: string[][];
}

/** One cell coordinate on a {@link CharGrid}; x grows rightward, y grows downward. */
export interface GridPoint {
  /** Column, in cells. */
  x: number;
  /** Row, in cells. */
  y: number;
}

/** Bitmask arm values: a box-drawing character is the OR of the arms it extends. */
const ARM_UP = 1, ARM_RIGHT = 2, ARM_DOWN = 4, ARM_LEFT = 8;

/** Each light box-drawing character's arm mask, the basis of junction resolution. */
const CHAR_TO_MASK: Readonly<Record<string, number>> = {
  '─': ARM_LEFT | ARM_RIGHT,
  '│': ARM_UP | ARM_DOWN,
  '┌': ARM_RIGHT | ARM_DOWN,
  '┐': ARM_LEFT | ARM_DOWN,
  '└': ARM_UP | ARM_RIGHT,
  '┘': ARM_UP | ARM_LEFT,
  '├': ARM_UP | ARM_DOWN | ARM_RIGHT,
  '┤': ARM_UP | ARM_DOWN | ARM_LEFT,
  '┬': ARM_LEFT | ARM_RIGHT | ARM_DOWN,
  '┴': ARM_LEFT | ARM_RIGHT | ARM_UP,
  '┼': ARM_UP | ARM_RIGHT | ARM_DOWN | ARM_LEFT,
};

/**
 * The inverse of {@link CHAR_TO_MASK}, plus the four single-arm masks (a lone stub
 * arm draws as the straight line it will usually be merged into).
 */
const MASK_TO_CHAR: Readonly<Record<number, string>> = {
  [ARM_UP]: '│', [ARM_DOWN]: '│', [ARM_LEFT]: '─', [ARM_RIGHT]: '─',
  [ARM_LEFT | ARM_RIGHT]: '─',
  [ARM_UP | ARM_DOWN]: '│',
  [ARM_RIGHT | ARM_DOWN]: '┌',
  [ARM_LEFT | ARM_DOWN]: '┐',
  [ARM_UP | ARM_RIGHT]: '└',
  [ARM_UP | ARM_LEFT]: '┘',
  [ARM_UP | ARM_DOWN | ARM_RIGHT]: '├',
  [ARM_UP | ARM_DOWN | ARM_LEFT]: '┤',
  [ARM_LEFT | ARM_RIGHT | ARM_DOWN]: '┬',
  [ARM_LEFT | ARM_RIGHT | ARM_UP]: '┴',
  [ARM_UP | ARM_RIGHT | ARM_DOWN | ARM_LEFT]: '┼',
};

/**
 * Allocates an all-space grid.
 *
 * @param width  columns, a positive integer
 * @param height rows, a positive integer
 *
 * @example
 *   const grid = makeGrid(10, 3);   // 10 columns × 3 rows of ' '
 *
 * @throws {RangeError} If either dimension is not a positive integer.
 */
export function makeGrid(width: number, height: number): CharGrid {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError(
      `makeGrid needs positive integer dimensions; received ${String(width)}×${String(height)}`
    );
  }
  return {
    width, height,
    cells: Array.from({ length: height }, () => Array.from({ length: width }, () => ' ')),
  };
}

/** Reads one cell, throwing on out-of-bounds — an internal-consistency bug, not caller error. */
function cellAt(grid: CharGrid, x: number, y: number): string {
  const row = grid.cells[y];
  const ch = row?.[x];
  if (ch === undefined) {
    throw new Error(`grid read out of bounds at (${String(x)}, ${String(y)})`);
  }
  return ch;
}

/**
 * Writes one character to one cell, overwriting whatever is there. Line drawing
 * should go through {@link mergeLine} instead so junctions resolve; `setCell` is for
 * text and arrowheads, which deliberately replace.
 *
 * @example
 *   setCell(grid, 3, 1, '▼');
 *
 * @throws {Error} If (x, y) is outside the grid — an internal bug in the caller's
 *                 layout arithmetic, never a user-input condition.
 */
export function setCell(grid: CharGrid, x: number, y: number, ch: string): void {
  const row = grid.cells[y];
  if (row === undefined || x < 0 || x >= grid.width) {
    throw new Error(`grid write out of bounds at (${String(x)}, ${String(y)})`);
  }
  row[x] = ch;
}

/**
 * Merges a line-arm mask into one cell: if the cell already holds a box-drawing
 * character the masks OR together (junction resolution); anything else is replaced
 * by the mask's own character.
 *
 * @param mask an OR of the arm bits; must map to a drawable character
 *
 * @example
 *   // cell holds '│'; merging a horizontal produces the crossing:
 *   mergeLine(grid, 4, 2, 0b1010);   // cell becomes '┼'
 *
 * @throws {Error} If out of bounds, or the merged mask has no character (impossible
 *                 for masks built from real arms; guards table drift).
 */
export function mergeLine(grid: CharGrid, x: number, y: number, mask: number): void {
  const existing = CHAR_TO_MASK[cellAt(grid, x, y)];
  const merged = existing === undefined ? mask : existing | mask;
  const ch = MASK_TO_CHAR[merged];
  if (ch === undefined) {
    throw new Error(`no box-drawing character for arm mask ${String(merged)}`);
  }
  setCell(grid, x, y, ch);
}

/**
 * Merges a single directional stub arm into one cell — the attachment point where a
 * line meets a border it does not cross: `attach(grid, x, y, 'down')` on a box's
 * `─` bottom border yields `┬` without adding the `┼`-producing up arm a full
 * `vline` would.
 *
 * @example
 *   attach(grid, 6, 2, 'down');   // border '─' at (6,2) becomes '┬'
 *
 * @throws {Error} If (x, y) is outside the grid.
 */
export function attach(grid: CharGrid, x: number, y: number, direction: 'up' | 'down' | 'left' | 'right'): void {
  const mask = direction === 'up' ? ARM_UP
    : direction === 'down' ? ARM_DOWN
    : direction === 'left' ? ARM_LEFT
    : ARM_RIGHT;
  mergeLine(grid, x, y, mask);
}

/** Sorts a segment's endpoints so iteration always runs low to high. */
function span(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * Draws a horizontal line from (x1, y) to (x2, y) inclusive, merging junctions with
 * anything already drawn. Endpoint order does not matter.
 *
 * @example
 *   hline(grid, 2, 8, 0);   // '───────' across row 0
 */
export function hline(grid: CharGrid, x1: number, x2: number, y: number): void {
  const [lo, hi] = span(x1, x2);
  for (let x = lo; x <= hi; x++) { mergeLine(grid, x, y, ARM_LEFT | ARM_RIGHT); }
}

/**
 * Draws a vertical line from (x, y1) to (x, y2) inclusive, merging junctions with
 * anything already drawn. Endpoint order does not matter.
 *
 * @example
 *   vline(grid, 4, 1, 5);   // '│' down column 4
 */
export function vline(grid: CharGrid, x: number, y1: number, y2: number): void {
  const [lo, hi] = span(y1, y2);
  for (let y = lo; y <= hi; y++) { mergeLine(grid, x, y, ARM_UP | ARM_DOWN); }
}

/**
 * Draws a rectangular box border with corners at (x, y) and (x+width-1, y+height-1),
 * merging with anything already drawn (two boxes sharing an edge resolve their
 * shared border's junctions correctly).
 *
 * @param width  total box width in cells, at least 2
 * @param height total box height in cells, at least 2
 *
 * @example
 *   drawBox(grid, 0, 0, 8, 3);
 *   // ┌──────┐
 *   // │      │
 *   // └──────┘
 *
 * @throws {RangeError} If `width` or `height` is less than 2 — a box needs room for
 *                        all four corners.
 */
export function drawBox(grid: CharGrid, x: number, y: number, width: number, height: number): void {
  if (width < 2 || height < 2) {
    throw new RangeError(
      `drawBox needs width and height of at least 2; received ${String(width)}×${String(height)}`
    );
  }
  hline(grid, x + 1, x + width - 2, y);
  hline(grid, x + 1, x + width - 2, y + height - 1);
  vline(grid, x, y + 1, y + height - 2);
  vline(grid, x + width - 1, y + 1, y + height - 2);
  mergeLine(grid, x, y, ARM_RIGHT | ARM_DOWN);
  mergeLine(grid, x + width - 1, y, ARM_LEFT | ARM_DOWN);
  mergeLine(grid, x, y + height - 1, ARM_UP | ARM_RIGHT);
  mergeLine(grid, x + width - 1, y + height - 1, ARM_UP | ARM_LEFT);
}

/**
 * Writes `text` left to right starting at (x, y), one character per cell,
 * overwriting whatever is there (an edge label deliberately interrupts its line).
 *
 * @example
 *   drawText(grid, 2, 1, 'locked');
 *
 * @throws {Error} If any character would land outside the grid.
 */
export function drawText(grid: CharGrid, x: number, y: number, text: string): void {
  let cx = x;
  for (const ch of text) { setCell(grid, cx, y, ch); cx += 1; }
}

/** The arrowhead drawn for each final-step direction; Unicode triangles per the spec. */
const ARROWHEADS: Readonly<Record<string, string>> = {
  up: '▲', down: '▼', left: '◀', right: '▶',
};

/** The unit direction from `a` to `b`, which must be orthogonally adjacent-or-aligned. */
function directionOf(a: GridPoint, b: GridPoint): 'up' | 'down' | 'left' | 'right' {
  if (a.x === b.x) { return b.y > a.y ? 'down' : 'up'; }
  if (a.y === b.y) { return b.x > a.x ? 'right' : 'left'; }
  throw new Error('path points must be orthogonally aligned');
}

/** The arm bit pointing from `from` toward `to` (which must share a row or column). */
function armToward(from: GridPoint, to: GridPoint): number {
  switch (directionOf(from, to)) {
    case 'up':    return ARM_UP;
    case 'down':  return ARM_DOWN;
    case 'left':  return ARM_LEFT;
    case 'right': return ARM_RIGHT;
  }
}

/**
 * Expands orthogonal waypoints into the full unit-step cell sequence between them,
 * dropping zero-length steps. The result is what {@link drawPath} draws and what the
 * layout layer records for edge-traceability tests.
 *
 * @param waypoints the path's corners, in order; consecutive points must share a row
 *                   or a column
 *
 * @example
 *   expandWaypoints([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }])
 *   // => [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:2,y:1}]
 *
 * @throws {Error} If consecutive waypoints are diagonal to each other.
 */
export function expandWaypoints(waypoints: readonly GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (const wp of waypoints) {
    const last = out[out.length - 1];
    if (last === undefined) { out.push({ x: wp.x, y: wp.y }); continue; }
    if (last.x === wp.x && last.y === wp.y) { continue; }
    const dir = directionOf(last, wp);
    let { x, y } = last;
    while (x !== wp.x || y !== wp.y) {
      if (dir === 'up') { y -= 1; } else if (dir === 'down') { y += 1; }
      else if (dir === 'left') { x -= 1; } else { x += 1; }
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Draws one edge path: every cell but the last merges its in/out line arms (so
 * borders become junctions and crossings become `┼`), and the last cell gets the
 * arrowhead for its approach direction (`▶ ◀ ▲ ▼`).
 *
 * The first cell merges only its outgoing arm — placed on a box's border character
 * this is exactly what turns `─` into `┬`: the visible attachment point.
 *
 * @param points the full unit-step cell sequence, from source attachment to
 *                arrowhead cell; at least 2 points
 *
 * @example
 *   drawPath(grid, expandWaypoints([{ x: 3, y: 2 }, { x: 3, y: 4 }]));
 *   // column 3: row 2 merges '┬' into a box bottom, row 3 '│', row 4 '▼'
 *
 * @throws {Error} If fewer than 2 points, or points are not unit orthogonal steps.
 */
export function drawPath(grid: CharGrid, points: readonly GridPoint[]): void {
  if (points.length < 2) { throw new Error('drawPath needs at least 2 points'); }
  for (let i = 0; i < points.length; i++) {
    const here = points[i];
    if (here === undefined) { throw new Error('drawPath: sparse points array'); }
    if (i === points.length - 1) {
      const prev = points[i - 1];
      if (prev === undefined) { throw new Error('drawPath: sparse points array'); }
      const head = ARROWHEADS[directionOf(prev, here)];
      if (head === undefined) { throw new Error('drawPath: unmapped arrow direction'); }
      setCell(grid, here.x, here.y, head);
      continue;
    }
    let mask = 0;
    const prev = points[i - 1];
    const next = points[i + 1];
    if (prev !== undefined) { mask |= armToward(here, prev); }
    if (next !== undefined) { mask |= armToward(here, next); }
    mergeLine(grid, here.x, here.y, mask);
  }
}

/**
 * The grid's used extent: the smallest (width, height) containing every non-space
 * cell. Used to crop the canvas before framing, so a generously allocated grid
 * frames to its content.
 *
 * @example
 *   usedExtent(grid)   // => { width: 14, height: 5 }
 *
 * @throws {RangeError} If the grid is entirely blank — a diagram with no content is
 *                        a caller bug upstream of rendering.
 */
export function usedExtent(grid: CharGrid): { width: number; height: number } {
  let width = 0, height = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = grid.width - 1; x >= 0; x--) {
      if (cellAt(grid, x, y) !== ' ') {
        if (x + 1 > width) { width = x + 1; }
        height = y + 1;
        break;
      }
    }
  }
  if (width === 0) { throw new RangeError('cannot render an empty grid'); }
  return { width, height };
}

/** Options for {@link renderGrid} and {@link renderLines}. */
export interface RenderGridOptions {
  /** Frame the output in a visible box (default true); see the spec's ragged-edge finding. */
  frame?: boolean;
}

/**
 * Joins pre-built lines into the final diagram string: framed by default (the frame
 * guarantees a visible rectangle that editors cannot strip, costing two lines and
 * four columns), or unframed with trailing whitespace stripped from every line (the
 * interior stays aligned; only the invisible right pad is dropped, so a consumer
 * that re-pads loses nothing).
 *
 * @param lines the diagram's rows, top to bottom, without trailing newlines
 *
 * @example
 *   renderLines(['a', 'bb'])
 *   // => '┌────┐\n│ a  │\n│ bb │\n└────┘'
 *
 * @throws {RangeError} If `lines` is empty.
 * @see renderGrid
 */
export function renderLines(lines: readonly string[], options?: RenderGridOptions): string {
  if (lines.length === 0) { throw new RangeError('cannot render zero lines'); }
  const frame = options?.frame ?? true;
  const width = Math.max(...lines.map(l => l.length));
  if (!frame) {
    return lines.map(l => l.replace(/ +$/u, '')).join('\n');
  }
  const bar = '─'.repeat(width + 2);
  const body = lines.map(l => `│ ${l.padEnd(width)} │`);
  return [`┌${bar}┐`, ...body, `└${bar}┘`].join('\n');
}

/**
 * Renders the grid to its final string: cropped to its used extent, then framed (or
 * trailing-whitespace-stripped) per {@link renderLines}.
 *
 * @example
 *   const grid = makeGrid(20, 3);
 *   drawBox(grid, 0, 0, 5, 3);
 *   renderGrid(grid, { frame: false })
 *   // => '┌───┐\n│   │\n└───┘'
 *
 * @throws {RangeError} If the grid is entirely blank.
 * @see renderLines
 * @see usedExtent
 */
export function renderGrid(grid: CharGrid, options?: RenderGridOptions): string {
  const { width, height } = usedExtent(grid);
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) { line += cellAt(grid, x, y); }
    lines.push(line);
  }
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') { lines.shift(); }
  return renderLines(lines, options);
}
