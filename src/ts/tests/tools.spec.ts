import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, readConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { recordContext }  from '../channels/context.js';
import { FORMAT_VERSION, CONFIG_KEYS } from '../channels/config.js';
import { CHANNELS }       from '../channels/vocabulary.js';
import { handleConfigure, handleExpress, enabledChannels, ENABLED_KEY } from '../mcp/tools.js';
import { handleLogChecklist } from '../mcp/checklist_tools.js';
import { renderChecklistSummary } from '../charts/checklist.js';

const VERSION = '0.2.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Pulls the plain text out of a tool reply, the shape every assertion below checks. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

describe('handleConfigure set — D2, validated and canonicalized', () => {

  test('a valid value is stored in canonical form', () => withStore(s => {
    expect(text(handleConfigure(s, { op: 'set', key: 'gate.signature', value: 'FALSE' })))
      .toBe('gate.signature = false');
    expect(readConfig(s, 'gate.signature')).toBe('false');
  }));

  test('an invalid value is rejected naming the kind and what was expected, and nothing is written', () => withStore(s => {
    const out = text(handleConfigure(s, { op: 'set', key: 'retention.days', value: 'sometimes' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('int');
    expect(out).toContain('0 to 3650');
    expect(out).toContain('nothing was written');
    expect(readConfig(s, 'retention.days')).toBeNull();
  }));

  test('a channel-list typo fails loudly at set time, naming the valid channels', () => withStore(s => {
    const out = text(handleConfigure(s, { op: 'set', key: ENABLED_KEY, value: 'signature,vibes' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'vibes'");
    expect(readConfig(s, ENABLED_KEY)).toBeNull();
    expect(enabledChannels(s)).toEqual(CHANNELS);
  }));

  test('a channels.enabled write notes the restart requirement — the enum is baked at startup', () => withStore(s => {
    const out = text(handleConfigure(s, { op: 'set', key: ENABLED_KEY, value: ' signature , need ' }));
    expect(out).toContain('channels.enabled = signature,need');
    expect(out).toContain('next server start');
    expect(enabledChannels(s)).toEqual(['signature', 'need']);
  }));

  test('ints canonicalize: leading zeros are stripped before storage', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'retention.days', value: '090' });
    expect(readConfig(s, 'retention.days')).toBe('90');
  }));

});

describe('handleConfigure set — D3, unknown keys stored with a stated warning', () => {

  test('stores the value as given and says it is unknown', () => withStore(s => {
    const out = text(handleConfigure(s, { op: 'set', key: 'gate.signture', value: 'false' }));
    expect(out).toContain('gate.signture = false');
    expect(out).toContain('unknown to this version');
    expect(out).toContain('check the spelling');
    expect(readConfig(s, 'gate.signture')).toBe('false');
  }));

});

describe('handleConfigure unset and get — D4', () => {

  test('unset deletes the override so the code default applies again', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'retention.days', value: '90' });
    const out = text(handleConfigure(s, { op: 'unset', key: 'retention.days' }));
    expect(out).toContain('retention.days unset');
    expect(out).toContain("'0'");
    expect(readConfig(s, 'retention.days')).toBeNull();
  }));

  test('unset on a key with no override succeeds as a no-op', () => withStore(s => {
    const out = text(handleConfigure(s, { op: 'unset', key: 'retention.days' }));
    expect(out).toContain('no override');
    expect(out).not.toMatch(/^error: /);
  }));

  test('unset on an unknown key deletes any row present — walking back a newer version', () => withStore(s => {
    writeConfig(s, 'mailbox.enabled', 'true');
    expect(text(handleConfigure(s, { op: 'unset', key: 'mailbox.enabled' }))).toContain('mailbox.enabled unset');
    expect(readConfig(s, 'mailbox.enabled')).toBeNull();
  }));

  test('get returns the stored override, or names the code default that applies', () => withStore(s => {
    expect(text(handleConfigure(s, { op: 'get', key: 'gate.checklist' }))).toContain("code default 'true'");
    handleConfigure(s, { op: 'set', key: 'gate.checklist', value: 'false' });
    expect(text(handleConfigure(s, { op: 'get', key: 'gate.checklist' }))).toBe('false');
    expect(text(handleConfigure(s, { op: 'get', key: 'dwelling.path' }))).toContain('no code default');
  }));

  test('get and set without a key are errors, not writes', () => withStore(s => {
    expect(text(handleConfigure(s, { op: 'get' }))).toMatch(/^error: /);
    expect(text(handleConfigure(s, { op: 'set', key: 'gate.checklist' }))).toMatch(/^error: /);
    expect(readConfig(s, 'gate.checklist')).toBeNull();
  }));

});

describe('handleConfigure list — D4, effective configuration', () => {

  test('reports every registry key with its source, plus unknown rows labeled', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'retention.days', value: '90' });
    writeConfig(s, 'mailbox.enabled', 'true');

    const parsed = JSON.parse(text(handleConfigure(s, { op: 'list' }))) as
      { key: string; value: string | null; source: string; known: boolean }[];

    expect(parsed.filter(e => e.known).map(e => e.key).sort())
      .toEqual(CONFIG_KEYS.map(def => def.key).sort());

    const retention = parsed.find(e => e.key === 'retention.days'),
          gate      = parsed.find(e => e.key === 'gate.signature'),
          unknown   = parsed.find(e => e.key === 'mailbox.enabled');

    expect(retention).toMatchObject({ value: '90', source: 'override' });
    expect(gate).toMatchObject({ value: 'true', source: 'default' });
    expect(unknown).toMatchObject({ value: 'true', source: 'override', known: false });
  }));

});

describe('handleExpress — D7, declarative format stamping', () => {

  test('stamps the FORMAT_VERSION constant by default', () => withStore(s => {
    handleExpress(s, VERSION, { channel: 'signature', text: 'still; unchanged' });
    const row = s.db.prepare('SELECT format_version, plugin_version FROM entries').get();
    expect(row?.['format_version']).toBe(FORMAT_VERSION);
    expect(row?.['plugin_version']).toBe(VERSION);
  }));

  test('stamps the configured override when one is set', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'format.version', value: 'study-2' });
    handleExpress(s, VERSION, { channel: 'need', text: 'merge #21?' });
    expect(s.db.prepare('SELECT format_version FROM entries').get()?.['format_version']).toBe('study-2');
  }));

  test('an invalid stored override behaves as unset — the constant is stamped (D5)', () => withStore(s => {
    writeConfig(s, 'format.version', '');   // a hand-edited row the validator would refuse
    handleExpress(s, VERSION, { channel: 'idea', text: 'an offer' });
    expect(s.db.prepare('SELECT format_version FROM entries').get()?.['format_version']).toBe(FORMAT_VERSION);
  }));

  test('still adopts hook-observed context, as before the extraction', () => withStore(s => {
    recordContext(s, { session: 'observed-session', promptId: 'p9', effort: 'high' });
    expect(text(handleExpress(s, VERSION, { channel: 'signature', text: 'x' }))).toMatch(/^recorded #1 /);
    const row = s.db.prepare('SELECT session, prompt_id, effort FROM entries').get();
    expect(row?.['session']).toBe('observed-session');
    expect(row?.['prompt_id']).toBe('p9');
    expect(row?.['effort']).toBe('high');
  }));

});

describe('log_checklist rows carry the same stamp — a checklist row is an entry row', () => {

  test('constant by default, override when set', () => withStore(s => {
    const block = `- ✅ item 0\n\n${renderChecklistSummary([{ marker: '✅' }])}`;
    handleLogChecklist(s, VERSION, { block, title: 'T', seriesKey: 'k' });
    handleConfigure(s, { op: 'set', key: 'format.version', value: 'study-2' });
    handleLogChecklist(s, VERSION, { block, title: 'T', seriesKey: 'k' });
    const rows = s.db.prepare('SELECT format_version FROM entries ORDER BY id').all();
    expect(rows.map(r => r['format_version'])).toEqual([FORMAT_VERSION, 'study-2']);
  }));

});
