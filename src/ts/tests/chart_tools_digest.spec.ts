import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import { recordEntry }           from '../channels/entries.js';
import { handleRenderDigest, handleRenderChecklistSummary } from '../mcp/chart_tools.js';

const VERSION = '0.2.0';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-digest-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Pulls the plain text out of a tool reply, the shape every assertion below checks. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

describe('handleRenderDigest', () => {

  test('findings profile renders the severity digest with no scalar axis', () => withStore(s => {
    const out = text(handleRenderDigest(s, {
      profile : 'findings',
      units   : [{ marker: '❗' }, { marker: '⚠️' }, { marker: '⚠️' }],
    }));
    expect(out).toBe('1/2/0 findings  ⚠️ 2  ❗ 1');
  }));

  test('diff profile classifies by explicit change kind and sums the +N −M tail', () => withStore(s => {
    const out = text(handleRenderDigest(s, {
      profile : 'diff',
      units   : [
        { marker: '🧪', bucket: 'added', plus: 40 },
        { marker: '🪚', bucket: 'modified', plus: 12, minus: 8 },
        { marker: '🗑️', bucket: 'removed', minus: 30 },
      ],
    }));
    expect(out).toBe('1/1/1 files +52 −38  🧪 1  🪚 1  🗑️ 1');
  }));

  test('the checklist profile renders the same bytes as render_checklist_summary', () => withStore(s => {
    const units = [{ marker: '✅' }, { marker: '✅' }, { marker: '❌' }];
    expect(text(handleRenderDigest(s, { profile: 'checklist', units })))
      .toBe(text(handleRenderChecklistSummary(s, { items: units })));
  }));

  test('seriesKey resolves to the recorded percent history and appends the trend', () => withStore(s => {
    for (const percent of [10, 40, 70, 100]) {
      recordEntry(s, { channel: 'need', text: 'checkpoint', session: 's1', seriesKey: 'digest-trend', percent }, VERSION);
    }
    const out = text(handleRenderDigest(s, {
      profile   : 'findings',
      units     : [{ marker: '⚠️' }],
      seriesKey : 'digest-trend',
    }));
    expect(out).toBe('0/1/0 findings  trend ▁▄▆█  ⚠️ 1');
  }));

  test('an empty units array returns an error reply, never a protocol fault', () => withStore(s => {
    const out = text(handleRenderDigest(s, { profile: 'findings', units: [] }));
    expect(out.startsWith('error: ')).toBe(true);
    expect(out).toContain('non-empty');
  }));

});
