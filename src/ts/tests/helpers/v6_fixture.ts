/**
 * A genuine schema-v6 database fixture, for the v6→v7 migration specs.
 *
 * v6 is the first version whose `entries` table this fixture does **not** freeze, and the
 * reason is the v5 fixture's own reasoning applied one step further: v6→v7 touches
 * `turn_context` and nothing else, so v6's `entries` shape and today's are genuinely the
 * same table. Aliasing {@link ../../channels/schema.js entriesDdl} rather than copying it
 * means the two can never disagree about a shape they share — and if a later version does
 * change `entries`, that step's fixture freezes it then, exactly as v1 through v5 did.
 *
 * What *is* frozen here is the table the step changes:
 * {@link ./v1_fixture.js V1_TURN_CONTEXT_DDL}, the `turn_context` shape every database
 * from v1 through v6 has on disk — **no `source` column**. That constant lives in the v1
 * fixture because that is where the table was introduced and it did not change once in
 * six versions.
 *
 * @see ../../channels/migrate.js
 * @see ./v1_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  entriesDdl, INDEX_DDL, META_DDL, CONFIG_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
  NOTES_DDL, NOTE_EVENTS_DDL, NOTE_INDEX_DDL,
} from '../../channels/schema.js';
import { V1_TURN_CONTEXT_DDL } from './v1_fixture.js';

/**
 * Build a genuine v6 database on disk, the way v6 `openStore` would have: today's
 * `entries` (unchanged by v7), the **pre-v7** `turn_context`, the side tables, the full
 * v6 index set, and `schema_version` stamped `'6'` with a fixed machine identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV6(join(dir, 'log.sqlite3'));
 *   insertV6Context(db, 's1', 'p-1', 1);
 *   db.close();
 *
 * @see insertV6Context
 */
export function buildV6(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const statements = [
    entriesDdl(), V1_TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
    MESSAGES_DDL, MESSAGE_READS_DDL, NOTES_DDL, NOTE_EVENTS_DDL,
    ...INDEX_DDL, ...MESSAGE_INDEX_DDL, ...NOTE_INDEX_DDL,
  ];
  for (const s of statements) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','6','2026-08-29T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-08-29T00:00:00Z','2026-08-29T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','66666666-7777-8888-9999-aaaaaaaaaaaa','2026-08-29T00:00:00Z')").run();
  return db;
}

/**
 * Insert one `turn_context` row the way a v6 hook genuinely wrote it — thirteen columns
 * and no `source`, through raw SQL, bypassing today's code.
 *
 * This is what the migration has to carry forward untouched: a row that predates the
 * column and must come out the other side with NULL rather than a backfilled `'hook'`.
 *
 * @param session the session to record under
 * @param prompt  the turn identifier
 * @param index   the turn index the v6 hook would have derived
 *
 * @example
 *   insertV6Context(db, 's1', 'p-1', 1);
 *
 * @throws {Error} If a `source` value is somehow supplied — v6 has no such column at
 *                 all, which is what proves the fixture is v6.
 */
export function insertV6Context(
  db      : DatabaseSync,
  session : string,
  prompt  : string,
  index   : number,
): void {
  db.prepare(`
    INSERT INTO turn_context (ts_utc, session, prompt_id, turn_index, turn, cwd, effort)
    VALUES (?,?,?,?,?,?,?)`)
    .run('2026-08-29T00:00:00Z', session, prompt, index, 'reply', '/repo', 'high');
}
