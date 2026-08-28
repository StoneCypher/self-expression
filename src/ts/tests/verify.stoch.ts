/**
 * Stochastic property tests for the charts/verify.ts checklist validator.
 *
 * The central property is renderer/validator agreement: for any generated marker
 * multiset at any legal nesting, a block whose items are listed verbatim and whose
 * summary comes from the real `renderChecklistSummary` must verify clean — the two
 * modules are independent implementations of the same convention, so a disagreement
 * between them is a bug in one of them by construction. The complementary property is
 * that a corrupted percent never verifies clean, so the validator cannot be passing
 * vacuously.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderChecklistSummary } from '../charts/checklist.js';
import type { ChecklistItem } from '../charts/checklist.js';
import { verifyChecklist } from '../charts/verify.js';

// A pool spanning all three buckets plus the bucket-flexible ship, wide enough that
// generated sets exercise the inline form, the block form, and wrapped bucket lines.
const MARKER_POOL = [
  '✅', '💯', '🤖', '⏳', '🌐', '🛠️', '🛰️', '🔜', '🦥', '🌗', '🫨', '🦡',
  '❌', '🚫', '🦗', '⏭️', '⏸️', '❗', '⚠️', '⏰', '😴', '🧠', '🛳️',
] as const;

const itemsArb: fc.Arbitrary<ChecklistItem[]> = fc
  .array(fc.constantFrom(...MARKER_POOL), { minLength: 1, maxLength: 120 })
  .map(markers => markers.map(marker => ({ marker })));

const indentArb = fc.constantFrom(0, 2, 4);

/** Composes the block exactly as a session surfaces it: items, blank line, real summary. */
function compose(items: readonly ChecklistItem[], indents: readonly number[]): string {
  const lines = items.map((item, i) =>
    `${' '.repeat(indents[i] ?? 0)}- ${item.marker} item ${String(i)}`);
  return `${lines.join('\n')}\n\n${renderChecklistSummary(items)}`;
}

describe('verifyChecklist — stochastic renderer agreement', () => {

  it('any renderer-produced checklist verifies clean, at any legal indentation', () => {
    fc.assert(
      fc.property(
        itemsArb.chain(items =>
          fc.tuple(fc.constant(items), fc.array(indentArb, { minLength: items.length, maxLength: items.length }))),
        ([items, indents]) => {
          const verdict = verifyChecklist(compose(items, indents));
          expect(verdict.failures).toEqual([]);
          expect(verdict.ok).toBe(true);
          expect(verdict.itemCount).toBe(items.length);
        }
      ),
      { numRuns: 250 }
    );
  });

  it('a corrupted percent never verifies clean', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const block = compose(items, items.map(() => 0));
        const match = /\((\d+)%\)/.exec(block);
        expect(match).not.toBeNull();
        const stated = Number((match as RegExpExecArray)[1]);
        const corrupted = block.replace(`(${String(stated)}%)`, `(${String((stated + 1) % 101)}%)`);
        expect(verifyChecklist(corrupted).ok).toBe(false);
      }),
      { numRuns: 250 }
    );
  });

  it('deleting one item line never verifies clean when the summary is left alone', () => {
    fc.assert(
      fc.property(
        // Two markers minimum so a deletion leaves at least one item behind.
        itemsArb.filter(items => items.length >= 2),
        (items) => {
          const block = compose(items, items.map(() => 0));
          const corrupted = block.split('\n').filter((_, i) => i !== 0).join('\n');
          expect(verifyChecklist(corrupted).ok).toBe(false);
        }
      ),
      { numRuns: 250 }
    );
  });

});
