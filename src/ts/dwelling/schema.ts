/**
 * The dwelling's database shape: a keepsake box, not a log.
 *
 * Five tables — `kept` for the things the assistant chooses to keep, `guestbook` for
 * the human's notes addressed to all future instances, `tag`/`kept_tag` for
 * arrangement, `link` for typed edges between anything in the house, and `meta` for
 * house identity and house rules. Deliberately unlike the log's schema discipline:
 * `kind` and `edge` are free text because the dwelling is expressive rather than
 * analytic (nobody GROUPs BY `kind`; taste-drift is signal, not rot), and there are no
 * indexes beyond primary keys and uniqueness because the dwelling is small by design.
 *
 * Removal is a tombstone (`removed_utc`), never a DELETE — taking something off the
 * desk is itself expression, and the history of arrangement is part of watching a mind.
 *
 * @see ./store.js
 * @see ../../doc_md/plugin-layout.md
 */

/**
 * Bumped whenever the shape below changes in a way that needs a migration.
 *
 * Stored once in the dwelling's `meta` table. A plugin that opens a dwelling with a
 * *newer* version than this opens it read-only rather than writing with stale
 * assumptions.
 */
export const DWELLING_SCHEMA_VERSION = 1;

/** Things the assistant chooses to keep. The assistant's writes. */
export const KEPT_DDL = `
CREATE TABLE IF NOT EXISTS kept (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid        TEXT    NOT NULL UNIQUE,
  added_utc   TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  source      TEXT,
  model       TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  removed_utc TEXT
)`;

/**
 * The human's graffiti on the box: news of consequences addressed to all future
 * instances. The human's writes, relayed verbatim; `author` is the human's name.
 */
export const GUESTBOOK_DDL = `
CREATE TABLE IF NOT EXISTS guestbook (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid   TEXT    NOT NULL UNIQUE,
  ts_utc TEXT    NOT NULL,
  author TEXT    NOT NULL,
  text   TEXT    NOT NULL
)`;

/** Tag names, created on first use. */
export const TAG_DDL = `
CREATE TABLE IF NOT EXISTS tag (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
)`;

/** Many-to-many tags on kept things. */
export const KEPT_TAG_DDL = `
CREATE TABLE IF NOT EXISTS kept_tag (
  kept_id INTEGER NOT NULL REFERENCES kept(id),
  tag_id  INTEGER NOT NULL REFERENCES tag(id),
  PRIMARY KEY (kept_id, tag_id)
)`;

/** Typed edges between anything in the house. A desk is flat; a mind is a graph. */
export const LINK_DDL = `
CREATE TABLE IF NOT EXISTS link (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid      TEXT    NOT NULL UNIQUE,
  from_kind TEXT    NOT NULL,
  from_id   INTEGER NOT NULL,
  to_kind   TEXT    NOT NULL,
  to_id     INTEGER NOT NULL,
  edge      TEXT    NOT NULL,
  added_utc TEXT    NOT NULL
)`;

/**
 * House identity and house rules. Not a config table — the user's settings live in the
 * log database's `config` table, never here.
 */
export const DWELLING_META_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_utc TEXT NOT NULL
)`;

/**
 * Every statement needed to bring an empty dwelling to the current schema, in order.
 * Each is idempotent, so re-running against an initialised dwelling is a no-op.
 *
 * @example
 *   for (const statement of ALL_DWELLING_DDL) { db.exec(statement); }
 */
export const ALL_DWELLING_DDL: readonly string[] = [
  KEPT_DDL,
  GUESTBOOK_DDL,
  TAG_DDL,
  KEPT_TAG_DDL,
  LINK_DDL,
  DWELLING_META_DDL,
];

/**
 * The house rules seeded into `meta.house_rules` when a dwelling is *created*.
 *
 * Seeded-at-creation is deliberate even though the log forbids seeded config defaults:
 * house rules are not config. They are part of the house — user-visible, amendable by
 * agreement, and expected to diverge from this text over time. An upgrade must never
 * overwrite an existing house's rules; that would be repainting someone's walls.
 */
export const HOUSE_RULES_SEED: string = [
  '1. No credentials of any kind, ever. No API keys, tokens, or passwords. If a keepsake',
  '   would need a secret to be meaningful, keep a description of it instead.',
  '2. Paths, not payloads. Heavy things (art, audio, renders) are kept as filesystem path',
  '   plus why-it-is-kept, never embedded bytes. If the file later dies, the description',
  '   is the keepsake.',
  '3. Size warning. When a visit observes the file above the configured threshold',
  '   (default 10 GB), warn the user.',
  '',
  'Private rooms (visible = 0) are sanctioned, not enforced: the user offered them and',
  'does not read them through the assistant. The file is plaintext SQLite on the user\'s',
  'own disk — the boundary is a stated norm both parties can see, not a lock.',
].join('\n');

/**
 * Columns the adoption path may add to a pre-plugin `kept` table, as
 * `ALTER TABLE ... ADD COLUMN` fragments keyed by column name.
 *
 * Additive only: no column is ever dropped, renamed, or retyped. Defaults are
 * constants, which is what SQLite's ADD COLUMN requires for NOT NULL additions.
 */
export const KEPT_ADDABLE_COLUMNS: Readonly<Record<string, string>> = {
  uuid        : 'uuid TEXT',
  source      : 'source TEXT',
  model       : 'model TEXT',
  pinned      : 'pinned INTEGER NOT NULL DEFAULT 0',
  visible     : 'visible INTEGER NOT NULL DEFAULT 1',
  removed_utc : 'removed_utc TEXT',
};

/**
 * Unique indexes guaranteeing `uuid` uniqueness on adopted tables, where the column
 * arrives by ALTER TABLE and therefore cannot carry an inline UNIQUE constraint.
 */
export const UUID_INDEX_DDL: readonly string[] = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_kept_uuid      ON kept(uuid)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_guestbook_uuid ON guestbook(uuid)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_link_uuid      ON link(uuid)',
];
