/**
 * A genuine schema-v5 database fixture, for the v5→v6 migration specs.
 *
 * The DDL is verbatim — the literal shape every post-#43, pre-#16 database has on disk:
 * the anchor columns and the held-note tables present, and **no `corrects_kind` and no
 * `verbatim` column**. Deliberately NOT generated from the current schema module, exactly
 * as the v1 through v4 fixtures are not: a fixture that drifts forward when the schema
 * does proves nothing about the migration it exists to test.
 *
 * v5's `entries` table is v4's plus nothing — the v4→v5 step only added the held-note
 * tables — so the entries DDL here is v4's verbatim, aliased rather than copied so the
 * two can never disagree about a shape they genuinely share. What makes this a v5 rather
 * than a v4 is `notes`, `note_events`, and the stamped version.
 *
 * @see ../../channels/migrate.js
 * @see ./v4_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  META_DDL, CONFIG_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
  NOTES_DDL, NOTE_EVENTS_DDL, NOTE_INDEX_DDL,
} from '../../channels/schema.js';
import { V1_TURN_CONTEXT_DDL }          from './v1_fixture.js';
import { V4_ENTRIES_DDL, V4_INDEX_DDL } from './v4_fixture.js';

/**
 * The v5 `entries` DDL, frozen — identical to v4's, since v4→v5 touched no entries
 * column.
 */
export const V5_ENTRIES_DDL: string = V4_ENTRIES_DDL;

/** The indices a v5 database carried: v4's, plus the two the held-note tables added. */
export const V5_INDEX_DDL: readonly string[] = [...V4_INDEX_DDL, ...NOTE_INDEX_DDL];

/**
 * Build a genuine v5 database on disk, the way v5 `openStore` would have: the v5 entries
 * DDL, the side tables, the messagebox and held-note tables, the v5 index set (no
 * `idx_entries_corrects`), and `schema_version` stamped `'5'` with a fixed machine
 * identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV5(join(dir, 'log.sqlite3'));
 *   insertV5(db, 'u1', 'checklist', { series_key: 'atlas', percent: 40 });
 *   db.close();
 *
 * @see insertV5
 */
export function buildV5(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const statements = [
    V5_ENTRIES_DDL, V1_TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
    MESSAGES_DDL, MESSAGE_READS_DDL, NOTES_DDL, NOTE_EVENTS_DDL,
    ...V5_INDEX_DDL, ...MESSAGE_INDEX_DDL,
  ];
  for (const s of statements) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','5','2026-08-28T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-08-28T00:00:00Z','2026-08-28T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','55555555-6666-7777-8888-999999999999','2026-08-28T00:00:00Z')").run();
  return db;
}

/**
 * Insert one minimal v5 row plus whatever extra columns/values are supplied, through raw
 * SQL — the way rows genuinely reached a v5 database, bypassing today's code.
 *
 * This is how a **legacy correction link** is created for the read-rule tests: a
 * `corrects_id` with no kind beside it, which is exactly what every pre-#16 retraction
 * looks like and exactly what must keep reading as `retracts` without anything being
 * written onto it.
 *
 * @param extra column name → value pairs beyond the required minimum
 *
 * @example
 *   insertV5(db, 'u2', 'divergence', { corrects_id: 1 });   // a legacy, kind-less link
 *
 * @throws {Error} If the v5 CHECKs reject a value — or, for `corrects_kind` or
 *                 `verbatim`, because v5 has no such column at all, which is what proves
 *                 the fixture is v5.
 */
export function insertV5(
  db      : DatabaseSync,
  uuid    : string,
  channel : string,
  extra   : Record<string, string | number> = {},
): void {
  const keys = Object.keys(extra),
        cols = ['uuid', 'ts_utc', 'ts_local', 'tz', 'session', 'channel', 'text', 'plugin_version', ...keys],
        vals = [uuid, '2026-08-28T00:00:00Z', '9:14 am PDT', 'PDT', 's1', channel, `text for ${uuid}`, '0.2.1'];
  db.prepare(`INSERT INTO entries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...vals, ...keys.map(k => extra[k] ?? null));
}
