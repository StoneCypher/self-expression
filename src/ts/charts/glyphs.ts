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

import { isMember, describeVocabulary } from '../channels/vocabulary.js';

/**
 * The directions a trend tag can point.
 *
 * `up`/`down` read as a plain increase or decrease; `rising`/`falling` and `steady`
 * exist for series with no inherent "more is better" — a distinction the caller is
 * expected to make, since the glyph alone cannot.
 */
export const TREND_DIRECTIONS = ['up', 'down', 'rising', 'falling', 'steady'] as const;

/** One member of {@link TREND_DIRECTIONS}. */
export type TrendDirection = typeof TREND_DIRECTIONS[number];

/** The glyph each {@link TrendDirection} renders as, per `visuals.md`. */
const TREND_GLYPHS: Readonly<Record<TrendDirection, string>> = {
  up:      '\u{25B2}', // ▲
  down:    '\u{25BC}', // ▼
  rising:  '\u{2197}', // ↗
  falling: '\u{2198}', // ↘
  steady:  '\u{2192}', // →
};

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
export function renderTrendTag(text: string, direction: TrendDirection): string {
  if (!isMember(TREND_DIRECTIONS, direction)) {
    throw new RangeError(
      `direction must be one of ${describeVocabulary(TREND_DIRECTIONS)}; received ${JSON.stringify(direction)}`
    );
  }
  return `${text} ${TREND_GLYPHS[direction]}`;
}

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
export function renderStars(score: number, max = 5): string {

  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError(`max must be a positive integer (a count of star slots); received ${String(max)}`);
  }
  if (!Number.isFinite(score) || score < 0 || score > max) {
    throw new RangeError(`score must be between 0 and ${String(max)} inclusive; received ${String(score)}`);
  }

  const rounded = Math.round(score * 2) / 2,
        full    = Math.floor(rounded),
        half    = rounded - full === 0.5 ? 1 : 0,
        empty   = max - full - half;

  return '\u{2605}'.repeat(full) + (half ? '\u{BD}' : '') + '\u{2606}'.repeat(empty);

}

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
export function renderRetryHealth(available: number, spent: number): string {

  if (!Number.isInteger(available) || available < 0) {
    throw new RangeError(`available must be a non-negative integer; received ${String(available)}`);
  }
  if (!Number.isInteger(spent) || spent < 0) {
    throw new RangeError(`spent must be a non-negative integer; received ${String(spent)}`);
  }

  const heart     = '\u{2764}\u{FE0F}',   // ❤️
        greyHeart = '\u{1FA76}';          // 🩶

  return heart.repeat(available) + greyHeart.repeat(spent);

}

/**
 * The weather-glyph vocabulary for summarizing a test set's health, in the order
 * `visuals.md` lists them: the green-to-red gradient first, then the special states
 * that don't fit on that gradient.
 */
export const WEATHER_STATES = [
  'all-green', 'mostly-green', 'mixed', 'failing', 'broad-failure',
  'flaky', 'crashing', 'stalled', 'recovered',
] as const;

/** One member of {@link WEATHER_STATES}. */
export type WeatherState = typeof WEATHER_STATES[number];

/** The glyph each {@link WeatherState} renders as, per `visuals.md`. */
const WEATHER_GLYPHS: Readonly<Record<WeatherState, string>> = {
  'all-green':     '\u{2600}\u{FE0F}',   // ☀️
  'mostly-green':  '\u{1F324}\u{FE0F}',  // 🌤️
  'mixed':         '\u{26C5}',           // ⛅
  'failing':       '\u{1F327}\u{FE0F}',  // 🌧️
  'broad-failure': '\u{26C8}\u{FE0F}',   // ⛈️
  'flaky':         '\u{1F32B}\u{FE0F}',  // 🌫️
  'crashing':      '\u{1F329}\u{FE0F}',  // 🌩️
  'stalled':       '\u{2744}\u{FE0F}',   // ❄️
  'recovered':     '\u{1F308}',          // 🌈
};

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
export function renderWeather(state: WeatherState): string {
  if (!isMember(WEATHER_STATES, state)) {
    throw new RangeError(
      `state must be one of ${describeVocabulary(WEATHER_STATES)}; received ${JSON.stringify(state)}`
    );
  }
  return WEATHER_GLYPHS[state];
}
