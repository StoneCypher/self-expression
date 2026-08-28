/**
 * The status-checklist validator: re-derives a rendered checklist's summary arithmetic
 * from its items and reports any mismatch, so the error-prone parts (bucket partition,
 * percent, progress bar, icon lists) are checked mechanically instead of by eye.
 *
 * A careful port of the original skill's `check-checklist.mjs` — the least janky thing
 * in the old plugin — with two deliberate substitutions: the vocabulary comes from
 * `markers.ts` (the promoted single source of truth) instead of re-reading `markers.md`
 * at runtime, and the expected progress bar comes from `scale.ts`'s `barCells` instead
 * of a re-derived boundary rule. Grapheme handling keeps the original's
 * `Intl.Segmenter` clusters rather than naive string indexing, because many markers are
 * multi-code-point (a base emoji plus U+FE0F VARIATION SELECTOR-16).
 *
 * Checks performed:
 *   - every item's marker exists in the canonical vocabulary
 *   - item indentation is exactly 0 / 2 / 4 spaces
 *   - the stated success/active/failure triple partitions the items, with 🛳️ allowed
 *     to count as success or active (completed vs in progress is not knowable from the
 *     glyph)
 *   - percent = round(100 * success / total)
 *   - the 10-cell progress bar matches the percent, including the anti-aliased
 *     boundary cell
 *   - per-marker icon entries (inline after the bar and/or in the icon block below)
 *     match the actual marker counts, and each icon line is sorted by count,
 *     non-increasing, tiebroken by canonical order
 *   - no icon line exceeds 12 entries
 *   - 8-or-fewer distinct markers stay inline; 9+ move to the block below
 *   - block lines are bucket-homogeneous, appear success → active → failure, and are
 *     blank-separated exactly when any bucket wrapped past 12 entries
 *
 * Not checked (documented limitations, inherited from the original): ship-to-targets
 * destination syntax and the optional visuals.
 *
 * Since issue #20 this module also carries {@link verifyDigest}, the generalization of
 * the same re-derivation to every digest profile in `profiles.ts` — the profile is
 * inferred from the digest line's noun, a checklist digest delegates to
 * {@link verifyChecklist} unchanged, and the icon-list layout checks are shared
 * between the two via one parameterized helper rather than duplicated.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * @see ./markers.ts
 * @see ./scale.ts
 * @see ./checklist.ts
 * @see ./digest.ts
 * @see ./profiles.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
/**
 * The checklist lines out of `text`: the first fenced block's contents when fences
 * exist, otherwise every line.
 *
 * Accepts either a bare checklist block or a Markdown document containing one — the
 * first fence pair wins, matching the original validator's file handling.
 *
 * @example
 *   extractChecklistBlock('intro\n```\n- ✅ done\n```\noutro')  // => ['- ✅ done']
 *   extractChecklistBlock('- ✅ done')                          // => ['- ✅ done']
 */
export declare function extractChecklistBlock(text: string): string[];
/** The summary triple and percent a checklist block states. */
export interface SummaryCounts {
    readonly success: number;
    readonly active: number;
    readonly failure: number;
    readonly percent: number;
}
/**
 * The stated `S/A/F items (P%)` head of a checklist block, or `null` when the block
 * carries no parseable summary line.
 *
 * This is the logger's parse — deliberately looser than {@link verifyChecklist}'s full
 * summary-line match, so a block whose bar or icon list is malformed can still be
 * recorded (and separately flagged by the validator). Matches anywhere in the block,
 * like the original `log-checklist.mjs`.
 *
 * @example
 *   parseSummaryCounts('- ✅ a\n- ❌ b\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1')
 *   // => { success: 1, active: 0, failure: 1, percent: 50 }
 *   parseSummaryCounts('- ✅ a')  // => null
 *
 * @see verifyChecklist
 */
export declare function parseSummaryCounts(block: string): SummaryCounts | null;
/** What {@link verifyChecklist} found. */
export interface ChecklistVerification {
    /** `true` exactly when no check failed. */
    readonly ok: boolean;
    /** How many checklist items were parsed out of the block. */
    readonly itemCount: number;
    /** Every passed check, one `ok: …` line each. */
    readonly passes: readonly string[];
    /** Every failed check, one `FAIL: …` line each. */
    readonly failures: readonly string[];
    /**
     * The human-readable report, formatted exactly as the original validator printed:
     * the parsed-item count, every failure, and a closing verdict line.
     */
    readonly report: string;
}
/**
 * Validates a rendered status checklist against the convention's arithmetic, reporting
 * every mismatch rather than stopping at the first.
 *
 * `text` may be a bare checklist block or a Markdown document containing one fenced
 * block (the first fence pair is used) — see {@link extractChecklistBlock}.
 *
 * @param text the rendered checklist, summary line included
 * @returns every check's outcome plus the formatted report
 *
 * @example
 *   verifyChecklist('- ✅ shipped\n- ❌ broke\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1')
 *   // => { ok: true, itemCount: 2, report: 'ok: 2 items parsed\nok: all checks passed', … }
 *
 * @example
 *   verifyChecklist('- ✅ shipped\n\n1/0/0 items (90%) █████████░  ✅ 1')
 *   // => { ok: false, … }  — the percent says 90 but one success of one item is 100
 *
 * @see ./checklist.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
export declare function verifyChecklist(text: string): ChecklistVerification;
/**
 * Validates a rendered compressed-artifact digest of **any** profile against the
 * general digest grammar, reporting every mismatch rather than stopping at the first —
 * the generalization of {@link verifyChecklist} the compression-mechanic spec calls
 * for (issue #20).
 *
 * The profile is inferred from the digest line's noun, per the fixed-grammar rule that
 * the noun cues the profile (`items` → checklist, `findings`, `options`, `files`,
 * `hits` — see `profiles.ts`). A checklist digest delegates wholesale to
 * {@link verifyChecklist}, so the two validators can never disagree about the
 * deepest-developed profile. For other profiles the checks re-derive what is derivable
 * from the body: marker vocabulary, indentation, the count partition (recomputed from
 * the body's markers for marker-classified profiles; sum-only for the diff profile,
 * whose change kinds a rendered body does not carry), the scalar percent and bar
 * exactly when the profile declares a scalar axis (a fabricated percent on a
 * scalar-less profile is a FAIL), the `+N −M` tail exactly when the profile declares
 * one, and the full set of icon-list layout rules shared with the checklist validator.
 *
 * `text` may be a bare block or a Markdown document containing one fenced block —
 * see {@link extractChecklistBlock}.
 *
 * @param text the rendered artifact, digest line included
 * @returns every check's outcome plus the formatted report, in the same shape
 *   {@link verifyChecklist} returns
 *
 * @example
 *   verifyDigest('- ❗ auth bypass\n- ⚠️ slow query\n\n1/1/0 findings  ❗ 1  ⚠️ 1')
 *   // => { ok: true, itemCount: 2, report: 'ok: 2 findings parsed\nok: all checks passed', … }
 *
 * @example
 *   verifyDigest('- 🔍 a\n- 🔍 b\n\n2/0/0 hits (100%) ██████████  🔍 2')
 *   // => { ok: false, … }  — the results profile has no scalar axis; the percent is fabricated
 *
 * @see verifyChecklist
 * @see ./profiles.ts
 * @see ./digest.ts
 */
export declare function verifyDigest(text: string): ChecklistVerification;
//# sourceMappingURL=verify.d.ts.map