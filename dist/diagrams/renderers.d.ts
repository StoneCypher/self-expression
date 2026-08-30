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
import type { Digraph } from './model.js';
import type { MatrixData } from './matrix.js';
/**
 * The default maximum output width in columns, frame included: fits an 80-column
 * terminal inside a code fence without wrapping.
 */
export declare const DEFAULT_DIAGRAM_WIDTH = 78;
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
export declare function renderStateDiagram(machine: Digraph | string, options?: StateDiagramOptions): string;
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
export declare function renderDigraph(graph: Digraph, options?: DiagramRenderOptions): string;
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
export declare function renderTree(root: string, children: Readonly<Record<string, readonly string[]>>, options?: TreeRenderOptions): string;
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
export declare function renderSequence(actors: readonly string[], messages: readonly SequenceMessage[], options?: DiagramRenderOptions): string;
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
export declare const MATRIX_RAMP: readonly string[];
/**
 * The legibility threshold for matrix rows: past this, a shaded table stops being a
 * shape one can see at a glance and becomes a spreadsheet, which the terminal is the
 * wrong surface for. Columns need no separate cap — each costs two columns of width,
 * so the width budget refuses them first.
 */
export declare const MAX_MATRIX_ROWS = 40;
/** The fewest columns a row-label gutter may be squeezed to before rendering refuses. */
export declare const MIN_MATRIX_LABEL = 3;
/** How many characters of a column key the rotated header shows, by default. */
export declare const DEFAULT_COL_LABEL_HEIGHT = 12;
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
export declare function renderMatrix(data: MatrixData, options?: MatrixRenderOptions): string;
//# sourceMappingURL=renderers.d.ts.map