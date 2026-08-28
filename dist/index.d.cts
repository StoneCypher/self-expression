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
 * Pure: no I/O, no clock, no randomness.
 *
 * @see ./markers.ts
 * @see ./scale.ts
 * @see ./checklist.ts
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

export { BLUE, BRAILLE, CANONICAL_ORDER, DELTA_WINDOW, EIGHTHS, FAILURE_MARKERS, FIRST_CODE, GLYPHS, GLYPH_HEIGHT, GLYPH_SPACING, GLYPH_WIDTH, GREEN, GREY, HISTORY_CHARTS, INK, LAST_CODE, LIGHT_GREY, LOGICAL_HEIGHT, LOGICAL_WIDTH, ORANGE, OUTCOMES, PNG_SIGNATURE, PURPLE, SERIES_COLORS, SHADES, SKY, STEM_COLORS, SUCCESS_MARKERS, TREND_DIRECTIONS, VERMILLION, WEATHER_STATES, WHITE, YELLOW, absoluteIndex, barCells, boundaryGlyph, canonicalRank, classifyMarker, dayColumn, deltaColor, double, drawChecklistSeries, drawDeltaLane, drawNeedRate, drawStemPunch, drawUncertainStrip, encodePng, extractChecklistBlock, fillRect, fullRegion, glyphColumns, hline, makeSurface, measureText, parseSummaryCounts, pixel, polyline, readPixel, rect, relativeIndex, renderBoxWhisker, renderBraille, renderBullet, renderChecklistSummary, renderComparison, renderDependencyChain, renderDiverging, renderFsl, renderHistoryPng, renderProgressBar, renderRange, renderRetryHealth, renderSparkline, renderStacked, renderStars, renderTileGrid, renderTimelineColored, renderTimelineRail, renderTrendTag, renderWeather, renderWinLoss, rollingMean, stemColor, subRegion, text, unhandled_external, upscale, verifyChecklist, vline };
export type { BoxWhiskerStats, Bucket, ChecklistItem, ChecklistSeriesRow, ChecklistVerification, ComparisonRow, FslTransition, HistoryChart, HistoryData, Milestone, MilestoneState, NeedWeekRow, Outcome, RangeStyle, Region, RenderOptions, Rgba, SeriesScale, SignatureRow, SummaryCounts, SummaryOptions, Surface, TileCell, TileFill, TrendDirection, WeatherState };
