/**
 * The public ASCII-chart renderer surface, re-exported from one place.
 *
 * Every renderer, type, and constant a caller might reasonably import lives in one of
 * `scale.ts`, `markers.ts`, `series.ts`, `bars.ts`, `rows.ts`, `timeline.ts`,
 * `glyphs.ts`, `profiles.ts`, `digest.ts`, `checklist.ts`, `annotations.ts`, and
 * `verify.ts`; this barrel re-exports all of it so consumers — the MCP chart tools in
 * `mcp/chart_tools.ts`, the checklist tools in `mcp/checklist_tools.ts`, the annotation
 * surface in `mcp/tools.ts`, and library users importing from the package root — need
 * one import path instead of twelve.
 * `src/ts/index.ts` re-exports this module in turn, so the renderers are also part of
 * the package's public API.
 *
 * @see ./scale.js
 * @see ./markers.js
 * @see ./series.js
 * @see ./bars.js
 * @see ./rows.js
 * @see ./timeline.js
 * @see ./glyphs.js
 * @see ./profiles.js
 * @see ./digest.js
 * @see ./checklist.js
 * @see ./annotations.js
 * @see ./verify.js
 */
export * from './scale.js';
export * from './markers.js';
export * from './series.js';
export * from './bars.js';
export * from './rows.js';
export * from './timeline.js';
export * from './glyphs.js';
export * from './profiles.js';
export * from './digest.js';
export * from './checklist.js';
export * from './annotations.js';
export * from './verify.js';
//# sourceMappingURL=index.d.ts.map