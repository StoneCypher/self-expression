import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import {
  recordEntry, validate, hasClosingSignature, previousSignature, recentEntries,
  recentChecklists, seriesPercents,
} from '../channels/entries.js';

const VERSION = '0.2.0';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-entries-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

describe('validate', () => {

  test('accepts a minimal valid entry', () => {
    expect(validate({ channel: 'need', text: 'merge #21?', session: 's1' })).toEqual([]);
  });

  test('names the offending value and what would have worked', () => {
    const [problem] = validate({ channel: 'vibes' as never, text: 'x', session: 's' });
    expect(problem).toContain("'vibes'");
    expect(problem).toContain('channel');
    expect(problem).toContain("'signature'");
  });

  test('reports every problem at once, not just the first', () => {
    expect(validate({
      channel: 'signature', text: 'x', session: 's',
      delta: 'flat' as never, position: 'sideways' as never,
    })).toHaveLength(2);
  });

  test('rejects empty text and empty session', () => {
    expect(validate({ channel: 'idea', text: '   ', session: 's' })).toContain('text must not be empty');
    expect(validate({ channel: 'idea', text: 'x', session: '  ' })).toContain('session must not be empty');
  });

});

describe('recordEntry', () => {

  test('returns an id and a uuid', () => withStore(s => {
    const w = recordEntry(s, { channel: 'idea', text: 'what if', session: 's1' }, VERSION);
    expect(w.id).toBe(1);
    expect(w.uuid).toMatch(/^[0-9a-f-]{36}$/);
  }));

  test('fills timestamps and machine identity rather than accepting them', () => withStore(s => {
    recordEntry(s, { channel: 'need', text: 'push?', session: 's1' }, VERSION,
                new Date('2026-08-18T16:14:00Z'));
    const row = s.db.prepare('SELECT ts_utc, ts_local, tz, machine_id, platform FROM entries').get();
    expect(row.ts_utc).toBe('2026-08-18T16:14:00.000Z');
    expect(String(row.ts_local)).toContain(String(row.tz));
    expect(row.machine_id).toBe(s.machineId);
    expect(row.platform).toBeTruthy();
  }));

  test('throws naming every problem, and writes nothing', () => withStore(s => {
    expect(() => recordEntry(s, {
      channel: 'signature', text: 'x', session: 's', delta: 'right' as never,
    }, VERSION)).toThrow(/right/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(0);
  }));

  test('visible defaults to 1, nudged and uncertain to 0', () => withStore(s => {
    recordEntry(s, { channel: 'dissent', text: 'reservation', session: 's1' }, VERSION);
    const row = s.db.prepare('SELECT visible, nudged, uncertain FROM entries').get();
    expect(row.visible).toBe(1); expect(row.nudged).toBe(0); expect(row.uncertain).toBe(0);
  }));

  test('records a dissent that was logged but never surfaced', () => withStore(s => {
    recordEntry(s, { channel: 'dissent', text: 'unsaid', session: 's1', visible: false }, VERSION);
    expect(s.db.prepare('SELECT visible FROM entries').get().visible).toBe(0);
  }));

  test('one turn can carry two needs', () => withStore(s => {
    recordEntry(s, { channel: 'need', text: 'a?', session: 's1', promptId: 'p1' }, VERSION);
    recordEntry(s, { channel: 'need', text: 'b?', session: 's1', promptId: 'p1' }, VERSION);
    expect(s.db.prepare("SELECT COUNT(*) n FROM entries WHERE channel='need'").get().n).toBe(2);
  }));

  test('stores the full model identifier verbatim', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'still', session: 's1',
                     model: 'claude-opus-5[1m]' }, VERSION);
    expect(s.db.prepare('SELECT model FROM entries').get().model).toBe('claude-opus-5[1m]');
  }));

});

describe('hasClosingSignature', () => {

  test('is false when the turn has not signed off', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'open', session: 's1',
                     promptId: 'p1', position: 'open' }, VERSION);
    expect(hasClosingSignature(s, 'p1')).toBe(false);
  }));

  test('is true once a close lands for that turn', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'done', session: 's1',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(hasClosingSignature(s, 'p1')).toBe(true);
  }));

  test('a mid signature also satisfies the gate', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'lurch', session: 's1',
                     promptId: 'p1', position: 'mid' }, VERSION);
    expect(hasClosingSignature(s, 'p1')).toBe(true);
  }));

  test("another turn's close does not satisfy this one — the bug the time window had", () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'prev', session: 's1',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(hasClosingSignature(s, 'p2')).toBe(false);
  }));

  test('a non-signature channel does not satisfy the gate', () => withStore(s => {
    recordEntry(s, { channel: 'need', text: 'ask', session: 's1', promptId: 'p1' }, VERSION);
    expect(hasClosingSignature(s, 'p1')).toBe(false);
  }));

});

describe('previousSignature', () => {

  test('is null in a fresh session', () => withStore(s => {
    expect(previousSignature(s, 's1')).toBeNull();
  }));

  test('returns the latest signature so delta is derived, not recalled', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'first',  session: 's1', face: '🙂', stem: 'still' }, VERSION);
    recordEntry(s, { channel: 'signature', text: 'second', session: 's1', face: '😌', stem: 'spark' }, VERSION);
    expect(previousSignature(s, 's1')?.face).toBe('😌');
  }));

  test('ignores other sessions', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'theirs', session: 'other', face: '🙂' }, VERSION);
    expect(previousSignature(s, 's1')).toBeNull();
  }));

});

describe('recentEntries', () => {

  test('returns newest last', () => withStore(s => {
    for (const t of ['one', 'two', 'three']) {
      recordEntry(s, { channel: 'idea', text: t, session: 's1' }, VERSION);
    }
    expect(recentEntries(s, 3).map(r => r.text)).toEqual(['one', 'two', 'three']);
  }));

  test('honours the limit', () => withStore(s => {
    for (const t of ['a', 'b', 'c', 'd']) {
      recordEntry(s, { channel: 'idea', text: t, session: 's1' }, VERSION);
    }
    expect(recentEntries(s, 2)).toHaveLength(2);
  }));

});

describe('recentChecklists', () => {

  test('returns only checklist rows, newest last, with the checklist columns', () => withStore(s => {
    recordEntry(s, { channel: 'checklist', text: 'block a', session: 's1',
                     title: 'alpha', seriesKey: 'a', succ: 1, active: 1, fail: 0, percent: 50 }, VERSION);
    recordEntry(s, { channel: 'idea', text: 'not a checklist', session: 's1' }, VERSION);
    recordEntry(s, { channel: 'checklist', text: 'block b', session: 's1',
                     title: 'beta', seriesKey: 'b', succ: 2, active: 0, fail: 0, percent: 100 }, VERSION);
    const rows = recentChecklists(s, 10);
    expect(rows.map(r => r['title'])).toEqual(['alpha', 'beta']);
    expect(rows.map(r => r['series_key'])).toEqual(['a', 'b']);
    expect(rows.map(r => r['percent'])).toEqual([50, 100]);
  }));

  test('honours the limit, keeping the most recent rows', () => withStore(s => {
    for (const [title, percent] of [['a', 10], ['b', 20], ['c', 30]] as const) {
      recordEntry(s, { channel: 'checklist', text: 'x', session: 's1', title, seriesKey: title, percent }, VERSION);
    }
    expect(recentChecklists(s, 2).map(r => r['title'])).toEqual(['b', 'c']);
  }));

});

describe('seriesPercents', () => {

  test('returns a series\' percents ascending by id, ignoring other series', () => withStore(s => {
    recordEntry(s, { channel: 'checklist', text: 'a', session: 's1', seriesKey: 'x', percent: 10 }, VERSION);
    recordEntry(s, { channel: 'checklist', text: 'b', session: 's1', seriesKey: 'x', percent: 50 }, VERSION);
    recordEntry(s, { channel: 'checklist', text: 'c', session: 's1', seriesKey: 'x', percent: 90 }, VERSION);
    recordEntry(s, { channel: 'checklist', text: 'unrelated', session: 's1', seriesKey: 'y', percent: 30 }, VERSION);
    expect(seriesPercents(s, 'x')).toEqual([10, 50, 90]);
  }));

  test('an unknown series key yields an empty array', () => withStore(s => {
    recordEntry(s, { channel: 'checklist', text: 'a', session: 's1', seriesKey: 'x', percent: 10 }, VERSION);
    expect(seriesPercents(s, 'nonesuch')).toEqual([]);
  }));

});
