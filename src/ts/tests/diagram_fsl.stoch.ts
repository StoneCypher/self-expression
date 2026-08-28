/**
 * Stochastic property tests for diagrams/fsl.ts: the round-trip contract with the
 * charts side's `renderFsl` emitter, across arbitrary transition lists — the same
 * edge sequence comes back out, actions become labels, and the active-state
 * `**bold**` marks always strip cleanly no matter which state carries them.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseFsl } from '../diagrams/fsl.js';
import { renderFsl } from '../charts/timeline.js';
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
