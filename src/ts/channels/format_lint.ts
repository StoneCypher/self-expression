/**
 * The list lint: find prose lists in an assistant message that should have been
 * number-square lists.
 *
 * The conventions say that up to ten parallel items are rendered with the number
 * squares `1️⃣`…`🔟`, not as a Markdown `1.` list. Remembering that was left to the model,
 * and in practice it forgot. This module is the check, and its construction is the whole
 * answer to "will it interfere with code?":
 *
 * - The message is **parsed** into an mdast tree by a real CommonMark parser, never
 *   scanned with a regular expression. Only `list` nodes are inspected. Fenced code,
 *   indented code, inline code, HTML, and diff blocks are `code` / `inlineCode` / `html`
 *   nodes, which have no children, so a numbered line or a YAML dash inside them can
 *   never become a list node — they cannot be touched, by construction rather than by a
 *   carefully maintained exclusion list.
 * - Anything inside a **blockquote** is skipped. The number squares must never appear in
 *   a blockquote (italics render them poorly), so a quoted list is not a mistake this
 *   lint may point at.
 * - An **ordered** list of 2–10 items is a violation: it is exactly the shape the squares
 *   replace. A **bullet** list in the same range is only a warning, because bullets are
 *   often the right choice for non-parallel items and the lint cannot tell.
 *
 * The parser is **injected** rather than imported. That keeps this module free of a
 * runtime dependency (the library bundles import it without pulling in a parser), and it
 * lets the command-line entry load the parser lazily, so a missing parser skips the lint
 * instead of preventing the whole binary from loading.
 *
 * Only the assistant's own message is ever given to this module — never files, never
 * tool inputs.
 *
 * @see ../mcp/hooks.js onStop
 * @see ./signature_line.js the one-line grammar, which is a different kind of question
 */

import type { List, Nodes, Root } from 'mdast';

/**
 * Turns Markdown into an mdast tree. `mdast-util-from-markdown`'s `fromMarkdown` has
 * this shape.
 */
export type MarkdownParser = (text: string) => Root;

/** Which kind of list a finding is about. */
export type ListKind = 'ordered-list' | 'bullet-list';

/** How serious a finding is: a `violation` may block; a `warning` never does. */
export type FindingSeverity = 'violation' | 'warning';

/** Fewest items a list must have to be number-square-shaped: one item is not a list. */
export const SQUARE_LIST_MIN = 2;

/** Most items the number squares can carry: `1️⃣` through `🔟`. */
export const SQUARE_LIST_MAX = 10;

/** Longest excerpt of a flagged list kept for the findings log, in characters. */
export const EXCERPT_MAX = 60;

/** One list the lint flagged. */
export interface ListFinding {
  readonly kind     : ListKind;
  readonly severity : FindingSeverity;
  /** How many items the list has. */
  readonly items    : number;
  /** The 1-based line of the message the list starts on. */
  readonly line     : number;
  /** The list's first source line, trimmed and capped at {@link EXCERPT_MAX}. */
  readonly excerpt  : string;
}

/**
 * Every list node in the tree that is not inside a blockquote, in document order,
 * including lists nested inside list items.
 *
 * A walk rather than a visitor library, because the rule is tiny: descend into anything
 * with children except a blockquote. Code, inline code, and HTML nodes have no children,
 * so they end the walk on their own.
 *
 * @param tree a parsed message
 * @returns the prose list nodes
 *
 * @example
 *   proseLists(fromMarkdown('1. a\n2. b\n\n> 1. quoted\n> 2. list'))
 *   // => [the first list only]
 */
export function proseLists(tree: Root): List[] {

  const found: List[] = [];

  const walk = (node: Nodes): void => {
    if (node.type === 'blockquote') { return; }
    if (node.type === 'list') { found.push(node); }
    if ('children' in node) {
      for (const child of node.children) { walk(child); }
    }
  };

  walk(tree);

  return found;

}

/**
 * The first source line of a node, trimmed and capped, for the findings log.
 *
 * @param source the whole message the node was parsed from
 * @param line   the node's 1-based start line
 */
function excerptAt(source: string, line: number): string {
  const text = (source.split(/\r?\n/u)[line - 1] ?? '').trim();
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text;
}

/**
 * Classify one list node: a finding when it has 2–10 items, else `null`.
 *
 * @param list   a list node from {@link proseLists}
 * @param source the message it was parsed from, for the excerpt
 *
 * @example
 *   classifyList(orderedListOfThree, source)
 *   // => { kind: 'ordered-list', severity: 'violation', items: 3, line: 4, excerpt: '1. first' }
 */
export function classifyList(list: List, source: string): ListFinding | null {

  const items = list.children.length;
  if (items < SQUARE_LIST_MIN || items > SQUARE_LIST_MAX) { return null; }

  const ordered = list.ordered === true,
        line    = list.position?.start.line ?? 1;

  return {
    kind     : ordered ? 'ordered-list' : 'bullet-list',
    severity : ordered ? 'violation'    : 'warning',
    items,
    line,
    excerpt  : excerptAt(source, line),
  };

}

/**
 * Lint one assistant message for lists that should be number-square lists.
 *
 * @param text  the assistant message, exactly as it was sent
 * @param parse the Markdown parser to use
 * @returns every finding, in document order; empty when the message is clean
 *
 * @example
 *   lintLists('Options:\n\n1. rebase\n2. merge\n', fromMarkdown)
 *   // => [{ kind: 'ordered-list', severity: 'violation', items: 2, line: 3, excerpt: '1. rebase' }]
 *
 * @example
 *   lintLists('```yaml\n- a\n- b\n```\n\n```text\n1. x\n2. y\n```', fromMarkdown)
 *   // => [] — code blocks are never list nodes
 *
 * @see proseLists
 * @see classifyList
 */
export function lintLists(text: string, parse: MarkdownParser): ListFinding[] {
  return proseLists(parse(text))
    .map(list => classifyList(list, text))
    .filter((finding): finding is ListFinding => finding !== null);
}

/**
 * The refusal sentence for ordered-list violations, naming where each one starts.
 *
 * @param violations the findings that are blocking
 * @returns one paragraph, suitable for a Stop hook `reason`
 *
 * @example
 *   listBlockReason([{ kind: 'ordered-list', severity: 'violation', items: 3, line: 4, excerpt: '1. a' }])
 *   // => 'This message uses a Markdown numbered list where the conventions ask for …'
 */
export function listBlockReason(violations: readonly ListFinding[]): string {
  const where = violations.map(v => `line ${String(v.line)} (${String(v.items)} items, "${v.excerpt}")`).join('; ');
  return 'This message uses a Markdown numbered list where the conventions ask for a ' +
    'number-square list: each item on its own line, indented two spaces, starting with ' +
    `1️⃣ … 🔟, with a blank line between items. Found at ${where}. Re-send just that ` +
    'list in number-square form, then end with your close signature line again; do ' +
    'not restate the rest of the message.';
}
