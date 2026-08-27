import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { privacyFlags }                       from '../channels/privacy.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-privacy-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

describe('privacyFlags', () => {

  test('defaults to recording everything when unconfigured', () => withStore(s => {
    expect(privacyFlags(s)).toEqual({ storeCwd: true, storePromptLen: true });
  }));

  test("privacy.store_cwd = false suppresses the path fields only", () => withStore(s => {
    writeConfig(s, 'privacy.store_cwd', false);
    expect(privacyFlags(s)).toEqual({ storeCwd: false, storePromptLen: true });
  }));

  test("privacy.store_prompt_len = false suppresses the length only", () => withStore(s => {
    writeConfig(s, 'privacy.store_prompt_len', false);
    expect(privacyFlags(s)).toEqual({ storeCwd: true, storePromptLen: false });
  }));

  test('both can be suppressed at once', () => withStore(s => {
    writeConfig(s, 'privacy.store_cwd', false);
    writeConfig(s, 'privacy.store_prompt_len', false);
    expect(privacyFlags(s)).toEqual({ storeCwd: false, storePromptLen: false });
  }));

  test("only the exact string 'false' suppresses; anything else records", () => withStore(s => {
    writeConfig(s, 'privacy.store_cwd', 'true');
    expect(privacyFlags(s).storeCwd).toBe(true);
    writeConfig(s, 'privacy.store_cwd', 'no');
    expect(privacyFlags(s).storeCwd).toBe(true);
  }));

});
