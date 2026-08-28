import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import {
  recordEntry, validate, hasClosingSignature, previousSignature, recentEntries,
  recentChecklists, seriesPercents, forecastOutcomes,
  localHour, isoWeekKey, signatureHistory, needWeekly, checklistSeriesTop,
} from '../channels/entries.js';
import { CHANNELS, SILENCE_KINDS } from '../channels/vocabulary.js';

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

  test('accepts a checklist snapshot carrying its stable series key', () => {
    expect(validate({
      channel: 'checklist', text: '- ✅ done', session: 's',
      seriesKey: 'release-build', title: 'Release build', percent: 67,
    })).toEqual([]);
  });

  test('rejects a blank seriesKey', () => {
    expect(validate({ channel: 'checklist', text: 'x', session: 's', seriesKey: '  ' }))
      .toContain('seriesKey must not be blank');
  });

  test('rejects a percent snapshot without a seriesKey — the invisible orphan (#27)', () => {
    const problems = validate({ channel: 'checklist', text: 'x', session: 's', percent: 40 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('seriesKey');
  });

  test('rejects a percent outside 0-100 or non-integral', () => {
    for (const percent of [-1, 101, 33.3]) {
      const problems = validate({ channel: 'checklist', text: 'x', session: 's',
                                  seriesKey: 'k', percent });
      expect(problems.some(p => p.includes('percent must be an integer'))).toBe(true);
    }
  });

  test('accepts a forecast: predicted confidence with a resolveBy date', () => {
    expect(validate({ channel: 'confidence', text: 'the stryker run passes untouched', session: 's',
                      confidence: 'predicted', resolveBy: '2026-08-30' })).toEqual([]);
  });

  test('accepts a bare forecast — resolveBy is optional', () => {
    expect(validate({ channel: 'confidence', text: 'x', session: 's',
                      confidence: 'predicted' })).toEqual([]);
  });

  test('rejects resolveBy on every non-predicted ground, naming the rule', () => {
    for (const confidence of ['verified', 'recalled', 'inferred', 'guessed'] as const) {
      const problems = validate({ channel: 'confidence', text: 'x', session: 's',
                                  confidence, resolveBy: '2026-08-30' });
      expect(problems.some(p => p.includes("confidence 'predicted'"))).toBe(true);
    }
  });

  test('rejects resolveBy with no confidence at all', () => {
    const problems = validate({ channel: 'signature', text: 'x', session: 's', resolveBy: '2026-08-30' });
    expect(problems.some(p => p.includes("confidence 'predicted'"))).toBe(true);
  });

  test('rejects a resolveBy that is not an ISO local date — a wakeup cannot grep prose', () => {
    for (const bad of ['soon', 'august 30', '2026-8-3', '2026-08-30T12:00:00Z']) {
      const problems = validate({ channel: 'confidence', text: 'x', session: 's',
                                  confidence: 'predicted', resolveBy: bad });
      expect(problems.some(p => p.includes('ISO-8601 local date'))).toBe(true);
    }
  });

  test('accepts an outcome pointing back at a forecast via correctsId', () => {
    expect(validate({ channel: 'confidence', text: 'merged clean', session: 's',
                      correctsId: 1, outcome: 'hit' })).toEqual([]);
  });

  test('rejects an outcome without a correctsId — it resolves nothing', () => {
    const problems = validate({ channel: 'confidence', text: 'x', session: 's', outcome: 'miss' });
    expect(problems.some(p => p.includes('correctsId'))).toBe(true);
  });

  test('rejects an outcome outside the vocabulary', () => {
    const problems = validate({ channel: 'confidence', text: 'x', session: 's',
                                correctsId: 1, outcome: 'won' as never });
    expect(problems.some(p => p.includes('outcome'))).toBe(true);
  });

  test('accepts every silence kind on every channel — it is a qualifier, not a channel', () => {
    for (const channel of CHANNELS) {
      for (const silence of SILENCE_KINDS) {
        expect(validate({ channel, text: 'x', session: 's', silence })).toEqual([]);
      }
    }
  });

  test('rejects a silence outside the vocabulary', () => {
    const problems = validate({ channel: 'signature', text: 'x', session: 's', silence: 'quiet' as never });
    expect(problems.some(p => p.includes('silence'))).toBe(true);
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

  test('carries confidence, divergence_kind, silence, and outcome, so recent forecasts are readable', () => withStore(s => {
    recordEntry(s, { channel: 'confidence', text: 'lands by friday', session: 's1',
                     confidence: 'predicted', resolveBy: '2026-08-30' }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'landed', session: 's1',
                     correctsId: 1, outcome: 'hit' }, VERSION);
    recordEntry(s, { channel: 'signature', text: 'still; nothing notable', session: 's1',
                     silence: 'empty' }, VERSION);
    const [forecast, resolution, sig] = recentEntries(s, 3);
    expect(forecast?.['confidence']).toBe('predicted');
    expect(resolution?.['outcome']).toBe('hit');
    expect(sig?.['silence']).toBe('empty');
  }));

});

describe('forecastOutcomes', () => {

  test('is empty with no resolutions', () => withStore(s => {
    recordEntry(s, { channel: 'confidence', text: 'open forecast', session: 's1',
                     confidence: 'predicted' }, VERSION);
    expect(forecastOutcomes(s)).toEqual([]);
  }));

  test('returns resolved outcomes in resolution order', () => withStore(s => {
    const a = recordEntry(s, { channel: 'confidence', text: 'f1', session: 's1', confidence: 'predicted' }, VERSION);
    const b = recordEntry(s, { channel: 'confidence', text: 'f2', session: 's1', confidence: 'predicted' }, VERSION);
    const c = recordEntry(s, { channel: 'confidence', text: 'f3', session: 's1', confidence: 'predicted' }, VERSION);
    // Resolved out of forecast order, deliberately: resolution order is what counts.
    recordEntry(s, { channel: 'confidence', text: 'r2', session: 's1', correctsId: b.id, outcome: 'miss' }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'r1', session: 's1', correctsId: a.id, outcome: 'hit'  }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'r3', session: 's1', correctsId: c.id, outcome: 'void' }, VERSION);
    expect(forecastOutcomes(s)).toEqual(['miss', 'hit', 'void']);
  }));

  test('ignores an outcome whose target is not a forecast', () => withStore(s => {
    const plain = recordEntry(s, { channel: 'confidence', text: 'checked', session: 's1',
                                   confidence: 'verified' }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'stray', session: 's1',
                     correctsId: plain.id, outcome: 'hit' }, VERSION);
    expect(forecastOutcomes(s)).toEqual([]);
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

  test('a retitled checklist keeps one unbroken series — the split #27 forbids', () => withStore(s => {
    recordEntry(s, { channel: 'checklist', text: 'a', session: 's1',
                     seriesKey: 'atlas', title: 'Project Atlas', percent: 25 }, VERSION);
    recordEntry(s, { channel: 'checklist', text: 'b', session: 's1',
                     seriesKey: 'atlas', title: 'Project Atlas — phase 2', percent: 60 }, VERSION);
    recordEntry(s, { channel: 'checklist', text: 'c', session: 's1',
                     seriesKey: 'atlas', title: 'Project Altas — phase 2', percent: 80 }, VERSION);
    expect(seriesPercents(s, 'atlas')).toEqual([25, 60, 80]);
  }));

});

describe('localHour', () => {

  test.each([
    ['9:14 am PDT', 9], ['12:03 am PDT', 0], ['12:00 pm CET', 12],
    ['1:00 pm PDT', 13], ['11:59 pm UTC', 23],
  ] as const)("recovers the hour out of '%s'", (rendered, hour) => {
    expect(localHour(rendered)).toBe(hour);
  });

  test.each(['whenever', '', '25:00 am PDT', '0:30 am PDT', 'about 9ish'])(
    "returns null for unrecoverable '%s' rather than guessing", (rendered) => {
      expect(localHour(rendered)).toBeNull();
    });

});

describe('isoWeekKey', () => {

  test('labels a mid-year instant with its ISO week', () => {
    expect(isoWeekKey(new Date('2026-08-27T21:00:00Z'))).toBe('2026-W35');
  });

  test('a new-year instant can belong to the previous ISO week-year', () => {
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });

  test('Monday starts the week: Sunday and the following Monday differ', () => {
    expect(isoWeekKey(new Date('2026-08-23T12:00:00Z')))     // a Sunday
      .not.toBe(isoWeekKey(new Date('2026-08-24T12:00:00Z')));  // the Monday after
  });

});

const WHEN = new Date('2026-08-27T21:15:04.000Z');

describe('signatureHistory', () => {

  test('returns signature rows only, ascending, with the panel shape', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'a', session: 's1', stem: 'flow', delta: 'up', project: 'atlas' }, VERSION, WHEN);
    recordEntry(s, { channel: 'need',      text: 'not a signature', session: 's1' }, VERSION, WHEN);
    recordEntry(s, { channel: 'signature', text: 'b', session: 's1', uncertain: true }, VERSION, WHEN);

    const rows = signatureHistory(s, '2026-08-01T00:00:00.000Z');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.stem).toBe('flow');
    expect(rows[0]?.delta).toBe('up');
    expect(rows[0]?.project).toBe('atlas');
    expect(rows[0]?.uncertain).toBe(false);
    expect(rows[1]?.stem).toBeNull();
    expect(rows[1]?.uncertain).toBe(true);
    expect((rows[0]?.id ?? 0) < (rows[1]?.id ?? 0)).toBe(true);
  }));

  test('the recovered local hour matches the stored local rendering', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'a', session: 's1' }, VERSION, WHEN);
    const [row] = signatureHistory(s, '2026-08-01T00:00:00.000Z');
    // The stored ts_local depends on the test machine's zone; the recovered hour
    // must agree with re-parsing that same stored text.
    expect(row?.hourLocal).toBe(localHour(String(
      s.db.prepare('SELECT ts_local FROM entries LIMIT 1').get()?.['ts_local'])));
    expect(row?.hourLocal).toBeGreaterThanOrEqual(0);
    expect(row?.hourLocal).toBeLessThanOrEqual(23);
  }));

  test('rows before the window are excluded', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'old', session: 's1' }, VERSION, new Date('2026-01-01T00:00:00Z'));
    recordEntry(s, { channel: 'signature', text: 'new', session: 's1' }, VERSION, WHEN);
    expect(signatureHistory(s, '2026-08-01T00:00:00.000Z')).toHaveLength(1);
  }));

});

describe('needWeekly', () => {

  test('counts distinct prompts as turns and need rows as needs, per ISO week', () => withStore(s => {
    // Two signatures in one prompt: one turn, not two.
    recordEntry(s, { channel: 'signature', text: 'open',  session: 's1', promptId: 'p1' }, VERSION, WHEN);
    recordEntry(s, { channel: 'signature', text: 'close', session: 's1', promptId: 'p1' }, VERSION, WHEN);
    recordEntry(s, { channel: 'signature', text: 'open',  session: 's1', promptId: 'p2' }, VERSION, WHEN);
    recordEntry(s, { channel: 'need',      text: 'merge?', session: 's1', promptId: 'p1' }, VERSION, WHEN);

    expect(needWeekly(s, '2026-08-01T00:00:00.000Z')).toEqual([
      { week: '2026-W35', turns: 2, needs: 1 },
    ]);
  }));

  test('weeks sort ascending and needs without signatures still form a week', () => withStore(s => {
    recordEntry(s, { channel: 'need', text: 'early', session: 's1' }, VERSION, new Date('2026-08-10T12:00:00Z'));
    recordEntry(s, { channel: 'signature', text: 'late', session: 's1', promptId: 'p9' }, VERSION, WHEN);

    expect(needWeekly(s, '2026-08-01T00:00:00.000Z')).toEqual([
      { week: '2026-W33', turns: 0, needs: 1 },
      { week: '2026-W35', turns: 1, needs: 0 },
    ]);
  }));

  test('an empty store yields no weeks rather than zero-filled ones', () => withStore(s => {
    expect(needWeekly(s, '2026-08-01T00:00:00.000Z')).toEqual([]);
  }));

});

describe('checklistSeriesTop', () => {

  test('returns the busiest series first, each with its in-range history in order', () => withStore(s => {
    for (const percent of [10, 20, 30]) {
      recordEntry(s, { channel: 'checklist', text: 'x', session: 's1', seriesKey: 'busy', percent }, VERSION, WHEN);
    }
    recordEntry(s, { channel: 'checklist', text: 'x', session: 's1', seriesKey: 'quiet', percent: 99 }, VERSION, WHEN);

    expect(checklistSeriesTop(s, '2026-08-01T00:00:00.000Z', 5)).toEqual([
      { seriesKey: 'busy',  percents: [10, 20, 30] },
      { seriesKey: 'quiet', percents: [99] },
    ]);
  }));

  test('honours n, dropping the quietest series', () => withStore(s => {
    for (const percent of [10, 20]) {
      recordEntry(s, { channel: 'checklist', text: 'x', session: 's1', seriesKey: 'busy', percent }, VERSION, WHEN);
    }
    recordEntry(s, { channel: 'checklist', text: 'x', session: 's1', seriesKey: 'quiet', percent: 99 }, VERSION, WHEN);
    expect(checklistSeriesTop(s, '2026-08-01T00:00:00.000Z', 1).map(row => row.seriesKey)).toEqual(['busy']);
  }));

  test('out-of-range snapshots count for neither ranking nor history', () => withStore(s => {
    recordEntry(s, { channel: 'checklist', text: 'x', session: 's1', seriesKey: 'a', percent: 10 }, VERSION, new Date('2026-01-01T00:00:00Z'));
    recordEntry(s, { channel: 'checklist', text: 'x', session: 's1', seriesKey: 'a', percent: 50 }, VERSION, WHEN);
    expect(checklistSeriesTop(s, '2026-08-01T00:00:00.000Z', 5)).toEqual([
      { seriesKey: 'a', percents: [50] },
    ]);
  }));

});
