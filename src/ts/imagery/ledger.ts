/**
 * Generation ledger lifecycle, writes, and the queries the budget is answered from.
 *
 * Its own SQLite file beside the expression log, opened with the same
 * create-if-missing discipline as `channels/store.ts`. The ledger is both the audit
 * record and the budget's memory: the session and daily caps are answered from
 * {@link billableInSession} and {@link billableSince}, so enforcement is server-side
 * state rather than model politeness — the same posture as the audio strike ledger.
 *
 * **Every text column is pattern-scrubbed on the way in.** The caller already scrubs
 * with the credential it holds; this scrubs again with {@link scrubUnknown}, which
 * holds no credential and needs none. The two mechanisms are independent on purpose:
 * a bug that disables one leaves the other standing, and the tests break each of them
 * separately to prove it.
 *
 * @see ./schema.js
 * @see ./scrub.js
 * @see ./gate.js
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync }    from 'node:fs';
import { dirname }      from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { ALL_IMAGE_DDL, BILLABLE_OUTCOMES, IMAGE_SCHEMA_VERSION } from './schema.js';
import type { GenerationOutcome, PromptSource } from './schema.js';
import type { CostSource, ImageProviderId }     from './providers.js';
import { imageDbPath } from './paths.js';
import { scrubUnknown } from './scrub.js';
import { stamp }        from '../channels/time.js';

/** An open generation ledger. */
export interface ImageLedger {
  readonly db   : DatabaseSync;
  /** Absolute path to the ledger database file. */
  readonly path : string;
}

/** What is known about an attempt before the request is sent. */
export interface AttemptRecord {
  readonly sessionId          : string;
  readonly provider           : ImageProviderId;
  readonly model              : string;
  readonly prompt             : string;
  readonly promptSource       : PromptSource;
  readonly promptSourceDetail : string | null;
  readonly size               : string | null;
  /** The variable the credential is read from — a **name**; there is no value column. */
  readonly credentialEnvVar   : string | null;
  readonly pluginVersion      : string;
}

/** What is known once the request has resolved, or been refused before it was sent. */
export interface Settlement {
  readonly outcome           : GenerationOutcome;
  readonly detail            : string | null;
  readonly imageCount        : number;
  readonly bytes             : number | null;
  readonly path              : string | null;
  readonly costEstimateUsd   : number | null;
  readonly costSource        : CostSource;
  readonly providerRequestId : string | null;
}

/** A written row's identity, which is also the handle the panel can watch. */
export interface WrittenAttempt {
  readonly id   : number;
  readonly uuid : string;
}

/** One row of the no-rewording rule's working set. */
export interface RefusedPrompt {
  readonly utc    : string;
  readonly prompt : string;
}

/** The SHA-256 of a prompt, so its identity survives the text being pruned. */
export function promptDigest(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

/** Scrub a nullable text column on its way into the database. */
function clean(value: string | null): string | null {
  return value === null ? null : scrubUnknown(value);
}

/**
 * Open (creating if necessary) the generation ledger, applying the schema idempotently.
 *
 * @param path - ledger file to open; defaults to the resolved data directory
 *
 * @example
 *   const ledger = openImageLedger('/tmp/x/images.sqlite3');
 *   const row = recordAttempt(ledger, attempt);
 *   closeImageLedger(ledger);
 *
 * @throws {Error} If the directory cannot be created or the file cannot be opened —
 *                 loud on purpose: a facility that spends money it cannot ledger is
 *                 exactly the unauditable spend the design forbids.
 */
export function openImageLedger(path: string = imageDbPath()): ImageLedger {

  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  for (const statement of ALL_IMAGE_DDL) { db.exec(statement); }

  db.prepare(
    'INSERT INTO meta (key, value, updated_utc) VALUES (?,?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_utc = excluded.updated_utc'
  ).run('schema_version', String(IMAGE_SCHEMA_VERSION), stamp().utc);

  return { db, path };

}

/**
 * Append one attempt as `pending`, before the request is sent.
 *
 * The returned uuid is the attempt's handle: it names the ledger row, it is embedded
 * in every image filename the attempt produces, and it is what the panel watches to
 * see a generation in flight — which is why this facility needs no separate job store
 * and no polling tool to be watchable.
 *
 * @param ledger  - the open ledger
 * @param attempt - everything known before the socket opens
 * @param when    - the attempt instant; injectable so tests can pin filenames
 * @returns the new row's id and uuid
 *
 * @example
 *   recordAttempt(ledger, {
 *     sessionId: 's1', provider: 'openai', model: 'gpt-image-1',
 *     prompt: 'a red bicycle', promptSource: 'composed', promptSourceDetail: null,
 *     size: '1024x1024', credentialEnvVar: 'OPENAI_API_KEY', pluginVersion: '0.2.1',
 *   })
 *   // => { id: 1, uuid: '9b2f…' }
 *
 * @see settleAttempt
 */
export function recordAttempt(
  ledger  : ImageLedger,
  attempt : AttemptRecord,
  when    : Date = new Date(),
): WrittenAttempt {

  const uuid   = randomUUID(),
        at     = stamp(when),
        prompt = scrubUnknown(attempt.prompt);

  const result = ledger.db.prepare(
    'INSERT INTO generations (uuid, session_id, asked_utc, local, tz, provider, model, prompt, ' +
    'prompt_sha256, prompt_source, prompt_source_detail, size, outcome, image_count, ' +
    'cost_source, credential_env_var, plugin_version) ' +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,'none',?,?)"
  ).run(
    uuid, attempt.sessionId, at.utc, at.local, at.tz, attempt.provider, attempt.model,
    prompt, promptDigest(prompt), attempt.promptSource, clean(attempt.promptSourceDetail),
    attempt.size, clean(attempt.credentialEnvVar), attempt.pluginVersion,
  );

  return { id: Number(result.lastInsertRowid), uuid };

}

/**
 * Settle a pending attempt with what actually happened.
 *
 * @param ledger - the open ledger
 * @param id     - the row id {@link recordAttempt} returned
 * @param result - the outcome, its detail, and any cost the attempt is known to carry
 * @param when   - the settlement instant
 *
 * @example
 *   settleAttempt(ledger, 1, {
 *     outcome: 'generated', detail: null, imageCount: 1, bytes: 81234,
 *     path: 'C:/…/images/openai_….png', costEstimateUsd: 0.04,
 *     costSource: 'list-price', providerRequestId: 'img_123',
 *   });
 */
export function settleAttempt(
  ledger : ImageLedger,
  id     : number,
  result : Settlement,
  when   : Date = new Date(),
): void {

  ledger.db.prepare(
    'UPDATE generations SET outcome = ?, detail = ?, image_count = ?, bytes = ?, path = ?, ' +
    'cost_estimate_usd = ?, cost_source = ?, provider_request_id = ?, settled_utc = ? WHERE id = ?'
  ).run(
    result.outcome, clean(result.detail), result.imageCount, result.bytes, clean(result.path),
    result.costEstimateUsd, result.costSource, clean(result.providerRequestId),
    stamp(when).utc, id,
  );

}

/**
 * Record one attempt that never reached the network: a spent cap, a missing
 * credential, or the no-rewording rule.
 *
 * Written in one statement rather than an insert-then-settle pair, because there is no
 * window during which its fate is unknown — nothing was sent, so nothing can be
 * in flight.
 *
 * @param reason - the refusal text, which the reply repeats verbatim
 *
 * @example
 *   recordRefusal(ledger, attempt, 'the per-session image cap (6) is spent…')
 *   // => { id: 4, uuid: '…' }
 */
export function recordRefusal(
  ledger  : ImageLedger,
  attempt : AttemptRecord,
  reason  : string,
  when    : Date = new Date(),
): WrittenAttempt {

  const written = recordAttempt(ledger, attempt, when);

  settleAttempt(ledger, written.id, {
    outcome           : 'refused',
    detail            : reason,
    imageCount        : 0,
    bytes             : null,
    path              : null,
    costEstimateUsd   : null,
    costSource        : 'none',
    providerRequestId : null,
  }, when);

  return written;

}

/** The `?,?,…` placeholder list and values for the billable-outcome filter. */
const BILLABLE_PLACEHOLDERS = BILLABLE_OUTCOMES.map(() => '?').join(',');

/**
 * How many billable attempts this session has made.
 *
 * @param sessionId - the per-process session id the caller minted at startup
 * @returns the count of rows whose outcome is in {@link BILLABLE_OUTCOMES}
 *
 * @example
 *   billableInSession(ledger, 's1')  // => 2
 */
export function billableInSession(ledger: ImageLedger, sessionId: string): number {

  const row = ledger.db.prepare(
    `SELECT COUNT(*) AS n FROM generations WHERE session_id = ? ` +
    `AND outcome IN (${BILLABLE_PLACEHOLDERS})`
  ).get(sessionId, ...BILLABLE_OUTCOMES);

  return Number(row?.['n'] ?? 0);

}

/**
 * How many billable attempts were made at or after `sinceUtc` — the rolling daily cap's
 * working set.
 *
 * Rolling rather than calendar-day, matching the audio facility's rolling hour: a
 * calendar boundary invites a wait-for-midnight retry loop and would make the same cap
 * mean different things in different timezones.
 *
 * @param sinceUtc - ISO 8601 UTC lower bound, inclusive
 *
 * @example
 *   billableSince(ledger, '2026-08-28T10:00:00.000Z')  // => 5
 */
export function billableSince(ledger: ImageLedger, sinceUtc: string): number {

  const row = ledger.db.prepare(
    `SELECT COUNT(*) AS n FROM generations WHERE asked_utc >= ? ` +
    `AND outcome IN (${BILLABLE_PLACEHOLDERS})`
  ).get(sinceUtc, ...BILLABLE_OUTCOMES);

  return Number(row?.['n'] ?? 0);

}

/**
 * The prompts a provider's content policy refused at or after `sinceUtc`, newest first.
 *
 * This is what makes "never retried with a reworded prompt" a rule the server enforces
 * rather than a rule the model is asked to remember. Read from the ledger rather than
 * from process memory so a restart does not launder a refusal.
 *
 * @param sinceUtc - ISO 8601 UTC lower bound, inclusive
 * @param limit    - most rows to consider; the rule only needs the recent ones
 *
 * @example
 *   policyRefusalsSince(ledger, '2026-08-28T10:00:00.000Z')
 *   // => [{ utc: '2026-08-28T11:04:00.000Z', prompt: 'a … scene' }]
 */
export function policyRefusalsSince(
  ledger   : ImageLedger,
  sinceUtc : string,
  limit             = 20,
): RefusedPrompt[] {

  const rows = ledger.db.prepare(
    "SELECT asked_utc, prompt FROM generations WHERE outcome = 'policy_refused' " +
    'AND asked_utc >= ? ORDER BY asked_utc DESC LIMIT ?'
  ).all(sinceUtc, limit);

  return rows.map(row => ({ utc: String(row['asked_utc']), prompt: String(row['prompt']) }));

}

/**
 * Total estimated spend at or after `sinceUtc`, in USD.
 *
 * An estimate of an estimate, and named so: no provider returns a dollar figure, so
 * this sums the registry's list prices. It exists because a budget the user cannot
 * read the balance of is a budget they cannot reason about.
 *
 * @example
 *   spendSince(ledger, '2026-08-28T10:00:00.000Z')  // => 0.24
 */
export function spendSince(ledger: ImageLedger, sinceUtc: string): number {

  const row = ledger.db.prepare(
    'SELECT COALESCE(SUM(cost_estimate_usd), 0) AS total FROM generations WHERE asked_utc >= ?'
  ).get(sinceUtc);

  return Number(row?.['total'] ?? 0);

}

/**
 * Close the ledger. Safe to call on an already-closed ledger.
 *
 * @example
 *   closeImageLedger(ledger);
 */
export function closeImageLedger(ledger: ImageLedger): void {
  try { ledger.db.close(); } catch { /* already closed */ }
}
