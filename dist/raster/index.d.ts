/**
 * Barrel for the raster module: the zero-dependency PNG encoder, the 5×7 bitmap
 * font, the drawing surface, the five dashboard panels, and the composer.
 *
 * Re-exported from `src/ts/index.ts` so the encoder and renderers are library
 * API like everything else. Everything here is pure except nothing — the file
 * write lives in the invocation layer (`mcp/chart_tools.ts`), not in this module.
 *
 * @see ../../superpowers/spec/2026-08-27-png-history-design.md
 */
export { encodePng, PNG_SIGNATURE } from './encoder.js';
export { GLYPHS, GLYPH_WIDTH, GLYPH_HEIGHT, GLYPH_SPACING, FIRST_CODE, LAST_CODE, glyphColumns, measureText, } from './font.js';
export { WHITE, INK, GREY, LIGHT_GREY, ORANGE, SKY, GREEN, YELLOW, BLUE, VERMILLION, PURPLE, makeSurface, fullRegion, subRegion, pixel, hline, vline, fillRect, rect, polyline, text, upscale, readPixel, } from './surface.js';
export type { Rgba, Surface, Region } from './surface.js';
export { STEM_COLORS, SERIES_COLORS, DELTA_WINDOW, stemColor, deltaColor, dayColumn, rollingMean, drawStemPunch, drawDeltaLane, drawUncertainStrip, drawNeedRate, drawChecklistSeries, } from './panels.js';
export type { SignatureRow, NeedWeekRow, ChecklistSeriesRow } from './panels.js';
export { renderHistoryPng, HISTORY_CHARTS, LOGICAL_WIDTH, LOGICAL_HEIGHT } from './compose.js';
export type { HistoryChart, HistoryData, RenderOptions } from './compose.js';
//# sourceMappingURL=index.d.ts.map