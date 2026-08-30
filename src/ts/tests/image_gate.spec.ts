/**
 * The generation gate's unit tests.
 *
 * The gate is where money is refused, so the tests care about two things beyond the
 * plain yes/no: that a refusal names the specific cap that fired and the call that
 * raises it, and that the no-rewording rule blocks a reworded retry while leaving a
 * genuinely different request alone.
 */

import { describe, test, expect } from 'vitest';

import {
  MIN_COMPARABLE_TOKENS, REWORD_SIMILARITY_THRESHOLD,
  decideGeneration, isReword, promptSimilarity, promptTokens,
} from '../imagery/gate.js';
import type { GenerationCounts } from '../imagery/gate.js';
import type { ImageConfig, CredentialState } from '../imagery/config.js';
import { imageProvider } from '../imagery/providers.js';
import type { ImageProvider } from '../imagery/providers.js';

function must(id: string): ImageProvider {
  const found = imageProvider(id);
  if (found === undefined) { throw new Error(`no provider ${id}`); }
  return found;
}

const CONFIG: ImageConfig = {
  enabled          : true,
  provider         : must('openai'),
  model            : 'gpt-image-1',
  sessionCap       : 6,
  dailyCap         : 20,
  timeoutSeconds   : 120,
  localBaseUrl     : 'http://127.0.0.1:7860',
  credentialEnvVar : 'OPENAI_API_KEY',
};

const HAVE: CredentialState = { needed: true, envVar: 'OPENAI_API_KEY', present: true, value: 'sk-fake-0123456789abcdef' },
      LACK: CredentialState = { needed: true, envVar: 'OPENAI_API_KEY', present: false, value: null };

const FRESH: GenerationCounts = { session: 0, day: 0 };

const ASK = { prompt: 'a red bicycle leaning on a wall at dusk', size: null };

describe('decideGeneration — consent and credential', () => {

  test('allows an ordinary first call', () => {
    expect(decideGeneration(ASK, CONFIG, HAVE, FRESH, [])).toEqual({ allowed: true });
  });

  test('a disabled facility refuses and says which switch', () => {
    const out = decideGeneration(ASK, { ...CONFIG, enabled: false }, HAVE, FRESH, []);
    expect(out.allowed).toBe(false);
    if (!out.allowed) { expect(out.reason).toContain('image.enabled'); }
  });

  test('a missing credential names the variable, never a value', () => {
    const out = decideGeneration(ASK, CONFIG, LACK, FRESH, []);
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.reason).toContain('OPENAI_API_KEY');
      expect(out.reason).toContain('image.api_key_env');
      expect(out.reason).not.toContain('sk-fake');
    }
  });

  test('a provider needing no credential is not blocked by the absence of one', () => {
    const noKey: CredentialState = { needed: false, envVar: null, present: true, value: null };
    const out = decideGeneration(ASK, { ...CONFIG, provider: must('automatic1111'), credentialEnvVar: null },
                                 noKey, FRESH, []);
    expect(out.allowed).toBe(true);
  });

  test('an empty prompt is refused before anything else costs money', () => {
    const out = decideGeneration({ prompt: '   ', size: null }, CONFIG, HAVE, FRESH, []);
    expect(out.allowed).toBe(false);
    if (!out.allowed) { expect(out.reason).toContain('non-empty prompt'); }
  });

});

describe('decideGeneration — the caps', () => {

  test('a spent session cap names the cap, its number, and how to raise it', () => {
    const out = decideGeneration(ASK, CONFIG, HAVE, { session: 6, day: 0 }, []);
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.reason).toContain('per-session');
      expect(out.reason).toContain('(6)');
      expect(out.reason).toContain('configure set image.session_cap');
    }
  });

  test('a spent daily cap names its own key, not the session one', () => {
    const out = decideGeneration(ASK, CONFIG, HAVE, { session: 0, day: 20 }, []);
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.reason).toContain('per-day');
      expect(out.reason).toContain('configure set image.daily_cap');
      expect(out.reason).not.toContain('image.session_cap');
    }
  });

  test('the session cap is reported first, because it is the cheaper one to clear', () => {
    const out = decideGeneration(ASK, CONFIG, HAVE, { session: 6, day: 20 }, []);
    if (!out.allowed) { expect(out.reason).toContain('per-session'); }
  });

  test('one below a cap is still allowed; exactly at it is not', () => {
    expect(decideGeneration(ASK, CONFIG, HAVE, { session: 5, day: 0 }, []).allowed).toBe(true);
    expect(decideGeneration(ASK, CONFIG, HAVE, { session: 6, day: 0 }, []).allowed).toBe(false);
    expect(decideGeneration(ASK, CONFIG, HAVE, { session: 0, day: 19 }, []).allowed).toBe(true);
    expect(decideGeneration(ASK, CONFIG, HAVE, { session: 0, day: 20 }, []).allowed).toBe(false);
  });

  test('a cap of zero refuses everything, which is a usable off-switch', () => {
    expect(decideGeneration(ASK, { ...CONFIG, sessionCap: 0 }, HAVE, FRESH, []).allowed).toBe(false);
  });

});

describe('the no-rewording rule', () => {

  const REFUSED = [{ utc: '2026-08-29T10:00:00.000Z', prompt: 'a red bicycle leaning on a wall at dusk' }];

  test('the identical prompt is refused locally, before any money is spent', () => {
    const out = decideGeneration(ASK, CONFIG, HAVE, FRESH, REFUSED);
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.reason).toContain('content policy');
      expect(out.reason).toContain('2026-08-29T10:00:00.000Z');
    }
  });

  test('a reworded prompt is refused too — that is the whole point of the rule', () => {
    const reworded = { prompt: 'please render a crimson bicycle resting against a wall at dusk', size: null };
    expect(decideGeneration(reworded, CONFIG, HAVE, FRESH, REFUSED).allowed).toBe(false);
  });

  test('a genuinely different request passes untouched', () => {
    const different = { prompt: 'a bar chart of quarterly revenue in blue', size: null };
    expect(decideGeneration(different, CONFIG, HAVE, FRESH, REFUSED).allowed).toBe(true);
  });

  test('the refusal tells the model to report and stop rather than to try harder', () => {
    const out = decideGeneration(ASK, CONFIG, HAVE, FRESH, REFUSED);
    if (!out.allowed) {
      expect(out.reason).toContain('plainly');
      expect(out.reason).toContain('not yours');
    }
  });

  test('any one of several recent refusals is enough to block', () => {
    const many = [{ utc: '2026-08-29T09:00:00.000Z', prompt: 'a bar chart of revenue' },
                  ...REFUSED];
    expect(decideGeneration(ASK, CONFIG, HAVE, FRESH, many).allowed).toBe(false);
  });

  test('an empty refusal history blocks nothing', () => {
    expect(decideGeneration(ASK, CONFIG, HAVE, FRESH, []).allowed).toBe(true);
  });

});

describe('promptTokens and promptSimilarity', () => {

  test('drops stopwords and punctuation, keeps subject matter', () => {
    expect([...promptTokens('A red bicycle, in the rain!')].sort()).toEqual(['bicycle', 'rain', 'red']);
  });

  test('drops the words that mean "make me a picture", which every prompt shares', () => {
    expect(promptTokens('draw an image of a bicycle')).toEqual(new Set(['bicycle']));
  });

  test('identical content words score one however they are punctuated', () => {
    expect(promptSimilarity('a red bicycle', 'THE RED BICYCLE!!')).toBe(1);
  });

  test('disjoint subjects score zero', () => {
    expect(promptSimilarity('a red bicycle', 'a blue whale')).toBe(0);
  });

  test('an empty prompt resembles nothing, including another empty prompt', () => {
    expect(promptSimilarity('', '')).toBe(0);
    expect(promptSimilarity('the of and', 'a red bicycle')).toBe(0);
  });

  test('similarity is symmetric', () => {
    const a = 'a red bicycle at dusk on a hill',
          b = 'a crimson bicycle at dusk';
    expect(promptSimilarity(a, b)).toBeCloseTo(promptSimilarity(b, a), 12);
  });

  test('isReword agrees with the threshold it is given', () => {
    const a = 'a red bicycle at dusk',
          b = 'a crimson bicycle at dusk';
    const score = promptSimilarity(a, b);
    expect(isReword(a, b, score)).toBe(true);
    expect(isReword(a, b, score + 0.001)).toBe(false);
  });

  test('the default threshold is the one the module publishes', () => {
    const a = 'alpha beta gamma delta',
          b = 'alpha beta gamma epsilon';
    expect(promptSimilarity(a, b)).toBeGreaterThanOrEqual(REWORD_SIMILARITY_THRESHOLD);
    expect(isReword(a, b)).toBe(true);
  });

  test('padding a refused prompt with new words does not escape the rule', () => {
    // The failure Jaccard had: every added word diluted the score, so the cheapest
    // rewording — keep the nouns, add decoration — was the one that got through.
    const refused = 'a red bicycle leaning on a wall at dusk',
          padded  = 'please render a crimson bicycle resting against a wall at dusk, ' +
                    'oil painting, dramatic lighting, high detail';
    expect(promptSimilarity(refused, padded)).toBeGreaterThanOrEqual(REWORD_SIMILARITY_THRESHOLD);
    expect(isReword(padded, refused)).toBe(true);
  });

  test('a short prompt swallowed by a longer one is not treated as a rewording', () => {
    const short = 'a bicycle',
          long  = 'a bicycle shop in Amsterdam at noon with tulips';
    expect(promptTokens(short).size).toBeLessThan(MIN_COMPARABLE_TOKENS);
    expect(promptSimilarity(long, short)).toBe(0);
    expect(isReword(long, short)).toBe(false);
  });

  test('under the floor, only an exact match of content words counts', () => {
    expect(promptSimilarity('a red bicycle', 'the RED bicycle')).toBe(1);
    expect(promptSimilarity('a red bicycle', 'a red tricycle')).toBe(0);
  });

});
