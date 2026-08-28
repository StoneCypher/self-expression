/**
 * Executable entry point for the `self-expression` bin.
 *
 * Deliberately thin: it resolves the version, wires real process streams, stdin, and
 * the real exit code to the dispatcher in `cli_commands.ts`, and does nothing else.
 * All behaviour worth testing lives there and in the store modules, so importing this
 * file is the only thing that starts a process — which is exactly what Rollup needs
 * from a bundle entry, and exactly what a test must avoid.
 *
 * @see ./cli_commands.js
 * @see ./mcp/server.js
 * @see ./mcp/hooks.js
 */

import { readFileSync }  from 'node:fs';
import { join }          from 'node:path';
import { runAsync }      from './cli_commands.js';
import type { RenderCommand } from './cli_commands.js';
import { startStdio }    from './mcp/server.js';
import { handleHook }    from './mcp/hooks.js';
import type { HookPayload } from './mcp/hooks.js';
import { renderHistoryToFile } from './mcp/chart_tools.js';
import { openStore, closeStore } from './channels/store.js';
import type { Store }    from './channels/store.js';

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

/** Drain stdin fully; resolves to an empty string if it never arrives. */
async function readStdin(): Promise<string> {
  try {
    const parts: string[] = [];
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) { parts.push(String(chunk)); }
    return parts.join('');
  } catch {
    return '';
  }
}

/**
 * Run one hook: read its payload, dispatch, write whatever it decided.
 *
 * Every failure path allows the turn. A hook that cannot open the database still emits
 * the ambient clock; a hook that cannot parse its payload emits nothing at all. A bug
 * in the enforcer must never be able to wedge a session, because the person it wedges
 * cannot debug it from inside the wedge.
 */
async function runHook(name: string): Promise<void> {

  const raw = await readStdin();

  let payload: HookPayload = {};
  try { payload = JSON.parse(raw) as HookPayload; } catch { /* allow */ }

  let store: Store | null = null;
  try { store = openStore(); } catch { /* allow */ }

  const output = handleHook(name, store, payload);

  if (output !== null) { process.stdout.write(JSON.stringify(output)); }

}

/**
 * Run one `render` command against the real store: query, draw, write the PNG,
 * and resolve to the path it landed at. The store is closed even when the
 * render throws, so a failed write cannot leak a database handle.
 */
function runRender(command: RenderCommand): Promise<string> {
  const store = openStore();
  try {
    const result = renderHistoryToFile(store, {
      days  : command.days,
      chart : command.chart,
      ...(command.out === null ? {} : { out: command.out }),
    });
    return Promise.resolve(result.path);
  } finally {
    closeStore(store);
  }
}

const streams = {
  out: (line: string): void => { console.log(line);   },
  err: (line: string): void => { console.error(line); },
};

runAsync(process.argv.slice(2), streams, () => startStdio(version()), runHook, runRender)
  .then(code => { process.exit(code); })
  .catch((error: unknown) => {
    console.error(`self-expression: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(70);
  });
