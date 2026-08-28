import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import {
  DWELLING_ENABLED_KEY, DWELLING_PATH_KEY, DWELLING_SIZE_WARN_KEY, DEFAULT_SIZE_WARN_GB,
  dwellingConfig, activeDwellingDir, rejectDwellingWrite, dwellingChangeNotice,
} from '../dwelling/config.js';

function withStore<T>(fn: (s: Store, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-dwell-config-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s, dir); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

describe('dwellingConfig', () => {

  test('ships dark: disabled, no path, 10 GB threshold', () => withStore(s => {
    expect(dwellingConfig(s)).toEqual({ enabled: false, path: null, sizeWarnGb: DEFAULT_SIZE_WARN_GB });
  }));

  test('reads overrides once set', () => withStore((s, dir) => {
    writeConfig(s, DWELLING_ENABLED_KEY,   'true');
    writeConfig(s, DWELLING_PATH_KEY,      dir);
    writeConfig(s, DWELLING_SIZE_WARN_KEY, '25');
    expect(dwellingConfig(s)).toEqual({ enabled: true, path: dir, sizeWarnGb: 25 });
  }));

  test('a malformed size threshold falls back to the default, never to no-warning', () => withStore(s => {
    writeConfig(s, DWELLING_SIZE_WARN_KEY, 'lots');
    expect(dwellingConfig(s).sizeWarnGb).toBe(DEFAULT_SIZE_WARN_GB);
    writeConfig(s, DWELLING_SIZE_WARN_KEY, '-3');
    expect(dwellingConfig(s).sizeWarnGb).toBe(DEFAULT_SIZE_WARN_GB);
  }));

});

describe('activeDwellingDir', () => {

  test('inactive when unconfigured', () => withStore(s => {
    expect(activeDwellingDir(s)).toBeNull();
  }));

  test('inactive when enabled but no path — never a silent default location', () => withStore(s => {
    writeConfig(s, DWELLING_ENABLED_KEY, 'true');
    expect(activeDwellingDir(s)).toBeNull();
  }));

  test('inactive when a path is set but the feature is off', () => withStore((s, dir) => {
    writeConfig(s, DWELLING_PATH_KEY, dir);
    expect(activeDwellingDir(s)).toBeNull();
  }));

  test('active when enabled with a valid path', () => withStore((s, dir) => {
    writeConfig(s, DWELLING_ENABLED_KEY, 'true');
    writeConfig(s, DWELLING_PATH_KEY,    dir);
    expect(activeDwellingDir(s)).toBe(dir);
  }));

  test('deactivates when the configured directory has vanished', () => withStore((s, dir) => {
    writeConfig(s, DWELLING_ENABLED_KEY, 'true');
    writeConfig(s, DWELLING_PATH_KEY,    dir);
    expect(activeDwellingDir(s, () => false)).toBeNull();
  }));

});

describe('rejectDwellingWrite', () => {

  test('keys outside dwelling.* are not its business', () => withStore(s => {
    expect(rejectDwellingWrite(s, 'retention.days', 'anything')).toBeNull();
  }));

  test('enabled accepts only true/false', () => withStore(s => {
    expect(rejectDwellingWrite(s, DWELLING_ENABLED_KEY, 'yes')).toContain('error:');
    expect(rejectDwellingWrite(s, DWELLING_ENABLED_KEY, 'false')).toBeNull();
  }));

  test('enabling without a path is an error surfaced at the configure call', () => withStore(s => {
    const out = rejectDwellingWrite(s, DWELLING_ENABLED_KEY, 'true');
    expect(out).toContain('error:');
    expect(out).toContain('dwelling.path');
  }));

  test('enabling with a stale path is refused too', () => withStore((s, dir) => {
    writeConfig(s, DWELLING_PATH_KEY, dir);
    expect(rejectDwellingWrite(s, DWELLING_ENABLED_KEY, 'true', () => false)).toContain('does not exist');
    expect(rejectDwellingWrite(s, DWELLING_ENABLED_KEY, 'true', () => true)).toBeNull();
  }));

  test('path must be absolute and existing; the plugin never creates the directory', () => withStore(s => {
    expect(rejectDwellingWrite(s, DWELLING_PATH_KEY, 'relative/house', () => true)).toContain('absolute');
    expect(rejectDwellingWrite(s, DWELLING_PATH_KEY, join(tmpdir(), 'se-nonesuch-house'))).toContain('does not exist');
  }));

  test('a real directory is accepted as the path', () => withStore((s, dir) => {
    expect(rejectDwellingWrite(s, DWELLING_PATH_KEY, dir)).toBeNull();
  }));

  test('size_warn_gb must be a non-negative integer (0 warns on every visit)', () => withStore(s => {
    expect(rejectDwellingWrite(s, DWELLING_SIZE_WARN_KEY, '10')).toBeNull();
    expect(rejectDwellingWrite(s, DWELLING_SIZE_WARN_KEY, '0')).toBeNull();
    expect(rejectDwellingWrite(s, DWELLING_SIZE_WARN_KEY, '-3')).toContain('error:');
    expect(rejectDwellingWrite(s, DWELLING_SIZE_WARN_KEY, '2.5')).toContain('error:');
    expect(rejectDwellingWrite(s, DWELLING_SIZE_WARN_KEY, 'big')).toContain('error:');
  }));

});

describe('dwellingChangeNotice', () => {

  test('activation keys carry the next-session note; others do not', () => {
    expect(dwellingChangeNotice(DWELLING_ENABLED_KEY)).toContain('next session');
    expect(dwellingChangeNotice(DWELLING_PATH_KEY)).toContain('next session');
    expect(dwellingChangeNotice(DWELLING_SIZE_WARN_KEY)).toBeNull();
    expect(dwellingChangeNotice('retention.days')).toBeNull();
  });

});
