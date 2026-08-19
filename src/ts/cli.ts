/**
 * Executable entry point for the `self-expression` bin.
 *
 * Deliberately thin: it resolves the version, wires real process streams and the real
 * exit code to the dispatcher in `cli_commands.ts`, and does nothing else. All
 * behaviour worth testing lives there and in the store modules, so importing this file
 * is the only thing that starts a process — which is exactly what Rollup needs from a
 * bundle entry, and exactly what a test must avoid.
 *
 * @see ./cli_commands.js
 * @see ./mcp/server.js
 */

import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import { runAsync }     from './cli_commands.js';
import { startStdio }   from './mcp/server.js';

/** Present in the CommonJS bundle Rollup emits; this file is never imported as ESM. */
declare const __dirname: string;

/**
 * The package version, read from the manifest beside the installed bundle.
 *
 * Read at runtime rather than compiled in, so a published package cannot report a
 * version it was not published as. Falls back rather than throwing — an unreadable
 * manifest should not stop the server from serving.
 */
function version(): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
      return String((manifest).version);
    }
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const streams = {
  out: (line: string): void => { console.log(line);   },
  err: (line: string): void => { console.error(line); },
};

runAsync(process.argv.slice(2), streams, () => startStdio(version()))
  .then(code => { process.exit(code); })
  .catch((error: unknown) => {
    console.error(`self-expression: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(70);
  });
