import { fromMarkdown } from 'mdast-util-from-markdown';

import {
  lintLists, proseLists, classifyList, listBlockReason,
  SQUARE_LIST_MIN, SQUARE_LIST_MAX, EXCERPT_MAX,
} from '../channels/format_lint.js';

const parse = (text: string) => fromMarkdown(text);

describe('lintLists — what it flags', () => {

  test('a numbered list of three is a violation, located and counted', () => {
    const message = 'Three options:\n\n1. rebase\n2. merge\n3. squash\n';
    expect(lintLists(message, parse)).toEqual([
      { kind: 'ordered-list', severity: 'violation', items: 3, line: 3, excerpt: '1. rebase' },
    ]);
  });

  test('a bullet list of two is only a warning', () => {
    expect(lintLists('- one\n- two\n', parse)).toEqual([
      { kind: 'bullet-list', severity: 'warning', items: 2, line: 1, excerpt: '- one' },
    ]);
  });

  test('an ordered list starting at 4 is still an ordered list', () => {
    expect(lintLists('4. d\n5. e\n', parse)[0]?.kind).toBe('ordered-list');
  });

  test('a paren-numbered list is an ordered list too', () => {
    expect(lintLists('1) a\n2) b\n', parse)[0]).toMatchObject({ kind: 'ordered-list', items: 2 });
  });

  test('lists nested inside a list item are inspected as their own lists', () => {
    const message = '- outer one\n  1. inner a\n  2. inner b\n- outer two\n';
    const kinds = lintLists(message, parse).map(f => `${f.kind}:${String(f.items)}`);
    expect(kinds).toEqual(['bullet-list:2', 'ordered-list:2']);
  });

  test('the boundaries: one item and eleven items are not number-square-shaped', () => {
    expect(SQUARE_LIST_MIN).toBe(2);
    expect(SQUARE_LIST_MAX).toBe(10);
    expect(lintLists('1. alone\n', parse)).toEqual([]);
    const eleven = Array.from({ length: 11 }, (_, i) => `${String(i + 1)}. item`).join('\n');
    const ten    = Array.from({ length: 10 }, (_, i) => `${String(i + 1)}. item`).join('\n');
    expect(lintLists(eleven, parse)).toEqual([]);
    expect(lintLists(ten, parse)[0]?.items).toBe(10);
  });

  test('a long first line is excerpted, never stored whole', () => {
    const long    = `1. ${'x'.repeat(200)}\n2. y\n`,
          excerpt = lintLists(long, parse)[0]?.excerpt ?? '';
    expect(excerpt.length).toBe(EXCERPT_MAX);
    expect(excerpt.endsWith('…')).toBe(true);
  });

});

describe('lintLists — what it must leave alone', () => {

  test('a fenced code block full of numbered lines and YAML dashes is never a list', () => {
    const message = [
      'Here is the config:',
      '',
      '```yaml',
      'steps:',
      '  - checkout',
      '  - build',
      '  - test',
      '```',
      '',
      'and the plan as plain text:',
      '',
      '```text',
      '1. first',
      '2. second',
      '3. third',
      '```',
    ].join('\n');
    expect(lintLists(message, parse)).toEqual([]);
  });

  test('a tilde fence and a diff block are left alone', () => {
    const message = [
      '~~~',
      '1. numbered',
      '2. inside tildes',
      '~~~',
      '',
      '```diff',
      '- need: which repo is the source of truth? 😟',
      '- need: OK to force-push? 😬',
      '+ 💡 what if the log fed a sparkline? 🤩',
      '```',
    ].join('\n');
    expect(lintLists(message, parse)).toEqual([]);
  });

  test('indented code is left alone', () => {
    const message = 'Output:\n\n    1. one\n    2. two\n    - dash\n    - dash\n';
    expect(lintLists(message, parse)).toEqual([]);
  });

  test('inline code containing list markers is left alone', () => {
    expect(lintLists('Run `1. a 2. b` and `- x - y` then stop.', parse)).toEqual([]);
  });

  test('HTML blocks are left alone', () => {
    const message = '<div>\n1. one\n2. two\n</div>\n';
    expect(lintLists(message, parse)).toEqual([]);
  });

  test('a blockquoted list is skipped — the squares never belong in a blockquote', () => {
    const message = '> 1. quoted one\n> 2. quoted two\n>\n> - a\n> - b\n';
    expect(lintLists(message, parse)).toEqual([]);
  });

  test('a list nested inside a blockquote inside a list is skipped too', () => {
    const message = '- outer\n  > 1. deep\n  > 2. deeper\n- outer two\n';
    expect(lintLists(message, parse).map(f => f.kind)).toEqual(['bullet-list']);
  });

  test('a correct number-square list is paragraphs, not a list', () => {
    const message = [
      '  1️⃣ write decisions at decision-time',
      '',
      '  2️⃣ prefer storage the next agent loads',
      '',
      '  3️⃣ record the why beside the what',
    ].join('\n');
    expect(lintLists(message, parse)).toEqual([]);
  });

  test('a signature line and a checklist fence produce nothing', () => {
    const message = [
      '```',
      '✅ lint',
      '✅ typecheck',
      '🟡 build',
      '```',
      '',
      '`[9:14 am PDT]` ⬆️ 🙂 🧭 - feat `»` flow; clear plan',
    ].join('\n');
    expect(lintLists(message, parse)).toEqual([]);
  });

  test('prose enumeration is prose', () => {
    expect(lintLists('First we build, then we test, and 2. is not a list here.', parse)).toEqual([]);
  });

});

describe('proseLists and classifyList', () => {

  test('proseLists returns lists in document order, skipping blockquotes', () => {
    const tree  = parse('1. a\n2. b\n\n> - q\n> - r\n\n- c\n- d\n');
    expect(proseLists(tree).map(list => list.ordered)).toEqual([true, false]);
  });

  test('classifyList reads the start line from the node position', () => {
    const source = '\n\n\n1. a\n2. b\n',
          [list] = proseLists(parse(source));
    expect(list).toBeDefined();
    if (list !== undefined) {
      expect(classifyList(list, source)).toMatchObject({ line: 4, excerpt: '1. a' });
    }
  });

});

describe('listBlockReason', () => {

  test('names every blocking list and asks for number squares without a restatement', () => {
    const reason = listBlockReason([
      { kind: 'ordered-list', severity: 'violation', items: 3, line: 4, excerpt: '1. a' },
      { kind: 'ordered-list', severity: 'violation', items: 2, line: 9, excerpt: '1. z' },
    ]);
    expect(reason).toContain('line 4 (3 items, "1. a")');
    expect(reason).toContain('line 9 (2 items, "1. z")');
    expect(reason).toContain('1️⃣');
    expect(reason).toContain('do not restate');
  });

});
