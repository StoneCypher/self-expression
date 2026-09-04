/**
 * The audio facility's configuration keys and their tolerant readers.
 *
 * The keys ride the #30 registry in `channels/config.ts` and the shared `config`
 * table — no second mechanism — but they are **read** here, by the claudio server,
 * fresh on every strike, so a disable takes hold the instant the row changes rather
 * than at the next session (spec rule 3).
 *
 * Two policy rules are enforced in this module:
 *
 * - **Exact affirmative enable** (spec rule 1): the facility is on only when
 *   `audio.enabled` reads exactly `'true'` — the mirror of `privacy.ts`'s rule that a
 *   switch takes effect only when unambiguously set.
 * - **The ceiling the assistant can never raise** (spec rule 4): the effective ceiling
 *   is the *minimum* of the `audio.volume_ceiling` config row and the
 *   `CLAUDIO_VOLUME_CEILING` environment variable. Config rows are reachable through
 *   the `configure` tool the assistant operates; the environment block of the host's
 *   MCP registration is not. A user who sets the variable therefore holds a clamp no
 *   tool call can loosen, while the config row stays available for day-to-day taste.
 *   Because that clamp is the one thing the assistant can never talk its way past, a
 *   variable that is *set but unparseable* fails CLOSED to the most restrictive
 *   ceiling rather than falling open — see {@link parseCeilingEnv}.
 *
 * @see ../channels/config.js
 * @see ./gate.js
 */

import { join }           from 'node:path';
import { readConfig }     from '../channels/store.js';
import type { Store }     from '../channels/store.js';
import { LEITMOTIFS }     from './vocabulary.js';
import type { Leitmotif } from './vocabulary.js';

/** Config key: whether the audio facility offers any sound at all. Ships dark. */
export const AUDIO_ENABLED_KEY = 'audio.enabled';

/** Config key: the loudest volume (0–100) the assistant may choose. */
export const AUDIO_CEILING_KEY = 'audio.volume_ceiling';

/** Config key: the local (SAPI) text-to-speech tier's separate gate. Ships dark. */
export const AUDIO_TTS_LOCAL_KEY = 'audio.tts_local';

/** Config key: minimum seconds between audible strikes. */
export const AUDIO_MIN_GAP_KEY = 'audio.min_gap_seconds';

/** Config key: audible strikes allowed per rolling hour. */
export const AUDIO_HOURLY_BUDGET_KEY = 'audio.hourly_budget';

/** Config key: the slightly larger per-hour budget `attention` strikes draw from. */
export const AUDIO_ATTENTION_BUDGET_KEY = 'audio.hourly_budget_attention';

/** Environment variable holding the user's assistant-proof volume clamp. */
export const CEILING_ENV_VAR = 'CLAUDIO_VOLUME_CEILING';

/** Default volume ceiling when neither the row nor the variable is set. */
export const DEFAULT_CEILING = 50;

/** Default minimum spacing between strikes, in seconds — a spike-time proposal. */
export const DEFAULT_MIN_GAP_SECONDS = 30;

/** Default strikes per rolling hour — a spike-time proposal for the human to tune. */
export const DEFAULT_HOURLY_BUDGET = 6;

/** Default per-hour budget for `attention`, which exists for exactly these moments. */
export const DEFAULT_ATTENTION_BUDGET = 8;

/**
 * The config key holding a replacement WAV path for one leitmotif.
 *
 * @example
 *   motifWavKey('spark')  // => 'audio.wav.spark'
 */
export function motifWavKey(leitmotif: Leitmotif): string {
  return `audio.wav.${leitmotif}`;
}

/** Every `audio.wav.<leitmotif>` key, for registry registration. */
export const AUDIO_WAV_KEYS: readonly string[] = LEITMOTIFS.map(motifWavKey);

/** The audio configuration as read from overrides plus code defaults. */
export interface AudioConfig {
  /** True only when `audio.enabled` is exactly `'true'`. */
  readonly enabled               : boolean;
  /** True only when `audio.tts_local` is exactly `'true'`. */
  readonly ttsLocal              : boolean;
  /** The effective ceiling: min(config row, environment clamp), in [0, 100]. */
  readonly ceiling               : number;
  /** Minimum spacing between audible strikes, in seconds. */
  readonly minGapSeconds         : number;
  /** Audible strikes allowed per rolling hour. */
  readonly hourlyBudget          : number;
  /** The per-hour budget `attention` draws from instead. */
  readonly hourlyBudgetAttention : number;
}

/** Parse a stored integer tolerantly: in-range integers pass, everything else falls back. */
function intOr(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/**
 * The ceiling {@link parseCeilingEnv} answers for a `CLAUDIO_VOLUME_CEILING` that is
 * set but fails to parse: the most restrictive value there is, so a broken clamp
 * silences rather than un-clamps.
 */
export const CEILING_ENV_PARSE_FAILURE = 0;

/**
 * Parse the `CLAUDIO_VOLUME_CEILING` environment override strictly: a finite integer
 * in [0, 100], or nothing.
 *
 * Unset means "no clamp offered" and answers 100 silently — the config row alone
 * governs, the ordinary case for most installs. Anything else that fails to parse
 * (blank, `'abc'`, `'NaN'`, `'1e999'`, a non-integer like `'1.5'`, an out-of-range
 * integer) is a misconfiguration, not an absence — and because this variable exists
 * specifically as the one clamp no tool call can loosen, a typo in it must never
 * quietly remove that clamp. It therefore fails CLOSED to
 * {@link CEILING_ENV_PARSE_FAILURE} and writes one line to stderr naming the
 * offending value, rather than falling through to 100 and leaving the assistant
 * unclamped (the previous, mistaken behavior).
 *
 * @param raw - `env[CEILING_ENV_VAR]`; `undefined` when the key is absent entirely
 *
 * @example
 *   parseCeilingEnv(undefined)   // => 100 — no variable set, no restriction offered
 *   parseCeilingEnv('30')        // => 30
 *   parseCeilingEnv('nonsense')  // => 0, plus one stderr line naming 'nonsense'
 */
export function parseCeilingEnv(raw: string | undefined): number {

  if (raw === undefined) { return 100; }

  const trimmed = raw.trim(),
        parsed  = Number(trimmed);

  if (trimmed !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100) {
    return parsed;
  }

  process.stderr.write(
    `claudio: ${CEILING_ENV_VAR}=${JSON.stringify(raw)} is not an integer in [0, 100]; ` +
    `failing closed to ${String(CEILING_ENV_PARSE_FAILURE)} rather than leaving the volume clamp open\n`);
  return CEILING_ENV_PARSE_FAILURE;

}

/**
 * Read the audio configuration, applying code defaults and the environment clamp.
 *
 * Readers are tolerant in the house pattern: a malformed row behaves as unset. The
 * ceiling is the one deliberate asymmetry, and only in one direction: the
 * environment variable can only ever *lower* the result when it parses, and fails
 * CLOSED (never open) when it does not — see {@link parseCeilingEnv}.
 *
 * @param store - the shared log store the `config` table lives in
 * @param env   - injectable environment, for tests; defaults to the process's
 *
 * @example
 *   audioConfig(store)  // => { enabled: false, ttsLocal: false, ceiling: 50, ... }
 */
export function audioConfig(
  store : Store,
  env   : Record<string, string | undefined> = process.env,
): AudioConfig {

  const configured = intOr(readConfig(store, AUDIO_CEILING_KEY), DEFAULT_CEILING, 0, 100),
        envCeiling = parseCeilingEnv(env[CEILING_ENV_VAR]);

  return {
    enabled               : readConfig(store, AUDIO_ENABLED_KEY)   === 'true',
    ttsLocal              : readConfig(store, AUDIO_TTS_LOCAL_KEY) === 'true',
    ceiling               : Math.min(configured, envCeiling),
    minGapSeconds         : intOr(readConfig(store, AUDIO_MIN_GAP_KEY),          DEFAULT_MIN_GAP_SECONDS,  0, 3600),
    hourlyBudget          : intOr(readConfig(store, AUDIO_HOURLY_BUDGET_KEY),    DEFAULT_HOURLY_BUDGET,    0, 600),
    hourlyBudgetAttention : intOr(readConfig(store, AUDIO_ATTENTION_BUDGET_KEY), DEFAULT_ATTENTION_BUDGET, 0, 600),
  };

}

/**
 * Whether `path` is safe to use as a `strike`/`audition` waveform file: an absolute
 * path — never relative, never a UNC share — ending `.wav` (case-insensitive), and
 * free of embedded NULs or other control characters.
 *
 * Pure and total; never throws. The refusals exist for distinct reasons: a UNC path
 * (`\\server\share\...`, or its `//server/share/...` POSIX-notation twin) would send
 * the player reaching across the network on every strike; a relative path resolves
 * against whatever directory the server process happens to be started from, which
 * the user does not control; a non-`.wav` extension would hand
 * `System.Media.SoundPlayer` a format it cannot play, or a file that is not audio at
 * all; control characters (the same range {@link escapePwshSingleQuoted} flattens)
 * could otherwise smuggle something past the PowerShell command line the path is
 * interpolated into.
 *
 * @example
 *   isValidWavPath('C:\\sounds\\spark.wav')     // => true
 *   isValidWavPath('/sounds/spark.wav')         // => true
 *   isValidWavPath('sounds/spark.wav')          // => false — relative
 *   isValidWavPath('\\\\server\\share\\x.wav')  // => false — UNC
 *   isValidWavPath('C:\\sounds\\spark.mp3')     // => false — wrong extension
 *
 * @see ./player.js
 */
export function isValidWavPath(path: string): boolean {

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) { return false; }

  if (!/\.wav$/i.test(path)) { return false; }

  if (path.startsWith('\\\\') || path.startsWith('//')) { return false; }   // UNC, either slash convention

  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(path),
        posixAbsolute   = path.startsWith('/');   // the '//' UNC form was already refused above

  return windowsAbsolute || posixAbsolute;

}

/**
 * The WAV file to play for one leitmotif: the user's configured replacement when one
 * is set and valid, else the vendored asset `<assetDir>/<leitmotif>.wav`.
 *
 * An override that fails {@link isValidWavPath} — relative, UNC, wrong extension, or
 * carrying control characters — behaves as unset, in the same tolerant-reader house
 * pattern as a malformed integer row: the config value is untrusted input, and a bad
 * path here is not a reason to hand the player something dangerous or unplayable.
 * Whether the resolved file exists and decodes is still decided at strike time by
 * the parser, which refuses loudly — this resolver only chooses which path to try.
 *
 * @param store     - the shared log store the `config` table lives in
 * @param leitmotif - the meaning being struck
 * @param assetDir  - directory of the vendored assets
 *
 * @example
 *   motifWavPath(store, 'spark', '/x/assets/leitmotifs')
 *   // => '/x/assets/leitmotifs/spark.wav', when no override is set
 */
export function motifWavPath(store: Store, leitmotif: Leitmotif, assetDir: string): string {
  const override = readConfig(store, motifWavKey(leitmotif))?.trim();
  return override !== undefined && override !== '' && isValidWavPath(override)
    ? override
    : join(assetDir, `${leitmotif}.wav`);
}
