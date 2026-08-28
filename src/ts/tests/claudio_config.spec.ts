import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { CONFIG_KEYS, configKey } from '../channels/config.js';
import {
  AUDIO_ENABLED_KEY, AUDIO_CEILING_KEY, AUDIO_TTS_LOCAL_KEY, AUDIO_MIN_GAP_KEY,
  AUDIO_HOURLY_BUDGET_KEY, AUDIO_ATTENTION_BUDGET_KEY, CEILING_ENV_VAR,
  DEFAULT_CEILING, DEFAULT_MIN_GAP_SECONDS, DEFAULT_HOURLY_BUDGET, DEFAULT_ATTENTION_BUDGET,
  audioConfig, motifWavKey, motifWavPath, AUDIO_WAV_KEYS,
} from '../claudio/config.js';
import { LEITMOTIFS } from '../claudio/vocabulary.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-claudio-config-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

describe('audioConfig', () => {

  test('ships dark: disabled, no TTS, conservative defaults', () => withStore(s => {
    expect(audioConfig(s, {})).toEqual({
      enabled: false, ttsLocal: false, ceiling: DEFAULT_CEILING,
      minGapSeconds: DEFAULT_MIN_GAP_SECONDS, hourlyBudget: DEFAULT_HOURLY_BUDGET,
      hourlyBudgetAttention: DEFAULT_ATTENTION_BUDGET,
    });
  }));

  test("only the exact affirmative 'true' enables — synonyms stay dark", () => withStore(s => {
    for (const notQuite of ['yes', '1', 'TRUE', 'on', 'enabled']) {
      writeConfig(s, AUDIO_ENABLED_KEY, notQuite);
      expect(audioConfig(s, {}).enabled).toBe(false);
    }
    writeConfig(s, AUDIO_ENABLED_KEY, 'true');
    expect(audioConfig(s, {}).enabled).toBe(true);
  }));

  test('the TTS tier has its own exact-affirmative gate', () => withStore(s => {
    writeConfig(s, AUDIO_ENABLED_KEY, 'true');
    expect(audioConfig(s, {}).ttsLocal).toBe(false);
    writeConfig(s, AUDIO_TTS_LOCAL_KEY, 'true');
    expect(audioConfig(s, {}).ttsLocal).toBe(true);
  }));

  test('reads configured limits, tolerating malformed rows as unset', () => withStore(s => {
    writeConfig(s, AUDIO_MIN_GAP_KEY, '90');
    writeConfig(s, AUDIO_HOURLY_BUDGET_KEY, 'lots');
    writeConfig(s, AUDIO_ATTENTION_BUDGET_KEY, '12');
    const config = audioConfig(s, {});
    expect(config.minGapSeconds).toBe(90);
    expect(config.hourlyBudget).toBe(DEFAULT_HOURLY_BUDGET);
    expect(config.hourlyBudgetAttention).toBe(12);
  }));

});

describe('the ceiling the assistant can never raise', () => {

  test('the config row sets the ceiling when no environment clamp exists', () => withStore(s => {
    writeConfig(s, AUDIO_CEILING_KEY, '80');
    expect(audioConfig(s, {}).ceiling).toBe(80);
  }));

  test('the environment clamp always takes the minimum', () => withStore(s => {
    writeConfig(s, AUDIO_CEILING_KEY, '80');
    expect(audioConfig(s, { [CEILING_ENV_VAR]: '30' }).ceiling).toBe(30);
    writeConfig(s, AUDIO_CEILING_KEY, '10');
    expect(audioConfig(s, { [CEILING_ENV_VAR]: '30' }).ceiling).toBe(10);
  }));

  test('raising the config row cannot climb over the environment clamp', () => withStore(s => {
    writeConfig(s, AUDIO_CEILING_KEY, '100');
    expect(audioConfig(s, { [CEILING_ENV_VAR]: '25' }).ceiling).toBe(25);
  }));

  test('a malformed environment value is ignored, never treated as zero', () => withStore(s => {
    writeConfig(s, AUDIO_CEILING_KEY, '60');
    for (const junk of ['loud', '', '  ', '3.5', '-2', '101']) {
      expect(audioConfig(s, { [CEILING_ENV_VAR]: junk }).ceiling).toBe(60);
    }
  }));

  test('a malformed ceiling row falls back to the default', () => withStore(s => {
    writeConfig(s, AUDIO_CEILING_KEY, 'eleven');
    expect(audioConfig(s, {}).ceiling).toBe(DEFAULT_CEILING);
  }));

});

describe('motif waveform resolution', () => {

  test('defaults to the vendored asset beside the others', () => withStore(s => {
    expect(motifWavPath(s, 'spark', join('a', 'b'))).toBe(join('a', 'b', 'spark.wav'));
  }));

  test('a configured override replaces the vendored path for that meaning only', () => withStore(s => {
    writeConfig(s, motifWavKey('spark'), 'D:\\sounds\\my-spark.wav');
    expect(motifWavPath(s, 'spark', 'assets')).toBe('D:\\sounds\\my-spark.wav');
    expect(motifWavPath(s, 'attention', 'assets')).toBe(join('assets', 'attention.wav'));
  }));

  test('a whitespace-only override behaves as unset', () => withStore(s => {
    writeConfig(s, motifWavKey('spark'), '   ');
    expect(motifWavPath(s, 'spark', 'assets')).toBe(join('assets', 'spark.wav'));
  }));

});

describe('registry agreement — the #30 surface and the facility cannot drift', () => {

  test('every audio key constant is registered in CONFIG_KEYS', () => {
    for (const key of [
      AUDIO_ENABLED_KEY, AUDIO_CEILING_KEY, AUDIO_TTS_LOCAL_KEY,
      AUDIO_MIN_GAP_KEY, AUDIO_HOURLY_BUDGET_KEY, AUDIO_ATTENTION_BUDGET_KEY,
    ]) {
      expect(configKey(key), key).toBeDefined();
    }
  });

  test('every leitmotif has its audio.wav.* key registered, with no default', () => {
    expect(AUDIO_WAV_KEYS).toHaveLength(LEITMOTIFS.length);
    for (const leitmotif of LEITMOTIFS) {
      const def = configKey(motifWavKey(leitmotif));
      expect(def, leitmotif).toBeDefined();
      expect(def?.fallback).toBeNull();
    }
  });

  test('the registry defaults match the facility defaults', () => {
    expect(configKey(AUDIO_ENABLED_KEY)?.fallback).toBe('false');
    expect(configKey(AUDIO_TTS_LOCAL_KEY)?.fallback).toBe('false');
    expect(configKey(AUDIO_CEILING_KEY)?.fallback).toBe(String(DEFAULT_CEILING));
    expect(configKey(AUDIO_MIN_GAP_KEY)?.fallback).toBe(String(DEFAULT_MIN_GAP_SECONDS));
    expect(configKey(AUDIO_HOURLY_BUDGET_KEY)?.fallback).toBe(String(DEFAULT_HOURLY_BUDGET));
    expect(configKey(AUDIO_ATTENTION_BUDGET_KEY)?.fallback).toBe(String(DEFAULT_ATTENTION_BUDGET));
  });

  test('audio keys validate through the registry like any other key', () => {
    const enabled = configKey(AUDIO_ENABLED_KEY),
          ceiling = configKey(AUDIO_CEILING_KEY);
    expect(enabled?.validate('TRUE')).toEqual({ ok: true, canonical: 'true' });
    expect(enabled?.validate('yes').ok).toBe(false);
    expect(ceiling?.validate('101').ok).toBe(false);
    expect(ceiling?.validate('45')).toEqual({ ok: true, canonical: '45' });
  });

  test('no key registered twice', () => {
    const names = CONFIG_KEYS.map(def => def.key);
    expect(new Set(names).size).toBe(names.length);
  });

});
