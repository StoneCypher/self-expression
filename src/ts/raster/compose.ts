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

import { encodePng } from './encoder.js';
import {
  drawChecklistSeries, drawDeltaLane, drawNeedRate, drawStemPunch, drawUncertainStrip,
} from './panels.js';
import type { ChecklistSeriesRow, NeedWeekRow, SignatureRow } from './panels.js';
import { WHITE, fullRegion, makeSurface, subRegion, upscale } from './surface.js';
import type { Region } from './surface.js';

/** The charts a render can produce: the five-panel dashboard, or one panel alone at full size. */
export const HISTORY_CHARTS = ['dashboard', 'stems', 'delta', 'uncertain', 'need', 'checklist'] as const;

/** One of {@link HISTORY_CHARTS}. */
export type HistoryChart = typeof HISTORY_CHARTS[number];

/** Everything the renderer needs, already queried — no store access from here down. */
export interface HistoryData {
  /** Signatures in range, `id` order — panels A, B, and C. */
  readonly signatures      : readonly SignatureRow[];
  /** Weekly turn/need counts — panel D. */
  readonly needWeeks       : readonly NeedWeekRow[];
  /** Top checklist series' percent histories — panel E. */
  readonly checklistSeries : readonly ChecklistSeriesRow[];
  /** The window length in calendar days; a positive integer. */
  readonly days            : number;
  /** The window's end instant, ISO 8601 UTC — normally the render time. */
  readonly endUtc          : string;
}

/** Rendering choices; both fields optional with dashboard/2× defaults. */
export interface RenderOptions {
  /** Which chart to draw; defaults to `'dashboard'`. */
  readonly chart? : HistoryChart | undefined;
  /** Integer output magnification, 1 or 2; defaults to 2 (1920×1440 physical). */
  readonly scale? : 1 | 2 | undefined;
}

/** Logical dashboard width in pixels, before scaling. */
export const LOGICAL_WIDTH = 960;

/** Logical dashboard height in pixels, before scaling. */
export const LOGICAL_HEIGHT = 720;

/** Draw one named panel into one region. File-private dispatch shared by both layouts. */
function drawPanel(chart: Exclude<HistoryChart, 'dashboard'>, region: Region, data: HistoryData): void {
  switch (chart) {
    case 'stems':     { drawStemPunch(region, data.signatures, data.days, data.endUtc);     break; }
    case 'delta':     { drawDeltaLane(region, data.signatures);                             break; }
    case 'uncertain': { drawUncertainStrip(region, data.signatures, data.days, data.endUtc); break; }
    case 'need':      { drawNeedRate(region, data.needWeeks);                               break; }
    case 'checklist': { drawChecklistSeries(region, data.checklistSeries);                  break; }
  }
}

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
export function renderHistoryPng(data: HistoryData, options: RenderOptions = {}): Buffer {

  if (!Number.isInteger(data.days) || data.days < 1) {
    throw new RangeError(`renderHistoryPng: days must be a positive integer; got ${String(data.days)}`);
  }

  const chart   = options.chart ?? 'dashboard',
        scale   = options.scale ?? 2,
        surface = makeSurface(LOGICAL_WIDTH, LOGICAL_HEIGHT, WHITE),
        whole   = fullRegion(surface);

  if (chart === 'dashboard') {
    drawPanel('stems',     subRegion(whole,   8,   8, 592, 336), data);
    drawPanel('delta',     subRegion(whole, 608,   8, 344, 336), data);
    drawPanel('uncertain', subRegion(whole,   8, 352, 592, 116), data);
    drawPanel('need',      subRegion(whole, 608, 352, 344, 360), data);
    drawPanel('checklist', subRegion(whole,   8, 476, 592, 236), data);
  } else {
    drawPanel(chart, subRegion(whole, 8, 8, LOGICAL_WIDTH - 16, LOGICAL_HEIGHT - 16), data);
  }

  const physical = scale === 1 ? surface : upscale(surface, scale);

  return encodePng(physical.width, physical.height, physical.data);

}
