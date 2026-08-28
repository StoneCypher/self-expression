import { verifyDigest, verifyChecklist } from '../charts/verify.js';
import { renderDigest }                  from '../charts/digest.js';
import type { DigestUnit }               from '../charts/digest.js';
import { FINDINGS_PROFILE, DIFF_PROFILE, RESULTS_PROFILE } from '../charts/profiles.js';

/** Composes a body-plus-digest block the way a session would, via the real renderer. */
function compose(units: readonly DigestUnit[], profile: typeof FINDINGS_PROFILE): string {
  const body = units.map((unit, i) => `- ${unit.marker} unit ${String(i)}`).join('\n');
  return `${body}\n\n${renderDigest(units, profile)}`;
}

const FINDINGS: DigestUnit[] = [
  { marker: '❗' }, { marker: '❗' }, { marker: '⚠️' }, { marker: '🐛' }, { marker: '🔍' },
];

describe('verifyDigest — agreement with the renderer', () => {

  test('a renderer-produced findings artifact passes every check', () => {
    const verdict = verifyDigest(compose(FINDINGS, FINDINGS_PROFILE));
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.itemCount).toBe(5);
    expect(verdict.report).toContain('ok: 5 findings parsed');
    expect(verdict.report).toContain('ok: all checks passed');
  });

  test('a renderer-produced diff artifact passes — partition accepted by kind, tail present', () => {
    const units: DigestUnit[] = [
      { marker: '🧪', bucket: 'added', plus: 40 },
      { marker: '🪚', bucket: 'modified', plus: 12, minus: 8 },
      { marker: '🗑️', bucket: 'removed', minus: 30 },
    ];
    const verdict = verifyDigest(compose(units, DIFF_PROFILE));
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.passes.join('\n')).toContain('partition accepted');
  });

  test('a checklist digest delegates wholesale to verifyChecklist', () => {
    const block = '- ✅ shipped\n- ❌ broke\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1';
    expect(verifyDigest(block)).toEqual(verifyChecklist(block));
    expect(verifyDigest(block).ok).toBe(true);
  });

  test('a fenced markdown wrapper verifies the same as the bare block', () => {
    const bare = compose(FINDINGS, FINDINGS_PROFILE);
    expect(verifyDigest(`preamble\n\`\`\`\n${bare}\n\`\`\`\npostamble`).ok).toBe(true);
  });

});

describe('verifyDigest — catching what the eye misses', () => {

  test('a count section that does not sum to the units is flagged', () => {
    const corrupted = compose(FINDINGS, FINDINGS_PROFILE).replace('2/2/1 findings', '2/3/1 findings');
    const verdict = verifyDigest(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('sums to 6, but 5 findings were parsed');
  });

  test('a partition that disagrees with the markers is flagged per bucket', () => {
    const corrupted = compose(FINDINGS, FINDINGS_PROFILE).replace('2/2/1 findings', '1/3/1 findings');
    const verdict = verifyDigest(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain("bucket 'blocking': stated 1, computed 2 from markers");
  });

  test('a fabricated percent and bar on a scalar-less profile is flagged', () => {
    const block = '- 🔍 a\n- 🔍 b\n\n2/0/0 hits (100%) ██████████  🔍 2';
    const verdict = verifyDigest(block);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('no scalar axis');
  });

  test('a missing +N −M tail on a diff digest is flagged', () => {
    const block = '- 🪚 a\n\n0/1/0 files  🪚 1';
    const verdict = verifyDigest(block);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('line-count tail');
  });

  test('a +N −M tail on a non-diff profile is flagged', () => {
    const block = '- 🔍 a\n\n1/0/0 hits +3 −1  🔍 1';
    const verdict = verifyDigest(block);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('does not carry');
  });

  test('a count section of the wrong width for the profile is flagged', () => {
    const block = '- 🔍 a\n\n1/0 hits  🔍 1';
    const verdict = verifyDigest(block);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('partitions into 3 buckets');
  });

  test('an icon count that disagrees with the units is flagged', () => {
    const corrupted = compose(FINDINGS, FINDINGS_PROFILE).replace('❗ 2', '❗ 3');
    const verdict = verifyDigest(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('❗');
  });

  test('an unsorted icon list is flagged', () => {
    const block = '- 🌗 a\n- 🦗 b\n- 🦗 c\n\n0/1/2 hits  🌗 1  🦗 2';
    const verdict = verifyDigest(block);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('order');
  });

  test('an unknown marker is flagged by name', () => {
    const block = '- 🤷 who knows\n\n0/0/1 findings  🤷 1';
    const verdict = verifyDigest(block);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('unknown marker 🤷');
  });

  test('a block with no recognizable digest line is flagged', () => {
    const verdict = verifyDigest('- ⚠️ degraded\n- ❗ blocker');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('no digest line found');
    expect(verdict.report).toContain('1 check(s) FAILED');
  });

  test('an unknown noun is not mistaken for a digest line', () => {
    const verdict = verifyDigest('- ⚠️ a\n\n1/0/0 zebras  ⚠️ 1');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('no digest line found');
  });

  test('a bad indent is flagged, exactly as the checklist body grammar', () => {
    const units = [{ marker: '⚠️' }, { marker: '🔍' }];
    const good = compose(units, FINDINGS_PROFILE);
    const corrupted = good.replace('- 🔍 unit 1', '   - 🔍 unit 1');
    const verdict = verifyDigest(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('bad indent 3');
  });

  test('a results digest with a wrong partial count is flagged', () => {
    const units: DigestUnit[] = [{ marker: '🔍' }, { marker: '🌗' }, { marker: '🦗' }];
    const corrupted = compose(units, RESULTS_PROFILE).replace('1/1/1 hits', '2/0/1 hits');
    const verdict = verifyDigest(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain("bucket 'matched': stated 2, computed 1 from markers");
  });

});
