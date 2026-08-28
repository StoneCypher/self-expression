/**
 * Command-line entry point for the self-expression plugin.
 *
 * Exists so all three host plugins can register one identical MCP server command —
 * `npx -y self-expression mcp` — rather than each pointing at a host-specific path.
 * Claude Code, Codex, and Gemini CLI expand different plugin-root variables, and npx
 * needs none of them.
 *
 * Parsing is separated from execution so the argument grammar can be tested without
 * spawning a process or starting a server.
 *
 * @see ../doc_md/plugin-layout.md
 */

import { HISTORY_CHARTS } from './raster/compose.js';
import type { HistoryChart } from './raster/compose.js';

/** A resolved `render` subcommand: the window, the chart, and where to write. */
export interface RenderCommand {
  readonly kind  : 'render';
  /** Days of history to render, counted back from now; a positive integer. */
  readonly days  : number;
  /** Which chart to draw — the dashboard, or one panel alone. */
  readonly chart : HistoryChart;
  /** Explicit output path, or `null` for the default beside the database. */
  readonly out   : string | null;
}

/** A resolved command line, after parsing but before execution. */
export type CliCommand =
  | { readonly kind: 'mcp' }
  | { readonly kind: 'hook'; readonly name: string }
  | { readonly kind: 'help' }
  | RenderCommand
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'unknown'; readonly token: string };

/** Streams the CLI writes to, injectable so tests can capture output. */
export interface CliStreams {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Resolve raw command-line arguments into a single command.
 *
 * `argv` is the argument list with the node binary and script path already removed —
 * `process.argv.slice(2)`. An empty list is treated as a help request rather than an
 * error, because a bare invocation is a question, not a mistake.
 *
 * Unrecognised input is returned as `unknown` carrying the offending token rather than
 * throwing, so the caller decides how loudly to fail.
 *
 * @example
 *   parseCommand(['mcp'])       // { kind: 'mcp' }
 *   parseCommand([])            // { kind: 'help' }
 *   parseCommand(['--help'])    // { kind: 'help' }
 *   parseCommand(['frobnicate'])// { kind: 'unknown', token: 'frobnicate' }
 */
export function parseCommand(argv: readonly string[]): CliCommand {

  const [first] = argv;

  if (first === undefined)                                    { return { kind: 'help' }; }
  if (first === 'mcp')                                        { return { kind: 'mcp'  }; }
  if (first === 'hook')                                       { return { kind: 'hook', name: argv[1] ?? '' }; }
  if (first === 'render')                                     { return parseRender(argv.slice(1)); }
  if (first === 'help' || first === '--help' || first === '-h') { return { kind: 'help' }; }

  return { kind: 'unknown', token: first };

}

/**
 * Parse the flags after `render` into a {@link RenderCommand}, or an `invalid`
 * command naming exactly what was wrong.
 *
 * Grammar: `render [--days N] [--chart X] [--out P]`, flags in any order. A bad
 * value is reported rather than silently defaulted, because a typo'd `--days`
 * silently becoming 90 would render the wrong chart while looking like success.
 *
 * @example
 *   parseRender(['--days', '30', '--chart', 'stems'])
 *   // => { kind: 'render', days: 30, chart: 'stems', out: null }
 *   parseRender(['--days', 'soon'])
 *   // => { kind: 'invalid', message: "--days must be a positive integer; got 'soon'" }
 */
function parseRender(rest: readonly string[]): CliCommand {

  let days                = 90,
      chart: HistoryChart = 'dashboard',
      out: string | null  = null;

  for (let i = 0; i < rest.length; i += 2) {

    const flag = rest[i], value = rest[i + 1];

    if (flag === undefined) { break; }
    if (value === undefined) {
      return { kind: 'invalid', message: `${flag} requires a value` };
    }

    switch (flag) {

      case '--days': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          return { kind: 'invalid', message: `--days must be a positive integer; got '${value}'` };
        }
        days = parsed;
        break;
      }

      case '--chart': {
        const found = HISTORY_CHARTS.find(name => name === value);
        if (found === undefined) {
          return { kind: 'invalid', message: `--chart must be one of ${HISTORY_CHARTS.join('|')}; got '${value}'` };
        }
        chart = found;
        break;
      }

      case '--out': {
        out = value;
        break;
      }

      default:
        return { kind: 'invalid', message: `render does not understand '${flag}'` };

    }

  }

  return { kind: 'render', days, chart, out };

}

/**
 * The text shown for `--help` and for a bare invocation.
 *
 * Kept as a pure function returning one string so it can be asserted against directly,
 * and so the help text has exactly one definition.
 *
 * @example
 *   helpText().startsWith('self-expression') // true
 */
export function helpText(): string {
  return [
    'self-expression — backchannels, charting, and turn-boundary discipline',
    '',
    'Usage:',
    '  self-expression mcp          start the MCP server on stdio',
    '  self-expression hook <name>  run a lifecycle hook, payload on stdin',
    '  self-expression render [--days N] [--chart X] [--out P]',
    '                               render logged history as a PNG; prints the path',
    '  self-expression help         show this message',
    '',
    'The MCP server is normally started by a host plugin rather than by hand;',
    'see .mcp.json in the plugin root.',
  ].join('\n');
}

/** Starts the MCP server and resolves when its transport closes. */
export type ServerStarter = () => Promise<void>;

/** Runs one named hook, reading its payload from stdin and writing its own output. */
export type HookRunner = (name: string) => Promise<void>;

/** Renders the history PNG and resolves to the absolute path it was written at. */
export type RenderRunner = (command: RenderCommand) => Promise<string>;

/**
 * Dispatch a command line, including the one command that is asynchronous.
 *
 * `mcp` runs a server until its transport closes, which `run` cannot express because it
 * returns a number. Everything else delegates to `run` unchanged, so the pure dispatch
 * stays pure and only the genuinely asynchronous path lives here.
 *
 * `startServer`, `runHook`, and `runRender` are injected so this can be tested
 * without opening a pipe, a database, or writing an image to disk.
 *
 * @example
 *   await runAsync(['help'], streams, start, hook, render)  // => 0, never calls start
 *   await runAsync(['mcp'],  streams, start, hook, render)  // => 0 once the transport closes
 *   await runAsync(['render', '--days', '30'], streams, start, hook, render)
 *   // => 0, having written the rendered path to streams.out
 */
export async function runAsync(
  argv        : readonly string[],
  streams     : CliStreams,
  startServer : ServerStarter,
  runHook     : HookRunner,
  runRender   : RenderRunner,
): Promise<number> {

  const command = parseCommand(argv);

  if (command.kind === 'mcp')  { await startServer();          return 0; }
  if (command.kind === 'hook') { await runHook(command.name);  return 0; }

  if (command.kind === 'render') {
    streams.out(await runRender(command));
    return 0;
  }

  return run(argv, streams);

}

/**
 * Execute a parsed command and report the process exit code.
 *
 * Returns the code rather than calling `process.exit`, so the whole dispatch path is
 * testable and so a caller embedding this can decide what to do. 0 means success;
 * any nonzero value is a failure suitable for passing straight to `process.exit`.
 *
 * @example
 *   run(['help'], streams)        // => 0, writes help to out
 *   run(['frobnicate'], streams)  // => 1, writes an error to err
 *
 * @throws Nothing. Failures are reported through the return code and `streams.err`.
 */
export function run(argv: readonly string[], streams: CliStreams): number {

  const command = parseCommand(argv);

  switch (command.kind) {

    case 'help':
      streams.out(helpText());
      return 0;

    case 'mcp':
    case 'hook':
    case 'render':
      streams.err(`self-expression: '${command.kind}' must be dispatched through runAsync.`);
      return 70;   // EX_SOFTWARE — reachable only by calling run() directly, which is a bug

    case 'invalid':
      streams.err(`self-expression: ${command.message}`);
      streams.err(helpText());
      return 64;   // EX_USAGE

    case 'unknown':
      streams.err(`self-expression: unknown command '${command.token}'`);
      streams.err(helpText());
      return 64;   // EX_USAGE

  }

}
