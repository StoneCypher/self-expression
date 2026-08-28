/**
 * Stochastic property tests for diagrams/grid.ts.
 *
 * Pins the property the whole drawing layer leans on: junction resolution is closed
 * under drawing order — the same set of lines drawn in any order yields the same
 * grid, because arm-mask OR is commutative, associative, and idempotent. Also pins
 * the render-shape invariants (framed rectangle, no trailing whitespace) across
 * arbitrary line content.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { makeGrid, drawHline, drawVline, renderLines, renderGrid, drawBox } from '../diagrams/grid.js';
import type { CharGrid } from '../diagrams/grid.js';

const SIZE = 12;

interface Segment { horizontal: boolean; a: number; b: number; at: number }

const segmentArb: fc.Arbitrary<Segment> = fc.record({
  horizontal: fc.boolean(),
  a: fc.integer({ min: 0, max: SIZE - 1 }),
  b: fc.integer({ min: 0, max: SIZE - 1 }),
  at: fc.integer({ min: 0, max: SIZE - 1 }),
});

function draw(grid: CharGrid, seg: Segment): void {
  if (seg.horizontal) { drawHline(grid, seg.a, seg.b, seg.at); }
  else { drawVline(grid, seg.at, seg.a, seg.b); }
}

function drawnAll(segments: readonly Segment[]): string[] {
  const grid = makeGrid(SIZE, SIZE);
  for (const seg of segments) { draw(grid, seg); }
  return grid.cells.map(row => row.join(''));
}

describe('junction resolution — stochastic invariants', () => {

  it('is closed under drawing order: any order of the same lines, the same grid', () => {
    fc.assert(
      fc.property(fc.array(segmentArb, { minLength: 1, maxLength: 12 }), (segments) => {
        const forward = drawnAll(segments);
        const reversed = drawnAll([...segments].reverse());
        const regrouped = drawnAll([
          ...segments.filter(s => s.horizontal),
          ...segments.filter(s => !s.horizontal),
        ]);
        expect(reversed).toEqual(forward);
        expect(regrouped).toEqual(forward);
      }),
      { numRuns: 200 }
    );
  });

  it('is idempotent: drawing the same lines twice changes nothing', () => {
    fc.assert(
      fc.property(fc.array(segmentArb, { minLength: 1, maxLength: 8 }), (segments) => {
        expect(drawnAll([...segments, ...segments])).toEqual(drawnAll(segments));
      }),
      { numRuns: 200 }
    );
  });

  it('every drawn cell is a light box-drawing character; untouched cells stay spaces', () => {
    fc.assert(
      fc.property(fc.array(segmentArb, { minLength: 1, maxLength: 12 }), (segments) => {
        for (const row of drawnAll(segments)) {
          for (const ch of row) {
            expect('─│┌┐└┘├┤┬┴┼ ').toContain(ch);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderLines — stochastic invariants', () => {

  const lineArb = fc.array(
    fc.constantFrom(...'abcdefgh │─┼.'.split('')),
    { minLength: 0, maxLength: 20 },
  ).map(chars => chars.join(''));

  it('framed output is always a rectangle with no trailing whitespace', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 10 }), (lines) => {
        const out = renderLines(lines).split('\n');
        const widths = new Set(out.map(l => [...l].length));
        expect(widths.size).toBe(1);
        expect(out).toHaveLength(lines.length + 2);
        for (const line of out) { expect(line).not.toMatch(/[ \t]$/); }
      }),
      { numRuns: 200 }
    );
  });

  it('unframed output never carries trailing whitespace either', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 10 }), (lines) => {
        for (const line of renderLines(lines, { frame: false }).split('\n')) {
          expect(line).not.toMatch(/[ \t]$/);
        }
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderGrid — stochastic crop invariant', () => {

  it('a box drawn anywhere renders to the same framed string regardless of canvas slack', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 2, max: 4 }),
        (x, y, w, h) => {
          const tight = makeGrid(x + w, y + h);
          drawBox(tight, x, y, w, h);
          const slack = makeGrid(x + w + 9, y + h + 5);
          drawBox(slack, x, y, w, h);
          expect(renderGrid(slack)).toBe(renderGrid(tight));
        },
      ),
      { numRuns: 200 }
    );
  });

});
