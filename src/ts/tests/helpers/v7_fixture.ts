/**
 * A genuine schema-v7 database fixture, for the v7→v8 migration specs.
 *
 * v7→v8 only adds the `format_findings` table, so every table v7 had is today's table:
 * the DDL is aliased from the schema module rather than frozen, on the v6 fixture's
 * reasoning. What makes this v7 is what is *absent* — no `format_findings`, no
 * `idx_findings_check` — and the stamped `schema_version`.
 *
 * @see ../../channels/migrate.js
 * @see ./v6_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  entriesDdl, INDEX_DDL, META_DDL, CONFIG_DDL, TURN_CONTEXT_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
  NOTES_DDL, NOTE_EVENTS_DDL, NOTE_INDEX_DDL,
} from '../../channels/schema.js';

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
  const statements = [
    entriesDdl(), TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
    MESSAGES_DDL, MESSAGE_READS_DDL, NOTES_DDL, NOTE_EVENTS_DDL,
    ...INDEX_DDL, ...MESSAGE_INDEX_DDL, ...NOTE_INDEX_DDL,
  ];
  for (const s of statements) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','7','2026-09-01T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','77777777-8888-9999-aaaa-bbbbbbbbbbbb','2026-09-01T00:00:00Z')").run();
  return db;
}
