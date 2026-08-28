import { createHash } from 'node:crypto';

import {
  ANCHOR_QUOTE_MAX, ANCHOR_HASH_CHARS,
  normalizeQuote, anchorHash, parseFileSpan, parseOrdinal, spanProblem, locateQuote,
  resolveFileAnchor, resolveMessageAnchor, resolveChecklistAnchor, resolveEntryAnchor,
  resolveAnchor,
} from '../channels/anchors.js';
import type { Anchor } from '../channels/anchors.js';
import { ANCHOR_KINDS } from '../channels/vocabulary.js';

/** A file anchor with the fields the resolver reads; `hash` derives unless overridden. */
function fileAnchor(span: string | undefined, quote: string | undefined): Anchor {
  return { kind: 'file', target: 'src/x.ts', span, quote };
}

describe('normalizeQuote', () => {

  test('collapses every run of whitespace to one space and trims the ends', () => {
    expect(normalizeQuote('  readConfig(store,\n    key)  ')).toBe('readConfig(store, key)');
    expect(normalizeQuote('a\t\tb\r\nc')).toBe('a b c');
  });

  test('is idempotent — normalizing twice is normalizing once', () => {
    const once = normalizeQuote(' a \n b ');
    expect(normalizeQuote(once)).toBe(once);
  });

  test('an all-whitespace quote normalizes to empty, which validation rejects', () => {
    expect(normalizeQuote('   \n\t ')).toBe('');
  });

});

describe('anchorHash', () => {

  test('is the truncated SHA-256 of the normalized quote — pinned against the vector', () => {
    const expected = createHash('sha256').update('readConfig(store, key)').digest('hex')
      .slice(0, ANCHOR_HASH_CHARS);
    expect(anchorHash('readConfig(store, key)')).toBe(expected);
    expect(anchorHash('readConfig(store, key)')).toHaveLength(ANCHOR_HASH_CHARS);
  });

  test('equal normalized quotes hash equal, differing ones do not', () => {
    expect(anchorHash('  readConfig(store,\n  key) ')).toBe(anchorHash('readConfig(store, key)'));
    expect(anchorHash('readConfig(store, key)')).not.toBe(anchorHash('readConfig(store, other)'));
  });

  test('is lowercase hex, so a stored value is comparable as text', () => {
    expect(anchorHash('anything')).toMatch(/^[0-9a-f]+$/);
  });

});

describe('parseFileSpan', () => {

  test('reads a single line as a one-line range', () => {
    expect(parseFileSpan('L40')).toEqual({ start: 40, end: 40 });
  });

  test('reads a forward range', () => {
    expect(parseFileSpan('L40-52')).toEqual({ start: 40, end: 52 });
  });

  test('rejects a backwards range rather than reordering it', () => {
    expect(parseFileSpan('L52-40')).toBeNull();
  });

  test('rejects line zero, bare numbers, and other grammars', () => {
    for (const bad of ['L0', 'L0-3', '40', 'line 40', '#2', '@3', 'L', '']) {
      expect(parseFileSpan(bad)).toBeNull();
    }
  });

});

describe('parseOrdinal', () => {

  test('an absent span means the first occurrence', () => {
    expect(parseOrdinal(undefined)).toBe(1);
  });

  test('reads an occurrence ordinal', () => {
    expect(parseOrdinal('#2')).toBe(2);
    expect(parseOrdinal('#10')).toBe(10);
  });

  test('rejects zero and other grammars', () => {
    for (const bad of ['#0', '2', 'L40', '@3', '#', '#-1']) {
      expect(parseOrdinal(bad)).toBeNull();
    }
  });

});

describe('spanProblem — the per-kind grammar', () => {

  test('accepts each kind its own grammar', () => {
    expect(spanProblem('file', 'L40')).toBeNull();
    expect(spanProblem('file', 'L40-52')).toBeNull();
    expect(spanProblem('prompt', '#2')).toBeNull();
    expect(spanProblem('reply', '#3')).toBeNull();
    expect(spanProblem('checklist', '@3')).toBeNull();
  });

  test('rejects each kind the other kinds grammars, naming what would have worked', () => {
    expect(spanProblem('file', '#2')).toContain('L<line>');
    expect(spanProblem('prompt', 'L40')).toContain("'#2'");
    expect(spanProblem('checklist', 'L40')).toContain("'@3'");
  });

  test('an entry anchor takes no span at all — the id is already exact', () => {
    expect(spanProblem('entry', '#1')).toContain('already exact');
    expect(spanProblem('entry', 'L40')).toContain('already exact');
  });

});

describe('locateQuote', () => {

  test('finds the first occurrence by default', () => {
    expect(locateQuote('ship it when ready. ship it', 'ship it')).toBe(0);
  });

  test('finds a later occurrence by ordinal', () => {
    expect(locateQuote('ship it when ready. ship it', 'ship it', 2)).toBe(20);
  });

  test('normalizes both sides, so indentation cannot hide a match', () => {
    expect(locateQuote('ship   it\n  when ready', 'ship it when')).toBe(0);
  });

  test('returns -1 for an absent quote, an ordinal past the last occurrence, and an empty quote', () => {
    expect(locateQuote('ship it when ready', 'later')).toBe(-1);
    expect(locateQuote('ship it when ready', 'ship it', 2)).toBe(-1);
    expect(locateQuote('ship it', '   ')).toBe(-1);
    expect(locateQuote('ship it', 'ship it', 0)).toBe(-1);
  });

});

describe('resolveFileAnchor — the drift ladder', () => {

  const LINES = ['const a = 1;', 'const b = 2;', 'const c = 3;'];

  test('fresh: the content at the recorded span still fingerprints the same', () => {
    expect(resolveFileAnchor(fileAnchor('L2', 'const b = 2;'), LINES))
      .toEqual({ status: 'fresh', span: 'L2' });
  });

  test('fresh across reindentation, because the fingerprint is over normalized text', () => {
    expect(resolveFileAnchor(fileAnchor('L2', 'const   b = 2;'), ['const a = 1;', '    const b = 2;']))
      .toEqual({ status: 'fresh', span: 'L2' });
  });

  test('moved: gone from the span, found exactly once elsewhere, reported both ways', () => {
    expect(resolveFileAnchor(fileAnchor('L1', 'const b = 2;'), ['inserted', 'const a = 1;', 'const b = 2;']))
      .toEqual({ status: 'moved', span: 'L3', from: 'L1' });
  });

  test('a moved multi-line span reports the new range, not just its first line', () => {
    const anchor = fileAnchor('L1-2', 'const a = 1; const b = 2;');
    expect(resolveFileAnchor(anchor, ['pad', 'const a = 1;', 'const b = 2;']))
      .toEqual({ status: 'moved', span: 'L2-3', from: 'L1-2' });
  });

  test('orphaned: the content is simply gone', () => {
    expect(resolveFileAnchor(fileAnchor('L2', 'const b = 2;'), ['const a = 1;']))
      .toEqual({ status: 'orphaned' });
  });

  test('orphaned: the file is gone', () => {
    expect(resolveFileAnchor(fileAnchor('L2', 'const b = 2;'), null))
      .toEqual({ status: 'orphaned' });
  });

  test('orphaned: an empty file has nowhere for the content to be', () => {
    expect(resolveFileAnchor(fileAnchor('L2', 'const b = 2;'), []))
      .toEqual({ status: 'orphaned' });
  });

  test('orphaned, not moved: two identical candidates are ambiguous, and a guess is worse than an orphan', () => {
    expect(resolveFileAnchor(fileAnchor('L1', 'const b = 2;'), ['x', 'const b = 2;', 'const b = 2;']))
      .toEqual({ status: 'orphaned' });
  });

  test('a span past EOF with content that still exists resolves as moved, not as a crash', () => {
    expect(resolveFileAnchor(fileAnchor('L9', 'const c = 3;'), LINES))
      .toEqual({ status: 'moved', span: 'L3', from: 'L9' });
  });

  test('a span-only anchor is fresh inside the file and orphaned past its end — no drift detection was bought', () => {
    expect(resolveFileAnchor(fileAnchor('L2', undefined), LINES)).toEqual({ status: 'fresh', span: 'L2' });
    expect(resolveFileAnchor(fileAnchor('L9', undefined), LINES)).toEqual({ status: 'orphaned' });
  });

  test('an anchor with neither span nor quote cannot be resolved at all', () => {
    expect(resolveFileAnchor(fileAnchor(undefined, undefined), LINES)).toEqual({ status: 'orphaned' });
  });

  test('a quote with no span is fresh at its unique location, orphaned when duplicated', () => {
    expect(resolveFileAnchor(fileAnchor(undefined, 'const c = 3;'), LINES))
      .toEqual({ status: 'fresh', span: 'L3' });
    expect(resolveFileAnchor(fileAnchor(undefined, 'dup'), ['dup', 'dup']))
      .toEqual({ status: 'orphaned' });
  });

  test('a stored hash is honoured over rederiving from the quote — the suppressed-quote path', () => {
    const anchor = { kind: 'file' as const, target: 'src/x.ts', span: 'L2',
                     hash: anchorHash('const b = 2;') };
    expect(resolveFileAnchor(anchor, LINES)).toEqual({ status: 'fresh', span: 'L2' });
  });

  test('a malformed recorded span falls back to searching, rather than throwing', () => {
    expect(resolveFileAnchor(fileAnchor('nonsense', 'const c = 3;'), LINES))
      .toEqual({ status: 'fresh', span: 'L3' });
  });

});

describe('resolveMessageAnchor — the access ladder', () => {

  test('fresh when the turn is in reach', () => {
    expect(resolveMessageAnchor({ kind: 'prompt', target: 'p-2', quote: 'ship it' }, ['p-1', 'p-2']))
      .toEqual({ status: 'fresh', span: undefined });
  });

  test('distant when the turn is not — a sent message never moves, but it can go out of reach', () => {
    expect(resolveMessageAnchor({ kind: 'prompt', target: 'p-0', quote: 'ship it' }, ['p-1', 'p-2']))
      .toEqual({ status: 'distant', span: undefined });
  });

  test('never returns moved or orphaned, whatever the turn list says', () => {
    for (const turns of [[], ['p-1'], ['p-1', 'p-2']]) {
      const status = resolveMessageAnchor({ kind: 'reply', target: 'p-1', quote: 'x' }, turns).status;
      expect(['fresh', 'distant']).toContain(status);
    }
  });

  test('carries the recorded ordinal through, so a repeated quote stays addressable', () => {
    expect(resolveMessageAnchor({ kind: 'prompt', target: 'p-1', span: '#2', quote: 'x' }, ['p-1']))
      .toEqual({ status: 'fresh', span: '#2' });
  });

});

describe('resolveChecklistAnchor', () => {

  test('fresh while the quoted label is still in the latest snapshot', () => {
    expect(resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', quote: 'migrate' },
                                  ['migrate', 'render']).status).toBe('fresh');
  });

  test('orphaned once the label is gone — the series persists, the item did not', () => {
    expect(resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', quote: 'migrate' },
                                  ['render']).status).toBe('orphaned');
  });

  test('orphaned when the series itself is unknown', () => {
    expect(resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', quote: 'migrate' }, null).status)
      .toBe('orphaned');
  });

  test('a quoteless anchor points at the series, so any labels at all keep it fresh', () => {
    expect(resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', span: '@3' }, ['whatever']).status)
      .toBe('fresh');
    expect(resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', span: '@3' }, []).status)
      .toBe('orphaned');
  });

  test('label matching normalizes, so reindented labels still match', () => {
    expect(resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', quote: 'run  the   migration' },
                                  ['run the migration']).status).toBe('fresh');
  });

});

describe('resolveEntryAnchor', () => {

  test('is always fresh, because rows are never deleted', () => {
    expect(resolveEntryAnchor()).toEqual({ status: 'fresh' });
  });

});

describe('resolveAnchor — the dispatcher', () => {

  test('dispatches each kind to its own resolver', () => {
    expect(resolveAnchor({ kind: 'entry', target: '212' }, {}).status).toBe('fresh');
    expect(resolveAnchor({ kind: 'file', target: 'x.ts', span: 'L1', quote: 'a' },
                         { fileLines: ['a'] }).status).toBe('fresh');
    expect(resolveAnchor({ kind: 'prompt', target: 'p-1', quote: 'a' },
                         { knownTurns: ['p-1'] }).status).toBe('fresh');
    expect(resolveAnchor({ kind: 'reply', target: 'p-1', quote: 'a' },
                         { knownTurns: ['p-1'] }).status).toBe('fresh');
    expect(resolveAnchor({ kind: 'checklist', target: 'k', quote: 'a' },
                         { checklistLabels: ['a'] }).status).toBe('fresh');
  });

  test('a caller that could not look never gets a verdict implying it did', () => {
    expect(resolveAnchor({ kind: 'file', target: 'x.ts', span: 'L1', quote: 'a' }, {}).status).toBe('orphaned');
    expect(resolveAnchor({ kind: 'prompt', target: 'p-1', quote: 'a' }, {}).status).toBe('distant');
    expect(resolveAnchor({ kind: 'checklist', target: 'k', quote: 'a' }, {}).status).toBe('orphaned');
  });

  test('an unknown kind is a RangeError naming the accepted domain', () => {
    expect(() => resolveAnchor({ kind: 'diagram' as never, target: 'x' }, {}))
      .toThrow(/not an anchor kind/);
    for (const kind of ANCHOR_KINDS) {
      expect(() => resolveAnchor({ kind, target: '1' }, {})).not.toThrow();
    }
  });

});

describe('the anchor constants', () => {

  test('the quote cap is short enough to stay an excerpt, not a second text column', () => {
    expect(ANCHOR_QUOTE_MAX).toBe(120);
  });

  test('the hash is 16 hex characters — 64 bits, unreadable as language', () => {
    expect(ANCHOR_HASH_CHARS).toBe(16);
  });

});
