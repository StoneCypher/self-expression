/**
 * Executable entry point for the `self-expression` bin.
 *
 * Deliberately thin: it wires real process streams and the real exit code to the pure
 * dispatcher in `cli_commands.ts`, and does nothing else. All behaviour worth testing
 * lives there, so importing this file is the only thing that starts a process — which
 * is exactly what Rollup needs from a bundle entry, and exactly what a test must avoid.
 *
 * @see ./cli_commands.js
 */

import { run } from './cli_commands.js';

process.exit(run(process.argv.slice(2), {
  out: (line: string): void => { console.log(line);   },
  err: (line: string): void => { console.error(line); },
}));
