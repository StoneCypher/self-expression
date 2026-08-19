import { dataDir, dbPath, HOME_VAR, DEFAULT_DIR, DB_FILE } from '../channels/paths.js';
import { join }                                            from 'node:path';

describe('dataDir', () => {

  test('defaults to a dotdir in home', () => {
    expect(dataDir({}, '/Users/ada')).toBe(join('/Users/ada', DEFAULT_DIR));
  });

  test('honours the environment override', () => {
    expect(dataDir({ [HOME_VAR]: '/tmp/elsewhere' }, '/Users/ada')).toBe('/tmp/elsewhere');
  });

  test('treats a blank override as unset rather than as the filesystem root', () => {
    for (const blank of ['', '   ', '\t', '\n']) {
      expect(dataDir({ [HOME_VAR]: blank }, '/Users/ada')).toBe(join('/Users/ada', DEFAULT_DIR));
    }
  });

  test('ignores unrelated environment variables', () => {
    expect(dataDir({ CLAUDE_PLUGIN_DATA: '/somewhere/claude' }, '/Users/ada'))
      .toBe(join('/Users/ada', DEFAULT_DIR));
  });

  test('never resolves under a host-specific directory by default', () => {
    const resolved = dataDir({}, '/Users/ada');
    expect(resolved).not.toContain('.claude');
    expect(resolved).not.toContain('.codex');
    expect(resolved).not.toContain('.gemini');
  });

});

describe('dbPath', () => {

  test('is the database file inside the data directory', () => {
    expect(dbPath({}, '/Users/ada')).toBe(join('/Users/ada', DEFAULT_DIR, DB_FILE));
  });

  test('follows the override', () => {
    expect(dbPath({ [HOME_VAR]: '/tmp/x' }, '/h')).toBe(join('/tmp/x', DB_FILE));
  });

  test('is one file, not one per channel', () => {
    expect(dbPath({}, '/h').endsWith(DB_FILE)).toBe(true);
  });

});
