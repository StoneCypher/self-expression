import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import { recordEntry }           from '../channels/entries.js';
import { buildServer }           from '../mcp/server.js';
import {
  handleRenderHistoryPng, renderHistoryToFile,
} from '../mcp/chart_tools.js';

const VERSION = '0.2.0';
const WHEN    = new Date('2026-08-27T21:15:04.321Z');

function withStore<T>(fn: (s: Store, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-raster-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s, dir); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Seeds a store with a small, realistic mixed history. */
function seed(s: Store): void {
  recordEntry(s, { channel: 'signature', text: 'open',  session: 's1', promptId: 'p1', position: 'open',  stem: 'flow',  delta: 'up',   project: 'atlas' }, VERSION, WHEN);
  recordEntry(s, { channel: 'signature', text: 'close', session: 's1', promptId: 'p1', position: 'close', stem: 'drag',  delta: 'down', uncertain: true  }, VERSION, WHEN);
  recordEntry(s, { channel: 'need',      text: 'merge #21?', session: 's1', promptId: 'p1' }, VERSION, WHEN);
  recordEntry(s, { channel: 'checklist', text: '- ✅', session: 's1', seriesKey: 'coverage', percent: 62 }, VERSION, WHEN);
  recordEntry(s, { channel: 'checklist', text: '- ✅', session: 's1', seriesKey: 'coverage', percent: 71 }, VERSION, WHEN);
}

/** Pulls the plain text out of a tool reply. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('renderHistoryToFile', () => {

  test('writes a PNG beside the database, under renders/, with a hyphenated UTC stamp', () => withStore((s, dir) => {
    seed(s);
    const result = renderHistoryToFile(s, {}, WHEN);
    expect(result.path).toBe(join(dir, 'renders', 'history_2026-08-27T21-15-04Z.png'));
    expect(result.path).not.toContain(':' + '15');   // colons hyphenated for Windows
    const bytes = readFileSync(result.path);
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(bytes.length).toBeGreaterThan(1000);
  }));

  test('reports how many rows fed each panel group', () => withStore(s => {
    seed(s);
    const result = renderHistoryToFile(s, {}, WHEN);
    expect(result.signatureCount).toBe(2);
    expect(result.weekCount).toBe(1);
    expect(result.seriesCount).toBe(1);
  }));

  test('an explicit out overrides the whole path', () => withStore((s, dir) => {
    seed(s);
    const out    = join(dir, 'elsewhere', 'chart.png');
    const result = renderHistoryToFile(s, { out }, WHEN);
    expect(result.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  }));

  test('an empty store still renders a file — five empty panels are an answer', () => withStore(s => {
    const result = renderHistoryToFile(s, {}, WHEN);
    expect(existsSync(result.path)).toBe(true);
    expect(result.signatureCount).toBe(0);
    expect(result.weekCount).toBe(0);
    expect(result.seriesCount).toBe(0);
  }));

  test('a project filter narrows the signature rows it draws from', () => withStore(s => {
    seed(s);
    expect(renderHistoryToFile(s, { project: 'atlas' },   WHEN).signatureCount).toBe(1);
    expect(renderHistoryToFile(s, { project: 'nowhere' }, WHEN).signatureCount).toBe(0);
  }));

  test('a seriesKey filter narrows the checklist panel to that one series', () => withStore(s => {
    seed(s);
    recordEntry(s, { channel: 'checklist', text: '- ✅', session: 's1', seriesKey: 'other', percent: 10 }, VERSION, WHEN);
    expect(renderHistoryToFile(s, { seriesKey: 'coverage' }, WHEN).seriesCount).toBe(1);
    expect(renderHistoryToFile(s, { seriesKey: 'nonesuch' }, WHEN).seriesCount).toBe(0);
  }));

  test('the day window actually excludes older rows', () => withStore(s => {
    const old = new Date(WHEN.getTime() - 40 * 86_400_000);
    recordEntry(s, { channel: 'signature', text: 'old', session: 's0', position: 'open' }, VERSION, old);
    expect(renderHistoryToFile(s, { days: 90 }, WHEN).signatureCount).toBe(1);
    expect(renderHistoryToFile(s, { days: 30 }, WHEN).signatureCount).toBe(0);
  }));

});

describe('handleRenderHistoryPng', () => {

  test('returns the path plus a one-line row-count summary as text — never image content', () => withStore(s => {
    seed(s);
    const reply = handleRenderHistoryPng(s, { days: 30 }, WHEN);
    expect(reply.content).toHaveLength(1);
    expect(reply.content[0]?.type).toBe('text');
    const [path, summary] = text(reply).split('\n');
    expect(path?.endsWith('history_2026-08-27T21-15-04Z.png')).toBe(true);
    expect(existsSync(path ?? '')).toBe(true);
    expect(summary).toContain('2 signatures');
    expect(summary).toContain('30 days');
  }));

  test('a domain violation is reported as error text, not thrown', () => withStore(s => {
    const out = text(handleRenderHistoryPng(s, { days: -5 }, WHEN));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('positive integer');
  }));

  test('a write failure is reported as error text, not a protocol fault', () => withStore((s, dir) => {
    // A directory path as `out` cannot be written as a file.
    const out = text(handleRenderHistoryPng(s, { out: dir }, WHEN));
    expect(out).toMatch(/^error: /);
  }));

});

describe('registration', () => {

  test('buildServer registers render_history_png alongside the rest without throwing', () => withStore(s => {
    expect(() => buildServer(s, VERSION)).not.toThrow();
  }));

});
