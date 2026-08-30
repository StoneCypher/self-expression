/**
 * The first-run onboarding questionnaire: a code-resident question registry plus the
 * per-question ledger that records what has been resolved (issue #40).
 *
 * The registry is the single source of truth for what gets asked — skills never
 * enumerate the questions, for the same reason they never enumerate channels: static
 * markdown cannot track registry growth or answered state. There is deliberately no
 * completion boolean; the questionnaire demonstrably grows (three expansions on the
 * day the issue was filed), and under a boolean every addition either re-runs the
 * whole interview or reaches nobody who already onboarded. Under the per-question
 * ledger, an upgrade shipping a new question produces exactly one pending item.
 *
 * Every config key asked about is owned by another spec (#30, #42, #45, the
 * party-roster skill); this module inherits their names and defaults from
 * {@link ../channels/config.js CONFIG_KEYS} and adds exactly one key of its own,
 * {@link ANSWERED_KEY}.
 *
 * @see ./config.js
 * @see ../mcp/tools.js
 */

import { readConfig, writeConfig, deleteConfig } from './store.js';
import type { Store }                            from './store.js';
import { CHANNELS }                              from './vocabulary.js';
import type { Channel }                          from './vocabulary.js';

/**
 * Config key holding the comma-separated list of question ids that have been
 * resolved — answered, or explicitly skipped.
 *
 * Same list-in-a-string idiom as `channels.enabled`. Unknown ids in the list are
 * preserved, never dropped, per #30's unknown-keys rule: a newer plugin version's
 * question ids must survive a write by an older version.
 */
export const ANSWERED_KEY = 'onboarding.answered';

/**
 * The three answer shapes a question can take.
 *
 * - `boolean` — a yes/no writing `'true'`/`'false'` to a single key (or, for a
 *   question carrying a `channel`, toggling that channel's membership in
 *   `channels.enabled`).
 * - `path-gated boolean` — the dwelling: an enabling answer must carry a `path`
 *   argument, per #45's no-default-path rule.
 * - `channel-list` — channel trimming: the answer is a comma-separated channel list
 *   written to `channels.enabled`, taking full effect next server start.
 */
export type QuestionKind = 'boolean' | 'path-gated boolean' | 'channel-list';

/**
 * One entry of the questionnaire: what is asked, which config keys an answer writes,
 * what shape the answer takes, and what accepting the default would mean.
 */
export interface Question {
  /** Stable identifier; ledger entries and `answer` calls name questions by this. */
  readonly id            : string;
  /** The question as put to the user, including which way the default leans. */
  readonly prompt        : string;
  /** The config keys an answer writes; a hand-set row on any of them counts as answered. */
  readonly keys          : readonly string[];
  readonly kind          : QuestionKind;
  /** The canonical value accepting the default amounts to; written by nothing. */
  readonly defaultAnswer : string;
  /**
   * Present when the boolean governs one channel's membership in `channels.enabled`
   * rather than a key of its own — taste is a channel, not a flag (#42, #30).
   */
  readonly channel?      : Channel | undefined;
}

/**
 * The questionnaire, in asking order: cheap yes/nos first, the two structural
 * questions — the dwelling and channel trimming — last.
 *
 * Defaults are inherited from the owning specs and must match
 * {@link ../channels/config.js CONFIG_KEYS}; the registry-integrity tests hold the
 * two surfaces together.
 */
export const QUESTIONS: readonly Question[] = [
  { id: 'roster', kind: 'boolean', keys: ['roster.enabled'], defaultAnswer: 'false',
    prompt: 'Party-roster flavor when dispatching subagents — each agent gets a face, ' +
            'a name, and a class? Off by default; a matter of taste.' },
  { id: 'forecast', kind: 'boolean', keys: ['forecast.enabled'], defaultAnswer: 'true',
    prompt: 'End-of-turn forecasts (the ! 🔮 line, resolvable later)? On by default; ' +
            'physically large, and divisive.' },
  { id: 'revision', kind: 'boolean', keys: ['revision.enabled'], defaultAnswer: 'false',
    prompt: 'Visible revision — the one informative strikethrough seam? Off by default.' },
  { id: 'salience', kind: 'boolean', keys: ['salience.enabled'], defaultAnswer: 'true',
    prompt: 'The sentence-initial ⭑ marking the single load-bearing sentence of a ' +
            'response? On by default.' },
  { id: 'taste', kind: 'boolean', keys: ['channels.enabled'], defaultAnswer: 'true',
    channel: 'taste',
    prompt: 'The # 🎨 taste line — a scarce aesthetic observation about the work ' +
            'itself? On by default; taste is a channel, so no means trimming it from ' +
            'the channel set.' },
  { id: 'gifts', kind: 'boolean', keys: ['gifts.enabled'], defaultAnswer: 'false',
    prompt: 'The gift register? Off by default.' },
  { id: 'mailbox', kind: 'boolean', keys: ['mailbox.enabled'], defaultAnswer: 'false',
    prompt: 'Held notes — may the assistant write something down at a moment of its own ' +
            'choosing (including an unattended wakeup) for you to read at the start of a ' +
            'later turn of yours? Off by default. Nothing is ever said into an empty ' +
            'room: a note is only ever surfaced on a turn you started, at most one per ' +
            'turn and three a day, each with a stated reason, a visible "held since" ' +
            'line, and an expiry.' },
  { id: 'dwelling', kind: 'path-gated boolean',
    keys: ['dwelling.enabled', 'dwelling.path'], defaultAnswer: 'false',
    prompt: 'A keepsake dwelling — a small database of kept things? Off by default. ' +
            'Enabling requires a directory of your choosing; there is deliberately ' +
            'no default path.' },
  { id: 'channels', kind: 'channel-list', keys: ['channels.enabled'],
    defaultAnswer: CHANNELS.join(','),
    prompt: 'Trim the expression-channel set? All channels are on by default; answer ' +
            'with the comma-separated list to keep. Takes full effect next session — ' +
            'the channel enum is baked into the tool schema at server start.' },
];

/**
 * Every question id, in registry order — the enum the `onboard` tool validates
 * `answer` calls against, so a hallucinated question cannot validate.
 */
export const QUESTION_IDS: readonly string[] = QUESTIONS.map(q => q.id);

/**
 * Look up one question by id, or `undefined` for an id this version does not know.
 *
 * @example
 *   onboardingQuestion('roster')?.kind   // => 'boolean'
 *   onboardingQuestion('vibes')          // => undefined
 */
export function onboardingQuestion(id: string): Question | undefined {
  return QUESTIONS.find(q => q.id === id);
}

/**
 * The ledger as stored: every id — known or not — currently marked resolved.
 *
 * Unknown ids are returned rather than filtered, so a newer version's entries
 * survive being read (and re-written) by this one.
 *
 * @example
 *   answeredIds(store)   // => [] on a fresh database
 */
export function answeredIds(store: Store): readonly string[] {
  const raw = readConfig(store, ANSWERED_KEY);
  if (raw === null) { return []; }
  return raw.split(',').map(s => s.trim()).filter(s => s !== '');
}

/**
 * Whether one question is resolved: its id is in the ledger, or any of its config
 * keys has an explicit row.
 *
 * The second clause is the hand-configured-counts-as-answered rule: a user who
 * already ran `configure set roster.enabled true` by hand has answered that
 * question, and asking again would be noise.
 *
 * @example
 *   questionResolved(store, roster)   // => false on a fresh database
 */
export function questionResolved(store: Store, question: Question): boolean {
  if (answeredIds(store).includes(question.id)) { return true; }
  return question.keys.some(key => readConfig(store, key) !== null);
}

/**
 * The questions still pending, in asking order.
 *
 * A fresh database — empty ledger, no rows — leaves everything pending; that is what
 * "first run" means here. First run is a property of the shared database, not the
 * host, machine, or session: a user who answered under one host is never
 * re-interrogated under another.
 *
 * @example
 *   pendingQuestions(store).length   // => QUESTIONS.length on a fresh database
 *   // after configure set roster.enabled true by hand:
 *   pendingQuestions(store).some(q => q.id === 'roster')   // => false
 */
export function pendingQuestions(store: Store): readonly Question[] {
  return QUESTIONS.filter(q => !questionResolved(store, q));
}

/**
 * Mark one question id resolved, idempotently, preserving every id already in the
 * ledger — including ids this version does not know.
 *
 * @param id the question id to append; already-present ids append nothing
 * @returns whether the ledger actually changed
 *
 * @example
 *   resolveQuestion(store, 'roster')   // => true; ledger now 'roster'
 *   resolveQuestion(store, 'roster')   // => false; already resolved
 */
export function resolveQuestion(store: Store, id: string): boolean {
  const current = answeredIds(store);
  if (current.includes(id)) { return false; }
  writeConfig(store, ANSWERED_KEY, [...current, id].join(','));
  return true;
}

/**
 * Clear the ledger — and only the ledger — so the questionnaire becomes pending
 * again. This is "re-run onboarding".
 *
 * Config values are untouched, and hand-configured keys still count as resolved, so
 * a reset re-asks only questions the user never explicitly configured; a truly blank
 * slate means clearing the keys through `configure` as well.
 *
 * @returns whether a ledger row existed to clear
 *
 * @example
 *   resolveQuestion(store, 'roster');
 *   resetOnboarding(store)   // => true; everything unconfigured is pending again
 */
export function resetOnboarding(store: Store): boolean {
  return deleteConfig(store, ANSWERED_KEY);
}

/**
 * The MCP `instructions` string surfacing pending onboarding to the model, or
 * `null` when nothing is pending.
 *
 * The initialize handshake delivers this on every host — hooks are deliberately not
 * part of the detection path, because they are the least portable layer and
 * onboarding must reach the hosts host-native prompting misses.
 *
 * One of two things riding that transport; {@link ../mcp/server.js serverInstructions}
 * joins this to the conventions pointer. They are independent — either can be absent
 * without disturbing the other — so neither knows about the other here.
 *
 * @example
 *   onboardingInstructions(store)
 *   // => "Onboarding pending (8 questions). At a natural pause, …" on a fresh store
 */
export function onboardingInstructions(store: Store): string | null {
  const pending = pendingQuestions(store);
  if (pending.length === 0) { return null; }
  return `Onboarding pending (${String(pending.length)} question${pending.length === 1 ? '' : 's'}). ` +
         "At a natural pause — never the first turn, never mid-task — offer the questionnaire once; " +
         "onboard {op:'status'} lists it, and \"defaults\" is the one-word fast path " +
         "(onboard {op:'skip'}). Never interrupt or block the user's work for this; " +
         'an ignored offer simply recurs next session.';
}
