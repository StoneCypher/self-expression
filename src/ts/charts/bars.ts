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

import { SHADES, boundaryGlyph, barCells } from './scale.js';
import { isMember, describeVocabulary } from '../channels/vocabulary.js';

/**
 * Returns `array[index]`, narrowed to a definite value rather than
 * `T | undefined`.
 *
 * Exists because `noUncheckedIndexedAccess` types every array index access as possibly
 * `undefined`, and this project's lint rules forbid both ways of silencing that (`as T`
 * and the `!` non-null assertion) — so every index this module knows is in bounds (a
 * fixed-length glyph ramp, a loop counter kept under the array's own length) gets that
 * guarantee spelled out as a real runtime check and a control-flow narrowing, instead of
 * an assertion that trusts the caller with no check at all.
 *
 * @throws {Error} when `index` is out of bounds — an internal invariant violation, not a
 *   caller-facing precondition.
 */
function at<T>(array: readonly T[], index: number): T {
  const value = array[index];
  if (value === undefined) {
    throw new Error(`bars.ts: index ${String(index)} out of bounds (length ${String(array.length)})`);
  }
  return value;
}

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
export function renderProgressBar(percent: number): string {
  return barCells(percent, 10);
}

// The bullet graph's own fill ramp: eighths, lightest (1/8 filled) to darkest (7/8
// filled) — distinct from `SHADES`, per the vendored example's left-block glyphs. The
// darkest step (▉) doubles as the "fully filled" cell glyph, so a run of `full` cells
// and the ramp's last entry are visually identical, by design.
const BULLET_RAMP: readonly string[] = [
  '\u{258F}', // ▏ 1/8
  '\u{258E}', // ▎ 2/8
  '\u{258D}', // ▍ 3/8
  '\u{258C}', // ▌ 4/8
  '\u{258B}', // ▋ 5/8
  '\u{258A}', // ▊ 6/8
  '\u{2589}', // ▉ 7/8 (also the full-cell glyph)
];

const BULLET_FULL = at(BULLET_RAMP, BULLET_RAMP.length - 1);
const BULLET_TICK = '\u{2502}'; // │ light vertical — the target tick

/**
 * Maps a cell's fractional fill (`0`-`1`, exclusive of `1`) onto the nearest of the
 * seven-step bullet-graph ramp `▏▎▍▌▋▊▉`.
 *
 * Unlike `boundaryGlyph` (four shades, three thresholds), the bullet ramp has no glyph
 * for "empty" — its lightest step is already 1/8 filled — so a fraction near 0 still
 * renders `▏` rather than a blank cell; this is "nearest ramp step", not "anti-aliased
 * against a blank".
 *
 * @param fraction how full the boundary cell is, `0` (exclusive of a full cell) up to
 *   (but not including) `1`
 */
function bulletBoundaryGlyph(fraction: number): string {
  const step = Math.min(7, Math.max(1, Math.round(fraction * 8)));
  return at(BULLET_RAMP, step - 1);
}

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
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export function renderBullet(value: number, target: number, max: number, cells: number = 10): string {
  if (!Number.isFinite(max) || max <= 0) {
    throw new RangeError(`renderBullet: max must be a positive finite number; got ${String(max)}`);
  }
  if (!Number.isInteger(cells) || cells < 1) {
    throw new RangeError(`renderBullet: cells must be a positive integer; got ${String(cells)}`);
  }
  if (Number.isNaN(value) || value < 0 || value > max) {
    throw new RangeError(`renderBullet: value must be within [0, ${String(max)}]; got ${String(value)}`);
  }
  if (Number.isNaN(target) || target < 0 || target > max) {
    throw new RangeError(`renderBullet: target must be within [0, ${String(max)}]; got ${String(target)}`);
  }

  const cellWidth = max / cells;
  const rawFull = value / cellWidth;
  const full = Math.min(cells, Math.floor(rawFull));
  const hasBoundary = full < cells;
  const remainder = hasBoundary ? rawFull - full : 0;

  const bar: string[] = new Array<string>(cells).fill(at(SHADES, 0));
  for (let i = 0; i < full; i++) { bar[i] = BULLET_FULL; }
  if (hasBoundary) { bar[full] = bulletBoundaryGlyph(remainder); }

  const tickIndex = Math.min(cells - 1, Math.floor((target / max) * cells));
  bar[tickIndex] = BULLET_TICK;

  return bar.join('');
}

const DIVERGING_CENTER = '\u{2503}'; // ┃ heavy vertical

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
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export function renderDiverging(value: number, maxAbs: number, cellsPerSide: number = 6): string {
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
    throw new RangeError(`renderDiverging: maxAbs must be a positive finite number; got ${String(maxAbs)}`);
  }
  if (!Number.isInteger(cellsPerSide) || cellsPerSide < 1) {
    throw new RangeError(`renderDiverging: cellsPerSide must be a positive integer; got ${String(cellsPerSide)}`);
  }
  if (Number.isNaN(value) || value < -maxAbs || value > maxAbs) {
    throw new RangeError(`renderDiverging: value must be within [-${String(maxAbs)}, ${String(maxAbs)}]; got ${String(value)}`);
  }

  const fraction = Math.abs(value) / maxAbs;
  const rawFull = fraction * cellsPerSide;
  const full = Math.min(cellsPerSide, Math.floor(rawFull));
  const hasBoundary = full < cellsPerSide;
  const remainder = hasBoundary ? rawFull - full : 0;
  const boundary = hasBoundary ? boundaryGlyph(remainder) : '';
  const padCount = cellsPerSide - full - (hasBoundary ? 1 : 0);

  const grown = at(SHADES, 3).repeat(full);
  const pad = at(SHADES, 0).repeat(padCount);
  const emptySide = at(SHADES, 0).repeat(cellsPerSide);

  // Reading left-to-right: the growing side puts full cells adjacent to the center and
  // padding at the outer edge; the mirrored side (opposite sign) reverses that order.
  const towardCenterFromRight = grown + boundary + pad;
  const towardCenterFromLeft  = pad + boundary + grown;

  return value >= 0
    ? emptySide + DIVERGING_CENTER + towardCenterFromRight
    : towardCenterFromLeft + DIVERGING_CENTER + emptySide;
}

/** One count bucket of a `renderStacked` call, paired with the glyph it renders as. */
interface StackedBucket {
  readonly value : number;
  readonly glyph : string;
}

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
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export function renderStacked(success: number, activePending: number, failure: number, width: number = 16): string {
  const buckets: StackedBucket[] = [
    { value: success,       glyph: at(SHADES, 3) }, // █
    { value: activePending, glyph: at(SHADES, 2) }, // ▓
    { value: failure,       glyph: at(SHADES, 1) }, // ▒
  ];

  for (const bucket of buckets) {
    if (!Number.isFinite(bucket.value) || bucket.value < 0) {
      throw new RangeError(
        `renderStacked: success, activePending, and failure must each be a non-negative finite number; got ${String(bucket.value)}`
      );
    }
  }

  const total = success + activePending + failure;
  if (total <= 0) {
    throw new RangeError(`renderStacked: success + activePending + failure must be greater than 0; got ${String(total)}`);
  }

  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`renderStacked: width must be a positive integer; got ${String(width)}`);
  }

  const nonzeroCount = buckets.filter(b => b.value > 0).length;
  if (width < nonzeroCount) {
    throw new RangeError(
      `renderStacked: width must be at least the number of nonzero buckets (${String(nonzeroCount)}); got ${String(width)}`
    );
  }

  // Phase 1: standard largest-remainder apportionment, ignoring the minimum-1 rule.
  const raw = buckets.map(b => (b.value / total) * width);
  const floored = raw.map(Math.floor);
  const floorSum = floored.reduce((a, b) => a + b, 0);
  const remaining = width - floorSum;

  const byRemainderDesc = raw
    .map((r, i) => ({ i, remainder: r - at(floored, i) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  const counts = [...floored];
  for (let k = 0; k < remaining; k++) {
    const winner = at(byRemainderDesc, k);
    counts[winner.i] = at(counts, winner.i) + 1;
  }

  // Phase 2: guarantee every nonzero bucket keeps at least one cell, by stealing a cell
  // from whichever bucket currently holds the most.
  for (let i = 0; i < buckets.length; i++) {
    if (at(buckets, i).value <= 0 || at(counts, i) > 0) { continue; }
    let donor = 0;
    for (let j = 1; j < counts.length; j++) {
      if (at(counts, j) > at(counts, donor)) { donor = j; }
    }
    counts[donor] = at(counts, donor) - 1;
    counts[i] = 1;
  }

  return buckets.map((b, i) => b.glyph.repeat(at(counts, i))).join('');
}

const RANGE_STYLES = ['fill', 'marker'] as const;

/** How `renderRange` draws a value's position in its band. */
export type RangeStyle = typeof RANGE_STYLES[number];

const RANGE_INNER_WIDTH = 10;
const RANGE_LEFT_BORDER = '\u{2595}';  // ▕ right one eighth block, used as the left cap
const RANGE_RIGHT_BORDER = '\u{258F}'; // ▏ left one eighth block, used as the right cap
const RANGE_MARKER = '\u{25CF}';       // ●

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
export function renderRange(value: number, min: number, max: number, style: RangeStyle): string {
  if (!(min < max)) {
    throw new RangeError(`renderRange: min must be less than max; got min=${String(min)}, max=${String(max)}`);
  }
  if (Number.isNaN(value) || value < min || value > max) {
    throw new RangeError(`renderRange: value must be within [${String(min)}, ${String(max)}]; got ${String(value)}`);
  }
  if (!isMember(RANGE_STYLES, style)) {
    throw new RangeError(`renderRange: style must be one of ${describeVocabulary(RANGE_STYLES)}; received ${JSON.stringify(style)}`);
  }

  const fraction = (value - min) / (max - min);

  if (style === 'fill') {
    const filled = Math.min(RANGE_INNER_WIDTH, Math.max(0, Math.round(fraction * RANGE_INNER_WIDTH)));
    const inner = at(SHADES, 2).repeat(filled) + at(SHADES, 0).repeat(RANGE_INNER_WIDTH - filled);
    return RANGE_LEFT_BORDER + inner + RANGE_RIGHT_BORDER;
  }

  const position = Math.min(RANGE_INNER_WIDTH - 1, Math.max(0, Math.round(fraction * (RANGE_INNER_WIDTH - 1))));
  const cells: string[] = new Array<string>(RANGE_INNER_WIDTH).fill(at(SHADES, 0));
  cells[position] = RANGE_MARKER;
  return RANGE_LEFT_BORDER + cells.join('') + RANGE_RIGHT_BORDER;
}

/** The five summary statistics `renderBoxWhisker` draws as a one-line distribution. */
export interface BoxWhiskerStats {
  min    : number;
  q1     : number;
  median : number;
  q3     : number;
  max    : number;
}

const BOX_WHISKER_END_LEFT  = '\u{251C}'; // ├
const BOX_WHISKER_END_RIGHT = '\u{2524}'; // ┤
const BOX_WHISKER_FILL      = '\u{2500}'; // ─ whisker line
const BOX_WALL_LEFT         = '\u{2528}'; // ┨ left wall of the interquartile box
const BOX_WALL_RIGHT        = '\u{2520}'; // ┠ right wall of the interquartile box

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
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export function renderBoxWhisker(stats: BoxWhiskerStats, width: number = 16): string {
  const { min, q1, median, q3, max } = stats;

  for (const [name, v] of Object.entries(stats)) {
    if (!Number.isFinite(v)) {
      throw new RangeError(`renderBoxWhisker: ${name} must be a finite number; got ${String(v)}`);
    }
  }
  if (!(min <= q1 && q1 <= median && median <= q3 && q3 <= max)) {
    throw new RangeError(
      `renderBoxWhisker: stats must satisfy min <= q1 <= median <= q3 <= max; got ` +
      `min=${String(min)}, q1=${String(q1)}, median=${String(median)}, q3=${String(q3)}, max=${String(max)}`
    );
  }
  if (!Number.isInteger(width) || width < 2) {
    throw new RangeError(`renderBoxWhisker: width must be an integer >= 2; got ${String(width)}`);
  }

  const span = max - min;
  const fraction = (v: number): number => (span === 0 ? 0 : (v - min) / span);
  const position = (v: number): number => Math.round(fraction(v) * (width - 1));

  const posMin    = position(min);
  const posQ1     = position(q1);
  const posMedian = position(median);
  const posQ3     = position(q3);
  const posMax    = position(max);

  const cells: string[] = new Array<string>(width).fill(BOX_WHISKER_FILL);
  for (let i = posQ1 + 1; i < posMedian; i++) { cells[i] = at(SHADES, 2); }
  for (let i = posMedian + 1; i < posQ3; i++) { cells[i] = at(SHADES, 2); }

  // Assignment order doubles as precedence: each later write wins a coincident cell.
  // Box walls first, then the median (beats the walls), then the right whisker end,
  // then the left whisker end last — so `min` deliberately wins over `max` in the
  // fully degenerate `min === max` case, per the DocBlock above.
  cells[posQ1] = BOX_WALL_LEFT;
  cells[posQ3] = BOX_WALL_RIGHT;
  cells[posMedian] = DIVERGING_CENTER;
  cells[posMax] = BOX_WHISKER_END_RIGHT;
  cells[posMin] = BOX_WHISKER_END_LEFT;

  return cells.join('');
}
