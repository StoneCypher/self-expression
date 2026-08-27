import {
  renderTimelineRail, renderTimelineColored, renderDependencyChain, renderFsl,
  type Milestone,
} from '../charts/timeline.js';

// Independent reproduction of the rail arithmetic documented in visuals.md §
// "Process timeline": labels join on four spaces, and each marker sits at
// `labelStart + floor((labelLength - 1) / 2)` on a `━` rail spanning the label row's
// exact width. This is a second, from-the-rule derivation used as the test oracle -
// not a call into the renderer under test - so a bug shared by both would have to be
// a bug in the *rule itself*, not in one implementation of it.
const RAIL_GAP = '    ';
const RAIL_CHAR = '\u{2501}'; // ━
const RAIL_MARKERS: Readonly<Record<'reached' | 'current' | 'future', string>> = {
  reached: '\u{25CF}', // ●
  current: '\u{25C6}', // ◆
  future:  '\u{25CB}', // ○
};

function deriveRail(milestones: readonly Milestone[]): string {
  const labelLine = milestones.map(m => m.label).join(RAIL_GAP);
  const rail = Array.from({ length: labelLine.length }, () => RAIL_CHAR);
  let cursor = 0;
  for (const m of milestones) {
    if (m.state === 'failed') { throw new Error('deriveRail: failed has no rail glyph'); }
    const column = cursor + Math.floor((m.label.length - 1) / 2);
    rail[column] = RAIL_MARKERS[m.state];
    cursor += m.label.length + RAIL_GAP.length;
  }
  return `${rail.join('')}\n${labelLine}`;
}

describe('renderTimelineRail', () => {

  const milestones: readonly Milestone[] = [
    { label: 'spec',  state: 'reached' },
    { label: 'build', state: 'reached' },
    { label: 'test',  state: 'current' },
    { label: 'ship',  state: 'future' },
  ];

  test('matches the column arithmetic derived independently from the documented rule', () => {
    expect(renderTimelineRail(milestones)).toBe(deriveRail(milestones));
  });

  test('renders the exact two-line string for the four-milestone example', () => {
    // Derived by hand from the rule, not copied from the renderer's own output:
    // labels join on 4 spaces -> "spec    build    test    ship" (29 chars);
    // spec starts at 0 (len 4)  -> marker col 0 + floor(3/2) = 1
    // build starts at 8 (len 5) -> marker col 8 + floor(4/2) = 10
    // test starts at 17 (len 4) -> marker col 17 + floor(3/2) = 18
    // ship starts at 25 (len 4) -> marker col 25 + floor(3/2) = 26
    const expected =
      '\u{2501}\u{25CF}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}' +
      '\u{25CF}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}' +
      '\u{25C6}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}' +
      '\u{25CB}\u{2501}\u{2501}' +
      '\nspec    build    test    ship';
    expect(renderTimelineRail(milestones)).toBe(expected);
  });

  test('the rail line and the label line are equal length', () => {
    const [rail, labels] = renderTimelineRail(milestones).split('\n');
    expect([...(rail ?? '')].length).toBe([...(labels ?? '')].length);
  });

  test('a single milestone centers its marker over its own label', () => {
    const single: readonly Milestone[] = [{ label: 'go', state: 'current' }];
    expect(renderTimelineRail(single)).toBe(deriveRail(single));
    expect(renderTimelineRail(single)).toBe('\u{25C6}\u{2501}\ngo');
  });

  test('a failed milestone throws RangeError pointing at renderTimelineColored', () => {
    const withFailure: readonly Milestone[] = [
      { label: 'spec', state: 'reached' },
      { label: 'ship', state: 'failed' },
    ];
    expect(() => renderTimelineRail(withFailure)).toThrow(RangeError);
    expect(() => renderTimelineRail(withFailure)).toThrow(/renderTimelineColored/);
    expect(() => renderTimelineRail(withFailure)).toThrow(/'failed'/);
  });

  test('an empty milestone list throws RangeError', () => {
    expect(() => renderTimelineRail([])).toThrow(RangeError);
  });

  // Regression coverage for a review finding: floor((labelLength - 1) / 2) on an
  // empty label collapses to floor(-1 / 2) = -1. As the first milestone that writes
  // rail[-1], a non-index property `.join('')` silently ignores - the marker simply
  // vanishes rather than throwing or corrupting visible output.
  test('an empty label on the first milestone throws RangeError instead of silently dropping its marker', () => {
    const withEmptyFirst: readonly Milestone[] = [
      { label: '', state: 'reached' },
      { label: 'ship', state: 'future' },
    ];
    expect(() => renderTimelineRail(withEmptyFirst)).toThrow(RangeError);
    expect(() => renderTimelineRail(withEmptyFirst)).toThrow(/non-empty label/);
  });

  // As a later milestone, the same arithmetic lands one column before `cursor`,
  // silently overwriting the previous milestone's trailing rail character instead of
  // vanishing outright - a second, distinct corruption from the first-milestone case.
  test('an empty label on a later milestone throws RangeError instead of corrupting the previous marker', () => {
    const withEmptyLater: readonly Milestone[] = [
      { label: 'spec', state: 'reached' },
      { label: '', state: 'future' },
    ];
    expect(() => renderTimelineRail(withEmptyLater)).toThrow(RangeError);
    expect(() => renderTimelineRail(withEmptyLater)).toThrow(/non-empty label/);
  });

  test('a one-character label still centers correctly (floor((1 - 1) / 2) = 0)', () => {
    const oneChar: readonly Milestone[] = [
      { label: 'a', state: 'reached' },
      { label: 'b', state: 'future' },
    ];
    expect(renderTimelineRail(oneChar)).toBe(deriveRail(oneChar));
    expect(renderTimelineRail(oneChar)).toBe('\u{25CF}\u{2501}\u{2501}\u{2501}\u{2501}\u{25CB}\na    b');
  });

});

describe('renderTimelineColored', () => {

  test('renders the documented four-state example, joined by double rail', () => {
    const milestones: readonly Milestone[] = [
      { label: 'spec',  state: 'reached' },
      { label: 'build', state: 'failed' },
      { label: 'test',  state: 'current' },
      { label: 'ship',  state: 'future' },
    ];
    expect(renderTimelineColored(milestones)).toBe(
      '\u{1F7E2} spec \u{2501}\u{2501} \u{1F536} build \u{2501}\u{2501} \u{1F7E6} test \u{2501}\u{2501} \u{25CE} ship'
    );
  });

  test('renders the same string with literal emoji, for a human-readable cross-check', () => {
    const milestones: readonly Milestone[] = [
      { label: 'spec',  state: 'reached' },
      { label: 'build', state: 'failed' },
      { label: 'test',  state: 'current' },
      { label: 'ship',  state: 'future' },
    ];
    expect(renderTimelineColored(milestones)).toBe('🟢 spec ━━ 🔶 build ━━ 🟦 test ━━ ◎ ship');
  });

  test('a single milestone renders with no join separator', () => {
    expect(renderTimelineColored([{ label: 'go', state: 'reached' }])).toBe('🟢 go');
  });

  test('failed is a valid state for the colored form (unlike the monochrome rail)', () => {
    expect(() => renderTimelineColored([{ label: 'x', state: 'failed' }])).not.toThrow();
  });

  test('an empty milestone list throws RangeError', () => {
    expect(() => renderTimelineColored([])).toThrow(RangeError);
  });

  test('an empty label throws RangeError, for consistency with the rail form', () => {
    expect(() => renderTimelineColored([{ label: '', state: 'reached' }])).toThrow(RangeError);
    expect(() => renderTimelineColored([{ label: '', state: 'reached' }])).toThrow(/non-empty label/);
  });

});

describe('renderDependencyChain', () => {

  test('renders the documented example: current step underlined with combining U+0332', () => {
    expect(renderDependencyChain(['lint', 'test', 'build', 'deploy'], 2))
      .toBe('lint \u{2501} test \u{2501} b\u{0332}u\u{0332}i\u{0332}l\u{0332}d\u{0332} \u{2501} deploy');
  });

  test('renders the same string with literal glyphs, for a human-readable cross-check', () => {
    expect(renderDependencyChain(['lint', 'test', 'build', 'deploy'], 2))
      .toBe('lint ━ test ━ b̲u̲i̲l̲d̲ ━ deploy');
  });

  test('every non-current step keeps its plain characters, no underline mark present', () => {
    const rendered = renderDependencyChain(['lint', 'test', 'build', 'deploy'], 2);
    expect(rendered.startsWith('lint \u{2501} test \u{2501} ')).toBe(true);
    expect(rendered.endsWith(' \u{2501} deploy')).toBe(true);
  });

  test('underlining the first step', () => {
    expect(renderDependencyChain(['a', 'b'], 0)).toBe('a\u{0332} \u{2501} b');
  });

  test('underlining the last step', () => {
    expect(renderDependencyChain(['a', 'b'], 1)).toBe('a \u{2501} b\u{0332}');
  });

  test('a single-step chain underlines that one step', () => {
    expect(renderDependencyChain(['solo'], 0)).toBe('s\u{0332}o\u{0332}l\u{0332}o\u{0332}');
  });

  test('an empty step list throws RangeError', () => {
    expect(() => renderDependencyChain([], 0)).toThrow(RangeError);
  });

  test('a negative currentIndex throws RangeError', () => {
    expect(() => renderDependencyChain(['a', 'b'], -1)).toThrow(RangeError);
  });

  test('a currentIndex at or past the step count throws RangeError', () => {
    expect(() => renderDependencyChain(['a', 'b'], 2)).toThrow(RangeError);
  });

  test('a non-integer currentIndex throws RangeError', () => {
    expect(() => renderDependencyChain(['a', 'b'], 0.5)).toThrow(RangeError);
  });

  test('an empty step string throws RangeError, for consistency with the milestone label guard', () => {
    expect(() => renderDependencyChain(['a', '', 'c'], 0)).toThrow(RangeError);
    expect(() => renderDependencyChain(['a', '', 'c'], 0)).toThrow(/non-empty label/);
  });

  test('an empty current step also throws RangeError', () => {
    expect(() => renderDependencyChain(['a', ''], 1)).toThrow(RangeError);
  });

  test('underlines by Unicode code point, not UTF-16 code unit, so a surrogate-pair step name gets one underline mark per glyph', () => {
    const rendered = renderDependencyChain(['\u{1F680}build', 'test'], 0);
    const expectedFirstStep = Array.from('\u{1F680}build', ch => `${ch}\u{0332}`).join('');
    expect(rendered).toBe(`${expectedFirstStep} \u{2501} test`);
    // exactly one underline mark immediately after the (single, two-code-unit) rocket
    // emoji, not two - proof the implementation iterates by code point via
    // Array.from(text, ...), not by UTF-16 code unit via a naive index loop
    expect(rendered.startsWith('\u{1F680}\u{0332}')).toBe(true);
    expect(rendered.split('\u{0332}').length - 1).toBe(Array.from('\u{1F680}build').length);
  });

});

describe('renderFsl', () => {

  test('renders the documented turnstile example: connected transitions merge into one chain', () => {
    const rendered = renderFsl(
      [
        { from: 'locked',   to: 'unlocked', action: 'coin' },
        { from: 'unlocked', to: 'locked',   action: 'push' },
      ],
      'locked',
    );
    expect(rendered).toBe("**locked** 'coin' -> unlocked 'push' -> locked;");
  });

  // Controller ruling: bold ONLY the first occurrence of the active state, never any
  // later occurrence - even though 'locked' appears twice in the turnstile cycle above,
  // only the first (opening) occurrence is wrapped in `**`.
  test('bolds only the first occurrence of the active state, not the later one', () => {
    const rendered = renderFsl(
      [
        { from: 'locked',   to: 'unlocked', action: 'coin' },
        { from: 'unlocked', to: 'locked',   action: 'push' },
      ],
      'locked',
    );
    expect(rendered.match(/\*\*locked\*\*/g)?.length).toBe(1);
    // Standalone "locked" occurrences only - "unlocked" contains "locked" as a
    // substring and must not be counted as a second occurrence of the state.
    expect((rendered.match(/(?<!un)locked/g) ?? []).length).toBe(2);
    expect(rendered.endsWith('push\' -> locked;')).toBe(true);
  });

  test('bolds the active state even when it first appears mid-chain, not just at the start', () => {
    const rendered = renderFsl(
      [
        { from: 'a', to: 'b', action: 'x' },
        { from: 'b', to: 'c', action: 'y' },
      ],
      'b',
    );
    expect(rendered).toBe("a 'x' -> **b** 'y' -> c;");
  });

  test('with no activeState given, nothing is bolded', () => {
    const rendered = renderFsl([
      { from: 'locked', to: 'unlocked', action: 'coin' },
    ]);
    expect(rendered).not.toContain('**');
    expect(rendered).toBe("locked 'coin' -> unlocked;");
  });

  test('an activeState absent from every transition leaves the output unbolded', () => {
    const rendered = renderFsl(
      [{ from: 'locked', to: 'unlocked', action: 'coin' }],
      'nowhere',
    );
    expect(rendered).not.toContain('**');
  });

  test('non-connecting transitions render as separate semicolon-terminated statements', () => {
    const rendered = renderFsl([
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd' },
    ]);
    expect(rendered).toBe('a -> b; c -> d;');
  });

  test('a transition with no action omits the quoted action label', () => {
    const rendered = renderFsl([{ from: 'idle', to: 'running' }]);
    expect(rendered).toBe('idle -> running;');
  });

  test('a mix of connected and non-connecting transitions merges and separates correctly', () => {
    const rendered = renderFsl([
      { from: 'a', to: 'b', action: 'x' },
      { from: 'b', to: 'c', action: 'y' },
      { from: 'p', to: 'q', action: 'z' },
    ]);
    expect(rendered).toBe("a 'x' -> b 'y' -> c; p 'z' -> q;");
  });

  test('every statement ends with a semicolon, including the only statement', () => {
    const rendered = renderFsl([{ from: 'a', to: 'b' }]);
    expect(rendered.endsWith(';')).toBe(true);
    expect(rendered.match(/;/g)?.length).toBe(1);
  });

  test('an empty transitions list throws RangeError', () => {
    expect(() => renderFsl([])).toThrow(RangeError);
  });

});
