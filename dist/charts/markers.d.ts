/**
 * The checklist marker vocabulary, promoted from prose to code.
 *
 * `markers.md` (the complete emoji vocabulary and its canonical order) and the
 * "Bucket membership" list in `status-checklists-skill.md` § The summary line
 * exist today only as prose a person has to re-read correctly every time a
 * checklist gets summarized. That is exactly the failure mode
 * `channels/vocabulary.ts` already solved for the affect-signature
 * vocabularies: promote the list to a runtime array once, and every caller —
 * validation, sorting, bucket classification — reads the same array instead
 * of re-deriving the rule from memory.
 *
 * A note on the strings themselves: several markers are multi-code-point —
 * a base emoji followed by U+FE0F (VARIATION SELECTOR-16), which forces the
 * emoji presentation of an otherwise text-default glyph (`🛠️`, `🛳️`, `🎙️`,
 * `🕵️`, and others below). These arrays store each marker exactly as it
 * appears in `markers.md`, and every comparison in this module is plain
 * string equality — no normalization, no stripping of variation selectors.
 * Callers (including test authors) must pass the marker string exactly as
 * rendered; a visually identical but code-point-different string will not
 * match.
 *
 * @see ../../doc_md/reference/markers.md
 * @see ../../doc_md/reference/status-checklists-skill.md
 * @see ../channels/vocabulary.ts
 */
/**
 * Which section of a checklist summary's count line a marker's item counts
 * toward.
 *
 * Not a strength or a status in itself — it is the coarse three-way split
 * the summary line's count section reports (`success / activePending /
 * failure`), independent of a marker's finer status/topic meaning.
 */
export type Bucket = 'success' | 'active' | 'failure';
/**
 * Markers that count toward the summary line's `success` bucket.
 *
 * Per `status-checklists-skill.md` § The summary line, "Bucket membership":
 * done, a perfect pass, finishing a major goal, agreement, something
 * genuinely cool, and caution/worked-with-a-caveat (the caveat stays visible
 * in the icon list, but the work still landed).
 *
 * `🛳️` (deploying something) is deliberately **not** in this array — a
 * deploy's bucket depends on whether it completed, a fact the glyph alone
 * cannot carry. Classify it via {@link classifyMarker}'s `override`
 * parameter instead.
 *
 * @example
 *   SUCCESS_MARKERS.includes('✅')  // => true
 *   SUCCESS_MARKERS.includes('🛳️')  // => false — pass an override instead
 */
export declare const SUCCESS_MARKERS: readonly ["✅", "💯", "🏁", "👍", "😎", "⚠️"];
/**
 * Markers that count toward the summary line's `failure` bucket.
 *
 * Per `status-checklists-skill.md` § The summary line, "Bucket membership":
 * failed, blocked, gone silent, dead/hung/degraded processes, a discovered
 * security problem, a serious problem or threat, active attack, and the
 * "something is wrong" family (stupid/frustrating, unknown cause, rejected
 * with no reason, suspect, overloaded, dormant, flaky, partial/degraded).
 *
 * @example
 *   FAILURE_MARKERS.includes('❌')  // => true
 *   FAILURE_MARKERS.includes('✅')  // => false
 */
export declare const FAILURE_MARKERS: readonly ["❌", "🚫", "🦗", "💀", "🧟", "🦹", "🌋", "🤬", "🤡", "😕", "🤌", "🤥", "🥵", "😴", "🫨", "🌗"];
/**
 * Every marker from `markers.md`, in its canonical order: the status
 * markers in their listed order (with `💯`, the perfect-pass variant of
 * `✅`, spliced in immediately after `✅` even though it has no bullet of
 * its own in the source — the file states the rule in prose rather than a
 * list entry), followed by the topic/action markers group by group, top to
 * bottom, in each group's left-to-right listed order.
 *
 * `markers.md`'s "Status markers" heading says "(22, canonical order)", but
 * the bulleted list beneath it has 23 entries — a stale
 * count in the source doc. This array transcribes the actual list, per the
 * rule "every marker... in its listed order".
 *
 * This is the tiebreaker `status-checklists-skill.md` specifies for sorting
 * a summary line's per-marker icon list: equal-count markers sort by first
 * appearance here.
 *
 * @see canonicalRank
 * @example
 *   CANONICAL_ORDER.indexOf('✅')  // => 0
 *   CANONICAL_ORDER.indexOf('💯')  // => 1 — immediately after ✅
 */
export declare const CANONICAL_ORDER: readonly ["✅", "💯", "🤖", "⏳", "🌐", "🛠️", "🛰️", "🔜", "🦥", "🌗", "🫨", "🦡", "❌", "🚫", "🦗", "⏭️", "⏸️", "❗", "⚠️", "⏰", "😴", "🧠", "❓", "🤔", "📋", "🐙", "📅", "📩", "👔", "📝", "📖", "📎", "📺", "🎙️", "🖨️", "🧪", "🦆", "🔍", "🔗", "🎫", "🏁", "🪚", "🐀", "⚡", "🐛", "🧹", "🗑️", "🦤", "🧐", "⚖️", "👑", "👍", "👎", "✋", "🛳️", "♾️", "↩️", "🏗️", "📦", "⚙️", "🔑", "🩹", "🩺", "☸️", "⬆️", "⬇️", "⏫", "⏬", "🔌", "💽", "🧬", "🌱", "💾", "🪵", "🧮", "📊", "🔮", "🔥", "🚨", "🧯", "🤕", "🗿", "🪦", "🕵️", "🦓", "🏷️", "🔀", "🚀", "🔨", "🆙", "🤮", "🎨", "♿", "📐", "🗺️", "🎣", "🪓", "🦹", "🪪", "🩻", "🔒", "🕳️", "🐒", "🧌", "🤬", "🛡️", "👁️", "💰", "🌪️", "🧊", "👻", "💀", "🧟", "🌋", "🤡", "😕", "🤌", "🤥", "🥵", "😎", "🦙", "💅", "🤓"];
/**
 * The bucket a marker's item counts toward in a checklist summary line.
 *
 * `override` exists for markers whose bucket cannot be read off the glyph
 * alone — chiefly `🛳️` (deploying something), whose bucket depends on
 * whether the deploy completed, failed, or is still underway. When supplied,
 * `override` wins outright rather than being blended with the marker's own
 * classification.
 *
 * Markers in neither {@link SUCCESS_MARKERS} nor {@link FAILURE_MARKERS} —
 * including every running/queued/topic marker and any marker this module
 * does not recognize — classify as `'active'`, matching the skill's
 * "active+pending: every other marker" rule.
 *
 * @param marker the marker string, exactly as it would be rendered in the
 *   checklist item (see the module note on variation selectors)
 * @param override the bucket to report unconditionally, when the caller
 *   already knows something the glyph can't express
 * @returns which bucket the marker's item counts toward
 * @example
 *   classifyMarker('✅')             // => 'success'
 *   classifyMarker('❌')             // => 'failure'
 *   classifyMarker('🔜')             // => 'active'
 *   classifyMarker('🛳️', 'success')  // => 'success' — deploy completed
 */
export declare function classifyMarker(marker: string, override?: Bucket): Bucket;
/**
 * A marker's position in {@link CANONICAL_ORDER}, for sorting a summary
 * line's per-marker icon list (equal-count markers sort by this rank).
 *
 * An unrecognized marker ranks after every known marker rather than
 * throwing, so an icon list containing a marker this module doesn't (yet)
 * know about still sorts — last, deterministically — instead of crashing
 * the renderer.
 *
 * @param marker the marker string, exactly as it would be rendered
 * @returns the marker's zero-based index in `CANONICAL_ORDER`, or
 *   `CANONICAL_ORDER.length` when the marker is not recognized
 * @example
 *   canonicalRank('✅')   // => 0
 *   canonicalRank('💯')   // => 1 — immediately after ✅
 *   canonicalRank('🤷')   // => CANONICAL_ORDER.length — not in markers.md
 */
export declare function canonicalRank(marker: string): number;
//# sourceMappingURL=markers.d.ts.map