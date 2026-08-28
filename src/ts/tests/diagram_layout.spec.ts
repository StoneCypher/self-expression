import { layoutDigraph, MAX_DIAGRAM_NODES, DIAGRAM_FALLBACKS } from '../diagrams/layout.js';
import type { DigraphLayout, NodeBox } from '../diagrams/layout.js';
import { normalizeGraph } from '../diagrams/model.js';
import { parseFsl } from '../diagrams/fsl.js';

const WIDTH = 74;

/** True when two placed boxes share any cell — the no-overlap oracle. */
function overlap(a: NodeBox, b: NodeBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Asserts the route-shape invariants every layout must satisfy. */
function expectWellRouted(layout: DigraphLayout): void {
  const byId = new Map(layout.boxes.map(box => [box.id, box]));
  for (const route of layout.routes) {
    const source = byId.get(route.from);
    const target = byId.get(route.to);
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    if (source === undefined || target === undefined) { continue; }

    // Contiguous orthogonal unit steps.
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1];
      const b = route.points[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) { continue; }
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    }

    // Starts on the source's bottom border; ends just above the target's top border.
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) { continue; }
    expect(first.y).toBe(source.y + source.height - 1);
    expect(first.x).toBeGreaterThan(source.x);
    expect(first.x).toBeLessThan(source.x + source.width - 1);
    expect(last.y).toBe(target.y - 1);
    expect(last.x).toBeGreaterThan(target.x);
    expect(last.x).toBeLessThan(target.x + target.width - 1);

    // Stays inside the declared surface.
    for (const point of route.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(layout.surfaceWidth);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(layout.surfaceHeight);
    }
  }
}

describe('layoutDigraph — structure', () => {

  test('a forward chain layers top to bottom', () => {
    const layout = layoutDigraph(parseFsl('a -> b -> c;'), { surfaceWidth: WIDTH });
    const [a, b, c] = ['a', 'b', 'c'].map(id => layout.boxes.find(box => box.id === id));
    expect(a).toBeDefined(); expect(b).toBeDefined(); expect(c).toBeDefined();
    if (a === undefined || b === undefined || c === undefined) { return; }
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  test('a two-state toggle draws two boxes, never recursing on the cycle', () => {
    const layout = layoutDigraph(parseFsl("locked 'coin' -> unlocked 'push' -> locked;"), { surfaceWidth: WIDTH });
    expect(layout.boxes).toHaveLength(2);
    expect(layout.routes).toHaveLength(2);
    expectWellRouted(layout);
  });

  test('a self-loop routes out and back into its own box', () => {
    const layout = layoutDigraph(parseFsl('spin -> spin;'), { surfaceWidth: WIDTH });
    expect(layout.boxes).toHaveLength(1);
    expectWellRouted(layout);
  });

  test('the tri-host fan-in/fan-out places every box disjointly', () => {
    const layout = layoutDigraph(normalizeGraph([
      { from: 'claude', to: 'root' }, { from: 'codex', to: 'root' }, { from: 'gemini', to: 'root' },
      { from: 'root', to: 'skills' }, { from: 'root', to: 'commands' },
    ]), { surfaceWidth: WIDTH });
    for (let i = 0; i < layout.boxes.length; i++) {
      for (let j = i + 1; j < layout.boxes.length; j++) {
        const a = layout.boxes[i];
        const b = layout.boxes[j];
        if (a === undefined || b === undefined) { continue; }
        expect(overlap(a, b)).toBe(false);
      }
    }
    expectWellRouted(layout);
  });

  test('labels option overrides a box label without touching topology', () => {
    const layout = layoutDigraph(parseFsl('a -> b;'), {
      surfaceWidth: WIDTH,
      labels: new Map([['a', '▶ a']]),
    });
    expect(layout.boxes.find(box => box.id === 'a')?.label).toBe('▶ a');
    expect(layout.boxes.find(box => box.id === 'b')?.label).toBe('b');
  });

  test('deterministic: identical input, identical layout', () => {
    const graph = normalizeGraph([
      { from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
    ]);
    expect(layoutDigraph(graph, { surfaceWidth: WIDTH }))
      .toEqual(layoutDigraph(graph, { surfaceWidth: WIDTH }));
  });

  test('the width fits the budget it was given', () => {
    const layout = layoutDigraph(parseFsl('a -> b; b -> a; a -> a;'), { surfaceWidth: WIDTH });
    expect(layout.surfaceWidth).toBeLessThanOrEqual(WIDTH);
  });

});

describe('layoutDigraph — refusals name the fallbacks', () => {

  test('one node past the threshold refuses; the threshold itself does not', () => {
    // A chain layers vertically, so node count is the only limit being tested here.
    const chain = (n: number) => normalizeGraph(
      Array.from({ length: n - 1 }, (_v, i) => ({ from: `q${String(i)}`, to: `q${String(i + 1)}` })),
    );
    expect(() => layoutDigraph(chain(MAX_DIAGRAM_NODES), { surfaceWidth: WIDTH })).not.toThrow();

    expect(() => layoutDigraph(chain(MAX_DIAGRAM_NODES + 1), { surfaceWidth: WIDTH })).toThrow(RangeError);
    expect(() => layoutDigraph(chain(MAX_DIAGRAM_NODES + 1), { surfaceWidth: WIDTH })).toThrow(/legibility threshold/);
    expect(() => layoutDigraph(chain(MAX_DIAGRAM_NODES + 1), { surfaceWidth: WIDTH })).toThrow(/fall back/);
  });

  test('a drawing wider than the budget refuses rather than wraps', () => {
    const graph = normalizeGraph([
      { from: 'a-very-long-node-name', to: 'another-long-node-name' },
    ]);
    expect(() => layoutDigraph(graph, { surfaceWidth: 20 })).toThrow(RangeError);
    expect(() => layoutDigraph(graph, { surfaceWidth: 20 })).toThrow(/width budget/);
    expect(() => layoutDigraph(graph, { surfaceWidth: 20 })).toThrow(/fall back/);
  });

  test('a node with more edges than border cells refuses as too tangled', () => {
    // 'x' (box width 5, interior 3) receiving edges from four sources.
    const graph = normalizeGraph([
      { from: 'aa', to: 'x' }, { from: 'bb', to: 'x' }, { from: 'cc', to: 'x' }, { from: 'dd', to: 'x' },
    ]);
    expect(() => layoutDigraph(graph, { surfaceWidth: WIDTH })).toThrow(RangeError);
    expect(() => layoutDigraph(graph, { surfaceWidth: WIDTH })).toThrow(/too tangled/);
    expect(() => layoutDigraph(graph, { surfaceWidth: WIDTH })).toThrow(/fall back/);
  });

  test('the fallback text names all three fallbacks', () => {
    expect(DIAGRAM_FALLBACKS).toMatch(/renderFsl/);
    expect(DIAGRAM_FALLBACKS).toMatch(/adjacency list/);
    expect(DIAGRAM_FALLBACKS).toMatch(/mermaid/);
  });

});
