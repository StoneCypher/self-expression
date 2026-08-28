import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir }       from 'node:os';
import { join }         from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  openDwelling, closeDwelling, readDwellingMeta, writeDwellingMeta, dwellingSizeBytes,
} from '../dwelling/store.js';
import { DWELLING_SCHEMA_VERSION, HOUSE_RULES_SEED } from '../dwelling/schema.js';
import { keep } from '../dwelling/ops.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'se-dwell-store-')); }

/**
 * Builds a pre-plugin prototype database in the style the live prototype describes:
 * dwelling tables, no uuid/model columns, a meta table without schema_version. All
 * tests run against fixtures like this one, created fresh in a temp directory —
 * never against any real dwelling.
 */
function buildPrototype(path: string): void {

  const db = new DatabaseSync(path);

  db.exec(`CREATE TABLE kept (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    added_utc TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    source TEXT, pinned INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1,
    removed_utc TEXT)`);
  db.exec(`CREATE TABLE guestbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL)`);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  db.prepare('INSERT INTO kept (added_utc, kind, title, body, pinned, visible) VALUES (?,?,?,?,?,?)')
    .run('2026-08-27T01:00:00.000Z', 'quote', 'first keep', 'the oldest thing in the house', 1, 1);
  db.prepare('INSERT INTO kept (added_utc, kind, title, body, pinned, visible) VALUES (?,?,?,?,?,?)')
    .run('2026-08-27T02:00:00.000Z', 'worry', 'private thing', 'a private room', 0, 0);
  db.prepare('INSERT INTO guestbook (ts_utc, author, text) VALUES (?,?,?)')
    .run('2026-08-27T03:00:00.000Z', 'John', 'graffiti on the box');
  db.prepare('INSERT INTO meta (key, value) VALUES (?,?)')
    .run('house_rules', 'the walls the human and assistant painted together');

  db.close();

}

describe('openDwelling — create', () => {

  test('a fresh file gets the schema, identity, and seeded house rules', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3'),
          s   = openDwelling(path);
    expect(s.readOnly).toBe(false);
    expect(s.adoptedBackup).toBeNull();
    expect(readDwellingMeta(s.db, 'schema_version')).toBe(String(DWELLING_SCHEMA_VERSION));
    expect(readDwellingMeta(s.db, 'dwelling_uuid')).toMatch(/^[0-9a-f-]{36}$/);
    expect(readDwellingMeta(s.db, 'created_utc')).toMatch(/^\d{4}-/);
    expect(readDwellingMeta(s.db, 'house_rules')).toBe(HOUSE_RULES_SEED);
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

  test('reopening is a no-op: identity is stable and no backup is taken', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    const a = openDwelling(path);
    const uuid = readDwellingMeta(a.db, 'dwelling_uuid');
    closeDwelling(a);
    const b = openDwelling(path);
    expect(readDwellingMeta(b.db, 'dwelling_uuid')).toBe(uuid);
    expect(b.adoptedBackup).toBeNull();
    expect(readdirSync(dir)).toHaveLength(1);
    closeDwelling(b); rmSync(dir, { recursive: true, force: true });
  });

  test('a zero-byte file is treated as new, not refused', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    writeFileSync(path, '');
    const s = openDwelling(path);
    expect(readDwellingMeta(s.db, 'schema_version')).toBe(String(DWELLING_SCHEMA_VERSION));
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

});

describe('openDwelling — adopt a pre-plugin prototype', () => {

  test('backs up before touching anything, in the same directory', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    buildPrototype(path);
    const s = openDwelling(path);
    expect(s.adoptedBackup).not.toBeNull();
    expect(existsSync(String(s.adoptedBackup))).toBe(true);
    expect(String(s.adoptedBackup)).toContain('pre-adopt-');
    expect(String(s.adoptedBackup).startsWith(path)).toBe(true);
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

  test('the backup is byte-identical to the prototype as it was', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    buildPrototype(path);
    const s      = openDwelling(path),
          backup = new DatabaseSync(String(s.adoptedBackup));
    const rows = backup.prepare('SELECT title, body FROM kept ORDER BY id').all();
    expect(rows.map(r => r['title'])).toEqual(['first keep', 'private thing']);
    // the backup predates adoption, so it has no uuid column
    expect(() => backup.prepare('SELECT uuid FROM kept').all()).toThrow();
    backup.close();
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

  test('adds uuid and model additively and backfills fresh uuids, altering no content', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    buildPrototype(path);
    const s    = openDwelling(path);
    const rows = s.db.prepare('SELECT * FROM kept ORDER BY id').all();
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(first?.['title']).toBe('first keep');
    expect(first?.['body']).toBe('the oldest thing in the house');
    expect(first?.['added_utc']).toBe('2026-08-27T01:00:00.000Z');
    expect(String(first?.['uuid'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.['model']).toBeNull();
    expect(Number(second?.['visible'])).toBe(0);   // the private room stayed private
    const guest = s.db.prepare('SELECT * FROM guestbook').all();
    expect(guest[0]?.['text']).toBe('graffiti on the box');
    expect(String(guest[0]?.['uuid'])).toMatch(/^[0-9a-f-]{36}$/);
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

  test('creates the missing tables, seeds identity, backdates created_utc to the oldest keep', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    buildPrototype(path);
    const s = openDwelling(path);
    expect(readDwellingMeta(s.db, 'schema_version')).toBe(String(DWELLING_SCHEMA_VERSION));
    expect(readDwellingMeta(s.db, 'created_utc')).toBe('2026-08-27T01:00:00.000Z');
    expect(s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tag','kept_tag','link')").all()).toHaveLength(3);
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

  test('existing house rules are left exactly as found — never repainted', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    buildPrototype(path);
    const s = openDwelling(path);
    expect(readDwellingMeta(s.db, 'house_rules')).toBe('the walls the human and assistant painted together');
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

  test('a same-day re-adoption cannot overwrite the first backup', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    buildPrototype(path);
    const a = openDwelling(path);
    closeDwelling(a);
    // simulate a second pre-plugin database appearing at the same path
    rmSync(path);
    buildPrototype(path);
    const b = openDwelling(path);
    expect(b.adoptedBackup).not.toBe(a.adoptedBackup);
    expect(existsSync(String(a.adoptedBackup))).toBe(true);
    expect(existsSync(String(b.adoptedBackup))).toBe(true);
    closeDwelling(b); rmSync(dir, { recursive: true, force: true });
  });

  test('an adopted dwelling accepts new keeps immediately', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    buildPrototype(path);
    const s = openDwelling(path);
    expect(() => keep(s, { kind: 'toy', title: 'post-adoption', body: 'works' })).not.toThrow();
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

});

describe('openDwelling — refusal and read-only', () => {

  test('refuses a database it does not recognise, without modifying it', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3'),
          db  = new DatabaseSync(path);
    db.exec('CREATE TABLE unrelated (a TEXT)');
    db.close();
    expect(() => openDwelling(path)).toThrow(/refusing/);
    const check = new DatabaseSync(path);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toHaveLength(1);
    check.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('refuses a kept table missing required columns', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3'),
          db  = new DatabaseSync(path);
    db.exec('CREATE TABLE kept (id INTEGER PRIMARY KEY, note TEXT)');
    db.close();
    expect(() => openDwelling(path)).toThrow(/kind|added_utc|title|body/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('refuses a file that is not SQLite at all', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    writeFileSync(path, 'this is not a database, it is a poem');
    expect(() => openDwelling(path)).toThrow(/refusing/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a newer schema_version opens read-only rather than writing with stale assumptions', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    const a = openDwelling(path);
    writeDwellingMeta(a.db, 'schema_version', String(DWELLING_SCHEMA_VERSION + 1));
    closeDwelling(a);
    const b = openDwelling(path);
    expect(b.readOnly).toBe(true);
    expect(() => keep(b, { kind: 'toy', title: 'nope', body: 'nope' })).toThrow(/read-only/);
    closeDwelling(b); rmSync(dir, { recursive: true, force: true });
  });

  test('an unrecognisable schema_version is refused', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3');
    const a = openDwelling(path);
    writeDwellingMeta(a.db, 'schema_version', 'vintage');
    closeDwelling(a);
    expect(() => openDwelling(path)).toThrow(/schema_version/);
    rmSync(dir, { recursive: true, force: true });
  });

});

describe('dwellingSizeBytes', () => {

  test('reports a real size for a real file, and 0 when the file cannot be statted', () => {
    const dir = tmp(), path = join(dir, 'dwelling.sqlite3'),
          s   = openDwelling(path);
    expect(dwellingSizeBytes(s)).toBeGreaterThan(0);
    expect(dwellingSizeBytes({ ...s, path: join(dir, 'gone.sqlite3') })).toBe(0);
    closeDwelling(s); rmSync(dir, { recursive: true, force: true });
  });

});
