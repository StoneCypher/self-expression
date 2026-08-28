/**
 * Stochastic property tests for the digest core (issue #20): the compression spec's
 * six invariants, quantified over profiles, plus byte-identity of the checklist
 * summary line under the digest extraction.
 *
 * The invariant tests recompute their expectations independently from the profile
 * *data* (bucket marker lists, residual, scalar) and the already-tested pure
 * primitives (`canonicalRank`), never by re-deriving `renderDigest`'s own logic. The
 * byte-identity test compares the refactored `renderChecklistSummary` against a frozen
 * copy of the pre-refactor implementation — the extraction's whole contract is that
 * these two never disagree on any input.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { renderDigest }           from '../charts/digest.js';
import type { DigestUnit }        from '../charts/digest.js';
import { PROFILES }               from '../charts/profiles.js';
import type { DigestProfile }     from '../charts/profiles.js';
import { renderChecklistSummary } from '../charts/checklist.js';
import type { ChecklistItem }     from '../charts/checklist.js';
import { verifyDigest }           from '../charts/verify.js';
import { classifyMarker, canonicalRank } from '../charts/markers.js';
import type { Bucket }            from '../charts/markers.js';
import { barCells }               from '../charts/scale.js';
import { renderSparkline }        from '../charts/series.js';

// A fixed pool spanning buckets in every profile, capped at 12 distinct markers so no
// bucket line can ever wrap (wrap needs a 13th entry) — wrap behavior has its own
// exact-string specs; these properties target the arithmetic.
const MARKER_POOL = [
  '✅', '💯', '🤖', '⏳', '🌐', '🛠️', '🔜', '❗', '❌', '🚫', '🌗', '⚠️',
] as const;

const ALL_PROFILES: readonly DigestProfile[] = Object.values(PROFILES);
const DIFF_BUCKETS = ['added', 'modified', 'removed'] as const;

const profileArb = fc.constantFrom(...ALL_PROFILES);

/** Units for `profile`: markers from the shared pool; explicit change kinds for diff. */
function unitsArb(profile: DigestProfile): fc.Arbitrary<DigestUnit[]> {
  const marker = fc.constantFrom(...MARKER_POOL);
  const unit: fc.Arbitrary<DigestUnit> = profile.name === 'diff'
    ? fc.record({ marker, bucket: fc.constantFrom(...DIFF_BUCKETS) })
    : marker.map(m => ({ marker: m }));
  return fc.array(unit, { minLength: 1, maxLength: 60 });
}

/** `[profile, units]` pairs, the quantification domain of every invariant below. */
const artifactArb: fc.Arbitrary<[DigestProfile, DigestUnit[]]> =
  profileArb.chain(profile => unitsArb(profile).map(units => [profile, units]));

/**
 * The spec's classification rule, restated independently: a valid explicit bucket
 * override wins; otherwise the first bucket whose marker list contains the marker;
 * otherwise the residual.
 */
function expectedBucket(unit: DigestUnit, profile: DigestProfile): string {
  if (unit.bucket !== undefined && profile.buckets.some(b => b.id === unit.bucket)) { return unit.bucket; }
  return profile.buckets.find(b => b.markers.includes(unit.marker))?.id ?? profile.residual;
}

/** Per-bucket expected counts, recomputed from the profile data alone. */
function expectedCounts(units: readonly DigestUnit[], profile: DigestProfile): number[] {
  const counts = new Map<string, number>(profile.buckets.map(b => [b.id, 0]));
  for (const unit of units) {
    const bucket = expectedBucket(unit, profile);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return profile.buckets.map(b => counts.get(b.id) ?? 0);
}

/** The stated count section off a rendered digest's head line. */
function parsedCounts(rendered: string, profile: DigestProfile): number[] {
  const head = rendered.split('\n')[0] ?? '';
  const m = new RegExp(`^((?:\\d+/)*\\d+) ${profile.noun}`).exec(head);
  expect(m).not.toBeNull();
  return (m as unknown as [string, string])[1].split('/').map(Number);
}

/** Every `<marker> <count>` icon entry in a rendered digest, aggregated per marker. */
function parsedIcons(rendered: string, profile: DigestProfile): Map<string, number> {
  const lines = rendered.split('\n');
  const head  = lines[0] ?? '';
  const headMatch = new RegExp(
    `^(?:\\d+/)*\\d+ ${profile.noun}(?: \\(\\d+%\\) [█▓▒░]{10})?(?: \\+\\d+ −\\d+)?(?:  trend [▁▂▃▄▅▆▇█]+)?(?:  (.+))?$`
  ).exec(head);
  expect(headMatch).not.toBeNull();
  const inline = (headMatch as unknown as [string, string | undefined])[1];
  const iconLines = [...(inline !== undefined ? [inline] : []), ...lines.slice(2).filter(l => l.length > 0)];
  const totals = new Map<string, number>();
  for (const line of iconLines) {
    for (const token of line.split('  ')) {
      const m = /^(\S+) (\d+)$/u.exec(token);
      expect(m).not.toBeNull();
      const [, marker, count] = m as unknown as [string, string, string];
      totals.set(marker, (totals.get(marker) ?? 0) + Number(count));
    }
  }
  return totals;
}

describe('renderDigest — the six compression invariants, quantified over profiles', () => {

  it('derivability: the digest is a pure function of the body, and its counts are recomputable', () => {
    fc.assert(
      fc.property(artifactArb, ([profile, units]) => {
        const rendered = renderDigest(units, profile);
        expect(renderDigest(units, profile)).toBe(rendered);            // pure — same body, same digest
        expect(parsedCounts(rendered, profile)).toEqual(expectedCounts(units, profile));
      }),
      { numRuns: 300 }
    );
  });

  it('partition: every unit counted in exactly one bucket — full width, summing to the total', () => {
    fc.assert(
      fc.property(artifactArb, ([profile, units]) => {
        const counts = parsedCounts(renderDigest(units, profile), profile);
        expect(counts).toHaveLength(profile.buckets.length);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(units.length);
      }),
      { numRuns: 300 }
    );
  });

  it('substitutability: the digest drops unit ordering — any permutation of the body renders identically', () => {
    fc.assert(
      fc.property(
        artifactArb.chain(([profile, units]) =>
          fc.shuffledSubarray(units, { minLength: units.length, maxLength: units.length })
            .map(shuffled => [profile, units, shuffled] as const)),
        ([profile, units, shuffled]) => {
          expect(renderDigest(shuffled, profile)).toBe(renderDigest(units, profile));
        }
      ),
      { numRuns: 300 }
    );
  });

  it('fixed shape: the head always matches the profile grammar — scalar and tail exactly when declared', () => {
    fc.assert(
      fc.property(artifactArb, ([profile, units]) => {
        const head = renderDigest(units, profile).split('\n')[0] ?? '';
        const m = new RegExp(
          `^(?:\\d+/)*\\d+ ${profile.noun}( \\(\\d+%\\) [█▓▒░]{10})?( \\+\\d+ −\\d+)?(?:  .+)?$`
        ).exec(head);
        expect(m).not.toBeNull();
        const [, scalarPart, tailPart] = m as unknown as [string, string | undefined, string | undefined];
        expect(scalarPart !== undefined).toBe(profile.scalar !== undefined);
        expect(tailPart !== undefined).toBe(profile.plusMinus === true);
      }),
      { numRuns: 300 }
    );
  });

  it('conservation: the icon list re-states the body exactly — nothing missing, nothing fabricated', () => {
    fc.assert(
      fc.property(artifactArb, ([profile, units]) => {
        const expected = new Map<string, number>();
        for (const unit of units) { expected.set(unit.marker, (expected.get(unit.marker) ?? 0) + 1); }
        const actual = parsedIcons(renderDigest(units, profile), profile);
        expect(Object.fromEntries([...actual].sort())).toEqual(Object.fromEntries([...expected].sort()));
      }),
      { numRuns: 300 }
    );
  });

  it('identity stability: one marker advancing in place moves exactly one unit between buckets', () => {
    fc.assert(
      fc.property(
        artifactArb.chain(([profile, units]) =>
          fc.record({
            index     : fc.integer({ min: 0, max: units.length - 1 }),
            newMarker : fc.constantFrom(...MARKER_POOL),
          }).map(({ index, newMarker }) => [profile, units, index, newMarker] as const)),
        ([profile, units, index, newMarker]) => {
          const before = expectedCounts(units, profile);
          const advanced = units.map((unit, i) => (i === index ? { ...unit, marker: newMarker } : unit));
          const after = parsedCounts(renderDigest(advanced, profile), profile);
          expect(after.reduce((a, b) => a + b, 0)).toBe(units.length);   // total conserved
          const moved = before.reduce((sum, n, i) => sum + Math.abs(n - (after[i] ?? 0)), 0);
          expect([0, 2]).toContain(moved);                                // at most one unit moved
        }
      ),
      { numRuns: 300 }
    );
  });

  it('an empty units array always throws RangeError, for every profile', () => {
    for (const profile of ALL_PROFILES) {
      expect(() => renderDigest([], profile)).toThrow(RangeError);
    }
  });

});

// ---------------------------------------------------------------------------------
// Byte-identity of the checklist summary line under the refactor
// ---------------------------------------------------------------------------------

/**
 * The pre-refactor `renderChecklistSummary`, frozen verbatim (charts/checklist.ts as
 * of #26) as an oracle: the digest extraction is correct exactly when the refactored
 * renderer and this copy agree on every input.
 */
function oracleChecklistSummary(items: readonly ChecklistItem[], options?: { series?: readonly number[] }): string {
  interface Group { marker: string; bucket: Bucket; count: number; }
  const BUCKET_LINE_ORDER: Readonly<Record<Bucket, number>> = { success: 0, active: 1, failure: 2 };

  const total = items.length;
  let success = 0;
  let failure = 0;
  for (const item of items) {
    const bucket = classifyMarker(item.marker, item.bucket);
    if (bucket === 'success') { success += 1; }
    else if (bucket === 'failure') { failure += 1; }
  }
  const activePending = total - success - failure;

  const percent = Math.round((100 * success) / total);
  let head = `${String(success)}/${String(activePending)}/${String(failure)} items (${String(percent)}%) ${barCells(percent)}`;

  if (options?.series !== undefined && options.series.length >= 4) {
    head += `  trend ${renderSparkline(options.series, 'absolute')}`;
  }

  const groupMap = new Map<string, Group>();
  for (const item of items) {
    const bucket = classifyMarker(item.marker, item.bucket);
    const key = `${bucket}|${item.marker}`;
    const existing = groupMap.get(key);
    if (existing) { existing.count += 1; }
    else { groupMap.set(key, { marker: item.marker, bucket, count: 1 }); }
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    if (a.count !== b.count) { return b.count - a.count; }
    const rankDiff = canonicalRank(a.marker) - canonicalRank(b.marker);
    if (rankDiff !== 0) { return rankDiff; }
    return BUCKET_LINE_ORDER[a.bucket] - BUCKET_LINE_ORDER[b.bucket];
  });
  const entry = (g: Group): string => `${g.marker} ${String(g.count)}`;

  if (groups.length <= 8) { return `${head}  ${groups.map(entry).join('  ')}`; }

  const sections = (['success', 'active', 'failure'] as const)
    .map(bucket => {
      const own = groups.filter(g => g.bucket === bucket);
      const lines: string[] = [];
      for (let i = 0; i < own.length; i += 12) {
        lines.push(own.slice(i, i + 12).map(entry).join('  '));
      }
      return lines;
    })
    .filter(lines => lines.length > 0);

  const anyWrapped = sections.some(lines => lines.length > 1);
  const block = sections.map(lines => lines.join('\n')).join(anyWrapped ? '\n\n' : '\n');
  return `${head}\n\n${block}`;
}

// Checklist items with occasional bucket overrides (the 🛳️ pattern) and a wider pool
// than the digest properties use — wraps and block form included on purpose here.
const CHECKLIST_POOL = [
  '✅', '💯', '🤖', '⏳', '🌐', '🛠️', '🛰️', '🔜', '🦥', '🦡', '⏭️', '⏸️', '❗', '⏰',
  '🧠', '❌', '🚫', '🌗', '⚠️', '🛳️', '🐛', '🧪',
] as const;

const checklistItemArb: fc.Arbitrary<ChecklistItem> = fc.record({
  marker : fc.constantFrom(...CHECKLIST_POOL),
  bucket : fc.option(fc.constantFrom('success', 'active', 'failure'), { nil: undefined }),
}).map(({ marker, bucket }) => (bucket === undefined ? { marker } : { marker, bucket }));

const checklistItemsArb = fc.array(checklistItemArb, { minLength: 1, maxLength: 120 });

const seriesArb = fc.option(
  fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 0, maxLength: 12 }),
  { nil: undefined },
);

describe('renderChecklistSummary — byte-identical to the pre-refactor implementation', () => {

  it('agrees with the frozen oracle on every generated checklist, series included', () => {
    fc.assert(
      fc.property(checklistItemsArb, seriesArb, (items, series) => {
        const options = series === undefined ? undefined : { series };
        expect(renderChecklistSummary(items, options)).toBe(oracleChecklistSummary(items, options));
      }),
      { numRuns: 500 }
    );
  });

});

// ---------------------------------------------------------------------------------
// Validator round-trip: render → re-derive → ok, for every profile
// ---------------------------------------------------------------------------------

describe('verifyDigest — round-trips every profile against the renderer', () => {

  it('a renderer-produced artifact passes every check', () => {
    fc.assert(
      fc.property(artifactArb, ([profile, units]) => {
        const body   = units.map((unit, i) => `- ${unit.marker} unit ${String(i)}`).join('\n');
        const digest = renderDigest(units, profile);
        const verdict = verifyDigest(`${body}\n\n${digest}`);
        expect(verdict.failures).toEqual([]);
        expect(verdict.ok).toBe(true);
        expect(verdict.itemCount).toBe(units.length);
      }),
      { numRuns: 300 }
    );
  });

});
