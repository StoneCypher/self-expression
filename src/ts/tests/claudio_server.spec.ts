import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { openLedger, closeLedger } from '../claudio/ledger.js';
import type { AudioLedger } from '../claudio/ledger.js';
import { buildAudioServer, AUDIO_SERVER_NAME } from '../claudio/server.js';
import { registerAudioTools, newAudioSession } from '../claudio/tools.js';
import type { AudioDeps } from '../claudio/tools.js';
import { AUDIO_ENABLED_KEY, AUDIO_TTS_LOCAL_KEY } from '../claudio/config.js';

const deps: AudioDeps = {
  assetDir : 'unused',
  env      : {},
  play     : () => Promise.resolve({ ok: true, capped: false, detail: null }),
};

function withBoth<T>(fn: (store: Store, ledger: AudioLedger) => T): T {
  const dir    = mkdtempSync(join(tmpdir(), 'se-claudio-server-')),
        store  = openStore(join(dir, 'log.sqlite3')),
        ledger = openLedger(join(dir, 'audio.sqlite3'));
  try { return fn(store, ledger); }
  finally { closeStore(store); closeLedger(ledger); rmSync(dir, { recursive: true, force: true }); }
}

/** True when `name` is already registered — a duplicate registration throws. */
function has(server: McpServer, name: string): boolean {
  try {
    server.registerTool(name, { description: 'probe' }, () => ({ content: [] }));
    return false;
  } catch {
    return true;
  }
}

describe('buildAudioServer bakes the tools out of the schema', () => {

  test('a fresh install registers nothing — absence degrades to silence', () => withBoth((store, ledger) => {
    const server = buildAudioServer(store, ledger, '0.0.0', deps, 'win32');
    expect(has(server, 'strike')).toBe(false);
    expect(has(server, 'audition')).toBe(false);
    expect(has(server, 'say')).toBe(false);
  }));

  test('enabled on win32 registers strike and audition, but not say', () => withBoth((store, ledger) => {
    writeConfig(store, AUDIO_ENABLED_KEY, 'true');
    const server = buildAudioServer(store, ledger, '0.0.0', deps, 'win32');
    expect(has(server, 'strike')).toBe(true);
    expect(has(server, 'audition')).toBe(true);
    expect(has(server, 'say')).toBe(false);
  }));

  test('the local TTS tier adds say only behind its own gate', () => withBoth((store, ledger) => {
    writeConfig(store, AUDIO_ENABLED_KEY, 'true');
    writeConfig(store, AUDIO_TTS_LOCAL_KEY, 'true');
    const server = buildAudioServer(store, ledger, '0.0.0', deps, 'win32');
    expect(has(server, 'say')).toBe(true);
  }));

  test('a platform with no player registers nothing even when enabled', () => withBoth((store, ledger) => {
    writeConfig(store, AUDIO_ENABLED_KEY, 'true');
    writeConfig(store, AUDIO_TTS_LOCAL_KEY, 'true');
    const server = buildAudioServer(store, ledger, '0.0.0', deps, 'linux');
    expect(has(server, 'strike')).toBe(false);
    expect(has(server, 'say')).toBe(false);
  }));

  test("a non-exact enable ('yes') stays dark", () => withBoth((store, ledger) => {
    writeConfig(store, AUDIO_ENABLED_KEY, 'yes');
    const server = buildAudioServer(store, ledger, '0.0.0', deps, 'win32');
    expect(has(server, 'strike')).toBe(false);
  }));

  test('the handshake name is claudio, not self-expression', () => {
    expect(AUDIO_SERVER_NAME).toBe('claudio');
  });

});

describe('registerAudioTools', () => {

  test('registers on a fresh server without throwing', () => withBoth((store, ledger) => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => {
      registerAudioTools(server, store, ledger, deps, newAudioSession(), '0.0.0', true);
    }).not.toThrow();
    expect(has(server, 'strike')).toBe(true);
    expect(has(server, 'audition')).toBe(true);
    expect(has(server, 'say')).toBe(true);
  }));

});
