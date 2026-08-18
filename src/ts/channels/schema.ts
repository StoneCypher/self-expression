/**
 * The database shape: one table of expressions, one of system state, one of user config.
 *
 * The central decision is that **every channel is a row in one table**, distinguished by
 * a `channel` column, rather than a signature row with other kinds hanging off it. Ideas
 * are rendered "anywhere relevant, occasionally" and are not attached to a signature, so
 * a parent-child relationship would be inventing a link that does not exist. Grouping is
 * done by `prompt_id`, which identifies a turn — that is enough to associate a need with
 * the signature it renders under, and it permits two needs in one turn, which a single
 * nullable column never could.
 *
 * Signature-only columns are NULL on other channels. That sparseness is deliberate and
 * the right way round: signatures run about two per turn while other channels are
 * occasional, so the dominant case gets real columns and the minority carries NULLs,
 * which SQLite stores in about a bit each.
 *
 * @see ../../doc_md/plugin-layout.md
 */

import {
  CHANNELS, POSITIONS, DELTAS, TURNS, EFFORTS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES, STEMS,
} from './vocabulary.js';

/**
 * Bumped whenever the shape below changes in a way that needs a migration.
 *
 * Stored once in `meta`, not on every row: it changes only at upgrade, so per-row
 * storage would be pure duplication of a value that is identical everywhere.
 */
export const SCHEMA_VERSION = 1;

/**
 * A SQL `CHECK` clause constraining `column` to a vocabulary, allowing NULL.
 *
 * Generated from the TypeScript arrays rather than written out, so the database and the
 * tool schemas cannot drift apart — a drift that previously let 12% of rows accumulate
 * values outside their documented vocabulary.
 *
 * Terms are known to be lowercase ASCII (enforced by test), so no escaping is required.
 *
 * @example
 *   check('delta', DELTAS)
 *   // => "CHECK (delta IS NULL OR delta IN ('up','down','steady'))"
 */
export function check(column: string, vocabulary: readonly string[]): string {
  return `CHECK (${column} IS NULL OR ${column} IN (${vocabulary.map(v => `'${v}'`).join(',')}))`;
}

/** Every expression, of every kind, in one table. */
export const ENTRIES_DDL = `
CREATE TABLE IF NOT EXISTS entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT    NOT NULL UNIQUE,

  ts_utc          TEXT    NOT NULL,
  ts_local        TEXT    NOT NULL,
  tz              TEXT    NOT NULL,
  elapsed_ms      INTEGER,

  session         TEXT    NOT NULL,
  prompt_id       TEXT,
  turn_index      INTEGER,
  turn            TEXT ${check('turn', TURNS)},
  host            TEXT,
  host_version    TEXT,
  agent_id        TEXT,
  agent_type      TEXT,
  effort          TEXT ${check('effort', EFFORTS)},
  permission_mode TEXT,
  cwd             TEXT,
  project         TEXT,
  git_branch      TEXT,
  machine_id      TEXT,
  platform        TEXT,
  model           TEXT,

  channel         TEXT    NOT NULL ${check('channel', CHANNELS)},
  text            TEXT    NOT NULL,
  modality        TEXT ${check('modality', MODALITIES)},
  visible         INTEGER NOT NULL DEFAULT 1,
  nudged          INTEGER NOT NULL DEFAULT 0,
  interrupted     INTEGER NOT NULL DEFAULT 0,
  tool_calls      INTEGER,
  error_count     INTEGER,
  compactions     INTEGER,
  prompt_len      INTEGER,
  response_len    INTEGER,
  context_tokens  INTEGER,
  output_tokens   INTEGER,
  thinking_tokens INTEGER,
  corrects_id     INTEGER REFERENCES entries(id),

  position        TEXT ${check('position', POSITIONS)},
  delta           TEXT ${check('delta', DELTAS)},
  uncertain       INTEGER NOT NULL DEFAULT 0,
  face            TEXT,
  context_emoji   TEXT,
  stem            TEXT ${check('stem', STEMS)},
  cctype          TEXT,

  confidence      TEXT ${check('confidence', CONFIDENCE_GROUNDS)},
  divergence_kind TEXT ${check('divergence_kind', DIVERGENCE_KINDS)},

  series_key      TEXT,
  title           TEXT,
  succ            INTEGER,
  active          INTEGER,
  fail            INTEGER,
  percent         INTEGER,

  plugin_version  TEXT    NOT NULL,
  format_version  TEXT
)`;

/** System state. Not user-editable; changes at install and upgrade only. */
export const META_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_utc TEXT NOT NULL
)`;

/**
 * User choices. Overrides only — defaults live in code, so a database with zero rows
 * here is a valid and fully working state. Seeding defaults would mean a later change
 * to a default could never reach an existing install.
 */
export const CONFIG_DDL = `
CREATE TABLE IF NOT EXISTS config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_utc TEXT NOT NULL
)`;

/** Indices covering the queries the gates and the analyses actually run. */
export const INDEX_DDL: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_entries_prompt  ON entries(prompt_id)',
  'CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session, id)',
  'CREATE INDEX IF NOT EXISTS idx_entries_channel ON entries(channel, ts_utc)',
  'CREATE INDEX IF NOT EXISTS idx_entries_series  ON entries(series_key, id)',
];

/**
 * Every statement needed to bring an empty database to the current schema, in order.
 *
 * Each is idempotent, so running this against an already-initialised database is a
 * no-op rather than an error.
 *
 * @example
 *   for (const statement of ALL_DDL) { db.exec(statement); }
 */
export const ALL_DDL: readonly string[] = [
  ENTRIES_DDL,
  META_DDL,
  CONFIG_DDL,
  ...INDEX_DDL,
];
