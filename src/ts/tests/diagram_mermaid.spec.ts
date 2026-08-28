import { toMermaid } from '../diagrams/mermaid.js';
import { normalizeGraph } from '../diagrams/model.js';
import { parseFsl } from '../diagrams/fsl.js';

describe('toMermaid — stateDiagram-v2', () => {

  test('the toggle emits transitions with action annotations', () => {
    expect(toMermaid(parseFsl("locked 'coin' -> unlocked 'push' -> locked;"), 'stateDiagram-v2')).toBe(
      'stateDiagram-v2\n'
      + '    locked --> unlocked: coin\n'
      + '    unlocked --> locked: push'
    );
  });

  test('an unlabeled edge emits without the colon', () => {
    expect(toMermaid(normalizeGraph([{ from: 'a', to: 'b' }]), 'stateDiagram-v2')).toBe(
      'stateDiagram-v2\n    a --> b'
    );
  });

  test('a display label becomes a state alias declaration', () => {
    expect(toMermaid(normalizeGraph(
      [{ from: 'a', to: 'b' }],
      [{ id: 'a', label: 'Alpha' }, { id: 'b' }],
    ), 'stateDiagram-v2')).toBe(
      'stateDiagram-v2\n    state "Alpha" as a\n    a --> b'
    );
  });

});

describe('toMermaid — flowchart', () => {

  test('declares every node with its label and pipes edge labels', () => {
    expect(toMermaid(normalizeGraph(
      [{ from: 'a', to: 'b', label: 'x' }, { from: 'a', to: 'c' }],
      [{ id: 'a', label: 'Alpha' }, { id: 'b' }, { id: 'c' }],
    ), 'flowchart')).toBe(
      'flowchart TD\n'
      + '    a["Alpha"]\n'
      + '    b["b"]\n'
      + '    c["c"]\n'
      + '    a -->|x| b\n'
      + '    a --> c'
    );
  });

});

describe('toMermaid — what mermaid cannot carry is named, never mangled', () => {

  test('whitespace in an id', () => {
    const graph = normalizeGraph([{ from: 'two words', to: 'b' }]);
    expect(() => toMermaid(graph, 'flowchart')).toThrow(RangeError);
    expect(() => toMermaid(graph, 'flowchart')).toThrow(/'two words'/);
  });

  test('a quote in a label', () => {
    const graph = normalizeGraph([{ from: 'a', to: 'b' }], [{ id: 'a', label: 'say "hi"' }, { id: 'b' }]);
    expect(() => toMermaid(graph, 'flowchart')).toThrow(RangeError);
  });

  test('a pipe in an edge label', () => {
    const graph = normalizeGraph([{ from: 'a', to: 'b', label: 'x|y' }]);
    expect(() => toMermaid(graph, 'flowchart')).toThrow(RangeError);
  });

  test('graph validation still applies on the way through', () => {
    expect(() => toMermaid({ nodes: [{ id: 'a' }, { id: 'a' }], edges: [] }, 'flowchart')).toThrow(RangeError);
  });

});
