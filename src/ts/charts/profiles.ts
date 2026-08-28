/**
 * The digest profiles: per-domain parameterizations of the compression mechanic,
 * promoted from the design spec's table to runtime data.
 *
 * `2026-08-27-compression-mechanic-design.md` (issue #20) reframes the status-checklist
 * summary line as one instance of a general digest grammar —
 * `<counts> <noun> [(<scalar>%) <bar>] [trend <sparkline>] <icon-list>` — whose
 * per-domain variation is entirely data: the unit noun, the bucket partition and its
 * marker classification, and whether a scalar axis exists. This module is that data,
 * in the `vocabulary.ts` / `markers.ts` pattern: exported `const` profile tables that
 * feed both rendering (`digest.ts`) and validation (`verify.ts`), so the partition
 * rules live in exactly one place instead of being re-derived per caller.
 *
 * The glyph vocabulary is shared across profiles — every marker any profile names must
 * appear in `markers.md` (and thus `markers.ts`'s `CANONICAL_ORDER`); a profile never
 * introduces a glyph privately. Bucket membership below mirrors the "Profile bucket
 * membership" section of `markers.md`, which is the prose source of truth.
 *
 * @see ./digest.ts
 * @see ./markers.ts
 * @see ../../doc_md/reference/markers.md
 * @see ../../superpowers/spec/2026-08-27-compression-mechanic-design.md
 */

import { SUCCESS_MARKERS, FAILURE_MARKERS } from './markers.js';

/**
 * One bucket of a profile's partition: its id (the name validation and overrides refer
 * to) and the markers that classify into it.
 *
 * An empty `markers` list means no marker classifies here by glyph alone — units land
 * in such a bucket only by explicit override (the diff profile's change-kind buckets)
 * or by being the profile's residual bucket.
 */
export interface DigestBucketSpec {
  /** The bucket's id, unique within its profile — e.g. `'success'`, `'blocking'`. */
  readonly id      : string;
  /** Markers whose units classify into this bucket, exactly as rendered (see the multi-code-point note in `markers.ts`). */
  readonly markers : readonly string[];
}

/**
 * One digest profile: everything the general renderer and validator need to know about
 * a domain, as data.
 *
 * The invariants (spec § The invariants) constrain the data: `buckets` is a partition
 * in canonical order (invariant 2), `residual` names the bucket a unit falls into when
 * no marker list claims it (so every unit is counted exactly once), and `scalar` exists
 * only for a genuinely monotone axis — no percent is fabricated for a profile without
 * one (spec § Alternatives rejected).
 */
export interface DigestProfile {
  /** The profile's name, the key it is registered under — e.g. `'checklist'`. */
  readonly name         : string;
  /** The unit noun rendered after the counts — one word, plural, unique across profiles; it is the reader's cue for which profile grammar to pattern-match, and the validator's profile-inference key. */
  readonly noun         : string;
  /** The partition, in canonical (rendered) order. */
  readonly buckets      : readonly DigestBucketSpec[];
  /** The id of the bucket a unit counts toward when no bucket's marker list contains its marker — the partition's completeness guarantee. */
  readonly residual     : string;
  /** When present, the id of the bucket whose share of the total renders as `(<P>%) <bar>`; absent for profiles with no monotone axis. */
  readonly scalar?      : string;
  /** When `true`, the digest carries a `+N −M` line-count tail after the noun, summed from the units' `plus`/`minus` fields (the diff profile). */
  readonly plusMinus?   : boolean;
  /** Bucket ids, most-defining-first: an artifact's overall state is the first bucket in this order that holds at least one unit — how a nested artifact is bucketed in its parent (spec § Composition rules, rule 3). Must cover every bucket id. */
  readonly overallOrder : readonly string[];
  /** Markers, most-salient-first, that qualify a unit as the lead line's argmax; empty when the profile has no mechanical salience rule (diff — the riskiest file is a judgment call). */
  readonly attention    : readonly string[];
}

/**
 * The status-checklist profile — the deepest-developed instance, and the one
 * `renderChecklistSummary` must reproduce byte-identically.
 *
 * Bucket membership comes straight from `markers.ts` (`SUCCESS_MARKERS`,
 * `FAILURE_MARKERS`); the residual `active` bucket is the skill's "active+pending:
 * every other marker" rule. The scalar axis is completion: percent = success ÷ total.
 *
 * @example
 *   CHECKLIST_PROFILE.noun               // => 'items'
 *   CHECKLIST_PROFILE.buckets[0]?.id     // => 'success'
 */
export const CHECKLIST_PROFILE: DigestProfile = {
  name    : 'checklist',
  noun    : 'items',
  buckets : [
    { id: 'success', markers: SUCCESS_MARKERS },
    { id: 'active',  markers: [] },
    { id: 'failure', markers: FAILURE_MARKERS },
  ],
  residual     : 'active',
  scalar       : 'success',
  overallOrder : ['failure', 'active', 'success'],
  attention    : ['❌', '❗', '🚫', '🦗'],
};

/**
 * The findings profile: the digest a review or audit closes with — severity tallies
 * readable instead of the findings. Blocking leads the bucket order because the
 * digest's first number is the one a glance reads first, and for findings the blocker
 * count is the headline. No scalar: 60% of findings being minor is not 60% of anything
 * a bar should imply progress toward.
 *
 * @example
 *   // ❗❗ ⚠️⚠️⚠️⚠️⚠️ 🐛🐛🐛 🔍🔍 as findings:
 *   // => '2/8/2 findings  ⚠️ 5  🐛 3  ❗ 2  🔍 2'
 */
export const FINDINGS_PROFILE: DigestProfile = {
  name    : 'findings',
  noun    : 'findings',
  buckets : [
    { id: 'blocking', markers: ['❗', '🦹', '🌋', '❌', '🚫'] },
    { id: 'degraded', markers: ['⚠️', '🌗', '🐛', '🤡', '😕'] },
    { id: 'note',     markers: [] },
  ],
  residual     : 'note',
  overallOrder : ['blocking', 'degraded', 'note'],
  attention    : ['❗', '🦹', '🌋', '❌', '🚫', '⚠️', '🌗', '🐛', '🤡', '😕'],
};

/**
 * The options profile: the decision summary over per-option detail. The verdict is the
 * lead line ("✅ chose sqlite: single-file, zero-daemon"); the digest says at a glance
 * whether the decision is still open (`0/4/1 options`). No scalar — a decided tradeoff
 * is not 25% complete.
 *
 * `overallOrder` puts `open` first (any open option means the decision is undecided),
 * then `chosen` (a made decision), then `rejected` (everything was declined).
 *
 * @example
 *   // ✅ 🤔🤔 ❌❌❌ as options:
 *   // => '1/2/3 options  ❌ 3  🤔 2  ✅ 1'
 */
export const OPTIONS_PROFILE: DigestProfile = {
  name    : 'options',
  noun    : 'options',
  buckets : [
    { id: 'chosen',   markers: ['✅', '👍'] },
    { id: 'open',     markers: ['🤔', '❓', '⏸️'] },
    { id: 'rejected', markers: ['❌', '👎', '✋'] },
  ],
  residual     : 'open',
  overallOrder : ['open', 'chosen', 'rejected'],
  attention    : ['✅', '👍', '❓', '🤔'],
};

/**
 * The diff profile: the shape of the change over the hunks — `git diff --stat` restated
 * in the house grammar so it composes. The first profile to classify by something other
 * than the marker: buckets are change kinds, assigned per unit via the explicit
 * `bucket` override (`'added'` | `'modified'` | `'removed'`), leaving the marker free
 * to carry the work kind (🪚 📝 🧪 …). A unit with no stated change kind counts as
 * `modified`, the residual. Instead of a bar, the digest carries a `+N −M` line-count
 * tail summed from the units' `plus`/`minus` fields.
 *
 * `attention` is empty: the spec puts the lead line on "the riskiest file", which is a
 * judgment call, not a marker rule — the caller picks the lead unit by hand.
 *
 * @example
 *   // 16 changed files, 214 lines added, 96 removed:
 *   // => '3/11/2 files +214 −96  🪚 6  📝 4  🧪 3  🗑️ 2  🔨 1'
 */
export const DIFF_PROFILE: DigestProfile = {
  name    : 'diff',
  noun    : 'files',
  buckets : [
    { id: 'added',    markers: [] },
    { id: 'modified', markers: [] },
    { id: 'removed',  markers: [] },
  ],
  residual     : 'modified',
  plusMinus    : true,
  overallOrder : ['removed', 'added', 'modified'],
  attention    : [],
};

/**
 * The results profile: what was found over where. The digest answers "did the search
 * pay?" before the reader commits to the detail; the `missed` bucket (🦗 for a source
 * that returned nothing) makes silent-miss reporting structural rather than optional.
 * Anything neither partial nor missed counts as `matched`, the residual.
 *
 * @example
 *   // 🔍×14 🌗×2 🦗×1 as results:
 *   // => '14/2/1 hits  🔍 14  🌗 2  🦗 1'
 */
export const RESULTS_PROFILE: DigestProfile = {
  name    : 'results',
  noun    : 'hits',
  buckets : [
    { id: 'matched', markers: [] },
    { id: 'partial', markers: ['🌗'] },
    { id: 'missed',  markers: ['🦗', '❌'] },
  ],
  residual     : 'matched',
  overallOrder : ['missed', 'partial', 'matched'],
  attention    : ['🦗', '❌', '🌗'],
};

/**
 * Every registered profile name, in the spec's listed order — the closed vocabulary
 * the `render_digest` MCP tool's `profile` enum is built from, so a misspelled profile
 * is unnameable.
 *
 * @example
 *   PROFILE_NAMES.includes('findings')  // => true
 */
export const PROFILE_NAMES = ['checklist', 'findings', 'options', 'diff', 'results'] as const;

/** One of the registered profile names. */
export type ProfileName = (typeof PROFILE_NAMES)[number];

/**
 * The registered profiles by name — the single lookup rendering and tooling share.
 *
 * @example
 *   PROFILES.findings.noun  // => 'findings'
 */
export const PROFILES: Readonly<Record<ProfileName, DigestProfile>> = {
  checklist : CHECKLIST_PROFILE,
  findings  : FINDINGS_PROFILE,
  options   : OPTIONS_PROFILE,
  diff      : DIFF_PROFILE,
  results   : RESULTS_PROFILE,
};

/**
 * The profile whose noun is `noun`, or `undefined` when no profile renders that noun —
 * the validator's profile inference, per the fixed-grammar rule that the digest's noun
 * cues the profile.
 *
 * @param noun the unit noun exactly as rendered in a digest line, e.g. `'findings'`
 * @returns the matching profile, or `undefined` for an unknown noun
 * @example
 *   profileForNoun('items')?.name  // => 'checklist'
 *   profileForNoun('zebras')       // => undefined
 * @see ./verify.ts verifyDigest
 */
export function profileForNoun(noun: string): DigestProfile | undefined {
  return Object.values(PROFILES).find(profile => profile.noun === noun);
}
