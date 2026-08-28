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
import type { HistoryChart } from './raster/compose.js';
import type { Audience } from './channels/vocabulary.js';
/** A resolved `render` subcommand: the window, the chart, and where to write. */
export interface RenderCommand {
    readonly kind: 'render';
    /** Days of history to render, counted back from now; a positive integer. */
    readonly days: number;
    /** Which chart to draw — the dashboard, or one panel alone. */
    readonly chart: HistoryChart;
    /** Explicit output path, or `null` for the default beside the database. */
    readonly out: string | null;
}
/**
 * A resolved `messages` subcommand — the user's direct door into the messagebox
 * (issue #41), with no model in the loop.
 */
export interface MessagesCommand {
    readonly kind: 'messages';
    /** Which mailbox to read; defaults to `user`, the human's own mail. */
    readonly audience: Audience;
    /** Coordination-box filter, or `null` for no filter. */
    readonly box: string | null;
    /** Whether to write `reader: 'user'` receipts; collecting rather than peeking. */
    readonly ack: boolean;
    /** Most messages printed; a positive integer, capped at 100. */
    readonly limit: number;
}
/** A resolved command line, after parsing but before execution. */
export type CliCommand = {
    readonly kind: 'mcp';
} | {
    readonly kind: 'hook';
    readonly name: string;
} | {
    readonly kind: 'help';
} | RenderCommand | MessagesCommand | {
    readonly kind: 'invalid';
    readonly message: string;
} | {
    readonly kind: 'unknown';
    readonly token: string;
};
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
export declare function parseCommand(argv: readonly string[]): CliCommand;
/**
 * The text shown for `--help` and for a bare invocation.
 *
 * Kept as a pure function returning one string so it can be asserted against directly,
 * and so the help text has exactly one definition.
 *
 * @example
 *   helpText().startsWith('self-expression') // true
 */
export declare function helpText(): string;
/** Starts the MCP server and resolves when its transport closes. */
export type ServerStarter = () => Promise<void>;
/** Runs one named hook, reading its payload from stdin and writing its own output. */
export type HookRunner = (name: string) => Promise<void>;
/** Renders the history PNG and resolves to the absolute path it was written at. */
export type RenderRunner = (command: RenderCommand) => Promise<string>;
/** Reads messagebox mail and resolves to the human-first report to print. */
export type MessagesRunner = (command: MessagesCommand) => Promise<string>;
/**
 * Dispatch a command line, including the one command that is asynchronous.
 *
 * `mcp` runs a server until its transport closes, which `run` cannot express because it
 * returns a number. Everything else delegates to `run` unchanged, so the pure dispatch
 * stays pure and only the genuinely asynchronous path lives here.
 *
 * `startServer`, `runHook`, `runRender`, and `runMessages` are injected so this can
 * be tested without opening a pipe, a database, or writing an image to disk.
 *
 * @example
 *   await runAsync(['help'], streams, start, hook, render, messages)  // => 0, never calls start
 *   await runAsync(['mcp'],  streams, start, hook, render, messages)  // => 0 once the transport closes
 *   await runAsync(['messages', '--ack'], streams, start, hook, render, messages)
 *   // => 0, having written the mail report to streams.out
 */
export declare function runAsync(argv: readonly string[], streams: CliStreams, startServer: ServerStarter, runHook: HookRunner, runRender: RenderRunner, runMessages: MessagesRunner): Promise<number>;
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
export declare function run(argv: readonly string[], streams: CliStreams): number;
//# sourceMappingURL=cli_commands.d.ts.map