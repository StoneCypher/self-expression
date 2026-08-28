/**
 * The status-checklist summary line, computed instead of imitated.
 *
 * `status-checklists-skill.md` § The summary line spells out, in prose, exactly how the
 * count section, percent, progress bar, optional trend, and per-marker icon list are
 * derived from a checklist's items — and every one of those rules has an edge (the
 * 0.17/0.5/0.83 anti-aliasing boundary, the count-desc-then-canonical-order sort, the
 * 8-vs-9 inline/block split, the 12-entry wrap) that a hand-drawn checklist has
 * historically gotten wrong by eye.
 *
 * Since issue #20 reframed the summary line as the checklist **profile** of the
 * general digest grammar, the machinery lives in `digest.ts` and this module is the
 * checklist-profile instantiation: same signature, byte-identical output (the
 * exact-string and stochastic suites are the proof), with the arithmetic composed from
 * the already-pinned primitives in `scale.ts`, `markers.ts`, and `series.ts` rather
 * than re-deriving any of it. Pure: no I/O, no clock, no randomness.
 *
 * @see ./digest.ts
 * @see ./profiles.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ./markers.ts
 */
import type { Bucket } from './markers.js';
/**
 * One checklist item, reduced to exactly what the summary line needs: the marker glyph
 * it renders with, and — only for a marker like `🛳️` whose bucket the glyph alone can't
 * carry — which bucket it counts toward.
 *
 * `bucket` wins outright over the marker's own classification whenever supplied,
 * exactly as `classifyMarker`'s `override` parameter always has.
 */
export interface ChecklistItem {
    marker: string;
    bucket?: Bucket;
}
/** Options accepted by {@link renderChecklistSummary}. */
export interface SummaryOptions {
    series?: readonly number[];
}
/**
 * Renders a checklist's summary line, per `status-checklists-skill.md` § The summary
 * line: the three-number count section, the percent, the 10-cell anti-aliased progress
 * bar, an optional trend sparkline, and the per-marker icon list — inline when it is
 * short, or split into a success/active+pending/failure block below the bar when it
 * isn't.
 *
 * This is `renderDigest` with the checklist profile plugged in (issue #20): the icon
 * list moves from inline to the block form past 8 distinct `(marker, bucket)` entries,
 * bucket lines wrap past 12 entries, and every bucket's block (success, then
 * active+pending, then failure — empty buckets omitted) is blank-separated exactly
 * when any bucket line wrapped, matching this skill's own `check-checklist.mjs`
 * validator. Callers should not need to know the framing changed: the signature and
 * the rendered bytes are exactly what they were before the extraction.
 *
 * @param items   every checklist item at every nesting level, one entry each; must be
 *   non-empty — a summary line has nothing to summarize otherwise
 * @param options `series`, the checklist's percent history in chronological order; a
 *   trend sparkline is appended only when it has 4 or more points (fewer is silently
 *   omitted, not an error — see `renderSparkline`'s own precondition)
 *
 * @example
 *   // The SKILL.md example: 11 distinct markers, more than 8, so the icon list drops
 *   // to its own block and splits into three bucket lines.
 *   renderChecklistSummary([
 *     ...Array(8).fill({ marker: '✅' }),  ...Array(4).fill({ marker: '🤖' }),
 *     ...Array(2).fill({ marker: '⏳' }),  ...Array(2).fill({ marker: '🔜' }),
 *     ...Array(2).fill({ marker: '❗' }),  { marker: '🌐' }, { marker: '🛠️' },
 *     { marker: '🤔' }, ...Array(2).fill({ marker: '🌗' }),
 *     { marker: '❌' }, { marker: '🚫' },
 *   ])
 *   // => '8/13/4 items (32%) ███▒░░░░░░\n' +
 *   //    '\n' +
 *   //    '✅ 8\n' +
 *   //    '🤖 4  ⏳ 2  🔜 2  ❗ 2  🌐 1  🛠️ 1  🤔 1\n' +
 *   //    '🌗 2  ❌ 1  🚫 1'
 *
 * @example
 *   // 8 or fewer distinct markers stay inline, two spaces after the bar.
 *   renderChecklistSummary([
 *     ...Array(4).fill({ marker: '✅' }), { marker: '🔜' }, { marker: '❌' },
 *   ])
 *   // => '4/1/1 items (67%) ██████▓░░░  ✅ 4  🔜 1  ❌ 1'
 *
 * @throws {RangeError} when `items` is empty.
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ./digest.ts renderDigest
 * @see ./profiles.ts CHECKLIST_PROFILE
 */
export declare function renderChecklistSummary(items: readonly ChecklistItem[], options?: SummaryOptions): string;
//# sourceMappingURL=checklist.d.ts.map