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

/** The value shapes a registered key can take. */
export type ConfigKind = 'bool' | 'int' | 'list' | 'string';

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
 * Exists for keys whose domain is a handful of words (`share.time_granularity`) —
 * a free string validator would admit prose into a field other code switches on.
 *
 * @param choices the accepted canonical values, already lowercase
 *
 * @example
 *   choiceValidator(['hour', 'day'])(' Hour ')  // => { ok: true, canonical: 'hour' }
 *   choiceValidator(['hour', 'day'])('minute')  // => { ok: false, expected: "one of 'hour', 'day'" }
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
 * with its length key already registered rather than silently unbounded.
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
  { key: 'messages.enabled', kind: 'bool', fallback: 'true',
    description: 'the messagebox facility (#41): kill switch for the message tools and every hook delivery moment',
    validate: validateBool },
  { key: 'messages.notify', kind: 'bool', fallback: 'true',
    description: 'the per-turn unread-count line specifically; SessionStart injection is governed by messages.enabled alone',
    validate: validateBool },
  { key: 'dwelling.enabled', kind: 'bool', fallback: 'false',
    description: 'whether the dwelling facility (#45) is active; requires dwelling.path to be set',
    validate: validateBool },
  { key: 'dwelling.path', kind: 'string', fallback: null,
    description: 'absolute directory the dwelling database lives in; deliberately no default — required when dwelling.enabled is true',
    validate: stringValidator(1024) },
  { key: 'dwelling.size_warn_gb', kind: 'int', fallback: '10',
    description: 'dwelling file size, in gigabytes, at which a visit warns the user',
    validate: intValidator(0, 1048576) },
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
  { key: 'share.enabled', kind: 'bool', fallback: 'false',
    description: 'whether public-aggregation export (#31) is available; off by default, and only the exact value true enables — the inverse posture of privacy.*',
    validate: validateBool },
  { key: 'share.opted_in_utc', kind: 'string', fallback: null,
    description: 'the most recent opt-in moment; only rows recorded at or after it are ever exported — stamped automatically when share.enabled is set true, cleared on opt-out, never retroactive',
    validate: validateIsoUtc },
  { key: 'share.time_granularity', kind: 'string', fallback: 'hour',
    description: 'how far exported timestamps are coarsened: hour keeps time-of-day questions answerable, day destroys them for a smaller residual',
    validate: choiceValidator(['hour', 'day']) },
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
