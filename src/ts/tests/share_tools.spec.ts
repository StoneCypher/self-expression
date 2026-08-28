/**
 * Unit tests for the `share` MCP tool: the preview-before-export gate, the refusal
 * messages, the status report, and the file write — all through the real handler
 * against a real store, never a hand-built expected object.
 */

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { recordEntry } from '../channels/entries.js';
import {
  makeShareSession, resolveGranularity, handleShare, registerShareTools,
} from '../mcp/share_tools.js';
import { buildServer } from '../mcp/server.js';
import type { PublicExport } from '../channels/public_export.js';

function withStore<T>(fn: (s: Store, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-share-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s, dir); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

function optIn(s: Store): void {
  writeConfig(s, 'share.enabled', 'true');
  writeConfig(s, 'share.opted_in_utc', '2020-01-01T00:00:00.000Z');
}

const V = '0.0.0-test';

describe('resolveGranularity', () => {

  test('an explicit argument wins; the config key is the fallback; hour is the default', () => withStore(s => {
    expect(resolveGranularity(s, 'day')).toBe('day');
    expect(resolveGranularity(s, undefined)).toBe('hour');
    writeConfig(s, 'share.time_granularity', 'day');
    expect(resolveGranularity(s, undefined)).toBe('day');
  }));

  test('a garbage stored granularity resolves to hour rather than wedging', () => withStore(s => {
    writeConfig(s, 'share.time_granularity', 'fortnight');
    expect(resolveGranularity(s, undefined)).toBe('hour');
  }));

});

describe('export refusals — the gate, in configure error style', () => {

  test('export refuses when sharing is off, writing nothing', () => withStore(s => {
    const session = makeShareSession(),
          out     = handleShare(s, session, V, { op: 'export' });
    expect(out.content[0]?.text).toMatch(/^error: sharing is off/);
  }));

  test('export refuses when enabled but no opt-in moment is on record', () => withStore(s => {
    writeConfig(s, 'share.enabled', 'true');
    const out = handleShare(s, makeShareSession(), V, { op: 'export' });
    expect(out.content[0]?.text).toMatch(/^error: no opt-in moment/);
  }));

  test('export refuses until a preview for the same options was rendered this session', () => withStore(s => {
    optIn(s);
    const session = makeShareSession(),
          refused = handleShare(s, session, V, { op: 'export' });
    expect(refused.content[0]?.text).toMatch(/^error: no preview/);

    handleShare(s, session, V, { op: 'preview' });
    const allowed = handleShare(s, session, V, { op: 'export' });
    expect(allowed.content[0]?.text).not.toMatch(/^error/);
  }));

  test('a preview at one granularity does not unlock export at another', () => withStore(s => {
    optIn(s);
    const session = makeShareSession();
    handleShare(s, session, V, { op: 'preview', granularity: 'hour' });
    const refused = handleShare(s, session, V, { op: 'export', granularity: 'day' });
    expect(refused.content[0]?.text).toMatch(/^error: no preview .* 'day'/);
  }));

  test('the gate is per session — a fresh session must preview again', () => withStore(s => {
    optIn(s);
    handleShare(s, makeShareSession(), V, { op: 'preview' });
    const refused = handleShare(s, makeShareSession(), V, { op: 'export' });
    expect(refused.content[0]?.text).toMatch(/^error: no preview/);
  }));

});

describe('export output', () => {

  test('without a path, export returns the JSON submission document itself', () => withStore(s => {
    optIn(s);
    recordEntry(s, { channel: 'signature', text: 'prose', session: 's1', stem: 'flow' }, V);
    const session = makeShareSession();
    handleShare(s, session, V, { op: 'preview' });
    const out = handleShare(s, session, V, { op: 'export' }),
          doc = JSON.parse(out.content[0]?.text ?? '') as PublicExport;
    expect(doc.meta.row_count).toBe(1);
    expect(doc.rows[0]?.['stem']).toBe('flow');
    expect(out.content[0]?.text).not.toContain('prose');
  }));

  test('with a path, export writes the document to the file and reports the count', () => withStore((s, dir) => {
    optIn(s);
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1' }, V);
    const session = makeShareSession(),
          path    = join(dir, 'submission.json');
    handleShare(s, session, V, { op: 'preview' });
    const out = handleShare(s, session, V, { op: 'export', path });
    expect(out.content[0]?.text).toContain('exported 1 rows');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as PublicExport;
    expect(doc.meta.row_count).toBe(1);
  }));

  test('an unwritable path is reported as an error, not thrown through the protocol', () => withStore((s, dir) => {
    optIn(s);
    const session = makeShareSession();
    handleShare(s, session, V, { op: 'preview' });
    const out = handleShare(s, session, V, { op: 'export', path: join(dir, 'nope', 'deeper', 'x.json') });
    expect(out.content[0]?.text).toMatch(/^error: could not write/);
  }));

});

describe('status', () => {

  test('reports the gate facts and eligible count without touching a row', () => withStore(s => {
    optIn(s);
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1' }, V);
    const session = makeShareSession();
    handleShare(s, session, V, { op: 'preview' });
    const out    = handleShare(s, session, V, { op: 'status' }),
          status = JSON.parse(out.content[0]?.text ?? '') as Record<string, unknown>;
    expect(status).toMatchObject({
      share_enabled : true,
      opted_in_utc  : '2020-01-01T00:00:00.000Z',
      eligible_rows : 1,
      previewed     : ['hour'],
    });
  }));

  test('a fresh install reports disabled with nothing eligible', () => withStore(s => {
    const out    = handleShare(s, makeShareSession(), V, { op: 'status' }),
          status = JSON.parse(out.content[0]?.text ?? '') as Record<string, unknown>;
    expect(status).toMatchObject({ share_enabled: false, opted_in_utc: null, eligible_rows: 0 });
  }));

});

describe('registration', () => {

  test('buildServer registers the share tool without throwing, alongside the others', () => withStore(s => {
    expect(() => buildServer(s, V)).not.toThrow();
    // Registering the same tool name twice throws — proof `share` is actually on the server.
    expect(() => registerShareTools(buildServer(s, V), s, V)).toThrow();
  }));

});
