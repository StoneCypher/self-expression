/**
 * Unit tests for the first-run onboarding questionnaire (issue #40): registry
 * integrity against the config surface it inherits from, the pending computation on
 * fresh / partial / hand-configured stores, ledger idempotence and unknown-id
 * preservation, and the `onboard` tool's four ops through the real handler.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, test, expect } from 'vitest';

import { openStore, closeStore, writeConfig, readConfig, allConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { configKey }  from '../channels/config.js';
import { CHANNELS }   from '../channels/vocabulary.js';
import {
  ANSWERED_KEY, QUESTIONS, QUESTION_IDS, onboardingQuestion, answeredIds,
  questionResolved, pendingQuestions, resolveQuestion, resetOnboarding,
  onboardingInstructions,
} from '../channels/onboarding.js';
import { handleOnboard, ENABLED_KEY } from '../mcp/tools.js';
import { buildServer } from '../mcp/server.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-onboarding-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** A store plus a real directory that outlives the callback, for dwelling answers. */
function withStoreAndDir<T>(fn: (s: Store, dir: string) => T): T {
  const dir     = mkdtempSync(join(tmpdir(), 'se-onboarding-')),
        houseDir = mkdtempSync(join(tmpdir(), 'se-dwelling-dir-')),
        s       = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s, houseDir); } finally {
    closeStore(s);
    rmSync(dir, { recursive: true, force: true });
    rmSync(houseDir, { recursive: true, force: true });
  }
}

/** Pulls the plain text out of a tool reply, the shape every assertion below checks. */
function text(reply: { content: { type: 'text'; text: string }[] }): string {
  const [first] = reply.content;
  return first === undefined ? '' : first.text;
}

describe('registry integrity — the questionnaire inherits its keys from their owning specs', () => {

  test('question ids are unique', () => {
    expect(new Set(QUESTION_IDS).size).toBe(QUESTIONS.length);
  });

  test('every key every question writes is registered in CONFIG_KEYS', () => {
    for (const question of QUESTIONS) {
      for (const key of question.keys) {
        expect(configKey(key), `${question.id} names unregistered key ${key}`).toBeDefined();
      }
    }
  });

  test('plain boolean defaults agree with the config registry fallbacks', () => {
    for (const question of QUESTIONS.filter(q => q.kind === 'boolean' && q.channel === undefined)) {
      const [key] = question.keys;
      expect(configKey(key ?? '')?.fallback).toBe(question.defaultAnswer);
    }
  });

  test('the questionnaire matches the issue-thread verdicts: roster off, forecast on, revision off, salience on, taste on, gifts off, dwelling off, channels all', () => {
    const byId = (id: string): string => onboardingQuestion(id)?.defaultAnswer ?? '(missing)';
    expect(byId('roster')).toBe('false');
    expect(byId('forecast')).toBe('true');
    expect(byId('revision')).toBe('false');
    expect(byId('salience')).toBe('true');
    expect(byId('taste')).toBe('true');
    expect(byId('gifts')).toBe('false');
    expect(byId('dwelling')).toBe('false');
    expect(byId('channels')).toBe(CHANNELS.join(','));
  });

  test('the dwelling is path-gated and names both of its keys', () => {
    const dwelling = onboardingQuestion('dwelling');
    expect(dwelling?.kind).toBe('path-gated boolean');
    expect(dwelling?.keys).toContain('dwelling.enabled');
    expect(dwelling?.keys).toContain('dwelling.path');
  });

  test('taste rides channels.enabled — taste is a channel, not a flag', () => {
    const taste = onboardingQuestion('taste');
    expect(taste?.keys).toEqual(['channels.enabled']);
    expect(taste?.channel).toBe('taste');
    expect(CHANNELS).toContain('taste');
  });

  test('the two structural questions come last, per the spec ordering', () => {
    expect(QUESTION_IDS.slice(-2)).toEqual(['dwelling', 'channels']);
  });

  test('the ledger key is registered, with no default — absence means nothing resolved', () => {
    const def = configKey(ANSWERED_KEY);
    expect(def).toBeDefined();
    expect(def?.fallback).toBeNull();
  });

  test('the ledger validator preserves unknown ids rather than rejecting them', () => {
    const def = configKey(ANSWERED_KEY);
    expect(def?.validate('roster, a-future-question ')).toEqual(
      { ok: true, canonical: 'roster,a-future-question' });
  });

});

describe('pendingQuestions — first run is a property of the database', () => {

  test('a fresh database leaves everything pending, in registry order', () => withStore(s => {
    expect(pendingQuestions(s).map(q => q.id)).toEqual([...QUESTION_IDS]);
    expect(answeredIds(s)).toEqual([]);
  }));

  test('a ledger entry resolves exactly its question', () => withStore(s => {
    resolveQuestion(s, 'roster');
    const pending = pendingQuestions(s).map(q => q.id);
    expect(pending).not.toContain('roster');
    expect(pending).toHaveLength(QUESTIONS.length - 1);
  }));

  test('a hand-configured key counts as answered — asking again would be noise', () => withStore(s => {
    writeConfig(s, 'roster.enabled', 'true');
    expect(pendingQuestions(s).map(q => q.id)).not.toContain('roster');
    expect(answeredIds(s)).toEqual([]);   // resolved by row, not by ledger
  }));

  test('a hand-set channels.enabled resolves both the taste and channels questions', () => withStore(s => {
    writeConfig(s, ENABLED_KEY, 'signature,need');
    const pending = pendingQuestions(s).map(q => q.id);
    expect(pending).not.toContain('taste');
    expect(pending).not.toContain('channels');
  }));

  test('a hand-set dwelling.path alone resolves the dwelling question — any key counts', () => withStore(s => {
    writeConfig(s, 'dwelling.path', 'C:/somewhere');
    expect(pendingQuestions(s).map(q => q.id)).not.toContain('dwelling');
    const dwelling = onboardingQuestion('dwelling');
    expect(dwelling).toBeDefined();
    if (dwelling !== undefined) { expect(questionResolved(s, dwelling)).toBe(true); }
  }));

});

describe('the ledger — idempotent, preserving, and cleanly resettable', () => {

  test('resolveQuestion appends once and is idempotent', () => withStore(s => {
    expect(resolveQuestion(s, 'roster')).toBe(true);
    expect(resolveQuestion(s, 'roster')).toBe(false);
    expect(answeredIds(s)).toEqual(['roster']);
  }));

  test('unknown ids in the ledger survive a write by this version', () => withStore(s => {
    writeConfig(s, ANSWERED_KEY, 'a-future-question');
    resolveQuestion(s, 'roster');
    expect(answeredIds(s)).toEqual(['a-future-question', 'roster']);
  }));

  test('resetOnboarding clears only the ledger; config values are untouched', () => withStore(s => {
    writeConfig(s, 'forecast.enabled', 'false');
    resolveQuestion(s, 'roster');
    expect(resetOnboarding(s)).toBe(true);
    expect(readConfig(s, ANSWERED_KEY)).toBeNull();
    expect(readConfig(s, 'forecast.enabled')).toBe('false');
    expect(resetOnboarding(s)).toBe(false);   // nothing left to clear
  }));

});

describe('onboard status — read-only, the implicit defer', () => {

  test('reports pending questions, the ledger, and completeness, writing nothing', () => withStore(s => {
    const parsed = JSON.parse(text(handleOnboard(s, { op: 'status' }))) as
      { pending: { id: string; prompt: string; kind: string; default: string; keys: string[] }[];
        answered: string[]; complete: boolean };
    expect(parsed.pending.map(p => p.id)).toEqual([...QUESTION_IDS]);
    expect(parsed.answered).toEqual([]);
    expect(parsed.complete).toBe(false);
    expect(allConfig(s)).toEqual({});   // status is the implicit defer: no rows
  }));

  test('reports complete once everything is resolved', () => withStore(s => {
    handleOnboard(s, { op: 'skip' });
    const parsed = JSON.parse(text(handleOnboard(s, { op: 'status' }))) as
      { pending: unknown[]; complete: boolean };
    expect(parsed.pending).toEqual([]);
    expect(parsed.complete).toBe(true);
  }));

});

describe('onboard skip — accepting the defaults writes no config rows', () => {

  test('resolves everything pending and writes only the ledger', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'skip' }));
    expect(out).toContain('no config rows were written');
    expect(out).toContain('code defaults apply');
    expect(Object.keys(allConfig(s))).toEqual([ANSWERED_KEY]);
    expect(pendingQuestions(s)).toEqual([]);
  }));

  test('skips only what is pending — a hand-configured question is not re-ledgered', () => withStore(s => {
    writeConfig(s, 'roster.enabled', 'true');
    handleOnboard(s, { op: 'skip' });
    expect(answeredIds(s)).not.toContain('roster');
    expect(pendingQuestions(s)).toEqual([]);
  }));

  test('with nothing pending, says so rather than pretending to work', () => withStore(s => {
    handleOnboard(s, { op: 'skip' });
    expect(text(handleOnboard(s, { op: 'skip' }))).toContain('nothing pending');
  }));

});

describe('onboard answer — one question per call, explicit answers always write', () => {

  test('a plain boolean answer writes its row and resolves the question', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'roster', value: 'true' }));
    expect(out).toContain('roster.enabled = true');
    expect(readConfig(s, 'roster.enabled')).toBe('true');
    expect(answeredIds(s)).toContain('roster');
  }));

  test('an answer equal to the default still writes — a later default flip must not un-choose it', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'forecast', value: 'TRUE' }));
    expect(out).toContain('forecast.enabled = true');
    expect(out).toContain('explicit');
    expect(readConfig(s, 'forecast.enabled')).toBe('true');
  }));

  test('an invalid value is refused, nothing written, and the question stays pending', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'roster', value: 'yes' }));
    expect(out).toMatch(/^error: /);
    expect(readConfig(s, 'roster.enabled')).toBeNull();
    expect(pendingQuestions(s).map(q => q.id)).toContain('roster');
  }));

  test('answer without id or value is an error, not a write', () => withStore(s => {
    expect(text(handleOnboard(s, { op: 'answer', value: 'true' }))).toMatch(/^error: /);
    expect(text(handleOnboard(s, { op: 'answer', id: 'roster' }))).toMatch(/^error: /);
    expect(allConfig(s)).toEqual({});
  }));

  test('a hallucinated question id cannot validate', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'vibes', value: 'true' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('roster');   // the valid ids are named
  }));

});

describe('onboard answer — the dwelling carries its consent shape', () => {

  test('enabling without a path is refused, restating the no-default-path rule', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'dwelling', value: 'true' }));
    expect(out).toMatch(/^error: /);
    expect(out).toContain('no default location');
    expect(readConfig(s, 'dwelling.enabled')).toBeNull();
    expect(pendingQuestions(s).map(q => q.id)).toContain('dwelling');
  }));

  test('enabling with a real directory writes path then enabled, and resolves', () => withStoreAndDir((s, dir) => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'dwelling', value: 'true', path: dir }));
    expect(out).toContain('dwelling.enabled = true');
    expect(readConfig(s, 'dwelling.path')).toBe(dir);
    expect(readConfig(s, 'dwelling.enabled')).toBe('true');
    expect(answeredIds(s)).toContain('dwelling');
  }));

  test('a path that is not an existing directory is refused — same rule as configure', () => withStore(s => {
    const out = text(handleOnboard(s, {
      op: 'answer', id: 'dwelling', value: 'true',
      path: join(tmpdir(), 'se-onboarding-nonesuch', 'deeper') }));
    expect(out).toMatch(/^error: /);
    expect(readConfig(s, 'dwelling.path')).toBeNull();
    expect(readConfig(s, 'dwelling.enabled')).toBeNull();
  }));

  test('an explicit no writes dwelling.enabled = false and needs no path', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'dwelling', value: 'false' }));
    expect(out).toContain('dwelling.enabled = false');
    expect(readConfig(s, 'dwelling.enabled')).toBe('false');
    expect(readConfig(s, 'dwelling.path')).toBeNull();
    expect(answeredIds(s)).toContain('dwelling');
  }));

});

describe('onboard answer — taste is channel membership, not a flag', () => {

  test('declining taste trims it from the enabled set and notes the startup caveat', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'taste', value: 'false' }));
    expect(out).toContain('next server start');
    const stored = readConfig(s, ENABLED_KEY);
    expect(stored).not.toBeNull();
    expect(stored?.split(',')).not.toContain('taste');
    expect(stored?.split(',')).toEqual(CHANNELS.filter(c => c !== 'taste'));
    expect(answeredIds(s)).toContain('taste');
  }));

  test('accepting taste on a fresh store writes no row — the default already offers it', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'taste', value: 'true' }));
    expect(out).toContain('default');
    expect(readConfig(s, ENABLED_KEY)).toBeNull();
    expect(answeredIds(s)).toContain('taste');
  }));

  test('accepting taste when an override trimmed it restores the channel in canonical order', () => withStore(s => {
    writeConfig(s, ENABLED_KEY, 'signature,need');
    handleOnboard(s, { op: 'answer', id: 'taste', value: 'true' });
    expect(readConfig(s, ENABLED_KEY)).toBe('signature,need,taste');
  }));

  test('declining taste when the sole enabled channel is taste refuses to empty the set', () => withStore(s => {
    writeConfig(s, ENABLED_KEY, 'taste');
    const out = text(handleOnboard(s, { op: 'answer', id: 'taste', value: 'false' }));
    expect(out).toMatch(/^error: /);
    expect(readConfig(s, ENABLED_KEY)).toBe('taste');
  }));

});

describe('onboard answer — channel trimming', () => {

  test('a valid list is written canonically with the startup caveat stated', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'channels', value: ' signature , need ' }));
    expect(out).toContain(`${ENABLED_KEY} = signature,need`);
    expect(out).toContain('next server start');
    expect(readConfig(s, ENABLED_KEY)).toBe('signature,need');
    expect(answeredIds(s)).toContain('channels');
  }));

  test('an unknown channel name is refused, nothing written', () => withStore(s => {
    const out = text(handleOnboard(s, { op: 'answer', id: 'channels', value: 'signature,vibes' }));
    expect(out).toMatch(/^error: /);
    expect(readConfig(s, ENABLED_KEY)).toBeNull();
  }));

});

describe('onboard reset — re-run onboarding without touching choices', () => {

  test('clears the ledger, leaves config rows, and re-asks only unconfigured questions', () => withStore(s => {
    handleOnboard(s, { op: 'answer', id: 'roster', value: 'true' });
    handleOnboard(s, { op: 'skip' });
    const out = text(handleOnboard(s, { op: 'reset' }));
    expect(out).toContain('pending again');
    expect(readConfig(s, 'roster.enabled')).toBe('true');
    const pending = pendingQuestions(s).map(q => q.id);
    expect(pending).not.toContain('roster');        // answered by row, still resolved
    expect(pending).toContain('forecast');          // skipped, so pending again
  }));

});

describe('surfacing — the instructions string and the always-registered tool', () => {

  test('onboardingInstructions names the pending count on a fresh store', () => withStore(s => {
    const line = onboardingInstructions(s);
    expect(line).toContain(`(${String(QUESTIONS.length)} questions)`);
    expect(line).toContain('natural pause');
    expect(line).toContain("onboard {op:'status'}");
  }));

  test('onboardingInstructions is null once nothing is pending — no stale nudge', () => withStore(s => {
    handleOnboard(s, { op: 'skip' });
    expect(onboardingInstructions(s)).toBeNull();
  }));

  test('buildServer constructs cleanly with and without pending onboarding', () => withStore(s => {
    expect(() => buildServer(s, '0.0.0', null)).not.toThrow();
    handleOnboard(s, { op: 'skip' });
    expect(() => buildServer(s, '0.0.0', null)).not.toThrow();
  }));

});
