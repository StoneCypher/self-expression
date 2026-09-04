/**
 * Versioned schema migrations, run stepwise by `openStore`.
 *
 * The vocabularies are baked into the `entries` DDL as `CHECK` constraints, and SQLite
 * cannot alter a constraint in place — so any vocabulary growth forces the standard
 * SQLite table rebuild: create the new-shape table, copy the rows across with explicit
 * column lists on both sides, drop the old table, rename, recreate the indices.
 * Without this, a database created before a vocabulary grew keeps its old `CHECK`s
 * forever and silently rejects the new terms — passing on fresh installs and failing
 * on existing ones, the exact environment-dependent bug a migration step prevents.
 *
 * The rebuild is the expensive path, not the only one. A table that bakes no `CHECK`
 * clause can simply be widened: `turn_context` carries none, so the v6→v7 step is a
 * single `ALTER TABLE … ADD COLUMN`. Reach for the rebuild when a constraint has to
 * change, and for the `ALTER` when nothing but the column list does.
 *
 * The machinery is deliberately reusable rather than a one-off: each version step is a
 * `MigrationStep`, {@link migrate} walks whatever chain exists, and the rebuild recipe
 * itself is one shared function three steps already call. #41, #18, #43, and #16 all
 * added their steps to {@link MIGRATIONS} rather than new mechanisms; later schema work
 * does the same.
 *
 * @see ./schema.js
 * @see ./store.js
 */

import type { DatabaseSync } from 'node:sqlite';
import {
  entriesDdl, INDEX_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
  NOTES_DDL, NOTE_EVENTS_DDL, NOTE_INDEX_DDL,
  TURN_CONTEXT_SOURCE_COLUMN,
  PENDING_NOTICE_DDL,
} from './schema.js';

/**
 * The `entries` columns exactly as schema v1 declared them, in v1 order.
 *
 * The v1→v2 rebuild names these explicitly on both sides of its `INSERT … SELECT`, so
 * a column-order difference between the two table shapes can never silently shear
 * values into the wrong columns. Frozen history: this list must never change again,
 * because it describes databases that already exist.
 */
export const V1_ENTRY_COLUMNS: readonly string[] = [
  'id', 'uuid',
  'ts_utc', 'ts_local', 'tz', 'elapsed_ms',
  'session', 'prompt_id', 'turn_index', 'turn', 'host', 'host_version',
  'agent_id', 'agent_type', 'effort', 'permission_mode', 'cwd', 'project',
  'git_branch', 'machine_id', 'platform', 'model',
  'channel', 'text', 'modality', 'visible', 'nudged', 'interrupted',
  'tool_calls', 'error_count', 'compactions', 'prompt_len', 'response_len',
  'context_tokens', 'output_tokens', 'thinking_tokens', 'corrects_id',
  'position', 'delta', 'uncertain', 'face', 'context_emoji', 'stem', 'cctype',
  'confidence', 'divergence_kind',
  'series_key', 'title', 'succ', 'active', 'fail', 'percent',
  'plugin_version', 'format_version',
];

/**
 * The `entries` columns exactly as schema v3 declared them, in v3 order.
 *
 * v1's list plus the three #42 additions — v2→v3 was purely additive and touched no
 * `entries` column. Named explicitly on both sides of the v3→v4 rebuild's
 * `INSERT … SELECT`, for the same anti-shear reason as {@link V1_ENTRY_COLUMNS}, and
 * frozen for the same reason: it describes databases that already exist.
 */
export const V3_ENTRY_COLUMNS: readonly string[] = [
  ...V1_ENTRY_COLUMNS.slice(0, V1_ENTRY_COLUMNS.indexOf('series_key')),
  'resolve_by', 'outcome', 'silence',
  ...V1_ENTRY_COLUMNS.slice(V1_ENTRY_COLUMNS.indexOf('series_key')),
];

/**
 * The `entries` columns exactly as schema v5 declared them, in v5 order.
 *
 * v3's list plus the five #18 anchor columns — v4→v5 was purely additive and touched no
 * `entries` column, so the v4 and v5 shapes are identical. Named explicitly on both
 * sides of the v5→v6 rebuild's `INSERT … SELECT`, for the same anti-shear reason as
 * {@link V1_ENTRY_COLUMNS}, and frozen for the same reason: it describes databases that
 * already exist.
 */
export const V5_ENTRY_COLUMNS: readonly string[] = [
  ...V3_ENTRY_COLUMNS.slice(0, V3_ENTRY_COLUMNS.indexOf('series_key')),
  'anchor_kind', 'anchor_target', 'anchor_span', 'anchor_quote', 'anchor_hash',
  ...V3_ENTRY_COLUMNS.slice(V3_ENTRY_COLUMNS.indexOf('series_key')),
];

/** One version step: how to carry a database from `from` to `to`. */
export interface MigrationStep {
  /** The stored schema version this step starts from. */
  readonly from  : number;
  /** The schema version the database is at once `apply` completes. */
  readonly to    : number;
  /** Perform the step. Must be transactional: all-or-nothing on error. */
  readonly apply : (db: DatabaseSync) => void;
}

/**
 * The SQLite table-rebuild recipe, shared by every step that has to widen a baked
 * `CHECK`: build the new-shape table under a scratch name, copy the old shape's columns
 * across by explicit name on both sides, drop, rename, recreate the indices the drop
 * took with it.
 *
 * Foreign-key enforcement is switched off around the transaction — the standard SQLite
 * recipe, and required here because `corrects_id` self-references `entries`: with
 * enforcement on, dropping the old table trips the copied rows' references. `PRAGMA
 * foreign_key_check` runs before commit so a genuinely broken chain still fails loudly,
 * and enforcement is restored on every exit path.
 *
 * Extracted rather than repeated because it is now run by two steps and will be run by
 * every future vocabulary growth: one recipe means the second rebuild cannot quietly
 * differ from the first.
 *
 * @param db      the database being migrated
 * @param scratch the temporary table name to build into; must not already exist
 * @param columns the *old* shape's columns, in the old shape's order — new columns are
 *                simply absent from both sides of the copy and arrive NULL
 *
 * @example
 *   rebuildEntries(db, 'entries_v2', V1_ENTRY_COLUMNS);
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so a
 *                 failed migration leaves the database exactly as it was.
 */
function rebuildEntries(db: DatabaseSync, scratch: string, columns: readonly string[]): void {

  const named = columns.join(', ');

  db.exec('PRAGMA foreign_keys = OFF');   // a no-op inside a transaction, so set before BEGIN
  db.exec('BEGIN');
  try {
    db.exec(entriesDdl(scratch));
    db.exec(`INSERT INTO ${scratch} (${named}) SELECT ${named} FROM entries`);
    db.exec('DROP TABLE entries');
    db.exec(`ALTER TABLE ${scratch} RENAME TO entries`);
    for (const statement of INDEX_DDL) { db.exec(statement); }
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length > 0) {
      throw new Error(`migration would leave ${String(broken.length)} broken foreign-key reference(s)`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }

}

/**
 * The v1→v2 step: rebuild `entries` so the widened `CHECK`s and the new nullable
 * `resolve_by`, `outcome`, and `silence` columns exist (#42).
 *
 * Every v1 column is copied, `id` included, so the `corrects_id` chain stays valid; the
 * new columns arrive NULL.
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so
 *                 a failed migration leaves the v1 database exactly as it was.
 *
 * @see rebuildEntries
 */
function migrateV1toV2(db: DatabaseSync): void {
  rebuildEntries(db, 'entries_v2', V1_ENTRY_COLUMNS);
}

/**
 * The v2→v3 step: create the messagebox tables and their indices (#41).
 *
 * Purely additive — no existing table changes shape and no rows move — so the step is
 * simply the new DDL, wrapped in one transaction for the all-or-nothing contract every
 * `MigrationStep` promises. Each statement is `IF NOT EXISTS`-idempotent, which also
 * makes this safe when `openStore` has already applied `ALL_DDL` before walking the
 * chain (its normal order of operations).
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so
 *                 a failed step leaves the v2 database exactly as it was.
 */
function migrateV2toV3(db: DatabaseSync): void {

  db.exec('BEGIN');
  try {
    db.exec(MESSAGES_DDL);
    db.exec(MESSAGE_READS_DDL);
    for (const statement of MESSAGE_INDEX_DDL) { db.exec(statement); }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

}

/**
 * The v3→v4 step: rebuild `entries` so the five nullable anchor columns and the
 * `anchor_kind` `CHECK` exist (#18).
 *
 * Additive in data terms — every v3 row keeps every v3 value and the anchor columns
 * arrive NULL, which is exactly "not anchored" — but the new `CHECK` cannot be added in
 * place, so this is a rebuild rather than five `ALTER TABLE`s. `idx_entries_anchor`
 * comes back with the rest of {@link INDEX_DDL} inside the rebuild.
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so a
 *                 failed step leaves the v3 database exactly as it was.
 *
 * @see rebuildEntries
 */
function migrateV3toV4(db: DatabaseSync): void {
  rebuildEntries(db, 'entries_v4', V3_ENTRY_COLUMNS);
}

/**
 * The v4→v5 step: create the held-note tables and their indices (#43).
 *
 * Purely additive, exactly like v2→v3, and for a reason worth stating: a note is a
 * *sidecar* on an existing `messages` row rather than a rival store, so nothing about
 * `messages`, `message_reads`, or `entries` changes shape and no row moves. A v4
 * database that never enables the mailbox is byte-identical afterward apart from two
 * empty tables.
 *
 * Each statement is `IF NOT EXISTS`-idempotent, which also makes this safe when
 * `openStore` has already applied `TABLE_DDL` before walking the chain — its normal
 * order of operations.
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so a
 *                 failed step leaves the v4 database exactly as it was.
 */
function migrateV4toV5(db: DatabaseSync): void {

  db.exec('BEGIN');
  try {
    db.exec(NOTES_DDL);
    db.exec(NOTE_EVENTS_DDL);
    for (const statement of NOTE_INDEX_DDL) { db.exec(statement); }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

}

/**
 * The v5→v6 step: rebuild `entries` so the nullable `corrects_kind` and `verbatim`
 * columns and the `corrects_kind` `CHECK` exist (#16).
 *
 * Additive in data terms — every v5 row keeps every v5 value, and the two new columns
 * arrive NULL, which reads as "an unstated link kind" and "no quote". That NULL is not a
 * hole: the legacy read rule gives a pre-existing `corrects_id` link the meaning its
 * column description promised since v1 (`retracts`, or `resolves` when the row carries an
 * `outcome`), so an old database's retraction register is correct the moment it opens
 * rather than after a backfill. **Nothing is ever written onto an old row to make that
 * true** — see {@link ../channels/entries.js effectiveCorrectionKind}.
 *
 * A rebuild rather than two `ALTER TABLE`s because the new `CHECK` cannot be added in
 * place. `idx_entries_corrects` comes back with the rest of {@link INDEX_DDL} inside the
 * rebuild.
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so a
 *                 failed step leaves the v5 database exactly as it was.
 *
 * @see rebuildEntries
 */
function migrateV5toV6(db: DatabaseSync): void {
  rebuildEntries(db, 'entries_v6', V5_ENTRY_COLUMNS);
}

/**
 * Whether `table` already has a column named `column`.
 *
 * The `ADD COLUMN` half of the idempotence every other step gets free from
 * `IF NOT EXISTS`: SQLite has no `ADD COLUMN IF NOT EXISTS`, and a second `ALTER` for a
 * column that is already there is an outright error rather than a no-op. Asking first
 * keeps a re-run of a step — or a step reached on a database some other path already
 * widened — as harmless as re-running `CREATE TABLE IF NOT EXISTS`.
 *
 * @param table  the table to inspect
 * @param column the column name to look for, compared exactly
 *
 * @example
 *   hasColumn(db, 'turn_context', 'source')   // => false on a v6 database
 *
 * @see migrateV6toV7
 */
export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some(row => String(row['name']) === column);
}

/**
 * The v6→v7 step: give `turn_context` its nullable `source` column, so a reader can tell
 * a hook-observed row from one a hookless host's model volunteered through `begin_turn`.
 *
 * The first step in this chain that is **not** a table rebuild, and the reason is worth
 * stating: every earlier widening touched `entries`, whose vocabularies are baked into
 * `CHECK` constraints SQLite cannot alter in place. `turn_context` has never carried a
 * `CHECK` — not even on `turn`, which is a closed vocabulary everywhere else — so adding
 * a column to it is exactly the one-statement operation SQLite does support.
 *
 * Existing rows keep NULL. That is not a hole to backfill: before this version there was
 * only one writer, so NULL means "the hook, from a version that had no other path", and
 * writing `'hook'` onto rows nobody observed writing it onto would be manufacturing
 * evidence in a table whose entire purpose is to hold observations.
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so a
 *                 failed step leaves the v6 database exactly as it was.
 *
 * @see hasColumn
 * @see ./schema.js TURN_CONTEXT_DDL
 */
function migrateV6toV7(db: DatabaseSync): void {

  if (hasColumn(db, 'turn_context', TURN_CONTEXT_SOURCE_COLUMN)) { return; }

  db.exec('BEGIN');
  try {
    db.exec(`ALTER TABLE turn_context ADD COLUMN ${TURN_CONTEXT_SOURCE_COLUMN} TEXT`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

}

/**
 * The v7→v8 step: create the `pending_notice` table and its `session` primary key
 * (issue #98).
 *
 * Purely additive, exactly like v2→v3 and v4→v5: nothing about `entries`,
 * `turn_context`, the messagebox, or the held-note tables changes shape, and no row
 * moves. `pending_notice` holds one row per session — the fingerprint of the last
 * pending-state notice that session was told about — so a v7 database that never uses
 * the feature is byte-identical afterward apart from one empty table.
 *
 * `CREATE TABLE IF NOT EXISTS` makes the statement idempotent, which also makes this
 * safe when `openStore` has already applied `TABLE_DDL` before walking the chain — its
 * normal order of operations.
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so a
 *                 failed step leaves the v7 database exactly as it was.
 *
 * @example
 *   migrateV7toV8(db);   // db is now a v8 database; call site still stamps the version
 *
 * @see ./schema.js PENDING_NOTICE_DDL
 */
export function migrateV7toV8(db: DatabaseSync): void {

  db.exec('BEGIN');
  try {
    db.exec(PENDING_NOTICE_DDL);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

}

/**
 * Every known version step, ascending. `migrate` walks these; later schema changes
 * append their own step here rather than inventing new machinery.
 */
export const MIGRATIONS: readonly MigrationStep[] = [
  { from: 1, to: 2, apply: migrateV1toV2 },
  { from: 2, to: 3, apply: migrateV2toV3 },
  { from: 3, to: 4, apply: migrateV3toV4 },
  { from: 4, to: 5, apply: migrateV4toV5 },
  { from: 5, to: 6, apply: migrateV5toV6 },
  { from: 6, to: 7, apply: migrateV6toV7 },
  { from: 7, to: 8, apply: migrateV7toV8 },
];

/**
 * Carry a database from schema version `from` to `to`, one step at a time.
 *
 * Stepwise on purpose: a v1 database opened by v4 code runs 1→2, 2→3, 3→4 in order,
 * so each step only ever reasons about adjacent shapes. Requesting a walk with a
 * missing step is an error, never a silent skip — a half-migrated database is worse
 * than a loud failure.
 *
 * @param from the schema version the database is currently at
 * @param to   the schema version to reach; `from === to` is a no-op
 *
 * @example
 *   migrate(db, 1, SCHEMA_VERSION);   // a v1 database, brought current
 *
 * @throws {Error} If no registered step leads onward from some intermediate version.
 *
 * @see MIGRATIONS
 */
export function migrate(db: DatabaseSync, from: number, to: number): void {

  let at = from;

  while (at < to) {
    const step = MIGRATIONS.find(m => m.from === at);
    if (step === undefined) {
      throw new Error(`no migration step from schema version ${String(at)} toward ${String(to)}`);
    }
    step.apply(db);
    at = step.to;
  }

}
