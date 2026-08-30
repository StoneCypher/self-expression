/**
 * Client tests, built around the failure this whole design is defensive about: a sender
 * that echoes the request it was given — headers included — into its error text, which
 * is what real provider SDKs do and is how keys reach logs.
 *
 * Both fake keys appear. The patterned one would be caught by the shape patterns alone;
 * the opaque one can only be caught because the client was handed the secret. A test
 * that used only the first would pass with the held-secret pass deleted.
 */

import { describe, test, expect } from 'vitest';

import { MAX_TOTAL_IMAGE_BYTES, callProvider, scrubOutcome } from '../imagery/client.js';
import type { HttpSend } from '../imagery/client.js';
import { imageProvider } from '../imagery/providers.js';
import type { ImageProvider, ImageRequestPlan } from '../imagery/providers.js';

const PATTERNED_KEY = 'sk-proj-FAKE0123456789abcdefGHIJKLmnop',
      OPAQUE_KEY    = 'zzq7wandering-albatross-4815162342-not-a-known-shape';

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

function must(id: string): ImageProvider {
  const found = imageProvider(id);
  if (found === undefined) { throw new Error(`no provider ${id}`); }
  return found;
}

function planFor(provider: ImageProvider, key: string): ImageRequestPlan {
  return provider.plan({ prompt: 'a red bicycle', model: provider.defaultModel, size: null,
                         credential: key, baseUrl: 'http://127.0.0.1:7860' });
}

/** A sender that answers with fixed status and body. */
function answers(status: number, body: unknown): HttpSend {
  return () => Promise.resolve({ status, text: typeof body === 'string' ? body : JSON.stringify(body) });
}

/**
 * The hostile case: a sender that throws, and puts the entire request — URL, headers,
 * body — into the message, exactly as a chatty HTTP client does.
 */
const echoingThrower: HttpSend = (plan) => {
  throw new Error(
    `connect ECONNREFUSED while POSTing ${plan.url} ` +
    `headers=${JSON.stringify(plan.headers)} body=${plan.body}`);
};

/** The same hostility, but at the HTTP level: the provider echoes the request back. */
function echoingResponder(status: number): HttpSend {
  return (plan) => Promise.resolve({
    status,
    text: JSON.stringify({ error: { message:
      `request rejected: headers ${JSON.stringify(plan.headers)}` } }),
  });
}

describe('the happy path', () => {

  test('parses a provider reply into an image outcome', async () => {
    const provider = must('openai');
    const out = await callProvider(provider, planFor(provider, PATTERNED_KEY),
                                   answers(200, { data: [{ b64_json: PNG_B64 }] }), 1000, [PATTERNED_KEY]);
    expect(out.kind).toBe('image');
  });

  test('passes the timeout through to the sender', async () => {
    const provider = must('openai');
    let seen = 0;
    const send: HttpSend = (_plan, timeoutMs) => {
      seen = timeoutMs;
      return Promise.resolve({ status: 200, text: JSON.stringify({ data: [{ b64_json: PNG_B64 }] }) });
    };
    await callProvider(provider, planFor(provider, PATTERNED_KEY), send, 4321, []);
    expect(seen).toBe(4321);
  });

});

describe('a thrown transport error never carries the credential out', () => {

  test('an echoing throw loses the opaque key, which only the held-secret pass can catch', async () => {
    const provider = must('openai');
    const out = await callProvider(provider, planFor(provider, OPAQUE_KEY), echoingThrower, 1000, [OPAQUE_KEY]);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.detail).not.toContain(OPAQUE_KEY);
      expect(out.detail).toContain('ECONNREFUSED');
    }
  });

  test('an echoing throw loses a patterned key even when no secret is held', async () => {
    const provider = must('openai');
    const out = await callProvider(provider, planFor(provider, PATTERNED_KEY), echoingThrower, 1000, []);
    if (out.kind === 'error') { expect(out.detail).not.toContain(PATTERNED_KEY); }
  });

  test('the same holds for the header-based provider', async () => {
    const provider = must('nanobanana');
    const out = await callProvider(provider, planFor(provider, OPAQUE_KEY), echoingThrower, 1000, [OPAQUE_KEY]);
    if (out.kind === 'error') { expect(out.detail).not.toContain(OPAQUE_KEY); }
  });

  test('a non-Error throw is scrubbed too', async () => {
    const provider = must('openai');
    const send: HttpSend = () => { throw `raw string carrying ${OPAQUE_KEY}`; };
    const out = await callProvider(provider, planFor(provider, OPAQUE_KEY), send, 1000, [OPAQUE_KEY]);
    if (out.kind === 'error') { expect(out.detail).not.toContain(OPAQUE_KEY); }
  });

});

describe('a provider that echoes the request in its error body', () => {

  test('the credential does not survive into the outcome', async () => {
    const provider = must('openai');
    const out = await callProvider(provider, planFor(provider, OPAQUE_KEY),
                                   echoingResponder(400), 1000, [OPAQUE_KEY]);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') { expect(out.detail).not.toContain(OPAQUE_KEY); }
  });

  test('a policy refusal is still classified as policy, and still scrubbed', async () => {
    const provider = must('openai');
    const send: HttpSend = (plan) => Promise.resolve({
      status: 400,
      text: JSON.stringify({ error: { code: 'moderation_blocked',
        message: `rejected by our safety system; sent ${JSON.stringify(plan.headers)}` } }),
    });
    const out = await callProvider(provider, planFor(provider, OPAQUE_KEY), send, 1000, [OPAQUE_KEY]);
    expect(out.kind).toBe('policy');
    if (out.kind === 'policy') { expect(out.detail).not.toContain(OPAQUE_KEY); }
  });

});

describe('bodies that are not what a provider promised', () => {

  test('an HTML error page becomes a scrubbed error with a short excerpt', async () => {
    const provider = must('openai');
    const out = await callProvider(provider, planFor(provider, OPAQUE_KEY),
                                   answers(502, `<html>gateway blew up, sent ${OPAQUE_KEY}</html>`),
                                   1000, [OPAQUE_KEY]);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.detail).toContain('not JSON');
      expect(out.detail).not.toContain(OPAQUE_KEY);
    }
  });

  test('a very long non-JSON body is truncated rather than pasted whole', async () => {
    const provider = must('openai');
    const out = await callProvider(provider, planFor(provider, ''), answers(502, 'x'.repeat(5000)), 1000, []);
    if (out.kind === 'error') { expect(out.detail.length).toBeLessThan(400); }
  });

  test('a reader that throws becomes a scrubbed error rather than a crash', async () => {
    const exploding: ImageProvider = {
      ...must('openai'),
      read: () => { throw new Error(`reader blew up holding ${OPAQUE_KEY}`); },
    };
    const out = await callProvider(exploding, planFor(exploding, OPAQUE_KEY),
                                   answers(200, { data: [] }), 1000, [OPAQUE_KEY]);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') { expect(out.detail).not.toContain(OPAQUE_KEY); }
  });

});

describe('the payload cap', () => {

  test('an oversized image payload is refused rather than written', async () => {
    const huge: ImageProvider = {
      ...must('openai'),
      read: () => ({ kind: 'image', costEstimateUsd: null, costSource: 'none', providerRequestId: null,
                     images: [{ bytes: new Uint8Array(MAX_TOTAL_IMAGE_BYTES + 1),
                                extension: 'png', mimeType: 'image/png' }] }),
    };
    const out = await callProvider(huge, planFor(huge, ''), answers(200, {}), 1000, []);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') { expect(out.detail).toContain('cap is'); }
  });

  test('a payload at the cap is allowed', async () => {
    const atCap: ImageProvider = {
      ...must('openai'),
      read: () => ({ kind: 'image', costEstimateUsd: null, costSource: 'none', providerRequestId: null,
                     images: [{ bytes: new Uint8Array(MAX_TOTAL_IMAGE_BYTES),
                                extension: 'png', mimeType: 'image/png' }] }),
    };
    const out = await callProvider(atCap, planFor(atCap, ''), answers(200, {}), 1000, []);
    expect(out.kind).toBe('image');
  });

});

describe('scrubOutcome', () => {

  test('scrubs the detail of a policy outcome', () => {
    const out = scrubOutcome({ kind: 'policy', detail: `no: ${OPAQUE_KEY}` }, [OPAQUE_KEY]);
    if (out.kind === 'policy') { expect(out.detail).not.toContain(OPAQUE_KEY); }
  });

  test('scrubs the detail of an error outcome', () => {
    const out = scrubOutcome({ kind: 'error', detail: `no: ${OPAQUE_KEY}` }, [OPAQUE_KEY]);
    if (out.kind === 'error') { expect(out.detail).not.toContain(OPAQUE_KEY); }
  });

  test('leaves the bytes of an image outcome untouched', () => {
    const image = { kind: 'image' as const, images: [{ bytes: new Uint8Array([1, 2, 3]),
                                                       extension: 'png', mimeType: 'image/png' }],
                    costEstimateUsd: null, costSource: 'none' as const, providerRequestId: null };
    expect(scrubOutcome(image, [OPAQUE_KEY])).toBe(image);
  });

});
