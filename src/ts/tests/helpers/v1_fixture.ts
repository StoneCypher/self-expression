/**
 * A genuine schema-v1 database fixture, shared by the migration unit and stochastic
 * specs.
 *
 * The DDL is verbatim — the literal shape every pre-#42 database has on disk, with
 * the v1 vocabularies baked into its CHECKs. Deliberately NOT generated from the
 * current schema module: the whole point of the fixture is that it cannot drift
 * forward when the schema does.
 *
 * @see ../../channels/migrate.js
 */

import { DatabaseSync } from 'node:sqlite';
import { META_DDL, CONFIG_DDL } from '../../channels/schema.js';

/**
 * The `turn_context` DDL as every database from v1 through v6 carried it, frozen —
 * **no `source` column**, which is exactly what the v6→v7 step adds.
 *
 * Frozen here, in the oldest fixture, and re-exported by the later ones rather than
 * copied, because the table genuinely did not change across those six versions: one
 * constant for one shape means the v2–v6 fixtures cannot disagree about it. Before this
 * existed, every fixture imported the live `TURN_CONTEXT_DDL` — harmless while the table
 * was immutable, and silently wrong the moment it was not, since a "v1" database would
 * have been built with a v7 table and the migration would have had nothing to prove.
 *
 * @see ../../channels/schema.js TURN_CONTEXT_DDL
 */
export const V1_TURN_CONTEXT_DDL = `
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
  prompt_len      INTEGER
)`;

/**
 * The indices a v1 database carried, frozen alongside its DDL.
 *
 * Deliberately not `INDEX_DDL` from the schema module, for the same reason the table
 * DDL is not `entriesDdl()`: a later index over a later column (`idx_entries_anchor`,
 * #18) would fail outright against a v1 table, which is the fixture drifting forward
 * and then blaming the migration for it.
 */
export const V1_INDEX_DDL: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_entries_prompt  ON entries(prompt_id)',
  'CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session, id)',
  'CREATE INDEX IF NOT EXISTS idx_entries_channel ON entries(channel, ts_utc)',
  'CREATE INDEX IF NOT EXISTS idx_entries_series  ON entries(series_key, id)',
  'CREATE INDEX IF NOT EXISTS idx_context_session ON turn_context(session, id)',
];

/** The v1 `entries` DDL, frozen. Must never change again: it describes databases that already exist. */
export const V1_ENTRIES_DDL = `
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

  channel         TEXT    NOT NULL CHECK (channel IS NULL OR channel IN ('signature','need','idea','divergence','dissent','conflict','confidence','unanswerable','pattern','checklist')),
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

  confidence      TEXT CHECK (confidence IS NULL OR confidence IN ('verified','recalled','inferred','guessed')),
  divergence_kind TEXT CHECK (divergence_kind IS NULL OR divergence_kind IN ('unverified','assumed','misread','overstated','stale')),

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
 * Build a genuine v1 database on disk, the way v1 `openStore` would have: v1 entries
 * DDL, the (unchanged in v2) side tables and indices, and `schema_version` stamped
 * `'1'` with a fixed machine identity.
 *
 * @param path the database file to create
 * @returns the open handle, for the caller to populate and close
 *
 * @example
 *   const db = buildV1(join(dir, 'log.sqlite3'));
 *   insertV1(db, 'u1', 'signature');
 *   db.close();
 *
 * @see insertV1
 */
export function buildV1(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  for (const s of [V1_ENTRIES_DDL, V1_TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL, ...V1_INDEX_DDL]) {
    db.exec(s);
  }
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('schema_version','1','2026-08-18T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('created_utc','2026-08-18T00:00:00Z','2026-08-18T00:00:00Z')").run();
  db.prepare("INSERT INTO meta (key, value, updated_utc) VALUES ('machine_id','11111111-2222-3333-4444-555555555555','2026-08-18T00:00:00Z')").run();
  return db;
}

/**
 * Insert one minimal v1 row plus whatever extra columns/values are supplied, through
 * raw SQL — the way rows genuinely reached a v1 database, bypassing today's code.
 *
 * @param extra column name → value pairs beyond the required minimum
 *
 * @example
 *   insertV1(db, 'u3', 'checklist', { series_key: 'atlas', percent: 40 });
 *
 * @throws {Error} If the v1 CHECKs reject a value — which is itself what the fixture
 *                 tests use to prove the fixture really is v1.
 */
export function insertV1(
  db      : DatabaseSync,
  uuid    : string,
  channel : string,
  extra   : Record<string, string | number> = {},
): void {
  const keys = Object.keys(extra),
        cols = ['uuid', 'ts_utc', 'ts_local', 'tz', 'session', 'channel', 'text', 'plugin_version', ...keys],
        vals = [uuid, '2026-08-18T00:00:00Z', '9:14 am PDT', 'PDT', 's1', channel, `text for ${uuid}`, '0.1.9'];
  db.prepare(`INSERT INTO entries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...vals, ...keys.map(k => extra[k] ?? null));
}
