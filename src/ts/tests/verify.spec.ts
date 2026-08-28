import { verifyChecklist, extractChecklistBlock, parseSummaryCounts } from '../charts/verify.js';
import { renderChecklistSummary } from '../charts/checklist.js';
import type { ChecklistItem } from '../charts/checklist.js';

/**
 * Composes a full checklist block the way a session actually would: one `- <marker> …`
 * line per item, a blank line, then the summary rendered by the real renderer — so
 * every "passes" assertion below is the renderer and the validator agreeing on the
 * same contract, not a hand-made expected value checked against itself.
 */
function compose(items: readonly ChecklistItem[], indents?: readonly number[], series?: readonly number[]): string {
  const lines = items.map((item, i) =>
    `${' '.repeat(indents?.[i] ?? 0)}- ${item.marker} item ${String(i)}`);
  const summary = renderChecklistSummary(items, series === undefined ? undefined : { series: [...series] });
  return `${lines.join('\n')}\n\n${summary}`;
}

const INLINE_ITEMS: ChecklistItem[] = [
  ...Array<ChecklistItem>(4).fill({ marker: '✅' }), { marker: '🔜' }, { marker: '❌' },
];

// The SKILL.md example: 11 distinct markers, so the icon list drops to a block below.
const BLOCK_ITEMS: ChecklistItem[] = [
  ...Array<ChecklistItem>(8).fill({ marker: '✅' }), ...Array<ChecklistItem>(4).fill({ marker: '🤖' }),
  ...Array<ChecklistItem>(2).fill({ marker: '⏳' }), ...Array<ChecklistItem>(2).fill({ marker: '🔜' }),
  ...Array<ChecklistItem>(2).fill({ marker: '❗' }), { marker: '🌐' }, { marker: '🛠️' },
  { marker: '🤔' }, ...Array<ChecklistItem>(2).fill({ marker: '🌗' }),
  { marker: '❌' }, { marker: '🚫' },
];

describe('extractChecklistBlock', () => {

  test('takes the first fenced block out of a markdown document', () => {
    const doc = 'intro\n```\n- ✅ done\n```\noutro\n```\nnot this one\n```';
    expect(extractChecklistBlock(doc)).toEqual(['- ✅ done']);
  });

  test('a bare block passes through whole', () => {
    expect(extractChecklistBlock('- ✅ a\n- ❌ b')).toEqual(['- ✅ a', '- ❌ b']);
  });

});

describe('parseSummaryCounts', () => {

  test('parses the stated triple and percent out of a rendered block', () => {
    expect(parseSummaryCounts(compose(INLINE_ITEMS)))
      .toEqual({ success: 4, active: 1, failure: 1, percent: 67 });
  });

  test('returns null when the block carries no summary line', () => {
    expect(parseSummaryCounts('- ✅ done\n- ❌ broke')).toBeNull();
  });

});

describe('verifyChecklist — agreement with the renderer', () => {

  test('a renderer-produced inline-form checklist passes every check', () => {
    const verdict = verifyChecklist(compose(INLINE_ITEMS));
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.itemCount).toBe(6);
    expect(verdict.report).toContain('ok: 6 items parsed');
    expect(verdict.report).toContain('ok: all checks passed');
  });

  test('a renderer-produced block-form checklist (11 distinct markers) passes', () => {
    const verdict = verifyChecklist(compose(BLOCK_ITEMS));
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.itemCount).toBe(BLOCK_ITEMS.length);
  });

  test('a wrapped bucket line (13 distinct active markers) passes with blank separation', () => {
    const actives = ['🤖', '⏳', '🌐', '🛠️', '🛰️', '🔜', '🦥', '🦡', '⏭️', '⏸️', '❗', '⏰', '🧠'];
    const items: ChecklistItem[] = [{ marker: '✅' }, ...actives.map(marker => ({ marker }))];
    const verdict = verifyChecklist(compose(items));
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test('nested items at 2- and 4-space indents pass', () => {
    const items: ChecklistItem[] = [{ marker: '✅' }, { marker: '🤖' }, { marker: '🔜' }];
    expect(verifyChecklist(compose(items, [0, 2, 4])).ok).toBe(true);
  });

  test('a trend sparkline on the summary line is accepted, not mistaken for icons', () => {
    const verdict = verifyChecklist(compose(INLINE_ITEMS, undefined, [10, 20, 30, 40]));
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test('a fenced markdown wrapper verifies the same as the bare block', () => {
    const bare = compose(INLINE_ITEMS);
    expect(verifyChecklist(`preamble\n\`\`\`\n${bare}\n\`\`\`\npostamble`).ok).toBe(true);
  });

  test('🛳️ may count as success or as active — both partitions pass', () => {
    const asActive = '- ✅ shipped\n- 🛳️ deploying\n\n1/1/0 items (50%) █████░░░░░  ✅ 1  🛳️ 1';
    const asSuccess = '- ✅ shipped\n- 🛳️ deployed\n\n2/0/0 items (100%) ██████████  ✅ 1  🛳️ 1';
    expect(verifyChecklist(asActive).ok).toBe(true);
    expect(verifyChecklist(asSuccess).ok).toBe(true);
  });

});

describe('verifyChecklist — catching what the eye misses', () => {

  test('a wrong percent is flagged', () => {
    const corrupted = compose(INLINE_ITEMS).replace('(67%)', '(76%)');
    const verdict = verifyChecklist(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('percent 76% stated, 67% computed');
  });

  test('a wrong bar cell is flagged', () => {
    const corrupted = compose(INLINE_ITEMS).replace('██████▓░░░', '███████░░░');
    const verdict = verifyChecklist(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('bar');
  });

  test('an icon count that disagrees with the items is flagged', () => {
    const corrupted = compose(INLINE_ITEMS).replace('✅ 4', '✅ 5');
    const verdict = verifyChecklist(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('✅');
  });

  test('an unknown marker is flagged by name', () => {
    const verdict = verifyChecklist('- 🤷 who knows\n\n0/1/0 items (0%) ░░░░░░░░░░  🤷 1');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('unknown marker 🤷');
  });

  test('a 3-space indent is flagged', () => {
    const items: ChecklistItem[] = [{ marker: '✅' }, { marker: '🔜' }];
    const verdict = verifyChecklist(compose(items, [0, 3]));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('bad indent 3');
  });

  test('an unsorted icon list is flagged', () => {
    const verdict = verifyChecklist('- ✅ a\n- ✅ b\n- ❌ c\n\n2/0/1 items (67%) ██████▓░░░  ❌ 1  ✅ 2');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('order');
  });

  test('a missing summary line is flagged', () => {
    const verdict = verifyChecklist('- ✅ done\n- ❌ broke');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('no summary line found');
    expect(verdict.report).toContain('1 check(s) FAILED');
  });

  test('a count section that does not sum to the items is flagged', () => {
    const corrupted = compose(INLINE_ITEMS).replace('4/1/1 items', '4/2/1 items');
    const verdict = verifyChecklist(corrupted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('sums to 7, but 6 items were parsed');
  });

  test('an icon listed with no matching item is flagged', () => {
    const verdict = verifyChecklist('- ✅ a\n\n1/0/0 items (100%) ██████████  ✅ 1  🐛 1');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('🐛 listed but no such item exists');
  });

  test('nine or more distinct markers left inline are flagged', () => {
    // Canonically ordered so the placement rule is the only failure.
    const markers = ['✅', '🤖', '⏳', '🌐', '🛠️', '🔜', '❌', '❗', '🤔'];
    const itemLines = markers.map(marker => `- ${marker} x`).join('\n');
    const icons = markers.map(marker => `${marker} 1`).join('  ');
    const verdict = verifyChecklist(`${itemLines}\n\n1/7/1 items (11%) █░░░░░░░░░  ${icons}`);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual([
      'FAIL: 9 distinct markers (≥9) must move to a block below the bar, not inline',
    ]);
  });

});
