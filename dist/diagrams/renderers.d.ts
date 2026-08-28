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
import type { Digraph } from './model.js';
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
//# sourceMappingURL=renderers.d.ts.map