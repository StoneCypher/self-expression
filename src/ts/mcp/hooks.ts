/**
 * Hook handlers, invoked as `self-expression hook <name>`.
 *
 * They run as subcommands of the same binary rather than as standalone scripts so
 * there is one copy of the storage logic. The previous implementation had separate
 * `.mjs` files that each opened the database themselves, which is how the gate and the
 * logger ended up able to disagree about what had been written.
 *
 * **Every handler fails open.** A hook that throws, or that cannot reach the database,
 * must allow the turn to proceed. Enforcement failing silently is a bad day; a bug in
 * the enforcer wedging a session is a much worse one, and the person it wedges cannot
 * easily debug it from inside the wedge.
 *
 * @see ../channels/context.js
 */

import { recordContext, latestContext, turnCount } from '../channels/context.js';
import { hasClosingSignature }                     from '../channels/entries.js';
import { readConfig }                              from '../channels/store.js';
import type { Store }                              from '../channels/store.js';
import { clockTime, zoneAbbreviation }             from '../channels/time.js';
import { privacyFlags }                            from '../channels/privacy.js';

/** The subset of a hook payload these handlers read. */
export interface HookPayload {
  readonly session_id?      : string;
  readonly prompt_id?       : string;
  readonly cwd?             : string;
  readonly permission_mode? : string;
  readonly agent_id?        : string;
  readonly agent_type?      : string;
  readonly user_input?      : string;
  readonly effort?          : { readonly level?: string };
  readonly hook_event_name? : string;
}

/** What a handler wants written to stdout, and nothing else. */
export type HookOutput = Record<string, unknown> | null;

/**
 * A short human sentence naming the moment a turn begins.
 *
 * Wall-clock time is not otherwise available at turn start, so without it the opening
 * signature has no clock to report and falls back to a placeholder. The zone travels with
 * the clock because the signature timestamp is specified `12-hour, with zone` and must
 * never be fabricated — the model can only carry a zone it was handed, so the hook has to
 * hand it one, exactly as the original standalone hook did. Part-of-day is included
 * because the interesting question is rarely the exact minute — it is whether this is a
 * Tuesday morning or a Saturday at two in the morning.
 *
 * @example
 *   describeMoment(new Date(2026, 7, 18, 14, 5))
 *   // => 'Turn starting Tuesday, August 18, 2026 at 2:05 pm PDT (afternoon).'
 */
export function describeMoment(now: Date): string {

  const hour = now.getHours(),
        part = hour < 5 ? 'small hours'
             : hour < 12 ? 'morning'
             : hour < 17 ? 'afternoon'
             : hour < 21 ? 'evening'
             : 'night',
        date = now.toLocaleDateString('en-US',
                 { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `Turn starting ${date} at ${clockTime(now)} ${zoneAbbreviation(now)} (${part}).`;

}

/**
 * Asks for the opening signature at the only moment it can honestly be written.
 *
 * The opening read is deliberately not enforced at the end of the turn: blocking a stop
 * for a missing open would only produce one written after the fact, and a backdated
 * before-measurement is worse than an absent one, because it looks like data.
 *
 * So this is the entire enforcement, and it is prompting rather than blocking. That is
 * a change of kind from the previous design, where nothing asked at all — which is the
 * most likely explanation for opens running at roughly 54% of closes across five weeks
 * of logged use. Whether asking is sufficient is now a measurable question.
 */
export const OPEN_REMINDER =
  'Open this turn with a signature before working, using the timestamp above.';

/**
 * `UserPromptSubmit`: record what the harness knows, and hand back the clock.
 *
 * The context write is the important half. It is the only way session identity,
 * effort, permission mode and agent identity reach the record at all — the MCP server
 * cannot observe any of them, and the model reporting them about itself is exactly the
 * self-report this design removes.
 *
 * The path-carrying fields — `cwd` and the prompt length — are gated here on the privacy
 * config, at the point of capture, so a suppressed field is never written to the database
 * rather than being hidden after the fact. The config read is inside the fail-open `try`,
 * so a config error skips the context write entirely and still delivers the clock.
 *
 * @example
 *   onUserPromptSubmit(store, { session_id: 'abc', prompt_id: 'p1' }, new Date())
 *   // => { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '…' } }
 */
export function onUserPromptSubmit(store: Store | null, payload: HookPayload, now: Date): HookOutput {

  if (store !== null && typeof payload.session_id === 'string' && payload.session_id !== '') {
    try {
      const privacy = privacyFlags(store);
      recordContext(store, {
        session        : payload.session_id,
        promptId       : payload.prompt_id,
        turnIndex      : turnCount(store, payload.session_id) + 1,
        turn           : 'reply',
        cwd            : privacy.storeCwd ? payload.cwd : undefined,
        permissionMode : payload.permission_mode,
        agentId        : payload.agent_id,
        agentType      : payload.agent_type,
        effort         : payload.effort?.level,
        promptLen      : privacy.storePromptLen ? payload.user_input?.length : undefined,
      }, now);
    } catch { /* fail open: the clock still gets delivered */ }
  }

  return {
    hookSpecificOutput: {
      hookEventName    : 'UserPromptSubmit',
      additionalContext: `${describeMoment(now)} ${OPEN_REMINDER}`,
    },
  };

}

/**
 * `Stop`: refuse to end a turn that never signed off.
 *
 * The question is answered exactly, by turn identity, replacing a three-minute
 * freshness window that passed a slow turn on the *previous* turn's signature and
 * blocked a long turn that had done the right thing.
 *
 * Returns `null` — meaning allow — whenever the answer is not confidently no: gate
 * disabled, no store, no turn context, no known turn. Enforcing on a guess is worse
 * than not enforcing.
 *
 * @example
 *   onStop(store, {})   // => null when the turn already signed off
 *   onStop(store, {})   // => { decision: 'block', reason: '…' } when it did not
 */
export function onStop(store: Store | null, payload: HookPayload): HookOutput {

  if (store === null) { return null; }

  try {

    if (readConfig(store, 'gate.signature') === 'false') { return null; }

    const context  = latestContext(store, payload.session_id),
          promptId = payload.prompt_id
            ?? (typeof context?.['prompt_id'] === 'string' ? context['prompt_id'] : undefined);

    if (promptId === undefined || promptId === '') { return null; }
    if (hasClosingSignature(store, promptId))      { return null; }

    return {
      decision: 'block',
      reason:
        'Close this turn by recording a signature before stopping. Call the ' +
        'self-expression `express` tool with channel "signature" and position "close". ' +
        'If nothing changed, "still; unchanged" is a complete and valid entry — the ' +
        'requirement is to look, not to produce. Then restate your previous final ' +
        'message IN FULL, because a blocked stop can hide it from the user entirely.',
    };

  } catch {

    return null;   // fail open on every error path

  }

}

/**
 * Dispatch a named hook.
 *
 * Unknown names allow rather than erroring, so a hooks file referencing a handler this
 * version does not implement degrades to doing nothing.
 *
 * @example
 *   handleHook('stop', store, payload, new Date())
 */
export function handleHook(
  name    : string,
  store   : Store | null,
  payload : HookPayload,
  now     : Date = new Date(),
): HookOutput {

  if (name === 'user-prompt-submit') { return onUserPromptSubmit(store, payload, now); }
  if (name === 'stop')               { return onStop(store, payload); }

  return null;

}
