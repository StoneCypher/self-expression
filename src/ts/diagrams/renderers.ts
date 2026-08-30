/**
 * The public diagram forms: state diagram, digraph, tree, sequence, and seriated
 * matrix — data in, exact framed ASCII string out, the error class of hand-drawn
 * diagrams (misaligned edges, arrows touching the wrong box, ragged margins)
 * prevented rather than detected.
 *
 * All five share the rendering-compatibility constraints from the design spec:
 * single-width glyphs only (light box-drawing set plus `▶ ◀ ▲ ▼` arrowheads and the
 * `░▒▓█` shade ramp), a width budget defaulting to {@link DEFAULT_DIAGRAM_WIDTH}
 * columns, framed output by default, no trailing whitespace ever, and refusal —
 * naming fallbacks — over an illegible or wrapped drawing. Emit the result inside a
 * ` ```text ` fence; outside one, proportional fonts destroy the alignment these
 * renderers guarantee.
 *
 * Pure: no I/O, no store access, no clock, no randomness.
 *
 * @see ./layout.js
 * @see ./grid.js
 * @see ./matrix.js
 * @see ../../superpowers/spec/2026-08-27-diagrams-design.md
 */

import {
  makeGrid, drawBox, drawText, drawPath, expandWaypoints, renderGrid, renderLines, drawVline, attach,
} from './grid.js';
import type { CharGrid }   from './grid.js';
import { layoutDigraph, MAX_DIAGRAM_NODES, DIAGRAM_FALLBACKS } from './layout.js';
import type { RoutedEdge } from './layout.js';
import { normalizeGraph, requireGridSafe } from './model.js';
import type { Digraph }    from './model.js';
import { parseFsl }        from './fsl.js';
import { normalizeMatrix, matrixTotals, MATRIX_FALLBACKS } from './matrix.js';
import type { MatrixData } from './matrix.js';

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
    drawVline(grid, x, 3, height - 1);
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

/**
 * The density ramp {@link renderMatrix} maps cell magnitude onto, emptiest to fullest.
 *
 * Index 0 is reserved for an exactly-zero cell and is a dot rather than a space on
 * purpose: a blank cell reads as *missing*, while `·` reads as *present and empty*,
 * which is a different claim and usually the true one. The remaining four are the
 * house shade ramp the chart renderers use, kept in step with them by eye rather than
 * by import — `diagrams/` is a sibling of `charts/`, not a dependent.
 *
 * @example
 *   MATRIX_RAMP[0]   // => '·'  (exactly zero)
 *   MATRIX_RAMP[4]   // => '█'  (the largest cell in the table)
 *
 * @see ../charts/scale.js
 * @see renderMatrix
 */
export const MATRIX_RAMP: readonly string[] = ['·', '░', '▒', '▓', '█'];

/**
 * The legibility threshold for matrix rows: past this, a shaded table stops being a
 * shape one can see at a glance and becomes a spreadsheet, which the terminal is the
 * wrong surface for. Columns need no separate cap — each costs two columns of width,
 * so the width budget refuses them first.
 */
export const MAX_MATRIX_ROWS = 40;

/** The fewest columns a row-label gutter may be squeezed to before rendering refuses. */
export const MIN_MATRIX_LABEL = 3;

/** How many characters of a column key the rotated header shows, by default. */
export const DEFAULT_COL_LABEL_HEIGHT = 12;

/** The gutter label and header word marking the marginal totals. */
const TOTAL_LABEL = 'total';

/** Options for {@link renderMatrix}. */
export interface MatrixRenderOptions extends DiagramRenderOptions {
  /**
   * Draw the marginal totals — a row-total column on the right and a column-total
   * block underneath; default true. Turn them off only when the shape alone is the
   * point, since shading shows proportion and hides magnitude.
   */
  totals?: boolean | undefined;
  /**
   * The density ramp, emptiest to fullest, at least two single-width glyphs; default
   * {@link MATRIX_RAMP}. Index 0 draws an exactly-zero cell; every non-zero cell maps
   * into the rest by its fraction of the table's largest cell.
   */
  ramp?: readonly string[] | undefined;
  /**
   * Cap the row-label gutter at this many columns, truncating longer keys; default is
   * the longest key, shrunk automatically if the width budget demands it.
   */
  labelWidth?: number | undefined;
  /**
   * Cap the rotated column header at this many rows, truncating longer keys; default
   * {@link DEFAULT_COL_LABEL_HEIGHT}. Header height costs vertical space only, so this
   * is a legibility choice rather than a fitting one.
   */
  colLabelHeight?: number | undefined;
}

/** Formats one marginal total: exact when integral, one decimal otherwise. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Picks a cell's ramp glyph: index 0 for exactly zero, else by fraction of `max`. */
function densityGlyph(value: number, max: number, ramp: readonly string[]): string {
  const empty = ramp[0] ?? ' ';
  if (value === 0 || max === 0) { return empty; }
  const levels = ramp.length - 1;
  const step = Math.min(levels - 1, Math.floor((value / max) * levels));
  return ramp[1 + step] ?? empty;
}

/** Validates a caller-supplied density ramp: enough glyphs, each drawable and single-width. */
function requireRampDrawable(ramp: readonly string[]): void {
  if (ramp.length < 2) {
    throw new RangeError(
      `renderMatrix needs a ramp of at least two glyphs (empty and full); received ${String(ramp.length)}`
    );
  }
  for (const glyph of ramp) {
    // Code points, not UTF-16 units: '█'.length is 1 but an astral glyph's is 2, and it
    // is the code-point count that decides whether one cell holds it.
    const points = Array.from(glyph).length;
    if (points !== 1) {
      throw new RangeError(
        `the ramp entry '${glyph}' is ${String(points)} characters; each ramp entry must `
        + 'be exactly one single-width character so the cells stay aligned'
      );
    }
    requireGridSafe(glyph, `the ramp entry '${glyph}'`);
  }
}

/**
 * Renders a two-way table as a shaded matrix: row keys down the left, column keys
 * rotated into a vertical header, one density glyph per cell, and the marginal totals
 * alongside — the form a seriated table is meant to be read in.
 *
 * The drawing does **not** reorder anything. Pass it whatever order you want read, and
 * pass it `seriate(...).matrix` when you want the order that shows blocks; keeping the
 * two apart is what lets an axis be pinned, and what keeps this function a pure
 * display of the data it was handed.
 *
 * Cells are one column wide with a single space between them, which keeps the shaded
 * field tight enough to read as a shape rather than as a grid of separate marks. That
 * is also why the column totals are stacked vertically underneath rather than laid out
 * in a row: a horizontal total row would force every cell as wide as the widest number
 * and blow the pattern apart. Row keys are truncated, and the rotated header capped,
 * when the width budget requires it; only when even a three-column gutter will not fit
 * does the render refuse.
 *
 * Like {@link renderTree} and unlike the graph forms, this builds its lines directly
 * rather than drawing on a `CharGrid` — a table has fixed columns and nothing to route,
 * so the grid's junction resolution would buy nothing.
 *
 * @param data    the table to draw, in the order it should be read
 * @param options totals, ramp, label caps, plus the shared frame/width options
 *
 * @example
 *   renderMatrix(normalizeMatrix(
 *     ['v0.1', 'v0.2'],
 *     ['infra', 'docs'],
 *     [[12, 1], [2, 9]],
 *   ))
 *   // => a framed table: 'infra' and 'docs' rotated into a vertical header, a
 *   //    '█ ░' / '░ █' shaded 2×2 field, a right-hand column reading 13 and 11, and
 *   //    a stacked 'total' block underneath reading 14 and 10, grand total 24
 *
 * @throws {RangeError} If `data` fails {@link normalizeMatrix}, the table has more than
 *                        {@link MAX_MATRIX_ROWS} rows, a ramp entry is not a single
 *                        grid-safe character, a label cap is not a positive integer, or
 *                        the drawing cannot fit the width budget even with the row
 *                        labels squeezed to {@link MIN_MATRIX_LABEL} columns; refusals
 *                        name the fallbacks.
 * @see ./matrix.js
 * @see renderTree
 */
export function renderMatrix(data: MatrixData, options?: MatrixRenderOptions): string {

  const matrix = normalizeMatrix(data.rows, data.cols, data.values);
  const rowCount = matrix.rows.length, colCount = matrix.cols.length;

  if (rowCount > MAX_MATRIX_ROWS) {
    throw new RangeError(
      `a matrix of ${String(rowCount)} rows is past the legibility threshold of `
      + `${String(MAX_MATRIX_ROWS)}; ${MATRIX_FALLBACKS}`
    );
  }

  const frame  = options?.frame ?? true;
  const budget = surfaceBudget(options?.width, frame, 'renderMatrix');
  const totals = options?.totals ?? true;
  const ramp   = options?.ramp ?? MATRIX_RAMP;

  requireRampDrawable(ramp);

  const headerCap = options?.colLabelHeight ?? DEFAULT_COL_LABEL_HEIGHT;
  if (!Number.isInteger(headerCap) || headerCap < 1) {
    throw new RangeError(
      `renderMatrix's colLabelHeight must be a positive integer; received ${String(headerCap)}`
    );
  }
  const labelCap = options?.labelWidth;
  if (labelCap !== undefined && (!Number.isInteger(labelCap) || labelCap < 1)) {
    throw new RangeError(
      `renderMatrix's labelWidth must be a positive integer; received ${String(labelCap)}`
    );
  }

  // ---- sizes ------------------------------------------------------------------------
  const margins    = matrixTotals(matrix);
  const rowMargins = margins.rowTotals.map(formatQuantity);
  const colMargins = margins.colTotals.map(formatQuantity);
  const grand      = formatQuantity(margins.grand);

  const marginWidth = totals
    ? Math.max(TOTAL_LABEL.length, grand.length, ...rowMargins.map(text => text.length))
    : 0;

  const fieldWidth = colCount * 2 - 1;                       // one glyph, one space between
  const overhead   = 3 + fieldWidth + (totals ? 3 + marginWidth : 0);
  const room       = budget - overhead;

  if (room < MIN_MATRIX_LABEL) {
    throw new RangeError(
      `this ${String(rowCount)}×${String(colCount)} matrix needs at least `
      + `${String(overhead + MIN_MATRIX_LABEL + (frame ? 4 : 0))} columns but the width budget `
      + `allows ${String(budget + (frame ? 4 : 0))}; ${MATRIX_FALLBACKS}`
    );
  }

  const natural    = Math.max(...matrix.rows.map(key => key.length), totals ? TOTAL_LABEL.length : 1);
  const labelWidth = Math.min(labelCap ?? natural, natural, room);

  const colLabels   = matrix.cols.map(key => key.slice(0, headerCap));
  const headerRows  = Math.max(...colLabels.map(label => label.length));
  const marginRows  = totals ? Math.max(...colMargins.map(text => text.length)) : 0;

  // ---- line assembly ------------------------------------------------------------------
  const line = (label: string, field: string, margin: string): string => {
    const left = `${label.slice(0, labelWidth).padEnd(labelWidth)} │ ${field}`;
    return totals ? `${left} │ ${margin.padStart(marginWidth)}` : left;
  };

  const rule = totals
    ? `${'─'.repeat(labelWidth + 1)}┼${'─'.repeat(fieldWidth + 2)}┼${'─'.repeat(marginWidth + 1)}`
    : `${'─'.repeat(labelWidth + 1)}┼${'─'.repeat(fieldWidth + 1)}`;

  const lines: string[] = [];

  // Rotated column keys, bottom-aligned so every key ends against the rule below it.
  for (let k = 0; k < headerRows; k++) {
    const glyphs = colLabels.map(label => label[k - (headerRows - label.length)] ?? ' ');
    lines.push(line('', glyphs.join(' '), k === headerRows - 1 ? TOTAL_LABEL : ''));
  }

  lines.push(rule);

  const peak = Math.max(...matrix.values.map(row => Math.max(...row)));
  matrix.values.forEach((row, r) => {
    const glyphs = row.map(value => densityGlyph(value, peak, ramp));
    lines.push(line(
      matrix.rows[r] ?? '',
      glyphs.join(' '),
      rowMargins[r] ?? '',
    ));
  });

  // Column totals stacked vertically, top-aligned so every number starts at the rule.
  if (totals) {
    lines.push(rule);
    for (let k = 0; k < marginRows; k++) {
      const digits = colMargins.map(text => text[k] ?? ' ');
      lines.push(line(k === 0 ? TOTAL_LABEL : '', digits.join(' '), k === 0 ? grand : ''));
    }
  }

  return renderLines(lines, { frame });

}
