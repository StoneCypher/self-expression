import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { openLedger, closeLedger, recordStrike, playedSince } from '../claudio/ledger.js';
import type { AudioLedger, StrikeRecord } from '../claudio/ledger.js';
import { AUDIO_SCHEMA_VERSION } from '../claudio/schema.js';
import { audioDbPath, defaultAssetDir, AUDIO_DB_FILE } from '../claudio/paths.js';

function withLedger<T>(fn: (ledger: AudioLedger, dir: string) => T): T {
  const dir    = mkdtempSync(join(tmpdir(), 'se-claudio-ledger-')),
        ledger = openLedger(join(dir, 'audio.sqlite3'));
  try { return fn(ledger, dir); } finally { closeLedger(ledger); rmSync(dir, { recursive: true, force: true }); }
}

function record(overrides: Partial<StrikeRecord> = {}): StrikeRecord {
  return {
    kind: 'strike', leitmotif: 'spark', requestedVolume: null, playedVolume: 25,
    ceiling: 50, durationMs: 800, outcome: 'played', detail: null, text: null,
    pluginVersion: '0.0.0-test',
    ...overrides,
  };
}

describe('openLedger', () => {

  test('creates the file, the schema, and the version stamp', () => withLedger(ledger => {
    expect(existsSync(ledger.path)).toBe(true);
    const row = ledger.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    expect(row).toBeDefined();
    expect(String(row?.['value'])).toBe(String(AUDIO_SCHEMA_VERSION));
  }));

  test('reopening an existing ledger is a no-op that keeps its rows', () => withLedger((ledger, dir) => {
    recordStrike(ledger, record());
    closeLedger(ledger);
    const again = openLedger(join(dir, 'audio.sqlite3'));
    try {
      const count = again.db.prepare('SELECT COUNT(*) AS n FROM strikes').get();
      expect(Number(count?.['n'])).toBe(1);
    } finally { closeLedger(again); }
  }));

  test('closeLedger is safe to call twice', () => withLedger(ledger => {
    closeLedger(ledger);
    expect(() => { closeLedger(ledger); }).not.toThrow();
  }));

});

describe('recordStrike', () => {

  test('returns sequential ids and unique uuids', () => withLedger(ledger => {
    const first  = recordStrike(ledger, record()),
          second = recordStrike(ledger, record({ leitmotif: 'attention' }));
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(first.uuid).not.toBe(second.uuid);
  }));

  test('persists every field, refusals and say text included', () => withLedger(ledger => {
    recordStrike(ledger, record({
      kind: 'say', leitmotif: null, requestedVolume: 80, playedVolume: 0,
      durationMs: null, outcome: 'refused', detail: 'the hourly strike budget (6) is spent',
      text: 'the build is green',
    }));
    const row = ledger.db.prepare('SELECT * FROM strikes WHERE id = 1').get();
    expect(row?.['kind']).toBe('say');
    expect(row?.['leitmotif']).toBeNull();
    expect(Number(row?.['requested_volume'])).toBe(80);
    expect(Number(row?.['played_volume'])).toBe(0);
    expect(row?.['outcome']).toBe('refused');
    expect(String(row?.['detail'])).toContain('budget');
    expect(row?.['text']).toBe('the build is green');
    expect(row?.['plugin_version']).toBe('0.0.0-test');
  }));

  test('stamps the injected clock in all three time forms', () => withLedger(ledger => {
    const when = new Date('2026-08-28T05:06:07.000Z');
    recordStrike(ledger, record(), when);
    const row = ledger.db.prepare('SELECT struck_utc, local, tz FROM strikes WHERE id = 1').get();
    expect(row?.['struck_utc']).toBe('2026-08-28T05:06:07.000Z');
    expect(String(row?.['local'])).not.toBe('');
    expect(String(row?.['tz'])).not.toBe('');
  }));

  test('the schema CHECK refuses a vocabulary-breaking kind at the last layer', () => withLedger(ledger => {
    expect(() => ledger.db.prepare(
      "INSERT INTO strikes (uuid, struck_utc, local, tz, kind, played_volume, ceiling, outcome, plugin_version) " +
      "VALUES ('u','2026-01-01T00:00:00Z','x','y','doorbell',0,50,'played','0')"
    ).run()).toThrow();
  }));

});

describe('playedSince', () => {

  test('returns only played rows at or after the bound, oldest first', () => withLedger(ledger => {
    recordStrike(ledger, record(), new Date('2026-08-28T09:00:00.000Z'));
    recordStrike(ledger, record({ outcome: 'refused', playedVolume: 0, detail: 'gap' }), new Date('2026-08-28T10:30:00.000Z'));
    recordStrike(ledger, record({ outcome: 'error', detail: 'player exited 1' }),        new Date('2026-08-28T10:40:00.000Z'));
    recordStrike(ledger, record({ kind: 'audition' }), new Date('2026-08-28T10:45:00.000Z'));
    recordStrike(ledger, record({ leitmotif: 'attention' }), new Date('2026-08-28T10:50:00.000Z'));

    const recent = playedSince(ledger, '2026-08-28T10:00:00.000Z');
    expect(recent).toEqual([
      { utc: '2026-08-28T10:45:00.000Z', kind: 'audition', leitmotif: 'spark' },
      { utc: '2026-08-28T10:50:00.000Z', kind: 'strike',   leitmotif: 'attention' },
    ]);
  }));

  test('an empty ledger answers with an empty history', () => withLedger(ledger => {
    expect(playedSince(ledger, '2020-01-01T00:00:00.000Z')).toEqual([]);
  }));

});

describe('paths', () => {

  test('the ledger rides SELF_EXPRESSION_HOME beside the log, in its own file', () => {
    expect(audioDbPath({ SELF_EXPRESSION_HOME: '/tmp/xyz' }, '/h')).toBe(join('/tmp/xyz', AUDIO_DB_FILE));
    expect(audioDbPath({}, '/Users/ada')).toBe(join('/Users/ada', '.self-expression', AUDIO_DB_FILE));
  });

  test('the vendored assets sit one level above the bundle directory', () => {
    expect(defaultAssetDir(join('x', 'dist'))).toBe(join('x', 'assets', 'leitmotifs'));
  });

});
