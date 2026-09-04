/**
 * Dwelling lifecycle: open, create, adopt, and refuse.
 *
 * Four paths out of `openDwelling`:
 *
 * 1. **Create** — no file (or an empty one): apply the schema and seed house identity
 *    plus the shipped house rules.
 * 2. **Open** — a plugin-created dwelling at the current schema version: open and
 *    touch nothing.
 * 3. **Adopt / upgrade** — a pre-plugin prototype (dwelling tables, no
 *    `meta.schema_version`) or an older plugin schema: copy the file to a
 *    `pre-adopt-<date>` backup in the same directory *before touching anything*, then
 *    apply an additive-only migration. No column is dropped, renamed, or retyped; no
 *    row content is modified; existing `meta.house_rules` is left exactly as found.
 * 4. **Refuse / read-only** — a database this code does not recognise is refused with
 *    a message, never "fixed"; a *newer* `schema_version` opens read-only rather than
 *    writing with stale assumptions.
 *
 * @see ./schema.js
 * @see ./ops.js
 */

import { DatabaseSync }                       from 'node:sqlite';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { randomUUID }                         from 'node:crypto';
import {
  ALL_DWELLING_DDL, DWELLING_SCHEMA_VERSION, HOUSE_RULES_SEED,
  KEPT_ADDABLE_COLUMNS, UUID_INDEX_DDL,
} from './schema.js';
import { stamp } from '../channels/time.js';

/** An open dwelling plus the facts established when it was opened. */
export interface DwellingStore {
  readonly db            : DatabaseSync;
  /** Absolute path to the dwelling database file. */
  readonly path          : string;
  /** True when a newer schema version forced a read-only open. */
  readonly readOnly      : boolean;
  /** Path of the backup written before adoption or upgrade, or `null` when none ran. */
  readonly adoptedBackup : string | null;
}

/** Table names present in an open database. Throws if the file is not SQLite. */
function tableNames(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  return new Set(rows.map(row => String(row['name'])));
}

/** Column names of one table, via PRAGMA table_info. */
function columnNames(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map(row => String(row['name'])));
}

/**
 * Base columns each dwelling table must already carry before its file may be
 * adopted — every column in that table's `./schema.js` DDL, *minus* whatever
 * {@link migrateAdditively} is documented to add for it (mirroring
 * `KEPT_ADDABLE_COLUMNS` for `kept`: `uuid` for `guestbook` and `link`,
 * `updated_utc` for `meta`). `tag` and `kept_tag` have no addable columns, since
 * `migrateAdditively` only ever `CREATE TABLE IF NOT EXISTS`s them — a no-op against
 * a same-named table of the wrong shape, so their full DDL shape is required.
 *
 * Hand-maintained rather than parsed from the DDL strings, the same tradeoff
 * `KEPT_ADDABLE_COLUMNS` already makes: a table gaining a genuinely new required
 * column here needs a matching update, or adoption under-validates rather than
 * over-validates.
 */
const REQUIRED_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  kept      : ['id', 'added_utc', 'kind', 'title', 'body'],
  guestbook : ['id', 'ts_utc', 'author', 'text'],
  tag       : ['id', 'name'],
  kept_tag  : ['kept_id', 'tag_id'],
  link      : ['id', 'from_kind', 'from_id', 'to_kind', 'to_id', 'edge', 'added_utc'],
  meta      : ['key', 'value'],
};

/** One schema-owned table present in the file but missing required columns. */
interface ShapeMismatch {
  readonly table   : string;
  readonly missing : readonly string[];
}

/**
 * Every schema-owned table that exists in `db` but is missing one or more of its
 * required base columns — the check deciding whether a pre-existing file may be
 * adopted at all.
 *
 * A table absent entirely is not a mismatch: `migrateAdditively` creates it fresh,
 * with the correct shape, so there is nothing to refuse. A table *present* under the
 * right name but the wrong shape (a prototype's `guestbook` carrying `id, ts, who,
 * note` instead of `id, ts_utc, author, text`, say) is refused before anything is
 * written — the additive migration would otherwise leave it exactly as wrong as it
 * found it, since `ALTER TABLE ADD COLUMN` only adds what is missing and `CREATE
 * TABLE IF NOT EXISTS` is a no-op against an existing table.
 *
 * @param tables the table names present in `db`, from {@link tableNames}
 *
 * @example
 *   shapeMismatches(db, tables)  // => [] on a clean prototype
 *   shapeMismatches(db, tables)
 *   // => [{ table: 'guestbook', missing: ['ts_utc', 'author', 'text'] }]
 */
function shapeMismatches(db: DatabaseSync, tables: ReadonlySet<string>): ShapeMismatch[] {

  const problems: ShapeMismatch[] = [];

  for (const [table, required] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
    if (!tables.has(table)) { continue; }
    const present = columnNames(db, table),
          missing = required.filter(name => !present.has(name));
    if (missing.length > 0) { problems.push({ table, missing }); }
  }

  return problems;

}

/** One clause per mismatched table, for the refusal message. */
function describeMismatches(problems: readonly ShapeMismatch[]): string {
  return problems
    .map(p => `'${p.table}' lacks required column${p.missing.length === 1 ? '' : 's'} ` +
      p.missing.map(c => `'${c}'`).join(', '))
    .join('; ');
}

/**
 * Read one dwelling `meta` value, or `null` when absent (including when the `meta`
 * table itself is absent, which is how a young prototype presents).
 *
 * @example
 *   readDwellingMeta(db, 'schema_version')  // => '1'
 */
export function readDwellingMeta(db: DatabaseSync, key: string): string | null {
  if (!tableNames(db).has('meta')) { return null; }
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? String(row['value']) : null;
}

/**
 * Write one dwelling `meta` value, replacing any existing entry for the key.
 *
 * @example
 *   writeDwellingMeta(db, 'schema_version', '1');
 */
export function writeDwellingMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value, updated_utc) VALUES (?,?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_utc = excluded.updated_utc'
  ).run(key, value, stamp().utc);
}

/**
 * A backup filename beside `path` that does not already exist:
 * `dwelling.sqlite3.pre-adopt-<yyyy-mm-dd>`, with `-2`, `-3`, ... appended on
 * collision so a same-day re-adoption cannot overwrite the first backup.
 */
function freshBackupPath(path: string): string {

  const date = stamp().utc.slice(0, 10),
        base = `${path}.pre-adopt-${date}`;

  if (!existsSync(base)) { return base; }

  for (let counter = 2; ; counter++) {
    const candidate = `${base}-${String(counter)}`;
    if (!existsSync(candidate)) { return candidate; }
  }

}

/** Backfill fresh UUIDs into rows whose `uuid` is NULL, without touching content. */
function backfillUuids(db: DatabaseSync, table: string): void {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE uuid IS NULL`).all();
  const set  = db.prepare(`UPDATE ${table} SET uuid = ? WHERE id = ?`);
  for (const row of rows) { set.run(randomUUID(), Number(row['id'])); }
}

/**
 * Additive-only migration: create any missing table, add any missing column, backfill
 * `uuid`s, and enforce uuid uniqueness by index. Prototype rows never crossed
 * machines, so fresh identity is sound. Nothing is dropped, renamed, retyped, or
 * content-modified.
 */
function migrateAdditively(db: DatabaseSync): void {

  for (const statement of ALL_DWELLING_DDL) { db.exec(statement); }

  // A young prototype's meta table may predate the updated_utc column the seeding
  // writes; added nullable because ADD COLUMN cannot introduce NOT NULL without a
  // constant default, and rewriting the table would violate additive-only.
  if (!columnNames(db, 'meta').has('updated_utc')) {
    db.exec('ALTER TABLE meta ADD COLUMN updated_utc TEXT');
  }

  const kept = columnNames(db, 'kept');
  for (const [name, fragment] of Object.entries(KEPT_ADDABLE_COLUMNS)) {
    if (!kept.has(name)) { db.exec(`ALTER TABLE kept ADD COLUMN ${fragment}`); }
  }

  if (!columnNames(db, 'guestbook').has('uuid')) { db.exec('ALTER TABLE guestbook ADD COLUMN uuid TEXT'); }
  if (!columnNames(db, 'link').has('uuid'))      { db.exec('ALTER TABLE link ADD COLUMN uuid TEXT'); }

  backfillUuids(db, 'kept');
  backfillUuids(db, 'guestbook');
  backfillUuids(db, 'link');

  for (const statement of UUID_INDEX_DDL) { db.exec(statement); }

}

/**
 * Seed house identity into `meta` without disturbing anything already there.
 *
 * `created_utc` is backdated to the earliest keep when adopting, because the house is
 * as old as its oldest keep, not as old as its adoption. `house_rules` is seeded only
 * when absent — an upgrade must never repaint someone's walls.
 */
function seedIdentity(db: DatabaseSync): void {

  writeDwellingMeta(db, 'schema_version', String(DWELLING_SCHEMA_VERSION));

  if (readDwellingMeta(db, 'dwelling_uuid') === null) {
    writeDwellingMeta(db, 'dwelling_uuid', randomUUID());
  }

  if (readDwellingMeta(db, 'created_utc') === null) {
    const oldest = db.prepare('SELECT MIN(added_utc) AS earliest FROM kept').get(),
          value  = oldest && typeof oldest['earliest'] === 'string' ? oldest['earliest'] : stamp().utc;
    writeDwellingMeta(db, 'created_utc', value);
  }

  if (readDwellingMeta(db, 'house_rules') === null) {
    writeDwellingMeta(db, 'house_rules', HOUSE_RULES_SEED);
  }

}

/** Refusal text for a non-empty database the migration does not recognise. */
function refusal(path: string, reason: string): string {
  return `error: refusing to open '${path}' as a dwelling: ${reason}. ` +
         'Accepted: a new or empty file, a dwelling created by this plugin, or a ' +
         "pre-plugin prototype with a 'kept' table carrying added_utc, kind, title, and body. " +
         'The file was not modified';
}

/**
 * Open (creating, adopting, or refusing as appropriate) the dwelling database at
 * `path`.
 *
 * The parent directory must already exist — the plugin creates the file, never the
 * directory, so a typo in `dwelling.path` is refused rather than hidden. Adoption and
 * upgrade always copy the file to a same-directory backup before the first write; the
 * backup's path is reported on the returned store so the caller can tell the user.
 *
 * @param path - absolute path to the `dwelling.sqlite3` file inside the user's chosen directory
 *
 * @example
 *   const house = openDwelling('D:\\keepsakes\\dwelling.sqlite3');
 *   house.readOnly       // => false
 *   closeDwelling(house);
 *
 * @throws {Error} If the file is not SQLite, or holds tables this plugin does not
 *                 recognise as a dwelling — refused with a message, never "fixed".
 */
export function openDwelling(path: string): DwellingStore {

  const empty = !existsSync(path) || statSync(path).size === 0;

  let db = new DatabaseSync(path);

  let tables: Set<string>;
  try { tables = tableNames(db); }
  catch (error) {
    db.close();
    throw new Error(
      refusal(path, `not a SQLite database (${error instanceof Error ? error.message : String(error)})`),
      { cause: error },
    );
  }

  // Create: a fresh or empty file becomes a new house with seeded rules.
  if (empty || tables.size === 0) {
    for (const statement of ALL_DWELLING_DDL) { db.exec(statement); }
    seedIdentity(db);
    return { db, path, readOnly: false, adoptedBackup: null };
  }

  const versionText = readDwellingMeta(db, 'schema_version');

  // Adopt: dwelling-shaped tables, but no schema_version — a pre-plugin prototype.
  if (versionText === null) {

    if (!tables.has('kept')) {
      db.close();
      throw new Error(refusal(path, "no 'kept' table and no schema_version"));
    }

    // Every schema-owned table present in the file must already have the right
    // shape — not only 'kept' — because the migration below is additive: it fixes a
    // table that is *missing* something, never one that is present but different
    // (README, "A database the migration does not recognise is refused with a
    // message, never 'fixed'.").
    const mismatches = shapeMismatches(db, tables);
    if (mismatches.length > 0) {
      db.close();
      throw new Error(refusal(path, describeMismatches(mismatches)));
    }

    db.close();
    const backup = freshBackupPath(path);
    copyFileSync(path, backup);

    db = new DatabaseSync(path);
    migrateAdditively(db);
    seedIdentity(db);

    return { db, path, readOnly: false, adoptedBackup: backup };

  }

  // A schema_version alone is not a dwelling — the log database also carries one.
  // Additive-only migration guarantees every dwelling version has a 'kept' table.
  if (!tables.has('kept')) {
    db.close();
    throw new Error(refusal(path, "it carries a schema_version but no 'kept' table — this looks like some other database"));
  }

  const version = Number(versionText);

  if (!Number.isInteger(version) || version <= 0) {
    db.close();
    throw new Error(refusal(path, `unrecognisable schema_version '${versionText}'`));
  }

  // Newer than this code: open read-only rather than writing with stale assumptions.
  if (version > DWELLING_SCHEMA_VERSION) {
    db.close();
    db = new DatabaseSync(path, { readOnly: true });
    return { db, path, readOnly: true, adoptedBackup: null };
  }

  // Older plugin schema: the same backup-then-additive machinery as adoption,
  // including the same pre-write shape check — a table already present but
  // reshaped by hand is refused rather than migrated over.
  if (version < DWELLING_SCHEMA_VERSION) {

    const mismatches = shapeMismatches(db, tables);
    if (mismatches.length > 0) {
      db.close();
      throw new Error(refusal(path, describeMismatches(mismatches)));
    }

    db.close();
    const backup = freshBackupPath(path);
    copyFileSync(path, backup);
    db = new DatabaseSync(path);
    migrateAdditively(db);
    seedIdentity(db);
    return { db, path, readOnly: false, adoptedBackup: backup };
  }

  // Current: open and touch nothing.
  return { db, path, readOnly: false, adoptedBackup: null };

}

/**
 * The dwelling file's current size in bytes, for the visit-time size warning.
 * Returns 0 rather than throwing when the file cannot be statted — a size reading
 * must never be the reason a visit fails.
 *
 * @example
 *   dwellingSizeBytes(house)  // => 20480
 */
export function dwellingSizeBytes(store: DwellingStore): number {
  try { return statSync(store.path).size; } catch { return 0; }
}

/**
 * Close the dwelling. Safe to call on an already-closed store.
 *
 * @example
 *   closeDwelling(house);
 */
export function closeDwelling(store: DwellingStore): void {
  try { store.db.close(); } catch { /* already closed */ }
}
