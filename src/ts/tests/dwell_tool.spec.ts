import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { openDwelling, closeDwelling }        from '../dwelling/store.js';
import type { DwellingStore }                 from '../dwelling/store.js';
import {
  DWELLING_ENABLED_KEY, DWELLING_PATH_KEY, DWELLING_SIZE_WARN_KEY,
} from '../dwelling/config.js';
import { dwellingDbPath }  from '../dwelling/paths.js';
import { handleDwell, maybeOpenDwelling, registerDwellTool } from '../mcp/dwell_tool.js';
import { buildServer }     from '../mcp/server.js';

function withBoth<T>(fn: (store: Store, house: DwellingStore, dir: string) => T): T {
  const dir   = mkdtempSync(join(tmpdir(), 'se-dwell-tool-')),
        store = openStore(join(dir, 'log.sqlite3')),
        house = openDwelling(join(dir, 'dwelling.sqlite3'));
  try { return fn(store, house, dir); }
  finally { closeDwelling(house); closeStore(store); rmSync(dir, { recursive: true, force: true }); }
}

/** Pulls the plain text out of a tool reply, the shape every assertion below checks. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

describe('handleDwell', () => {

  test('keep then visit round-trips the keepsake', () => withBoth((store, house) => {
    const kept = text(handleDwell(store, house, { op: 'keep', kind: 'quote', title: 'the desk', body: 'flat vs graph' }));
    expect(kept).toMatch(/^kept #1 /);
    const seen = JSON.parse(text(handleDwell(store, house, { op: 'visit' }))) as { recent: { title: string }[] };
    expect(seen.recent.map(k => k.title)).toEqual(['the desk']);
  }));

  test('visit honors the configured size threshold from the log store', () => withBoth((store, house) => {
    writeConfig(store, DWELLING_SIZE_WARN_KEY, '1');
    const seen = JSON.parse(text(handleDwell(store, house, { op: 'visit' }))) as { sizeWarning: string | null };
    expect(seen.sizeWarning).toBeNull();   // a fresh house is nowhere near 1 GB
  }));

  test('a missing required field replies error text naming it, in the house style', () => withBoth((store, house) => {
    expect(text(handleDwell(store, house, { op: 'keep', title: 't', body: 'b' }))).toContain("error: 'kind' is required");
    expect(text(handleDwell(store, house, { op: 'guestbook', author: 'John' }))).toContain("error: 'text' is required");
    expect(text(handleDwell(store, house, { op: 'link', edge: 'x' }))).toContain('error: link requires');
    expect(text(handleDwell(store, house, { op: 'unkeep' }))).toContain('error:');
  }));

  test('unkeep replies tombstone language and reports idempotence', () => withBoth((store, house) => {
    handleDwell(store, house, { op: 'keep', kind: 'toy', title: 'passing', body: 'b' });
    expect(text(handleDwell(store, house, { op: 'unkeep', id: 1 }))).toContain('tombstoned, not deleted');
    expect(text(handleDwell(store, house, { op: 'unkeep', id: 1 }))).toContain('already removed');
  }));

  test('pin, tag, link, and guestbook dispatch through', () => withBoth((store, house) => {
    handleDwell(store, house, { op: 'keep', kind: 'quote', title: 'a', body: 'b' });
    handleDwell(store, house, { op: 'guestbook', author: 'John', text: 'graffiti' });
    expect(text(handleDwell(store, house, { op: 'pin', id: 1 }))).toBe('#1 pinned = true');
    expect(text(handleDwell(store, house, { op: 'tag', id: 1, tag: 'blue' }))).toContain("'blue' attached");
    expect(text(handleDwell(store, house, { op: 'tag', id: 1, tag: 'blue', detach: true }))).toContain("'blue' detached");
    expect(text(handleDwell(store, house, { op: 'link', fromKind: 'kept', fromId: 1, toKind: 'guestbook', toId: 1, edge: 'moment-within' }))).toMatch(/^linked #1 /);
    expect(text(handleDwell(store, house, { op: 'guestbook', author: 'John', text: 'more' }))).toContain('relayed verbatim for John');
  }));

  test('an op-level failure becomes error text, never a throw across the tool boundary', () => withBoth((store, house) => {
    expect(text(handleDwell(store, house, { op: 'pin', id: 99 }))).toContain('error: no keep matches');
  }));

});

describe('maybeOpenDwelling', () => {

  test('returns null when unconfigured — the door does not exist', () => withBoth((store) => {
    expect(maybeOpenDwelling(store)).toBeNull();
  }));

  test('opens the dwelling when enabled with a valid path', () => withBoth((store, _house, dir) => {
    writeConfig(store, DWELLING_PATH_KEY,    dir);
    writeConfig(store, DWELLING_ENABLED_KEY, 'true');
    const opened = maybeOpenDwelling(store);
    expect(opened).not.toBeNull();
    expect(opened?.path).toBe(dwellingDbPath(dir));
    if (opened !== null) { closeDwelling(opened); }
  }));

  test('a refused database yields null rather than taking the server down', () => withBoth((store, _house, dir) => {
    const sub = join(dir, 'squatted');
    mkdirSync(sub);
    const bad = openStore(dwellingDbPath(sub));   // squats the dwelling path with log tables
    closeStore(bad);
    writeConfig(store, DWELLING_PATH_KEY,    sub);
    writeConfig(store, DWELLING_ENABLED_KEY, 'true');
    expect(maybeOpenDwelling(store)).toBeNull();
  }));

});

describe('registration follows config', () => {

  test('registerDwellTool registers on a fresh server without throwing', () => withBoth((store, house) => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => { registerDwellTool(server, store, house); }).not.toThrow();
  }));

  test('buildServer leaves dwell unregistered when inactive, so the door is absent', () => withBoth((store, house) => {
    const inactive = buildServer(store, '0.0.0', null);
    // registering dwell now must succeed, proving it was not already present
    expect(() => { registerDwellTool(inactive, store, house); }).not.toThrow();
  }));

  test('buildServer with no dwelling argument resolves from configuration', () => withBoth((store, house) => {
    const resolved = buildServer(store, '0.0.0');   // unconfigured => inactive => unregistered
    expect(() => { registerDwellTool(resolved, store, house); }).not.toThrow();
  }));

  test('buildServer registers dwell when handed an open dwelling', () => withBoth((store, house) => {
    const active = buildServer(store, '0.0.0', house);
    // a second registration of the same name throws, proving it was present
    expect(() => { registerDwellTool(active, store, house); }).toThrow();
  }));

  test('an adopted dwelling advertises its backup in the tool description', () => withBoth((store, house) => {
    const server  = new McpServer({ name: 'test', version: '0.0.0' }),
          adopted = { ...house, adoptedBackup: 'D:\\somewhere\\dwelling.sqlite3.pre-adopt-2026-08-28' };
    expect(() => { registerDwellTool(server, store, adopted); }).not.toThrow();
  }));

});
