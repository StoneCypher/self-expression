import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import { recordEntry }           from '../channels/entries.js';
import {
  renderSignatureLine, parseSignatureLine, sameSignatureText,
  lastNonEmptyLine, firstNonEmptyLine, hasEarlierSignature, signatureLineFor, turnSignature,
  DELTA_GLYPHS, NO_CLOCK,
} from '../channels/signature_line.js';

const VERSION = '0.7.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-sigline-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

const FULL = {
  tsLocal: '9:14 am PDT', delta: 'up', showDelta: true, uncertain: false,
  face: '🙂', contextEmoji: '🧭', cctype: 'feat', text: 'flow; clear plan',
} as const;

describe('renderSignatureLine', () => {

  test('renders the documented example exactly', () => {
    expect(renderSignatureLine(FULL)).toBe('`[9:14 am PDT]` ⬆️ 🙂 🧭 - feat `»` flow; clear plan');
  });

  test('the second documented example: down, uncertain, two context emoji', () => {
    expect(renderSignatureLine({ ...FULL, tsLocal: '1:03 pm PDT', delta: 'down', uncertain: true,
                                 face: '😬', contextEmoji: '⛈️', cctype: 'fix',
                                 text: "strain; can't tell if workload or friction" }))
      .toBe("`[1:03 pm PDT]` ⬇️ ❓😬 ⛈️ - fix `»` strain; can't tell if workload or friction");
  });

  test('no cc type drops the hyphen too', () => {
    expect(renderSignatureLine({ ...FULL, delta: 'steady', face: '🤔', contextEmoji: '🌫️',
                                 cctype: null, text: 'fog; missing context' }))
      .toBe('`[9:14 am PDT]` ➡️ 🤔 🌫️ `»` fog; missing context');
  });

  test("a session's first signature shows no arrow even when a delta was given", () => {
    expect(renderSignatureLine({ ...FULL, showDelta: false }))
      .toBe('`[9:14 am PDT]` 🙂 🧭 - feat `»` flow; clear plan');
  });

  test('no clock renders the placeholder, never a fabricated time', () => {
    expect(NO_CLOCK).toBe('--:--');
    expect(renderSignatureLine({ ...FULL, tsLocal: null })).toMatch(/^`\[--:--\]` /u);
  });

  test('a bare signature is still one well-formed line', () => {
    expect(renderSignatureLine({ tsLocal: null, delta: null, showDelta: true, uncertain: false,
                                 face: null, contextEmoji: null, cctype: null, text: 'still' }))
      .toBe('`[--:--]` `»` still');
  });

  test('every delta has its own glyph', () => {
    expect(Object.values(DELTA_GLYPHS)).toEqual(['⬆️', '⬇️', '➡️']);
  });

});

describe('parseSignatureLine', () => {

  test('splits a full line into stamp, middle, and text', () => {
    expect(parseSignatureLine('`[9:14 am PDT]` ⬆️ 🙂 🧭 - feat `»` flow; clear plan')).toEqual({
      stamp: '9:14 am PDT', middle: '⬆️ 🙂 🧭 - feat', text: 'flow; clear plan',
    });
  });

  test('ignores surrounding whitespace', () => {
    expect(parseSignatureLine('   `[--:--]` `»` still  ')?.text).toBe('still');
  });

  test.each([
    ['plain prose',                         'flow; clear plan'],
    ['no backticks on the stamp',           '[9:14 am PDT] 🙂 `»` flow'],
    ['no backticks on the guillemet',       '`[9:14 am PDT]` 🙂 » flow'],
    ['the whole line in one code span',    '`[9:14 am PDT] 🙂 » flow`'],
    ['nothing after the guillemet',         '`[9:14 am PDT]` 🙂 `»`'],
    ['a diff channel line',                 '- need: which repo? 😟'],
    ['a stamp not at the start',            'done `[9:14 am PDT]` 🙂 `»` flow'],
  ])('rejects %s', (_label, line) => {
    expect(parseSignatureLine(line)).toBeNull();
  });

});

describe('text helpers', () => {

  test('sameSignatureText ignores whitespace runs and the ends, nothing else', () => {
    expect(sameSignatureText('flow;  clear plan ', ' flow; clear plan')).toBe(true);
    expect(sameSignatureText('flow; clear plan', 'flow; clear plans')).toBe(false);
  });

  test('lastNonEmptyLine and firstNonEmptyLine skip blank lines, CRLF included', () => {
    expect(lastNonEmptyLine('body\r\n\r\nsig\r\n\r\n')).toBe('sig');
    expect(firstNonEmptyLine('\n  \nfirst\nsecond')).toBe('first');
    expect(lastNonEmptyLine('   \n\n')).toBeNull();
    expect(firstNonEmptyLine('')).toBeNull();
  });

});

describe('recorded signatures', () => {

  test('hasEarlierSignature is about this session, before this id, signatures only', () => withStore(s => {
    const need  = recordEntry(s, { channel: 'need', text: 'x', session: 's1' }, VERSION),
          first = recordEntry(s, { channel: 'signature', text: 'a', session: 's1' }, VERSION),
          other = recordEntry(s, { channel: 'signature', text: 'b', session: 's2' }, VERSION),
          next  = recordEntry(s, { channel: 'signature', text: 'c', session: 's1' }, VERSION);
    expect(hasEarlierSignature(s, 's1', first.id)).toBe(false);   // the need does not count
    expect(hasEarlierSignature(s, 's2', other.id)).toBe(false);   // s1's does not count
    expect(hasEarlierSignature(s, 's1', next.id)).toBe(true);
    expect(need.id).toBeLessThan(first.id);
  }));

  test('signatureLineFor renders from the row, with the arrow only after the first', () => withStore(s => {
    const when  = new Date(2026, 8, 22, 9, 14),
          first = recordEntry(s, { channel: 'signature', text: 'still; fresh', session: 's1',
                                   position: 'open', face: '🙂', delta: 'up' }, VERSION, when),
          later = recordEntry(s, { channel: 'signature', text: 'flow; clear plan', session: 's1',
                                   position: 'close', face: '🙂', contextEmoji: '🧭', delta: 'up',
                                   cctype: 'feat', uncertain: true }, VERSION, when);
    const firstLine = signatureLineFor(s, first.id) ?? '',
          laterLine = signatureLineFor(s, later.id) ?? '';
    expect(firstLine).toMatch(/^`\[9:14 am \S+\]` 🙂 `»` still; fresh$/u);
    expect(laterLine).toMatch(/^`\[9:14 am \S+\]` ⬆️ ❓🙂 🧭 - feat `»` flow; clear plan$/u);
  }));

  test('signatureLineFor is null for a non-signature or a missing row', () => withStore(s => {
    const need = recordEntry(s, { channel: 'need', text: 'x', session: 's1' }, VERSION);
    expect(signatureLineFor(s, need.id)).toBeNull();
    expect(signatureLineFor(s, 9999)).toBeNull();
  }));

  test('turnSignature finds the newest one at a position, scoped by the pair', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'first close', session: 's1', promptId: 'p1', position: 'close' }, VERSION);
    recordEntry(s, { channel: 'signature', text: 'second close', session: 's1', promptId: 'p1', position: 'close' }, VERSION);
    recordEntry(s, { channel: 'signature', text: 'their close', session: 's2', promptId: 'p1', position: 'close' }, VERSION);
    recordEntry(s, { channel: 'signature', text: 'the open', session: 's1', promptId: 'p1', position: 'open' }, VERSION);

    expect(turnSignature(s, 's1', 'p1', 'close')?.text).toBe('second close');
    expect(turnSignature(s, 's1', 'p1', 'open')?.text).toBe('the open');
    expect(turnSignature(s, 's1', 'p2', 'close')).toBeNull();
    expect(turnSignature(s, undefined, 'p1', 'close')?.text).toBe('their close');   // unscoped: newest
    expect(turnSignature(s, 's1', 'p1', 'close')?.line).toMatch(/`»` second close$/u);
  }));

});
