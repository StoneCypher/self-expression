import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { ALL_DDL, SCHEMA_VERSION, check } from '../channels/schema.js';
import { CHANNELS, DELTAS }               from '../channels/vocabulary.js';

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

  test('creates every index', () => {
    const { db, dir } = freshDb();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                  .all().map(r => r.name as string);
    expect(idx).toHaveLength(4);
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

});
