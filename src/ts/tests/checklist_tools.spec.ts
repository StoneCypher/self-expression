import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import { recordContext }         from '../channels/context.js';
import { seriesPercents }        from '../channels/entries.js';
import { renderChecklistSummary } from '../charts/checklist.js';
import {
  handleLogChecklist, handleRecallChecklists, handleCheckChecklist, registerChecklistTools,
} from '../mcp/checklist_tools.js';

const VERSION = '0.2.0';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-checklist-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Pulls the plain text out of a tool reply, the shape every assertion below checks. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

/** A real rendered block: the items verbatim plus the renderer's own summary line. */
function block(succ: number, active: number, fail: number): string {
  const items = [
    ...Array<{ marker: string }>(succ).fill({ marker: '✅' }),
    ...Array<{ marker: string }>(active).fill({ marker: '🔜' }),
    ...Array<{ marker: string }>(fail).fill({ marker: '❌' }),
  ];
  const lines = items.map((item, i) => `- ${item.marker} item ${String(i)}`);
  return `${lines.join('\n')}\n\n${renderChecklistSummary(items)}`;
}

describe('handleLogChecklist', () => {

  test('records a checklist row with the summary parsed out of the block', () => withStore(s => {
    const out = text(handleLogChecklist(s, VERSION,
      { block: block(1, 0, 1), title: 'Release 12', seriesKey: 'release-12' }));
    expect(out).toMatch(/^\[\d{1,2}:\d{2} [ap]m [^\]]+\] recorded #1 [0-9a-f-]{36}\n/);
    expect(out).toContain("series 'release-12': 50");
    const row = s.db.prepare(
      'SELECT channel, title, series_key, succ, active, fail, percent, session FROM entries').get();
    expect(row.channel).toBe('checklist');
    expect(row.title).toBe('Release 12');
    expect(row.series_key).toBe('release-12');
    expect(row.succ).toBe(1);
    expect(row.active).toBe(0);
    expect(row.fail).toBe(1);
    expect(row.percent).toBe(50);
    expect(row.session).toBe('no-hook');
  }));

  test('seriesKey, not the title, is the stored series identity', () => withStore(s => {
    handleLogChecklist(s, VERSION, { block: block(1, 1, 0), title: 'Project Atlas — phase 2', seriesKey: 'atlas' });
    const row = s.db.prepare('SELECT title, series_key FROM entries').get();
    expect(row.title).toBe('Project Atlas — phase 2');
    expect(row.series_key).toBe('atlas');
    expect(seriesPercents(s, 'atlas')).toEqual([50]);
  }));

  test('a blank seriesKey is rejected by entry validation, and nothing is written', () => withStore(s => {
    expect(() => handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'T', seriesKey: '  ' }))
      .toThrow(/seriesKey must not be blank/);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n).toBe(0);
  }));

  test('re-renders accumulate into one series, and the reply carries the whole history', () => withStore(s => {
    handleLogChecklist(s, VERSION, { block: block(0, 4, 0), title: 'T', seriesKey: 'k' });   //   0%
    handleLogChecklist(s, VERSION, { block: block(1, 3, 0), title: 'T', seriesKey: 'k' });   //  25%
    handleLogChecklist(s, VERSION, { block: block(2, 2, 0), title: 'T', seriesKey: 'k' });   //  50%
    const out = text(handleLogChecklist(s, VERSION, { block: block(4, 0, 0), title: 'T', seriesKey: 'k' }));
    expect(out).toContain("series 'k': 0 25 50 100");
    expect(seriesPercents(s, 'k')).toEqual([0, 25, 50, 100]);
  }));

  test('a block with no summary line is rejected, and nothing is written', () => withStore(s => {
    const out = text(handleLogChecklist(s, VERSION,
      { block: '- ✅ done\n- ❌ broke', title: 'T', seriesKey: 'k' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('summary');
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n).toBe(0);
  }));

  test('adopts the session and turn context the hook observed', () => withStore(s => {
    recordContext(s, { session: 'observed-session', promptId: 'p9', effort: 'high' });
    handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'T', seriesKey: 'k' });
    const row = s.db.prepare('SELECT session, prompt_id, effort FROM entries').get();
    expect(row.session).toBe('observed-session');
    expect(row.prompt_id).toBe('p9');
    expect(row.effort).toBe('high');
  }));

  test('a caller-supplied session beats the observed one', () => withStore(s => {
    recordContext(s, { session: 'observed-session' });
    handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'T', seriesKey: 'k', session: 'claimed' });
    expect(s.db.prepare('SELECT session FROM entries').get().session).toBe('claimed');
  }));

  test('project is dropped when privacy.store_cwd is false', () => withStore(s => {
    writeConfig(s, 'privacy.store_cwd', 'false');
    handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'T', seriesKey: 'k', project: 'secret-project' });
    expect(s.db.prepare('SELECT project FROM entries').get().project).toBeNull();
  }));

  test('the host identity from the handshake is stamped when supplied', () => withStore(s => {
    handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'T', seriesKey: 'k' },
                       { name: 'claude-code', version: '2.0.0' });
    const row = s.db.prepare('SELECT host, host_version FROM entries').get();
    expect(row.host).toBe('claude-code');
    expect(row.host_version).toBe('2.0.0');
  }));

});

describe('handleLogChecklist — the checklist channel enforces the same gates express does', () => {

  test('a disabled checklist channel refuses to record, and nothing is written', () => withStore(s => {
    writeConfig(s, 'channels.enabled', 'signature,need');
    const out = text(handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'T', seriesKey: 'k' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'checklist'");
    expect(out).toContain('disabled');
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n).toBe(0);
  }));

  test('a lowered channels.checklist.max_chars refuses a normal block, and nothing is written', () => withStore(s => {
    writeConfig(s, 'channels.checklist.max_chars', '1');
    const out = text(handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'T', seriesKey: 'k' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('channels.checklist.max_chars');
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n).toBe(0);
  }));

  test('default config still logs — the new gates do not regress the common path', () => withStore(s => {
    const out = text(handleLogChecklist(s, VERSION, { block: block(2, 1, 1), title: 'T', seriesKey: 'k' }));
    expect(out).not.toMatch(/^error: /);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n).toBe(1);
  }));

});

describe('handleRecallChecklists', () => {

  test('returns recent checklist rows oldest first, with the checklist columns', () => withStore(s => {
    handleLogChecklist(s, VERSION, { block: block(1, 1, 0), title: 'first', seriesKey: 'first' });
    handleLogChecklist(s, VERSION, { block: block(2, 0, 0), title: 'second', seriesKey: 'second' });
    const parsed = JSON.parse(text(handleRecallChecklists(s, {}))) as {
      recent: { title: string; percent: number; series_key: string }[];
    };
    expect(parsed.recent.map(r => r.title)).toEqual(['first', 'second']);
    expect(parsed.recent.map(r => r.percent)).toEqual([50, 100]);
    expect(parsed.recent.map(r => r.series_key)).toEqual(['first', 'second']);
  }));

  test('limit narrows the window to the most recent rows', () => withStore(s => {
    for (const title of ['a', 'b', 'c']) {
      handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title, seriesKey: title });
    }
    const parsed = JSON.parse(text(handleRecallChecklists(s, { limit: 2 }))) as {
      recent: { title: string }[];
    };
    expect(parsed.recent.map(r => r.title)).toEqual(['b', 'c']);
  }));

  test('a named seriesKey also returns that series, exactly as stored', () => withStore(s => {
    handleLogChecklist(s, VERSION, { block: block(1, 3, 0), title: 'T', seriesKey: 'k' });
    handleLogChecklist(s, VERSION, { block: block(3, 1, 0), title: 'T', seriesKey: 'k' });
    const parsed = JSON.parse(text(handleRecallChecklists(s, { seriesKey: 'k' }))) as {
      series: number[];
    };
    expect(parsed.series).toEqual([25, 75]);
  }));

  test('a never-used seriesKey returns an empty series, not an error', () => withStore(s => {
    const parsed = JSON.parse(text(handleRecallChecklists(s, { seriesKey: 'nonesuch' }))) as {
      recent: unknown[]; series: number[];
    };
    expect(parsed.recent).toEqual([]);
    expect(parsed.series).toEqual([]);
  }));

  test('non-checklist entries never leak into the recall', () => withStore(s => {
    recordContext(s, { session: 's1' });
    handleLogChecklist(s, VERSION, { block: block(1, 0, 0), title: 'only-this', seriesKey: 'only-this' });
    s.db.prepare(`INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version)
                  VALUES ('u1', 't', 't', 'z', 's1', 'idea', 'not a checklist', ?)`).run(VERSION);
    const parsed = JSON.parse(text(handleRecallChecklists(s, {}))) as { recent: { title: string }[] };
    expect(parsed.recent.map(r => r.title)).toEqual(['only-this']);
  }));

});

describe('handleCheckChecklist', () => {

  test('a renderer-produced block gets a clean bill', () => {
    const out = text(handleCheckChecklist({ block: block(2, 1, 1) }));
    expect(out).toContain('ok: 4 items parsed');
    expect(out).toContain('ok: all checks passed');
  });

  test('a corrupted block reports each failure as a normal reply, not an error', () => {
    const corrupted = block(2, 1, 1).replace('(50%)', '(95%)');
    const out = text(handleCheckChecklist({ block: corrupted }));
    expect(out).toContain('FAIL: percent 95% stated, 50% computed');
    expect(out).toMatch(/\d+ check\(s\) FAILED/);
  });

});

describe('registerChecklistTools', () => {

  test('registers all three tools on a fresh server without throwing', () => withStore(s => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => { registerChecklistTools(server, s, VERSION); }).not.toThrow();
  }));

});
