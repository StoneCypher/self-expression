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
import type { ChecklistSeriesRow, NeedWeekRow, SignatureRow } from './panels.js';
/** The charts a render can produce: the five-panel dashboard, or one panel alone at full size. */
export declare const HISTORY_CHARTS: readonly ["dashboard", "stems", "delta", "uncertain", "need", "checklist"];
/** One of {@link HISTORY_CHARTS}. */
export type HistoryChart = typeof HISTORY_CHARTS[number];
/** Everything the renderer needs, already queried — no store access from here down. */
export interface HistoryData {
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
export interface RenderOptions {
    /** Which chart to draw; defaults to `'dashboard'`. */
    readonly chart?: HistoryChart | undefined;
    /** Integer output magnification, 1 or 2; defaults to 2 (1920×1440 physical). */
    readonly scale?: 1 | 2 | undefined;
}
/** Logical dashboard width in pixels, before scaling. */
export declare const LOGICAL_WIDTH = 960;
/** Logical dashboard height in pixels, before scaling. */
export declare const LOGICAL_HEIGHT = 720;
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
export declare function renderHistoryPng(data: HistoryData, options?: RenderOptions): Buffer;
//# sourceMappingURL=compose.d.ts.map