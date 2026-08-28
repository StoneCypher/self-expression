/**
 * Renderers for labeled rows: a multi-row comparison chart and a tile-grid map, per
 * `visuals.md` § Multi-row comparison chart and § Tile-grid map (text choropleth).
 *
 * Both forms compare several values side by side rather than drawing one bar in
 * isolation, so both need a scale that is shared across every row or cell rather than
 * each one normalizing to itself. `renderComparison` shares one `max` across all its
 * rows — the highest of every row's own `max` (or its own `value`, where `max` is
 * absent). `renderTileGrid`'s `'abbr-shade'` fill reads each cell's value on the fixed
 * absolute 0–100 scale (`absoluteIndex`, the same scale the trend sparkline uses for
 * percent series — comparable across separate grids the way a percent is), while its
 * `'pixel'` and `'color-keyed'` fills bucket cells into genuine value quintiles among
 * whatever data the grid actually holds (`relativeIndex`, steps = 5) — a statistical
 * partition, not a fixed scale, which "quintile" itself implies. Pure: no I/O, no
 * store access, no clock, no randomness.
 *
 * @see ../../doc_md/reference/visuals.md#multi-row-comparison-chart
 * @see ../../doc_md/reference/visuals.md#tile-grid-map-text-choropleth
 * @see ./scale.ts
 */
/** One labeled row of a {@link renderComparison} chart. */
export interface ComparisonRow {
    /** The row's short name, drawn left of its bar or dot track. */
    label: string;
    /** The row's value. Non-negative, and no greater than `max` when `max` is given. */
    value: number;
    /**
     * This row's own ceiling, when it differs from the chart's shared scale. Absent, it
     * defaults to the row's own `value` for the purpose of computing the shared max — see
     * {@link renderComparison}.
     */
    max?: number;
}
/**
 * Renders a multi-row comparison chart: one labeled bar (or dot) per row, all drawn
 * against a single shared scale so the rows stay visually comparable
 * (`visuals.md` § Multi-row comparison chart).
 *
 * Labels pad to the longest label plus two spaces. Each row's fill is
 * `round(value / sharedMax * width)` cells — full `█` cells for `'bar'`, a single `●`
 * on a `░` track at the same fill position for `'dot'` (the Cleveland dot-plot form) —
 * followed by two spaces and the value: `${value}%` when the shared max is exactly
 * 100, `${value}` otherwise. The shared max is {@link sharedMaxOf}: the highest of
 * every row's own `max` (or its own `value` where `max` is absent).
 *
 * @param rows  The rows to compare. At least one.
 * @param width The bar/track width in cells. Defaults to 20.
 * @param form  `'bar'` (default) or `'dot'`.
 *
 * @example
 *   renderComparison([
 *     { label: 'schema',  value: 80, max: 100 },
 *     { label: 'content', value: 55, max: 100 },
 *     { label: 'media',   value: 20, max: 100 },
 *   ])
 *   // => 'schema   ████████████████░░░░  80%\n' +
 *   //    'content  ███████████░░░░░░░░░  55%\n' +
 *   //    'media    ████░░░░░░░░░░░░░░░░  20%'
 *
 * @example
 *   renderComparison([{ label: 'x', value: 50, max: 100 }], 10, 'dot')
 *   // => 'x  ░░░░░●░░░░  50%'
 *
 * @throws {RangeError} If `rows` is empty, `width` is not a positive integer, `form` is
 *   not `'bar'` or `'dot'`, any row's `value` is negative or exceeds its own `max`, or
 *   the computed shared max is zero.
 * @see ../../doc_md/reference/visuals.md#multi-row-comparison-chart
 */
export declare function renderComparison(rows: readonly ComparisonRow[], width?: number, form?: 'bar' | 'dot'): string;
/** One cell of a {@link renderTileGrid}. Which fields are used depends on the chosen {@link TileFill}. */
export interface TileCell {
    /** The cell's short region label — used only by `'abbr-shade'`. */
    label?: string;
    /** The cell's value — used by `'abbr-shade'`, `'color-keyed'`, and `'pixel'`. */
    value?: number;
    /** The cell's literal glyph or short character sequence — used only by `'custom'`. */
    glyph?: string;
}
/** How {@link renderTileGrid} fills each cell. */
export type TileFill = 'abbr-shade' | 'custom' | 'color-keyed' | 'pixel';
/**
 * Renders a tile-grid map: one equal-size cell per region, in a fixed-column grid,
 * filled per `fill` (`visuals.md` § Tile-grid map).
 *
 * `rows` is a grid of cells, outer array top to bottom, inner array left to right; a
 * `null` cell is a gap — outside the mapped territory. Cells within a row join with a
 * single space, rows join with `\n`.
 *
 * - `'abbr-shade'` — each cell's `label` plus a `SHADES` glyph for its `value`, read as
 *   an absolute 0–100 percent (the same fixed scale the trend sparkline uses), e.g.
 *   `CA█`. Appends a blank line and the `low ░ ▒ ▓ █ high` legend.
 * - `'custom'` — each cell's `glyph`, verbatim.
 * - `'color-keyed'` — one of five colored squares by `value`'s quintile among every
 *   value present in the grid; no labels.
 * - `'pixel'` — the same colored squares, but a `null` cell renders `⬛` instead of a
 *   gap, so the grid stays a complete raster; no labels.
 *
 * @param rows The grid, at least one row. `null` marks a gap cell.
 * @param fill Which of the four fill strategies above to use.
 *
 * @example
 *   renderTileGrid([[
 *     { label: 'A', value: 20 }, { label: 'B', value: 40 }, { label: 'C', value: 60 },
 *   ]], 'abbr-shade')
 *   // => 'A░ B▒ C▓\n\nlow ░ ▒ ▓ █ high'
 *
 * @example
 *   renderTileGrid([[{ value: 0 }, null, { value: 100 }]], 'pixel')
 *   // => '🟥 ⬛ 🟦'
 *
 * @throws {RangeError} If `rows` is empty, `fill` is outside {@link TileFill}, or a
 *   non-null cell is missing a field its fill strategy needs.
 * @see ../../doc_md/reference/visuals.md#tile-grid-map-text-choropleth
 */
export declare function renderTileGrid(rows: readonly (TileCell | null)[][], fill: TileFill): string;
//# sourceMappingURL=rows.d.ts.map