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
  isMember, describeVocabulary,
} from './vocabulary.js';
import type {
  Channel, Position, Delta, Turn, Effort, Stem,
  ConfidenceGround, DivergenceKind, Modality,
} from './vocabulary.js';
import { stamp } from './time.js';
import type { Store } from './store.js';

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
];

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
 * @example
 *   validate({ channel: 'signature', text: 'x', session: 's' })      // => []
 *   validate({ channel: 'vibes', text: 'x', session: 's' })
 *   // => ["'vibes' is not a valid channel; expected 'signature', 'need', ..."]
 *   validate({ channel: 'checklist', text: 'x', session: 's', percent: 80 })
 *   // => ['percent requires a seriesKey — a snapshot recorded without one can never join a trend series']
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

  return problems;

}

/** SQLite has no boolean; store as 0/1, and leave undefined alone. */
function bit(value: boolean | undefined): number | null {
  return value === undefined ? null : (value ? 1 : 0);
}

/**
 * Record one entry, returning its identity.
 *
 * Generates the uuid, all three timestamps, and the machine identity rather than
 * accepting them. `when` is injectable so tests can pin the clock.
 *
 * @example
 *   recordEntry(store, { channel: 'need', text: 'merge #21?', session: 's1' })
 *   // => { id: 1, uuid: '…' }
 *
 * @throws {Error} If validation fails — a closed field outside its vocabulary, or a
 *                 checklist series violation (see {@link validate}) — naming every
 *                 problem and the values that would have been accepted.
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

  const at   = stamp(when),
        uuid = randomUUID();

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
      confidence, divergence_kind,
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
      ?,?,
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
 * @example
 *   recentEntries(store, 3)  // => [{ … }, { … }, { … }]
 */
export function recentEntries(store: Store, limit = 10): Record<string, unknown>[] {
  const rows = store.db.prepare(
    `SELECT ts_local, tz, channel, position, delta, face, stem, text
       FROM entries ORDER BY id DESC LIMIT ?`).all(limit);
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
