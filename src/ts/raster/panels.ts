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

import {
  BLUE, GREEN, GREY, INK, LIGHT_GREY, ORANGE, PURPLE, SKY, VERMILLION, WHITE,
  fillRect, hline, polyline, rect, subRegion, text,
} from './surface.js';
import type { Region, Rgba } from './surface.js';
import { measureText } from './font.js';

// --- row shapes -----------------------------------------------------------------

/** One signature entry, as the punch/delta/uncertainty panels consume it. */
export interface SignatureRow {
  /** Insertion order — the delta lane's x-axis. */
  readonly id        : number;
  /** ISO 8601 UTC timestamp; the day-bucketing key. */
  readonly tsUtc     : string;
  /** Local hour 0–23 parsed from the stored local time, or `null` when unparseable. */
  readonly hourLocal : number | null;
  /** The affect stem, or `null` when none was recorded. */
  readonly stem      : string | null;
  /** Direction since the previous signature, or `null` on a session's first. */
  readonly delta     : string | null;
  /** Whether the signature was marked uncertain. */
  readonly uncertain : boolean;
  /** Project name, or `null` when unrecorded (e.g. privacy off). */
  readonly project   : string | null;
}

/** One ISO week's turn and need counts, as the need-rate panel consumes them. */
export interface NeedWeekRow {
  /** ISO week label, e.g. `2026-W35`. */
  readonly week  : string;
  /** Distinct prompts that produced a signature that week. */
  readonly turns : number;
  /** `need` rows recorded that week. */
  readonly needs : number;
}

/** One checklist series' percent history, as the checklist panel consumes it. */
export interface ChecklistSeriesRow {
  /** The stable series identity (#27), drawn as the line's label. */
  readonly seriesKey : string;
  /** Percent snapshots in recording order, each 0–100. */
  readonly percents  : readonly number[];
}

// --- category colors ------------------------------------------------------------

/** Stems in vocabulary order, each with its Okabe–Ito color; unknown/null falls to grey. */
export const STEM_COLORS: readonly (readonly [string, Rgba])[] = [
  ['flow',   BLUE],
  ['spark',  ORANGE],
  ['drag',   VERMILLION],
  ['fog',    SKY],
  ['strain', PURPLE],
  ['still',  GREEN],
];

/** The delta lane's coloring: up blue, down vermillion, steady (and anything else) grey. */
export function deltaColor(delta: string | null): Rgba {
  if (delta === 'up')   { return BLUE; }
  if (delta === 'down') { return VERMILLION; }
  return GREY;
}

/** The color for one stem value — the {@link STEM_COLORS} lookup plus the grey fallback. */
export function stemColor(stem: string | null): Rgba {
  const found = STEM_COLORS.find(([name]) => name === stem);
  return found === undefined ? GREY : found[1];
}

// --- shared layout arithmetic ---------------------------------------------------

/** Milliseconds per day; UTC day buckets divide by this. */
const DAY_MS = 86_400_000;

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
export function dayColumn(tsUtc: string, endUtc: string, days: number): number | null {

  const rowDay = Math.floor(Date.parse(tsUtc)  / DAY_MS),
        endDay = Math.floor(Date.parse(endUtc) / DAY_MS);

  if (Number.isNaN(rowDay) || Number.isNaN(endDay)) { return null; }

  const column = days - 1 - (endDay - rowDay);
  return column >= 0 && column < days ? column : null;

}

/**
 * Rolling mean of the last `window` values at each position — the delta lane's
 * drift line. Position `i` averages values `max(0, i - window + 1) .. i`, so the
 * line exists from the first entry instead of starting `window` entries in.
 *
 * @example
 *   rollingMean([1, 1, -1, -1], 2)  // => [1, 1, 0, -1]
 */
export function rollingMean(values: readonly number[], window: number): number[] {

  const out: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) { sum += values[j] ?? 0; }
    out.push(sum / (i - start + 1));
  }

  return out;

}

/** Height reserved for a panel's title row. File-private layout constant. */
const TITLE_H = 14;

/**
 * Draw a panel's frame and title, returning the inner plot region below the
 * title. The shared opening move of every panel.
 */
function panelFrame(region: Region, title: string): Region {
  rect(region, 0, 0, region.width, region.height, INK);
  text(region, 4, 4, title, INK, 1);
  return subRegion(region, 2, TITLE_H, region.width - 4, region.height - TITLE_H - 2);
}

/** Draw the `no data in range` message centered-ish in a plot region. */
function noData(plot: Region): void {
  const label = 'no data in range';
  text(plot, Math.max(2, Math.floor((plot.width - measureText(label)) / 2)),
             Math.max(2, Math.floor(plot.height / 2) - 3), label, GREY, 1);
}

// --- panel A: stems by time of day ----------------------------------------------

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
export function drawStemPunch(region: Region, rows: readonly SignatureRow[], days: number, endUtc: string): void {

  const plotAll = panelFrame(region, 'A  stems by hour of day');

  if (rows.length === 0) { noData(plotAll); return; }

  const legendH = 10,
        axisW   = 14,
        plot    = subRegion(plotAll, axisW, 0, plotAll.width - axisW, plotAll.height - legendH);

  for (const hour of [0, 6, 12, 18]) {
    const y = Math.floor((hour + 0.5) * plot.height / 24);
    text(plotAll, 0, y - 3, String(hour), GREY, 1);
    hline(plot, 0, y, plot.width, LIGHT_GREY);
  }

  for (const row of rows) {
    if (row.hourLocal === null) { continue; }
    const column = dayColumn(row.tsUtc, endUtc, days);
    if (column === null) { continue; }
    const x = Math.floor((column + 0.5) * plot.width / days) - 1,
          y = Math.floor((row.hourLocal + 0.5) * plot.height / 24) - 1;
    fillRect(plot, x, y, 2, 2, stemColor(row.stem));
  }

  let legendX = axisW;
  const legendY = plotAll.height - legendH + 2;
  for (const [name, color] of [...STEM_COLORS, ['null', GREY] as const]) {
    fillRect(plotAll, legendX, legendY, 4, 4, color);
    text(plotAll, legendX + 6, legendY - 1, name, INK, 1);
    legendX += 6 + measureText(name) + 8;
  }

}

// --- panel B: delta lane --------------------------------------------------------

/** The rolling-mean window, in signatures, the delta lane's drift line averages over. */
export const DELTA_WINDOW = 20;

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
export function drawDeltaLane(region: Region, rows: readonly SignatureRow[]): void {

  const plot = panelFrame(region, 'B  delta lane');

  if (rows.length === 0) { noData(plot); return; }

  const laneTop = 8,
        laneH   = plot.height - 16,
        mid     = laneTop + Math.floor(laneH / 2);

  const columnWidth = Math.max(1, Math.floor(plot.width / rows.length));

  rows.forEach((row, i) => {
    const x = Math.floor(i * plot.width / rows.length);
    fillRect(plot, x, laneTop, columnWidth, laneH, deltaColor(row.delta));
  });

  hline(plot, 0, mid, plot.width, WHITE);

  const numeric = rows.map(row => row.delta === 'up' ? 1 : row.delta === 'down' ? -1 : 0),
        means   = rollingMean(numeric, DELTA_WINDOW),
        points  = means.map((mean, i): readonly [number, number] => [
          Math.floor(i * plot.width / rows.length),
          mid - Math.round(mean * (laneH / 2 - 1)),
        ]);

  polyline(plot, points, INK);

}

// --- panel C: uncertainty -------------------------------------------------------

/**
 * Panel C — daily uncertainty: for each calendar day in range, the proportion of
 * signatures with `uncertain` set, as a vermillion bar rising from the baseline.
 * Shares panel A's day axis so spikes can be eyeballed against what was
 * happening that day.
 *
 * @example
 *   drawUncertainStrip(panelRegion, signatureHistory(store, since), 90, nowIso);
 */
export function drawUncertainStrip(region: Region, rows: readonly SignatureRow[], days: number, endUtc: string): void {

  const plot = panelFrame(region, 'C  uncertain, daily proportion');

  if (rows.length === 0) { noData(plot); return; }

  const totals    = new Array<number>(days).fill(0),
        uncertain = new Array<number>(days).fill(0);

  for (const row of rows) {
    const column = dayColumn(row.tsUtc, endUtc, days);
    if (column === null) { continue; }
    totals[column] = (totals[column] ?? 0) + 1;
    if (row.uncertain) { uncertain[column] = (uncertain[column] ?? 0) + 1; }
  }

  const baseline = plot.height - 2,
        barSpan  = baseline - 2;

  hline(plot, 0, baseline, plot.width, GREY);

  for (let day = 0; day < days; day++) {
    const total = totals[day] ?? 0;
    if (total === 0) { continue; }
    const proportion = (uncertain[day] ?? 0) / total,
          barHeight  = Math.round(proportion * barSpan),
          x          = Math.floor(day * plot.width / days),
          barWidth   = Math.max(1, Math.floor(plot.width / days) - 1);
    if (barHeight > 0) {
      fillRect(plot, x, baseline - barHeight, barWidth, barHeight, VERMILLION);
    } else {
      hline(plot, x, baseline - 1, barWidth, LIGHT_GREY);
    }
  }

}

// --- panel D: need rate ---------------------------------------------------------

/**
 * Panel D — weekly need rate: per ISO week, turns as a grey bar, `need` rows as
 * a narrower orange bar overlaid, and the need-per-turn proportion as a blue
 * polyline on an implicit right-hand 0–100% scale. Answers "how often is `need`
 * non-null, and is that changing".
 *
 * @example
 *   drawNeedRate(panelRegion, needWeekly(store, since));
 */
export function drawNeedRate(region: Region, weeks: readonly NeedWeekRow[]): void {

  const plot = panelFrame(region, 'D  need rate, weekly');

  if (weeks.length === 0) { noData(plot); return; }

  const baseline = plot.height - 10,
        barSpan  = baseline - 4,
        maxTurns = Math.max(1, ...weeks.map(week => Math.max(week.turns, week.needs))),
        slotW    = plot.width / weeks.length;

  hline(plot, 0, baseline, plot.width, GREY);

  weeks.forEach((week, i) => {
    const x        = Math.floor(i * slotW),
          barWidth = Math.max(2, Math.floor(slotW) - 2),
          turnsH   = Math.round(week.turns / maxTurns * barSpan),
          needsH   = Math.round(week.needs / maxTurns * barSpan);
    if (turnsH > 0) { fillRect(plot, x, baseline - turnsH, barWidth, turnsH, LIGHT_GREY); }
    if (needsH > 0) { fillRect(plot, x + Math.floor(barWidth / 4), baseline - needsH, Math.max(1, Math.floor(barWidth / 2)), needsH, ORANGE); }
  });

  const points = weeks.map((week, i): readonly [number, number] => [
    Math.floor((i + 0.5) * slotW),
    baseline - Math.round((week.turns === 0 ? 0 : Math.min(1, week.needs / week.turns)) * barSpan),
  ]);

  polyline(plot, points, BLUE);

  const [firstWeek] = weeks, lastWeek = weeks[weeks.length - 1];
  if (firstWeek !== undefined) { text(plot, 0, baseline + 2, firstWeek.week, GREY, 1); }
  if (lastWeek !== undefined && weeks.length > 1) {
    text(plot, plot.width - measureText(lastWeek.week), baseline + 2, lastWeek.week, GREY, 1);
  }

}

// --- panel E: checklist series --------------------------------------------------

/** The line colors the checklist panel cycles through, one per series. */
export const SERIES_COLORS: readonly Rgba[] = [BLUE, ORANGE, GREEN, VERMILLION, PURPLE];

/**
 * Panel E — checklist series: `percent` versus recording order, one polyline per
 * series, labeled with its stable `series_key`. The y axis is fixed 0–100 so
 * charts are comparable across renders, matching the absolute-scale rule the
 * ASCII sparklines follow.
 *
 * @example
 *   drawChecklistSeries(panelRegion, checklistSeriesTop(store, since, 5));
 */
export function drawChecklistSeries(region: Region, series: readonly ChecklistSeriesRow[]): void {

  const plot = panelFrame(region, 'E  checklist percent by series');

  if (series.length === 0) { noData(plot); return; }

  const labelW  = 110,
        lines   = subRegion(plot, 0, 0, plot.width - labelW, plot.height),
        chartH  = lines.height - 4;

  for (const percent of [0, 50, 100]) {
    hline(lines, 0, 2 + Math.round((100 - percent) / 100 * chartH), lines.width, LIGHT_GREY);
  }

  series.forEach((oneSeries, index) => {

    const color = SERIES_COLORS[index % SERIES_COLORS.length] ?? GREY;

    const points = oneSeries.percents.map((percent, i): readonly [number, number] => [
      oneSeries.percents.length === 1 ? 0 : Math.floor(i * (lines.width - 1) / (oneSeries.percents.length - 1)),
      2 + Math.round((100 - Math.min(100, Math.max(0, percent))) / 100 * chartH),
    ]);

    polyline(lines, points, color);

    const labelY = 2 + index * 10,
          key    = oneSeries.seriesKey.length > 16 ? oneSeries.seriesKey.slice(0, 16) : oneSeries.seriesKey;
    fillRect(plot, plot.width - labelW + 2, labelY + 1, 4, 4, color);
    text(plot, plot.width - labelW + 8, labelY, key, INK, 1);

  });

}
