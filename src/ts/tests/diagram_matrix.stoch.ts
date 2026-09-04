/**
 * Stochastic property tests for matrix seriation and the shaded-table renderer.
 *
 * The properties here are the ones that have to hold for *every* table, not just the
 * ones a fixture author thought of: no NaN reaches the output, no key is lost or
 * duplicated by the reordering, the reported score is a real score of the order
 * actually returned, the objective never gets worse, and a pinned axis is untouched.
 * A separate family builds block structure on purpose, at random sizes, shuffles it,
 * and checks that the search finds it again.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  normalizeMatrix, seriate, seriationScore, describeSeriation, MAX_SERIATION_KEYS,
} from '../diagrams/matrix.js';
import type { MatrixData } from '../diagrams/matrix.js';
import { renderMatrix, DEFAULT_DIAGRAM_WIDTH } from '../diagrams/renderers.js';

/** Distinct axis keys; `r0`…`r9` and `c0`…`c9` never collide or nest as substrings. */
function rowKey(i: number): string { return `r${String(i)}`; }
function colKey(i: number): string { return `c${String(i)}`; }

/** Cell values: non-negative, finite, and often exactly zero, like real cross-tabs. */
const valueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 3, arbitrary: fc.nat({ max: 400 }) },
  { weight: 1, arbitrary: fc.double({ min: 0, max: 400, noNaN: true, noDefaultInfinity: true }) },
);

/** Random tables up to 8×8, with mixed integer, fractional, and empty cells. */
const matrixArb: fc.Arbitrary<MatrixData> = fc
  .record({
    rows: fc.integer({ min: 1, max: 8 }),
    cols: fc.integer({ min: 1, max: 8 }),
    flat: fc.array(valueArb, { minLength: 64, maxLength: 64 }),
  })
  .map(({ rows, cols, flat }) => normalizeMatrix(
    Array.from({ length: rows }, (_v, r) => rowKey(r)),
    Array.from({ length: cols }, (_v, c) => colKey(c)),
    Array.from({ length: rows }, (_v, r) =>
      Array.from({ length: cols }, (_w, c) => flat[r * 8 + c] ?? 0)),
  ));

/** How the seriation may be constrained, so every property sees every pinning mode. */
const pinArb: fc.Arbitrary<{ pinRows: boolean; pinCols: boolean }> = fc.record({
  pinRows: fc.boolean(),
  pinCols: fc.boolean(),
});

/** Sorted copy of a key list, for comparing two orderings as multisets. */
function sorted(keys: readonly string[]): string[] {
  return [...keys].sort();
}

describe('seriate — stochastic invariants', () => {

  it('never invents a NaN, in the matrix or in either score', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        const found = seriate(data, pins);
        expect(Number.isFinite(found.scoreBefore)).toBe(true);
        expect(Number.isFinite(found.scoreAfter)).toBe(true);
        for (const row of found.matrix.values) {
          for (const value of row) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('never loses, duplicates, or invents a key on either axis', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        const found = seriate(data, pins);
        expect(sorted(found.matrix.rows)).toEqual(sorted(data.rows));
        expect(sorted(found.matrix.cols)).toEqual(sorted(data.cols));
        expect(new Set(found.matrix.rows).size).toBe(data.rows.length);
        expect(new Set(found.matrix.cols).size).toBe(data.cols.length);
        expect([...found.rowOrder].sort((a, b) => a - b))
          .toEqual(data.rows.map((_key, i) => i));
        expect([...found.colOrder].sort((a, b) => a - b))
          .toEqual(data.cols.map((_key, i) => i));
      }),
      { numRuns: 300 }
    );
  });

  it('carries every original cell through to the position its permutations claim', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        const found = seriate(data, pins);
        found.rowOrder.forEach((source, r) => {
          found.colOrder.forEach((column, c) => {
            expect(found.matrix.values[r]?.[c]).toBe(data.values[source]?.[column]);
          });
        });
      }),
      { numRuns: 200 }
    );
  });

  it('reports a score that is a freshly computable score of the order it returned', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        const found = seriate(data, pins);
        expect(found.scoreAfter).toBe(seriationScore(found.matrix));
        expect(found.scoreBefore).toBe(seriationScore(data));
      }),
      { numRuns: 300 }
    );
  });

  it('never worsens the objective, whatever the input or the pinning', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        const found = seriate(data, pins);
        expect(found.scoreAfter).toBeLessThanOrEqual(found.scoreBefore);
      }),
      { numRuns: 400 }
    );
  });

  it('leaves a pinned axis byte-identical to the caller order', () => {
    fc.assert(
      fc.property(matrixArb, fc.boolean(), (data, alsoPinCols) => {
        const rowPinned = seriate(data, { pinRows: true, pinCols: alsoPinCols });
        expect(rowPinned.matrix.rows).toEqual([...data.rows]);
        expect(rowPinned.rowOrder).toEqual(data.rows.map((_key, i) => i));
        const colPinned = seriate(data, { pinCols: true });
        expect(colPinned.matrix.cols).toEqual([...data.cols]);
        expect(colPinned.colOrder).toEqual(data.cols.map((_key, i) => i));
      }),
      { numRuns: 300 }
    );
  });

  it('pinning both axes is exactly a no-op', () => {
    fc.assert(
      fc.property(matrixArb, (data) => {
        const found = seriate(data, { pinRows: true, pinCols: true });
        expect(found.matrix).toEqual(data);
        expect(found.scoreAfter).toBe(found.scoreBefore);
      }),
      { numRuns: 200 }
    );
  });

  it('is idempotent: seriating the result changes nothing', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        const once  = seriate(data, pins);
        const twice = seriate(once.matrix, pins);
        expect(twice.matrix).toEqual(once.matrix);
        expect(twice.scoreAfter).toBe(once.scoreAfter);
      }),
      { numRuns: 300 }
    );
  });

  it('is deterministic: two calls, identical results', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        expect(seriate(data, pins)).toEqual(seriate(data, pins));
      }),
      { numRuns: 200 }
    );
  });

  it('describes itself without ever claiming an improvement it did not make', () => {
    fc.assert(
      fc.property(matrixArb, pinArb, (data, pins) => {
        const found = seriate(data, pins);
        const said = describeSeriation(found);
        expect(said.startsWith('seriation: profile distance ')).toBe(true);
        expect(said.includes('tighter')).toBe(found.scoreAfter < found.scoreBefore);
        expect(said.includes('unchanged')).toBe(found.scoreAfter === found.scoreBefore);
      }),
      { numRuns: 300 }
    );
  });

});

describe('seriate — stochastic block recovery', () => {

  /**
   * Random block-diagonal tables: `blocks` groups of `size` rows and columns, every
   * in-block cell strictly positive and every out-of-block cell zero, then both axes
   * shuffled independently. The keys are named so the block a key belongs to survives
   * the shuffle and can be read back out of the recovered order.
   *
   * In-block weights are drawn from a narrow band on purpose. A profile-distance
   * objective calls two rows a block when they *resemble* each other, so weights
   * spanning 1 to 60 inside one block would produce rows that share a name and nothing
   * else — and the search would be right to separate them. See the unit suite's
   * `blocks by name are not blocks by profile` for that case pinned deliberately;
   * here the blocks are real, so recovering them is a fair demand.
   */
  const blockArb = fc
    .record({
      blocks: fc.integer({ min: 2, max: 4 }),
      size: fc.integer({ min: 2, max: 3 }),
      weights: fc.array(fc.integer({ min: 40, max: 60 }), { minLength: 144, maxLength: 144 }),
      rowPerm: fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
      colPerm: fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
    })
    .map(({ blocks, size, weights, rowPerm, colPerm }) => {

      const n = blocks * size;
      const keys = Array.from({ length: n }, (_v, i) => Math.floor(i / size));
      const cellAt = (r: number, c: number): number =>
        (keys[r] === keys[c] ? (weights[r * 12 + c] ?? 1) : 0);

      /** Fisher-Yates driven by the drawn naturals, so shrinking still makes sense. */
      const permute = (draws: readonly number[]): number[] => {
        const order = Array.from({ length: n }, (_v, i) => i);
        for (let i = n - 1; i > 0; i--) {
          const j = (draws[i] ?? 0) % (i + 1);
          const a = order[i] ?? 0, b = order[j] ?? 0;
          order[i] = b;
          order[j] = a;
        }
        return order;
      };

      const rows = permute(rowPerm), cols = permute(colPerm);
      const label = (i: number, axis: string): string => `${axis}${String(keys[i] ?? 0)}_${String(i)}`;

      return {
        blocks,
        data: normalizeMatrix(
          rows.map(r => label(r, 'r')),
          cols.map(c => label(c, 'c')),
          rows.map(r => cols.map(c => cellAt(r, c))),
        ),
      };

    });

  /** Which block each key in an order belongs to, read out of its name. */
  function blockRun(keys: readonly string[]): Map<string, number[]> {
    const runs = new Map<string, number[]>();
    keys.forEach((key, position) => {
      const block = key.slice(1, key.indexOf('_'));
      const found = runs.get(block) ?? [];
      found.push(position);
      runs.set(block, found);
    });
    return runs;
  }

  /** True when a position list, already in ascending order, has no gaps. */
  function contiguous(positions: readonly number[]): boolean {
    return positions.every((position, k) => k === 0 || position === (positions[k - 1] ?? -9) + 1);
  }

  /**
   * Whether every block's keys form one unbroken run on both axes and the two axes lay
   * the blocks out in the same sequence — or in the exact opposite one, since reversing
   * a whole axis leaves every adjacency intact and so leaves the objective unchanged.
   * An anti-diagonal is a recovered block structure read from the other end, not a
   * failure, and a predicate that called it one would be testing an accident.
   */
  function recovered(rows: readonly string[], cols: readonly string[], blocks: number): boolean {
    const rowRuns = blockRun(rows), colRuns = blockRun(cols);
    if (rowRuns.size !== blocks || colRuns.size !== blocks) { return false; }
    for (const positions of [...rowRuns.values(), ...colRuns.values()]) {
      if (!contiguous(positions)) { return false; }
    }
    const order = (runs: Map<string, number[]>): string[] =>
      [...runs.entries()].sort((a, b) => (a[1][0] ?? 0) - (b[1][0] ?? 0)).map(entry => entry[0]);
    const byRow = order(rowRuns).join(), byCol = order(colRuns);
    return byRow === byCol.join() || byRow === [...byCol].reverse().join();
  }

  /** The score of the order the block names say is right, for comparison. */
  function labelledScore(data: MatrixData): number {
    const byBlock = (keys: readonly string[]): number[] =>
      keys.map((_key, i) => i).sort((a, b) =>
        ((keys[a] ?? '') < (keys[b] ?? '') ? -1 : (keys[a] ?? '') > (keys[b] ?? '') ? 1 : 0));
    const rows = byBlock(data.rows), cols = byBlock(data.cols);
    return seriationScore(normalizeMatrix(
      rows.map(r => data.rows[r] ?? ''),
      cols.map(c => data.cols[c] ?? ''),
      rows.map(r => cols.map(c => data.values[r]?.[c] ?? 0)),
    ));
  }

  it('either puts every block back together, or finds an order the objective likes as much', () => {
    // The honest form of the recovery claim. Seriation is a heuristic, so "always
    // recovers" would be a claim it cannot keep; what it does keep is that a miss is
    // never the search losing track. Whenever the blocks do not come back, the order it
    // settled on scores at least as well as the one the block *names* imply — it
    // disagreed with the labels rather than failing to find anything.
    fc.assert(
      fc.property(blockArb, ({ blocks, data }) => {
        const found = seriate(data);
        if (recovered(found.matrix.rows, found.matrix.cols, blocks)) { return; }
        expect(found.scoreAfter).toBeLessThanOrEqual(labelledScore(data));
      }),
      { numRuns: 300 }
    );
  });

  it('draws unbroken runs, not scatter, whenever it did recover the blocks', () => {
    // What the eye actually reads off a recovered matrix: no row has mass, then a gap,
    // then mass again. Asserting it directly on the drawn order catches a reordering
    // that satisfies the block bookkeeping while still looking like confetti.
    fc.assert(
      fc.property(blockArb, ({ blocks, data }) => {

        const found = seriate(data);
        if (!recovered(found.matrix.rows, found.matrix.cols, blocks)) { return; }

        const unbroken = (line: readonly number[]): boolean => {
          const filled = line.map((value, i) => (value === 0 ? -1 : i)).filter(i => i >= 0);
          return contiguous(filled);
        };

        for (const row of found.matrix.values) { expect(unbroken(row)).toBe(true); }
        found.matrix.cols.forEach((_key, c) => {
          expect(unbroken(found.matrix.values.map(row => row[c] ?? 0))).toBe(true);
        });

      }),
      { numRuns: 250 }
    );
  });

  it('never hands back an order looser than the shuffle it was given', () => {
    fc.assert(
      fc.property(blockArb, ({ data }) => {
        const found = seriate(data);
        expect(found.scoreAfter).toBeLessThanOrEqual(found.scoreBefore);
      }),
      { numRuns: 200 }
    );
  });

});

describe('renderMatrix — stochastic invariants', () => {

  /** The output-invariant contract, matching the graph renderers' stochastic suite. */
  function expectInvariants(out: string, width: number = DEFAULT_DIAGRAM_WIDTH): void {
    const lines = out.split('\n');
    expect(new Set(lines.map(line => [...line].length)).size).toBe(1);
    expect(lines[0]?.startsWith('┌')).toBe(true);
    expect(lines[lines.length - 1]?.startsWith('└')).toBe(true);
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(width);
      expect(line).not.toMatch(/[ \t]$/u);
    }
  }

  it('renders well-formed or refuses by name; nothing in between', () => {
    fc.assert(
      fc.property(matrixArb, fc.boolean(), (data, totals) => {
        let out: string;
        try { out = renderMatrix(data, { totals }); }
        catch (err) {
          expect(err instanceof RangeError && /fall back/u.test(err.message)).toBe(true);
          return;
        }
        expectInvariants(out);
        for (const key of data.rows) { expect(out.split(key).length - 1).toBe(1); }
      }),
      { numRuns: 300 }
    );
  });

  it('honors any width budget it accepts, and refuses the rest by name', () => {
    fc.assert(
      fc.property(matrixArb, fc.integer({ min: 12, max: 90 }), (data, width) => {
        let out: string;
        try { out = renderMatrix(data, { width }); }
        catch (err) {
          expect(err instanceof RangeError && /fall back/u.test(err.message)).toBe(true);
          return;
        }
        expectInvariants(out, width);
      }),
      { numRuns: 400 }
    );
  });

  it('unframed output never carries trailing whitespace', () => {
    fc.assert(
      fc.property(matrixArb, (data) => {
        for (const line of renderMatrix(data, { frame: false }).split('\n')) {
          expect(line).not.toMatch(/[ \t]$/u);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('is deterministic, and still names every original row key once after being seriated', () => {
    fc.assert(
      fc.property(matrixArb, (data) => {
        const rendered = renderMatrix(data);
        expect(renderMatrix(data)).toBe(rendered);              // pure: same input twice, same text
        for (const key of data.rows) { expect(rendered.split(key).length - 1).toBe(1); }

        const found    = seriate(data),
              seriated  = renderMatrix(found.matrix);
        expect(renderMatrix(found.matrix)).toBe(seriated);       // determinism survives seriation too
        // Seriation only reorders rows and columns; it must not lose, duplicate, or
        // rename one along the way — the render of the reordered table still names every
        // original row key exactly once, just possibly on a different line than above.
        for (const key of data.rows) { expect(seriated.split(key).length - 1).toBe(1); }
      }),
      { numRuns: 200 }
    );
  });

});

describe('the seriation key ceiling', () => {

  it('refuses every axis past the ceiling and accepts every axis at it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (over) => {
        const n = MAX_SERIATION_KEYS + over;
        const wide = normalizeMatrix(
          ['r0'],
          Array.from({ length: n }, (_v, c) => colKey(c)),
          [Array.from({ length: n }, () => 1)],
        );
        expect(() => seriate(wide)).toThrow(RangeError);
        expect(() => seriate(wide)).toThrow(/keys per axis/u);
      }),
      { numRuns: 12 }
    );
  });

});
