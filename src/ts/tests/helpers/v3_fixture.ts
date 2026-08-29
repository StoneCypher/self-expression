/**
 * A genuine schema-v3 database fixture, for the v3→v4 migration specs.
 *
 * The DDL is verbatim — the literal shape every post-#41, pre-#18 database has on disk,
 * with the v3 vocabularies baked into its CHECKs and **no anchor columns**. Deliberately
 * NOT generated from the current schema module, exactly as the v1 and v2 fixtures are
 * not: a fixture that drifts forward when the schema does proves nothing about the
 * migration it exists to test.
 *
 * v3's `entries` table is v2's plus nothing — the v2→v3 step only added the messagebox
 * tables — so the entries DDL here is v2's verbatim, and what makes this fixture a v3
 * rather than a v2 is the messagebox tables and the stamped version.
 *
 * @see ../../channels/migrate.js
 * @see ./v2_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  META_DDL, CONFIG_DDL, MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
} from '../../channels/schema.js';
import { V1_INDEX_DDL, V1_TURN_CONTEXT_DDL } from './v1_fixture.js';
import { V2_ENTRIES_DDL } from './v2_fixture.js';

/**
 * The v3 `entries` DDL, frozen — identical to v2's, since v2→v3 touched no entries
 * column. Aliased rather than copied so the two can never disagree about a shape they
 * genuinely share.
 */
export const V3_ENTRIES_DDL: string = V2_ENTRIES_DDL;

/**
 * Build a genuine v3 database on disk, the way v3 `openStore` would have: the v3
 * entries DDL, the side tables, the messagebox tables and their indices, the v3 index
 * set (no `idx_entries_anchor`), and `schema_version` stamped `'3'` with a fixed
 * machine identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV3(join(dir, 'log.sqlite3'));
 *   insertV3(db, 'u1', 'dissent');
 *   db.close();
 *
 * @see insertV3
 */
export function buildV3(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const statements = [
    V3_ENTRIES_DDL, V1_TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
    MESSAGES_DDL, MESSAGE_READS_DDL,
    ...V1_INDEX_DDL, ...MESSAGE_INDEX_DDL,
  ];
  for (const s of statements) { db.exec(s); }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','3','2026-08-28T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-08-28T00:00:00Z','2026-08-28T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','33333333-4444-5555-6666-777777777777','2026-08-28T00:00:00Z')").run();
  return db;
}

/**
 * Insert one minimal v3 row plus whatever extra columns/values are supplied, through
 * raw SQL — the way rows genuinely reached a v3 database, bypassing today's code.
 *
 * @param extra column name → value pairs beyond the required minimum
 *
 * @example
 *   insertV3(db, 'u3', 'confidence', { confidence: 'predicted', resolve_by: '2026-08-30' });
 *
 * @throws {Error} If the v3 CHECKs reject a value — or, for an anchor column, because
 *                 v3 has no such column at all, which is what proves the fixture is v3.
 */
export function insertV3(
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
