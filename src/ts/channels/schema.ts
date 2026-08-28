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
 * The same shape carries **qualifiers**: typed silence (#42) and the five anchor
 * columns (#18) are nullable columns any channel may fill, not tables or channels of
 * their own. An anchored dissent is still a dissent, so it is still one row.
 *
 * @see ../../doc_md/plugin-layout.md
 */

import {
  CHANNELS, POSITIONS, DELTAS, TURNS, EFFORTS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES, STEMS,
  FORECAST_OUTCOMES, SILENCE_KINDS, AUDIENCES, ANCHOR_KINDS,
} from './vocabulary.js';

/**
 * Bumped whenever the shape below changes in a way that needs a migration.
 *
 * Stored once in `meta`, not on every row: it changes only at upgrade, so per-row
 * storage would be pure duplication of a value that is identical everywhere.
 *
 * v2 (issue #42): `CHANNELS` gained `load` and `taste`, `CONFIDENCE_GROUNDS` gained
 * `predicted`, `DIVERGENCE_KINDS` gained `faded`, and `entries` gained the nullable
 * `resolve_by`, `outcome`, and `silence` columns. Because the vocabularies are baked
 * into `CHECK` constraints, v1 databases require the table rebuild in `migrate.ts`.
 *
 * v3 (issue #41): the messagebox facility added the `messages` and `message_reads`
 * tables and their indices. Purely additive — no existing table changes shape and no
 * data moves — so the v2→v3 step only creates what is missing; the bump exists so the
 * recorded history says when the shape changed.
 *
 * v4 (issue #18): `entries` gained the five nullable anchor columns and
 * `idx_entries_anchor`. Additive in data terms, but `anchor_kind` carries a `CHECK`
 * over `ANCHOR_KINDS`, and SQLite cannot add a constraint in place — so the v3→v4 step
 * is another table rebuild, the same recipe v1→v2 used.
 *
 * @see ./migrate.js
 */
export const SCHEMA_VERSION = 4;

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

/**
 * The `entries` DDL, parameterized on the table name.
 *
 * Exists (beyond {@link ENTRIES_DDL}) for the migration's table rebuild: SQLite cannot
 * alter a `CHECK` constraint in place, so a version step creates `entries_v2` from
 * this same definition, copies the rows across, and renames. Generating both from one
 * function means the rebuilt table cannot drift from the fresh-install one.
 *
 * @param table the table name to create; defaults to `entries`
 * @returns a `CREATE TABLE IF NOT EXISTS` statement for the current schema
 *
 * @example
 *   entriesDdl()             // the canonical entries table
 *   entriesDdl('entries_v2') // the migration's rebuild target
 *
 * @see ./migrate.js
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- isolatedDeclarations requires the annotation
export function entriesDdl(table: string = 'entries'): string {
  return `
CREATE TABLE IF NOT EXISTS ${table} (
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
  resolve_by      TEXT,
  outcome         TEXT ${check('outcome', FORECAST_OUTCOMES)},
  silence         TEXT ${check('silence', SILENCE_KINDS)},

  anchor_kind     TEXT ${check('anchor_kind', ANCHOR_KINDS)},
  anchor_target   TEXT,
  anchor_span     TEXT,
  anchor_quote    TEXT,
  anchor_hash     TEXT,

  series_key      TEXT,
  title           TEXT,
  succ            INTEGER,
  active          INTEGER,
  fail            INTEGER,
  percent         INTEGER,

  plugin_version  TEXT    NOT NULL,
  format_version  TEXT
)`;
}

/**
 * Every expression, of every kind, in one table.
 *
 * The explicit annotation is required by `isolatedDeclarations` and is simultaneously
 * flagged by eslint's `no-inferrable-types`, which does not know about that constraint.
 * The compiler wins: without the annotation the build fails outright, whereas the lint
 * rule is a style preference.
 */
export const ENTRIES_DDL: string = entriesDdl();

/**
 * What the harness knows about the current turn, written by the hooks.
 *
 * This table is the join between two processes that otherwise cannot see each other.
 * A hook knows the session, the turn, the working directory and the effort level but
 * cannot write an expression; the MCP server can write expressions but knows none of
 * those things. Neither can be fixed alone — so the hook deposits what it knows here,
 * and the server reads it when recording.
 *
 * Rows accumulate rather than being replaced, so a turn's context survives for later
 * inspection and so concurrent sessions do not overwrite each other.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const TURN_CONTEXT_DDL: string = `
CREATE TABLE IF NOT EXISTS turn_context (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc          TEXT    NOT NULL,
  session         TEXT    NOT NULL,
  prompt_id       TEXT,
  turn_index      INTEGER,
  turn            TEXT,
  cwd             TEXT,
  git_branch      TEXT,
  permission_mode TEXT,
  agent_id        TEXT,
  agent_type      TEXT,
  effort          TEXT,
  compactions     INTEGER,
  prompt_len      INTEGER
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

/**
 * One messagebox message (issue #41): audience-tagged, sender-identified, optionally
 * boxed and expiring.
 *
 * Sender identity is observed the way `entries` observes it — adopted from
 * `turn_context` at write time, with absent context recorded as `no-hook` rather than
 * disguised. `expires_utc` excludes a message from delivery; it never deletes —
 * deletion belongs to `retention.days` and nothing else. Deliberately no `cwd`/path
 * columns at all: the strongest form of `privacy.store_cwd` compliance is having
 * nothing to redact.
 *
 * @see ./messages.js
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const MESSAGES_DDL: string = `
CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT    NOT NULL UNIQUE,

  ts_utc         TEXT    NOT NULL,
  ts_local       TEXT    NOT NULL,
  tz             TEXT    NOT NULL,

  session        TEXT    NOT NULL,
  prompt_id      TEXT,
  agent_id       TEXT,
  agent_type     TEXT,
  machine_id     TEXT    NOT NULL,

  audience       TEXT    NOT NULL ${check('audience', AUDIENCES)},
  box            TEXT,
  reply_to       INTEGER REFERENCES messages(id),
  text           TEXT    NOT NULL,
  expires_utc    TEXT,

  plugin_version TEXT    NOT NULL
)`;

/**
 * One delivery receipt: a particular reader collected a particular message at a
 * particular moment.
 *
 * Read-state is never a mutable flag on the message — receipts are append-only rows,
 * so "who read this, and when" stays a fact the record can answer, multiple readers
 * (sibling agents) each get their own receipt, and the storage keeps the house's
 * no-UPDATE ethos. **Unread** is a computed predicate: no receipt from this reader,
 * and not expired.
 *
 * @see ./messages.js
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const MESSAGE_READS_DDL: string = `
CREATE TABLE IF NOT EXISTS message_reads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id),
  ts_utc      TEXT    NOT NULL,
  reader      TEXT    NOT NULL ${check('reader', ['model', 'user'])},
  session     TEXT,
  agent_id    TEXT,
  prompt_id   TEXT
)`;

/** Indices covering the queries the gates and the analyses actually run. */
export const INDEX_DDL: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_entries_prompt  ON entries(prompt_id)',
  'CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session, id)',
  'CREATE INDEX IF NOT EXISTS idx_entries_channel ON entries(channel, ts_utc)',
  'CREATE INDEX IF NOT EXISTS idx_entries_series  ON entries(series_key, id)',
  // "every note ever attached to this file / this message / this series" is the one
  // question anchoring exists to answer, so it gets the one index anchoring adds (#18).
  'CREATE INDEX IF NOT EXISTS idx_entries_anchor  ON entries(anchor_kind, anchor_target)',
  'CREATE INDEX IF NOT EXISTS idx_context_session ON turn_context(session, id)',
];

/**
 * Indices for the messagebox tables, kept apart from {@link INDEX_DDL} so the v1→v2
 * migration step — which recreates the entries indices on a database where the
 * messagebox tables may not exist yet — never references a table outside its own
 * version's shape.
 *
 * @see ./migrate.js
 */
export const MESSAGE_INDEX_DDL: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_messages_audience ON messages(audience, session, id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_box      ON messages(box, id)',
  'CREATE INDEX IF NOT EXISTS idx_reads_message     ON message_reads(message_id)',
];

/**
 * Every `CREATE TABLE` the current schema needs, in order — and nothing else.
 *
 * Kept apart from the indices because the two have different safety on an *old*
 * database: `CREATE TABLE IF NOT EXISTS` on an existing table is a genuine no-op
 * whatever shape that table has, while `CREATE INDEX` over a column the old shape
 * lacks is an outright error. `openStore` therefore applies these before migrating and
 * {@link ALL_INDEX_DDL} after, so an index over a newly-migrated column is never
 * attempted against the pre-migration shape.
 *
 * @example
 *   for (const statement of TABLE_DDL) { db.exec(statement); }
 *
 * @see ./store.js openStore
 */
export const TABLE_DDL: readonly string[] = [
  ENTRIES_DDL,
  TURN_CONTEXT_DDL,
  META_DDL,
  CONFIG_DDL,
  MESSAGES_DDL,
  MESSAGE_READS_DDL,
];

/** Every index the current schema declares, entries and messagebox together. */
export const ALL_INDEX_DDL: readonly string[] = [...INDEX_DDL, ...MESSAGE_INDEX_DDL];

/**
 * Every statement needed to bring an **empty** database to the current schema, in
 * order: tables, then indices.
 *
 * Each is idempotent, so re-running it against a database already at this version is a
 * no-op. On a database at an *older* version, use {@link TABLE_DDL} and
 * {@link ALL_INDEX_DDL} around the migration instead — see the note on `TABLE_DDL`.
 *
 * @example
 *   for (const statement of ALL_DDL) { db.exec(statement); }
 */
export const ALL_DDL: readonly string[] = [...TABLE_DDL, ...ALL_INDEX_DDL];
