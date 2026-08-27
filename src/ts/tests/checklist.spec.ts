import { renderChecklistSummary } from '../charts/checklist.js';
import type { ChecklistItem } from '../charts/checklist.js';

/** Builds `count` items all sharing the same marker (and optional bucket override). */
function repeat(marker: string, count: number, bucket?: ChecklistItem['bucket']): ChecklistItem[] {
  return Array.from({ length: count }, () => (bucket === undefined ? { marker } : { marker, bucket }));
}

describe('renderChecklistSummary', () => {

  test('the SKILL.md example renders byte-identical', () => {
    const items: ChecklistItem[] = [
      ...repeat('✅', 8),
      ...repeat('🤖', 4),
      ...repeat('⏳', 2),
      ...repeat('🔜', 2),
      ...repeat('❗', 2),
      ...repeat('🌐', 1),
      ...repeat('🛠️', 1),
      ...repeat('🤔', 1),
      ...repeat('🌗', 2),
      ...repeat('❌', 1),
      ...repeat('🚫', 1),
    ];
    const expected =
      '8/13/4 items (32%) ███▒░░░░░░\n' +
      '\n' +
      '✅ 8\n' +
      '🤖 4  ⏳ 2  🔜 2  ❗ 2  🌐 1  🛠️ 1  🤔 1\n' +
      '🌗 2  ❌ 1  🚫 1';
    expect(renderChecklistSummary(items)).toBe(expected);
  });

  test('the skill\'s inline example: 4/1/1 items (67%)', () => {
    const items: ChecklistItem[] = [
      ...repeat('✅', 4),
      ...repeat('🔜', 1),
      ...repeat('❌', 1),
    ];
    expect(renderChecklistSummary(items)).toBe('4/1/1 items (67%) ██████▓░░░  ✅ 4  🔜 1  ❌ 1');
  });

  test('the release-build example: 4/1/1 items (67%) with 💯 folded into success', () => {
    const items: ChecklistItem[] = [
      ...repeat('✅', 3),
      ...repeat('💯', 1),
      ...repeat('🔜', 1),
      ...repeat('❌', 1),
    ];
    // 💯 counts as success but ranks its own icon entry, distinct from ✅.
    expect(renderChecklistSummary(items)).toBe('4/1/1 items (67%) ██████▓░░░  ✅ 3  💯 1  🔜 1  ❌ 1');
  });

  test('count section always three numbers summing to the total', () => {
    const items: ChecklistItem[] = [...repeat('✅', 2), ...repeat('🔜', 3), ...repeat('❌', 1)];
    const rendered = renderChecklistSummary(items);
    const [, s, a, f] = /^(\d+)\/(\d+)\/(\d+) items/.exec(rendered) as unknown as [string, string, string, string];
    expect(Number(s) + Number(a) + Number(f)).toBe(items.length);
    expect(s).toBe('2');
    expect(a).toBe('3');
    expect(f).toBe('1');
  });

  test('P rounds 100*success/total to the nearest integer (1/3 -> 33%)', () => {
    const items: ChecklistItem[] = [...repeat('✅', 1), ...repeat('🔜', 2)];
    expect(renderChecklistSummary(items)).toContain('items (33%)');
  });

  test('P rounds up at the .5 boundary (1/8 -> 13%, not 12%)', () => {
    // 100 * 1/8 = 12.5 -> rounds to 13
    const items: ChecklistItem[] = [...repeat('✅', 1), ...repeat('🔜', 7)];
    expect(renderChecklistSummary(items)).toContain('items (13%)');
  });

  test('an empty items array throws RangeError', () => {
    expect(() => renderChecklistSummary([])).toThrow(RangeError);
    try {
      renderChecklistSummary([]);
    } catch (err) {
      expect((err as Error).message).toContain('non-empty');
    }
  });

  test('options.series with >=4 points appends the trend sparkline after the bar', () => {
    const items: ChecklistItem[] = [...repeat('✅', 4), ...repeat('🔜', 1), ...repeat('❌', 1)];
    const rendered = renderChecklistSummary(items, { series: [0, 12.5, 25, 100] });
    expect(rendered).toBe('4/1/1 items (67%) ██████▓░░░  trend ▁▂▃█  ✅ 4  🔜 1  ❌ 1');
  });

  test('options.series with fewer than 4 points is silently ignored (no trend, no throw)', () => {
    const items: ChecklistItem[] = [...repeat('✅', 4), ...repeat('🔜', 1), ...repeat('❌', 1)];
    const rendered = renderChecklistSummary(items, { series: [10, 20, 30] });
    expect(rendered).toBe('4/1/1 items (67%) ██████▓░░░  ✅ 4  🔜 1  ❌ 1');
    expect(rendered).not.toContain('trend');
  });

  test('options.series appends the trend before a block-form icon list too', () => {
    // 9 distinct markers -> block form; trend must still trail the bar on the head line.
    const items: ChecklistItem[] = [
      ...repeat('✅', 1), ...repeat('🤖', 1), ...repeat('⏳', 1), ...repeat('🌐', 1),
      ...repeat('🛠️', 1), ...repeat('🛰️', 1), ...repeat('🔜', 1), ...repeat('🦥', 1),
      ...repeat('❌', 1),
    ];
    const rendered = renderChecklistSummary(items, { series: [0, 12.5, 25, 100] });
    const headLine = rendered.split('\n')[0] as string;
    expect(headLine).toContain('  trend ▁▂▃█');
    expect(headLine.endsWith('trend ▁▂▃█')).toBe(true);
  });

  test('exactly 8 distinct markers stays inline', () => {
    const items: ChecklistItem[] = [
      ...repeat('✅', 1), ...repeat('🤖', 1), ...repeat('⏳', 1), ...repeat('🌐', 1),
      ...repeat('🛠️', 1), ...repeat('🛰️', 1), ...repeat('🔜', 1), ...repeat('🦥', 1),
    ];
    const rendered = renderChecklistSummary(items);
    expect(rendered.split('\n')).toHaveLength(1);
  });

  test('9 distinct markers moves to the block form below the bar', () => {
    const items: ChecklistItem[] = [
      ...repeat('✅', 1), ...repeat('🤖', 1), ...repeat('⏳', 1), ...repeat('🌐', 1),
      ...repeat('🛠️', 1), ...repeat('🛰️', 1), ...repeat('🔜', 1), ...repeat('🦥', 1),
      ...repeat('❌', 1),
    ];
    const rendered = renderChecklistSummary(items);
    const lines = rendered.split('\n');
    expect(lines[0]).not.toMatch(/✅/); // icon list is not inline on the head line
    expect(lines[1]).toBe(''); // blank line separates head from the block
    expect(lines.length).toBeGreaterThan(2);
  });

  test('block form omits an empty bucket line entirely (no failure items)', () => {
    const items: ChecklistItem[] = [
      ...repeat('✅', 1), ...repeat('🤖', 1), ...repeat('⏳', 1), ...repeat('🌐', 1),
      ...repeat('🛠️', 1), ...repeat('🛰️', 1), ...repeat('🔜', 1), ...repeat('🦥', 1),
      ...repeat('🦡', 1),
    ];
    const rendered = renderChecklistSummary(items);
    const [, , , failureCount] = /^(\d+)\/(\d+)\/(\d+)/.exec(rendered) as unknown as [string, string, string, string];
    expect(failureCount).toBe('0');
    const block = rendered.split('\n\n')[1] as string;
    // No failure-bucket markers exist among the 9 active items above, so only two
    // block lines should appear (success, active) -- never a stray empty third line.
    const blockLines = block.split('\n');
    expect(blockLines.every(l => l.length > 0)).toBe(true);
  });

  test('13+ same-bucket distinct markers wrap at 12, blank-separating every bucket line', () => {
    // 13 distinct 'active' markers (none in SUCCESS_MARKERS/FAILURE_MARKERS), one
    // success item, one failure item -- forces the active bucket to wrap onto a
    // second line, which per the skill must blank-separate ALL bucket lines.
    const activeMarkers = [
      '🤖', '⏳', '🌐', '🛠️', '🛰️', '🔜', '🦥', '🦡', '⏭️', '⏸️', '❗', '⏰', '🧠',
    ];
    const items: ChecklistItem[] = [
      ...repeat('✅', 1),
      ...activeMarkers.map(marker => ({ marker })),
      ...repeat('❌', 1),
    ];
    const rendered = renderChecklistSummary(items);
    const [head, blank, ...rest] = rendered.split('\n');
    expect(head).toContain('1/13/1 items');
    expect(blank).toBe('');
    // success line, then a blank, then two active lines (12 + 1), then a blank, then failure
    expect(rest).toEqual([
      '✅ 1',
      '',
      '🤖 1  ⏳ 1  🌐 1  🛠️ 1  🛰️ 1  🔜 1  🦥 1  🦡 1  ⏭️ 1  ⏸️ 1  ❗ 1  ⏰ 1',
      '🧠 1',
      '',
      '❌ 1',
    ]);
  });

  test('sort tiebreak: equal counts order by CANONICAL_ORDER, not by input order', () => {
    // Passed in reverse-canonical order; rendering must still emit ⏳ before 🔜 before ❗
    // (all count 1) because that is their CANONICAL_ORDER rank, not arrival order.
    const items: ChecklistItem[] = [
      ...repeat('❗', 1), ...repeat('🔜', 1), ...repeat('⏳', 1), ...repeat('✅', 4),
    ];
    expect(renderChecklistSummary(items)).toBe('4/3/0 items (57%) █████▓░░░░  ✅ 4  ⏳ 1  🔜 1  ❗ 1');
  });

  test('a 🛳️ item classifies via its per-item bucket override', () => {
    const items: ChecklistItem[] = [
      ...repeat('✅', 3),
      { marker: '🛳️', bucket: 'success' },
    ];
    expect(renderChecklistSummary(items)).toBe('4/0/0 items (100%) ██████████  ✅ 3  🛳️ 1');
  });

  test('bar is always exactly 10 cells wide', () => {
    const items: ChecklistItem[] = [...repeat('✅', 1), ...repeat('🔜', 6)];
    const rendered = renderChecklistSummary(items);
    const bar = rendered.split(' ')[3] as string;
    expect([...bar]).toHaveLength(10);
  });

});
