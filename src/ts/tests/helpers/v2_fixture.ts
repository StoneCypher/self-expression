/**
 * A genuine schema-v2 database fixture, for the v2→v3 migration specs.
 *
 * The DDL is verbatim — the literal shape every post-#42, pre-#41 database has on
 * disk, with the v2 vocabularies baked into its CHECKs and **no messagebox tables**.
 * Deliberately NOT generated from the current schema module, exactly as the v1
 * fixture is not: the whole point of a fixture is that it cannot drift forward when
 * the schema does.
 *
 * @see ../../channels/migrate.js
 * @see ./v1_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import { TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL } from '../../channels/schema.js';
import { V1_INDEX_DDL } from './v1_fixture.js';

/** The v2 `entries` DDL, frozen. Must never change again: it describes databases that already exist. */
export const V2_ENTRIES_DDL = `
CREATE TABLE IF NOT EXISTS entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT    NOT NULL UNIQUE,

  ts_utc          TEXT    NOT NULL,
  ts_local        TEXT    NOT NULL,
  tz              TEXT    NOT NULL,
  elapsed_ms      INTEGER,

  session         TEXT    NOT NULL,
  prompt_id       TEXT,
  turn_index      INTEGER,
  turn            TEXT CHECK (turn IS NULL OR turn IN ('reply','wakeup','notification','hook')),
  host            TEXT,
  host_version    TEXT,
  agent_id        TEXT,
  agent_type      TEXT,
  effort          TEXT CHECK (effort IS NULL OR effort IN ('low','medium','high','xhigh','max')),
  permission_mode TEXT,
  cwd             TEXT,
  project         TEXT,
  git_branch      TEXT,
  machine_id      TEXT,
  platform        TEXT,
  model           TEXT,

  channel         TEXT    NOT NULL CHECK (channel IS NULL OR channel IN ('signature','need','idea','divergence','dissent','conflict','confidence','unanswerable','pattern','checklist','load','taste')),
  text            TEXT    NOT NULL,
  modality        TEXT CHECK (modality IS NULL OR modality IN ('deliverable','draft','sketch','option','aside','question')),
  visible         INTEGER NOT NULL DEFAULT 1,
  nudged          INTEGER NOT NULL DEFAULT 0,
  interrupted     INTEGER NOT NULL DEFAULT 0,
  tool_calls      INTEGER,
  error_count     INTEGER,
  compactions     INTEGER,
  prompt_len      INTEGER,
  response_len    INTEGER,
  context_tokens  INTEGER,
  output_tokens   INTEGER,
  thinking_tokens INTEGER,
  corrects_id     INTEGER REFERENCES entries(id),

  position        TEXT CHECK (position IS NULL OR position IN ('open','close','mid')),
  delta           TEXT CHECK (delta IS NULL OR delta IN ('up','down','steady')),
  uncertain       INTEGER NOT NULL DEFAULT 0,
  face            TEXT,
  context_emoji   TEXT,
  stem            TEXT CHECK (stem IS NULL OR stem IN ('flow','spark','drag','fog','strain','still')),
  cctype          TEXT,

  confidence      TEXT CHECK (confidence IS NULL OR confidence IN ('verified','recalled','inferred','guessed','predicted')),
  divergence_kind TEXT CHECK (divergence_kind IS NULL OR divergence_kind IN ('unverified','assumed','misread','overstated','stale','faded')),
  resolve_by      TEXT,
  outcome         TEXT CHECK (outcome IS NULL OR outcome IN ('hit','miss','void')),
  silence         TEXT CHECK (silence IS NULL OR silence IN ('empty','unlooked','held','depth')),

  series_key      TEXT,
  title           TEXT,
  succ            INTEGER,
  active          INTEGER,
  fail            INTEGER,
  percent         INTEGER,

  plugin_version  TEXT    NOT NULL,
  format_version  TEXT
)`;

/**
 * Build a genuine v2 database on disk, the way v2 `openStore` would have: v2 entries
 * DDL, the side tables and entry/context indices, **no messagebox tables**, and
 * `schema_version` stamped `'2'` with a fixed machine identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV2(join(dir, 'log.sqlite3'));
 *   insertV2(db, 'u1', 'taste');
 *   db.close();
 *
 * @see insertV2
 */
export function buildV2(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  // v2 and v1 carried the same indices — `idx_entries_anchor` arrives only at v4 — so
  // the frozen v1 list is exactly right here, and reusing it says so.
  for (const s of [V2_ENTRIES_DDL, TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL, ...V1_INDEX_DDL]) {
    db.exec(s);
  }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','2','2026-08-27T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-08-27T00:00:00Z','2026-08-27T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','22222222-3333-4444-5555-666666666666','2026-08-27T00:00:00Z')").run();
  return db;
}

/**
 * Insert one minimal v2 row plus whatever extra columns/values are supplied, through
 * raw SQL — the way rows genuinely reached a v2 database, bypassing today's code.
 *
 * @param extra column name → value pairs beyond the required minimum
 *
 * @example
 *   insertV2(db, 'u3', 'confidence', { confidence: 'predicted', resolve_by: '2026-08-30' });
 *
 * @throws {Error} If the v2 CHECKs reject a value.
 */
export function insertV2(
  db      : DatabaseSync,
  uuid    : string,
  channel : string,
  extra   : Record<string, string | number> = {},
): void {
  const keys = Object.keys(extra),
        cols = ['uuid', 'ts_utc', 'ts_local', 'tz', 'session', 'channel', 'text', 'plugin_version', ...keys],
        vals = [uuid, '2026-08-27T00:00:00Z', '9:14 am PDT', 'PDT', 's1', channel, `text for ${uuid}`, '0.2.1'];
  db.prepare(`INSERT INTO entries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...vals, ...keys.map(k => extra[k] ?? null));
}
