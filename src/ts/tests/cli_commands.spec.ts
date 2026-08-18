import { parseCommand, helpText, run } from '../cli_commands.js';
import type { CliStreams }             from '../cli_commands.js';

/** Collect everything the dispatcher writes, so exit codes and output can both be asserted. */
function capture(): { streams: CliStreams; out: string[]; err: string[] } {
  const out: string[] = [],
        err: string[] = [];
  return { streams: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe('parseCommand', () => {

  test('an empty argument list is a help request, not an error', () => {
    expect(parseCommand([])).toEqual({ kind: 'help' });
  });

  test('recognises the mcp subcommand', () => {
    expect(parseCommand(['mcp'])).toEqual({ kind: 'mcp' });
  });

  test.each(['help', '--help', '-h'])('recognises %s as help', (flag) => {
    expect(parseCommand([flag])).toEqual({ kind: 'help' });
  });

  test('reports an unrecognised command without throwing, carrying the token', () => {
    expect(parseCommand(['frobnicate'])).toEqual({ kind: 'unknown', token: 'frobnicate' });
  });

  test('ignores arguments after the first', () => {
    expect(parseCommand(['mcp', '--verbose', 'extra'])).toEqual({ kind: 'mcp' });
  });

});

describe('helpText', () => {

  test('names the binary and both subcommands', () => {
    const text = helpText();
    expect(text).toContain('self-expression');
    expect(text).toContain('mcp');
    expect(text).toContain('help');
  });

});

describe('run', () => {

  test('help succeeds and writes to stdout, not stderr', () => {
    const { streams, out, err } = capture();
    expect(run(['help'], streams)).toBe(0);
    expect(out.join('\n')).toContain('Usage:');
    expect(err).toHaveLength(0);
  });

  test('mcp reports unavailable with EX_SOFTWARE rather than pretending to start', () => {
    const { streams, out, err } = capture();
    expect(run(['mcp'], streams)).toBe(70);
    expect(err.join('\n')).toContain('not implemented');
    expect(out).toHaveLength(0);
  });

  test('an unknown command exits EX_USAGE and shows help on stderr', () => {
    const { streams, out, err } = capture();
    expect(run(['frobnicate'], streams)).toBe(64);
    expect(err.join('\n')).toContain('frobnicate');
    expect(err.join('\n')).toContain('Usage:');
    expect(out).toHaveLength(0);
  });

  test('a bare invocation behaves exactly like help', () => {
    const bare = capture(),
          help = capture();
    expect(run([], bare.streams)).toBe(run(['help'], help.streams));
    expect(bare.out).toEqual(help.out);
  });

});
