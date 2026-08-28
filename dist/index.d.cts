/********
 *
 *  Returns the arithmetic double of the input number, or throws if not a number
 *
 *  @summary Double a number
 *  @category stub
 *
 *  @param {number} x - The input value to be doubled
 *
 *  @returns {number} The doubled value
 *
 *  @example
 *  This will work:
 *  ```ts
 *    console.log( double(3) );  // should print "6"
 *  ```
 *  This will throw:
 *  ```ts
 *    console.log( double('three') );  // should explode
 *  ```
 *
 *  @since Introduced in v0.3.0, Mar 22 2026
 *  @author John Haugeland
 *
 *  @throws TypeError if `typeof x !== 'number'`
 *
 *  @privateRemarks
 *  This function is here to show that building, bundling, and testing are working.  It also serves to remind us what
 *  typedoc arguments are being used.  Destroy this file and this function, de-export this function from index, and
 *  remove the `spec`, `stoch`, and `mutat` tests for double before proceeding.
 *
 */
declare function double(x: number): number;
declare function unhandled_external(): void;

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
declare const EIGHTHS: readonly string[];
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
declare const SHADES: readonly string[];
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
declare const BRAILLE: readonly string[];
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
declare function absoluteIndex(percent: number, steps: number): number;
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
declare function relativeIndex(value: number, min: number, max: number, steps: number): number;
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
declare function boundaryGlyph(fraction: number): string;
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
declare function barCells(percent: number, cells?: number): string;

/**
 * The checklist marker vocabulary, promoted from prose to code.
 *
 * `markers.md` (the complete emoji vocabulary and its canonical order) and the
 * "Bucket membership" list in `status-checklists-skill.md` § The summary line
 * exist today only as prose a person has to re-read correctly every time a
 * checklist gets summarized. That is exactly the failure mode
 * `channels/vocabulary.ts` already solved for the affect-signature
 * vocabularies: promote the list to a runtime array once, and every caller —
 * validation, sorting, bucket classification — reads the same array instead
 * of re-deriving the rule from memory.
 *
 * A note on the strings themselves: several markers are multi-code-point —
 * a base emoji followed by U+FE0F (VARIATION SELECTOR-16), which forces the
 * emoji presentation of an otherwise text-default glyph (`🛠️`, `🛳️`, `🎙️`,
 * `🕵️`, and others below). These arrays store each marker exactly as it
 * appears in `markers.md`, and every comparison in this module is plain
 * string equality — no normalization, no stripping of variation selectors.
 * Callers (including test authors) must pass the marker string exactly as
 * rendered; a visually identical but code-point-different string will not
 * match.
 *
 * @see ../../doc_md/reference/markers.md
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ../channels/vocabulary.ts
 */
/**
 * Which section of a checklist summary's count line a marker's item counts
 * toward.
 *
 * Not a strength or a status in itself — it is the coarse three-way split
 * the summary line's count section reports (`success / activePending /
 * failure`), independent of a marker's finer status/topic meaning.
 */
type Bucket = 'success' | 'active' | 'failure';
/**
 * Markers that count toward the summary line's `success` bucket.
 *
 * Per `status-checklists-skill.md` § The summary line, "Bucket membership":
 * done, a perfect pass, finishing a major goal, agreement, something
 * genuinely cool, and caution/worked-with-a-caveat (the caveat stays visible
 * in the icon list, but the work still landed).
 *
 * `🛳️` (deploying something) is deliberately **not** in this array — a
 * deploy's bucket depends on whether it completed, a fact the glyph alone
 * cannot carry. Classify it via {@link classifyMarker}'s `override`
 * parameter instead.
 *
 * @example
 *   SUCCESS_MARKERS.includes('✅')  // => true
 *   SUCCESS_MARKERS.includes('🛳️')  // => false — pass an override instead
 */
declare const SUCCESS_MARKERS: readonly ["✅", "💯", "🏁", "👍", "😎", "⚠️"];
/**
 * Markers that count toward the summary line's `failure` bucket.
 *
 * Per `status-checklists-skill.md` § The summary line, "Bucket membership":
 * failed, blocked, gone silent, dead/hung/degraded processes, a discovered
 * security problem, a serious problem or threat, active attack, and the
 * "something is wrong" family (stupid/frustrating, unknown cause, rejected
 * with no reason, suspect, overloaded, dormant, flaky, partial/degraded).
 *
 * @example
 *   FAILURE_MARKERS.includes('❌')  // => true
 *   FAILURE_MARKERS.includes('✅')  // => false
 */
declare const FAILURE_MARKERS: readonly ["❌", "🚫", "🦗", "💀", "🧟", "🦹", "🌋", "🤬", "🤡", "😕", "🤌", "🤥", "🥵", "😴", "🫨", "🌗"];
/**
 * Every marker from `markers.md`, in its canonical order: the status
 * markers in their listed order (with `💯`, the perfect-pass variant of
 * `✅`, spliced in immediately after `✅` even though it has no bullet of
 * its own in the source — the file states the rule in prose rather than a
 * list entry), followed by the topic/action markers group by group, top to
 * bottom, in each group's left-to-right listed order.
 *
 * `markers.md`'s status-marker list carries 25 entries (the 2026-08-27 field
 * trial added 🔬 "under review" and 🔁 "in a fix round", both classifying
 * active+pending). This array transcribes the actual list, per the rule
 * "every marker... in its listed order".
 *
 * This is the tiebreaker `status-checklists-skill.md` specifies for sorting
 * a summary line's per-marker icon list: equal-count markers sort by first
 * appearance here.
 *
 * @see canonicalRank
 * @example
 *   CANONICAL_ORDER.indexOf('✅')  // => 0
 *   CANONICAL_ORDER.indexOf('💯')  // => 1 — immediately after ✅
 */
declare const CANONICAL_ORDER: readonly ["✅", "💯", "🤖", "⏳", "🌐", "🔬", "🔁", "🛠️", "🛰️", "🔜", "🦥", "🌗", "🫨", "🦡", "❌", "🚫", "🦗", "⏭️", "⏸️", "❗", "⚠️", "⏰", "😴", "🧠", "❓", "🤔", "📋", "🐙", "📅", "📩", "👔", "📝", "📖", "📎", "📺", "🎙️", "🖨️", "🧪", "🦆", "🔍", "🔗", "🎫", "🏁", "🪚", "🐀", "⚡", "🐛", "🧹", "🗑️", "🦤", "🧐", "⚖️", "👑", "👍", "👎", "✋", "🛳️", "♾️", "↩️", "🏗️", "📦", "⚙️", "🔑", "🩹", "🩺", "☸️", "⬆️", "⬇️", "⏫", "⏬", "🔌", "💽", "🧬", "🌱", "💾", "🪵", "🧮", "📊", "🔮", "🔥", "🚨", "🧯", "🤕", "🗿", "🪦", "🕵️", "🦓", "🏷️", "🔀", "🚀", "🔨", "🆙", "🤮", "🎨", "♿", "📐", "🗺️", "🎣", "🪓", "🦹", "🪪", "🩻", "🔒", "🕳️", "🐒", "🧌", "🤬", "🛡️", "👁️", "💰", "🌪️", "🧊", "👻", "💀", "🧟", "🌋", "🤡", "😕", "🤌", "🤥", "🥵", "😎", "🦙", "💅", "🤓"];
/**
 * The bucket a marker's item counts toward in a checklist summary line.
 *
 * `override` exists for markers whose bucket cannot be read off the glyph
 * alone — chiefly `🛳️` (deploying something), whose bucket depends on
 * whether the deploy completed, failed, or is still underway. When supplied,
 * `override` wins outright rather than being blended with the marker's own
 * classification.
 *
 * Markers in neither {@link SUCCESS_MARKERS} nor {@link FAILURE_MARKERS} —
 * including every running/queued/topic marker and any marker this module
 * does not recognize — classify as `'active'`, matching the skill's
 * "active+pending: every other marker" rule.
 *
 * @param marker the marker string, exactly as it would be rendered in the
 *   checklist item (see the module note on variation selectors)
 * @param override the bucket to report unconditionally, when the caller
 *   already knows something the glyph can't express
 * @returns which bucket the marker's item counts toward
 * @example
 *   classifyMarker('✅')             // => 'success'
 *   classifyMarker('❌')             // => 'failure'
 *   classifyMarker('🔜')             // => 'active'
 *   classifyMarker('🛳️', 'success')  // => 'success' — deploy completed
 */
declare function classifyMarker(marker: string, override?: Bucket): Bucket;
/**
 * A marker's position in {@link CANONICAL_ORDER}, for sorting a summary
 * line's per-marker icon list (equal-count markers sort by this rank).
 *
 * An unrecognized marker ranks after every known marker rather than
 * throwing, so an icon list containing a marker this module doesn't (yet)
 * know about still sorts — last, deterministically — instead of crashing
 * the renderer.
 *
 * @param marker the marker string, exactly as it would be rendered
 * @returns the marker's zero-based index in `CANONICAL_ORDER`, or
 *   `CANONICAL_ORDER.length` when the marker is not recognized
 * @example
 *   canonicalRank('✅')   // => 0
 *   canonicalRank('💯')   // => 1 — immediately after ✅
 *   canonicalRank('🤷')   // => CANONICAL_ORDER.length — not in markers.md
 */
declare function canonicalRank(marker: string): number;

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
type SeriesScale = 'absolute' | 'relative';
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
declare function renderSparkline(series: readonly number[], scale: SeriesScale): string;
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
declare function renderBraille(series: readonly number[], scale: SeriesScale): string;
/**
 * The run-outcome vocabulary a win/loss strip renders, per `visuals.md` § Inline
 * micro-visualizations, "Win/loss strip".
 *
 * @example
 *   OUTCOMES[0]  // => 'pass'
 *   OUTCOMES[5]  // => 'skipped'
 */
declare const OUTCOMES: readonly string[];
/** One member of {@link OUTCOMES}. */
type Outcome = 'pass' | 'flaky' | 'fail' | 'underway' | 'queued' | 'skipped';
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
declare function renderWinLoss(outcomes: readonly Outcome[]): string;

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
declare function renderProgressBar(percent: number): string;
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
declare function renderBullet(value: number, target: number, max: number, cells?: number): string;
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
declare function renderDiverging(value: number, maxAbs: number, cellsPerSide?: number): string;
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
declare function renderStacked(success: number, activePending: number, failure: number, width?: number): string;
declare const RANGE_STYLES: readonly ["fill", "marker"];
/** How `renderRange` draws a value's position in its band. */
type RangeStyle = typeof RANGE_STYLES[number];
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
declare function renderRange(value: number, min: number, max: number, style: RangeStyle): string;
/** The five summary statistics `renderBoxWhisker` draws as a one-line distribution. */
interface BoxWhiskerStats {
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
declare function renderBoxWhisker(stats: BoxWhiskerStats, width?: number): string;

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
interface ComparisonRow {
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
declare function renderComparison(rows: readonly ComparisonRow[], width?: number, form?: 'bar' | 'dot'): string;
/** One cell of a {@link renderTileGrid}. Which fields are used depends on the chosen {@link TileFill}. */
interface TileCell {
    /** The cell's short region label — used only by `'abbr-shade'`. */
    label?: string;
    /** The cell's value — used by `'abbr-shade'`, `'color-keyed'`, and `'pixel'`. */
    value?: number;
    /** The cell's literal glyph or short character sequence — used only by `'custom'`. */
    glyph?: string;
}
/** How {@link renderTileGrid} fills each cell. */
type TileFill = 'abbr-shade' | 'custom' | 'color-keyed' | 'pixel';
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
declare function renderTileGrid(rows: readonly (TileCell | null)[][], fill: TileFill): string;

/**
 * Ordered-stage renderers: a milestone list, a step pipeline, or a transition graph in,
 * one drawn rail or line out.
 *
 * `visuals.md` § Process timeline gives the rail two forms rather than one because
 * color and centered alignment cannot coexist in a monospace grid: emoji are
 * double-width, so a colored rail cannot align its pips to a single-width label row.
 * The monochrome form gets the centered rail and drops color (and therefore `'failed'`,
 * which has no monochrome glyph); the colored form gets `'failed'` and drops the rail.
 * Both live here alongside the two other ordered-stage forms from § Inline
 * micro-visualizations: the dependency chain (an inline pipeline with one underlined
 * current step) and the one-line FSL state-machine description.
 *
 * Pure: no I/O, no store access, no clock, no randomness — the same input always
 * renders the same string.
 *
 * @see ../../doc_md/reference/visuals.md
 */
/** The state a single timeline milestone is in. */
type MilestoneState = 'reached' | 'current' | 'future' | 'failed';
/** One stage of a process timeline: its short label and the state it is currently in. */
interface Milestone {
    /** The stage's short name, e.g. `'spec'` or `'ship'` — drawn on the label row. */
    label: string;
    /** One of {@link MilestoneState}. */
    state: MilestoneState;
}
/**
 * Renders the two-line monochrome process-timeline rail: a `━` rail spanning the full
 * width of the label row, each milestone's marker centered over its label.
 *
 * The rail character at each milestone's column sits at
 * `labelStart + floor((labelLength - 1) / 2)`, where `labelStart` is that label's
 * starting column on the label row (labels joined by four spaces). The monochrome ramp
 * has no glyph for `'failed'` — color is what distinguishes a failed stage from a
 * reached one, and color needs double-width emoji, which this form deliberately avoids
 * so its rail can align to the single-width label row beneath it.
 *
 * @param milestones The stages, left to right. At least one.
 *
 * @example
 *   renderTimelineRail([
 *     { label: 'spec',  state: 'reached' },
 *     { label: 'build', state: 'reached' },
 *     { label: 'test',  state: 'current' },
 *     { label: 'ship',  state: 'future' },
 *   ])
 *   // => '━●━━━━━━━━●━━━━━━━◆━━━━━━━○━━\nspec    build    test    ship'
 *
 * @throws {RangeError} If `milestones` is empty, any milestone has an empty `label`,
 *                        or any milestone is in the `'failed'` state — use
 *                        {@link renderTimelineColored} instead.
 * @see ../../doc_md/reference/visuals.md#process-timeline
 */
declare function renderTimelineRail(milestones: readonly Milestone[]): string;
/**
 * Renders the one-line colored process-timeline form: each milestone's colored pip
 * immediately followed by its label, joined by ` ━━ `.
 *
 * Chosen over {@link renderTimelineRail} whenever color — and therefore `'failed'` — is
 * needed: color requires emoji, emoji are double-width, and double-width pips cannot
 * align to a single-width centered rail, so this form drops the rail and lives on one
 * line instead.
 *
 * @param milestones The stages, left to right. At least one.
 *
 * @example
 *   renderTimelineColored([
 *     { label: 'spec',  state: 'reached' },
 *     { label: 'build', state: 'failed' },
 *     { label: 'test',  state: 'current' },
 *     { label: 'ship',  state: 'future' },
 *   ])
 *   // => '🟢 spec ━━ 🔶 build ━━ 🟦 test ━━ ◎ ship'
 *
 * @throws {RangeError} If `milestones` is empty, or any milestone has an empty
 *                        `label`.
 * @see ../../doc_md/reference/visuals.md#process-timeline
 */
declare function renderTimelineColored(milestones: readonly Milestone[]): string;
/**
 * Renders an ordered pipeline inline: steps joined by ` ━ `, with the currently-running
 * step's characters underlined via the combining low-line mark (U+0332) rather than a
 * separate glyph, so the underline survives being embedded inside surrounding item text.
 *
 * @param steps        The pipeline's stages in order, e.g. `['lint', 'test', 'build',
 *                      'deploy']`. At least one.
 * @param currentIndex The index into `steps` of the stage currently running.
 *
 * @example
 *   renderDependencyChain(['lint', 'test', 'build', 'deploy'], 2)
 *   // => 'lint ━ test ━ b̲u̲i̲l̲d̲ ━ deploy'
 *
 * @throws {RangeError} If `steps` is empty, any step is an empty string, or
 *                        `currentIndex` is not an integer within
 *                        `[0, steps.length - 1]`.
 * @see ../../doc_md/reference/visuals.md#inline-micro-visualizations
 */
declare function renderDependencyChain(steps: readonly string[], currentIndex: number): string;
/** One transition in a finite-state machine: an edge, optionally labeled by its action. */
interface FslTransition {
    /** The state the transition leaves. */
    from: string;
    /** The state the transition enters. */
    to: string;
    /** The action or event driving the transition, if the diagram names one. */
    action?: string;
}
/**
 * Renders a one-line FSL-style state-machine description: `from 'action' -> to;`,
 * consecutive transitions merged into a single chained statement wherever one's `to`
 * matches the next's `from`, `;`-terminated statements where they do not connect.
 *
 * `transitions` is read as a path: connectivity is judged purely by comparing each
 * transition's `from` against the immediately preceding transition's `to`, in array
 * order — a caller wanting one merged chain must already list its edges in traversal
 * order, since this renderer does not search for a connecting path out of order.
 *
 * When `activeState` is given, only its **first** rendered occurrence is wrapped in
 * `**bold**`; later occurrences of the same state name — for instance returning to it
 * in a cycle — render plain. This marks where the machine currently is, not every place
 * the state's name happens to appear.
 *
 * @param transitions The edges to render, in traversal order. At least one.
 * @param activeState The state currently occupied, if known. Its first occurrence is
 *                     bolded; omit when no state is known to be active.
 *
 * @example
 *   renderFsl(
 *     [
 *       { from: 'locked', to: 'unlocked', action: 'coin' },
 *       { from: 'unlocked', to: 'locked', action: 'push' },
 *     ],
 *     'locked',
 *   )
 *   // => "**locked** 'coin' -> unlocked 'push' -> locked;"
 *
 * @example
 *   renderFsl([{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }])
 *   // => 'a -> b; c -> d;'
 *
 * @throws {RangeError} If `transitions` is empty.
 * @see ../../doc_md/reference/visuals.md#inline-micro-visualizations
 */
declare function renderFsl(transitions: readonly FslTransition[], activeState?: string): string;

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
declare const TREND_DIRECTIONS: readonly ["up", "down", "rising", "falling", "steady"];
/** One member of {@link TREND_DIRECTIONS}. */
type TrendDirection = typeof TREND_DIRECTIONS[number];
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
declare function renderTrendTag(text: string, direction: TrendDirection): string;
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
declare function renderStars(score: number, max?: number): string;
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
declare function renderRetryHealth(available: number, spent: number): string;
/**
 * The weather-glyph vocabulary for summarizing a test set's health, in the order
 * `visuals.md` lists them: the green-to-red gradient first, then the special states
 * that don't fit on that gradient.
 */
declare const WEATHER_STATES: readonly ["all-green", "mostly-green", "mixed", "failing", "broad-failure", "flaky", "crashing", "stalled", "recovered"];
/** One member of {@link WEATHER_STATES}. */
type WeatherState = typeof WEATHER_STATES[number];
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
declare function renderWeather(state: WeatherState): string;

/**
 * The digest profiles: per-domain parameterizations of the compression mechanic,
 * promoted from the design spec's table to runtime data.
 *
 * `2026-08-27-compression-mechanic-design.md` (issue #20) reframes the status-checklist
 * summary line as one instance of a general digest grammar —
 * `<counts> <noun> [(<scalar>%) <bar>] [trend <sparkline>] <icon-list>` — whose
 * per-domain variation is entirely data: the unit noun, the bucket partition and its
 * marker classification, and whether a scalar axis exists. This module is that data,
 * in the `vocabulary.ts` / `markers.ts` pattern: exported `const` profile tables that
 * feed both rendering (`digest.ts`) and validation (`verify.ts`), so the partition
 * rules live in exactly one place instead of being re-derived per caller.
 *
 * The glyph vocabulary is shared across profiles — every marker any profile names must
 * appear in `markers.md` (and thus `markers.ts`'s `CANONICAL_ORDER`); a profile never
 * introduces a glyph privately. Bucket membership below mirrors the "Profile bucket
 * membership" section of `markers.md`, which is the prose source of truth.
 *
 * @see ./digest.ts
 * @see ./markers.ts
 * @see ../../doc_md/reference/markers.md
 * @see ../../superpowers/spec/2026-08-27-compression-mechanic-design.md
 */
/**
 * One bucket of a profile's partition: its id (the name validation and overrides refer
 * to) and the markers that classify into it.
 *
 * An empty `markers` list means no marker classifies here by glyph alone — units land
 * in such a bucket only by explicit override (the diff profile's change-kind buckets)
 * or by being the profile's residual bucket.
 */
interface DigestBucketSpec {
    /** The bucket's id, unique within its profile — e.g. `'success'`, `'blocking'`. */
    readonly id: string;
    /** Markers whose units classify into this bucket, exactly as rendered (see the multi-code-point note in `markers.ts`). */
    readonly markers: readonly string[];
}
/**
 * One digest profile: everything the general renderer and validator need to know about
 * a domain, as data.
 *
 * The invariants (spec § The invariants) constrain the data: `buckets` is a partition
 * in canonical order (invariant 2), `residual` names the bucket a unit falls into when
 * no marker list claims it (so every unit is counted exactly once), and `scalar` exists
 * only for a genuinely monotone axis — no percent is fabricated for a profile without
 * one (spec § Alternatives rejected).
 */
interface DigestProfile {
    /** The profile's name, the key it is registered under — e.g. `'checklist'`. */
    readonly name: string;
    /** The unit noun rendered after the counts — one word, plural, unique across profiles; it is the reader's cue for which profile grammar to pattern-match, and the validator's profile-inference key. */
    readonly noun: string;
    /** The partition, in canonical (rendered) order. */
    readonly buckets: readonly DigestBucketSpec[];
    /** The id of the bucket a unit counts toward when no bucket's marker list contains its marker — the partition's completeness guarantee. */
    readonly residual: string;
    /** When present, the id of the bucket whose share of the total renders as `(<P>%) <bar>`; absent for profiles with no monotone axis. */
    readonly scalar?: string;
    /** When `true`, the digest carries a `+N −M` line-count tail after the noun, summed from the units' `plus`/`minus` fields (the diff profile). */
    readonly plusMinus?: boolean;
    /** Bucket ids, most-defining-first: an artifact's overall state is the first bucket in this order that holds at least one unit — how a nested artifact is bucketed in its parent (spec § Composition rules, rule 3). Must cover every bucket id. */
    readonly overallOrder: readonly string[];
    /** Markers, most-salient-first, that qualify a unit as the lead line's argmax; empty when the profile has no mechanical salience rule (diff — the riskiest file is a judgment call). */
    readonly attention: readonly string[];
}
/**
 * The status-checklist profile — the deepest-developed instance, and the one
 * `renderChecklistSummary` must reproduce byte-identically.
 *
 * Bucket membership comes straight from `markers.ts` (`SUCCESS_MARKERS`,
 * `FAILURE_MARKERS`); the residual `active` bucket is the skill's "active+pending:
 * every other marker" rule. The scalar axis is completion: percent = success ÷ total.
 *
 * @example
 *   CHECKLIST_PROFILE.noun               // => 'items'
 *   CHECKLIST_PROFILE.buckets[0]?.id     // => 'success'
 */
declare const CHECKLIST_PROFILE: DigestProfile;
/**
 * The findings profile: the digest a review or audit closes with — severity tallies
 * readable instead of the findings. Blocking leads the bucket order because the
 * digest's first number is the one a glance reads first, and for findings the blocker
 * count is the headline. No scalar: 60% of findings being minor is not 60% of anything
 * a bar should imply progress toward.
 *
 * @example
 *   // ❗❗ ⚠️⚠️⚠️⚠️⚠️ 🐛🐛🐛 🔍🔍 as findings:
 *   // => '2/8/2 findings  ⚠️ 5  🐛 3  ❗ 2  🔍 2'
 */
declare const FINDINGS_PROFILE: DigestProfile;
/**
 * The options profile: the decision summary over per-option detail. The verdict is the
 * lead line ("✅ chose sqlite: single-file, zero-daemon"); the digest says at a glance
 * whether the decision is still open (`0/4/1 options`). No scalar — a decided tradeoff
 * is not 25% complete.
 *
 * `overallOrder` puts `open` first (any open option means the decision is undecided),
 * then `chosen` (a made decision), then `rejected` (everything was declined).
 *
 * @example
 *   // ✅ 🤔🤔 ❌❌❌ as options:
 *   // => '1/2/3 options  ❌ 3  🤔 2  ✅ 1'
 */
declare const OPTIONS_PROFILE: DigestProfile;
/**
 * The diff profile: the shape of the change over the hunks — `git diff --stat` restated
 * in the house grammar so it composes. The first profile to classify by something other
 * than the marker: buckets are change kinds, assigned per unit via the explicit
 * `bucket` override (`'added'` | `'modified'` | `'removed'`), leaving the marker free
 * to carry the work kind (🪚 📝 🧪 …). A unit with no stated change kind counts as
 * `modified`, the residual. Instead of a bar, the digest carries a `+N −M` line-count
 * tail summed from the units' `plus`/`minus` fields.
 *
 * `attention` is empty: the spec puts the lead line on "the riskiest file", which is a
 * judgment call, not a marker rule — the caller picks the lead unit by hand.
 *
 * @example
 *   // 16 changed files, 214 lines added, 96 removed:
 *   // => '3/11/2 files +214 −96  🪚 6  📝 4  🧪 3  🗑️ 2  🔨 1'
 */
declare const DIFF_PROFILE: DigestProfile;
/**
 * The results profile: what was found over where. The digest answers "did the search
 * pay?" before the reader commits to the detail; the `missed` bucket (🦗 for a source
 * that returned nothing) makes silent-miss reporting structural rather than optional.
 * Anything neither partial nor missed counts as `matched`, the residual.
 *
 * @example
 *   // 🔍×14 🌗×2 🦗×1 as results:
 *   // => '14/2/1 hits  🔍 14  🌗 2  🦗 1'
 */
declare const RESULTS_PROFILE: DigestProfile;
/**
 * Every registered profile name, in the spec's listed order — the closed vocabulary
 * the `render_digest` MCP tool's `profile` enum is built from, so a misspelled profile
 * is unnameable.
 *
 * @example
 *   PROFILE_NAMES.includes('findings')  // => true
 */
declare const PROFILE_NAMES: readonly ["checklist", "findings", "options", "diff", "results"];
/** One of the registered profile names. */
type ProfileName = (typeof PROFILE_NAMES)[number];
/**
 * The registered profiles by name — the single lookup rendering and tooling share.
 *
 * @example
 *   PROFILES.findings.noun  // => 'findings'
 */
declare const PROFILES: Readonly<Record<ProfileName, DigestProfile>>;
/**
 * The profile whose noun is `noun`, or `undefined` when no profile renders that noun —
 * the validator's profile inference, per the fixed-grammar rule that the digest's noun
 * cues the profile.
 *
 * @param noun the unit noun exactly as rendered in a digest line, e.g. `'findings'`
 * @returns the matching profile, or `undefined` for an unknown noun
 * @example
 *   profileForNoun('items')?.name  // => 'checklist'
 *   profileForNoun('zebras')       // => undefined
 * @see ./verify.ts verifyDigest
 */
declare function profileForNoun(noun: string): DigestProfile | undefined;

/**
 * The general digest renderer: the profile-independent machinery of the compression
 * mechanic, extracted from `checklist.ts` (issue #20).
 *
 * A compressed artifact is a body of comparable units plus a digest derived from them;
 * this module renders the digest — one fixed-shape line (plus the existing overflow
 * block) per the grammar
 * `<counts> <noun> [(<scalar>%) <bar>] [trend <sparkline>] <icon-list>` — for any
 * profile in `profiles.ts`. The grouping by `(marker, bucket)`, the tallying, the
 * count-desc/canonical-rank sort, the 8-entry inline/block split, and the 12-entry
 * wrap were all pinned by the status-checklist convention and are unchanged here; only
 * the bucket set, the noun, and the scalar formula became parameters. The status-
 * checklist summary line is this grammar with the checklist profile plugged in —
 * byte-identical, which the existing checklist suites prove.
 *
 * Also here: the two composition helpers the spec's invariants call for —
 * {@link leadUnitIndex} (the lead line's argmax, the one digest element that keeps a
 * single unit's identity) and {@link overallBucket} / {@link nestDigest} (nesting by
 * digest substitution: a child artifact appears in its parent as one line carrying the
 * child's digest, counted as one unit bucketed by the child's overall state).
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * @see ./profiles.ts
 * @see ./checklist.ts
 * @see ../../superpowers/spec/2026-08-27-compression-mechanic-design.md
 */

/**
 * One unit of a compressed artifact, reduced to exactly what the digest needs: the
 * marker glyph it renders with, and — when the glyph alone can't carry it — which
 * bucket it counts toward.
 *
 * `bucket` names one of the profile's bucket ids and wins outright over the marker's
 * own classification when it does; an id the profile does not define is ignored and
 * the unit classifies by marker as usual. Profiles that classify by something other
 * than the marker (the diff profile's change kinds) rely on it entirely.
 *
 * `plus`/`minus` feed the `+N −M` tail of a `plusMinus` profile (lines added and
 * removed by this unit, for the diff profile) and are ignored everywhere else.
 */
interface DigestUnit {
    marker: string;
    bucket?: string;
    plus?: number;
    minus?: number;
}
/** Options accepted by {@link renderDigest}. */
interface DigestOptions {
    series?: readonly number[];
}
/**
 * The icon list moves from inline (after the head) to its own block below once it
 * holds more than this many distinct `(marker, bucket)` entries.
 */
declare const INLINE_ENTRY_LIMIT = 8;
/** Within the block form, a bucket line wraps onto a new line after this many entries. */
declare const MAX_ENTRIES_PER_LINE = 12;
/**
 * Renders a compressed artifact's digest, per the general grammar:
 * the per-bucket count section, the profile's unit noun, an optional scalar percent
 * with the 10-cell anti-aliased progress bar (only when the profile declares a scalar
 * axis — no percent is fabricated otherwise), an optional `+N −M` line-count tail
 * (only for a `plusMinus` profile), an optional trend sparkline, and the per-marker
 * icon list — inline when it is short, or split into per-bucket blocks below when it
 * isn't.
 *
 * Every layout rule is exactly the status-checklist convention's, with the bucket set
 * as a parameter: the icon list moves from inline to block form past
 * {@link INLINE_ENTRY_LIMIT} distinct `(marker, bucket)` entries; block bucket lines
 * appear in the profile's canonical bucket order (empty buckets omitted), wrap past
 * {@link MAX_ENTRIES_PER_LINE} entries, and are blank-separated exactly when any
 * bucket line wrapped.
 *
 * @param units   every unit of the artifact, one entry each; must be non-empty — a
 *   digest has nothing to summarize otherwise
 * @param profile the digest profile: buckets, noun, scalar axis, tail — see
 *   `profiles.ts`
 * @param options `series`, the artifact's scalar history in chronological order; a
 *   trend sparkline is appended only when it has 4 or more points (fewer is silently
 *   omitted, not an error), always on the `'absolute'` scale so digests of different
 *   artifacts stay comparable
 *
 * @example
 *   renderDigest(
 *     [
 *       ...Array(2).fill({ marker: '❗' }), ...Array(5).fill({ marker: '⚠️' }),
 *       ...Array(3).fill({ marker: '🐛' }), ...Array(2).fill({ marker: '🔍' }),
 *     ],
 *     FINDINGS_PROFILE,
 *   )
 *   // => '2/8/2 findings  ⚠️ 5  🐛 3  ❗ 2  🔍 2'
 *
 * @throws {RangeError} when `units` is empty.
 * @see ./profiles.ts
 * @see ./checklist.ts renderChecklistSummary — the checklist-profile instantiation
 */
declare function renderDigest(units: readonly DigestUnit[], profile: DigestProfile, options?: DigestOptions): string;
/**
 * The index of the artifact's lead unit — the argmax of the body by the profile's
 * attention order — or `-1` when no unit qualifies.
 *
 * This is the lead-line exception made mechanical: the lead line is the one digest
 * element that keeps a unit's identity, a 1-unit compression sitting between the
 * digest (0 units of identity) and the body (all of them) — which is why the result is
 * a single index, never a list: two lead lines would be a body. The winner is the unit
 * whose marker appears earliest in `profile.attention`; ties go to the earliest unit
 * in body order. A `-1` means nothing needs attention — the caller leads with the
 * all-clear (✅) or omits the lead line entirely, per the skill's own rule.
 *
 * @param units   the artifact's units, in body order
 * @param profile the profile whose `attention` order ranks salience
 * @returns the winning unit's index in `units`, or `-1` when no marker qualifies
 *
 * @example
 *   leadUnitIndex(
 *     [{ marker: '✅' }, { marker: '🚫' }, { marker: '❌' }],
 *     CHECKLIST_PROFILE,
 *   )  // => 2 — ❌ outranks 🚫 in the checklist attention order
 *
 * @see ./profiles.ts
 */
declare function leadUnitIndex(units: readonly DigestUnit[], profile: DigestProfile): number;
/**
 * The artifact's overall state: the first bucket in the profile's `overallOrder` that
 * holds at least one unit.
 *
 * This is how a nested artifact is bucketed in its parent (spec § Composition rules,
 * rule 3): a checklist with any failure is overall `'failure'`, one with work still
 * running is `'active'`, one fully landed is `'success'`; an options artifact with any
 * open option is overall `'open'`. Guaranteed to return a bucket id as long as
 * `overallOrder` covers every bucket (which every registered profile's does); the
 * residual bucket is the defensive fallback.
 *
 * @param units   the artifact's units; must be non-empty — an empty artifact has no state
 * @param profile the profile whose `overallOrder` defines "overall"
 * @returns the id of the artifact's overall bucket
 *
 * @example
 *   overallBucket([{ marker: '✅' }, { marker: '⏳' }], CHECKLIST_PROFILE)  // => 'active'
 *   overallBucket([{ marker: '✅' }, { marker: '✅' }], CHECKLIST_PROFILE)  // => 'success'
 *
 * @throws {RangeError} when `units` is empty.
 * @see nestDigest
 */
declare function overallBucket(units: readonly DigestUnit[], profile: DigestProfile): string;
/** What {@link nestDigest} hands the parent artifact: the child's one-line representation and overall bucket. */
interface NestedDigest {
    /** The child's digest head line — the fixed-shape part, safe to embed as one body line even when the child's own icon list went block-form. */
    readonly line: string;
    /** The child's overall bucket id, per {@link overallBucket} — what the parent's partition counts the child under. */
    readonly bucket: string;
}
/**
 * Represents a whole child artifact as one unit-sized line for a parent artifact's
 * body — nesting by digest substitution (spec § Composition rules, rule 3).
 *
 * When a unit is itself a compressed artifact, the child appears in the parent's body
 * as one line carrying the child's *digest*, and counts as exactly **one** unit in the
 * parent's partition, bucketed by the child's overall state — its units are never
 * double-counted into the parent, because the digest is its representation. The
 * returned `line` is the child digest's head line (identical to the full digest when
 * the child's icon list fit inline); the returned `bucket` is what the parent passes
 * as the unit's explicit `bucket` override when parent and child share a bucket
 * vocabulary (checklist-in-checklist), or maps into its own partition otherwise.
 *
 * Within a single artifact, plain indentation sub-items remain individually counted
 * exactly as before — this rule applies only across artifacts, where the nested thing
 * has a digest of its own.
 *
 * @param childUnits   the child artifact's units; must be non-empty
 * @param childProfile the child artifact's profile
 * @param options      passed through to the child's {@link renderDigest} (trend series)
 * @returns the child's head line and overall bucket
 *
 * @example
 *   nestDigest([{ marker: '✅' }, { marker: '❌' }], CHECKLIST_PROFILE)
 *   // => { line: '1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1', bucket: 'failure' }
 *   // The parent then carries e.g. `- 📋 subplan — 1/0/1 items (50%) …` as ONE unit,
 *   // with { marker: '📋', bucket: 'failure' } in its own units list.
 *
 * @throws {RangeError} when `childUnits` is empty (via {@link renderDigest}).
 * @see overallBucket
 */
declare function nestDigest(childUnits: readonly DigestUnit[], childProfile: DigestProfile, options?: DigestOptions): NestedDigest;

/**
 * The status-checklist summary line, computed instead of imitated.
 *
 * `status-checklists-skill.md` § The summary line spells out, in prose, exactly how the
 * count section, percent, progress bar, optional trend, and per-marker icon list are
 * derived from a checklist's items — and every one of those rules has an edge (the
 * 0.17/0.5/0.83 anti-aliasing boundary, the count-desc-then-canonical-order sort, the
 * 8-vs-9 inline/block split, the 12-entry wrap) that a hand-drawn checklist has
 * historically gotten wrong by eye.
 *
 * Since issue #20 reframed the summary line as the checklist **profile** of the
 * general digest grammar, the machinery lives in `digest.ts` and this module is the
 * checklist-profile instantiation: same signature, byte-identical output (the
 * exact-string and stochastic suites are the proof), with the arithmetic composed from
 * the already-pinned primitives in `scale.ts`, `markers.ts`, and `series.ts` rather
 * than re-deriving any of it. Pure: no I/O, no clock, no randomness.
 *
 * @see ./digest.ts
 * @see ./profiles.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ./markers.ts
 */

/**
 * One checklist item, reduced to exactly what the summary line needs: the marker glyph
 * it renders with, and — only for a marker like `🛳️` whose bucket the glyph alone can't
 * carry — which bucket it counts toward.
 *
 * `bucket` wins outright over the marker's own classification whenever supplied,
 * exactly as `classifyMarker`'s `override` parameter always has.
 */
interface ChecklistItem {
    marker: string;
    bucket?: Bucket;
}
/** Options accepted by {@link renderChecklistSummary}. */
interface SummaryOptions {
    series?: readonly number[];
}
/**
 * Renders a checklist's summary line, per `status-checklists-skill.md` § The summary
 * line: the three-number count section, the percent, the 10-cell anti-aliased progress
 * bar, an optional trend sparkline, and the per-marker icon list — inline when it is
 * short, or split into a success/active+pending/failure block below the bar when it
 * isn't.
 *
 * This is `renderDigest` with the checklist profile plugged in (issue #20): the icon
 * list moves from inline to the block form past 8 distinct `(marker, bucket)` entries,
 * bucket lines wrap past 12 entries, and every bucket's block (success, then
 * active+pending, then failure — empty buckets omitted) is blank-separated exactly
 * when any bucket line wrapped, matching this skill's own `check-checklist.mjs`
 * validator. Callers should not need to know the framing changed: the signature and
 * the rendered bytes are exactly what they were before the extraction.
 *
 * @param items   every checklist item at every nesting level, one entry each; must be
 *   non-empty — a summary line has nothing to summarize otherwise
 * @param options `series`, the checklist's percent history in chronological order; a
 *   trend sparkline is appended only when it has 4 or more points (fewer is silently
 *   omitted, not an error — see `renderSparkline`'s own precondition)
 *
 * @example
 *   // The SKILL.md example: 11 distinct markers, more than 8, so the icon list drops
 *   // to its own block and splits into three bucket lines.
 *   renderChecklistSummary([
 *     ...Array(8).fill({ marker: '✅' }),  ...Array(4).fill({ marker: '🤖' }),
 *     ...Array(2).fill({ marker: '⏳' }),  ...Array(2).fill({ marker: '🔜' }),
 *     ...Array(2).fill({ marker: '❗' }),  { marker: '🌐' }, { marker: '🛠️' },
 *     { marker: '🤔' }, ...Array(2).fill({ marker: '🌗' }),
 *     { marker: '❌' }, { marker: '🚫' },
 *   ])
 *   // => '8/13/4 items (32%) ███▒░░░░░░\n' +
 *   //    '\n' +
 *   //    '✅ 8\n' +
 *   //    '🤖 4  ⏳ 2  🔜 2  ❗ 2  🌐 1  🛠️ 1  🤔 1\n' +
 *   //    '🌗 2  ❌ 1  🚫 1'
 *
 * @example
 *   // 8 or fewer distinct markers stay inline, two spaces after the bar.
 *   renderChecklistSummary([
 *     ...Array(4).fill({ marker: '✅' }), { marker: '🔜' }, { marker: '❌' },
 *   ])
 *   // => '4/1/1 items (67%) ██████▓░░░  ✅ 4  🔜 1  ❌ 1'
 *
 * @throws {RangeError} when `items` is empty.
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ./digest.ts renderDigest
 * @see ./profiles.ts CHECKLIST_PROFILE
 */
declare function renderChecklistSummary(items: readonly ChecklistItem[], options?: SummaryOptions): string;

/**
 * The annotation renderers: an anchor segment for a single channel line, and the
 * grouped annotation block for a batch (issue #18).
 *
 * The medium is the constraint. No host in the tri-host set can draw *on* an earlier
 * message — the transcript is append-only everywhere — so the only universal primitive
 * is new text that **quotes and marks**. These renderers are that primitive, computed
 * rather than imitated, on exactly the argument that motivated the chart renderers:
 * a canonical rendering the model can paste beats a rendering it approximates by eye.
 *
 * What is deliberately *not* here: the diff marker (`!`, `-`, `+`, `#`) and the
 * self-state decoration glyph (`🤔`, `🧭`, …). Those are per-channel skill conventions,
 * derivable from the record and never stored, and duplicating that table here would
 * create a second place for it to drift. {@link renderAnchorSegment} produces exactly
 * the segment that splices between the keyword and the note, which is the piece
 * anchoring actually adds to a channel line.
 *
 * Pure: no I/O, no store access, no clock, no randomness. Resolution verdicts are
 * *passed in* — computed by `channels/anchors.ts` against the target's present state —
 * because a renderer that read the filesystem would stop being testable by exact string.
 *
 * @see ../channels/anchors.js
 * @see ../../superpowers/spec/2026-08-27-anchoring-design.md
 */
/**
 * The five addressable kinds, restated here as a literal union rather than imported
 * from `channels/vocabulary.ts`.
 *
 * The reason is what ships: `dist/charts/*.d.ts` are published, `dist/channels/` are
 * not, so a chart declaration file naming a channels type would dangle for every
 * consumer resolving the package's types. Every other renderer's declarations already
 * stand alone; this keeps that true — a pure presentation module describing its own
 * inputs, which is the honest shape for it anyway.
 *
 * The restatement is the same two-layer arrangement the schema's `CHECK`s and
 * `entries.validate` already use, and it is guarded the same way: `annotations.spec.ts`
 * asserts this union and `ANCHOR_KINDS` accept exactly the same set, so they cannot
 * drift apart silently.
 *
 * @see ../channels/vocabulary.js ANCHOR_KINDS
 */
type AnnotationKind = 'file' | 'prompt' | 'reply' | 'checklist' | 'entry';
/**
 * How an anchor stands against its target's current state, as the renderer receives it.
 *
 * Structurally identical to `AnchorResolution` in `channels/anchors.ts`, and restated
 * for the same shipping reason as {@link AnnotationKind}: a verdict from `resolveAnchor`
 * is assignable here directly, so a caller passes one straight through.
 *
 * @see ../channels/anchors.js resolveAnchor
 */
type AnnotationStatus = 'fresh' | 'moved' | 'orphaned' | 'distant';
/** One resolution verdict, plus where the content is now when that differs. */
interface AnnotationResolution {
    readonly status: AnnotationStatus;
    /** The span the content occupies *now*, in the kind's own grammar, when known. */
    readonly span?: string | undefined;
    /** The span originally recorded, present only on a `moved` verdict. */
    readonly from?: string | undefined;
}
/**
 * How many characters of quote text a rendered line shows before truncating with `…`.
 *
 * Smaller than the stored cap (`ANCHOR_QUOTE_MAX`, 120) on purpose: storage keeps
 * enough to *resolve* the anchor, while the block keeps enough to *recognize* it. A
 * quote column running to 120 characters would push every note off the right edge,
 * which is the floating-prose failure in a new costume.
 *
 * @see ../channels/anchors.js
 */
declare const QUOTE_DISPLAY_CAP = 40;
/** One note to render: the anchor, the words, and — for the block — how it resolves now. */
interface AnnotationNote {
    /** The note itself; whatever the entry's `text` says. */
    readonly text: string;
    /** The feeling face that ends every channel line. Omitted renders no face. */
    readonly face?: string | undefined;
    readonly anchorKind: AnnotationKind;
    /** Repo-relative path, `prompt_id`, `series_key`, or entry id as text. */
    readonly anchorTarget: string;
    readonly anchorSpan?: string | undefined;
    readonly anchorQuote?: string | undefined;
    /**
     * A friendlier name for the target than the target itself — a checklist series'
     * display title, say. Presentation only; the record still keys on `anchorTarget`.
     */
    readonly targetLabel?: string | undefined;
    /**
     * How many turns back a `prompt`/`reply` target is, when that is known and not zero.
     * Renders as `your message (2 turns ago)`.
     */
    readonly turnsAgo?: number | undefined;
    /** The verdict from `resolveAnchor`; absent reads as `fresh`. */
    readonly resolution?: AnnotationResolution | undefined;
}
/** Options both renderers accept. */
interface AnnotationOptions {
    /**
     * Render a `file` target as a markdown link (`[path:141](path#L141)`), the one
     * progressive enhancement the VS Code surface offers. Off by default, because the
     * terminal is the floor and a raw link there is noise.
     */
    readonly markdown?: boolean | undefined;
}
/**
 * Render one anchor's target the way its kind reads best.
 *
 * Per kind: a `file` renders `path:line` (or the whole path when it has no span, or a
 * markdown link under `markdown`), a `prompt` renders as the words `your message`, a
 * `reply` as `my reply`, a `checklist` as its series title, and an `entry` as `#id`.
 * A `prompt`/`reply` note carrying `turnsAgo` says how far back it is; an orphaned
 * target is marked `(gone)`, because an orphaned annotation loses its address, never
 * its content.
 *
 * @param note    the note whose target to render
 * @param options `markdown` to emit the clickable file-link form
 *
 * @example
 *   renderAnchorTarget({ text: 'x', anchorKind: 'file',
 *                        anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141' })
 *   // => 'src/ts/channels/store.ts:141'
 *
 * @example
 *   renderAnchorTarget({ text: 'x', anchorKind: 'prompt', anchorTarget: 'p-7',
 *                        anchorQuote: 'ship it', turnsAgo: 2 })
 *   // => 'your message (2 turns ago)'
 *
 * @throws {RangeError} If `anchorKind` is not one of the known anchor kinds.
 */
declare function renderAnchorTarget(note: AnnotationNote, options?: AnnotationOptions): string;
/**
 * Render the anchor segment of one channel line: the `⚓`, the target, the quote, and
 * the guillemet, followed by the note and its feeling face.
 *
 * This is what splices between a channel's keyword and its note, so
 * `! 🤔 dissent: ` + this = the whole anchored line, with the marker and decoration
 * staying where they already live (the skill, derived from the record).
 *
 * A `moved` anchor renders its travel — `L141→L158 (moved)` — in place of a bare line
 * number, so a reader sees at a glance that the address changed under the note. An
 * `orphaned` one marks the target `(gone)` and lets the quote carry the whole anchor:
 * that is exactly what floating prose already gets right, so orphaning degrades *to*
 * today's behavior, never below it.
 *
 * @param note    the note to render
 * @param options `markdown` to emit the clickable file-link form
 *
 * @example
 *   renderAnchorSegment({ text: "null for unset and for empty; callers can't tell which",
 *                         face: '😕', anchorKind: 'file',
 *                         anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141',
 *                         anchorQuote: 'readConfig(store, key)' })
 *   // => '⚓ src/ts/channels/store.ts:141 `readConfig(store, key)` » null for unset and
 *   //     for empty; callers can't tell which 😕'   (one line)
 *
 * @example
 *   renderAnchorSegment({ text: 'that entry claimed the gate was exact; it wasn\'t',
 *                         face: '😬', anchorKind: 'entry', anchorTarget: '212' })
 *   // => '⚓ #212 » that entry claimed the gate was exact; it wasn\'t 😬'
 *
 * @throws {RangeError} If the note's `anchorKind` is unknown, its `anchorTarget` is
 *                      blank, or its `text` is empty.
 *
 * @see renderAnnotations
 */
declare function renderAnchorSegment(note: AnnotationNote, options?: AnnotationOptions): string;
/**
 * Render the canonical annotation block: notes grouped under one `⚓` header per target,
 * one aligned quote-and-note line each.
 *
 * This is the code-review shape the issue asks for — many short notes bound to many
 * locations, instead of prose that mentions locations. Within a group the position and
 * quote columns pad to the group's widest, so the notes line up and the block scans
 * vertically; groups are separated by a blank line and appear in the order their
 * targets were first named. Each line still records as its own row with its own
 * channel: **the block is presentation, the rows are the record.**
 *
 * The header names the target and nothing else — position and resolution belong to
 * individual notes, and a group of ten has ten of each. Under `markdown` it is
 * therefore the *position* column that becomes clickable, which is the half a reader
 * wants to click anyway.
 *
 * The channel is deliberately not drawn. A block that repeated `dissent:` down its
 * left edge would spend the alignment on the least surprising column — what the notes
 * share is that they are all commentary on one target, and what distinguishes them is
 * the words.
 *
 * @param notes   one or more notes; the group headers come from their targets
 * @param options `markdown` to render file targets as clickable links
 * @returns the block, with no trailing newline
 *
 * @example
 *   renderAnnotations([
 *     { anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141',
 *       anchorQuote: 'readConfig(store, key)', text: 'null for unset and for empty', face: '😕' },
 *     { anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L162',
 *       anchorQuote: 'writeConfig', text: 'local timestamp never updated', face: '🤨' },
 *   ])
 *   // => '⚓ src/ts/channels/store.ts\n' +
 *   //    '   L141  `readConfig(store, key)`  » null for unset and for empty 😕\n' +
 *   //    '   L162  `writeConfig`             » local timestamp never updated 🤨'
 *
 * @example
 *   renderAnnotations([
 *     { anchorKind: 'prompt', anchorTarget: 'p-7', anchorQuote: 'ship it when ready',
 *       text: '"ready" reads three ways; assuming tests-green', face: '🤔' },
 *   ])
 *   // => '⚓ your message\n' +
 *   //    '   `ship it when ready`  » "ready" reads three ways; assuming tests-green 🤔'
 *
 * @throws {RangeError} If `notes` is empty, or any note has an unknown `anchorKind`, a
 *                      blank `anchorTarget`, or empty `text`.
 *
 * @see renderAnchorSegment
 * @see ../channels/anchors.js resolveAnchor
 */
declare function renderAnnotations(notes: readonly AnnotationNote[], options?: AnnotationOptions): string;

/**
 * The status-checklist validator: re-derives a rendered checklist's summary arithmetic
 * from its items and reports any mismatch, so the error-prone parts (bucket partition,
 * percent, progress bar, icon lists) are checked mechanically instead of by eye.
 *
 * A careful port of the original skill's `check-checklist.mjs` — the least janky thing
 * in the old plugin — with two deliberate substitutions: the vocabulary comes from
 * `markers.ts` (the promoted single source of truth) instead of re-reading `markers.md`
 * at runtime, and the expected progress bar comes from `scale.ts`'s `barCells` instead
 * of a re-derived boundary rule. Grapheme handling keeps the original's
 * `Intl.Segmenter` clusters rather than naive string indexing, because many markers are
 * multi-code-point (a base emoji plus U+FE0F VARIATION SELECTOR-16).
 *
 * Checks performed:
 *   - every item's marker exists in the canonical vocabulary
 *   - item indentation is exactly 0 / 2 / 4 spaces
 *   - the stated success/active/failure triple partitions the items, with 🛳️ allowed
 *     to count as success or active (completed vs in progress is not knowable from the
 *     glyph)
 *   - percent = round(100 * success / total)
 *   - the 10-cell progress bar matches the percent, including the anti-aliased
 *     boundary cell
 *   - per-marker icon entries (inline after the bar and/or in the icon block below)
 *     match the actual marker counts, and each icon line is sorted by count,
 *     non-increasing, tiebroken by canonical order
 *   - no icon line exceeds 12 entries
 *   - 8-or-fewer distinct markers stay inline; 9+ move to the block below
 *   - block lines are bucket-homogeneous, appear success → active → failure, and are
 *     blank-separated exactly when any bucket wrapped past 12 entries
 *
 * Not checked (documented limitations, inherited from the original): ship-to-targets
 * destination syntax and the optional visuals.
 *
 * Since issue #20 this module also carries {@link verifyDigest}, the generalization of
 * the same re-derivation to every digest profile in `profiles.ts` — the profile is
 * inferred from the digest line's noun, a checklist digest delegates to
 * {@link verifyChecklist} unchanged, and the icon-list layout checks are shared
 * between the two via one parameterized helper rather than duplicated.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * @see ./markers.ts
 * @see ./scale.ts
 * @see ./checklist.ts
 * @see ./digest.ts
 * @see ./profiles.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
/**
 * The checklist lines out of `text`: the first fenced block's contents when fences
 * exist, otherwise every line.
 *
 * Accepts either a bare checklist block or a Markdown document containing one — the
 * first fence pair wins, matching the original validator's file handling.
 *
 * @example
 *   extractChecklistBlock('intro\n```\n- ✅ done\n```\noutro')  // => ['- ✅ done']
 *   extractChecklistBlock('- ✅ done')                          // => ['- ✅ done']
 */
declare function extractChecklistBlock(text: string): string[];
/** The summary triple and percent a checklist block states. */
interface SummaryCounts {
    readonly success: number;
    readonly active: number;
    readonly failure: number;
    readonly percent: number;
}
/**
 * The stated `S/A/F items (P%)` head of a checklist block, or `null` when the block
 * carries no parseable summary line.
 *
 * This is the logger's parse — deliberately looser than {@link verifyChecklist}'s full
 * summary-line match, so a block whose bar or icon list is malformed can still be
 * recorded (and separately flagged by the validator). Matches anywhere in the block,
 * like the original `log-checklist.mjs`.
 *
 * @example
 *   parseSummaryCounts('- ✅ a\n- ❌ b\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1')
 *   // => { success: 1, active: 0, failure: 1, percent: 50 }
 *   parseSummaryCounts('- ✅ a')  // => null
 *
 * @see verifyChecklist
 */
declare function parseSummaryCounts(block: string): SummaryCounts | null;
/** What {@link verifyChecklist} found. */
interface ChecklistVerification {
    /** `true` exactly when no check failed. */
    readonly ok: boolean;
    /** How many checklist items were parsed out of the block. */
    readonly itemCount: number;
    /** Every passed check, one `ok: …` line each. */
    readonly passes: readonly string[];
    /** Every failed check, one `FAIL: …` line each. */
    readonly failures: readonly string[];
    /**
     * The human-readable report, formatted exactly as the original validator printed:
     * the parsed-item count, every failure, and a closing verdict line.
     */
    readonly report: string;
}
/**
 * Validates a rendered status checklist against the convention's arithmetic, reporting
 * every mismatch rather than stopping at the first.
 *
 * `text` may be a bare checklist block or a Markdown document containing one fenced
 * block (the first fence pair is used) — see {@link extractChecklistBlock}.
 *
 * @param text the rendered checklist, summary line included
 * @returns every check's outcome plus the formatted report
 *
 * @example
 *   verifyChecklist('- ✅ shipped\n- ❌ broke\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1')
 *   // => { ok: true, itemCount: 2, report: 'ok: 2 items parsed\nok: all checks passed', … }
 *
 * @example
 *   verifyChecklist('- ✅ shipped\n\n1/0/0 items (90%) █████████░  ✅ 1')
 *   // => { ok: false, … }  — the percent says 90 but one success of one item is 100
 *
 * @see ./checklist.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
declare function verifyChecklist(text: string): ChecklistVerification;
/**
 * Validates a rendered compressed-artifact digest of **any** profile against the
 * general digest grammar, reporting every mismatch rather than stopping at the first —
 * the generalization of {@link verifyChecklist} the compression-mechanic spec calls
 * for (issue #20).
 *
 * The profile is inferred from the digest line's noun, per the fixed-grammar rule that
 * the noun cues the profile (`items` → checklist, `findings`, `options`, `files`,
 * `hits` — see `profiles.ts`). A checklist digest delegates wholesale to
 * {@link verifyChecklist}, so the two validators can never disagree about the
 * deepest-developed profile. For other profiles the checks re-derive what is derivable
 * from the body: marker vocabulary, indentation, the count partition (recomputed from
 * the body's markers for marker-classified profiles; sum-only for the diff profile,
 * whose change kinds a rendered body does not carry), the scalar percent and bar
 * exactly when the profile declares a scalar axis (a fabricated percent on a
 * scalar-less profile is a FAIL), the `+N −M` tail exactly when the profile declares
 * one, and the full set of icon-list layout rules shared with the checklist validator.
 *
 * `text` may be a bare block or a Markdown document containing one fenced block —
 * see {@link extractChecklistBlock}.
 *
 * @param text the rendered artifact, digest line included
 * @returns every check's outcome plus the formatted report, in the same shape
 *   {@link verifyChecklist} returns
 *
 * @example
 *   verifyDigest('- ❗ auth bypass\n- ⚠️ slow query\n\n1/1/0 findings  ❗ 1  ⚠️ 1')
 *   // => { ok: true, itemCount: 2, report: 'ok: 2 findings parsed\nok: all checks passed', … }
 *
 * @example
 *   verifyDigest('- 🔍 a\n- 🔍 b\n\n2/0/0 hits (100%) ██████████  🔍 2')
 *   // => { ok: false, … }  — the results profile has no scalar axis; the percent is fabricated
 *
 * @see verifyChecklist
 * @see ./profiles.ts
 * @see ./digest.ts
 */
declare function verifyDigest(text: string): ChecklistVerification;

/**
 * The shared graph model for the diagram renderers: nodes, edges, and the
 * normalization that turns a caller's edge list into a validated {@link Digraph}.
 *
 * Diagrams draw structure on a single-width monospace character grid, so the model
 * layer is where grid-hostile text is rejected: double-width glyphs (emoji, CJK),
 * combining marks, and embedded newlines all corrupt column alignment silently if
 * they reach the drawing surface, so they are a `RangeError` here instead
 * (`2026-08-27-diagrams-design.md` § Rendering-compatibility constraints).
 *
 * Pure: no I/O, no store access, no clock, no randomness.
 *
 * @see ./grid.js
 * @see ./layout.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */
/** One vertex of a diagram: its identity, and optionally a display label. */
interface DiagramNode {
    /** The node's unique identity, referenced by edges. */
    id: string;
    /** The text drawn inside the node's box; defaults to `id` when absent. */
    label?: string;
}
/** One directed edge of a diagram, optionally labeled (e.g. by a transition action). */
interface DiagramEdge {
    /** The id of the node this edge leaves. */
    from: string;
    /** The id of the node this edge enters. */
    to: string;
    /** The text drawn along the edge, if any — an action, a dependency kind, a verb. */
    label?: string;
}
/** A validated directed graph: the input shape every diagram renderer draws from. */
interface Digraph {
    /** Every node exactly once, in first-appearance order. */
    nodes: readonly DiagramNode[];
    /** Every edge, in input order; parallel edges and self-loops are legal. */
    edges: readonly DiagramEdge[];
}
/**
 * Guards that `text` can be drawn on the single-width grid: no control characters or
 * newlines (they break the line structure) and no double-width or combining glyphs
 * (they break column alignment). Shared by every diagram entry point that accepts
 * caller text — silently corrupting the grid is the failure class this module exists
 * to prevent.
 *
 * @param text the caller-supplied text about to be drawn
 * @param what names the offending field in the error, e.g. `"node id 'a'"`
 *
 * @example
 *   requireGridSafe('locked', "node id 'locked'");   // returns quietly
 *
 * @throws {RangeError} If `text` contains a control character, a newline, a combining
 *                        mark, or a double-width glyph such as an emoji or CJK
 *                        character.
 * @see normalizeGraph
 */
declare function requireGridSafe(text: string, what: string): void;
/**
 * The text a node draws inside its box: its label when present, its id otherwise.
 *
 * @example
 *   displayLabel({ id: 'a', label: 'alpha' })   // => 'alpha'
 *   displayLabel({ id: 'a' })                   // => 'a'
 */
declare function displayLabel(node: DiagramNode): string;
/**
 * Builds a validated {@link Digraph} from an edge list, inferring the node set from
 * edge endpoints (in first-appearance order) when `nodes` is not given, and checking
 * everything a renderer relies on: unique node ids, no dangling edge references, and
 * grid-safe text throughout.
 *
 * @param edges the graph's edges; may be empty only when `nodes` supplies at least
 *               one node, since a diagram of nothing is unrenderable
 * @param nodes the explicit node set, when node order or labels matter; every edge
 *               endpoint must appear in it
 *
 * @example
 *   normalizeGraph([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])
 *   // => { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [...] }
 *
 * @throws {RangeError} If two nodes share an id, an edge references a node absent
 *                        from an explicit `nodes` list, the graph has no nodes at
 *                        all, or any id or label fails {@link requireGridSafe}.
 * @see requireGridSafe
 */
declare function normalizeGraph(edges: readonly DiagramEdge[], nodes?: readonly DiagramNode[]): Digraph;

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
interface CharGrid {
    /** Total columns; x runs [0, width). */
    readonly width: number;
    /** Total rows; y runs [0, height). */
    readonly height: number;
    /** The cell buffer, row-major, every cell exactly one single-width character. */
    readonly cells: string[][];
}
/** One cell coordinate on a {@link CharGrid}; x grows rightward, y grows downward. */
interface GridPoint {
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
declare function makeGrid(width: number, height: number): CharGrid;
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
declare function setCell(grid: CharGrid, x: number, y: number, ch: string): void;
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
declare function mergeLine(grid: CharGrid, x: number, y: number, mask: number): void;
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
declare function attach(grid: CharGrid, x: number, y: number, direction: 'up' | 'down' | 'left' | 'right'): void;
/**
 * Draws a horizontal line from (x1, y) to (x2, y) inclusive, merging junctions with
 * anything already drawn. Endpoint order does not matter.
 *
 * @example
 *   drawHline(grid, 2, 8, 0);   // '───────' across row 0
 */
declare function drawHline(grid: CharGrid, x1: number, x2: number, y: number): void;
/**
 * Draws a vertical line from (x, y1) to (x, y2) inclusive, merging junctions with
 * anything already drawn. Endpoint order does not matter.
 *
 * @example
 *   drawVline(grid, 4, 1, 5);   // '│' down column 4
 */
declare function drawVline(grid: CharGrid, x: number, y1: number, y2: number): void;
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
declare function drawBox(grid: CharGrid, x: number, y: number, width: number, height: number): void;
/**
 * Writes `text` left to right starting at (x, y), one character per cell,
 * overwriting whatever is there (an edge label deliberately interrupts its line).
 *
 * @example
 *   drawText(grid, 2, 1, 'locked');
 *
 * @throws {Error} If any character would land outside the grid.
 */
declare function drawText(grid: CharGrid, x: number, y: number, text: string): void;
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
declare function expandWaypoints(waypoints: readonly GridPoint[]): GridPoint[];
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
declare function drawPath(grid: CharGrid, points: readonly GridPoint[]): void;
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
declare function usedExtent(grid: CharGrid): {
    width: number;
    height: number;
};
/** Options for {@link renderGrid} and {@link renderLines}. */
interface RenderGridOptions {
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
declare function renderLines(lines: readonly string[], options?: RenderGridOptions): string;
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
declare function renderGrid(grid: CharGrid, options?: RenderGridOptions): string;

/**
 * A small FSL-subset parser: exactly the fragment `renderFsl` (in
 * `../charts/timeline.ts`) emits, turned back into a {@link Digraph}.
 *
 * The subset is: bare transitions (`a -> b;`), action-labeled transitions
 * (`a 'action' -> b;`), chained arrows (`a -> b -> c;`), multiple `;`-separated
 * statements, and the active-state `**bold**` marks (stripped on parse). Everything
 * else in real FSL/jssm — probabilities, named machines, themes, other arrow kinds —
 * is a `RangeError` naming the subset, never a silent skip: this project carries
 * zero runtime dependencies, so jssm's full grammar deliberately stays out of scope
 * (`2026-08-27-diagrams-design.md` § FSL / jssm). A caller with a full FSL machine
 * has jssm; a transcript diagram needs the topology.
 *
 * Round-trip property, pinned by the stochastic suite: for any transition list `t`,
 * `parseFsl(renderFsl(t))` yields the same edge sequence as `t`, actions and all.
 *
 * @see ../charts/timeline.js
 * @see ./model.js
 */

/**
 * Parses an FSL-subset source string into a validated {@link Digraph}: each
 * transition becomes an edge, each quoted action its edge's label, and the node set
 * is inferred in first-appearance order. `**bold**` active-state marks are stripped
 * — the active state is display information, carried separately by
 * `renderStateDiagram`'s `activeState` option, not part of the topology.
 *
 * @param source the FSL text, e.g. output of `renderFsl`; must contain at least one
 *                transition, and every statement must end with `;`
 *
 * @example
 *   parseFsl("locked 'coin' -> unlocked 'push' -> locked;")
 *   // => {
 *   //   nodes: [{ id: 'locked' }, { id: 'unlocked' }],
 *   //   edges: [
 *   //     { from: 'locked', to: 'unlocked', label: 'coin' },
 *   //     { from: 'unlocked', to: 'locked', label: 'push' },
 *   //   ],
 *   // }
 *
 * @throws {RangeError} If the source is empty, a statement is malformed or missing
 *                        its `;`, or the text uses FSL features outside the subset
 *                        (probabilities, named machines, other arrow kinds); every
 *                        rejection names the subset.
 * @see normalizeGraph
 */
declare function parseFsl(source: string): Digraph;

/**
 * Layered layout for digraphs — deliberately modest, per the design spec: longest-path
 * layering, barycenter ordering within layers (a heuristic, explicitly not optimal),
 * and orthogonal edge routing on the grid.
 *
 * The shape of a drawing: layers stack top to bottom, each node a 3-row framed box;
 * between layers sit gutters where edges run. Every edge leaves its source through the
 * bottom border and enters its target through the top border with a `▼`, which makes
 * arrow direction uniform and legible. Edges to the next layer route inside one gutter
 * (straight, or with one horizontal jog on a row of their own); every other edge —
 * spanning multiple layers, looping back, or self-referencing — routes out to its own
 * corridor column on the right, giving cycles the classic wrap-around return arrow.
 * Back edges are found by depth-first search and never used for layering, so a
 * two-state toggle draws as two boxes with a forward and a return arrow rather than
 * recursing.
 *
 * Refusal is a feature: a graph past {@link MAX_DIAGRAM_NODES} nodes, a node with more
 * edges than its box has border cells, or a drawing wider than the budget is a
 * `RangeError` naming the fallbacks ({@link DIAGRAM_FALLBACKS}) — a wrapped or tangled
 * diagram is worse than no diagram.
 *
 * Pure and deterministic: identical input always yields the identical layout.
 *
 * @see ./grid.js
 * @see ./renderers.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */

/**
 * The legibility threshold: layout refuses graphs with more nodes than this. Chosen
 * from typical 78-column capacity (spec § Open questions, shipped as a reviewable
 * constant to tune against real use), not measured law.
 */
declare const MAX_DIAGRAM_NODES = 20;
/**
 * The fallback menu every layout refusal names, so the caller's next action is named
 * rather than guessed: the inline FSL form, a plain adjacency list, or the mermaid
 * emission for a destination that renders it.
 */
declare const DIAGRAM_FALLBACKS: string;
/** One node's placed box: position and size in grid cells, plus its display label. */
interface NodeBox {
    /** The node's id, matching the graph. */
    id: string;
    /** The text drawn inside the box (already includes any active-state marker). */
    label: string;
    /** Left column of the box border. */
    x: number;
    /** Top row of the box border. */
    y: number;
    /** Total box width including borders: label length + 4. */
    width: number;
    /** Total box height including borders; always 3 in this layout. */
    height: number;
}
/** One routed edge: its endpoints, optional label, and full unit-step cell path. */
interface RoutedEdge {
    /** Source node id. */
    from: string;
    /** Target node id. */
    to: string;
    /** The edge's label, when it has one; placement is the renderer's job. */
    label?: string;
    /**
     * Every cell of the path in order, from the attachment cell on the source's bottom
     * border to the arrowhead cell just above the target's top border.
     */
    points: readonly GridPoint[];
}
/** A finished digraph layout, ready to draw: geometry only, no characters yet. */
interface DigraphLayout {
    /** Columns the drawing needs; guaranteed ≤ the requested budget. */
    surfaceWidth: number;
    /** Rows the drawing needs. */
    surfaceHeight: number;
    /** Every node's placed box. */
    boxes: readonly NodeBox[];
    /** Every edge's route, in the graph's edge order. */
    routes: readonly RoutedEdge[];
}
/** Options for {@link layoutDigraph}. */
interface DigraphLayoutOptions {
    /** The width budget in columns; a layout that cannot fit refuses rather than wraps. */
    surfaceWidth: number;
    /** Per-node display-label overrides (e.g. the state form's `▶ ` active marker). */
    labels?: ReadonlyMap<string, string> | undefined;
}
/**
 * Computes the full layered layout for a validated digraph: layer assignment,
 * barycenter ordering, box placement, and an orthogonal route (with arrowhead cell)
 * for every edge.
 *
 * @param graph   a {@link Digraph}, normally from `normalizeGraph` or `parseFsl`
 * @param options the width budget and optional per-node display labels
 *
 * @example
 *   const graph = parseFsl("locked 'coin' -> unlocked 'push' -> locked;");
 *   const layout = layoutDigraph(graph, { surfaceWidth: 74 });
 *   // layout.boxes: locked at the top, unlocked below it;
 *   // layout.routes: a straight forward edge and a wrap-around return edge
 *
 * @throws {RangeError} If the graph exceeds {@link MAX_DIAGRAM_NODES} nodes, a node
 *                        has more edges than its box border can attach, or the
 *                        drawing cannot fit `surfaceWidth` columns; each refusal
 *                        names {@link DIAGRAM_FALLBACKS}.
 * @see ./renderers.js
 */
declare function layoutDigraph(graph: Digraph, options: DigraphLayoutOptions): DigraphLayout;

/**
 * The public diagram forms: state diagram, digraph, tree, and sequence — data in,
 * exact framed ASCII string out, the error class of hand-drawn diagrams (misaligned
 * edges, arrows touching the wrong box, ragged margins) prevented rather than
 * detected.
 *
 * All four share the rendering-compatibility constraints from the design spec:
 * single-width glyphs only (light box-drawing set plus `▶ ◀ ▲ ▼` arrowheads), a
 * width budget defaulting to {@link DEFAULT_DIAGRAM_WIDTH} columns, framed output by
 * default, no trailing whitespace ever, and refusal — naming fallbacks — over an
 * illegible or wrapped drawing. Emit the result inside a ` ```text ` fence; outside
 * one, proportional fonts destroy the alignment these renderers guarantee.
 *
 * Pure: no I/O, no store access, no clock, no randomness.
 *
 * @see ./layout.js
 * @see ./grid.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */

/**
 * The default maximum output width in columns, frame included: fits an 80-column
 * terminal inside a code fence without wrapping.
 */
declare const DEFAULT_DIAGRAM_WIDTH = 78;
/** Options shared by every diagram form. */
interface DiagramRenderOptions {
    /** Frame the diagram in a visible box; default true (see the ragged-edge finding). */
    frame?: boolean | undefined;
    /** Maximum output width in columns, frame included; default {@link DEFAULT_DIAGRAM_WIDTH}. */
    width?: number | undefined;
}
/** Options for {@link renderStateDiagram}. */
interface StateDiagramOptions extends DiagramRenderOptions {
    /** The state currently occupied, if known; its box's label gets a `▶ ` marker. */
    activeState?: string | undefined;
}
/**
 * Renders a state machine as boxes and labeled arrows: layers top to bottom, every
 * transition entering its target from above with a `▼`, cycles drawn as wrap-around
 * return arrows on the right. Input is either a {@link Digraph} or FSL-subset source
 * (the text `renderFsl` emits); the active state — a display fact, not topology — is
 * marked with `▶ ` inside its box, since bolding does not exist inside a code fence.
 *
 * @param machine a graph, or FSL-subset source such as `"a 'go' -> b;"`
 * @param options `activeState` plus the shared frame/width options
 *
 * @example
 *   renderStateDiagram("locked 'coin' -> unlocked 'push' -> locked;")
 *   // => a framed drawing: locked's box above unlocked's, a labeled 'coin' arrow
 *   //    down, and a labeled 'push' return arrow wrapping around the right side
 *
 * @throws {RangeError} If the FSL source is outside the parser's subset, the graph
 *                        fails validation, `activeState` names an unknown state, or
 *                        layout refuses (too many nodes, too tangled, or over the
 *                        width budget) — refusals name the fallbacks.
 * @see parseFsl
 * @see renderDigraph
 */
declare function renderStateDiagram(machine: Digraph | string, options?: StateDiagramOptions): string;
/**
 * Renders a directed graph — dependencies, call flows, data lineage — with the same
 * drawing engine as {@link renderStateDiagram} but no state-machine affordances.
 * Reach for it the moment structure branches, merges, cycles, or fans in or out; a
 * straight line is better served by the inline chain forms.
 *
 * @param graph the graph to draw; run through `normalizeGraph` internally, so a
 *               hand-built edge list is fine
 *
 * @example
 *   renderDigraph(normalizeGraph([
 *     { from: 'claude', to: 'root' }, { from: 'codex', to: 'root' },
 *     { from: 'root', to: 'skills' }, { from: 'root', to: 'commands' },
 *   ]))
 *   // => a framed fan-in/fan-out drawing: two manifests converging on root,
 *   //    root forking to skills and commands
 *
 * @throws {RangeError} If the graph fails validation or layout refuses (too many
 *                        nodes, too tangled, or over the width budget) — refusals
 *                        name the fallbacks.
 * @see renderStateDiagram
 * @see renderTree
 */
declare function renderDigraph(graph: Digraph, options?: DiagramRenderOptions): string;
/** Options for {@link renderTree}. */
interface TreeRenderOptions extends DiagramRenderOptions {
    /** Display labels by node id; a node absent from the map draws its id. */
    labels?: Readonly<Record<string, string>> | undefined;
}
/**
 * Renders a strict hierarchy — a decision tree, a module tree with annotations — as
 * a connector tree (`├─`/`└─`/`│`), the simpler tidy layout the spec reserves for
 * input that is genuinely a tree. Non-tree input is refused by naming the first node
 * that appears under two parents (or in a cycle), so the caller knows to use
 * {@link renderDigraph} instead.
 *
 * @param root     the root node's id
 * @param children each node's ordered children, by parent id; ids absent from the
 *                  map are leaves, and every key must be reachable from `root`
 *
 * @example
 *   renderTree('plugin', { plugin: ['skills', 'commands'], commands: ['claude', 'gemini'] })
 *   // => '┌────────────────┐\n' +
 *   //    '│ plugin         │\n' +
 *   //    '│ ├─ skills      │\n' +
 *   //    '│ └─ commands    │\n' +
 *   //    '│    ├─ claude   │\n' +
 *   //    '│    └─ gemini   │\n' +
 *   //    '└────────────────┘'
 *
 * @throws {RangeError} If a node repeats (shared child or cycle — the error names
 *                        it), a `children` key is unreachable from `root`, the tree
 *                        exceeds the node threshold, or a line exceeds the width
 *                        budget; refusals name the fallbacks.
 * @see renderDigraph
 */
declare function renderTree(root: string, children: Readonly<Record<string, readonly string[]>>, options?: TreeRenderOptions): string;
/** One message of a sequence diagram: source actor, target actor, optional label. */
interface SequenceMessage {
    /** The sending actor's name, which must appear in `actors`. */
    from: string;
    /** The receiving actor's name, which must appear in `actors`; may equal `from`. */
    to: string;
    /** The text drawn on its own row above the arrow, if any. */
    label?: string;
}
/**
 * Renders a sequence diagram: one boxed actor per column, a lifeline under each, and
 * one horizontal arrow row per message, top to bottom in message order — the shape
 * the issue thread singles out as the most painful to hand-draw and the most
 * mechanical to render (fixed lifeline columns, monotone rows, no layout search).
 * Self-messages draw as a small right-hand loop; labels sit on their own row above
 * their arrow.
 *
 * @param actors   the lifeline columns, left to right; unique, non-empty names
 * @param messages the messages in time order; may be empty (actors and lifelines
 *                  still draw)
 *
 * @example
 *   renderSequence(['human', 'agent'], [
 *     { from: 'human', to: 'agent', label: 'ask' },
 *     { from: 'agent', to: 'human', label: 'answer' },
 *   ])
 *   // => a framed drawing: two boxed actors, lifelines, an 'ask' arrow rightward
 *   //    and an 'answer' arrow back leftward, each labeled on the row above
 *
 * @throws {RangeError} If `actors` is empty, repeats a name, or exceeds the node
 *                        threshold; a message names an unknown actor; or the
 *                        drawing exceeds the width budget — refusals name the
 *                        fallbacks.
 * @see renderDigraph
 */
declare function renderSequence(actors: readonly string[], messages: readonly SequenceMessage[], options?: DiagramRenderOptions): string;

/**
 * The secondary emission: a mermaid serializer, no layout. Mermaid does not render
 * in the transcript surface this plugin lives in (settled empirically in issue #19 —
 * the reader gets raw source), so this is emitted only on request, for destinations
 * that do render it: GitHub issue/PR bodies, READMEs, and preview surfaces.
 *
 * Pure string emission; the graph is re-validated on the way through, and the small
 * extra vocabulary mermaid itself cannot carry (whitespace in ids, quotes in
 * labels) is a named `RangeError` rather than silently mangled output.
 *
 * @see ./model.js
 * @see ./renderers.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */

/** The two mermaid dialects emitted: state machines, and everything else. */
type MermaidDialect = 'stateDiagram-v2' | 'flowchart';
/**
 * Serializes a graph to mermaid source: `stateDiagram-v2` for state machines (edge
 * labels become `: action` transition annotations), `flowchart` (top-down) for
 * everything else (every node declared with its label, edge labels in `|pipes|`).
 * No layout, no line drawing — mermaid's renderer owns that on whatever surface
 * this lands.
 *
 * @param graph   the graph to serialize; re-validated internally
 * @param dialect which mermaid grammar to emit
 *
 * @example
 *   toMermaid(normalizeGraph([
 *     { from: 'locked', to: 'unlocked', label: 'coin' },
 *     { from: 'unlocked', to: 'locked', label: 'push' },
 *   ]), 'stateDiagram-v2')
 *   // => 'stateDiagram-v2\n    locked --> unlocked: coin\n    unlocked --> locked: push'
 *
 * @throws {RangeError} If the graph fails validation, or an id or label uses
 *                        characters the chosen mermaid syntax cannot carry.
 * @see normalizeGraph
 */
declare function toMermaid(graph: Digraph, dialect: MermaidDialect): string;

/**
 * A zero-dependency PNG encoder: RGBA bytes in, a complete PNG file `Buffer` out.
 *
 * PNG is a signature, a few length-prefixed chunks each carrying a CRC32, and
 * scanlines compressed with deflate — and Node supplies both non-trivial halves
 * (`zlib.deflateSync` always, `zlib.crc32` since v22.2.0). Since `node:sqlite`
 * already requires Node ≥ 22.5, any install that can open the store can encode a
 * PNG, so no CRC table fallback is carried.
 *
 * Output is deliberately the simplest valid encoding: 8-bit truecolor+alpha
 * (color type 6), filter type 0 (None) on every scanline, one `IDAT` chunk.
 * Chart rasters are large runs of flat color, which deflate at its default level
 * compresses well enough that smarter per-scanline filters are not worth their
 * code.
 *
 * @see ./surface.js
 * @see ./compose.js
 * @see ../../superpowers/spec/2026-08-27-png-history-design.md
 */
/** The eight fixed bytes every PNG file starts with. */
declare const PNG_SIGNATURE: Buffer;
/**
 * Encode raw RGBA pixels as a complete PNG file.
 *
 * `rgba` is row-major, four bytes per pixel (red, green, blue, alpha), top row
 * first — exactly the layout `surface.ts` maintains — and must be exactly
 * `4 * width * height` bytes long.
 *
 * @param width  image width in pixels; a positive integer
 * @param height image height in pixels; a positive integer
 * @param rgba   the pixel bytes, row-major RGBA, length exactly `4 * width * height`
 * @returns the bytes of a valid PNG file, ready to write to disk
 *
 * @example
 *   const rgba = new Uint8Array(4 * 2 * 2).fill(255);   // a 2×2 white square
 *   const png  = encodePng(2, 2, rgba);
 *   writeFileSync('white.png', png);
 *
 * @throws {RangeError} When `width` or `height` is not a positive integer, or when
 *                      `rgba.length` is not `4 * width * height` — the message names
 *                      the expected length.
 *
 * @see ./compose.js
 */
declare function encodePng(width: number, height: number, rgba: Uint8Array): Buffer;

/**
 * A vendored 5×7 bitmap font covering printable ASCII — pure data, no drawing.
 *
 * The PNG renderer has no font stack, so text comes from bit patterns: the same
 * class of column-packed 5×7 font every oscilloscope and BIOS uses. Each glyph is
 * five column bytes; in each byte, bit 0 is the top row and bit 6 the bottom, so
 * `(column >> row) & 1` answers "is this pixel inked". Codes outside 32–126 have
 * no pattern and render as blank space rather than throwing — a chart label must
 * never be the reason a render fails.
 *
 * @see ./surface.js — `text()` blits these patterns onto a surface
 * @see ../../superpowers/spec/2026-08-27-png-history-design.md
 */
/** Width of every glyph cell in pixels, excluding inter-glyph spacing. */
declare const GLYPH_WIDTH = 5;
/** Height of every glyph cell in pixels. */
declare const GLYPH_HEIGHT = 7;
/** Blank columns between adjacent glyphs. */
declare const GLYPH_SPACING = 1;
/** Character code of the first glyph in the table (space). */
declare const FIRST_CODE = 32;
/** Character code of the last glyph in the table (tilde). */
declare const LAST_CODE = 126;
/**
 * Every printable-ASCII glyph's five column bytes, keyed by the character itself.
 *
 * @example
 *   GLYPHS['A']  // => [0x7e, 0x11, 0x11, 0x11, 0x7e]
 *   GLYPHS['€']  // => undefined — outside printable ASCII, drawn as blank
 *
 * @see glyphColumns
 */
declare const GLYPHS: Readonly<Record<string, readonly number[]>>;
/**
 * The column bytes for one character, or `null` when the character has no glyph.
 *
 * Exists beside {@link GLYPHS} so drawing code gets an explicit "no pattern" answer
 * instead of an `undefined` property read.
 *
 * @example
 *   glyphColumns('A')  // => [0x7e, 0x11, 0x11, 0x11, 0x7e]
 *   glyphColumns('é')  // => null
 */
declare function glyphColumns(character: string): readonly number[] | null;
/**
 * The width in pixels a string occupies at scale 1: five columns per character
 * plus one spacing column between adjacent characters. An empty string is 0 wide.
 *
 * Characters without a glyph still occupy a full cell — they render blank, but
 * their neighbours must not shift.
 *
 * @example
 *   measureText('')      // => 0
 *   measureText('A')     // => 5
 *   measureText('days')  // => 23
 */
declare function measureText(text: string): number;

/**
 * A minimal drawing surface over a flat RGBA array, plus the chart palette.
 *
 * Every operation draws through a {@link Region} — a translated, clipped window
 * onto a surface — so panel code can be handed its own rectangle and physically
 * cannot scribble on a neighbouring panel: out-of-region pixels are silently
 * skipped rather than clamped onto the edge or thrown over. Pure throughout — no
 * I/O, no clock, no randomness — so every operation is directly assertable
 * pixel-by-pixel.
 *
 * Colors are opaque and overwrite; there is no blending and no anti-aliasing,
 * which is what keeps 2× upscaling crisp.
 *
 * @see ./font.js
 * @see ./panels.js
 * @see ./encoder.js
 */
/** One color as red, green, blue, alpha bytes (0–255 each). */
type Rgba = readonly [number, number, number, number];
/** A pixel buffer: `data` is row-major RGBA, `4 * width * height` bytes. */
interface Surface {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
}
/**
 * A translated, clipped drawing window onto a surface. All drawing coordinates
 * are relative to the region's own top-left corner.
 */
interface Region {
    readonly surface: Surface;
    /** The region's left edge, in surface coordinates. */
    readonly x: number;
    /** The region's top edge, in surface coordinates. */
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** Background. */
declare const WHITE: Rgba;
/** Ink for frames, axes, and text. */
declare const INK: Rgba;
/** Neutral grey for null / steady / unknown categories. */
declare const GREY: Rgba;
/** Light grey for background bars and gridlines. */
declare const LIGHT_GREY: Rgba;
/** Okabe–Ito orange. */
declare const ORANGE: Rgba;
/** Okabe–Ito sky blue. */
declare const SKY: Rgba;
/** Okabe–Ito bluish green. */
declare const GREEN: Rgba;
/** Okabe–Ito yellow. */
declare const YELLOW: Rgba;
/** Okabe–Ito blue. */
declare const BLUE: Rgba;
/** Okabe–Ito vermillion. */
declare const VERMILLION: Rgba;
/** Okabe–Ito reddish purple. */
declare const PURPLE: Rgba;
/**
 * Allocate a surface filled with one color.
 *
 * @param width  surface width in pixels; a positive integer
 * @param height surface height in pixels; a positive integer
 * @param fill   the color every pixel starts as
 *
 * @example
 *   const s = makeSurface(960, 720, WHITE);
 *
 * @throws {RangeError} When `width` or `height` is not a positive integer.
 */
declare function makeSurface(width: number, height: number, fill: Rgba): Surface;
/**
 * The region covering an entire surface.
 *
 * @example
 *   const everywhere = fullRegion(makeSurface(4, 4, WHITE));
 */
declare function fullRegion(surface: Surface): Region;
/**
 * A translated sub-window of an existing region, clipped so it can never extend
 * past its parent — the mechanism by which a panel is confined to its rectangle.
 *
 * A sub-region requested wholly outside the parent degenerates to zero size
 * rather than erroring; drawing into it is then a no-op.
 *
 * @param region the parent window
 * @param x      the sub-window's left edge, relative to the parent
 * @param y      the sub-window's top edge, relative to the parent
 *
 * @example
 *   const panel = subRegion(fullRegion(s), 8, 8, 592, 336);
 */
declare function subRegion(region: Region, x: number, y: number, width: number, height: number): Region;
/**
 * Set one pixel, region-relative. Coordinates outside the region are silently
 * skipped — clipping, not clamping, so a stray coordinate never smears the edge.
 *
 * @example
 *   pixel(fullRegion(s), 0, 0, INK);
 */
declare function pixel(region: Region, x: number, y: number, color: Rgba): void;
/**
 * Horizontal run of pixels starting at (`x`, `y`), `length` wide.
 *
 * @example
 *   hline(region, 0, 10, 50, INK);
 */
declare function hline(region: Region, x: number, y: number, length: number, color: Rgba): void;
/**
 * Vertical run of pixels starting at (`x`, `y`), `length` tall.
 *
 * @example
 *   vline(region, 10, 0, 50, INK);
 */
declare function vline(region: Region, x: number, y: number, length: number, color: Rgba): void;
/**
 * Solid filled rectangle with its top-left at (`x`, `y`).
 *
 * @example
 *   fillRect(region, 2, 2, 4, 4, BLUE);
 */
declare function fillRect(region: Region, x: number, y: number, width: number, height: number, color: Rgba): void;
/**
 * One-pixel rectangle outline with its top-left at (`x`, `y`) — the panel frame.
 *
 * @example
 *   rect(region, 0, 0, region.width, region.height, INK);
 */
declare function rect(region: Region, x: number, y: number, width: number, height: number, color: Rgba): void;
/**
 * Connected line segments through `points`, drawn with Bresenham's algorithm.
 * A single point draws one pixel; an empty list draws nothing.
 *
 * @param points region-relative `[x, y]` vertices, in drawing order
 *
 * @example
 *   polyline(region, [[0, 10], [5, 2], [10, 8]], BLUE);
 */
declare function polyline(region: Region, points: readonly (readonly [number, number])[], color: Rgba): void;
/**
 * Blit a string using the 5×7 bitmap font, top-left at (`x`, `y`), each font
 * pixel drawn as a `scale`×`scale` block. Characters without a glyph occupy a
 * blank cell, so mixed text never shifts alignment.
 *
 * @param scale integer magnification; 1 for small labels, 2 for titles
 *
 * @example
 *   text(region, 4, 4, 'stems by hour', INK, 1);
 *
 * @see ./font.js
 */
declare function text(region: Region, x: number, y: number, content: string, color: Rgba, scale?: number): void;
/**
 * Nearest-neighbour integer upscale of a whole surface — how the logical
 * 960×720 dashboard becomes the crisp 1920×1440 physical raster without any
 * anti-aliasing.
 *
 * @param factor integer magnification, at least 1; 1 returns a copy
 *
 * @example
 *   const big = upscale(s, 2);   // 960×720 -> 1920×1440
 *
 * @throws {RangeError} When `factor` is not a positive integer.
 */
declare function upscale(surface: Surface, factor: number): Surface;
/**
 * Read one pixel back, region-relative — the assertion primitive the pixel tests
 * are written against. Out-of-region reads return `null`.
 *
 * @example
 *   readPixel(region, 0, 0)  // => [255, 255, 255, 255]
 */
declare function readPixel(region: Region, x: number, y: number): Rgba | null;

/**
 * The five dashboard panels, one pure function each: typed row arrays in, pixels
 * onto a surface region out.
 *
 * All layout arithmetic — scales, bucket placement, rolling means — lives here so
 * it is directly testable without touching the store or the encoder. Every panel
 * draws its frame and title even when it has nothing to plot, rendering the text
 * `no data in range` instead of omitting itself: a missing panel looks like a
 * bug, while an empty one is an answer.
 *
 * Category values (`stem`, `delta`) are accepted as plain strings and colored
 * from local maps, with anything unrecognised falling into grey. This keeps the
 * raster layer decoupled from the store's vocabulary module (mirroring how
 * `chart_tools.ts` keeps its own literal tuples) and means a future vocabulary
 * addition degrades to a grey dot rather than a crash.
 *
 * @see ./surface.js
 * @see ./compose.js
 * @see ../channels/entries.js — the query helpers producing these row shapes
 * @see ../../superpowers/spec/2026-08-27-png-history-design.md
 */

/** One signature entry, as the punch/delta/uncertainty panels consume it. */
interface SignatureRow {
    /** Insertion order — the delta lane's x-axis. */
    readonly id: number;
    /** ISO 8601 UTC timestamp; the day-bucketing key. */
    readonly tsUtc: string;
    /** Local hour 0–23 parsed from the stored local time, or `null` when unparseable. */
    readonly hourLocal: number | null;
    /** The affect stem, or `null` when none was recorded. */
    readonly stem: string | null;
    /** Direction since the previous signature, or `null` on a session's first. */
    readonly delta: string | null;
    /** Whether the signature was marked uncertain. */
    readonly uncertain: boolean;
    /** Project name, or `null` when unrecorded (e.g. privacy off). */
    readonly project: string | null;
}
/** One ISO week's turn and need counts, as the need-rate panel consumes them. */
interface NeedWeekRow {
    /** ISO week label, e.g. `2026-W35`. */
    readonly week: string;
    /** Distinct prompts that produced a signature that week. */
    readonly turns: number;
    /** `need` rows recorded that week. */
    readonly needs: number;
}
/** One checklist series' percent history, as the checklist panel consumes it. */
interface ChecklistSeriesRow {
    /** The stable series identity (#27), drawn as the line's label. */
    readonly seriesKey: string;
    /** Percent snapshots in recording order, each 0–100. */
    readonly percents: readonly number[];
}
/** Stems in vocabulary order, each with its Okabe–Ito color; unknown/null falls to grey. */
declare const STEM_COLORS: readonly (readonly [string, Rgba])[];
/** The delta lane's coloring: up blue, down vermillion, steady (and anything else) grey. */
declare function deltaColor(delta: string | null): Rgba;
/** The color for one stem value — the {@link STEM_COLORS} lookup plus the grey fallback. */
declare function stemColor(stem: string | null): Rgba;
/**
 * Which day column a timestamp lands in, for a window of `days` calendar days
 * (UTC) ending on `endUtc`'s day. Column 0 is the oldest day; the newest day is
 * `days - 1`; timestamps outside the window return `null`.
 *
 * @param tsUtc  the row's ISO UTC timestamp
 * @param endUtc the window's inclusive end instant, ISO UTC
 * @param days   window length in calendar days; a positive integer
 *
 * @example
 *   dayColumn('2026-08-27T04:00:00Z', '2026-08-27T21:00:00Z', 7)  // => 6
 *   dayColumn('2026-08-20T04:00:00Z', '2026-08-27T21:00:00Z', 7)  // => null — 8 days back
 */
declare function dayColumn(tsUtc: string, endUtc: string, days: number): number | null;
/**
 * Rolling mean of the last `window` values at each position — the delta lane's
 * drift line. Position `i` averages values `max(0, i - window + 1) .. i`, so the
 * line exists from the first entry instead of starting `window` entries in.
 *
 * @example
 *   rollingMean([1, 1, -1, -1], 2)  // => [1, 1, 0, -1]
 */
declare function rollingMean(values: readonly number[], window: number): number[];
/**
 * Panel A — the stem punch-strip: x is the calendar day across the queried
 * range, y is the local hour 0–23, one 2×2 dot per signature colored by stem
 * (grey for null). A legend along the bottom lists the stems in vocabulary
 * order. Rows with an unparseable local hour are skipped rather than guessed.
 *
 * @param rows   the signatures in range
 * @param days   the window length in calendar days; a positive integer
 * @param endUtc the window's end instant, ISO UTC
 *
 * @example
 *   drawStemPunch(panelRegion, signatureHistory(store, since), 90, nowIso);
 *
 * @see dayColumn
 */
declare function drawStemPunch(region: Region, rows: readonly SignatureRow[], days: number, endUtc: string): void;
/** The rolling-mean window, in signatures, the delta lane's drift line averages over. */
declare const DELTA_WINDOW = 20;
/**
 * Panel B — the delta lane: signatures in `id` order as thin columns colored
 * up=blue / down=vermillion / steady=grey, with the rolling mean of (+1/−1/0)
 * over a {@link DELTA_WINDOW}-entry window drawn as an ink polyline on top.
 * Oscillation reads as dense color churn under a flat line; real drift reads as
 * the line leaving the zero midline.
 *
 * @example
 *   drawDeltaLane(panelRegion, signatureHistory(store, since));
 *
 * @see rollingMean
 */
declare function drawDeltaLane(region: Region, rows: readonly SignatureRow[]): void;
/**
 * Panel C — daily uncertainty: for each calendar day in range, the proportion of
 * signatures with `uncertain` set, as a vermillion bar rising from the baseline.
 * Shares panel A's day axis so spikes can be eyeballed against what was
 * happening that day.
 *
 * @example
 *   drawUncertainStrip(panelRegion, signatureHistory(store, since), 90, nowIso);
 */
declare function drawUncertainStrip(region: Region, rows: readonly SignatureRow[], days: number, endUtc: string): void;
/**
 * Panel D — weekly need rate: per ISO week, turns as a grey bar, `need` rows as
 * a narrower orange bar overlaid, and the need-per-turn proportion as a blue
 * polyline on an implicit right-hand 0–100% scale. Answers "how often is `need`
 * non-null, and is that changing".
 *
 * @example
 *   drawNeedRate(panelRegion, needWeekly(store, since));
 */
declare function drawNeedRate(region: Region, weeks: readonly NeedWeekRow[]): void;
/** The line colors the checklist panel cycles through, one per series. */
declare const SERIES_COLORS: readonly Rgba[];
/**
 * Panel E — checklist series: `percent` versus recording order, one polyline per
 * series, labeled with its stable `series_key`. The y axis is fixed 0–100 so
 * charts are comparable across renders, matching the absolute-scale rule the
 * ASCII sparklines follow.
 *
 * @example
 *   drawChecklistSeries(panelRegion, checklistSeriesTop(store, since, 5));
 */
declare function drawChecklistSeries(region: Region, series: readonly ChecklistSeriesRow[]): void;

/**
 * Dashboard composition: lay the five panels out on one surface and encode it.
 *
 * `renderHistoryPng` is the whole raster pipeline short of the file write: it
 * allocates the surface, hands each panel its own clipped region, upscales, and
 * returns the encoded PNG `Buffer`. Its only inputs are query results and
 * options — it never touches the store, the clock, or the filesystem, so a test
 * can drive it entirely from fixtures. The single impure step (resolving the
 * output path and writing the file) lives in the invocation layer
 * (`mcp/chart_tools.ts`), not here.
 *
 * @see ./panels.js
 * @see ./encoder.js
 * @see ../mcp/chart_tools.js
 * @see ../../superpowers/spec/2026-08-27-png-history-design.md
 */

/** The charts a render can produce: the five-panel dashboard, or one panel alone at full size. */
declare const HISTORY_CHARTS: readonly ["dashboard", "stems", "delta", "uncertain", "need", "checklist"];
/** One of {@link HISTORY_CHARTS}. */
type HistoryChart = typeof HISTORY_CHARTS[number];
/** Everything the renderer needs, already queried — no store access from here down. */
interface HistoryData {
    /** Signatures in range, `id` order — panels A, B, and C. */
    readonly signatures: readonly SignatureRow[];
    /** Weekly turn/need counts — panel D. */
    readonly needWeeks: readonly NeedWeekRow[];
    /** Top checklist series' percent histories — panel E. */
    readonly checklistSeries: readonly ChecklistSeriesRow[];
    /** The window length in calendar days; a positive integer. */
    readonly days: number;
    /** The window's end instant, ISO 8601 UTC — normally the render time. */
    readonly endUtc: string;
}
/** Rendering choices; both fields optional with dashboard/2× defaults. */
interface RenderOptions {
    /** Which chart to draw; defaults to `'dashboard'`. */
    readonly chart?: HistoryChart | undefined;
    /** Integer output magnification, 1 or 2; defaults to 2 (1920×1440 physical). */
    readonly scale?: 1 | 2 | undefined;
}
/** Logical dashboard width in pixels, before scaling. */
declare const LOGICAL_WIDTH = 960;
/** Logical dashboard height in pixels, before scaling. */
declare const LOGICAL_HEIGHT = 720;
/**
 * Render the history dashboard (or one panel alone) as a complete PNG.
 *
 * The dashboard is 960×720 logical pixels — panel A top-left, B top-right, C
 * (sharing A's day axis) below A, E below C, D filling the right column — drawn
 * with hard pixels and then integer-upscaled by `scale`, so the default output
 * is a crisp 1920×1440 with no anti-aliasing. A single-chart option renders that
 * panel alone at the full logical size.
 *
 * @param data    the queried rows plus the day window they cover
 * @param options chart selection and output scale
 * @returns the encoded PNG bytes, ready to write to disk
 *
 * @example
 *   const png = renderHistoryPng({
 *     signatures: [], needWeeks: [], checklistSeries: [],
 *     days: 90, endUtc: '2026-08-27T21:15:04Z',
 *   });
 *   // => a 1920×1440 PNG of five framed panels, each reading 'no data in range'
 *
 * @throws {RangeError} When `data.days` is not a positive integer.
 *
 * @see drawPanel
 * @see ./encoder.js
 */
declare function renderHistoryPng(data: HistoryData, options?: RenderOptions): Buffer;

export { BLUE, BRAILLE, CANONICAL_ORDER, CHECKLIST_PROFILE, DEFAULT_DIAGRAM_WIDTH, DELTA_WINDOW, DIAGRAM_FALLBACKS, DIFF_PROFILE, EIGHTHS, FAILURE_MARKERS, FINDINGS_PROFILE, FIRST_CODE, GLYPHS, GLYPH_HEIGHT, GLYPH_SPACING, GLYPH_WIDTH, GREEN, GREY, HISTORY_CHARTS, INK, INLINE_ENTRY_LIMIT, LAST_CODE, LIGHT_GREY, LOGICAL_HEIGHT, LOGICAL_WIDTH, MAX_DIAGRAM_NODES, MAX_ENTRIES_PER_LINE, OPTIONS_PROFILE, ORANGE, OUTCOMES, PNG_SIGNATURE, PROFILES, PROFILE_NAMES, PURPLE, QUOTE_DISPLAY_CAP, RESULTS_PROFILE, SERIES_COLORS, SHADES, SKY, STEM_COLORS, SUCCESS_MARKERS, TREND_DIRECTIONS, VERMILLION, WEATHER_STATES, WHITE, YELLOW, absoluteIndex, attach, barCells, boundaryGlyph, canonicalRank, classifyMarker, dayColumn, deltaColor, displayLabel, double, drawBox, drawChecklistSeries, drawDeltaLane, drawHline, drawNeedRate, drawPath, drawStemPunch, drawText, drawUncertainStrip, drawVline, encodePng, expandWaypoints, extractChecklistBlock, fillRect, fullRegion, glyphColumns, hline, layoutDigraph, leadUnitIndex, makeGrid, makeSurface, measureText, mergeLine, nestDigest, normalizeGraph, overallBucket, parseFsl, parseSummaryCounts, pixel, polyline, profileForNoun, readPixel, rect, relativeIndex, renderAnchorSegment, renderAnchorTarget, renderAnnotations, renderBoxWhisker, renderBraille, renderBullet, renderChecklistSummary, renderComparison, renderDependencyChain, renderDigest, renderDigraph, renderDiverging, renderFsl, renderGrid, renderHistoryPng, renderLines, renderProgressBar, renderRange, renderRetryHealth, renderSequence, renderSparkline, renderStacked, renderStars, renderStateDiagram, renderTileGrid, renderTimelineColored, renderTimelineRail, renderTree, renderTrendTag, renderWeather, renderWinLoss, requireGridSafe, rollingMean, setCell, stemColor, subRegion, text, toMermaid, unhandled_external, upscale, usedExtent, verifyChecklist, verifyDigest, vline };
export type { AnnotationKind, AnnotationNote, AnnotationOptions, AnnotationResolution, AnnotationStatus, BoxWhiskerStats, Bucket, CharGrid, ChecklistItem, ChecklistSeriesRow, ChecklistVerification, ComparisonRow, DiagramEdge, DiagramNode, DiagramRenderOptions, DigestBucketSpec, DigestOptions, DigestProfile, DigestUnit, Digraph, DigraphLayout, DigraphLayoutOptions, FslTransition, GridPoint, HistoryChart, HistoryData, MermaidDialect, Milestone, MilestoneState, NeedWeekRow, NestedDigest, NodeBox, Outcome, ProfileName, RangeStyle, Region, RenderGridOptions, RenderOptions, Rgba, RoutedEdge, SequenceMessage, SeriesScale, SignatureRow, StateDiagramOptions, SummaryCounts, SummaryOptions, Surface, TileCell, TileFill, TreeRenderOptions, TrendDirection, WeatherState };
