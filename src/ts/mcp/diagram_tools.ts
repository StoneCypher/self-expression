/**
 * The MCP diagram-rendering tool surface: one grouped tool, `render_diagram`,
 * wrapping the pure renderers in `../diagrams/index.js` — the structure-drawing
 * sibling of `chart_tools.ts`'s quantity-drawing six.
 *
 * Same conventions as `chart_tools.ts`: `form` is a closed `z.enum` built via
 * {@link tuple} so a misspelled form is unrepresentable; per-form required fields are
 * optional in the schema and checked at dispatch, with an `error: `-prefixed message
 * naming the form's full requirement; a renderer's `RangeError` returns the same way,
 * never as a protocol fault. The refusal path matters more here than in charts: a
 * too-big or too-tangled graph's error text carries the fallback menu (FSL one-liner,
 * adjacency list, mermaid emission), so the model's next action is named rather than
 * guessed.
 *
 * @see ../diagrams/index.js
 * @see ./chart_tools.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import {
  renderStateDiagram, renderDigraph, renderTree, renderSequence,
  normalizeGraph, parseFsl, toMermaid,
} from '../diagrams/index.js';
import type {
  Digraph, DiagramEdge, DiagramNode, SequenceMessage, MermaidDialect,
} from '../diagrams/index.js';
import type { Store } from '../channels/store.js';

/**
 * A non-empty tuple, which is what `z.enum` requires, preserving the literal types.
 *
 * Copied from `chart_tools.ts` rather than imported — that copy is file-private
 * there, and the house pattern is to keep this tiny helper local to whichever file
 * needs it.
 *
 * @throws {Error} If `values` is empty, which would mean a tool with an
 *                 unsatisfiable argument.
 */
function tuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) { throw new Error('vocabulary must not be empty'); }
  return [first, ...rest];
}

/**
 * Compile-time exact type equality — the invariant-comparison trick documented at
 * length on `chart_tools.ts`'s copy; kept file-private here for the same reason
 * {@link tuple} is.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- A and B each referenced exactly once is the point of this comparison
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Fails to compile unless `T` is exactly `true`; see `chart_tools.ts`'s copy for why
 * this is a real call rather than a type alias.
 */
function expectType<T extends true>(value: T): T { return value; }

/**
 * The shape of an MCP tool result's text content; mirrors `chart_tools.ts`'s
 * {@link ToolReply} including the index signature the SDK's `CallToolResult` carries.
 */
export interface ToolReply {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
}

/** Wraps a value as the text content an MCP tool result carries. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/**
 * Runs `fn`, catching a thrown `RangeError` and returning its message as `error: `
 * tool text instead of letting it escape as a protocol fault.
 *
 * @throws unchanged, anything `fn` throws that is not a `RangeError`.
 */
function guarded(fn: () => ToolReply): ToolReply {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RangeError) { return reply(`error: ${err.message}`); }
    throw err;
  }
}

/** Re-shapes one zod-optional edge into `DiagramEdge`'s absent-key optional shape. */
function toDiagramEdge(edge: { from: string; to: string; label?: string | undefined }): DiagramEdge {
  return edge.label === undefined
    ? { from: edge.from, to: edge.to }
    : { from: edge.from, to: edge.to, label: edge.label };
}

/** See {@link toDiagramEdge}: the same conversion for one node. */
function toDiagramNode(node: { id: string; label?: string | undefined }): DiagramNode {
  return node.label === undefined ? { id: node.id } : { id: node.id, label: node.label };
}

/** See {@link toDiagramEdge}: the same conversion for one sequence message. */
function toSequenceMessage(m: { from: string; to: string; label?: string | undefined }): SequenceMessage {
  return m.label === undefined
    ? { from: m.from, to: m.to }
    : { from: m.from, to: m.to, label: m.label };
}

/** The forms {@link handleRenderDiagram} accepts. */
export const DIAGRAM_FORMS = ['state', 'digraph', 'tree', 'sequence'] as const;

/** The three emissions `render_diagram` can produce. */
const DIAGRAM_EMITS = ['ascii', 'mermaid', 'both'] as const;

/** The raw zod shape backing `render_diagram`'s `inputSchema`. */
const DIAGRAM_SHAPE = {
  form: z.enum(tuple(DIAGRAM_FORMS)).describe(
    "which diagram form to render: 'state' (a state machine: boxes, labeled transition "
    + "arrows, cycles as return arrows), 'digraph' (a directed graph: dependencies, call "
    + "flows, lineage), 'tree' (a strict hierarchy as a connector tree), or 'sequence' "
    + '(actors, lifelines, and one arrow row per message)'),
  edges: z.array(z.object({
    from: z.string().describe('the node this edge leaves'),
    to: z.string().describe('the node this edge enters'),
    label: z.string().optional().describe(
      'the text drawn along the edge — an action, a dependency kind, a verb'),
  })).optional().describe(
    "'state'/'digraph'/'tree' forms: the edges; nodes are inferred from endpoints in "
    + "first-appearance order unless 'nodes' is given. For 'tree', each edge is parent "
    + "-> child. The 'state' form accepts 'fsl' instead."),
  nodes: z.array(z.object({
    id: z.string().describe('the unique node id edges reference'),
    label: z.string().optional().describe('display label; defaults to the id'),
  })).optional().describe(
    "'state'/'digraph'/'tree' forms, optional: explicit node list, for node order, "
    + 'display labels, or isolated nodes'),
  fsl: z.string().optional().describe(
    "'state' form only, alternative to 'edges': FSL-subset source, the text render_timeline's "
    + "'fsl' form emits — chained transitions with optional quoted actions, ';'-terminated, "
    + "e.g. \"locked 'coin' -> unlocked 'push' -> locked;\""),
  activeState: z.string().optional().describe(
    "'state' form only, optional: the state currently occupied; drawn with a '▶ ' marker "
    + 'inside its box'),
  root: z.string().optional().describe(
    "'tree' form only, required: the root node id"),
  actors: z.array(z.string()).optional().describe(
    "'sequence' form only, required: the lifeline columns, left to right; unique, non-empty"),
  messages: z.array(z.object({
    from: z.string().describe('the sending actor'),
    to: z.string().describe('the receiving actor; may equal from (drawn as a self-loop)'),
    label: z.string().optional().describe('text drawn on its own row above the arrow'),
  })).optional().describe(
    "'sequence' form only, required: the messages in time order"),
  frame: z.boolean().optional().describe(
    'frame the diagram in a visible box (default true); the frame guarantees a rectangle '
    + 'out of visible characters that editors cannot strip'),
  width: z.number().int().optional().describe(
    'maximum output width in columns, frame included (default 78: fits an 80-column '
    + 'terminal inside a code fence); a diagram that cannot fit refuses and names fallbacks'),
  emit: z.enum(tuple(DIAGRAM_EMITS)).optional().describe(
    "'ascii' (default: the drawn diagram — place it in a ```text fence), 'mermaid' (source "
    + "for a destination with a mermaid renderer, e.g. a GitHub PR body; not available for "
    + "the 'sequence' form), or 'both' (ascii, a blank line, then mermaid)"),
};

/**
 * What a caller supplies to `render_diagram`, after schema validation.
 *
 * Hand-written rather than `z.infer`-derived for the same `isolatedDeclarations`
 * reason as `chart_tools.ts`'s `SeriesArgs`; kept honest against
 * {@link DIAGRAM_SHAPE} by the `expectType` assertion below and by
 * `registerDiagramTools`'s call site.
 */
export interface DiagramArgs {
  form: 'state' | 'digraph' | 'tree' | 'sequence';
  edges?: { from: string; to: string; label?: string | undefined }[] | undefined;
  nodes?: { id: string; label?: string | undefined }[] | undefined;
  fsl?: string | undefined;
  activeState?: string | undefined;
  root?: string | undefined;
  actors?: string[] | undefined;
  messages?: { from: string; to: string; label?: string | undefined }[] | undefined;
  frame?: boolean | undefined;
  width?: number | undefined;
  emit?: 'ascii' | 'mermaid' | 'both' | undefined;
}

// Fails to compile if DiagramArgs drifts from DIAGRAM_SHAPE — see expectType's docblock.
expectType<Equal<DiagramArgs, z.infer<z.ZodObject<typeof DIAGRAM_SHAPE>>>>(true);

/** Builds the graph a `'state'`/`'digraph'`/`'tree'` call describes, or an error reply. */
function graphFrom(args: DiagramArgs): Digraph {
  return normalizeGraph(
    (args.edges ?? []).map(toDiagramEdge),
    args.nodes?.map(toDiagramNode),
  );
}

/** Combines the ascii and mermaid emissions per the `emit` option. */
function emitted(emit: DiagramArgs['emit'], ascii: () => string, mermaid: () => string): ToolReply {
  switch (emit ?? 'ascii') {
    case 'ascii':   return reply(ascii());
    case 'mermaid': return reply(mermaid());
    case 'both':    return reply(`${ascii()}\n\n${mermaid()}`);
  }
}

/**
 * Handles `render_diagram`: one of the four structure forms, as drawn ASCII, mermaid
 * source, or both.
 *
 * @param args the validated tool arguments; `store` is unused by every form, but the
 *             parameter is kept for a uniform handler signature with the chart tools
 *
 * @example
 *   handleRenderDiagram(store, {
 *     form: 'state',
 *     fsl: "locked 'coin' -> unlocked 'push' -> locked;",
 *   })
 *   // => { content: [{ type: 'text', text: '┌─...the framed drawing...─┘' }] }
 */
export function handleRenderDiagram(_store: Store, args: DiagramArgs): ToolReply {
  return guarded(() => {

    const frame = args.frame;
    const width = args.width;
    const shared = { frame, width };

    switch (args.form) {

      case 'state': {
        if (args.fsl === undefined && (args.edges === undefined || args.edges.length === 0)) {
          return reply(
            "error: render_diagram form 'state' is missing 'edges' or 'fsl'; requires "
            + "'edges' (non-empty array of {from, to, label?}) or 'fsl' (FSL-subset "
            + "source); 'nodes', 'activeState', 'frame', 'width', 'emit' optional"
          );
        }
        const graph = args.fsl === undefined ? graphFrom(args) : parseFsl(args.fsl);
        return emitted(args.emit,
          () => renderStateDiagram(graph, { ...shared, activeState: args.activeState }),
          () => toMermaid(graph, 'stateDiagram-v2' satisfies MermaidDialect));
      }

      case 'digraph': {
        if (args.edges === undefined || args.edges.length === 0) {
          return reply(
            "error: render_diagram form 'digraph' is missing 'edges'; requires 'edges' "
            + "(non-empty array of {from, to, label?}); 'nodes', 'frame', 'width', "
            + "'emit' optional"
          );
        }
        const graph = graphFrom(args);
        return emitted(args.emit,
          () => renderDigraph(graph, shared),
          () => toMermaid(graph, 'flowchart'));
      }

      case 'tree': {
        const root = args.root;
        if (root === undefined || args.edges === undefined || args.edges.length === 0) {
          return reply(
            "error: render_diagram form 'tree' is missing 'root' and/or 'edges'; requires "
            + "'root' (string) and 'edges' (non-empty array of parent -> child {from, to}); "
            + "'nodes' (for labels), 'frame', 'width', 'emit' optional"
          );
        }
        const graph = graphFrom(args);   // validates ids/labels and edge references
        const children: Record<string, string[]> = {};
        for (const edge of graph.edges) {
          (children[edge.from] ??= []).push(edge.to);
        }
        const labels: Record<string, string> = {};
        for (const node of graph.nodes) {
          if (node.label !== undefined) { labels[node.id] = node.label; }
        }
        return emitted(args.emit,
          () => renderTree(root, children, { ...shared, labels }),
          () => toMermaid(graph, 'flowchart'));
      }

      case 'sequence': {
        if (args.actors === undefined || args.actors.length === 0 || args.messages === undefined) {
          return reply(
            "error: render_diagram form 'sequence' is missing 'actors' and/or 'messages'; "
            + "requires 'actors' (non-empty string[]) and 'messages' (array of {from, to, "
            + "label?}, may be empty); 'frame', 'width' optional; 'emit' must be 'ascii'"
          );
        }
        if (args.emit !== undefined && args.emit !== 'ascii') {
          return reply(
            "error: render_diagram form 'sequence' has no mermaid emission (toMermaid "
            + "covers state machines and digraphs only); use emit 'ascii'"
          );
        }
        return reply(renderSequence(args.actors, args.messages.map(toSequenceMessage), shared));
      }

    }

  });
}

/**
 * Registers the `render_diagram` tool on `server`.
 *
 * Like the chart tools, diagrams have no config gate: every form is always
 * available.
 *
 * @example
 *   const server = new McpServer({ name: 'self-expression', version: '0.2.0' });
 *   registerDiagramTools(server, store);
 */
export function registerDiagramTools(server: McpServer, store: Store): void {

  server.registerTool('render_diagram', {
    title: 'Render diagram',
    description:
      'Render structure — topology, relationships, transitions — as an exact ASCII '
      + 'box-and-arrow diagram: a state machine (from edges or FSL source), a directed '
      + 'graph, a strict-hierarchy tree, or a sequence diagram. Reach for this the moment '
      + 'structure branches, merges, cycles, or fans in or out — a state machine with more '
      + 'than one path, a dependency graph with shared dependencies, a call flow with a '
      + 'decision point; quantities belong to the render_* chart tools, and a straight '
      + "line to render_timeline's inline forms. Output is framed and single-width; place "
      + 'it inside a ```text fence. A graph too large or tangled to draw legibly is '
      + 'refused with the fallbacks named in the error text; emit \'mermaid\' or '
      + "'both' only when the destination (e.g. a GitHub PR body) actually renders mermaid.",
    inputSchema: DIAGRAM_SHAPE,
  }, (args) => handleRenderDiagram(store, args));

}
