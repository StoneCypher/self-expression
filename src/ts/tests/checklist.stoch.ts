/**
 * Stochastic property tests for the charts/checklist.ts summary line.
 *
 * Validates the invariants the exact-string spec cannot fully exercise: for any
 * generated marker multiset, the count section always partitions and sums to the
 * total, the percent always lands in [0, 100] and matches `round(100*success/total)`,
 * the progress bar is always exactly 10 cells, every icon-list line is sorted by count
 * descending then canonical rank ascending, and the icon list sits inline exactly when
 * it has 8 or fewer distinct markers. Expectations are recomputed independently from
 * `classifyMarker`/`canonicalRank` (already-tested pure dependencies), not by
 * re-deriving `renderChecklistSummary`'s own logic.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderChecklistSummary } from '../charts/checklist.js';
import type { ChecklistItem } from '../charts/checklist.js';
import { classifyMarker, canonicalRank } from '../charts/markers.js';

// A fixed pool spanning all three buckets, small enough that a generated series
// exercises both the inline (<=8 distinct) and block (9+ distinct) forms.
const MARKER_POOL = [
  '✅', '💯', '🤖', '⏳', '🌐', '🛠️', '🛰️', '🔜', '❗', '❌', '🚫', '🌗',
] as const;

const markersArb = fc.array(fc.constantFrom(...MARKER_POOL), { minLength: 1, maxLength: 100 });
const itemsArb: fc.Arbitrary<ChecklistItem[]> = markersArb.map(markers => markers.map(marker => ({ marker })));

/** Parses one `<marker> <count>` icon-list token; markers never contain whitespace. */
function parseEntry(token: string): { marker: string; count: number } {
  const match = /^(\S+) (\d+)$/u.exec(token);
  if (!match) { throw new Error(`not an icon-list token: ${JSON.stringify(token)}`); }
  return { marker: match[1] as string, count: Number(match[2]) };
}

/** All icon-list lines in a rendered summary: the inline remainder (if any) plus every block line. */
function iconLines(rendered: string, inlineHead: string | undefined): string[] {
  const lines = rendered.split('\n');
  const blockLines = lines.slice(2).filter(l => l.length > 0);
  return inlineHead !== undefined ? [inlineHead, ...blockLines] : blockLines;
}

describe('renderChecklistSummary — stochastic invariants', () => {

  it('the count section always partitions and sums to the total', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const rendered = renderChecklistSummary(items);
        const match = /^(\d+)\/(\d+)\/(\d+) items \((\d+)%\)/.exec(rendered);
        expect(match).not.toBeNull();
        const [, s, a, f] = match as unknown as [string, string, string, string];

        const expectedSuccess = items.filter(i => classifyMarker(i.marker, i.bucket) === 'success').length;
        const expectedFailure = items.filter(i => classifyMarker(i.marker, i.bucket) === 'failure').length;
        const expectedActive = items.length - expectedSuccess - expectedFailure;

        expect(Number(s)).toBe(expectedSuccess);
        expect(Number(a)).toBe(expectedActive);
        expect(Number(f)).toBe(expectedFailure);
        expect(Number(s) + Number(a) + Number(f)).toBe(items.length);
      }),
      { numRuns: 300 }
    );
  });

  it('the percent always lands in [0, 100] and matches round(100*success/total)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const rendered = renderChecklistSummary(items);
        const match = /items \((\d+)%\)/.exec(rendered);
        const percent = Number((match as unknown as [string, string])[1]);
        const success = items.filter(i => classifyMarker(i.marker, i.bucket) === 'success').length;
        expect(percent).toBeGreaterThanOrEqual(0);
        expect(percent).toBeLessThanOrEqual(100);
        expect(percent).toBe(Math.round((100 * success) / items.length));
      }),
      { numRuns: 300 }
    );
  });

  it('the progress bar is always exactly 10 cells, drawn from the shade ramp', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const rendered = renderChecklistSummary(items);
        const match = /items \(\d+%\) ([█▓▒░]{10})/.exec(rendered);
        expect(match).not.toBeNull();
        expect([...(match as unknown as [string, string])[1]]).toHaveLength(10);
      }),
      { numRuns: 300 }
    );
  });

  it('the icon list sits inline exactly when it has 8 or fewer distinct (marker, bucket) entries', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const distinct = new Set(items.map(i => `${classifyMarker(i.marker, i.bucket)} ${i.marker}`)).size;
        const rendered = renderChecklistSummary(items);
        const isInline = !rendered.includes('\n');
        expect(isInline).toBe(distinct <= 8);
      }),
      { numRuns: 300 }
    );
  });

  it('every icon-list line is sorted by count descending, then canonical rank ascending', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const rendered = renderChecklistSummary(items);
        const headMatch = /^\d+\/\d+\/\d+ items \(\d+%\) [█▓▒░]{10}(?:  trend [▁▂▃▄▅▆▇█]+)?(?:  (.+))?$/.exec(
          rendered.split('\n')[0] as string
        );
        const inlineRemainder = (headMatch as unknown as [string, string | undefined])[1];

        for (const line of iconLines(rendered, inlineRemainder)) {
          const entries = line.split('  ').map(parseEntry);
          for (let i = 1; i < entries.length; i++) {
            const prev = entries[i - 1] as { marker: string; count: number };
            const curr = entries[i] as { marker: string; count: number };
            if (prev.count !== curr.count) {
              expect(prev.count).toBeGreaterThan(curr.count);
            } else {
              expect(canonicalRank(prev.marker)).toBeLessThanOrEqual(canonicalRank(curr.marker));
            }
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('every rendered icon-list entry count matches the actual item count for that marker+bucket', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const expected = new Map<string, number>();
        for (const item of items) {
          const key = `${classifyMarker(item.marker, item.bucket)} ${item.marker}`;
          expected.set(key, (expected.get(key) ?? 0) + 1);
        }

        const rendered = renderChecklistSummary(items);
        const headMatch = /^\d+\/\d+\/\d+ items \(\d+%\) [█▓▒░]{10}(?:  trend [▁▂▃▄▅▆▇█]+)?(?:  (.+))?$/.exec(
          rendered.split('\n')[0] as string
        );
        const inlineRemainder = (headMatch as unknown as [string, string | undefined])[1];

        const actual = new Map<string, number>();
        for (const line of iconLines(rendered, inlineRemainder)) {
          for (const { marker, count } of line.split('  ').map(parseEntry)) {
            const bucket = classifyMarker(marker); // no override info survives rendering; ok for this pool
            actual.set(`${bucket} ${marker}`, (actual.get(`${bucket} ${marker}`) ?? 0) + count);
          }
        }

        for (const [key, count] of expected) { expect(actual.get(key)).toBe(count); }
        expect(actual.size).toBe(expected.size);
      }),
      { numRuns: 300 }
    );
  });

  it('an empty items array always throws RangeError', () => {
    expect(() => renderChecklistSummary([])).toThrow(RangeError);
  });

});
