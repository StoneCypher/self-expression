/**
 * Stochastic property tests for the credential scrubber.
 *
 * The scrubber's contract is a universal claim — *no* held secret survives *any*
 * surrounding text — and a universal claim is exactly what example tests cannot
 * establish. These properties generate the secret and the text it is buried in, so a
 * hole that only opens for one shape of key or one shape of message shows up here
 * rather than in production.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  MIN_LITERAL_SECRET_CHARS, REDACTION, scrub, scrubError, scrubSecrets, scrubUnknown, secretForms,
} from '../imagery/scrub.js';

/** Credential-shaped values: long enough to be real, from the alphabet keys use. */
const arbSecret: fc.Arbitrary<string> = fc.stringMatching(/^[A-Za-z0-9_-]{8,64}$/);

/** Arbitrary surrounding text, including the punctuation an error message carries. */
const arbNoise: fc.Arbitrary<string> = fc.string({ maxLength: 120 });

describe('held secrets never survive', () => {

  it('a secret buried in arbitrary text is gone afterwards', () => {
    fc.assert(fc.property(arbSecret, arbNoise, arbNoise, (secret, before, after) => {
      const text = `${before}${secret}${after}`;
      expect(scrubSecrets(text, [secret])).not.toContain(secret);
    }));
  });

  it('the same holds through the full scrub, in either order of the two passes', () => {
    fc.assert(fc.property(arbSecret, arbNoise, arbNoise, (secret, before, after) => {
      expect(scrub(`${before}${secret}${after}`, [secret])).not.toContain(secret);
    }));
  });

  it('a secret repeated many times is removed every time', () => {
    fc.assert(fc.property(arbSecret, fc.integer({ min: 1, max: 12 }), (secret, times) => {
      const text = Array.from({ length: times }, () => secret).join(' | ');
      const out  = scrubSecrets(text, [secret]);
      expect(out).not.toContain(secret);
      expect(out.split(REDACTION)).toHaveLength(times + 1);
    }));
  });

  it('the percent-encoded form is removed as well as the literal one', () => {
    fc.assert(fc.property(arbSecret, arbNoise, (secret, noise) => {
      const encoded = encodeURIComponent(secret);
      const out     = scrubSecrets(`${noise}?k=${encoded}`, [secret]);
      expect(out).not.toContain(encoded);
    }));
  });

  it('the base64 forms are removed as well as the literal one', () => {
    fc.assert(fc.property(arbSecret, (secret) => {
      const plain = Buffer.from(secret, 'utf8').toString('base64'),
            basic = Buffer.from(`:${secret}`, 'utf8').toString('base64');
      const out = scrubSecrets(`Basic ${basic} and raw ${plain}`, [secret]);
      expect(out).not.toContain(plain);
      expect(out).not.toContain(basic);
    }));
  });

  it('one secret among several is still removed', () => {
    fc.assert(fc.property(fc.array(arbSecret, { minLength: 1, maxLength: 5 }), (secrets) => {
      const text = secrets.join(' then ');
      const out  = scrubSecrets(text, secrets);
      for (const secret of secrets) { expect(out).not.toContain(secret); }
    }));
  });

  it('holding a secret that is not present changes nothing', () => {
    fc.assert(fc.property(arbSecret, arbNoise, (secret, noise) => {
      fc.pre(!noise.includes(secret));
      expect(scrubSecrets(noise, [secret])).toBe(noise);
    }));
  });

  it('no twelve-character run of a held secret survives, whatever shape its tail has', () => {
    // Pins the pass order. If the shape patterns ran first they would consume the
    // `sk-…` tail and strand the prefix, which is a partial disclosure rather than a
    // redaction — and a partial disclosure of a credential is still a disclosure.
    fc.assert(fc.property(fc.stringMatching(/^[a-z]{4,20}$/),
                          fc.stringMatching(/^[A-Za-z0-9]{16,32}$/),
      (prefix, tail) => {
        const secret = `${prefix}-sk-${tail}`,
              out    = scrub(`echoed ${secret} back`, [secret]);
        for (let start = 0; start + 12 <= secret.length; start += 1) {
          expect(out).not.toContain(secret.slice(start, start + 12));
        }
      }));
  });

  it('every offered encoding clears the literal floor', () => {
    fc.assert(fc.property(arbSecret, (secret) => {
      for (const form of secretForms(secret)) {
        expect(form.length).toBeGreaterThanOrEqual(MIN_LITERAL_SECRET_CHARS);
      }
    }));
  });

});

describe('the scrub is stable and total', () => {

  it('scrubbing twice is the same as scrubbing once', () => {
    fc.assert(fc.property(arbSecret, arbNoise, (secret, noise) => {
      const once = scrub(`${noise} ${secret}`, [secret]);
      expect(scrub(once, [secret])).toBe(once);
    }));
  });

  it('scrubUnknown never throws, whatever it is handed', () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), (text) => {
      expect(typeof scrubUnknown(text)).toBe('string');
    }));
  });

  it('an error carrying a secret in its message or cause loses it either way', () => {
    fc.assert(fc.property(arbSecret, arbNoise, (secret, noise) => {
      const direct = new Error(`${noise} ${secret}`),
            nested = new Error(noise, { cause: new Error(`inner ${secret}`) });
      expect(scrubError(direct, [secret])).not.toContain(secret);
      expect(scrubError(nested, [secret])).not.toContain(secret);
    }));
  });

  it('a scrubbed string is never longer than the original plus one redaction per hit', () => {
    fc.assert(fc.property(arbSecret, fc.integer({ min: 1, max: 6 }), (secret, times) => {
      const text = Array.from({ length: times }, () => secret).join('.');
      const out  = scrubSecrets(text, [secret]);
      expect(out.length).toBeLessThanOrEqual(text.length + times * REDACTION.length);
    }));
  });

});

describe('shape patterns, with no secret held', () => {

  it('an OpenAI-shaped key never survives, whatever follows it', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{12,40}$/), arbNoise, (tail, noise) => {
      const key = `sk-${tail}`;
      expect(scrubUnknown(`${noise} ${key}`)).not.toContain(key);
    }));
  });

  it('a Google-shaped key never survives', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{20,40}$/), (tail) => {
      const key = `AIza${tail}`;
      expect(scrubUnknown(`sent ${key} onward`)).not.toContain(key);
    }));
  });

  it('a credential query parameter never survives', () => {
    fc.assert(fc.property(arbSecret, (secret) => {
      expect(scrubUnknown(`https://x.test/v1?key=${secret}&n=1`)).not.toContain(secret);
    }));
  });

  it('a stringified headers object never leaks its authorization value', () => {
    fc.assert(fc.property(arbSecret, (secret) => {
      const body = JSON.stringify({ 'content-type': 'application/json',
                                    authorization: `Bearer ${secret}` });
      expect(scrubUnknown(body)).not.toContain(secret);
    }));
  });

  it('a stringified headers object never leaks a vendor key header', () => {
    fc.assert(fc.property(arbSecret, (secret) => {
      const body = JSON.stringify({ 'x-goog-api-key': secret });
      expect(scrubUnknown(body)).not.toContain(secret);
    }));
  });

});
