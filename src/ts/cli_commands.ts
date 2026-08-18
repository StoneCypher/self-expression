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

/** A resolved command line, after parsing but before execution. */
export type CliCommand =
  | { readonly kind: 'mcp' }
  | { readonly kind: 'help' }
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
  if (first === 'help' || first === '--help' || first === '-h') { return { kind: 'help' }; }

  return { kind: 'unknown', token: first };

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
    '  self-expression mcp     start the MCP server on stdio',
    '  self-expression help    show this message',
    '',
    'The MCP server is normally started by a host plugin rather than by hand;',
    'see .mcp.json in the plugin root.',
  ].join('\n');
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
      streams.err('self-expression: the MCP server is not implemented yet.');
      return 70;   // EX_SOFTWARE — the command is understood but unavailable

    case 'unknown':
      streams.err(`self-expression: unknown command '${command.token}'`);
      streams.err(helpText());
      return 64;   // EX_USAGE

  }

}
