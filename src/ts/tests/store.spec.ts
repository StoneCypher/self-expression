import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir }                          from 'node:os';
import { join }                            from 'node:path';
import {
  openStore, closeStore, readMeta, writeMeta,
  readConfig, writeConfig, allConfig,
} from '../channels/store.js';
import { SCHEMA_VERSION } from '../channels/schema.js';
import { stamp, clockTime, zoneAbbreviation } from '../channels/time.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'se-store-')); }

describe('openStore', () => {

  test('creates the data directory when it does not exist', () => {
    const dir  = tmp(),
          path = join(dir, 'nested', 'deeper', 'log.sqlite3'),
          s    = openStore(path);
    expect(existsSync(path)).toBe(true);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('seeds schema_version, created_utc, platform, and machine_id', () => {
    const dir = tmp(), s = openStore(join(dir, 'log.sqlite3'));
    expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));
    expect(readMeta(s, 'created_utc')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readMeta(s, 'platform')).toBeTruthy();
    expect(s.machineId).toMatch(/^[0-9a-f-]{36}$/);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('machine_id and created_utc are stable across reopens', () => {
    const dir  = tmp(),
          path = join(dir, 'log.sqlite3'),
          a    = openStore(path);
    const id = a.machineId, created = readMeta(a, 'created_utc');
    closeStore(a);
    const b = openStore(path);
    expect(b.machineId).toBe(id);
    expect(readMeta(b, 'created_utc')).toBe(created);
    closeStore(b); rmSync(dir, { recursive: true, force: true });
  });

  test('a fresh install gets a different machine_id — a reinstall is a real discontinuity', () => {
    const d1 = tmp(), d2 = tmp(),
          a  = openStore(join(d1, 'log.sqlite3')),
          b  = openStore(join(d2, 'log.sqlite3'));
    expect(a.machineId).not.toBe(b.machineId);
    closeStore(a); closeStore(b);
    rmSync(d1, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true });
  });

  test('reopening is a no-op, not an error', () => {
    const dir = tmp(), path = join(dir, 'log.sqlite3');
    const a = openStore(path); closeStore(a);
    expect(() => { const b = openStore(path); closeStore(b); }).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

});

describe('config', () => {

  test('an unset key reads as null so the default can live in code', () => {
    const dir = tmp(), s = openStore(join(dir, 'log.sqlite3'));
    expect(readConfig(s, 'gate.signature')).toBeNull();
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('round-trips strings, numbers, and booleans as text', () => {
    const dir = tmp(), s = openStore(join(dir, 'log.sqlite3'));
    writeConfig(s, 'retention.days', 90);
    writeConfig(s, 'gate.checklist', false);
    writeConfig(s, 'format.version', 'v18');
    expect(readConfig(s, 'retention.days')).toBe('90');
    expect(readConfig(s, 'gate.checklist')).toBe('false');
    expect(readConfig(s, 'format.version')).toBe('v18');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('writing the same key twice updates rather than duplicating', () => {
    const dir = tmp(), s = openStore(join(dir, 'log.sqlite3'));
    writeConfig(s, 'k', 'first');
    writeConfig(s, 'k', 'second');
    expect(readConfig(s, 'k')).toBe('second');
    expect(Object.keys(allConfig(s))).toHaveLength(1);
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('preserves keys it does not recognise, so a downgrade cannot destroy settings', () => {
    const dir = tmp(), s = openStore(join(dir, 'log.sqlite3'));
    writeConfig(s, 'some.future.key', 'from a newer version');
    expect(allConfig(s)['some.future.key']).toBe('from a newer version');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

  test('config and meta are separate — clearing config cannot lose schema_version', () => {
    const dir = tmp(), s = openStore(join(dir, 'log.sqlite3'));
    writeConfig(s, 'a', '1');
    s.db.exec('DELETE FROM config');
    expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

});

describe('meta', () => {

  test('writeMeta replaces rather than duplicating', () => {
    const dir = tmp(), s = openStore(join(dir, 'log.sqlite3'));
    writeMeta(s, 'x', 'one'); writeMeta(s, 'x', 'two');
    expect(readMeta(s, 'x')).toBe('two');
    closeStore(s); rmSync(dir, { recursive: true, force: true });
  });

});

describe('time', () => {

  test('clockTime uses 12-hour form with no leading zero', () => {
    expect(clockTime(new Date(2026, 7, 18,  9, 14))).toBe('9:14 am');
    expect(clockTime(new Date(2026, 7, 18, 21,  5))).toBe('9:05 pm');
  });

  test('midnight and noon are 12, not 0', () => {
    expect(clockTime(new Date(2026, 7, 18,  0,  3))).toBe('12:03 am');
    expect(clockTime(new Date(2026, 7, 18, 12,  0))).toBe('12:00 pm');
  });

  test('zoneAbbreviation never throws and never returns empty', () => {
    expect(zoneAbbreviation(new Date()).length).toBeGreaterThan(0);
  });

  test('stamp carries utc, rendered local, and the zone separately', () => {
    const s = stamp(new Date('2026-08-18T16:14:00Z'));
    expect(s.utc).toBe('2026-08-18T16:14:00.000Z');
    expect(s.local).toContain(s.tz);
    expect(s.local).toMatch(/^\d{1,2}:\d{2} (am|pm) /);
  });

});
