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
  CREDENTIAL_ENV_DENYLIST, credentialAvailable, credentialEnvVar, credentialEnvVarAllowed,
  credentialEnvVarProblem, imageConfig, isLoopbackOrPrivateHost, localBaseUrlProblem,
  providerApiKeyEnvKey, resolveCredential,
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
    writeConfig(store, providerApiKeyEnvKey('openai'), 'PERSONAL_OPENAI_KEY');
    expect(credentialEnvVar(store, must('openai'))).toBe('PERSONAL_OPENAI_KEY');
    expect(credentialEnvVar(store, must('nanobanana'))).toBe('WORK_IMAGE_KEY');
  }));

  test('a blank override falls through to the next rule', () => withStore(store => {
    writeConfig(store, providerApiKeyEnvKey('openai'), '   ');
    expect(credentialEnvVar(store, must('openai'))).toBe('OPENAI_API_KEY');
  }));

  test('a stored name this facility will not read from falls through, however it got there',
    () => withStore(store => {
      // A row written before the rule existed, or edited in by hand, is not honoured just
      // because it is stored — otherwise the validator would be a suggestion.
      writeConfig(store, providerApiKeyEnvKey('openai'), 'ANTHROPIC_API_KEY');
      expect(credentialEnvVar(store, must('openai'))).toBe('OPENAI_API_KEY');

      writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'PATH');
      expect(credentialEnvVar(store, must('nanobanana'))).toBe('GEMINI_API_KEY');
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
    writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'ELSEWHERE_API_KEY');
    const state = resolveCredential(imageConfig(store),
                                    { GEMINI_API_KEY: 'wrong', ELSEWHERE_API_KEY: FAKE_KEY });
    expect(state.value).toBe(FAKE_KEY);
  }));

  test('a renamed variable this facility refuses is never read, even when it holds something',
    () => withStore(store => {
      // The whole hazard in one line: configure is model-callable, so an unchecked name
      // would let one vendor's secret be resolved and sent to another vendor's endpoint.
      writeConfig(store, IMAGE_API_KEY_ENV_KEY, 'ANTHROPIC_API_KEY');
      const state = resolveCredential(imageConfig(store),
                                      { ANTHROPIC_API_KEY: FAKE_KEY, GEMINI_API_KEY: 'the right one' });
      expect(state.envVar).toBe('GEMINI_API_KEY');
      expect(state.value).toBe('the right one');
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

describe('which variable names may be given at all', () => {

  test('an ordinary image credential variable is accepted', () => {
    for (const name of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'WORK_IMAGE_KEY',
                        'IMAGE_LOCAL_TOKEN', 'SELF_EXPRESSION_IMAGE', 'A1_KEY']) {
      expect(credentialEnvVarProblem(name)).toBeNull();
    }
  });

  test('a well-known credential belonging to something else is refused by name', () => {
    for (const name of CREDENTIAL_ENV_DENYLIST) {
      expect(credentialEnvVarAllowed(name)).toBe(false);
      expect(credentialEnvVarProblem(name)).toContain(name);
    }
  });

  test('a whole denied family is refused, not just the names anyone thought to list', () => {
    for (const name of ['AZURE_OPENAI_API_KEY', 'AZURE_CLIENT_SECRET_KEY', 'SSH_AUTH_KEY']) {
      expect(credentialEnvVarAllowed(name)).toBe(false);
    }
  });

  test('anything not shaped like a variable name is refused, naming the shape', () => {
    for (const raw of ['openai_api_key', 'MY KEY', 'sk-proj-realsecret', '', 'K', '9_KEY',
                       'OPENAI-API-KEY', `${'X'.repeat(129)}_KEY`]) {
      const problem = credentialEnvVarProblem(raw);
      expect(problem).not.toBeNull();
      expect(problem ?? '').toContain('SCREAMING_SNAKE_CASE');
    }
  });

  test('a name that does not read as a credential is refused even when it is harmless', () => {
    // The rule is positive, not merely a blocklist: a name has to look like a key.
    for (const name of ['EDITOR', 'MY_FAVOURITE_COLOUR', 'TMPDIR']) {
      expect(credentialEnvVarAllowed(name)).toBe(false);
    }
  });

  test('every registered provider default is a name this rule would accept', () => {
    for (const id of ['nanobanana', 'openai'] as const) {
      expect(credentialEnvVarAllowed(must(id).defaultEnvVar ?? '')).toBe(true);
    }
  });

});

describe('where the local provider may post', () => {

  test('loopback and the private ranges are local', () => {
    for (const host of ['localhost', 'dev.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]',
                        '10.0.0.4', '172.16.0.1', '172.31.255.254', '192.168.1.9']) {
      expect(isLoopbackOrPrivateHost(host)).toBe(true);
    }
  });

  test('everything else is not, including the near misses', () => {
    for (const host of ['example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1',
                        '11.0.0.1', 'localhost.evil.test', '999.0.0.1']) {
      expect(isLoopbackOrPrivateHost(host)).toBe(false);
    }
  });

  test('the default endpoint is one this rule accepts', () => {
    expect(localBaseUrlProblem(DEFAULT_LOCAL_BASE_URL)).toBeNull();
  });

  test('a remote endpoint is refused, and the message says why', () => {
    const problem = localBaseUrlProblem('https://images.example.test/api');
    expect(problem).not.toBeNull();
    expect(problem ?? '').toContain('images.example.test');
    expect(problem ?? '').toContain('remote host');
  });

  test('a non-URL, a non-HTTP scheme, and userinfo are each refused for their own reason', () => {
    expect(localBaseUrlProblem('127.0.0.1:7860') ?? '').toContain('absolute');
    expect(localBaseUrlProblem('file:///etc/passwd') ?? '').toContain('scheme');
    expect(localBaseUrlProblem('http://user:pw@127.0.0.1:7860') ?? '').toContain('userinfo');
  });

  test('a stored remote endpoint behaves as unset rather than being dialled', () => withStore(store => {
    writeConfig(store, IMAGE_LOCAL_BASE_URL_KEY, 'https://images.example.test');
    expect(imageConfig(store).localBaseUrl).toBe(DEFAULT_LOCAL_BASE_URL);
  }));

  test('a stored private endpoint is honoured, because that is the feature', () => withStore(store => {
    writeConfig(store, IMAGE_LOCAL_BASE_URL_KEY, 'http://192.168.1.40:7860');
    expect(imageConfig(store).localBaseUrl).toBe('http://192.168.1.40:7860');
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

  test('image.provider is an enum carrying its choices, so configure list can offer them', () => {
    // A closed set registered as a free string prints as prose; the point of the enum
    // kind is that the choices are readable without parsing a rejection message.
    const def = CONFIG_KEYS.find(entry => entry.key === IMAGE_PROVIDER_KEY);
    expect(def?.kind).toBe('enum');
    expect(def?.choices).toEqual(['nanobanana', 'openai', 'automatic1111']);
  });

  test('the credential-name keys refuse a secret belonging to something else', () => {
    const keys = [IMAGE_API_KEY_ENV_KEY,
                  ...['nanobanana', 'openai', 'automatic1111'].map(providerApiKeyEnvKey)];
    for (const key of keys) {
      const def = CONFIG_KEYS.find(entry => entry.key === key);
      expect(def?.validate('OPENAI_API_KEY').ok).toBe(true);
      expect(def?.validate('ANTHROPIC_API_KEY').ok).toBe(false);
      expect(def?.validate('AWS_SECRET_ACCESS_KEY').ok).toBe(false);
      expect(def?.validate('PATH').ok).toBe(false);
      expect(def?.validate('lowercase_key').ok).toBe(false);
    }
  });

  test('image.local_base_url refuses a host that is not the user’s own machine', () => {
    const def = CONFIG_KEYS.find(entry => entry.key === IMAGE_LOCAL_BASE_URL_KEY);
    expect(def?.validate('http://127.0.0.1:7860').ok).toBe(true);
    expect(def?.validate('http://10.1.2.3:7860').ok).toBe(true);
    expect(def?.validate('https://images.example.test').ok).toBe(false);
  });

  test('no registered image key is named in a way that invites storing a key', () => {
    for (const def of CONFIG_KEYS.filter(entry => entry.key.startsWith('image.'))) {
      const looksLikeStorage = /api_key$|\bkey$|secret|token|credential$/.test(def.key);
      expect(looksLikeStorage).toBe(false);
    }
  });

});
