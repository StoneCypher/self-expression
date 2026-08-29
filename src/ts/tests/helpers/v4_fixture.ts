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
 * @see ./v5_fixture.js
 */

import { DatabaseSync } from 'node:sqlite';
import {
  META_DDL, CONFIG_DDL,
  MESSAGES_DDL, MESSAGE_READS_DDL, MESSAGE_INDEX_DDL,
} from '../../channels/schema.js';
import { V1_INDEX_DDL, V1_TURN_CONTEXT_DDL } from './v1_fixture.js';

/**
 * The indices a v4 database carried, frozen alongside its DDL: v1's plus
 * `idx_entries_anchor`, which arrived with #18, and nothing later.
 *
 * Deliberately not `INDEX_DDL` from the schema module, for the same reason the table DDL
 * is not `entriesDdl()`: a later index over a later column is the fixture drifting
 * forward and then blaming the migration for it.
 */
export const V4_INDEX_DDL: readonly string[] = [
  ...V1_INDEX_DDL,
  'CREATE INDEX IF NOT EXISTS idx_entries_anchor  ON entries(anchor_kind, anchor_target)',
];

/**
 * The v4 `entries` DDL, frozen. Must never change again: it describes databases that
 * already exist.
 *
 * This was generated from the schema module until #16 widened `entries` at v6 — sound
 * only while every later step stayed additive, and a `migrate.spec.ts` test existed
 * precisely to catch the moment that stopped being true. It did, so the shape is written
 * out here: v2's columns plus the five #18 anchor columns, and **no `corrects_kind` and
 * no `verbatim`**. That absence is what makes this fixture prove anything at all about
 * the v5→v6 rebuild.
 *
 * v4→v5 touched no `entries` column, so this is also the v5 entries shape — see
 * {@link ./v5_fixture.js V5_ENTRIES_DDL}, which aliases it rather than copying it.
 */
export const V4_ENTRIES_DDL = `
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

  anchor_kind     TEXT CHECK (anchor_kind IS NULL OR anchor_kind IN ('file','prompt','reply','checklist','entry')),
  anchor_target   TEXT,
  anchor_span     TEXT,
  anchor_quote    TEXT,
  anchor_hash     TEXT,

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
    V4_ENTRIES_DDL, V1_TURN_CONTEXT_DDL, META_DDL, CONFIG_DDL,
    MESSAGES_DDL, MESSAGE_READS_DDL,
    ...V4_INDEX_DDL, ...MESSAGE_INDEX_DDL,
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

/**
 * Insert one minimal v4 entries row plus whatever extra columns/values are supplied,
 * through raw SQL — the way rows genuinely reached a v4 database, bypassing today's code.
 *
 * @param extra column name → value pairs beyond the required minimum
 *
 * @example
 *   insertV4(db, 'u2', 'divergence', { corrects_id: 1 });
 *
 * @throws {Error} If the v4 CHECKs reject a value — or, for a correction column, because
 *                 v4 has no such column at all, which is what proves the fixture is v4.
 */
export function insertV4(
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
