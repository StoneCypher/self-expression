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

import { normalizeGraph, displayLabel } from './model.js';
import type { Digraph } from './model.js';

/** The two mermaid dialects emitted: state machines, and everything else. */
export type MermaidDialect = 'stateDiagram-v2' | 'flowchart';

/** Guards one id against mermaid's identifier rules, naming the constraint. */
function requireMermaidId(id: string): void {
  if (/[\s"|[\]{}()<>]/u.test(id)) {
    throw new RangeError(
      `node id '${id}' cannot be emitted as a mermaid identifier (whitespace, quotes, `
      + 'brackets, and pipes are not representable); rename the node or skip the mermaid emission'
    );
  }
}

/** Guards one label against the emitted syntax's delimiters, naming the constraint. */
function requireMermaidLabel(label: string, what: string): void {
  if (label.includes('"') || label.includes('|')) {
    throw new RangeError(
      `${what} contains a '"' or '|', which the mermaid emission cannot escape; `
      + 'reword it or skip the mermaid emission'
    );
  }
}

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
export function toMermaid(graph: Digraph, dialect: MermaidDialect): string {

  const normalized = normalizeGraph(graph.edges, graph.nodes);

  for (const node of normalized.nodes) {
    requireMermaidId(node.id);
    requireMermaidLabel(displayLabel(node), `the label of node '${node.id}'`);
  }
  for (const edge of normalized.edges) {
    if (edge.label !== undefined) {
      requireMermaidLabel(edge.label, `the label of edge '${edge.from}' -> '${edge.to}'`);
    }
  }

  if (dialect === 'stateDiagram-v2') {
    const lines = ['stateDiagram-v2'];
    for (const node of normalized.nodes) {
      if (node.label !== undefined && node.label !== node.id) {
        lines.push(`    state "${node.label}" as ${node.id}`);
      }
    }
    for (const edge of normalized.edges) {
      lines.push(`    ${edge.from} --> ${edge.to}${edge.label === undefined ? '' : `: ${edge.label}`}`);
    }
    return lines.join('\n');
  }

  const lines = ['flowchart TD'];
  for (const node of normalized.nodes) {
    lines.push(`    ${node.id}["${displayLabel(node)}"]`);
  }
  for (const edge of normalized.edges) {
    lines.push(edge.label === undefined
      ? `    ${edge.from} --> ${edge.to}`
      : `    ${edge.from} -->|${edge.label}| ${edge.to}`);
  }
  return lines.join('\n');

}
