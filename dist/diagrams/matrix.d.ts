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
/**
 * The largest number of keys {@link seriate} accepts on either axis.
 *
 * Seriation builds a full key-by-key distance matrix per axis, which costs
 * O(rows² × cols + cols² × rows); 256 keeps the worst case in the tens of
 * milliseconds. It is a cost ceiling, not a legibility one — the renderer has its own,
 * much lower, legibility threshold.
 */
export declare const MAX_SERIATION_KEYS = 256;
/** How many barycentre passes one sweep runs before giving up on convergence. */
export declare const DEFAULT_SERIATION_PASSES = 24;
/** How many sweep-then-hill-climb rounds {@link seriate} runs before stopping. */
export declare const DEFAULT_SERIATION_ROUNDS = 8;
/**
 * The fallback menu every matrix refusal names, so a caller whose table will not draw
 * has a next action rather than a dead end. The graph forms' `DIAGRAM_FALLBACKS` menu
 * is wrong here — a matrix has no adjacency list and no mermaid form — so matrices
 * carry their own.
 *
 * @see ./layout.js
 */
export declare const MATRIX_FALLBACKS: string;
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
export declare function normalizeMatrix(rows: readonly string[], cols: readonly string[], values: readonly (readonly number[])[]): MatrixData;
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
export declare function matrixTotals(data: MatrixData): MatrixTotals;
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
export declare function seriationScore(data: MatrixData): number;
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
export declare function seriate(data: MatrixData, options?: SeriationOptions): SeriationResult;
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
export declare function describeSeriation(result: SeriationResult): string;
//# sourceMappingURL=matrix.d.ts.map