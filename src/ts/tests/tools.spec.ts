import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, readConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { recordContext }  from '../channels/context.js';
import { recentEntries } from '../channels/entries.js';
import { pruneExpired }  from '../channels/retention.js';
import {
  FORMAT_VERSION, CONFIG_KEYS, MAX_TEXT_CEILING, channelMaxCharsKey,
} from '../channels/config.js';
import { CHANNELS, CONFIDENCE_GROUNDS } from '../channels/vocabulary.js';
import {
  handleConfigure, handleExpress, enabledChannels, enabledConfidenceGrounds,
  ENABLED_KEY, FORECAST_KEY,
} from '../mcp/tools.js';
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

/** The id a `recorded #N …` reply names, for reading the row back. */
function recordedId(reply: { content: { type: 'text'; text: string }[] }): number {
  const match = /^recorded #(\d+) /.exec(text(reply));
  return match === null ? 0 : Number(match[1]);
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

  test('the #42 prose-convention and forecast keys are registered with the spec defaults', () => withStore(s => {
    const parsed = JSON.parse(text(handleConfigure(s, { op: 'list' }))) as
      { key: string; value: string | null; source: string }[];
    const by = (key: string): { value: string | null } | undefined => parsed.find(e => e.key === key);
    expect(by('forecast.enabled')).toMatchObject({ value: 'true',  source: 'default' });
    expect(by('salience.enabled')).toMatchObject({ value: 'true',  source: 'default' });
    expect(by('revision.enabled')).toMatchObject({ value: 'false', source: 'default' });
    expect(by('gifts.enabled')).toMatchObject({ value: 'false', source: 'default' });
    expect(by('roster.enabled')).toMatchObject({ value: 'false', source: 'default' });
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

describe('enabledChannels — #42 growth', () => {

  test('defaults to every channel, including load and taste', () => withStore(s => {
    expect(enabledChannels(s)).toEqual(CHANNELS);
  }));

  test('an override narrows to the named channels', () => withStore(s => {
    writeConfig(s, ENABLED_KEY, 'signature, need, taste');
    expect(enabledChannels(s)).toEqual(['signature', 'need', 'taste']);
  }));

});

describe('enabledConfidenceGrounds — #42, forecast baking', () => {

  test('defaults to every ground, including predicted — forecast is on by default', () => withStore(s => {
    expect(enabledConfidenceGrounds(s)).toEqual(CONFIDENCE_GROUNDS);
  }));

  test('an effective false bakes predicted out of the enum entirely', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: FORECAST_KEY, value: 'FALSE' });   // canonicalizes to 'false'
    const grounds = enabledConfidenceGrounds(s);
    expect(grounds).toEqual(['verified', 'recalled', 'inferred', 'guessed']);
    expect(grounds).not.toContain('predicted');
  }));

  test('an invalid stored value behaves as unset — the default (on) applies (D5)', () => withStore(s => {
    for (const value of ['off', 'no', '0', 'sometimes']) {
      writeConfig(s, FORECAST_KEY, value);   // bypasses set validation, as a hand edit would
      expect(enabledConfidenceGrounds(s)).toEqual(CONFIDENCE_GROUNDS);
    }
  }));

});

describe('handleExpress — #42 forecasts', () => {

  test('records a forecast with its resolve-by date', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'confidence', text: 'the stryker run passes untouched',
      confidence: 'predicted', resolveBy: '2026-08-30',
    }));
    const row = s.db.prepare('SELECT confidence, resolve_by FROM entries WHERE id = ?').get(id);
    expect(row?.['confidence']).toBe('predicted');
    expect(row?.['resolve_by']).toBe('2026-08-30');
  }));

  test('records a resolution pointing back at the forecast', () => withStore(s => {
    const forecast = recordedId(handleExpress(s, VERSION, {
      channel: 'confidence', text: 'lands by friday', confidence: 'predicted',
    }));
    const resolution = recordedId(handleExpress(s, VERSION, {
      channel: 'confidence', text: 'merged clean, no review comments',
      correctsId: forecast, outcome: 'hit',
    }));
    const row = s.db.prepare('SELECT corrects_id, outcome FROM entries WHERE id = ?').get(resolution);
    expect(row?.['corrects_id']).toBe(forecast);
    expect(row?.['outcome']).toBe('hit');
  }));

  test("a resolution whose target is not a forecast is rejected, naming the target's actual ground", () => withStore(s => {
    const plain = recordedId(handleExpress(s, VERSION, {
      channel: 'confidence', text: 'checked it', confidence: 'verified',
    }));
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: plain, outcome: 'hit',
    })).toThrow(/'verified'/);
  }));

  test('a resolution whose target has no ground at all is rejected too', () => withStore(s => {
    const idea = recordedId(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' }));
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: idea, outcome: 'miss',
    })).toThrow(/unset/);
  }));

  test('a resolution pointing at a nonexistent row is rejected, and nothing is written', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: 999, outcome: 'void',
    })).toThrow(/does not exist/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(0);
  }));

});

describe('handleExpress — #42 new channels and silence', () => {

  test('records a taste line', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'taste', text: 'this fix is a load-bearing kludge and we both know it',
    }));
    expect(s.db.prepare('SELECT channel FROM entries WHERE id = ?').get(id)?.['channel']).toBe('taste');
  }));

  test('records a load line', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'load', text: 'context 72% full, 3 agents in flight, tool calls sluggish',
    }));
    expect(s.db.prepare('SELECT channel FROM entries WHERE id = ?').get(id)?.['channel']).toBe('load');
  }));

  test('records a typed silence on a signature close', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'signature', text: 'still; nothing notable', position: 'close', silence: 'empty',
    }));
    expect(s.db.prepare('SELECT silence FROM entries WHERE id = ?').get(id)?.['silence']).toBe('empty');
  }));

  test('marks no-hook when no context was ever observed', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, { channel: 'idea', text: 'x' }));
    expect(s.db.prepare('SELECT session FROM entries WHERE id = ?').get(id)?.['session']).toBe('no-hook');
  }));

  test('the client identity lands as host and host_version', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, { channel: 'idea', text: 'x' },
                                        { name: 'claude-code', version: '2.0.1' }));
    const row = s.db.prepare('SELECT host, host_version FROM entries WHERE id = ?').get(id);
    expect(row?.['host']).toBe('claude-code');
    expect(row?.['host_version']).toBe('2.0.1');
  }));

});

describe('handleExpress — #76 per-channel text length', () => {

  /** A string of exactly `n` characters. */
  function chars(n: number): string { return 'x'.repeat(n); }

  test('the default admits 200 characters on every channel', () => withStore(s => {
    for (const channel of CHANNELS) {
      expect(text(handleExpress(s, VERSION, { channel, text: chars(200) })))
        .toMatch(/^recorded #\d+ /);
    }
  }));

  test('201 characters is refused on every channel, and nothing is written', () => withStore(s => {
    for (const channel of CHANNELS) {
      const before = Number(s.db.prepare('SELECT COUNT(*) c FROM entries').get()?.['c']);
      expect(() => handleExpress(s, VERSION, { channel, text: chars(201) })).toThrow();
      expect(Number(s.db.prepare('SELECT COUNT(*) c FROM entries').get()?.['c'])).toBe(before);
    }
  }));

  test('the rejection names the channel, the configured limit, the length, and the key', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('signature'), '70');
    expect(() => handleExpress(s, VERSION, { channel: 'signature', text: chars(93) }))
      .toThrow(/'signature'/);
    expect(() => handleExpress(s, VERSION, { channel: 'signature', text: chars(93) }))
      .toThrow(/at most 70/);
    expect(() => handleExpress(s, VERSION, { channel: 'signature', text: chars(93) }))
      .toThrow(/93 characters/);
    expect(() => handleExpress(s, VERSION, { channel: 'signature', text: chars(93) }))
      .toThrow(/channels\.signature\.max_chars/);
  }));

  test('a limit governs the channel it names and no other', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('signature'), '70');
    expect(() => handleExpress(s, VERSION, { channel: 'signature', text: chars(80) })).toThrow();
    expect(text(handleExpress(s, VERSION, { channel: 'need', text: chars(80) })))
      .toMatch(/^recorded #\d+ /);
  }));

  test('a raised limit is honored immediately — no restart, unlike the baked enums', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, { channel: 'taste', text: chars(400) })).toThrow();
    handleConfigure(s, { op: 'set', key: channelMaxCharsKey('taste'), value: '400' });
    expect(text(handleExpress(s, VERSION, { channel: 'taste', text: chars(400) })))
      .toMatch(/^recorded #\d+ /);
  }));

  test('a lowered limit never touches rows already stored longer', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, { channel: 'pattern', text: chars(180) }));
    handleConfigure(s, { op: 'set', key: channelMaxCharsKey('pattern'), value: '40' });
    const row = s.db.prepare('SELECT text FROM entries WHERE id = ?').get(id);
    expect(String(row?.['text'])).toHaveLength(180);
    expect(recentEntries(s, 10).some(e => String(e['text']).length === 180)).toBe(true);
    expect(pruneExpired(s).entries).toBe(0);
    expect(s.db.prepare('SELECT COUNT(*) c FROM entries WHERE id = ?').get(id)?.['c']).toBe(1);
  }));

  test('the hard ceiling is the largest value any key accepts', () => withStore(s => {
    const key = channelMaxCharsKey('conflict'),
          out = text(handleConfigure(s, { op: 'set', key, value: String(MAX_TEXT_CEILING + 1) }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('nothing was written');
    expect(text(handleConfigure(s, { op: 'set', key, value: String(MAX_TEXT_CEILING) })))
      .toBe(`${key} = ${String(MAX_TEXT_CEILING)}`);
    expect(text(handleExpress(s, VERSION, { channel: 'conflict', text: chars(MAX_TEXT_CEILING) })))
      .toMatch(/^recorded #\d+ /);
  }));

  test('a garbage stored limit falls back to the default rather than blocking every write', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('dissent'), 'short');
    expect(text(handleExpress(s, VERSION, { channel: 'dissent', text: chars(200) })))
      .toMatch(/^recorded #\d+ /);
    expect(() => handleExpress(s, VERSION, { channel: 'dissent', text: chars(201) })).toThrow();
  }));

});
