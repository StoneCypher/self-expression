/**
 * Unit tests for the matrix model, the seriation search, and the shaded-table
 * renderer.
 *
 * The load-bearing test here is `recovers a shuffled block-diagonal matrix`: it builds
 * a table whose structure is known by construction, destroys the evidence by shuffling
 * both axes independently, and then asks whether seriation puts it back — which is the
 * only claim this module actually makes. The rest pin the contract around it (pinning
 * is absolute, the objective never worsens, seriating twice changes nothing).
 */

import {
  normalizeMatrix, matrixTotals, seriationScore, seriate, describeSeriation,
  MAX_SERIATION_KEYS,
} from '../diagrams/matrix.js';
import type { MatrixData } from '../diagrams/matrix.js';
import {
  renderMatrix, MATRIX_RAMP, MAX_MATRIX_ROWS,
} from '../diagrams/renderers.js';

/** The running example: a tiny release-by-theme tracker. */
const TRACKER: MatrixData = normalizeMatrix(
  ['v0.1', 'v0.2', 'v0.3'],
  ['infra', 'tests', 'docs', 'refactor'],
  [[12, 3, 1, 0], [2, 20, 6, 0], [0, 5, 30, 9]],
);

/**
 * A 9×9 table with three genuine 3×3 blocks on the diagonal and nothing off it, cell
 * weights varied inside each block so the recovery is not a symmetry accident.
 */
function blockDiagonal(): MatrixData {
  const rows: string[] = [], cols: string[] = [];
  for (let block = 0; block < 3; block++) {
    for (let k = 0; k < 3; k++) {
      rows.push(`r${String(block)}${String(k)}`);
      cols.push(`c${String(block)}${String(k)}`);
    }
  }
  const values = Array.from({ length: 9 }, (_v, r) => Array.from({ length: 9 }, (_w, c) =>
    Math.floor(r / 3) === Math.floor(c / 3) ? 5 + ((r * 3 + c) % 7) : 0));
  return normalizeMatrix(rows, cols, values);
}

/** A deterministic shuffle: an LCG-driven Fisher-Yates, so failures reproduce exactly. */
function shuffle(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_v, i) => i);
  let state = seed;
  for (let i = n - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    const a = out[i] ?? 0, b = out[j] ?? 0;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Applies two permutations to a matrix, producing the scrambled presentation order. */
function scramble(data: MatrixData, rowPerm: readonly number[], colPerm: readonly number[]): MatrixData {
  return normalizeMatrix(
    rowPerm.map(r => data.rows[r] ?? ''),
    colPerm.map(c => data.cols[c] ?? ''),
    rowPerm.map(r => colPerm.map(c => (data.values[r] ?? [])[c] ?? 0)),
  );
}

/**
 * Where each block's keys landed, given keys named `<letter><block><member>`.
 * Returns one sorted position list per block id.
 */
function blockPositions(keys: readonly string[]): number[][] {
  const found: number[][] = [[], [], []];
  keys.forEach((key, position) => {
    const block = Number(key[1]);
    (found[block] ?? []).push(position);
  });
  return found;
}

/** True when a sorted position list is a run of consecutive integers. */
function contiguous(positions: readonly number[]): boolean {
  return positions.every((position, k) => k === 0 || position === (positions[k - 1] ?? -9) + 1);
}

describe('normalizeMatrix', () => {

  test('accepts a rectangular table and hands back independent copies', () => {
    const values = [[1, 2], [3, 4]];
    const data = normalizeMatrix(['a', 'b'], ['x', 'y'], values);
    expect(data.rows).toEqual(['a', 'b']);
    expect(data.cols).toEqual(['x', 'y']);
    expect(data.values).toEqual([[1, 2], [3, 4]]);
    (values[0] ?? [])[0] = 99;
    expect(data.values[0]?.[0]).toBe(1);
  });

  test('an empty axis is refused by name', () => {
    expect(() => normalizeMatrix([], ['x'], [])).toThrow(/at least one row key/u);
    expect(() => normalizeMatrix(['a'], [], [[]])).toThrow(/at least one column key/u);
  });

  test('duplicate keys are refused, naming the repeat', () => {
    expect(() => normalizeMatrix(['a', 'a'], ['x'], [[1], [2]])).toThrow(/duplicate row key 'a'/u);
    expect(() => normalizeMatrix(['a'], ['x', 'x'], [[1, 2]])).toThrow(/duplicate column key 'x'/u);
  });

  test('grid-hostile keys are refused, same vocabulary as the graph model', () => {
    expect(() => normalizeMatrix(['🎉'], ['x'], [[1]])).toThrow(RangeError);
    expect(() => normalizeMatrix(['a'], ['x\ny'], [[1]])).toThrow(/control character or newline/u);
  });

  test('an empty key is refused', () => {
    expect(() => normalizeMatrix([''], ['x'], [[1]])).toThrow(/must be non-empty/u);
  });

  test('a value grid with the wrong number of rows is refused', () => {
    expect(() => normalizeMatrix(['a', 'b'], ['x'], [[1]]))
      .toThrow(/2 row keys but 1 value rows/u);
  });

  test('a ragged value grid is refused, naming the row', () => {
    expect(() => normalizeMatrix(['a', 'b'], ['x', 'y'], [[1, 2], [3]]))
      .toThrow(/row 'b' has 1 values but there are 2 column keys/u);
  });

  test('non-finite values are refused', () => {
    expect(() => normalizeMatrix(['a'], ['x'], [[Number.NaN]])).toThrow(/must be finite/u);
    expect(() => normalizeMatrix(['a'], ['x'], [[Number.POSITIVE_INFINITY]])).toThrow(/must be finite/u);
  });

  test('negative values are refused, and the message says why', () => {
    expect(() => normalizeMatrix(['a'], ['x'], [[-1]]))
      .toThrow(/non-negative, because seriation weights axis positions by value/u);
  });

});

describe('matrixTotals', () => {

  test('sums both margins and the grand total', () => {
    expect(matrixTotals(normalizeMatrix(['a', 'b'], ['x', 'y'], [[1, 2], [3, 4]])))
      .toEqual({ rowTotals: [3, 7], colTotals: [4, 6], grand: 10 });
  });

  test('the tracker margins are what the renderer prints', () => {
    expect(matrixTotals(TRACKER)).toEqual({
      rowTotals: [16, 28, 44], colTotals: [14, 28, 37, 9], grand: 88,
    });
  });

});

describe('seriationScore', () => {

  test('grouping like columns lowers the score on the same data', () => {
    const scattered = normalizeMatrix(['a', 'b'], ['x', 'y', 'z'], [[9, 0, 9], [0, 9, 0]]);
    const grouped   = normalizeMatrix(['a', 'b'], ['x', 'z', 'y'], [[9, 9, 0], [0, 0, 9]]);
    expect(seriationScore(scattered)).toBe(567);
    expect(seriationScore(grouped)).toBe(405);
  });

  test('a single cell has no adjacent pairs, so no distance to walk', () => {
    expect(seriationScore(normalizeMatrix(['a'], ['x'], [[7]]))).toBe(0);
  });

});

describe('seriate — the block-recovery property', () => {

  test('recovers a shuffled block-diagonal matrix on both axes', () => {

    const base = blockDiagonal();
    const scrambled = scramble(base, shuffle(9, 7), shuffle(9, 91));

    // The shuffle really did destroy the picture, or the test proves nothing.
    expect(scrambled.rows).not.toEqual(base.rows);
    expect(scrambled.cols).not.toEqual(base.cols);

    const found = seriate(scrambled);

    const rowBlocks = blockPositions(found.matrix.rows);
    const colBlocks = blockPositions(found.matrix.cols);

    // Every block's three rows land in a run, and so do its three columns.
    for (const block of [0, 1, 2]) {
      expect(rowBlocks[block]).toHaveLength(3);
      expect(colBlocks[block]).toHaveLength(3);
      expect(contiguous(rowBlocks[block] ?? [])).toBe(true);
      expect(contiguous(colBlocks[block] ?? [])).toBe(true);
    }

    // And the two axes lay the blocks out in the same sequence, which is what makes it
    // *diagonal* rather than merely clustered. Either sequence may run backwards:
    // reversing a whole axis preserves every adjacency, so the objective cannot tell
    // a diagonal from an anti-diagonal and neither reading is more correct.
    const byRowStart = [0, 1, 2].sort((a, b) => (rowBlocks[a]?.[0] ?? 0) - (rowBlocks[b]?.[0] ?? 0));
    const byColStart = [0, 1, 2].sort((a, b) => (colBlocks[a]?.[0] ?? 0) - (colBlocks[b]?.[0] ?? 0));
    expect([byColStart.join(), [...byColStart].reverse().join()]).toContain(byRowStart.join());

    // And what the eye reads off the drawing: every row's mass is one unbroken run,
    // never mass, gap, mass. This is the orientation-free statement of "blocks".
    for (const row of found.matrix.values) {
      const filled = row.map((value, c) => (value === 0 ? -1 : c)).filter(c => c >= 0);
      expect(contiguous(filled)).toBe(true);
    }

    expect(found.scoreAfter).toBeLessThan(found.scoreBefore);

  });

  test('blocks by name are not blocks by profile, and the score says which is which', () => {

    // Four rows in two named blocks, but the two members of each block are near
    // opposites: r0_0 is heavy on c0_0's column and r0_1 is heavy on c0_1's. Sharing a
    // label does not make them similar, and a profile-distance objective is right to
    // say so. This is pinned rather than fixed: the number seriate reports is what
    // separates "found real structure" from "found the structure I assumed".
    const labelled = normalizeMatrix(
      ['r0_1', 'r1_2', 'r1_3', 'r0_0'],
      ['c0_1', 'c1_2', 'c1_3', 'c0_0'],
      [[1, 0, 0, 15], [0, 6, 1, 0], [0, 1, 1, 0], [12, 0, 0, 1]],
    );
    const byName = normalizeMatrix(
      ['r0_0', 'r0_1', 'r1_2', 'r1_3'],
      ['c0_0', 'c0_1', 'c1_2', 'c1_3'],
      [[1, 12, 0, 0], [15, 1, 0, 0], [0, 0, 6, 1], [0, 0, 1, 1]],
    );

    const found = seriate(labelled);
    expect(seriationScore(byName)).toBe(1129);
    expect(found.scoreAfter).toBe(870);
    expect(found.scoreAfter).toBeLessThan(seriationScore(byName));

  });

  test('a scrambled block matrix scores far worse than its recovered order', () => {
    const base = blockDiagonal();
    const scrambled = scramble(base, shuffle(9, 7), shuffle(9, 91));
    const found = seriate(scrambled);
    expect(found.scoreBefore).toBe(seriationScore(scrambled));
    expect(found.scoreAfter / found.scoreBefore).toBeLessThan(0.5);
  });

});

describe('seriate — pinning is absolute', () => {

  test('a pinned row axis comes back identical to the input order', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const found = seriate(scrambled, { pinRows: true });
    expect(found.matrix.rows).toEqual(scrambled.rows);
    expect(found.rowOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(found.pinnedRows).toBe(true);
    // The unpinned axis still moved, so the pin is a pin rather than a no-op run.
    expect(found.matrix.cols).not.toEqual(scrambled.cols);
  });

  test('a pinned column axis comes back identical to the input order', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const found = seriate(scrambled, { pinCols: true });
    expect(found.matrix.cols).toEqual(scrambled.cols);
    expect(found.colOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(found.matrix.rows).not.toEqual(scrambled.rows);
  });

  test('pinning both axes changes nothing at all, including the score', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const found = seriate(scrambled, { pinRows: true, pinCols: true });
    expect(found.matrix).toEqual(scrambled);
    expect(found.scoreAfter).toBe(found.scoreBefore);
    expect(found.swaps).toBe(0);
  });

  test('the motivating case: milestones stay in release order while themes cluster', () => {
    const found = seriate(TRACKER, { pinRows: true });
    expect(found.matrix.rows).toEqual(['v0.1', 'v0.2', 'v0.3']);
    expect(found.scoreAfter).toBeLessThanOrEqual(found.scoreBefore);
  });

});

describe('seriate — the reported objective', () => {

  test('never worsens, on structured and unstructured input alike', () => {
    for (const data of [TRACKER, blockDiagonal(), scramble(blockDiagonal(), shuffle(9, 3), shuffle(9, 5))]) {
      for (const options of [{}, { pinRows: true }, { pinCols: true }, { pinRows: true, pinCols: true }]) {
        const found = seriate(data, options);
        expect(found.scoreAfter).toBeLessThanOrEqual(found.scoreBefore);
      }
    }
  });

  test('scoreBefore and scoreAfter are real scores of real orders', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const found = seriate(scrambled);
    expect(found.scoreBefore).toBe(seriationScore(scrambled));
    expect(found.scoreAfter).toBe(seriationScore(found.matrix));
  });

  test('the orders returned are permutations that explain the matrix', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const found = seriate(scrambled);
    expect([...found.rowOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(found.matrix.rows).toEqual(found.rowOrder.map(r => scrambled.rows[r]));
    expect(found.matrix.cols).toEqual(found.colOrder.map(c => scrambled.cols[c]));
  });

});

describe('seriate — idempotence', () => {

  test('seriating an already-seriated matrix changes nothing', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const once  = seriate(scrambled);
    const twice = seriate(once.matrix);
    expect(twice.matrix).toEqual(once.matrix);
    expect(twice.scoreAfter).toBe(once.scoreAfter);
    expect(twice.swaps).toBe(0);
    expect(twice.rounds).toBe(1);
  });

  test('it holds with an axis pinned too', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const once  = seriate(scrambled, { pinRows: true });
    const twice = seriate(once.matrix, { pinRows: true });
    expect(twice.matrix).toEqual(once.matrix);
  });

  /**
   * Regression, found by the stochastic suite. These seven values span 140 orders of
   * magnitude, so the squared distances between the small ones underflow to zero
   * beside the large ones: the local searches kept finding "improvements" worth less
   * than one unit in the last place of a total near 12545, the search never settled,
   * and the round cap decided the answer. Seriating three times gave three orders.
   */
  test('a table spanning 140 orders of magnitude still settles', () => {
    const degenerate = normalizeMatrix(
      ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
      ['c0'],
      [[113], [113], [2.687150443026836e-138], [1.5717277847026288e-162],
        [0], [3.1434555694052576e-162], [1]],
    );
    const once   = seriate(degenerate);
    const twice  = seriate(once.matrix);
    const thrice = seriate(twice.matrix);
    expect(twice.matrix).toEqual(once.matrix);
    expect(thrice.matrix).toEqual(once.matrix);
    expect(twice.swaps).toBe(0);
    expect(twice.rounds).toBe(1);
  });

});

describe('seriate — refusals', () => {

  test('past the key ceiling it refuses, naming the fallbacks', () => {
    const n = MAX_SERIATION_KEYS + 1;
    const wide = normalizeMatrix(
      ['a'],
      Array.from({ length: n }, (_v, i) => `c${String(i)}`),
      [Array.from({ length: n }, () => 1)],
    );
    expect(() => seriate(wide)).toThrow(/at most 256 keys per axis/u);
    expect(() => seriate(wide)).toThrow(/fall back/u);
  });

  test('a non-integer effort cap is refused', () => {
    expect(() => seriate(TRACKER, { maxPasses: 0 })).toThrow(/maxPasses must be a positive integer/u);
    expect(() => seriate(TRACKER, { maxRounds: 1.5 })).toThrow(/maxRounds must be a positive integer/u);
  });

  test('a malformed matrix is refused on the way in', () => {
    expect(() => seriate({ rows: ['a'], cols: ['x'], values: [[-1]] })).toThrow(RangeError);
  });

});

describe('describeSeriation', () => {

  test('an improvement reports both scores and how much tighter', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    expect(describeSeriation(seriate(scrambled)))
      .toBe('seriation: profile distance 5863 -> 1709 (71% tighter); both axes reordered');
  });

  test('a pinned axis is named, so a modest gain is not mistaken for a weak signal', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    expect(describeSeriation(seriate(scrambled, { pinRows: true })))
      .toBe('seriation: profile distance 5863 -> 3795 (35% tighter); rows pinned to caller order, columns reordered');
  });

  test('finding nothing says so rather than dressing up a flat result', () => {
    const found = seriate(TRACKER, { pinRows: true, pinCols: true });
    expect(describeSeriation(found)).toContain('unchanged');
    expect(describeSeriation(found)).toContain('both axes pinned to caller order');
  });

  test('the column-pinned wording is its own', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    expect(describeSeriation(seriate(scrambled, { pinCols: true })))
      .toContain('columns pinned to caller order, rows reordered');
  });

});

describe('renderMatrix', () => {

  test('draws the canonical shaded table', () => {
    expect(renderMatrix(normalizeMatrix(['v0.1', 'v0.2'], ['infra', 'docs'], [[12, 1], [2, 9]]))).toBe(
      '┌─────────────────────┐\n'
      + '│       │ i   │       │\n'
      + '│       │ n d │       │\n'
      + '│       │ f o │       │\n'
      + '│       │ r c │       │\n'
      + '│       │ a s │ total │\n'
      + '│ ──────┼─────┼────── │\n'
      + '│ v0.1  │ █ ░ │    13 │\n'
      + '│ v0.2  │ ░ █ │    11 │\n'
      + '│ ──────┼─────┼────── │\n'
      + '│ total │ 1 1 │    24 │\n'
      + '│       │ 4 0 │       │\n'
      + '└─────────────────────┘'
    );
  });

  test('column keys read downward, bottom-aligned against the rule', () => {
    const lines = renderMatrix(TRACKER, { frame: false }).split('\n');
    const header = lines.slice(0, lines.findIndex(line => line.startsWith('─')));
    // The fourth column key is the longest, so it fills the header top to bottom.
    const fourth = header.map(line => line[14] ?? ' ').join('');
    expect(fourth).toBe('refactor');
  });

  test('the marginal totals carry the mass the shading hides', () => {
    const out = renderMatrix(TRACKER, { frame: false });
    expect(out).toContain('    16');
    expect(out).toContain('    44');
    expect(out).toContain('    88');            // grand total
  });

  test('totals: false drops the margin block entirely', () => {
    const out = renderMatrix(TRACKER, { totals: false, frame: false });
    expect(out).not.toContain('total');
    expect(out).not.toContain('88');
    expect(out.split('\n').filter(line => line.startsWith('─'))).toHaveLength(1);
  });

  test('zero reads as present-and-empty, not as missing', () => {
    const out = renderMatrix(normalizeMatrix(['a'], ['x', 'y'], [[0, 4]]), { frame: false });
    expect(out).toContain(`${MATRIX_RAMP[0] ?? ''} ${MATRIX_RAMP[4] ?? ''}`);
  });

  test('an all-zero table draws entirely at the empty end of the ramp', () => {
    const out = renderMatrix(normalizeMatrix(['a', 'b'], ['x'], [[0], [0]]), { frame: false });
    expect(out).toContain('· ');
    expect(out).not.toContain('█');
  });

  test('unframed output never leaves trailing whitespace', () => {
    for (const line of renderMatrix(TRACKER, { frame: false }).split('\n')) {
      expect(line).not.toMatch(/[ \t]$/u);
    }
  });

  test('framed output is a rectangle of equal-length lines', () => {
    const lines = renderMatrix(TRACKER).split('\n');
    expect(new Set(lines.map(line => [...line].length)).size).toBe(1);
  });

  test('row keys are truncated rather than overflowing the budget', () => {
    const out = renderMatrix(
      normalizeMatrix(['alphabetical', 'betabetabeta'], ['x', 'y'], [[1, 2], [3, 4]]),
      { width: 18, frame: false },
    );
    expect(out).toContain('alph │');
    expect(out).toContain('beta │');
    for (const line of out.split('\n')) { expect([...line].length).toBeLessThanOrEqual(18); }
  });

  test('a caller-supplied label cap is honored even when there is room', () => {
    const out = renderMatrix(
      normalizeMatrix(['alphabetical'], ['x'], [[1]]),
      { labelWidth: 5, frame: false, totals: false },
    );
    expect(out).toContain('alpha │');
  });

  test('the rotated header is capped so one long key cannot run the page', () => {
    const out = renderMatrix(
      normalizeMatrix(['a'], ['abcdefghijklmnop'], [[1]]),
      { colLabelHeight: 4, frame: false },
    );
    expect(out.split('\n').filter(line => line.includes('│')).length).toBeGreaterThan(0);
    expect(out).not.toContain('e');           // only 'abcd' survives the cap
  });

  test('past the row threshold it refuses, naming the fallbacks', () => {
    const tall = normalizeMatrix(
      Array.from({ length: MAX_MATRIX_ROWS + 1 }, (_v, i) => `r${String(i)}`),
      ['x'],
      Array.from({ length: MAX_MATRIX_ROWS + 1 }, () => [1]),
    );
    expect(() => renderMatrix(tall)).toThrow(/past the legibility threshold of 40/u);
    expect(() => renderMatrix(tall)).toThrow(/fall back/u);
  });

  test('a table too wide for the budget refuses rather than wrapping', () => {
    const wide = normalizeMatrix(
      ['a'],
      Array.from({ length: 30 }, (_v, i) => `c${String(i)}`),
      [Array.from({ length: 30 }, () => 1)],
    );
    expect(() => renderMatrix(wide, { width: 40 })).toThrow(/width budget allows 40/u);
    expect(() => renderMatrix(wide, { width: 40 })).toThrow(/fall back/u);
  });

  test('a width under the shared floor is refused by the shared guard', () => {
    expect(() => renderMatrix(TRACKER, { width: 8 }))
      .toThrow(/renderMatrix needs an integer width of at least 12/u);
  });

  test('a custom ramp is used end to end', () => {
    const out = renderMatrix(
      normalizeMatrix(['a'], ['x', 'y'], [[0, 8]]),
      { ramp: ['.', '#'], frame: false, totals: false },
    );
    expect(out).toContain('. #');
  });

  test('a ramp that cannot draw is refused', () => {
    expect(() => renderMatrix(TRACKER, { ramp: ['x'] })).toThrow(/at least two glyphs/u);
    expect(() => renderMatrix(TRACKER, { ramp: ['a', 'bb'] })).toThrow(/must be exactly one/u);
    expect(() => renderMatrix(TRACKER, { ramp: ['a', '🎉'] })).toThrow(RangeError);
  });

  test('a nonsense label cap is refused', () => {
    expect(() => renderMatrix(TRACKER, { labelWidth: 0 }))
      .toThrow(/labelWidth must be a positive integer/u);
    expect(() => renderMatrix(TRACKER, { colLabelHeight: -2 }))
      .toThrow(/colLabelHeight must be a positive integer/u);
  });

  test('non-integer values print as one decimal in the margins', () => {
    const out = renderMatrix(normalizeMatrix(['a'], ['x', 'y'], [[0.5, 1.25]]), { frame: false });
    expect(out).toContain('1.8');
  });

  test('it draws whatever order it is handed — reordering is seriate\'s job', () => {
    const scrambled = scramble(blockDiagonal(), shuffle(9, 7), shuffle(9, 91));
    const drawn = renderMatrix(scrambled, { frame: false });
    const keys = drawn.split('\n').map(line => line.slice(0, 5).trim()).filter(key => key.startsWith('r'));
    expect(keys).toEqual([...scrambled.rows]);
  });

});
