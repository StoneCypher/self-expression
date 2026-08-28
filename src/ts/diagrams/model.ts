/**
 * The shared graph model for the diagram renderers: nodes, edges, and the
 * normalization that turns a caller's edge list into a validated {@link Digraph}.
 *
 * Diagrams draw structure on a single-width monospace character grid, so the model
 * layer is where grid-hostile text is rejected: double-width glyphs (emoji, CJK),
 * combining marks, and embedded newlines all corrupt column alignment silently if
 * they reach the drawing surface, so they are a `RangeError` here instead
 * (`2026-08-27-diagrams-design.md` § Rendering-compatibility constraints).
 *
 * Pure: no I/O, no store access, no clock, no randomness.
 *
 * @see ./grid.js
 * @see ./layout.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */

/** One vertex of a diagram: its identity, and optionally a display label. */
export interface DiagramNode {
  /** The node's unique identity, referenced by edges. */
  id: string;
  /** The text drawn inside the node's box; defaults to `id` when absent. */
  label?: string;
}

/** One directed edge of a diagram, optionally labeled (e.g. by a transition action). */
export interface DiagramEdge {
  /** The id of the node this edge leaves. */
  from: string;
  /** The id of the node this edge enters. */
  to: string;
  /** The text drawn along the edge, if any — an action, a dependency kind, a verb. */
  label?: string;
}

/** A validated directed graph: the input shape every diagram renderer draws from. */
export interface Digraph {
  /** Every node exactly once, in first-appearance order. */
  nodes: readonly DiagramNode[];
  /** Every edge, in input order; parallel edges and self-loops are legal. */
  edges: readonly DiagramEdge[];
}

/**
 * Matches any single character that cannot sit on a single-width monospace grid:
 * combining marks (zero width), emoji and pictographs (double width), and the East
 * Asian wide and fullwidth blocks (double width). One shared definition so the model,
 * the parser, and the renderers all reject the same vocabulary.
 */
const GRID_HOSTILE = new RegExp(
  '[\\p{M}\\p{Extended_Pictographic}]'
  + '|[\\u1100-\\u115F\\u2E80-\\u303E\\u3041-\\u33FF\\u3400-\\u4DBF\\u4E00-\\u9FFF]'
  + '|[\\uA000-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6]'
  + '|[\\u{1F000}-\\u{1FFFF}]|[\\u{20000}-\\u{3FFFD}]',
  'u',
);

/**
 * Guards that `text` can be drawn on the single-width grid: no control characters or
 * newlines (they break the line structure) and no double-width or combining glyphs
 * (they break column alignment). Shared by every diagram entry point that accepts
 * caller text — silently corrupting the grid is the failure class this module exists
 * to prevent.
 *
 * @param text the caller-supplied text about to be drawn
 * @param what names the offending field in the error, e.g. `"node id 'a'"`
 *
 * @example
 *   requireGridSafe('locked', "node id 'locked'");   // returns quietly
 *
 * @throws {RangeError} If `text` contains a control character, a newline, a combining
 *                        mark, or a double-width glyph such as an emoji or CJK
 *                        character.
 * @see normalizeGraph
 */
export function requireGridSafe(text: string, what: string): void {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f || cp === 0x2028 || cp === 0x2029) {
      throw new RangeError(
        `${what} contains a control character or newline, which cannot sit on the diagram grid`
      );
    }
    if (GRID_HOSTILE.test(ch)) {
      throw new RangeError(
        `${what} contains '${ch}', a double-width or combining character; diagram text must `
        + 'be single-width (no emoji, CJK, or combining marks) so columns stay aligned'
      );
    }
  }
}

/** Validates one node's id and optional label; `what` names the node in errors. */
function requireNodeDrawable(node: DiagramNode): void {
  if (node.id === '') { throw new RangeError('a diagram node id must be non-empty'); }
  requireGridSafe(node.id, `node id '${node.id}'`);
  if (node.label !== undefined) {
    if (node.label === '') {
      throw new RangeError(`node '${node.id}' has an empty label; omit the label to use the id`);
    }
    requireGridSafe(node.label, `the label of node '${node.id}'`);
  }
}

/**
 * The text a node draws inside its box: its label when present, its id otherwise.
 *
 * @example
 *   displayLabel({ id: 'a', label: 'alpha' })   // => 'alpha'
 *   displayLabel({ id: 'a' })                   // => 'a'
 */
export function displayLabel(node: DiagramNode): string {
  return node.label ?? node.id;
}

/**
 * Builds a validated {@link Digraph} from an edge list, inferring the node set from
 * edge endpoints (in first-appearance order) when `nodes` is not given, and checking
 * everything a renderer relies on: unique node ids, no dangling edge references, and
 * grid-safe text throughout.
 *
 * @param edges the graph's edges; may be empty only when `nodes` supplies at least
 *               one node, since a diagram of nothing is unrenderable
 * @param nodes the explicit node set, when node order or labels matter; every edge
 *               endpoint must appear in it
 *
 * @example
 *   normalizeGraph([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])
 *   // => { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [...] }
 *
 * @throws {RangeError} If two nodes share an id, an edge references a node absent
 *                        from an explicit `nodes` list, the graph has no nodes at
 *                        all, or any id or label fails {@link requireGridSafe}.
 * @see requireGridSafe
 */
export function normalizeGraph(
  edges: readonly DiagramEdge[],
  nodes?: readonly DiagramNode[],
): Digraph {

  for (const edge of edges) {
    if (edge.from === '' || edge.to === '') {
      throw new RangeError('a diagram edge must name non-empty from and to node ids');
    }
    requireGridSafe(edge.from, `edge endpoint '${edge.from}'`);
    requireGridSafe(edge.to, `edge endpoint '${edge.to}'`);
    if (edge.label !== undefined) {
      if (edge.label === '') {
        throw new RangeError(
          `the edge '${edge.from}' -> '${edge.to}' has an empty label; omit the label instead`
        );
      }
      requireGridSafe(edge.label, `the label of edge '${edge.from}' -> '${edge.to}'`);
    }
  }

  let resolved: DiagramNode[];

  if (nodes === undefined) {
    resolved = [];
    const seen = new Set<string>();
    for (const edge of edges) {
      for (const id of [edge.from, edge.to]) {
        if (!seen.has(id)) {
          seen.add(id);
          resolved.push({ id });
        }
      }
    }
  } else {
    const seen = new Set<string>();
    for (const node of nodes) {
      requireNodeDrawable(node);
      if (seen.has(node.id)) {
        throw new RangeError(`duplicate node id '${node.id}'; node ids must be unique`);
      }
      seen.add(node.id);
    }
    for (const edge of edges) {
      for (const id of [edge.from, edge.to]) {
        if (!seen.has(id)) {
          throw new RangeError(
            `edge '${edge.from}' -> '${edge.to}' references '${id}', which is not in the node list`
          );
        }
      }
    }
    resolved = nodes.map(n => (n.label === undefined ? { id: n.id } : { id: n.id, label: n.label }));
  }

  if (resolved.length === 0) {
    throw new RangeError('a diagram needs at least one node; supply edges or a node list');
  }

  return { nodes: resolved, edges: edges.map(e => (
    e.label === undefined ? { from: e.from, to: e.to } : { from: e.from, to: e.to, label: e.label }
  )) };

}
