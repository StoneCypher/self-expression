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
import { onboardingInstructions } from '../channels/onboarding.js';
import {
  availableConventions, conventionsPointer, defaultConventionsRoot, packageRoot,
} from '../channels/conventions.js';
import type { ConventionDoc } from '../channels/conventions.js';
import { registerConventionResources } from './resources.js';
import { pruneExpired }  from '../channels/retention.js';
import type { Store }    from '../channels/store.js';
import { registerTools } from './tools.js';
import { registerChartTools } from './chart_tools.js';
import { registerChecklistTools } from './checklist_tools.js';
import { registerMessageTools } from './message_tools.js';
import { registerNoteTools } from './note_tools.js';
import { registerDiagramTools } from './diagram_tools.js';
import { registerShareTools } from './share_tools.js';
import { maybeOpenDwelling, registerDwellTool } from './dwell_tool.js';
import { closeDwelling } from '../dwelling/store.js';
import type { DwellingStore } from '../dwelling/store.js';

/** Name advertised to the host during the MCP handshake. */
export const SERVER_NAME = 'self-expression';

/**
 * The `instructions` string for one connection, or `null` when there is nothing to say.
 *
 * Two things ride this transport, and they ride it for the same reason: the MCP
 * `initialize` handshake is the one channel every host implements, so anything that must
 * reach a host with no hooks and no skills has to travel here. Onboarding says a
 * questionnaire is pending; the conventions pointer says where the practice is served.
 *
 * They are joined rather than nested because they are independent — a fresh database on
 * a skill-having host has onboarding and no useful pointer, a settled database on a bare
 * MCP client has the pointer and no onboarding, and either can be absent without
 * disturbing the other.
 *
 * Kept short deliberately. Everything here is paid for on every connection to every
 * host, which is exactly why the conventions themselves are resources and only the
 * pointer to them is here.
 *
 * @param store the open store, for the onboarding half
 * @param docs  the convention documents actually available, for the pointer half
 *
 * @example
 *   serverInstructions(store, availableConventions('/pkg'))
 *   // => 'Onboarding pending (9 questions). … The conventions these tools assume …'
 *
 * @see ../channels/onboarding.js onboardingInstructions
 * @see ../channels/conventions.js conventionsPointer
 */
export function serverInstructions(
  store : Store,
  docs  : readonly ConventionDoc[],
): string | null {
  const parts = [onboardingInstructions(store), conventionsPointer(docs)]
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join('\n\n');
}

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
 * When onboarding questions are pending (issue #40), the server's `instructions`
 * string says so — the MCP initialize handshake delivers it on every host, which is
 * why hooks are deliberately not part of that detection path. The `onboard` tool
 * itself is always registered, so permission caches never see a tool flicker.
 *
 * The conventions ride the same two channels, split by cost: a short pointer joins the
 * `instructions` string, and the documents themselves are registered as **resources**,
 * pulled on demand. A host that already loaded the skills is told so by the pointer and
 * reads nothing; a host with no skills at all can list and fetch them. Neither is
 * fatal — a package whose convention files cannot be found registers no resources,
 * omits the pointer, and serves every tool exactly as before.
 *
 * @param dwelling - an open dwelling to register, `null` for none, or omit to resolve
 *                   from configuration; a caller who passes one also owns closing it
 * @param root     - the package root the convention documents are read from; omit to
 *                   discover it from the running script and the working directory
 *
 * @example
 *   const server = buildServer(store, '0.2.0');
 *
 * @see serverInstructions
 * @see ./resources.js registerConventionResources
 */
export function buildServer(
  store    : Store,
  version  : string,
  dwelling?: DwellingStore | null,
  root?    : string | null,
): McpServer {

  const where   = root === undefined ? defaultConventionsRoot() : root,
        docs    = availableConventions(where),
        pending = serverInstructions(store, docs);

  const server = pending === null
    ? new McpServer({ name: SERVER_NAME, version })
    : new McpServer({ name: SERVER_NAME, version }, { instructions: pending });

  registerConventionResources(server, where);
  registerTools(server, store, version);
  registerChartTools(server, store);
  registerChecklistTools(server, store, version);
  registerMessageTools(server, store, version);
  registerNoteTools(server, store, version);
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
 * `bundleDir` is the running bundle's directory — `__dirname` in the CJS bundle — from
 * which the convention documents are found one level up. Passing it beats searching:
 * the entry point knows exactly where it sits, and the search
 * ({@link ../channels/conventions.js defaultConventionsRoot}) exists for callers that do
 * not, such as the test suite. Omitting it falls back to that search.
 *
 * @param bundleDir the running bundle's directory; omit to discover the package root
 *
 * @example
 *   await startStdio('0.2.0');                 // blocks, serving the host
 *   await startStdio('0.2.0', undefined, __dirname);
 *
 * @throws {Error} If the data directory cannot be created or the database cannot open.
 *                 Failing loudly here is correct: a server that starts without storage
 *                 would accept expressions and silently discard them.
 */
export async function startStdio(version: string, dbFile?: string, bundleDir?: string): Promise<void> {

  const store     = dbFile === undefined ? openStore() : openStore(dbFile),
        house     = maybeOpenDwelling(store),
        root      = bundleDir === undefined ? undefined : packageRoot(bundleDir),
        server    = buildServer(store, version, house, root),
        transport = new StdioServerTransport();

  // Startup retention (issue #30, D6): prune rows past the configured horizon, once
  // per server process, before any turn's reads. A pruning failure must not keep the
  // server from starting — retention is a horizon, not a gate — so it fails open with
  // a note on stderr, which is the diagnostics channel here.
  try {
    const pruned = pruneExpired(store);
    if (pruned.entries > 0 || pruned.turnContext > 0 || pruned.messages > 0) {
      process.stderr.write(
        `${SERVER_NAME}: retention pruned ${String(pruned.entries)} entries, ` +
        `${String(pruned.turnContext)} turn-context rows, ${String(pruned.messages)} messages, ` +
        `${String(pruned.messageReads)} orphaned receipts, and ${String(pruned.notes)} held notes\n`);
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
