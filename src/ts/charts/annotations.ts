/**
 * The annotation renderers: an anchor segment for a single channel line, and the
 * grouped annotation block for a batch (issue #18).
 *
 * The medium is the constraint. No host in the tri-host set can draw *on* an earlier
 * message — the transcript is append-only everywhere — so the only universal primitive
 * is new text that **quotes and marks**. These renderers are that primitive, computed
 * rather than imitated, on exactly the argument that motivated the chart renderers:
 * a canonical rendering the model can paste beats a rendering it approximates by eye.
 *
 * What is deliberately *not* here: the diff marker (`!`, `-`, `+`, `#`) and the
 * self-state decoration glyph (`🤔`, `🧭`, …). Those are per-channel skill conventions,
 * derivable from the record and never stored, and duplicating that table here would
 * create a second place for it to drift. {@link renderAnchorSegment} produces exactly
 * the segment that splices between the keyword and the note, which is the piece
 * anchoring actually adds to a channel line.
 *
 * Pure: no I/O, no store access, no clock, no randomness. Resolution verdicts are
 * *passed in* — computed by `channels/anchors.ts` against the target's present state —
 * because a renderer that read the filesystem would stop being testable by exact string.
 *
 * @see ../channels/anchors.js
 * @see ../../superpowers/spec/2026-08-27-anchoring-design.md
 */

import { ANCHOR_KINDS, isMember, describeVocabulary } from '../channels/vocabulary.js';
import type { AnchorKind } from '../channels/vocabulary.js';
import type { AnchorResolution } from '../channels/anchors.js';

/** `⚓` — the anchor mark that opens every anchored segment and every group header. */
const ANCHOR_GLYPH = '\u{2693}';

/** `»` — the guillemet separating the anchor from the note, as on the signature line. */
const GUILLEMET = '\u{00BB}';

/**
 * How many characters of quote text a rendered line shows before truncating with `…`.
 *
 * Smaller than the stored {@link ANCHOR_QUOTE_MAX} on purpose: storage keeps enough to
 * *resolve* the anchor, while the block keeps enough to *recognize* it. A block whose
 * quote column ran to 120 characters would push every note off the right edge, which is
 * the floating-prose failure in a new costume.
 */
export const QUOTE_DISPLAY_CAP = 40;

/** The indent every note line in a group carries, under its `⚓` header. */
const NOTE_INDENT = '   ';

/** One note to render: the anchor, the words, and — for the block — how it resolves now. */
export interface AnnotationNote {
  /** The note itself; whatever the entry's `text` says. */
  readonly text          : string;
  /** The feeling face that ends every channel line. Omitted renders no face. */
  readonly face?         : string | undefined;
  readonly anchorKind    : AnchorKind;
  /** Repo-relative path, `prompt_id`, `series_key`, or entry id as text. */
  readonly anchorTarget  : string;
  readonly anchorSpan?   : string | undefined;
  readonly anchorQuote?  : string | undefined;
  /**
   * A friendlier name for the target than the target itself — a checklist series'
   * display title, say. Presentation only; the record still keys on `anchorTarget`.
   */
  readonly targetLabel?  : string | undefined;
  /**
   * How many turns back a `prompt`/`reply` target is, when that is known and not zero.
   * Renders as `your message (2 turns ago)`.
   */
  readonly turnsAgo?     : number | undefined;
  /** The verdict from `resolveAnchor`; absent reads as `fresh`. */
  readonly resolution?   : AnchorResolution | undefined;
}

/** Options both renderers accept. */
export interface AnnotationOptions {
  /**
   * Render a `file` target as a markdown link (`[path:141](path#L141)`), the one
   * progressive enhancement the VS Code surface offers. Off by default, because the
   * terminal is the floor and a raw link there is noise.
   */
  readonly markdown? : boolean | undefined;
}

/** The note's effective status; an absent resolution means nothing was checked, so: fresh. */
function statusOf(note: AnnotationNote): AnchorResolution['status'] {
  return note.resolution?.status ?? 'fresh';
}

/** The span to display: where the content is *now* when that is known, else as recorded. */
function displaySpan(note: AnnotationNote): string | undefined {
  return note.resolution?.span ?? note.anchorSpan;
}

/** The 1-based first line of a file span, for ordering; 0 when there is none to read. */
function positionOf(note: AnnotationNote): number {
  const matched = /(\d+)/.exec(displaySpan(note) ?? '');
  return matched === null ? 0 : Number(matched[1]);
}

/**
 * Render one anchor's target the way its kind reads best.
 *
 * Per kind: a `file` renders `path:line` (or the whole path when it has no span, or a
 * markdown link under `markdown`), a `prompt` renders as the words `your message`, a
 * `reply` as `my reply`, a `checklist` as its series title, and an `entry` as `#id`.
 * A `prompt`/`reply` note carrying `turnsAgo` says how far back it is; an orphaned
 * target is marked `(gone)`, because an orphaned annotation loses its address, never
 * its content.
 *
 * @param note    the note whose target to render
 * @param options `markdown` to emit the clickable file-link form
 *
 * @example
 *   renderAnchorTarget({ text: 'x', anchorKind: 'file',
 *                        anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141' })
 *   // => 'src/ts/channels/store.ts:141'
 *
 * @example
 *   renderAnchorTarget({ text: 'x', anchorKind: 'prompt', anchorTarget: 'p-7',
 *                        anchorQuote: 'ship it', turnsAgo: 2 })
 *   // => 'your message (2 turns ago)'
 *
 * @throws {RangeError} If `anchorKind` is not one of the known anchor kinds.
 */
export function renderAnchorTarget(note: AnnotationNote, options?: AnnotationOptions): string {

  if (!isMember(ANCHOR_KINDS, note.anchorKind)) {
    throw new RangeError(
      `renderAnchorTarget: '${String(note.anchorKind)}' is not an anchor kind; ` +
      `expected ${describeVocabulary(ANCHOR_KINDS)}`);
  }

  const gone = statusOf(note) === 'orphaned' ? ' (gone)' : '',
        back = note.turnsAgo === undefined || note.turnsAgo <= 0
          ? ''
          : ` (${String(note.turnsAgo)} turn${note.turnsAgo === 1 ? '' : 's'} ago)`;

  switch (note.anchorKind) {

    case 'file': {
      const span = displaySpan(note),
            line = span === undefined ? null : /(\d+)/.exec(span)?.[1] ?? null,
            plain = line === null ? note.anchorTarget : `${note.anchorTarget}:${line}`;
      if (options?.markdown !== true || line === null) { return `${plain}${gone}`; }
      return `[${plain}](${note.anchorTarget}#L${line})${gone}`;
    }

    case 'prompt'    : return `your message${back}${gone}`;
    case 'reply'     : return `my reply${back}${gone}`;
    case 'checklist' : return `${note.targetLabel ?? note.anchorTarget}${gone}`;
    case 'entry'     : return `#${note.anchorTarget}${gone}`;

  }

}

/** The quote, capped for display and backticked; empty string when there is no quote. */
function renderQuote(note: AnnotationNote): string {
  if (note.anchorQuote === undefined) { return ''; }
  const quote = note.anchorQuote.length > QUOTE_DISPLAY_CAP
    ? `${note.anchorQuote.slice(0, QUOTE_DISPLAY_CAP - 1)}\u{2026}`
    : note.anchorQuote;
  return `\`${quote}\``;
}

/** The trailing face, with its separating space, or nothing at all. */
function faceSuffix(note: AnnotationNote): string {
  return note.face === undefined || note.face === '' ? '' : ` ${note.face}`;
}

/** Reject the shapes neither renderer can render, naming the accepted domain. */
function checkNote(note: AnnotationNote, where: string, index: number): void {
  if (!isMember(ANCHOR_KINDS, note.anchorKind)) {
    throw new RangeError(
      `${where}: note ${String(index)} has anchorKind '${String(note.anchorKind)}'; ` +
      `expected ${describeVocabulary(ANCHOR_KINDS)}`);
  }
  if (note.anchorTarget.trim() === '') {
    throw new RangeError(`${where}: note ${String(index)} has a blank anchorTarget; every anchor names a target`);
  }
  if (note.text.trim() === '') {
    throw new RangeError(`${where}: note ${String(index)} has empty text; an annotation with no note is not an annotation`);
  }
}

/**
 * Render the anchor segment of one channel line: the `⚓`, the target, the quote, and
 * the guillemet, followed by the note and its feeling face.
 *
 * This is what splices between a channel's keyword and its note, so
 * `! 🤔 dissent: ` + this = the whole anchored line, with the marker and decoration
 * staying where they already live (the skill, derived from the record).
 *
 * A `moved` anchor renders its travel — `L141→L158 (moved)` — in place of a bare line
 * number, so a reader sees at a glance that the address changed under the note. An
 * `orphaned` one marks the target `(gone)` and lets the quote carry the whole anchor:
 * that is exactly what floating prose already gets right, so orphaning degrades *to*
 * today's behavior, never below it.
 *
 * @param note    the note to render
 * @param options `markdown` to emit the clickable file-link form
 *
 * @example
 *   renderAnchorSegment({ text: "null for unset and for empty; callers can't tell which",
 *                         face: '😕', anchorKind: 'file',
 *                         anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141',
 *                         anchorQuote: 'readConfig(store, key)' })
 *   // => '⚓ src/ts/channels/store.ts:141 `readConfig(store, key)` » null for unset and
 *   //     for empty; callers can't tell which 😕'   (one line)
 *
 * @example
 *   renderAnchorSegment({ text: 'that entry claimed the gate was exact; it wasn\'t',
 *                         face: '😬', anchorKind: 'entry', anchorTarget: '212' })
 *   // => '⚓ #212 » that entry claimed the gate was exact; it wasn\'t 😬'
 *
 * @throws {RangeError} If the note's `anchorKind` is unknown, its `anchorTarget` is
 *                      blank, or its `text` is empty.
 *
 * @see renderAnnotations
 */
export function renderAnchorSegment(note: AnnotationNote, options?: AnnotationOptions): string {

  checkNote(note, 'renderAnchorSegment', 0);

  const moved  = statusOf(note) === 'moved' && note.resolution?.from !== undefined
          ? ` ${note.resolution.from}\u{2192}${note.resolution.span ?? ''} (moved)`
          : '',
        quote  = renderQuote(note),
        target = renderAnchorTarget(note, options);

  return [
    `${ANCHOR_GLYPH} ${target}${moved}`,
    ...(quote === '' ? [] : [quote]),
    GUILLEMET,
    `${note.text}${faceSuffix(note)}`,
  ].join(' ');

}

/**
 * The position column's text for one note: its span, or a resolution mark.
 *
 * In `markdown` mode a `file` span becomes the clickable link, rather than the group
 * header — the line number is the thing a reader actually wants to click, and the
 * header already names the file once for the whole group.
 */
function positionText(note: AnnotationNote, options?: AnnotationOptions): string {

  const status = statusOf(note);

  if (status === 'orphaned') { return '(orphaned)'; }
  if (status === 'distant')  { return '(distant)'; }

  if (status === 'moved') {
    return `${note.resolution?.from ?? '?'}\u{2192}${note.resolution?.span ?? '?'} (moved)`;
  }

  const span = displaySpan(note);
  if (span === undefined) { return ''; }

  const line = note.anchorKind === 'file' && options?.markdown === true
    ? /(\d+)/.exec(span)?.[1] ?? null
    : null;

  return line === null ? span : `[${span}](${note.anchorTarget}#L${line})`;

}

/** Notes sharing one target, in the order they will render. */
interface Group {
  readonly header : string;
  readonly notes  : readonly AnnotationNote[];
}

/** Group by (kind, target), targets in first-appearance order, notes by position within. */
function groupNotes(notes: readonly AnnotationNote[], options?: AnnotationOptions): Group[] {

  const order : string[] = [],
        byKey = new Map<string, AnnotationNote[]>();

  for (const note of notes) {
    const key   = `${note.anchorKind}\u{0000}${note.anchorTarget}`,
          found = byKey.get(key);
    if (found === undefined) { order.push(key); byKey.set(key, [note]); }
    else                     { found.push(note); }
  }

  return order.map(key => {
    const members = byKey.get(key) ?? [],
          first   = members[0] as AnnotationNote,
          sorted  = members
            .map((note, index) => ({ note, index }))
            .sort((a, b) => positionOf(a.note) - positionOf(b.note) || a.index - b.index)
            .map(entry => entry.note);
    // The header names the *target*, never a position or a verdict: the position column
    // carries both, per note, and a group of ten notes has ten of each.
    const naked: AnnotationNote = { ...first, anchorSpan: undefined, resolution: undefined };
    return { header: `${ANCHOR_GLYPH} ${renderAnchorTarget(naked, options)}`, notes: sorted };
  });

}

/**
 * Render the canonical annotation block: notes grouped under one `⚓` header per target,
 * one aligned quote-and-note line each.
 *
 * This is the code-review shape the issue asks for — many short notes bound to many
 * locations, instead of prose that mentions locations. Within a group the position and
 * quote columns pad to the group's widest, so the notes line up and the block scans
 * vertically; groups are separated by a blank line and appear in the order their
 * targets were first named. Each line still records as its own row with its own
 * channel: **the block is presentation, the rows are the record.**
 *
 * The header names the target and nothing else — position and resolution belong to
 * individual notes, and a group of ten has ten of each. Under `markdown` it is
 * therefore the *position* column that becomes clickable, which is the half a reader
 * wants to click anyway.
 *
 * The channel is deliberately not drawn. A block that repeated `dissent:` down its
 * left edge would spend the alignment on the least surprising column — what the notes
 * share is that they are all commentary on one target, and what distinguishes them is
 * the words.
 *
 * @param notes   one or more notes; the group headers come from their targets
 * @param options `markdown` to render file targets as clickable links
 * @returns the block, with no trailing newline
 *
 * @example
 *   renderAnnotations([
 *     { anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L141',
 *       anchorQuote: 'readConfig(store, key)', text: 'null for unset and for empty', face: '😕' },
 *     { anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts', anchorSpan: 'L162',
 *       anchorQuote: 'writeConfig', text: 'local timestamp never updated', face: '🤨' },
 *   ])
 *   // => '⚓ src/ts/channels/store.ts\n' +
 *   //    '   L141  `readConfig(store, key)`  » null for unset and for empty 😕\n' +
 *   //    '   L162  `writeConfig`             » local timestamp never updated 🤨'
 *
 * @example
 *   renderAnnotations([
 *     { anchorKind: 'prompt', anchorTarget: 'p-7', anchorQuote: 'ship it when ready',
 *       text: '"ready" reads three ways; assuming tests-green', face: '🤔' },
 *   ])
 *   // => '⚓ your message\n' +
 *   //    '   `ship it when ready`  » "ready" reads three ways; assuming tests-green 🤔'
 *
 * @throws {RangeError} If `notes` is empty, or any note has an unknown `anchorKind`, a
 *                      blank `anchorTarget`, or empty `text`.
 *
 * @see renderAnchorSegment
 * @see ../channels/anchors.js resolveAnchor
 */
export function renderAnnotations(notes: readonly AnnotationNote[], options?: AnnotationOptions): string {

  if (notes.length === 0) {
    throw new RangeError('renderAnnotations: notes must be a non-empty array; got 0 notes');
  }

  for (const [index, note] of notes.entries()) { checkNote(note, 'renderAnnotations', index); }

  return groupNotes(notes, options).map(group => {

    const positions = group.notes.map(note => positionText(note, options)),
          quotes    = group.notes.map(renderQuote),
          posWidth  = Math.max(...positions.map(p => p.length)),
          quoteWidth = Math.max(...quotes.map(q => q.length));

    const lines = group.notes.map((note, index) => {
      const position = posWidth === 0 ? '' : `${(positions[index] ?? '').padEnd(posWidth)}  `,
            quote    = quoteWidth === 0 ? '' : `${(quotes[index] ?? '').padEnd(quoteWidth)}  `;
      return `${NOTE_INDENT}${position}${quote}${GUILLEMET} ${note.text}${faceSuffix(note)}`;
    });

    return [group.header, ...lines].join('\n');

  }).join('\n\n');

}
