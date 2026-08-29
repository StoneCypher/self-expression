import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { recordEntry }                        from '../channels/entries.js';
import { latestContext, turnCount }           from '../channels/context.js';
import {
  onUserPromptSubmit, onStop, handleHook, describeMoment,
  OPEN_REMINDER, OPEN_REMINDER_CLOCKLESS,
  conventionFlags, CONVENTION_FLAGS, channelLengths,
  windowPostureLine, windowClause, WINDOW_SURFACE_NOUNS,
  renderReplayItem, retractionReplayLine,
  REPLAY_WINDOW_DAYS, REPLAY_MAX_ITEMS, REPLAY_QUOTE_MAX,
} from '../mcp/hooks.js';
import { configKey, channelMaxCharsKey, DEFAULT_CHANNEL_MAX_CHARS,
         WINDOW_SURFACES, WINDOW_POSTURES, windowPostureKey } from '../channels/config.js';
import { CHANNELS }                           from '../channels/vocabulary.js';
import { zoneAbbreviation }                   from '../channels/time.js';

const VERSION = '0.2.0';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-hooks-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

const NOW = new Date(2026, 7, 18, 14, 5);

describe('describeMoment', () => {

  test('names the day, the clock, and the part of day', () => {
    const text = describeMoment(NOW);
    expect(text).toContain('Tuesday');
    expect(text).toContain('2:05 pm');
    expect(text).toContain('afternoon');
  });

  test('carries the zone with the clock, so the signature can render it', () => {
    const text = describeMoment(NOW);
    // The signature spec is "12-hour, with zone"; the clock must be handed a zone token,
    // sitting between the time and the part-of-day, and it must be the real machine zone.
    expect(text).toMatch(/2:05 pm \S+ \(afternoon\)/);
    expect(text).toContain(`2:05 pm ${zoneAbbreviation(NOW)} `);
  });

  test.each([
    [3,  'small hours'], [9,  'morning'], [14, 'afternoon'],
    [19, 'evening'],     [23, 'night'],
  ])('hour %i reads as %s', (hour, part) => {
    expect(describeMoment(new Date(2026, 7, 18, hour, 0))).toContain(part);
  });

});

describe('onUserPromptSubmit', () => {

  test('records what the harness observed', () => withStore(s => {
    onUserPromptSubmit(s, {
      session_id: 'sess-1', prompt_id: 'p1', cwd: '/w/x',
      permission_mode: 'default', effort: { level: 'high' }, user_input: 'hello there',
    }, NOW);
    const c = latestContext(s);
    expect(c?.['session']).toBe('sess-1');
    expect(c?.['prompt_id']).toBe('p1');
    expect(c?.['cwd']).toBe('/w/x');
    expect(c?.['effort']).toBe('high');
    expect(c?.['prompt_len']).toBe(11);
  }));

  test('privacy.store_cwd = false keeps cwd out of the record at capture', () => withStore(s => {
    writeConfig(s, 'privacy.store_cwd', false);
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1', cwd: '/w/x',
      user_input: 'hello there' }, NOW);
    const c = latestContext(s);
    expect(c?.['cwd']).toBeNull();
    expect(c?.['prompt_len']).toBe(11);        // a separate switch, still recorded
  }));

  test('privacy.store_prompt_len = false keeps the length out of the record', () => withStore(s => {
    writeConfig(s, 'privacy.store_prompt_len', false);
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1', cwd: '/w/x',
      user_input: 'hello there' }, NOW);
    const c = latestContext(s);
    expect(c?.['prompt_len']).toBeNull();
    expect(c?.['cwd']).toBe('/w/x');           // a separate switch, still recorded
  }));

  test('turn_index counts up within a session', () => withStore(s => {
    for (const p of ['p1', 'p2', 'p3']) {
      onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: p }, NOW);
    }
    expect(latestContext(s)?.['turn_index']).toBe(3);
    expect(turnCount(s, 'sess-1')).toBe(3);
  }));

  test('always returns the clock, even with no store', () => {
    const out = onUserPromptSubmit(null, { session_id: 'x' }, NOW);
    expect(JSON.stringify(out)).toContain('UserPromptSubmit');
    expect(JSON.stringify(out)).toContain('2:05 pm');
  });

  test('asks for the opening signature, which is the only prompt for it there is', () => {
    const out = onUserPromptSubmit(null, { session_id: 'x' }, NOW);
    expect(JSON.stringify(out)).toContain('Open this turn');
  });

  test('the clock precedes the reminder, so the timestamp is in hand before it is asked for', () => {
    const context = String(
      (onUserPromptSubmit(null, { session_id: 'x' }, NOW) as
        { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
    expect(context.indexOf('2:05 pm')).toBeLessThan(context.indexOf(OPEN_REMINDER));
  });

  test('a payload with no session still yields the clock and records nothing', () => withStore(s => {
    expect(onUserPromptSubmit(s, {}, NOW)).not.toBeNull();
    expect(latestContext(s)).toBeNull();
  }));

  test('the context line carries the conventions flags between the clock and the reminder', () => withStore(s => {
    const context = String(
      (onUserPromptSubmit(s, { session_id: 'x' }, NOW) as
        { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
    expect(context).toContain('conventions: salience:on revision:off gifts:off roster:off');
    expect(context.indexOf('2:05 pm')).toBeLessThan(context.indexOf('conventions:'));
    expect(context.indexOf('conventions:')).toBeLessThan(context.indexOf(OPEN_REMINDER));
  }));

  test('with no store there is no flags segment, and the clock still arrives', () => {
    const context = String(
      (onUserPromptSubmit(null, { session_id: 'x' }, NOW) as
        { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
    expect(context).not.toContain('conventions:');
    expect(context).toContain('2:05 pm');
  });

});

describe('conventionFlags', () => {

  test('renders the code-side defaults when nothing is configured', () => withStore(s => {
    expect(conventionFlags(s)).toBe('conventions: salience:on revision:off gifts:off roster:off');
  }));

  test('an override flips its flag in the rendered segment', () => withStore(s => {
    writeConfig(s, 'salience.enabled', false);
    writeConfig(s, 'revision.enabled', true);
    expect(conventionFlags(s)).toBe('conventions: salience:off revision:on gifts:off roster:off');
  }));

  test('only the exact strings true and false override; anything else falls back', () => withStore(s => {
    writeConfig(s, 'salience.enabled', 'off');    // a typo, not a setting
    writeConfig(s, 'gifts.enabled',    'yes');    // likewise
    expect(conventionFlags(s)).toBe('conventions: salience:on revision:off gifts:off roster:off');
  }));

  test('every declared convention appears in the segment exactly once', () => withStore(s => {
    const segment = conventionFlags(s);
    for (const { label } of CONVENTION_FLAGS) {
      expect(segment.split(`${label}:`)).toHaveLength(2);
    }
  }));

  test('every convention key is registered, and the fallbacks agree with the registry defaults', () => {
    for (const { key, fallback } of CONVENTION_FLAGS) {
      expect(configKey(key)?.fallback).toBe(fallback ? 'true' : 'false');
    }
  });

});

describe('channelLengths — the #76 ceiling transport', () => {

  test('an unconfigured install costs one short segment, not twelve pairs', () => withStore(s => {
    expect(channelLengths(s)).toBe('lengths: 200 all');
  }));

  test('a configured channel is named as an exception against the shared base', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('signature'), '70');
    expect(channelLengths(s)).toBe('lengths: 200 except signature:70');
  }));

  test('several exceptions are listed in vocabulary order', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('signature'), '70');
    writeConfig(s, channelMaxCharsKey('taste'), '400');
    expect(channelLengths(s)).toBe('lengths: 200 except signature:70 taste:400');
  }));

  test('moving every channel to one new number renders as compactly as the default', () => withStore(s => {
    for (const channel of CHANNELS) { writeConfig(s, channelMaxCharsKey(channel), '120'); }
    expect(channelLengths(s)).toBe('lengths: 120 all');
  }));

  test('the base follows the majority, so a lone holdout is the exception', () => withStore(s => {
    for (const channel of CHANNELS.filter(c => c !== 'taste')) {
      writeConfig(s, channelMaxCharsKey(channel), '120');
    }
    expect(channelLengths(s)).toBe('lengths: 120 except taste:200');
  }));

  test('an invalid stored row never reaches the segment — it renders as the default', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('need'), 'lots');
    expect(channelLengths(s)).toBe('lengths: 200 all');
  }));

  test('the ceiling on the line is the configured one, never the hardcoded default', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('need'), '450');
    const context = String(
      (onUserPromptSubmit(s, { session_id: 'x' }, NOW) as
        { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
    expect(context).toContain('lengths: 200 except need:450');
  }));

  test('the segment sits after the conventions flags and before the reminder', () => withStore(s => {
    const context = String(
      (onUserPromptSubmit(s, { session_id: 'x' }, NOW) as
        { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
    expect(context.indexOf('conventions:')).toBeLessThan(context.indexOf('lengths:'));
    expect(context.indexOf('lengths:')).toBeLessThan(context.indexOf(OPEN_REMINDER));
  }));

  test('with no store there is no lengths segment, and the clock still arrives', () => {
    const context = String(
      (onUserPromptSubmit(null, { session_id: 'x' }, NOW) as
        { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
    expect(context).not.toContain('lengths:');
    expect(context).toContain('2:05 pm');
  });

  test('every channel is representable in the segment, whether as base or exception', () => withStore(s => {
    for (const channel of CHANNELS) {
      writeConfig(s, channelMaxCharsKey(channel), String(DEFAULT_CHANNEL_MAX_CHARS + 1));
      expect(channelLengths(s)).toContain(channel);
      writeConfig(s, channelMaxCharsKey(channel), String(DEFAULT_CHANNEL_MAX_CHARS));
    }
  }));

});

describe('windowPostureLine — the advisory window-posture transport', () => {

  /** The whole `additionalContext` string one turn produces. */
  function contextOf(store: Store | null): string {
    return String((onUserPromptSubmit(store, { session_id: 'x' }, NOW) as
      { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
  }

  test('an unconfigured install states ask for both surfaces — ask is itself an instruction', () => withStore(s => {
    expect(windowPostureLine(s)).toBe(
      'windows: ask before opening an external browser window; ' +
      'ask before opening an editor tab');
  }));

  test.each([
    ['never',  'windows: never open an external browser window; ask before opening an editor tab'],
    ['ask',    'windows: ask before opening an external browser window; ask before opening an editor tab'],
    ['always', 'windows: opening an external browser window is pre-approved; ask before opening an editor tab'],
  ])('the browser posture %s produces its own sentence', (posture, expected) => withStore(s => {
    writeConfig(s, 'window.browser', posture);
    expect(windowPostureLine(s)).toBe(expected);
  }));

  test.each([
    ['never',  'windows: ask before opening an external browser window; never open an editor tab'],
    ['ask',    'windows: ask before opening an external browser window; ask before opening an editor tab'],
    ['always', 'windows: ask before opening an external browser window; opening an editor tab is pre-approved'],
  ])('the editor posture %s produces its own sentence', (posture, expected) => withStore(s => {
    writeConfig(s, 'window.editor', posture);
    expect(windowPostureLine(s)).toBe(expected);
  }));

  test('the two surfaces are stated independently — the whole point of two keys', () => withStore(s => {
    writeConfig(s, 'window.browser', 'never');
    writeConfig(s, 'window.editor', 'always');
    expect(windowPostureLine(s)).toBe(
      'windows: never open an external browser window; opening an editor tab is pre-approved');
  }));

  test('every posture-by-surface combination renders as a distinct, grammatical clause', () => {
    const seen = new Set<string>();
    for (const surface of WINDOW_SURFACES) {
      for (const posture of WINDOW_POSTURES) {
        const clause = windowClause(posture, WINDOW_SURFACE_NOUNS[surface]);
        expect(clause).toContain(WINDOW_SURFACE_NOUNS[surface]);
        expect(clause).not.toMatch(/^\s|\s$|[.;]$/);
        seen.add(clause);
      }
    }
    expect(seen.size).toBe(WINDOW_SURFACES.length * WINDOW_POSTURES.length);
  });

  test('an invalid stored value behaves as ask, never as permission', () => withStore(s => {
    for (const bad of ['sometimes', 'true', 'yes', '', 'whenever', 'never ask']) {
      writeConfig(s, 'window.browser', bad);
      writeConfig(s, 'window.editor', bad);
      expect(windowPostureLine(s)).toBe(
        'windows: ask before opening an external browser window; ' +
        'ask before opening an editor tab');
    }
  }));

  test('a valid-but-uncanonical row is canonicalized on read, not treated as garbage', () => withStore(s => {
    writeConfig(s, 'window.browser', ' ALWAYS ');   // a hand-edited row that still means something
    expect(windowPostureLine(s)).toContain('opening an external browser window is pre-approved');
  }));

  test('the segment sits after the lengths and before the reminder', () => withStore(s => {
    const context = contextOf(s);
    expect(context.indexOf('lengths:')).toBeLessThan(context.indexOf('windows:'));
    expect(context.indexOf('windows:')).toBeLessThan(context.indexOf(OPEN_REMINDER));
  }));

  test('the configured posture, not the default, is what reaches the turn', () => withStore(s => {
    writeConfig(s, 'window.browser', 'never');
    expect(contextOf(s)).toContain('never open an external browser window');
  }));

  test('with no store there is no windows segment, and the clock still arrives', () => {
    const context = contextOf(null);
    expect(context).not.toContain('windows:');
    expect(context).toContain('2:05 pm');
  });

  test('both registered keys are the ones the line actually reads', () => {
    for (const surface of WINDOW_SURFACES) {
      expect(configKey(windowPostureKey(surface))?.fallback).toBe('ask');
    }
  });

});

describe('onUserPromptSubmit — time.hook (issue #30, D9)', () => {

  function additionalContext(out: unknown): string {
    return String((out as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext);
  }

  test("'false' drops the clock sentence and keeps the reminder, reworded for the clockless case", () => withStore(s => {
    writeConfig(s, 'time.hook', false);
    const context = additionalContext(onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW));
    // The conventions flags are config transport, not time presentation (#42), so they
    // still lead the clockless line; only the clock sentence is suppressed.
    expect(context).toBe(
      `${conventionFlags(s)}. ${channelLengths(s)}. ${windowPostureLine(s)}. ${OPEN_REMINDER_CLOCKLESS}`);
    expect(context).not.toContain('2:05 pm');
    expect(context).not.toContain('Turn starting');
    expect(context).not.toContain('timestamp above');   // the shipped wording must not dangle
  }));

  test("'false' with no store yields exactly the clockless reminder — nothing dangles", () => {
    // No store means no config read at all, so the suppression path cannot fire; this
    // pins the other boundary: flags absent, clock present, reminder intact.
    const context = additionalContext(onUserPromptSubmit(null, { session_id: 'x' }, NOW));
    expect(context).toBe(`${describeMoment(NOW)} ${OPEN_REMINDER}`);
  });

  test("context recording is unaffected — the write is observational, not presentational", () => withStore(s => {
    writeConfig(s, 'time.hook', false);
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1', effort: { level: 'high' } }, NOW);
    const c = latestContext(s);
    expect(c?.['session']).toBe('sess-1');
    expect(c?.['prompt_id']).toBe('p1');
    expect(c?.['effort']).toBe('high');
  }));

  test('only the exact string false suppresses; any other value keeps current behavior', () => withStore(s => {
    writeConfig(s, 'time.hook', 'off');
    const context = additionalContext(onUserPromptSubmit(s, { session_id: 'sess-1' }, NOW));
    expect(context).toContain('2:05 pm');
    expect(context).toContain(OPEN_REMINDER);
  }));

  test('unset keeps the clock, with the conventions flags, lengths, and windows between clock and reminder', () => withStore(s => {
    const context = additionalContext(onUserPromptSubmit(s, { session_id: 'sess-1' }, NOW));
    expect(context).toBe(
      `${describeMoment(NOW)} ${conventionFlags(s)}. ${channelLengths(s)}. ` +
      `${windowPostureLine(s)}. ${OPEN_REMINDER}`);
  }));

});

describe('the retraction replay (#16)', () => {

  /** Record a claim and take it back, at `when`. Returns the strike's replacement text. */
  function takeBack(s: Store, when: Date, claim: string, fix: string): string {
    const original = recordEntry(s, { channel: 'checklist', text: 'a render', session: 's1' },
                                 VERSION, when).id;
    recordEntry(s, { channel: 'divergence', text: fix, session: 's1', divergenceKind: 'stale',
                     correctsId: original, correctsKind: 'retracts', verbatim: claim },
                VERSION, when);
    return fix;
  }

  /** The whole `additionalContext` string one turn produces. */
  function contextLine(s: Store | null, session: string, at: Date = NOW): string {
    return String((onUserPromptSubmit(s, { session_id: session, prompt_id: 'p1' }, at) as
      { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);
  }

  test('renders one item as ⊘ quote → replacement (day)', () => {
    expect(renderReplayItem({
      kind: 'retracts', at: '2026-08-25T18:02:00.000Z', original: null,
      verbatim: 'the build skips lint on spec-only PRs',
      replacement: { id: 9, channel: 'divergence', text: 'it runs markdownlint' },
    })).toBe('⊘ "the build skips lint on spec-only PRs" → it runs markdownlint (2026-08-25)');
  });

  test('falls back to the original\'s own text when the strike quoted nothing', () => {
    expect(renderReplayItem({
      kind: 'retracts', at: '2026-08-25T18:02:00.000Z',
      original: { id: 3, channel: 'checklist', tsUtc: '2026-08-24T00:00:00.000Z', text: 'Atlas 31%' },
      verbatim: null,
      replacement: { id: 9, channel: 'divergence', text: 'Atlas 62%' },
    })).toContain('"Atlas 31%"');
  });

  test('elides a claim longer than the line budget rather than flooding the turn', () => {
    const long = 'x'.repeat(REPLAY_QUOTE_MAX + 40);
    const line = renderReplayItem({
      kind: 'retracts', at: '2026-08-25T00:00:00.000Z', original: null, verbatim: long,
      replacement: { id: 1, channel: 'divergence', text: 'no' },
    });
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(long.length);
  });

  test('the first turn of a session carries the recently retracted claims', () => withStore(s => {
    takeBack(s, new Date(NOW.getTime() - 86_400_000), 'icons sort by status first', 'rank then bucket');
    const context = contextLine(s, 'sess-new');
    expect(context).toContain('Recently retracted (do not rely on these):');
    expect(context).toContain('⊘ "icons sort by status first" → rank then bucket');
  }));

  test('and no later turn does — once per session, or it becomes wallpaper', () => withStore(s => {
    takeBack(s, new Date(NOW.getTime() - 86_400_000), 'wrong thing', 'right thing');
    expect(contextLine(s, 'sess-new')).toContain('Recently retracted');
    expect(contextLine(s, 'sess-new')).not.toContain('Recently retracted');
    expect(turnCount(s, 'sess-new')).toBe(2);
  }));

  test('an empty register costs no ritual text at all', () => withStore(s => {
    expect(contextLine(s, 'sess-new')).not.toContain('Recently retracted');
  }));

  test('retraction.replay = false suppresses it, and nothing else', () => withStore(s => {
    takeBack(s, new Date(NOW.getTime() - 86_400_000), 'wrong thing', 'right thing');
    writeConfig(s, 'retraction.replay', 'false');
    const context = contextLine(s, 'sess-new');
    expect(context).not.toContain('Recently retracted');
    expect(context).toContain(OPEN_REMINDER);
    expect(context).toContain('2:05 pm');
  }));

  test('the reminder still precedes it — the replay never displaces the ask', () => withStore(s => {
    takeBack(s, new Date(NOW.getTime() - 86_400_000), 'wrong thing', 'right thing');
    const context = contextLine(s, 'sess-new');
    expect(context.indexOf(OPEN_REMINDER)).toBeLessThan(context.indexOf('Recently retracted'));
  }));

  test('anything older than the window is not replayed', () => withStore(s => {
    takeBack(s, new Date(NOW.getTime() - (REPLAY_WINDOW_DAYS + 2) * 86_400_000),
             'ancient history', 'long since fixed');
    expect(contextLine(s, 'sess-new')).not.toContain('Recently retracted');
  }));

  test('the register is capped, so a bad week cannot swamp the turn', () => withStore(s => {
    for (let i = 0; i < REPLAY_MAX_ITEMS + 4; i++) {
      takeBack(s, new Date(NOW.getTime() - 3_600_000), `claim ${String(i)}`, `fix ${String(i)}`);
    }
    const context = contextLine(s, 'sess-new');
    expect([...context.matchAll(/⊘/gu)]).toHaveLength(REPLAY_MAX_ITEMS);
  }));

  test('an amendment is never replayed as a falsehood', () => withStore(s => {
    const original = recordEntry(s, { channel: 'checklist', text: '171 rows', session: 's1' },
                                 VERSION, new Date(NOW.getTime() - 3_600_000)).id;
    recordEntry(s, { channel: 'divergence', text: '172; off by the header', session: 's1',
                     correctsId: original, correctsKind: 'amends', verbatim: '171 rows' },
                VERSION, new Date(NOW.getTime() - 3_600_000));
    expect(contextLine(s, 'sess-new')).not.toContain('Recently retracted');
  }));

  test('a withdrawn retraction stops replaying its original, and replays itself instead', () => withStore(s => {
    const when     = new Date(NOW.getTime() - 3_600_000),
          original = recordEntry(s, { channel: 'checklist', text: 'a render', session: 's1' },
                                 VERSION, when).id;
    const strike = recordEntry(s, { channel: 'divergence', text: 'rank then bucket', session: 's1',
                                    correctsId: original, correctsKind: 'retracts',
                                    verbatim: 'icons sort by status' }, VERSION, when).id;
    recordEntry(s, { channel: 'divergence', text: 'I was wrong to take that back', session: 's1',
                     correctsId: strike, correctsKind: 'retracts' }, VERSION, when);
    const context = contextLine(s, 'sess-new');
    // The original claim stands again, so it is no longer named as a falsehood…
    expect(context).not.toContain('icons sort by status');
    // …and the withdrawn retraction is now the thing not to rely on.
    expect(context).toContain('⊘ "rank then bucket" → I was wrong to take that back');
  }));

  test('retractionReplayLine is null when disabled and null when empty', () => withStore(s => {
    expect(retractionReplayLine(s, NOW)).toBeNull();
    recordEntry(s, { channel: 'divergence', text: 'it runs markdownlint', session: 's1',
                     verbatim: 'the build skips lint' }, VERSION, NOW);
    expect(retractionReplayLine(s, NOW)).toContain('⊘ "the build skips lint"');
    writeConfig(s, 'retraction.replay', 'false');
    expect(retractionReplayLine(s, NOW)).toBeNull();
  }));

  test('with no store there is no replay, and the clock still arrives', () => {
    const context = contextLine(null, 'sess-new');
    expect(context).not.toContain('Recently retracted');
    expect(context).toContain('2:05 pm');
  });

});

describe('onStop', () => {

  test('allows when the turn already signed off', () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW);
    recordEntry(s, { channel: 'signature', text: 'done', session: 'sess-1',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(onStop(s, { session_id: 'sess-1', prompt_id: 'p1' })).toBeNull();
  }));

  test('blocks when it did not', () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW);
    const out = onStop(s, { session_id: 'sess-1', prompt_id: 'p1' });
    expect(out?.['decision']).toBe('block');
    expect(String(out?.['reason'])).toContain('still; unchanged');
  }));

  test('finds the turn from context when the payload omits prompt_id', () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p9' }, NOW);
    expect(onStop(s, { session_id: 'sess-1' })?.['decision']).toBe('block');
  }));

  test("another turn's signature does not satisfy this one", () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW);
    recordEntry(s, { channel: 'signature', text: 'old', session: 'sess-1',
                     promptId: 'p0', position: 'close' }, VERSION);
    expect(onStop(s, { session_id: 'sess-1', prompt_id: 'p1' })?.['decision']).toBe('block');
  }));

  test('a non-signature entry does not satisfy the gate', () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW);
    recordEntry(s, { channel: 'need', text: 'ask', session: 'sess-1', promptId: 'p1' }, VERSION);
    expect(onStop(s, { session_id: 'sess-1', prompt_id: 'p1' })?.['decision']).toBe('block');
  }));

  test('config can disable the gate entirely', () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW);
    writeConfig(s, 'gate.signature', false);
    expect(onStop(s, { session_id: 'sess-1', prompt_id: 'p1' })).toBeNull();
  }));

  test('fails open with no store', () => {
    expect(onStop(null, { session_id: 'x', prompt_id: 'p' })).toBeNull();
  });

  test('fails open when no turn is known — never enforces on a guess', () => withStore(s => {
    expect(onStop(s, {})).toBeNull();
  }));

  test('an open alone does not satisfy the gate; only a close or mid does', () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW);
    recordEntry(s, { channel: 'signature', text: 'opened', session: 'sess-1',
                     promptId: 'p1', position: 'open' }, VERSION);
    expect(onStop(s, { session_id: 'sess-1', prompt_id: 'p1' })?.['decision']).toBe('block');
  }));

  test('a missing open never blocks — a backdated before-measurement is worse than none', () => withStore(s => {
    onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p1' }, NOW);
    recordEntry(s, { channel: 'signature', text: 'closed only', session: 'sess-1',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(onStop(s, { session_id: 'sess-1', prompt_id: 'p1' })).toBeNull();
  }));

});

describe('handleHook', () => {

  test('routes by name', () => withStore(s => {
    expect(handleHook('user-prompt-submit', s, { session_id: 'a' }, NOW)).not.toBeNull();
    expect(handleHook('stop', s, {})).toBeNull();
  }));

  test('an unknown hook name does nothing rather than erroring', () => withStore(s => {
    expect(handleHook('some-future-event', s, { session_id: 'a' }, NOW)).toBeNull();
  }));

});
