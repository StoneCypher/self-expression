import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join, sep }           from 'node:path';

import {
  DWELLING_DB_FILE, directoryExists, dwellingDbPath, validateDwellingDir,
} from '../dwelling/paths.js';

describe('directoryExists', () => {

  test('true for a real directory, false for a missing path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-dwell-paths-'));
    expect(directoryExists(dir)).toBe(true);
    expect(directoryExists(join(dir, 'nonesuch'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('false for a file — a dwelling.path must be a directory, not a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-dwell-paths-'));
    // the tmp dir itself is a directory; probe a path that is definitely not one
    expect(directoryExists(join(dir, 'x', 'y'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

});

describe('validateDwellingDir', () => {

  const yes = (): boolean => true;

  test('accepts an absolute path to an existing directory', () => {
    expect(validateDwellingDir(`${sep}absolute${sep}house`, yes)).toBeNull();
  });

  test('rejects an empty or whitespace value', () => {
    expect(validateDwellingDir('', yes)).toContain('error:');
    expect(validateDwellingDir('   ', yes)).toContain('error:');
  });

  test('rejects a relative path, naming what would be accepted', () => {
    const out = validateDwellingDir('relative/house', yes);
    expect(out).toContain('error:');
    expect(out).toContain('absolute');
  });

  test('rejects a missing directory rather than creating it — a typo must surface', () => {
    const out = validateDwellingDir(`${sep}no${sep}such${sep}dir`, () => false);
    expect(out).toContain('error:');
    expect(out).toContain('does not exist');
  });

  test('uses the real filesystem when no probe is injected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-dwell-paths-'));
    expect(validateDwellingDir(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
    expect(validateDwellingDir(dir)).toContain('does not exist');
  });

});

describe('dwellingDbPath', () => {

  test('pins the file name to dwelling.sqlite3 inside the chosen directory', () => {
    expect(dwellingDbPath(`${sep}house`)).toBe(join(`${sep}house`, DWELLING_DB_FILE));
    expect(DWELLING_DB_FILE).toBe('dwelling.sqlite3');
  });

});
