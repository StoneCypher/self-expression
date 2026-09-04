/**
 * Stochastic property tests for diagrams/fsl.ts: the round-trip contract with the
 * charts side's `renderFsl` emitter, across arbitrary transition lists — the same
 * edge sequence comes back out, actions become labels, and the active-state
 * `**bold**` marks always strip cleanly no matter which state carries them.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseFsl } from '../diagrams/fsl.js';
import { renderFsl, fslName } from '../charts/timeline.js';
import type { FslTransition } from '../charts/timeline.js';

/** Subset-safe word: letters only, so no token ever collides with the grammar. */
const wordArb = fc.array(
  fc.constantFrom(...'abcdefghijklmnop'.split('')),
  { minLength: 1, maxLength: 8 },
).map(chars => chars.join(''));

const transitionArb: fc.Arbitrary<FslTransition> = fc.record({
  from: wordArb,
  to: wordArb,
  action: fc.option(wordArb, { nil: undefined }),
}).map(t => (t.action === undefined
  ? { from: t.from, to: t.to }
  : { from: t.from, to: t.to, action: t.action }));

const transitionsArb = fc.array(transitionArb, { minLength: 1, maxLength: 12 });

/** The edge list `parseFsl` should produce for a transition list. */
function expectedEdges(transitions: readonly FslTransition[]): { from: string; to: string; label?: string }[] {
  return transitions.map(t => (t.action === undefined
    ? { from: t.from, to: t.to }
    : { from: t.from, to: t.to, label: t.action }));
}

describe('parseFsl ∘ renderFsl — stochastic round trip', () => {

  it('returns exactly the transition sequence renderFsl was given', () => {
    fc.assert(
      fc.property(transitionsArb, (transitions) => {
        expect(parseFsl(renderFsl(transitions)).edges).toEqual(expectedEdges(transitions));
      }),
      { numRuns: 300 }
    );
  });

  it('the active-state bold marks strip regardless of which state is active', () => {
    fc.assert(
      fc.property(transitionsArb, fc.nat(), (transitions, pick) => {
        const first = transitions[pick % transitions.length];
        if (first === undefined) { return; }
        const active = pick % 2 === 0 ? first.from : first.to;
        expect(parseFsl(renderFsl(transitions, active)).edges).toEqual(expectedEdges(transitions));
      }),
      { numRuns: 300 }
    );
  });

  it('node inference collects each distinct state exactly once', () => {
    fc.assert(
      fc.property(transitionsArb, (transitions) => {
        const nodes = parseFsl(renderFsl(transitions)).nodes.map(n => n.id);
        const distinct = new Set(nodes);
        expect(distinct.size).toBe(nodes.length);
        const mentioned = new Set(transitions.flatMap(t => [t.from, t.to]));
        expect(distinct).toEqual(mentioned);
      }),
      { numRuns: 300 }
    );
  });

});

/**
 * A single character or short substring that forces {@link fslName} to quote a name:
 * whitespace (including the tokenizer's own word-break characters), a single or double
 * quote, `*` (collides with the `**bold**` marker), `;` (the statement terminator), the
 * arrow token, or a backslash (the escape character quoting introduces).
 */
const triggerArb = fc.constantFrom(' ', '\t', '\n', "'", '"', '*', ';', '->', '\\');

/** Letters only, so padding around a trigger never accidentally forms a second one. */
const safeLetterArb = fc.constantFrom(...'abcdefghijklmnop'.split(''));

/**
 * A state name guaranteed to need {@link fslName}'s quoting: safe letters with exactly
 * one trigger substring spliced in at a random position. `diagram_fsl.stoch.ts`'s
 * original `wordArb` is deliberately letters-only so the parser round-trip property
 * holds; this is the adversarial counterpart issue review flagged as missing — names
 * built by string concatenation, wide enough to hit every character `renderFsl` must
 * now escape rather than emit raw.
 */
const dangerousNameArb = fc.tuple(
  fc.array(safeLetterArb, { minLength: 0, maxLength: 4 }),
  triggerArb,
  fc.array(safeLetterArb, { minLength: 0, maxLength: 4 }),
).map(([before, trigger, after]) => [...before, trigger, ...after].join(''));

/**
 * Reads one `"`-delimited, backslash-escaped token starting at `text[at]`, decoding it
 * independently of {@link fslName}'s own escaping logic — a hand-rolled inverse, so a
 * property built on it is checking `renderFsl`'s actual output rather than confirming
 * `fslName` agrees with itself.
 *
 * @param text the rendered FSL text
 * @param at   the index of the opening `"`
 * @returns the decoded content and the index just past the closing `"`
 * @throws {Error} If `text[at]` is not `"`, or the quoted token never closes
 */
function readQuotedToken(text: string, at: number): { value: string; end: number } {
  if (text[at] !== '"') { throw new Error(`readQuotedToken: expected '"' at ${String(at)}`); }
  let i = at + 1, value = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { value += text[i + 1] ?? ''; i += 2; continue; }
    if (ch === '"') { return { value, end: i + 1 }; }
    value += ch; i += 1;
  }
  throw new Error('readQuotedToken: unterminated quoted token');
}

describe('renderFsl escapes dangerous state names — stochastic', () => {

  it('a name needing quoting decodes back to the exact name, with no unquoted grammar leak', () => {
    fc.assert(
      fc.property(dangerousNameArb, dangerousNameArb, (from, to) => {
        const rendered = renderFsl([{ from, to }]);

        // Every dangerous name is embedded as a quoted token — never bare — so the
        // statement starts with '"' and the two tokens are joined by the literal
        // grammar this renderer promises, nothing else.
        const first  = readQuotedToken(rendered, 0);
        expect(first.value).toBe(from);
        expect(rendered.slice(first.end, first.end + 4)).toBe(' -> ');

        const second = readQuotedToken(rendered, first.end + 4);
        expect(second.value).toBe(to);
        expect(rendered.slice(second.end)).toBe(';');
      }),
      { numRuns: 300 }
    );
  });

  it('composes exactly with the action and bold-mark grammar renderFsl already promises', () => {
    fc.assert(
      fc.property(dangerousNameArb, dangerousNameArb, fc.option(wordArb, { nil: undefined }),
        (from, to, action) => {
          const rendered   = renderFsl(action === undefined ? [{ from, to }] : [{ from, to, action }]),
                actionPart = action === undefined ? '' : ` '${action}'`;
          expect(rendered).toBe(`${fslName(from)}${actionPart} -> ${fslName(to)};`);
        }),
      { numRuns: 300 }
    );
  });

  it('a chain through a dangerous connecting name merges into one statement without duplicating it', () => {
    fc.assert(
      fc.property(dangerousNameArb, wordArb, wordArb, (mid, a, c) => {
        const rendered = renderFsl([{ from: a, to: mid }, { from: mid, to: c }]);

        // One connected statement, not two — the shared state is emitted once. (Not
        // checked by counting ';' in the whole string: `mid` may itself contain a
        // literal ';' inside its own quoted, escaped form, which would inflate a naive
        // count. The exact-equality check below is the real assertion — a chain that
        // failed to merge would render as two ';'-terminated statements instead of one.)
        expect(rendered).toBe(`${fslName(a)} -> ${fslName(mid)} -> ${fslName(c)};`);
      }),
      { numRuns: 200 }
    );
  });

  it('a name safe by fslName\'s own rule is never quoted, matching the plain-name examples above', () => {
    fc.assert(
      fc.property(wordArb, wordArb, (from, to) => {
        const rendered = renderFsl([{ from, to }]);
        expect(rendered).toBe(`${from} -> ${to};`);
        expect(rendered).not.toContain('"');
      }),
      { numRuns: 200 }
    );
  });

});
