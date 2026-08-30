/**
 * Stochastic property tests for the generation gate and the similarity measure the
 * no-rewording rule is built on.
 *
 * The gate is the whole money story, so its invariants are pinned property-style:
 * whatever the configuration, credential, counts, and history, a disabled facility
 * never allows, a spent cap always refuses, and a permission is never granted while
 * any of the conditions that would refuse it holds.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { decideGeneration, isReword, promptSimilarity, promptTokens } from '../imagery/gate.js';
import type { GenerationAsk, GenerationCounts } from '../imagery/gate.js';
import type { ImageConfig, CredentialState }    from '../imagery/config.js';
import type { RefusedPrompt }                   from '../imagery/ledger.js';
import { IMAGE_PROVIDERS, IMAGE_SIZES }         from '../imagery/providers.js';

const arbConfig: fc.Arbitrary<ImageConfig> = fc.record({
  enabled        : fc.boolean(),
  provider       : fc.constantFrom(...IMAGE_PROVIDERS),
  model          : fc.constantFrom('gpt-image-1', 'gemini-2.5-flash-image', 'local'),
  sessionCap     : fc.integer({ min: 0, max: 12 }),
  dailyCap       : fc.integer({ min: 0, max: 30 }),
  timeoutSeconds : fc.integer({ min: 5, max: 900 }),
  localBaseUrl   : fc.constant('http://127.0.0.1:7860'),
  credentialEnvVar: fc.option(fc.constantFrom('OPENAI_API_KEY', 'GEMINI_API_KEY', 'WORK_KEY'),
                              { nil: null }),
});

const arbCredential: fc.Arbitrary<CredentialState> = fc.record({
  needed  : fc.boolean(),
  envVar  : fc.option(fc.constant('OPENAI_API_KEY'), { nil: null }),
  present : fc.boolean(),
  value   : fc.option(fc.constant('sk-fake-0123456789abcdef'), { nil: null }),
});

const arbCounts: fc.Arbitrary<GenerationCounts> = fc.record({
  session : fc.integer({ min: 0, max: 15 }),
  day     : fc.integer({ min: 0, max: 40 }),
});

const arbPrompt: fc.Arbitrary<string> = fc.string({ maxLength: 80 });

const arbAsk: fc.Arbitrary<GenerationAsk> = fc.record({
  prompt : arbPrompt,
  size   : fc.option(fc.constantFrom(...IMAGE_SIZES), { nil: null }),
});

const arbRefusals: fc.Arbitrary<RefusedPrompt[]> = fc.array(
  fc.record({ utc: fc.constant('2026-08-29T10:00:00.000Z'), prompt: arbPrompt }),
  { maxLength: 6 },
);

describe('gate invariants', () => {

  it('a disabled facility never allows anything', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCredential, arbCounts, arbRefusals,
      (ask, config, credential, counts, refusals) => {
        const out = decideGeneration(ask, { ...config, enabled: false }, credential, counts, refusals);
        expect(out.allowed).toBe(false);
        if (!out.allowed) { expect(out.reason).toContain('image.enabled'); }
      }));
  });

  it('a needed-but-absent credential never allows anything', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCounts, arbRefusals,
      (ask, config, counts, refusals) => {
        const lacking: CredentialState = { needed: true, envVar: 'OPENAI_API_KEY', present: false, value: null };
        const out = decideGeneration(ask, { ...config, enabled: true }, lacking, counts, refusals);
        expect(out.allowed).toBe(false);
      }));
  });

  it('a spent session cap always refuses', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCredential, arbCounts, arbRefusals,
      (ask, config, credential, counts, refusals) => {
        fc.pre(counts.session >= config.sessionCap);
        const have: CredentialState = { ...credential, needed: false, present: true };
        const out = decideGeneration(ask, { ...config, enabled: true }, have, counts, refusals);
        expect(out.allowed).toBe(false);
      }));
  });

  it('a spent daily cap always refuses', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCredential, arbCounts, arbRefusals,
      (ask, config, credential, counts, refusals) => {
        fc.pre(counts.day >= config.dailyCap);
        const have: CredentialState = { ...credential, needed: false, present: true };
        const out = decideGeneration(ask, { ...config, enabled: true }, have, counts, refusals);
        expect(out.allowed).toBe(false);
      }));
  });

  it('an allowed generation implies every refusing condition was false', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCredential, arbCounts, arbRefusals,
      (ask, config, credential, counts, refusals) => {
        const out = decideGeneration(ask, config, credential, counts, refusals);
        if (out.allowed) {
          expect(config.enabled).toBe(true);
          expect(credential.needed && !credential.present).toBe(false);
          expect(ask.prompt.trim()).not.toBe('');
          expect(counts.session).toBeLessThan(config.sessionCap);
          expect(counts.day).toBeLessThan(config.dailyCap);
          expect(refusals.some(row => isReword(ask.prompt, row.prompt))).toBe(false);
        }
      }));
  });

  it('a refusal always says something actionable rather than a bare no', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCredential, arbCounts, arbRefusals,
      (ask, config, credential, counts, refusals) => {
        const out = decideGeneration(ask, config, credential, counts, refusals);
        if (!out.allowed) { expect(out.reason.length).toBeGreaterThan(30); }
      }));
  });

  it('the decision never depends on the credential value, only on its presence', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCounts, arbRefusals, fc.string(),
      (ask, config, counts, refusals, value) => {
        const withValue: CredentialState = { needed: true, envVar: 'K', present: true, value },
              withOther: CredentialState = { needed: true, envVar: 'K', present: true, value: 'other' };
        expect(decideGeneration(ask, config, withValue, counts, refusals))
          .toEqual(decideGeneration(ask, config, withOther, counts, refusals));
      }));
  });

  it('no refusal reason ever contains the credential value', () => {
    fc.assert(fc.property(arbAsk, arbConfig, arbCounts, arbRefusals,
      fc.stringMatching(/^[A-Za-z0-9]{16,40}$/),
      (ask, config, counts, refusals, value) => {
        const state: CredentialState = { needed: true, envVar: 'K', present: true, value };
        const out = decideGeneration(ask, config, state, counts, refusals);
        if (!out.allowed) { expect(out.reason).not.toContain(value); }
      }));
  });

});

describe('similarity invariants', () => {

  it('similarity always lands in [0, 1]', () => {
    fc.assert(fc.property(arbPrompt, arbPrompt, (a, b) => {
      const score = promptSimilarity(a, b);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }));
  });

  it('similarity is symmetric', () => {
    fc.assert(fc.property(arbPrompt, arbPrompt, (a, b) => {
      expect(promptSimilarity(a, b)).toBeCloseTo(promptSimilarity(b, a), 12);
    }));
  });

  it('a prompt with content words is always a rewording of itself', () => {
    fc.assert(fc.property(arbPrompt, (prompt) => {
      fc.pre(promptTokens(prompt).size > 0);
      expect(promptSimilarity(prompt, prompt)).toBe(1);
      expect(isReword(prompt, prompt)).toBe(true);
    }));
  });

  it('a prompt with no content words resembles nothing, so it blocks nothing', () => {
    fc.assert(fc.property(arbPrompt, (other) => {
      expect(promptSimilarity('the of and a', other)).toBe(0);
    }));
  });

  it('a perfect score always means one content-word set contains the other', () => {
    fc.assert(fc.property(arbPrompt, arbPrompt, (a, b) => {
      if (promptSimilarity(a, b) !== 1) { return; }
      const left = promptTokens(a), right = promptTokens(b);
      const contained = [...left].every(token => right.has(token))
                     || [...right].every(token => left.has(token));
      expect(contained).toBe(true);
    }));
  });

  it('a short prompt contained in a long one is not, by itself, a rewording', () => {
    fc.assert(fc.property(fc.constantFrom('bicycle', 'a red bicycle'), (short) => {
      const long = `${short} shop in Amsterdam at noon with tulips and rain`;
      expect(isReword(long, short)).toBe(false);
    }));
  });

  it('tokenizing is idempotent under re-joining', () => {
    fc.assert(fc.property(arbPrompt, (prompt) => {
      const once = [...promptTokens(prompt)];
      expect([...promptTokens(once.join(' '))].sort()).toEqual([...once].sort());
    }));
  });

});
