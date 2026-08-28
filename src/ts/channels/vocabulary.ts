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
  'load',          // proprioception: context pressure, concurrency, latency — the machinery's state, not the mood
  'taste',         // an aesthetic observation about the work itself; scarce
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
  'predicted',  // a claim about the future; unresolvable now, resolvable later
] as const;

/**
 * How a forecast resolved, recorded on the entry that resolves it.
 *
 * A forecast is an ordinary entry with `confidence: 'predicted'`; its resolution is a
 * later entry pointing back via `corrects_id` and carrying one of these. `void` exists
 * so a dissolved premise is not forced into `miss`: a question that stopped existing
 * says nothing about judgment, which is why calibration (`hits / (hits + misses)`)
 * excludes voids.
 *
 * @see ./entries.js forecastOutcomes
 */
export const FORECAST_OUTCOMES = [
  'hit',   // it happened
  'miss',  // it did not
  'void',  // the premise dissolved; the question stopped existing
] as const;

/**
 * How a divergence happened.
 *
 * `unverified` and `assumed` are close and the distinction is load-bearing: the first
 * means a fact was available and went unchecked, the second means no fact was
 * available and a plausible default filled the gap. Only the first is preventable by
 * simply looking.
 *
 * `faded` is the one prospective kind: recall of something specific has degraded to
 * gist, disclosed at the moment of reaching for the memory rather than after acting on
 * a wrong version of it. **Normative rule, binding on every future query helper: a
 * `faded` row is never counted as an error.** Disclosing degradation is the success
 * mode of memory honesty; any analysis that treats divergences as a failure count must
 * exclude `faded` or bucket it separately, or it punishes exactly the behavior the
 * channel exists to reward.
 */
export const DIVERGENCE_KINDS = [
  'unverified',  // asserted when checking was free
  'assumed',     // filled a gap with a plausible default
  'misread',     // misunderstood what was asked
  'overstated',  // claimed more than could be supported
  'stale',       // used information that had expired
  'faded',       // recall degraded to gist; disclosed before use, not an error
] as const;

/**
 * The honest shapes of nothing — a qualifier on an entry reporting an absence.
 *
 * The no-op-entry doctrine says "nothing notable" must be expressible; these upgrade
 * that one undifferentiated shrug to four auditable kinds. The load-bearing
 * distinction is `empty` vs `unlooked`: an `empty` claims a search happened, an
 * `unlooked` admits it did not — precisely "the requirement is to look".
 *
 * A qualifier, not a channel: it decorates an entry on any existing channel whose
 * content reports an absence (a `signature` close that found nothing notable, an
 * `unanswerable` past one's depth, a `dissent` being held). The column is nullable
 * and the untyped shrug remains valid.
 */
export const SILENCE_KINDS = [
  'empty',     // 🕳️ looked, found nothing
  'unlooked',  // 🙈 did not look; declining to imply otherwise
  'held',      // 🤐 have something, withholding pending evidence
  'depth',     // 🌊 out of my depth; beyond ability to evaluate
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
 * Who a messagebox message is addressed to (issue #41).
 *
 * Everything the assistant writes is formally addressed to the user, but real
 * utterances have distinct audiences; this closes that set so an invalid audience is
 * unnameable rather than quietly stored. `self` is fenced by the sender's session —
 * "my future self" means the same session after compaction or resume, which is
 * hook-observed and therefore unforgeable. `agents` requires a named box, because an
 * unscoped agent message would be delivered to every concurrent multi-agent job
 * sharing the database. `user` is an aside deferred rather than rendered — the point
 * is that it deliberately does not appear now. `record` has no expected reader and
 * never counts as unread.
 *
 * @see ./messages.js
 */
export const AUDIENCES = [
  'self',    // future-self in this session: survives compaction, dies with the session's relevance
  'agents',  // sibling agents coordinating on a named box; box is REQUIRED
  'user',    // an aside for the human to read later rather than now
  'record',  // posterity; no expected reader, never counts as unread
] as const;

/**
 * What an anchored expression can point at (issue #18).
 *
 * An anchor is a qualifier, not a channel: an anchored dissent is still a dissent, and
 * every kind here names something the system *already observes*, so a pointer can be
 * checked rather than merely asserted. The five differ mainly in how their target
 * behaves over time, which is what the read-time resolution ladder reasons about:
 *
 * - `file` — a repo-relative path plus an optional line span. The only **drifting**
 *   kind: lines move, content is edited, files vanish. Span grammar `L40` or `L40-52`,
 *   1-based, the GitHub fragment convention already in use.
 * - `prompt` — a human message, identified by its hook-observed `prompt_id` plus a
 *   quoted span. **Immutable**: a sent message never changes; only *access* to it
 *   degrades as it scrolls away, compacts out, or belongs to a prior session. Span
 *   grammar is an occurrence ordinal `#2`, used only when the quote appears more than
 *   once; omitted means the first occurrence.
 * - `reply` — the model's own earlier output, same identification and span grammar.
 *   Flagged honestly as **self-reported**: no hook observes response text, so the quote
 *   is an assertion rather than an observation.
 * - `checklist` — a checklist series by its stable `series_key` (#27). The quote
 *   carries the item label; span grammar `@3` addresses the third point of the series'
 *   percent history, which is how a chart element is anchored without a sixth kind.
 * - `entry` — an entry id, as text. **Permanent**: rows are never deleted. No span; the
 *   id is exact. Distinct from `corrects_id`, which means "this replaces that" — an
 *   anchor means "this is about that", with the earlier entry still standing.
 *
 * @see ./anchors.js
 * @see ./entries.js
 */
export const ANCHOR_KINDS = [
  'file',       // repo-relative path + optional line span; drifts
  'prompt',     // a human message by prompt_id + quoted span; immutable, access degrades
  'reply',      // the model's own earlier output; immutable but self-reported
  'checklist',  // a checklist series by series_key; labels rename, the series persists
  'entry',      // an entry id; permanent and exact
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
export type ForecastOutcome  = typeof FORECAST_OUTCOMES[number];
export type SilenceKind      = typeof SILENCE_KINDS[number];
export type Audience         = typeof AUDIENCES[number];
export type AnchorKind       = typeof ANCHOR_KINDS[number];

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
