/**
 * The secondary emission: a mermaid serializer, no layout. Mermaid does not render
 * in the transcript surface this plugin lives in (settled empirically in issue #19 —
 * the reader gets raw source), so this is emitted only on request, for destinations
 * that do render it: GitHub issue/PR bodies, READMEs, and preview surfaces.
 *
 * Pure string emission; the graph is re-validated on the way through, and the small
 * extra vocabulary mermaid itself cannot carry (whitespace in ids, quotes in
 * labels) is a named `RangeError` rather than silently mangled output.
 *
 * @see ./model.js
 * @see ./renderers.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */
import type { Digraph } from './model.js';
/** The two mermaid dialects emitted: state machines, and everything else. */
export type MermaidDialect = 'stateDiagram-v2' | 'flowchart';
/**
 * Serializes a graph to mermaid source: `stateDiagram-v2` for state machines (edge
 * labels become `: action` transition annotations), `flowchart` (top-down) for
 * everything else (every node declared with its label, edge labels in `|pipes|`).
 * No layout, no line drawing — mermaid's renderer owns that on whatever surface
 * this lands.
 *
 * @param graph   the graph to serialize; re-validated internally
 * @param dialect which mermaid grammar to emit
 *
 * @example
 *   toMermaid(normalizeGraph([
 *     { from: 'locked', to: 'unlocked', label: 'coin' },
 *     { from: 'unlocked', to: 'locked', label: 'push' },
 *   ]), 'stateDiagram-v2')
 *   // => 'stateDiagram-v2\n    locked --> unlocked: coin\n    unlocked --> locked: push'
 *
 * @throws {RangeError} If the graph fails validation, or an id or label uses
 *                        characters the chosen mermaid syntax cannot carry.
 * @see normalizeGraph
 */
export declare function toMermaid(graph: Digraph, dialect: MermaidDialect): string;
//# sourceMappingURL=mermaid.d.ts.map