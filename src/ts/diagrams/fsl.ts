/**
 * A small FSL-subset parser: exactly the fragment `renderFsl` (in
 * `../charts/timeline.ts`) emits, turned back into a {@link Digraph}.
 *
 * The subset is: bare transitions (`a -> b;`), action-labeled transitions
 * (`a 'action' -> b;`), chained arrows (`a -> b -> c;`), multiple `;`-separated
 * statements, and the active-state `**bold**` marks (stripped on parse). Everything
 * else in real FSL/jssm — probabilities, named machines, themes, other arrow kinds —
 * is a `RangeError` naming the subset, never a silent skip: this project carries
 * zero runtime dependencies, so jssm's full grammar deliberately stays out of scope
 * (`2026-08-27-diagrams-design.md` § FSL / jssm). A caller with a full FSL machine
 * has jssm; a transcript diagram needs the topology.
 *
 * Round-trip property, pinned by the stochastic suite: for any transition list `t`,
 * `parseFsl(renderFsl(t))` yields the same edge sequence as `t`, actions and all.
 *
 * @see ../charts/timeline.js
 * @see ./model.js
 */

import { normalizeGraph } from './model.js';
import type { Digraph, DiagramEdge } from './model.js';

/** The one-line description of the accepted grammar, used by every rejection. */
const SUBSET =
  "the FSL subset accepted is: statements of chained transitions ending in ';', each "
  + "transition 'state -> state' with an optional quoted 'action' before the arrow, and "
  + 'optional **bold** marks around a state name';

/** One lexical token of the subset grammar. */
interface FslToken {
  kind: 'word' | 'action' | 'arrow' | 'semi';
  text: string;
}

/** True for the whitespace the tokenizer skips between tokens. */
function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** Characters that end a bare word; `-` ends one only when it starts a `->` arrow. */
function isWordBreak(source: string, i: number): boolean {
  const ch = source[i];
  if (ch === undefined || isSpace(ch) || ch === ';' || ch === "'") { return true; }
  return ch === '-' && source[i + 1] === '>';
}

/** Rejects word content the subset never produces, naming what it saw and the subset. */
function requireSubsetWord(word: string): void {
  for (const [ch, feature] of [
    [':', 'named machines and metadata'],
    ['%', 'probabilities'],
    ['<', 'other arrow kinds'],
    ['=', 'other arrow kinds'],
    ['~', 'other arrow kinds'],
  ] as const) {
    if (word.includes(ch)) {
      throw new RangeError(
        `'${word}' looks like FSL ${feature}, which is outside the subset; ${SUBSET}`
      );
    }
  }
}

/** Strips a `**bold**` active-state wrapper; a stray `*` elsewhere is a rejection. */
function unwrapBold(word: string): string {
  const bolded = word.startsWith('**') && word.endsWith('**') && word.length > 4;
  const bare = bolded ? word.slice(2, -2) : word;
  if (bare.includes('*')) {
    throw new RangeError(`unexpected '*' in state name '${word}'; ${SUBSET}`);
  }
  return bare;
}

/** Tokenizes the source into words, quoted actions, arrows, and semicolons. */
function tokenize(source: string): FslToken[] {
  const tokens: FslToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined || isSpace(ch)) { i += 1; continue; }
    if (ch === ';') { tokens.push({ kind: 'semi', text: ';' }); i += 1; continue; }
    if (ch === "'") {
      const close = source.indexOf("'", i + 1);
      if (close === -1) {
        throw new RangeError(`unterminated quoted action starting at index ${String(i)}; ${SUBSET}`);
      }
      const text = source.slice(i + 1, close);
      if (text === '') {
        throw new RangeError(`empty quoted action at index ${String(i)}; ${SUBSET}`);
      }
      tokens.push({ kind: 'action', text });
      i = close + 1;
      continue;
    }
    if (ch === '-' && source[i + 1] === '>') {
      tokens.push({ kind: 'arrow', text: '->' });
      i += 2;
      continue;
    }
    let j = i;
    while (!isWordBreak(source, j)) { j += 1; }
    const raw = source.slice(i, j);
    requireSubsetWord(raw);
    tokens.push({ kind: 'word', text: unwrapBold(raw) });
    i = j;
  }
  return tokens;
}

/**
 * Parses an FSL-subset source string into a validated {@link Digraph}: each
 * transition becomes an edge, each quoted action its edge's label, and the node set
 * is inferred in first-appearance order. `**bold**` active-state marks are stripped
 * — the active state is display information, carried separately by
 * `renderStateDiagram`'s `activeState` option, not part of the topology.
 *
 * @param source the FSL text, e.g. output of `renderFsl`; must contain at least one
 *                transition, and every statement must end with `;`
 *
 * @example
 *   parseFsl("locked 'coin' -> unlocked 'push' -> locked;")
 *   // => {
 *   //   nodes: [{ id: 'locked' }, { id: 'unlocked' }],
 *   //   edges: [
 *   //     { from: 'locked', to: 'unlocked', label: 'coin' },
 *   //     { from: 'unlocked', to: 'locked', label: 'push' },
 *   //   ],
 *   // }
 *
 * @throws {RangeError} If the source is empty, a statement is malformed or missing
 *                        its `;`, or the text uses FSL features outside the subset
 *                        (probabilities, named machines, other arrow kinds); every
 *                        rejection names the subset.
 * @see normalizeGraph
 */
export function parseFsl(source: string): Digraph {

  const tokens = tokenize(source);
  if (tokens.length === 0) {
    throw new RangeError(`parseFsl needs at least one transition; ${SUBSET}`);
  }

  const edges: DiagramEdge[] = [];
  let pos = 0;

  const peek = (): FslToken | undefined => tokens[pos];
  const take = (): FslToken | undefined => tokens[pos++];

  while (pos < tokens.length) {

    const first = take();
    if (first?.kind !== 'word') {
      throw new RangeError(
        `expected a state name to start a statement, saw '${first?.text ?? 'end of input'}'; ${SUBSET}`
      );
    }

    let from = first.text;
    let transitions = 0;

    for (;;) {
      const next = peek();
      if (next === undefined || (next.kind !== 'action' && next.kind !== 'arrow')) { break; }

      let action: string | undefined = undefined;
      if (next.kind === 'action') { action = next.text; pos += 1; }

      const arrow = take();
      if (arrow?.kind !== 'arrow') {
        throw new RangeError(
          `expected '->' after ${action === undefined ? `'${from}'` : `action '${action}'`}, `
          + `saw '${arrow?.text ?? 'end of input'}'; ${SUBSET}`
        );
      }

      const target = take();
      if (target?.kind !== 'word') {
        throw new RangeError(
          `expected a state name after '->', saw '${target?.text ?? 'end of input'}'; ${SUBSET}`
        );
      }

      edges.push(action === undefined
        ? { from, to: target.text }
        : { from, to: target.text, label: action });
      from = target.text;
      transitions += 1;
    }

    if (transitions === 0) {
      throw new RangeError(`state '${from}' has no transition; ${SUBSET}`);
    }

    const semi = take();
    if (semi?.kind !== 'semi') {
      throw new RangeError(
        `expected ';' to end the statement, saw '${semi?.text ?? 'end of input'}'; ${SUBSET}`
      );
    }

  }

  return normalizeGraph(edges);

}
