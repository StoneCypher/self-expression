/**
 * Configuration tests, including the one that matters most: the credential is read from
 * the environment and never appears in configuration, in either direction.
 */

import { describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { openStore, closeStore, writeConfig, allConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  DEFAULT_DAILY_CAP, DEFAULT_LOCAL_BASE_URL, DEFAULT_SESSION_CAP, DEFAULT_TIMEOUT_SECONDS,
  IMAGE_API_KEY_ENV_KEY, IMAGE_DAILY_CAP_KEY, IMAGE_ENABLED_KEY, IMAGE_LOCAL_BASE_URL_KEY,
  IMAGE_MODEL_KEY, IMAGE_PROVIDER_KEY, IMAGE_SESSION_CAP_KEY, IMAGE_TIMEOUT_KEY,
  credentialAvailable, credentialEnvVar, imageConfig, providerApiKeyEnvKey, resolveCredential,
} from '../imagery/config.js';
import { imageProvider } from '../imagery/providers.js';
import type { ImageProvider } from '../imagery/providers.js';
import { CONFIG_KEYS, effectiveConfig } from '../channels/config.js';

const FAKE_KEY = 'AIzaSyFAKE-0123456789abcdefghijklmnopqrs';

function withStore<T>(fn: (store: Store) => T): T {
  const dir   = mkdtempSync(join(tmpdir(), 'se-image-config-')),
        store = openStore(join(dir, 'log.sqlite3'));
  try { return fn(store); }
  finally { closeStore(store); rmSync(dir, { recursive: true, force: true }); }
}

function must(id: string): ImageProvider {
  const found = imageProvider(id);
  if (found === undefined) { throw new Error(`no provider ${id}`); }
  return found;
}

describe('imageConfig defaults', () => {

  test('ships dark, on the default provider, with conservative caps', () => withStore(store => {
    const config = imageConfig(store);
    expect(config.enabled).toBe(false);
    expect(config.provider.id).toBe('nanobanana');
    expect(config.model).toBe(config.provider.defaultModel);
    expect(config.sessionCap).toBe(DEFAULT_SESSION_CAP);
    expect(config.dailyCap).toBe(DEFAULT_DAILY_CAP);
    expect(config.timeoutSeconds).toBe(DEFAULT_TIMEOUT_SECONDS);
    expect(config.localBaseUrl).toBe(DEFAULT_LOCAL_BASE_URL);
  }));

  test('only exactly true enables', () => withStore(store => {
    for (const value of ['TRUE', 'yes', '1', 'True', 'on', '']) {
      writeConfig(store, IMAGE_ENABLED_KEY, value);
      expect(imageConfig(store).enabled).toBe(false);
    }
    writeConfig(store, IMAGE_ENABLED_KEY, 'true');
    expect(imageConfig(store).enabled).toBe(true);
  }));

  test('an unknown provider name falls back rather than wedging the facility', () => withStore(store => {
    writeConfig(store, IMAGE_PROVIDER_KEY, 'midjourney');
    expect(imageConfig(store).provider.id).toBe('nanobanana');
  }));

  test('a model the provider does not list is ignored rather than sent', () => withStore(store => {
    writeConfig(store, IMAGE_PROVIDER_KEY, 'openai');
    writeConfig(store, IMAGE_MODEL_KEY, 'gpt-9-imagines');
    expect(imageConfig(store).model).toBe('gpt-image-1');
    writeConfig(store, IMAGE_MODEL_KEY, 'dall-e-3');
    expect(imageConfig(store).model).toBe('dall-e-3');
  }));

  test('out-of-range and malformed numbers behave as unset', () => withStore(store => {
    writeConfig(store, IMAGE_SESSION_CAP_KEY, 'lots');
    writeConfig(store, IMAGE_DAILY_CAP_KEY,   '-4');
    writeConfig(store, IMAGE_TIMEOUT_KEY,     '99999');
    const config = imageConfig(store);
    expect(config.sessionCap).toBe(DEFAULT_SESSION_CAP);
    expect(config.dailyCap).toBe(DEFAULT_DAILY_CAP);
    expect(config.timeoutSeconds).toBe(DEFAULT_TIMEOUT_SECONDS);
  }));

  test('a zero cap is honoured — it is a real choice, not a malformed one', () => withStore(store => {
    writeConfig(store, IMAGE_SESSION_CAP_KEY, '0');
    expect(imageConfig(store).sessionCap).toBe(0);
  }));

  test('a blank local base url falls back rather than producing a bare path', () => withStore(store => {
    writeConfig(store, IMAGE_LOCAL_BASE_URL_KEY, '   ');
    expect(imageConfig(store).localBaseUrl).toBe(DEFAULT_LOCAL_BASE_URL);
  }));

});

describe('credentialEnvVar — which variable, and in which order', () => {

  test('falls back to the provider default when nothing is configured', () => withStore(store => {
    expect(credentialEnvVar(store, must('openai'))).toBe('OPENAI_API_KEY');
    expect(credentialEnvVar(store, must('nanobanana'))).toBe('GEMINI_API_KEY');
  }));

  test('the single-key spelling overrides the provider default', () => withStore(store => {
    writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'WORK_IMAGE_KEY');
    expect(credentialEnvVar(store, must('openai'))).toBe('WORK_IMAGE_KEY');
  }));

  test('the per-provider spelling overrides the single-key spelling', () => withStore(store => {
    writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'WORK_IMAGE_KEY');
    writeConfig(store, providerApiKeyEnvKey('openai'), 'PERSONAL_OPENAI');
    expect(credentialEnvVar(store, must('openai'))).toBe('PERSONAL_OPENAI');
    expect(credentialEnvVar(store, must('nanobanana'))).toBe('WORK_IMAGE_KEY');
  }));

  test('a blank override falls through to the next rule', () => withStore(store => {
    writeConfig(store, providerApiKeyEnvKey('openai'), '   ');
    expect(credentialEnvVar(store, must('openai'))).toBe('OPENAI_API_KEY');
  }));

  test('a provider needing no credential names none, whatever is configured', () => withStore(store => {
    writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'WORK_IMAGE_KEY');
    expect(credentialEnvVar(store, must('automatic1111'))).toBeNull();
  }));

});

describe('resolveCredential — the only contact with the secret', () => {

  test('reads the named variable at call time', () => withStore(store => {
    const state = resolveCredential(imageConfig(store), { GEMINI_API_KEY: FAKE_KEY });
    expect(state).toEqual({ needed: true, envVar: 'GEMINI_API_KEY', present: true, value: FAKE_KEY });
  }));

  test('an unset variable is absent rather than an error', () => withStore(store => {
    const state = resolveCredential(imageConfig(store), {});
    expect(state.present).toBe(false);
    expect(state.value).toBeNull();
    expect(state.envVar).toBe('GEMINI_API_KEY');
  }));

  test('a whitespace-only variable is absent, not a credential of spaces', () => withStore(store => {
    expect(resolveCredential(imageConfig(store), { GEMINI_API_KEY: '   ' }).present).toBe(false);
  }));

  test('a value is trimmed, because a trailing newline is the classic dotfile mistake', () => withStore(store => {
    expect(resolveCredential(imageConfig(store), { GEMINI_API_KEY: `${FAKE_KEY}\n` }).value).toBe(FAKE_KEY);
  }));

  test('reads the variable the configuration renamed, not the provider default', () => withStore(store => {
    writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'ELSEWHERE');
    const state = resolveCredential(imageConfig(store), { GEMINI_API_KEY: 'wrong', ELSEWHERE: FAKE_KEY });
    expect(state.value).toBe(FAKE_KEY);
  }));

  test('a provider needing no credential is always satisfied', () => withStore(store => {
    writeConfig(store, IMAGE_PROVIDER_KEY, 'automatic1111');
    const state = resolveCredential(imageConfig(store), {});
    expect(state).toEqual({ needed: false, envVar: null, present: true, value: null });
  }));

  test('credentialAvailable answers without keeping the value anywhere', () => withStore(store => {
    expect(credentialAvailable(imageConfig(store), { GEMINI_API_KEY: FAKE_KEY })).toBe(true);
    expect(credentialAvailable(imageConfig(store), {})).toBe(false);
  }));

});

describe('the credential never enters configuration', () => {

  test('ImageConfig has a variable NAME and nowhere for a value', () => withStore(store => {
    const config = imageConfig(store);
    expect(config.credentialEnvVar).toBe('GEMINI_API_KEY');
    expect(JSON.stringify({ ...config, provider: config.provider.id })).not.toContain(FAKE_KEY);
  }));

  test('reading the config with the key live in the environment stores nothing', () => withStore(store => {
    process.env['SE_TEST_IMAGE_KEY'] = FAKE_KEY;
    try {
      writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'SE_TEST_IMAGE_KEY');
      writeConfig(store, IMAGE_ENABLED_KEY, 'true');
      const config = imageConfig(store);
      expect(resolveCredential(config).value).toBe(FAKE_KEY);           // it really is readable
      expect(JSON.stringify(allConfig(store))).not.toContain(FAKE_KEY); // and it really is not stored
    } finally {
      delete process.env['SE_TEST_IMAGE_KEY'];
    }
  }));

  test('the effective-config listing prints the name and never a value', () => withStore(store => {
    writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'SE_TEST_IMAGE_KEY');
    const line = effectiveConfig(store).find(entry => entry.key === IMAGE_API_KEY_ENV_KEY);
    expect(line?.value).toBe('SE_TEST_IMAGE_KEY');
  }));

});

describe('registry registration', () => {

  test('every image key the facility reads is registered, so configure can set it', () => {
    const registered = new Set(CONFIG_KEYS.map(def => def.key));
    for (const key of [IMAGE_ENABLED_KEY, IMAGE_PROVIDER_KEY, IMAGE_API_KEY_ENV_KEY,
                       IMAGE_MODEL_KEY, IMAGE_SESSION_CAP_KEY, IMAGE_DAILY_CAP_KEY,
                       IMAGE_TIMEOUT_KEY, IMAGE_LOCAL_BASE_URL_KEY]) {
      expect(registered.has(key)).toBe(true);
    }
  });

  test('every provider gets its own credential-variable key without a code change', () => {
    const registered = new Set(CONFIG_KEYS.map(def => def.key));
    for (const provider of ['nanobanana', 'openai', 'automatic1111'] as const) {
      expect(registered.has(providerApiKeyEnvKey(provider))).toBe(true);
    }
  });

  test('image.provider only accepts a registered provider id', () => {
    const def = CONFIG_KEYS.find(entry => entry.key === IMAGE_PROVIDER_KEY);
    expect(def?.validate('openai').ok).toBe(true);
    expect(def?.validate('midjourney').ok).toBe(false);
  });

  test('no registered image key is named in a way that invites storing a key', () => {
    for (const def of CONFIG_KEYS.filter(entry => entry.key.startsWith('image.'))) {
      const looksLikeStorage = /api_key$|\bkey$|secret|token|credential$/.test(def.key);
      expect(looksLikeStorage).toBe(false);
    }
  });

});
