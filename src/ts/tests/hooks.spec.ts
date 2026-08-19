import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { recordEntry }                        from '../channels/entries.js';
import { latestContext, turnCount }           from '../channels/context.js';
import { onUserPromptSubmit, onStop, handleHook, describeMoment, OPEN_REMINDER } from '../mcp/hooks.js';

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
