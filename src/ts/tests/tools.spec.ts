import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, readConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  recordContext, latestContext, NO_HOOK_SESSION, UNKNOWN_CONTEXT, UNKNOWN_PREVIOUS,
} from '../channels/context.js';
import { recentEntries, register } from '../channels/entries.js';
import { pruneExpired }  from '../channels/retention.js';
import {
  FORMAT_VERSION, CONFIG_KEYS, MAX_TEXT_CEILING, channelMaxCharsKey,
} from '../channels/config.js';
import { CHANNELS, CONFIDENCE_GROUNDS } from '../channels/vocabulary.js';
import { writeQuestions } from '../channels/desk_questions.js';
import {
  handleConfigure, handleExpress, handleAnnotate, handleBeginTurn,
  enabledChannels, enabledConfidenceGrounds,
  registerTools, ENABLED_KEY, FORECAST_KEY, ANNOTATE_MAX_NOTES,
} from '../mcp/tools.js';
import { buildServer } from '../mcp/server.js';
import { handleLogChecklist } from '../mcp/checklist_tools.js';
import { renderChecklistSummary } from '../charts/checklist.js';
import { renderAnnotations } from '../charts/annotations.js';
import { anchorHash } from '../channels/anchors.js';

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
    // A synthetic key no release registers: naming a real-but-not-yet-shipped key here
    // makes the test fail the day that key ships, which is drift rather than coverage.
    writeConfig(s, 'from.a.newer.version', 'true');

    const parsed = JSON.parse(text(handleConfigure(s, { op: 'list' }))) as
      { key: string; value: string | null; source: string; known: boolean }[];

    expect(parsed.filter(e => e.known).map(e => e.key).sort())
      .toEqual(CONFIG_KEYS.map(def => def.key).sort());

    const retention = parsed.find(e => e.key === 'retention.days'),
          gate      = parsed.find(e => e.key === 'gate.signature'),
          unknown   = parsed.find(e => e.key === 'from.a.newer.version');

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
      correctsId: forecast, correctsKind: 'resolves', outcome: 'hit',
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
      channel: 'confidence', text: 'resolved?', correctsId: plain, correctsKind: 'resolves', outcome: 'hit',
    })).toThrow(/'verified'/);
  }));

  test('a resolution whose target has no ground at all is rejected too', () => withStore(s => {
    const idea = recordedId(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' }));
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: idea, correctsKind: 'resolves', outcome: 'miss',
    })).toThrow(/unset/);
  }));

  test('a resolution pointing at a nonexistent row is rejected, and nothing is written', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: 999, correctsKind: 'resolves', outcome: 'void',
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

describe('handleExpress — #18 anchors', () => {

  test('records an anchored dissent on a file, hash derived server-side', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'dissent', text: 'null for unset and for empty',
      anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts',
      anchorSpan: 'L141', anchorQuote: 'readConfig(store, key)',
    }));
    const row = s.db.prepare(
      'SELECT channel, anchor_kind, anchor_span, anchor_hash FROM entries WHERE id = ?').get(id);
    expect(row?.['channel']).toBe('dissent');
    expect(row?.['anchor_kind']).toBe('file');
    expect(row?.['anchor_span']).toBe('L141');
    expect(row?.['anchor_hash']).toBe(anchorHash('readConfig(store, key)'));
  }));

  test('a prompt anchor with no target adopts the turn being answered', () => withStore(s => {
    recordContext(s, { session: 'sess', promptId: 'p-42' });
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'dissent', text: '"ready" reads three ways',
      anchorKind: 'prompt', anchorQuote: 'ship it when ready',
    }));
    expect(s.db.prepare('SELECT anchor_target FROM entries WHERE id = ?').get(id)?.['anchor_target'])
      .toBe('p-42');
  }));

  test('an explicitly named prompt target beats the observed one — retrospective annotation works', () => withStore(s => {
    recordContext(s, { session: 'sess', promptId: 'p-42' });
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'dissent', text: 'about the earlier one', anchorKind: 'prompt',
      anchorTarget: 'p-7', anchorQuote: 'the old config format',
    }));
    expect(s.db.prepare('SELECT anchor_target FROM entries WHERE id = ?').get(id)?.['anchor_target'])
      .toBe('p-7');
  }));

  test('a prompt anchor with no target and no hook observation is rejected, not invented', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, {
      channel: 'dissent', text: 'x', anchorKind: 'prompt', anchorQuote: 'q',
    })).toThrow(/requires an anchorTarget/);
  }));

  test('an entry anchor to a nonexistent id is rejected, naming the highest that exists', () => withStore(s => {
    handleExpress(s, VERSION, { channel: 'idea', text: 'the first row' });
    expect(() => handleExpress(s, VERSION, {
      channel: 'dissent', text: 'about #9999', anchorKind: 'entry', anchorTarget: '9999',
    })).toThrow(/highest id so far is 1/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(1);
  }));

  test('an entry anchor on an empty log says so rather than naming a phantom id', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, {
      channel: 'dissent', text: 'x', anchorKind: 'entry', anchorTarget: '1',
    })).toThrow(/no entries have been recorded yet/);
  }));

  test('a checklist anchor to an unknown series is rejected, naming the known keys', () => withStore(s => {
    handleExpress(s, VERSION, { channel: 'checklist', text: 'snapshot', seriesKey: 'atlas', percent: 40 });
    expect(() => handleExpress(s, VERSION, {
      channel: 'dissent', text: 'x', anchorKind: 'checklist', anchorTarget: 'nonesuch',
    })).toThrow(/'atlas'/);
    expect(() => handleExpress(s, VERSION, {
      channel: 'dissent', text: 'x', anchorKind: 'checklist', anchorTarget: 'atlas',
    })).not.toThrow();
  }));

  test('file and reply targets are deliberately unchecked — the server cannot verify either', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, {
      channel: 'dissent', text: 'x', anchorKind: 'file', anchorTarget: 'not/on/this/disk.ts',
      anchorSpan: 'L1',
    })).not.toThrow();
    expect(() => handleExpress(s, VERSION, {
      channel: 'dissent', text: 'y', anchorKind: 'reply', anchorTarget: 'p-unknown', anchorQuote: 'q',
    })).not.toThrow();
  }));

  test('privacy.store_quotes reaches the tool path, dropping the words and keeping the hash', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'privacy.store_quotes', value: 'false' });
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'dissent', text: 'ambiguous', anchorKind: 'prompt', anchorTarget: 'p-1',
      anchorQuote: 'ship it when ready',
    }));
    const row = s.db.prepare('SELECT anchor_quote, anchor_hash FROM entries WHERE id = ?').get(id);
    expect(row?.['anchor_quote']).toBeNull();
    expect(row?.['anchor_hash']).toBe(anchorHash('ship it when ready'));
  }));

});

describe('handleAnnotate — #18 the batch', () => {

  /** Two notes on one file plus one on a message: the shape the issue is about. */
  const REVIEW = [
    { channel: 'dissent' as const, text: 'null for unset and for empty', face: '\u{1F615}',
      anchorKind: 'file' as const, anchorTarget: 'src/ts/channels/store.ts',
      anchorSpan: 'L141', anchorQuote: 'readConfig(store, key)' },
    { channel: 'dissent' as const, text: 'local timestamp never updated', face: '\u{1F928}',
      anchorKind: 'file' as const, anchorTarget: 'src/ts/channels/store.ts',
      anchorSpan: 'L162', anchorQuote: 'writeConfig' },
    { channel: 'confidence' as const, text: 'assuming tests-green', face: '\u{1F914}',
      anchorKind: 'prompt' as const, anchorTarget: 'p-7', anchorQuote: 'ship it when ready' },
  ];

  test('records one row per note, each on its own channel', () => withStore(s => {
    const out = text(handleAnnotate(s, VERSION, { notes: REVIEW }));
    expect(out).toContain('recorded #1, #2, #3');
    const rows = s.db.prepare('SELECT channel, anchor_kind, anchor_span FROM entries ORDER BY id').all();
    expect(rows.map(r => r['channel'])).toEqual(['dissent', 'dissent', 'confidence']);
    expect(rows.map(r => r['anchor_kind'])).toEqual(['file', 'file', 'prompt']);
  }));

  test('the reply carries the canonical block, byte-identical to the renderer', () => withStore(s => {
    const out = text(handleAnnotate(s, VERSION, { notes: REVIEW })),
          [, block] = out.split('\n\n', 2);
    expect(out).toContain(renderAnnotations(REVIEW.map(n => ({
      text: n.text, face: n.face, anchorKind: n.anchorKind,
      anchorTarget: n.anchorTarget, anchorSpan: n.anchorSpan, anchorQuote: n.anchorQuote,
    }))));
    expect(block).toContain('\u{2693} src/ts/channels/store.ts');
  }));

  test('all-or-nothing: one bad note rejects the batch, naming its index, and writes nothing', () => withStore(s => {
    expect(() => handleAnnotate(s, VERSION, { notes: [
      REVIEW[0] as (typeof REVIEW)[number],
      { channel: 'dissent', text: 'no quote on a message anchor',
        anchorKind: 'prompt', anchorTarget: 'p-7' },
    ] })).toThrow(/note 1/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(0);
  }));

  test('every bad note is reported at once, not one round trip each', () => withStore(s => {
    let message = '';
    try {
      handleAnnotate(s, VERSION, { notes: [
        { channel: 'dissent', text: 'a', anchorKind: 'prompt', anchorTarget: 'p' },
        { channel: 'dissent', text: 'b', anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: '#2' },
      ] });
    } catch (error) { message = String(error); }
    expect(message).toContain('note 0');
    expect(message).toContain('note 1');
    expect(message).toContain('nothing was written');
  }));

  test('an empty batch and an over-long batch are both refused', () => withStore(s => {
    expect(() => handleAnnotate(s, VERSION, { notes: [] })).toThrow(/must not be empty/);
    const many = Array.from({ length: ANNOTATE_MAX_NOTES + 1 }, (_, i) => ({
      channel: 'dissent' as const, text: `note ${String(i)}`,
      anchorKind: 'file' as const, anchorTarget: 'a.ts', anchorSpan: `L${String(i + 1)}`,
    }));
    expect(() => handleAnnotate(s, VERSION, { notes: many })).toThrow(/exceeds the limit/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(0);
  }));

  test('a note with no anchorKind is refused — that is what express is for', () => withStore(s => {
    expect(() => handleAnnotate(s, VERSION, {
      notes: [{ channel: 'dissent', text: 'floating' } as never],
    })).toThrow(/requires an anchorKind/);
  }));

  test('hook context is adopted per note, exactly as express does', () => withStore(s => {
    recordContext(s, { session: 'observed', promptId: 'p-42', effort: 'high' });
    handleAnnotate(s, VERSION, { notes: [
      { channel: 'dissent', text: 'a', anchorKind: 'prompt', anchorQuote: 'ship it' },
    ] });
    const row = s.db.prepare('SELECT session, prompt_id, effort, anchor_target FROM entries').get();
    expect(row?.['session']).toBe('observed');
    expect(row?.['prompt_id']).toBe('p-42');
    expect(row?.['effort']).toBe('high');
    expect(row?.['anchor_target']).toBe('p-42');
  }));

  test('the privacy gate applies per note: the prompt quote goes, the file quote stays', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'privacy.store_quotes', value: 'false' });
    handleAnnotate(s, VERSION, { notes: [
      { channel: 'dissent', text: 'a', anchorKind: 'prompt', anchorTarget: 'p-1', anchorQuote: 'their words' },
      { channel: 'dissent', text: 'b', anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1',
        anchorQuote: 'const a = 1;' },
    ] });
    const rows = s.db.prepare('SELECT anchor_quote, anchor_hash FROM entries ORDER BY id').all();
    expect(rows[0]?.['anchor_quote']).toBeNull();
    expect(rows[0]?.['anchor_hash']).toBe(anchorHash('their words'));
    expect(rows[1]?.['anchor_quote']).toBe('const a = 1;');
  }));

  test('the returned block still shows a suppressed quote — it appeared in the transcript once', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'privacy.store_quotes', value: 'false' });
    const out = text(handleAnnotate(s, VERSION, { notes: [
      { channel: 'dissent', text: 'a', anchorKind: 'prompt', anchorTarget: 'p-1', anchorQuote: 'their words' },
    ] }));
    expect(out).toContain('`their words`');
    expect(s.db.prepare('SELECT anchor_quote FROM entries').get()?.['anchor_quote']).toBeNull();
  }));

  test('a batch reaching a bad target rolls back every note, not just the bad one', () => withStore(s => {
    expect(() => handleAnnotate(s, VERSION, { notes: [
      { channel: 'dissent', text: 'fine', anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1' },
      { channel: 'dissent', text: 'bad target', anchorKind: 'entry', anchorTarget: '77' },
    ] })).toThrow(/note 1/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(0);
  }));

  test('a one-note batch is legal — the batch is a convenience, not a minimum', () => withStore(s => {
    expect(text(handleAnnotate(s, VERSION, { notes: [REVIEW[2] as (typeof REVIEW)[number]] })))
      .toContain('recorded #1');
  }));

  test('buildServer registers annotate alongside the rest, and registering twice collides', () => withStore(s => {
    const server = buildServer(s, VERSION);
    expect(server).toBeDefined();
    // A second registration of the same names throws, which is the proof the first took.
    expect(() => registerTools(server, s, VERSION)).toThrow();
  }));

  test('a note past its channel’s configured length is refused, so the batch is no hole around #76', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'channels.dissent.max_chars', value: '40' });
    expect(() => handleAnnotate(s, VERSION, { notes: [
      { channel: 'dissent', text: 'x'.repeat(41), anchorKind: 'file',
        anchorTarget: 'a.ts', anchorSpan: 'L1' },
    ] })).toThrow(/allows at most 40/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(0);
  }));

});

describe('handleExpress — #16 retraction', () => {

  test('records a retraction with its kind and its verbatim quote', () => withStore(s => {
    const original = recordedId(handleExpress(s, VERSION, {
      channel: 'checklist', text: 'Project Atlas 31%', seriesKey: 'atlas', percent: 31,
    }));
    const strike = recordedId(handleExpress(s, VERSION, {
      channel: 'divergence', text: 'sort is rank then bucket 😬', divergenceKind: 'stale',
      correctsId: original, correctsKind: 'retracts',
      verbatim: 'icons sort by status first, then alphabetically',
    }));
    const row = s.db.prepare(
      'SELECT corrects_id, corrects_kind, verbatim FROM entries WHERE id = ?').get(strike);
    expect(row?.['corrects_id']).toBe(original);
    expect(row?.['corrects_kind']).toBe('retracts');
    expect(row?.['verbatim']).toBe('icons sort by status first, then alphabetically');
  }));

  test('the reply echoes the target and its channel, so a wrong aim shows at write time', () => withStore(s => {
    const original = recordedId(handleExpress(s, VERSION, { channel: 'checklist', text: 'Atlas 31%' }));
    const out = text(handleExpress(s, VERSION, {
      channel: 'divergence', text: 'rank then bucket', correctsId: original, correctsKind: 'retracts',
    }));
    expect(out).toContain(`retracts #${String(original)} (checklist)`);
  }));

  test('an ordinary entry gets no echo at all', () => withStore(s => {
    // The no-turn-context notice may follow the uuid; the claim here is that no
    // *correction* echo does, which is what `retracts` / `amends` / `corrects` would be.
    const out = text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' }));
    expect(out).toMatch(/^recorded #1 [0-9a-f-]{36}(?: —|$)/);
    expect(out).not.toMatch(/retracts|amends|corrects/);
  }));

  test('with a turn begun, the reply for an ordinary entry is the bare confirmation', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' });
    expect(text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' })))
      .toMatch(/^recorded #1 [0-9a-f-]{36}$/);
  }));

  test('a link with no kind is refused, and nothing is written', () => withStore(s => {
    const original = recordedId(handleExpress(s, VERSION, { channel: 'checklist', text: 'Atlas 31%' }));
    expect(() => handleExpress(s, VERSION, {
      channel: 'divergence', text: 'rank then bucket', correctsId: original,
    })).toThrow(/correctsKind/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(1);
  }));

  test('a retraction pointing at nothing is refused, naming the highest id there is', () => withStore(s => {
    handleExpress(s, VERSION, { channel: 'checklist', text: 'Atlas 31%' });
    expect(() => handleExpress(s, VERSION, {
      channel: 'divergence', text: 'x', correctsId: 999, correctsKind: 'retracts',
    })).toThrow(/highest id so far is 1/);
  }));

  test('retracts and amends may target any row — only resolves demands a forecast', () => withStore(s => {
    const idea = recordedId(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' }));
    expect(() => handleExpress(s, VERSION, {
      channel: 'divergence', text: 'that was wrong', correctsId: idea, correctsKind: 'retracts',
    })).not.toThrow();
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: idea, correctsKind: 'resolves',
    })).toThrow(/not a forecast/);
  }));

  test('a prose-only retraction needs no link at all', () => withStore(s => {
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'divergence', text: 'it runs markdownlint 😬', divergenceKind: 'stale',
      verbatim: 'the build skips lint on spec-only PRs',
    }));
    expect(register(s).map(row => row.replacement.id)).toEqual([id]);
    expect(register(s)[0]?.original).toBeNull();
  }));

  test('a quote where nothing is being taken back is refused', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, {
      channel: 'signature', text: 'still; unchanged', verbatim: 'something',
    })).toThrow(/verbatim is only valid/);
  }));

});

describe('recall — #16 marked rows and the register', () => {

  /** The tool handlers `registerTools` installs, captured without a transport. */
  function handlers(s: Store): Map<string, (args: Record<string, unknown>) => {
    content: { type: 'text'; text: string }[] } > {
    const found = new Map<string, (args: Record<string, unknown>) => {
      content: { type: 'text'; text: string }[] }>();
    const stub = {
      registerTool: (name: string, _config: unknown, handler: unknown): void => {
        found.set(name, handler as (args: Record<string, unknown>) => {
          content: { type: 'text'; text: string }[] });
      },
      server: { getClientVersion: (): undefined => undefined },
    };
    registerTools(stub as unknown as Parameters<typeof registerTools>[0], s, VERSION);
    return found;
  }

  /** Call the real `recall` handler and parse its JSON reply. */
  function recall(s: Store, args: Record<string, unknown> = {}): Record<string, unknown> {
    const handler = handlers(s).get('recall');
    if (handler === undefined) { throw new Error('recall was not registered'); }
    return JSON.parse(text(handler(args))) as Record<string, unknown>;
  }

  /** A claim and its retraction; returns both ids. */
  function takeBack(s: Store): { original: number; strike: number } {
    const original = recordedId(handleExpress(s, VERSION, {
      channel: 'checklist', text: 'Project Atlas 31%', seriesKey: 'atlas', percent: 31 }));
    const strike = recordedId(handleExpress(s, VERSION, {
      channel: 'divergence', text: 'sort is rank then bucket', correctsId: original,
      correctsKind: 'retracts', verbatim: 'icons sort by status first' }));
    return { original, strike };
  }

  test('every returned row carries its id, so a retraction can aim from the record', () => withStore(s => {
    const { original } = takeBack(s);
    const rows = recall(s)['recent'] as Record<string, unknown>[];
    expect(rows.map(row => row['id'])).toContain(original);
  }));

  test('a retracted row comes back marked, and is not omitted', () => withStore(s => {
    const { original, strike } = takeBack(s);
    const rows   = recall(s)['recent'] as Record<string, unknown>[],
          marked = rows.find(row => row['id'] === original);
    expect(rows).toHaveLength(2);
    expect(marked?.['status']).toBe('retracted');
    expect(marked?.['by']).toBe(strike);
  }));

  test('the register is absent unless asked for — no context spent on an unrequested key', () => withStore(s => {
    takeBack(s);
    expect(recall(s)['retractions']).toBeUndefined();
  }));

  test('retractions: true returns the register beside the usual blocks', () => withStore(s => {
    const { original, strike } = takeBack(s);
    const out = recall(s, { retractions: true });
    expect(out).toHaveProperty('context');
    expect(out).toHaveProperty('previous');
    expect(out).toHaveProperty('recent');
    const listed = out['retractions'] as { kind: string; original: { id: number } | null;
                                           replacement: { id: number } }[];
    expect(listed).toHaveLength(1);
    expect(listed[0]?.kind).toBe('retracts');
    expect(listed[0]?.original?.id).toBe(original);
    expect(listed[0]?.replacement.id).toBe(strike);
  }));

  test('an empty register is an empty list, not a missing key, once asked for', () => withStore(s => {
    handleExpress(s, VERSION, { channel: 'idea', text: 'what if' });
    expect(recall(s, { retractions: true })['retractions']).toEqual([]);
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

describe('handleBeginTurn — the hookless host volunteers what the hook would have observed', () => {

  test('a first call records the turn and says which path wrote it', () => withStore(s => {
    const out = text(handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1', turn: 'reply' }));
    expect(out).toContain('turn 1 recorded');
    expect(out).toContain('sess-1');
    expect(out).toContain('source: tool');
  }));

  test('the row it writes has the hook row\'s shape, only marked tool', () => withStore(s => {
    handleBeginTurn(s, {
      session: 'sess-1', promptId: 'p-1', turn: 'reply', cwd: '/repo', gitBranch: 'main',
      permissionMode: 'plan', agentId: 'a1', agentType: 'general', effort: 'high',
      compactions: 1, promptLen: 84,
    });
    const row = latestContext(s, 'sess-1');
    expect(row?.['prompt_id']).toBe('p-1');
    expect(row?.['turn_index']).toBe(1);
    expect(row?.['turn']).toBe('reply');
    expect(row?.['cwd']).toBe('/repo');
    expect(row?.['git_branch']).toBe('main');
    expect(row?.['permission_mode']).toBe('plan');
    expect(row?.['agent_id']).toBe('a1');
    expect(row?.['agent_type']).toBe('general');
    expect(row?.['effort']).toBe('high');
    expect(row?.['compactions']).toBe(1);
    expect(row?.['prompt_len']).toBe(84);
    expect(row?.['source']).toBe('tool');
  }));

  test('a second call for the same turn writes nothing and reports the standing row', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' });
    const out = text(handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' }));
    expect(out).toContain('was already recorded');
    expect(out).toContain('nothing written');
    expect(Number(s.db.prepare('SELECT COUNT(*) c FROM turn_context').get()?.['c'])).toBe(1);
  }));

  test('where the hook already fired it is harmless, and says so', () => withStore(s => {
    recordContext(s, { session: 'sess-1', promptId: 'p-1', turnIndex: 1, source: 'hook' });
    const out = text(handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' }));
    expect(out).toContain('source: hook');
    expect(out).toContain('harmless');
    expect(Number(s.db.prepare('SELECT COUNT(*) c FROM turn_context').get()?.['c'])).toBe(1);
    expect(latestContext(s, 'sess-1')?.['source']).toBe('hook');
  }));

  test('the caller cannot claim to be the hook — source is stamped, never accepted', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' } as never);
    expect(latestContext(s, 'sess-1')?.['source']).toBe('tool');
  }));

  test('express adopts what it recorded, instead of falling back to no-hook', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1', turn: 'reply', effort: 'high' });
    const id  = recordedId(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' })),
          row = s.db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    expect(row?.['session']).toBe('sess-1');
    expect(row?.['prompt_id']).toBe('p-1');
    expect(row?.['turn']).toBe('reply');
    expect(row?.['effort']).toBe('high');
  }));

  test('the turn index counts turns, and a repeated call does not advance it', () => withStore(s => {
    expect(text(handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' }))).toContain('turn 1');
    expect(text(handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' }))).toContain('turn 1');
    expect(text(handleBeginTurn(s, { session: 'sess-1', promptId: 'p-2' }))).toContain('turn 2');
  }));

  test('privacy.store_cwd suppresses the path fields at capture, not afterwards', () => withStore(s => {
    writeConfig(s, 'privacy.store_cwd', 'false');
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1', cwd: '/repo', gitBranch: 'main' });
    const row = latestContext(s, 'sess-1');
    expect(row?.['cwd']).toBeNull();
    expect(row?.['git_branch']).toBeNull();
    expect(row?.['session']).toBe('sess-1');   // everything else still lands
  }));

  test('privacy.store_prompt_len suppresses the length the same way', () => withStore(s => {
    writeConfig(s, 'privacy.store_prompt_len', 'false');
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1', promptLen: 84 });
    expect(latestContext(s, 'sess-1')?.['prompt_len']).toBeNull();
  }));

  test('it is registered as a tool, with session and promptId required', () => withStore(s => {
    const stub = {
      registerTool: (name: string, config: { inputSchema: Record<string, { isOptional: () => boolean }> }): void => {
        if (name !== 'begin_turn') { return; }
        expect(config.inputSchema['session']?.isOptional()).toBe(false);
        expect(config.inputSchema['promptId']?.isOptional()).toBe(false);
        expect(config.inputSchema['cwd']?.isOptional()).toBe(true);
        expect(config.inputSchema).not.toHaveProperty('source');
      },
      server: { getClientVersion: (): undefined => undefined },
    };
    registerTools(stub as unknown as Parameters<typeof registerTools>[0], s, VERSION);
  }));

});

describe('recall — degrading loudly where no turn context was ever recorded', () => {

  /** The tool handlers `registerTools` installs, captured without a transport. */
  function recall(s: Store, args: Record<string, unknown> = {}): Record<string, unknown> {
    const found = new Map<string, (a: Record<string, unknown>) => {
      content: { type: 'text'; text: string }[] }>();
    const stub = {
      registerTool: (name: string, _config: unknown, handler: unknown): void => {
        found.set(name, handler as (a: Record<string, unknown>) => {
          content: { type: 'text'; text: string }[] });
      },
      server: { getClientVersion: (): undefined => undefined },
    };
    registerTools(stub as unknown as Parameters<typeof registerTools>[0], s, VERSION);
    const handler = found.get('recall');
    if (handler === undefined) { throw new Error('recall was not registered'); }
    return JSON.parse(text(handler(args))) as Record<string, unknown>;
  }

  test('context says unknown, with the reason, rather than a silent null', () => withStore(s => {
    const out = recall(s);
    expect(out['context']).toBe(UNKNOWN_CONTEXT);
    expect(String(out['context'])).toContain('nothing was happening');
  }));

  test('previous says unknown too — nothing was searched, which is not "there is none"', () => withStore(s => {
    expect(recall(s)['previous']).toBe(UNKNOWN_PREVIOUS);
  }));

  test('once a turn is recorded, both answer with real values again', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1', turn: 'reply' });
    const id = recordedId(handleExpress(s, VERSION, {
      channel: 'signature', text: 'still', position: 'close', face: '🙂', stem: 'still' }));
    const out = recall(s);
    expect(out['context']).not.toBe(UNKNOWN_CONTEXT);
    expect((out['context'] as Record<string, unknown>)['session']).toBe('sess-1');
    expect(out['previous']).not.toBe(UNKNOWN_PREVIOUS);
    expect((out['previous'] as Record<string, unknown>)['id']).toBe(id);
    expect((out['previous'] as Record<string, unknown>)['stem']).toBe('still');
  }));

  test('a known session with no signature yet is null — genuinely none, not unsearched', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' });
    expect(recall(s)['previous']).toBeNull();
  }));

  test('a caller-supplied session is enough to search, even with no context row', () => withStore(s => {
    expect(recall(s, { session: 'sess-9' })['previous']).toBeNull();
    expect(recall(s, { session: 'sess-9' })['context']).toBe(UNKNOWN_CONTEXT);
  }));

});

describe('express and annotate — saying the gap out loud, not only recording it', () => {

  test('a write with nothing to adopt names the placeholder and the fix', () => withStore(s => {
    const out = text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' }));
    expect(out).toMatch(/^recorded #\d+ /);
    expect(out).toContain(NO_HOOK_SESSION);
    expect(out).toContain('begin_turn');
  }));

  test('a write with context says nothing extra', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' });
    const out = text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' }));
    expect(out).not.toContain(NO_HOOK_SESSION);
    expect(out).not.toContain('begin_turn');
  }));

  test('a caller-supplied session counts as context and silences the notice', () => withStore(s => {
    const out = text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if', session: 'mine' }));
    expect(out).not.toContain(NO_HOOK_SESSION);
  }));

  test('annotate says it once for the batch, before the rendered block', () => withStore(s => {
    const out = text(handleAnnotate(s, VERSION, { notes: [
      { channel: 'dissent', text: 'one', anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1' },
      { channel: 'dissent', text: 'two', anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L2' },
    ]}));
    expect(out.split(NO_HOOK_SESSION)).toHaveLength(2);
    expect(out.indexOf(NO_HOOK_SESSION)).toBeLessThan(out.indexOf('⚓'));
  }));

  test('annotate is silent about it once a turn has been begun', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-1', promptId: 'p-1' });
    const out = text(handleAnnotate(s, VERSION, { notes: [
      { channel: 'dissent', text: 'one', anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1' },
    ]}));
    expect(out).not.toContain(NO_HOOK_SESSION);
  }));

});

describe('the pending notice rides the reply carriers (#98)', () => {

  /** A desk directory the store is pointed at, with one queued, unclaimed intent. */
  function withQueuedIntent<T>(s: Store, at: Date, fn: () => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'se-tools-desk-'));
    writeConfig(s, 'desk.path', dir);
    writeQuestions(dir, [
      { id: 'q1', text: 'merge #21?', asked: at.toISOString(), queued: 'next', queuedAt: at.toISOString() },
    ]);
    try { return fn(); } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  test('express ends with the pending line, and the next express does not', () => withStore(s =>
    withQueuedIntent(s, new Date('2026-08-30T10:00:00Z'), () => {

      const first = text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if', session: 'S' }));
      expect(first).toMatch(/\n\n— pending: 1 desk request \(self-expression claim_pending\)$/);

      const second = text(handleExpress(s, VERSION, { channel: 'idea', text: 'and also', session: 'S' }));
      expect(second).not.toContain('pending:');

    })));

  test('the line lands after the no-context notice, not before it', () => withStore(s =>
    withQueuedIntent(s, new Date('2026-08-30T10:00:00Z'), () => {
      const out = text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if' }));
      expect(out.indexOf(NO_HOOK_SESSION)).toBeLessThan(out.indexOf('pending:'));
    })));

  test('annotate carries it after the rendered block', () => withStore(s =>
    withQueuedIntent(s, new Date('2026-08-30T10:00:00Z'), () => {
      const out = text(handleAnnotate(s, VERSION, { notes: [
        { channel: 'dissent', text: 'one', anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1' },
      ], session: 'S' }));
      expect(out).toMatch(/\n\n— pending: 1 desk request \(self-expression claim_pending\)$/);
      expect(out.indexOf('⚓')).toBeLessThan(out.indexOf('pending:'));
    })));

  test('begin_turn carries it for the session it just recorded', () => withStore(s =>
    withQueuedIntent(s, new Date('2026-08-30T10:00:00Z'), () => {
      const out = text(handleBeginTurn(s, { session: 'S', promptId: 'p-1' }));
      expect(out).toMatch(/— pending: 1 desk request/);
    })));

  test('recall carries it after the JSON, and the JSON still parses on its own', () => withStore(s =>
    withQueuedIntent(s, new Date('2026-08-30T10:00:00Z'), () => {
      const found = new Map<string, (a: Record<string, unknown>) => {
        content: { type: 'text'; text: string }[] }>();
      const stub = {
        registerTool: (name: string, _config: unknown, handler: unknown): void => {
          found.set(name, handler as (a: Record<string, unknown>) => {
            content: { type: 'text'; text: string }[] });
        },
        server: { getClientVersion: (): undefined => undefined },
      };
      registerTools(stub as unknown as Parameters<typeof registerTools>[0], s, VERSION);
      const handler = found.get('recall');
      if (handler === undefined) { throw new Error('recall was not registered'); }

      const out = text(handler({ session: 'S' }));
      expect(out).toMatch(/— pending: 1 desk request/);
      expect(JSON.parse(out.slice(0, out.lastIndexOf('\n\n—')))).toHaveProperty('recent');
    })));

  test('one carrier speaking silences the others — the fingerprint is shared', () => withStore(s =>
    withQueuedIntent(s, new Date('2026-08-30T10:00:00Z'), () => {
      expect(text(handleBeginTurn(s, { session: 'S', promptId: 'p-1' }))).toMatch(/pending:/);
      expect(text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if', session: 'S' })))
        .not.toContain('pending:');
    })));

  test('pending.enabled false keeps every carrier quiet', () => withStore(s =>
    withQueuedIntent(s, new Date('2026-08-30T10:00:00Z'), () => {
      writeConfig(s, 'pending.enabled', 'false');
      expect(text(handleExpress(s, VERSION, { channel: 'idea', text: 'what if', session: 'S' })))
        .not.toContain('pending:');
    })));

});
