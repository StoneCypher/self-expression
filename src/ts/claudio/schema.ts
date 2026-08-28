/**
 * DDL for the strike ledger — the audio facility's own auditable record.
 *
 * Every strike attempt is recorded, refusals included, so the human can always
 * reconstruct what made noise (or tried to) and when. Choosing *not* to strike
 * records nothing: audio is a privilege, not an obligation, so the no-op-entry
 * doctrine that protects mandatory channels is deliberately absent here.
 *
 * The CHECK constraints repeat the runtime vocabularies on purpose, in the pattern
 * of `channels/schema.ts`: a bad value must fail at every layer it could arrive
 * through.
 *
 * @see ./ledger.js
 * @see ./vocabulary.js
 */

import { LEITMOTIFS, STRIKE_KINDS } from './vocabulary.js';

/** Schema version stamped into the ledger's `meta` table. */
export const AUDIO_SCHEMA_VERSION = 1;

const kinds  = STRIKE_KINDS.map(k => `'${k}'`).join(','),
      motifs = LEITMOTIFS.map(m => `'${m}'`).join(',');

/**
 * The strike ledger: one row per attempt, played or refused.
 *
 * The explicit annotation is required by `isolatedDeclarations` and simultaneously
 * flagged by eslint's `no-inferrable-types`, which does not know about that
 * constraint; the compiler wins, exactly as in `channels/schema.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const STRIKES_DDL: string = `
  CREATE TABLE IF NOT EXISTS strikes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid             TEXT    NOT NULL,
    struck_utc       TEXT    NOT NULL,
    local            TEXT    NOT NULL,
    tz               TEXT    NOT NULL,
    kind             TEXT    NOT NULL CHECK (kind IN (${kinds})),
    leitmotif        TEXT             CHECK (leitmotif IS NULL OR leitmotif IN (${motifs})),
    requested_volume INTEGER,
    played_volume    INTEGER NOT NULL,
    ceiling          INTEGER NOT NULL,
    duration_ms      INTEGER,
    outcome          TEXT    NOT NULL CHECK (outcome IN ('played','refused','error')),
    detail           TEXT,
    text             TEXT,
    plugin_version   TEXT    NOT NULL
  )
`;

/** Key/value system state for the ledger file itself. */
export const AUDIO_META_DDL = `
  CREATE TABLE IF NOT EXISTS meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_utc TEXT
  )
`;

/** The rate limiter's one query path: recent rows by time. */
export const STRIKES_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_strikes_utc ON strikes (struck_utc)
`;

/** Every statement needed to bring a fresh ledger to the current schema. */
export const ALL_AUDIO_DDL: readonly string[] = [STRIKES_DDL, AUDIO_META_DDL, STRIKES_INDEX_DDL];
