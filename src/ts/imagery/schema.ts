/**
 * DDL for the generation ledger — the record of everything this facility spent money
 * on, or tried to.
 *
 * Two shapes here are worth defending, because both are departures from the obvious.
 *
 * **A row is written before the request, not after.** The obvious design ledgers the
 * outcome once it is known, which means a process that dies mid-request leaves no
 * trace of a call that may well have been billed. Since the whole reason this facility
 * has a ledger is that every attempt costs the user real money, an attempt that
 * vanishes because the process died is precisely the row the user most needs. So the
 * row is inserted as `pending` before the socket opens and updated when the reply
 * lands; a `pending` row that never settled is an honest "we asked, and we do not know
 * what happened", and it counts against the budget, because assuming an unknown call
 * was free is how a runaway loop stays invisible.
 *
 * **`credential_env_var` stores a name, and there is no column for a key.** The
 * variable name is recorded because "which variable was this billed against" is a real
 * question with a real answer; the value has no column, no index, and no code path
 * that could reach one. The asymmetry is deliberate and visible in the schema itself.
 *
 * `prompt` and `prompt_source` together answer the hazard the issue raises without
 * listing: a prompt assembled from a file, a PR body, or a fetched page is content of
 * unknown provenance being sent to a third party on the user's account. The full text
 * is stored (local free text under the #31 rule, never aggregated), its SHA-256 is
 * stored beside it so the text can be *matched* even after retention removes it, and
 * the declared source and its detail record where the words came from.
 *
 * @see ./ledger.js
 * @see ./providers.js
 */

import { IMAGE_PROVIDER_IDS } from './providers.js';

/** Schema version stamped into the ledger's `meta` table. */
export const IMAGE_SCHEMA_VERSION = 1;

/**
 * Where the words in a prompt came from.
 *
 * `composed` means the assistant wrote them; every other value means text of some
 * other provenance was forwarded to a third party under the user's credential, which
 * is a materially different act and is recorded as one.
 */
export const PROMPT_SOURCES = ['composed', 'user', 'file', 'web', 'repository', 'other'] as const;

/** One declared prompt provenance. */
export type PromptSource = (typeof PROMPT_SOURCES)[number];

/**
 * What became of one attempt.
 *
 * `refused` never reached the network — a cap, a missing credential, or the
 * no-rewording rule stopped it here. `policy_refused` reached the provider and the
 * provider declined. `error` reached a definite failure. `pending` is a row whose
 * request was sent and whose fate is unknown.
 */
export const GENERATION_OUTCOMES = ['pending', 'generated', 'policy_refused', 'refused', 'error'] as const;

/** One recorded outcome. */
export type GenerationOutcome = (typeof GENERATION_OUTCOMES)[number];

/**
 * Outcomes that count against the session and daily caps.
 *
 * `generated` was billed. `policy_refused` reached the provider and is commonly billed
 * too. `pending` is unknown and therefore assumed billed, because a budget that
 * forgives everything it cannot see is not a budget. `error` and `refused` do not
 * count: a DNS failure or a spent cap costs nothing, and charging the user's daily
 * allowance for a network outage would be a second punishment for a first misfortune.
 */
export const BILLABLE_OUTCOMES: readonly GenerationOutcome[] = ['pending', 'generated', 'policy_refused'];

const providers = IMAGE_PROVIDER_IDS.map(id => `'${id}'`).join(','),
      sources   = PROMPT_SOURCES.map(s => `'${s}'`).join(','),
      outcomes  = GENERATION_OUTCOMES.map(o => `'${o}'`).join(',');

/**
 * The generation ledger: one row per attempt, billed or not.
 *
 * The explicit annotation is required by `isolatedDeclarations` and simultaneously
 * flagged by eslint's `no-inferrable-types`, which does not know about that
 * constraint; the compiler wins, exactly as in `channels/schema.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const GENERATIONS_DDL: string = `
  CREATE TABLE IF NOT EXISTS generations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid               TEXT    NOT NULL,
    session_id         TEXT    NOT NULL,
    asked_utc          TEXT    NOT NULL,
    local              TEXT    NOT NULL,
    tz                 TEXT    NOT NULL,
    provider           TEXT    NOT NULL CHECK (provider IN (${providers})),
    model              TEXT    NOT NULL,
    prompt             TEXT    NOT NULL,
    prompt_sha256      TEXT    NOT NULL,
    prompt_source      TEXT    NOT NULL CHECK (prompt_source IN (${sources})),
    prompt_source_detail TEXT,
    size               TEXT,
    outcome            TEXT    NOT NULL CHECK (outcome IN (${outcomes})),
    detail             TEXT,
    image_count        INTEGER NOT NULL DEFAULT 0,
    bytes              INTEGER,
    path               TEXT,
    cost_estimate_usd  REAL,
    cost_source        TEXT    NOT NULL DEFAULT 'none',
    provider_request_id TEXT,
    credential_env_var TEXT,
    settled_utc        TEXT,
    plugin_version     TEXT    NOT NULL
  )
`;

/** Key/value system state for the ledger file itself. */
export const IMAGE_META_DDL = `
  CREATE TABLE IF NOT EXISTS meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_utc TEXT
  )
`;

/** The budget's query path: recent rows by time. */
export const GENERATIONS_TIME_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_generations_utc ON generations (asked_utc)
`;

/** The session cap's query path. */
export const GENERATIONS_SESSION_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_generations_session ON generations (session_id)
`;

/** Every statement needed to bring a fresh ledger to the current schema. */
export const ALL_IMAGE_DDL: readonly string[] = [
  GENERATIONS_DDL, IMAGE_META_DDL, GENERATIONS_TIME_INDEX_DDL, GENERATIONS_SESSION_INDEX_DDL,
];
