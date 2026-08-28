import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { openStore, closeStore, readMeta, writeMeta } from '../channels/store.js';
import { recordEntry, seriesPercents }                from '../channels/entries.js';
import { migrate, MIGRATIONS, V1_ENTRY_COLUMNS, V3_ENTRY_COLUMNS } from '../channels/migrate.js';
import {
  SCHEMA_VERSION, INDEX_DDL, MESSAGE_INDEX_DDL, NOTE_INDEX_DDL, entriesDdl,
} from '../channels/schema.js';
import { postMessage, readMessages, unreadCounts }    from '../channels/messages.js';
import { composeNote, listNotes }                     from '../channels/notes.js';
import { writeConfig }                                from '../channels/store.js';
import { anchoredEntries }                            from '../channels/entries.js';
import { buildV1, insertV1 }                          from './helpers/v1_fixture.js';
import { buildV2, insertV2 }                          from './helpers/v2_fixture.js';
import { buildV3, insertV3 }                          from './helpers/v3_fixture.js';
import { buildV4, insertV4Message, V4_ENTRIES_DDL }   from './helpers/v4_fixture.js';

const VERSION = '0.2.0';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'se-migrate-')); }

describe('the v1 fixture', () => {

  test('really is v1: it rejects the vocabulary this migration exists to admit', () => {
    const dir = tmp(), db = buildV1(join(dir, 'log.sqlite3'));
    expect(() => insertV1(db, 'u-taste', 'taste')).toThrow();
    expect(() => insertV1(db, 'u-pred', 'confidence', { confidence: 'predicted' })).toThrow();
    expect(() => insertV1(db, 'u-faded', 'divergence', { divergence_kind: 'faded' })).toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

});

describe('openStore on a v1 database', () => {

  test('migrates: rows survive, new columns exist, the new vocabulary writes succeed', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v1  = buildV1(path);
    insertV1(v1, 'u1', 'signature', { position: 'close', stem: 'still', face: '🙂' });
    insertV1(v1, 'u2', 'need');
    insertV1(v1, 'u3', 'checklist', { series_key: 'atlas', title: 'Project Atlas', percent: 40 });
    insertV1(v1, 'u4', 'divergence', { divergence_kind: 'stale' });
    v1.close();

    const s = openStore(path);

    expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));

    const rows = s.db.prepare('SELECT * FROM entries ORDER BY id').all();
    expect(rows).toHaveLength(4);
    expect(rows[0]?.uuid).toBe('u1');
    expect(rows[0]?.stem).toBe('still');
    expect(rows[0]?.face).toBe('🙂');
    expect(rows[2]?.series_key).toBe('atlas');
    expect(rows[2]?.percent).toBe(40);
    expect(rows[3]?.divergence_kind).toBe('stale');
    for (const row of rows) {
      expect(row).toHaveProperty('resolve_by', null);
      expect(row).toHaveProperty('outcome',    null);
      expect(row).toHaveProperty('silence',    null);
    }

    // The whole point: writes v1 CHECKs rejected now succeed through the normal path.
    recordEntry(s, { channel: 'taste', text: 'the sparse-column decision reads like it was always true', session: 's1' }, VERSION);
    recordEntry(s, { channel: 'load',  text: 'context 72% full, 3 agents in flight', session: 's1' }, VERSION);
    const forecast = recordEntry(s, { channel: 'confidence', text: 'passes untouched', session: 's1',
                                      confidence: 'predicted', resolveBy: '2026-08-30' }, VERSION);
    recordEntry(s, { channel: 'confidence', text: 'merged clean', session: 's1',
                     correctsId: forecast.id, outcome: 'hit' }, VERSION);
    recordEntry(s, { channel: 'divergence', text: 'which way is gone', session: 's1',
                     divergenceKind: 'faded' }, VERSION);
    recordEntry(s, { channel: 'signature', text: 'still; nothing notable', session: 's1',
                     silence: 'empty' }, VERSION);

    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(10);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('preserves ids across the rebuild, so the corrects_id chain stays valid', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v1  = buildV1(path);
    insertV1(v1, 'u1', 'confidence', { confidence: 'guessed' });
    insertV1(v1, 'u2', 'confidence', { corrects_id: 1 });
    v1.close();

    const s = openStore(path);
    const rows = s.db.prepare('SELECT id, uuid, corrects_id FROM entries ORDER BY id').all();
    expect(rows[0]?.id).toBe(1);
    expect(rows[1]?.corrects_id).toBe(1);

    // AUTOINCREMENT continuity: the next insert does not reuse an id.
    const written = recordEntry(s, { channel: 'idea', text: 'x', session: 's1' }, VERSION);
    expect(written.id).toBe(3);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('recreates the entries indices the rebuild drops', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV1(path).close();
    const s = openStore(path);
    const idx = s.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                    .all().map(r => r.name as string);
    expect(idx).toHaveLength(INDEX_DDL.length + MESSAGE_INDEX_DDL.length);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('a series recorded under v1 still replays after migration (#27 contract holds)', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v1  = buildV1(path);
    for (const [i, percent] of [10, 50, 90].entries()) {
      insertV1(v1, `u-${String(i)}`, 'checklist', { series_key: 'k', percent });
    }
    v1.close();
    const s = openStore(path);
    expect(seriesPercents(s, 'k')).toEqual([10, 50, 90]);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('reopening after migration is idempotent — a no-op, not a second rebuild', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v1  = buildV1(path);
    insertV1(v1, 'u1', 'signature');
    v1.close();
    const a = openStore(path);
    recordEntry(a, { channel: 'taste', text: 'x', session: 's1' }, VERSION);
    closeStore(a);
    const b = openStore(path);
    expect(readMeta(b, 'schema_version')).toBe(String(SCHEMA_VERSION));
    expect(b.db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(2);
    closeStore(b); rmSync(dir, { recursive: true, force: true });
  });

  test('meta identity survives migration: created_utc and machine_id are untouched', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV1(path).close();
    const s = openStore(path);
    expect(readMeta(s, 'created_utc')).toBe('2026-08-18T00:00:00Z');
    expect(s.machineId).toBe('11111111-2222-3333-4444-555555555555');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

});

describe('openStore on a v2 database (#41)', () => {

  test('the fixture really is v2: no messagebox tables, but the v2 vocabulary writes', () => {
    const dir = tmp(), db = buildV2(join(dir, 'log.sqlite3'));
    insertV2(db, 'u-taste', 'taste');
    insertV2(db, 'u-pred', 'confidence', { confidence: 'predicted', resolve_by: '2026-08-30' });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
                     .all().map(r => String(r.name));
    expect(tables).not.toContain('messages');
    expect(tables).not.toContain('message_reads');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('migrates additively: entries untouched, messagebox tables usable, version stamped', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v2  = buildV2(path);
    insertV2(v2, 'u1', 'signature', { position: 'close', stem: 'still', silence: 'empty' });
    insertV2(v2, 'u2', 'taste');
    // Named columns, not SELECT *: v2's entries columns are exactly V3_ENTRY_COLUMNS
    // (v2→v3 added tables, not columns), and the later v3→v4 step legitimately widens
    // the row — this asserts nothing v2 held has changed, not that nothing was added.
    const columns = V3_ENTRY_COLUMNS.join(', '),
          before  = JSON.parse(JSON.stringify(
            v2.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;
    v2.close();

    const s = openStore(path);
    expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));
    const after = JSON.parse(JSON.stringify(
      s.db.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;
    expect(after).toEqual(before);

    // The whole point: the messagebox works through the normal path post-migration.
    postMessage(s, { audience: 'self', text: 'note to future self', session: 's1' }, '0.2.1');
    expect(readMessages(s, { reader: 'model', session: 's1' }, {})).toHaveLength(1);

    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('meta identity survives migration: created_utc and machine_id are untouched', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV2(path).close();
    const s = openStore(path);
    expect(readMeta(s, 'created_utc')).toBe('2026-08-27T00:00:00Z');
    expect(s.machineId).toBe('22222222-3333-4444-5555-666666666666');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('reopening after migration is idempotent — a no-op, not a second pass', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV2(path).close();
    const a = openStore(path);
    postMessage(a, { audience: 'record', text: 'for posterity', session: 's1' }, '0.2.1');
    closeStore(a);
    const b = openStore(path);
    expect(readMeta(b, 'schema_version')).toBe(String(SCHEMA_VERSION));
    expect(b.db.prepare('SELECT COUNT(*) n FROM messages').get().n).toBe(1);
    closeStore(b); rmSync(dir, { recursive: true, force: true });
  });

});

describe('openStore on a v3 database (#18)', () => {

  test('the fixture really is v3: no anchor columns at all, but the v3 vocabulary writes', () => {
    const dir = tmp(), db = buildV3(join(dir, 'log.sqlite3'));
    insertV3(db, 'u-pred', 'confidence', { confidence: 'predicted', resolve_by: '2026-08-30' });
    expect(() => insertV3(db, 'u-anchor', 'dissent', { anchor_kind: 'file' })).toThrow();
    const columns = db.prepare("SELECT name FROM pragma_table_info('entries')")
                      .all().map(r => String(r.name));
    expect(columns).not.toContain('anchor_kind');
    expect(columns).toContain('silence');
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('migrates: rows survive byte-for-byte, anchor columns arrive NULL, version stamped', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v3  = buildV3(path);
    insertV3(v3, 'u1', 'signature', { position: 'close', stem: 'still', silence: 'empty' });
    insertV3(v3, 'u2', 'taste');
    insertV3(v3, 'u3', 'checklist', { series_key: 'atlas', percent: 40 });
    const columns = V3_ENTRY_COLUMNS.join(', '),
          before  = JSON.parse(JSON.stringify(
            v3.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;
    v3.close();

    const s = openStore(path);
    expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));
    const after = JSON.parse(JSON.stringify(
      s.db.prepare(`SELECT ${columns} FROM entries ORDER BY id`).all())) as unknown;
    expect(after).toEqual(before);

    for (const row of s.db.prepare('SELECT * FROM entries').all()) {
      expect(row).toHaveProperty('anchor_kind',   null);
      expect(row).toHaveProperty('anchor_target', null);
      expect(row).toHaveProperty('anchor_span',   null);
      expect(row).toHaveProperty('anchor_quote',  null);
      expect(row).toHaveProperty('anchor_hash',   null);
    }

    // The whole point: an anchored write the v3 CHECKs could not even name now succeeds.
    recordEntry(s, { channel: 'dissent', text: 'null for unset and for empty', session: 's1',
                     anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts',
                     anchorSpan: 'L141', anchorQuote: 'readConfig(store, key)' }, VERSION);
    expect(anchoredEntries(s, 'file', 'src/ts/channels/store.ts')).toHaveLength(1);

    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('preserves ids across the rebuild, so the corrects_id chain stays valid', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v3  = buildV3(path);
    insertV3(v3, 'u1', 'confidence', { confidence: 'guessed' });
    insertV3(v3, 'u2', 'confidence', { corrects_id: 1 });
    v3.close();

    const s    = openStore(path),
          rows = s.db.prepare('SELECT id, uuid, corrects_id FROM entries ORDER BY id').all();
    expect(rows[0]?.id).toBe(1);
    expect(rows[1]?.corrects_id).toBe(1);
    expect(recordEntry(s, { channel: 'idea', text: 'x', session: 's1' }, VERSION).id).toBe(3);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('creates idx_entries_anchor, which a v3 database could not have held', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV3(path).close();
    const s   = openStore(path),
          idx = s.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                    .all().map(r => r.name as string);
    expect(idx).toContain('idx_entries_anchor');
    expect(idx).toHaveLength(INDEX_DDL.length + MESSAGE_INDEX_DDL.length + NOTE_INDEX_DDL.length);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('the messagebox survives the entries rebuild untouched', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v3  = buildV3(path);
    v3.prepare(
      `INSERT INTO messages (uuid, ts_utc, ts_local, tz, session, machine_id, audience, text, plugin_version)
       VALUES ('m-1','2026-08-28T00:00:00Z','9:14 am PDT','PDT','s1','m1','self','pre-migration','0.2.1')`).run();
    v3.close();
    const s = openStore(path);
    expect(readMessages(s, { reader: 'model', session: 's1' }, {})).toHaveLength(1);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('meta identity survives migration: created_utc and machine_id are untouched', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV3(path).close();
    const s = openStore(path);
    expect(readMeta(s, 'created_utc')).toBe('2026-08-28T00:00:00Z');
    expect(s.machineId).toBe('33333333-4444-5555-6666-777777777777');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('reopening after migration is idempotent — a no-op, not a second rebuild', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV3(path).close();
    const a = openStore(path);
    recordEntry(a, { channel: 'dissent', text: 'x', session: 's1',
                     anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1' }, VERSION);
    closeStore(a);
    const b = openStore(path);
    expect(readMeta(b, 'schema_version')).toBe(String(SCHEMA_VERSION));
    expect(b.db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(1);
    closeStore(b); rmSync(dir, { recursive: true, force: true });
  });

});

describe('openStore on a v4 database (#43)', () => {

  test('the fixture really is v4: no note tables at all', () => {
    const dir = tmp(), db = buildV4(join(dir, 'log.sqlite3'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
                     .all().map(r => String(r.name));
    expect(tables).toContain('messages');
    expect(tables).not.toContain('notes');
    expect(tables).not.toContain('note_events');
    expect(() => db.exec('SELECT 1 FROM notes')).toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('V4_ENTRIES_DDL still describes v4 — v4→v5 must stay additive', () => {
    // The v4 fixture generates its entries DDL from the schema module, which is only
    // sound while v4→v5 adds no entries column. If a later version widens the table,
    // this fails and the fixture must be frozen the way v1's and v2's are.
    expect(V4_ENTRIES_DDL).toBe(entriesDdl());
  });

  test('migrates: the messagebox survives untouched, and notes become usable', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v4  = buildV4(path);
    insertV4Message(v4, 'm-1', 'a pre-migration aside');
    v4.close();

    const s = openStore(path);
    expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));

    // The pre-existing `user` message is still ordinary unread mail — a migration must
    // not reclassify anything as a held note.
    expect(unreadCounts(s, 's1').forUser).toBe(1);

    writeConfig(s, 'mailbox.enabled', 'true');
    composeNote(s, { text: 'run reconcile first', reason: 'the deploy window', session: 's1' }, VERSION);
    expect(listNotes(s)).toHaveLength(1);
    expect(unreadCounts(s, 's1').forUser).toBe(1);   // the note is not plain user mail

    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('creates the note indices, which a v4 database could not have held', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV4(path).close();
    const s   = openStore(path),
          idx = s.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                    .all().map(r => r.name as string);
    expect(idx).toContain('idx_notes_ripe');
    expect(idx).toContain('idx_note_events');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('reopening after migration is idempotent — a no-op, not a second create', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV4(path).close();
    const a = openStore(path);
    writeConfig(a, 'mailbox.enabled', 'true');
    composeNote(a, { text: 'x', reason: 'y', session: 's1' }, VERSION);
    closeStore(a);
    const b = openStore(path);
    expect(readMeta(b, 'schema_version')).toBe(String(SCHEMA_VERSION));
    expect(b.db.prepare('SELECT COUNT(*) n FROM notes').get().n).toBe(1);
    closeStore(b); rmSync(dir, { recursive: true, force: true });
  });

  test('meta identity survives migration: created_utc and machine_id are untouched', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    buildV4(path).close();
    const s = openStore(path);
    expect(readMeta(s, 'created_utc')).toBe('2026-08-28T00:00:00Z');
    expect(s.machineId).toBe('44444444-5555-6666-7777-888888888888');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

});

describe('a v1 database walks the whole chain', () => {

  test('1 → 5 in one open: old rows intact, anchors, messagebox, and notes all usable', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          v1  = buildV1(path);
    insertV1(v1, 'u1', 'signature', { position: 'close', stem: 'still' });
    v1.close();

    const s = openStore(path);
    expect(readMeta(s, 'schema_version')).toBe('5');
    expect(s.db.prepare('SELECT uuid FROM entries').get().uuid).toBe('u1');

    const written = recordEntry(s, { channel: 'taste', text: 'reads like it was always true', session: 's1' }, VERSION);
    recordEntry(s, { channel: 'dissent', text: 'about that', session: 's1',
                     anchorKind: 'entry', anchorTarget: String(written.id) }, VERSION);
    postMessage(s, { audience: 'record', text: 'for posterity', session: 's1' }, VERSION);
    writeConfig(s, 'mailbox.enabled', 'true');
    composeNote(s, { text: 'held across four migrations', reason: 'it still matters',
                     session: 's1' }, VERSION);

    expect(anchoredEntries(s, 'entry', String(written.id))).toHaveLength(1);
    expect(listNotes(s)).toHaveLength(1);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

});

describe('openStore version guards', () => {

  test('a stored version newer than the code is an error, not a downgrade-in-place', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          s   = openStore(path);
    writeMeta(s, 'schema_version', String(SCHEMA_VERSION + 1));
    closeStore(s);
    expect(() => openStore(path)).toThrow(/newer/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a non-integer stored version is an error, never silently restamped', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3'),
          s   = openStore(path);
    writeMeta(s, 'schema_version', 'banana');
    closeStore(s);
    expect(() => openStore(path)).toThrow(/not an integer/);
    rmSync(dir, { recursive: true, force: true });
  });

});

describe('migrate', () => {

  test('from === to is a no-op', () => {
    const dir = tmp(), db = buildV1(join(dir, 'log.sqlite3'));
    expect(() => { migrate(db, 1, 1); }).not.toThrow();
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('a gap with no registered step is a loud error, never a silent skip', () => {
    const dir = tmp(), db = buildV1(join(dir, 'log.sqlite3'));
    expect(() => { migrate(db, 0, SCHEMA_VERSION); }).toThrow(/no migration step/);
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('the registered steps chain 1 → SCHEMA_VERSION with no gaps', () => {
    let at = 1;
    while (at < SCHEMA_VERSION) {
      const step = MIGRATIONS.find(m => m.from === at);
      expect(step).toBeDefined();
      at = step?.to ?? Number.NaN;
    }
    expect(at).toBe(SCHEMA_VERSION);
  });

  test('V1_ENTRY_COLUMNS names exactly the v1 columns, in a set sense', () => {
    const dir = tmp(), db = buildV1(join(dir, 'log.sqlite3'));
    const actual = db.prepare("SELECT name FROM pragma_table_info('entries')")
                     .all().map(r => String(r.name));
    expect([...V1_ENTRY_COLUMNS].sort()).toEqual([...actual].sort());
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('V3_ENTRY_COLUMNS names exactly the v3 columns, in a set sense', () => {
    const dir = tmp(), db = buildV3(join(dir, 'log.sqlite3'));
    const actual = db.prepare("SELECT name FROM pragma_table_info('entries')")
                     .all().map(r => String(r.name));
    expect([...V3_ENTRY_COLUMNS].sort()).toEqual([...actual].sort());
    db.close(); rmSync(dir, { recursive: true, force: true });
  });

  test('V3_ENTRY_COLUMNS is V1 plus exactly the three #42 columns', () => {
    expect(V3_ENTRY_COLUMNS.filter(c => !V1_ENTRY_COLUMNS.includes(c)))
      .toEqual(['resolve_by', 'outcome', 'silence']);
  });

});
