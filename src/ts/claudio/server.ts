/**
 * The claudio stdio MCP server — the audio facility's **own** surface.
 *
 * A separate server, a separate process, a separate bundle: the issue rules that
 * audio is its own facility, and the structural guarantee that a broken audio stack
 * can never break the backchannel is this process boundary. The server reads the
 * shared config table (the #30 registry owns the `audio.*` keys) and keeps its own
 * strike ledger.
 *
 * When the facility is disabled — or the platform has no player — the server starts
 * with **zero tools**: baked out of the schema, not present-but-refusing, so absence
 * degrades to silence, which is the correct failure mode for a sound system.
 *
 * stdout is the protocol channel; every human-facing message goes to stderr, exactly
 * as in `mcp/server.ts`.
 *
 * @see ./tools.js
 * @see ../mcp/server.js
 */

import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn }                from 'node:child_process';

import { openStore, closeStore }    from '../channels/store.js';
import type { Store }               from '../channels/store.js';
import { audioConfig }              from './config.js';
import { openLedger, closeLedger }  from './ledger.js';
import type { AudioLedger }         from './ledger.js';
import { platformHasPlayer, runPlayer }              from './player.js';
import type { PlayerCommand, PlayOutcome }           from './player.js';
import { newAudioSession, registerAudioTools }       from './tools.js';
import type { AudioDeps }                            from './tools.js';

/** Name advertised to the host during the MCP handshake. */
export const AUDIO_SERVER_NAME = 'claudio';

/**
 * The real player: spawn the command detached from stdio (the protocol channel must
 * never see a child's output) and supervise it under the cap.
 */
function spawnAndPlay(command: PlayerCommand, capMs: number): Promise<PlayOutcome> {
  return runPlayer(
    command,
    (exe, args) => spawn(exe, [...args], { stdio: 'ignore', windowsHide: true }),
    capMs,
  );
}

/**
 * Build a configured claudio server without connecting it to anything, mirroring
 * `buildServer` so tests can construct the real thing against temporary stores.
 *
 * Tools register only when `audio.enabled` reads exactly `'true'` **and** the
 * platform has a player; the `say` tier additionally needs `audio.tts_local`. The
 * handlers re-check configuration per call regardless — this startup gate only
 * decides what appears in the schema.
 *
 * @param platform - a `process.platform` value; injectable for tests
 *
 * @example
 *   const server = buildAudioServer(store, ledger, '0.2.1', deps, 'win32');
 */
export function buildAudioServer(
  store    : Store,
  ledger   : AudioLedger,
  version  : string,
  deps     : AudioDeps,
  platform : string = process.platform,
): McpServer {

  const server = new McpServer({ name: AUDIO_SERVER_NAME, version }),
        config = audioConfig(store, deps.env ?? process.env);

  if (config.enabled && platformHasPlayer(platform)) {
    registerAudioTools(server, store, ledger, deps, newAudioSession(), version, config.ttsLocal);
  }

  return server;

}

/**
 * Open the stores, build the server, and serve on stdio until the transport closes.
 *
 * @param version  - the plugin version, stamped onto every ledger row
 * @param assetDir - directory of the vendored leitmotif WAVs, resolved by the entry
 *                   point from the bundle's own location
 *
 * @example
 *   await startAudioStdio('0.2.1', defaultAssetDir(__dirname));   // blocks, serving
 *
 * @throws {Error} If the data directory cannot be created or a database cannot open —
 *                 loud on purpose; a facility that cannot ledger must not play.
 */
export async function startAudioStdio(version: string, assetDir: string): Promise<void> {

  const store  = openStore(),
        ledger = openLedger(),
        deps: AudioDeps = { assetDir, play: spawnAndPlay },
        server = buildAudioServer(store, ledger, version, deps),
        config = audioConfig(store);

  process.stderr.write(
    `${AUDIO_SERVER_NAME} ${version} — ` +
    (config.enabled && platformHasPlayer(process.platform)
      ? `enabled, ceiling ${String(config.ceiling)}, ledger at ${ledger.path}\n`
      : 'silent (disabled or no player on this platform); no tools registered\n'));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>(resolve => {
    transport.onclose = (): void => { resolve(); };
  });

  closeStore(store);
  closeLedger(ledger);

}
