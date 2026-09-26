/**
 * A genuine schema-v8 database fixture, for the v8→v9 migration specs (issue #130).
 *
 * v8 is v7 plus the `format_findings` table and its index. What makes it v8 rather than
 * current is the `turn_context` shape: the frozen {@link ./v7_fixture.js V7_TURN_CONTEXT_DDL},
 * with no `host_pid` column and no `idx_context_host`.
 *
 * @see ../../channels/migrate.js
 * @see ./v7_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import { FORMAT_FINDINGS_DDL, FINDINGS_INDEX_DDL } from '../../channels/schema.js';
import { V7_DDL } from './v7_fixture.js';

/**
 * Build a genuine v8 database on disk, the way v8 `openStore` would have: every v7
 * statement, then `format_findings` and its index, stamped `'8'` with a fixed machine
 * identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV8(join(dir, 'log.sqlite3'));
 *   db.close();
 */
export function buildV8(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  for (const s of [...V7_DDL, FORMAT_FINDINGS_DDL, ...FINDINGS_INDEX_DDL]) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','8','2026-09-20T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-09-20T00:00:00Z','2026-09-20T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','88888888-9999-aaaa-bbbb-cccccccccccc','2026-09-20T00:00:00Z')").run();
  return db;
}
