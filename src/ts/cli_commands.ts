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
import { AUDIENCES, NOTE_STATES, describeVocabulary } from './channels/vocabulary.js';
import type { Audience, NoteState } from './channels/vocabulary.js';

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

/**
 * A resolved `messages` subcommand — the user's direct door into the messagebox
 * (issue #41), with no model in the loop.
 */
export interface MessagesCommand {
  readonly kind     : 'messages';
  /** Which mailbox to read; defaults to `user`, the human's own mail. */
  readonly audience : Audience;
  /** Coordination-box filter, or `null` for no filter. */
  readonly box      : string | null;
  /** Whether to write `reader: 'user'` receipts; collecting rather than peeking. */
  readonly ack      : boolean;
  /** Most messages printed; a positive integer, capped at 100. */
  readonly limit    : number;
}

/**
 * A resolved `notes` subcommand — the human's audit door onto held notes (issue #43).
 *
 * Read-only by design. The whole facility must work for someone who never runs this, so
 * the door is for looking; it is deliberately not a drain, and there is nothing here
 * that could mark a note delivered.
 */
export interface NotesCommand {
  readonly kind   : 'notes';
  /** State filter, or `null` for everything — including the notes that died. */
  readonly state  : NoteState | null;
  /** Most notes printed; a positive integer, capped at 200. */
  readonly limit  : number;
}

/** A resolved command line, after parsing but before execution. */
export type CliCommand =
  | { readonly kind: 'mcp' }
  | { readonly kind: 'hook'; readonly name: string }
  | { readonly kind: 'help' }
  | RenderCommand
  | MessagesCommand
  | NotesCommand
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
  if (first === 'messages')                                   { return parseMessages(argv.slice(1)); }
  if (first === 'notes')                                      { return parseNotes(argv.slice(1)); }
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
 * Parse the flags after `messages` into a {@link MessagesCommand}, or an `invalid`
 * command naming exactly what was wrong.
 *
 * Grammar: `messages [--audience A] [--box B] [--ack] [--limit N]`, flags in any
 * order. `--ack` is a bare flag — collecting is a decision, not a value — so this
 * loop advances one token at a time rather than two. A bad value is reported rather
 * than silently defaulted, because a typo'd audience quietly becoming `user` would
 * read the wrong mailbox while looking like success.
 *
 * @example
 *   parseMessages([])
 *   // => { kind: 'messages', audience: 'user', box: null, ack: false, limit: 20 }
 *   parseMessages(['--audience', 'agents', '--box', 'issue-41', '--ack'])
 *   // => { kind: 'messages', audience: 'agents', box: 'issue-41', ack: true, limit: 20 }
 *   parseMessages(['--audience', 'everyone'])
 *   // => { kind: 'invalid', message: "--audience must be one of 'self', 'agents', …" }
 */
function parseMessages(rest: readonly string[]): CliCommand {

  let audience: Audience    = 'user',
      box: string | null    = null,
      ack                   = false,
      limit                 = 20;

  let i = 0;
  while (i < rest.length) {

    const flag = rest[i];
    if (flag === undefined) { break; }

    if (flag === '--ack') { ack = true; i += 1; continue; }

    const value = rest[i + 1];
    if (value === undefined) {
      return { kind: 'invalid', message: `${flag} requires a value` };
    }

    switch (flag) {

      case '--audience': {
        const found = AUDIENCES.find(name => name === value);
        if (found === undefined) {
          return { kind: 'invalid',
                   message: `--audience must be one of ${describeVocabulary(AUDIENCES)}; got '${value}'` };
        }
        audience = found;
        break;
      }

      case '--box': {
        box = value;
        break;
      }

      case '--limit': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          return { kind: 'invalid', message: `--limit must be an integer from 1 to 100; got '${value}'` };
        }
        limit = parsed;
        break;
      }

      default:
        return { kind: 'invalid', message: `messages does not understand '${flag}'` };

    }

    i += 2;

  }

  return { kind: 'messages', audience, box, ack, limit };

}

/**
 * Parse the flags after `notes` into a {@link NotesCommand}, or an `invalid` command
 * naming exactly what was wrong.
 *
 * Grammar: `notes [--state S] [--limit N]`, flags in any order. A bad value is reported
 * rather than silently defaulted, for the same reason `messages` reports one: a typo'd
 * state quietly becoming "everything" would answer a different question while looking
 * like success.
 *
 * @example
 *   parseNotes([])
 *   // => { kind: 'notes', state: null, limit: 20 }
 *   parseNotes(['--state', 'expired'])
 *   // => { kind: 'notes', state: 'expired', limit: 20 }
 *   parseNotes(['--state', 'read'])
 *   // => { kind: 'invalid', message: "--state must be one of 'queued', … " }
 */
function parseNotes(rest: readonly string[]): CliCommand {

  let state: NoteState | null = null,
      limit                   = 20;

  for (let i = 0; i < rest.length; i += 2) {

    const flag = rest[i], value = rest[i + 1];

    if (flag === undefined) { break; }
    if (value === undefined) {
      return { kind: 'invalid', message: `${flag} requires a value` };
    }

    switch (flag) {

      case '--state': {
        const found = NOTE_STATES.find(name => name === value);
        if (found === undefined) {
          return { kind: 'invalid',
                   message: `--state must be one of ${describeVocabulary(NOTE_STATES)}; got '${value}'` };
        }
        state = found;
        break;
      }

      case '--limit': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
          return { kind: 'invalid', message: `--limit must be an integer from 1 to 200; got '${value}'` };
        }
        limit = parsed;
        break;
      }

      default:
        return { kind: 'invalid', message: `notes does not understand '${flag}'` };

    }

  }

  return { kind: 'notes', state, limit };

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
    '  self-expression messages [--audience A] [--box B] [--ack] [--limit N]',
    '                               read messagebox mail (default: yours); --ack marks it read',
    '  self-expression notes [--state S] [--limit N]',
    '                               list held notes and how each one ended; read-only',
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

/** Reads messagebox mail and resolves to the human-first report to print. */
export type MessagesRunner = (command: MessagesCommand) => Promise<string>;

/** Reads the held-note queue and resolves to the human-first report to print. */
export type NotesRunner = (command: NotesCommand) => Promise<string>;

/**
 * Dispatch a command line, including the one command that is asynchronous.
 *
 * `mcp` runs a server until its transport closes, which `run` cannot express because it
 * returns a number. Everything else delegates to `run` unchanged, so the pure dispatch
 * stays pure and only the genuinely asynchronous path lives here.
 *
 * `startServer`, `runHook`, `runRender`, `runMessages`, and `runNotes` are injected so
 * this can be tested without opening a pipe, a database, or writing an image to disk.
 *
 * @example
 *   await runAsync(['help'], streams, start, hook, render, messages, notes)  // => 0, never calls start
 *   await runAsync(['mcp'],  streams, start, hook, render, messages, notes)  // => 0 once the transport closes
 *   await runAsync(['messages', '--ack'], streams, start, hook, render, messages, notes)
 *   // => 0, having written the mail report to streams.out
 */
export async function runAsync(
  argv        : readonly string[],
  streams     : CliStreams,
  startServer : ServerStarter,
  runHook     : HookRunner,
  runRender   : RenderRunner,
  runMessages : MessagesRunner,
  runNotes    : NotesRunner,
): Promise<number> {

  const command = parseCommand(argv);

  if (command.kind === 'mcp')  { await startServer();          return 0; }
  if (command.kind === 'hook') { await runHook(command.name);  return 0; }

  if (command.kind === 'render') {
    streams.out(await runRender(command));
    return 0;
  }

  if (command.kind === 'messages') {
    streams.out(await runMessages(command));
    return 0;
  }

  if (command.kind === 'notes') {
    streams.out(await runNotes(command));
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
    case 'messages':
    case 'notes':
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
