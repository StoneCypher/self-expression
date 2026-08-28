/**
 * Writing and reading expression entries.
 *
 * Validation happens here rather than being left to the database, so a rejection can
 * say what would have worked instead of surfacing a bare constraint failure. The
 * `CHECK` clauses in the schema remain as a second line of defence: this module is the
 * only intended writer, but it should not be the only thing standing between a typo
 * and the record.
 *
 * @see ./vocabulary.js
 * @see ./store.js
 */

import { randomUUID } from 'node:crypto';
import {
  CHANNELS, POSITIONS, DELTAS, TURNS, EFFORTS, STEMS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES,
  FORECAST_OUTCOMES, SILENCE_KINDS, ANCHOR_KINDS,
  isMember, describeVocabulary,
} from './vocabulary.js';
import type {
  Channel, Position, Delta, Turn, Effort, Stem,
  ConfidenceGround, DivergenceKind, Modality,
  ForecastOutcome, SilenceKind, AnchorKind,
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

  problems.push(...anchorProblems(input));

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
          `${String(field)} requires an anchorKind — an anchor field with no kind ` +
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
 *   // => { quote: null, hash: 'a1b2c3d4e5f60718' }   — hash present, words gone
 *   storedQuote('file', 'readConfig(store, key)', false)
 *   // => { quote: 'readConfig(store, key)', hash: '…' }  — the repo's own text
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
      context_tokens, output_tokens, thinking_tokens, corrects_id,
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
      ?,?,?,?,
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
    input.correctsId ?? null,
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
 * @example
 *   hasClosingSignature(store, 'prompt-abc')  // => true
 */
export function hasClosingSignature(store: Store, promptId: string): boolean {
  const row = store.db.prepare(
    `SELECT 1 AS found FROM entries
      WHERE prompt_id = ? AND channel = 'signature' AND position IN ('close','mid')
      LIMIT 1`).get(promptId);
  return row !== undefined;
}

/**
 * The most recent signature in a session, or `null` when there is none.
 *
 * Exists so `delta` can be derived from the record instead of recalled. Memory of a
 * previous turn is exactly the kind of thing that degrades quietly.
 *
 * @example
 *   previousSignature(store, 's1')  // => { face: '🙂', stem: 'still', ts_utc: '…' }
 */
export function previousSignature(store: Store, session: string): Record<string, unknown> | null {
  const row = store.db.prepare(
    `SELECT face, context_emoji, stem, delta, uncertain, ts_utc, ts_local
       FROM entries
      WHERE session = ? AND channel = 'signature'
      ORDER BY id DESC LIMIT 1`).get(session);
  return row ?? null;
}

/**
 * The most recent entries, newest last.
 *
 * Carries `confidence`, `divergence_kind`, `silence`, and `outcome` alongside the
 * display fields, so delta-derivation's neighbor — "what did I recently forecast, and
 * what silences did I type" — is answerable without raw SQL. The five anchor columns
 * ride along for the same reason (#18): "what did I recently annotate, and was it
 * answered" should not require raw SQL either.
 *
 * @example
 *   recentEntries(store, 3)  // => [{ … }, { … }, { … }]
 */
export function recentEntries(store: Store, limit = 10): Record<string, unknown>[] {
  const rows = store.db.prepare(
    `SELECT id, ts_local, tz, channel, position, delta, face, stem, text,
            confidence, divergence_kind, silence, outcome,
            anchor_kind, anchor_target, anchor_span, anchor_quote, anchor_hash
       FROM entries ORDER BY id DESC LIMIT ?`).all(limit);
  return rows.reverse();
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
 * @returns each resolution's outcome, ascending by the resolving entry's id
 *
 * @example
 *   forecastOutcomes(store)  // => ['hit', 'hit', 'miss', 'void']
 *
 * @see recordEntry
 */
export function forecastOutcomes(store: Store): ForecastOutcome[] {
  const rows = store.db.prepare(
    `SELECT resolution.outcome AS outcome
       FROM entries resolution
       JOIN entries forecast ON resolution.corrects_id = forecast.id
      WHERE resolution.outcome IS NOT NULL
        AND forecast.confidence = 'predicted'
      ORDER BY resolution.id ASC`).all();
  return rows.map(row => String(row['outcome']) as ForecastOutcome);
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
 * @param seriesKey the series identifier entries were recorded under
 * @returns each matching entry's `percent`, ascending by id (recording order)
 *
 * @example
 *   seriesPercents(store, 'coverage')  // => [62, 71, 71, 84]
 *   seriesPercents(store, 'nonesuch')  // => []
 */
export function seriesPercents(store: Store, seriesKey: string): number[] {
  const rows = store.db.prepare(
    `SELECT percent FROM entries
      WHERE series_key = ? AND percent IS NOT NULL
      ORDER BY id ASC`).all(seriesKey);
  return rows.map(row => Number(row['percent']));
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
 * @param sinceUtc inclusive ISO UTC lower bound of the window
 * @returns one row per signature, ascending by id
 *
 * @example
 *   signatureHistory(store, '2026-05-29T00:00:00.000Z')
 *   // => [{ id: 1, tsUtc: '2026-08-18T16:14:00.000Z', hourLocal: 9, stem: 'flow', … }]
 *
 * @see localHour
 * @see ../raster/panels.js
 */
export function signatureHistory(store: Store, sinceUtc: string): SignatureRow[] {

  const rows = store.db.prepare(
    `SELECT id, ts_utc, ts_local, stem, delta, uncertain, project
       FROM entries
      WHERE channel = 'signature' AND ts_utc >= ?
      ORDER BY id ASC`).all(sinceUtc);

  return rows.map(row => ({
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
 * @param sinceUtc inclusive ISO UTC lower bound of the window
 * @param n        how many series to return, busiest first; a positive integer
 *
 * @example
 *   checklistSeriesTop(store, '2026-05-29T00:00:00.000Z', 5)
 *   // => [{ seriesKey: 'coverage', percents: [62, 71, 84] }, …]
 *
 * @see seriesPercents
 */
export function checklistSeriesTop(store: Store, sinceUtc: string, n = 5): ChecklistSeriesRow[] {

  const keys = store.db.prepare(
    `SELECT series_key, COUNT(*) AS rows_in_range FROM entries
      WHERE channel = 'checklist' AND series_key IS NOT NULL AND percent IS NOT NULL AND ts_utc >= ?
      GROUP BY series_key
      ORDER BY rows_in_range DESC, series_key ASC
      LIMIT ?`).all(sinceUtc, n);

  const history = store.db.prepare(
    `SELECT percent FROM entries
      WHERE channel = 'checklist' AND series_key = ? AND percent IS NOT NULL AND ts_utc >= ?
      ORDER BY id ASC`);

  return keys.map(keyRow => {
    const seriesKey = String(keyRow['series_key']);
    return {
      seriesKey,
      percents: history.all(seriesKey, sinceUtc).map(row => Number(row['percent'])),
    };
  });

}
