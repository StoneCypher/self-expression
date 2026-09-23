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
import { hasClosingSignature, register }           from '../channels/entries.js';
import type { RegisterRow }                        from '../channels/entries.js';
import { readConfig }                              from '../channels/store.js';
import { effectiveValue, channelMaxChars, DEFAULT_CHANNEL_MAX_CHARS,
         windowPosture, WINDOW_SURFACES,
         listGateMode, injectMode, DEFAULT_INJECT_MODE } from '../channels/config.js';
import type { WindowPosture, WindowSurface,
              InjectMode }                       from '../channels/config.js';
import { injectedConventions }                   from '../channels/conventions.js';
import { CHANNELS }                                from '../channels/vocabulary.js';
import { unreadCounts, readMessages }              from '../channels/messages.js';
import { offerRipeNotes, renderHeldNote }          from '../channels/notes.js';
import type { Store }                              from '../channels/store.js';
import { clockTime, zoneAbbreviation, partOfDay }  from '../channels/time.js';
import { privacyFlags }                            from '../channels/privacy.js';
import { lintLists, listBlockReason, EXCERPT_MAX }  from '../channels/format_lint.js';
import type { MarkdownParser, ListFinding }        from '../channels/format_lint.js';
import { recordFinding }                           from '../channels/findings.js';
import type { FindingInput }                       from '../channels/findings.js';
import { parseSignatureLine, sameSignatureText, lastNonEmptyLine,
         firstNonEmptyLine, turnSignature }       from '../channels/signature_line.js';
import { firstAssistantTextOfTurn, readTail }      from '../channels/transcript.js';

/**
 * The subset of a hook payload these handlers read, named for what the harness actually
 * sends rather than for what a field's job would suggest it is called.
 *
 * That distinction has already cost this file one silent bug: the prompt text arrives as
 * `prompt`, and a handler reading `user_input` recorded `undefined` on every turn while
 * looking entirely correct. Two fields the harness sends and no handler wants —
 * `last_assistant_message` and `session_title` — are declared anyway, marked as never
 * stored, so the payload's real shape is legible here instead of only in a transcript.
 *
 * Claude Code is the only host that sends hook payloads today; `hooks.claude.json` is the
 * only wiring that exists, and the Codex and Gemini manifests list hooks as pending. So
 * these names track one harness on purpose. A second host gets its own fields when it
 * arrives, rather than speculative aliases nothing has ever populated.
 *
 * @see ../../doc_md/plugin-layout.md the per-host manifest table
 */
export interface HookPayload {
  readonly session_id?             : string;
  readonly prompt_id?              : string;
  readonly cwd?                    : string;
  readonly permission_mode?        : string;
  readonly agent_id?               : string;
  readonly agent_type?             : string;
  /** `UserPromptSubmit`: the text the user typed. Only its **length** is ever read. */
  readonly prompt?                 : string;
  readonly effort?                 : { readonly level?: string };
  readonly hook_event_name?        : string;
  /** `SessionStart` only: what began the session — `startup`, `resume`, `clear`, or `compact`. */
  readonly source?                 : string;
  /**
   * `Stop` only: the turn is already continuing because a Stop hook blocked it once.
   * {@link onStop} allows unconditionally when this is `true` — see there for why.
   */
  readonly stop_hook_active?       : boolean;
  /**
   * `Stop`: the turn's final assistant text. Read by the format checks in {@link onStop}
   * — the visible close line and the list lint — and never stored, except that the list
   * lint logs the first line of a flagged list (at most {@link EXCERPT_MAX} characters) to
   * `format_findings`.
   */
  readonly last_assistant_message? : string;
  /**
   * `Stop` (and every other event): the host's JSONL transcript. Only its tail is read,
   * and only the current turn's first **assistant** text is taken from it, for the open
   * check; see {@link ../channels/transcript.js}.
   */
  readonly transcript_path?        : string;
  /** `UserPromptSubmit`: the host's session title. Documented for shape; never read, never stored. */
  readonly session_title?          : string;
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

  const date = now.toLocaleDateString('en-US',
                 { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `Turn starting ${date} at ${clockTime(now)} ${zoneAbbreviation(now)} (${partOfDay(now)}).`;

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
 * The context line's channel-length segment, e.g. `lengths: 200 all` or
 * `lengths: 200 except signature:70 taste:400`.
 *
 * The same transport problem the conventions flags exist for, one step further: the
 * skill is static Markdown and cannot read `channels.<name>.max_chars` (issue #76), so
 * the turn-start hook carries the configured ceilings on the line it already injects,
 * beside {@link conventionFlags}, rather than inventing a second mechanism. The skill
 * then teaches its recommended length as a constant and takes its **ceiling** from
 * here — which is the whole point: the recommendation is editorial and stable, the
 * ceiling is the user's and must never be hardcoded into a file they cannot configure.
 *
 * Rendered against a base rather than as twelve pairs, because the mailbox line's
 * lesson applies: every turn pays for this, so the common case must be nearly free. The
 * base is whichever limit the most channels share — so an install that moved every
 * channel to the same number renders as compactly as an unconfigured one — and only
 * genuine deviations are named. Ties go to the earliest channel in `CHANNELS`, so the
 * rendering is deterministic.
 *
 * Reports every channel, including ones `channels.enabled` has switched off: a disabled
 * channel cannot be named through the tool at all, so its limit costs nothing to state
 * and saves this function from duplicating the enabled-set logic.
 *
 * @param store the open store to resolve limits against
 * @returns the segment text, without trailing punctuation
 *
 * @example
 *   channelLengths(store)   // => 'lengths: 200 all' on a fresh install
 *   writeConfig(store, 'channels.signature.max_chars', '70');
 *   channelLengths(store)   // => 'lengths: 200 except signature:70'
 *
 * @see conventionFlags
 * @see ../channels/config.js channelMaxChars
 * @see onUserPromptSubmit
 */
export function channelLengths(store: Store): string {

  const limits = CHANNELS.map(channel => ({ channel, limit: channelMaxChars(store, channel) })),
        tally  = new Map<number, number>();

  for (const { limit } of limits) { tally.set(limit, (tally.get(limit) ?? 0) + 1); }

  let base  = DEFAULT_CHANNEL_MAX_CHARS,
      most  = 0;

  for (const [limit, count] of tally) {
    if (count > most) { base = limit; most = count; }
  }

  const exceptions = limits.filter(entry => entry.limit !== base);

  return exceptions.length === 0
    ? `lengths: ${String(base)} all`
    : `lengths: ${String(base)} except ` +
      exceptions.map(entry => `${entry.channel}:${String(entry.limit)}`).join(' ');

}

/**
 * The context line's format-grammar reminder: the three renderings the conventions ask
 * for and a model most often drops — the visible signature line, number-square lists,
 * and diff-block channel lines.
 *
 * A reminder, not a specification: the skill carries the grammar, and this segment only
 * names it at the moment of writing, beside `conventions:` and `lengths:`. It is a
 * constant because it is injected on every turn and must stay short; nothing about it
 * varies with configuration.
 *
 * @example
 *   FORMAT_SEGMENT   // => 'format: sig-line, number-square lists, diff channels'
 *
 * @see onUserPromptSubmit
 */
export const FORMAT_SEGMENT = 'format: sig-line, number-square lists, diff channels';

/**
 * How each window surface is named in the posture line.
 *
 * Short noun phrases rather than the config key names, because the line is read by a
 * model deciding what to do next, not by someone editing configuration — and because
 * the two nouns are the whole argument for two keys: "an external browser window" and
 * "an editor tab" are visibly different impositions on whoever is at the machine.
 *
 * @see windowPostureLine
 * @see ../channels/config.js WINDOW_SURFACES
 */
export const WINDOW_SURFACE_NOUNS: Readonly<Record<WindowSurface, string>> = {
  browser : 'an external browser window',
  editor  : 'an editor tab',
};

/**
 * One surface's posture, rendered as an English clause.
 *
 * Each posture gets its own sentence shape rather than a shared `label:value` pair,
 * because the line has to survive being skimmed: `browser:never` is a fact the reader
 * must then interpret, while "never open an external browser window" is already the
 * instruction. All three shapes are grammatical with either noun, so the six
 * combinations need no special cases.
 *
 * @param posture the posture in force for the surface
 * @param noun    the surface's noun phrase, e.g. `'an editor tab'`
 * @returns the clause, with no leading or trailing punctuation
 *
 * @example
 *   windowClause('ask',    'an editor tab')                // => 'ask before opening an editor tab'
 *   windowClause('never',  'an external browser window')   // => 'never open an external browser window'
 *   windowClause('always', 'an editor tab')                // => 'opening an editor tab is pre-approved'
 *
 * @see windowPostureLine
 */
export function windowClause(posture: WindowPosture, noun: string): string {

  if (posture === 'never')  { return `never open ${noun}`; }
  if (posture === 'always') { return `opening ${noun} is pre-approved`; }

  return `ask before opening ${noun}`;

}

/**
 * The context line's window-posture segment, e.g.
 * `windows: ask before opening an external browser window; ask before opening an editor tab`.
 *
 * The same transport {@link conventionFlags} and {@link channelLengths} ride, for the
 * same reason: this is a preference the model must know *before* it acts, and the
 * turn-start context line is the one place it reliably sees anything. Both surfaces are
 * always named, including at the default, because `ask` is itself an instruction — a
 * silent line would read as "no opinion", which is the opposite of what `ask` means.
 *
 * **Advisory, and deliberately not enforcement.** No tool in this plugin gates window
 * opening, and none is planned: a shell command can open a browser with no MCP call at
 * all, so a gate would be a lock on one of several doors, and a lock that can be walked
 * around is worse than an honest request — it invites the belief that the door is shut.
 * What the plugin can do is make sure the user's stated wish is in front of the model at
 * the moment the choice is made, and that is exactly what this line is.
 *
 * Reads through {@link ../channels/config.js windowPosture}, so a hand-edited or
 * newer-vocabulary row renders as `ask` (D5) rather than as a permission nobody granted.
 *
 * @param store the open store to resolve postures against
 * @returns the segment text, without trailing punctuation
 *
 * @example
 *   windowPostureLine(store)
 *   // => 'windows: ask before opening an external browser window; ask before opening an editor tab'
 *   writeConfig(store, 'window.browser', 'never');
 *   windowPostureLine(store)
 *   // => 'windows: never open an external browser window; ask before opening an editor tab'
 *
 * @see windowClause
 * @see onUserPromptSubmit
 */
export function windowPostureLine(store: Store): string {

  const clauses = WINDOW_SURFACES.map(surface =>
    windowClause(windowPosture(store, surface), WINDOW_SURFACE_NOUNS[surface]));

  return `windows: ${clauses.join('; ')}`;

}

/**
 * The context line's mailbox segment, e.g.
 * `Mailbox: 2 unread for you, 1 for your human partner (self-expression read_messages).`
 * — or `null` when there is nothing to report.
 *
 * Counts only, never text: full injection every turn would spend context on notes the
 * model usually still remembers. Gated on both `messages.enabled` (the facility's
 * kill switch) and `messages.notify` (this line specifically — someone may want the
 * facility without per-turn context spent on it), read through the tolerant
 * effective-value accessor. Silent — `null` — when both counts are zero, so the
 * common no-mail turn costs nothing.
 *
 * @param session the reader session fencing the self count; absent counts user mail only
 *
 * @example
 *   mailboxLine(store, 'sess-1')
 *   // => 'Mailbox: 2 unread for you, 1 for your human partner (self-expression read_messages).'
 *
 * @see onUserPromptSubmit
 * @see ../channels/messages.js unreadCounts
 */
export function mailboxLine(store: Store, session: string | undefined, now: Date = new Date()): string | null {

  if (effectiveValue(store, 'messages.enabled') === 'false') { return null; }
  if (effectiveValue(store, 'messages.notify')  === 'false') { return null; }

  const counts = unreadCounts(store, session, now),
        parts: string[] = [];

  if (counts.forModel > 0) { parts.push(`${String(counts.forModel)} unread for you`); }
  if (counts.forUser  > 0) { parts.push(`${String(counts.forUser)} for your human partner`); }

  if (parts.length === 0) { return null; }

  return `Mailbox: ${parts.join(', ')} (self-expression read_messages).`;

}

/**
 * The context line's held-note segment (issue #43) — or `null` when nothing is offered.
 *
 * **This is the entire delivery vehicle for self-initiated speech, and it exists only
 * here.** A note may be composed on any turn; it can only ever be *offered* from inside
 * this handler, on a turn the harness itself stamped `reply`, because that is the one
 * moment in the platform with a presence guarantee — a human definitionally just acted.
 * {@link ../channels/notes.js offerRipeNotes} refuses any other turn type outright, so
 * there is no code path from a wakeup to a delivery claim.
 *
 * Unlike the messagebox count line, this carries the note **text**, not a count. The
 * count-only shape would cost a round trip on every ripe turn and, worse, leave the
 * model liable to render a note it had not actually fetched; carrying the words means
 * the reply can be composed in one shot, with the provenance already rendered. The
 * injection is still not delivery — context handed to the model is not text shown to a
 * human — which is exactly why `surface_note` remains a separate, checked step.
 *
 * Ripe notes are offered as a side effect of reading this line, which is deliberate: an
 * offer is a mechanical fact about a turn, so the hook that observed the turn is the
 * only honest place to record it.
 *
 * @param turnId the hook-observed `prompt_id`; an absent one offers nothing, because a
 *               turn with no identity cannot authorize a later surfacing
 *
 * @example
 *   heldNotesLine(store, 'p-1', 'sess-1', new Date())
 *   // => '📬 Held note #12 — written Saturday evening, held until Tuesday morning; …'
 *
 * @see onUserPromptSubmit
 * @see ../channels/notes.js offerRipeNotes
 */
export function heldNotesLine(
  store   : Store,
  turnId  : string | undefined,
  session : string | undefined,
  now     : Date = new Date(),
): string | null {

  if (turnId === undefined || turnId === '') { return null; }

  const offered = offerRipeNotes(store, { turn: 'reply', promptId: turnId, session }, now);

  if (offered.length === 0) { return null; }

  return `${offered.map(renderHeldNote).join('\n')}\n` +
    'Render the note(s) above near the top of your reply, provenance line included and ' +
    'verbatim, then call surface_note for each id you actually rendered. If this is the ' +
    'wrong moment, render nothing and say nothing about it — the note returns to the ' +
    'queue and gets another chance later, and a few chances is all it ever gets.';

}

/** Config key gating the session-resume retraction replay (#16). */
export const REPLAY_KEY = 'retraction.replay';

/**
 * How far back the resume replay looks, in days.
 *
 * A code constant, not a config key: defaults live in code, and a key nobody has asked
 * to tune is seeding by another name. A fortnight is long enough to cover a weekend plus
 * a working week — the realistic gap between writing something wrong and resuming the
 * work — and short enough that a retraction from last quarter does not keep announcing
 * itself.
 */
export const REPLAY_WINDOW_DAYS = 14;

/** How many retracted claims the resume replay will name. Code constant, same reasoning. */
export const REPLAY_MAX_ITEMS = 5;

/** Longest a quoted claim may run inside the replay line before it is elided. */
export const REPLAY_QUOTE_MAX = 90;

/**
 * One register row rendered for the replay line: `⊘ "<the wrong words>" → <what replaced
 * them> (2026-08-25)`.
 *
 * `⊘` is the mark for a replayed original — chosen over `✗` (already the quote bracket in
 * the retraction line's own grammar), over `🚫` (which reads as prohibition rather than
 * withdrawal), and over `❌` (already the failure marker in the checklist vocabulary).
 * The glyph is presentation and is never stored; it is derived from the record every time
 * it is drawn.
 *
 * The quoted claim is the `verbatim` column when the strike carried one and the
 * original's own text otherwise, because one of the two always exists: a prose-only
 * retraction must quote, and a row-backed one already preserves the words it struck.
 *
 * @param row  one standing strike from the register
 * @returns a single line, with the claim elided at {@link REPLAY_QUOTE_MAX} characters
 *
 * @example
 *   renderReplayItem({ kind: 'retracts', at: '2026-08-25T18:02:00.000Z', original: null,
 *                      verbatim: 'the build skips lint on spec-only PRs',
 *                      replacement: { id: 9, channel: 'divergence', text: 'it runs markdownlint' } })
 *   // => '⊘ "the build skips lint on spec-only PRs" → it runs markdownlint (2026-08-25)'
 *
 * @see retractionReplayLine
 * @see ../channels/entries.js register
 */
export function renderReplayItem(row: RegisterRow): string {

  const claimed = row.verbatim ?? row.original?.text ?? '(claim not recorded)',
        claim   = claimed.length > REPLAY_QUOTE_MAX
                    ? `${claimed.slice(0, REPLAY_QUOTE_MAX - 1)}…`
                    : claimed,
        day     = row.at.slice(0, 10);

  return `⊘ "${claim}" → ${row.replacement.text} (${day})`;

}

/**
 * The context line's retraction-replay segment (issue #16) — or `null` when there is
 * nothing to replay.
 *
 * The issue's third option: a resumed session must not carry silent falsehoods forward.
 * `recall` is pull, and the whole problem is that nobody knows to pull; this is the push
 * half, and it fires **once per session** because the context line is prime attention
 * real estate and a register repeated every turn becomes wallpaper.
 *
 * Scope is deliberately narrow: standing `retracts` strikes from the last
 * {@link REPLAY_WINDOW_DAYS} days, newest first, capped at {@link REPLAY_MAX_ITEMS}. The
 * whole segment is omitted when the register is empty, so the happy path costs no ritual
 * text at all. Amendments are left out on purpose — an amended claim stood, so listing it
 * under "do not rely on these" would overclaim exactly the way the `amends` kind exists
 * to prevent.
 *
 * Gated on `retraction.replay` (default on) through the tolerant effective-value
 * accessor, so a stored override that fails validation behaves as unset.
 *
 * @param now the moment the turn began, which anchors the window
 * @returns the segment text, or `null` when disabled or empty
 *
 * @example
 *   retractionReplayLine(store, new Date('2026-08-28T09:14:00Z'))
 *   // => 'Recently retracted (do not rely on these): ⊘ "icons sort by status first" → rank then bucket (2026-08-25)'
 *
 * @see onUserPromptSubmit
 * @see ../channels/entries.js register
 */
export function retractionReplayLine(store: Store, now: Date = new Date()): string | null {

  if (effectiveValue(store, REPLAY_KEY) === 'false') { return null; }

  const since = new Date(now.getTime() - REPLAY_WINDOW_DAYS * 86_400_000).toISOString(),
        rows  = register(store, { kind: 'retracts', sinceUtc: since, limit: REPLAY_MAX_ITEMS });

  if (rows.length === 0) { return null; }

  return `Recently retracted (do not rely on these): ${rows.map(renderReplayItem).join(' · ')}`;

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
 * so a config error skips the context write entirely and still delivers the clock. The
 * length is measured on `payload.prompt`, which is the field the harness actually sends;
 * only the count is kept, never the words.
 *
 * The context line also carries the conventions-flags segment ({@link conventionFlags})
 * between the clock and the open reminder — the transport by which config keys reach
 * pure-prose skill conventions. It fails open separately: a flags error still delivers
 * the clock and the reminder, just without flags.
 *
 * The channel-length segment ({@link channelLengths}, issue #76) follows the flags on
 * that same transport, carrying the configured per-channel text ceilings to a skill
 * that cannot read config. It fails open on its own terms too.
 *
 * Beside the lengths rides the static format reminder ({@link FORMAT_SEGMENT}) — the
 * signature line, number-square lists, diff channels — named at the moment of writing
 * because the Stop hook now checks the first two. It needs no store, so it is present
 * even when the database is unreachable.
 *
 * After the lengths comes the window-posture segment ({@link windowPostureLine}), which
 * states what the user has said about opening an external browser window and about
 * opening an editor tab — two keys, because the two impositions are not the same size.
 * It is advisory by construction: no tool gates window opening, so the line is the whole
 * mechanism, and it fails open on its own terms like every other segment.
 *
 * After that comes the messagebox count line ({@link mailboxLine}, issue #41),
 * present only when something is actually unread and both `messages.*` keys allow it.
 * It fails open separately too: a mailbox error costs the count line and nothing else.
 *
 * On a session's **first** turn only, the retraction replay ({@link retractionReplayLine},
 * issue #16) follows the reminder: the recently taken-back claims, so a resumed session
 * does not carry known falsehoods forward. Turn index 1 — a session this store has never
 * seen — is the portable definition of the resume/fresh boundary, observed rather than
 * claimed, and it fires on every host that runs the plugin at all rather than only the
 * ones with a `SessionStart` event. It fails open on its own terms too.
 *
 * Last comes the held-note segment ({@link heldNotesLine}, issue #43) — the **only**
 * delivery vehicle self-initiated speech has. Notes may be composed on any turn, but
 * they can be offered only from here, on a turn this hook stamped `reply`, which is what
 * makes "compose on any turn; deliver only on a human's turn" a property of the code
 * rather than a promise. It fails open on its own terms as well.
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

  // Captured from the context write, because it is also the resume/fresh boundary the
  // retraction replay keys off: turn 1 is "a turn this store has never seen for this
  // session", which is exactly what a fresh start or a resume under a new session id
  // looks like, observed rather than claimed.
  let turnIndex: number | null = null;

  if (store !== null && typeof payload.session_id === 'string' && payload.session_id !== '') {
    try {
      const privacy = privacyFlags(store),
            index   = turnCount(store, payload.session_id) + 1;
      recordContext(store, {
        session        : payload.session_id,
        promptId       : payload.prompt_id,
        turnIndex      : index,
        turn           : 'reply',
        cwd            : privacy.storeCwd ? payload.cwd : undefined,
        permissionMode : payload.permission_mode,
        agentId        : payload.agent_id,
        agentType      : payload.agent_type,
        effort         : payload.effort?.level,
        // `prompt`, not `user_input`: the latter is a field Claude Code has never sent, so
        // the length silently recorded NULL on every turn and `privacy.store_prompt_len`
        // governed nothing at all.
        promptLen      : privacy.storePromptLen ? payload.prompt?.length : undefined,
        // The harness observed this turn; nothing here is the model's word for itself.
        // `begin_turn` writes the same shape with 'tool', and the column is what keeps
        // the two distinguishable to anyone reading the database later.
        source         : 'hook',
      }, now);
      turnIndex = index;
    } catch { /* fail open: the clock still gets delivered */ }
  }

  let flags = '';
  if (store !== null) {
    try { flags = ` ${conventionFlags(store)}.`; }
    catch { /* fail open: the clock and reminder still get delivered */ }
  }

  let lengths = '';
  if (store !== null) {
    try { lengths = ` ${channelLengths(store)}.`; }
    catch { /* fail open: the clock, flags, and reminder still get delivered */ }
  }

  // Static, so it needs no store and cannot fail; it sits beside the lengths because
  // both are about how the lines a model writes are meant to look.
  const format = ` ${FORMAT_SEGMENT}.`;

  let windows = '';
  if (store !== null) {
    try { windows = ` ${windowPostureLine(store)}.`; }
    catch { /* fail open: the clock, flags, lengths, and reminder still get delivered */ }
  }

  let mail = '';
  if (store !== null) {
    try {
      const line = mailboxLine(store, payload.session_id, now);
      if (line !== null) { mail = ` ${line}`; }
    } catch { /* fail open: the clock, flags, lengths, windows, and reminder still get delivered */ }
  }

  // The retraction replay (#16), on the first turn this store has seen of this session
  // and no other. Fails open on its own terms: an error here costs the replay segment and
  // nothing else, which is the right trade — a hook that could wedge a turn over a
  // register lookup would be worse than a register nobody sees.
  let replay = '';
  if (store !== null && turnIndex === 1) {
    try {
      const line = retractionReplayLine(store, now);
      if (line !== null) { replay = `\n${line}`; }
    } catch { /* fail open: every other segment still gets delivered */ }
  }

  // Held notes (#43) ride the same fail-open boundary, and are last because they are the
  // only segment that can be several lines long. An error here costs the note line and
  // nothing else: the mailbox must never be able to wedge a turn, which is why the whole
  // facility degrades to today's behaviour — a clock line and nothing more.
  let held = '';
  if (store !== null) {
    try {
      const line = heldNotesLine(store, payload.prompt_id, payload.session_id, now);
      if (line !== null) { held = `\n${line}`; }
    } catch { /* fail open: every other segment still gets delivered */ }
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

  const head     = clock ? `${describeMoment(now)}${flags}${lengths}${format}${windows}${mail}`
                         : `${flags}${lengths}${format}${windows}${mail}`.trimStart(),
        reminder = clock ? OPEN_REMINDER : OPEN_REMINDER_CLOCKLESS;

  return {
    hookSpecificOutput: {
      hookEventName    : 'UserPromptSubmit',
      additionalContext: head === ''
        ? `${reminder}${replay}${held}`
        : `${head} ${reminder}${replay}${held}`,
    },
  };

}

/**
 * `Stop`: refuse to end a turn that never signed off.
 *
 * The question is answered exactly, by turn identity — the pair (`session`,
 * `prompt_id`) — replacing a three-minute freshness window that passed a slow turn on
 * the *previous* turn's signature and blocked a long turn that had done the right thing.
 * Only a `close` satisfies it: a `mid` signature marks a mid-turn lurch and does not end
 * the turn. See {@link ../channels/entries.js hasClosingSignature}.
 *
 * Returns `null` — meaning allow — whenever the answer is not confidently no: gate
 * disabled, no store, no turn context, no known turn. Enforcing on a guess is worse
 * than not enforcing.
 *
 * **One block per turn is the ceiling, and `stop_hook_active` is how that ceiling is
 * enforced.** Claude Code sets the flag on a `Stop` event when the assistant is only
 * still running because a Stop hook blocked it a moment ago. Blocking again at that
 * point asks for a signature the last block already asked for, and if the `express` tool
 * cannot answer — MCP server down, version skew, a host that never loaded it — the same
 * refusal repeats forever and the session cannot be ended from inside. So a second block
 * is never issued: the gate has had its one say, and a gate that can wedge a session is
 * worse than a signature that goes unwritten. This is the fail-open principle in the file
 * header applied to the one failure the handler can see coming.
 *
 * **The format checks.** Recording a close is not the same as showing one, and a list
 * the conventions want as number squares is not caught by any record. So four checks run,
 * each failing open on its own ({@link guarded}), and their verdicts merge into a single
 * output — one block per turn means one reason carrying every refusal:
 *
 * - {@link closeRecordCheck} — the original gate; blocks (`gate.signature`).
 * - {@link closeLineCheck} — the last line must render the recorded close; blocks
 *   (`gate.signature_line`).
 * - {@link listCheck} — the Markdown list lint; report-only by default (`gate.lists`).
 * - {@link openLineCheck} — the open line and record; warns, never blocks
 *   (`gate.open_line`).
 *
 * Every finding is written to `format_findings`, whatever was done about it.
 *
 * @param deps the list lint's parser, the transcript reader, and a clock; see {@link StopDeps}
 *
 * @example
 *   onStop(store, {})                            // => null when the turn already signed off
 *   onStop(store, {})                            // => { decision: 'block', reason: '…' } when it did not
 *   onStop(store, { stop_hook_active: true })    // => null; the gate already spoke this turn
 *   onStop(store, { last_assistant_message: 'done, no line' })
 *   // => { decision: 'block', reason: '… End the message with exactly this line …' } after a recorded close
 */
export function onStop(store: Store | null, payload: HookPayload, deps: StopDeps = {}): HookOutput {

  if (store === null)           { return null; }
  if (payload.stop_hook_active) { return null; }   // already blocked once; never twice

  try {

    const turn = stopTurn(store, payload);
    if (turn === null) { return null; }

    const now     = deps.now ?? new Date(),
          message = payload.last_assistant_message,
          checks  = [
            guarded(() => closeRecordCheck(store, turn)),
            guarded(() => closeLineCheck(store, turn, message)),
            guarded(() => listCheck(store, message, deps.parse)),
            guarded(() => openLineCheck(store, turn, payload.transcript_path,
                                        deps.readTranscript ?? readTail)),
          ],
          outcome = mergeOutcomes(checks);

    for (const finding of outcome.findings) {
      try {
        recordFinding(store, { ...finding, session: turn.session, promptId: turn.promptId }, now);
      } catch { /* fail open: an unloggable finding still gets its verdict */ }
    }

    return stopOutput(outcome);

  } catch {

    return null;   // fail open on every error path

  }

}

/** What the Stop hook's format checks can be handed that the payload does not carry. */
export interface StopDeps {
  /**
   * The Markdown parser for the list lint. Absent skips the lint — the command-line entry
   * loads the parser lazily, so a missing dependency degrades to no lint instead of to a
   * binary that cannot start.
   */
  readonly parse?          : MarkdownParser | undefined;
  /** Reads a transcript's tail; defaults to {@link readTail}. `null` means unreadable. */
  readonly readTranscript? : ((path: string) => string | null) | undefined;
  /** Injectable clock for the findings log. */
  readonly now?            : Date | undefined;
}

/** The turn a stop belongs to: the pair (`session`, `promptId`). */
export interface StopTurn {
  readonly session  : string | undefined;
  readonly promptId : string;
}

/**
 * Recover the stopping turn's identity, or `null` when no turn is known.
 *
 * The payload's fields when the host supplies them, else the observed turn-context row's.
 * A `p1` invented by a hookless host in one session must not close a `p1` in another,
 * which is why both halves are recovered rather than the prompt id alone.
 *
 * @example
 *   stopTurn(store, { session_id: 's1', prompt_id: 'p1' })   // => { session: 's1', promptId: 'p1' }
 *   stopTurn(store, {})                                      // => null on an empty store
 */
export function stopTurn(store: Store, payload: HookPayload): StopTurn | null {

  const context  = latestContext(store, payload.session_id),
        promptId = payload.prompt_id
          ?? (typeof context?.['prompt_id'] === 'string' ? context['prompt_id'] : undefined),
        session  = payload.session_id
          ?? (typeof context?.['session']   === 'string' ? context['session']   : undefined);

  if (promptId === undefined || promptId === '') { return null; }

  return { session, promptId };

}

/** A finding as a check produces it, before the turn identity is stamped on. */
export type CheckFinding = Omit<FindingInput, 'session' | 'promptId'>;

/**
 * What one Stop-hook check concluded: refusal paragraphs (any one blocks the stop),
 * warning sentences for the user, and findings for the log.
 */
export interface CheckOutcome {
  readonly blocks   : readonly string[];
  readonly warnings : readonly string[];
  readonly findings : readonly CheckFinding[];
}

/** The outcome of a check that found nothing, or was skipped. */
export const NO_OUTCOME: CheckOutcome = Object.freeze({ blocks: [], warnings: [], findings: [] });

/**
 * Run one check, failing open on its own: a check that throws contributes nothing, and
 * the others still run. A parser bug in the list lint must never cost the close gate.
 *
 * @example
 *   guarded(() => { throw new Error('x'); })   // => NO_OUTCOME
 */
export function guarded(check: () => CheckOutcome): CheckOutcome {
  try { return check(); } catch { return NO_OUTCOME; }
}

/**
 * Combine several checks' outcomes into one, preserving order.
 *
 * @example
 *   mergeOutcomes([{ blocks: ['a'], warnings: [], findings: [] }, NO_OUTCOME]).blocks   // => ['a']
 */
export function mergeOutcomes(outcomes: readonly CheckOutcome[]): CheckOutcome {
  return {
    blocks   : outcomes.flatMap(outcome => outcome.blocks),
    warnings : outcomes.flatMap(outcome => outcome.warnings),
    findings : outcomes.flatMap(outcome => outcome.findings),
  };
}

/**
 * Turn a merged outcome into the hook's stdout: a block when anything refuses, carrying
 * every refusal in one reason — there is only ever one block per turn, so it must say
 * everything at once — and the warnings as a `systemMessage` for the user.
 *
 * @example
 *   stopOutput(NO_OUTCOME)   // => null
 *   stopOutput({ blocks: [], warnings: ['w'], findings: [] })   // => { systemMessage: 'self-expression: w' }
 */
export function stopOutput(outcome: CheckOutcome): HookOutput {

  const message = outcome.warnings.length === 0
    ? undefined
    : `self-expression: ${outcome.warnings.join(' ')}`;

  if (outcome.blocks.length > 0) {
    return {
      decision : 'block',
      reason   : outcome.blocks.join('\n\n'),
      ...(message === undefined ? {} : { systemMessage: message }),
    };
  }

  return message === undefined ? null : { systemMessage: message };

}

/** The refusal for a turn that never recorded a close. Unchanged in substance since v0.1. */
export const CLOSE_RECORD_REASON: string =
  'Close this turn by recording a signature before stopping. Call the ' +
  'self-expression `express` tool with channel "signature" and position "close", then ' +
  'end your message with the signature line it returns. ' +
  'If nothing changed, "still; unchanged" is a complete and valid entry — the ' +
  'requirement is to look, not to produce. Do not restate the message you just ' +
  'wrote; it is already on screen, and repeating it is the most visible thing ' +
  'this gate does.';

/**
 * The original gate: a finished turn must have recorded a close signature.
 *
 * Only a `close` satisfies it: a `mid` marks a lurch and does not end the turn. Governed
 * by `gate.signature`; only the exact value `'false'` turns it off.
 *
 * @example
 *   closeRecordCheck(store, { session: 's1', promptId: 'p1' }).blocks   // => [CLOSE_RECORD_REASON] when unsigned
 *
 * @see ../channels/entries.js hasClosingSignature
 */
export function closeRecordCheck(store: Store, turn: StopTurn): CheckOutcome {

  if (readConfig(store, 'gate.signature') === 'false')          { return NO_OUTCOME; }
  if (hasClosingSignature(store, turn.session, turn.promptId)) { return NO_OUTCOME; }

  return { blocks: [CLOSE_RECORD_REASON], warnings: [], findings: [] };

}

/**
 * The visible close check: when a close was recorded, the message's last non-empty line
 * must be a signature line carrying the recorded text.
 *
 * This is what the record-only gate could not see. A close recorded through `express`
 * but never rendered left the reader with no signature at all, and the gate passed it.
 * Now the last line is parsed against the signature grammar, and its text must equal the
 * newest recorded close's text; otherwise the stop is blocked with the exact line to
 * paste, rendered from the record by the same function `express` uses.
 *
 * Skipped — fail open — when `gate.signature_line` is exactly `'false'`, when no close
 * was recorded (the record check already speaks to that), or when the host sent no final
 * message to look at.
 *
 * @param message the payload's `last_assistant_message`
 *
 * @example
 *   closeLineCheck(store, turn, 'Done.\n\n`[9:14 am PDT]` 🙂 `»` flow; clear plan')
 *   // => NO_OUTCOME when that is the recorded close's text
 *
 * @see ../channels/signature_line.js parseSignatureLine
 */
export function closeLineCheck(store: Store, turn: StopTurn, message: string | undefined): CheckOutcome {

  if (readConfig(store, 'gate.signature_line') === 'false') { return NO_OUTCOME; }
  if (message === undefined || message.trim() === '')       { return NO_OUTCOME; }

  const recorded = turnSignature(store, turn.session, turn.promptId, 'close');
  if (recorded === null) { return NO_OUTCOME; }

  const last   = lastNonEmptyLine(message),
        parsed = last === null ? null : parseSignatureLine(last);

  if (parsed !== null && sameSignatureText(parsed.text, recorded.text)) { return NO_OUTCOME; }

  const kind = parsed === null ? 'close-line-missing' : 'close-line-mismatch';

  return {
    blocks: [
      (parsed === null
        ? 'The close signature was recorded, but the message does not end with its ' +
          'visible line. '
        : 'The message ends with a signature line whose text differs from the close ' +
          'that was recorded. ') +
      'End the message with exactly this line, as the last line, and nothing after it:\n\n' +
      `${recorded.line}\n\n` +
      'Do not restate the rest of the message.',
    ],
    warnings : [],
    findings : [{ check: 'close-line', kind, severity: 'violation', action: 'blocked',
                  excerpt: clip(last ?? '') }],
  };

}

/**
 * The list lint, in whatever mode `gate.lists` selects.
 *
 * Every finding is logged. In `block` mode, ordered-list violations also refuse the stop;
 * bullet-list warnings never do, in any mode. In `report` mode — the default — nothing
 * ever blocks: the log is the whole output, so the false-positive rate can be measured
 * before blocking is ever switched on. Skipped when the mode is `off`, when no parser was
 * supplied, or when there is no message.
 *
 * @param parse the Markdown parser; absent skips the lint
 *
 * @example
 *   listCheck(store, '1. a\n2. b\n', fromMarkdown).findings[0]?.action   // => 'reported'
 *
 * @see ../channels/format_lint.js lintLists
 */
export function listCheck(
  store   : Store,
  message : string | undefined,
  parse   : MarkdownParser | undefined,
): CheckOutcome {

  const mode = listGateMode(store);

  if (mode === 'off' || parse === undefined)          { return NO_OUTCOME; }
  if (message === undefined || message.trim() === '') { return NO_OUTCOME; }

  const found      = lintLists(message, parse),
        blocking   = mode === 'block' ? found.filter(f => f.severity === 'violation') : [],
        findings   = found.map((f: ListFinding): CheckFinding => ({
          check    : 'lists',
          kind     : f.kind,
          severity : f.severity,
          action   : blocking.includes(f) ? 'blocked' : 'reported',
          items    : f.items,
          line     : f.line,
          excerpt  : f.excerpt,
        }));

  return {
    blocks   : blocking.length > 0 ? [listBlockReason(blocking)] : [],
    warnings : [],
    findings,
  };

}

/**
 * The open check: the turn's first assistant text should begin with a rendered open
 * signature, and a matching open should have been recorded. **It only ever warns.**
 *
 * Blocking here would be worse than useless: the only thing a block could produce is an
 * open written after the fact, and a backdated before-measurement looks like data and is
 * not. So a finding is logged and the user gets a one-line `systemMessage`; the turn ends
 * normally.
 *
 * The first text is read from the host transcript's tail, because the Stop payload only
 * carries the last message. Skipped — fail open — when `gate.open_line` is exactly
 * `'false'`, when there is no transcript, or when the turn's start is not in the tail
 * that was read.
 *
 * @param path the payload's `transcript_path`
 * @param read reads a transcript tail; `null` means unreadable
 *
 * @example
 *   openLineCheck(store, turn, '/t.jsonl', () => transcriptWithNoOpen).warnings
 *   // => ['this turn began without a rendered open signature line.']
 *
 * @see ../channels/transcript.js firstAssistantTextOfTurn
 */
export function openLineCheck(
  store : Store,
  turn  : StopTurn,
  path  : string | undefined,
  read  : (path: string) => string | null,
): CheckOutcome {

  if (readConfig(store, 'gate.open_line') === 'false') { return NO_OUTCOME; }
  if (path === undefined || path === '')               { return NO_OUTCOME; }

  const tail  = read(path),
        first = tail === null ? null : firstAssistantTextOfTurn(tail);

  if (first === null) { return NO_OUTCOME; }

  const line     = firstNonEmptyLine(first),
        parsed   = line === null ? null : parseSignatureLine(line),
        recorded = turnSignature(store, turn.session, turn.promptId, 'open');

  const [kind, sentence] =
      parsed === null && recorded === null
        ? ['open-missing',        'this turn began without an open signature, rendered or recorded.']
    : parsed === null
        ? ['open-line-missing',   'this turn recorded an open signature but never rendered its line.']
    : recorded === null
        ? ['open-record-missing', 'this turn rendered an open signature line but never recorded it with express.']
    : !sameSignatureText(parsed.text, recorded.text)
        ? ['open-mismatch',       'the rendered open signature differs from the one recorded.']
        : [null, null];

  if (kind === null) { return NO_OUTCOME; }

  return {
    blocks   : [],
    warnings : [sentence],
    findings : [{ check: 'open-line', kind, severity: 'warning', action: 'warned',
                  excerpt: clip(line ?? '') }],
  };

}

/** Cap a logged excerpt at {@link EXCERPT_MAX} characters. */
function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX - 1)}…` : trimmed;
}

/**
 * The unread notes to self a resumed or compacted session is handed, rendered — or
 * `null` when there are none to hand over (issue #41).
 *
 * Fires only on `source: 'compact'` or `'resume'` — the one moment the notes are
 * guaranteed relevant and guaranteed forgotten. On `startup` it stays silent: a fresh
 * session has no past self. Renders the **full text** of the session's unread `self`
 * messages and receipts them (`reader: 'model'`) as delivered, so nothing is handed over
 * twice. Governed by `messages.enabled` alone — not `messages.notify`, which gates only
 * the per-turn count line — because compaction recovery is the point of the facility.
 *
 * Fails open: no store, no session, a read error, or a receipt error yields `null`.
 *
 * @param store   the open store, or `null` when it could not be opened
 * @param payload the `SessionStart` payload; `source` and `session_id` are what matter
 * @param now     the moment of the session start, for expiry and receipts
 * @returns the rendered block, or `null`
 *
 * @example
 *   unreadNotesBlock(store, { session_id: 's1', source: 'compact' }, new Date())
 *   // => 'Unread notes from your earlier self in this session (now delivered):\n- [2:05 pm] resume at step 3'
 *
 * @see onSessionStart
 * @see ../channels/messages.js readMessages
 */
export function unreadNotesBlock(store: Store | null, payload: HookPayload, now: Date): string | null {

  if (store === null)                                             { return null; }
  if (payload.source !== 'compact' && payload.source !== 'resume') { return null; }

  const session = payload.session_id;
  if (typeof session !== 'string' || session === '') { return null; }

  try {

    if (effectiveValue(store, 'messages.enabled') === 'false') { return null; }

    const notes = readMessages(store,
      { reader: 'model', session, promptId: payload.prompt_id },
      { audience: 'self', limit: 100 }, now);

    if (notes.length === 0) { return null; }

    const rendered = notes
      .map(note => `- [${String(note['ts_local'])}] ${String(note['text'])}`)
      .join('\n');

    return `Unread notes from your earlier self in this session (now delivered):\n${rendered}`;

  } catch {

    return null;   // fail open on every error path

  }

}

/**
 * Whether a session start from `source` gets the conventions injected under `mode`.
 *
 * `always` answers yes to **every** source, including a missing one and ones a newer
 * host adds (Claude Code already sends `fork`): the key's promise is "whenever a session
 * starts", and a source this version has never heard of is still a session starting.
 * `startup-only` answers yes to exactly `'startup'`. `off` answers no.
 *
 * @param mode   the injection mode in force
 * @param source the payload's `source`, when the host sent one
 * @returns `true` when the conventions should be injected
 *
 * @example
 *   shouldInjectConventions('always', 'compact')        // => true
 *   shouldInjectConventions('startup-only', 'compact')  // => false
 *   shouldInjectConventions('startup-only', 'startup')  // => true
 *   shouldInjectConventions('off', 'startup')           // => false
 *
 * @see ../channels/config.js INJECT_MODES
 */
export function shouldInjectConventions(mode: InjectMode, source: string | undefined): boolean {
  if (mode === 'always')       { return true; }
  if (mode === 'startup-only') { return source === 'startup'; }
  return false;
}

/**
 * Where {@link onSessionStart} finds the conventions, and where it reports trouble.
 *
 * Both are injectable so the handler stays testable without a real install: the CLI
 * passes the installed package root, resolved from its own bundle directory; tests pass a
 * temporary one, or a directory with nothing in it.
 */
export interface SessionStartOptions {
  /**
   * The installed plugin's package root, or `null`/absent for none. Absent means the
   * caller did not opt in to injection at all, and nothing is read or logged; a root
   * whose file cannot be read is a packaging fault, and is logged.
   */
  readonly root? : string | null;
  /** Receives one line per failure. Defaults to stderr, the hook's diagnostics channel. */
  readonly log?  : (line: string) => void;
}

/**
 * The default failure log: one prefixed line on stderr, which Claude Code shows in its
 * hook diagnostics and never feeds to the model.
 *
 * @param line the message, without a trailing newline
 */
function logToStderr(line: string): void {
  process.stderr.write(`self-expression: ${line}\n`);
}

/**
 * The injected conventions block for this session start, or `null` for none.
 *
 * Reads `inject.conventions` through the tolerant accessor, then the core document off
 * disk under `options.root`. Fails open at every step: with no store the mode is the
 * default (`always`), because an unreadable config is not a choice anyone made; a mode
 * read that throws is treated the same way; and an unreadable conventions file injects
 * nothing and logs why, rather than blocking the session.
 *
 * @param store   the open store, or `null`
 * @param source  the payload's `source`
 * @param options where the package root is and where failures go
 * @returns the framed conventions text, or `null`
 *
 * @example
 *   conventionsBlock(store, 'compact', { root: '/opt/self-expression' })
 *   // => 'Self-expression conventions (injected at session start; …):\n\n…'
 *
 * @see ../channels/conventions.js injectedConventions
 */
export function conventionsBlock(
  store   : Store | null,
  source  : string | undefined,
  options : SessionStartOptions,
): string | null {

  if (options.root === undefined) { return null; }

  let mode: InjectMode = DEFAULT_INJECT_MODE;
  if (store !== null) {
    try { mode = injectMode(store); }
    catch { /* fail open: the default mode, since an unreadable config chose nothing */ }
  }

  if (!shouldInjectConventions(mode, source)) { return null; }

  const result = injectedConventions(options.root);
  if (result.ok) { return result.text; }

  try { (options.log ?? logToStderr)(`conventions not injected: ${result.problem}`); }
  catch { /* a failing logger must not wedge the session start either */ }

  return null;

}

/**
 * `SessionStart`: hand the new context what it cannot have otherwise — the unread notes
 * to self, and the core conventions.
 *
 * Two independent blocks, combined into one `additionalContext`:
 *
 * - **Unread notes to self** ({@link unreadNotesBlock}, issue #41), on `resume` and
 *   `compact` only — the compaction-survival mechanism.
 * - **The core conventions** ({@link conventionsBlock}), per `inject.conventions`: on
 *   every source by default, because the failure it fixes is a model that never read them,
 *   and the moment they are most reliably lost is compaction, which summarizes them away
 *   while the per-turn reminders survive. Only the core document is injected; the other
 *   skills are named and left as resources.
 *
 * The notes come first. They are short, specific to this session, and time-sensitive,
 * and putting them under thirty-odd kilobytes of conventions would bury exactly the text
 * that most needs to be seen.
 *
 * Fails open like every handler: each block fails on its own, and with neither the
 * result is `null` (inject nothing) rather than a wedged session start.
 *
 * @param store   the open store, or `null` when it could not be opened
 * @param payload the `SessionStart` payload
 * @param now     the moment of the session start
 * @param options the package root to read the conventions from, and the failure log;
 *                omit the root to skip injection entirely
 * @returns the hook output, or `null` when there is nothing to inject
 *
 * @example
 *   onSessionStart(store, { session_id: 's1', source: 'compact' }, new Date(), { root })
 *   // => { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Unread notes …\n\nSelf-expression conventions …' } }
 *
 * @see unreadNotesBlock
 * @see conventionsBlock
 */
export function onSessionStart(
  store   : Store | null,
  payload : HookPayload,
  now     : Date,
  options : SessionStartOptions = {},
): HookOutput {

  const parts = [unreadNotesBlock(store, payload, now), conventionsBlock(store, payload.source, options)]
    .filter((part): part is string => part !== null);

  if (parts.length === 0) { return null; }

  return {
    hookSpecificOutput: {
      hookEventName    : 'SessionStart',
      additionalContext: parts.join('\n\n'),
    },
  };

}

/**
 * The dispatcher's per-handler options: the stop gate's dependencies and the session-start
 * injection's, side by side, since their field names never overlap.
 *
 * @see handleHook
 */
export type HandleHookOptions = StopDeps & SessionStartOptions;

/**
 * Dispatch a named hook.
 *
 * Unknown names allow rather than erroring, so a hooks file referencing a handler this
 * version does not implement degrades to doing nothing.
 *
 * @param options each handler takes its own fields: `stop` the list lint's parser and the
 *                transcript reader ({@link StopDeps}); `session-start` where the conventions
 *                live and where failures are logged ({@link SessionStartOptions})
 *
 * @example
 *   handleHook('stop', store, payload, new Date(), { parse: fromMarkdown })
 *   handleHook('session-start', store, payload, new Date(), { root: '/opt/self-expression' })
 */
export function handleHook(
  name    : string,
  store   : Store | null,
  payload : HookPayload,
  now     : Date = new Date(),
  options : HandleHookOptions = {},
): HookOutput {

  const { parse, readTranscript, root, log } = options;

  if (name === 'user-prompt-submit') { return onUserPromptSubmit(store, payload, now); }
  if (name === 'stop')               { return onStop(store, payload, { parse, readTranscript, now }); }
  if (name === 'session-start')      {
    return onSessionStart(store, payload, now, {
      ...(root !== undefined ? { root } : {}),
      ...(log  !== undefined ? { log }  : {}),
    });
  }

  return null;

}
