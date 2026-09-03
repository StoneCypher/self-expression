import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, deleteConfig, readConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  FORMAT_VERSION, CONFIG_KEYS, configKey,
  DEFAULT_CHANNEL_MAX_CHARS, MAX_TEXT_CEILING, MIN_CHANNEL_MAX_CHARS,
  channelMaxChars, channelMaxCharsKey,
  validateBool, intValidator, validateChannelList, stringValidator, choiceValidator,
  effectiveValue, effectiveConfig,
  WINDOW_SURFACES, WINDOW_POSTURES, DEFAULT_WINDOW_POSTURE,
  windowPosture, windowPostureKey,
} from '../channels/config.js';
import { CHANNELS } from '../channels/vocabulary.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-config-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

describe('CONFIG_KEYS registry', () => {

  test('registers exactly the settled surface: the eight #30 keys, the three dwelling keys, the desk path, the two #98 pending keys, the five #42 keys, the two #41 keys, the six #43 mailbox keys, the three #31 share keys, the eleven #44 audio keys, the eleven #78 image keys, the #40 onboarding ledger, the twelve #76 length keys, the #18 quote key, the #16 replay key, and the two window-posture keys', () => {
    expect(CONFIG_KEYS.map(def => def.key).sort()).toEqual([
      'audio.enabled', 'audio.hourly_budget', 'audio.hourly_budget_attention',
      'audio.min_gap_seconds', 'audio.tts_local', 'audio.volume_ceiling',
      'audio.wav.attention', 'audio.wav.need-blocked', 'audio.wav.quiet-completion',
      'audio.wav.session-open', 'audio.wav.spark',
      'channels.checklist.max_chars', 'channels.confidence.max_chars',
      'channels.conflict.max_chars', 'channels.dissent.max_chars',
      'channels.divergence.max_chars',
      'channels.enabled',
      'channels.idea.max_chars', 'channels.load.max_chars', 'channels.need.max_chars',
      'channels.pattern.max_chars', 'channels.signature.max_chars',
      'channels.taste.max_chars', 'channels.unanswerable.max_chars',
      'desk.path',
      'dwelling.enabled', 'dwelling.path', 'dwelling.size_warn_gb',
      'forecast.enabled', 'format.version', 'gate.checklist', 'gate.signature',
      'gifts.enabled',
      'image.api_key_env', 'image.automatic1111.api_key_env', 'image.daily_cap',
      'image.enabled', 'image.local_base_url', 'image.model',
      'image.nanobanana.api_key_env', 'image.openai.api_key_env', 'image.provider',
      'image.session_cap', 'image.timeout_seconds',
      'mailbox.daily_cap', 'mailbox.default_ttl_days', 'mailbox.enabled',
      'mailbox.max_pending', 'mailbox.offer_cap', 'mailbox.surface_budget',
      'messages.enabled', 'messages.notify', 'onboarding.answered',
      'pending.enabled', 'pending.nag_hours',
      'privacy.store_cwd', 'privacy.store_prompt_len', 'privacy.store_quotes',
      'retention.days', 'retraction.replay',
      'revision.enabled', 'roster.enabled', 'salience.enabled',
      'share.enabled', 'share.opted_in_utc', 'share.time_granularity',
      'time.hook',
      'window.browser', 'window.editor',
    ]);
  });

  test('every privacy key defaults to recording — the switch acts only when set (#18 included)', () => {
    for (const key of ['privacy.store_cwd', 'privacy.store_prompt_len', 'privacy.store_quotes']) {
      expect(configKey(key)).toMatchObject({ kind: 'bool', fallback: 'true' });
    }
  });

  test('the #41 messagebox keys ship on by default — the facility works out of the box', () => {
    expect(configKey('messages.enabled')).toMatchObject({ kind: 'bool', fallback: 'true' });
    expect(configKey('messages.notify')).toMatchObject({ kind: 'bool', fallback: 'true' });
  });

  test('the #43 mailbox ships OFF — unprompted speech is a consent surface, not a default', () => {
    expect(configKey('mailbox.enabled')).toMatchObject({ kind: 'bool', fallback: 'false' });
  });

  test('the #43 budgets carry the spec defaults, so scarcity is structural', () => {
    expect(configKey('mailbox.surface_budget')).toMatchObject({ kind: 'int', fallback: '1' });
    expect(configKey('mailbox.daily_cap')).toMatchObject({ kind: 'int', fallback: '3' });
    expect(configKey('mailbox.max_pending')).toMatchObject({ kind: 'int', fallback: '10' });
    expect(configKey('mailbox.offer_cap')).toMatchObject({ kind: 'int', fallback: '3' });
    expect(configKey('mailbox.default_ttl_days')).toMatchObject({ kind: 'int', fallback: '14' });
  });

  test('the share keys carry the #31 semantics: off by default, no default opt-in moment, hour granularity', () => {
    expect(configKey('share.enabled')).toMatchObject({ kind: 'bool', fallback: 'false' });
    expect(configKey('share.opted_in_utc')).toMatchObject({ kind: 'string', fallback: null });
    // A closed two-word domain, so it carries the enum kind and its choices: the
    // rejection a user sees names 'hour' and 'day', not the word "string".
    expect(configKey('share.time_granularity'))
      .toMatchObject({ kind: 'enum', choices: ['hour', 'day'], fallback: 'hour' });
  });

  test('the #42 keys carry the spec defaults: forecast and salience on, the rest off', () => {
    expect(configKey('forecast.enabled')).toMatchObject({ kind: 'bool', fallback: 'true' });
    expect(configKey('salience.enabled')).toMatchObject({ kind: 'bool', fallback: 'true' });
    expect(configKey('revision.enabled')).toMatchObject({ kind: 'bool', fallback: 'false' });
    expect(configKey('gifts.enabled')).toMatchObject({ kind: 'bool', fallback: 'false' });
    expect(configKey('roster.enabled')).toMatchObject({ kind: 'bool', fallback: 'false' });
  });

  test("every key with a default validates its own default's canonical form", () => {
    for (const def of CONFIG_KEYS) {
      if (def.fallback === null) { continue; }
      const outcome = def.validate(def.fallback);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) { expect(outcome.canonical).toBe(def.fallback); }
    }
  });

  test('the dwelling keys carry the #45 semantics: off by default, no default path, 10 GB warning', () => {
    expect(configKey('dwelling.enabled')).toMatchObject({ kind: 'bool', fallback: 'false' });
    expect(configKey('dwelling.path')).toMatchObject({ kind: 'string', fallback: null });
    expect(configKey('dwelling.size_warn_gb')).toMatchObject({ kind: 'int', fallback: '10' });
  });

  test('desk.path is a string with no default — a desk is a place the user chose (#93, #98)', () => {
    expect(configKey('desk.path')).toMatchObject({ kind: 'string', fallback: null });
    expect(configKey('desk.path')?.validate('C:/somewhere/desk').ok).toBe(true);
    expect(configKey('desk.path')?.validate('').ok).toBe(false);
  });

  test('the #98 pending keys ship on by default, nagging every four hours', () => {
    expect(configKey('pending.enabled')).toMatchObject({ kind: 'bool', fallback: 'true' });
    expect(configKey('pending.nag_hours')).toMatchObject({ kind: 'int', fallback: '4' });
    expect(configKey('pending.nag_hours')?.validate('0').ok).toBe(false);
    expect(configKey('pending.nag_hours')?.validate('168').ok).toBe(true);
    expect(configKey('pending.nag_hours')?.validate('169').ok).toBe(false);
  });

  test('gate.checklist is reserved with the same shape gate.signature has', () => {
    expect(configKey('gate.checklist')).toMatchObject({ kind: 'bool', fallback: 'true' });
  });

  test("channels.enabled's default is every channel", () => {
    expect(configKey('channels.enabled')?.fallback).toBe(CHANNELS.join(','));
  });

  test("format.version's default is the FORMAT_VERSION constant", () => {
    expect(configKey('format.version')?.fallback).toBe(FORMAT_VERSION);
  });

  test('an unknown key has no definition — that is what makes the D3 warning possible', () => {
    expect(configKey('gate.signture')).toBeUndefined();
  });

});

describe('channels.<name>.max_chars — the #76 length family', () => {

  test('every channel has a registered int key defaulting to 200', () => {
    for (const channel of CHANNELS) {
      expect(configKey(channelMaxCharsKey(channel)))
        .toMatchObject({ kind: 'int', fallback: String(DEFAULT_CHANNEL_MAX_CHARS) });
    }
    expect(DEFAULT_CHANNEL_MAX_CHARS).toBe(200);
  });

  test('the key name is the documented shape users type', () => {
    expect(channelMaxCharsKey('signature')).toBe('channels.signature.max_chars');
    expect(channelMaxCharsKey('taste')).toBe('channels.taste.max_chars');
  });

  test('the accepted range is 1 to the hard ceiling the tool schema carries', () => {
    const def = configKey(channelMaxCharsKey('signature'));
    expect(def?.validate(String(MIN_CHANNEL_MAX_CHARS)).ok).toBe(true);
    expect(def?.validate(String(MAX_TEXT_CEILING)).ok).toBe(true);
    expect(def?.validate('0').ok).toBe(false);
    expect(def?.validate(String(MAX_TEXT_CEILING + 1)).ok).toBe(false);
  });

  test('zero is refused, naming the range — disabling a channel is channels.enabled’s job', () => {
    const outcome = configKey(channelMaxCharsKey('need'))?.validate('0');
    expect(outcome?.ok).toBe(false);
    if (outcome !== undefined && !outcome.ok) { expect(outcome.expected).toContain('1 to 2000'); }
  });

  test('channelMaxChars returns the default on a fresh store', () => withStore(s => {
    for (const channel of CHANNELS) {
      expect(channelMaxChars(s, channel)).toBe(DEFAULT_CHANNEL_MAX_CHARS);
    }
  }));

  test('a configured limit reaches exactly the channel it names', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('taste'), '320');
    expect(channelMaxChars(s, 'taste')).toBe(320);
    for (const other of CHANNELS.filter(c => c !== 'taste')) {
      expect(channelMaxChars(s, other)).toBe(DEFAULT_CHANNEL_MAX_CHARS);
    }
  }));

  test('a hand-edited garbage or out-of-range row behaves as unset, never as a limit nobody chose', () => withStore(s => {
    for (const bad of ['soon', '-5', '0', '99999', '', '12.5']) {
      writeConfig(s, channelMaxCharsKey('need'), bad);
      expect(channelMaxChars(s, 'need')).toBe(DEFAULT_CHANNEL_MAX_CHARS);
    }
  }));

  test('an unregistered channel name resolves to the default rather than throwing', () => withStore(s => {
    expect(channelMaxChars(s, 'vibes')).toBe(DEFAULT_CHANNEL_MAX_CHARS);
  }));

  test('unset returns the channel to the code default', () => withStore(s => {
    writeConfig(s, channelMaxCharsKey('load'), '90');
    expect(channelMaxChars(s, 'load')).toBe(90);
    deleteConfig(s, channelMaxCharsKey('load'));
    expect(channelMaxChars(s, 'load')).toBe(DEFAULT_CHANNEL_MAX_CHARS);
  }));

  test('the family appears in the effective listing, one inspectable line per channel', () => withStore(s => {
    const listed = effectiveConfig(s).filter(e => e.key.endsWith('.max_chars'));
    expect(listed).toHaveLength(CHANNELS.length);
    for (const entry of listed) {
      expect(entry).toMatchObject({ value: '200', source: 'default', known: true });
    }
  }));

});

describe('the enum kind', () => {

  test('every enum key carries a non-empty choice set, and no other kind does', () => {
    for (const def of CONFIG_KEYS) {
      if (def.kind === 'enum') {
        expect(def.choices).toBeDefined();
        expect(def.choices?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(def.choices).toBeUndefined();
      }
    }
  });

  test('an enum key accepts exactly its own choices and nothing else', () => {
    for (const def of CONFIG_KEYS.filter(d => d.kind === 'enum')) {
      for (const choice of def.choices ?? []) {
        expect(def.validate(choice)).toEqual({ ok: true, canonical: choice });
      }
      expect(def.validate('not-a-choice-any-key-has').ok).toBe(false);
    }
  });

  test("an enum key's every choice is already canonical — no choice needs rewriting to be stored", () => {
    for (const def of CONFIG_KEYS.filter(d => d.kind === 'enum')) {
      for (const choice of def.choices ?? []) {
        expect(choice).toBe(choice.trim().toLowerCase());
      }
    }
  });

  test('the rejection names the whole set, not the kind — that is why enum exists', () => {
    const outcome = choiceValidator(WINDOW_POSTURES)('maybe');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      for (const posture of WINDOW_POSTURES) { expect(outcome.expected).toContain(`'${posture}'`); }
      expect(outcome.expected).toContain('one of');
    }
  });

});

describe('the window posture keys', () => {

  test('one key per surface, each an enum over the three postures, defaulting to ask', () => {
    for (const surface of WINDOW_SURFACES) {
      expect(configKey(windowPostureKey(surface))).toMatchObject({
        kind: 'enum', choices: WINDOW_POSTURES, fallback: DEFAULT_WINDOW_POSTURE,
      });
    }
    expect(DEFAULT_WINDOW_POSTURE).toBe('ask');
  });

  test('the key names are the stable shape a user types', () => {
    expect(windowPostureKey('browser')).toBe('window.browser');
    expect(windowPostureKey('editor')).toBe('window.editor');
  });

  test('both keys validate their own defaults, which is what makes ask reachable by unset', () => {
    for (const surface of WINDOW_SURFACES) {
      const def = configKey(windowPostureKey(surface));
      expect(def?.validate(def.fallback ?? '')).toEqual({ ok: true, canonical: 'ask' });
    }
  });

  test.each([
    ['never', 'NEVER'], ['never', ' Never '], ['ask', 'Ask'], ['ask', 'aSk'],
    ['always', 'ALWAYS'], ['always', ' always'],
  ])('canonicalises %s from the mixed case %s', (canonical, raw) => {
    for (const surface of WINDOW_SURFACES) {
      expect(configKey(windowPostureKey(surface))?.validate(raw)).toEqual({ ok: true, canonical });
    }
  });

  test.each(['sometimes', 'yes', 'true', '1', '', 'never ask always', 'nevermore'])(
    'rejects %s with a message naming the whole set', (raw) => {
      const outcome = configKey('window.browser')?.validate(raw);
      expect(outcome?.ok).toBe(false);
      if (outcome !== undefined && !outcome.ok) {
        expect(outcome.expected).toContain("'never'");
        expect(outcome.expected).toContain("'ask'");
        expect(outcome.expected).toContain("'always'");
      }
    });

  test('a fresh store answers ask for both surfaces', () => withStore(s => {
    for (const surface of WINDOW_SURFACES) {
      expect(windowPosture(s, surface)).toBe('ask');
    }
  }));

  test('the two keys are genuinely independent — that is the entire reason there are two', () => withStore(s => {
    writeConfig(s, 'window.browser', 'never');
    writeConfig(s, 'window.editor', 'always');
    expect(windowPosture(s, 'browser')).toBe('never');
    expect(windowPosture(s, 'editor')).toBe('always');
  }));

  test.each(['never', 'ask', 'always'])('a stored %s reaches the reader intact', (posture) => withStore(s => {
    for (const surface of WINDOW_SURFACES) {
      writeConfig(s, windowPostureKey(surface), posture);
      expect(windowPosture(s, surface)).toBe(posture);
    }
  }));

  test('an invalid stored value behaves as unset — ask, the safe direction (D5)', () => withStore(s => {
    for (const bad of ['sometimes', 'TRUE', '', '  ', 'ask always', 'occasionally']) {
      for (const surface of WINDOW_SURFACES) {
        writeConfig(s, windowPostureKey(surface), bad);
        expect(windowPosture(s, surface)).toBe('ask');
      }
    }
  }));

  test('an unregistered surface resolves to ask rather than throwing', () => withStore(s => {
    expect(windowPosture(s, 'terminal')).toBe('ask');
  }));

  test('unset returns a surface to ask', () => withStore(s => {
    writeConfig(s, 'window.browser', 'always');
    expect(windowPosture(s, 'browser')).toBe('always');
    deleteConfig(s, 'window.browser');
    expect(windowPosture(s, 'browser')).toBe('ask');
  }));

  test('both keys appear in the effective listing, at their defaults, on a fresh store', () => withStore(s => {
    const listed = effectiveConfig(s).filter(e => e.key.startsWith('window.'));
    expect(listed.map(e => e.key).sort()).toEqual(['window.browser', 'window.editor']);
    for (const entry of listed) {
      expect(entry).toMatchObject({ value: 'ask', source: 'default', known: true });
    }
  }));

  test('an invalid stored posture is listed at ask with a note, matching what the reader does', () => withStore(s => {
    writeConfig(s, 'window.editor', 'whenever');
    const entry = effectiveConfig(s).find(e => e.key === 'window.editor');
    expect(entry).toMatchObject({ value: 'ask', source: 'default', known: true });
    expect(entry?.note).toContain("'whenever'");
    expect(windowPosture(s, 'editor')).toBe('ask');
  }));

});

describe('validateBool', () => {

  test.each([['true', 'true'], ['false', 'false'], ['TRUE', 'true'], [' False ', 'false']])(
    'accepts %s and canonicalizes to %s', (raw, canonical) => {
      expect(validateBool(raw)).toEqual({ ok: true, canonical });
    });

  test.each(['yes', '1', 'off', 'no', '', 'truthy'])('rejects %s rather than guessing', (raw) => {
    const outcome = validateBool(raw);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) { expect(outcome.expected).toContain("'true' or 'false'"); }
  });

});

describe('intValidator', () => {

  const days = intValidator(0, 3650);

  test('accepts in-range decimals and strips leading zeros', () => {
    expect(days('0')).toEqual({ ok: true, canonical: '0' });
    expect(days('090')).toEqual({ ok: true, canonical: '90' });
    expect(days('3650')).toEqual({ ok: true, canonical: '3650' });
  });

  test.each(['-1', '3651', '1.5', 'abc', '', '1e3', '0x10'])('rejects %s naming the range', (raw) => {
    const outcome = days(raw);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) { expect(outcome.expected).toContain('0 to 3650'); }
  });

});

describe('validateChannelList', () => {

  test('canonicalizes to trimmed names joined with commas', () => {
    expect(validateChannelList(' signature , need ')).toEqual({ ok: true, canonical: 'signature,need' });
  });

  test('accepts the full vocabulary verbatim', () => {
    expect(validateChannelList(CHANNELS.join(','))).toEqual({ ok: true, canonical: CHANNELS.join(',') });
  });

  test('an unknown name rejects the whole write, naming the valid channels', () => {
    const outcome = validateChannelList('signature,vibes');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.expected).toContain("'vibes'");
      expect(outcome.expected).toContain("'signature'");
    }
  });

  test('an empty list is rejected — a typo must not silently disable the plugin', () => {
    expect(validateChannelList('').ok).toBe(false);
    expect(validateChannelList(' , , ').ok).toBe(false);
  });

});

describe('stringValidator', () => {

  const version = stringValidator(64);

  test('accepts and trims a plausible version label', () => {
    expect(version(' v18 ')).toEqual({ ok: true, canonical: 'v18' });
  });

  test('rejects empty and over-long values naming the constraint', () => {
    const empty = version('   '), long = version('x'.repeat(65));
    expect(empty.ok).toBe(false);
    expect(long.ok).toBe(false);
    if (!long.ok) { expect(long.expected).toContain('64'); }
  });

});

describe('effectiveValue — the tolerant accessor', () => {

  test('an unset key resolves to its code default', () => withStore(s => {
    expect(effectiveValue(s, 'retention.days')).toBe('0');
    expect(effectiveValue(s, 'gate.checklist')).toBe('true');
    expect(effectiveValue(s, 'dwelling.enabled')).toBe('false');
  }));

  test('a key with no default resolves to null when unset', () => withStore(s => {
    expect(effectiveValue(s, 'dwelling.path')).toBeNull();
  }));

  test('a valid override wins, in canonical form', () => withStore(s => {
    writeConfig(s, 'retention.days', 90);
    expect(effectiveValue(s, 'retention.days')).toBe('90');
  }));

  test('an invalid stored value behaves as unset — the code default applies', () => withStore(s => {
    writeConfig(s, 'retention.days', 'sometimes');   // a hand-edited or pre-validation row
    expect(effectiveValue(s, 'retention.days')).toBe('0');
    writeConfig(s, 'format.version', '');
    expect(effectiveValue(s, 'format.version')).toBe(FORMAT_VERSION);
  }));

  test('never throws on garbage rows', () => withStore(s => {
    for (const def of CONFIG_KEYS) { writeConfig(s, def.key, '\u0000 utterly wrong ￿'); }
    for (const def of CONFIG_KEYS) {
      expect(() => effectiveValue(s, def.key)).not.toThrow();
      expect(effectiveValue(s, def.key)).toBe(def.fallback);
    }
  }));

  test('an unregistered key passes through raw, because there is nothing to validate against', () => withStore(s => {
    expect(effectiveValue(s, 'some.future.key')).toBeNull();
    writeConfig(s, 'some.future.key', 'from a newer version');
    expect(effectiveValue(s, 'some.future.key')).toBe('from a newer version');
  }));

});

describe('effectiveConfig — the full report', () => {

  test('an empty config table still reports every registered key, all from defaults', () => withStore(s => {
    const report = effectiveConfig(s);
    expect(report.map(e => e.key).sort()).toEqual(CONFIG_KEYS.map(def => def.key).sort());
    for (const entry of report) {
      expect(entry.source).toBe('default');
      expect(entry.known).toBe(true);
    }
  }));

  test('an override is reported with its source', () => withStore(s => {
    writeConfig(s, 'gate.signature', false);
    const entry = effectiveConfig(s).find(e => e.key === 'gate.signature');
    expect(entry).toMatchObject({ value: 'false', source: 'override', known: true });
  }));

  test('an unknown override row is listed and labeled unknown, never dropped', () => withStore(s => {
    // Deliberately a key no release has ever registered, and no future one is likely to:
    // this test previously used a then-unregistered real key and broke the day that key
    // shipped, which is exactly the drift a synthetic name avoids.
    writeConfig(s, 'from.a.newer.version', 'true');
    const entry = effectiveConfig(s).find(e => e.key === 'from.a.newer.version');
    expect(entry).toMatchObject({ value: 'true', source: 'override', known: false });
    expect(entry?.note).toContain('unknown');
  }));

  test('an invalid stored override is reported at the default, with a note', () => withStore(s => {
    writeConfig(s, 'time.hook', 'maybe');
    const entry = effectiveConfig(s).find(e => e.key === 'time.hook');
    expect(entry).toMatchObject({ value: 'true', source: 'default', known: true });
    expect(entry?.note).toContain("'maybe'");
  }));

});

describe('deleteConfig', () => {

  test('removes an override so the code default applies again', () => withStore(s => {
    writeConfig(s, 'retention.days', 90);
    expect(deleteConfig(s, 'retention.days')).toBe(true);
    expect(readConfig(s, 'retention.days')).toBeNull();
    expect(effectiveValue(s, 'retention.days')).toBe('0');
  }));

  test('deleting an absent key is a successful no-op', () => withStore(s => {
    expect(deleteConfig(s, 'retention.days')).toBe(false);
  }));

  test('deletes unknown keys too — a newer version\'s setting can be walked back', () => withStore(s => {
    writeConfig(s, 'some.future.key', 'x');
    expect(deleteConfig(s, 'some.future.key')).toBe(true);
    expect(readConfig(s, 'some.future.key')).toBeNull();
  }));

});
