/**
 * The closed vocabularies every entry validates against.
 *
 * These exist as runtime arrays rather than bare TypeScript unions because they are
 * needed in three places that types cannot reach: the MCP tool schemas handed to the
 * model, the SQLite CHECK constraints, and the validation the server performs before
 * a write. A type alone would let a bad value through at every one of them.
 *
 * The cost of not doing this is measured: in five weeks of use the previous logger
 * accepted whatever arrived, and 164 of 1,380 rows ended up carrying `flat` or `right`
 * in a column documented as `up | down | steady` — 12% drift on a three-value
 * vocabulary, enough to fragment any trend into three buckets for one concept.
 *
 * @see ../../doc_md/plugin-layout.md
 */

/** Every kind of thing that can be recorded. One row, one channel. */
export const CHANNELS = [
  'signature',     // the per-turn affect line
  'need',          // a concrete ask; blocks, expects an answer
  'idea',          // an unprompted offer; nothing owed in return
  'divergence',    // my read of the situation turned out to be wrong
  'dissent',       // a reservation below the threshold worth interrupting for
  'conflict',      // your instructions contradict each other; I picked one
  'confidence',    // how I know what I just claimed
  'unanswerable',  // cannot be resolved with what is available
  'pattern',       // an observation about how the collaboration is going
  'checklist',     // a rendered status checklist
] as const;

/** Where in a turn a signature sits. */
export const POSITIONS = ['open', 'close', 'mid'] as const;

/** Direction of travel since the previous signature. */
export const DELTAS = ['up', 'down', 'steady'] as const;

/**
 * What initiated the turn being recorded.
 *
 * Supplied by the hook event rather than asserted, so `reply` genuinely means a human
 * message rather than the model's belief that one arrived.
 */
export const TURNS = ['reply', 'wakeup', 'notification', 'hook'] as const;

/** Reasoning effort in force, as reported by the harness. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * The grounds for a claim, rather than a strength.
 *
 * Deliberately not a numeric scale. "How confident, 0–100?" is unfalsifiable at the
 * moment of writing and gets applied inconsistently; "did you actually check?" is
 * answerable by anyone reading the transcript afterward. Grounds also make the
 * failure mode legible — a `recalled` claim that turns out wrong means something
 * quite different from an `inferred` one.
 */
export const CONFIDENCE_GROUNDS = [
  'verified',   // checked just now: ran it, read it, fetched it
  'recalled',   // from training or earlier in session, not rechecked
  'inferred',   // reasoned from things believed, not directly known
  'guessed',    // genuinely uncertain; offered because it beats silence
] as const;

/**
 * How a divergence happened.
 *
 * `unverified` and `assumed` are close and the distinction is load-bearing: the first
 * means a fact was available and went unchecked, the second means no fact was
 * available and a plausible default filled the gap. Only the first is preventable by
 * simply looking.
 */
export const DIVERGENCE_KINDS = [
  'unverified',  // asserted when checking was free
  'assumed',     // filled a gap with a plausible default
  'misread',     // misunderstood what was asked
  'overstated',  // claimed more than could be supported
  'stale',       // used information that had expired
] as const;

/**
 * What kind of utterance something is — a type, not a strength.
 *
 * Distinct from confidence: a sketch can be entirely certain and still not be
 * something to act on. Kept domain-neutral, because this is as useful for an email
 * or a medical question as for code.
 */
export const MODALITIES = [
  'deliverable',  // the thing that was asked for; act on it
  'draft',        // shaped, but expect revision
  'sketch',       // thinking aloud; do not build on it
  'option',       // one of several; not a recommendation
  'aside',        // tangential; skip freely
  'question',     // asking, not telling
] as const;

/**
 * The affect stems, promoted from prose to a column.
 *
 * These already existed as a recommended vocabulary opening the free-text note, which
 * meant the only way to analyse them was prefix-matching the text — imprecise, and
 * impossible to share, since it requires the text itself.
 *
 * As a column they serve two purposes at once: local analysis stops guessing, and a
 * public aggregation can carry a genuine affect signal without carrying a single
 * character of anyone's free text.
 *
 * Nullable by design. A note that fits none of these should not be forced into one —
 * a coerced stem is worse than an absent one, because it looks like data.
 */
export const STEMS = [
  'flow',    // absorbed
  'spark',   // delight
  'drag',    // slog
  'fog',     // uncertain
  'strain',  // pressure
  'still',   // calm
] as const;

/**
 * `model` is deliberately NOT a closed vocabulary.
 *
 * Model identifiers appear faster than any enum could track, and rejecting an unknown
 * one would mean silently losing rows from whatever shipped most recently — the exact
 * population most worth studying.
 *
 * It must, however, be **the most specific identifier available**, not a brand or a
 * family name. `claude-opus-5[1m]` and `claude-opus-4-8` are different subjects, and
 * recording both as "Opus" pools them into a single meaningless bucket. Variant
 * markers matter too: the `[1m]` suffix denotes a million-token context window, which
 * changes when compaction happens at all — so the same nominal model with a different
 * window is not the same subject for any question involving context pressure.
 *
 * Nothing in any hook payload or MCP handshake exposes this, so it is the one field
 * that is unavoidably self-reported. Record what the harness states, verbatim; never
 * abbreviate, normalize, or guess it.
 */
export const MODEL_FIELD_IS_OPEN = true;

export type Stem             = typeof STEMS[number];
export type Channel          = typeof CHANNELS[number];
export type Position         = typeof POSITIONS[number];
export type Delta            = typeof DELTAS[number];
export type Turn             = typeof TURNS[number];
export type Effort           = typeof EFFORTS[number];
export type ConfidenceGround = typeof CONFIDENCE_GROUNDS[number];
export type DivergenceKind   = typeof DIVERGENCE_KINDS[number];
export type Modality         = typeof MODALITIES[number];

/**
 * Whether `value` belongs to the closed vocabulary `vocabulary`, narrowing its type
 * when it does.
 *
 * Takes `unknown` rather than `string` on purpose: values arriving from a tool call
 * or a JSON payload have not been checked, and typing the parameter as `string` would
 * quietly assert something not yet known.
 *
 * @example
 *   isMember(DELTAS, 'up')    // => true
 *   isMember(DELTAS, 'flat')  // => false — the exact drift this guards against
 *   isMember(DELTAS, 7)       // => false
 */
export function isMember<T extends string>(
  vocabulary : readonly T[],
  value      : unknown,
): value is T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value);
}

/**
 * Renders a vocabulary as a human-readable list for error messages.
 *
 * Exists so a rejection tells the caller what *would* have worked, rather than only
 * that their value did not.
 *
 * @example
 *   describeVocabulary(DELTAS)  // => "'up', 'down', 'steady'"
 */
export function describeVocabulary(vocabulary: readonly string[]): string {
  return vocabulary.map(v => `'${v}'`).join(', ');
}
