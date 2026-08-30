/**
 * The scrubber's unit tests.
 *
 * Two fake keys run through everything, on purpose:
 *
 * - PATTERNED_KEY looks like a real OpenAI key, so the shape patterns alone would catch
 *   it even if the literal pass were removed;
 * - OPAQUE_KEY looks like nothing at all, so only the literal pass can catch it.
 *
 * Testing with one key would let a broken half of the scrubber hide behind the working
 * half. Testing with both means each half has at least one test that fails when only
 * that half breaks.
 */

import { describe, test, expect } from 'vitest';

import {
  CREDENTIAL_PATTERNS, MIN_LITERAL_SECRET_CHARS, REDACTION,
  redactUrl, scrub, scrubError, scrubSecrets, scrubUnknown, secretForms,
} from '../imagery/scrub.js';

/** A realistic-looking OpenAI project key that matches a shape pattern. */
const PATTERNED_KEY = 'sk-proj-FAKE0123456789abcdefGHIJKLmnopQRSTUVwxyz0123';

/** A realistic-looking Google key that matches a different shape pattern. */
const GOOGLE_KEY = 'AIzaSyFAKE-0123456789abcdefghijklmnopqrs';

/** A credential that matches no pattern at all; only the literal pass can find it. */
const OPAQUE_KEY = 'zzq7wandering-albatross-4815162342-not-a-known-shape';

describe('scrubSecrets — held credentials', () => {

  test('removes a key that matches no recognised shape', () => {
    const text = `the sender echoed the request: {"prompt":"a bike","cred":"${OPAQUE_KEY}"}`;
    const out  = scrubSecrets(text, [OPAQUE_KEY]);
    expect(out).not.toContain(OPAQUE_KEY);
    expect(out).toContain(REDACTION);
  });

  test('removes every occurrence, not just the first', () => {
    const text = `${OPAQUE_KEY} then ${OPAQUE_KEY} then ${OPAQUE_KEY}`;
    const out  = scrubSecrets(text, [OPAQUE_KEY]);
    expect(out).toBe(`${REDACTION} then ${REDACTION} then ${REDACTION}`);
  });

  test('removes the percent-encoded form a query string would carry', () => {
    const secret = 'key with spaces/and+slashes';
    const out    = scrubSecrets(`https://x.test/?q=${encodeURIComponent(secret)}`, [secret]);
    expect(out).not.toContain(encodeURIComponent(secret));
    expect(out).toContain(REDACTION);
  });

  test('removes the base64 form HTTP basic auth would carry', () => {
    const encoded = Buffer.from(`:${OPAQUE_KEY}`, 'utf8').toString('base64');
    const out     = scrubSecrets(`Authorization header was Basic ${encoded}`, [OPAQUE_KEY]);
    expect(out).not.toContain(encoded);
  });

  test('handles several held secrets at once', () => {
    const out = scrubSecrets(`${OPAQUE_KEY} and ${PATTERNED_KEY}`, [OPAQUE_KEY, PATTERNED_KEY]);
    expect(out).not.toContain(OPAQUE_KEY);
    expect(out).not.toContain(PATTERNED_KEY);
  });

  test('a key containing regex metacharacters is escaped, not interpreted', () => {
    const secret = 'a.b*c+d(e)f[g]';
    const out    = scrubSecrets(`sent ${secret} ok`, [secret]);
    expect(out).toBe(`sent ${REDACTION} ok`);
  });

  test('an empty or whitespace secret is skipped rather than replacing everything', () => {
    expect(scrubSecrets('hello world', ['']  )).toBe('hello world');
    expect(scrubSecrets('hello world', ['  '])).toBe('hello world');
  });

  test('a secret shorter than the literal floor is skipped', () => {
    const short = 'x'.repeat(MIN_LITERAL_SECRET_CHARS - 1);
    expect(scrubSecrets(`a ${short} b`, [short])).toBe(`a ${short} b`);
  });

  test('a secret exactly at the literal floor is still removed', () => {
    const atFloor = 'q7z9'.slice(0, MIN_LITERAL_SECRET_CHARS);
    expect(scrubSecrets(`a ${atFloor} b`, [atFloor])).not.toContain(atFloor);
  });

  test('text with no secret in it is returned unchanged', () => {
    expect(scrubSecrets('nothing to see', [OPAQUE_KEY])).toBe('nothing to see');
  });

});

describe('secretForms', () => {

  test('offers the literal, percent-encoded, and both base64 spellings', () => {
    const forms = secretForms('a b c');
    expect(forms).toContain('a b c');
    expect(forms).toContain('a%20b%20c');
    expect(forms).toContain(Buffer.from('a b c', 'utf8').toString('base64'));
    expect(forms).toContain(Buffer.from(':a b c', 'utf8').toString('base64'));
  });

  test('drops encodings that fall below the literal floor', () => {
    const short = 'ab';                                   // 2 chars, under the floor
    expect(secretForms(short).every(form => form.length >= MIN_LITERAL_SECRET_CHARS)).toBe(true);
    expect(secretForms(short)).not.toContain(short);
  });

  test('is sorted longest first, so a long form is consumed before a short one', () => {
    const forms = secretForms(PATTERNED_KEY);
    for (const [index, form] of forms.entries()) {
      const next = forms[index + 1];
      if (next !== undefined) { expect(form.length).toBeGreaterThanOrEqual(next.length); }
    }
  });

});

describe('scrubUnknown — credential shapes, no secret held', () => {

  test('removes an OpenAI-shaped key nobody told it about', () => {
    expect(scrubUnknown(`failed with ${PATTERNED_KEY}`)).not.toContain(PATTERNED_KEY);
  });

  test('removes a Google-shaped key nobody told it about', () => {
    expect(scrubUnknown(`x-goog-api-key was ${GOOGLE_KEY}`)).not.toContain(GOOGLE_KEY);
  });

  test('removes an Anthropic-shaped key that happened to be in the environment', () => {
    const key = 'sk-ant-api03-FAKE0123456789abcdefghijklmnop';
    expect(scrubUnknown(`leaked ${key}`)).not.toContain(key);
  });

  test('keeps the header name and destroys only the value', () => {
    const out = scrubUnknown(`Authorization: Bearer ${OPAQUE_KEY}`);
    expect(out).toContain('Authorization');
    expect(out).not.toContain(OPAQUE_KEY);
  });

  test('handles the JSON spelling a stringified headers object produces', () => {
    const body = JSON.stringify({ 'content-type': 'application/json', 'x-goog-api-key': OPAQUE_KEY });
    const out  = scrubUnknown(body);
    expect(out).not.toContain(OPAQUE_KEY);
    expect(out).toContain('x-goog-api-key');
  });

  test('handles a JSON authorization field', () => {
    const body = JSON.stringify({ authorization: `Bearer ${OPAQUE_KEY}` });
    expect(scrubUnknown(body)).not.toContain(OPAQUE_KEY);
  });

  test('destroys a credential query value and keeps the rest of the URL', () => {
    const out = scrubUnknown(`https://x.test/v1/models:run?key=${GOOGLE_KEY}&alt=sse`);
    expect(out).toBe('https://x.test/v1/models:run?key=[redacted]&alt=sse');
  });

  test('leaves ordinary prose alone', () => {
    const prose = 'the bicycle is red and the sky is the key to the picture';
    expect(scrubUnknown(prose)).toBe(prose);
  });

  test('every registered pattern is global, or it would only scrub the first hit', () => {
    for (const { pattern } of CREDENTIAL_PATTERNS) { expect(pattern.flags).toContain('g'); }
  });

});

describe('scrub — both halves, in order', () => {

  test('an opaque key survives neither pass', () => {
    expect(scrub(`sent ${OPAQUE_KEY}`, [OPAQUE_KEY])).not.toContain(OPAQUE_KEY);
  });

  test('a patterned key is caught even when it is not held', () => {
    expect(scrub(`sent ${PATTERNED_KEY}`, [])).not.toContain(PATTERNED_KEY);
  });

  test('an opaque key is NOT caught when it is not held — the honest limit of the shapes', () => {
    // This is not a defect being papered over; it is the reason the held-secret pass
    // exists at all, and the reason every outward path is given the secret to scrub with.
    expect(scrub(`sent ${OPAQUE_KEY}`, [])).toContain(OPAQUE_KEY);
  });

  test('defaults to holding no secrets', () => {
    expect(scrub(`sent ${PATTERNED_KEY}`)).not.toContain(PATTERNED_KEY);
  });

  test('a secret whose tail looks like a known shape is removed whole, not in part', () => {
    // The reason the held-secret pass runs FIRST. Run the shape patterns first instead
    // and they eat the `sk-…` tail, leaving `acme-production-imagegen-[redacted]` — at
    // which point the literal pass can no longer find the secret it was given, and half
    // the credential is disclosed. Order is load-bearing, so it gets its own test.
    const secret = 'acme-production-imagegen-sk-0123456789abcdefghij';
    const out    = scrub(`the sender echoed ${secret}`, [secret]);
    expect(out).toBe(`the sender echoed ${REDACTION}`);
    expect(out).not.toContain('acme-production-imagegen');
  });

  test('no run of a held secret survives, whichever half of it a pattern claims', () => {
    for (const secret of [`prefix-and-more-${PATTERNED_KEY}`,
                          `${GOOGLE_KEY}-and-a-trailing-part`,
                          `wrapped-${GOOGLE_KEY}-inside`]) {
      const out = scrub(`sent ${secret} onward`, [secret]);
      for (let start = 0; start + 12 <= secret.length; start += 1) {
        expect(out).not.toContain(secret.slice(start, start + 12));
      }
    }
  });

});

describe('scrubError', () => {

  test('scrubs a thrown Error message', () => {
    expect(scrubError(new Error(`401 for ${OPAQUE_KEY}`), [OPAQUE_KEY])).not.toContain(OPAQUE_KEY);
  });

  test('scrubs a cause, which is where fetch hides the real failure', () => {
    const error = new Error('request failed', { cause: new Error(`socket sent ${OPAQUE_KEY}`) });
    const out   = scrubError(error, [OPAQUE_KEY]);
    expect(out).toContain('request failed');
    expect(out).not.toContain(OPAQUE_KEY);
  });

  test('never reads the stack, which is where request bodies end up', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at send (${OPAQUE_KEY})`;
    expect(scrubError(error, [])).toBe('boom');
  });

  test('scrubs a non-Error throw', () => {
    expect(scrubError(`plain string with ${OPAQUE_KEY}`, [OPAQUE_KEY])).not.toContain(OPAQUE_KEY);
  });

});

describe('redactUrl', () => {

  test('keeps the endpoint identifiable and destroys the credential', () => {
    const out = redactUrl(`https://api.test/v1/images?api_key=${OPAQUE_KEY}`);
    expect(out).toContain('https://api.test/v1/images');
    expect(out).not.toContain(OPAQUE_KEY);
  });

  test('leaves a credential-free URL untouched', () => {
    expect(redactUrl('https://api.test/v1/images')).toBe('https://api.test/v1/images');
  });

});
