/**
 * Stochastic property tests for anchoring (issue #18): the pure resolver, the
 * fingerprint, and the renderer.
 *
 * The load-bearing property is the safety one — **the resolver never returns `moved`
 * unless exactly one candidate matched.** Silent wrong-attachment is the worst failure
 * this system can have, so it is proved against random files rather than against the
 * handful of shapes a human thought to write down.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  normalizeQuote, anchorHash, parseFileSpan, spanProblem,
  resolveFileAnchor, resolveMessageAnchor, resolveAnchor,
} from '../channels/anchors.js';
import { renderAnnotations } from '../charts/annotations.js';
import type { AnnotationNote } from '../charts/annotations.js';
import { ANCHOR_KINDS } from '../channels/vocabulary.js';

/** Lines drawn from a small alphabet, so duplicates and near-misses actually occur. */
const lineArb  = fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'alpha ', ' beta', 'epsilon');
const linesArb = fc.array(lineArb, { minLength: 0, maxLength: 12 });

/** Whitespace-flavoured text, for the normalization properties. */
const looseArb = fc.array(fc.constantFrom('a', 'b', ' ', '\t', '\n', '  ', 'c'), { maxLength: 20 })
  .map(parts => parts.join(''));

describe('normalization and fingerprinting — stochastic', () => {

  it('normalization is idempotent', () => {
    fc.assert(fc.property(looseArb, (raw) => {
      const once = normalizeQuote(raw);
      expect(normalizeQuote(once)).toBe(once);
    }), { numRuns: 400 });
  });

  it('normalization never leaves a leading, trailing, or doubled space', () => {
    fc.assert(fc.property(looseArb, (raw) => {
      const out = normalizeQuote(raw);
      expect(out).toBe(out.trim());
      expect(out).not.toMatch(/\s\s/);
      expect(out).not.toMatch(/[\t\n\r]/);
    }), { numRuns: 400 });
  });

  it('hashes are equal exactly when the normalized quotes are equal', () => {
    fc.assert(fc.property(looseArb, looseArb, (a, b) => {
      expect(anchorHash(a) === anchorHash(b)).toBe(normalizeQuote(a) === normalizeQuote(b));
    }), { numRuns: 500 });
  });

  it('a hash is always 16 lowercase hex characters, whatever the input', () => {
    fc.assert(fc.property(fc.string({ maxLength: 200 }), (raw) => {
      expect(anchorHash(raw)).toMatch(/^[0-9a-f]{16}$/);
    }), { numRuns: 300 });
  });

});

describe('the freshness ladder — stochastic', () => {

  it('never returns moved unless exactly one candidate window matches', () => {
    fc.assert(fc.property(linesArb, lineArb, fc.integer({ min: 1, max: 14 }), (lines, quote, at) => {

      const anchor     = { kind: 'file' as const, target: 'x.ts', span: `L${String(at)}`, quote },
            resolution = resolveFileAnchor(anchor, lines),
            wanted     = anchorHash(quote),
            matches    = lines.filter(line => anchorHash(line) === wanted).length;

      if (resolution.status === 'moved') {
        expect(matches).toBe(1);
        // And it moved to somewhere real, that genuinely holds the content.
        const found = parseFileSpan(resolution.span ?? '');
        expect(found).not.toBeNull();
        expect(anchorHash(lines[(found?.start ?? 1) - 1] ?? '')).toBe(wanted);
      }

      // Ambiguity is never resolved on a guess.
      if (matches > 1 && anchorHash(lines[at - 1] ?? '') !== wanted) {
        expect(resolution.status).toBe('orphaned');
      }

    }), { numRuns: 500 });
  });

  it('a quote still sitting at its recorded span is always fresh, never moved', () => {
    fc.assert(fc.property(fc.array(lineArb, { minLength: 1, maxLength: 12 }), (lines) => {
      for (const [index, line] of lines.entries()) {
        const span   = `L${String(index + 1)}`,
              status = resolveFileAnchor({ kind: 'file', target: 'x.ts', span, quote: line }, lines).status;
        expect(status).toBe('fresh');
      }
    }), { numRuns: 200 });
  });

  it('a vanished file orphans every anchor, whatever it recorded', () => {
    fc.assert(fc.property(lineArb, fc.option(fc.constantFrom('L1', 'L2-4'), { nil: undefined }),
      (quote, span) => {
        expect(resolveFileAnchor({ kind: 'file', target: 'x.ts', span, quote }, null).status)
          .toBe('orphaned');
      }), { numRuns: 100 });
  });

  it('a message anchor is only ever fresh or distant — a sent message cannot drift', () => {
    fc.assert(fc.property(
      fc.constantFrom('prompt' as const, 'reply' as const),
      fc.string({ maxLength: 6 }),
      fc.array(fc.string({ maxLength: 6 }), { maxLength: 5 }),
      (kind, target, turns) => {
        const status = resolveMessageAnchor({ kind, target, quote: 'q' }, turns).status;
        expect(status).toBe(turns.includes(target) ? 'fresh' : 'distant');
      }), { numRuns: 300 });
  });

  it('every kind resolves to a known verdict, and nothing throws on a well-formed anchor', () => {
    fc.assert(fc.property(
      fc.constantFrom(...ANCHOR_KINDS),
      linesArb,
      fc.array(fc.string({ maxLength: 4 }), { maxLength: 4 }),
      (kind, lines, turns) => {
        const status = resolveAnchor(
          { kind, target: 't', quote: 'alpha' },
          { fileLines: lines, knownTurns: turns, checklistLabels: lines },
        ).status;
        expect(['fresh', 'moved', 'orphaned', 'distant']).toContain(status);
      }), { numRuns: 300 });
  });

});

describe('the span grammar — stochastic', () => {

  it('a file span parses exactly when the grammar accepts it', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.integer({ min: 0, max: 300 }).map(n => `L${String(n)}`),
        fc.tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }))
          .map(([a, b]) => `L${String(a)}-${String(b)}`),
        fc.string({ maxLength: 8 }),
      ),
      (span) => {
        expect(parseFileSpan(span) === null).toBe(spanProblem('file', span) !== null);
      }), { numRuns: 500 });
  });

  it('no kind ever accepts another kind’s grammar by accident', () => {
    const samples: Record<string, string> = { file: 'L40', prompt: '#2', reply: '#2', checklist: '@3' };
    fc.assert(fc.property(fc.constantFrom(...ANCHOR_KINDS), fc.constantFrom(...ANCHOR_KINDS),
      (kind, other) => {
        const span = samples[other];
        if (span === undefined) { return; }                                  // entry has no sample
        const accepted = spanProblem(kind, span) === null;
        expect(accepted).toBe(samples[kind] === span);
      }), { numRuns: 200 });
  });

});

describe('the annotation block — stochastic', () => {

  const noteArb = fc.record({
    text         : fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim() !== ''),
    anchorKind   : fc.constantFrom('file' as const, 'entry' as const),
    anchorTarget : fc.constantFrom('a.ts', 'b.ts', '7'),
    anchorQuote  : fc.option(fc.string({ minLength: 1, maxLength: 60 }), { nil: undefined }),
  }).map((note): AnnotationNote => note.anchorKind === 'file'
    ? { ...note, anchorTarget: note.anchorTarget === '7' ? 'a.ts' : note.anchorTarget }
    : { ...note, anchorTarget: '7' });

  const notesArb = fc.array(noteArb, { minLength: 1, maxLength: 15 });

  it('the block’s line count is notes plus group headers plus blank separators', () => {
    fc.assert(fc.property(notesArb, (notes) => {
      const groups = new Set(notes.map(n => `${n.anchorKind}\u{0000}${n.anchorTarget}`)).size,
            lines  = renderAnnotations(notes).split('\n');
      expect(lines).toHaveLength(notes.length + groups + (groups - 1));
    }), { numRuns: 300 });
  });

  it('every note’s text survives into the block — presentation never drops content', () => {
    fc.assert(fc.property(notesArb, (notes) => {
      const block = renderAnnotations(notes);
      for (const note of notes) { expect(block).toContain(note.text); }
    }), { numRuns: 300 });
  });

  it('within a group every line is padded to one width, so the block stays a column', () => {
    fc.assert(fc.property(notesArb, (notes) => {
      for (const chunk of renderAnnotations(notes).split('\n\n')) {
        const noteLines = chunk.split('\n').slice(1),
              prefixes  = noteLines.map(line => line.indexOf('\u{00BB}'));
        expect(new Set(prefixes).size).toBe(1);
      }
    }), { numRuns: 300 });
  });

});
