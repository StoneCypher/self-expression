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

import { barCells }        from './scale.js';
import { canonicalRank }   from './markers.js';
import { renderSparkline } from './series.js';
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
  marker  : string;
  bucket? : string;
  plus?   : number;
  minus?  : number;
}

/** Options accepted by {@link renderDigest}. */
export interface DigestOptions { series?: readonly number[]; }

/**
 * The icon list moves from inline (after the head) to its own block below once it
 * holds more than this many distinct `(marker, bucket)` entries.
 */
export const INLINE_ENTRY_LIMIT = 8;

/** Within the block form, a bucket line wraps onto a new line after this many entries. */
export const MAX_ENTRIES_PER_LINE = 12;

/** One distinct `(marker, bucket)` pairing in a units list, and how many units share it. */
interface MarkerGroup {
  readonly marker : string;
  readonly bucket : string;
  readonly count  : number;
}

/**
 * The bucket id `unit` counts toward under `profile`: a valid explicit `bucket`
 * override wins; otherwise the first bucket (in canonical order) whose marker list
 * contains the unit's marker; otherwise the profile's residual bucket — so every unit
 * lands in exactly one bucket, which is the partition invariant.
 *
 * For the checklist profile this reproduces `markers.ts`'s `classifyMarker` exactly
 * (the success/failure lists are disjoint, and the residual is `active`).
 */
function classifyUnit(unit: DigestUnit, profile: DigestProfile): string {
  if (unit.bucket !== undefined && profile.buckets.some(b => b.id === unit.bucket)) { return unit.bucket; }
  for (const bucket of profile.buckets) {
    if (bucket.markers.includes(unit.marker)) { return bucket.id; }
  }
  return profile.residual;
}

/**
 * Groups `units` by the exact `(marker, bucket)` pairing each resolves to, counting
 * how many units share each pairing.
 *
 * Grouped by the *pairing* rather than the marker alone so a marker whose bucket
 * varies unit to unit via the `bucket` override still contributes a correct,
 * separately-counted icon-list entry to each bucket line it actually appears in.
 * Comparison is exact string equality on `marker` — see the module note in
 * `markers.ts` on multi-code-point markers.
 */
function groupByMarker(units: readonly DigestUnit[], profile: DigestProfile): MarkerGroup[] {
  const groups = new Map<string, { marker: string; bucket: string; count: number }>();
  for (const unit of units) {
    const bucket = classifyUnit(unit, profile);
    // '|' can never appear in a bucket id or a marker glyph, so it is an unambiguous,
    // explicit delimiter for this internal grouping key.
    const key = `${bucket}|${unit.marker}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { marker: unit.marker, bucket, count: 1 });
    }
  }
  return [...groups.values()];
}

/** A bucket id's position in the profile's canonical bucket order (unknown ids rank last). */
function bucketRank(bucket: string, profile: DigestProfile): number {
  const index = profile.buckets.findIndex(b => b.id === bucket);
  return index === -1 ? profile.buckets.length : index;
}

/**
 * The icon-list sort: count descending, then {@link canonicalRank} ascending, then —
 * for the rare case of one marker split across buckets by override, at equal count —
 * bucket in the profile's canonical order, so the result is fully deterministic.
 */
function compareGroups(a: MarkerGroup, b: MarkerGroup, profile: DigestProfile): number {
  if (a.count !== b.count) { return b.count - a.count; }
  const rankDiff = canonicalRank(a.marker) - canonicalRank(b.marker);
  if (rankDiff !== 0) { return rankDiff; }
  return bucketRank(a.bucket, profile) - bucketRank(b.bucket, profile);
}

/** Renders one sorted group as its icon-list token, `<marker> <count>`. */
function renderEntry(group: MarkerGroup): string {
  return `${group.marker} ${String(group.count)}`;
}

/**
 * Renders one bucket's groups as one or more `MAX_ENTRIES_PER_LINE`-capped lines, each
 * line's entries joined by two spaces — the 13th and later entries wrap onto
 * additional lines rather than growing the line without bound.
 */
function bucketLines(groups: readonly MarkerGroup[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += MAX_ENTRIES_PER_LINE) {
    lines.push(groups.slice(i, i + MAX_ENTRIES_PER_LINE).map(renderEntry).join('  '));
  }
  return lines;
}

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
export function renderDigest(
  units    : readonly DigestUnit[],
  profile  : DigestProfile,
  options? : DigestOptions,
): string {

  if (units.length === 0) {
    throw new RangeError('renderDigest: units must be a non-empty array; got 0 units');
  }

  const total  = units.length;
  const counts = new Map<string, number>(profile.buckets.map(b => [b.id, 0]));
  for (const unit of units) {
    const bucket = classifyUnit(unit, profile);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const countSection = profile.buckets.map(b => String(counts.get(b.id) ?? 0)).join('/');
  let head = `${countSection} ${profile.noun}`;

  if (profile.scalar !== undefined) {
    const scalarCount = counts.get(profile.scalar) ?? 0;
    const percent     = Math.round((100 * scalarCount) / total);
    head += ` (${String(percent)}%) ${barCells(percent)}`;
  }

  if (profile.plusMinus === true) {
    let plus = 0, minus = 0;
    for (const unit of units) {
      plus  += unit.plus  ?? 0;
      minus += unit.minus ?? 0;
    }
    head += ` +${String(plus)} −${String(minus)}`;
  }

  if (options?.series !== undefined && options.series.length >= 4) {
    head += `  trend ${renderSparkline(options.series, 'absolute')}`;
  }

  const groups = groupByMarker(units, profile).sort((a, b) => compareGroups(a, b, profile));

  if (groups.length <= INLINE_ENTRY_LIMIT) {
    return `${head}  ${groups.map(renderEntry).join('  ')}`;
  }

  const sections = profile.buckets
    .map(bucket => bucketLines(groups.filter(g => g.bucket === bucket.id)))
    .filter(lines => lines.length > 0);

  const anyWrapped = sections.some(lines => lines.length > 1);
  const sectionSeparator = anyWrapped ? '\n\n' : '\n';
  const block = sections.map(lines => lines.join('\n')).join(sectionSeparator);

  return `${head}\n\n${block}`;

}

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
export function leadUnitIndex(units: readonly DigestUnit[], profile: DigestProfile): number {
  let bestIndex = -1;
  let bestRank  = Number.POSITIVE_INFINITY;
  for (const [index, unit] of units.entries()) {
    const rank = profile.attention.indexOf(unit.marker);
    if (rank !== -1 && rank < bestRank) {
      bestRank  = rank;
      bestIndex = index;
    }
  }
  return bestIndex;
}

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
export function overallBucket(units: readonly DigestUnit[], profile: DigestProfile): string {
  if (units.length === 0) {
    throw new RangeError('overallBucket: units must be a non-empty array; got 0 units');
  }
  const present = new Set(units.map(unit => classifyUnit(unit, profile)));
  for (const bucket of profile.overallOrder) {
    if (present.has(bucket)) { return bucket; }
  }
  return profile.residual;
}

/** What {@link nestDigest} hands the parent artifact: the child's one-line representation and overall bucket. */
export interface NestedDigest {
  /** The child's digest head line — the fixed-shape part, safe to embed as one body line even when the child's own icon list went block-form. */
  readonly line   : string;
  /** The child's overall bucket id, per {@link overallBucket} — what the parent's partition counts the child under. */
  readonly bucket : string;
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
export function nestDigest(
  childUnits   : readonly DigestUnit[],
  childProfile : DigestProfile,
  options?     : DigestOptions,
): NestedDigest {
  const line = renderDigest(childUnits, childProfile, options).split('\n')[0] ?? '';
  return { line, bucket: overallBucket(childUnits, childProfile) };
}
