import { parseFsl } from '../diagrams/fsl.js';
import { renderFsl } from '../charts/timeline.js';

describe('parseFsl — the accepted subset', () => {

  test('a bare transition', () => {
    expect(parseFsl('a -> b;')).toEqual({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ from: 'a', to: 'b' }],
    });
  });

  test("the renderFsl docblock example: actions become edge labels", () => {
    expect(parseFsl("locked 'coin' -> unlocked 'push' -> locked;")).toEqual({
      nodes: [{ id: 'locked' }, { id: 'unlocked' }],
      edges: [
        { from: 'locked', to: 'unlocked', label: 'coin' },
        { from: 'unlocked', to: 'locked', label: 'push' },
      ],
    });
  });

  test('chained arrows unroll into consecutive edges', () => {
    expect(parseFsl('a -> b -> c;').edges).toEqual([
      { from: 'a', to: 'b' }, { from: 'b', to: 'c' },
    ]);
  });

  test('multiple ;-separated statements accumulate', () => {
    expect(parseFsl('a -> b; c -> d;').edges).toEqual([
      { from: 'a', to: 'b' }, { from: 'c', to: 'd' },
    ]);
  });

  test('**bold** active-state marks are stripped', () => {
    const g = parseFsl("**locked** 'coin' -> unlocked;");
    expect(g.nodes.map(n => n.id)).toEqual(['locked', 'unlocked']);
  });

  test('whitespace is free between tokens', () => {
    expect(parseFsl("  a   'go'\n->\n  b ;")).toEqual(parseFsl("a 'go' -> b;"));
  });

  test('a self-loop parses', () => {
    expect(parseFsl("retry 'fail' -> retry;").edges).toEqual([
      { from: 'retry', to: 'retry', label: 'fail' },
    ]);
  });

});

describe('parseFsl — rejections name the subset', () => {

  const rejects = (source: string, detail: RegExp): void => {
    expect(() => parseFsl(source)).toThrow(RangeError);
    expect(() => parseFsl(source)).toThrow(detail);
    expect(() => parseFsl(source)).toThrow(/subset/);
  };

  test('empty and blank input', () => {
    rejects('', /at least one transition/);
    rejects('   ', /at least one transition/);
  });

  test('a lone state with no transition', () => {
    rejects('a;', /no transition/);
  });

  test('a missing terminal semicolon', () => {
    rejects('a -> b', /';'/);
  });

  test('a dangling arrow', () => {
    rejects('a ->;', /state name/);
    rejects('a ->', /state name/);
  });

  test("an action with nothing after it", () => {
    rejects("a 'go';", /'->'/);
  });

  test('an unterminated quoted action', () => {
    rejects("a 'go -> b;", /unterminated/);
  });

  test('an empty quoted action', () => {
    rejects("a '' -> b;", /empty quoted action/);
  });

  test('jssm probabilities are outside the subset', () => {
    rejects("a 50% -> b;", /probabilities/);
  });

  test('machine metadata is outside the subset', () => {
    rejects('machine_name: "x"; a -> b;', /named machines|metadata/);
  });

  test('other arrow kinds are outside the subset', () => {
    rejects('a <-> b;', /arrow kinds/);
    rejects('a => b;', /arrow kinds/);
    rejects('a ~> b;', /arrow kinds/);
  });

  test('a stray asterisk that is not a bold wrapper', () => {
    rejects('a* -> b;', /'\*'/);
  });

});

describe('parseFsl round-trips renderFsl (the pinned canon)', () => {

  test('the two-state toggle round-trips exactly', () => {
    const transitions = [
      { from: 'locked', to: 'unlocked', action: 'coin' },
      { from: 'unlocked', to: 'locked', action: 'push' },
    ];
    const parsed = parseFsl(renderFsl(transitions));
    expect(parsed.edges).toEqual([
      { from: 'locked', to: 'unlocked', label: 'coin' },
      { from: 'unlocked', to: 'locked', label: 'push' },
    ]);
  });

  test('an active state renders bold and still round-trips', () => {
    const transitions = [
      { from: 'locked', to: 'unlocked', action: 'coin' },
      { from: 'unlocked', to: 'locked', action: 'push' },
    ];
    const source = renderFsl(transitions, 'locked');
    expect(source).toContain('**locked**');
    expect(parseFsl(source).edges).toEqual([
      { from: 'locked', to: 'unlocked', label: 'coin' },
      { from: 'unlocked', to: 'locked', label: 'push' },
    ]);
  });

  test('disconnected statements round-trip', () => {
    const transitions = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }];
    expect(parseFsl(renderFsl(transitions)).edges).toEqual([
      { from: 'a', to: 'b' }, { from: 'c', to: 'd' },
    ]);
  });

});
