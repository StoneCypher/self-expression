/**
 * The visible signature line: rendering it from a record, and recognising it in text.
 *
 * Until this module existed the line was composed by the model from memory of the
 * grammar, and the only machinery that looked at signatures checked that one had been
 * *recorded*. So a turn could record a close through `express`, never render the line,
 * and pass every gate — which is exactly what happened in practice. The fix is two-sided
 * and both halves live here, so they cannot drift:
 *
 * - {@link renderSignatureLine} builds the canonical line from a recorded row. `express`
 *   hands it back, so the model pastes a line instead of composing one — the same move
 *   `annotate` already makes for anchored notes.
 * - {@link parseSignatureLine} recognises that same grammar in the text of a message, so
 *   the Stop hook can check that the line the reader actually saw carries the text that
 *   was actually recorded.
 *
 * The recogniser is a regular expression over **one line** — the last or first non-empty
 * line of a message, which is a line-shaped question. That is deliberately different
 * from the list lint in `format_lint.ts`, which must never regex raw Markdown: a list is
 * a block structure, and only a parser can tell a list from a code block that contains
 * numbered lines.
 *
 * @see ../mcp/tools.js handleExpress
 * @see ../mcp/hooks.js onStop
 */

import type { Delta } from './vocabulary.js';
import type { Store } from './store.js';

/**
 * The delta glyphs, keyed by the recorded `delta` value.
 *
 * The same three arrows the skill documents: better, worse, steady — versus the previous
 * signature.
 *
 * @example
 *   DELTA_GLYPHS.up   // => '⬆️'
 */
export const DELTA_GLYPHS: Readonly<Record<Delta, string>> = {
  up     : '⬆️',
  down   : '⬇️',
  steady : '➡️',
};

/** What the timestamp renders as when no clock is available — never a fabricated one. */
export const NO_CLOCK = '--:--';

/** The uncertainty mark, prefixed directly to the face with no space. */
export const UNCERTAIN_MARK = '❓';

/**
 * Everything the visible line is built from, already resolved.
 *
 * `showDelta` is separate from `delta` because the skill says to omit the delta on a
 * session's first signature — and whether this *is* the first is a fact about the
 * record, not about the arguments, so the caller resolves it once and says so here.
 */
export interface SignatureParts {
  /** The rendered local clock, e.g. `9:14 am PDT`; `null` renders {@link NO_CLOCK}. */
  readonly tsLocal      : string | null;
  readonly delta        : Delta  | null;
  /** Whether a delta is meaningful: false on a session's first signature. */
  readonly showDelta    : boolean;
  readonly uncertain    : boolean;
  readonly face         : string | null;
  /** One or two non-face emoji, rendered exactly as recorded. */
  readonly contextEmoji : string | null;
  /** A Conventional Commits type; `null` omits the ` - type` segment and its hyphen. */
  readonly cctype       : string | null;
  readonly text         : string;
}

/**
 * Render the canonical visible signature line.
 *
 * Left to right: backticked bracketed timestamp, delta arrow, face (with ❓ prefixed when
 * uncertain), context emoji, ` - cctype`, then the backticked guillemet and the text.
 * Absent parts are omitted along with their spacing, so a bare signature is still one
 * well-formed line.
 *
 * @param parts the resolved pieces of the line
 * @returns the line, with no trailing newline
 *
 * @example
 *   renderSignatureLine({ tsLocal: '9:14 am PDT', delta: 'up', showDelta: true,
 *                         uncertain: false, face: '🙂', contextEmoji: '🧭',
 *                         cctype: 'feat', text: 'flow; clear plan' })
 *   // => '`[9:14 am PDT]` ⬆️ 🙂 🧭 - feat `»` flow; clear plan'
 *
 * @example
 *   renderSignatureLine({ tsLocal: null, delta: 'up', showDelta: false, uncertain: true,
 *                         face: '🤔', contextEmoji: null, cctype: null, text: 'fog' })
 *   // => '`[--:--]` ❓🤔 `»` fog'
 *
 * @see parseSignatureLine
 */
export function renderSignatureLine(parts: SignatureParts): string {

  const face  = parts.uncertain ? `${UNCERTAIN_MARK}${parts.face ?? ''}` : parts.face,
        arrow = parts.showDelta && parts.delta !== null ? DELTA_GLYPHS[parts.delta] : null,
        head  = [`\`[${parts.tsLocal ?? NO_CLOCK}]\``, arrow, face, parts.contextEmoji]
                  .filter((part): part is string => part !== null && part !== ''),
        type  = parts.cctype === null || parts.cctype === '' ? '' : ` - ${parts.cctype}`;

  return `${head.join(' ')}${type} \`»\` ${parts.text}`;

}

/** The three pieces a recognised signature line splits into. */
export interface ParsedSignatureLine {
  /** What sat inside the backticked brackets, e.g. `9:14 am PDT` or `--:--`. */
  readonly stamp  : string;
  /** Everything between the timestamp and the guillemet, trimmed; may be empty. */
  readonly middle : string;
  /** The text after the guillemet, trimmed. */
  readonly text   : string;
}

/**
 * The signature grammar as one anchored pattern: a backticked bracketed timestamp at the
 * start, a backticked guillemet later, and non-empty text after it.
 */
const SIGNATURE_PATTERN = /^`\[([^\]`]+)\]`(.*?)`»`[ \t]+(\S.*)$/u;

/**
 * Recognise one line as a signature line, or return `null`.
 *
 * Surrounding whitespace is ignored, because indentation is invisible in rendered prose
 * and the check is about what the reader saw. Anything else that departs from the
 * grammar — a missing backtick, the whole line in a code span, no text after `»` — is
 * not a signature line.
 *
 * @param line a single line of text
 * @returns the line's parts, or `null` when it does not follow the grammar
 *
 * @example
 *   parseSignatureLine('`[9:14 am PDT]` ⬆️ 🙂 🧭 - feat `»` flow; clear plan')
 *   // => { stamp: '9:14 am PDT', middle: '⬆️ 🙂 🧭 - feat', text: 'flow; clear plan' }
 *   parseSignatureLine('flow; clear plan')   // => null
 *
 * @see renderSignatureLine
 */
export function parseSignatureLine(line: string): ParsedSignatureLine | null {

  const match = SIGNATURE_PATTERN.exec(line.trim());
  if (match === null) { return null; }

  return {
    stamp  : (match[1] ?? '').trim(),
    middle : (match[2] ?? '').trim(),
    text   : (match[3] ?? '').trim(),
  };

}

/**
 * Two signature texts compare equal when they match after trimming and collapsing runs of
 * whitespace. Rendering can reflow spaces, and a doubled space is not a different
 * signature.
 *
 * @example
 *   sameSignatureText('flow;  clear plan ', 'flow; clear plan')   // => true
 *   sameSignatureText('flow', 'drag')                            // => false
 */
export function sameSignatureText(a: string, b: string): boolean {
  const norm = (s: string): string => s.trim().replace(/\s+/gu, ' ');
  return norm(a) === norm(b);
}

/**
 * The last line of `text` that has anything on it besides whitespace, or `null`.
 *
 * @example
 *   lastNonEmptyLine('body\n\n`[--:--]` `»` still\n\n')   // => '`[--:--]` `»` still'
 *   lastNonEmptyLine('  \n')                            // => null
 */
export function lastNonEmptyLine(text: string): string | null {
  const lines = text.split(/\r?\n/u).filter(line => line.trim() !== '');
  return lines.at(-1) ?? null;
}

/**
 * The first line of `text` that has anything on it besides whitespace, or `null`.
 *
 * @example
 *   firstNonEmptyLine('\n`[9:14 am PDT]` 🙂 `»` still\nwork')   // => '`[9:14 am PDT]` 🙂 `»` still'
 */
export function firstNonEmptyLine(text: string): string | null {
  return text.split(/\r?\n/u).find(line => line.trim() !== '') ?? null;
}

/** One recorded signature, as the Stop hook and `express` need it. */
export interface RecordedSignature {
  readonly id   : number;
  readonly text : string;
  /** The canonical visible line for this row; see {@link signatureLineFor}. */
  readonly line : string;
}

/**
 * Whether the session has any signature recorded before row `id`.
 *
 * This is the "session's first signature" test the delta omission rests on. It is asked
 * of the record rather than of the caller so that `express` (rendering right after the
 * write) and the Stop hook (rendering the same row later) always agree.
 *
 * @param session the session the row belongs to
 * @param id      the row being rendered; only earlier ids count
 *
 * @example
 *   hasEarlierSignature(store, 'sess-1', 41)   // => true once #40 was a signature
 */
export function hasEarlierSignature(store: Store, session: string, id: number): boolean {
  const row = store.db.prepare(
    `SELECT 1 AS found FROM entries
      WHERE session = ? AND channel = 'signature' AND id < ? LIMIT 1`).get(session, id);
  return row !== undefined;
}

/** A nullable text column read as a string or `null`. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The canonical visible line for recorded signature row `id`, or `null` when no such
 * signature exists.
 *
 * The timestamp is the row's own `ts_local` — the moment `express` recorded it, taken
 * from the server clock, so it is never fabricated. The delta is shown only when the
 * session had an earlier signature.
 *
 * @param id the entry id of a signature row
 *
 * @example
 *   signatureLineFor(store, 42)
 *   // => '`[9:14 am PDT]` ⬆️ 🙂 🧭 - feat `»` flow; clear plan'
 *
 * @see renderSignatureLine
 * @see hasEarlierSignature
 */
export function signatureLineFor(store: Store, id: number): string | null {

  const row = store.db.prepare(
    `SELECT id, session, ts_local, delta, uncertain, face, context_emoji, cctype, text
       FROM entries WHERE id = ? AND channel = 'signature'`).get(id);

  if (row === undefined) { return null; }

  const delta = textOrNull(row['delta']) as Delta | null;

  return renderSignatureLine({
    tsLocal      : textOrNull(row['ts_local']),
    delta,
    showDelta    : hasEarlierSignature(store, String(row['session']), id),
    uncertain    : Number(row['uncertain']) === 1,
    face         : textOrNull(row['face']),
    contextEmoji : textOrNull(row['context_emoji']),
    cctype       : textOrNull(row['cctype']),
    text         : String(row['text']),
  });

}

/**
 * The newest signature at `position` recorded for one turn, with its canonical line — or
 * `null` when the turn has none.
 *
 * Turn identity is the pair (`session`, `promptId`), exactly as
 * {@link ./entries.js hasClosingSignature} keys it; an absent session narrows nothing,
 * which is the same fail-open reading.
 *
 * @param position `open` or `close`
 *
 * @example
 *   turnSignature(store, 'sess-1', 'p1', 'close')
 *   // => { id: 42, text: 'flow; clear plan', line: '`[9:14 am PDT]` … `»` flow; clear plan' }
 */
export function turnSignature(
  store    : Store,
  session  : string | undefined,
  promptId : string,
  position : 'open' | 'close',
): RecordedSignature | null {

  const scoped = session !== undefined && session !== '',
        row    = store.db.prepare(
          `SELECT id, text FROM entries
            WHERE prompt_id = ? AND channel = 'signature' AND position = ?
              ${scoped ? 'AND session = ?' : ''}
            ORDER BY id DESC LIMIT 1`)
          .get(...(scoped ? [promptId, position, session] : [promptId, position]));

  if (row === undefined) { return null; }

  const id = Number(row['id']);

  return { id, text: String(row['text']), line: signatureLineFor(store, id) ?? '' };

}
