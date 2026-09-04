/**
 * Writing and reading expression entries.
 *
 * Validation happens here rather than being left to the database, so a rejection can
 * say what would have worked instead of surfacing a bare constraint failure. The
 * `CHECK` clauses in the schema remain as a second line of defence: this module is the
 * only intended writer, but it should not be the only thing standing between a typo
 * and the record.
 *
 * **The only verb is INSERT.** No function here issues an `UPDATE` or a `DELETE` against
 * `entries`, and none ever should — the one standing exception in the whole system is
 * schema migration's table rebuild, which copies rows verbatim and is versioned and
 * logged. Retraction (#16) is built on that property rather than around it: "retracted"
 * is a **derived** standing, computed from the `corrects_id` chain at read time by
 * {@link standingOf}, so there is nothing on an original row to falsify, backdate, or
 * forget to set, and taking something back leaves *more* evidence rather than less.
 *
 * @see ./vocabulary.js
 * @see ./store.js
 * @see standingOf
 */

import { randomUUID } from 'node:crypto';
import {
  CHANNELS, POSITIONS, DELTAS, TURNS, EFFORTS, STEMS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES,
  FORECAST_OUTCOMES, SILENCE_KINDS, ANCHOR_KINDS, CORRECTION_KINDS,
  isMember, describeVocabulary,
} from './vocabulary.js';
import type {
  Channel, Position, Delta, Turn, Effort, Stem,
  ConfidenceGround, DivergenceKind, Modality,
  ForecastOutcome, SilenceKind, AnchorKind, CorrectionKind,
} from './vocabulary.js';
import { normalizeQuote, anchorHash, spanProblem, ANCHOR_QUOTE_MAX } from './anchors.js';
import { privacyFlags } from './privacy.js';
import { stamp } from './time.js';
import type { Store } from './store.js';
import type { ChecklistSeriesRow, NeedWeekRow, SignatureRow } from '../raster/panels.js';

/**
 * What a caller supplies when recording. Timestamps, uuid, and machine identity are
 * filled in here rather than accepted, so they cannot be spoofed or forgotten.
 */
export interface EntryInput {
  readonly channel          : Channel;
  readonly text             : string;
  readonly session          : string;

  readonly promptId?        : string | undefined;
  readonly turnIndex?       : number | undefined;
  readonly turn?            : Turn | undefined;
  readonly host?            : string | undefined;
  readonly hostVersion?     : string | undefined;
  readonly agentId?         : string | undefined;
  readonly agentType?       : string | undefined;
  readonly effort?          : Effort | undefined;
  readonly permissionMode?  : string | undefined;
  readonly cwd?             : string | undefined;
  readonly project?         : string | undefined;
  readonly gitBranch?       : string | undefined;
  readonly model?           : string | undefined;

  readonly modality?        : Modality | undefined;
  readonly visible?         : boolean | undefined;
  readonly nudged?          : boolean | undefined;
  readonly interrupted?     : boolean | undefined;
  readonly toolCalls?       : number | undefined;
  readonly errorCount?      : number | undefined;
  readonly compactions?     : number | undefined;
  readonly promptLen?       : number | undefined;
  readonly responseLen?     : number | undefined;
  readonly contextTokens?   : number | undefined;
  readonly outputTokens?    : number | undefined;
  readonly thinkingTokens?  : number | undefined;
  readonly correctsId?      : number | undefined;
  readonly elapsedMs?       : number | undefined;

  // Correction fields (#16). `correctsKind` says what the `correctsId` link *means* —
  // `retracts` (the target is wrong), `amends` (a detail is refined), or `resolves`
  // (#42's forecast resolution, which is never wrongness). It is required alongside
  // `correctsId` for new writes: a link whose meaning is unstated is exactly the
  // ambiguity the column exists to end. `verbatim` is the retracted or amended claim,
  // quoted exactly, so the retraction is greppable against a transcript this plugin
  // cannot mark — and so a prose-only claim, which was never a row for `correctsId` to
  // point at, can enter the register at all.
  readonly correctsKind?    : CorrectionKind | undefined;
  readonly verbatim?        : string | undefined;

  readonly position?        : Position | undefined;
  readonly delta?           : Delta | undefined;
  readonly uncertain?       : boolean | undefined;
  readonly face?            : string | undefined;
  readonly contextEmoji?    : string | undefined;
  readonly stem?            : Stem | undefined;
  readonly cctype?          : string | undefined;

  readonly confidence?      : ConfidenceGround | undefined;
  readonly divergenceKind?  : DivergenceKind | undefined;

  // Forecast fields (#42). `resolveBy` is an ISO-8601 local date (YYYY-MM-DD), a real
  // column rather than prose so a future ripening-check (#43) can query it; valid only
  // with `confidence: 'predicted'`. `outcome` rides the entry that RESOLVES a
  // forecast, pointing back at it via `correctsId` — a resolution genuinely is a
  // correction, of "unknown" to "known".
  readonly resolveBy?       : string | undefined;
  readonly outcome?         : ForecastOutcome | undefined;

  // Typed silence (#42): which honest shape of nothing this entry reports, on any
  // channel whose content is an absence. Nullable; the untyped shrug remains valid.
  readonly silence?         : SilenceKind | undefined;

  // Anchor fields (#18): where this commentary is attached, as a qualifier on any
  // channel — an anchored dissent is still a dissent. `anchorHash` is deliberately NOT
  // here: it is derived from the quote at write time by {@link recordEntry}, because a
  // supplied hash could disagree with its own quote and the whole point of the field is
  // that it is a function of the content.
  readonly anchorKind?      : AnchorKind | undefined;
  readonly anchorTarget?    : string | undefined;
  readonly anchorSpan?      : string | undefined;
  readonly anchorQuote?     : string | undefined;

  // Checklist only. `seriesKey` is the series' stable identity (#27): chosen once at
  // the checklist's first render and repeated verbatim on every re-render, so `title`
  // — display prose — may be reworded freely without silently forking the percent
  // history into two series.
  readonly seriesKey?       : string | undefined;
  readonly title?           : string | undefined;
  readonly succ?            : number | undefined;
  readonly active?          : number | undefined;
  readonly fail?            : number | undefined;
  readonly percent?         : number | undefined;

  readonly formatVersion?   : string | undefined;
}

/** Identity of a row that was written. */
export interface Written {
  readonly id   : number;
  readonly uuid : string;
}

/** Each closed field, paired with the vocabulary it must belong to. */
const CONSTRAINED: readonly [keyof EntryInput, readonly string[]][] = [
  ['channel',        CHANNELS],
  ['position',       POSITIONS],
  ['delta',          DELTAS],
  ['turn',           TURNS],
  ['effort',         EFFORTS],
  ['stem',           STEMS],
  ['confidence',     CONFIDENCE_GROUNDS],
  ['divergenceKind', DIVERGENCE_KINDS],
  ['modality',       MODALITIES],
  ['outcome',        FORECAST_OUTCOMES],
  ['silence',        SILENCE_KINDS],
  ['anchorKind',     ANCHOR_KINDS],
  ['correctsKind',   CORRECTION_KINDS],
];

/** The anchor fields that mean nothing without an `anchorKind` to interpret them. */
const ANCHOR_QUALIFIERS: readonly (keyof EntryInput)[] = ['anchorTarget', 'anchorSpan', 'anchorQuote'];

/** Anchor kinds whose quote *is* the anchor: without it there is nothing to resolve. */
const QUOTE_REQUIRED: readonly string[] = ['prompt', 'reply'];

/** The shape `resolveBy` must take: an ISO-8601 local date, so it stays queryable. */
const ISO_LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check every closed field against its vocabulary — and the checklist series fields
 * against their contract — returning the problems found.
 *
 * Returns all failures rather than throwing on the first, so a caller supplying two
 * bad values learns about both in one round trip instead of two.
 *
 * The checklist rules exist because the series-split failure they guard against is
 * invisible (#27): a percent snapshot recorded without a `seriesKey` can never be found
 * by {@link seriesPercents}, so it would silently vanish from the trend rather than
 * erroring — this makes that loud at write time instead.
 *
 * The forecast rules (#42) are cross-field: `resolveBy` only makes sense on a claim
 * that resolves later (`confidence: 'predicted'`), and an `outcome` with nothing to
 * point at (`correctsId`) resolves no forecast at all. Whether the pointed-at row
 * really is a forecast needs the store, so that half lives at the tool layer.
 *
 * The correction rules (#16) live in {@link correctionProblems}, joining the same
 * cross-field family: a link must state its kind, a kind must have a link, an outcome
 * rides a `resolves` link, and a verbatim quote belongs only where something is
 * actually being taken back.
 *
 * @example
 *   validate({ channel: 'signature', text: 'x', session: 's' })      // => []
 *   validate({ channel: 'vibes', text: 'x', session: 's' })
 *   // => ["'vibes' is not a valid channel; expected 'signature', 'need', ..."]
 *   validate({ channel: 'checklist', text: 'x', session: 's', percent: 80 })
 *   // => ['percent requires a seriesKey — a snapshot recorded without one can never join a trend series']
 *   validate({ channel: 'confidence', text: 'x', session: 's', resolveBy: '2026-08-30' })
 *   // => ["resolveBy is only valid with confidence 'predicted' — only a forecast resolves later"]
 */
export function validate(input: EntryInput): string[] {

  const problems: string[] = [];

  for (const [field, vocabulary] of CONSTRAINED) {
    const value = input[field];
    if (value !== undefined && !isMember(vocabulary, value)) {
      problems.push(
        `'${String(value)}' is not a valid ${field}; expected ${describeVocabulary(vocabulary)}`
      );
    }
  }

  if (input.text.trim() === '')    { problems.push('text must not be empty'); }
  if (input.session.trim() === '') { problems.push('session must not be empty'); }

  if (input.seriesKey?.trim() === '') {
    problems.push('seriesKey must not be blank');
  }

  if (input.percent !== undefined && input.seriesKey === undefined) {
    problems.push('percent requires a seriesKey — a snapshot recorded without one can never join a trend series');
  }

  if (input.percent !== undefined && (input.percent < 0 || input.percent > 100 || !Number.isInteger(input.percent))) {
    problems.push(`percent must be an integer from 0 to 100; received ${String(input.percent)}`);
  }

  if (input.resolveBy !== undefined && input.confidence !== 'predicted') {
    problems.push("resolveBy is only valid with confidence 'predicted' — only a forecast resolves later");
  }

  if (input.resolveBy !== undefined && !ISO_LOCAL_DATE.test(input.resolveBy)) {
    problems.push(
      `resolveBy must be an ISO-8601 local date (YYYY-MM-DD); received '${input.resolveBy}' — ` +
      'a ripening check has to be able to query it as a date, not grep prose');
  }

  if (input.outcome !== undefined && input.correctsId === undefined) {
    problems.push('outcome requires a correctsId naming the forecast it resolves');
  }

  problems.push(...correctionProblems(input));
  problems.push(...anchorProblems(input));

  return problems;

}

/**
 * The correction cross-field rules (#16), returned as problem sentences.
 *
 * Split out of {@link validate} for the same reason {@link anchorProblems} is: the rules
 * are a self-contained matrix — kind × link × outcome × verbatim × channel — and keeping
 * them together makes the matrix readable next to the tests that pin it. Every rule
 * exists to stop the register from lying:
 *
 * - a `correctsKind` with no `correctsId` describes a link that is not there;
 * - a `correctsId` with no `correctsKind` is **rejected for new writes** — a link whose
 *   meaning is unstated is exactly the ambiguity the column exists to end, and the moment
 *   #42's resolutions share the chain, silence is no longer readable as "retracts". Rows
 *   written before the column existed carry NULL and are read, never rewritten, by
 *   {@link effectiveCorrectionKind};
 * - an `outcome` rides a `resolves` link and nothing else, so a resolution can never be
 *   filed as a retraction (crying wolf) nor a retraction as a resolution (laundering
 *   wrongness into bookkeeping);
 * - `verbatim` belongs on a `retracts`/`amends` entry (quoting the target's claim) or on
 *   a `divergence` entry with no link at all (a **prose-only** retraction, where the
 *   claim was never a row and the quote is the only anchor). Anywhere else it would be a
 *   quote of nothing.
 *
 * Exactness of the quote cannot be machine-checked against a transcript the plugin
 * cannot read, so exactness stays normative (skill-level); what the schema holds is the
 * slot, so the quote is queryable instead of buried in `text` prose.
 *
 * @example
 *   correctionProblems({ channel: 'divergence', text: 'x', session: 's', correctsId: 3 })
 *   // => ["correctsId requires a correctsKind — 'retracts' (the target is wrong), …"]
 *   correctionProblems({ channel: 'divergence', text: 'x', session: 's',
 *                        correctsId: 3, correctsKind: 'retracts', verbatim: 'sorts by status first' })
 *   // => []
 *
 * @see validate
 * @see effectiveCorrectionKind
 */
export function correctionProblems(input: EntryInput): string[] {

  const problems: string[] = [];

  if (input.correctsKind !== undefined && input.correctsId === undefined) {
    problems.push(
      `correctsKind '${input.correctsKind}' requires a correctsId — a link kind ` +
      'with no link describes a relationship to nothing');
  }

  if (input.correctsId !== undefined && input.correctsKind === undefined) {
    problems.push(
      'correctsId requires a correctsKind — ' +
      `${describeVocabulary(CORRECTION_KINDS)}. A link whose meaning is unstated cannot be ` +
      'told apart from a forecast resolution, and a register that cannot tell them apart ' +
      'is a register nobody can trust');
  }

  if (input.outcome !== undefined && input.correctsKind !== undefined && input.correctsKind !== 'resolves') {
    problems.push(
      `outcome requires correctsKind 'resolves'; received '${input.correctsKind}' — ` +
      'a forecast closing is not a claim being taken back, and the two must stay legible');
  }

  if (input.verbatim !== undefined) {

    const quoting   = input.correctsKind === 'retracts' || input.correctsKind === 'amends',
          proseOnly = input.correctsId === undefined && input.channel === 'divergence';

    if (input.verbatim.trim() === '') {
      problems.push('verbatim must not be blank — an empty quote anchors nothing');
    }

    if (!quoting && !proseOnly) {
      problems.push(
        "verbatim is only valid with correctsKind 'retracts' or 'amends', or on a " +
        'divergence entry with no correctsId (a prose-only retraction, where the claim ' +
        'was never a row and the quote is the only anchor)');
    }

  }

  return problems;

}

/**
 * The anchor cross-field rules (#18), returned as problem sentences.
 *
 * Split out of {@link validate} because the anchor rules are a self-contained matrix —
 * kind × target × span-grammar × quote-requirement — and keeping them together makes
 * the matrix readable next to the tests that pin it. Every rule fails toward *not*
 * recording an unresolvable anchor:
 *
 * - a qualifier without a kind is a pointer with no way to read it;
 * - a kind without a target names no thing at all;
 * - `prompt` and `reply` demand a quote, because a message anchor with no quote is
 *   unresolvable by construction — a `file` can still be found by span, a message
 *   cannot;
 * - the span must parse in its kind's grammar;
 * - the quote must survive normalization non-empty and fit {@link ANCHOR_QUOTE_MAX}.
 *
 * The two checks that need the store — that an `entry` target exists, and that a
 * `checklist` series has rows — live at the tool layer, exactly as the forecast rules
 * split.
 *
 * @example
 *   anchorProblems({ channel: 'dissent', text: 'x', session: 's', anchorQuote: 'y' })
 *   // => ['anchorQuote requires an anchorKind — an anchor field with no kind …']
 *
 * @see validate
 * @see ./anchors.js spanProblem
 */
export function anchorProblems(input: EntryInput): string[] {

  const problems: string[] = [];

  if (input.anchorKind === undefined) {
    for (const field of ANCHOR_QUALIFIERS) {
      if (input[field] !== undefined) {
        problems.push(
          `${field} requires an anchorKind — an anchor field with no kind ` +
          'is a pointer with no way to read it');
      }
    }
    return problems;
  }

  if (!isMember(ANCHOR_KINDS, input.anchorKind)) { return problems; }

  if (input.anchorTarget === undefined || input.anchorTarget.trim() === '') {
    problems.push(
      `anchorKind '${input.anchorKind}' requires an anchorTarget — the path, prompt id, ` +
      'series key, or entry id the note is attached to');
  }

  if (QUOTE_REQUIRED.includes(input.anchorKind) && input.anchorQuote === undefined) {
    problems.push(
      `a ${input.anchorKind} anchor requires an anchorQuote — a message anchor with no ` +
      'quote is unresolvable by construction; a file may anchor by span alone, a message may not');
  }

  if (input.anchorSpan !== undefined) {
    const problem = spanProblem(input.anchorKind, input.anchorSpan);
    if (problem !== null) { problems.push(problem); }
  }

  if (input.anchorQuote !== undefined) {
    const normalized = normalizeQuote(input.anchorQuote);
    if (normalized === '') {
      problems.push('anchorQuote must not be blank once whitespace is collapsed');
    } else if (normalized.length > ANCHOR_QUOTE_MAX) {
      problems.push(
        `anchorQuote must be at most ${String(ANCHOR_QUOTE_MAX)} characters once whitespace is ` +
        `collapsed; received ${String(normalized.length)} — quote the shortest span that is unambiguous`);
    }
  }

  return problems;

}

/** SQLite has no boolean; store as 0/1, and leave undefined alone. */
function bit(value: boolean | undefined): number | null {
  return value === undefined ? null : (value ? 1 : 0);
}

/** What actually reaches the two quote columns, once privacy has had its say. */
interface StoredQuote {
  readonly quote : string | null;
  readonly hash  : string | null;
}

/**
 * Decide what the `anchor_quote` and `anchor_hash` columns receive: the normalized
 * quote and its fingerprint, with the quote dropped when it is the human's words and
 * `privacy.store_quotes` is off.
 *
 * The redaction is **write-time, never captured-then-hidden** — the suppressed text
 * does not reach the database at all — and the hash survives it, which is the whole
 * design: sixteen hex characters keep drift detection and same-target grouping working
 * while carrying no language. Only `prompt` anchors are gated, because only they quote
 * the human; a `file`, `reply`, `checklist`, or `entry` quote is the repo's or the
 * model's own text.
 *
 * The hash is always derived here rather than accepted, so it cannot disagree with the
 * quote it summarizes.
 *
 * @param kind        the anchor kind, or `undefined` on an unanchored entry
 * @param quote       the caller's excerpt, before normalization
 * @param storeQuotes the effective `privacy.store_quotes` flag
 *
 * @example
 *   storedQuote('prompt', 'ship it when ready', false)
 *   // => { quote: null, hash: anchorHash('ship it when ready') }
 *   //    the words are gone; the fingerprint is not
 *   storedQuote('file', 'readConfig(store, key)', false)
 *   // => { quote: 'readConfig(store, key)', hash: anchorHash('readConfig(store, key)') }
 *   //    the repo's own text, so the flag does not touch it
 *
 * @see ./privacy.js
 */
export function storedQuote(
  kind        : AnchorKind | undefined,
  quote       : string | undefined,
  storeQuotes : boolean,
): StoredQuote {

  if (quote === undefined) { return { quote: null, hash: null }; }

  const normalized = normalizeQuote(quote),
        suppressed = kind === 'prompt' && !storeQuotes;

  return { quote: suppressed ? null : normalized, hash: anchorHash(normalized) };

}

/**
 * Record one entry, returning its identity.
 *
 * Generates the uuid, all three timestamps, and the machine identity rather than
 * accepting them. `when` is injectable so tests can pin the clock.
 *
 * `anchor_hash` is likewise derived here rather than accepted, and the `prompt`-anchor
 * quote redaction of `privacy.store_quotes` is applied here rather than at each call
 * site — one place, so the invariant "the hash records even when the words do not"
 * cannot be got wrong by a second writer (see {@link storedQuote}).
 *
 * @example
 *   recordEntry(store, { channel: 'need', text: 'merge #21?', session: 's1' })
 *   // => { id: 1, uuid: '…' }
 *
 * @example
 *   recordEntry(store, { channel: 'dissent', text: '"ready" reads three ways', session: 's1',
 *                        anchorKind: 'prompt', anchorTarget: 'p-7',
 *                        anchorQuote: 'ship it when ready' })
 *   // => { id: 2, uuid: '…' }
 *
 * @throws {Error} If validation fails — a closed field outside its vocabulary, a
 *                 checklist series violation, or an anchor cross-field violation (see
 *                 {@link validate}) — naming every problem and the values that would
 *                 have been accepted.
 */
export function recordEntry(
  store         : Store,
  input         : EntryInput,
  pluginVersion : string,
  when          : Date = new Date(),
): Written {

  const problems = validate(input);
  if (problems.length > 0) {
    throw new Error(`cannot record entry:\n  - ${problems.join('\n  - ')}`);
  }

  const at     = stamp(when),
        uuid   = randomUUID(),
        quoted = storedQuote(input.anchorKind, input.anchorQuote, privacyFlags(store).storeQuotes);

  store.db.prepare(`
    INSERT INTO entries (
      uuid, ts_utc, ts_local, tz, elapsed_ms,
      session, prompt_id, turn_index, turn, host, host_version,
      agent_id, agent_type, effort, permission_mode, cwd, project, git_branch,
      machine_id, platform, model,
      channel, text, modality, visible, nudged, interrupted,
      tool_calls, error_count, compactions, prompt_len, response_len,
      context_tokens, output_tokens, thinking_tokens, corrects_id, corrects_kind, verbatim,
      position, delta, uncertain, face, context_emoji, stem, cctype,
      confidence, divergence_kind, resolve_by, outcome, silence,
      anchor_kind, anchor_target, anchor_span, anchor_quote, anchor_hash,
      series_key, title, succ, active, fail, percent,
      plugin_version, format_version
    ) VALUES (
      ?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?,?,?,?,?,?,
      ?,(SELECT value FROM meta WHERE key='platform'),?,
      ?,?,?,COALESCE(?,1),COALESCE(?,0),COALESCE(?,0),
      ?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?,COALESCE(?,0),?,?,?,?,
      ?,?,?,?,?,
      ?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?
    )`).run(
    uuid, at.utc, at.local, at.tz, input.elapsedMs ?? null,
    input.session, input.promptId ?? null, input.turnIndex ?? null, input.turn ?? null,
    input.host ?? null, input.hostVersion ?? null,
    input.agentId ?? null, input.agentType ?? null, input.effort ?? null,
    input.permissionMode ?? null, input.cwd ?? null, input.project ?? null, input.gitBranch ?? null,
    store.machineId, input.model ?? null,
    input.channel, input.text, input.modality ?? null,
    bit(input.visible), bit(input.nudged), bit(input.interrupted),
    input.toolCalls ?? null, input.errorCount ?? null, input.compactions ?? null,
    input.promptLen ?? null, input.responseLen ?? null,
    input.contextTokens ?? null, input.outputTokens ?? null, input.thinkingTokens ?? null,
    input.correctsId ?? null, input.correctsKind ?? null, input.verbatim ?? null,
    input.position ?? null, input.delta ?? null, bit(input.uncertain),
    input.face ?? null, input.contextEmoji ?? null, input.stem ?? null, input.cctype ?? null,
    input.confidence ?? null, input.divergenceKind ?? null,
    input.resolveBy ?? null, input.outcome ?? null, input.silence ?? null,
    input.anchorKind ?? null, input.anchorTarget ?? null, input.anchorSpan ?? null,
    quoted.quote, quoted.hash,
    input.seriesKey ?? null, input.title ?? null,
    input.succ ?? null, input.active ?? null, input.fail ?? null, input.percent ?? null,
    pluginVersion, input.formatVersion ?? null,
  );

  const row = store.db.prepare('SELECT last_insert_rowid() AS id').get(),
        id  = Number(row?.['id'] ?? 0);

  return { id, uuid };

}

/**
 * Whether this turn already carries a closing signature.
 *
 * This is the Stop gate's question, answered exactly. The previous implementation
 * approximated it with "did any close row land in the last three minutes", which
 * passed a slow turn on the *previous* turn's signature and blocked a turn that took
 * longer than the window despite having done the right thing.
 *
 * The turn's identity is the **pair** (`session`, `prompt_id`) — the same pair
 * {@link ../channels/context.js contextForTurn} recognises a turn by. Keying on
 * `prompt_id` alone let two sessions satisfy each other's gate, which is not a remote
 * coincidence: a host with no turn-start hook is told to invent a turn id, and `p1` is
 * what anybody invents.
 *
 * The position must be exactly `close`. A `mid` signature marks a genuine mid-turn
 * lurch — it does not end the turn — so accepting it let a turn stop having never signed
 * off, which is the one thing this gate exists to prevent.
 *
 * An absent `session` deliberately does **not** become `session IS NULL`.
 * `entries.session` is `NOT NULL` and {@link validate} rejects a blank one, so that
 * predicate matches no row that was ever written, and the gate would block every stop on
 * a host that reports no session. Unconstrained is the fail-open reading, and it is what
 * the gate did before the pair became the key.
 *
 * **A retracted close still counts.** The question is whether this turn looked at itself
 * and said something, not whether what it said still stands: the turn *did* sign, and
 * taking back a signature's content is not un-signing it. The alternative re-arms the
 * gate on a turn that has already ended — and with `stop_hook_active` capping the gate at
 * one block per turn, that is a refusal nobody can act on.
 *
 * @param session  the session the turn belongs to; `undefined` or `''` narrows nothing
 * @param promptId the turn identifier
 *
 * @example
 *   hasClosingSignature(store, 'sess-1', 'prompt-abc')  // => true
 *   hasClosingSignature(store, 'sess-2', 'prompt-abc')  // => false — a different turn
 *
 * @see ../channels/context.js contextForTurn
 * @see ../mcp/hooks.js onStop
 */
export function hasClosingSignature(
  store    : Store,
  session  : string | undefined,
  promptId : string,
): boolean {

  const scoped = session !== undefined && session !== '';

  const row = store.db.prepare(
    `SELECT 1 AS found FROM entries
      WHERE prompt_id = ? AND channel = 'signature' AND position = 'close'
        ${scoped ? 'AND session = ?' : ''}
      LIMIT 1`).get(...(scoped ? [promptId, session] : [promptId]));

  return row !== undefined;

}

/**
 * What a row's standing is: it still holds, a detail of it was refined, or it has been
 * taken back.
 *
 * Never a stored column. See {@link standingOf} for why that is the whole point.
 */
export type EntryStatus = 'stands' | 'amended' | 'retracted';

/** One row's computed standing, and the strike that decided it. */
export interface Standing {
  /** The entry the standing is about. */
  readonly id     : number;
  /** Computed, never stored. */
  readonly status : EntryStatus;
  /** The newest standing strike that produced this status; `null` when it stands. */
  readonly by     : number | null;
}

/** One correction edge as the standing computation needs it: who struck whom, and how. */
interface Strike {
  readonly id     : number;
  readonly target : number;
  readonly kind   : CorrectionKind;
}

/**
 * A `TEXT` column's value as a string, or `null` for anything that is not one.
 *
 * Deliberately does **not** stringify a non-string. Every column read through this
 * (`corrects_kind`, `outcome`, `verbatim`) is declared `TEXT`, so a value of any other
 * type came from a hand-edited database; coercing it would manufacture a plausible-looking
 * term out of a blob, while `null` routes it to the read rules' honest fallback.
 */
function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * What a `corrects_id` link actually means, applying the legacy read rule in the one
 * place standing is computed.
 *
 * A row written before `corrects_kind` existed carries NULL, and NULL is not "no
 * meaning" — the column's description promised "id of an entry this retracts" from v1
 * until #42 reused the chain, so an unstated link reads as `retracts` unless it carries
 * an `outcome`, in which case it is unmistakably a forecast resolution. **This is a read
 * rule, never a backfill**: no old row is ever rewritten to say what it already meant,
 * which is exactly the property that makes the record's history trustworthy.
 *
 * @param correctsId the link target, or `null` on an entry that links to nothing
 * @param stated     the stored `corrects_kind`, or `null` for a legacy row
 * @param outcome    the stored `outcome`, or `null`
 * @returns the effective kind, or `null` when there is no link to interpret
 *
 * @example
 *   effectiveCorrectionKind(171, 'amends', null)  // => 'amends'
 *   effectiveCorrectionKind(171, null, null)      // => 'retracts'  — the legacy promise
 *   effectiveCorrectionKind(171, null, 'hit')     // => 'resolves'  — a #42 resolution
 *   effectiveCorrectionKind(null, null, null)     // => null        — no link at all
 *
 * @see ./vocabulary.js CORRECTION_KINDS
 * @see standingOf
 */
export function effectiveCorrectionKind(
  correctsId : number | null,
  stated     : string | null,
  outcome    : string | null,
): CorrectionKind | null {
  if (correctsId === null)                { return null; }
  if (isMember(CORRECTION_KINDS, stated)) { return stated; }
  return outcome === null ? 'retracts' : 'resolves';
}

/**
 * The standing of each of `ids`, computed from the `corrects_id` chain at read time.
 *
 * **This function is the heart of issue #16.** The obvious design — `UPDATE entries SET
 * retracted = 1` on the original — is the one this replaces, because it violates the
 * only-verb-is-INSERT property that every downstream use of this data rests on, and
 * because a stored flag can disagree with the chain that implies it, at which point the
 * disagreement is unresolvable after the fact. A derived mark cannot be forgotten,
 * because it is not set: if the strike row exists, every surface computes the mark; if it
 * does not, there is nothing to mark from.
 *
 * The rules:
 *
 * - A row R **strikes** E when `R.corrects_id = E.id`, R's effective kind (stated, or the
 *   legacy rule) is `retracts` or `amends`, and R has not itself been retracted.
 * - E is **retracted** when a standing strike against it is a `retracts`.
 * - E is **amended** when it is not retracted and a standing strike is an `amends`.
 * - Otherwise E **stands**.
 * - `resolves` links never affect standing: a resolved forecast stands with its outcome
 *   beside it, and a forecast that *missed* still stands, because "I predicted X" remains
 *   a true record of the prediction.
 *
 * The recursion is what makes un-retraction work without touching anything: retracting a
 * retraction restores the original, by computation. A strike that has itself been
 * *amended* still strikes — `amends` means the target stands in substance, so an amended
 * retraction is still a retraction.
 *
 * Costs **one query for the whole batch**, not one per row: a recursive CTE walks the
 * "who strikes me" edges forward from the requested ids and returns the reachable
 * subgraph, and the well-founded recursion is then evaluated here. The evaluation is not
 * pushed into SQL because the rule contains a negation inside its own recursion
 * (`… and R has not itself been retracted`), and SQLite's recursive CTEs admit no
 * negated reference to the recursive table. A hand-edited database containing a cycle —
 * impossible through this code, since a link can only name an already-inserted id —
 * resolves toward *standing* rather than looping.
 *
 * @param ids the entries to report on; unknown ids simply come back as `stands`
 * @returns one {@link Standing} per distinct requested id, in the order first requested
 *
 * @example
 *   standingOf(store, [171])              // => [{ id: 171, status: 'stands', by: null }]
 *   // …after entry 214 retracts 171:
 *   standingOf(store, [171])              // => [{ id: 171, status: 'retracted', by: 214 }]
 *   // …after entry 260 retracts 214 ("I was wrong to take that back"):
 *   standingOf(store, [171, 214])
 *   // => [{ id: 171, status: 'stands', by: null }, { id: 214, status: 'retracted', by: 260 }]
 *
 * @see effectiveCorrectionKind
 * @see register
 */
export function standingOf(store: Store, ids: readonly number[]): Standing[] {

  const wanted = [...new Set(ids.filter(id => Number.isInteger(id)))];
  if (wanted.length === 0) { return []; }

  const holes = wanted.map(() => '?').join(',');

  // One recursive walk of the strike edges: start at the requested rows, then repeatedly
  // add every row that points at something already reached. Pure reachability, so it is
  // monotone and expressible; the negation lives in the evaluation below.
  const rows = store.db.prepare(`
    WITH RECURSIVE reach(id) AS (
      SELECT id FROM entries WHERE id IN (${holes})
      UNION
      SELECT strike.id FROM entries strike JOIN reach ON strike.corrects_id = reach.id
    )
    SELECT e.id, e.corrects_id, e.corrects_kind, e.outcome
      FROM entries e JOIN reach ON reach.id = e.id`).all(...wanted);

  const against = new Map<number, Strike[]>();

  for (const row of rows) {
    const target = row['corrects_id'] === null || row['corrects_id'] === undefined
      ? null : Number(row['corrects_id']);
    if (target === null) { continue; }
    const kind = effectiveCorrectionKind(target, text(row['corrects_kind']), text(row['outcome']));
    if (kind !== 'retracts' && kind !== 'amends') { continue; }
    const strike = { id: Number(row['id']), target, kind },
          bucket = against.get(target);
    if (bucket === undefined) { against.set(target, [strike]); } else { bucket.push(strike); }
  }

  const verdicts = new Map<number, boolean>(),
        walking  = new Set<number>();

  const isRetracted = (id: number): boolean => {
    const known = verdicts.get(id);
    if (known !== undefined) { return known; }
    if (walking.has(id))     { return false; }   // only reachable in a hand-edited cycle
    walking.add(id);
    const verdict = (against.get(id) ?? [])
      .some(strike => strike.kind === 'retracts' && !isRetracted(strike.id));
    walking.delete(id);
    verdicts.set(id, verdict);
    return verdict;
  };

  const newest = (strikes: readonly Strike[]): number =>
    strikes.reduce((top, strike) => strike.id > top ? strike.id : top, 0);

  return wanted.map((id): Standing => {

    const living = (against.get(id) ?? []).filter(strike => !isRetracted(strike.id)),
          taken  = living.filter(strike => strike.kind === 'retracts'),
          fixed  = living.filter(strike => strike.kind === 'amends');

    if (taken.length > 0) { return { id, status: 'retracted', by: newest(taken) }; }
    if (fixed.length > 0) { return { id, status: 'amended',   by: newest(fixed) }; }

    return { id, status: 'stands', by: null };

  });

}

/**
 * Which of `ids` have been retracted — the one standing filter every read surface shares.
 *
 * Exists so the readers cannot drift apart. {@link seriesPercents} and
 * {@link checklistSeriesTop} ask the same question of the same `percent` column for the
 * same sparkline, and while each carried its own copy of this filter one of them silently
 * lost it: the recall path dropped a withdrawn snapshot and the history PNG replayed it
 * anyway, so the same number was both taken back and drawn. One helper, one answer, one
 * place to change when the chain semantics gain a case.
 *
 * Retracted only — **an amended row is not in the set**. An amendment means the claim
 * stood and a detail was refined, so the datum keeps its slot; see {@link standingOf}.
 *
 * Costs one batched {@link standingOf} query however many ids are passed, and no query at
 * all for an empty list.
 *
 * @param ids the rows to judge; unknown ids are simply not retracted
 * @returns the subset of `ids` whose computed standing is `retracted`
 *
 * @example
 *   retractedAmong(store, [171, 172])  // => Set(1) { 171 }
 *   retractedAmong(store, [])          // => Set(0) {}
 *
 * @see standingOf
 * @see seriesPercents
 * @see checklistSeriesTop
 */
export function retractedAmong(store: Store, ids: readonly number[]): Set<number> {
  return new Set(
    standingOf(store, ids)
      .filter(standing => standing.status === 'retracted')
      .map(standing => standing.id));
}

/** The retracted or amended claim, as the register presents it. */
export interface RegisterOriginal {
  readonly id      : number;
  readonly channel : string;
  readonly tsUtc   : string;
  readonly text    : string;
}

/** The entry that did the taking-back, as the register presents it. */
export interface RegisterReplacement {
  readonly id      : number;
  readonly channel : string;
  readonly text    : string;
}

/** One standing strike, presented before → after. */
export interface RegisterRow {
  readonly kind        : 'retracts' | 'amends';
  /** The strike's UTC timestamp — when the claim was taken back, not when it was made. */
  readonly at          : string;
  /**
   * The struck row, or `null` when there is none to show: a prose-only retraction of
   * something never recorded, or a target that retention has since pruned out from
   * under a strike that survived it.
   */
  readonly original    : RegisterOriginal | null;
  /** The exact words being withdrawn, when the strike quoted them. */
  readonly verbatim    : string | null;
  readonly replacement : RegisterReplacement;
}

/**
 * The struck row as the register presents it, or `null` when the `LEFT JOIN` found none.
 *
 * Two histories reach here with no original: a prose-only retraction, which never had a
 * `corrects_id` to begin with, and a strike whose target was pruned by retention while
 * the strike itself — being newer — stayed. Both are honestly "there is no original row
 * to show"; the alternative, reading the join's NULLs as columns, would render an
 * original numbered `0` whose every field was the literal string `'null'`.
 *
 * @param row one joined register row, with the original's columns aliased `original_*`
 *
 * @example
 *   registerOriginal({ original_id: 171, original_channel: 'checklist',
 *                      original_ts: '2026-08-01T…', original_text: 'Atlas 31%' })
 *   // => { id: 171, channel: 'checklist', tsUtc: '2026-08-01T…', text: 'Atlas 31%' }
 *   registerOriginal({ original_id: null })  // => null
 *
 * @see register
 * @see ./retention.js pruneExpired
 */
function registerOriginal(row: Record<string, unknown>): RegisterOriginal | null {

  const id = row['original_id'];

  if (id === null || id === undefined) { return null; }

  return {
    id      : Number(id),
    channel : String(row['original_channel']),
    tsUtc   : String(row['original_ts']),
    text    : String(row['original_text']),
  };

}

/** How the register may be narrowed. Every field is optional; all of them combine. */
export interface RegisterOptions {
  /** Only strikes of this kind — `'retracts'` for the falsehoods alone. */
  readonly kind?     : 'retracts' | 'amends' | undefined;
  /** Only strikes written in this session. */
  readonly session?  : string | undefined;
  /** Only strikes recorded under this project — matches nothing when `privacy.store_cwd` suppressed the column. */
  readonly project?  : string | undefined;
  /** Inclusive ISO UTC lower bound on the strike's own timestamp. */
  readonly sinceUtc? : string | undefined;
  /** Newest-first cap; defaults to {@link REGISTER_DEFAULT_LIMIT}. */
  readonly limit?    : number | undefined;
}

/** How many register rows come back when a caller names no limit. */
export const REGISTER_DEFAULT_LIMIT = 20;

/**
 * The retraction register: every standing `retracts` or `amends` strike, newest first,
 * presented before → after.
 *
 * A query, deliberately not a table. A stored register would be a materialized view of
 * derivable data — it would rot the first time chain semantics gained a case, and worse,
 * it would invite reading the *clean* view instead of the marked one, which is filtering
 * by architecture.
 *
 * Two shapes of entry appear:
 *
 * - **Row-backed** — the struck claim was recorded, so `original` carries it and
 *   `verbatim` is optional (the target's own `text` already preserves the exact words).
 * - **Prose-only** — the claim was a sentence in the transcript and never a row, so there
 *   is nothing for `corrects_id` to point at. `original` is `null` and `verbatim` is the
 *   whole anchor. These are `divergence` entries carrying a quote and no link; they are
 *   reported as `retracts`, because a quote withdrawn with no target to still stand is
 *   exactly what the design calls a prose-only retraction.
 *
 * A row-backed strike can *become* originalless: retention prunes by age, and a strike is
 * always newer than what it strikes, so a horizon can take the original and leave the
 * strike. Such a row keeps its link and its `verbatim` and reports `original: null` —
 * see {@link registerOriginal}.
 *
 * Strikes that have themselves been retracted do not appear — the register is the
 * *current* state of taken-back claims — but they remain in the table, reachable by
 * reading the chain, because the table is the full history of the taking-back.
 *
 * @returns the standing strikes, newest first, capped by `options.limit`
 *
 * @example
 *   register(store, { limit: 2 })
 *   // => [{ kind: 'retracts', at: '2026-08-27T21:14:09.000Z',
 *   //       original: { id: 171, channel: 'checklist', tsUtc: '…', text: 'Project Atlas 31%' },
 *   //       verbatim: 'icons sort by status first, then alphabetically',
 *   //       replacement: { id: 214, channel: 'divergence', text: 'sort is rank then bucket 😬' } }]
 *
 * @example
 *   register(store, { session: 's1', sinceUtc: '2026-08-14T00:00:00.000Z', limit: 5 })
 *   // => the last fortnight of this session's standing strikes
 *
 * @see standingOf
 */
export function register(store: Store, options: RegisterOptions = {}): RegisterRow[] {

  const where  : string[] = ['(s.corrects_id IS NOT NULL OR s.verbatim IS NOT NULL)'],
        params : (string | number)[] = [];

  if (options.session  !== undefined) { where.push('s.session = ?');  params.push(options.session);  }
  if (options.project  !== undefined) { where.push('s.project = ?');  params.push(options.project);  }
  if (options.sinceUtc !== undefined) { where.push('s.ts_utc >= ?');  params.push(options.sinceUtc); }

  // No SQL LIMIT: the cap applies after non-standing strikes are dropped, and applying it
  // first could return fewer rows than asked for while standing strikes went unreported.
  // The WHERE clause is what bounds the scan — only rows that link or quote qualify.
  const rows = store.db.prepare(`
    SELECT s.id      AS strike_id,   s.ts_utc  AS strike_ts,  s.channel AS strike_channel,
           s.text    AS strike_text, s.verbatim,
           s.corrects_id, s.corrects_kind, s.outcome,
           o.id AS original_id, o.channel AS original_channel,
           o.ts_utc AS original_ts, o.text AS original_text
      FROM entries s
      LEFT JOIN entries o ON o.id = s.corrects_id
     WHERE ${where.join(' AND ')}
     ORDER BY s.id DESC`).all(...params);

  // Resolve each row's meaning once, here, so the kind filter, the standing check, and
  // the rendering below can never disagree about what a given strike is.
  const candidates: { row: Record<string, unknown>; kind: 'retracts' | 'amends' }[] = [];

  for (const row of rows) {

    const target = row['corrects_id'] === null || row['corrects_id'] === undefined
      ? null : Number(row['corrects_id']);

    // A quote with no link is a prose-only retraction: the claim was a sentence in the
    // transcript, never a row, so the quote is the whole anchor and 'retracts' is what
    // withdrawing it means.
    const kind = target === null
      ? (text(row['verbatim']) === null ? null : 'retracts' as const)
      : effectiveCorrectionKind(target, text(row['corrects_kind']), text(row['outcome']));

    if (kind !== 'retracts' && kind !== 'amends')                { continue; }
    if (options.kind !== undefined && options.kind !== kind)     { continue; }

    candidates.push({ row, kind });

  }

  const gone = retractedAmong(store, candidates.map(entry => Number(entry.row['strike_id'])));

  return candidates
    .filter(entry => !gone.has(Number(entry.row['strike_id'])))
    .slice(0, options.limit ?? REGISTER_DEFAULT_LIMIT)
    .map(({ row, kind }): RegisterRow => ({
      kind,
      at          : String(row['strike_ts']),
      original    : registerOriginal(row),
      verbatim    : text(row['verbatim']),
      replacement : {
        id      : Number(row['strike_id']),
        channel : String(row['strike_channel']),
        text    : String(row['strike_text']),
      },
    }));

}

/**
 * How many recent signatures {@link previousSignature} will look back through before
 * giving up on finding one that still stands.
 *
 * A bound rather than an unbounded walk, so a pathological database — every signature in
 * a session retracted — costs one small indexed read instead of a full-table scan. In
 * practice the first row is the answer: retracting a signature is rare, and retracting
 * twenty-five in a row is not a state this system has.
 */
export const PREVIOUS_SIGNATURE_SCAN = 25;

/**
 * The most recent signature in a session that has not been retracted, or `null` when
 * there is none.
 *
 * Exists so `delta` can be derived from the record instead of recalled. Memory of a
 * previous turn is exactly the kind of thing that degrades quietly.
 *
 * **Documented exclusion (#16):** a retracted signature is skipped. A mis-recorded
 * signature can be taken back like anything else, and a taken-back reading must not
 * remain the baseline the next delta is measured against — the delta would then describe
 * travel from a claim its author has withdrawn. Amended signatures are *kept*: the claim
 * stood, a detail was refined. The row itself is never touched; only this read passes it
 * over, and {@link recentEntries} still returns it, marked.
 *
 * @returns the newest standing signature's display columns plus its `id`, or `null`
 *
 * @example
 *   previousSignature(store, 's1')  // => { id: 41, face: '🙂', stem: 'still', ts_utc: '…' }
 *
 * @see standingOf
 */
export function previousSignature(store: Store, session: string): Record<string, unknown> | null {

  const rows = store.db.prepare(
    `SELECT id, face, context_emoji, stem, delta, uncertain, ts_utc, ts_local
       FROM entries
      WHERE session = ? AND channel = 'signature'
      ORDER BY id DESC LIMIT ?`).all(session, PREVIOUS_SIGNATURE_SCAN);

  if (rows.length === 0) { return null; }

  const gone = retractedAmong(store, rows.map(row => Number(row['id'])));

  return rows.find(row => !gone.has(Number(row['id']))) ?? null;

}

/**
 * The most recent entries, newest last, each **marked** with its standing.
 *
 * Carries `confidence`, `divergence_kind`, `silence`, and `outcome` alongside the
 * display fields, so delta-derivation's neighbor — "what did I recently forecast, and
 * what silences did I type" — is answerable without raw SQL. The five anchor columns
 * ride along for the same reason (#18): "what did I recently annotate, and was it
 * answered" should not require raw SQL either.
 *
 * The link columns and the derived `status` / `by` ride along for the reason #16 exists:
 * without them a retracted entry replays here as authoritative, which is the transcript
 * problem reproduced in the one surface this plugin fully owns. **Retracted rows are
 * returned marked, never omitted** — the model should see that it took something back,
 * not develop amnesia about it. `corrects_id` and `corrects_kind` also let a model point
 * a new retraction at what it is reading, instead of remembering an id from a
 * `recorded #N` reply several turns ago.
 *
 * Costs exactly one extra query however many rows are returned, because
 * {@link standingOf} is batched.
 *
 * @example
 *   recentEntries(store, 3)
 *   // => [{ id: 39, channel: 'checklist', status: 'retracted', by: 41, … },
 *   //     { id: 40, channel: 'signature', status: 'stands',    by: null, … },
 *   //     { id: 41, channel: 'divergence', corrects_kind: 'retracts', status: 'stands', … }]
 *
 * @see standingOf
 * @see register
 */
export function recentEntries(store: Store, limit = 10): Record<string, unknown>[] {

  const rows = store.db.prepare(
    `SELECT id, ts_local, tz, channel, position, delta, face, stem, text,
            confidence, divergence_kind, silence, outcome,
            corrects_id, corrects_kind, verbatim,
            anchor_kind, anchor_target, anchor_span, anchor_quote, anchor_hash
       FROM entries ORDER BY id DESC LIMIT ?`).all(limit);

  const marks = new Map(
    standingOf(store, rows.map(row => Number(row['id'])))
      .map(standing => [standing.id, standing]));

  return rows.reverse().map(row => {
    const mark = marks.get(Number(row['id']));
    return { ...row, status: mark?.status ?? 'stands', by: mark?.by ?? null };
  });

}

/**
 * Every note ever attached to one target, oldest first — the query anchoring exists to
 * answer, and the reason `idx_entries_anchor` exists.
 *
 * Returns the anchor columns beside the note itself, so a caller can re-resolve each
 * one against the target's present state (resolution is never stored) without a second
 * read. An unannotated target returns an empty array rather than throwing: nothing
 * having been said about a file is not an error.
 *
 * @param kind   which addressable kind the target is
 * @param target the path, prompt id, series key, or entry id as text
 * @returns one row per anchored entry, ascending by id (recording order)
 *
 * @example
 *   anchoredEntries(store, 'file', 'src/ts/channels/store.ts')
 *   // => [{ id: 41, channel: 'dissent', anchor_span: 'L141', anchor_quote: '…', … }]
 *
 * @see ./anchors.js resolveAnchor
 */
export function anchoredEntries(store: Store, kind: AnchorKind, target: string): Record<string, unknown>[] {
  return store.db.prepare(
    `SELECT id, ts_local, tz, channel, face, text,
            anchor_kind, anchor_target, anchor_span, anchor_quote, anchor_hash
       FROM entries
      WHERE anchor_kind = ? AND anchor_target = ?
      ORDER BY id ASC`).all(kind, target);
}

/**
 * Every resolved forecast outcome, in resolution order — the calibration series.
 *
 * A row counts only when it carries an `outcome` and its `corrects_id` points at a
 * genuine forecast (`confidence = 'predicted'`), so a stray outcome that slipped past
 * the tool layer cannot pollute the series. Mapped `hit → 'pass'`, `miss → 'fail'`,
 * `void → 'skipped'`, the result feeds `render_series` `winloss` directly; hit rate is
 * `hits / (hits + misses)`, voids excluded, because a dissolved premise says nothing
 * about judgment.
 *
 * **Documented exclusion (#16): a pair is dropped when *either* end is retracted.** A
 * calibration number is the most damaging place for a withdrawn claim to survive — it is
 * a score, and a score computed partly from claims their author took back is a
 * measurement of nothing. Retracting the *resolution* says "that is not how it turned
 * out"; retracting the *forecast* says "I never actually predicted that". Neither should
 * still move the hit rate. **An amendment on either end keeps the pair**, with its
 * recorded `outcome` unchanged: {@link standingOf} reports standing, never a replacement
 * value, and an amended claim stood.
 *
 * @returns each surviving resolution's outcome, ascending by the resolving entry's id
 *
 * @example
 *   forecastOutcomes(store)  // => ['hit', 'hit', 'miss', 'void']
 *
 * @see recordEntry
 * @see retractedAmong
 */
export function forecastOutcomes(store: Store): ForecastOutcome[] {

  const rows = store.db.prepare(
    `SELECT resolution.id AS resolution_id, forecast.id AS forecast_id,
            resolution.outcome AS outcome
       FROM entries resolution
       JOIN entries forecast ON resolution.corrects_id = forecast.id
      WHERE resolution.outcome IS NOT NULL
        AND forecast.confidence = 'predicted'
      ORDER BY resolution.id ASC`).all();

  const gone = retractedAmong(store,
    rows.flatMap(row => [Number(row['resolution_id']), Number(row['forecast_id'])]));

  return rows
    .filter(row => !gone.has(Number(row['resolution_id'])) && !gone.has(Number(row['forecast_id'])))
    .map(row => String(row['outcome']) as ForecastOutcome);

}

/**
 * The most recent checklist rows, newest last — the checklist analogue of
 * {@link recentEntries}, carrying the checklist-specific columns that read omits.
 *
 * Backs the `recall_checklists` tool, replacing the old `log-checklist.mjs` `tail`
 * op: the same recency window, but with `series_key` visible so a caller can see
 * which series a row actually fed rather than assuming the title was the key.
 *
 * @param limit how many rows to return, most recent first before the reversal
 * @returns each row's timestamps, identity, and summary numbers, oldest first
 *
 * @example
 *   recentChecklists(store, 3)
 *   // => [{ ts_local: '9:14 am PDT', title: 'Project Atlas', percent: 31, … }, …]
 *
 * @see recentEntries
 * @see seriesPercents
 */
export function recentChecklists(store: Store, limit = 10): Record<string, unknown>[] {
  const rows = store.db.prepare(
    `SELECT ts_local, tz, project, session, title, series_key, succ, active, fail, percent
       FROM entries
      WHERE channel = 'checklist'
      ORDER BY id DESC LIMIT ?`).all(limit);
  return rows.reverse();
}

/**
 * The stored percent history for one checklist series, oldest first.
 *
 * Backs the chart tools' `seriesKey` resolution: a caller names a series it previously
 * logged instead of repeating its numbers by hand, and this replays exactly what
 * `recordEntry` persisted for it. An unknown or never-used key returns an empty array
 * rather than throwing — a series with no history yet is not an error.
 *
 * **Documented exclusion (#16): retracted snapshots are dropped from the series.** This
 * is the issue's own evidence case — a checklist rendered from stale memory, later
 * re-rendered corrected — and a sparkline replaying the wrong percent beside the right
 * one would double-count the moment. Its replacement row is present to be counted
 * instead. **Amended snapshots are kept**: the claim stood, a detail was refined, and the
 * datum keeps its slot. Nothing is deleted; only this read passes the row over, and
 * caller-supplied chart data is untouched — the caller is the authority on data it
 * supplies.
 *
 * @param seriesKey the series identifier entries were recorded under
 * @returns each standing matching entry's `percent`, ascending by id (recording order)
 *
 * @example
 *   seriesPercents(store, 'coverage')  // => [62, 71, 71, 84]
 *   seriesPercents(store, 'nonesuch')  // => []
 *
 * @see standingOf
 */
export function seriesPercents(store: Store, seriesKey: string): number[] {

  const rows = store.db.prepare(
    `SELECT id, percent FROM entries
      WHERE series_key = ? AND percent IS NOT NULL
      ORDER BY id ASC`).all(seriesKey);

  const gone = retractedAmong(store, rows.map(row => Number(row['id'])));

  return rows.filter(row => !gone.has(Number(row['id']))).map(row => Number(row['percent']));

}

/**
 * The local hour 0–23 out of a stored `ts_local` rendering like `9:14 am PDT`,
 * or `null` when the text does not carry a recognisable clock time.
 *
 * The schema stores the rendered local time precisely so local rhythm is
 * recoverable without replaying timezone history; this is the recovery step the
 * punch-strip panel builds on. Returning `null` rather than guessing keeps a
 * malformed row out of the chart instead of putting it in the wrong place.
 *
 * @example
 *   localHour('9:14 am PDT')   // => 9
 *   localHour('12:03 am PDT')  // => 0
 *   localHour('12:00 pm CET')  // => 12
 *   localHour('whenever')      // => null
 *
 * @see signatureHistory
 */
export function localHour(tsLocal: string): number | null {

  const match = /^(\d{1,2}):\d{2}\s*(am|pm)/i.exec(tsLocal.trim());
  if (match === null) { return null; }

  const twelve = Number(match[1]);
  if (twelve < 1 || twelve > 12) { return null; }

  const isPm = (match[2] ?? '').toLowerCase() === 'pm';
  return (twelve % 12) + (isPm ? 12 : 0);

}

/**
 * The ISO 8601 week a UTC instant falls in, as a label like `2026-W35`.
 *
 * ISO weeks start Monday and belong to the year containing their Thursday, so a
 * label's year can differ from the calendar year at the boundaries — which is
 * exactly why the bucketing is done once here rather than approximated per chart.
 *
 * @example
 *   isoWeekKey(new Date('2026-08-27T21:00:00Z'))  // => '2026-W35'
 *   isoWeekKey(new Date('2027-01-01T00:00:00Z'))  // => '2026-W53'
 *
 * @see needWeekly
 */
export function isoWeekKey(when: Date): string {

  const thursday = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
  const weekday  = thursday.getUTCDay() === 0 ? 7 : thursday.getUTCDay();
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);

  const year = thursday.getUTCFullYear(),
        week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);

  return `${String(year)}-W${String(week).padStart(2, '0')}`;

}

/**
 * Every signature entry since `sinceUtc`, in recording order, shaped for the
 * raster panels: day-bucketable UTC timestamp, recovered local hour, stem,
 * delta, uncertainty flag, and project (null when privacy withheld it).
 *
 * A thin read over the existing `idx_entries_channel` index — no new columns,
 * no new indexes.
 *
 * **Documented exclusion (#16): retracted signatures are dropped.** This is an analytics
 * read — it feeds the stem punch-strip, the delta lane, and the uncertainty strip — and
 * the contract those panels rest on is that a chart never replays a reading its author
 * took back. {@link previousSignature} already refuses to make a withdrawn signature the
 * next delta's baseline; a panel that plotted the same row anyway would be the same
 * falsehood, drawn instead of stated. **Amended signatures are kept**: the reading stood
 * and a detail was refined. The row itself is untouched, and {@link recentEntries} still
 * returns it, marked.
 *
 * @param sinceUtc inclusive ISO UTC lower bound of the window
 * @returns one row per standing signature, ascending by id
 *
 * @example
 *   signatureHistory(store, '2026-05-29T00:00:00.000Z')
 *   // => [{ id: 1, tsUtc: '2026-08-18T16:14:00.000Z', hourLocal: 9, stem: 'flow', … }]
 *
 * @see localHour
 * @see retractedAmong
 * @see ../raster/panels.js
 */
export function signatureHistory(store: Store, sinceUtc: string): SignatureRow[] {

  const rows = store.db.prepare(
    `SELECT id, ts_utc, ts_local, stem, delta, uncertain, project
       FROM entries
      WHERE channel = 'signature' AND ts_utc >= ?
      ORDER BY id ASC`).all(sinceUtc);

  const gone = retractedAmong(store, rows.map(row => Number(row['id'])));

  return rows.filter(row => !gone.has(Number(row['id']))).map(row => ({
    id        : Number(row['id']),
    tsUtc     : String(row['ts_utc']),
    hourLocal : localHour(String(row['ts_local'])),
    stem      : row['stem']    === null ? null : String(row['stem']),
    delta     : row['delta']   === null ? null : String(row['delta']),
    uncertain : Number(row['uncertain']) !== 0,
    project   : row['project'] === null ? null : String(row['project']),
  }));

}

/**
 * Per-ISO-week turn and need counts since `sinceUtc`, ascending by week — the
 * need-rate panel's data. Turns are distinct `prompt_id`s among signatures (a
 * turn usually carries two signatures, so raw row counts would double-count);
 * needs are `need` rows.
 *
 * Weeks in which either count is nonzero appear; weeks with neither are absent
 * rather than zero-filled, since an all-idle week carries no rate to plot.
 *
 * @param sinceUtc inclusive ISO UTC lower bound of the window
 *
 * @example
 *   needWeekly(store, '2026-05-29T00:00:00.000Z')
 *   // => [{ week: '2026-W33', turns: 41, needs: 3 }, { week: '2026-W34', turns: 12, needs: 5 }]
 *
 * @see isoWeekKey
 */
export function needWeekly(store: Store, sinceUtc: string): NeedWeekRow[] {

  const turnRows = store.db.prepare(
    `SELECT MIN(ts_utc) AS ts_utc FROM entries
      WHERE channel = 'signature' AND ts_utc >= ? AND prompt_id IS NOT NULL
      GROUP BY prompt_id`).all(sinceUtc);

  const needRows = store.db.prepare(
    `SELECT ts_utc FROM entries
      WHERE channel = 'need' AND ts_utc >= ?`).all(sinceUtc);

  const buckets = new Map<string, { turns: number; needs: number }>();

  const bucket = (tsUtc: unknown): { turns: number; needs: number } => {
    const key   = isoWeekKey(new Date(String(tsUtc))),
          found = buckets.get(key);
    if (found !== undefined) { return found; }
    const fresh = { turns: 0, needs: 0 };
    buckets.set(key, fresh);
    return fresh;
  };

  for (const row of turnRows) { bucket(row['ts_utc']).turns += 1; }
  for (const row of needRows) { bucket(row['ts_utc']).needs += 1; }

  return [...buckets.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([week, counts]) => ({ week, turns: counts.turns, needs: counts.needs }));

}

/**
 * The `n` checklist series with the most percent snapshots since `sinceUtc`,
 * each with its in-range percent history in recording order — the checklist
 * panel's data. Series keys are the stable identities of #27, so the labels
 * drawn from them cannot fork when a title is reworded.
 *
 * **Documented exclusion (#16): retracted snapshots are dropped**, by exactly the filter
 * {@link seriesPercents} applies — the two read the same `percent` column for the same
 * sparkline, and the moment they disagreed the recall path reported `[62]` while the
 * history PNG drew `[31, 62]`, replaying a number its author had taken back. The
 * exclusion applies to the **ranking as well as the history**: a withdrawn snapshot does
 * not make a series look busier than it was, and a series whose every in-range snapshot
 * was retracted drops out entirely rather than appearing as an empty line. **Amended
 * snapshots are kept**, keeping their slot and their recorded percent.
 *
 * @param sinceUtc inclusive ISO UTC lower bound of the window
 * @param n        how many series to return, busiest first; a positive integer
 *
 * @example
 *   checklistSeriesTop(store, '2026-05-29T00:00:00.000Z', 5)
 *   // => [{ seriesKey: 'coverage', percents: [62, 71, 84] }, …]
 *
 * @see seriesPercents
 * @see retractedAmong
 */
export function checklistSeriesTop(store: Store, sinceUtc: string, n = 5): ChecklistSeriesRow[] {

  // One read of the whole window rather than a ranking query plus one history query per
  // series: the standing filter has to be applied before the ranking, so the ranking
  // cannot be delegated to SQL's COUNT — and the surviving rows are exactly what the
  // histories are built from anyway.
  const rows = store.db.prepare(
    `SELECT id, series_key, percent FROM entries
      WHERE channel = 'checklist' AND series_key IS NOT NULL AND percent IS NOT NULL AND ts_utc >= ?
      ORDER BY id ASC`).all(sinceUtc);

  const gone   = retractedAmong(store, rows.map(row => Number(row['id']))),
        series = new Map<string, number[]>();

  for (const row of rows) {
    if (gone.has(Number(row['id']))) { continue; }
    const key    = String(row['series_key']),
          bucket = series.get(key);
    if (bucket === undefined) { series.set(key, [Number(row['percent'])]); }
    else                      { bucket.push(Number(row['percent'])); }
  }

  return [...series.entries()]
    .sort(([keyA, a], [keyB, b]) =>
      b.length - a.length || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map(([seriesKey, percents]) => ({ seriesKey, percents }));

}
