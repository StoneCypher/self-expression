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
 * Read the audio configuration, applying code defaults and the environment clamp.
 *
 * Readers are tolerant in the house pattern: a malformed row behaves as unset. The
 * one deliberate asymmetry is the ceiling, where the environment variable can only
 * ever *lower* the result — a malformed variable is ignored rather than treated as 0,
 * because "typo silences everything" would be a confusing off-switch when
 * `audio.enabled` already is one.
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

  const configured = intOr(readConfig(store, AUDIO_CEILING_KEY), DEFAULT_CEILING, 0, 100);

  const envRaw     = env[CEILING_ENV_VAR]?.trim(),
        envParsed  = envRaw === undefined || envRaw === '' ? NaN : Number(envRaw),
        envCeiling = Number.isInteger(envParsed) && envParsed >= 0 && envParsed <= 100 ? envParsed : 100;

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
 * The WAV file to play for one leitmotif: the user's configured replacement when one
 * is set, else the vendored asset `<assetDir>/<leitmotif>.wav`.
 *
 * Whether the file exists and is playable is decided at strike time by the parser,
 * which refuses loudly — this resolver only chooses which path to try.
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
  const override = readConfig(store, motifWavKey(leitmotif));
  return override !== null && override.trim() !== '' ? override : join(assetDir, `${leitmotif}.wav`);
}
