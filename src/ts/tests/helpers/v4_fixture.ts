/**
 * A genuine schema-v4 database fixture, for the v4→v5 migration specs.
 *
 * The DDL is verbatim — the literal shape every post-#18, pre-#43 database has on disk:
 * the anchor columns present, and **no `notes` or `note_events` tables at all**.
 * Deliberately NOT generated from the current schema module, exactly as the v1, v2, and
 * v3 fixtures are not: a fixture that drifts forward when the schema does proves nothing
 * about the migration it exists to test.
 *
 * @see ../../channels/migrate.js
 * @see ./v3_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL, INDEX_DDL,
  entriesDdl,
} from '../../channels/schema.js';

/**
 * The v4 `entries` DDL.
 *
 * v4→v5 is purely additive — it creates two tables and touches no `entries` column — so
 * the v4 entries shape *is* the current one, and generating it here is not the drift
 * hazard it would be for a rebuild step. A test in `migrate.spec.ts` pins that: if a
 * later version widens `entries`, this alias stops describing v4 and the fixture must
 * be frozen the way v1's and v2's are.
 */
export const V4_ENTRIES_DDL: string = entriesDdl();

/**
 * Build a genuine v4 database on disk, the way v4 `openStore` would have: the v4
 * entries DDL, the side tables, the messagebox tables, the v4 index set (no
 * `idx_notes_ripe`), and `schema_version` stamped `'4'` with a fixed machine identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV4(join(dir, 'log.sqlite3'));
 *   insertV4Message(db, 'm1', 'an ordinary aside', 'user');
 *   db.close();
 *
 * @see insertV4Message
 */
export function buildV4(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const statements = [
    V4_ENTRIES_DDL, TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
    MESSAGES_DDL, MESSAGE_READS_DDL,
    ...INDEX_DDL, ...MESSAGE_INDEX_DDL,
  ];
  for (const s of statements) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','4','2026-08-28T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-08-28T00:00:00Z','2026-08-28T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','44444444-5555-6666-7777-888888888888','2026-08-28T00:00:00Z')").run();
  return db;
}

/**
 * Insert one minimal v4 message through raw SQL — the way rows genuinely reached a v4
 * database, bypassing today's code.
 *
 * @param audience the messagebox audience; `'user'` is the one #43 later overlays notes
 *                 on, and is required explicitly so a test never leans on a default that
 *                 would quietly change what it is asserting
 *
 * @example
 *   insertV4Message(db, 'm-1', 'an ordinary aside', 'user');
 *
 * @throws {Error} If the v4 CHECKs reject a value.
 */
export function insertV4Message(
  db       : DatabaseSync,
  uuid     : string,
  text     : string,
  audience : string,
): void {
  db.prepare(`
    INSERT INTO messages (uuid, ts_utc, ts_local, tz, session, machine_id, audience, text, plugin_version)
    VALUES (?, '2026-08-28T00:00:00Z', '9:14 am PDT', 'PDT', 's1', 'm1', ?, ?, '0.2.1')`)
    .run(uuid, audience, text);
}
