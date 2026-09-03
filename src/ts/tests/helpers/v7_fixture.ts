/**
 * A genuine schema-v7 database fixture, for the v7→v8 migration specs.
 *
 * v7 is the first version whose `turn_context` shape this fixture does not freeze either:
 * v7→v8 touches neither `entries` nor `turn_context` at all, only adds a new table
 * (`pending_notice`, #98), so v7's full existing shape and today's (minus that new table)
 * are genuinely the same. Aliasing the schema module's DDL exports directly — including
 * the post-#98-unrelated {@link ../../channels/schema.js TURN_CONTEXT_DDL}, which already
 * carries `source` by v7 — means the fixture can never disagree with a shape it shares
 * with the current schema. If a later version does change one of these tables, that
 * step's fixture freezes it then, exactly as v1 through v6 did for theirs.
 *
 * @see ../../channels/migrate.js
 * @see ./v6_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  entriesDdl, TURN_CONTEXT_DDL, INDEX_DDL, META_DDL, CONFIG_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
  NOTES_DDL, NOTE_EVENTS_DDL, NOTE_INDEX_DDL,
} from '../../channels/schema.js';

/**
 * Build a genuine v7 database on disk, the way v7 `openStore` would have: today's
 * `entries` and `turn_context` (both unchanged by v8), the side tables, the full v7 index
 * set, and `schema_version` stamped `'7'` with a fixed machine identity — and, crucially,
 * **no `pending_notice` table**.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV7(join(dir, 'log.sqlite3'));
 *   db.close();
 *
 * @see ../../channels/migrate.js migrateV7toV8
 */
export function buildV7(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const statements = [
    entriesDdl(), TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
    MESSAGES_DDL, MESSAGE_READS_DDL, NOTES_DDL, NOTE_EVENTS_DDL,
    ...INDEX_DDL, ...MESSAGE_INDEX_DDL, ...NOTE_INDEX_DDL,
  ];
  for (const s of statements) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','7','2026-09-03T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','77777777-8888-9999-aaaa-bbbbbbbbbbbb','2026-09-03T00:00:00Z')").run();
  return db;
}
