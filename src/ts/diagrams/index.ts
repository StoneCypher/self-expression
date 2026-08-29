/**
 * The public diagram surface, re-exported from one place — the sibling of
 * `../charts/index.ts`, deliberately a separate directory because diagrams carry a
 * different correctness contract than charts: charts pin exact strings across dense
 * threshold bands; diagrams pin invariants (topology survives, frames are
 * rectangles, edges trace) plus a small canon of goldens
 * (`2026-08-27-diagrams-design.md` § Why diagrams are a different mechanic).
 *
 * `src/ts/index.ts` re-exports this module in turn, so the renderers, the FSL-subset
 * parser, and the mermaid emission are all part of the package's public API,
 * matching charts.
 *
 * @see ./model.js
 * @see ./grid.js
 * @see ./fsl.js
 * @see ./layout.js
 * @see ./matrix.js
 * @see ./renderers.js
 * @see ./mermaid.js
 */

export * from './model.js';
export * from './grid.js';
export * from './fsl.js';
export * from './layout.js';
export * from './matrix.js';
export * from './renderers.js';
export * from './mermaid.js';
