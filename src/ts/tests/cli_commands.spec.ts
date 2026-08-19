import { parseCommand, helpText, run, runAsync } from '../cli_commands.js';
import type { CliStreams }                       from '../cli_commands.js';

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

  test('the synchronous path refuses mcp rather than pretending to start a server', () => {
    const { streams, out, err } = capture();
    expect(run(['mcp'], streams)).toBe(70);
    expect(err.join('\n')).toContain('runAsync');
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

describe('hook parsing', () => {

  test('hook carries its name', () => {
    expect(parseCommand(['hook', 'stop'])).toEqual({ kind: 'hook', name: 'stop' });
  });

  test('a nameless hook parses rather than throwing, and dispatches to nothing', () => {
    expect(parseCommand(['hook'])).toEqual({ kind: 'hook', name: '' });
  });

});

describe('runAsync', () => {

  test('hook dispatches by name and never starts a server', async () => {
    const { streams } = capture();
    let ran = '', served = false;
    const code = await runAsync(['hook', 'stop'], streams,
      () => { served = true; return Promise.resolve(); },
      (n) => { ran = n; return Promise.resolve(); });
    expect(ran).toBe('stop');
    expect(served).toBe(false);
    expect(code).toBe(0);
  });


  test('mcp starts the server and succeeds once its transport closes', async () => {
    const { streams } = capture();
    let started = false;
    const noHook = (): Promise<void> => Promise.resolve();
    const code = await runAsync(['mcp'], streams, () => { started = true; return Promise.resolve(); }, noHook);
    expect(started).toBe(true);
    expect(code).toBe(0);
  });

  test('never starts a server for any other command', async () => {
    const { streams } = capture();
    let started = false;
    const start  = (): Promise<void> => { started = true; return Promise.resolve(); },
          noHook = (): Promise<void> => Promise.resolve();
    for (const argv of [['help'], [], ['--help'], ['frobnicate']]) {
      await runAsync(argv, streams, start, noHook);
    }
    expect(started).toBe(false);
  });

  test('delegates non-mcp exit codes unchanged', async () => {
    const a = capture(), b = capture();
    const start = (): Promise<void> => Promise.resolve();
    expect(await runAsync(['help'], a.streams, start, start)).toBe(0);
    expect(await runAsync(['frobnicate'], b.streams, start, start)).toBe(64);
  });

  test('propagates a startup failure rather than reporting success', async () => {
    const { streams } = capture();
    const noHook = (): Promise<void> => Promise.resolve();
    await expect(runAsync(['mcp'], streams, () => Promise.reject(new Error('no disk')), noHook))
      .rejects.toThrow('no disk');
  });

  test('the old help-equivalence still holds', () => {
    const bare = capture(),
          help = capture();
    expect(run([], bare.streams)).toBe(run(['help'], help.streams));
    expect(bare.out).toEqual(help.out);
  });

});
