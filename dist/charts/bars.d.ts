/**
 * Renderers for a single value (or one small stat set): one bar out, no series involved.
 *
 * Every form here composes the shared arithmetic in `scale.ts` — the anti-aliasing
 * boundary rule and the `█▓▒░` shade ramp — with a glyph set of its own: the bullet
 * graph's finer eighths ramp for its fill, the diverging bar's and box-whisker's heavy
 * vertical `┃`, the range slider's eighth-block borders, the box-whisker's box-drawing
 * walls. Pure: no I/O, no clock, no randomness. Every renderer throws `RangeError` on a
 * violated precondition, naming the domain that would have been accepted.
 *
 * @see ../../doc_md/reference/visuals.md
 * @see ./scale.ts
 */
/**
 * Renders a single percent-complete value as a fixed-width, anti-aliased progress bar —
 * no brackets, no label, just the ten cells `barCells` computes.
 *
 * Exists as its own export (rather than callers reaching for `barCells` directly)
 * because the `render_bar` MCP tool's `progress` form and every other single-value bar
 * in this module need a name that says what it draws rather than how.
 *
 * @param percent completion percentage; must be within `[0, 100]`
 *
 * @example
 *   renderProgressBar(32)   // => '███▒░░░░░░'
 *   renderProgressBar(100)  // => '██████████'
 *
 * @throws {RangeError} when `percent` is `NaN`, negative, or greater than 100.
 * @see ./scale.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
export declare function renderProgressBar(percent: number): string;
/**
 * Renders a bullet graph: a progress bar for `value` against `max`, carrying a `│`
 * tick at the `target` cell — the vendored vocabulary's stand-in for a plain progress
 * bar whenever the item or run has a meaningful goal value (`visuals.md` § Inline
 * micro-visualizations, "Bullet graph").
 *
 * The fill uses the finer seven-step eighths ramp (`▏▎▍▌▋▊▉`) rather than `boundaryGlyph`'s
 * four shades, so the boundary cell shows finer gradation than the plain progress bar.
 * The tick always overwrites whatever cell it lands on — fill, boundary, or padding —
 * because the target is the more load-bearing fact once it and the fill coincide.
 *
 * @param value  the current value; must be within `[0, max]`
 * @param target the goal value the tick marks; must be within `[0, max]`
 * @param max    the value the bar represents as fully filled; must be greater than 0
 * @param cells  total bar width in characters
 *
 * @example
 *   // full = floor(65/10) = 6; remainder = 0.5 -> nearest ramp step '▌'; tick at
 *   // floor(90/100*10) = 9, the last cell
 *   renderBullet(65, 90, 100)  // => '▉▉▉▉▉▉▌░░│'
 *
 * @throws {RangeError} when `max` is not a positive finite number, `cells` is not a
 *   positive integer, or `value`/`target` fall outside `[0, max]`.
 * @see ./scale.ts
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderBullet(value: number, target: number, max: number, cells?: number): string;
/**
 * Renders a diverging bar: a quantity growing either left (negative) or right
 * (positive) from a centered `┃`, for a value measured against a baseline
 * (ahead/behind schedule, over/under budget — `visuals.md` § Inline micro-visualizations,
 * "Diverging bar").
 *
 * Only the side matching `value`'s sign ever fills; the other side is entirely `░`
 * padding. On the growing side, full cells sit adjacent to the center, then one
 * `boundaryGlyph`-anti-aliased cell, then padding out to the outer edge — mirrored on
 * the left so both directions read as "fill grows toward the edge, away from center".
 *
 * @param value        the signed quantity; must be within `[-maxAbs, maxAbs]`
 * @param maxAbs       the magnitude at which a side is entirely full; must be greater
 *   than 0
 * @param cellsPerSide cells on each side of the center; the rendered width is always
 *   `2 * cellsPerSide + 1`
 *
 * @example
 *   // fraction = 50/100 = 0.5; rawFull = 0.5*6 = 3 -> 3 full cells, remainder 0 ->
 *   // boundaryGlyph(0) = '░'
 *   renderDiverging(50, 100, 6)   // => '░░░░░░┃███░░░'
 *   renderDiverging(-50, 100, 6)  // => '░░░███┃░░░░░░'
 *
 * @throws {RangeError} when `maxAbs` is not a positive finite number, `cellsPerSide` is
 *   not a positive integer, or `value` falls outside `[-maxAbs, maxAbs]`.
 * @see ./scale.ts
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderDiverging(value: number, maxAbs: number, cellsPerSide?: number): string;
/**
 * Renders a stacked (segmented) bar: proportional `█`/`▓`/`▒` runs for the
 * success / active+pending / failure count buckets, in that fixed order
 * (`visuals.md` § Inline micro-visualizations, "Stacked / segmented bar").
 *
 * Cells are allocated by largest-remainder apportionment (floor each bucket's ideal
 * share, then hand out the leftover cells to the buckets with the largest fractional
 * remainder), which is what guarantees the segments always sum to exactly `width`. A
 * second pass then guarantees every nonzero bucket keeps at least one cell: a bucket
 * whose ideal share rounds all the way down to 0 steals one cell from whichever bucket
 * currently holds the most, so a tiny nonzero count never vanishes from the bar.
 *
 * @param success       count of completed items; must be a non-negative finite number
 * @param activePending count of running, pending, or otherwise unresolved items; must
 *   be a non-negative finite number
 * @param failure       count of failed items; must be a non-negative finite number
 * @param width         total bar width in characters; must be at least the number of
 *   nonzero buckets, so every nonzero bucket can keep its guaranteed cell
 *
 * @example
 *   renderStacked(1, 1, 2, 16)  // => '████▓▓▓▓▒▒▒▒▒▒▒▒'
 *
 * @throws {RangeError} when any count is negative or non-finite, all three counts are
 *   0, or `width` is smaller than the number of nonzero buckets.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderStacked(success: number, activePending: number, failure: number, width?: number): string;
declare const RANGE_STYLES: readonly ["fill", "marker"];
/** How `renderRange` draws a value's position in its band. */
export type RangeStyle = typeof RANGE_STYLES[number];
/**
 * Renders a range slider: `value`'s position between `min` and `max`, hugged by
 * eighth-block borders (`visuals.md` § Inline micro-visualizations, "Range slider").
 * `style: 'fill'` shades cells up to the value; `style: 'marker'` places a single `●`
 * at the value's position. The inner width is always 10 cells, so the rendered string
 * is always 12 characters (border, 10 inner cells, border).
 *
 * @param value the position to render; must be within `[min, max]`
 * @param min   the band's lower bound
 * @param max   the band's upper bound; must be greater than `min`
 * @param style `'fill'` or `'marker'`
 *
 * @example
 *   renderRange(6, 0, 10, 'fill')    // => '▕▓▓▓▓▓▓░░░░▏'
 *   renderRange(3, 0, 10, 'marker')  // => '▕░░░●░░░░░░▏'
 *
 * @throws {RangeError} when `min` is not less than `max`, `value` falls outside
 *   `[min, max]`, or `style` is outside `{@link RangeStyle}`.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderRange(value: number, min: number, max: number, style: RangeStyle): string;
/** The five summary statistics `renderBoxWhisker` draws as a one-line distribution. */
export interface BoxWhiskerStats {
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
}
/**
 * Renders a box-and-whisker plot: a five-number-summary distribution on one line
 * (`visuals.md` § Inline micro-visualizations, "Box-and-whisker"). `min`/`max` become
 * the whisker ends (`├`/`┤`), `q1`/`q3` the interquartile box walls (`┨`/`┠`) with `▓`
 * fill between them, and `median` the `┃` tick — all five positions scaled linearly onto
 * `width` cells, with `min` always at the left edge and `max` always at the right.
 *
 * When two or more stats land on the same cell, the more specific glyph wins: the
 * median tick beats the box walls, and the whisker ends beat everything else. Between
 * the two ends themselves, the left end `├` wins — deliberately, not as an accident of
 * assignment order — so the fully degenerate case (`min === max`, which forces every
 * stat to the same value and every position to `0`, since `fraction` is defined as `0`
 * when the span is `0`) renders as a single `├` at the left edge followed by plain
 * whisker fill, matching "collapses to the left edge" rather than showing `┤` there.
 *
 * @param stats the five-number summary; must satisfy
 *   `min <= q1 <= median <= q3 <= max`
 * @param width total width in characters; must be an integer of at least 2, so `min`
 *   and `max` can occupy distinct cells
 *
 * @example
 *   // span = 100; position(v) = round(v/100 * 15)
 *   // posMin=0 posQ1=4 posMedian=8 posQ3=11 posMax=15
 *   renderBoxWhisker({ min: 0, q1: 25, median: 50, q3: 75, max: 100 })
 *   // => '├───┨▓▓▓┃▓▓┠───┤'
 *
 *   // degenerate case: min === max forces span = 0, so every position is 0 — the
 *   // left whisker end '├' wins the five-way tie, and everything past it is plain
 *   // whisker fill
 *   renderBoxWhisker({ min: 5, q1: 5, median: 5, q3: 5, max: 5 })
 *   // => '├───────────────'
 *
 * @throws {RangeError} when a stat is non-finite, the stats are not non-decreasing, or
 *   `width` is not an integer of at least 2.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderBoxWhisker(stats: BoxWhiskerStats, width?: number): string;
export {};
//# sourceMappingURL=bars.d.ts.map