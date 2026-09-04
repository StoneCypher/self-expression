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
 * The `name` values Node puts on a rejection when a request was **abandoned** rather
 * than answered.
 *
 * Both spellings are here because both occur: `AbortSignal.timeout` rejects with a
 * `TimeoutError`, while an abort from any other source — and older runtimes' timeouts —
 * rejects with an `AbortError`. Either way nobody knows what the provider did with the
 * request, which is the distinction the ledger cares about.
 */
export const ABANDONMENT_ERROR_NAMES: readonly string[] = ['TimeoutError', 'AbortError'];

/** How far down a `cause` chain to look before giving up. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Whether a rejection means the request was abandoned rather than definitely failed.
 *
 * Follows `cause`, because `fetch` wraps: a timed-out request surfaces as a bare
 * `TypeError: fetch failed` in some runtimes with the `TimeoutError` one level down,
 * and a check that only read the top-level `name` would silently mis-file every
 * timeout as an ordinary error — the exact bug this function exists to prevent.
 *
 * @param error - the thrown value, of entirely unknown shape
 * @param depth - how many `cause` hops have already been taken; callers pass nothing
 *
 * @example
 *   isAbandonment(Object.assign(new Error('x'), { name: 'TimeoutError' }))  // => true
 *   isAbandonment(new Error('socket hang up'))                              // => false
 *   isAbandonment(new TypeError('fetch failed',
 *                 { cause: Object.assign(new Error('t'), { name: 'TimeoutError' }) }))  // => true
 */
export function isAbandonment(error: unknown, depth = 0): boolean {

  if (depth > MAX_CAUSE_DEPTH || typeof error !== 'object' || error === null) { return false; }

  const thrown = error as { name?: unknown; cause?: unknown };

  if (typeof thrown.name === 'string' && ABANDONMENT_ERROR_NAMES.includes(thrown.name)) {
    return true;
  }

  return thrown.cause === undefined ? false : isAbandonment(thrown.cause, depth + 1);

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
 * What one call came to.
 *
 * Everything a provider's reader can say, plus the one thing only the caller can: that
 * the request was **abandoned** before any answer arrived. That arm is not a
 * {@link ProviderOutcome} because no reader could ever produce it — there was no reply
 * to read — and it is not folded into `error` because the two mean opposite things to
 * the budget. An `error` is a definite failure and costs nothing; an abandonment is a
 * request the provider may well have received, run, and billed, and a ledger that
 * settled it as a failure would let a facility whose every call times out spend
 * without limit.
 *
 * @see ../mcp/image_tools.js
 */
export type CallOutcome =
  | ProviderOutcome
  | { readonly kind : 'timeout'; readonly detail : string };

/**
 * Send one planned request and interpret the reply, scrubbing everything on the way out.
 *
 * Failure modes are kept distinct because the caller treats each differently: a
 * `policy` outcome is reported to the user and never reworded, an `error` is an
 * ordinary failure the caller may describe and the user may retry, and a `timeout` is
 * an unknown that stays unknown — see {@link CallOutcome}.
 *
 * @param provider  - the provider whose reader interprets the reply
 * @param plan      - the fully-formed request; consumed here and never returned
 * @param send      - how to perform the request
 * @param timeoutMs - how long to wait before abandoning it
 * @param secrets   - credential values held right now, for the scrubber
 * @returns the call's outcome, with every text field scrubbed
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
): Promise<CallOutcome> {

  let reply: HttpReply;

  try {
    reply = await send(plan, timeoutMs);
  } catch (error) {
    const detail = scrubError(error, secrets);
    return isAbandonment(error)
      ? { kind: 'timeout', detail:
          `the request to ${provider.label} was abandoned after ${String(timeoutMs)}ms without ` +
          `an answer, so whether it was run and billed is unknown: ${detail}` }
      : { kind: 'error', detail: `the request to ${provider.label} failed: ${detail}` };
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
