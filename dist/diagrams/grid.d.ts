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
export declare function makeGrid(width: number, height: number): CharGrid;
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
export declare function setCell(grid: CharGrid, x: number, y: number, ch: string): void;
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
export declare function mergeLine(grid: CharGrid, x: number, y: number, mask: number): void;
/**
 * Merges a single directional stub arm into one cell — the attachment point where a
 * line meets a border it does not cross: `attach(grid, x, y, 'down')` on a box's
 * `─` bottom border yields `┬` without adding the `┼`-producing up arm a full
 * `drawVline` would.
 *
 * @example
 *   attach(grid, 6, 2, 'down');   // border '─' at (6,2) becomes '┬'
 *
 * @throws {Error} If (x, y) is outside the grid.
 */
export declare function attach(grid: CharGrid, x: number, y: number, direction: 'up' | 'down' | 'left' | 'right'): void;
/**
 * Draws a horizontal line from (x1, y) to (x2, y) inclusive, merging junctions with
 * anything already drawn. Endpoint order does not matter.
 *
 * @example
 *   drawHline(grid, 2, 8, 0);   // '───────' across row 0
 */
export declare function drawHline(grid: CharGrid, x1: number, x2: number, y: number): void;
/**
 * Draws a vertical line from (x, y1) to (x, y2) inclusive, merging junctions with
 * anything already drawn. Endpoint order does not matter.
 *
 * @example
 *   drawVline(grid, 4, 1, 5);   // '│' down column 4
 */
export declare function drawVline(grid: CharGrid, x: number, y1: number, y2: number): void;
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
export declare function drawBox(grid: CharGrid, x: number, y: number, width: number, height: number): void;
/**
 * Writes `text` left to right starting at (x, y), one character per cell,
 * overwriting whatever is there (an edge label deliberately interrupts its line).
 *
 * @example
 *   drawText(grid, 2, 1, 'locked');
 *
 * @throws {Error} If any character would land outside the grid.
 */
export declare function drawText(grid: CharGrid, x: number, y: number, text: string): void;
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
export declare function expandWaypoints(waypoints: readonly GridPoint[]): GridPoint[];
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
export declare function drawPath(grid: CharGrid, points: readonly GridPoint[]): void;
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
export declare function usedExtent(grid: CharGrid): {
    width: number;
    height: number;
};
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
export declare function renderLines(lines: readonly string[], options?: RenderGridOptions): string;
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
export declare function renderGrid(grid: CharGrid, options?: RenderGridOptions): string;
//# sourceMappingURL=grid.d.ts.map