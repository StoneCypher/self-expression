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
import type { Region, Rgba } from './surface.js';
/** One signature entry, as the punch/delta/uncertainty panels consume it. */
export interface SignatureRow {
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
export interface NeedWeekRow {
    /** ISO week label, e.g. `2026-W35`. */
    readonly week: string;
    /** Distinct prompts that produced a signature that week. */
    readonly turns: number;
    /** `need` rows recorded that week. */
    readonly needs: number;
}
/** One checklist series' percent history, as the checklist panel consumes it. */
export interface ChecklistSeriesRow {
    /** The stable series identity (#27), drawn as the line's label. */
    readonly seriesKey: string;
    /** Percent snapshots in recording order, each 0–100. */
    readonly percents: readonly number[];
}
/** Stems in vocabulary order, each with its Okabe–Ito color; unknown/null falls to grey. */
export declare const STEM_COLORS: readonly (readonly [string, Rgba])[];
/** The delta lane's coloring: up blue, down vermillion, steady (and anything else) grey. */
export declare function deltaColor(delta: string | null): Rgba;
/** The color for one stem value — the {@link STEM_COLORS} lookup plus the grey fallback. */
export declare function stemColor(stem: string | null): Rgba;
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
export declare function dayColumn(tsUtc: string, endUtc: string, days: number): number | null;
/**
 * Rolling mean of the last `window` values at each position — the delta lane's
 * drift line. Position `i` averages values `max(0, i - window + 1) .. i`, so the
 * line exists from the first entry instead of starting `window` entries in.
 *
 * @example
 *   rollingMean([1, 1, -1, -1], 2)  // => [1, 1, 0, -1]
 */
export declare function rollingMean(values: readonly number[], window: number): number[];
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
export declare function drawStemPunch(region: Region, rows: readonly SignatureRow[], days: number, endUtc: string): void;
/** The rolling-mean window, in signatures, the delta lane's drift line averages over. */
export declare const DELTA_WINDOW = 20;
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
export declare function drawDeltaLane(region: Region, rows: readonly SignatureRow[]): void;
/**
 * Panel C — daily uncertainty: for each calendar day in range, the proportion of
 * signatures with `uncertain` set, as a vermillion bar rising from the baseline.
 * Shares panel A's day axis so spikes can be eyeballed against what was
 * happening that day.
 *
 * @example
 *   drawUncertainStrip(panelRegion, signatureHistory(store, since), 90, nowIso);
 */
export declare function drawUncertainStrip(region: Region, rows: readonly SignatureRow[], days: number, endUtc: string): void;
/**
 * Panel D — weekly need rate: per ISO week, turns as a grey bar, `need` rows as
 * a narrower orange bar overlaid, and the need-per-turn proportion as a blue
 * polyline on an implicit right-hand 0–100% scale. Answers "how often is `need`
 * non-null, and is that changing".
 *
 * @example
 *   drawNeedRate(panelRegion, needWeekly(store, since));
 */
export declare function drawNeedRate(region: Region, weeks: readonly NeedWeekRow[]): void;
/** The line colors the checklist panel cycles through, one per series. */
export declare const SERIES_COLORS: readonly Rgba[];
/**
 * Panel E — checklist series: `percent` versus recording order, one polyline per
 * series, labeled with its stable `series_key`. The y axis is fixed 0–100 so
 * charts are comparable across renders, matching the absolute-scale rule the
 * ASCII sparklines follow.
 *
 * @example
 *   drawChecklistSeries(panelRegion, checklistSeriesTop(store, since, 5));
 */
export declare function drawChecklistSeries(region: Region, series: readonly ChecklistSeriesRow[]): void;
//# sourceMappingURL=panels.d.ts.map