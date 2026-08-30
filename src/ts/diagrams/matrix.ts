/**
 * Seriation for two-way tables: the {@link MatrixData} model, the reordering that makes
 * block structure visible, and the objective that says whether any structure was
 * actually found.
 *
 * This module exists because of a specific observation. A throwaway drawing of a
 * 1010-issue tracker — release milestones on one axis, labels on the other, cells
 * shaded by share — turned out to reveal the project's real thematic staging, but only
 * after the label axis was reordered so that similar columns sat next to each other.
 * Nothing told the drawing what any label *meant*; the reordering alone recovered the
 * structure. The reordering is therefore the capability, and the shading is only how it
 * is read.
 *
 * The other half of that observation was a failure. Sorting the *milestone* axis
 * improved the objective score and destroyed the picture, because a reader already
 * knows what order releases come in and an "improved" ordering that shuffles them is
 * noise wearing a better score. So {@link SeriationOptions.pinRows} and
 * {@link SeriationOptions.pinCols} are not conveniences: an axis whose order already
 * carries meaning must be freezable, or the whole mechanism is unusable on exactly the
 * data that motivated it.
 *
 * The objective is a **profile-distance path length** — see {@link seriationScore} —
 * and it is minimized, so lower is better. It splits exactly into a row term and a
 * column term, and permuting one axis leaves the other axis's term untouched (a
 * column-to-column distance sums over *all* rows, so the row order cannot change it).
 * That separation is what lets the two axes be optimized independently and what makes
 * the adjacent-swap deltas exact rather than approximate.
 *
 * Grid-hostile text is rejected here for the same reason `model.ts` rejects it: the
 * keys become row labels and rotated column labels on a single-width character grid,
 * and a double-width glyph silently shears every column to its right.
 *
 * Pure: no I/O, no store access, no clock, no randomness. Identical input always
 * produces the identical ordering.
 *
 * @see ./renderers.js
 * @see ./model.js
 */

import { requireGridSafe } from './model.js';

/**
 * The largest number of keys {@link seriate} accepts on either axis.
 *
 * Seriation builds a full key-by-key distance matrix per axis, which costs
 * O(rows² × cols + cols² × rows); 256 keeps the worst case in the tens of
 * milliseconds. It is a cost ceiling, not a legibility one — the renderer has its own,
 * much lower, legibility threshold.
 */
export const MAX_SERIATION_KEYS = 256;

/** How many barycentre passes one sweep runs before giving up on convergence. */
export const DEFAULT_SERIATION_PASSES = 24;

/** How many sweep-then-hill-climb rounds {@link seriate} runs before stopping. */
export const DEFAULT_SERIATION_ROUNDS = 8;

/**
 * The fallback menu every matrix refusal names, so a caller whose table will not draw
 * has a next action rather than a dead end. The graph forms' `DIAGRAM_FALLBACKS` menu
 * is wrong here — a matrix has no adjacency list and no mermaid form — so matrices
 * carry their own.
 *
 * @see ./layout.js
 */
export const MATRIX_FALLBACKS: string =
  'fall back to a narrower slice (the top rows by total, or fewer columns), a plain '
  + 'ranked list of the largest cells, or one axis at a time through the labeled-bar '
  + "form (renderComparison / render_rows)";

/**
 * A validated two-way table: two key axes and the value at every crossing.
 *
 * Values are counts, shares, durations — whatever quantity the crossing carries. They
 * are required to be finite and non-negative because the barycentre step takes a
 * value-weighted mean of positions, and a negative weight makes that mean land outside
 * the axis it is supposed to index.
 */
export interface MatrixData {
  /** The row keys, top to bottom, each unique and drawable on a single-width grid. */
  rows: readonly string[];
  /** The column keys, left to right, each unique and drawable on a single-width grid. */
  cols: readonly string[];
  /** Row-major cell values: `values[r][c]` is the value at `rows[r]` × `cols[c]`. */
  values: readonly (readonly number[])[];
}

/** The marginal sums of a {@link MatrixData}: where the mass actually sits. */
export interface MatrixTotals {
  /** One total per row, in row order. */
  rowTotals: readonly number[];
  /** One total per column, in column order. */
  colTotals: readonly number[];
  /** The sum of every cell; equals the sum of either margin. */
  grand: number;
}

/** How {@link seriate} is allowed to reorder, and how hard it is allowed to look. */
export interface SeriationOptions {
  /**
   * Freeze the row axis in the caller's order (default false). Set this whenever the
   * rows already carry an order a reader understands — releases, weeks, severity
   * levels — since a better objective score is not worth an unreadable axis.
   */
  pinRows?: boolean | undefined;
  /** Freeze the column axis in the caller's order (default false); see `pinRows`. */
  pinCols?: boolean | undefined;
  /**
   * Barycentre passes per sweep, default {@link DEFAULT_SERIATION_PASSES}. A pass is
   * one row ordering plus one column ordering; sweeping stops early when a pass moves
   * nothing.
   */
  maxPasses?: number | undefined;
  /**
   * Sweep-then-hill-climb rounds, default {@link DEFAULT_SERIATION_ROUNDS}. A round is
   * kept only when it lowers the recomputed objective, so rounds stop at a fixed point
   * rather than at this cap — which is what makes seriation idempotent.
   */
  maxRounds?: number | undefined;
}

/**
 * What {@link seriate} found: the reordered table, the permutations that produced it,
 * and the objective before and after so the caller can judge whether the reordering
 * earned its keep.
 */
export interface SeriationResult {
  /** The table with both axes permuted into the discovered order. */
  matrix: MatrixData;
  /** For each output row position, the index it came from in the input's row axis. */
  rowOrder: readonly number[];
  /** For each output column position, the index it came from in the input's column axis. */
  colOrder: readonly number[];
  /** {@link seriationScore} of the input order; lower is more blocked. */
  scoreBefore: number;
  /** {@link seriationScore} of `matrix`; never greater than `scoreBefore`. */
  scoreAfter: number;
  /** Sweep-then-hill-climb rounds actually run, at most `maxRounds`. */
  rounds: number;
  /** Barycentre passes actually run across all rounds. */
  passes: number;
  /** Adjacent swaps the hill-climb accepted across all rounds. */
  swaps: number;
  /** Whether the row axis was pinned, echoed back for reporting. */
  pinnedRows: boolean;
  /** Whether the column axis was pinned, echoed back for reporting. */
  pinnedCols: boolean;
}

/**
 * Asserts an internally-derived value is present. Index reads are `T | undefined` under
 * `noUncheckedIndexedAccess`, and every read in this file is bounded by construction,
 * so a miss is a bug in this module rather than caller error.
 *
 * @throws {Error} If `value` is undefined.
 */
function req<T>(value: T | undefined, what: string): T {
  if (value === undefined) { throw new Error(`internal: ${what} was undefined`); }
  return value;
}

/** One cell of a validated matrix, with the bounds already guaranteed by the caller. */
function cell(data: MatrixData, row: number, col: number): number {
  return req(req(data.values[row], 'value row')[col], 'value');
}

/** Validates one axis's keys: non-empty, unique, and drawable on the character grid. */
function requireAxisDrawable(keys: readonly string[], axis: string): void {
  if (keys.length === 0) {
    throw new RangeError(`a matrix needs at least one ${axis} key`);
  }
  const seen = new Set<string>();
  for (const key of keys) {
    if (key === '') { throw new RangeError(`a matrix ${axis} key must be non-empty`); }
    requireGridSafe(key, `${axis} key '${key}'`);
    if (seen.has(key)) {
      throw new RangeError(`duplicate ${axis} key '${key}'; matrix keys must be unique`);
    }
    seen.add(key);
  }
}

/**
 * Builds a validated {@link MatrixData} from two key axes and a row-major value grid,
 * checking everything seriation and rendering rely on: unique non-empty grid-safe keys,
 * an exactly rectangular value grid, and finite non-negative values.
 *
 * @param rows   the row keys, top to bottom
 * @param cols   the column keys, left to right
 * @param values one array per row key, each holding one number per column key, in the
 *                same units throughout (counts, shares, seconds — the model does not
 *                care which, only that they are comparable)
 *
 * @example
 *   normalizeMatrix(['v0.1', 'v0.2'], ['infra', 'docs'], [[12, 1], [2, 9]])
 *   // => { rows: ['v0.1', 'v0.2'], cols: ['infra', 'docs'], values: [[12, 1], [2, 9]] }
 *
 * @throws {RangeError} If either axis is empty, a key is empty, duplicated, or fails
 *                        {@link requireGridSafe}; if `values` has a different number of
 *                        rows than `rows` or any row a different length than `cols`; or
 *                        if any value is not a finite non-negative number.
 * @see seriate
 * @see requireGridSafe
 */
export function normalizeMatrix(
  rows: readonly string[],
  cols: readonly string[],
  values: readonly (readonly number[])[],
): MatrixData {

  requireAxisDrawable(rows, 'row');
  requireAxisDrawable(cols, 'column');

  if (values.length !== rows.length) {
    throw new RangeError(
      `this matrix has ${String(rows.length)} row keys but ${String(values.length)} value `
      + 'rows; the value grid must carry exactly one row per row key'
    );
  }

  const grid = values.map((row, r) => {
    if (row.length !== cols.length) {
      throw new RangeError(
        `row '${req(rows[r], 'row key')}' has ${String(row.length)} values but there are `
        + `${String(cols.length)} column keys; the value grid must be rectangular`
      );
    }
    return row.map((value, c) => {
      if (!Number.isFinite(value)) {
        throw new RangeError(
          `the cell at '${req(rows[r], 'row key')}' × '${req(cols[c], 'column key')}' is `
          + `${String(value)}; matrix values must be finite numbers`
        );
      }
      if (value < 0) {
        throw new RangeError(
          `the cell at '${req(rows[r], 'row key')}' × '${req(cols[c], 'column key')}' is `
          + `${String(value)}; matrix values must be non-negative, because seriation `
          + 'weights axis positions by value and a negative weight has no position'
        );
      }
      return value;
    });
  });

  return { rows: [...rows], cols: [...cols], values: grid };

}

/**
 * Sums both margins of a matrix — the numbers the renderer prints alongside the
 * shading, because a density ramp shows shape while the margins carry the mass, and a
 * reader given only shape will over-read a bright cell that holds three items.
 *
 * @example
 *   matrixTotals(normalizeMatrix(['a', 'b'], ['x', 'y'], [[1, 2], [3, 4]]))
 *   // => { rowTotals: [3, 7], colTotals: [4, 6], grand: 10 }
 *
 * @see renderMatrix
 */
export function matrixTotals(data: MatrixData): MatrixTotals {
  const rowTotals = data.values.map(row => row.reduce((sum, value) => sum + value, 0));
  const colTotals = data.cols.map((_key, c) =>
    data.values.reduce((sum, row) => sum + req(row[c], 'value'), 0));
  return { rowTotals, colTotals, grand: rowTotals.reduce((sum, value) => sum + value, 0) };
}

/**
 * The seriation objective: the total profile distance walked along both axes, summing
 * the squared Euclidean distance between every pair of adjacent rows and every pair of
 * adjacent columns. **Lower is better** — a small score means neighbours resemble their
 * neighbours, which is what a block structure looks like numerically.
 *
 * Chosen over crossing counts or correlation measures for three reasons. It is defined
 * on the values themselves rather than on a thresholded binary version of them, so a
 * heavy cell and a light one are not the same evidence. It separates exactly into a row
 * term and a column term, which is what makes the adjacent-swap deltas below exact. And
 * it is a path length, so it is directly comparable before and after a reordering — the
 * ratio of the two is the honest answer to "did this find anything".
 *
 * The score is not normalized, so it scales with the matrix's magnitude and size.
 * Compare a score against another score of the *same* table, never against a threshold.
 *
 * @param data a validated matrix, in whatever order is being scored
 *
 * @example
 *   const scattered = normalizeMatrix(['a', 'b'], ['x', 'y', 'z'], [[9, 0, 9], [0, 9, 0]]);
 *   const grouped   = normalizeMatrix(['a', 'b'], ['x', 'z', 'y'], [[9, 9, 0], [0, 0, 9]]);
 *   seriationScore(scattered)   // => 567
 *   seriationScore(grouped)     // => 405 — the same table, its like columns adjacent
 *
 * @see seriate
 */
export function seriationScore(data: MatrixData): number {
  const rows = data.rows.length, cols = data.cols.length;
  let total = 0;
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const diff = cell(data, r - 1, c) - cell(data, r, c);
      total += diff * diff;
    }
  }
  for (let c = 1; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const diff = cell(data, r, c - 1) - cell(data, r, c);
      total += diff * diff;
    }
  }
  return total;
}

/** Squared-Euclidean distance between every pair of rows, indexed by input row number. */
function rowDistances(data: MatrixData): number[][] {
  const rows = data.rows.length, cols = data.cols.length;
  const dist = Array.from({ length: rows }, () => new Array<number>(rows).fill(0));
  for (let a = 0; a < rows; a++) {
    for (let b = a + 1; b < rows; b++) {
      let sum = 0;
      for (let c = 0; c < cols; c++) {
        const diff = cell(data, a, c) - cell(data, b, c);
        sum += diff * diff;
      }
      req(dist[a], 'distance row')[b] = sum;
      req(dist[b], 'distance row')[a] = sum;
    }
  }
  return dist;
}

/** See {@link rowDistances}: the same pairwise distances down the other axis. */
function colDistances(data: MatrixData): number[][] {
  const rows = data.rows.length, cols = data.cols.length;
  const dist = Array.from({ length: cols }, () => new Array<number>(cols).fill(0));
  for (let a = 0; a < cols; a++) {
    for (let b = a + 1; b < cols; b++) {
      let sum = 0;
      for (let r = 0; r < rows; r++) {
        const diff = cell(data, r, a) - cell(data, r, b);
        sum += diff * diff;
      }
      req(dist[a], 'distance row')[b] = sum;
      req(dist[b], 'distance row')[a] = sum;
    }
  }
  return dist;
}

/** One entry of a precomputed pairwise distance matrix. */
function distance(dist: readonly (readonly number[])[], a: number, b: number): number {
  return req(req(dist[a], 'distance row')[b], 'distance');
}

/** The objective's contribution from one axis under one ordering of that axis's keys. */
function pathLength(order: readonly number[], dist: readonly (readonly number[])[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    total += distance(dist, req(order[i - 1], 'order'), req(order[i], 'order'));
  }
  return total;
}

/** `0, 1, … n-1` — the identity permutation, i.e. the caller's own order. */
function identity(n: number): number[] {
  return Array.from({ length: n }, (_v, i) => i);
}

/** Whether two permutations are element-for-element equal. */
function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * One barycentre step for a single axis: order that axis's keys by the value-weighted
 * mean of the *other* axis's current positions.
 *
 * A key with no mass at all has no meaningful barycentre, so it keeps its current
 * position instead of collapsing to zero and dragging every empty key to the top edge.
 * Ties break on current position, which makes the step deterministic without relying on
 * sort stability.
 *
 * @param order      the axis being reordered, as input indices in current display order
 * @param otherOrder the other axis's current display order, whose positions are the
 *                    coordinates the mean is taken over
 * @param weight     the cell value at (key from `order`, key from `otherOrder`)
 */
function byBarycentre(
  order: readonly number[],
  otherOrder: readonly number[],
  weight: (key: number, otherKey: number) => number,
): number[] {

  const bary = order.map(key => {
    let mass = 0, moment = 0;
    otherOrder.forEach((otherKey, position) => {
      const w = weight(key, otherKey);
      mass += w;
      moment += w * position;
    });
    return { mass, moment };
  });

  const centre = (slot: number): number => {
    const { mass, moment } = req(bary[slot], 'barycentre');
    return mass === 0 ? slot : moment / mass;
  };

  const slots = identity(order.length);
  slots.sort((a, b) => (centre(a) - centre(b)) || (a - b));
  return slots.map(slot => req(order[slot], 'order'));

}

/**
 * Repeated barycentre passes over both axes, returning the best-scoring order seen
 * rather than the last one. Best-of is what makes the sweep safe: barycentre iteration
 * is not monotone and can cycle with period two, so keeping the best — with the
 * starting order in the candidate set — guarantees the sweep never hands back something
 * worse than it was given.
 */
function sweep(
  data: MatrixData,
  startRows: readonly number[],
  startCols: readonly number[],
  rowDist: readonly (readonly number[])[],
  colDist: readonly (readonly number[])[],
  pinRows: boolean,
  pinCols: boolean,
  maxPasses: number,
): { rows: number[]; cols: number[]; passes: number } {

  let rows = [...startRows], cols = [...startCols];
  let bestRows = [...rows], bestCols = [...cols];
  let best = pathLength(rows, rowDist) + pathLength(cols, colDist);
  let passes = 0;

  for (let pass = 0; pass < maxPasses; pass++) {

    let moved = false;

    if (!pinRows) {
      const next = byBarycentre(rows, cols, (r, c) => cell(data, r, c));
      if (!sameOrder(next, rows)) { rows = next; moved = true; }
    }
    if (!pinCols) {
      const next = byBarycentre(cols, rows, (c, r) => cell(data, r, c));
      if (!sameOrder(next, cols)) { cols = next; moved = true; }
    }

    passes = pass + 1;

    const score = pathLength(rows, rowDist) + pathLength(cols, colDist);
    if (score < best) { best = score; bestRows = [...rows]; bestCols = [...cols]; }

    if (!moved) { break; }

  }

  return { rows: bestRows, cols: bestCols, passes };

}

/**
 * Adjacent-swap hill-climb on one axis: repeatedly swap neighbouring keys whenever
 * doing so strictly shortens the path, until a full pass finds no improvement.
 *
 * Swapping positions `i` and `i+1` changes only the two path edges that reach outside
 * the pair — the edge between them is symmetric and survives — so each candidate costs
 * four table lookups rather than a rescore. Only strict improvements are taken, so the
 * descent is monotone and cannot cycle; the pass cap is a bound, not the usual exit.
 *
 * @returns how many swaps were accepted, which is zero exactly when the order arrives
 *          already at a local optimum
 */
function hillClimb(order: number[], dist: readonly (readonly number[])[]): number {

  const n = order.length;
  let swaps = 0;

  for (let pass = 0; pass < n; pass++) {

    let moved = false;

    for (let i = 0; i + 1 < n; i++) {
      const a = req(order[i], 'order'), b = req(order[i + 1], 'order');
      const left  = i > 0     ? req(order[i - 1], 'order') : -1;
      const right = i + 2 < n ? req(order[i + 2], 'order') : -1;
      const before = (left  < 0 ? 0 : distance(dist, left, a))
                   + (right < 0 ? 0 : distance(dist, b, right));
      const after  = (left  < 0 ? 0 : distance(dist, left, b))
                   + (right < 0 ? 0 : distance(dist, a, right));
      if (after < before) {
        order[i] = b;
        order[i + 1] = a;
        swaps += 1;
        moved = true;
      }
    }

    if (!moved) { break; }

  }

  return swaps;

}

/**
 * Relocation pass on one axis: lift each key out and reinsert it wherever the path gets
 * shortest, until a full pass finds no improvement.
 *
 * This exists because {@link hillClimb} alone is measurably too weak. Adjacent swaps
 * cannot move a key past a cohesive group, since every single step of that journey is
 * uphill even when the destination is far downhill — and that is exactly the shape of
 * the common failure, one member of a pair stranded on the wrong side of another block.
 * Measured over 4800 random shuffled block-diagonal tables (2–5 blocks of 2–4 keys),
 * the barycentre sweep plus adjacent swaps recovered every block in 4567 of them, and
 * in only 1368 of the 1600 two-key-block cases; adding this pass took those to 4795 and
 * 1596. The difference is not only in the count. Without this pass, all 233 misses were
 * genuine search failures — orders the objective itself rates *worse* than the block
 * order the search failed to find. With it, all five remaining misses score at least as
 * well as the block order, so a miss became a disagreement about the answer rather than
 * a failure to look. The stochastic suite asserts that as a property rather than
 * leaving it as an anecdote.
 *
 * Reinserting a key where it already was scores a gain of exactly zero, and only
 * strictly positive gains are taken, so a settled order is left alone.
 *
 * The gain is an incremental one — three edge lengths against three others, never the
 * whole path — so it is positive whenever those six numbers say so, even on a table
 * where the difference is far too small to survive being added back into the total.
 * That is why {@link seriate} does not treat "this pass moved something" as progress:
 * it keeps a round only when the recomputed objective really fell.
 *
 * @returns how many relocations were accepted; zero means the order arrived settled
 */
function relocate(order: number[], dist: readonly (readonly number[])[]): number {

  const n = order.length;
  const link = (a: number, b: number): number => (a < 0 || b < 0 ? 0 : distance(dist, a, b));
  let moves = 0;

  for (let pass = 0; pass < n; pass++) {

    let moved = false;

    for (let from = 0; from < n; from++) {

      const key  = req(order[from], 'order');
      const prev = from > 0     ? req(order[from - 1], 'order') : -1;
      const next = from + 1 < n ? req(order[from + 1], 'order') : -1;
      const freed = link(prev, key) + link(key, next) - link(prev, next);

      const rest = [...order.slice(0, from), ...order.slice(from + 1)];
      let bestGain = 0, bestAt = -1;

      for (let at = 0; at <= rest.length; at++) {
        const left  = at > 0            ? req(rest[at - 1], 'order') : -1;
        const right = at < rest.length  ? req(rest[at], 'order')     : -1;
        const gain = freed - (link(left, key) + link(key, right) - link(left, right));
        if (gain > bestGain) { bestGain = gain; bestAt = at; }
      }

      if (bestAt >= 0) {
        rest.splice(bestAt, 0, key);
        order.splice(0, n, ...rest);
        moves += 1;
        moved = true;
      }

    }

    if (!moved) { break; }

  }

  return moves;

}

/** Applies two permutations to a validated matrix, producing the reordered table. */
function permute(
  data: MatrixData,
  rowOrder: readonly number[],
  colOrder: readonly number[],
): MatrixData {
  return {
    rows: rowOrder.map(r => req(data.rows[r], 'row key')),
    cols: colOrder.map(c => req(data.cols[c], 'column key')),
    values: rowOrder.map(r => colOrder.map(c => cell(data, r, c))),
  };
}

/** Guards one of the two effort caps, which must be a positive integer. */
function requirePositiveInteger(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`seriate's ${what} must be a positive integer; received ${String(value)}`);
  }
}

/**
 * Reorders a matrix's axes so that similar rows sit beside similar rows and similar
 * columns beside similar columns, turning a scattered table into visible blocks — and
 * reports the objective before and after so the caller can tell whether it worked
 * rather than assuming it did.
 *
 * The search is a barycentre sweep (order each axis by the value-weighted mean position
 * of the other, alternating until nothing moves) followed by a local search on
 * {@link seriationScore} — adjacent swaps, then single-key relocation, which the swaps
 * alone measurably cannot substitute for — repeated as rounds until a round fails to
 * lower the objective, which is then recomputed from scratch on the reordered table
 * rather than tracked incrementally. Terminating at a fixed point is deliberate: it
 * makes seriation idempotent, so a table can be seriated twice without drifting. The
 * recomputation is what makes that true even when the values span enough orders of
 * magnitude that a local gain rounds away to nothing in the total.
 *
 * It is a heuristic, not a solver, and it is not told what any key *means*. It can
 * settle on an order that scores better than the one a human would have drawn, and on
 * a table with no structure it will still produce *an* order. That is precisely why the
 * scores come back with the result: a shaded matrix looks structured either way, and
 * the ratio of the two scores is the only thing that says whether it is.
 *
 * Pinning an axis leaves it byte-identical to the caller's order — not
 * nearly-identical, not re-sorted-then-restored. Pin any axis whose order a reader
 * already understands; a milestone axis sorted by similarity scores better and reads
 * worse, which is the whole reason this option exists.
 *
 * `scoreAfter` is guaranteed not to exceed `scoreBefore`. Both are computed by
 * {@link seriationScore} on real tables, so `seriationScore(result.matrix)` reproduces
 * `scoreAfter` exactly; in the vanishingly unlikely event the search's own arithmetic
 * disagreed with that recomputation, the reordering is discarded and the input order is
 * returned instead.
 *
 * @param data    the table to reorder, validated on the way in
 * @param options pinning and the two effort caps
 *
 * @example
 *   const tracker = normalizeMatrix(
 *     ['v0.1', 'v0.2', 'v0.3'],
 *     ['docs', 'infra', 'tests'],
 *     [[1, 12, 3], [6, 2, 20], [30, 0, 5]],
 *   );
 *   const found = seriate(tracker, { pinRows: true });
 *   found.matrix.rows                          // => ['v0.1', 'v0.2', 'v0.3'] — pinned
 *   found.scoreAfter <= found.scoreBefore      // => true
 *
 * @throws {RangeError} If `data` fails {@link normalizeMatrix}, either axis exceeds
 *                        {@link MAX_SERIATION_KEYS} keys, or an effort cap is not a
 *                        positive integer.
 * @see seriationScore
 * @see describeSeriation
 * @see renderMatrix
 */
export function seriate(data: MatrixData, options?: SeriationOptions): SeriationResult {

  const source = normalizeMatrix(data.rows, data.cols, data.values);
  const rowCount = source.rows.length, colCount = source.cols.length;

  if (rowCount > MAX_SERIATION_KEYS || colCount > MAX_SERIATION_KEYS) {
    throw new RangeError(
      `seriation handles at most ${String(MAX_SERIATION_KEYS)} keys per axis; this matrix `
      + `is ${String(rowCount)} × ${String(colCount)}. ${MATRIX_FALLBACKS}`
    );
  }

  const pinnedRows = options?.pinRows ?? false;
  const pinnedCols = options?.pinCols ?? false;
  const maxPasses  = options?.maxPasses ?? DEFAULT_SERIATION_PASSES;
  const maxRounds  = options?.maxRounds ?? DEFAULT_SERIATION_ROUNDS;

  requirePositiveInteger(maxPasses, 'maxPasses');
  requirePositiveInteger(maxRounds, 'maxRounds');

  const scoreBefore = seriationScore(source);
  const rowDist = rowDistances(source);
  const colDist = colDistances(source);

  let rowOrder = identity(rowCount), colOrder = identity(colCount);
  let bestScore = scoreBefore;
  let rounds = 0, passes = 0, swaps = 0;

  for (let round = 0; round < maxRounds; round++) {

    const swept = sweep(source, rowOrder, colOrder, rowDist, colDist, pinnedRows, pinnedCols, maxPasses);
    const tryRows = swept.rows, tryCols = swept.cols;
    passes += swept.passes;

    let moved = 0;
    if (!pinnedRows) { moved += hillClimb(tryRows, rowDist) + relocate(tryRows, rowDist); }
    if (!pinnedCols) { moved += hillClimb(tryCols, colDist) + relocate(tryCols, colDist); }

    rounds = round + 1;

    // A round is kept only when the objective, recomputed from scratch on the
    // reordered table, actually fell. The sweep and the two local searches all decide
    // in *incremental* arithmetic — a handful of edge lengths, never the whole path —
    // and on a table whose values span enough orders of magnitude a strictly positive
    // local gain can round away to nothing once it is added back into the total. Such
    // a round rearranges keys without improving anything, so the search never settles
    // and only the round cap stops it, leaving an order that depends on how many
    // rounds were allowed. Requiring a real improvement makes the accepted rounds
    // strictly monotone, so the search stops at a fixed point instead of a cap — which
    // is what makes seriating an already-seriated table a no-op.
    const roundScore = seriationScore(permute(source, tryRows, tryCols));
    if (!(roundScore < bestScore)) { break; }

    rowOrder  = tryRows;
    colOrder  = tryCols;
    bestScore = roundScore;
    swaps    += moved;

  }

  let matrix = permute(source, rowOrder, colOrder);
  let scoreAfter = seriationScore(matrix);

  if (scoreAfter > scoreBefore) {
    rowOrder = identity(rowCount);
    colOrder = identity(colCount);
    matrix = source;
    scoreAfter = scoreBefore;
    swaps = 0;
  }

  return {
    matrix, rowOrder, colOrder,
    scoreBefore, scoreAfter,
    rounds, passes, swaps,
    pinnedRows, pinnedCols,
  };

}

/** Formats one objective score compactly: exact when integral, four figures otherwise. */
function formatScore(value: number): string {
  return Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : value.toPrecision(4);
}

/**
 * One plain-text line summarizing what a {@link seriate} call did, for printing beneath
 * the drawing it produced.
 *
 * A shaded matrix is persuasive whether or not the reordering found anything, which is
 * exactly the failure mode this line exists to prevent: it says how much tighter the
 * table got and which axes were allowed to move, so a reader can discount a picture
 * that was already as blocked as it was going to get.
 *
 * @param result a completed seriation
 *
 * @example
 *   // a nine-key table with three real blocks, handed over in shuffled order
 *   describeSeriation(seriate(scrambled))
 *   // => 'seriation: profile distance 5863 -> 1709 (71% tighter); both axes reordered'
 *
 * @example
 *   // the same table with its rows frozen: less to gain, and honest about it
 *   describeSeriation(seriate(scrambled, { pinRows: true }))
 *   // => 'seriation: profile distance 5863 -> 3795 (35% tighter); rows pinned to
 *   //     caller order, columns reordered'
 *
 * @see seriate
 */
export function describeSeriation(result: SeriationResult): string {

  const axes = result.pinnedRows && result.pinnedCols ? 'both axes pinned to caller order'
    : result.pinnedRows ? 'rows pinned to caller order, columns reordered'
    : result.pinnedCols ? 'columns pinned to caller order, rows reordered'
    : 'both axes reordered';

  if (result.scoreAfter < result.scoreBefore) {
    const tighter = Math.round((1 - result.scoreAfter / result.scoreBefore) * 100);
    return `seriation: profile distance ${formatScore(result.scoreBefore)} -> `
      + `${formatScore(result.scoreAfter)} (${String(tighter)}% tighter); ${axes}`;
  }

  return `seriation: profile distance ${formatScore(result.scoreBefore)}, unchanged — no `
    + `reordering this search reached improved on the input order; ${axes}`;

}
