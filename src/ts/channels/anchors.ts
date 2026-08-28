/**
 * Anchors: normalization, content fingerprinting, span grammar, and the pure read-time
 * resolvers behind the fresh → moved → orphaned ladder (issue #18).
 *
 * Nothing here touches the disk, the clock, the store, or randomness. A resolver takes
 * the anchor fields **plus the target's current content as an argument** — the tool
 * layer does the file read — so every verdict is a pure function of two values and can
 * be pinned by a test instead of a fixture directory.
 *
 * Two decisions govern the whole module:
 *
 * - **Exact normalized match only.** No fuzzy matching, no edit-distance threshold. A
 *   note confidently pinned to the wrong line is the worst failure this system can
 *   have; an orphan is merely the floating-prose behavior anchoring set out to improve
 *   on, so a miss degrades honestly rather than guessing. Ambiguity (two identical
 *   candidates) degrades to `orphaned` for the same reason.
 * - **Resolution is never stored.** It is a fact about the present state of the target,
 *   not about the entry, and a stored verdict would rot the moment the file changed
 *   again — the same argument that kept decoration glyphs out of storage.
 *
 * @see ./vocabulary.js
 * @see ./entries.js
 * @see ../../superpowers/spec/2026-08-27-anchoring-design.md
 */

import { createHash } from 'node:crypto';

import { ANCHOR_KINDS, isMember, describeVocabulary } from './vocabulary.js';
import type { AnchorKind } from './vocabulary.js';

/**
 * The longest quote an anchor may carry, in characters after normalization.
 *
 * Short on purpose: the quote's job is to make the note *findable and legible*, not to
 * reproduce the target. Quoting discipline is "the shortest span that is unambiguous",
 * and a cap is what keeps `anchor_quote` from becoming a second free-text column.
 */
export const ANCHOR_QUOTE_MAX = 120;

/**
 * How many hex characters of the SHA-256 digest an `anchor_hash` keeps.
 *
 * Sixteen hex characters is 64 bits — far past any collision risk at the scale of one
 * developer's annotation log, and short enough to read in a row dump. The truncation is
 * also the privacy property: a digest this size carries drift detection and same-target
 * grouping without carrying a single word of anyone's text.
 */
export const ANCHOR_HASH_CHARS = 16;

/** The anchor fields of one entry, as the resolvers need them. */
export interface Anchor {
  readonly kind    : AnchorKind;
  /** Repo-relative path, `prompt_id`, `series_key`, or entry id as text. */
  readonly target  : string;
  /** Per-kind position grammar; absent for a whole-file or whole-message note. */
  readonly span?   : string | undefined;
  /** The normalized excerpt, when one was recorded (privacy may have dropped it). */
  readonly quote?  : string | undefined;
  /** The stored fingerprint. Survives quote suppression, which is the point of it. */
  readonly hash?   : string | undefined;
}

/**
 * How an anchor stands against the target's current state.
 *
 * - `fresh`    — the recorded content is still where it was recorded.
 * - `moved`    — gone from the recorded span, found exactly once elsewhere.
 * - `orphaned` — gone, or ambiguous, or the target itself is gone.
 * - `distant`  — a message anchor whose turn is not in the session at hand; immutable,
 *                so never `moved`, but no longer nearby. The quote carries the weight.
 */
export type AnchorStatus = 'fresh' | 'moved' | 'orphaned' | 'distant';

/** One resolution verdict, plus where the content is now when that differs. */
export interface AnchorResolution {
  readonly status : AnchorStatus;
  /** The span the content occupies *now*, in the kind's own grammar, when known. */
  readonly span?  : string | undefined;
  /** The span originally recorded, present only on a `moved` verdict. */
  readonly from?  : string | undefined;
}

/**
 * Collapse a quote to its canonical comparison form: every run of whitespace becomes a
 * single space, and the ends are trimmed.
 *
 * This is what makes the fingerprint survive reindentation and line-ending changes —
 * the edits that move code around without changing it — while still failing on a real
 * content change. Idempotent by construction: normalizing twice is normalizing once.
 *
 * @param raw the excerpt as supplied or as read out of the target
 * @returns the whitespace-collapsed, trimmed form
 *
 * @example
 *   normalizeQuote('  readConfig(store,\n    key)  ')  // => 'readConfig(store, key)'
 *   normalizeQuote('')                                 // => ''
 *
 * @see anchorHash
 */
export function normalizeQuote(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

/**
 * The content fingerprint of a quote: {@link ANCHOR_HASH_CHARS} hex characters of
 * SHA-256 over its normalized form.
 *
 * Derived here and never accepted from a caller — a caller-supplied hash could disagree
 * with its own quote, and the entire value of the field is that it is a function of the
 * content. Equal normalized quotes hash equal and unequal ones do not, which is the
 * property both drift detection and privacy-suppressed grouping rest on.
 *
 * @param raw the excerpt; normalized before hashing, so callers need not pre-normalize
 * @returns 16 lowercase hex characters
 *
 * @example
 *   anchorHash('readConfig(store, key)') === anchorHash('  readConfig(store,\n  key) ')
 *   // => true
 *
 * @see normalizeQuote
 */
export function anchorHash(raw: string): string {
  return createHash('sha256').update(normalizeQuote(raw)).digest('hex').slice(0, ANCHOR_HASH_CHARS);
}

/** `L40` or `L40-52`, 1-based — the GitHub fragment convention already in use. */
const FILE_SPAN    = /^L(\d+)(?:-(\d+))?$/;
/** `#2` — an occurrence ordinal for a quote that appears more than once. */
const MESSAGE_SPAN = /^#(\d+)$/;
/** `@3` — the third point of a checklist series' percent history. */
const SERIES_SPAN  = /^@(\d+)$/;

/**
 * One inclusive 1-based line range, as {@link parseFileSpan} reads it.
 */
export interface LineSpan {
  readonly start : number;
  readonly end   : number;
}

/**
 * Read a `file` span into an inclusive 1-based line range, or `null` when the text is
 * not a valid file span.
 *
 * A bare `L40` is the one-line range 40–40, so callers never special-case the single
 * line. A backwards range (`L52-40`) is rejected rather than reordered: silently
 * repairing it would hide a caller bug in the one field a reader checks by eye.
 *
 * @param span the recorded span text
 * @returns the range, or `null` when the span is malformed, zero-based, or backwards
 *
 * @example
 *   parseFileSpan('L40')     // => { start: 40, end: 40 }
 *   parseFileSpan('L40-52')  // => { start: 40, end: 52 }
 *   parseFileSpan('L52-40')  // => null
 *   parseFileSpan('40')      // => null
 */
export function parseFileSpan(span: string): LineSpan | null {

  const matched = FILE_SPAN.exec(span);
  if (matched === null) { return null; }

  const start = Number(matched[1]),
        end   = matched[2] === undefined ? start : Number(matched[2]);

  if (start < 1 || end < start) { return null; }

  return { start, end };

}

/**
 * Read an occurrence ordinal out of a `prompt` / `reply` span, defaulting to the first
 * occurrence when no span was recorded.
 *
 * Ordinals beat character offsets: an offset breaks under any whitespace
 * renormalization, is unreadable in a row dump, and is only meaningful against retained
 * text — which a privacy-suppressed quote is not.
 *
 * @param span the recorded span, or `undefined` for "the first occurrence"
 * @returns the 1-based ordinal, or `null` when the span is not an ordinal
 *
 * @example
 *   parseOrdinal(undefined)  // => 1
 *   parseOrdinal('#2')       // => 2
 *   parseOrdinal('L40')      // => null
 */
export function parseOrdinal(span: string | undefined): number | null {

  if (span === undefined) { return 1; }

  const matched = MESSAGE_SPAN.exec(span);
  if (matched === null) { return null; }

  const ordinal = Number(matched[1]);
  return ordinal >= 1 ? ordinal : null;

}

/**
 * Whether `span` is legal for `kind`, as a problem sentence or `null` when it is fine.
 *
 * The grammar is per-kind and enforced at write time rather than trusted, because a
 * span is the one anchor field a human reads directly: `L40`/`L40-52` for `file`, `#2`
 * for `prompt` and `reply`, `@3` or nothing for `checklist`, and nothing at all for
 * `entry`, whose id is already exact.
 *
 * @param kind the anchor kind the span belongs to
 * @param span the proposed span text
 * @returns the problem, naming what would have been accepted, or `null`
 *
 * @example
 *   spanProblem('file', 'L40-52')  // => null
 *   spanProblem('file', '40')
 *   // => "anchorSpan '40' is not valid for a file anchor; expected L<line> or L<line>-<line> …"
 *   spanProblem('entry', '#1')
 *   // => 'anchorSpan is not accepted on an entry anchor — the id is already exact'
 *
 * @see parseFileSpan
 * @see parseOrdinal
 */
export function spanProblem(kind: AnchorKind, span: string): string | null {

  switch (kind) {

    case 'file':
      return parseFileSpan(span) === null
        ? `anchorSpan '${span}' is not valid for a file anchor; expected L<line> or ` +
          'L<line>-<line>, 1-based and forwards (for example L40 or L40-52)'
        : null;

    case 'prompt':
    case 'reply':
      return parseOrdinal(span) === null
        ? `anchorSpan '${span}' is not valid for a ${kind} anchor; expected an occurrence ` +
          "ordinal like '#2', or omit it for the first occurrence"
        : null;

    case 'checklist':
      return SERIES_SPAN.test(span)
        ? null
        : `anchorSpan '${span}' is not valid for a checklist anchor; expected a history ` +
          "point like '@3', or omit it and let the quote carry the item label";

    case 'entry':
      return 'anchorSpan is not accepted on an entry anchor — the id is already exact';

  }

}

/**
 * Where the `ordinal`-th occurrence of `quote` starts in `text`, both normalized, or
 * `-1` when there are fewer than `ordinal` occurrences.
 *
 * Both sides are normalized first, so the ordinal counts occurrences of the same thing
 * the fingerprint hashes — a quote that matches by hash and a quote that matches by
 * position can never disagree about what "the same text" means.
 *
 * @param text    the whole message being quoted from
 * @param quote   the excerpt
 * @param ordinal 1-based occurrence to locate; defaults to the first
 * @returns the character index in the normalized text, or `-1`
 *
 * @example
 *   locateQuote('ship it when ready. ship it', 'ship it')     // => 0
 *   locateQuote('ship it when ready. ship it', 'ship it', 2)  // => 19
 *   locateQuote('ship it when ready', 'later')                // => -1
 */
export function locateQuote(text: string, quote: string, ordinal = 1): number {

  const haystack = normalizeQuote(text),
        needle   = normalizeQuote(quote);

  if (needle === '' || ordinal < 1) { return -1; }

  let at = -1;
  for (let seen = 0; seen < ordinal; seen += 1) {
    at = haystack.indexOf(needle, at + 1);
    if (at === -1) { return -1; }
  }

  return at;

}

/** The normalized join of `lines[start-1 … end-1]`, or `null` when the range is off the end. */
function windowAt(lines: readonly string[], start: number, end: number): string | null {
  if (start < 1 || end > lines.length) { return null; }
  return normalizeQuote(lines.slice(start - 1, end).join(' '));
}

/**
 * Resolve a `file` anchor against the file's current lines — the drift ladder.
 *
 * The verdicts, in the order they are tried:
 *
 *   1. **fresh** — the normalized content at the recorded span still fingerprints to
 *      the anchor's hash.
 *   2. **moved** — it does not, but exactly one same-length window elsewhere in the
 *      file does. The result carries the new span and the old one.
 *   3. **orphaned** — the content is gone, the file is gone, or *more than one* window
 *      matches, which is ambiguous. Resolving on a guess is worse than not resolving,
 *      so ambiguity degrades rather than picking.
 *
 * A span-only anchor (no quote and no hash) cannot detect drift at all: it is `fresh`
 * while its span is inside the file and `orphaned` once it is past the end. That is
 * stated rather than hidden — an anchor with no fingerprint bought no drift detection.
 * A quote with no span searches the whole file, and one unique match reads as `fresh`
 * because nothing was recorded for it to have moved *from*.
 *
 * @param anchor the recorded anchor fields
 * @param lines  the file's current lines, or `null` when the file no longer exists
 *
 * @example
 *   resolveFileAnchor({ kind: 'file', target: 'a.ts', span: 'L2', quote: 'const b = 2;' },
 *                     ['const a = 1;', 'const b = 2;'])
 *   // => { status: 'fresh', span: 'L2' }
 *
 * @example
 *   resolveFileAnchor({ kind: 'file', target: 'a.ts', span: 'L1', quote: 'const b = 2;' },
 *                     ['inserted', 'const a = 1;', 'const b = 2;'])
 *   // => { status: 'moved', span: 'L3', from: 'L1' }
 *
 * @see resolveAnchor
 */
export function resolveFileAnchor(anchor: Anchor, lines: readonly string[] | null): AnchorResolution {

  if (lines === null) { return { status: 'orphaned' }; }

  const recorded    = anchor.span === undefined ? null : parseFileSpan(anchor.span),
        fingerprint = anchor.hash ?? (anchor.quote === undefined ? null : anchorHash(anchor.quote));

  // No fingerprint: nothing to compare, so the only honest question is whether the span
  // is still inside the file.
  if (fingerprint === null) {
    if (recorded === null) { return { status: 'orphaned' }; }
    return recorded.end <= lines.length
      ? { status: 'fresh', span: anchor.span }
      : { status: 'orphaned' };
  }

  const height = recorded === null ? 1 : recorded.end - recorded.start + 1;

  if (recorded !== null) {
    const here = windowAt(lines, recorded.start, recorded.end);
    if (here !== null && anchorHash(here) === fingerprint) {
      return { status: 'fresh', span: anchor.span };
    }
  }

  const hits: LineSpan[] = [];
  for (let start = 1; start + height - 1 <= lines.length; start += 1) {
    const end     = start + height - 1,
          content = windowAt(lines, start, end);
    if (content !== null && anchorHash(content) === fingerprint) { hits.push({ start, end }); }
  }

  const only = hits.length === 1 ? hits[0] : undefined;
  if (only === undefined) { return { status: 'orphaned' }; }

  const found = only.start === only.end ? `L${String(only.start)}` : `L${String(only.start)}-${String(only.end)}`;

  return recorded === null
    ? { status: 'fresh', span: found }
    : { status: 'moved', span: found, from: anchor.span };

}

/**
 * Resolve a `prompt` or `reply` anchor — the access ladder, not a drift ladder.
 *
 * A sent message is frozen, so these anchors can never *move*; what degrades is reach.
 * The anchor is `fresh` when its turn is one of the session's known turns and `distant`
 * otherwise (an earlier session, or a turn compacted out of view), in which case the
 * quote is the whole anchor and carries the weight.
 *
 * @param anchor      the recorded anchor fields
 * @param knownTurns  the `prompt_id`s currently in reach
 *
 * @example
 *   resolveMessageAnchor({ kind: 'prompt', target: 'p-2', quote: 'ship it' }, ['p-1', 'p-2'])
 *   // => { status: 'fresh' }
 *   resolveMessageAnchor({ kind: 'prompt', target: 'p-0', quote: 'ship it' }, ['p-1', 'p-2'])
 *   // => { status: 'distant' }
 */
export function resolveMessageAnchor(anchor: Anchor, knownTurns: readonly string[]): AnchorResolution {
  return knownTurns.includes(anchor.target)
    ? { status: 'fresh', span: anchor.span }
    : { status: 'distant', span: anchor.span };
}

/**
 * Resolve a `checklist` anchor against the series' latest item labels.
 *
 * The series itself persists under its stable `series_key` (#27), so what can go stale
 * is the *item*: an anchor goes `orphaned` when its quoted label no longer appears in
 * the latest snapshot. An anchor with no quote points at the series (or, with an `@n`
 * span, at a history point) rather than an item, so it stays fresh as long as the series
 * has any labels at all.
 *
 * @param anchor the recorded anchor fields
 * @param labels the series' current item labels, or `null` when the series is unknown
 *
 * @example
 *   resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', quote: 'migrate' },
 *                          ['migrate', 'render'])
 *   // => { status: 'fresh' }
 *   resolveChecklistAnchor({ kind: 'checklist', target: 'atlas', quote: 'migrate' }, ['render'])
 *   // => { status: 'orphaned' }
 */
export function resolveChecklistAnchor(anchor: Anchor, labels: readonly string[] | null): AnchorResolution {

  if (labels === null) { return { status: 'orphaned' }; }

  if (anchor.quote === undefined) {
    return labels.length > 0 ? { status: 'fresh', span: anchor.span } : { status: 'orphaned' };
  }

  const wanted = normalizeQuote(anchor.quote);

  return labels.some(label => normalizeQuote(label) === wanted)
    ? { status: 'fresh', span: anchor.span }
    : { status: 'orphaned' };

}

/**
 * Resolve an `entry` anchor: always fresh.
 *
 * Rows are never deleted in this schema — retention prunes by age, and a correction is
 * a new row — so an entry id that resolved once resolves forever. Exists as a named
 * function anyway so {@link resolveAnchor} has no special case and the guarantee is
 * stated somewhere a reader can find it.
 *
 * @example
 *   resolveEntryAnchor()  // => { status: 'fresh' }
 */
export function resolveEntryAnchor(): AnchorResolution {
  return { status: 'fresh' };
}

/**
 * Everything the resolvers may need about the *present*, supplied by the caller so the
 * resolution itself stays pure. Every field is optional; an absent one is read as "the
 * target could not be looked at", which resolves conservatively.
 */
export interface AnchorContext {
  /** The anchored file's current lines, or `null` when it no longer exists. */
  readonly fileLines?       : readonly string[] | null | undefined;
  /** The `prompt_id`s currently in reach. */
  readonly knownTurns?      : readonly string[] | undefined;
  /** The anchored checklist series' current item labels, or `null` when unknown. */
  readonly checklistLabels? : readonly string[] | null | undefined;
}

/**
 * Resolve any anchor against whatever the caller could observe about its target.
 *
 * The one entry point a renderer or a report calls; it dispatches on kind and supplies
 * the conservative reading of a missing observation — an unread file is `orphaned`, an
 * unknown turn list is `distant`, an unread series is `orphaned` — so a caller that
 * could not look never gets a verdict implying that it did.
 *
 * @param anchor  the recorded anchor fields
 * @param context what is presently known about the target
 *
 * @example
 *   resolveAnchor({ kind: 'entry', target: '212' }, {})  // => { status: 'fresh' }
 *   resolveAnchor({ kind: 'file', target: 'gone.ts', span: 'L1', quote: 'x' },
 *                 { fileLines: null })
 *   // => { status: 'orphaned' }
 *
 * @throws {RangeError} If `anchor.kind` is not one of the known anchor kinds.
 *
 * @see resolveFileAnchor
 * @see resolveMessageAnchor
 * @see resolveChecklistAnchor
 */
export function resolveAnchor(anchor: Anchor, context: AnchorContext): AnchorResolution {

  if (!isMember(ANCHOR_KINDS, anchor.kind)) {
    throw new RangeError(
      `resolveAnchor: '${String(anchor.kind)}' is not an anchor kind; expected ${describeVocabulary(ANCHOR_KINDS)}`);
  }

  switch (anchor.kind) {
    case 'file'      : return resolveFileAnchor(anchor, context.fileLines ?? null);
    case 'prompt'    :
    case 'reply'     : return resolveMessageAnchor(anchor, context.knownTurns ?? []);
    case 'checklist' : return resolveChecklistAnchor(anchor, context.checklistLabels ?? null);
    case 'entry'     : return resolveEntryAnchor();
  }

}
