/**
 * Micro-glyphs: one datum in, a few characters out.
 *
 * These are the inline forms from `visuals.md` § Inline micro-visualizations — small
 * enough to sit inside an item's own text rather than beneath it. Each renderer is a
 * pure function: no I/O, no clock, no randomness, byte-identical output for the same
 * input every time. The closed vocabularies (`TREND_DIRECTIONS`, `WEATHER_STATES`) are
 * runtime arrays rather than bare type unions for the same reason `channels/vocabulary.ts`
 * promotes its vocabularies to arrays — a caller assembling a tool payload from a string
 * needs something to validate against, and a type alone vanishes at runtime.
 *
 * @see ../../doc_md/reference/visuals.md
 */
/**
 * The directions a trend tag can point.
 *
 * `up`/`down` read as a plain increase or decrease; `rising`/`falling` and `steady`
 * exist for series with no inherent "more is better" — a distinction the caller is
 * expected to make, since the glyph alone cannot.
 */
export declare const TREND_DIRECTIONS: readonly ["up", "down", "rising", "falling", "steady"];
/** One member of {@link TREND_DIRECTIONS}. */
export type TrendDirection = typeof TREND_DIRECTIONS[number];
/**
 * Renders a value plus a direction glyph — the lighter cousin of the trend sparkline,
 * for a current-vs-previous delta with no full series to plot.
 *
 * @param text      The label or value to prefix, verbatim — e.g. a percent or a
 *                   measurement with its unit. Not validated; any string is accepted.
 * @param direction One of {@link TREND_DIRECTIONS}.
 *
 * @example
 *   renderTrendTag('32%', 'up')            // => '32% ▲'
 *   renderTrendTag('latency 84ms', 'falling') // => 'latency 84ms ↘'
 *
 * @throws {RangeError} If `direction` is outside {@link TREND_DIRECTIONS}.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderTrendTag(text: string, direction: TrendDirection): string;
/**
 * Renders a discrete score as a fixed-width star rating: filled `★` for the score,
 * empty `☆` for the remainder, with a `½` only on a genuine half-step.
 *
 * `score` is rounded to the nearest half before rendering, so a caller passing an
 * arbitrary fraction (e.g. a percentage divided by 20) still gets a legible rating
 * rather than a value the vocabulary cannot express.
 *
 * @param score The score being rated, in `[0, max]`. May be fractional; rounds to the
 *              nearest half-star.
 * @param max   The number of star slots — the output is always exactly this many
 *              characters (a `½` counts as one). Must be a positive integer.
 *
 * @example
 *   renderStars(4, 5)    // => '★★★★☆'
 *   renderStars(3.5, 5)  // => '★★★½☆'
 *   renderStars(4)       // => '★★★★☆' (max defaults to 5)
 *
 * @throws {RangeError} If `max` is not a positive integer, or `score` is outside
 *                       `[0, max]`.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderStars(score: number, max?: number): string;
/**
 * Renders a bounded-retry health bar: one heart per retry still available, one grey
 * heart per retry already spent.
 *
 * @param available Retries remaining. A non-negative integer.
 * @param spent     Retries already used. A non-negative integer.
 *
 * @example
 *   renderRetryHealth(3, 2)  // => '❤️❤️❤️🩶🩶'
 *
 * @throws {RangeError} If either argument is not a non-negative integer.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderRetryHealth(available: number, spent: number): string;
/**
 * The weather-glyph vocabulary for summarizing a test set's health, in the order
 * `visuals.md` lists them: the green-to-red gradient first, then the special states
 * that don't fit on that gradient.
 */
export declare const WEATHER_STATES: readonly ["all-green", "mostly-green", "mixed", "failing", "broad-failure", "flaky", "crashing", "stalled", "recovered"];
/** One member of {@link WEATHER_STATES}. */
export type WeatherState = typeof WEATHER_STATES[number];
/**
 * Renders the single glyph summarizing a test set's health, meant for the end of an
 * item's or group's text.
 *
 * @param state One of {@link WEATHER_STATES}.
 *
 * @example
 *   renderWeather('mixed')     // => '⛅'
 *   renderWeather('recovered') // => '🌈'
 *
 * @throws {RangeError} If `state` is outside {@link WEATHER_STATES}.
 * @see ../../doc_md/reference/visuals.md
 */
export declare function renderWeather(state: WeatherState): string;
//# sourceMappingURL=glyphs.d.ts.map