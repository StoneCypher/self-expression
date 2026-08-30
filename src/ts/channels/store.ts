/**
 * Database lifecycle, system state, and user configuration.
 *
 * Opening a store creates the data directory and applies the schema if needed, so a
 * first run on a clean machine is indistinguishable from a later one. Two key/value
 * tables sit beside the entries: `meta` for system state that changes only at install
 * and upgrade, and `config` for user choices.
 *
 * They are separate on purpose. A user who corrupts a setting must not be able to take
 * `schema_version` with it, and a reset-my-config operation must not have to tiptoe
 * around rows it may not touch.
 *
 * @see ./schema.js
 */

import { DatabaseSync }   from 'node:sqlite';
import { mkdirSync }      from 'node:fs';
import { dirname }        from 'node:path';
import { randomUUID }     from 'node:crypto';
import { platform }       from 'node:process';
import { TABLE_DDL, ALL_INDEX_DDL, SCHEMA_VERSION } from './schema.js';
import { migrate }        from './migrate.js';
import { dbPath }         from './paths.js';
import { stamp }          from './time.js';

/** An open database plus the facts established when it was opened. */
export interface Store {
  readonly db        : DatabaseSync;
  /** Stable per-installation identifier, minted on first open. */
  readonly machineId : string;
  /** Absolute path to the database file. */
  readonly path      : string;
}

/** Config values are stored as text; these are the shapes callers may ask for. */
export type ConfigValue = string | number | boolean;

/**
 * Read one `meta` value, or `null` when absent.
 *
 * @example
 *   readMeta(store, 'schema_version')  // => '1'
 *   readMeta(store, 'nonesuch')        // => null
 */
export function readMeta(store: Store, key: string): string | null {
  const row = store.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? String(row['value']) : null;
}

/**
 * Write one `meta` value, replacing any existing entry for the key.
 *
 * @example
 *   writeMeta(store, 'schema_version', '2');
 */
export function writeMeta(store: Store, key: string, value: string): void {
  store.db.prepare(
    'INSERT INTO meta (key, value, updated_utc) VALUES (?,?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_utc = excluded.updated_utc'
  ).run(key, value, stamp().utc);
}

/**
 * Read one config override, or `null` when the user has not set it.
 *
 * A `null` here means "no override" and the caller should use its own default —
 * defaults deliberately live in code rather than as seeded rows, so that changing a
 * default later actually reaches existing installations.
 *
 * @example
 *   readConfig(store, 'gate.signature') ?? true   // default lives at the call site
 */
export function readConfig(store: Store, key: string): string | null {
  const row = store.db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? String(row['value']) : null;
}

/**
 * Set one config override.
 *
 * Values are stored as text regardless of the shape supplied, so booleans round-trip
 * as `'true'` / `'false'` and numbers as their decimal form.
 *
 * @example
 *   writeConfig(store, 'retention.days', 90);
 *   writeConfig(store, 'gate.checklist', false);
 */
export function writeConfig(store: Store, key: string, value: ConfigValue): void {
  store.db.prepare(
    'INSERT INTO config (key, value, updated_utc) VALUES (?,?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_utc = excluded.updated_utc'
  ).run(key, String(value), stamp().utc);
}

/**
 * Delete one config override, so the code default applies again — including a future
 * changed default.
 *
 * Without this, a user who once set a value could never return to tracking the
 * default; they could only pin the current one by hand (issue #30, D4). Deleting a key
 * with no override is a successful no-op, and deleting an unknown key removes any row
 * present — it may have been written by a newer version the user is walking back.
 *
 * @returns whether an override row was actually removed
 *
 * @example
 *   writeConfig(store, 'retention.days', 90);
 *   deleteConfig(store, 'retention.days')  // => true; the code default applies again
 *   deleteConfig(store, 'retention.days')  // => false; nothing left to remove
 */
export function deleteConfig(store: Store, key: string): boolean {
  const result = store.db.prepare('DELETE FROM config WHERE key = ?').run(key);
  return Number(result.changes) > 0;
}

/**
 * Every config override currently set, as a plain object.
 *
 * Unknown keys are returned rather than filtered. A newer version of the plugin may
 * have written a key this version does not recognise, and silently dropping it would
 * destroy that setting the next time config was rewritten.
 *
 * @example
 *   allConfig(store)  // => { 'retention.days': '90' }
 */
export function allConfig(store: Store): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of store.db.prepare('SELECT key, value FROM config').all()) {
    out[String(row['key'])] = String(row['value']);
  }
  return out;
}

/**
 * Open (creating if necessary) the log database, apply the schema, and establish
 * system state.
 *
 * The data directory is created if missing, so a first run needs no setup step. Schema
 * statements are idempotent, so reopening an existing database is a no-op. `machine_id`
 * is minted on first open and persisted; it deliberately does not survive a reinstall,
 * because a reinstall is a genuine discontinuity and the data should say so rather than
 * implying a continuity that did not exist.
 *
 * The version handling is ordered deliberately: apply the **table** DDL (a no-op on
 * existing tables), **read** the stored `schema_version`, run {@link migrate} when the
 * database is behind, apply the **index** DDL, and only *then* stamp the current
 * version. The previous implementation stamped unconditionally before reading — which
 * would have marked a v1 database as current without migrating it, the moment a v2
 * existed. Indices sit after the migration for a related reason: an index over a column
 * a later version added cannot be created against the older table shape, so applying
 * them first would turn every upgrade into a hard failure. A stored version *newer*
 * than this code's is an error, never a downgrade-in-place: the newer schema may hold
 * columns and vocabulary this code would silently mangle.
 *
 * @param path - database file to open; defaults to the resolved data directory
 *
 * @example
 *   const store = openStore('/tmp/x/log.sqlite3');
 *   readMeta(store, 'schema_version');  // => '2'
 *   closeStore(store);
 *
 * @throws {Error} If the directory cannot be created, the file cannot be opened, the
 *                 stored schema version is newer than this code's, or a migration
 *                 step fails (the failed step rolls back, leaving the file untouched).
 */
export function openStore(path: string = dbPath()): Store {

  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);

  /* Connection setup, before any DDL — `journal_mode` cannot change inside a transaction.
     Two of these are durability decisions; the rest are defaults SQLite leaves off for
     backwards compatibility with 2004. Each is one line, and each was measured or checked
     rather than copied from a listicle.

     **journal_mode=WAL + synchronous=NORMAL** — the reason any of this was found. The
     defaults make every write its own rollback-journal transaction: create a journal,
     fsync, write, fsync, delete it. Measured against this very store: **172 writes/sec**,
     against **11,236** with these two set. Sixty-five times. It stayed invisible because
     the server writes a handful of rows per turn; a property test doing thousands of them
     is what finally turned a constant factor into a number on the screen. What NORMAL
     gives up, precisely: under WAL a committed transaction still survives a process
     crash, and only an OS crash or power loss can lose the most recent commits.

     WAL is persisted in the file header; everything below is **per-connection** and must
     be set on every open, which is why these live here and not in a migration.

     **busy_timeout** — the correctness one, and the one this project most needed. Several
     sessions share one store. Without a timeout a second writer gets SQLITE_BUSY
     *immediately* and the write is simply lost; with it, SQLite waits and retries. WAL
     stops readers blocking the writer and does nothing whatsoever for two writers.

     **foreign_keys** — OFF by default, permanently, for backwards compatibility. This
     schema declares five references (`entries.corrects_id`, `messages.reply_to`,
     `message_reads.message_id`, `notes.message_id`, `note_events.note_id`) and every one
     of them has been decorative until now. This lands before the plugin has ever been
     installed anywhere, so there is no database in existence that could hold a row
     violating a constraint nobody was enforcing — the constraints simply start their life
     enforced, which is the only cheap moment to do this. Retrofitting it later would have
     meant a `PRAGMA foreign_key_check` sweep and a decision about whatever it found.

     `cache_size` is negative to mean kibibytes rather than pages, so it cannot silently
     change meaning if `page_size` ever does. `temp_store` keeps sorts and temporary
     tables off disk. `mmap_size` lets reads come from the page cache without a syscall
     per page. `analysis_limit` bounds the work `PRAGMA optimize` does at close (see
     {@link closeStore}), so keeping planner statistics fresh cannot itself become a stall.

     One caveat worth knowing rather than discovering: WAL writes `-wal` and `-shm`
     sidecar files beside the database and does not work on a network filesystem, so a
     `SELF_EXPRESSION_HOME` pointed at a share would need this reconsidered. */
  db.exec('PRAGMA journal_mode   = WAL');
  db.exec('PRAGMA synchronous    = NORMAL');
  db.exec('PRAGMA busy_timeout   = 5000');
  db.exec('PRAGMA foreign_keys   = ON');
  db.exec('PRAGMA cache_size     = -32000');
  db.exec('PRAGMA temp_store     = MEMORY');
  db.exec('PRAGMA mmap_size      = 268435456');
  db.exec('PRAGMA analysis_limit = 400');

  for (const statement of TABLE_DDL) { db.exec(statement); }

  const partial: Store = { db, machineId: '', path };

  const storedRaw = readMeta(partial, 'schema_version'),
        stored    = storedRaw === null ? null : Number(storedRaw);

  if (stored !== null && !Number.isInteger(stored)) {
    db.close();
    throw new Error(`stored schema_version '${storedRaw ?? ''}' is not an integer; refusing to guess`);
  }

  if (stored !== null && stored > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `database schema is version ${String(stored)}, newer than this code's ` +
      `${String(SCHEMA_VERSION)} — refusing to downgrade in place; upgrade the plugin instead`);
  }

  if (stored !== null && stored < SCHEMA_VERSION) {
    migrate(db, stored, SCHEMA_VERSION);
  }

  // Indices come after the migration, never before: an index over a column a later
  // version added (`idx_entries_anchor`, #18) is an outright error against the old
  // table shape, whereas `CREATE TABLE IF NOT EXISTS` on an old table is a real no-op.
  for (const statement of ALL_INDEX_DDL) { db.exec(statement); }

  if (readMeta(partial, 'created_utc') === null) {
    writeMeta(partial, 'created_utc', stamp().utc);
  }

  writeMeta(partial, 'schema_version', String(SCHEMA_VERSION));
  writeMeta(partial, 'platform',       platform);

  const existing  = readMeta(partial, 'machine_id'),
        machineId = existing ?? randomUUID();

  if (existing === null) { writeMeta(partial, 'machine_id', machineId); }

  return { db, machineId, path };

}

/**
 * Close the database. Safe to call on an already-closed store.
 *
 * Runs `PRAGMA optimize` first, which is SQLite's recommended close-time call: it updates
 * the query planner's statistics for tables whose shape has changed enough to matter, and
 * does nothing at all when nothing has. Without it the planner keeps choosing indexes
 * against the row counts it saw when the statistics were last written, which on a log that
 * only ever grows is exactly the number that ages worst. `analysis_limit` is set at open
 * to bound how much it may read, so this cannot turn closing into a stall.
 *
 * Its own `try` because a store closed twice must stay harmless, and a failure to update
 * statistics must never be the thing that stops a database being closed.
 *
 * @example
 *   closeStore(store);
 */
export function closeStore(store: Store): void {
  try { store.db.exec('PRAGMA optimize'); } catch { /* statistics are a nicety, not a duty */ }
  try { store.db.close(); } catch { /* already closed */ }
}
