import * as fc from 'fast-check';
import { fromMarkdown } from 'mdast-util-from-markdown';

import { lintLists } from '../channels/format_lint.js';

const parse = (text: string) => fromMarkdown(text);

/** A lowercase word: prose that can never be mistaken for a list marker. */
const word = fc.stringMatching(/^[a-z]{1,8}$/);

/** A line that would be a list item if it were prose. */
const listLikeLine = fc.oneof(
  fc.tuple(fc.integer({ min: 1, max: 12 }), word).map(([n, w]) => `${String(n)}. ${w}`),
  fc.tuple(fc.integer({ min: 1, max: 12 }), word).map(([n, w]) => `${String(n)}) ${w}`),
  word.map(w => `- ${w}`),
  word.map(w => `* ${w}`),
  word.map(w => `+ ${w}`),
  fc.tuple(word, word).map(([k, v]) => `  - ${k}: ${v}`),
  word,
);

/** A fenced code block — backtick or tilde, any info string — full of list-like lines. */
const fenced = fc.tuple(
  fc.constantFrom('```', '~~~', '````'),
  fc.constantFrom('', 'yaml', 'diff', 'text', 'ts', 'markdown'),
  fc.array(listLikeLine, { minLength: 1, maxLength: 12 }),
).map(([fence, info, lines]) => `${fence}${info}\n${lines.join('\n')}\n${fence}`);

/** Indented code: four spaces before every list-like line. */
const indented = fc.array(listLikeLine, { minLength: 1, maxLength: 6 })
  .map(lines => lines.map(line => `    ${line}`).join('\n'));

/** A blockquote holding a list. */
const quotedList = fc.array(listLikeLine, { minLength: 2, maxLength: 10 })
  .map(lines => lines.map(line => `> ${line}`).join('\n'));

/** A prose paragraph. */
const paragraph = fc.array(word, { minLength: 1, maxLength: 12 }).map(words => words.join(' '));

/** A block that must never produce a finding. */
const inertBlock = fc.oneof(fenced, quotedList, paragraph);

/** Join blocks the way a message separates them: blank lines between. */
function join(blocks: readonly string[]): string { return blocks.join('\n\n'); }

describe('lintLists stochastic', () => {

  test('lists inside code fences and blockquotes, among prose, never produce a finding', () => {
    fc.assert(fc.property(fc.array(inertBlock, { minLength: 1, maxLength: 8 }), blocks => {
      expect(lintLists(join(blocks), parse)).toEqual([]);
    }), { numRuns: 300 });
  });

  test('indented code after a paragraph never produces a finding', () => {
    fc.assert(fc.property(paragraph, indented, (para, code) => {
      expect(lintLists(`${para}\n\n${code}`, parse)).toEqual([]);
    }), { numRuns: 200 });
  });

  test('one real numbered list among inert blocks is found exactly once, with its item count', () => {
    fc.assert(fc.property(
      fc.array(inertBlock, { maxLength: 5 }),
      fc.array(inertBlock, { maxLength: 5 }),
      fc.array(word, { minLength: 2, maxLength: 10 }),
      (before, after, items) => {
        const list     = items.map((w, i) => `${String(i + 1)}. ${w}`).join('\n'),
              findings = lintLists(join([...before, list, ...after]), parse);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ kind: 'ordered-list', severity: 'violation', items: items.length });
      }), { numRuns: 300 });
  });

  test('a numbered list longer than ten is never flagged — the squares stop at 🔟', () => {
    fc.assert(fc.property(fc.array(word, { minLength: 11, maxLength: 30 }), items => {
      const list = items.map((w, i) => `${String(i + 1)}. ${w}`).join('\n');
      expect(lintLists(list, parse)).toEqual([]);
    }), { numRuns: 100 });
  });

});
