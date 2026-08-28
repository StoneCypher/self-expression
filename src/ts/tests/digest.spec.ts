import { renderDigest, leadUnitIndex, overallBucket, nestDigest } from '../charts/digest.js';
import type { DigestUnit } from '../charts/digest.js';
import {
  CHECKLIST_PROFILE, FINDINGS_PROFILE, OPTIONS_PROFILE, DIFF_PROFILE, RESULTS_PROFILE,
} from '../charts/profiles.js';
import { renderChecklistSummary } from '../charts/checklist.js';

/** Builds `count` units all sharing the same marker (and optional bucket override). */
function repeat(marker: string, count: number, bucket?: string): DigestUnit[] {
  return Array.from({ length: count }, () => (bucket === undefined ? { marker } : { marker, bucket }));
}

describe('renderDigest — per-profile exact-string fixtures', () => {

  // The spec's findings worked example, re-derived against the normative bucket table
  // (markers.md § Profile bucket membership): ❗ is blocking and ⚠️/🐛 are degraded, so
  // this unit set digests as 2/8/2 — the icon list is the spec's, verbatim.
  test('findings: severity tallies, no scalar axis', () => {
    const units: DigestUnit[] = [
      ...repeat('❗', 2), ...repeat('⚠️', 5), ...repeat('🐛', 3), ...repeat('🔍', 2),
    ];
    expect(renderDigest(units, FINDINGS_PROFILE)).toBe('2/8/2 findings  ⚠️ 5  🐛 3  ❗ 2  🔍 2');
  });

  test('options: the spec worked example, verbatim', () => {
    const units: DigestUnit[] = [
      ...repeat('✅', 1), ...repeat('🤔', 2), ...repeat('❌', 3),
    ];
    expect(renderDigest(units, OPTIONS_PROFILE)).toBe('1/2/3 options  ❌ 3  🤔 2  ✅ 1');
  });

  test('diff: the spec worked example, verbatim — kind-classified buckets and the +N −M tail', () => {
    const units: DigestUnit[] = [
      // 3 added files (the new test files carry the bulk of the added lines) …
      { marker: '🧪', bucket: 'added', plus: 120 },
      { marker: '🧪', bucket: 'added', plus: 40 },
      { marker: '🧪', bucket: 'added', plus: 14 },
      // … 11 modified …
      ...repeat('🪚', 6, 'modified').map((u, i) => ({ ...u, plus: 5, minus: i === 0 ? 26 : 10 })),
      ...repeat('📝', 4, 'modified').map(u => ({ ...u, plus: 2 })),
      { marker: '🔨', bucket: 'modified', plus: 2, minus: 0 },
      // … 2 removed.
      { marker: '🗑️', bucket: 'removed', minus: 10 },
      { marker: '🗑️', bucket: 'removed', minus: 10 },
    ];
    expect(renderDigest(units, DIFF_PROFILE)).toBe('3/11/2 files +214 −96  🪚 6  📝 4  🧪 3  🗑️ 2  🔨 1');
  });

  test('results: the spec worked example, verbatim — 🔍 lands in the matched residual', () => {
    const units: DigestUnit[] = [
      ...repeat('🔍', 14), ...repeat('🌗', 2), ...repeat('🦗', 1),
    ];
    expect(renderDigest(units, RESULTS_PROFILE)).toBe('14/2/1 hits  🔍 14  🌗 2  🦗 1');
  });

  test('the checklist profile is byte-identical to renderChecklistSummary (the SKILL.md example)', () => {
    const items: DigestUnit[] = [
      ...repeat('✅', 8), ...repeat('🤖', 4), ...repeat('⏳', 2), ...repeat('🔜', 2),
      ...repeat('❗', 2), ...repeat('🌐', 1), ...repeat('🛠️', 1), ...repeat('🤔', 1),
      ...repeat('🌗', 2), ...repeat('❌', 1), ...repeat('🚫', 1),
    ];
    const viaDigest = renderDigest(items, CHECKLIST_PROFILE);
    expect(viaDigest).toBe(renderChecklistSummary(items));
    expect(viaDigest).toBe(
      '8/13/4 items (32%) ███▒░░░░░░\n' +
      '\n' +
      '✅ 8\n' +
      '🤖 4  ⏳ 2  🔜 2  ❗ 2  🌐 1  🛠️ 1  🤔 1\n' +
      '🌗 2  ❌ 1  🚫 1'
    );
  });

  test('a non-scalar profile never fabricates a percent or bar', () => {
    const rendered = renderDigest(repeat('⚠️', 3), FINDINGS_PROFILE);
    expect(rendered).not.toContain('%');
    expect(rendered).not.toContain('█');
    expect(rendered).not.toContain('░');
  });

  test('a trend sparkline with 4+ points renders after the head, before the icon list', () => {
    const rendered = renderDigest(repeat('⚠️', 2), FINDINGS_PROFILE, { series: [0, 12.5, 25, 100] });
    expect(rendered).toBe('0/2/0 findings  trend ▁▂▃█  ⚠️ 2');
  });

  test('a 3-point series is silently omitted, exactly as the checklist rule', () => {
    expect(renderDigest(repeat('⚠️', 2), FINDINGS_PROFILE, { series: [10, 20, 30] }))
      .toBe('0/2/0 findings  ⚠️ 2');
  });

  test('9+ distinct entries drop to the block form, bucket lines in the profile order', () => {
    const units: DigestUnit[] = [
      // blocking (4 distinct), degraded (4 distinct), note (1) — nine distinct markers.
      ...repeat('❗', 2), ...repeat('🦹', 1), ...repeat('🌋', 1), ...repeat('❌', 1),
      ...repeat('⚠️', 3), ...repeat('🐛', 2), ...repeat('🤡', 1), ...repeat('😕', 1),
      ...repeat('🔍', 1),
    ];
    expect(renderDigest(units, FINDINGS_PROFILE)).toBe(
      '5/7/1 findings\n' +
      '\n' +
      '❗ 2  ❌ 1  🦹 1  🌋 1\n' +
      '⚠️ 3  🐛 2  🤡 1  😕 1\n' +
      '🔍 1'
    );
  });

  test('an explicit bucket override the profile does not define falls back to marker classification', () => {
    // 'blocking' is not an options bucket, so ✅ still classifies as chosen.
    expect(renderDigest([{ marker: '✅', bucket: 'blocking' }], OPTIONS_PROFILE))
      .toBe('1/0/0 options  ✅ 1');
  });

  test('an empty units array throws RangeError', () => {
    expect(() => renderDigest([], FINDINGS_PROFILE)).toThrow(RangeError);
    try {
      renderDigest([], FINDINGS_PROFILE);
    } catch (err) {
      expect((err as Error).message).toContain('non-empty');
    }
  });

});

describe('leadUnitIndex — the lead line argmax', () => {

  test('the highest-priority attention marker wins, wherever it sits', () => {
    const units: DigestUnit[] = [
      { marker: '✅' }, { marker: '🚫' }, { marker: '❌' }, { marker: '⏳' },
    ];
    // Checklist attention order is ❌ ❗ 🚫 🦗: the ❌ at index 2 outranks the 🚫 at 1.
    expect(leadUnitIndex(units, CHECKLIST_PROFILE)).toBe(2);
  });

  test('ties on attention rank go to the earliest unit in body order', () => {
    const units: DigestUnit[] = [{ marker: '✅' }, { marker: '❌' }, { marker: '❌' }];
    expect(leadUnitIndex(units, CHECKLIST_PROFILE)).toBe(1);
  });

  test('no attention marker present returns -1 (the caller leads with the all-clear)', () => {
    expect(leadUnitIndex([{ marker: '✅' }, { marker: '⏳' }], CHECKLIST_PROFILE)).toBe(-1);
  });

  test('a profile with no mechanical salience rule (diff) always returns -1', () => {
    expect(leadUnitIndex([{ marker: '🌋', bucket: 'modified' }], DIFF_PROFILE)).toBe(-1);
  });

});

describe('overallBucket — the nested artifact state', () => {

  test('any failure makes a checklist overall failure', () => {
    expect(overallBucket([{ marker: '✅' }, { marker: '❌' }], CHECKLIST_PROFILE)).toBe('failure');
  });

  test('work still running makes it active; fully landed makes it success', () => {
    expect(overallBucket([{ marker: '✅' }, { marker: '⏳' }], CHECKLIST_PROFILE)).toBe('active');
    expect(overallBucket([{ marker: '✅' }, { marker: '💯' }], CHECKLIST_PROFILE)).toBe('success');
  });

  test('an options artifact is open while any option is open, chosen once decided', () => {
    expect(overallBucket([{ marker: '✅' }, { marker: '🤔' }], OPTIONS_PROFILE)).toBe('open');
    expect(overallBucket([{ marker: '✅' }, { marker: '❌' }], OPTIONS_PROFILE)).toBe('chosen');
    expect(overallBucket([{ marker: '❌' }, { marker: '👎' }], OPTIONS_PROFILE)).toBe('rejected');
  });

  test('an empty units array throws RangeError', () => {
    expect(() => overallBucket([], CHECKLIST_PROFILE)).toThrow(RangeError);
  });

});

describe('nestDigest — nesting by digest substitution', () => {

  test('an inline child digest embeds whole, bucketed by its overall state', () => {
    const nested = nestDigest([{ marker: '✅' }, { marker: '❌' }], CHECKLIST_PROFILE);
    expect(nested).toEqual({
      line   : '1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1',
      bucket : 'failure',
    });
  });

  test('a block-form child contributes only its head line — one body line, never a block', () => {
    const units: DigestUnit[] = [
      { marker: '✅' }, { marker: '🤖' }, { marker: '⏳' }, { marker: '🌐' },
      { marker: '🛠️' }, { marker: '🛰️' }, { marker: '🔜' }, { marker: '🦥' },
      { marker: '❌' },
    ];
    const nested = nestDigest(units, CHECKLIST_PROFILE);
    expect(nested.line).toBe('1/7/1 items (11%) █░░░░░░░░░');
    expect(nested.line).not.toContain('\n');
    expect(nested.bucket).toBe('failure');
  });

  test('the child counts as exactly one unit in the parent partition, via the bucket override', () => {
    const child  = nestDigest([{ marker: '✅' }, { marker: '❌' }, { marker: '❌' }], CHECKLIST_PROFILE);
    // The parent carries the whole 3-unit child as ONE item, bucketed by its overall state.
    const parent = renderChecklistSummary([
      { marker: '✅' },
      { marker: '📋', bucket: child.bucket as 'success' | 'active' | 'failure' },
    ]);
    expect(parent).toBe('1/0/1 items (50%) █████░░░░░  ✅ 1  📋 1');
  });

});
