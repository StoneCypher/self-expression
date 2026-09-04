/**
 * The image-provider registry: one declarative entry per vendor, and nothing anywhere
 * else that knows a vendor's name.
 *
 * The shape of this module is the answer to "what does adding a third provider cost?"
 * — one entry in {@link IMAGE_PROVIDERS}, and nothing else. The gate, the ledger, the
 * budget, the tool, and the config surface all read the registry; none of them
 * switches on a provider id. The `automatic1111` entry exists partly to prove that:
 * it is a **local** provider with no credential and no cost, and it needed no new
 * interface to arrive, which is the whole claim the registry makes.
 *
 * ## The credential appears here and nowhere else
 *
 * {@link ImageProvider.plan} is the only function in the facility that receives a
 * credential value, and the {@link ImageRequestPlan} it returns is the only object
 * that carries one. That object goes straight to `fetch` and is never stored, never
 * returned to a caller, never stringified into an error, and never handed to the
 * ledger. Every provider that needs a credential sends it in a **header**, never in a
 * query string, for one reason: a URL is the part of a request that everything logs.
 *
 * ## Prices are a static table and say so
 *
 * None of these APIs returns a dollar amount, so a ledger that recorded only
 * provider-reported cost would record `null` forever and a budget facility would be
 * unable to tell the user what they spent. Each entry therefore carries a published
 * list price with the date it was read, and the ledger records which of the two it
 * used. A stale table that is labelled stale is useful; an empty column is not.
 *
 * @see ./client.js
 * @see ./config.js
 * @see ./ledger.js
 */

/** Every provider this version knows, in the order the config surface lists them. */
export const IMAGE_PROVIDER_IDS = ['nanobanana', 'openai', 'automatic1111'] as const;

/** One registered provider's id. */
export type ImageProviderId = (typeof IMAGE_PROVIDER_IDS)[number];

/** Output sizes the tool offers; providers that cannot honour one say so. */
export const IMAGE_SIZES = ['512x512', '1024x1024', '1024x1536', '1536x1024'] as const;

/** One offered output size, `WIDTHxHEIGHT`. */
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Where a cost figure came from, recorded beside the figure so it can be judged. */
export type CostSource = 'provider' | 'list-price' | 'none';

/** A fully-formed HTTP request, credential included — never logged, never stored. */
export interface ImageRequestPlan {
  readonly url     : string;
  readonly method  : 'POST';
  readonly headers : Readonly<Record<string, string>>;
  readonly body    : string;
}

/** One decoded image as it came back from a provider. */
export interface GeneratedImage {
  readonly bytes     : Uint8Array;
  /** Filename extension, without the dot. */
  readonly extension : string;
  readonly mimeType  : string;
}

/**
 * What a provider made of one HTTP reply.
 *
 * `policy` is a separate arm from `error` on purpose: a content-policy refusal is a
 * decision the provider made about the request, and this facility reports it plainly
 * and never reworks the prompt around it. Collapsing it into `error` would erase the
 * distinction the rule depends on.
 */
export type ProviderOutcome =
  | { readonly kind : 'image';
      readonly images            : readonly GeneratedImage[];
      readonly costEstimateUsd   : number | null;
      readonly costSource        : CostSource;
      readonly providerRequestId : string | null }
  | { readonly kind : 'policy'; readonly detail : string }
  | { readonly kind : 'error';  readonly detail : string };

/** Everything a provider needs to build one request. */
export interface ProviderPlanInput {
  readonly prompt     : string;
  readonly model      : string;
  /** `null` when the caller expressed no preference, or the provider ignores sizes. */
  readonly size       : ImageSize | null;
  /** The credential value, resolved from the environment moments ago; `null` for local providers. */
  readonly credential : string | null;
  /** Base URL for providers whose endpoint is user-supplied; ignored by the rest. */
  readonly baseUrl    : string;
}

/** One registered provider: identity, credential naming, endpoint, shapes, and price. */
export interface ImageProvider {
  readonly id             : ImageProviderId;
  readonly label          : string;
  /** Whether a credential is required at all; `false` is what makes a local provider work. */
  readonly needsCredential: boolean;
  /**
   * The environment variable this provider's credential is read from when the user
   * names none. A **name**, never a value, and freely printable — that asymmetry is
   * what makes this configuration rather than storage.
   */
  readonly defaultEnvVar  : string | null;
  readonly defaultModel   : string;
  readonly models         : readonly string[];
  /** Whether {@link ProviderPlanInput.size} reaches the wire at all. */
  readonly supportsSize   : boolean;
  /** Whether the endpoint comes from `image.local_base_url` rather than the vendor. */
  readonly usesBaseUrl    : boolean;
  /** Published list price per image in USD, or `null` when the provider is free. */
  readonly listPriceUsd   : number | null;
  /** Human-readable cost note, including when the price above was read. */
  readonly costNote       : string;
  /** Build one request. The only function in the facility handed a credential. */
  readonly plan           : (input: ProviderPlanInput) => ImageRequestPlan;
  /** Interpret one HTTP reply. Pure, and therefore the part worth testing hardest. */
  readonly read           : (status: number, payload: unknown) => ProviderOutcome;
}

// ---------------------------------------------------------------------------------
// Safe accessors for provider JSON, which is `unknown` until proven otherwise
// ---------------------------------------------------------------------------------

/** The value as a plain object, or `null` when it is anything else. */
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** The value as an array, or `null`. */
function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** The value as a non-empty string, or `null`. */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Walk a path of object keys, stopping at the first thing that is not an object. */
function dig(root: unknown, ...path: readonly string[]): unknown {
  let here: unknown = root;
  for (const key of path) {
    const here_obj = asObject(here);
    if (here_obj === null) { return undefined; }
    here = here_obj[key];
  }
  return here;
}

/** Extension and MIME type for a returned image, defaulting to PNG. */
function imageKind(mimeType: string | null): { extension: string; mimeType: string } {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') { return { extension: 'jpg',  mimeType: 'image/jpeg' }; }
  if (mimeType === 'image/webp')                             { return { extension: 'webp', mimeType: 'image/webp' }; }
  return { extension: 'png', mimeType: 'image/png' };
}

/**
 * Decode one base64 payload into an image, or `null` when it does not decode.
 *
 * @param base64   - the provider's base64 image data
 * @param mimeType - the provider's declared MIME type, or `null` to assume PNG
 *
 * @example
 *   decodeImage('iVBORw0KGgo=', 'image/png')  // => { bytes: Uint8Array, extension: 'png', … }
 */
export function decodeImage(base64: string, mimeType: string | null): GeneratedImage | null {

  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) { return null; }
    return { bytes: new Uint8Array(bytes), ...imageKind(mimeType) };
  } catch {
    return null;
  }

}

/** The width and height a `WIDTHxHEIGHT` size names. */
export function sizeDimensions(size: ImageSize): { width: number; height: number } {
  const [width = 1024, height = 1024] = size.split('x').map(Number);
  return { width, height };
}

/** The error text a provider reply carried, in whichever of the usual places it sat. */
function errorText(payload: unknown, status: number): string {
  return asString(dig(payload, 'error', 'message'))
      ?? asString(dig(payload, 'error'))
      ?? asString(dig(payload, 'message'))
      ?? asString(dig(payload, 'detail'))
      ?? `HTTP ${String(status)} with no error message`;
}

// ---------------------------------------------------------------------------------
// nanobanana — Gemini image generation
// ---------------------------------------------------------------------------------

/** Gemini finish reasons that mean "the model declined", not "the call failed". */
const GEMINI_POLICY_REASONS: readonly string[] = [
  'SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'BLOCKLIST', 'RECITATION', 'SPII',
];

/**
 * Read one Gemini `generateContent` reply.
 *
 * Gemini reports a refusal two different ways depending on where the block happened —
 * `promptFeedback.blockReason` for the prompt, `candidates[].finishReason` for the
 * output — and both must land on the `policy` arm, because both mean the same thing
 * to the user and neither may be retried with different words.
 */
function readGemini(status: number, payload: unknown): ProviderOutcome {

  const blockReason = asString(dig(payload, 'promptFeedback', 'blockReason'));

  if (blockReason !== null) {
    return { kind: 'policy',
             detail: `the provider's content policy blocked the prompt (${blockReason})` };
  }

  if (status < 200 || status >= 300) {
    return { kind: 'error', detail: errorText(payload, status) };
  }

  const candidates = asArray(dig(payload, 'candidates')) ?? [],
        first      = candidates[0],
        finish     = asString(dig(first, 'finishReason'));

  if (finish !== null && GEMINI_POLICY_REASONS.includes(finish)) {
    return { kind: 'policy',
             detail: `the provider's content policy stopped generation (finishReason ${finish})` };
  }

  const parts  = asArray(dig(first, 'content', 'parts')) ?? [],
        images = parts
          .map(part => {
            const data = asString(dig(part, 'inlineData', 'data'));
            return data === null ? null : decodeImage(data, asString(dig(part, 'inlineData', 'mimeType')));
          })
          .filter((image): image is GeneratedImage => image !== null);

  if (images.length === 0) {
    return { kind: 'error',
             detail: `the reply carried no image data${finish === null ? '' : ` (finishReason ${finish})`}` };
  }

  return { kind              : 'image',
           images,
           costEstimateUsd   : null,
           costSource        : 'none',
           providerRequestId : asString(dig(payload, 'responseId')) };

}

// ---------------------------------------------------------------------------------
// OpenAI — the Images API
// ---------------------------------------------------------------------------------

/** OpenAI error codes that mean the content policy refused, not that the call broke. */
const OPENAI_POLICY_CODES: readonly string[] = [
  'moderation_blocked', 'content_policy_violation', 'safety_violation',
];

/** Error text that means a policy refusal even when the code does not say so. */
const OPENAI_POLICY_TEXT = /safety system|content policy|moderation|not allowed by our/i;

/**
 * Read one OpenAI images reply.
 *
 * `gpt-image-1` always answers with base64 rather than a URL, which is exactly what
 * this facility wants: nothing to fetch from a CDN, nothing to hotlink, and the bytes
 * land on the user's disk before anything else happens to them.
 */
function readOpenAi(status: number, payload: unknown): ProviderOutcome {

  if (status < 200 || status >= 300) {

    const code    = asString(dig(payload, 'error', 'code')) ?? '',
          message = errorText(payload, status);

    return OPENAI_POLICY_CODES.includes(code) || OPENAI_POLICY_TEXT.test(message)
      ? { kind: 'policy', detail: `the provider's content policy refused the prompt (${message})` }
      : { kind: 'error',  detail: message };

  }

  const data   = asArray(dig(payload, 'data')) ?? [],
        images = data
          .map(item => {
            const b64 = asString(dig(item, 'b64_json'));
            return b64 === null ? null : decodeImage(b64, `image/${asString(dig(item, 'output_format')) ?? 'png'}`);
          })
          .filter((image): image is GeneratedImage => image !== null);

  if (images.length === 0) {
    return { kind: 'error',
             detail: 'the reply carried no inline image data; this facility never fetches image URLs' };
  }

  return { kind              : 'image',
           images,
           costEstimateUsd   : null,
           costSource        : 'none',
           providerRequestId : asString(dig(payload, 'id')) };

}

// ---------------------------------------------------------------------------------
// automatic1111 — a local endpoint, no credential, no cost
// ---------------------------------------------------------------------------------

/**
 * Read one Automatic1111 `txt2img` reply.
 *
 * A local model has no content policy to refuse with, so there is no `policy` arm
 * here at all — which is the honest shape rather than an omission.
 */
function readAutomatic1111(status: number, payload: unknown): ProviderOutcome {

  if (status < 200 || status >= 300) {
    return { kind: 'error', detail: errorText(payload, status) };
  }

  const raw    = asArray(dig(payload, 'images')) ?? [],
        images = raw
          .map(item => { const b64 = asString(item); return b64 === null ? null : decodeImage(b64, 'image/png'); })
          .filter((image): image is GeneratedImage => image !== null);

  return images.length === 0
    ? { kind: 'error', detail: 'the local endpoint returned no images' }
    : { kind: 'image', images, costEstimateUsd: 0, costSource: 'list-price', providerRequestId: null };

}

// ---------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------

// Adding a fourth provider is one constant below plus one name in IMAGE_PROVIDERS.
// Nothing outside this file names a vendor.
const NANOBANANA: ImageProvider =

  {
    id              : 'nanobanana',
    label           : 'nanobanana (Gemini image generation)',
    needsCredential : true,
    defaultEnvVar   : 'GEMINI_API_KEY',
    defaultModel    : 'gemini-2.5-flash-image',
    models          : ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation'],
    supportsSize    : false,
    usesBaseUrl     : false,
    listPriceUsd    : 0.039,
    costNote        :
      'Gemini image generation is billed per generated image; the API returns no dollar ' +
      'figure, so the ledger records the published list price (about $0.039/image, read ' +
      '2026-08) and labels it an estimate. The provider’s own billing is authoritative.',
    plan            : (input): ImageRequestPlan => ({
      url     : `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
      method  : 'POST',
      // The key rides a header rather than the documented `?key=` query parameter,
      // because a URL is the part of a request that every layer logs by default.
      headers : { 'content-type': 'application/json', 'x-goog-api-key': input.credential ?? '' },
      body    : JSON.stringify({
        contents         : [{ parts: [{ text: input.prompt }] }],
        generationConfig : { responseModalities: ['IMAGE'] },
      }),
    }),
    read            : readGemini,
  };

const OPENAI: ImageProvider =

  {
    id              : 'openai',
    label           : 'OpenAI images',
    needsCredential : true,
    defaultEnvVar   : 'OPENAI_API_KEY',
    defaultModel    : 'gpt-image-1',
    models          : ['gpt-image-1', 'dall-e-3'],
    supportsSize    : true,
    usesBaseUrl     : false,
    listPriceUsd    : 0.04,
    costNote        :
      'OpenAI image generation is billed per image and by quality; the API returns token ' +
      'usage but no dollar figure, so the ledger records the published list price (about ' +
      '$0.04 for one standard 1024×1024, read 2026-08) and labels it an estimate.',
    plan            : (input): ImageRequestPlan => ({
      url     : 'https://api.openai.com/v1/images/generations',
      method  : 'POST',
      headers : { 'content-type': 'application/json', authorization: `Bearer ${input.credential ?? ''}` },
      body    : JSON.stringify({
        model  : input.model,
        prompt : input.prompt,
        n      : 1,
        ...(input.size === null ? {} : { size: input.size }),
      }),
    }),
    read            : readOpenAi,
  };

const AUTOMATIC1111: ImageProvider =

  {
    id              : 'automatic1111',
    label           : 'Automatic1111 / ComfyUI-compatible local endpoint',
    needsCredential : false,
    defaultEnvVar   : null,
    defaultModel    : 'local',
    models          : ['local'],
    supportsSize    : true,
    usesBaseUrl     : true,
    listPriceUsd    : 0,
    costNote        :
      'A local endpoint costs no money. It still draws on the session and daily caps, ' +
      'which bound attention and disk as well as spend; raise them if local generation ' +
      'is your normal practice.',
    plan            : (input): ImageRequestPlan => {
      const { width, height } = sizeDimensions(input.size ?? '1024x1024');
      return {
        url     : `${input.baseUrl.replace(/\/+$/, '')}/sdapi/v1/txt2img`,
        method  : 'POST',
        headers : { 'content-type': 'application/json' },
        body    : JSON.stringify({ prompt: input.prompt, width, height, steps: 20 }),
      };
    },
    read            : readAutomatic1111,
  };

/**
 * Every provider this version knows about, in the order the config surface lists them.
 *
 * The entries are named constants rather than array literals so
 * {@link DEFAULT_IMAGE_PROVIDER} can be one of them by identity — a lookup with a
 * fallback would have needed a non-null assertion, and an assertion is a promise the
 * compiler cannot check.
 */
export const IMAGE_PROVIDERS: readonly ImageProvider[] = [NANOBANANA, OPENAI, AUTOMATIC1111];

/** The provider used when `image.provider` is unset or names something unknown. */
export const DEFAULT_IMAGE_PROVIDER: ImageProvider = NANOBANANA;

/**
 * Look up one provider by id.
 *
 * @param id - the provider id, from configuration or a tool argument
 * @returns the registry entry, or `undefined` for an id this version does not know
 *
 * @example
 *   imageProvider('openai')?.defaultEnvVar   // => 'OPENAI_API_KEY'
 *   imageProvider('midjourney')              // => undefined
 */
export function imageProvider(id: string): ImageProvider | undefined {
  return IMAGE_PROVIDERS.find(provider => provider.id === id);
}

/**
 * The cost to record for one attempt: the provider's own figure when it gave one, and
 * the registry's list price otherwise.
 *
 * Kept separate from the providers themselves so the "which of the two did we use"
 * answer is computed in exactly one place and can be asserted on directly.
 *
 * **A content-policy refusal is priced, not zeroed.** The refusal reached the provider,
 * and the major vendors bill for the call that produced it — which is also why
 * `policy_refused` counts against the caps. A refusal returns no images, so the count
 * cannot be the multiplier; the base per-image price is, which is the smallest honest
 * figure rather than a `null` that would silently under-report every spend total. An
 * `error` and a `timeout` are priced at nothing here, an error because it bought
 * nothing and a timeout because the caller never settles that row at all.
 *
 * @param provider - the provider that ran the attempt
 * @param outcome  - what its reply came to
 * @returns the amount in USD and where the amount came from; `none` when nothing is known
 *
 * @example
 *   estimateCost(openai, { kind: 'image', images: [img], costEstimateUsd: null, … })
 *   // => { usd: 0.04, source: 'list-price' }
 *   estimateCost(openai, { kind: 'policy', detail: 'refused' })
 *   // => { usd: 0.04, source: 'list-price' }
 *   estimateCost(openai, { kind: 'error', detail: 'socket hang up' })
 *   // => { usd: null, source: 'none' }
 */
export function estimateCost(
  provider : ImageProvider,
  outcome  : ProviderOutcome,
): { usd: number | null; source: CostSource } {

  if (outcome.kind === 'error') { return { usd: null, source: 'none' }; }

  if (outcome.kind === 'image'
      && outcome.costEstimateUsd !== null && outcome.costSource === 'provider') {
    return { usd: outcome.costEstimateUsd, source: 'provider' };
  }

  if (provider.listPriceUsd === null) { return { usd: null, source: 'none' }; }

  // A refusal returns no images, so the count cannot be the multiplier; one call was
  // still made, and one image's price is what it would have been billed at.
  const billed = outcome.kind === 'policy' ? 1 : outcome.images.length;

  return { usd: provider.listPriceUsd * billed, source: 'list-price' };

}
