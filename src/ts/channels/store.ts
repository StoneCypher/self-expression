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
import { ALL_DDL, SCHEMA_VERSION } from './schema.js';
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
  return row ? String(row.value) : null;
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
  return row ? String(row.value) : null;
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
    out[String(row.key)] = String(row.value);
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
 * @param path - database file to open; defaults to the resolved data directory
 *
 * @example
 *   const store = openStore('/tmp/x/log.sqlite3');
 *   readMeta(store, 'schema_version');  // => '1'
 *   closeStore(store);
 *
 * @throws {Error} If the directory cannot be created or the file cannot be opened.
 */
export function openStore(path: string = dbPath()): Store {

  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  for (const statement of ALL_DDL) { db.exec(statement); }

  const partial: Store = { db, machineId: '', path };

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
 * @example
 *   closeStore(store);
 */
export function closeStore(store: Store): void {
  try { store.db.close(); } catch { /* already closed */ }
}
