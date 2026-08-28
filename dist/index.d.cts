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
 * `markers.md`'s "Status markers" heading says "(22, canonical order)", but
 * the bulleted list beneath it has 23 entries — a stale
 * count in the source doc. This array transcribes the actual list, per the
 * rule "every marker... in its listed order".
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
declare const CANONICAL_ORDER: readonly ["✅", "💯", "🤖", "⏳", "🌐", "🛠️", "🛰️", "🔜", "🦥", "🌗", "🫨", "🦡", "❌", "🚫", "🦗", "⏭️", "⏸️", "❗", "⚠️", "⏰", "😴", "🧠", "❓", "🤔", "📋", "🐙", "📅", "📩", "👔", "📝", "📖", "📎", "📺", "🎙️", "🖨️", "🧪", "🦆", "🔍", "🔗", "🎫", "🏁", "🪚", "🐀", "⚡", "🐛", "🧹", "🗑️", "🦤", "🧐", "⚖️", "👑", "👍", "👎", "✋", "🛳️", "♾️", "↩️", "🏗️", "📦", "⚙️", "🔑", "🩹", "🩺", "☸️", "⬆️", "⬇️", "⏫", "⏬", "🔌", "💽", "🧬", "🌱", "💾", "🪵", "🧮", "📊", "🔮", "🔥", "🚨", "🧯", "🤕", "🗿", "🪦", "🕵️", "🦓", "🏷️", "🔀", "🚀", "🔨", "🆙", "🤮", "🎨", "♿", "📐", "🗺️", "🎣", "🪓", "🦹", "🪪", "🩻", "🔒", "🕳️", "🐒", "🧌", "🤬", "🛡️", "👁️", "💰", "🌪️", "🧊", "👻", "💀", "🧟", "🌋", "🤡", "😕", "🤌", "🤥", "🥵", "😎", "🦙", "💅", "🤓"];
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
 * The status-checklist summary line, computed instead of imitated.
 *
 * `status-checklists-skill.md` § The summary line spells out, in prose, exactly how the
 * count section, percent, progress bar, optional trend, and per-marker icon list are
 * derived from a checklist's items — and every one of those rules has an edge (the
 * 0.17/0.5/0.83 anti-aliasing boundary, the count-desc-then-canonical-order sort, the
 * 8-vs-9 inline/block split, the 12-entry wrap) that a hand-drawn checklist has
 * historically gotten wrong by eye. This module is the single place that arithmetic
 * lives, composed entirely from the already-pinned primitives in `scale.ts`,
 * `markers.ts`, and `series.ts` rather than re-deriving any of it. Pure: no I/O, no
 * clock, no randomness.
 *
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ./scale.ts
 * @see ./markers.ts
 * @see ./series.ts
 */

/**
 * One checklist item, reduced to exactly what the summary line needs: the marker glyph
 * it renders with, and — only for a marker like `🛳️` whose bucket the glyph alone can't
 * carry — which bucket it counts toward.
 *
 * `bucket` is passed straight through to {@link classifyMarker}'s `override` parameter,
 * so it wins outright over the marker's own classification whenever supplied.
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
 * The icon list moves from inline to the block form once it holds more than
 * {@link INLINE_ENTRY_LIMIT} distinct `(marker, bucket)` entries. In the block form, a
 * bucket line wraps onto additional lines past {@link MAX_ENTRIES_PER_LINE} entries;
 * when *any* bucket line wrapped this way, every bucket's block (success, then
 * active+pending, then failure — empty buckets omitted) is separated from the next by a
 * blank line, matching this skill's own `check-checklist.mjs` validator. When nothing
 * wrapped, the bucket blocks sit flush against one another with no blank line between.
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
 * @see ./scale.ts
 * @see ./markers.ts
 */
declare function renderChecklistSummary(items: readonly ChecklistItem[], options?: SummaryOptions): string;

export { BRAILLE, CANONICAL_ORDER, EIGHTHS, FAILURE_MARKERS, OUTCOMES, SHADES, SUCCESS_MARKERS, TREND_DIRECTIONS, WEATHER_STATES, absoluteIndex, barCells, boundaryGlyph, canonicalRank, classifyMarker, double, relativeIndex, renderBoxWhisker, renderBraille, renderBullet, renderChecklistSummary, renderComparison, renderDependencyChain, renderDiverging, renderFsl, renderProgressBar, renderRange, renderRetryHealth, renderSparkline, renderStacked, renderStars, renderTileGrid, renderTimelineColored, renderTimelineRail, renderTrendTag, renderWeather, renderWinLoss, unhandled_external };
export type { BoxWhiskerStats, Bucket, ChecklistItem, ComparisonRow, FslTransition, Milestone, MilestoneState, Outcome, RangeStyle, SeriesScale, SummaryOptions, TileCell, TileFill, TrendDirection, WeatherState };
