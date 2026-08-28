import { normalizeGraph, requireGridSafe, displayLabel } from '../diagrams/model.js';

describe('requireGridSafe', () => {

  test('plain ASCII passes quietly', () => {
    expect(() => { requireGridSafe('locked', 'test'); }).not.toThrow();
    expect(() => { requireGridSafe('a-b_c.d 42', 'test'); }).not.toThrow();
  });

  test('an emoji is rejected as double-width, naming the field', () => {
    expect(() => { requireGridSafe('go 🚀', "node id 'go 🚀'"); }).toThrow(RangeError);
    expect(() => { requireGridSafe('go 🚀', "node id 'go 🚀'"); }).toThrow(/double-width/);
    expect(() => { requireGridSafe('go 🚀', "node id 'go 🚀'"); }).toThrow(/node id/);
  });

  test('CJK is rejected as double-width', () => {
    expect(() => { requireGridSafe('状態', 'test'); }).toThrow(RangeError);
  });

  test('a combining mark is rejected — zero width also breaks alignment', () => {
    expect(() => { requireGridSafe('a\u{0332}b', 'test'); }).toThrow(RangeError);
  });

  test('an embedded newline is rejected', () => {
    expect(() => { requireGridSafe('two\nlines', 'test'); }).toThrow(RangeError);
    expect(() => { requireGridSafe('two\nlines', 'test'); }).toThrow(/control character or newline/);
  });

});

describe('displayLabel', () => {

  test('prefers the label, falls back to the id', () => {
    expect(displayLabel({ id: 'a', label: 'alpha' })).toBe('alpha');
    expect(displayLabel({ id: 'a' })).toBe('a');
  });

});

describe('normalizeGraph', () => {

  test('infers nodes from edges in first-appearance order', () => {
    const g = normalizeGraph([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]);
    expect(g.nodes.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(g.edges).toHaveLength(2);
  });

  test('keeps an explicit node list, order, labels, and isolated nodes', () => {
    const g = normalizeGraph(
      [{ from: 'b', to: 'a' }],
      [{ id: 'a', label: 'Alpha' }, { id: 'b' }, { id: 'lonely' }],
    );
    expect(g.nodes.map(n => n.id)).toEqual(['a', 'b', 'lonely']);
    expect(g.nodes[0]?.label).toBe('Alpha');
  });

  test('rejects duplicate node ids, naming the id', () => {
    expect(() => normalizeGraph([], [{ id: 'x' }, { id: 'x' }])).toThrow(RangeError);
    expect(() => normalizeGraph([], [{ id: 'x' }, { id: 'x' }])).toThrow(/'x'/);
  });

  test('rejects a dangling edge reference against an explicit node list', () => {
    expect(() => normalizeGraph([{ from: 'a', to: 'ghost' }], [{ id: 'a' }])).toThrow(RangeError);
    expect(() => normalizeGraph([{ from: 'a', to: 'ghost' }], [{ id: 'a' }])).toThrow(/'ghost'/);
  });

  test('rejects a graph with no nodes at all', () => {
    expect(() => normalizeGraph([])).toThrow(RangeError);
    expect(() => normalizeGraph([], [])).toThrow(RangeError);
  });

  test('rejects empty ids, empty labels, and empty edge labels', () => {
    expect(() => normalizeGraph([{ from: '', to: 'b' }])).toThrow(RangeError);
    expect(() => normalizeGraph([], [{ id: 'a', label: '' }])).toThrow(RangeError);
    expect(() => normalizeGraph([{ from: 'a', to: 'b', label: '' }])).toThrow(RangeError);
  });

  test('rejects grid-hostile text wherever it appears', () => {
    expect(() => normalizeGraph([{ from: 'a', to: '🎉' }])).toThrow(RangeError);
    expect(() => normalizeGraph([{ from: 'a', to: 'b', label: 'w🎉' }])).toThrow(RangeError);
    expect(() => normalizeGraph([], [{ id: 'a', label: '漢字' }])).toThrow(RangeError);
  });

  test('self-loops and parallel edges are legal topology', () => {
    const g = normalizeGraph([{ from: 'a', to: 'a' }, { from: 'a', to: 'a' }]);
    expect(g.nodes.map(n => n.id)).toEqual(['a']);
    expect(g.edges).toHaveLength(2);
  });

});
