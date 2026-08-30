/**
 * The provider registry's unit tests.
 *
 * The two things worth proving here are that every entry obeys the registry's contract
 * (so a fourth provider cannot arrive half-formed) and that each `read` puts a
 * content-policy refusal on the `policy` arm rather than the `error` arm — the whole
 * no-rewording rule downstream depends on that distinction being made correctly at the
 * one place it can be made at all.
 */

import { describe, test, expect } from 'vitest';

import {
  IMAGE_PROVIDERS, IMAGE_PROVIDER_IDS, IMAGE_SIZES,
  decodeImage, estimateCost, imageProvider, sizeDimensions,
} from '../imagery/providers.js';
import type { ImageProvider, ProviderOutcome } from '../imagery/providers.js';

const KEY = 'sk-proj-FAKE0123456789abcdefGHIJKLmnop';

/** One tiny valid PNG, base64-encoded. */
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

function provider(id: string): ImageProvider {
  const found = imageProvider(id);
  if (found === undefined) { throw new Error(`no provider ${id}`); }
  return found;
}

describe('the registry contract', () => {

  test('every declared id has exactly one entry, and vice versa', () => {
    expect(IMAGE_PROVIDERS.map(p => p.id).sort()).toEqual([...IMAGE_PROVIDER_IDS].sort());
    expect(new Set(IMAGE_PROVIDERS.map(p => p.id)).size).toBe(IMAGE_PROVIDERS.length);
  });

  test('a provider that needs a credential names a default variable, and one that does not, does not', () => {
    for (const entry of IMAGE_PROVIDERS) {
      if (entry.needsCredential) { expect(entry.defaultEnvVar).not.toBeNull(); }
      else                       { expect(entry.defaultEnvVar).toBeNull(); }
    }
  });

  test('every default model is one of the models the entry lists', () => {
    for (const entry of IMAGE_PROVIDERS) { expect(entry.models).toContain(entry.defaultModel); }
  });

  test('every entry carries a cost note, because every entry can cost something', () => {
    for (const entry of IMAGE_PROVIDERS) { expect(entry.costNote.length).toBeGreaterThan(20); }
  });

  test('at least one provider needs no credential — the local drop-in the design promises', () => {
    expect(IMAGE_PROVIDERS.some(entry => !entry.needsCredential)).toBe(true);
  });

  test('an unknown id resolves to undefined rather than a default', () => {
    expect(imageProvider('midjourney')).toBeUndefined();
  });

  test('supportsSize tells the truth in both directions', () => {
    // The handler passes `null` for size to a provider that declares it cannot honour
    // one, which is only meaningful if the declaration is honest. Pinned here rather
    // than at the call site because a provider that ignores size makes the call-site
    // guard unobservable — so the invariant worth testing is the registry's, not the
    // handler's: a provider claiming no size support must produce the same request
    // whether or not a size is supplied, and one claiming support must not.
    for (const entry of IMAGE_PROVIDERS) {
      const without = entry.plan({ prompt: 'a bike', model: entry.defaultModel, size: null,
                                   credential: KEY, baseUrl: 'http://127.0.0.1:7860' }),
            with_   = entry.plan({ prompt: 'a bike', model: entry.defaultModel, size: '512x512',
                                   credential: KEY, baseUrl: 'http://127.0.0.1:7860' });
      if (entry.supportsSize) { expect(with_).not.toEqual(without); }
      else                    { expect(with_).toEqual(without); }
    }
  });

});

describe('plan — where the credential goes', () => {

  test('no provider puts the credential in the URL', () => {
    for (const entry of IMAGE_PROVIDERS) {
      const plan = entry.plan({ prompt: 'a bike', model: entry.defaultModel, size: null,
                                credential: KEY, baseUrl: 'http://127.0.0.1:7860' });
      expect(plan.url).not.toContain(KEY);
    }
  });

  test('no provider puts the credential in the body', () => {
    for (const entry of IMAGE_PROVIDERS) {
      const plan = entry.plan({ prompt: 'a bike', model: entry.defaultModel, size: null,
                                credential: KEY, baseUrl: 'http://127.0.0.1:7860' });
      expect(plan.body).not.toContain(KEY);
    }
  });

  test('nanobanana sends the key as a header and asks for image modality', () => {
    const plan = provider('nanobanana').plan({ prompt: 'a bike', model: 'gemini-2.5-flash-image',
                                               size: null, credential: KEY, baseUrl: '' });
    expect(plan.headers['x-goog-api-key']).toBe(KEY);
    expect(plan.url).toContain('gemini-2.5-flash-image:generateContent');
    expect(JSON.parse(plan.body)).toMatchObject({ generationConfig: { responseModalities: ['IMAGE'] } });
  });

  test('openai sends a bearer header and honours a requested size', () => {
    const plan = provider('openai').plan({ prompt: 'a bike', model: 'gpt-image-1',
                                           size: '1024x1536', credential: KEY, baseUrl: '' });
    expect(plan.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(plan.body)).toMatchObject({ size: '1024x1536', n: 1 });
  });

  test('openai omits size entirely when none was asked for', () => {
    const plan = provider('openai').plan({ prompt: 'a bike', model: 'gpt-image-1',
                                           size: null, credential: KEY, baseUrl: '' });
    expect(Object.keys(JSON.parse(plan.body) as object)).not.toContain('size');
  });

  test('the local provider sends no credential header at all', () => {
    const plan = provider('automatic1111').plan({ prompt: 'a bike', model: 'local', size: '512x512',
                                                  credential: null, baseUrl: 'http://127.0.0.1:7860/' });
    expect(Object.keys(plan.headers)).toEqual(['content-type']);
    expect(plan.url).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img');
    expect(JSON.parse(plan.body)).toMatchObject({ width: 512, height: 512 });
  });

});

describe('read — nanobanana', () => {

  const gemini = provider('nanobanana');

  test('an inline image becomes an image outcome', () => {
    const out = gemini.read(200, {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }],
      responseId: 'resp-1',
    });
    expect(out.kind).toBe('image');
    if (out.kind === 'image') {
      expect(out.images).toHaveLength(1);
      expect(out.images[0]?.extension).toBe('png');
      expect(out.providerRequestId).toBe('resp-1');
    }
  });

  test('a blocked prompt is a policy refusal, not an error', () => {
    const out = gemini.read(200, { promptFeedback: { blockReason: 'SAFETY' } });
    expect(out.kind).toBe('policy');
  });

  test('a blocked prompt is a policy refusal even when the HTTP status is a failure', () => {
    const out = gemini.read(400, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } });
    expect(out.kind).toBe('policy');
  });

  test('a safety finishReason is a policy refusal', () => {
    const out = gemini.read(200, { candidates: [{ finishReason: 'IMAGE_SAFETY' }] });
    expect(out.kind).toBe('policy');
  });

  test('an ordinary finishReason with no image is an error, not a policy refusal', () => {
    const out = gemini.read(200, { candidates: [{ finishReason: 'MAX_TOKENS' }] });
    expect(out.kind).toBe('error');
  });

  test('a non-2xx status carries the provider message through', () => {
    const out = gemini.read(429, { error: { message: 'quota exceeded' } });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') { expect(out.detail).toContain('quota exceeded'); }
  });

  test('an empty reply is an error rather than an empty success', () => {
    expect(gemini.read(200, {}).kind).toBe('error');
  });

});

describe('read — openai', () => {

  const openai = provider('openai');

  test('base64 data becomes an image outcome', () => {
    const out = openai.read(200, { id: 'img-1', data: [{ b64_json: PNG_B64 }] });
    expect(out.kind).toBe('image');
    if (out.kind === 'image') { expect(out.providerRequestId).toBe('img-1'); }
  });

  test('a moderation code is a policy refusal', () => {
    const out = openai.read(400, { error: { code: 'moderation_blocked', message: 'blocked' } });
    expect(out.kind).toBe('policy');
  });

  test('a safety-system message with no code is still a policy refusal', () => {
    const out = openai.read(400, { error: { message: 'Your request was rejected by our safety system' } });
    expect(out.kind).toBe('policy');
  });

  test('an ordinary 401 is an error, not a policy refusal', () => {
    const out = openai.read(401, { error: { code: 'invalid_api_key', message: 'Incorrect API key' } });
    expect(out.kind).toBe('error');
  });

  test('a URL-only reply is an error — this facility never fetches image URLs', () => {
    const out = openai.read(200, { data: [{ url: 'https://cdn.test/x.png' }] });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') { expect(out.detail).toContain('never fetches image URLs'); }
  });

});

describe('read — automatic1111', () => {

  const local = provider('automatic1111');

  test('an images array becomes an image outcome with zero cost', () => {
    const out = local.read(200, { images: [PNG_B64] });
    expect(out.kind).toBe('image');
    if (out.kind === 'image') { expect(out.costEstimateUsd).toBe(0); }
  });

  test('a failure is an error; a local model has no content policy to refuse with', () => {
    expect(local.read(500, { detail: 'model not loaded' }).kind).toBe('error');
    expect(local.read(200, { images: [] }).kind).toBe('error');
  });

});

describe('decodeImage', () => {

  test('decodes base64 into bytes and picks the extension from the MIME type', () => {
    expect(decodeImage(PNG_B64, 'image/png')?.extension).toBe('png');
    expect(decodeImage(PNG_B64, 'image/jpeg')?.extension).toBe('jpg');
    expect(decodeImage(PNG_B64, 'image/webp')?.extension).toBe('webp');
  });

  test('defaults to png when the provider declares nothing', () => {
    expect(decodeImage(PNG_B64, null)?.extension).toBe('png');
  });

  test('empty data decodes to nothing rather than a zero-byte image', () => {
    expect(decodeImage('', 'image/png')).toBeNull();
  });

});

describe('sizeDimensions', () => {

  test('splits every offered size into numbers', () => {
    for (const size of IMAGE_SIZES) {
      const { width, height } = sizeDimensions(size);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(`${String(width)}x${String(height)}`).toBe(size);
    }
  });

});

describe('estimateCost', () => {

  const openai = provider('openai'),
        local  = provider('automatic1111');

  const oneImage: ProviderOutcome = {
    kind: 'image', images: [{ bytes: new Uint8Array([1]), extension: 'png', mimeType: 'image/png' }],
    costEstimateUsd: null, costSource: 'none', providerRequestId: null,
  };

  test('falls back to the registry list price and says so', () => {
    expect(estimateCost(openai, oneImage)).toEqual({ usd: 0.04, source: 'list-price' });
  });

  test('scales the list price by the number of images returned', () => {
    const two: ProviderOutcome = { ...oneImage, images: [...oneImage.kind === 'image' ? oneImage.images : [],
                                                         { bytes: new Uint8Array([2]), extension: 'png', mimeType: 'image/png' }] };
    expect(estimateCost(openai, two).usd).toBeCloseTo(0.08, 6);
  });

  test('prefers a provider-reported figure over the table when there is one', () => {
    const reported: ProviderOutcome = { ...oneImage, costEstimateUsd: 0.11, costSource: 'provider' };
    expect(estimateCost(openai, reported)).toEqual({ usd: 0.11, source: 'provider' });
  });

  test('a free local provider costs zero, not unknown', () => {
    expect(estimateCost(local, oneImage)).toEqual({ usd: 0, source: 'list-price' });
  });

  test('a non-image outcome has no cost at all', () => {
    expect(estimateCost(openai, { kind: 'policy', detail: 'no' })).toEqual({ usd: null, source: 'none' });
    expect(estimateCost(openai, { kind: 'error',  detail: 'no' })).toEqual({ usd: null, source: 'none' });
  });

});
