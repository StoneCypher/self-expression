import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import {
  recordEntry, validate, hasClosingSignature, previousSignature, recentEntries,
  recentChecklists, seriesPercents, forecastOutcomes, anchorProblems, storedQuote,
  anchoredEntries, correctionProblems, effectiveCorrectionKind, standingOf, register,
  localHour, isoWeekKey, signatureHistory, needWeekly, checklistSeriesTop, retractedAmong,
} from '../channels/entries.js';
import { anchorHash, ANCHOR_QUOTE_MAX } from '../channels/anchors.js';
import { writeConfig } from '../channels/store.js';
import { CHANNELS, SILENCE_KINDS, ANCHOR_KINDS, CORRECTION_KINDS } from '../channels/vocabulary.js';

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
                      correctsId: 1, correctsKind: 'resolves', outcome: 'hit' })).toEqual([]);
  });

  test('rejects an outcome without a correctsId — it resolves nothing', () => {
    const problems = validate({ channel: 'confidence', text: 'x', session: 's', outcome: 'miss' });
    expect(problems.some(p => p.includes('correctsId'))).toBe(true);
  });

  test('rejects an outcome outside the vocabulary', () => {
    const problems = validate({ channel: 'confidence', text: 'x', session: 's',
                                correctsId: 1, correctsKind: 'resolves', outcome: 'won' as never });
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

  test('the anchor rules reach validate, not only anchorProblems', () => {
    expect(validate({ channel: 'dissent', text: 'x', session: 's', anchorQuote: 'y' }).length)
      .toBeGreaterThan(0);
    expect(validate({ channel: 'dissent', text: 'x', session: 's',
                      anchorKind: 'entry', anchorTarget: '1' })).toEqual([]);
  });

});

describe('anchorProblems — the #18 cross-field matrix', () => {

  /** An otherwise-valid entry, so only the anchor rules can object. */
  const base = { channel: 'dissent', text: 'x', session: 's' } as const;

  test('an unanchored entry is the normal case and raises nothing', () => {
    expect(anchorProblems({ ...base })).toEqual([]);
  });

  test('any qualifier without a kind is rejected, and every offender is named at once', () => {
    for (const field of ['anchorTarget', 'anchorSpan', 'anchorQuote']) {
      const problems = anchorProblems({ ...base, [field]: 'v' });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(field);
    }
    expect(anchorProblems({ ...base, anchorTarget: 'a', anchorSpan: 'L1', anchorQuote: 'q' }))
      .toHaveLength(3);
  });

  test('a kind without a target names what a target would be', () => {
    const problems = anchorProblems({ ...base, anchorKind: 'file' });
    expect(problems[0]).toContain('requires an anchorTarget');
    expect(anchorProblems({ ...base, anchorKind: 'file', anchorTarget: '   ' })).toHaveLength(1);
  });

  test('prompt and reply demand a quote; file, checklist, and entry do not', () => {
    for (const kind of ['prompt', 'reply'] as const) {
      expect(anchorProblems({ ...base, anchorKind: kind, anchorTarget: 'p-1' })[0])
        .toContain('requires an anchorQuote');
      expect(anchorProblems({ ...base, anchorKind: kind, anchorTarget: 'p-1', anchorQuote: 'q' }))
        .toEqual([]);
    }
    expect(anchorProblems({ ...base, anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1' }))
      .toEqual([]);
    expect(anchorProblems({ ...base, anchorKind: 'entry', anchorTarget: '7' })).toEqual([]);
    expect(anchorProblems({ ...base, anchorKind: 'checklist', anchorTarget: 'k' })).toEqual([]);
  });

  test('the span grammar is enforced per kind', () => {
    expect(anchorProblems({ ...base, anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: '#2' }))
      .toHaveLength(1);
    expect(anchorProblems({ ...base, anchorKind: 'prompt', anchorTarget: 'p', anchorQuote: 'q', anchorSpan: 'L1' }))
      .toHaveLength(1);
    expect(anchorProblems({ ...base, anchorKind: 'entry', anchorTarget: '1', anchorSpan: '#1' }))
      .toHaveLength(1);
  });

  test('a blank quote and an over-long quote are both rejected, by their normalized length', () => {
    expect(anchorProblems({ ...base, anchorKind: 'file', anchorTarget: 'a.ts', anchorQuote: '  \n ' })[0])
      .toContain('blank');
    const long = anchorProblems({ ...base, anchorKind: 'file', anchorTarget: 'a.ts',
                                  anchorQuote: 'q'.repeat(ANCHOR_QUOTE_MAX + 1) });
    expect(long[0]).toContain(String(ANCHOR_QUOTE_MAX));
    // Collapsing whitespace is what decides it: this is over the cap raw, under it normalized.
    expect(anchorProblems({ ...base, anchorKind: 'file', anchorTarget: 'a.ts',
                            anchorQuote: `${'q'.repeat(ANCHOR_QUOTE_MAX - 1)}${' '.repeat(20)}` }))
      .toEqual([]);
  });

  test('an unknown kind is left to the vocabulary check, not double-reported', () => {
    expect(anchorProblems({ ...base, anchorKind: 'diagram' as never })).toEqual([]);
    expect(validate({ ...base, anchorKind: 'diagram' as never }).some(p => p.includes('anchorKind')))
      .toBe(true);
  });

  test('every kind accepts a well-formed anchor — the matrix has no unreachable row', () => {
    for (const kind of ANCHOR_KINDS) {
      expect(anchorProblems({ ...base, anchorKind: kind, anchorTarget: 't', anchorQuote: 'q' }))
        .toEqual([]);
    }
  });

});

describe('storedQuote — write-time redaction, hash surviving it', () => {

  test('no quote means no hash — there is nothing to fingerprint', () => {
    expect(storedQuote('file', undefined, true)).toEqual({ quote: null, hash: null });
  });

  test('the stored quote is the normalized form, and the hash is of that', () => {
    const stored = storedQuote('file', '  readConfig(store,\n key)  ', true);
    expect(stored.quote).toBe('readConfig(store, key)');
    expect(stored.hash).toBe(anchorHash('readConfig(store, key)'));
  });

  test('suppression drops a prompt quote and keeps its hash — that is the whole design', () => {
    const stored = storedQuote('prompt', 'ship it when ready', false);
    expect(stored.quote).toBeNull();
    expect(stored.hash).toBe(anchorHash('ship it when ready'));
  });

  test('suppression touches only prompt quotes; every other kind is the repo’s or the model’s own text', () => {
    for (const kind of ['file', 'reply', 'checklist', 'entry'] as const) {
      expect(storedQuote(kind, 'not the human', false).quote).toBe('not the human');
    }
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

  test('an anchored entry stores its columns, the quote normalized and the hash derived', () => withStore(s => {
    recordEntry(s, { channel: 'dissent', text: 'null for unset and for empty', session: 's1',
                     anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts',
                     anchorSpan: 'L141', anchorQuote: '  readConfig(store,\n  key) ' }, VERSION);
    const row = s.db.prepare(
      'SELECT anchor_kind, anchor_target, anchor_span, anchor_quote, anchor_hash FROM entries').get();
    expect(row.anchor_kind).toBe('file');
    expect(row.anchor_target).toBe('src/ts/channels/store.ts');
    expect(row.anchor_span).toBe('L141');
    expect(row.anchor_quote).toBe('readConfig(store, key)');
    expect(row.anchor_hash).toBe(anchorHash('readConfig(store, key)'));
  }));

  test('an anchored dissent is still a dissent — one row, its own channel', () => withStore(s => {
    recordEntry(s, { channel: 'dissent', text: 'about that', session: 's1',
                     anchorKind: 'entry', anchorTarget: '1' }, VERSION);
    const row = s.db.prepare('SELECT channel, corrects_id FROM entries').get();
    expect(row.channel).toBe('dissent');
    // Anchoring means "this is about that"; corrects_id means "this replaces that".
    expect(row.corrects_id).toBeNull();
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(1);
  }));

  test('privacy.store_quotes = false drops the prompt quote at write, and keeps the hash', () => withStore(s => {
    writeConfig(s, 'privacy.store_quotes', false);
    recordEntry(s, { channel: 'dissent', text: 'reads three ways', session: 's1',
                     anchorKind: 'prompt', anchorTarget: 'p-7',
                     anchorQuote: 'ship it when ready' }, VERSION);
    const row = s.db.prepare('SELECT anchor_quote, anchor_hash FROM entries').get();
    expect(row.anchor_quote).toBeNull();
    expect(row.anchor_hash).toBe(anchorHash('ship it when ready'));
    // Not captured-then-hidden: the words are nowhere in the row at all.
    const all = JSON.stringify(s.db.prepare('SELECT * FROM entries').get());
    expect(all).not.toContain('ship it when ready');
  }));

  test('privacy.store_quotes = false leaves file quotes untouched — they are not the human’s words', () => withStore(s => {
    writeConfig(s, 'privacy.store_quotes', false);
    recordEntry(s, { channel: 'dissent', text: 'x', session: 's1', anchorKind: 'file',
                     anchorTarget: 'a.ts', anchorSpan: 'L1', anchorQuote: 'const a = 1;' }, VERSION);
    expect(s.db.prepare('SELECT anchor_quote FROM entries').get().anchor_quote).toBe('const a = 1;');
  }));

  test('a rejected anchor writes nothing at all', () => withStore(s => {
    expect(() => recordEntry(s, { channel: 'dissent', text: 'x', session: 's1',
                                  anchorKind: 'prompt', anchorTarget: 'p-1' }, VERSION))
      .toThrow(/anchorQuote/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(0);
  }));

});

describe('anchoredEntries', () => {

  test('returns every note on one target, oldest first, and nothing from another', () => withStore(s => {
    for (const text of ['first', 'second']) {
      recordEntry(s, { channel: 'dissent', text, session: 's1', anchorKind: 'file',
                       anchorTarget: 'a.ts', anchorSpan: 'L1', anchorQuote: text }, VERSION);
    }
    recordEntry(s, { channel: 'dissent', text: 'elsewhere', session: 's1', anchorKind: 'file',
                     anchorTarget: 'b.ts', anchorSpan: 'L1', anchorQuote: 'other' }, VERSION);

    const rows = anchoredEntries(s, 'file', 'a.ts');
    expect(rows.map(r => r['text'])).toEqual(['first', 'second']);
    expect(rows[0]?.['anchor_hash']).toBe(anchorHash('first'));
  }));

  test('a target with nothing said about it is an empty array, not an error', () => withStore(s => {
    expect(anchoredEntries(s, 'file', 'never-mentioned.ts')).toEqual([]);
  }));

  test('the kind is part of the address: the same target under two kinds does not merge', () => withStore(s => {
    recordEntry(s, { channel: 'dissent', text: 'a', session: 's1', anchorKind: 'prompt',
                     anchorTarget: 'p-1', anchorQuote: 'q' }, VERSION);
    recordEntry(s, { channel: 'dissent', text: 'b', session: 's1', anchorKind: 'reply',
                     anchorTarget: 'p-1', anchorQuote: 'q' }, VERSION);
    expect(anchoredEntries(s, 'prompt', 'p-1')).toHaveLength(1);
    expect(anchoredEntries(s, 'reply',  'p-1')).toHaveLength(1);
  }));

});

describe('hasClosingSignature', () => {

  test('is false when the turn has not signed off', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'open', session: 's1',
                     promptId: 'p1', position: 'open' }, VERSION);
    expect(hasClosingSignature(s, 's1', 'p1')).toBe(false);
  }));

  test('is true once a close lands for that turn', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'done', session: 's1',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(hasClosingSignature(s, 's1', 'p1')).toBe(true);
  }));

  test('a mid signature does not satisfy the gate — a lurch is not an ending', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'lurch', session: 's1',
                     promptId: 'p1', position: 'mid' }, VERSION);
    expect(hasClosingSignature(s, 's1', 'p1')).toBe(false);
  }));

  test("another turn's close does not satisfy this one — the bug the time window had", () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'prev', session: 's1',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(hasClosingSignature(s, 's1', 'p2')).toBe(false);
  }));

  test('the same prompt id in another session does not satisfy this one — identity is the pair', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'theirs', session: 's2',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(hasClosingSignature(s, 's1', 'p1')).toBe(false);
    expect(hasClosingSignature(s, 's2', 'p1')).toBe(true);
  }));

  test('a non-signature channel does not satisfy the gate', () => withStore(s => {
    recordEntry(s, { channel: 'need', text: 'ask', session: 's1', promptId: 'p1' }, VERSION);
    expect(hasClosingSignature(s, 's1', 'p1')).toBe(false);
  }));

  test('an absent session narrows nothing — no row can carry the NULL it would match', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'done', session: 's1',
                     promptId: 'p1', position: 'close' }, VERSION);
    expect(hasClosingSignature(s, undefined, 'p1')).toBe(true);
    expect(hasClosingSignature(s, '',        'p1')).toBe(true);
    expect(hasClosingSignature(s, undefined, 'p2')).toBe(false);
  }));

  test('a retracted close still counts — the turn signed, and taking the words back is not un-signing', () => withStore(s => {
    const close = recordEntry(s, { channel: 'signature', text: 'done', session: 's1',
                                   promptId: 'p1', position: 'close' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'that was not the reading', session: 's1',
                     promptId: 'p1', correctsId: close, correctsKind: 'retracts' }, VERSION);
    expect(hasClosingSignature(s, 's1', 'p1')).toBe(true);
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
                     correctsId: 1, correctsKind: 'resolves', outcome: 'hit' }, VERSION);
    recordEntry(s, { channel: 'signature', text: 'still; nothing notable', session: 's1',
                     silence: 'empty' }, VERSION);
    const [forecast, resolution, sig] = recentEntries(s, 3);
    expect(forecast?.['confidence']).toBe('predicted');
    expect(resolution?.['outcome']).toBe('hit');
    expect(sig?.['silence']).toBe('empty');
  }));

  test('carries the anchor columns, so "what did I recently annotate" needs no raw SQL', () => withStore(s => {
    recordEntry(s, { channel: 'dissent', text: 'reads three ways', session: 's1',
                     anchorKind: 'prompt', anchorTarget: 'p-7',
                     anchorQuote: 'ship it when ready' }, VERSION);
    const [row] = recentEntries(s, 1);
    expect(row?.['anchor_kind']).toBe('prompt');
    expect(row?.['anchor_target']).toBe('p-7');
    expect(row?.['anchor_quote']).toBe('ship it when ready');
    expect(row?.['anchor_hash']).toBe(anchorHash('ship it when ready'));
    // The id rides along too, so a follow-up can point back with correctsId.
    expect(row?.['id']).toBe(1);
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
    recordEntry(s, { channel: 'confidence', text: 'r2', session: 's1', correctsId: b.id, correctsKind: 'resolves', outcome: 'miss' }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'r1', session: 's1', correctsId: a.id, correctsKind: 'resolves', outcome: 'hit'  }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'r3', session: 's1', correctsId: c.id, correctsKind: 'resolves', outcome: 'void' }, VERSION);
    expect(forecastOutcomes(s)).toEqual(['miss', 'hit', 'void']);
  }));

  test('ignores an outcome whose target is not a forecast', () => withStore(s => {
    const plain = recordEntry(s, { channel: 'confidence', text: 'checked', session: 's1',
                                   confidence: 'verified' }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'stray', session: 's1',
                     correctsId: plain.id, correctsKind: 'resolves', outcome: 'hit' }, VERSION);
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

/** A window lower bound comfortably before {@link WHEN}, for the panel readers. */
const SINCE = '2026-08-01T00:00:00.000Z';

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

// ── #16: retraction ─────────────────────────────────────────────────────────────────

/** Record an original claim and take it back; returns both ids. */
function retracted(s: Store, kind: 'retracts' | 'amends' = 'retracts'): { original: number; strike: number } {
  const original = recordEntry(s, { channel: 'checklist', text: 'icons sort by status', session: 's1',
                                    seriesKey: 'atlas', percent: 31 }, VERSION).id,
        strike   = recordEntry(s, { channel: 'divergence', text: 'sort is rank then bucket', session: 's1',
                                    divergenceKind: 'stale', correctsId: original, correctsKind: kind,
                                    verbatim: 'icons sort by status first, then alphabetically' }, VERSION).id;
  return { original, strike };
}

describe('correctionProblems', () => {

  test('accepts a fully stated retraction', () => {
    expect(correctionProblems({ channel: 'divergence', text: 'x', session: 's',
                                correctsId: 3, correctsKind: 'retracts',
                                verbatim: 'the wrong words' })).toEqual([]);
  });

  test('rejects a kind with no link — a relationship to nothing', () => {
    const problems = correctionProblems({ channel: 'divergence', text: 'x', session: 's',
                                          correctsKind: 'retracts' });
    expect(problems.some(p => p.includes('requires a correctsId'))).toBe(true);
  });

  test('rejects a link with no kind — the ambiguity the column exists to end', () => {
    const problems = correctionProblems({ channel: 'divergence', text: 'x', session: 's', correctsId: 3 });
    expect(problems.some(p => p.includes('requires a correctsKind'))).toBe(true);
    for (const kind of CORRECTION_KINDS) {
      expect(problems.join(' ')).toContain(`'${kind}'`);
    }
  });

  test('an outcome may only ride a resolves link, so wrongness cannot be filed as bookkeeping', () => {
    for (const kind of ['retracts', 'amends'] as const) {
      const problems = correctionProblems({ channel: 'confidence', text: 'x', session: 's',
                                            correctsId: 3, correctsKind: kind, outcome: 'hit' });
      expect(problems.some(p => p.includes("correctsKind 'resolves'"))).toBe(true);
    }
    expect(correctionProblems({ channel: 'confidence', text: 'x', session: 's',
                                correctsId: 3, correctsKind: 'resolves', outcome: 'hit' })).toEqual([]);
  });

  test('verbatim rides retracts and amends, and a prose-only divergence, and nothing else', () => {
    for (const kind of ['retracts', 'amends'] as const) {
      expect(correctionProblems({ channel: 'divergence', text: 'x', session: 's',
                                  correctsId: 3, correctsKind: kind, verbatim: 'q' })).toEqual([]);
    }
    // Prose-only: the claim was never a row, so the quote is the only anchor.
    expect(correctionProblems({ channel: 'divergence', text: 'x', session: 's', verbatim: 'q' })).toEqual([]);
    // A resolution quotes nothing: the forecast was not wrong.
    expect(correctionProblems({ channel: 'confidence', text: 'x', session: 's',
                                correctsId: 3, correctsKind: 'resolves', verbatim: 'q' })
      .some(p => p.includes('verbatim is only valid'))).toBe(true);
    // A quote with no link on some other channel anchors nothing at all.
    expect(correctionProblems({ channel: 'signature', text: 'x', session: 's', verbatim: 'q' })
      .some(p => p.includes('verbatim is only valid'))).toBe(true);
  });

  test('a blank quote is refused — an empty anchor is worse than none', () => {
    expect(correctionProblems({ channel: 'divergence', text: 'x', session: 's',
                                correctsId: 3, correctsKind: 'retracts', verbatim: '   ' })
      .some(p => p.includes('must not be blank'))).toBe(true);
  });

  test('validate carries the correction rules, so recordEntry enforces them', () => withStore(s => {
    expect(() => recordEntry(s, { channel: 'divergence', text: 'x', session: 's1', correctsId: 1 }, VERSION))
      .toThrow(/correctsKind/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(0);
  }));

});

describe('effectiveCorrectionKind — the legacy read rule', () => {

  test('a stated kind wins', () => {
    for (const kind of CORRECTION_KINDS) {
      expect(effectiveCorrectionKind(171, kind, null)).toBe(kind);
    }
  });

  test('a legacy kind-less link reads as retracts — what the column promised since v1', () => {
    expect(effectiveCorrectionKind(171, null, null)).toBe('retracts');
  });

  test('…unless it carries an outcome, which makes it unmistakably a resolution', () => {
    expect(effectiveCorrectionKind(171, null, 'hit')).toBe('resolves');
    expect(effectiveCorrectionKind(171, null, 'miss')).toBe('resolves');
  });

  test('no link means no kind at all', () => {
    expect(effectiveCorrectionKind(null, null, null)).toBeNull();
    expect(effectiveCorrectionKind(null, 'retracts', null)).toBeNull();
  });

  test('a stored value outside the vocabulary falls back to the read rule, never crashes', () => {
    expect(effectiveCorrectionKind(171, 'supersedes', null)).toBe('retracts');
  });

});

describe('standingOf', () => {

  test('an unstruck entry stands', () => withStore(s => {
    const id = recordEntry(s, { channel: 'idea', text: 'x', session: 's1' }, VERSION).id;
    expect(standingOf(s, [id])).toEqual([{ id, status: 'stands', by: null }]);
  }));

  test('an empty request costs no query and returns nothing', () => withStore(s => {
    expect(standingOf(s, [])).toEqual([]);
  }));

  test('a retraction marks the original — and writes nothing onto it', () => withStore(s => {

    const original = recordEntry(s, { channel: 'checklist', text: 'icons sort by status',
                                      session: 's1', seriesKey: 'atlas', percent: 31 }, VERSION).id;

    const before = JSON.parse(JSON.stringify(
      s.db.prepare('SELECT * FROM entries WHERE id = ?').get(original))) as unknown;

    const strike = recordEntry(s, { channel: 'divergence', text: 'sort is rank then bucket',
                                    session: 's1', correctsId: original, correctsKind: 'retracts',
                                    verbatim: 'icons sort by status first' }, VERSION).id;

    expect(standingOf(s, [original])).toEqual([{ id: original, status: 'retracted', by: strike }]);

    // The load-bearing half: the original row is byte-for-byte what it was.
    const after = JSON.parse(JSON.stringify(
      s.db.prepare('SELECT * FROM entries WHERE id = ?').get(original))) as unknown;
    expect(after).toEqual(before);

  }));

  test('an amendment marks the original as amended, not retracted', () => withStore(s => {
    const { original, strike } = retracted(s, 'amends');
    expect(standingOf(s, [original])).toEqual([{ id: original, status: 'amended', by: strike }]);
  }));

  test('retracts outranks amends when both strike the same row', () => withStore(s => {
    const original = recordEntry(s, { channel: 'checklist', text: 'x', session: 's1' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'detail', session: 's1',
                     correctsId: original, correctsKind: 'amends' }, VERSION);
    const hard = recordEntry(s, { channel: 'divergence', text: 'all wrong', session: 's1',
                                  correctsId: original, correctsKind: 'retracts' }, VERSION).id;
    expect(standingOf(s, [original])).toEqual([{ id: original, status: 'retracted', by: hard }]);
  }));

  test('retracting the retraction restores the original, by computation', () => withStore(s => {
    const { original, strike } = retracted(s);
    const undo = recordEntry(s, { channel: 'divergence', text: 'I was wrong to take that back',
                                  session: 's1', correctsId: strike, correctsKind: 'retracts' }, VERSION).id;
    expect(standingOf(s, [original, strike])).toEqual([
      { id: original, status: 'stands',    by: null },
      { id: strike,   status: 'retracted', by: undo },
    ]);
  }));

  test('and un-un-retracting takes it back again — the chain resolves however deep it goes', () => withStore(s => {
    const { original, strike } = retracted(s);
    const undo = recordEntry(s, { channel: 'divergence', text: 'no, it stood', session: 's1',
                                  correctsId: strike, correctsKind: 'retracts' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'no, it really was wrong', session: 's1',
                     correctsId: undo, correctsKind: 'retracts' }, VERSION);
    expect(standingOf(s, [original])).toEqual([{ id: original, status: 'retracted', by: strike }]);
  }));

  test('an amended strike still strikes — amends means the target stood', () => withStore(s => {
    const { original, strike } = retracted(s);
    recordEntry(s, { channel: 'divergence', text: 'a detail of the retraction', session: 's1',
                     correctsId: strike, correctsKind: 'amends' }, VERSION);
    expect(standingOf(s, [original])).toEqual([{ id: original, status: 'retracted', by: strike }]);
  }));

  test('a resolution never marks its forecast, however it turned out', () => withStore(s => {
    for (const outcome of ['hit', 'miss', 'void'] as const) {
      const forecast = recordEntry(s, { channel: 'confidence', text: 'x', session: 's1',
                                        confidence: 'predicted' }, VERSION).id;
      recordEntry(s, { channel: 'confidence', text: 'resolved', session: 's1',
                       correctsId: forecast, correctsKind: 'resolves', outcome }, VERSION);
      expect(standingOf(s, [forecast])).toEqual([{ id: forecast, status: 'stands', by: null }]);
    }
  }));

  test('reports the newest standing strike as `by`', () => withStore(s => {
    const original = recordEntry(s, { channel: 'checklist', text: 'x', session: 's1' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'first', session: 's1',
                     correctsId: original, correctsKind: 'retracts' }, VERSION);
    const later = recordEntry(s, { channel: 'divergence', text: 'again', session: 's1',
                                   correctsId: original, correctsKind: 'retracts' }, VERSION).id;
    expect(standingOf(s, [original])[0]?.by).toBe(later);
  }));

  test('answers a batch in one call, and an unknown id simply stands', () => withStore(s => {
    const { original } = retracted(s);
    expect(standingOf(s, [original, 9999]).map(x => x.status)).toEqual(['retracted', 'stands']);
  }));

});

describe('register', () => {

  test('is empty when nothing has been taken back', () => withStore(s => {
    recordEntry(s, { channel: 'idea', text: 'x', session: 's1' }, VERSION);
    expect(register(s)).toEqual([]);
  }));

  test('presents a row-backed retraction before → after', () => withStore(s => {
    const { original, strike } = retracted(s);
    const [entry] = register(s);
    expect(entry?.kind).toBe('retracts');
    expect(entry?.original?.id).toBe(original);
    expect(entry?.original?.channel).toBe('checklist');
    expect(entry?.original?.text).toBe('icons sort by status');
    expect(entry?.verbatim).toBe('icons sort by status first, then alphabetically');
    expect(entry?.replacement.id).toBe(strike);
    expect(entry?.replacement.text).toBe('sort is rank then bucket');
  }));

  test('presents a prose-only retraction with a null original and the quote as the anchor', () => withStore(s => {
    const strike = recordEntry(s, { channel: 'divergence', text: 'it runs markdownlint', session: 's1',
                                    divergenceKind: 'stale',
                                    verbatim: 'the build skips lint on spec-only PRs' }, VERSION).id;
    const [entry] = register(s);
    expect(entry?.original).toBeNull();
    expect(entry?.kind).toBe('retracts');
    expect(entry?.verbatim).toBe('the build skips lint on spec-only PRs');
    expect(entry?.replacement.id).toBe(strike);
  }));

  test('carries amendments too, marked as amendments', () => withStore(s => {
    retracted(s, 'amends');
    expect(register(s).map(row => row.kind)).toEqual(['amends']);
  }));

  test('a retracted strike leaves the register but stays in the table', () => withStore(s => {
    const { strike } = retracted(s);
    recordEntry(s, { channel: 'divergence', text: 'I was wrong to take that back', session: 's1',
                     correctsId: strike, correctsKind: 'retracts' }, VERSION);
    // The withdrawn retraction is gone from the *current* state…
    expect(register(s).map(row => row.replacement.id)).not.toContain(strike);
    // …and the whole history of the taking-back is still on the record.
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get()?.['n']).toBe(3);
  }));

  test('never lists a forecast resolution as a taken-back claim', () => withStore(s => {
    const forecast = recordEntry(s, { channel: 'confidence', text: 'lands friday', session: 's1',
                                      confidence: 'predicted' }, VERSION).id;
    recordEntry(s, { channel: 'confidence', text: 'it landed', session: 's1',
                     correctsId: forecast, correctsKind: 'resolves', outcome: 'hit' }, VERSION);
    expect(register(s)).toEqual([]);
  }));

  test('filters by kind, session, project, window, and limit', () => withStore(s => {
    const mine  = recordEntry(s, { channel: 'checklist', text: 'a', session: 's1' }, VERSION).id,
          other = recordEntry(s, { channel: 'checklist', text: 'b', session: 's2' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'wrong a', session: 's1', project: 'atlas',
                     correctsId: mine, correctsKind: 'retracts' }, VERSION,
                new Date('2026-08-20T00:00:00Z'));
    recordEntry(s, { channel: 'divergence', text: 'detail b', session: 's2',
                     correctsId: other, correctsKind: 'amends' }, VERSION,
                new Date('2026-08-27T00:00:00Z'));

    expect(register(s)).toHaveLength(2);
    expect(register(s, { kind: 'retracts' }).map(r => r.replacement.text)).toEqual(['wrong a']);
    expect(register(s, { session: 's2' }).map(r => r.replacement.text)).toEqual(['detail b']);
    expect(register(s, { project: 'atlas' }).map(r => r.replacement.text)).toEqual(['wrong a']);
    expect(register(s, { sinceUtc: '2026-08-25T00:00:00.000Z' }).map(r => r.replacement.text)).toEqual(['detail b']);
    expect(register(s, { limit: 1 })).toHaveLength(1);
  }));

  test('is newest first, so the most recent correction leads', () => withStore(s => {
    const a = recordEntry(s, { channel: 'checklist', text: 'a', session: 's1' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'first strike', session: 's1',
                     correctsId: a, correctsKind: 'retracts' }, VERSION);
    const b = recordEntry(s, { channel: 'checklist', text: 'b', session: 's1' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'second strike', session: 's1',
                     correctsId: b, correctsKind: 'retracts' }, VERSION);
    expect(register(s).map(r => r.replacement.text)).toEqual(['second strike', 'first strike']);
  }));

  test('the limit applies after non-standing strikes are dropped, never before', () => withStore(s => {
    // Newest-first the strikes are: the undo, the withdrawn strike, the standing strike.
    // Only the middle one is non-standing, so asking for two must reach past it — a SQL
    // LIMIT applied before the standing check would return one row and call it two.
    const a = recordEntry(s, { channel: 'checklist', text: 'a', session: 's1' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'standing strike', session: 's1',
                     correctsId: a, correctsKind: 'retracts' }, VERSION);
    const b = recordEntry(s, { channel: 'checklist', text: 'b', session: 's1' }, VERSION).id;
    const doomed = recordEntry(s, { channel: 'divergence', text: 'withdrawn strike', session: 's1',
                                    correctsId: b, correctsKind: 'retracts' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'take that back', session: 's1',
                     correctsId: doomed, correctsKind: 'retracts' }, VERSION);
    expect(register(s, { limit: 2 }).map(r => r.replacement.text))
      .toEqual(['take that back', 'standing strike']);
  }));

  test('the undo of a retraction is itself a register entry — taking back is a claim too', () => withStore(s => {
    const { original, strike } = retracted(s);
    const undo = recordEntry(s, { channel: 'divergence', text: 'I was wrong to take that back',
                                  session: 's1', correctsId: strike, correctsKind: 'retracts' },
                             VERSION).id;
    const listed = register(s);
    // The original is no longer listed as taken back…
    expect(listed.map(row => row.original?.id)).not.toContain(original);
    // …and the withdrawal of the retraction is what stands in the register now.
    expect(listed.map(row => row.replacement.id)).toEqual([undo]);
    expect(listed[0]?.original?.id).toBe(strike);
  }));

});

describe('marked read surfaces (#16)', () => {

  test('recentEntries marks retracted rows and never omits them', () => withStore(s => {
    const { original, strike } = retracted(s);
    const rows = recentEntries(s, 10);
    expect(rows).toHaveLength(2);
    const marked = rows.find(row => row['id'] === original);
    expect(marked?.['status']).toBe('retracted');
    expect(marked?.['by']).toBe(strike);
    expect(marked?.['text']).toBe('icons sort by status');
  }));

  test('recentEntries carries the link columns, so a retraction can aim at what it just read', () => withStore(s => {
    const { original } = retracted(s);
    const strikeRow = recentEntries(s, 10).find(row => row['corrects_id'] !== null);
    expect(strikeRow?.['corrects_id']).toBe(original);
    expect(strikeRow?.['corrects_kind']).toBe('retracts');
    expect(strikeRow?.['verbatim']).toBe('icons sort by status first, then alphabetically');
    expect(strikeRow?.['status']).toBe('stands');
  }));

  test('an unstruck row is marked as standing, with no strike named', () => withStore(s => {
    recordEntry(s, { channel: 'idea', text: 'x', session: 's1' }, VERSION);
    const [row] = recentEntries(s, 1);
    expect(row?.['status']).toBe('stands');
    expect(row?.['by']).toBeNull();
  }));

  test('seriesPercents drops a retracted snapshot and keeps an amended one', () => withStore(s => {
    const wrong = recordEntry(s, { channel: 'checklist', text: 'x', session: 's1',
                                   seriesKey: 'atlas', percent: 31 }, VERSION).id;
    const fine  = recordEntry(s, { channel: 'checklist', text: 'x', session: 's1',
                                   seriesKey: 'atlas', percent: 62 }, VERSION).id;
    recordEntry(s, { channel: 'checklist', text: 'x', session: 's1',
                     seriesKey: 'atlas', percent: 84 }, VERSION);
    recordEntry(s, { channel: 'divergence', text: 'that render was stale', session: 's1',
                     correctsId: wrong, correctsKind: 'retracts' }, VERSION);
    recordEntry(s, { channel: 'divergence', text: 'off by the header', session: 's1',
                     correctsId: fine, correctsKind: 'amends' }, VERSION);
    expect(seriesPercents(s, 'atlas')).toEqual([62, 84]);
  }));

  test('previousSignature skips a retracted signature and keeps an amended one', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'older', session: 's1', face: '🙂' }, VERSION);
    const wrong = recordEntry(s, { channel: 'signature', text: 'misrecorded', session: 's1',
                                   face: '😀' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'that was not the reading', session: 's1',
                     correctsId: wrong, correctsKind: 'retracts' }, VERSION);
    expect(previousSignature(s, 's1')?.['face']).toBe('🙂');

    const amended = recordEntry(s, { channel: 'signature', text: 'newer', session: 's1',
                                     face: '😌' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'a detail', session: 's1',
                     correctsId: amended, correctsKind: 'amends' }, VERSION);
    expect(previousSignature(s, 's1')?.['face']).toBe('😌');
  }));

  // The panel readers below feed the history PNG. They query the same columns the recall
  // path does, and the contract is that the two never disagree — a sparkline must not
  // replay a number its author took back just because it reached it by a different query.

  /** Record one checklist snapshot in the window, returning its id. */
  function snapshot(s: Store, seriesKey: string, percent: number): number {
    return recordEntry(s, { channel: 'checklist', text: 'x', session: 's1',
                            seriesKey, percent }, VERSION, WHEN).id;
  }

  /** Strike an earlier row, in the window. */
  function strike(s: Store, target: number, kind: 'retracts' | 'amends'): number {
    return recordEntry(s, { channel: 'divergence', text: `${kind} ${String(target)}`,
                            session: 's1', correctsId: target, correctsKind: kind }, VERSION, WHEN).id;
  }

  test('checklistSeriesTop drops a retracted snapshot, agreeing with seriesPercents', () => withStore(s => {
    // The issue's own evidence case: logged at 31, taken back, re-logged at 62.
    strike(s, snapshot(s, 'atlas', 31), 'retracts');
    snapshot(s, 'atlas', 62);

    expect(seriesPercents(s, 'atlas')).toEqual([62]);
    expect(checklistSeriesTop(s, SINCE, 5)).toEqual([{ seriesKey: 'atlas', percents: [62] }]);
  }));

  test('checklistSeriesTop keeps an amended snapshot — a refined detail is not a withdrawal', () => withStore(s => {
    strike(s, snapshot(s, 'atlas', 31), 'amends');
    snapshot(s, 'atlas', 62);

    expect(seriesPercents(s, 'atlas')).toEqual([31, 62]);
    expect(checklistSeriesTop(s, SINCE, 5)).toEqual([{ seriesKey: 'atlas', percents: [31, 62] }]);
  }));

  test('a withdrawn snapshot does not make its series look busier than it was', () => withStore(s => {
    // 'padded' logs three and takes two back; 'real' logs two that stand. Counting rows
    // rather than surviving rows would rank 'padded' first on snapshots it disowned.
    strike(s, snapshot(s, 'padded', 10), 'retracts');
    strike(s, snapshot(s, 'padded', 20), 'retracts');
    snapshot(s, 'padded', 30);
    snapshot(s, 'real', 40);
    snapshot(s, 'real', 50);

    expect(checklistSeriesTop(s, SINCE, 5)).toEqual([
      { seriesKey: 'real',   percents: [40, 50] },
      { seriesKey: 'padded', percents: [30]     },
    ]);
  }));

  test('a series whose every snapshot was retracted leaves the panel, not an empty line', () => withStore(s => {
    strike(s, snapshot(s, 'ghost', 99), 'retracts');
    snapshot(s, 'atlas', 62);

    expect(checklistSeriesTop(s, SINCE, 5)).toEqual([{ seriesKey: 'atlas', percents: [62] }]);
  }));

  test('signatureHistory drops a retracted signature and keeps an amended one', () => withStore(s => {
    const wrong  = recordEntry(s, { channel: 'signature', text: 'misrecorded', session: 's1',
                                    stem: 'spark' }, VERSION, WHEN).id,
          fine   = recordEntry(s, { channel: 'signature', text: 'nearly', session: 's1',
                                    stem: 'flow' }, VERSION, WHEN).id,
          stands = recordEntry(s, { channel: 'signature', text: 'as recorded', session: 's1',
                                    stem: 'still' }, VERSION, WHEN).id;
    strike(s, wrong, 'retracts');
    strike(s, fine,  'amends');

    expect(signatureHistory(s, SINCE).map(row => row.id)).toEqual([fine, stands]);
    expect(signatureHistory(s, SINCE).map(row => row.stem)).toEqual(['flow', 'still']);
  }));

  test('forecastOutcomes drops a pair whose resolution was retracted', () => withStore(s => {
    const kept = recordEntry(s, { channel: 'confidence', text: 'f1', session: 's1',
                                  confidence: 'predicted' }, VERSION).id,
          lost = recordEntry(s, { channel: 'confidence', text: 'f2', session: 's1',
                                  confidence: 'predicted' }, VERSION).id;
    recordEntry(s, { channel: 'confidence', text: 'r1', session: 's1',
                     correctsId: kept, correctsKind: 'resolves', outcome: 'hit' }, VERSION);
    const wrongCall = recordEntry(s, { channel: 'confidence', text: 'r2', session: 's1',
                                       correctsId: lost, correctsKind: 'resolves',
                                       outcome: 'miss' }, VERSION).id;
    strike(s, wrongCall, 'retracts');

    expect(forecastOutcomes(s)).toEqual(['hit']);
  }));

  test('forecastOutcomes drops a pair whose forecast was retracted — never predicted, never scored', () => withStore(s => {
    const kept    = recordEntry(s, { channel: 'confidence', text: 'f1', session: 's1',
                                     confidence: 'predicted' }, VERSION).id,
          disowned = recordEntry(s, { channel: 'confidence', text: 'f2', session: 's1',
                                      confidence: 'predicted' }, VERSION).id;
    recordEntry(s, { channel: 'confidence', text: 'r1', session: 's1',
                     correctsId: kept, correctsKind: 'resolves', outcome: 'hit' }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'r2', session: 's1',
                     correctsId: disowned, correctsKind: 'resolves', outcome: 'miss' }, VERSION);
    strike(s, disowned, 'retracts');

    expect(forecastOutcomes(s)).toEqual(['hit']);
  }));

  test('forecastOutcomes keeps a pair amended at either end, with its recorded outcome', () => withStore(s => {
    const a = recordEntry(s, { channel: 'confidence', text: 'f1', session: 's1',
                               confidence: 'predicted' }, VERSION).id,
          b = recordEntry(s, { channel: 'confidence', text: 'f2', session: 's1',
                               confidence: 'predicted' }, VERSION).id;
    const ra = recordEntry(s, { channel: 'confidence', text: 'r1', session: 's1',
                                correctsId: a, correctsKind: 'resolves', outcome: 'hit' }, VERSION).id;
    recordEntry(s, { channel: 'confidence', text: 'r2', session: 's1',
                     correctsId: b, correctsKind: 'resolves', outcome: 'miss' }, VERSION);
    strike(s, ra, 'amends');   // the resolution's wording refined
    strike(s, b,  'amends');   // the forecast's wording refined

    expect(forecastOutcomes(s)).toEqual(['hit', 'miss']);
  }));

});

describe('retractedAmong', () => {

  test('names the retracted rows and nothing else', () => withStore(s => {
    const taken = recordEntry(s, { channel: 'idea', text: 'wrong',  session: 's1' }, VERSION).id,
          fixed = recordEntry(s, { channel: 'idea', text: 'nearly', session: 's1' }, VERSION).id,
          held  = recordEntry(s, { channel: 'idea', text: 'right',  session: 's1' }, VERSION).id;
    recordEntry(s, { channel: 'divergence', text: 'no', session: 's1',
                     correctsId: taken, correctsKind: 'retracts' }, VERSION);
    recordEntry(s, { channel: 'divergence', text: 'detail', session: 's1',
                     correctsId: fixed, correctsKind: 'amends' }, VERSION);

    expect([...retractedAmong(s, [taken, fixed, held])]).toEqual([taken]);
  }));

  test('an empty request and an unknown id both yield nothing', () => withStore(s => {
    expect(retractedAmong(s, []).size).toBe(0);
    expect(retractedAmong(s, [9999]).size).toBe(0);
  }));

});
