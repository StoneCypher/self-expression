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
 * The machinery is deliberately reusable rather than a one-off: each version step is a
 * `MigrationStep`, and {@link migrate} walks whatever chain exists. Later schema work
 * (#41, #16, #18) adds steps to {@link MIGRATIONS} rather than new mechanisms.
 *
 * @see ./schema.js
 * @see ./store.js
 */

import type { DatabaseSync } from 'node:sqlite';
import {
  entriesDdl, INDEX_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
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
 * The v1→v2 step: rebuild `entries` so the widened `CHECK`s and the new nullable
 * `resolve_by`, `outcome`, and `silence` columns exist (#42).
 *
 * One transaction: build `entries_v2` from the current DDL, copy every v1 column
 * (including `id`, so the `corrects_id` chain stays valid; the new columns default
 * NULL), drop the old table, rename, recreate the indices the drop took with it.
 *
 * Foreign-key enforcement is switched off around the transaction — the standard
 * SQLite rebuild recipe, and required here because `corrects_id` self-references
 * `entries`: with enforcement on, dropping the old table trips the copied rows'
 * references. `PRAGMA foreign_key_check` runs before commit so a genuinely broken
 * chain still fails loudly, and enforcement is restored on every exit path.
 *
 * @throws {Error} Rethrows any SQLite failure after rolling the transaction back, so
 *                 a failed migration leaves the v1 database exactly as it was.
 */
function migrateV1toV2(db: DatabaseSync): void {

  const columns = V1_ENTRY_COLUMNS.join(', ');

  db.exec('PRAGMA foreign_keys = OFF');   // a no-op inside a transaction, so set before BEGIN
  db.exec('BEGIN');
  try {
    db.exec(entriesDdl('entries_v2'));
    db.exec(`INSERT INTO entries_v2 (${columns}) SELECT ${columns} FROM entries`);
    db.exec('DROP TABLE entries');
    db.exec('ALTER TABLE entries_v2 RENAME TO entries');
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
 * Every known version step, ascending. `migrate` walks these; later schema changes
 * append their own step here rather than inventing new machinery.
 */
export const MIGRATIONS: readonly MigrationStep[] = [
  { from: 1, to: 2, apply: migrateV1toV2 },
  { from: 2, to: 3, apply: migrateV2toV3 },
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
