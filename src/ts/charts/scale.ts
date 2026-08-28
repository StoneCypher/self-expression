/**
 * Shared arithmetic behind every ASCII chart renderer: the three glyph ramps, the two
 * ways a value becomes a glyph index (fixed 0–100 scale vs. series-relative), the
 * anti-aliasing rule for a partially-filled cell, and the one 10-cell progress bar every
 * other bar form composes from.
 *
 * Exists as its own module, ahead of every renderer, because this arithmetic is the
 * part that must be pinned exactly — the 12.5-percent-per-glyph threshold, the
 * 0.17/0.5/0.83 anti-aliasing boundaries — and reused identically everywhere a bar or a
 * sparkline appears, rather than each renderer re-deriving (and inevitably drifting
 * from) the same numbers. Pure: no I/O, no store access, no clock, no randomness.
 *
 * @see ../../doc_md/reference/visuals.md
 * @see ../../doc_md/reference/status-checklists-skill.md
 */

/**
 * The eight-step block-glyph ramp sparklines climb, lightest to darkest.
 *
 * One glyph renders one data point at whatever step `absoluteIndex` or `relativeIndex`
 * computes for it. Exported as a plain array, not individual named glyphs, because every
 * caller indexes it by computed step, never by name.
 *
 * @example
 *   EIGHTHS[0]  // => '▁'
 *   EIGHTHS[7]  // => '█'
 *
 * @see ../../doc_md/reference/visuals.md
 */
export const EIGHTHS: readonly string[] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

// Kept as a local `as const` tuple so the indexing below stays a definite `string`
// (not `string | undefined`) under `noUncheckedIndexedAccess`. `SHADES` itself keeps the
// broader `readonly string[]` type other modules import.
const SHADE_GLYPHS = ['░', '▒', '▓', '█'] as const;

/**
 * The four shade glyphs, lightest to darkest — the anti-aliasing ramp `boundaryGlyph`
 * and `barCells` render from.
 *
 * @example
 *   SHADES[0]  // => '░'
 *   SHADES[3]  // => '█'
 *
 * @see ../../doc_md/reference/visuals.md
 */
export const SHADES: readonly string[] = SHADE_GLYPHS;

/**
 * The six-step braille-density ramp, a denser sparkline (2×4 dots per character) for
 * series where the plain block ramp's resolution is not enough.
 *
 * @example
 *   BRAILLE[0]  // => '⣀'
 *   BRAILLE[5]  // => '⣿'
 *
 * @see ../../doc_md/reference/visuals.md
 */
export const BRAILLE: readonly string[] = ['⣀', '⣄', '⣦', '⣶', '⣾', '⣿'];

/**
 * Maps a 0–100 percent onto one of `steps` glyph indices, on a fixed absolute scale.
 *
 * Exists so completion-percent series are comparable across checklists: a project
 * idling at 95% and one idling at 5% must render visibly differently, which only holds
 * if every series maps onto the same 0–100 domain rather than each normalizing to its
 * own min/max (that is `relativeIndex`, for series without a natural bound). The result
 * is clamped into `[0, steps - 1]` rather than thrown on out-of-range input, so a
 * percent of exactly 100 lands on the last glyph instead of overflowing past it.
 *
 * @example
 *   absoluteIndex(12.5, 8)  // => 1
 *   absoluteIndex(100, 8)   // => 7 — clamped, not 8
 *   absoluteIndex(0, 8)     // => 0
 *
 * @see ../../doc_md/reference/visuals.md
 */
export function absoluteIndex(percent: number, steps: number): number {
  const rawIndex = Math.floor(percent / (100 / steps));
  return Math.min(steps - 1, Math.max(0, rawIndex));
}

/**
 * Maps `value` onto one of `steps` glyph indices, scaled to where it falls between
 * `min` and `max` — the lowest value in the series always renders the first glyph, the
 * highest always the last.
 *
 * Exists for series with no natural 0–100 bound (latency, counts): normalizing to the
 * series' own range is the only way such a series reads as anything but a flat line. A
 * flat series (`min === max`) would otherwise divide by zero and render every point as
 * `NaN`; instead it renders every point as the first glyph, which is the visually
 * correct answer — a flat series has no variation to show.
 *
 * @example
 *   relativeIndex(10, 10, 50, 8)  // => 0 — lowest value, first glyph
 *   relativeIndex(50, 10, 50, 8)  // => 7 — highest value, last glyph
 *   relativeIndex(3, 3, 3, 8)     // => 0 — flat series, not NaN
 *
 * @see ../../doc_md/reference/visuals.md
 */
export function relativeIndex(value: number, min: number, max: number, steps: number): number {
  if (min === max) { return 0; }
  const fraction = (value - min) / (max - min);
  const rawIndex = Math.floor(fraction * steps);
  return Math.min(steps - 1, Math.max(0, rawIndex));
}

/**
 * The anti-aliasing rule shared by every bar-shaped renderer: maps a cell's fractional
 * fill (`0`–`1`) onto the nearest quarter-step shade glyph, rather than rendering a
 * hard-edged bar that jumps a whole cell at a time.
 *
 * Exists as its own export, not inlined into `barCells`, because the diverging bar and
 * range-slider renderers need the identical boundary rule applied to their own single
 * cell.
 *
 * @example
 *   boundaryGlyph(0.16)  // => '░' — below the first threshold
 *   boundaryGlyph(0.17)  // => '▒'
 *   boundaryGlyph(0.5)   // => '▓'
 *   boundaryGlyph(0.83)  // => '█'
 *
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
export function boundaryGlyph(fraction: number): string {
  if (fraction < 0.17) { return SHADE_GLYPHS[0]; }
  if (fraction < 0.5)  { return SHADE_GLYPHS[1]; }
  if (fraction < 0.83) { return SHADE_GLYPHS[2]; }
  return SHADE_GLYPHS[3];
}

/**
 * Renders a percent as a fixed-width, anti-aliased progress bar: full `█` cells, one
 * `boundaryGlyph`-shaded cell for the fractional remainder, `░` padding — always exactly
 * `cells` characters regardless of `percent`.
 *
 * The shared arithmetic behind `renderProgressBar` and the checklist summary line's
 * bar; both need identical rendering so a hand-drawn checklist example and a
 * tool-rendered one are byte-identical. `percent` outside `[0, 100]`, including `NaN`,
 * throws rather than silently clamping or drawing a nonsensical bar — the domain here is
 * a genuine completion percentage, not a value with a sensible out-of-range meaning.
 *
 * @example
 *   barCells(32)   // => '███▒░░░░░░'
 *   barCells(67)   // => '██████▓░░░'
 *   barCells(100)  // => '██████████'
 *   barCells(0)    // => '░░░░░░░░░░'
 *
 * @throws {RangeError} when `percent` is `NaN`, negative, or greater than 100.
 *
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export function barCells(percent: number, cells: number = 10): string {
  if (Number.isNaN(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`barCells: percent must be a number within [0, 100]; got ${String(percent)}`);
  }

  const cellWidth = 100 / cells;
  const full = Math.floor(percent / cellWidth);
  if (full >= cells) { return SHADE_GLYPHS[3].repeat(cells); }

  const remainder = (percent - full * cellWidth) / cellWidth;
  const padding = SHADE_GLYPHS[0].repeat(cells - full - 1);
  return SHADE_GLYPHS[3].repeat(full) + boundaryGlyph(remainder) + padding;
}
