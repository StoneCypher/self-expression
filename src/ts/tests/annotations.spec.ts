import {
  renderAnnotations, renderAnchorSegment, renderAnchorTarget, QUOTE_DISPLAY_CAP,
} from '../charts/annotations.js';
import type { AnnotationNote, AnnotationKind, AnnotationResolution } from '../charts/annotations.js';
import { ANCHOR_KINDS } from '../channels/vocabulary.js';
import { resolveAnchor } from '../channels/anchors.js';

/** The store.ts pair from the design's own worked example. */
const STORE_NOTES: readonly AnnotationNote[] = [
  { anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141',
    anchorQuote: 'readConfig(store, key)', text: 'null for unset and for empty', face: '\u{1F615}' },
  { anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L162',
    anchorQuote: 'writeConfig', text: 'local timestamp never updated', face: '\u{1F928}' },
];

describe('the renderer’s local types agree with the channels layer', () => {

  // The renderer restates the anchor vocabulary so its shipped declaration file stands
  // alone (dist/channels/ is not published). These are the guards that keep the two
  // statements of it from drifting — the same arrangement, and the same defence, as the
  // schema's CHECKs versus entries.validate.

  test('every ANCHOR_KINDS member is a legal AnnotationKind, and every one renders', () => {
    for (const kind of ANCHOR_KINDS) {
      const asAnnotationKind: AnnotationKind = kind;   // compile-time: the union covers it
      expect(() => renderAnchorTarget({ text: 'x', anchorKind: asAnnotationKind, anchorTarget: 't' }))
        .not.toThrow();
    }
  });

  test('AnnotationKind admits nothing ANCHOR_KINDS does not', () => {
    const declared: AnnotationKind[] = ['file', 'prompt', 'reply', 'checklist', 'entry'];
    expect([...declared].sort()).toEqual([...ANCHOR_KINDS].sort());
  });

  test('a verdict from resolveAnchor is accepted by the renderer unchanged', () => {
    const verdict: AnnotationResolution = resolveAnchor(
      { kind: 'file', target: 'a.ts', span: 'L1', quote: 'moved me' },
      { fileLines: ['pad', 'moved me'] });
    expect(verdict.status).toBe('moved');
    expect(renderAnnotations([{ anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1',
                                anchorQuote: 'moved me', text: 'still true', resolution: verdict }]))
      .toContain('L1\u{2192}L2 (moved)');
  });

});

describe('renderAnchorTarget — per-kind target rendering', () => {

  test('a file renders path:line, and the whole path when it has no span', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'file', anchorTarget: 'a/b.ts', anchorSpan: 'L40' }))
      .toBe('a/b.ts:40');
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'file', anchorTarget: 'a/b.ts' }))
      .toBe('a/b.ts');
  });

  test('a range renders its first line, which is where a reader jumps', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'file', anchorTarget: 'a/b.ts', anchorSpan: 'L40-52' }))
      .toBe('a/b.ts:40');
  });

  test('markdown emits the clickable form the VS Code surface understands', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'file', anchorTarget: 'a/b.ts', anchorSpan: 'L40' },
                              { markdown: true }))
      .toBe('[a/b.ts:40](a/b.ts#L40)');
  });

  test('markdown degrades to plain text when there is no line to link to', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'file', anchorTarget: 'a/b.ts' }, { markdown: true }))
      .toBe('a/b.ts');
  });

  test('messages render as words, not as raw ids', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'prompt', anchorTarget: 'p-7' })).toBe('your message');
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'reply', anchorTarget: 'p-7' })).toBe('my reply');
  });

  test('a message says how far back it is when that is known', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'prompt', anchorTarget: 'p-5', turnsAgo: 2 }))
      .toBe('your message (2 turns ago)');
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'prompt', anchorTarget: 'p-6', turnsAgo: 1 }))
      .toBe('your message (1 turn ago)');
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'prompt', anchorTarget: 'p-7', turnsAgo: 0 }))
      .toBe('your message');
  });

  test('a checklist prefers its display title, falling back to the series key', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'checklist', anchorTarget: 'atlas',
                                targetLabel: 'Project Atlas' })).toBe('Project Atlas');
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'checklist', anchorTarget: 'atlas' })).toBe('atlas');
  });

  test('an entry renders as #id', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'entry', anchorTarget: '212' })).toBe('#212');
  });

  test('an orphaned target is marked gone — it lost its address, not its content', () => {
    expect(renderAnchorTarget({ text: 'x', anchorKind: 'file', anchorTarget: 'src/old.ts',
                                resolution: { status: 'orphaned' } })).toBe('src/old.ts (gone)');
  });

  test('an unknown kind is a RangeError naming the accepted domain', () => {
    expect(() => renderAnchorTarget({ text: 'x', anchorKind: 'diagram' as never, anchorTarget: 'a' }))
      .toThrow(/not an anchor kind/);
  });

});

describe('renderAnchorSegment — the anchored channel line', () => {

  test('renders the design’s worked file example exactly', () => {
    expect(renderAnchorSegment({
      anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141',
      anchorQuote: 'readConfig(store, key)',
      text: "null for unset and for empty; callers can't tell which", face: '\u{1F615}',
    })).toBe(
      '\u{2693} src/ts/channels/store.ts:141 `readConfig(store, key)` \u{00BB} ' +
      "null for unset and for empty; callers can't tell which \u{1F615}");
  });

  test('renders the design’s worked prompt example exactly', () => {
    expect(renderAnchorSegment({
      anchorKind: 'prompt', anchorTarget: 'p-7', anchorQuote: 'ship it when ready',
      text: '"ready" reads three ways: tests green, PR approved, or deployed', face: '\u{1F61F}',
    })).toBe(
      '\u{2693} your message `ship it when ready` \u{00BB} ' +
      '"ready" reads three ways: tests green, PR approved, or deployed \u{1F61F}');
  });

  test('renders the design’s worked entry example exactly — no quote, no empty backticks', () => {
    expect(renderAnchorSegment({
      anchorKind: 'entry', anchorTarget: '212',
      text: "that entry claimed the gate was exact; it wasn't for mid signatures", face: '\u{1F62C}',
    })).toBe(
      "\u{2693} #212 \u{00BB} that entry claimed the gate was exact; it wasn't for mid signatures \u{1F62C}");
  });

  test('a moved anchor shows its travel in place', () => {
    expect(renderAnchorSegment({
      anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L141', anchorQuote: 'x', text: 'still true',
      resolution: { status: 'moved', span: 'L158', from: 'L141' },
    })).toBe('\u{2693} a.ts:158 L141\u{2192}L158 (moved) `x` \u{00BB} still true');
  });

  test('an orphaned anchor keeps its quote and its note, marking only the address', () => {
    expect(renderAnchorSegment({
      anchorKind: 'file', anchorTarget: 'src/old.ts', anchorSpan: 'L4',
      anchorQuote: 'the quoted line', text: 'still worth saying',
      resolution: { status: 'orphaned' },
    })).toBe('\u{2693} src/old.ts:4 (gone) `the quoted line` \u{00BB} still worth saying');
  });

  test('a faceless note simply ends after its text', () => {
    expect(renderAnchorSegment({ anchorKind: 'entry', anchorTarget: '1', text: 'plain' }))
      .toBe('\u{2693} #1 \u{00BB} plain');
  });

  test('rejects a blank target and an empty note', () => {
    expect(() => renderAnchorSegment({ anchorKind: 'entry', anchorTarget: '  ', text: 'x' }))
      .toThrow(/blank anchorTarget/);
    expect(() => renderAnchorSegment({ anchorKind: 'entry', anchorTarget: '1', text: '   ' }))
      .toThrow(/empty text/);
  });

});

describe('renderAnnotations — the grouped block', () => {

  test('renders one group with its quotes padded to the widest', () => {
    expect(renderAnnotations(STORE_NOTES)).toBe([
      '\u{2693} src/ts/channels/store.ts',
      '   L141  `readConfig(store, key)`  \u{00BB} null for unset and for empty \u{1F615}',
      '   L162  `writeConfig`             \u{00BB} local timestamp never updated \u{1F928}',
    ].join('\n'));
  });

  test('a message group needs no position column at all', () => {
    expect(renderAnnotations([
      { anchorKind: 'prompt', anchorTarget: 'p-7', anchorQuote: 'ship it when ready',
        text: '"ready" reads three ways; assuming tests-green', face: '\u{1F914}' },
      { anchorKind: 'prompt', anchorTarget: 'p-7', anchorQuote: 'the old config format',
        text: 'two old formats exist; assuming v1', face: '\u{1F62C}' },
    ])).toBe([
      '\u{2693} your message',
      '   `ship it when ready`     \u{00BB} "ready" reads three ways; assuming tests-green \u{1F914}',
      '   `the old config format`  \u{00BB} two old formats exist; assuming v1 \u{1F62C}',
    ].join('\n'));
  });

  test('groups separate with a blank line, in the order their targets were first named', () => {
    const block = renderAnnotations([...STORE_NOTES,
      { anchorKind: 'prompt', anchorTarget: 'p-7', anchorQuote: 'ship it', text: 'ambiguous' },
    ]);
    expect(block).toContain('\n\n');
    expect(block.indexOf('\u{2693} src/ts/channels/store.ts'))
      .toBeLessThan(block.indexOf('\u{2693} your message'));
    // Line count is group headers plus notes plus the blank separators.
    expect(block.split('\n')).toHaveLength(3 + 2 + 1);
  });

  test('notes within a group order by position, not by arrival', () => {
    const block = renderAnnotations([
      { anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L90', anchorQuote: 'later', text: 'b' },
      { anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L9',  anchorQuote: 'early', text: 'a' },
    ]);
    expect(block.indexOf('L9 ')).toBeLessThan(block.indexOf('L90'));
  });

  test('same target, different kinds, are different groups — a kind is part of the address', () => {
    const block = renderAnnotations([
      { anchorKind: 'prompt', anchorTarget: 'p-1', anchorQuote: 'x', text: 'a' },
      { anchorKind: 'reply',  anchorTarget: 'p-1', anchorQuote: 'y', text: 'b' },
    ]);
    expect(block).toContain('\u{2693} your message');
    expect(block).toContain('\u{2693} my reply');
  });

  test('a quote over the display cap truncates with an ellipsis', () => {
    const long  = 'q'.repeat(QUOTE_DISPLAY_CAP + 20),
          block = renderAnnotations([{ anchorKind: 'entry', anchorTarget: '1', anchorQuote: long, text: 'x' }]);
    expect(block).toContain(`\`${'q'.repeat(QUOTE_DISPLAY_CAP - 1)}\u{2026}\``);
    expect(block).not.toContain(long);
  });

  test('a quote exactly at the cap is not truncated', () => {
    const exact = 'q'.repeat(QUOTE_DISPLAY_CAP);
    expect(renderAnnotations([{ anchorKind: 'entry', anchorTarget: '1', anchorQuote: exact, text: 'x' }]))
      .toContain(`\`${exact}\``);
  });

  test('a moved note shows its travel in the position column, the header staying the plain target', () => {
    expect(renderAnnotations([{
      anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L141', anchorQuote: 'x', text: 'still true',
      resolution: { status: 'moved', span: 'L158', from: 'L141' },
    }])).toBe([
      '\u{2693} a.ts',
      '   L141\u{2192}L158 (moved)  `x`  \u{00BB} still true',
    ].join('\n'));
  });

  test('one note orphaned does not mark the whole group gone — the file may still be there', () => {
    const block = renderAnnotations([
      { anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1', anchorQuote: 'gone', text: 'x',
        resolution: { status: 'orphaned' } },
      { anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L2', anchorQuote: 'here', text: 'y' },
    ]);
    expect(block.split('\n')[0]).toBe('\u{2693} a.ts');
    expect(block).toContain('(orphaned)');
  });

  test('orphaned and distant notes say so in the position column and keep their words', () => {
    const block = renderAnnotations([
      { anchorKind: 'file', anchorTarget: 'gone.ts', anchorSpan: 'L1', anchorQuote: 'q', text: 'kept',
        resolution: { status: 'orphaned' } },
      { anchorKind: 'prompt', anchorTarget: 'p-0', anchorQuote: 'r', text: 'also kept',
        resolution: { status: 'distant' } },
    ]);
    expect(block).toContain('(orphaned)');
    expect(block).toContain('(distant)');
    expect(block).toContain('kept');
    expect(block).toContain('also kept');
  });

  test('a group where no note has a position drops the column entirely, not to blanks', () => {
    expect(renderAnnotations([{ anchorKind: 'entry', anchorTarget: '7', anchorQuote: 'q', text: 'x' }]))
      .toBe(['\u{2693} #7', '   `q`  \u{00BB} x'].join('\n'));
  });

  test('a group where no note has a quote drops that column too', () => {
    expect(renderAnnotations([{ anchorKind: 'entry', anchorTarget: '7', text: 'x' }]))
      .toBe(['\u{2693} #7', '   \u{00BB} x'].join('\n'));
  });

  test('the block line count is notes plus headers plus blank separators, for any grouping', () => {
    const notes: AnnotationNote[] = [
      { anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1', anchorQuote: 'a', text: '1' },
      { anchorKind: 'file', anchorTarget: 'b.ts', anchorSpan: 'L1', anchorQuote: 'b', text: '2' },
      { anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L2', anchorQuote: 'c', text: '3' },
      { anchorKind: 'entry', anchorTarget: '9', text: '4' },
    ];
    // Three groups: a.ts, b.ts, #9 -> 4 notes + 3 headers + 2 blank separators.
    expect(renderAnnotations(notes).split('\n')).toHaveLength(4 + 3 + 2);
  });

  test('markdown makes the position column clickable, the header naming the file once', () => {
    const block = renderAnnotations(STORE_NOTES, { markdown: true });
    expect(block.split('\n')[0]).toBe('\u{2693} src/ts/channels/store.ts');
    expect(block).toContain('[L141](src/ts/channels/store.ts#L141)');
    expect(block).toContain('[L162](src/ts/channels/store.ts#L162)');
  });

  test('an empty batch is a RangeError, not an empty string', () => {
    expect(() => renderAnnotations([])).toThrow(RangeError);
    expect(() => renderAnnotations([])).toThrow(/non-empty/);
  });

  test('a bad note is rejected by index, so the caller knows which one', () => {
    expect(() => renderAnnotations([
      { anchorKind: 'entry', anchorTarget: '1', text: 'fine' },
      { anchorKind: 'entry', anchorTarget: '2', text: '  ' },
    ])).toThrow(/note 1/);
  });

});
