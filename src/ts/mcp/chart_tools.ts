/**
 * The MCP chart-rendering tool surface: six tools, grouped by data shape, wrapping the
 * pure renderers in `../charts/index.js`.
 *
 * Each tool takes a `form` field naming which of its renderers to use — a closed
 * `z.enum` built from a local `const` array via {@link tuple}, so a misspelled form is
 * unrepresentable rather than a runtime surprise (`render_checklist_summary` is the one
 * exception: it wraps exactly one renderer, so it has no `form` field at all). Because a
 * grouped tool's per-form fields cannot all be schema-required at once — a `render_bar`
 * call needs `percent` for `'progress'` but `value`/`target`/`max` for `'bullet'` — every
 * per-form field is optional in the schema and checked at dispatch instead; a violation
 * is reported as `error: <tool> form '<form>' is missing <field(s)>; requires <the
 * form's full requirement>` rather than a schema rejection, so the message stays
 * specific to the form actually chosen. A renderer's own `RangeError` (an out-of-domain
 * value, not a missing field) is caught the same way and returned as `error: <message>`
 * — never a protocol fault, matching `configure`'s existing error style in `tools.ts`.
 *
 * Handler bodies are exported as pure functions (`handleRenderX(store, args)`) separate
 * from registration, so they can be exercised directly in tests without a transport —
 * there is no in-process MCP call pattern elsewhere in this codebase to follow instead.
 *
 * @see ../charts/index.js
 * @see ./tools.js
 * @see ../channels/entries.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import {
  renderSparkline, renderBraille, renderWinLoss,
  renderProgressBar, renderBullet, renderDiverging, renderStacked, renderRange, renderBoxWhisker,
  renderComparison, renderTileGrid,
  renderTimelineRail, renderTimelineColored, renderDependencyChain, renderFsl,
  renderTrendTag, renderStars, renderRetryHealth, renderWeather,
  TREND_DIRECTIONS, WEATHER_STATES,
  renderChecklistSummary,
} from '../charts/index.js';
import type {
  ComparisonRow, TileCell, FslTransition, ChecklistItem, Milestone,
  Outcome, RangeStyle, TileFill, TrendDirection, WeatherState, Bucket,
} from '../charts/index.js';
import { seriesPercents } from '../channels/entries.js';
import type { Store } from '../channels/store.js';

/**
 * A non-empty tuple, which is what `z.enum` requires, preserving the literal types.
 *
 * Copied from `tools.ts` rather than imported — that copy is file-private there, and
 * the house pattern is to keep this tiny helper local to whichever file needs it.
 *
 * @throws {Error} If `values` is empty, which would mean a tool with an unsatisfiable
 *                 argument.
 */
function tuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) { throw new Error('vocabulary must not be empty'); }
  return [first, ...rest];
}

/**
 * Compile-time exact type equality — deliberately stricter than mutual `extends`.
 *
 * A hand-written `*Args` interface (see {@link SeriesArgs} and its five siblings) is
 * kept honest against its `*_SHAPE` zod object by a per-pair assertion built from this
 * type, immediately below each `*Args` declaration. Plain bidirectional `extends` is
 * NOT sufficient for that job: TypeScript's structural assignability treats "the target
 * declares an optional field, the source lacks the key entirely" as a match in both
 * directions, so a naive `A extends B ? (B extends A ? true : never) : never` would
 * silently accept an `*Args` interface that is missing (or has renamed) an optional
 * field the real schema carries — exactly the drift `registerChartTools`'s call-site
 * check cannot catch either, since the SDK hands each callback a contextually-typed
 * parameter, and structural assignability into a function parameter permits both
 * excess properties on the source and absent-but-optional properties on the target.
 * This type instead wraps each side in a generic function-return position before
 * comparing — the standard trick (used by test-type libraries like `tsd`/`expect-type`)
 * for forcing TypeScript to compare two types invariantly, which does distinguish
 * `{ f?: T }` from `{}` and catches a renamed, added, or removed optional key.
 *
 * `A` and `B` each appear exactly once in the body by necessity — that is the whole
 * shape of this comparison, not a sign either could be inlined away — so
 * `no-unnecessary-type-parameters` is disabled for this one declaration.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- A and B each referenced exactly once is the point of this comparison
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Fails to compile unless `T` is exactly `true`; otherwise returns what it was given.
 * Called once per `*Args`/`*_SHAPE` pair, e.g. `expectType<Equal<SeriesArgs,
 * z.infer<z.ZodObject<typeof SERIES_SHAPE>>>>(true)` — a real call rather than a bare
 * `type` alias, specifically so the assertion counts as "used" under this project's
 * `noUnusedLocals` without needing to export purely-internal type-testing plumbing.
 */
function expectType<T extends true>(value: T): T { return value; }

/**
 * The shape of an MCP tool result's text content — every chart tool's return type.
 *
 * Carries `[x: string]: unknown` alongside `content` because the SDK's own
 * `CallToolResult` type does, for forward-compatible protocol fields (`_meta` and
 * friends) this layer never sets; without it, an `interface` here — unlike a `type`
 * alias — does not structurally satisfy `CallToolResult` when a handler's return value
 * flows into `registerTool`'s callback.
 */
export interface ToolReply {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
}

/** Wraps a value as the text content an MCP tool result carries. Copied from `tools.ts`. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/**
 * Runs `fn`, catching a thrown `RangeError` and returning its message as `error: `
 * tool text instead of letting it escape as a protocol fault — the shared shape of
 * every chart tool's error handling (`design.md` § Errors).
 *
 * @throws unchanged, anything `fn` throws that is not a `RangeError` — a renderer
 *   precondition violation is the only failure mode this layer expects.
 */
function guarded(fn: () => ToolReply): ToolReply {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RangeError) { return reply(`error: ${err.message}`); }
    throw err;
  }
}

/**
 * Re-shapes one `render_rows` `'comparison'` row from zod's optional-as-`T | undefined`
 * output into `ComparisonRow`'s optional-as-absent-key shape.
 *
 * Exists because `exactOptionalPropertyTypes` treats `max?: number` (the renderer's own
 * declared shape) as strictly forbidding the literal value `undefined` — only an
 * altogether absent key satisfies "optional" — while zod's `.optional()` output always
 * carries the key with a possibly-`undefined` value. Every optional field a grouped
 * tool passes through to a renderer needs this same conversion; this one and its three
 * siblings below (for a tile cell, an FSL transition, and a checklist item) exist
 * because each renderer input shape has a different set of optional fields to drop.
 */
function toComparisonRow(row: { label: string; value: number; max?: number | undefined }): ComparisonRow {
  return row.max === undefined ? { label: row.label, value: row.value } : { label: row.label, value: row.value, max: row.max };
}

/** See {@link toComparisonRow}: the same conversion for one `render_rows` `'tilegrid'` cell. */
function toTileCell(
  cell: { label?: string | undefined; value?: number | undefined; glyph?: string | undefined } | null,
): TileCell | null {
  if (cell === null) { return null; }
  return {
    ...(cell.label !== undefined ? { label: cell.label } : {}),
    ...(cell.value !== undefined ? { value: cell.value } : {}),
    ...(cell.glyph !== undefined ? { glyph: cell.glyph } : {}),
  };
}

/** See {@link toComparisonRow}: the same conversion for one `render_timeline` `'fsl'` transition. */
function toFslTransition(t: { from: string; to: string; action?: string | undefined }): FslTransition {
  return t.action === undefined ? { from: t.from, to: t.to } : { from: t.from, to: t.to, action: t.action };
}

/** See {@link toComparisonRow}: the same conversion for one `render_checklist_summary` item. */
function toChecklistItem(
  item: { marker: string; bucket?: 'success' | 'active' | 'failure' | undefined },
): ChecklistItem {
  return item.bucket === undefined ? { marker: item.marker } : { marker: item.marker, bucket: item.bucket };
}

// ---------------------------------------------------------------------------------
// render_series — sparkline | braille | winloss
// ---------------------------------------------------------------------------------

/** The forms {@link handleRenderSeries} accepts. */
export const SERIES_FORMS = ['sparkline', 'braille', 'winloss'] as const;

/**
 * The run-outcome vocabulary `render_series`'s `'winloss'` form accepts, mirroring
 * `series.ts`'s `Outcome` union. Kept as its own literal tuple, rather than built from
 * `series.ts`'s exported `OUTCOMES`, because `OUTCOMES` is typed the widened
 * `readonly string[]` (so every caller gets a plain string, not the narrow union) and
 * `z.enum` needs a literal tuple to infer anything narrower.
 */
const WINLOSS_OUTCOMES = ['pass', 'flaky', 'fail', 'underway', 'queued', 'skipped'] as const;

/** The two arithmetic modes `render_series`'s `'sparkline'`/`'braille'` forms accept. */
const SERIES_SCALES = ['absolute', 'relative'] as const;

/** The raw zod shape backing `render_series`'s `inputSchema`. */
const SERIES_SHAPE = {
  form: z.enum(tuple(SERIES_FORMS)).describe(
    "which series form to render: 'sparkline' (8-step block-ramp trend line), 'braille' " +
    "(denser 6-step braille trend line), or 'winloss' (categorical run-outcome strip, " +
    'one glyph per outcome)'),
  data: z.array(z.number()).optional().describe(
    "'sparkline'/'braille' forms: the numeric data points, chronological order, at " +
    "least 4 (fewer reads as noise — see renderSparkline's precondition); omit when " +
    "supplying 'seriesKey' instead"),
  outcomes: z.array(z.enum(tuple(WINLOSS_OUTCOMES))).optional().describe(
    "'winloss' form only, required: the run outcomes, chronological order, each one of " +
    WINLOSS_OUTCOMES.join('|')),
  scale: z.enum(tuple(SERIES_SCALES)).optional().describe(
    "'sparkline'/'braille' forms only, optional: 'absolute' (default; fixed 0-100 " +
    "domain, comparable across every series) or 'relative' (normalized to this series' " +
    "own min-max). Ignored — always 'absolute' — when 'seriesKey' is supplied instead " +
    "of 'data'."),
  seriesKey: z.string().optional().describe(
    "'sparkline'/'braille' forms only, alternative to 'data': a series key previously " +
    'recorded via the express tool; resolves to that series’ stored percent ' +
    "history (seriesPercents) and always renders on the absolute scale"),
};

/**
 * What a caller supplies to `render_series`, after schema validation.
 *
 * Hand-written rather than `z.infer`-derived from {@link SERIES_SHAPE}: this project's
 * `isolatedDeclarations` setting requires every exported declaration's type to be
 * statically written out, and a `typeof SERIES_SHAPE` inference chain through zod's
 * generic builder methods cannot satisfy that on its own. `registerChartTools`'s call
 * to `handleRenderSeries` is where the two stay honest — passing the SDK's
 * schema-inferred argument object to a parameter typed `SeriesArgs` fails to compile if
 * this drifts from {@link SERIES_SHAPE}.
 */
export interface SeriesArgs {
  form: 'sparkline' | 'braille' | 'winloss';
  data?: number[] | undefined;
  outcomes?: Outcome[] | undefined;
  scale?: 'absolute' | 'relative' | undefined;
  seriesKey?: string | undefined;
}

// Fails to compile if SeriesArgs drifts from SERIES_SHAPE — see expectType's docblock.
expectType<Equal<SeriesArgs, z.infer<z.ZodObject<typeof SERIES_SHAPE>>>>(true);

/**
 * Handles `render_series`: a trend sparkline, a braille microplot, or a win/loss strip.
 *
 * @param store the store `seriesKey` is resolved against
 * @param args   the validated tool arguments
 *
 * @example
 *   handleRenderSeries(store, { form: 'sparkline', data: [0, 12.5, 25, 100] })
 *   // => { content: [{ type: 'text', text: '▁▂▃█' }] }
 */
export function handleRenderSeries(store: Store, args: SeriesArgs): ToolReply {
  return guarded(() => {

    if (args.form === 'winloss') {
      if (args.outcomes === undefined) {
        return reply(
          "error: render_series form 'winloss' is missing 'outcomes'; requires " +
          `'outcomes' (string[], each one of ${WINLOSS_OUTCOMES.join('|')})`
        );
      }
      return reply(renderWinLoss(args.outcomes));
    }

    const seriesKey = args.seriesKey;
    const data = args.data;

    if (seriesKey !== undefined) {
      const points = seriesPercents(store, seriesKey);
      return reply(args.form === 'sparkline' ? renderSparkline(points, 'absolute') : renderBraille(points, 'absolute'));
    }

    if (data !== undefined) {
      const scale = args.scale ?? 'absolute';
      return reply(args.form === 'sparkline' ? renderSparkline(data, scale) : renderBraille(data, scale));
    }

    return reply(
      `error: render_series form '${args.form}' is missing 'data' or 'seriesKey'; ` +
      "requires 'data' (number[], at least 4 points) or 'seriesKey' (string, resolved " +
      "via seriesPercents); 'scale' optional, defaults to 'absolute'"
    );

  });
}

// ---------------------------------------------------------------------------------
// render_bar — progress | bullet | diverging | stacked | range | boxwhisker
// ---------------------------------------------------------------------------------

/** The forms {@link handleRenderBar} accepts. */
export const BAR_FORMS = ['progress', 'bullet', 'diverging', 'stacked', 'range', 'boxwhisker'] as const;

/** The two draw styles `render_bar`'s `'range'` form accepts, mirroring `bars.ts`'s `RangeStyle`. */
const BAR_RANGE_STYLES = ['fill', 'marker'] as const;

/** The raw zod shape backing `render_bar`'s `inputSchema`. */
const BAR_SHAPE = {
  form: z.enum(tuple(BAR_FORMS)).describe(
    "which bar form to render: 'progress' (plain fixed-width completion bar), 'bullet' " +
    "(progress bar with a target tick), 'diverging' (grows left or right from a " +
    "centered baseline), 'stacked' (segmented success/active/failure bar), 'range' " +
    "(a value's position between a min and a max), or 'boxwhisker' (a five-number " +
    'distribution summary)'),
  percent: z.number().optional().describe(
    "'progress' form only, required: completion percentage, within [0, 100]"),
  value: z.number().optional().describe(
    "'bullet'/'diverging'/'range' forms, required: the current value being plotted — " +
    "within [0, max] for 'bullet', [-maxAbs, maxAbs] for 'diverging', [min, max] for " +
    "'range'"),
  target: z.number().optional().describe(
    "'bullet' form only, required: the goal value the tick marks, within [0, max]"),
  max: z.number().optional().describe(
    "'bullet' form, required: the value the bar represents as fully filled, > 0. " +
    "'range' form, required: the band's upper bound, must exceed 'min'. 'boxwhisker' " +
    "form, required: the maximum of the five-number summary, must be >= q3."),
  cells: z.number().int().optional().describe(
    "'bullet' form only, optional, defaults to 10: total bar width in characters"),
  maxAbs: z.number().optional().describe(
    "'diverging' form only, required: the magnitude at which a side is entirely full, > 0"),
  cellsPerSide: z.number().int().optional().describe(
    "'diverging' form only, optional, defaults to 6: cells on each side of the center; " +
    'the rendered width is always 2 * cellsPerSide + 1'),
  success: z.number().optional().describe(
    "'stacked' form only, required: count of completed items, a non-negative number"),
  activePending: z.number().optional().describe(
    "'stacked' form only, required: count of running, pending, or otherwise unresolved " +
    'items, a non-negative number'),
  failure: z.number().optional().describe(
    "'stacked' form only, required: count of failed items, a non-negative number"),
  width: z.number().int().optional().describe(
    "'stacked' form only, optional, defaults to 16: total bar width in characters, at " +
    "least the number of nonzero buckets. 'boxwhisker' form only, optional, defaults " +
    'to 16: total width in characters, an integer >= 2.'),
  min: z.number().optional().describe(
    "'range' form only, required: the band's lower bound, must be less than 'max'. " +
    "'boxwhisker' form only, required: the minimum of the five-number summary."),
  style: z.enum(tuple(BAR_RANGE_STYLES)).optional().describe(
    "'range' form only, required: 'fill' shades cells up to the value's position, " +
    "'marker' places a single ● at the value's position instead"),
  q1: z.number().optional().describe(
    "'boxwhisker' form only, required: the first quartile, must satisfy min <= q1 <= median"),
  median: z.number().optional().describe(
    "'boxwhisker' form only, required: the median, must satisfy q1 <= median <= q3"),
  q3: z.number().optional().describe(
    "'boxwhisker' form only, required: the third quartile, must satisfy median <= q3 <= max"),
};

/**
 * What a caller supplies to `render_bar`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link SeriesArgs}; kept
 * honest against {@link BAR_SHAPE} the same way, at the `handleRenderBar` call site.
 */
export interface BarArgs {
  form: 'progress' | 'bullet' | 'diverging' | 'stacked' | 'range' | 'boxwhisker';
  percent?: number | undefined;
  value?: number | undefined;
  target?: number | undefined;
  max?: number | undefined;
  cells?: number | undefined;
  maxAbs?: number | undefined;
  cellsPerSide?: number | undefined;
  success?: number | undefined;
  activePending?: number | undefined;
  failure?: number | undefined;
  width?: number | undefined;
  min?: number | undefined;
  style?: RangeStyle | undefined;
  q1?: number | undefined;
  median?: number | undefined;
  q3?: number | undefined;
}

// Fails to compile if BarArgs drifts from BAR_SHAPE — see expectType's docblock.
expectType<Equal<BarArgs, z.infer<z.ZodObject<typeof BAR_SHAPE>>>>(true);

/**
 * Handles `render_bar`: a single value, or a small stat set, as a fixed-width bar.
 *
 * @param args the validated tool arguments; `store` is unused by every `render_bar`
 *             form, but the parameter is kept for a uniform handler signature across
 *             all six chart tools
 *
 * @example
 *   handleRenderBar(store, { form: 'progress', percent: 32 })
 *   // => { content: [{ type: 'text', text: '███▓░░░░░░' }] }
 */
export function handleRenderBar(_store: Store, args: BarArgs): ToolReply {
  return guarded(() => {

    switch (args.form) {

      case 'progress': {
        const { percent } = args;
        if (percent === undefined) {
          return reply(
            "error: render_bar form 'progress' is missing 'percent'; requires " +
            "'percent' (number, within [0, 100])"
          );
        }
        return reply(renderProgressBar(percent));
      }

      case 'bullet': {
        const { value, target, max, cells } = args;
        if (value === undefined || target === undefined || max === undefined) {
          return reply(
            "error: render_bar form 'bullet' is missing 'value', 'target', and/or " +
            "'max'; requires 'value', 'target', 'max' (numbers; max > 0, value and " +
            "target within [0, max]); 'cells' optional, defaults to 10"
          );
        }
        return reply(renderBullet(value, target, max, cells));
      }

      case 'diverging': {
        const { value, maxAbs, cellsPerSide } = args;
        if (value === undefined || maxAbs === undefined) {
          return reply(
            "error: render_bar form 'diverging' is missing 'value' and/or 'maxAbs'; " +
            "requires 'value' (within [-maxAbs, maxAbs]) and 'maxAbs' (number > 0); " +
            "'cellsPerSide' optional, defaults to 6"
          );
        }
        return reply(renderDiverging(value, maxAbs, cellsPerSide));
      }

      case 'stacked': {
        const { success, activePending, failure, width } = args;
        if (success === undefined || activePending === undefined || failure === undefined) {
          return reply(
            "error: render_bar form 'stacked' is missing 'success', 'activePending', " +
            "and/or 'failure'; requires all three (non-negative numbers summing to " +
            "more than 0); 'width' optional, defaults to 16"
          );
        }
        return reply(renderStacked(success, activePending, failure, width));
      }

      case 'range': {
        const { value, min, max, style } = args;
        if (value === undefined || min === undefined || max === undefined || style === undefined) {
          return reply(
            "error: render_bar form 'range' is missing 'value', 'min', 'max', and/or " +
            "'style'; requires 'value', 'min', 'max' (numbers; min < max, value within " +
            "[min, max]) and 'style' ('fill' or 'marker')"
          );
        }
        return reply(renderRange(value, min, max, style));
      }

      case 'boxwhisker': {
        const { min, q1, median, q3, max, width } = args;
        if (min === undefined || q1 === undefined || median === undefined || q3 === undefined || max === undefined) {
          return reply(
            "error: render_bar form 'boxwhisker' is missing one or more of 'min', " +
            "'q1', 'median', 'q3', 'max'; requires all five (numbers satisfying min " +
            "<= q1 <= median <= q3 <= max); 'width' optional, defaults to 16"
          );
        }
        return reply(renderBoxWhisker({ min, q1, median, q3, max }, width));
      }

    }

  });
}

// ---------------------------------------------------------------------------------
// render_rows — comparison | tilegrid
// ---------------------------------------------------------------------------------

/** The forms {@link handleRenderRows} accepts. */
export const ROWS_FORMS = ['comparison', 'tilegrid'] as const;

/** The two track geometries `render_rows`'s `'comparison'` form accepts. */
const ROWS_COMPARISON_STYLES = ['bar', 'dot'] as const;

/** The four cell-fill strategies `render_rows`'s `'tilegrid'` form accepts. */
const ROWS_TILE_FILLS = ['abbr-shade', 'custom', 'color-keyed', 'pixel'] as const;

/** The raw zod shape backing `render_rows`'s `inputSchema`. */
const ROWS_SHAPE = {
  form: z.enum(tuple(ROWS_FORMS)).describe(
    "which rows form to render: 'comparison' (one labeled bar or dot per row, all " +
    "sharing one scale) or 'tilegrid' (a fixed-column grid, one cell per region)"),
  rows: z.array(z.object({
    label: z.string().describe("the row's short name, drawn left of its bar or track"),
    value: z.number().describe(
      "the row's value; non-negative, and no greater than this row's own 'max' when given"),
    max: z.number().optional().describe(
      "this row's own ceiling, when it differs from the chart's shared scale; absent, " +
      "it defaults to this row's own 'value' for computing the shared scale"),
  })).optional().describe(
    "'comparison' form only, required: the rows to compare, at least one"),
  width: z.number().int().optional().describe(
    "'comparison' form only, optional, defaults to 20: the bar/track width in characters"),
  style: z.enum(tuple(ROWS_COMPARISON_STYLES)).optional().describe(
    "'comparison' form only, optional, defaults to 'bar': 'bar' draws full fill cells, " +
    "'dot' draws a single ● marker on a ░ track at the same fill position"),
  grid: z.array(z.array(z.object({
    label: z.string().optional().describe("used only by the 'abbr-shade' fill"),
    value: z.number().optional().describe(
      "used by the 'abbr-shade', 'color-keyed', and 'pixel' fills"),
    glyph: z.string().optional().describe("used only by the 'custom' fill"),
  }).nullable())).optional().describe(
    "'tilegrid' form only, required: the grid, outer array top to bottom, inner array " +
    "left to right, at least one row; a null cell is a gap outside the mapped territory"),
  fill: z.enum(tuple(ROWS_TILE_FILLS)).optional().describe(
    "'tilegrid' form only, required: 'abbr-shade' (each cell's label plus a shade " +
    "glyph for its value, with a legend), 'custom' (each cell's literal glyph), " +
    "'color-keyed' (a colored square by value quintile), or 'pixel' (the same colors, " +
    "with null cells rendered as a gap glyph instead of a blank)"),
};

/**
 * What a caller supplies to `render_rows`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link SeriesArgs}; kept
 * honest against {@link ROWS_SHAPE} the same way, at the `handleRenderRows` call site.
 * `rows`' and `grid`'s cell shapes intentionally keep zod's permissive `T | undefined`
 * optionals rather than the renderer's stricter absent-key-only `ComparisonRow`/
 * `TileCell` — {@link toComparisonRow}/{@link toTileCell} bridge the two at the point of
 * calling the renderer.
 */
export interface RowsArgs {
  form: 'comparison' | 'tilegrid';
  rows?: { label: string; value: number; max?: number | undefined }[] | undefined;
  width?: number | undefined;
  style?: 'bar' | 'dot' | undefined;
  grid?: ({ label?: string | undefined; value?: number | undefined; glyph?: string | undefined } | null)[][] | undefined;
  fill?: TileFill | undefined;
}

// Fails to compile if RowsArgs drifts from ROWS_SHAPE — see expectType's docblock.
expectType<Equal<RowsArgs, z.infer<z.ZodObject<typeof ROWS_SHAPE>>>>(true);

/**
 * Handles `render_rows`: several values compared side by side, as bars/dots or a
 * tile-grid map.
 *
 * @param args the validated tool arguments; `store` is unused by every `render_rows`
 *             form, but the parameter is kept for a uniform handler signature
 *
 * @example
 *   handleRenderRows(store, {
 *     form: 'comparison',
 *     rows: [{ label: 'x', value: 50, max: 100 }],
 *   })
 *   // => { content: [{ type: 'text', text: 'x  ██████████░░░░░░░░░░  50%' }] }
 */
export function handleRenderRows(_store: Store, args: RowsArgs): ToolReply {
  return guarded(() => {

    switch (args.form) {

      case 'comparison': {
        const { rows, width, style } = args;
        if (rows === undefined || rows.length === 0) {
          return reply(
            "error: render_rows form 'comparison' is missing 'rows'; requires 'rows' " +
            "(non-empty array of {label, value, max?}); 'width' optional (default 20), " +
            "'style' optional ('bar' default or 'dot')"
          );
        }
        return reply(renderComparison(rows.map(toComparisonRow), width, style));
      }

      case 'tilegrid': {
        const { grid, fill } = args;
        if (grid === undefined || grid.length === 0 || fill === undefined) {
          return reply(
            "error: render_rows form 'tilegrid' is missing 'grid' and/or 'fill'; " +
            "requires 'grid' (non-empty 2D array of {label?, value?, glyph?} or null) " +
            "and 'fill' ('abbr-shade'|'custom'|'color-keyed'|'pixel')"
          );
        }
        return reply(renderTileGrid(grid.map(line => line.map(toTileCell)), fill));
      }

    }

  });
}

// ---------------------------------------------------------------------------------
// render_timeline — rail | colored | dependency | fsl
// ---------------------------------------------------------------------------------

/** The forms {@link handleRenderTimeline} accepts. */
export const TIMELINE_FORMS = ['rail', 'colored', 'dependency', 'fsl'] as const;

/** The states a timeline milestone can be in, mirroring `timeline.ts`'s `MilestoneState`. */
const TIMELINE_MILESTONE_STATES = ['reached', 'current', 'future', 'failed'] as const;

/** The raw zod shape backing `render_timeline`'s `inputSchema`. */
const TIMELINE_SHAPE = {
  form: z.enum(tuple(TIMELINE_FORMS)).describe(
    "which timeline form to render: 'rail' (two-line centered monochrome rail; no " +
    "'failed' glyph), 'colored' (one-line colored pips, including 'failed'), " +
    "'dependency' (an inline pipeline with the current step underlined), or 'fsl' " +
    '(a one-line FSL-style state-machine description)'),
  milestones: z.array(z.object({
    label: z.string().describe("the stage's short name, e.g. 'spec' or 'ship'"),
    state: z.enum(tuple(TIMELINE_MILESTONE_STATES)).describe(
      `one of ${TIMELINE_MILESTONE_STATES.join('|')}; the 'rail' form rejects ` +
      "'failed' — use 'colored' for a failed stage"),
  })).optional().describe(
    "'rail'/'colored' forms only, required: the stages, left to right, at least one, " +
    'every label non-empty'),
  steps: z.array(z.string()).optional().describe(
    "'dependency' form only, required: the pipeline's stages in order, at least one, " +
    'every step non-empty'),
  currentIndex: z.number().int().optional().describe(
    "'dependency' form only, required: the index into 'steps' of the stage currently running"),
  transitions: z.array(z.object({
    from: z.string().describe('the state the transition leaves'),
    to: z.string().describe('the state the transition enters'),
    action: z.string().optional().describe(
      'the action or event driving the transition, if the diagram names one'),
  })).optional().describe(
    "'fsl' form only, required: the edges to render, in traversal order, at least one"),
  activeState: z.string().optional().describe(
    "'fsl' form only, optional: the state currently occupied; its first rendered " +
    'occurrence is wrapped in **bold**'),
};

/**
 * What a caller supplies to `render_timeline`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link SeriesArgs}; kept
 * honest against {@link TIMELINE_SHAPE} the same way, at the `handleRenderTimeline`
 * call site. `milestones` reuses `Milestone` directly — unlike `transitions`, neither
 * of `Milestone`'s two fields is optional, so zod's output already matches it exactly
 * and no {@link toFslTransition}-style bridge is needed.
 */
export interface TimelineArgs {
  form: 'rail' | 'colored' | 'dependency' | 'fsl';
  milestones?: Milestone[] | undefined;
  steps?: string[] | undefined;
  currentIndex?: number | undefined;
  transitions?: { from: string; to: string; action?: string | undefined }[] | undefined;
  activeState?: string | undefined;
}

// Fails to compile if TimelineArgs drifts from TIMELINE_SHAPE — see expectType's docblock.
expectType<Equal<TimelineArgs, z.infer<z.ZodObject<typeof TIMELINE_SHAPE>>>>(true);

/**
 * Handles `render_timeline`: an ordered-stage milestone rail, dependency chain, or FSL
 * description.
 *
 * @param args the validated tool arguments; `store` is unused by every `render_timeline`
 *             form, but the parameter is kept for a uniform handler signature
 *
 * @example
 *   handleRenderTimeline(store, {
 *     form: 'dependency',
 *     steps: ['lint', 'test', 'build', 'deploy'],
 *     currentIndex: 2,
 *   })
 *   // => { content: [{ type: 'text', text: 'lint ━ test ━ b̲u̲i̲l̲d̲ ━ deploy' }] }
 */
export function handleRenderTimeline(_store: Store, args: TimelineArgs): ToolReply {
  return guarded(() => {

    switch (args.form) {

      case 'rail': {
        const { milestones } = args;
        if (milestones === undefined || milestones.length === 0) {
          return reply(
            "error: render_timeline form 'rail' is missing 'milestones'; requires " +
            "'milestones' (non-empty array of {label, state}), state one of " +
            "'reached'|'current'|'future'"
          );
        }
        return reply(renderTimelineRail(milestones));
      }

      case 'colored': {
        const { milestones } = args;
        if (milestones === undefined || milestones.length === 0) {
          return reply(
            "error: render_timeline form 'colored' is missing 'milestones'; requires " +
            "'milestones' (non-empty array of {label, state}), state one of " +
            "'reached'|'current'|'future'|'failed'"
          );
        }
        return reply(renderTimelineColored(milestones));
      }

      case 'dependency': {
        const { steps, currentIndex } = args;
        if (steps === undefined || steps.length === 0 || currentIndex === undefined) {
          return reply(
            "error: render_timeline form 'dependency' is missing 'steps' and/or " +
            "'currentIndex'; requires 'steps' (non-empty string[]) and 'currentIndex' " +
            "(integer index into 'steps')"
          );
        }
        return reply(renderDependencyChain(steps, currentIndex));
      }

      case 'fsl': {
        const { transitions, activeState } = args;
        if (transitions === undefined || transitions.length === 0) {
          return reply(
            "error: render_timeline form 'fsl' is missing 'transitions'; requires " +
            "'transitions' (non-empty array of {from, to, action?}); 'activeState' " +
            'optional'
          );
        }
        return reply(renderFsl(transitions.map(toFslTransition), activeState));
      }

    }

  });
}

// ---------------------------------------------------------------------------------
// render_glyph — trend | stars | retry | weather
// ---------------------------------------------------------------------------------

/** The forms {@link handleRenderGlyph} accepts. */
export const GLYPH_FORMS = ['trend', 'stars', 'retry', 'weather'] as const;

/** The raw zod shape backing `render_glyph`'s `inputSchema`. */
const GLYPH_SHAPE = {
  form: z.enum(tuple(GLYPH_FORMS)).describe(
    "which glyph form to render: 'trend' (a value plus a direction arrow), 'stars' (a " +
    "fixed-width star rating), 'retry' (a bounded-retry heart health bar), or " +
    "'weather' (a single glyph summarizing a test set's health)"),
  text: z.string().optional().describe(
    "'trend' form only, required: the label or value to prefix, verbatim — e.g. a " +
    'percent or a measurement with its unit'),
  direction: z.enum(tuple(TREND_DIRECTIONS)).optional().describe(
    `'trend' form only, required: one of ${TREND_DIRECTIONS.join('|')}`),
  score: z.number().optional().describe(
    "'stars' form only, required: the score being rated, in [0, max]; may be " +
    'fractional, rounds to the nearest half-star'),
  max: z.number().int().optional().describe(
    "'stars' form only, optional, defaults to 5: the number of star slots, a positive " +
    'integer'),
  available: z.number().int().optional().describe(
    "'retry' form only, required: retries still available, a non-negative integer"),
  spent: z.number().int().optional().describe(
    "'retry' form only, required: retries already used, a non-negative integer"),
  state: z.enum(tuple(WEATHER_STATES)).optional().describe(
    `'weather' form only, required: one of ${WEATHER_STATES.join('|')}`),
};

/**
 * What a caller supplies to `render_glyph`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link SeriesArgs}; kept
 * honest against {@link GLYPH_SHAPE} the same way, at the `handleRenderGlyph` call site.
 */
export interface GlyphArgs {
  form: 'trend' | 'stars' | 'retry' | 'weather';
  text?: string | undefined;
  direction?: TrendDirection | undefined;
  score?: number | undefined;
  max?: number | undefined;
  available?: number | undefined;
  spent?: number | undefined;
  state?: WeatherState | undefined;
}

// Fails to compile if GlyphArgs drifts from GLYPH_SHAPE — see expectType's docblock.
expectType<Equal<GlyphArgs, z.infer<z.ZodObject<typeof GLYPH_SHAPE>>>>(true);

/**
 * Handles `render_glyph`: the lightest-weight inline visual cue — a trend tag, star
 * rating, retry health bar, or weather glyph.
 *
 * @param args the validated tool arguments; `store` is unused by every `render_glyph`
 *             form, but the parameter is kept for a uniform handler signature
 *
 * @example
 *   handleRenderGlyph(store, { form: 'weather', state: 'mixed' })
 *   // => { content: [{ type: 'text', text: '⛅' }] }
 */
export function handleRenderGlyph(_store: Store, args: GlyphArgs): ToolReply {
  return guarded(() => {

    switch (args.form) {

      case 'trend': {
        const { text, direction } = args;
        if (text === undefined || direction === undefined) {
          return reply(
            "error: render_glyph form 'trend' is missing 'text' and/or 'direction'; " +
            "requires 'text' (string) and 'direction' " +
            `(one of ${TREND_DIRECTIONS.join('|')})`
          );
        }
        return reply(renderTrendTag(text, direction));
      }

      case 'stars': {
        const { score, max } = args;
        if (score === undefined) {
          return reply(
            "error: render_glyph form 'stars' is missing 'score'; requires 'score' " +
            "(number, 0 to max); 'max' optional, defaults to 5"
          );
        }
        return reply(renderStars(score, max));
      }

      case 'retry': {
        const { available, spent } = args;
        if (available === undefined || spent === undefined) {
          return reply(
            "error: render_glyph form 'retry' is missing 'available' and/or 'spent'; " +
            "requires 'available' and 'spent' (non-negative integers)"
          );
        }
        return reply(renderRetryHealth(available, spent));
      }

      case 'weather': {
        const { state } = args;
        if (state === undefined) {
          return reply(
            "error: render_glyph form 'weather' is missing 'state'; requires 'state' " +
            `(one of ${WEATHER_STATES.join('|')})`
          );
        }
        return reply(renderWeather(state));
      }

    }

  });
}

// ---------------------------------------------------------------------------------
// render_checklist_summary — no form; one renderer
// ---------------------------------------------------------------------------------

/** The bucket-override vocabulary a checklist item can carry, mirroring `markers.ts`'s `Bucket`. */
const CHECKLIST_BUCKETS = ['success', 'active', 'failure'] as const;

/** The raw zod shape backing `render_checklist_summary`'s `inputSchema`. */
const CHECKLIST_SUMMARY_SHAPE = {
  items: z.array(z.object({
    marker: z.string().describe("the marker glyph this item renders with, e.g. '✅'"),
    bucket: z.enum(tuple(CHECKLIST_BUCKETS)).optional().describe(
      "overrides the marker's own bucket classification when supplied — needed for a " +
      "marker like '🚢' whose bucket the glyph alone cannot carry"),
  })).min(1).describe(
    'every checklist item at every nesting level, one entry each; non-empty — a ' +
    'summary line has nothing to summarize otherwise'),
  series: z.array(z.number()).optional().describe(
    "the checklist's percent history, chronological order; a trend sparkline is " +
    'appended only when it has 4 or more points; omit when supplying \'seriesKey\' ' +
    'instead'),
  seriesKey: z.string().optional().describe(
    "alternative to 'series': a series key previously recorded via the express tool; " +
    "resolves to that series' stored percent history (seriesPercents) and becomes " +
    "options.series"),
};

/**
 * What a caller supplies to `render_checklist_summary`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link SeriesArgs}; kept
 * honest against {@link CHECKLIST_SUMMARY_SHAPE} the same way, at the
 * `handleRenderChecklistSummary` call site.
 */
export interface ChecklistSummaryArgs {
  items: { marker: string; bucket?: Bucket | undefined }[];
  series?: number[] | undefined;
  seriesKey?: string | undefined;
}

// Fails to compile if ChecklistSummaryArgs drifts from CHECKLIST_SUMMARY_SHAPE — see
// expectType's docblock.
expectType<Equal<ChecklistSummaryArgs, z.infer<z.ZodObject<typeof CHECKLIST_SUMMARY_SHAPE>>>>(true);

/**
 * Handles `render_checklist_summary`: the full status-checklist summary line — count
 * section, percent, progress bar, optional trend sparkline, and per-marker icon list.
 *
 * @param store the store `seriesKey` is resolved against
 * @param args   the validated tool arguments
 *
 * @example
 *   handleRenderChecklistSummary(store, {
 *     items: [{ marker: '✅' }, { marker: '✅' }, { marker: '❌' }],
 *   })
 *   // => { content: [{ type: 'text', text: '2/0/1 items (67%) ...' }] }
 */
export function handleRenderChecklistSummary(store: Store, args: ChecklistSummaryArgs): ToolReply {
  return guarded(() => {
    const series = args.seriesKey !== undefined ? seriesPercents(store, args.seriesKey) : args.series;
    return reply(renderChecklistSummary(args.items.map(toChecklistItem), series === undefined ? undefined : { series }));
  });
}

// ---------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------

/**
 * Registers all six chart-rendering tools on `server`.
 *
 * Charts have no config gate in v1 — unlike `express`'s channel set, every form is
 * always available, since a disabled renderer has no analogue to "logged but
 * unreadable data" motivating `registerTools`'s enabled-channel narrowing.
 *
 * @example
 *   const server = new McpServer({ name: 'self-expression', version: '0.2.0' });
 *   registerChartTools(server, store);
 */
export function registerChartTools(server: McpServer, store: Store): void {

  server.registerTool('render_series', {
    title: 'Render series',
    description:
      'Render one data series as a compact ASCII/emoji strip: a block-ramp sparkline, ' +
      'a denser braille microplot, or a categorical win/loss strip. Reach for this to ' +
      "show a metric's recent trend or a run history inline in text — coverage " +
      'climbing over the last several runs, latency wobbling, or a strip of ' +
      "pass/fail/flaky outcomes. Use 'seriesKey' instead of 'data' to replay a series " +
      'already logged as checklist percent snapshots, rather than retyping numbers by hand.',
    inputSchema: SERIES_SHAPE,
  }, (args) => handleRenderSeries(store, args));

  server.registerTool('render_bar', {
    title: 'Render bar',
    description:
      'Render a single value (or a small stat set) as a fixed-width ASCII bar: a plain ' +
      'progress bar, a bulleted target graph, a diverging over/under bar, a stacked ' +
      'success/active/failure bar, a min-max range slider, or a one-line box-and-whisker ' +
      'distribution. Reach for this whenever a single number, or a handful of them, ' +
      'needs a compact visual instead of prose — percent complete, ahead/behind ' +
      'schedule, a count breakdown, or a five-number summary.',
    inputSchema: BAR_SHAPE,
  }, (args) => handleRenderBar(store, args));

  server.registerTool('render_rows', {
    title: 'Render rows',
    description:
      'Render several values side by side against one shared scale: a multi-row ' +
      'comparison chart (a bar or dot track per row) or a tile-grid map (one cell per ' +
      'region, shaded, colored, or custom-glyphed). Reach for this to compare multiple ' +
      "items at once — several checklists' completion, several regions' health — " +
      'rather than one value in isolation.',
    inputSchema: ROWS_SHAPE,
  }, (args) => handleRenderRows(store, args));

  server.registerTool('render_timeline', {
    title: 'Render timeline',
    description:
      'Render an ordered sequence of stages: a centered monochrome rail, a colored ' +
      "one-line rail (needed for a failed stage), an inline dependency-chain pipeline " +
      'with the current step underlined, or a one-line FSL-style state-machine ' +
      'description. Reach for this to show where a multi-step process currently ' +
      "stands — a release pipeline, a build's stages, or a state machine's current " +
      'state and history.',
    inputSchema: TIMELINE_SHAPE,
  }, (args) => handleRenderTimeline(store, args));

  server.registerTool('render_glyph', {
    title: 'Render glyph',
    description:
      'Render one small inline glyph: a trend-direction tag next to a value, a star ' +
      'rating, a bounded-retry health bar, or a single weather glyph summarizing a ' +
      'test set’s health. Reach for this for the lightest-weight visual cue — a ' +
      'delta arrow after a percent, a score, retries remaining, or one glyph capturing ' +
      'overall health — when a full series or bar would be overkill.',
    inputSchema: GLYPH_SHAPE,
  }, (args) => handleRenderGlyph(store, args));

  server.registerTool('render_checklist_summary', {
    title: 'Render checklist summary',
    description:
      'Render a complete status-checklist summary line: the success/active/failure ' +
      'count section, percent, a 10-cell progress bar, an optional trend sparkline, ' +
      'and the sorted per-marker icon list (inline or split into blocks, per the ' +
      'status-checklists convention). Reach for this instead of hand-computing a ' +
      "checklist's summary line — it is the exact, contract-pinned arithmetic the " +
      'status-checklists skill specifies, not an approximation.',
    inputSchema: CHECKLIST_SUMMARY_SHAPE,
  }, (args) => handleRenderChecklistSummary(store, args));

}
