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
export declare function requireGridSafe(text: string, what: string): void;
/**
 * The text a node draws inside its box: its label when present, its id otherwise.
 *
 * @example
 *   displayLabel({ id: 'a', label: 'alpha' })   // => 'alpha'
 *   displayLabel({ id: 'a' })                   // => 'a'
 */
export declare function displayLabel(node: DiagramNode): string;
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
export declare function normalizeGraph(edges: readonly DiagramEdge[], nodes?: readonly DiagramNode[]): Digraph;
//# sourceMappingURL=model.d.ts.map