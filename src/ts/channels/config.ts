/**
 * The canonical registry of configuration keys: names, kinds, defaults, and validators.
 *
 * This is a runtime registry rather than a type for the same reason
 * `channels/vocabulary.ts` is: the keys are needed in places types cannot reach — the
 * `configure` tool's rejection messages must name what would have been accepted, and
 * the effective-config listing must enumerate every key with its default even when the
 * `config` table is empty (issue #30, D1).
 *
 * Two rules hold everywhere:
 *
 * - **Writers are strict** (D2): `configure set` runs a key's validator and stores the
 *   canonical text form, so "set once and quietly wrong for months" fails loudly at the
 *   moment of writing instead.
 * - **Readers are tolerant** (D5): {@link effectiveValue} treats a stored value that
 *   fails validation as absent, so a hand-edited database or a pre-validation row can
 *   never wedge the server or the gates.
 *
 * Defaults live here as code, never as seeded rows — a seeded default could never be
 * changed by a later release, because the row would shadow it forever.
 *
 * @see ./store.js
 * @see ./vocabulary.js
 */

import { CHANNELS, describeVocabulary } from './vocabulary.js';
import { LEITMOTIFS }                   from '../claudio/vocabulary.js';
import { IMAGE_PROVIDERS }              from '../imagery/providers.js';
import {
  DEFAULT_DAILY_CAP, DEFAULT_LOCAL_BASE_URL, DEFAULT_PROVIDER_ID, DEFAULT_SESSION_CAP,
  DEFAULT_TIMEOUT_SECONDS, credentialEnvVarProblem, localBaseUrlProblem, providerApiKeyEnvKey,
} from '../imagery/config.js';
import { readConfig, allConfig }        from './store.js';
import type { Store }                   from './store.js';

/**
 * The recording-convention label stamped onto every entry row when no
 * `format.version` override is set.
 *
 * The pin is declarative, not behavioral (D7): the value marks which convention a row
 * was written under so a mid-study upgrade is visible in the data — the server never
 * emulates older conventions when pinned to an older value.
 */
export const FORMAT_VERSION = '1';

/**
 * The text length every channel ships with, in characters (issue #76).
 *
 * Replaces two disagreeing numbers: the flat `.max(280)` the `express` schema carried
 * for all twelve channels, and the `≤70 characters` the skill taught for one of them.
 * 200 is the ceiling; the skill still recommends roughly 70, because a signature that
 * stops being a glance has stopped doing its job — a raised ceiling is headroom for the
 * occasional line that needs it, never an invitation to fill it.
 */
export const DEFAULT_CHANNEL_MAX_CHARS = 200;

/**
 * The largest value any `channels.<name>.max_chars` key may be set to, and therefore
 * the hard ceiling baked into `express`'s static zod schema.
 *
 * 2000 because that is already this project's answer to "how long may one recorded
 * utterance be" — {@link ../channels/messages.js MESSAGE_TEXT_MAX} caps a messagebox
 * message at exactly that, and having `express` and `post_message` agree means one
 * number to remember rather than two. The schema cannot read config (it is built once,
 * at registration, before any store read is meaningful), so it carries this bound and
 * the real per-channel check runs in the handler.
 *
 * @see MIN_CHANNEL_MAX_CHARS
 * @see channelMaxChars
 */
export const MAX_TEXT_CEILING = 2000;

/**
 * The smallest value any `channels.<name>.max_chars` key may be set to.
 *
 * One, not zero: a limit of zero would make a channel unwritable, which is a channel
 * disable arrived at through the wrong door — `channels.enabled` is that door, and it
 * removes the channel from the tool schema so no attention is spent on it. A limit of
 * zero would instead let the model keep trying and keep being rejected.
 */
export const MIN_CHANNEL_MAX_CHARS = 1;

/**
 * The value shapes a registered key can take.
 *
 * `enum` is the closed-choice shape: a key whose whole domain is a handful of words,
 * carrying those words in {@link ConfigKeyDef.choices}. It exists as its own kind
 * rather than riding `string` because the kind is user-facing — `configure set`'s
 * rejection names it — and "is not a valid string" is exactly the unhelpful half of
 * that sentence, where "is not a valid enum … expected one of 'never', 'ask',
 * 'always'" answers the question the user actually has.
 */
export type ConfigKind = 'bool' | 'enum' | 'int' | 'list' | 'string';

/**
 * The window surfaces a posture key governs: the user's external browser, and an
 * editor tab.
 *
 * Two surfaces rather than one key for "may Claude open a window" **because the costs
 * differ.** An external browser window steals focus and may land while the user is away
 * from the machine entirely; an editor tab appears in the window they are already
 * sitting in and waits to be noticed. A single key would force the expensive answer
 * onto the cheap case — a user who is happy with tabs and hostile to browser windows
 * could only express the stricter of the two.
 *
 * @see WINDOW_POSTURES
 * @see windowPostureKey
 */
export const WINDOW_SURFACES = ['browser', 'editor'] as const;

/** One window surface: `'browser'` or `'editor'`. */
export type WindowSurface = typeof WINDOW_SURFACES[number];

/**
 * The three answers a window-posture key accepts, in escalating permissiveness.
 *
 * Three states, which is why the keys are `enum` and not `bool`: "ask" is neither yes
 * nor no, and it is the only honest default for a plugin that cannot know whose machine
 * it is on, whether anyone is watching it, or what else is on that screen.
 *
 * @see WINDOW_SURFACES
 * @see windowPosture
 */
export const WINDOW_POSTURES = ['never', 'ask', 'always'] as const;

/** One window posture: `'never'`, `'ask'`, or `'always'`. */
export type WindowPosture = typeof WINDOW_POSTURES[number];

/**
 * The posture in force when nothing valid is stored — the conservative middle.
 *
 * `ask` rather than `always` because a window is an interruption of someone else's
 * machine, and rather than `never` because refusing outright would make the feature
 * unreachable for the many users who would simply have said yes.
 */
export const DEFAULT_WINDOW_POSTURE: WindowPosture = 'ask';

/**
 * The outcome of validating one proposed config value: either the canonical text to
 * store, or a description of what would have been accepted — never a bare "no".
 */
export type Validation =
  | { readonly ok: true;  readonly canonical: string }
  | { readonly ok: false; readonly expected: string };

/**
 * One registered configuration key: its name, kind, code default, purpose, and the
 * validator that canonicalizes a proposed value or explains what was expected.
 *
 * Adding a key to the surface is one declarative entry in {@link CONFIG_KEYS}; nothing
 * else needs to change for `set` validation, `unset`, and the effective listing to
 * cover it.
 */
export interface ConfigKeyDef {
  readonly key         : string;
  readonly kind        : ConfigKind;
  /** Canonical default text, or `null` when the key deliberately has no default. */
  readonly fallback    : string | null;
  /** One-line purpose, surfaced by the `configure` tool's effective listing. */
  readonly description : string;
  /** Canonicalizes a proposed value, or names what would have been accepted. */
  readonly validate    : (raw: string) => Validation;
  /**
   * The permitted values, present on and only on `enum` keys — the closed set the
   * validator canonicalizes into and rejects outside of. Carried on the definition, not
   * merely captured inside the validator's closure, so a caller that needs to *offer*
   * the choices (a prompt, a listing, a test) can read them without parsing a
   * rejection message.
   */
  readonly choices?    : readonly string[] | undefined;
}

/**
 * Validate a boolean value: exactly `true` or `false`, case-insensitively, and
 * canonicalized to lowercase.
 *
 * Synonyms (`yes`, `1`, `off`) are rejected rather than guessed at — every accepted
 * synonym would be a second spelling that some future reader must also know about, and
 * canonicalizing at write is what makes the read-side "only exact `'false'`
 * suppresses" rule safe rather than fragile.
 *
 * @example
 *   validateBool('TRUE')  // => { ok: true, canonical: 'true' }
 *   validateBool('yes')   // => { ok: false, expected: "a boolean: exactly 'true' or 'false' …" }
 */
export function validateBool(raw: string): Validation {
  const lowered = raw.trim().toLowerCase();
  return lowered === 'true' || lowered === 'false'
    ? { ok: true, canonical: lowered }
    : { ok: false, expected:
        "a boolean: exactly 'true' or 'false' (case-insensitive; synonyms like 'yes' or '1' are not guessed at)" };
}

/**
 * Build a validator for an integer key: decimal digits only, within `[min, max]`
 * inclusive, canonicalized to plain decimal (leading zeros stripped).
 *
 * @param min smallest accepted value, inclusive
 * @param max largest accepted value, inclusive
 *
 * @example
 *   intValidator(0, 3650)('090')   // => { ok: true, canonical: '90' }
 *   intValidator(0, 3650)('-1')    // => { ok: false, expected: 'an integer from 0 to 3650 …' }
 */
export function intValidator(min: number, max: number): (raw: string) => Validation {
  const expected = `an integer from ${String(min)} to ${String(max)}, decimal digits only`;
  return (raw: string): Validation => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) { return { ok: false, expected }; }
    const value = Number(trimmed);
    return value >= min && value <= max
      ? { ok: true, canonical: String(value) }
      : { ok: false, expected };
  };
}

/**
 * Validate a channel list: comma-separated channel names, each a known channel, at
 * least one of them, canonicalized to trimmed names joined with `,`.
 *
 * An unknown name rejects the whole write, naming the valid channels — a typo must
 * fail loudly at set time, not silently disable half the plugin at read time.
 *
 * @example
 *   validateChannelList(' signature , need ')  // => { ok: true, canonical: 'signature,need' }
 *   validateChannelList('signature,vibes')     // => { ok: false, expected: "channel names from 'signature', …" }
 */
export function validateChannelList(raw: string): Validation {

  const named = raw.split(',').map(s => s.trim()).filter(s => s !== '');

  if (named.length === 0) {
    return { ok: false, expected:
      `a non-empty comma-separated list of channels: ${describeVocabulary(CHANNELS)}` };
  }

  const unknown = named.filter(n => !(CHANNELS as readonly string[]).includes(n));

  if (unknown.length > 0) {
    return { ok: false, expected:
      `channel names from ${describeVocabulary(CHANNELS)}; ` +
      `${unknown.map(u => `'${u}'`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not recognised` };
  }

  return { ok: true, canonical: named.join(',') };

}

/**
 * Build a validator for a string key: trimmed, non-empty, at most `maxLength`
 * characters.
 *
 * @param maxLength longest accepted value, in characters, after trimming
 *
 * @example
 *   stringValidator(64)('v18')  // => { ok: true, canonical: 'v18' }
 *   stringValidator(64)('  ')   // => { ok: false, expected: 'a non-empty string of at most 64 characters' }
 */
export function stringValidator(maxLength: number): (raw: string) => Validation {
  const expected = `a non-empty string of at most ${String(maxLength)} characters`;
  return (raw: string): Validation => {
    const trimmed = raw.trim();
    return trimmed !== '' && trimmed.length <= maxLength
      ? { ok: true, canonical: trimmed }
      : { ok: false, expected };
  };
}

/**
 * Build a validator for a small closed-choice key: the value, trimmed and lowercased,
 * must be exactly one of `choices`.
 *
 * This is the validator every `enum` key uses. It exists for keys whose domain is a
 * handful of words (`share.time_granularity`, the `window.*` postures) — a free string
 * validator would admit prose into a field other code switches on. The rejection names
 * the whole set in the same `describeVocabulary` shape {@link validateChannelList}
 * uses, so a mistyped value is answered with what would have worked rather than only
 * that it did not.
 *
 * @param choices the accepted canonical values, already lowercase; also what the key's
 *                {@link ConfigKeyDef.choices} should carry, so the two cannot disagree
 *
 * @example
 *   choiceValidator(['hour', 'day'])(' Hour ')  // => { ok: true, canonical: 'hour' }
 *   choiceValidator(['hour', 'day'])('minute')  // => { ok: false, expected: "one of 'hour', 'day'" }
 *
 * @see WINDOW_POSTURES
 */
export function choiceValidator(choices: readonly string[]): (raw: string) => Validation {
  const expected = `one of ${describeVocabulary(choices)}`;
  return (raw: string): Validation => {
    const lowered = raw.trim().toLowerCase();
    return choices.includes(lowered)
      ? { ok: true, canonical: lowered }
      : { ok: false, expected };
  };
}

/**
 * Validate the **name** of an environment variable a credential is read from.
 *
 * The one validator in this registry written against a hostile caller rather than a
 * mistaken one. `configure` is a tool the model can call, and `image.api_key_env` is
 * read at call time and sent to a third party in an authorization header — so a key
 * that accepted any string would let `image.api_key_env = ANTHROPIC_API_KEY` plus
 * `image.provider = openai` ship one vendor's secret to another, with nothing in the
 * request looking wrong. The rule itself lives beside the facility that enforces it at
 * read time, so the two cannot drift.
 *
 * @example
 *   validateCredentialEnvVar('OPENAI_API_KEY')     // => { ok: true, canonical: 'OPENAI_API_KEY' }
 *   validateCredentialEnvVar('ANTHROPIC_API_KEY')  // => { ok: false, expected: 'a name other than …' }
 *
 * @see credentialEnvVarProblem
 */
export function validateCredentialEnvVar(raw: string): Validation {
  const trimmed = raw.trim(),
        problem = credentialEnvVarProblem(trimmed);
  return problem === null ? { ok: true, canonical: trimmed } : { ok: false, expected: problem };
}

/**
 * Validate a self-hosted image endpoint: an `http`/`https` URL on loopback or a
 * private network, and nowhere else.
 *
 * The local provider posts the user's prompt with no credential and no cost
 * accounting, on the understanding that the endpoint is the user's own machine. A free
 * string here would quietly turn that into a remote party receiving every prompt.
 *
 * @example
 *   validateLocalBaseUrl('http://127.0.0.1:7860')  // => { ok: true, canonical: 'http://127.0.0.1:7860' }
 *   validateLocalBaseUrl('https://images.example') // => { ok: false, expected: 'a loopback or …' }
 *
 * @see localBaseUrlProblem
 */
export function validateLocalBaseUrl(raw: string): Validation {
  const trimmed = raw.trim(),
        problem = localBaseUrlProblem(trimmed);
  return problem === null ? { ok: true, canonical: trimmed } : { ok: false, expected: problem };
}

/**
 * Validate an ISO 8601 UTC timestamp (a trailing `Z`), canonicalized through
 * `toISOString` so stored values compare lexicographically with entry `ts_utc` values.
 *
 * Exists for `share.opted_in_utc`, where a malformed moment must fail loudly at write
 * time — an unparseable opt-in stamp read tolerantly behaves as *no opt-in at all*,
 * which would silently disable sharing the user believed was on.
 *
 * @example
 *   validateIsoUtc('2026-08-28T00:00:00Z')  // => { ok: true, canonical: '2026-08-28T00:00:00.000Z' }
 *   validateIsoUtc('yesterday')             // => { ok: false, expected: 'an ISO 8601 UTC timestamp …' }
 */
export function validateIsoUtc(raw: string): Validation {
  const trimmed = raw.trim(),
        parsed  = Date.parse(trimmed);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(trimmed) && !Number.isNaN(parsed)
    ? { ok: true, canonical: new Date(parsed).toISOString() }
    : { ok: false, expected: "an ISO 8601 UTC timestamp ending in Z, e.g. '2026-08-28T00:00:00Z'" };
}

/**
 * Validate a free token list: comma-separated non-empty tokens, at least one,
 * canonicalized to trimmed tokens joined with `,`.
 *
 * Deliberately permissive about what a token *is* — it exists for
 * `onboarding.answered`, whose unknown-ids-are-preserved rule (#40, following #30's
 * unknown-keys rule) means a strict membership check would be a bug: a newer plugin
 * version's question ids must survive validation by an older version, and a reader
 * that treated them as invalid would silently un-answer the whole questionnaire.
 *
 * @example
 *   validateTokenList(' roster , forecast ')  // => { ok: true, canonical: 'roster,forecast' }
 *   validateTokenList(' , ')                  // => { ok: false, expected: 'a non-empty comma-separated list …' }
 */
export function validateTokenList(raw: string): Validation {
  const tokens = raw.split(',').map(s => s.trim()).filter(s => s !== '');
  return tokens.length > 0
    ? { ok: true, canonical: tokens.join(',') }
    : { ok: false, expected: 'a non-empty comma-separated list of ids' };
}

/**
 * The registry key naming one channel's maximum text length.
 *
 * Twelve flat keys rather than one map-valued key, deliberately (issue #76): a map
 * would need its own parser, its own error vocabulary, and a `configure set` grammar
 * nothing else in the surface uses, and `configure list` would print it as one opaque
 * blob instead of twelve inspectable lines. Twelve entries cost a wider table and
 * nothing else — `set`, `unset`, `get`, and the effective listing all work with no
 * special-casing at all.
 *
 * @param channel the channel name; a member of `CHANNELS` in practice, though the
 *                function is total so callers need not narrow first
 * @returns the config key, which is stable public surface — users type it
 *
 * @example
 *   channelMaxCharsKey('signature')  // => 'channels.signature.max_chars'
 *
 * @see channelMaxChars
 */
export function channelMaxCharsKey(channel: string): string {
  return `channels.${channel}.max_chars`;
}

/**
 * The registry key naming one window surface's posture.
 *
 * A builder rather than two bare strings for the same reason
 * {@link channelMaxCharsKey} is one: the key is stable public surface users type, and
 * deriving it in one place means the registry entry, the tolerant reader, and the
 * turn-start hook cannot drift apart on a spelling.
 *
 * @param surface the window surface; a member of {@link WINDOW_SURFACES} in practice,
 *                though the function is total so callers need not narrow first
 * @returns the config key
 *
 * @example
 *   windowPostureKey('browser')  // => 'window.browser'
 *   windowPostureKey('editor')   // => 'window.editor'
 *
 * @see windowPosture
 */
export function windowPostureKey(surface: string): string {
  return `window.${surface}`;
}

/**
 * The registered provider ids, as the closed choice set `image.provider` offers.
 *
 * Derived from the registry rather than written out, so a provider added in
 * `imagery/providers.ts` arrives in `configure list` already spelled correctly.
 */
const IMAGE_PROVIDER_CHOICES: readonly string[] = IMAGE_PROVIDERS.map(provider => provider.id);

/**
 * Every key this version of the plugin knows about.
 *
 * A key a newer version writes is still stored and preserved (D3) — this registry is
 * what makes it possible to *say* it is unknown, not a gate that rejects it. The
 * `dwelling.*` keys belong to issue #45's facility and are registered here so the
 * config surface and the dwelling cannot disagree about their names, kinds, or
 * defaults. The `audio.*` keys belong to issue #44's claudio facility on the same
 * terms: the keys ride this registry and the shared `config` table (no second
 * mechanism), while the claudio server reads them through its own tolerant reader
 * in `../claudio/config.ts`. The `channels.<name>.max_chars` family belongs to issue
 * #76 and is generated from `CHANNELS`, so a channel added to the vocabulary arrives
 * with its length key already registered rather than silently unbounded. The
 * `mailbox.*` family belongs to issue #43's held notes: one kill switch plus four
 * numeric budgets and a TTL, all riding this registry so the consent surface and the
 * facility cannot disagree about a default. `retraction.replay` belongs to issue #16 and
 * is the single key that feature adds — the register itself is always computed; the key
 * governs only whether a session's first turn is handed it. The `image.*` family belongs
 * to issue #78 and carries the registry's one genuinely unusual rule: `image.api_key_env`
 * and its per-provider siblings store the **name** of an environment variable and never a
 * credential. A name is not a secret and is printed freely; the value is read from the
 * environment at call time by `imagery/config.ts` and written nowhere at all. Any future
 * key that would hold a credential rather than name one does not belong in this registry,
 * or in this database. Because `configure` is model-callable, those name keys and
 * `image.local_base_url` carry validators written against a hostile value rather than a
 * mistyped one — what may be named, and where a prompt may be posted, are bounded here and
 * again at read time. The `window.*` pair is the `enum` kind's first home: two keys, one
 * per window surface, because the cost of an external browser window and the cost of an
 * editor tab are not the same cost.
 */
export const CONFIG_KEYS: readonly ConfigKeyDef[] = [
  { key: 'channels.enabled', kind: 'list', fallback: CHANNELS.join(','),
    description: 'which expression channels the express tool offers; baked into the tool schema at server startup',
    validate: validateChannelList },
  ...CHANNELS.map((channel): ConfigKeyDef => ({
    key: channelMaxCharsKey(channel), kind: 'int', fallback: String(DEFAULT_CHANNEL_MAX_CHARS),
    description:
      `longest text, in characters, express accepts on the '${channel}' channel (#76); ` +
      'a ceiling rather than a target, checked in the handler and governing writes only — ' +
      'rows already stored longer than a lowered limit are never touched',
    validate: intValidator(MIN_CHANNEL_MAX_CHARS, MAX_TEXT_CEILING) })),
  { key: 'gate.signature', kind: 'bool', fallback: 'true',
    description: 'whether the Stop gate blocks a turn that never signed off',
    validate: validateBool },
  { key: 'gate.checklist', kind: 'bool', fallback: 'true',
    description: 'reserved for the checklist gate (D8); registered now so its name and default are settled before anything reads it',
    validate: validateBool },
  { key: 'retention.days', kind: 'int', fallback: '0',
    description: 'prune entries and turn context older than this many days at server startup; 0 never prunes',
    validate: intValidator(0, 3650) },
  { key: 'privacy.store_cwd', kind: 'bool', fallback: 'true',
    description: 'record cwd, project, and git branch; suppressed at write time when exactly false',
    validate: validateBool },
  { key: 'privacy.store_prompt_len', kind: 'bool', fallback: 'true',
    description: 'record the prompt length; suppressed at write time when exactly false',
    validate: validateBool },
  { key: 'privacy.store_quotes', kind: 'bool', fallback: 'true',
    description: "record the verbatim anchor quote of a prompt-kind anchor — the human's own words (#18); suppressed at write time when exactly false, while anchor_hash still records so drift detection and aggregation survive without language",
    validate: validateBool },
  { key: 'format.version', kind: 'string', fallback: FORMAT_VERSION,
    description: 'declarative recording-convention label stamped onto each entry row; not behavioral',
    validate: stringValidator(64) },
  { key: 'time.hook', kind: 'bool', fallback: 'true',
    description: 'whether the UserPromptSubmit hook injects the clock sentence; context recording is unaffected',
    validate: validateBool },
  { key: 'forecast.enabled', kind: 'bool', fallback: 'true',
    description: "whether the 'predicted' confidence ground is offered; baked into the tool schema at server startup (#42)",
    validate: validateBool },
  { key: 'salience.enabled', kind: 'bool', fallback: 'true',
    description: 'the ⭑ salience-glyph prose convention; carried to skills via the context line’s conventions flags (#42)',
    validate: validateBool },
  { key: 'revision.enabled', kind: 'bool', fallback: 'false',
    description: 'the visible-revision prose convention; carried via the conventions flags',
    validate: validateBool },
  { key: 'gifts.enabled', kind: 'bool', fallback: 'false',
    description: 'the gift register prose convention; carried via the conventions flags',
    validate: validateBool },
  { key: 'roster.enabled', kind: 'bool', fallback: 'false',
    description: 'the party-roster prose convention (#40); carried via the conventions flags',
    validate: validateBool },
  { key: 'retraction.replay', kind: 'bool', fallback: 'true',
    description:
      'whether the first turn of a session is handed the recent retraction register (#16), ' +
      'so a resumed session does not carry known falsehoods forward; on by default — ' +
      'hiding what you already know is wrong is a strange thing to offer prominently, so ' +
      'this is the escape hatch rather than a personality choice',
    validate: validateBool },
  { key: 'messages.enabled', kind: 'bool', fallback: 'true',
    description: 'the messagebox facility (#41): kill switch for the message tools and every hook delivery moment',
    validate: validateBool },
  { key: 'messages.notify', kind: 'bool', fallback: 'true',
    description: 'the per-turn unread-count line specifically; SessionStart injection is governed by messages.enabled alone',
    validate: validateBool },
  { key: 'mailbox.enabled', kind: 'bool', fallback: 'false',
    description:
      'self-initiated held notes (#43): the one switch that stops composition, offering, ' +
      "and surfacing at once. Off by default — until a human says yes, no note is ever " +
      'composed and no mailbox line is ever injected',
    validate: validateBool },
  { key: 'mailbox.surface_budget', kind: 'int', fallback: '1',
    description:
      'how many held notes one reply turn may be offered; 0 offers none, which holds ' +
      'everything without composing being disabled',
    validate: intValidator(0, 10) },
  { key: 'mailbox.daily_cap', kind: 'int', fallback: '3',
    description:
      'held notes that may be surfaced in any rolling 24 hours; a ceiling on the whole ' +
      'facility, not per-series — scarcity is what makes each note cost something',
    validate: intValidator(0, 100) },
  { key: 'mailbox.max_pending', kind: 'int', fallback: '10',
    description:
      'queue depth; composing past it fails loudly rather than queueing silently, so a ' +
      'runaway composer is a visible error instead of a backlog nobody asked for',
    validate: intValidator(1, 1000) },
  { key: 'mailbox.offer_cap', kind: 'int', fallback: '3',
    description:
      'offers a note gets before it expires unsurfaced; a note gets a few chances at an ' +
      'entrance and then it is over — there is no state from which a note can pester forever',
    validate: intValidator(1, 100) },
  { key: 'mailbox.default_ttl_days', kind: 'int', fallback: '14',
    description:
      'default lifetime of a composed note, in days, when no expiry is given; expiry is ' +
      'mandatory, so this is the default rather than an opt-in',
    validate: intValidator(1, 3650) },
  { key: 'dwelling.enabled', kind: 'bool', fallback: 'false',
    description: 'whether the dwelling facility (#45) is active; requires dwelling.path to be set',
    validate: validateBool },
  { key: 'dwelling.path', kind: 'string', fallback: null,
    description: 'absolute directory the dwelling database lives in; deliberately no default — required when dwelling.enabled is true',
    validate: stringValidator(1024) },
  { key: 'dwelling.size_warn_gb', kind: 'int', fallback: '10',
    description: 'dwelling file size, in gigabytes, at which a visit warns the user',
    validate: intValidator(0, 1048576) },
  { key: 'desk.path', kind: 'string', fallback: null,
    description:
      'absolute directory of the desk (#93, #98) — the same one the desk server is started on; ' +
      'deliberately no default, since a desk is a place the user chose, not one the plugin picks',
    validate: stringValidator(1024) },
  { key: 'desk.answer_cards', kind: 'int', fallback: '8',
    description:
      'how many render_card answer cards the desk keeps before the oldest ages out (#93); ' +
      'a card worth keeping gets pinned (fixed: true) and is never counted',
    validate: intValidator(1, 100) },
  { key: 'audio.enabled', kind: 'bool', fallback: 'false',
    description: "whether the claudio audio facility (#44) offers its tools; only exactly 'true' enables — read at claudio server startup for the schema, and re-checked per strike",
    validate: validateBool },
  { key: 'audio.volume_ceiling', kind: 'int', fallback: '50',
    description: 'loudest volume (0-100) the assistant may choose; the CLAUDIO_VOLUME_CEILING environment variable can only lower it further, never raise it',
    validate: intValidator(0, 100) },
  { key: 'audio.tts_local', kind: 'bool', fallback: 'false',
    description: "the local offline TTS tier's own consent gate; only exactly 'true' registers the say tool. Cloud TTS tiers deliberately do not exist in this build",
    validate: validateBool },
  { key: 'audio.min_gap_seconds', kind: 'int', fallback: '30',
    description: 'minimum seconds between audible strikes, enforced server-side from the ledger',
    validate: intValidator(0, 3600) },
  { key: 'audio.hourly_budget', kind: 'int', fallback: '6',
    description: 'audible strikes allowed per rolling hour; scarcity is structural, not aspirational',
    validate: intValidator(0, 600) },
  { key: 'audio.hourly_budget_attention', kind: 'int', fallback: '8',
    description: "the slightly larger per-hour budget 'attention' strikes draw from — it exists for exactly the moments the budget protects",
    validate: intValidator(0, 600) },
  ...LEITMOTIFS.map((leitmotif): ConfigKeyDef => ({
    key: `audio.wav.${leitmotif}`, kind: 'string', fallback: null,
    description: `absolute path to a replacement 16-bit PCM WAV for the '${leitmotif}' leitmotif; unset plays the vendored asset`,
    validate: stringValidator(1024) })),
  { key: 'image.enabled', kind: 'bool', fallback: 'false',
    description:
      "whether the image-generation facility (#78) registers its tool; only exactly 'true' " +
      'enables, and even then the tool appears only when the named credential variable is ' +
      'actually holding something — off by default because every call spends the user’s money',
    validate: validateBool },
  { key: 'image.provider', kind: 'enum', choices: IMAGE_PROVIDER_CHOICES,
    fallback: DEFAULT_PROVIDER_ID,
    description:
      'which registered image provider is active; adding a provider is one registry entry ' +
      'in imagery/providers.ts, and this key learns its name automatically',
    validate: choiceValidator(IMAGE_PROVIDER_CHOICES) },
  { key: 'image.api_key_env', kind: 'string', fallback: null,
    description:
      'the NAME of the environment variable holding the image credential — never the key ' +
      'itself, which is read from the environment at call time and never written to this ' +
      'table, the ledger, a cache, or a log. Must look like an image credential’s name and ' +
      'may not name a well-known secret belonging to something else, because this value ' +
      'decides what gets sent to an image vendor. Unset falls back to the active provider’s ' +
      'own default variable name, so a shell that already exports one needs no configuration',
    validate: validateCredentialEnvVar },
  ...IMAGE_PROVIDERS.map((provider): ConfigKeyDef => ({
    key: providerApiKeyEnvKey(provider.id), kind: 'string', fallback: null,
    description:
      `the NAME of the environment variable holding the ${provider.id} credential, ` +
      'overriding image.api_key_env for that provider only; exists so two providers can be ' +
      'configured at once and switched between without rewriting a key name' +
      (provider.defaultEnvVar === null
        ? ' — this provider needs no credential, so the key is inert'
        : `. Unset uses ${provider.defaultEnvVar}`),
    validate: validateCredentialEnvVar })),
  { key: 'image.model', kind: 'string', fallback: null,
    description: 'which of the active provider’s models to ask for; unset takes the provider’s default, and a model the provider does not list is ignored rather than sent',
    validate: stringValidator(128) },
  { key: 'image.session_cap', kind: 'int', fallback: String(DEFAULT_SESSION_CAP),
    description:
      'generations allowed in one server session; enforced server-side from the ledger, and ' +
      'named in the refusal when it is what stopped a call. A runaway loop is a bill, not an annoyance',
    validate: intValidator(0, 1000) },
  { key: 'image.daily_cap', kind: 'int', fallback: String(DEFAULT_DAILY_CAP),
    description: 'generations allowed in any rolling 24 hours; rolling rather than calendar-day, so no cap resets at midnight and no retry loop waits for one',
    validate: intValidator(0, 10000) },
  { key: 'image.timeout_seconds', kind: 'int', fallback: String(DEFAULT_TIMEOUT_SECONDS),
    description: 'how long one generation may take before it is abandoned; the ledger keeps the abandoned row as pending, which counts against the caps because an unknown call may still have been billed',
    validate: intValidator(5, 900) },
  { key: 'image.local_base_url', kind: 'string', fallback: DEFAULT_LOCAL_BASE_URL,
    description: 'base URL for a self-hosted image endpoint (the automatic1111 provider); a local provider needs no credential and costs no money, which is why the registry makes needsCredential a per-provider fact rather than an assumption. Only loopback and private-network hosts are accepted — a remote host here would be an unaccounted third party receiving every prompt',
    validate: validateLocalBaseUrl },
  { key: 'share.enabled', kind: 'bool', fallback: 'false',
    description: 'whether public-aggregation export (#31) is available; off by default, and only the exact value true enables — the inverse posture of privacy.*',
    validate: validateBool },
  { key: 'share.opted_in_utc', kind: 'string', fallback: null,
    description: 'the most recent opt-in moment; only rows recorded at or after it are ever exported — stamped automatically when share.enabled is set true, cleared on opt-out, never retroactive',
    validate: validateIsoUtc },
  { key: 'share.time_granularity', kind: 'enum', choices: ['hour', 'day'], fallback: 'hour',
    description: 'how far exported timestamps are coarsened: hour keeps time-of-day questions answerable, day destroys them for a smaller residual',
    validate: choiceValidator(['hour', 'day']) },
  { key: 'onboarding.answered', kind: 'list', fallback: null,
    description: 'ids of onboarding questions resolved — answered or skipped (#40); unknown ids are preserved, and unsetting this re-runs onboarding',
    validate: validateTokenList },
  { key: windowPostureKey('browser'), kind: 'enum', choices: WINDOW_POSTURES,
    fallback: DEFAULT_WINDOW_POSTURE,
    description:
      "whether a page may be opened in the user's external browser: never, ask, or always. " +
      'Separate from window.editor because an external window steals focus and may land ' +
      'while nobody is at the machine. Advisory — carried on the turn-start context line, ' +
      'not enforced, because nothing can stop a shell command from opening a window',
    validate: choiceValidator(WINDOW_POSTURES) },
  { key: windowPostureKey('editor'), kind: 'enum', choices: WINDOW_POSTURES,
    fallback: DEFAULT_WINDOW_POSTURE,
    description:
      'whether a page may be opened as an editor tab: never, ask, or always. The cheaper ' +
      'of the two surfaces — a tab appears in the window the user is already sitting in — ' +
      'which is exactly why it gets its own key rather than inheriting the browser answer. ' +
      'Advisory on the same terms as window.browser',
    validate: choiceValidator(WINDOW_POSTURES) },
];

/**
 * Look up one registered key's definition, or `undefined` for a key this version does
 * not know about.
 *
 * @example
 *   configKey('gate.signature')?.fallback  // => 'true'
 *   configKey('gate.signture')             // => undefined — the typo D3's warning exists for
 */
export function configKey(key: string): ConfigKeyDef | undefined {
  return CONFIG_KEYS.find(def => def.key === key);
}

/**
 * The tolerant effective-value accessor every consumer reads through (D5).
 *
 * For a registered key: the stored override in canonical form when it validates, else
 * the code default — a hand-edited or pre-validation row behaves as unset rather than
 * wedging anything. Returns `null` only for a key with no default (`dwelling.path`)
 * and no valid override. For an unregistered key: the raw stored value, or `null`,
 * because there is nothing to validate against.
 *
 * @param key the config key to resolve
 * @returns the effective canonical value, or `null` when the key resolves to nothing
 *
 * @example
 *   effectiveValue(store, 'retention.days')   // => '0' on a fresh install
 *   writeConfig(store, 'retention.days', 90);
 *   effectiveValue(store, 'retention.days')   // => '90'
 */
export function effectiveValue(store: Store, key: string): string | null {

  const def = configKey(key),
        raw = readConfig(store, key);

  if (def === undefined) { return raw; }

  if (raw !== null) {
    const outcome = def.validate(raw);
    if (outcome.ok) { return outcome.canonical; }
  }

  return def.fallback;

}

/**
 * The text length in force for one channel, in characters.
 *
 * Reads through {@link effectiveValue}, so a hand-edited or out-of-range row behaves as
 * unset and yields {@link DEFAULT_CHANNEL_MAX_CHARS} rather than a limit nobody chose.
 * An unregistered channel name — which the closed `channel` enum makes unreachable
 * through the tool — also lands on the default rather than throwing.
 *
 * **Normative rule, binding on every future reader and prune: this limit governs
 * writes, and only writes.** A row already stored at 300 characters stays exactly as it
 * is when the limit is later lowered to 80: not truncated, not flagged, not excluded
 * from a read, not a candidate for deletion, and not excluded from an export. Retention
 * (`retention.days`) deletes by age and nothing else, and no query helper may treat an
 * over-long stored row as invalid. A limit says what may be written from now on; it is
 * never a retroactive judgment on what was already said.
 *
 * @param store   the open store to resolve against
 * @param channel which channel's limit to read
 * @returns the limit in characters, always within
 *          `[MIN_CHANNEL_MAX_CHARS, MAX_TEXT_CEILING]`
 *
 * @example
 *   channelMaxChars(store, 'taste')      // => 200 on a fresh install
 *   writeConfig(store, 'channels.taste.max_chars', '320');
 *   channelMaxChars(store, 'taste')      // => 320
 *   channelMaxChars(store, 'signature')  // => 200 — one key, one channel
 *
 * @see channelMaxCharsKey
 */
export function channelMaxChars(store: Store, channel: string): number {

  const raw    = effectiveValue(store, channelMaxCharsKey(channel)),
        parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isInteger(parsed)
      && parsed >= MIN_CHANNEL_MAX_CHARS
      && parsed <= MAX_TEXT_CEILING
    ? parsed
    : DEFAULT_CHANNEL_MAX_CHARS;

}

/**
 * The posture in force for one window surface.
 *
 * Reads through {@link effectiveValue}, so a hand-edited row, a value from a newer
 * version's larger vocabulary, or a downgrade all land on
 * {@link DEFAULT_WINDOW_POSTURE} — `ask`, which is the safe direction (D5). The return
 * type is narrowed to {@link WindowPosture} so callers can switch exhaustively instead
 * of re-checking a string.
 *
 * **This value is advisory, and deliberately so.** Nothing in this plugin can prevent a
 * shell command from opening a window, and no tool here tries to; the key exists to put
 * the user's stated wish somewhere the model reliably sees it, every turn, which is the
 * only mechanism honestly available.
 *
 * @param store   the open store to resolve against
 * @param surface which window surface's posture to read
 * @returns the posture in force, never null and never outside {@link WINDOW_POSTURES}
 *
 * @example
 *   windowPosture(store, 'browser')   // => 'ask' on a fresh install
 *   writeConfig(store, 'window.editor', 'always');
 *   windowPosture(store, 'editor')    // => 'always'
 *   writeConfig(store, 'window.editor', 'sometimes');
 *   windowPosture(store, 'editor')    // => 'ask' — an invalid row behaves as unset
 *
 * @see windowPostureKey
 * @see ../mcp/hooks.js windowPostureLine
 */
export function windowPosture(store: Store, surface: string): WindowPosture {

  const raw = effectiveValue(store, windowPostureKey(surface));

  return (WINDOW_POSTURES as readonly string[]).includes(raw ?? '')
    ? raw as WindowPosture
    : DEFAULT_WINDOW_POSTURE;

}

/** One line of the effective-configuration report. */
export interface EffectiveEntry {
  readonly key    : string;
  /** The value in effect; `null` for a key with no default and no valid override. */
  readonly value  : string | null;
  /** Where the value came from — an override row, or the code default. */
  readonly source : 'override' | 'default';
  /** Whether this version's registry knows the key. */
  readonly known  : boolean;
  /** Present when something is worth flagging: an invalid stored row, or an unknown key. */
  readonly note?  : string | undefined;
}

/**
 * The effective configuration: every registered key with its value and source, plus
 * any unknown override rows, labeled as unknown (D4).
 *
 * This answers "what is my configuration?" when the answer is mostly defaults — which
 * the overrides-only dump it replaces never could. An override that fails its key's
 * validator is reported at the default with a note, matching what
 * {@link effectiveValue} will actually do.
 *
 * @example
 *   effectiveConfig(store)
 *   // => [ { key: 'channels.enabled', value: 'signature,need,…', source: 'default', known: true }, … ]
 */
export function effectiveConfig(store: Store): EffectiveEntry[] {

  const overrides = allConfig(store),
        out: EffectiveEntry[] = [];

  for (const def of CONFIG_KEYS) {

    const raw = overrides[def.key];

    if (raw === undefined) {
      out.push({ key: def.key, value: def.fallback, source: 'default', known: true });
      continue;
    }

    const outcome = def.validate(raw);

    if (outcome.ok) {
      out.push({ key: def.key, value: outcome.canonical, source: 'override', known: true });
    } else {
      out.push({ key: def.key, value: def.fallback, source: 'default', known: true,
                 note: `stored override '${raw}' is not ${outcome.expected}; treated as unset` });
    }

  }

  for (const [key, value] of Object.entries(overrides)) {
    if (configKey(key) === undefined) {
      out.push({ key, value, source: 'override', known: false,
                 note: 'unknown to this version; preserved — possibly written by a newer version' });
    }
  }

  return out;

}
