import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { z }                   from 'zod';
import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import { recordEntry }           from '../channels/entries.js';
import {
  handleRenderSeries, handleRenderBar, handleRenderRows, handleRenderTimeline,
  handleRenderGlyph, handleRenderChecklistSummary, registerChartTools,
  SERIES_FORMS, BAR_FORMS, ROWS_FORMS, TIMELINE_FORMS, GLYPH_FORMS,
} from '../mcp/chart_tools.js';

/**
 * A non-empty tuple, which is what `z.enum` requires — the same tiny helper
 * `chart_tools.ts` keeps file-private, reimplemented here so the "unknown form" tests
 * below can build the exact same kind of schema the tool registration does, without
 * chart_tools.ts needing to export its internal per-tool zod shapes just for this.
 */
function tuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) { throw new Error('vocabulary must not be empty'); }
  return [first, ...rest];
}

const VERSION = '0.2.0';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-chart-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Pulls the plain text out of a tool reply, the shape every assertion below checks. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

describe('handleRenderSeries', () => {

  test('sparkline form renders literal data', () => withStore(s => {
    expect(text(handleRenderSeries(s, { form: 'sparkline', data: [0, 12.5, 25, 100] }))).toBe('▁▂▃█');
  }));

  test('sparkline form resolves seriesKey to recorded percents, on the absolute scale', () => withStore(s => {
    for (const percent of [10, 40, 70, 100]) {
      recordEntry(s, { channel: 'need', text: 'checkpoint', session: 's1', seriesKey: 'coverage', percent }, VERSION);
    }
    // absoluteIndex(percent, 8): 10->0 '▁', 40->3 '▄', 70->5 '▆', 100->7(clamped) '█'
    expect(text(handleRenderSeries(s, { form: 'sparkline', seriesKey: 'coverage' }))).toBe('▁▄▆█');
  }));

  test('a conflicting scale is ignored when seriesKey is supplied — always renders absolute', () => withStore(s => {
    for (const percent of [10, 40, 70, 100]) {
      recordEntry(s, { channel: 'need', text: 'checkpoint', session: 's1', seriesKey: 'scale-conflict', percent }, VERSION);
    }
    // Same [10,40,70,100] data, requested on the 'relative' scale this series' own
    // min(10)/max(100) would produce relativeIndex mapping '▁▃▆█' (40 -> step 2, '▃')
    // rather than the absolute mapping '▁▄▆█' (40 -> step 3, '▄') — asserting the
    // absolute string proves 'scale' was actually overridden, not merely unread.
    const out = text(handleRenderSeries(s, { form: 'sparkline', seriesKey: 'scale-conflict', scale: 'relative' }));
    expect(out).toBe('▁▄▆█');
  }));

  test('braille form resolves seriesKey the same way', () => withStore(s => {
    for (const percent of [0, 20, 50, 100]) {
      recordEntry(s, { channel: 'need', text: 'checkpoint', session: 's1', seriesKey: 'braille-series', percent }, VERSION);
    }
    expect(text(handleRenderSeries(s, { form: 'braille', seriesKey: 'braille-series' }))).toBe('⣀⣄⣶⣿');
  }));

  test('a 3-point series is under the 4-point minimum and returns an error', () => withStore(s => {
    const out = text(handleRenderSeries(s, { form: 'sparkline', data: [1, 2, 3] }));
    expect(out.startsWith('error: ')).toBe(true);
    expect(out).toContain('4');
  }));

  test('winloss form renders one glyph per outcome', () => withStore(s => {
    expect(text(handleRenderSeries(s, { form: 'winloss', outcomes: ['pass', 'fail'] }))).toBe('✅❌');
  }));

  test('sparkline form without data or seriesKey names both accepted fields', () => withStore(s => {
    const out = text(handleRenderSeries(s, { form: 'sparkline' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'data'");
    expect(out).toContain("'seriesKey'");
  }));

  test('winloss form without outcomes names the missing field', () => withStore(s => {
    const out = text(handleRenderSeries(s, { form: 'winloss' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('outcomes');
  }));

});

describe('handleRenderBar', () => {

  test('progress form', () => withStore(s => {
    expect(text(handleRenderBar(s, { form: 'progress', percent: 32 }))).toBe('███▒░░░░░░');
  }));

  test('bullet form — the bars.ts pinned example', () => withStore(s => {
    expect(text(handleRenderBar(s, { form: 'bullet', value: 65, target: 90, max: 100 }))).toBe('▉▉▉▉▉▉▌░░│');
  }));

  test('diverging form — the bars.ts pinned example', () => withStore(s => {
    expect(text(handleRenderBar(s, { form: 'diverging', value: 50, maxAbs: 100 }))).toBe('░░░░░░┃███░░░');
  }));

  test('stacked form — the bars.ts pinned example', () => withStore(s => {
    expect(text(handleRenderBar(s, {
      form: 'stacked', success: 1, activePending: 1, failure: 2,
    }))).toBe('████▓▓▓▓▒▒▒▒▒▒▒▒');
  }));

  test('range form — the bars.ts pinned example', () => withStore(s => {
    expect(text(handleRenderBar(s, {
      form: 'range', value: 6, min: 0, max: 10, style: 'fill',
    }))).toBe('▕▓▓▓▓▓▓░░░░▏');
  }));

  test('boxwhisker form — the bars.ts pinned example', () => withStore(s => {
    expect(text(handleRenderBar(s, {
      form: 'boxwhisker', min: 0, q1: 25, median: 50, q3: 75, max: 100,
    }))).toBe('├───┨▓▓▓┃▓▓┠───┤');
  }));

  test('bullet form missing target names the missing field', () => withStore(s => {
    const out = text(handleRenderBar(s, { form: 'bullet', value: 65, max: 100 }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'target'");
  }));

  test('a domain violation is caught and reported as error text, not thrown', () => withStore(s => {
    const out = text(handleRenderBar(s, { form: 'progress', percent: 101 }));
    expect(out).toMatch(/^error: /);
  }));

});

describe('handleRenderRows', () => {

  test('comparison form — the rows.ts pinned dot example', () => withStore(s => {
    expect(text(handleRenderRows(s, {
      form: 'comparison', rows: [{ label: 'x', value: 50, max: 100 }], width: 10, style: 'dot',
    }))).toBe('x  ░░░░░●░░░░  50%');
  }));

  test('tilegrid form — the rows.ts pinned pixel example', () => withStore(s => {
    expect(text(handleRenderRows(s, {
      form: 'tilegrid', grid: [[{ value: 0 }, null, { value: 100 }]], fill: 'pixel',
    }))).toBe('🟥 ⬛ 🟦');
  }));

  test('comparison form without rows names the missing field', () => withStore(s => {
    const out = text(handleRenderRows(s, { form: 'comparison' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'rows'");
  }));

});

describe('handleRenderTimeline', () => {

  const milestones = [
    { label: 'spec',  state: 'reached'  as const },
    { label: 'build', state: 'reached'  as const },
    { label: 'test',  state: 'current'  as const },
    { label: 'ship',  state: 'future'   as const },
  ];

  test('rail form — the timeline.ts pinned example', () => withStore(s => {
    expect(text(handleRenderTimeline(s, { form: 'rail', milestones })))
      .toBe('━●━━━━━━━━●━━━━━━━◆━━━━━━━○━━\nspec    build    test    ship');
  }));

  test('colored form — the timeline.ts pinned example', () => withStore(s => {
    const colored = [
      { label: 'spec',  state: 'reached' as const },
      { label: 'build', state: 'failed'  as const },
      { label: 'test',  state: 'current' as const },
      { label: 'ship',  state: 'future'  as const },
    ];
    expect(text(handleRenderTimeline(s, { form: 'colored', milestones: colored })))
      .toBe('🟢 spec ━━ 🔶 build ━━ 🟦 test ━━ ◎ ship');
  }));

  test('dependency form — the timeline.ts pinned example', () => withStore(s => {
    expect(text(handleRenderTimeline(s, {
      form: 'dependency', steps: ['lint', 'test', 'build', 'deploy'], currentIndex: 2,
    }))).toBe('lint ━ test ━ b̲u̲i̲l̲d̲ ━ deploy');
  }));

  test('fsl form — the timeline.ts pinned example', () => withStore(s => {
    expect(text(handleRenderTimeline(s, {
      form: 'fsl',
      transitions: [
        { from: 'locked', to: 'unlocked', action: 'coin' },
        { from: 'unlocked', to: 'locked', action: 'push' },
      ],
      activeState: 'locked',
    }))).toBe("**locked** 'coin' -> unlocked 'push' -> locked;");
  }));

  test('dependency form missing currentIndex names the missing field', () => withStore(s => {
    const out = text(handleRenderTimeline(s, { form: 'dependency', steps: ['lint', 'test'] }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'currentIndex'");
  }));

});

describe('handleRenderGlyph', () => {

  test('trend form', () => withStore(s => {
    expect(text(handleRenderGlyph(s, { form: 'trend', text: '32%', direction: 'up' }))).toBe('32% ▲');
  }));

  test('stars form', () => withStore(s => {
    expect(text(handleRenderGlyph(s, { form: 'stars', score: 4, max: 5 }))).toBe('★★★★☆');
  }));

  test('retry form', () => withStore(s => {
    expect(text(handleRenderGlyph(s, { form: 'retry', available: 3, spent: 2 }))).toBe('❤️❤️❤️🩶🩶');
  }));

  test('weather form', () => withStore(s => {
    expect(text(handleRenderGlyph(s, { form: 'weather', state: 'mixed' }))).toBe('⛅');
  }));

  test('stars form missing score names the missing field', () => withStore(s => {
    const out = text(handleRenderGlyph(s, { form: 'stars' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain("'score'");
  }));

});

describe('handleRenderChecklistSummary', () => {

  test('renders the full summary line — the checklist.ts pinned inline example', () => withStore(s => {
    const items = [
      { marker: '✅' }, { marker: '✅' }, { marker: '✅' }, { marker: '✅' },
      { marker: '🔜' }, { marker: '❌' },
    ];
    expect(text(handleRenderChecklistSummary(s, { items })))
      .toBe('4/1/1 items (67%) ██████▓░░░  ✅ 4  🔜 1  ❌ 1');
  }));

  test('seriesKey resolves to a trend sparkline appended to the summary', () => withStore(s => {
    for (const percent of [10, 40, 70, 100]) {
      recordEntry(s, { channel: 'need', text: 'checkpoint', session: 's1', seriesKey: 'checklist-trend', percent }, VERSION);
    }
    const items = [{ marker: '✅' }, { marker: '✅' }, { marker: '❌' }];
    const out = text(handleRenderChecklistSummary(s, { items, seriesKey: 'checklist-trend' }));
    expect(out).toContain('trend ▁▄▆█');
  }));

});

describe('form is a closed schema vocabulary', () => {

  test.each([
    ['render_series', SERIES_FORMS],
    ['render_bar', BAR_FORMS],
    ['render_rows', ROWS_FORMS],
    ['render_timeline', TIMELINE_FORMS],
    ['render_glyph', GLYPH_FORMS],
  ] as const)('%s rejects a misspelled form rather than accepting it', (_name, forms) => {
    const result = z.enum(tuple(forms)).safeParse('not-a-real-form');
    expect(result.success).toBe(false);
  });

  test.each([
    ['render_series', SERIES_FORMS],
    ['render_bar', BAR_FORMS],
    ['render_rows', ROWS_FORMS],
    ['render_timeline', TIMELINE_FORMS],
    ['render_glyph', GLYPH_FORMS],
  ] as const)('%s still accepts every one of its real forms', (_name, forms) => {
    for (const form of forms) {
      expect(z.enum(tuple(forms)).safeParse(form).success).toBe(true);
    }
  });

});

describe('registerChartTools', () => {

  test('registers all six tools on a fresh server without throwing', () => withStore(s => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => { registerChartTools(server, s); }).not.toThrow();
  }));

});
