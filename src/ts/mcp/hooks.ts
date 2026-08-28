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
import { effectiveValue }                          from '../channels/config.js';
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
 * The prose-convention toggles the context line carries to the skills, with their
 * code-side defaults.
 *
 * Skills are static Markdown and cannot vary by configuration, so a config key that
 * governs a pure-prose convention (the salience glyph, visible revision, the gift
 * register, the party roster) has no tool schema to be baked into. This table is the
 * transport instead: the turn-start hook reads each key and appends a compact flags
 * segment to the context line it already injects, and the skills obey the flags the
 * line carries. Adding a future skill-level toggle means adding one row here.
 *
 * Key names and defaults coordinate with #30 (which owns the config surface); the key
 * name is the interface, not the transport.
 */
export const CONVENTION_FLAGS: readonly { label: string; key: string; fallback: boolean }[] = [
  { label: 'salience', key: 'salience.enabled', fallback: true  },
  { label: 'revision', key: 'revision.enabled', fallback: false },
  { label: 'gifts',    key: 'gifts.enabled',    fallback: false },
  { label: 'roster',   key: 'roster.enabled',   fallback: false },
];

/**
 * The context line's conventions-flags segment, e.g.
 * `conventions: salience:on revision:off gifts:off roster:off`.
 *
 * Reads through the tolerant effective-value accessor (issue #30, D5), so a stored
 * override that fails its key's validator behaves as unset; the registered defaults
 * and the fallbacks here agree by test. Only a canonical `'true'` / `'false'` flips a
 * flag — anything else falls back, on the principle that a toggle should take effect
 * only when unambiguously set. Costs one SELECT per key on a database the hook holds
 * open anyway; no extra tool call, no extra process.
 *
 * @returns the segment text, without trailing punctuation
 *
 * @example
 *   conventionFlags(store)
 *   // => 'conventions: salience:on revision:off gifts:off roster:off'
 *
 * @see CONVENTION_FLAGS
 * @see onUserPromptSubmit
 */
export function conventionFlags(store: Store): string {
  const parts = CONVENTION_FLAGS.map(({ label, key, fallback }) => {
    const value = effectiveValue(store, key),
          on    = value === 'true' ? true : value === 'false' ? false : fallback;
    return `${label}:${on ? 'on' : 'off'}`;
  });
  return `conventions: ${parts.join(' ')}`;
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
 * The open-signature reminder for the clockless case — `time.hook` set exactly to
 * `'false'` (issue #30, D9).
 *
 * The reminder still goes out when the clock sentence is suppressed, because it
 * belongs to enforcement (the `gate.*` family's concern), not to time injection — but
 * the shipped wording says "using the timestamp above", which must not dangle when no
 * timestamp was injected. Hence this variant.
 */
export const OPEN_REMINDER_CLOCKLESS =
  'Open this turn with a signature before working.';

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
 * The context line also carries the conventions-flags segment ({@link conventionFlags})
 * between the clock and the open reminder — the transport by which config keys reach
 * pure-prose skill conventions. It fails open separately: a flags error still delivers
 * the clock and the reminder, just without flags.
 *
 * When `time.hook` is exactly `'false'`, the clock sentence is omitted and the
 * open-signature reminder goes out in its clockless wording — presentation changes,
 * observation does not (issue #30, D9). The conventions flags are config transport,
 * not time presentation, so they still lead the clockless line.
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

  let flags = '';
  if (store !== null) {
    try { flags = ` ${conventionFlags(store)}.`; }
    catch { /* fail open: the clock and reminder still get delivered */ }
  }

  // `time.hook` suppresses the clock sentence, and only that (issue #30, D9): the
  // context write above is observational, not presentational, and is unaffected; the
  // open-signature reminder still goes out, reworded for the clockless case. Only the
  // exact string 'false' suppresses — the same asymmetry the privacy keys use — and
  // the read fails open to keeping the clock, since suppressing on an error would be
  // enforcing a choice nobody made.
  let clock = true;
  if (store !== null) {
    try { clock = readConfig(store, 'time.hook') !== 'false'; }
    catch { /* fail open: keep the clock */ }
  }

  const head     = clock ? `${describeMoment(now)}${flags}` : flags.trimStart(),
        reminder = clock ? OPEN_REMINDER : OPEN_REMINDER_CLOCKLESS;

  return {
    hookSpecificOutput: {
      hookEventName    : 'UserPromptSubmit',
      additionalContext: head === '' ? reminder : `${head} ${reminder}`,
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
