import {
  renderStateDiagram, renderDigraph, renderTree, renderSequence, DEFAULT_DIAGRAM_WIDTH,
} from '../diagrams/renderers.js';
import { normalizeGraph } from '../diagrams/model.js';

/**
 * Asserts the output invariants the design doc pins as contract: framed output is a
 * perfect rectangle bordered on all four sides, no line exceeds the width budget,
 * and no line carries trailing whitespace.
 */
function expectWellFormed(output: string, width: number = DEFAULT_DIAGRAM_WIDTH): void {
  const lines = output.split('\n');
  const first = lines[0] ?? '';
  const last = lines[lines.length - 1] ?? '';
  expect(first.startsWith('┌')).toBe(true);
  expect(first.endsWith('┐')).toBe(true);
  expect(last.startsWith('└')).toBe(true);
  expect(last.endsWith('┘')).toBe(true);
  const widths = new Set(lines.map(l => [...l].length));
  expect(widths.size).toBe(1);
  for (const line of lines) {
    expect([...line].length).toBeLessThanOrEqual(width);
    expect(line).not.toMatch(/[ \t]$/);
    expect(line.startsWith('│') || line.startsWith('┌') || line.startsWith('└')).toBe(true);
  }
}

/** Counts non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const TOGGLE = "locked 'coin' -> unlocked 'push' -> locked;";

describe('renderStateDiagram — goldens (the pinned canon)', () => {

  test('the two-state toggle', () => {
    expect(renderStateDiagram(TOGGLE)).toBe([
      '┌────────────────┐',
      '│     ┌─ push ─┐ │',
      '│     ▼        │ │',
      '│ ┌────────┐   │ │',
      '│ │ locked │   │ │',
      '│ └───┬────┘   │ │',
      '│     │ coin   │ │',
      '│     └┐       │ │',
      '│      ▼       │ │',
      '│ ┌──────────┐ │ │',
      '│ │ unlocked │ │ │',
      '│ └────┬─────┘ │ │',
      '│      │       │ │',
      '│      └───────┘ │',
      '└────────────────┘',
    ].join('\n'));
  });

  test('the traffic light', () => {
    expect(renderStateDiagram("green 'time' -> yellow 'time' -> red 'time' -> green;")).toBe([
      '┌──────────────┐',
      '│     ┌──────┐ │',
      '│     ▼      │ │',
      '│ ┌───────┐  │ │',
      '│ │ green │  │ │',
      '│ └───┬───┘  │ │',
      '│     │ time │ │',
      '│     ▼      │ │',
      '│ ┌────────┐ │ │',
      '│ │ yellow │ │ │',
      '│ └───┬────┘ │ │',
      '│     │      │ │',
      '│    ┌┘ time │ │',
      '│    ▼       │ │',
      '│ ┌─────┐    │ │',
      '│ │ red │    │ │',
      '│ └──┬──┘    │ │',
      '│    │       │ │',
      '│    └ time ─┘ │',
      '└──────────────┘',
    ].join('\n'));
  });

});

describe('renderStateDiagram — behavior', () => {

  test('accepts a Digraph as well as FSL source', () => {
    const graph = normalizeGraph([
      { from: 'locked', to: 'unlocked', label: 'coin' },
      { from: 'unlocked', to: 'locked', label: 'push' },
    ]);
    expect(renderStateDiagram(graph)).toBe(renderStateDiagram(TOGGLE));
  });

  test('the active state is marked ▶ inside its box, exactly once', () => {
    const out = renderStateDiagram(TOGGLE, { activeState: 'locked' });
    expect(out).toContain('│ ▶ locked │');
    expect(count(out, '▶ locked')).toBe(1);
    expectWellFormed(out);
  });

  test('an unknown activeState is a RangeError naming the known states', () => {
    expect(() => renderStateDiagram(TOGGLE, { activeState: 'ajar' })).toThrow(RangeError);
    expect(() => renderStateDiagram(TOGGLE, { activeState: 'ajar' })).toThrow(/ajar/);
    expect(() => renderStateDiagram(TOGGLE, { activeState: 'ajar' })).toThrow(/locked, unlocked/);
  });

  test('frame: false drops the frame and still strips trailing whitespace', () => {
    const out = renderStateDiagram(TOGGLE, { frame: false });
    expect(out.startsWith('┌────────────────┐')).toBe(false);
    for (const line of out.split('\n')) { expect(line).not.toMatch(/ $/); }
    // The framed form is the unframed form plus the border.
    const framed = renderStateDiagram(TOGGLE);
    const inner = framed.split('\n').slice(1, -1).map(l => l.slice(2, -2).replace(/ +$/, ''));
    expect(out).toBe(inner.join('\n'));
  });

  test('every state label appears exactly once', () => {
    const out = renderStateDiagram(TOGGLE);
    expect(count(out, 'locked') - count(out, 'unlocked')).toBe(1);   // 'locked' box itself
    expect(count(out, 'unlocked')).toBe(1);
    expect(count(out, 'coin')).toBe(1);
    expect(count(out, 'push')).toBe(1);
  });

  test('a width too small to hold the machine refuses, naming fallbacks', () => {
    expect(() => renderStateDiagram(TOGGLE, { width: 12 })).toThrow(RangeError);
    expect(() => renderStateDiagram(TOGGLE, { width: 12 })).toThrow(/fall back/);
  });

  test('a nonsense width is rejected outright', () => {
    expect(() => renderStateDiagram(TOGGLE, { width: 4 })).toThrow(/at least 12/);
    expect(() => renderStateDiagram(TOGGLE, { width: 30.5 })).toThrow(RangeError);
  });

  test('deterministic: two calls, identical strings', () => {
    expect(renderStateDiagram(TOGGLE)).toBe(renderStateDiagram(TOGGLE));
  });

});

describe('renderDigraph', () => {

  const TRIHOST = normalizeGraph([
    { from: 'claude', to: 'root' }, { from: 'codex', to: 'root' }, { from: 'gemini', to: 'root' },
    { from: 'root', to: 'skills' }, { from: 'root', to: 'commands' },
  ]);

  test('golden: the tri-host fan-in/fan-out from the issue', () => {
    expect(renderDigraph(TRIHOST)).toBe([
      '┌───────────────────────────────────┐',
      '│ ┌────────┐  ┌───────┐  ┌────────┐ │',
      '│ │ claude │  │ codex │  │ gemini │ │',
      '│ └───┬────┘  └───┬───┘  └───┬────┘ │',
      '│     │           │          │      │',
      '│  ┌──┘           │          │      │',
      '│  │ ┌────────────┘          │      │',
      '│  │ │ ┌─────────────────────┘      │',
      '│  ▼ ▼ ▼                            │',
      '│ ┌──────┐                          │',
      '│ │ root │                          │',
      '│ └─┬─┬──┘                          │',
      '│   │ │                             │',
      '│   └─┤                             │',
      '│     ├────────────┐                │',
      '│     ▼            ▼                │',
      '│ ┌────────┐  ┌──────────┐          │',
      '│ │ skills │  │ commands │          │',
      '│ └────────┘  └──────────┘          │',
      '└───────────────────────────────────┘',
    ].join('\n'));
  });

  test('the golden satisfies the output invariants too', () => {
    expectWellFormed(renderDigraph(TRIHOST));
  });

  test('node labels draw instead of ids when given', () => {
    const out = renderDigraph(normalizeGraph(
      [{ from: 'a', to: 'b' }],
      [{ id: 'a', label: 'alpha' }, { id: 'b', label: 'beta' }],
    ));
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
    expect(out).not.toMatch(/│ a │/);
  });

});

describe('renderTree', () => {

  test('golden: the plugin layout fragment', () => {
    expect(renderTree('plugin', { plugin: ['skills', 'commands'], commands: ['claude', 'gemini'] })).toBe([
      '┌──────────────┐',
      '│ plugin       │',
      '│ ├─ skills    │',
      '│ └─ commands  │',
      '│    ├─ claude │',
      '│    └─ gemini │',
      '└──────────────┘',
    ].join('\n'));
  });

  test('labels substitute for ids', () => {
    const out = renderTree('r', { r: ['k'] }, { labels: { r: 'root dir', k: 'kid dir' } });
    expect(out).toContain('root dir');
    expect(out).toContain('├─ kid dir'.replace('├', '└'));
  });

  test('a shared node is refused by name, pointing at renderDigraph', () => {
    const shared = { a: ['b', 'c'], b: ['d'], c: ['d'] };
    expect(() => renderTree('a', shared)).toThrow(RangeError);
    expect(() => renderTree('a', shared)).toThrow(/'d'/);
    expect(() => renderTree('a', shared)).toThrow(/renderDigraph/);
  });

  test('a cycle is refused the same way', () => {
    expect(() => renderTree('a', { a: ['b'], b: ['a'] })).toThrow(RangeError);
    expect(() => renderTree('a', { a: ['b'], b: ['a'] })).toThrow(/'a'/);
  });

  test('an unreachable children key is refused by name', () => {
    expect(() => renderTree('a', { a: ['b'], z: ['q'] })).toThrow(RangeError);
    expect(() => renderTree('a', { a: ['b'], z: ['q'] })).toThrow(/'z'/);
  });

  test('a tree past the node threshold refuses, naming fallbacks', () => {
    const kids = Array.from({ length: 21 }, (_v, i) => `k${String(i)}`);
    expect(() => renderTree('r', { r: kids })).toThrow(RangeError);
    expect(() => renderTree('r', { r: kids })).toThrow(/legibility threshold/);
  });

  test('a line wider than the budget refuses rather than wraps', () => {
    expect(() => renderTree('short', { short: ['a-very-long-child-name'] }, { width: 20 }))
      .toThrow(/width budget/);
  });

});

describe('renderSequence', () => {

  test('golden: two actors, ask and answer', () => {
    expect(renderSequence(['human', 'agent'], [
      { from: 'human', to: 'agent', label: 'ask' },
      { from: 'agent', to: 'human', label: 'answer' },
    ])).toBe([
      '┌──────────────────────┐',
      '│ ┌───────┐  ┌───────┐ │',
      '│ │ human │  │ agent │ │',
      '│ └───┬───┘  └───┬───┘ │',
      '│     │          │     │',
      '│     │ ask      │     │',
      '│     ├─────────▶│     │',
      '│     │          │     │',
      '│     │ answer   │     │',
      '│     │◀─────────┤     │',
      '│     │          │     │',
      '└──────────────────────┘',
    ].join('\n'));
  });

  test('a message crossing an intermediate lifeline draws a ┼, never a break', () => {
    const out = renderSequence(['a', 'b', 'c'], [{ from: 'a', to: 'c' }]);
    const arrowLine = out.split('\n').find(l => l.includes('▶'));
    expect(arrowLine).toBeDefined();
    expect(arrowLine).toContain('┼');
    expectWellFormed(out);
  });

  test('a self-message draws its loop and keeps the lifeline continuous', () => {
    const out = renderSequence(['a', 'b'], [{ from: 'b', to: 'b', label: 'tick' }]);
    expect(out).toContain('├──┐');
    expect(out).toContain('│◀─┘');
    expect(out).toContain('tick');
    expectWellFormed(out);
  });

  test('every actor label appears exactly once; unlabeled messages carry no text', () => {
    const out = renderSequence(['one', 'two'], [{ from: 'one', to: 'two' }]);
    expect(out.split('one').length - 1).toBe(1);
    expect(out.split('two').length - 1).toBe(1);
  });

  test('an empty actor list, a duplicate, and an unknown endpoint each refuse', () => {
    expect(() => renderSequence([], [])).toThrow(RangeError);
    expect(() => renderSequence(['a', 'a'], [])).toThrow(/duplicate actor/);
    expect(() => renderSequence(['a'], [{ from: 'a', to: 'ghost' }])).toThrow(/'ghost'/);
  });

  test('too many actors refuse, naming the threshold', () => {
    const many = Array.from({ length: 21 }, (_v, i) => `a${String(i)}`);
    expect(() => renderSequence(many, [])).toThrow(/legibility threshold/);
  });

  test('a width the actors cannot fit refuses, naming fallbacks', () => {
    expect(() => renderSequence(['first-very-long-actor', 'second-very-long-actor'], [], { width: 24 }))
      .toThrow(/fall back/);
  });

  test('deterministic: two calls, identical strings', () => {
    const args: [string[], { from: string; to: string; label?: string }[]] =
      [['x', 'y'], [{ from: 'x', to: 'y', label: 'ping' }]];
    expect(renderSequence(...args)).toBe(renderSequence(...args));
  });

});
