/**
 * The general digest renderer: the profile-independent machinery of the compression
 * mechanic, extracted from `checklist.ts` (issue #20).
 *
 * A compressed artifact is a body of comparable units plus a digest derived from them;
 * this module renders the digest — one fixed-shape line (plus the existing overflow
 * block) per the grammar
 * `<counts> <noun> [(<scalar>%) <bar>] [trend <sparkline>] <icon-list>` — for any
 * profile in `profiles.ts`. The grouping by `(marker, bucket)`, the tallying, the
 * count-desc/canonical-rank sort, the 8-entry inline/block split, and the 12-entry
 * wrap were all pinned by the status-checklist convention and are unchanged here; only
 * the bucket set, the noun, and the scalar formula became parameters. The status-
 * checklist summary line is this grammar with the checklist profile plugged in —
 * byte-identical, which the existing checklist suites prove.
 *
 * Also here: the two composition helpers the spec's invariants call for —
 * {@link leadUnitIndex} (the lead line's argmax, the one digest element that keeps a
 * single unit's identity) and {@link overallBucket} / {@link nestDigest} (nesting by
 * digest substitution: a child artifact appears in its parent as one line carrying the
 * child's digest, counted as one unit bucketed by the child's overall state).
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * @see ./profiles.ts
 * @see ./checklist.ts
 * @see ../../superpowers/spec/2026-08-27-compression-mechanic-design.md
 */
import type { DigestProfile } from './profiles.js';
/**
 * One unit of a compressed artifact, reduced to exactly what the digest needs: the
 * marker glyph it renders with, and — when the glyph alone can't carry it — which
 * bucket it counts toward.
 *
 * `bucket` names one of the profile's bucket ids and wins outright over the marker's
 * own classification when it does; an id the profile does not define is ignored and
 * the unit classifies by marker as usual. Profiles that classify by something other
 * than the marker (the diff profile's change kinds) rely on it entirely.
 *
 * `plus`/`minus` feed the `+N −M` tail of a `plusMinus` profile (lines added and
 * removed by this unit, for the diff profile) and are ignored everywhere else.
 */
export interface DigestUnit {
    marker: string;
    bucket?: string;
    plus?: number;
    minus?: number;
}
/** Options accepted by {@link renderDigest}. */
export interface DigestOptions {
    series?: readonly number[];
}
/**
 * The icon list moves from inline (after the head) to its own block below once it
 * holds more than this many distinct `(marker, bucket)` entries.
 */
export declare const INLINE_ENTRY_LIMIT = 8;
/** Within the block form, a bucket line wraps onto a new line after this many entries. */
export declare const MAX_ENTRIES_PER_LINE = 12;
/**
 * Renders a compressed artifact's digest, per the general grammar:
 * the per-bucket count section, the profile's unit noun, an optional scalar percent
 * with the 10-cell anti-aliased progress bar (only when the profile declares a scalar
 * axis — no percent is fabricated otherwise), an optional `+N −M` line-count tail
 * (only for a `plusMinus` profile), an optional trend sparkline, and the per-marker
 * icon list — inline when it is short, or split into per-bucket blocks below when it
 * isn't.
 *
 * Every layout rule is exactly the status-checklist convention's, with the bucket set
 * as a parameter: the icon list moves from inline to block form past
 * {@link INLINE_ENTRY_LIMIT} distinct `(marker, bucket)` entries; block bucket lines
 * appear in the profile's canonical bucket order (empty buckets omitted), wrap past
 * {@link MAX_ENTRIES_PER_LINE} entries, and are blank-separated exactly when any
 * bucket line wrapped.
 *
 * @param units   every unit of the artifact, one entry each; must be non-empty — a
 *   digest has nothing to summarize otherwise
 * @param profile the digest profile: buckets, noun, scalar axis, tail — see
 *   `profiles.ts`
 * @param options `series`, the artifact's scalar history in chronological order; a
 *   trend sparkline is appended only when it has 4 or more points (fewer is silently
 *   omitted, not an error), always on the `'absolute'` scale so digests of different
 *   artifacts stay comparable
 *
 * @example
 *   renderDigest(
 *     [
 *       ...Array(2).fill({ marker: '❗' }), ...Array(5).fill({ marker: '⚠️' }),
 *       ...Array(3).fill({ marker: '🐛' }), ...Array(2).fill({ marker: '🔍' }),
 *     ],
 *     FINDINGS_PROFILE,
 *   )
 *   // => '2/8/2 findings  ⚠️ 5  🐛 3  ❗ 2  🔍 2'
 *
 * @throws {RangeError} when `units` is empty.
 * @see ./profiles.ts
 * @see ./checklist.ts renderChecklistSummary — the checklist-profile instantiation
 */
export declare function renderDigest(units: readonly DigestUnit[], profile: DigestProfile, options?: DigestOptions): string;
/**
 * The index of the artifact's lead unit — the argmax of the body by the profile's
 * attention order — or `-1` when no unit qualifies.
 *
 * This is the lead-line exception made mechanical: the lead line is the one digest
 * element that keeps a unit's identity, a 1-unit compression sitting between the
 * digest (0 units of identity) and the body (all of them) — which is why the result is
 * a single index, never a list: two lead lines would be a body. The winner is the unit
 * whose marker appears earliest in `profile.attention`; ties go to the earliest unit
 * in body order. A `-1` means nothing needs attention — the caller leads with the
 * all-clear (✅) or omits the lead line entirely, per the skill's own rule.
 *
 * @param units   the artifact's units, in body order
 * @param profile the profile whose `attention` order ranks salience
 * @returns the winning unit's index in `units`, or `-1` when no marker qualifies
 *
 * @example
 *   leadUnitIndex(
 *     [{ marker: '✅' }, { marker: '🚫' }, { marker: '❌' }],
 *     CHECKLIST_PROFILE,
 *   )  // => 2 — ❌ outranks 🚫 in the checklist attention order
 *
 * @see ./profiles.ts
 */
export declare function leadUnitIndex(units: readonly DigestUnit[], profile: DigestProfile): number;
/**
 * The artifact's overall state: the first bucket in the profile's `overallOrder` that
 * holds at least one unit.
 *
 * This is how a nested artifact is bucketed in its parent (spec § Composition rules,
 * rule 3): a checklist with any failure is overall `'failure'`, one with work still
 * running is `'active'`, one fully landed is `'success'`; an options artifact with any
 * open option is overall `'open'`. Guaranteed to return a bucket id as long as
 * `overallOrder` covers every bucket (which every registered profile's does); the
 * residual bucket is the defensive fallback.
 *
 * @param units   the artifact's units; must be non-empty — an empty artifact has no state
 * @param profile the profile whose `overallOrder` defines "overall"
 * @returns the id of the artifact's overall bucket
 *
 * @example
 *   overallBucket([{ marker: '✅' }, { marker: '⏳' }], CHECKLIST_PROFILE)  // => 'active'
 *   overallBucket([{ marker: '✅' }, { marker: '✅' }], CHECKLIST_PROFILE)  // => 'success'
 *
 * @throws {RangeError} when `units` is empty.
 * @see nestDigest
 */
export declare function overallBucket(units: readonly DigestUnit[], profile: DigestProfile): string;
/** What {@link nestDigest} hands the parent artifact: the child's one-line representation and overall bucket. */
export interface NestedDigest {
    /** The child's digest head line — the fixed-shape part, safe to embed as one body line even when the child's own icon list went block-form. */
    readonly line: string;
    /** The child's overall bucket id, per {@link overallBucket} — what the parent's partition counts the child under. */
    readonly bucket: string;
}
/**
 * Represents a whole child artifact as one unit-sized line for a parent artifact's
 * body — nesting by digest substitution (spec § Composition rules, rule 3).
 *
 * When a unit is itself a compressed artifact, the child appears in the parent's body
 * as one line carrying the child's *digest*, and counts as exactly **one** unit in the
 * parent's partition, bucketed by the child's overall state — its units are never
 * double-counted into the parent, because the digest is its representation. The
 * returned `line` is the child digest's head line (identical to the full digest when
 * the child's icon list fit inline); the returned `bucket` is what the parent passes
 * as the unit's explicit `bucket` override when parent and child share a bucket
 * vocabulary (checklist-in-checklist), or maps into its own partition otherwise.
 *
 * Within a single artifact, plain indentation sub-items remain individually counted
 * exactly as before — this rule applies only across artifacts, where the nested thing
 * has a digest of its own.
 *
 * @param childUnits   the child artifact's units; must be non-empty
 * @param childProfile the child artifact's profile
 * @param options      passed through to the child's {@link renderDigest} (trend series)
 * @returns the child's head line and overall bucket
 *
 * @example
 *   nestDigest([{ marker: '✅' }, { marker: '❌' }], CHECKLIST_PROFILE)
 *   // => { line: '1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1', bucket: 'failure' }
 *   // The parent then carries e.g. `- 📋 subplan — 1/0/1 items (50%) …` as ONE unit,
 *   // with { marker: '📋', bucket: 'failure' } in its own units list.
 *
 * @throws {RangeError} when `childUnits` is empty (via {@link renderDigest}).
 * @see overallBucket
 */
export declare function nestDigest(childUnits: readonly DigestUnit[], childProfile: DigestProfile, options?: DigestOptions): NestedDigest;
//# sourceMappingURL=digest.d.ts.map