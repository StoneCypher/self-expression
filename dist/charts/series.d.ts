/**
 * Renderers for a numeric or categorical sequence: one line out, one glyph per point.
 *
 * The trend sparkline and braille microplot (`visuals.md` § Trend sparkline, §
 * Inline micro-visualizations) share the same arithmetic contract — one ramp glyph per
 * data point, mapped by either the fixed 0–100 absolute scale or the series' own
 * relative range — so both are built on the same internal renderer, parameterized only
 * by which ramp (`EIGHTHS` vs. `BRAILLE`) they draw from. The win/loss strip is a
 * distinct shape: a closed categorical vocabulary rather than a numeric range, so it
 * gets its own vocabulary array and lookup table in the pattern of
 * `channels/vocabulary.ts`. Pure: no I/O, no clock, no randomness.
 *
 * @see ../../doc_md/reference/visuals.md
 * @see ./scale.ts
 */
/**
 * Which arithmetic a sparkline or braille microplot maps its points through.
 *
 * `'absolute'` is for percent series: every checklist's sparkline is comparable to
 * every other, because 0–100 always maps onto the same glyph range. `'relative'` is for
 * series with no natural bound (latency, counts): the series' own min and max become
 * the first and last glyph.
 */
export type SeriesScale = 'absolute' | 'relative';
/**
 * The glyph a non-finite point (`NaN`, `Infinity`, `-Infinity` — a gap or a bad
 * upstream computation) renders as, in both {@link renderSparkline} and
 * {@link renderBraille}: a middle dot, distinct from every ramp glyph in both the
 * block and braille families so a missing point is never mistaken for a real
 * (if extreme) value.
 *
 * @see renderSeries
 */
export declare const MISSING_GLYPH = "\u00B7";
/**
 * Renders a trend sparkline: one `EIGHTHS` glyph per point in `series`, oldest to
 * newest.
 *
 * @param series the data points, chronological order; needs at least 4 — a shorter
 *   series is a segment, not a trend, and reads as noise (`visuals.md` § Trend
 *   sparkline)
 * @param scale  `'absolute'` for percent series (0–100 maps directly onto the ramp);
 *   `'relative'` for series without a natural bound, normalized to the series' own
 *   min–max
 *
 * @example
 *   renderSparkline([0, 12.5, 25, 100], 'absolute')  // => '▁▂▃█'
 *   renderSparkline([5, 95, 5, 95], 'absolute')       // => '▁█▁█'
 *   renderSparkline([10, 20, 30, 40], 'relative')     // => '▁▃▆█'
 *
 * @throws {RangeError} when `series` has fewer than 4 points.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderSparkline(series: readonly number[], scale: SeriesScale): string;
/**
 * Renders a braille microplot: one `BRAILLE` glyph per point in `series`, oldest to
 * newest — a denser sparkline (2×4 dots per character) for series where the plain
 * block ramp's resolution is not enough.
 *
 * Same contract as {@link renderSparkline}, on the six-step braille ramp instead of the
 * eight-step block ramp.
 *
 * @param series the data points, chronological order; needs at least 4
 * @param scale  see {@link renderSparkline}
 *
 * @example
 *   renderBraille([0, 20, 50, 100], 'absolute')  // => '⣀⣄⣶⣿'
 *   renderBraille([10, 20, 30, 40], 'relative')  // => '⣀⣦⣾⣿'
 *
 * @throws {RangeError} when `series` has fewer than 4 points.
 * @see ../../doc_md/reference/visuals.md
 * @see renderSparkline
 */
export declare function renderBraille(series: readonly number[], scale: SeriesScale): string;
/**
 * The run-outcome vocabulary a win/loss strip renders, per `visuals.md` § Inline
 * micro-visualizations, "Win/loss strip".
 *
 * @example
 *   OUTCOMES[0]  // => 'pass'
 *   OUTCOMES[5]  // => 'skipped'
 */
export declare const OUTCOMES: readonly string[];
/** One member of {@link OUTCOMES}. */
export type Outcome = 'pass' | 'flaky' | 'fail' | 'underway' | 'queued' | 'skipped';
/**
 * Renders a win/loss strip: one glyph per run outcome, oldest to newest, no
 * separators.
 *
 * @param outcomes the run outcomes, chronological order
 *
 * @example
 *   renderWinLoss(['pass', 'pass', 'fail', 'flaky', 'pass', 'underway', 'queued', 'queued'])
 *   // => '✅✅❌🟨✅🟦⬛⬛'
 *
 * @throws {RangeError} when an outcome is outside {@link OUTCOMES}.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderWinLoss(outcomes: readonly Outcome[]): string;
//# sourceMappingURL=series.d.ts.map