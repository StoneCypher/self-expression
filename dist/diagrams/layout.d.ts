/**
 * Layered layout for digraphs — deliberately modest, per the design spec: longest-path
 * layering, barycenter ordering within layers (a heuristic, explicitly not optimal),
 * and orthogonal edge routing on the grid.
 *
 * The shape of a drawing: layers stack top to bottom, each node a 3-row framed box;
 * between layers sit gutters where edges run. Every edge leaves its source through the
 * bottom border and enters its target through the top border with a `▼`, which makes
 * arrow direction uniform and legible. Edges to the next layer route inside one gutter
 * (straight, or with one horizontal jog on a row of their own); every other edge —
 * spanning multiple layers, looping back, or self-referencing — routes out to its own
 * corridor column on the right, giving cycles the classic wrap-around return arrow.
 * Back edges are found by depth-first search and never used for layering, so a
 * two-state toggle draws as two boxes with a forward and a return arrow rather than
 * recursing.
 *
 * Refusal is a feature: a graph past {@link MAX_DIAGRAM_NODES} nodes, a node with more
 * edges than its box has border cells, or a drawing wider than the budget is a
 * `RangeError` naming the fallbacks ({@link DIAGRAM_FALLBACKS}) — a wrapped or tangled
 * diagram is worse than no diagram.
 *
 * Pure and deterministic: identical input always yields the identical layout.
 *
 * @see ./grid.js
 * @see ./renderers.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */
import type { GridPoint } from './grid.js';
import type { Digraph } from './model.js';
/**
 * The legibility threshold: layout refuses graphs with more nodes than this. Chosen
 * from typical 78-column capacity (spec § Open questions, shipped as a reviewable
 * constant to tune against real use), not measured law.
 */
export declare const MAX_DIAGRAM_NODES = 20;
/**
 * The fallback menu every layout refusal names, so the caller's next action is named
 * rather than guessed: the inline FSL form, a plain adjacency list, or the mermaid
 * emission for a destination that renders it.
 */
export declare const DIAGRAM_FALLBACKS: string;
/** One node's placed box: position and size in grid cells, plus its display label. */
export interface NodeBox {
    /** The node's id, matching the graph. */
    id: string;
    /** The text drawn inside the box (already includes any active-state marker). */
    label: string;
    /** Left column of the box border. */
    x: number;
    /** Top row of the box border. */
    y: number;
    /** Total box width including borders: label length + 4. */
    width: number;
    /** Total box height including borders; always 3 in this layout. */
    height: number;
}
/** One routed edge: its endpoints, optional label, and full unit-step cell path. */
export interface RoutedEdge {
    /** Source node id. */
    from: string;
    /** Target node id. */
    to: string;
    /** The edge's label, when it has one; placement is the renderer's job. */
    label?: string;
    /**
     * Every cell of the path in order, from the attachment cell on the source's bottom
     * border to the arrowhead cell just above the target's top border.
     */
    points: readonly GridPoint[];
}
/** A finished digraph layout, ready to draw: geometry only, no characters yet. */
export interface DigraphLayout {
    /** Columns the drawing needs; guaranteed ≤ the requested budget. */
    surfaceWidth: number;
    /** Rows the drawing needs. */
    surfaceHeight: number;
    /** Every node's placed box. */
    boxes: readonly NodeBox[];
    /** Every edge's route, in the graph's edge order. */
    routes: readonly RoutedEdge[];
}
/** Options for {@link layoutDigraph}. */
export interface DigraphLayoutOptions {
    /** The width budget in columns; a layout that cannot fit refuses rather than wraps. */
    surfaceWidth: number;
    /** Per-node display-label overrides (e.g. the state form's `▶ ` active marker). */
    labels?: ReadonlyMap<string, string> | undefined;
}
/**
 * Computes the full layered layout for a validated digraph: layer assignment,
 * barycenter ordering, box placement, and an orthogonal route (with arrowhead cell)
 * for every edge.
 *
 * @param graph   a {@link Digraph}, normally from `normalizeGraph` or `parseFsl`
 * @param options the width budget and optional per-node display labels
 *
 * @example
 *   const graph = parseFsl("locked 'coin' -> unlocked 'push' -> locked;");
 *   const layout = layoutDigraph(graph, { surfaceWidth: 74 });
 *   // layout.boxes: locked at the top, unlocked below it;
 *   // layout.routes: a straight forward edge and a wrap-around return edge
 *
 * @throws {RangeError} If the graph exceeds {@link MAX_DIAGRAM_NODES} nodes, a node
 *                        has more edges than its box border can attach, or the
 *                        drawing cannot fit `surfaceWidth` columns; each refusal
 *                        names {@link DIAGRAM_FALLBACKS}.
 * @see ./renderers.js
 */
export declare function layoutDigraph(graph: Digraph, options: DigraphLayoutOptions): DigraphLayout;
//# sourceMappingURL=layout.d.ts.map