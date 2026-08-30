/**
 * The one place this facility talks to a network, and therefore the one place a
 * credential could escape.
 *
 * Everything in here is arranged around a single rule: **no string leaves this module
 * without passing through the scrubber.** The plan object holding the credential is
 * built by the provider, handed to the sender, and dropped; it is never returned, never
 * stringified, and never attached to an error. Every `detail` on every arm of every
 * outcome is scrubbed on the way out, including the ones produced by code that has no
 * business seeing a credential at all — because "this path cannot possibly contain the
 * key" is the belief that puts keys in logs.
 *
 * The sender is injected so the whole of this module is testable without a socket, and
 * so a test can supply the realistic hostile case: a sender that echoes the request it
 * was given — headers included — into its failure text, which is exactly what real
 * provider SDKs do.
 *
 * @see ./scrub.js
 * @see ./providers.js
 */

import type { ImageProvider, ImageRequestPlan, ProviderOutcome } from './providers.js';
import { scrub, scrubError } from './scrub.js';

/** One HTTP reply, reduced to the two things a provider reader needs. */
export interface HttpReply {
  readonly status : number;
  readonly text   : string;
}

/**
 * How a request becomes a reply.
 *
 * Injected everywhere so tests exercise the real parsing, the real dispatch, and the
 * real scrubbing without a network.
 */
export type HttpSend = (plan: ImageRequestPlan, timeoutMs: number) => Promise<HttpReply>;

/**
 * Largest total image payload one generation may return, in bytes.
 *
 * A cap rather than trust: the bytes are written to the user's disk, and a provider
 * (or something impersonating one) returning half a gigabyte should be a refusal
 * rather than a full filesystem.
 */
export const MAX_TOTAL_IMAGE_BYTES: number = 32 * 1024 * 1024;

/**
 * The real sender: `fetch` with a timeout, and nothing else.
 *
 * Node's global `fetch` is used deliberately over any provider SDK. An SDK would bring
 * its own retry policy (a retry is a second charge), its own logging (the classic key
 * leak), and its own opinion about what to do with an error body. This facility wants
 * exactly one request, one reply, and no opinions.
 *
 * @param plan      - the fully-formed request, credential included
 * @param timeoutMs - how long to wait before abandoning the request
 * @returns the status and the body text
 *
 * @throws {Error} On transport failure or timeout. The caller scrubs it; this function
 *                 deliberately adds no context of its own, because the only context it
 *                 has is the request.
 */
export async function nodeSend(plan: ImageRequestPlan, timeoutMs: number): Promise<HttpReply> {

  const response = await fetch(plan.url, {
    method  : plan.method,
    headers : { ...plan.headers },
    body    : plan.body,
    signal  : AbortSignal.timeout(timeoutMs),
  });

  return { status: response.status, text: await response.text() };

}

/** Parse a body as JSON, or `undefined` when it is not JSON at all. */
function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** A short, scrubbed excerpt of a non-JSON body, for the error text. */
function excerpt(text: string, secrets: readonly string[]): string {
  const cleaned = scrub(text.replace(/\s+/g, ' ').trim(), secrets);
  return cleaned.length <= 200 ? cleaned : `${cleaned.slice(0, 200)}…`;
}

/**
 * Scrub every `detail` an outcome carries, whichever arm it is.
 *
 * Applied to provider output unconditionally. A provider reader has no access to a
 * credential and no reason to emit one — and that is precisely the assumption worth
 * not relying on, since a reader echoes provider text and provider text echoes
 * requests.
 *
 * @example
 *   scrubOutcome({ kind: 'error', detail: 'Bearer sk-fake-0123456789ab rejected' }, [])
 *   // => { kind: 'error', detail: 'Bearer [redacted] rejected' }
 */
export function scrubOutcome(outcome: ProviderOutcome, secrets: readonly string[]): ProviderOutcome {

  if (outcome.kind === 'image') { return outcome; }

  return { kind: outcome.kind, detail: scrub(outcome.detail, secrets) };

}

/**
 * Send one planned request and interpret the reply, scrubbing everything on the way out.
 *
 * Failure modes are kept distinct because the caller treats them differently: a
 * `policy` outcome is reported to the user and never reworded, while an `error` is an
 * ordinary failure the caller may describe and the user may retry.
 *
 * @param provider  - the provider whose reader interprets the reply
 * @param plan      - the fully-formed request; consumed here and never returned
 * @param send      - how to perform the request
 * @param timeoutMs - how long to wait before abandoning it
 * @param secrets   - credential values held right now, for the scrubber
 * @returns the provider's outcome, with every text field scrubbed
 *
 * @example
 *   await callProvider(openai, plan, nodeSend, 120_000, [key])
 *   // => { kind: 'image', images: [ … ], costEstimateUsd: null, … }
 */
export async function callProvider(
  provider  : ImageProvider,
  plan      : ImageRequestPlan,
  send      : HttpSend,
  timeoutMs : number,
  secrets   : readonly string[],
): Promise<ProviderOutcome> {

  let reply: HttpReply;

  try {
    reply = await send(plan, timeoutMs);
  } catch (error) {
    return { kind: 'error', detail: `the request to ${provider.label} failed: ${scrubError(error, secrets)}` };
  }

  const payload = parseJson(reply.text);

  if (payload === undefined) {
    return { kind: 'error', detail:
      `${provider.label} answered HTTP ${String(reply.status)} with a body that is not JSON: ` +
      excerpt(reply.text, secrets) };
  }

  let outcome: ProviderOutcome;

  try {
    outcome = provider.read(reply.status, payload);
  } catch (error) {
    return { kind: 'error', detail:
      `could not read the reply from ${provider.label}: ${scrubError(error, secrets)}` };
  }

  if (outcome.kind === 'image') {
    const total = outcome.images.reduce((sum, image) => sum + image.bytes.length, 0);
    if (total > MAX_TOTAL_IMAGE_BYTES) {
      return { kind: 'error', detail:
        `${provider.label} returned ${String(total)} bytes of image data; the cap is ` +
        `${String(MAX_TOTAL_IMAGE_BYTES)} bytes and nothing that large is written to disk` };
    }
  }

  return scrubOutcome(outcome, secrets);

}
