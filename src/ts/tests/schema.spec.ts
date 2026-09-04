import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import {
  ALL_DDL, TABLE_DDL, ALL_INDEX_DDL, TURN_CONTEXT_DDL, TURN_CONTEXT_SOURCE_COLUMN,
  SCHEMA_VERSION, check, entriesDdl,
} from '../channels/schema.js';
import {
  CHANNELS, DELTAS, FORECAST_OUTCOMES, SILENCE_KINDS, AUDIENCES, ANCHOR_KINDS,
  CORRECTION_KINDS,
} from '../channels/vocabulary.js';

/** A throwaway on-disk database; node:sqlite has no shared in-memory mode across handles. */
function freshDb(): { db: DatabaseSync; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'se-schema-')),
        db  = new DatabaseSync(join(dir, 'log.sqlite3'));
  for (const statement of ALL_DDL) { db.exec(statement); }
  return { db, dir };
}

/** The columns a minimal insert must supply. */
const REQUIRED = "uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version";
const VALUES   = "'u1','2026-08-18T00:00:00Z','9:14 am PDT','PDT','s1',?,'hello','0.2.0'";

describe('schema', () => {

  test('applies cleanly to an empty database', () => {
    const { db, dir } = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                     .all().map(r => r.name as string);
    expect(tables).toContain('entries');
    expect(tables).toContain('meta');
    expect(tables).toContain('config');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('is idempotent — applying twice is a no-op, not an error', () => {
    const { db, dir } = freshDb();
    expect(() => { for (const s of ALL_DDL) { db.exec(s); } }).not.toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('creates every index the DDL declares', () => {
    const { db, dir } = freshDb();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                  .all().map(r => r.name as string);
    // Counted from the whole index DDL rather than hardcoded, or family by family, so
    // neither adding an index nor adding a family of them can break this.
    expect(idx).toHaveLength(ALL_INDEX_DDL.length);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('creates the turn_context table that bridges hooks and server', () => {
    const { db, dir } = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
                     .all().map(r => r.name as string);
    expect(tables).toContain('turn_context');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('accepts a minimal valid entry', () => {
    const { db, dir } = freshDb();
    db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('signature');
    expect(db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(1);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('rejects a channel outside the vocabulary', () => {
    const { db, dir } = freshDb();
    expect(() => db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('vibes'))
      .toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('rejects the exact drift values that corrupted the previous log', () => {
    const { db, dir } = freshDb();
    const stmt = db.prepare(
      `INSERT INTO entries (${REQUIRED}, delta) VALUES (${VALUES}, ?)`);
    for (const bad of ['flat', 'right']) {
      expect(() => stmt.run('signature', bad)).toThrow();
    }
    expect(() => stmt.run('signature', 'steady')).not.toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('a missing position cannot silently become a fake close', () => {
    const { db, dir } = freshDb();
    db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('signature');
    expect(db.prepare('SELECT position FROM entries').get().position).toBeNull();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('enforces uuid uniqueness so cross-machine merges cannot collide', () => {
    const { db, dir } = freshDb();
    const stmt = db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`);
    stmt.run('signature');
    expect(() => stmt.run('need')).toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('defaults visible to 1 and nudged to 0', () => {
    const { db, dir } = freshDb();
    db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('dissent');
    const row = db.prepare('SELECT visible, nudged, uncertain FROM entries').get();
    expect(row.visible).toBe(1);
    expect(row.nudged).toBe(0);
    expect(row.uncertain).toBe(0);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('accepts the #42 vocabulary growth: taste, load, predicted, faded', () => {
    const { db, dir } = freshDb();
    db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('taste');
    db.prepare(`INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version, confidence, divergence_kind)
                VALUES ('u2','2026-08-18T00:00:00Z','9:14 am PDT','PDT','s1',?, 'x','0.2.0','predicted','faded')`)
      .run('load');
    expect(db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(2);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('carries the forecast and silence columns, nullable', () => {
    const { db, dir } = freshDb();
    db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('signature');
    const row = db.prepare('SELECT resolve_by, outcome, silence FROM entries').get();
    expect(row.resolve_by).toBeNull();
    expect(row.outcome).toBeNull();
    expect(row.silence).toBeNull();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('accepts every forecast outcome and every silence kind', () => {
    const { db, dir } = freshDb();
    for (const [i, outcome] of FORECAST_OUTCOMES.entries()) {
      db.prepare(`INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version, outcome)
                  VALUES (?, '2026-08-18T00:00:00Z', '9:14 am PDT', 'PDT', 's1', 'confidence', 'x', '0.2.0', ?)`)
        .run(`o-${String(i)}`, outcome);
    }
    for (const [i, silence] of SILENCE_KINDS.entries()) {
      db.prepare(`INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version, silence)
                  VALUES (?, '2026-08-18T00:00:00Z', '9:14 am PDT', 'PDT', 's1', 'signature', 'x', '0.2.0', ?)`)
        .run(`s-${String(i)}`, silence);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM entries').get().n)
      .toBe(FORECAST_OUTCOMES.length + SILENCE_KINDS.length);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('rejects an outcome or silence outside its vocabulary', () => {
    const { db, dir } = freshDb();
    expect(() => db.prepare(
      `INSERT INTO entries (${REQUIRED}, outcome) VALUES (${VALUES}, 'won')`).run('confidence'))
      .toThrow();
    expect(() => db.prepare(
      `INSERT INTO entries (${REQUIRED}, silence) VALUES (${VALUES}, 'quiet')`).run('signature'))
      .toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('carries the five anchor columns, nullable — an unanchored entry is the normal case', () => {
    const { db, dir } = freshDb();
    db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('signature');
    const row = db.prepare(
      'SELECT anchor_kind, anchor_target, anchor_span, anchor_quote, anchor_hash FROM entries').get();
    expect(row.anchor_kind).toBeNull();
    expect(row.anchor_target).toBeNull();
    expect(row.anchor_span).toBeNull();
    expect(row.anchor_quote).toBeNull();
    expect(row.anchor_hash).toBeNull();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('accepts every anchor kind and rejects one outside the vocabulary', () => {
    const { db, dir } = freshDb();
    for (const [i, kind] of ANCHOR_KINDS.entries()) {
      db.prepare(`INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version, anchor_kind, anchor_target)
                  VALUES (?, '2026-08-28T00:00:00Z', '9:14 am PDT', 'PDT', 's1', 'dissent', 'x', '0.2.1', ?, 't')`)
        .run(`a-${String(i)}`, kind);
    }
    expect(() => db.prepare(
      `INSERT INTO entries (${REQUIRED}, anchor_kind) VALUES (${VALUES}, 'diagram')`).run('dissent'))
      .toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(ANCHOR_KINDS.length);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('carries the two correction columns, nullable — an unlinked entry is the normal case', () => {
    const { db, dir } = freshDb();
    db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('signature');
    const row = db.prepare('SELECT corrects_kind, verbatim FROM entries').get();
    expect(row.corrects_kind).toBeNull();
    expect(row.verbatim).toBeNull();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('accepts every correction kind and rejects one outside the vocabulary', () => {
    const { db, dir } = freshDb();
    for (const [i, kind] of CORRECTION_KINDS.entries()) {
      db.prepare(`INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version, corrects_kind)
                  VALUES (?, '2026-08-28T00:00:00Z', '9:14 am PDT', 'PDT', 's1', 'divergence', 'x', '0.2.1', ?)`)
        .run(`c-${String(i)}`, kind);
    }
    expect(() => db.prepare(
      `INSERT INTO entries (${REQUIRED}, corrects_kind) VALUES (${VALUES}, 'supersedes')`).run('divergence'))
      .toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(CORRECTION_KINDS.length);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('there is no retracted column — standing is derived, never stored (#16)', () => {
    const { db, dir } = freshDb();
    const columns = db.prepare("SELECT name FROM pragma_table_info('entries')")
                      .all().map(r => r.name as string);
    expect(columns).not.toContain('retracted');
    expect(columns).not.toContain('retracted_by');
    expect(columns).not.toContain('status');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('creates idx_entries_corrects, the index the standing walk uses', () => {
    const { db, dir } = freshDb();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                  .all().map(r => r.name as string);
    expect(idx).toContain('idx_entries_corrects');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('anchoring is a qualifier, not a table or a channel — the row is still one entries row', () => {
    const { db, dir } = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
                     .all().map(r => r.name as string);
    expect(tables).not.toContain('anchors');
    expect(CHANNELS as readonly string[]).not.toContain('annotation');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('creates idx_entries_anchor, the index anchoring exists to use', () => {
    const { db, dir } = freshDb();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                  .all().map(r => r.name as string);
    expect(idx).toContain('idx_entries_anchor');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('creates the messagebox tables (#41)', () => {
    const { db, dir } = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
                     .all().map(r => r.name as string);
    expect(tables).toContain('messages');
    expect(tables).toContain('message_reads');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('accepts every audience and rejects one outside the vocabulary', () => {
    const { db, dir } = freshDb();
    const insert = db.prepare(
      `INSERT INTO messages (uuid, ts_utc, ts_local, tz, session, machine_id, audience, text, plugin_version)
       VALUES (?, '2026-08-28T00:00:00Z', '9:14 am PDT', 'PDT', 's1', 'm1', ?, 'x', '0.2.1')`);
    for (const [i, audience] of AUDIENCES.entries()) {
      insert.run(`a-${String(i)}`, audience);
    }
    expect(() => insert.run('a-bad', 'everyone')).toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM messages').get().n).toBe(AUDIENCES.length);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test("message_reads accepts only 'model' and 'user' readers", () => {
    const { db, dir } = freshDb();
    db.prepare(
      `INSERT INTO messages (uuid, ts_utc, ts_local, tz, session, machine_id, audience, text, plugin_version)
       VALUES ('m-1', '2026-08-28T00:00:00Z', '9:14 am PDT', 'PDT', 's1', 'm1', 'self', 'x', '0.2.1')`).run();
    const insert = db.prepare(
      "INSERT INTO message_reads (message_id, ts_utc, reader) VALUES (1, '2026-08-28T00:00:00Z', ?)");
    insert.run('model');
    insert.run('user');
    expect(() => insert.run('bystander')).toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('accepts every channel in the vocabulary', () => {
    const { db, dir } = freshDb();
    for (const [i, channel] of CHANNELS.entries()) {
      db.prepare(`INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version)
                  VALUES (?, '2026-08-18T00:00:00Z', '9:14 am PDT', 'PDT', 's1', ?, 'x', '0.2.0')`)
        .run(`u-${String(i)}`, channel);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(CHANNELS.length);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

});

describe('check', () => {

  test('allows NULL alongside the vocabulary', () => {
    expect(check('delta', DELTAS)).toBe(
      "CHECK (delta IS NULL OR delta IN ('up','down','steady'))");
  });

});

describe('SCHEMA_VERSION', () => {

  test('is a positive integer', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });

  test('is 8 — the pending_notice shape', () => {
    expect(SCHEMA_VERSION).toBe(8);
  });

  test('turn_context declares source, and still bakes no CHECK into that table', () => {
    expect(TURN_CONTEXT_DDL).toContain(TURN_CONTEXT_SOURCE_COLUMN);
    expect(TURN_CONTEXT_DDL).not.toContain('CHECK');
  });

});

describe('the DDL split', () => {

  test('ALL_DDL is exactly the tables followed by the indices', () => {
    expect(ALL_DDL).toEqual([...TABLE_DDL, ...ALL_INDEX_DDL]);
  });

  test('no table statement creates an index, and no index statement creates a table', () => {
    for (const statement of TABLE_DDL)     { expect(statement).toContain('CREATE TABLE'); }
    for (const statement of ALL_INDEX_DDL) { expect(statement).toContain('CREATE INDEX'); }
  });

  test('applying the tables alone is enough for an insert — indices are never load-bearing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-schema-split-')),
          db  = new DatabaseSync(join(dir, 'log.sqlite3'));
    for (const statement of TABLE_DDL) { db.exec(statement); }
    expect(() => db.prepare(`INSERT INTO entries (${REQUIRED}) VALUES (${VALUES})`).run('signature'))
      .not.toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

});

describe('entriesDdl', () => {

  test('defaults to the canonical entries table', () => {
    expect(entriesDdl()).toBe(ALL_DDL[0]);
    expect(entriesDdl()).toContain('CREATE TABLE IF NOT EXISTS entries (');
  });

  test('parameterizes the table name for the migration rebuild, changing nothing else', () => {
    const rebuilt = entriesDdl('entries_v2');
    expect(rebuilt).toContain('CREATE TABLE IF NOT EXISTS entries_v2 (');
    expect(rebuilt.replace('entries_v2', 'entries')).toBe(entriesDdl());
  });

});
