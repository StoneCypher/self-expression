/**
 * Stochastic property tests for the diagram renderers and layout: across random
 * graphs, trees, and sequences, a successful render always satisfies the output
 * invariants (framed rectangle, width budget, no trailing whitespace, one label per
 * node, one arrowhead per edge), and anything the layout cannot draw legibly is a
 * refusal naming the fallbacks — never a malformed drawing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  renderStateDiagram, renderDigraph, renderTree, renderSequence, DEFAULT_DIAGRAM_WIDTH,
} from '../diagrams/renderers.js';
import { normalizeGraph } from '../diagrams/model.js';
import type { Digraph, DiagramEdge } from '../diagrams/model.js';
import { toMermaid } from '../diagrams/mermaid.js';
import { MAX_DIAGRAM_NODES } from '../diagrams/layout.js';

/**
 * Distinct doubled-letter ids ('aa', 'bb', …): none is a substring of another, so
 * counting occurrences in rendered output is a sound one-label-per-node oracle.
 */
function ident(i: number): string {
  const letter = 'abcdefghijklmnopqrst'[i] ?? 'z';
  return letter + letter;
}

/** Random digraphs on up to 8 nodes; edges may include cycles and self-loops. */
const graphArb: fc.Arbitrary<Digraph> = fc
  .record({
    n: fc.integer({ min: 1, max: 8 }),
    pairs: fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 0, maxLength: 10 }),
  })
  .map(({ n, pairs }) => {
    const edges: DiagramEdge[] = pairs.map(([a, b]) => ({ from: ident(a % n), to: ident(b % n) }));
    const nodes = Array.from({ length: n }, (_v, i) => ({ id: ident(i) }));
    return normalizeGraph(edges, nodes);
  });

/** Asserts the full output-invariant contract on one rendered diagram. */
function expectInvariants(out: string, width: number = DEFAULT_DIAGRAM_WIDTH): void {
  const lines = out.split('\n');
  const widths = new Set(lines.map(l => [...l].length));
  expect(widths.size).toBe(1);
  expect(lines[0]?.startsWith('┌')).toBe(true);
  expect(lines[lines.length - 1]?.startsWith('└')).toBe(true);
  for (const line of lines) {
    expect([...line].length).toBeLessThanOrEqual(width);
    expect(line).not.toMatch(/[ \t]$/);
  }
}

/** True when the thrown refusal is the documented kind: RangeError naming fallbacks. */
function isNamedRefusal(err: unknown): boolean {
  return err instanceof RangeError && /fall back/.test(err.message);
}

describe('renderDigraph — stochastic invariants', () => {

  it('renders well-formed or refuses by name; nothing in between', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        let out: string;
        try { out = renderDigraph(graph); }
        catch (err) { expect(isNamedRefusal(err)).toBe(true); return; }
        expectInvariants(out);
        for (const node of graph.nodes) {
          expect(out.split(node.id).length - 1).toBe(1);
        }
        // One ▼ arrowhead per edge: every edge enters its target from above, and
        // entry slots are distinct cells.
        expect(out.split('▼').length - 1).toBe(graph.edges.length);
      }),
      { numRuns: 250 }
    );
  });

  it('is deterministic: two calls, identical strings', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        let first: string;
        try { first = renderDigraph(graph); } catch { return; }
        expect(renderDigraph(graph)).toBe(first);
      }),
      { numRuns: 100 }
    );
  });

  it('past the node threshold it always refuses, never draws', () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_DIAGRAM_NODES + 1, max: MAX_DIAGRAM_NODES + 10 }), (n) => {
        const nodes = Array.from({ length: n }, (_v, i) => ({ id: `q${String(i)}` }));
        expect(() => renderDigraph(normalizeGraph([], nodes))).toThrow(RangeError);
        expect(() => renderDigraph(normalizeGraph([], nodes))).toThrow(/legibility threshold/);
      }),
      { numRuns: 50 }
    );
  });

});

describe('renderStateDiagram — stochastic invariants', () => {

  it('marking any node active preserves the invariants and marks exactly once', () => {
    fc.assert(
      fc.property(graphArb, fc.nat(), (graph, pick) => {
        const node = graph.nodes[pick % graph.nodes.length];
        if (node === undefined) { return; }
        let out: string;
        try { out = renderStateDiagram(graph, { activeState: node.id }); }
        catch (err) { expect(isNamedRefusal(err)).toBe(true); return; }
        expectInvariants(out);
        expect(out.split(`▶ ${node.id}`).length - 1).toBe(1);
      }),
      { numRuns: 150 }
    );
  });

});

describe('renderTree — stochastic invariants', () => {

  /** Random trees: node k > 0 gets a random parent among 0..k-1. */
  const treeArb = fc
    .record({
      n: fc.integer({ min: 1, max: 12 }),
      parents: fc.array(fc.nat(), { minLength: 11, maxLength: 11 }),
    })
    .map(({ n, parents }) => {
      const children: Record<string, string[]> = {};
      for (let k = 1; k < n; k++) {
        const parent = ident((parents[k - 1] ?? 0) % k);
        (children[parent] ??= []).push(ident(k));
      }
      return { root: ident(0), children, n };
    });

  it('every node appears exactly once and the frame invariants hold', () => {
    fc.assert(
      fc.property(treeArb, ({ root, children, n }) => {
        const out = renderTree(root, children);
        expectInvariants(out);
        for (let i = 0; i < n; i++) {
          expect(out.split(ident(i)).length - 1).toBe(1);
        }
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderSequence — stochastic invariants', () => {

  const sequenceArb = fc
    .record({
      n: fc.integer({ min: 1, max: 5 }),
      picks: fc.array(
        fc.record({ a: fc.nat(), b: fc.nat(), labeled: fc.boolean(), label: fc.integer({ min: 0, max: 19 }) }),
        { minLength: 0, maxLength: 8 },
      ),
    })
    .map(({ n, picks }) => ({
      actors: Array.from({ length: n }, (_v, i) => ident(i)),
      messages: picks.map(p => (p.labeled
        ? { from: ident(p.a % n), to: ident(p.b % n), label: ident(p.label) }
        : { from: ident(p.a % n), to: ident(p.b % n) })),
    }));

  it('renders well-formed or refuses by name across random message traffic', () => {
    fc.assert(
      fc.property(sequenceArb, ({ actors, messages }) => {
        let out: string;
        try { out = renderSequence(actors, messages); }
        catch (err) { expect(isNamedRefusal(err)).toBe(true); return; }
        expectInvariants(out);
        expect(out).toBe(renderSequence(actors, messages));   // deterministic
      }),
      { numRuns: 200 }
    );
  });

});

describe('toMermaid — stochastic shape', () => {

  it('flowchart output is always header + one line per node + one per edge', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const lines = toMermaid(graph, 'flowchart').split('\n');
        expect(lines[0]).toBe('flowchart TD');
        expect(lines).toHaveLength(1 + graph.nodes.length + graph.edges.length);
      }),
      { numRuns: 200 }
    );
  });

  it('stateDiagram-v2 output is always header + one line per edge (ids as labels)', () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const lines = toMermaid(graph, 'stateDiagram-v2').split('\n');
        expect(lines[0]).toBe('stateDiagram-v2');
        expect(lines).toHaveLength(1 + graph.edges.length);
      }),
      { numRuns: 200 }
    );
  });

});
