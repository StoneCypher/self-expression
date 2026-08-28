/**
 * The public diagram forms: state diagram, digraph, tree, and sequence — data in,
 * exact framed ASCII string out, the error class of hand-drawn diagrams (misaligned
 * edges, arrows touching the wrong box, ragged margins) prevented rather than
 * detected.
 *
 * All four share the rendering-compatibility constraints from the design spec:
 * single-width glyphs only (light box-drawing set plus `▶ ◀ ▲ ▼` arrowheads), a
 * width budget defaulting to {@link DEFAULT_DIAGRAM_WIDTH} columns, framed output by
 * default, no trailing whitespace ever, and refusal — naming fallbacks — over an
 * illegible or wrapped drawing. Emit the result inside a ` ```text ` fence; outside
 * one, proportional fonts destroy the alignment these renderers guarantee.
 *
 * Pure: no I/O, no store access, no clock, no randomness.
 *
 * @see ./layout.js
 * @see ./grid.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */

import {
  makeGrid, drawBox, drawText, drawPath, expandWaypoints, renderGrid, renderLines, vline, attach,
} from './grid.js';
import type { CharGrid }   from './grid.js';
import { layoutDigraph, MAX_DIAGRAM_NODES, DIAGRAM_FALLBACKS } from './layout.js';
import type { RoutedEdge } from './layout.js';
import { normalizeGraph, requireGridSafe } from './model.js';
import type { Digraph }    from './model.js';
import { parseFsl }        from './fsl.js';

/**
 * The default maximum output width in columns, frame included: fits an 80-column
 * terminal inside a code fence without wrapping.
 */
export const DEFAULT_DIAGRAM_WIDTH = 78;

/** The marker prefixed to the active state's label — bolding does not exist in a fence. */
const ACTIVE_MARK = '▶ ';

/** Options shared by every diagram form. */
export interface DiagramRenderOptions {
  /** Frame the diagram in a visible box; default true (see the ragged-edge finding). */
  frame?: boolean | undefined;
  /** Maximum output width in columns, frame included; default {@link DEFAULT_DIAGRAM_WIDTH}. */
  width?: number | undefined;
}

/** Options for {@link renderStateDiagram}. */
export interface StateDiagramOptions extends DiagramRenderOptions {
  /** The state currently occupied, if known; its box's label gets a `▶ ` marker. */
  activeState?: string | undefined;
}

/**
 * Resolves the drawing-surface budget: the requested width minus the frame's four
 * columns when framed.
 *
 * @throws {RangeError} If `width` is not an integer of at least 12 — narrower cannot
 *                        hold even a one-letter box plus frame.
 */
function surfaceBudget(width: number | undefined, frame: boolean, fn: string): number {
  const w = width ?? DEFAULT_DIAGRAM_WIDTH;
  if (!Number.isInteger(w) || w < 12) {
    throw new RangeError(`${fn} needs an integer width of at least 12; received ${String(w)}`);
  }
  return frame ? w - 4 : w;
}

/**
 * Places one edge's label: preferably interrupting the longest horizontal run of its
 * path (` label ` centered, at least one line cell surviving on each side, so the
 * edge stays traceable); failing that, beside the middle of its longest vertical run
 * where the cells are still empty; failing both, dropped — the edge is kept, per the
 * spec, because a lost label degrades less than a corrupted grid.
 */
function placeEdgeLabel(grid: CharGrid, route: RoutedEdge): void {
  const label = route.label;
  if (label === undefined) { return; }

  const body = route.points.slice(0, -1);   // never write over the arrowhead cell

  interface Run { horizontal: boolean; cells: { x: number; y: number }[] }
  const runs: Run[] = [];
  for (const point of body) {
    const current = runs[runs.length - 1];
    const prev = current?.cells[current.cells.length - 1];
    if (current !== undefined && prev !== undefined) {
      if (current.horizontal && point.y === prev.y) { current.cells.push(point); continue; }
      if (!current.horizontal && point.x === prev.x) { current.cells.push(point); continue; }
      runs.push({ horizontal: point.y === prev.y, cells: [prev, point] });
      continue;
    }
    runs.push({ horizontal: true, cells: [point] });
  }

  const padded = ` ${label} `;
  let bestH: Run | undefined = undefined;
  let bestV: Run | undefined = undefined;
  for (const run of runs) {
    if (run.horizontal && run.cells.length > (bestH?.cells.length ?? 1)) { bestH = run; }
    if (!run.horizontal && run.cells.length > (bestV?.cells.length ?? 1)) { bestV = run; }
  }

  if (bestH !== undefined && bestH.cells.length >= padded.length + 2) {
    const xs = bestH.cells.map(c => c.x);
    const low = Math.min(...xs);
    const first = bestH.cells[0];
    const yRow = first === undefined ? 0 : first.y;
    const offset = Math.floor((bestH.cells.length - padded.length) / 2);
    drawText(grid, low + offset, yRow, padded);
    return;
  }

  if (bestV === undefined) { return; }

  const clearAt = (x: number, y: number, length: number): boolean => {
    if (x < 0 || x + length > grid.width) { return false; }
    const row = grid.cells[y];
    if (row === undefined) { return false; }
    for (let k = 0; k < length; k++) {
      if (row[x + k] !== ' ') { return false; }
    }
    return true;
  };

  // Candidate anchors: the middle of the run first, then the rest top to bottom,
  // skipping the first cell (it sits on the source's border). Right side preferred,
  // left side as a last resort.
  const cells = bestV.cells.slice(1);
  const mid = Math.floor(cells.length / 2);
  const anchors = [
    ...(cells[mid] === undefined ? [] : [cells[mid]]),
    ...cells.filter((_c, k) => k !== mid),
  ];
  for (const side of ['right', 'left'] as const) {
    for (const anchor of anchors) {
      // A one-cell breathing gap between the line (or its corner) and the text.
      const tx = side === 'right' ? anchor.x + 2 : anchor.x - 1 - label.length;
      const guard = side === 'right' ? tx - 1 : tx;
      if (clearAt(guard, anchor.y, label.length + 1)) { drawText(grid, tx, anchor.y, label); return; }
    }
  }
}

/** The shared draw pass behind {@link renderStateDiagram} and {@link renderDigraph}. */
function drawDigraphForm(
  graph: Digraph,
  labels: ReadonlyMap<string, string> | undefined,
  frame: boolean,
  budget: number,
): string {
  const layout = layoutDigraph(graph, { surfaceWidth: budget, labels });
  const grid = makeGrid(budget, layout.surfaceHeight);
  for (const box of layout.boxes) {
    drawBox(grid, box.x, box.y, box.width, box.height);
    drawText(grid, box.x + 2, box.y + 1, box.label);
  }
  for (const route of layout.routes) { drawPath(grid, route.points); }
  for (const route of layout.routes) { placeEdgeLabel(grid, route); }
  return renderGrid(grid, { frame });
}

/**
 * Renders a state machine as boxes and labeled arrows: layers top to bottom, every
 * transition entering its target from above with a `▼`, cycles drawn as wrap-around
 * return arrows on the right. Input is either a {@link Digraph} or FSL-subset source
 * (the text `renderFsl` emits); the active state — a display fact, not topology — is
 * marked with `▶ ` inside its box, since bolding does not exist inside a code fence.
 *
 * @param machine a graph, or FSL-subset source such as `"a 'go' -> b;"`
 * @param options `activeState` plus the shared frame/width options
 *
 * @example
 *   renderStateDiagram("locked 'coin' -> unlocked 'push' -> locked;")
 *   // => a framed drawing: locked's box above unlocked's, a labeled 'coin' arrow
 *   //    down, and a labeled 'push' return arrow wrapping around the right side
 *
 * @throws {RangeError} If the FSL source is outside the parser's subset, the graph
 *                        fails validation, `activeState` names an unknown state, or
 *                        layout refuses (too many nodes, too tangled, or over the
 *                        width budget) — refusals name the fallbacks.
 * @see parseFsl
 * @see renderDigraph
 */
export function renderStateDiagram(machine: Digraph | string, options?: StateDiagramOptions): string {
  const graph = typeof machine === 'string'
    ? parseFsl(machine)
    : normalizeGraph(machine.edges, machine.nodes);

  const active = options?.activeState;
  let labels: Map<string, string> | undefined = undefined;
  if (active !== undefined) {
    const node = graph.nodes.find(candidate => candidate.id === active);
    if (node === undefined) {
      throw new RangeError(
        `activeState '${active}' is not a state of this machine; known states: `
        + graph.nodes.map(candidate => candidate.id).join(', ')
      );
    }
    labels = new Map([[node.id, `${ACTIVE_MARK}${node.label ?? node.id}`]]);
  }

  const frame = options?.frame ?? true;
  return drawDigraphForm(graph, labels, frame, surfaceBudget(options?.width, frame, 'renderStateDiagram'));
}

/**
 * Renders a directed graph — dependencies, call flows, data lineage — with the same
 * drawing engine as {@link renderStateDiagram} but no state-machine affordances.
 * Reach for it the moment structure branches, merges, cycles, or fans in or out; a
 * straight line is better served by the inline chain forms.
 *
 * @param graph the graph to draw; run through `normalizeGraph` internally, so a
 *               hand-built edge list is fine
 *
 * @example
 *   renderDigraph(normalizeGraph([
 *     { from: 'claude', to: 'root' }, { from: 'codex', to: 'root' },
 *     { from: 'root', to: 'skills' }, { from: 'root', to: 'commands' },
 *   ]))
 *   // => a framed fan-in/fan-out drawing: two manifests converging on root,
 *   //    root forking to skills and commands
 *
 * @throws {RangeError} If the graph fails validation or layout refuses (too many
 *                        nodes, too tangled, or over the width budget) — refusals
 *                        name the fallbacks.
 * @see renderStateDiagram
 * @see renderTree
 */
export function renderDigraph(graph: Digraph, options?: DiagramRenderOptions): string {
  const normalized = normalizeGraph(graph.edges, graph.nodes);
  const frame = options?.frame ?? true;
  return drawDigraphForm(normalized, undefined, frame, surfaceBudget(options?.width, frame, 'renderDigraph'));
}

/** Options for {@link renderTree}. */
export interface TreeRenderOptions extends DiagramRenderOptions {
  /** Display labels by node id; a node absent from the map draws its id. */
  labels?: Readonly<Record<string, string>> | undefined;
}

/**
 * Renders a strict hierarchy — a decision tree, a module tree with annotations — as
 * a connector tree (`├─`/`└─`/`│`), the simpler tidy layout the spec reserves for
 * input that is genuinely a tree. Non-tree input is refused by naming the first node
 * that appears under two parents (or in a cycle), so the caller knows to use
 * {@link renderDigraph} instead.
 *
 * @param root     the root node's id
 * @param children each node's ordered children, by parent id; ids absent from the
 *                  map are leaves, and every key must be reachable from `root`
 *
 * @example
 *   renderTree('plugin', { plugin: ['skills', 'commands'], commands: ['claude', 'gemini'] })
 *   // => '┌────────────────┐\n' +
 *   //    '│ plugin         │\n' +
 *   //    '│ ├─ skills      │\n' +
 *   //    '│ └─ commands    │\n' +
 *   //    '│    ├─ claude   │\n' +
 *   //    '│    └─ gemini   │\n' +
 *   //    '└────────────────┘'
 *
 * @throws {RangeError} If a node repeats (shared child or cycle — the error names
 *                        it), a `children` key is unreachable from `root`, the tree
 *                        exceeds the node threshold, or a line exceeds the width
 *                        budget; refusals name the fallbacks.
 * @see renderDigraph
 */
export function renderTree(
  root: string,
  children: Readonly<Record<string, readonly string[]>>,
  options?: TreeRenderOptions,
): string {

  if (root === '') { throw new RangeError('renderTree needs a non-empty root id'); }
  requireGridSafe(root, `root id '${root}'`);

  const frame = options?.frame ?? true;
  const budget = surfaceBudget(options?.width, frame, 'renderTree');
  const labels = options?.labels;

  const labelOf = (id: string): string => {
    const label = labels?.[id];
    if (label !== undefined) {
      if (label === '') { throw new RangeError(`node '${id}' has an empty label; omit it to use the id`); }
      requireGridSafe(label, `the label of node '${id}'`);
    }
    return label ?? id;
  };

  const seen = new Set<string>();
  const lines: string[] = [];

  const visit = (id: string, prefix: string, connector: string, childPrefix: string): void => {
    requireGridSafe(id, `node id '${id}'`);
    if (seen.has(id)) {
      throw new RangeError(
        `'${id}' appears more than once, so this is a graph rather than a tree (a shared `
        + 'node or a cycle); use renderDigraph for it instead'
      );
    }
    seen.add(id);
    if (seen.size > MAX_DIAGRAM_NODES) {
      throw new RangeError(
        `this tree is past the legibility threshold of ${String(MAX_DIAGRAM_NODES)} nodes; `
        + DIAGRAM_FALLBACKS
      );
    }
    lines.push(`${prefix}${connector}${labelOf(id)}`);
    const kids = Object.hasOwn(children, id) ? children[id] ?? [] : [];
    kids.forEach((kid, k) => {
      const last = k === kids.length - 1;
      visit(kid, prefix + childPrefix, last ? '└─ ' : '├─ ', last ? '   ' : '│  ');
    });
  };

  visit(root, '', '', '');

  for (const key of Object.keys(children)) {
    if (!seen.has(key)) {
      throw new RangeError(
        `children lists '${key}', which is not reachable from root '${root}'`
      );
    }
  }

  const widest = Math.max(...lines.map(l => l.length));
  if (widest > budget) {
    throw new RangeError(
      `this tree needs ${String(widest)} columns but the width budget allows `
      + `${String(budget)}; ${DIAGRAM_FALLBACKS}`
    );
  }

  return renderLines(lines, { frame });

}

/** One message of a sequence diagram: source actor, target actor, optional label. */
export interface SequenceMessage {
  /** The sending actor's name, which must appear in `actors`. */
  from: string;
  /** The receiving actor's name, which must appear in `actors`; may equal `from`. */
  to: string;
  /** The text drawn on its own row above the arrow, if any. */
  label?: string;
}

/**
 * Renders a sequence diagram: one boxed actor per column, a lifeline under each, and
 * one horizontal arrow row per message, top to bottom in message order — the shape
 * the issue thread singles out as the most painful to hand-draw and the most
 * mechanical to render (fixed lifeline columns, monotone rows, no layout search).
 * Self-messages draw as a small right-hand loop; labels sit on their own row above
 * their arrow.
 *
 * @param actors   the lifeline columns, left to right; unique, non-empty names
 * @param messages the messages in time order; may be empty (actors and lifelines
 *                  still draw)
 *
 * @example
 *   renderSequence(['human', 'agent'], [
 *     { from: 'human', to: 'agent', label: 'ask' },
 *     { from: 'agent', to: 'human', label: 'answer' },
 *   ])
 *   // => a framed drawing: two boxed actors, lifelines, an 'ask' arrow rightward
 *   //    and an 'answer' arrow back leftward, each labeled on the row above
 *
 * @throws {RangeError} If `actors` is empty, repeats a name, or exceeds the node
 *                        threshold; a message names an unknown actor; or the
 *                        drawing exceeds the width budget — refusals name the
 *                        fallbacks.
 * @see renderDigraph
 */
export function renderSequence(
  actors: readonly string[],
  messages: readonly SequenceMessage[],
  options?: DiagramRenderOptions,
): string {

  if (actors.length === 0) { throw new RangeError('renderSequence needs at least one actor'); }
  if (actors.length > MAX_DIAGRAM_NODES) {
    throw new RangeError(
      `a sequence of ${String(actors.length)} actors is past the legibility threshold of `
      + `${String(MAX_DIAGRAM_NODES)}; ${DIAGRAM_FALLBACKS}`
    );
  }
  const indexOf = new Map<string, number>();
  actors.forEach((actor, i) => {
    if (actor === '') { throw new RangeError('renderSequence actors must be non-empty'); }
    requireGridSafe(actor, `actor '${actor}'`);
    if (indexOf.has(actor)) { throw new RangeError(`duplicate actor '${actor}'`); }
    indexOf.set(actor, i);
  });
  for (const message of messages) {
    for (const end of [message.from, message.to]) {
      if (!indexOf.has(end)) {
        throw new RangeError(
          `message endpoint '${end}' is not an actor; actors: ${actors.join(', ')}`
        );
      }
    }
    if (message.label !== undefined) {
      if (message.label === '') {
        throw new RangeError('a sequence message label must be non-empty; omit it instead');
      }
      requireGridSafe(message.label, `the label of message '${message.from}' -> '${message.to}'`);
    }
  }

  const frame = options?.frame ?? true;
  const budget = surfaceBudget(options?.width, frame, 'renderSequence');

  // ---- columns: box lefts and lifeline x positions --------------------------------
  const boxW = actors.map(actor => actor.length + 4);
  const boxLeft: number[] = [];
  const lifeX: number[] = [];
  let requiredBeyondLast = 0;

  actors.forEach((_actor, i) => {
    const w = boxW[i] ?? 0;
    if (i === 0) { boxLeft.push(0); lifeX.push(Math.floor(w / 2)); return; }
    const prevW = boxW[i - 1] ?? 0;
    const prevLeft = boxLeft[i - 1] ?? 0;
    const prevX = lifeX[i - 1] ?? 0;
    let gap = (prevLeft + prevW + 2 + Math.floor(w / 2)) - prevX;   // boxes 2 apart minimum
    for (const message of messages) {
      const a = indexOf.get(message.from) ?? 0;
      const b = indexOf.get(message.to) ?? 0;
      const left = Math.min(a, b);
      if (left !== i - 1) { continue; }
      if (a === b) { gap = Math.max(gap, 6); }
      if (message.label !== undefined) { gap = Math.max(gap, message.label.length + 4); }
    }
    const x = prevX + gap;
    lifeX.push(x);
    boxLeft.push(x - Math.floor(w / 2));
  });

  for (const message of messages) {
    const a = indexOf.get(message.from) ?? 0;
    const b = indexOf.get(message.to) ?? 0;
    if (Math.min(a, b) !== actors.length - 1) { continue; }
    if (a === b) { requiredBeyondLast = Math.max(requiredBeyondLast, 5); }
    if (message.label !== undefined) {
      requiredBeyondLast = Math.max(requiredBeyondLast, message.label.length + 3);
    }
  }

  const lastLeft = boxLeft[actors.length - 1] ?? 0;
  const lastW = boxW[actors.length - 1] ?? 0;
  const lastX = lifeX[actors.length - 1] ?? 0;
  const width = Math.max(lastLeft + lastW, lastX + requiredBeyondLast + 1);

  if (width > budget) {
    throw new RangeError(
      `this sequence diagram needs ${String(width)} columns but the width budget allows `
      + `${String(budget)}; ${DIAGRAM_FALLBACKS}`
    );
  }

  // ---- rows -----------------------------------------------------------------------
  interface PlacedMessage { message: SequenceMessage; labelRow?: number; arrowRow: number }
  const placed: PlacedMessage[] = [];
  let y = 3;
  for (const message of messages) {
    y += 1;                                                   // spacer row
    let labelRow: number | undefined = undefined;
    if (message.label !== undefined) { labelRow = y; y += 1; }
    const arrowRow = y; y += 1;
    if (message.from === message.to) { y += 1; }              // loop return row
    placed.push(labelRow === undefined ? { message, arrowRow } : { message, labelRow, arrowRow });
  }
  y += 1;                                                     // trailing lifeline row
  const height = y;

  // ---- draw -----------------------------------------------------------------------
  const grid = makeGrid(budget, height);

  actors.forEach((actor, i) => {
    drawBox(grid, boxLeft[i] ?? 0, 0, boxW[i] ?? 0, 3);
    drawText(grid, (boxLeft[i] ?? 0) + 2, 1, actor);
  });
  // The lifeline attaches to the box's bottom border as a ┬ and runs to the bottom.
  for (const x of lifeX) {
    attach(grid, x, 2, 'down');
    vline(grid, x, 3, height - 1);
  }

  for (const item of placed) {
    const a = indexOf.get(item.message.from) ?? 0;
    const b = indexOf.get(item.message.to) ?? 0;
    const xa = lifeX[a] ?? 0;
    const xb = lifeX[b] ?? 0;
    if (a === b) {
      // Self-message: a small right-hand loop, arrow returning into the lifeline.
      drawPath(grid, expandWaypoints([
        { x: xa, y: item.arrowRow }, { x: xa + 3, y: item.arrowRow },
        { x: xa + 3, y: item.arrowRow + 1 }, { x: xa + 1, y: item.arrowRow + 1 },
      ]));
    } else {
      // The arrowhead cell sits just short of the target lifeline, leaving it intact.
      const head = xa < xb ? xb - 1 : xb + 1;
      drawPath(grid, expandWaypoints([{ x: xa, y: item.arrowRow }, { x: head, y: item.arrowRow }]));
    }
    if (item.labelRow !== undefined && item.message.label !== undefined) {
      drawText(grid, Math.min(xa, xb) + 2, item.labelRow, item.message.label);
    }
  }

  return renderGrid(grid, { frame });

}
