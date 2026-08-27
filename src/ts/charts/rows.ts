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

import { SHADES, absoluteIndex, relativeIndex } from './scale.js';
import { isMember, describeVocabulary } from '../channels/vocabulary.js';

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

/** The two geometries {@link renderComparison} can draw a row's value as. */
const COMPARISON_FORMS: readonly string[] = ['bar', 'dot'];

/**
 * `█` — {@link renderComparison}'s bar-fill glyph; the darkest of `SHADES`. Kept as its
 * own literal rather than `SHADES[3]`: `renderComparison`'s fill count is a plain
 * round-to-nearest-cell (`Math.round(value / sharedMax * width)`), not a `SHADES`-ramp
 * index computed via `absoluteIndex`/`relativeIndex`, so there is no shared arithmetic
 * here to reuse — only the character happens to coincide with `SHADES`'s last entry.
 */
const FILL_GLYPH = '\u{2588}';

/**
 * `░` — the empty/pad glyph both `renderComparison` track forms share; the lightest of
 * `SHADES`, kept independent for the same reason as {@link FILL_GLYPH}.
 */
const PAD_GLYPH = '\u{2591}';

/** `●` — the marker {@link renderComparison}'s `'dot'` form places on its `░` track. */
const DOT_GLYPH = '\u{25CF}';

/**
 * The single scale every row in a comparison chart is drawn against: the highest of
 * each row's own `max` (or, absent that, its own `value`) — "the row maximum" per
 * `visuals.md`. Rows share this one ceiling so their bars stay visually comparable; a
 * row supplying its own smaller `max` only asserts what its own value cannot exceed,
 * not a scale the rest of the chart adopts.
 */
function sharedMaxOf(rows: readonly ComparisonRow[]): number {
  return Math.max(...rows.map(row => row.max ?? row.value));
}

/** Renders a `width`-cell `●`-on-`░` Cleveland dot track for a fill of `fillCells`. */
function dotTrack(fillCells: number, width: number): string {
  const dotIndex = Math.min(Math.max(fillCells, 0), width - 1);
  return Array.from({ length: width }, (_, i) => (i === dotIndex ? DOT_GLYPH : PAD_GLYPH)).join('');
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
export function renderComparison(
  rows: readonly ComparisonRow[],
  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  width: number = 20,
  form: 'bar' | 'dot' = 'bar',
): string {
  if (rows.length === 0) {
    throw new RangeError('renderComparison needs at least one row');
  }
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`renderComparison: width must be a positive integer; got ${String(width)}`);
  }
  if (!isMember(COMPARISON_FORMS, form)) {
    throw new RangeError(
      `renderComparison: form must be one of ${describeVocabulary(COMPARISON_FORMS)}; received ${JSON.stringify(form)}`
    );
  }
  for (const row of rows) {
    if (!Number.isFinite(row.value) || row.value < 0) {
      throw new RangeError(
        `renderComparison: '${row.label}' value must be a non-negative number; got ${String(row.value)}`
      );
    }
    if (row.max !== undefined && row.value > row.max) {
      throw new RangeError(
        `renderComparison: '${row.label}' value ${String(row.value)} exceeds its own max ${String(row.max)}`
      );
    }
  }

  const sharedMax = sharedMaxOf(rows);
  if (sharedMax <= 0) {
    throw new RangeError('renderComparison: the shared max must be greater than zero');
  }

  const labelWidth = Math.max(...rows.map(row => row.label.length)) + 2;

  return rows.map(row => {
    const fillCells = Math.round((row.value / sharedMax) * width);
    const track = form === 'bar'
      ? FILL_GLYPH.repeat(fillCells) + PAD_GLYPH.repeat(width - fillCells)
      : dotTrack(fillCells, width);
    const valueText = sharedMax === 100 ? `${String(row.value)}%` : String(row.value);
    return `${row.label.padEnd(labelWidth)}${track}  ${valueText}`;
  }).join('\n');
}

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

/** The closed vocabulary {@link TileFill} draws from. */
const TILE_FILLS: readonly string[] = ['abbr-shade', 'custom', 'color-keyed', 'pixel'];

/** `low ░ ▒ ▓ █ high` — the legend line `'abbr-shade'` appends. */
const SHADE_LEGEND = `low ${SHADES.join(' ')} high`;

/** `⬛` — {@link renderTileGrid}'s null-cell glyph for the `'pixel'` fill only. */
const PIXEL_GAP = '\u{2B1B}';

/** How many buckets {@link renderTileGrid}'s `'color-keyed'`/`'pixel'` fills quintile a value into. */
const QUINTILE_STEPS = 5;

/**
 * The colored-square glyph for `relativeIndex(value, min, max, QUINTILE_STEPS)`,
 * lowest to highest: 🟥 🟧 🟨 🟩 🟦. Written as a literal-index switch, in the pattern of
 * `scale.ts`'s `boundaryGlyph`, so the result is a definite `string` rather than the
 * possibly-`undefined` type a computed array index would carry under
 * `noUncheckedIndexedAccess`.
 */
function quintileGlyph(value: number, min: number, max: number): string {
  switch (relativeIndex(value, min, max, QUINTILE_STEPS)) {
    case 0:  return '\u{1F7E5}'; // 🟥
    case 1:  return '\u{1F7E7}'; // 🟧
    case 2:  return '\u{1F7E8}'; // 🟨
    case 3:  return '\u{1F7E9}'; // 🟩
    default: return '\u{1F7E6}'; // 🟦
  }
}

/**
 * Renders one grid cell (or gap, for `null`) under `fill`, given the grid-wide `min`
 * and `max` value that `'color-keyed'`/`'pixel'` quintiles need. `row`/`col` name the
 * cell in a thrown error message only.
 *
 * A `null` cell is a gap: empty string for every fill except `'pixel'`, which renders
 * `⬛` instead so its unlabeled raster stays a complete grid rather than developing
 * holes.
 */
function renderTileCell(
  cell: TileCell | null,
  fill: TileFill,
  min: number,
  max: number,
  row: number,
  col: number,
): string {
  if (cell === null) {
    return fill === 'pixel' ? PIXEL_GAP : '';
  }

  switch (fill) {
    case 'abbr-shade': {
      if (cell.label === undefined || cell.value === undefined) {
        const missing = cell.label === undefined ? 'label' : 'value';
        throw new RangeError(
          `renderTileGrid: 'abbr-shade' cells need both a label and a value; `
          + `row ${String(row)} col ${String(col)} is missing ${missing}`
        );
      }
      // Stay inside a join (never a template literal) over the computed SHADES index,
      // per the same reasoning as series.ts's `ramp[absoluteIndex(value, steps)]`
      // inside a `.map(...).join('')`: the indexed element is possibly-`undefined`
      // under `noUncheckedIndexedAccess` (SHADES is exported as the widened
      // `readonly string[]`, not a tuple), but `.join('')` accepts that without
      // requiring a non-undefined `string`, so SHADES stays the single source of the
      // glyphs rather than being restated here.
      return [cell.label, SHADES[absoluteIndex(cell.value, SHADES.length)]].join('');
    }
    case 'custom': {
      if (cell.glyph === undefined) {
        throw new RangeError(
          `renderTileGrid: 'custom' cells need a glyph; row ${String(row)} col ${String(col)} is missing glyph`
        );
      }
      return cell.glyph;
    }
    case 'color-keyed':
    case 'pixel': {
      if (cell.value === undefined) {
        throw new RangeError(
          `renderTileGrid: '${fill}' cells need a value; row ${String(row)} col ${String(col)} is missing value`
        );
      }
      return quintileGlyph(cell.value, min, max);
    }
  }
}

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
export function renderTileGrid(rows: readonly (TileCell | null)[][], fill: TileFill): string {
  if (rows.length === 0) {
    throw new RangeError('renderTileGrid needs at least one row');
  }
  if (!isMember(TILE_FILLS, fill)) {
    throw new RangeError(
      `renderTileGrid: fill must be one of ${describeVocabulary(TILE_FILLS)}; received ${JSON.stringify(fill)}`
    );
  }

  const values = rows
    .flat()
    .filter((cell): cell is TileCell & { value: number } => cell?.value !== undefined)
    .map(cell => cell.value);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;

  const grid = rows
    .map((line, r) => line.map((cell, c) => renderTileCell(cell, fill, min, max, r, c)).join(' '))
    .join('\n');

  return fill === 'abbr-shade' ? `${grid}\n\n${SHADE_LEGEND}` : grid;
}
