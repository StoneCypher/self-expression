/**
 * The strike gate: every consent, ceiling, and scarcity rule as one pure decision.
 *
 * Enforcement is server-side by design — the facility's own code refuses an
 * over-limit strike; model politeness is never load-bearing. Keeping the decision
 * pure (configuration in, history in, verdict out) is what lets the stochastic tests
 * hammer the invariants: a disabled facility never allows, an allowed volume never
 * exceeds the ceiling, a spent budget always refuses.
 *
 * The audition tool's "interactive configuration conversation" gate is not
 * mechanically detectable (the design flags this honestly), so audition reduces to
 * what *is* enforceable: a fixed low volume and its own modest rate allowance,
 * outside the strike budget.
 *
 * @see ./config.js
 * @see ./ledger.js
 */

import type { AudioConfig }             from './config.js';
import type { RecentStrike }            from './ledger.js';
import type { Leitmotif, StrikeKind }   from './vocabulary.js';

/** Volume auditions always play at (further clamped by the ceiling). */
export const AUDITION_VOLUME = 20;

/** Minimum seconds between auditions — brisk enough to review a palette. */
export const AUDITION_MIN_GAP_SECONDS = 5;

/** Auditions allowed per rolling hour. */
export const AUDITION_HOURLY_BUDGET = 20;

/** What the gate is being asked to permit. */
export interface StrikeAsk {
  readonly kind            : StrikeKind;
  /** The meaning to strike; `null` for `say`. */
  readonly leitmotif       : Leitmotif | null;
  /** Caller-chosen volume 0–100, or `null` to take the kind's default. */
  readonly requestedVolume : number | null;
}

/** The verdict: a volume to play at, or the specific limit that refused. */
export type GateDecision =
  | { readonly allowed: true;  readonly volume: number }
  | { readonly allowed: false; readonly reason: string };

/** Seconds elapsed between two ISO UTC stamps (negative when `b` precedes `a`). */
function secondsBetween(aUtc: string, bUtc: string): number {
  return (Date.parse(bUtc) - Date.parse(aUtc)) / 1000;
}

/**
 * The default volume for a kind: `attention` earns the full ceiling — it exists for
 * the moments the budget protects — everything else defaults to half of it, so the
 * soft strike is the unmarked case and loudness is always a choice.
 */
function defaultVolume(ask: StrikeAsk, ceiling: number): number {
  return ask.leitmotif === 'attention' ? ceiling : Math.round(ceiling / 2);
}

/**
 * Decide one strike attempt against configuration, recent history, and session state.
 *
 * Rules, in refusal order: the facility must be enabled exactly (`audio.enabled` is
 * `'true'`); `say` additionally needs its own tier gate; `session-open` plays at most
 * once per server process; auditions obey their own gap and budget at a fixed low
 * volume; audible strikes obey the minimum gap and the rolling per-hour budget
 * (`attention` draws from its slightly larger budget). An allowed volume is the
 * caller's choice clamped into `[0, ceiling]` — the assistant can choose softer,
 * never louder.
 *
 * @param ask               - what is being struck, and how loud the caller asked for
 * @param config            - the audio configuration in force right now
 * @param recentPlayed      - strikes that actually played in the last hour, oldest first
 * @param sessionOpenStruck - whether `session-open` already played this server process
 * @param nowUtc            - the decision instant, ISO 8601 UTC
 *
 * @example
 *   decideStrike(
 *     { kind: 'strike', leitmotif: 'spark', requestedVolume: null },
 *     config, [], false, '2026-08-28T10:00:00.000Z')
 *   // => { allowed: true, volume: 25 } under the default 50 ceiling
 */
export function decideStrike(
  ask               : StrikeAsk,
  config            : AudioConfig,
  recentPlayed      : readonly RecentStrike[],
  sessionOpenStruck : boolean,
  nowUtc            : string,
): GateDecision {

  if (!config.enabled) {
    return { allowed: false,
             reason: "audio is disabled: audio.enabled is not exactly 'true' (the user enables it; default off)" };
  }

  if (ask.kind === 'say' && !config.ttsLocal) {
    return { allowed: false,
             reason: "the local TTS tier is disabled: audio.tts_local is not exactly 'true'" };
  }

  if (ask.kind === 'strike' && ask.leitmotif === 'session-open' && sessionOpenStruck) {
    return { allowed: false,
             reason: 'session-open plays at most once per session, and it already has' };
  }

  if (ask.kind === 'audition') {

    const auditions = recentPlayed.filter(row => row.kind === 'audition'),
          last      = auditions[auditions.length - 1];

    if (last !== undefined && secondsBetween(last.utc, nowUtc) < AUDITION_MIN_GAP_SECONDS) {
      return { allowed: false,
               reason: `audition minimum gap is ${String(AUDITION_MIN_GAP_SECONDS)} s; the last audition was too recent` };
    }

    if (auditions.length >= AUDITION_HOURLY_BUDGET) {
      return { allowed: false,
               reason: `audition budget is ${String(AUDITION_HOURLY_BUDGET)} per hour, and it is spent` };
    }

    return { allowed: true, volume: Math.min(AUDITION_VOLUME, config.ceiling) };

  }

  // Audible strikes: 'strike' and 'say' share the gap and the budget — scarcity is
  // of noise in the room, not of any one tool.
  const audible = recentPlayed.filter(row => row.kind !== 'audition'),
        last    = audible[audible.length - 1];

  if (last !== undefined) {
    const elapsed = secondsBetween(last.utc, nowUtc);
    if (elapsed < config.minGapSeconds) {
      const wait = Math.ceil(config.minGapSeconds - elapsed);
      return { allowed: false,
               reason: `minimum gap between strikes is ${String(config.minGapSeconds)} s; ` +
                       `about ${String(wait)} s remain` };
    }
  }

  const budget = ask.leitmotif === 'attention' ? config.hourlyBudgetAttention : config.hourlyBudget;

  if (audible.length >= budget) {
    return { allowed: false,
             reason: `the hourly strike budget (${String(budget)}) is spent; ` +
                     'scarcity is what keeps a leitmotif meaningful' };
  }

  const requested = ask.requestedVolume ?? defaultVolume(ask, config.ceiling);

  return { allowed: true, volume: Math.min(config.ceiling, Math.max(0, Math.round(requested))) };

}
