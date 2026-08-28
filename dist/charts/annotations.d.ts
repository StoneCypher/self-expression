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
/**
 * The five addressable kinds, restated here as a literal union rather than imported
 * from `channels/vocabulary.ts`.
 *
 * The reason is what ships: `dist/charts/*.d.ts` are published, `dist/channels/` are
 * not, so a chart declaration file naming a channels type would dangle for every
 * consumer resolving the package's types. Every other renderer's declarations already
 * stand alone; this keeps that true — a pure presentation module describing its own
 * inputs, which is the honest shape for it anyway.
 *
 * The restatement is the same two-layer arrangement the schema's `CHECK`s and
 * `entries.validate` already use, and it is guarded the same way: `annotations.spec.ts`
 * asserts this union and `ANCHOR_KINDS` accept exactly the same set, so they cannot
 * drift apart silently.
 *
 * @see ../channels/vocabulary.js ANCHOR_KINDS
 */
export type AnnotationKind = 'file' | 'prompt' | 'reply' | 'checklist' | 'entry';
/**
 * How an anchor stands against its target's current state, as the renderer receives it.
 *
 * Structurally identical to `AnchorResolution` in `channels/anchors.ts`, and restated
 * for the same shipping reason as {@link AnnotationKind}: a verdict from `resolveAnchor`
 * is assignable here directly, so a caller passes one straight through.
 *
 * @see ../channels/anchors.js resolveAnchor
 */
export type AnnotationStatus = 'fresh' | 'moved' | 'orphaned' | 'distant';
/** One resolution verdict, plus where the content is now when that differs. */
export interface AnnotationResolution {
    readonly status: AnnotationStatus;
    /** The span the content occupies *now*, in the kind's own grammar, when known. */
    readonly span?: string | undefined;
    /** The span originally recorded, present only on a `moved` verdict. */
    readonly from?: string | undefined;
}
/**
 * How many characters of quote text a rendered line shows before truncating with `…`.
 *
 * Smaller than the stored cap (`ANCHOR_QUOTE_MAX`, 120) on purpose: storage keeps
 * enough to *resolve* the anchor, while the block keeps enough to *recognize* it. A
 * quote column running to 120 characters would push every note off the right edge,
 * which is the floating-prose failure in a new costume.
 *
 * @see ../channels/anchors.js
 */
export declare const QUOTE_DISPLAY_CAP = 40;
/** One note to render: the anchor, the words, and — for the block — how it resolves now. */
export interface AnnotationNote {
    /** The note itself; whatever the entry's `text` says. */
    readonly text: string;
    /** The feeling face that ends every channel line. Omitted renders no face. */
    readonly face?: string | undefined;
    readonly anchorKind: AnnotationKind;
    /** Repo-relative path, `prompt_id`, `series_key`, or entry id as text. */
    readonly anchorTarget: string;
    readonly anchorSpan?: string | undefined;
    readonly anchorQuote?: string | undefined;
    /**
     * A friendlier name for the target than the target itself — a checklist series'
     * display title, say. Presentation only; the record still keys on `anchorTarget`.
     */
    readonly targetLabel?: string | undefined;
    /**
     * How many turns back a `prompt`/`reply` target is, when that is known and not zero.
     * Renders as `your message (2 turns ago)`.
     */
    readonly turnsAgo?: number | undefined;
    /** The verdict from `resolveAnchor`; absent reads as `fresh`. */
    readonly resolution?: AnnotationResolution | undefined;
}
/** Options both renderers accept. */
export interface AnnotationOptions {
    /**
     * Render a `file` target as a markdown link (`[path:141](path#L141)`), the one
     * progressive enhancement the VS Code surface offers. Off by default, because the
     * terminal is the floor and a raw link there is noise.
     */
    readonly markdown?: boolean | undefined;
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
export declare function renderAnchorTarget(note: AnnotationNote, options?: AnnotationOptions): string;
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
export declare function renderAnchorSegment(note: AnnotationNote, options?: AnnotationOptions): string;
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
export declare function renderAnnotations(notes: readonly AnnotationNote[], options?: AnnotationOptions): string;
//# sourceMappingURL=annotations.d.ts.map