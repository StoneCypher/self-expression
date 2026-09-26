/**
 * A genuine schema-v7 database fixture, for the v7→v8 migration specs.
 *
 * v7→v8 only adds the `format_findings` table, so most of what v7 had is still today's
 * table, and that DDL is aliased from the schema module on the v6 fixture's reasoning.
 * The exception is `turn_context`, which v9 widened with `host_pid` (issue #130). Its
 * v7 shape is frozen here as {@link V7_TURN_CONTEXT_DDL}, so this fixture cannot
 * silently grow the newer column. What else makes this v7 is what is *absent*: no
 * `format_findings`, no `idx_findings_check`. The stamped `schema_version` completes it.
 *
 * @see ../../channels/migrate.js
 * @see ./v6_fixture.js
 * @see ./v8_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  entriesDdl, INDEX_DDL, META_DDL, CONFIG_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
  NOTES_DDL, NOTE_EVENTS_DDL, NOTE_INDEX_DDL,
} from '../../channels/schema.js';

/**
 * The `turn_context` DDL as every v7 and v8 database carried it, frozen: the v1 columns
 * plus `source`, and no `host_pid`. It must never change again, because it describes
 * databases that already exist.
 *
 * @see ../../channels/schema.js TURN_CONTEXT_DDL
 */
export const V7_TURN_CONTEXT_DDL = `
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
  prompt_len      INTEGER,
  source          TEXT
)`;

/**
 * Every statement a v7 `openStore` applied, in order: tables, then indices. {@link buildV7}
 * uses it, and so does the v8 fixture, which adds v8's one table on top.
 */
export const V7_DDL: readonly string[] = [
  entriesDdl(), V7_TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, NOTES_DDL, NOTE_EVENTS_DDL,
  ...INDEX_DDL, ...MESSAGE_INDEX_DDL, ...NOTE_INDEX_DDL,
];

/**
 * Build a genuine v7 database on disk, the way v7 `openStore` would have: every v7 table
 * and index, no `format_findings`, and `schema_version` stamped `'7'` with a fixed
 * machine identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV7(join(dir, 'log.sqlite3'));
 *   db.close();
 */
export function buildV7(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  for (const s of V7_DDL) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','7','2026-09-01T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','77777777-8888-9999-aaaa-bbbbbbbbbbbb','2026-09-01T00:00:00Z')").run();
  return db;
}
