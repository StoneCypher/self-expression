/**
 * The stdio MCP server.
 *
 * Thin by design: it opens the store, registers the tools, and connects a transport.
 * Everything worth testing lives in `tools.ts`, `chart_tools.ts`,
 * `checklist_tools.ts`, `diagram_tools.ts`, and the store modules, which need no
 * pipe to exercise.
 *
 * One constraint shapes this whole file — **stdout is the protocol channel**. Anything
 * written there that is not a JSON-RPC frame corrupts the stream and the host sees a
 * broken server rather than a diagnostic. Every human-facing message therefore goes to
 * stderr, including the `node:sqlite` experimental warning, which is harmless precisely
 * because it lands there.
 *
 * @see ./tools.js
 * @see ./chart_tools.js
 * @see ./checklist_tools.js
 * @see ./diagram_tools.js
 * @see ./share_tools.js
 */

import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { openStore, closeStore } from '../channels/store.js';
import { pruneExpired }  from '../channels/retention.js';
import type { Store }    from '../channels/store.js';
import { registerTools } from './tools.js';
import { registerChartTools } from './chart_tools.js';
import { registerChecklistTools } from './checklist_tools.js';
import { registerDiagramTools } from './diagram_tools.js';
import { registerShareTools } from './share_tools.js';
import { maybeOpenDwelling, registerDwellTool } from './dwell_tool.js';
import { closeDwelling } from '../dwelling/store.js';
import type { DwellingStore } from '../dwelling/store.js';

/** Name advertised to the host during the MCP handshake. */
export const SERVER_NAME = 'self-expression';

/**
 * Build a configured server without connecting it to anything.
 *
 * Separated from `startStdio` so tests can construct the real server, with the real
 * tools, against a temporary store.
 *
 * The `dwell` tool is registered only when the dwelling is active — absent from the
 * tool list, not present-but-refusing, so a locked door costs no attention. Pass
 * `dwelling` explicitly to control that in tests, or omit it to let configuration
 * decide via `maybeOpenDwelling`.
 *
 * @param dwelling - an open dwelling to register, `null` for none, or omit to resolve
 *                   from configuration; a caller who passes one also owns closing it
 *
 * @example
 *   const server = buildServer(store, '0.2.0');
 */
export function buildServer(store: Store, version: string, dwelling?: DwellingStore | null): McpServer {

  const server = new McpServer({ name: SERVER_NAME, version });

  registerTools(server, store, version);
  registerChartTools(server, store);
  registerChecklistTools(server, store, version);
  registerDiagramTools(server, store);
  registerShareTools(server, store, version);

  const house = dwelling === undefined ? maybeOpenDwelling(store) : dwelling;
  if (house !== null) { registerDwellTool(server, store, house); }

  return server;

}

/**
 * Open the store, run startup retention, build the server, and serve on stdio until
 * the transport closes.
 *
 * Resolves when the connection ends. `dbFile` is injectable for tests; it defaults to
 * the resolved data directory.
 *
 * @example
 *   await startStdio('0.2.0');   // blocks, serving the host
 *
 * @throws {Error} If the data directory cannot be created or the database cannot open.
 *                 Failing loudly here is correct: a server that starts without storage
 *                 would accept expressions and silently discard them.
 */
export async function startStdio(version: string, dbFile?: string): Promise<void> {

  const store     = dbFile === undefined ? openStore() : openStore(dbFile),
        house     = maybeOpenDwelling(store),
        server    = buildServer(store, version, house),
        transport = new StdioServerTransport();

  // Startup retention (issue #30, D6): prune rows past the configured horizon, once
  // per server process, before any turn's reads. A pruning failure must not keep the
  // server from starting — retention is a horizon, not a gate — so it fails open with
  // a note on stderr, which is the diagnostics channel here.
  try {
    const pruned = pruneExpired(store);
    if (pruned.entries > 0 || pruned.turnContext > 0) {
      process.stderr.write(
        `${SERVER_NAME}: retention pruned ${String(pruned.entries)} entries and ` +
        `${String(pruned.turnContext)} turn-context rows\n`);
    }
  } catch (error) {
    process.stderr.write(`${SERVER_NAME}: retention pruning failed, continuing: ${String(error)}\n`);
  }

  process.stderr.write(`${SERVER_NAME} ${version} — logging to ${store.path}\n`);

  await server.connect(transport);

  // `connect` resolves once the transport is attached, not when the session ends.
  // Returning here would let the caller exit the process immediately, killing a server
  // that had just finished announcing itself — which is exactly what it did before this
  // wait existed. Stay alive until stdin closes and the transport reports it.
  await new Promise<void>((resolve) => {
    transport.onclose = (): void => { resolve(); };
  });

  closeStore(store);
  if (house !== null) { closeDwelling(house); }

}
