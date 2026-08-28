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

import { expandWaypoints } from './grid.js';
import type { GridPoint }  from './grid.js';
import { displayLabel }    from './model.js';
import type { Digraph }    from './model.js';

/**
 * The legibility threshold: layout refuses graphs with more nodes than this. Chosen
 * from typical 78-column capacity (spec § Open questions, shipped as a reviewable
 * constant to tune against real use), not measured law.
 */
export const MAX_DIAGRAM_NODES = 20;

/**
 * The fallback menu every layout refusal names, so the caller's next action is named
 * rather than guessed: the inline FSL form, a plain adjacency list, or the mermaid
 * emission for a destination that renders it.
 */
export const DIAGRAM_FALLBACKS: string =
  "fall back to the one-line FSL form (renderFsl / render_timeline form 'fsl'), a plain "
  + "adjacency list in text, or the mermaid export (toMermaid / emit: 'mermaid') for a "
  + 'destination with a mermaid renderer';

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

/** Unwraps a value that the layout's own arithmetic guarantees present. */
function req<T>(value: T | undefined, what: string): T {
  if (value === undefined) { throw new Error(`layout internal: missing ${what}`); }
  return value;
}

/**
 * Evenly spaced attachment columns along a box border's interior, preferring a gap
 * between neighbors, falling back to adjacent columns, refusing when the border
 * cannot hold them all.
 *
 * @throws {RangeError} If `count` exceeds the border's interior width — the graph is
 *                        too tangled at this node to draw legibly.
 */
function slotColumns(x: number, width: number, count: number, id: string): number[] {
  if (count === 0) { return []; }
  const interior = width - 2;
  const spread = (step: number, used: number): number[] => {
    const start = x + 1 + Math.floor((interior - used) / 2);
    return Array.from({ length: count }, (_v, k) => start + step * k);
  };
  if (2 * count - 1 <= interior) { return spread(2, 2 * count - 1); }
  if (count <= interior) { return spread(1, count); }
  throw new RangeError(
    `node '${id}' needs ${String(count)} edge attachment points but its box border fits `
    + `${String(interior)}; this graph is too tangled to draw legibly — ${DIAGRAM_FALLBACKS}`
  );
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
export function layoutDigraph(graph: Digraph, options: DigraphLayoutOptions): DigraphLayout {

  const nodes = graph.nodes;
  const edges = graph.edges;
  const n = nodes.length;

  if (n > MAX_DIAGRAM_NODES) {
    throw new RangeError(
      `a diagram of ${String(n)} nodes is past the legibility threshold of `
      + `${String(MAX_DIAGRAM_NODES)}; ${DIAGRAM_FALLBACKS}`
    );
  }

  const indexOf = new Map<string, number>(nodes.map((node, i) => [node.id, i]));
  const labels = nodes.map(node => options.labels?.get(node.id) ?? displayLabel(node));

  const from = edges.map(e => req(indexOf.get(e.from), `node '${e.from}'`));
  const to = edges.map(e => req(indexOf.get(e.to), `node '${e.to}'`));

  // ---- back-edge detection (DFS over edges in input order) -----------------------
  const outEdges: number[][] = nodes.map(() => []);
  edges.forEach((_e, ei) => { req(outEdges[req(from[ei], 'from')], 'outEdges').push(ei); });

  const isBack: boolean[] = edges.map(() => false);
  const color: number[] = nodes.map(() => 0);
  const dfs = (u: number): void => {
    color[u] = 1;
    for (const ei of req(outEdges[u], 'outEdges row')) {
      const v = req(to[ei], 'to');
      if (color[v] === 1) { isBack[ei] = true; }
      else if (color[v] === 0) { dfs(v); }
    }
    color[u] = 2;
  };
  for (let u = 0; u < n; u++) { if (color[u] === 0) { dfs(u); } }

  // ---- longest-path layering over forward edges ----------------------------------
  const layer: number[] = nodes.map(() => 0);
  const indeg: number[] = nodes.map(() => 0);
  edges.forEach((_e, ei) => {
    if (req(isBack[ei], 'isBack')) { return; }
    const v = req(to[ei], 'to');
    indeg[v] = req(indeg[v], 'indeg') + 1;
  });
  const queue: number[] = [];
  for (let u = 0; u < n; u++) { if (indeg[u] === 0) { queue.push(u); } }
  while (queue.length > 0) {
    const u = req(queue.shift(), 'queue head');
    for (const ei of req(outEdges[u], 'outEdges row')) {
      if (req(isBack[ei], 'isBack')) { continue; }
      const v = req(to[ei], 'to');
      layer[v] = Math.max(req(layer[v], 'layer'), req(layer[u], 'layer') + 1);
      indeg[v] = req(indeg[v], 'indeg') - 1;
      if (indeg[v] === 0) { queue.push(v); }
    }
  }

  const layerCount = Math.max(...layer) + 1;
  const layerNodes: number[][] = Array.from({ length: layerCount }, () => []);
  nodes.forEach((_node, i) => { req(layerNodes[req(layer[i], 'layer')], 'layer row').push(i); });

  // ---- barycenter ordering within layers -----------------------------------------
  const pos: number[] = nodes.map(() => 0);
  const refresh = (): void => {
    for (const row of layerNodes) { row.forEach((node, idx) => { pos[node] = idx; }); }
  };
  refresh();

  const preds: number[][] = nodes.map(() => []);
  const succs: number[][] = nodes.map(() => []);
  edges.forEach((_e, ei) => {
    if (req(isBack[ei], 'isBack')) { return; }
    req(preds[req(to[ei], 'to')], 'preds').push(req(from[ei], 'from'));
    req(succs[req(from[ei], 'from')], 'succs').push(req(to[ei], 'to'));
  });

  const sortRow = (row: number[], neighborsOf: readonly number[][]): void => {
    const key = new Map<number, number>();
    for (const node of row) {
      const ns = req(neighborsOf[node], 'neighbors');
      const self = req(pos[node], 'pos');
      key.set(node, ns.length === 0
        ? self
        : ns.reduce((sum, nb) => sum + req(pos[nb], 'pos'), 0) / ns.length);
    }
    row.sort((a, b) =>
      (req(key.get(a), 'key') - req(key.get(b), 'key')) || (req(pos[a], 'pos') - req(pos[b], 'pos')));
  };

  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < layerCount; l++) { sortRow(req(layerNodes[l], 'row'), preds); refresh(); }
    for (let l = layerCount - 2; l >= 0; l--) { sortRow(req(layerNodes[l], 'row'), succs); refresh(); }
  }

  // ---- box geometry ---------------------------------------------------------------
  const boxX: number[] = nodes.map(() => 0);
  const boxW: number[] = nodes.map((_node, i) => req(labels[i], 'label').length + 4);
  let contentWidth = 0;
  for (const row of layerNodes) {
    let x = 0;
    for (const node of row) {
      boxX[node] = x;
      x += req(boxW[node], 'boxW') + 2;
    }
    contentWidth = Math.max(contentWidth, x - 2);
  }
  const centerOf = (i: number): number => req(boxX[i], 'boxX') + Math.floor(req(boxW[i], 'boxW') / 2);

  // ---- attachment slots -----------------------------------------------------------
  const exitX: number[] = edges.map(() => 0);
  const entryX: number[] = edges.map(() => 0);

  for (let u = 0; u < n; u++) {
    const outs = [...req(outEdges[u], 'outEdges row')];
    outs.sort((a, b) => (centerOf(req(to[a], 'to')) - centerOf(req(to[b], 'to'))) || (a - b));
    const cols = slotColumns(req(boxX[u], 'boxX'), req(boxW[u], 'boxW'), outs.length, req(nodes[u], 'node').id);
    outs.forEach((ei, k) => { exitX[ei] = req(cols[k], 'slot'); });

    const ins: number[] = [];
    edges.forEach((_e, ei) => { if (to[ei] === u) { ins.push(ei); } });
    ins.sort((a, b) => (centerOf(req(from[a], 'from')) - centerOf(req(from[b], 'from'))) || (a - b));
    const inCols = slotColumns(req(boxX[u], 'boxX'), req(boxW[u], 'boxW'), ins.length, req(nodes[u], 'node').id);
    ins.forEach((ei, k) => { entryX[ei] = req(inCols[k], 'slot'); });
  }

  // ---- edge classification and jog rows -------------------------------------------
  // Gutters: index g in [0, layerCount]; g < layerCount sits above layer g, and
  // g === layerCount sits below the last layer. An edge exits into the gutter below
  // its source (fromLayer + 1) and enters from the gutter above its target (toLayer).
  const viaCorridor = edges.map((_e, ei) =>
    req(isBack[ei], 'isBack') || req(layer[req(to[ei], 'to')], 'layer') > req(layer[req(from[ei], 'from')], 'layer') + 1);

  const jogOrdinal = new Map<string, number>();
  const jogCount: number[] = Array.from({ length: layerCount + 1 }, () => 0);
  const addJog = (gutter: number, key: string): void => {
    jogOrdinal.set(key, req(jogCount[gutter], 'jogCount'));
    jogCount[gutter] = req(jogCount[gutter], 'jogCount') + 1;
  };
  edges.forEach((_e, ei) => {
    const exitGutter = req(layer[req(from[ei], 'from')], 'layer') + 1;
    const entryGutter = req(layer[req(to[ei], 'to')], 'layer');
    if (req(viaCorridor[ei], 'viaCorridor')) {
      addJog(exitGutter, `${String(ei)}:exit`);
      addJog(entryGutter, `${String(ei)}:entry`);
    } else if (exitX[ei] !== entryX[ei]) {
      addJog(exitGutter, `${String(ei)}:jog`);
    }
  });

  const gutterHeight: number[] = jogCount.map((count, g) => {
    const outer = g === 0 || g === layerCount;
    return outer && count === 0 ? 0 : count + 2;
  });

  // ---- vertical positions -----------------------------------------------------------
  const gutterTop: number[] = Array.from({ length: layerCount + 1 }, () => 0);
  const layerTop: number[] = Array.from({ length: layerCount }, () => 0);
  let y = 0;
  for (let l = 0; l < layerCount; l++) {
    gutterTop[l] = y; y += req(gutterHeight[l], 'gutterHeight');
    layerTop[l] = y; y += 3;
  }
  gutterTop[layerCount] = y; y += req(gutterHeight[layerCount], 'gutterHeight');
  const surfaceHeight = y;

  // ---- corridor columns and the width budget -----------------------------------------
  const corridorEdges: number[] = [];
  edges.forEach((_e, ei) => { if (req(viaCorridor[ei], 'viaCorridor')) { corridorEdges.push(ei); } });
  const corridorCol = new Map<number, number>();
  corridorEdges.forEach((ei, k) => { corridorCol.set(ei, contentWidth + 1 + 2 * k); });

  const surfaceWidth = corridorEdges.length === 0
    ? contentWidth
    : contentWidth + 2 * corridorEdges.length;

  if (surfaceWidth > options.surfaceWidth) {
    throw new RangeError(
      `this diagram needs ${String(surfaceWidth)} columns but the width budget is `
      + `${String(options.surfaceWidth)}; ${DIAGRAM_FALLBACKS}`
    );
  }

  // ---- routes -------------------------------------------------------------------------
  const routes: RoutedEdge[] = edges.map((edge, ei) => {
    const srcLayer = req(layer[req(from[ei], 'from')], 'layer');
    const dstLayer = req(layer[req(to[ei], 'to')], 'layer');
    const ex = req(exitX[ei], 'exitX');
    const nx = req(entryX[ei], 'entryX');
    const srcBottom = req(layerTop[srcLayer], 'layerTop') + 2;

    let waypoints: GridPoint[];

    if (!req(viaCorridor[ei], 'viaCorridor')) {
      const g = srcLayer + 1;
      const arrowRow = req(gutterTop[g], 'gutterTop') + req(gutterHeight[g], 'gutterHeight') - 1;
      if (ex === nx) {
        waypoints = [{ x: ex, y: srcBottom }, { x: ex, y: arrowRow }];
      } else {
        const jr = req(gutterTop[g], 'gutterTop') + 1 + req(jogOrdinal.get(`${String(ei)}:jog`), 'jog');
        waypoints = [
          { x: ex, y: srcBottom }, { x: ex, y: jr }, { x: nx, y: jr }, { x: nx, y: arrowRow },
        ];
      }
    } else {
      const exitGutter = srcLayer + 1;
      const entryGutter = dstLayer;
      const ejr = req(gutterTop[exitGutter], 'gutterTop') + 1
        + req(jogOrdinal.get(`${String(ei)}:exit`), 'exit jog');
      const njr = req(gutterTop[entryGutter], 'gutterTop') + 1
        + req(jogOrdinal.get(`${String(ei)}:entry`), 'entry jog');
      const arrowRow = req(gutterTop[entryGutter], 'gutterTop')
        + req(gutterHeight[entryGutter], 'gutterHeight') - 1;
      const c = req(corridorCol.get(ei), 'corridor column');
      waypoints = [
        { x: ex, y: srcBottom }, { x: ex, y: ejr }, { x: c, y: ejr },
        { x: c, y: njr }, { x: nx, y: njr }, { x: nx, y: arrowRow },
      ];
    }

    const points = expandWaypoints(waypoints);
    return edge.label === undefined
      ? { from: edge.from, to: edge.to, points }
      : { from: edge.from, to: edge.to, label: edge.label, points };
  });

  const boxes: NodeBox[] = nodes.map((node, i) => ({
    id: node.id,
    label: req(labels[i], 'label'),
    x: req(boxX[i], 'boxX'),
    y: req(layerTop[req(layer[i], 'layer')], 'layerTop'),
    width: req(boxW[i], 'boxW'),
    height: 3,
  }));

  return { surfaceWidth, surfaceHeight, boxes, routes };

}
