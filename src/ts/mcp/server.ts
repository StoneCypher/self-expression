/**
 * The stdio MCP server.
 *
 * Thin by design: it opens the store, registers the tools, and connects a transport.
 * Everything worth testing lives in `tools.ts`, `chart_tools.ts`,
 * `checklist_tools.ts`, and the store modules, which need no pipe to exercise.
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
 */

import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }    from '../channels/store.js';
import { registerTools } from './tools.js';
import { registerChartTools } from './chart_tools.js';
import { registerChecklistTools } from './checklist_tools.js';

/** Name advertised to the host during the MCP handshake. */
export const SERVER_NAME = 'self-expression';

/**
 * Build a configured server without connecting it to anything.
 *
 * Separated from `startStdio` so tests can construct the real server, with the real
 * tools, against a temporary store.
 *
 * @example
 *   const server = buildServer(store, '0.2.0');
 */
export function buildServer(store: Store, version: string): McpServer {

  const server = new McpServer({ name: SERVER_NAME, version });

  registerTools(server, store, version);
  registerChartTools(server, store);
  registerChecklistTools(server, store, version);

  return server;

}

/**
 * Open the store, build the server, and serve on stdio until the transport closes.
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
        server    = buildServer(store, version),
        transport = new StdioServerTransport();

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

}
