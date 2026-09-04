/**
 * Types for `deskguard.mjs`, so the tests and any TypeScript caller see its contract.
 *
 * Hand-written rather than emitted, for the same reason as `deskcards.d.mts` beside it:
 * the module is deliberately plain ESM with no build step, so this file is the one place
 * kept in step with it by hand. It is one function; drift shows up as a failing test.
 *
 * @see ./deskguard.mjs
 */

/** The minimal shape `requestAllowed` needs — a real `http.IncomingMessage` satisfies it. */
export interface GuardableRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** The guard's verdict: allowed, or refused with which check failed. */
export type GuardVerdict =
  | { ok: true }
  | { ok: false; reason: 'host' | 'origin' | 'content-type' };

/** Whether one request may reach the router, checked before any route runs. */
export declare function requestAllowed(req: GuardableRequest, port: number): GuardVerdict;
