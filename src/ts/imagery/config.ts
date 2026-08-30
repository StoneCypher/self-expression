/**
 * The image facility's configuration, and the one line in the codebase where a
 * credential is read.
 *
 * The rule this module exists to make structural: **configuration names the
 * environment variable; configuration never holds the key.** The shape of the code is
 * the enforcement. {@link ImageConfig} has a `credentialEnvVar` field and no field a
 * credential could occupy, and {@link imageConfig} takes no environment at all — it
 * *cannot* read a key, because it is never handed anywhere to read one from.
 * {@link resolveCredential} is the only function that touches
 * `process.env[<the configured name>]`, it is called once per generation attempt and
 * at no other time, and what it returns is used inside a single function call and then
 * dropped.
 *
 * The variable *name* is not a secret. It is printed in the startup warning, offered
 * by `configure list`, and written to the ledger, all deliberately: a user has to be
 * able to see which variable the plugin is looking at in order to fix it when it is
 * the wrong one. That asymmetry — name public, value untouchable — is what makes this
 * configuration rather than storage.
 *
 * ## Which key, for which provider
 *
 * The issue asked whether to have one credential key per provider or one active
 * provider with one key, and recommended the second. This module does the second and
 * gets the first for three lines, by resolving in order:
 *
 *   1. `image.<provider>.api_key_env` — the per-provider override, for a user who
 *      keeps two providers configured and switches between them;
 *   2. `image.api_key_env` — the one-key spelling, which is what a person actually
 *      writes;
 *   3. the provider's own {@link ImageProvider.defaultEnvVar} — so a user whose shell
 *      already exports `OPENAI_API_KEY` configures nothing but `image.enabled`.
 *
 * @see ./providers.js
 * @see ./gate.js
 * @see ../channels/config.js
 */

import { readConfig }         from '../channels/store.js';
import type { Store }         from '../channels/store.js';
import { DEFAULT_IMAGE_PROVIDER, IMAGE_PROVIDER_IDS, imageProvider } from './providers.js';
import type { ImageProvider, ImageProviderId } from './providers.js';

/** Config key: whether the image facility offers its tool at all. Ships dark. */
export const IMAGE_ENABLED_KEY = 'image.enabled';

/** Config key: which registered provider is active. */
export const IMAGE_PROVIDER_KEY = 'image.provider';

/** Config key: the name of the environment variable holding the credential. */
export const IMAGE_API_KEY_ENV_KEY = 'image.api_key_env';

/** Config key: the model to ask the active provider for; unset takes its default. */
export const IMAGE_MODEL_KEY = 'image.model';

/** Config key: generations allowed in one server session. */
export const IMAGE_SESSION_CAP_KEY = 'image.session_cap';

/** Config key: generations allowed in any rolling 24 hours. */
export const IMAGE_DAILY_CAP_KEY = 'image.daily_cap';

/** Config key: base URL for providers whose endpoint the user runs themselves. */
export const IMAGE_LOCAL_BASE_URL_KEY = 'image.local_base_url';

/** Config key: how long one generation may take before it is abandoned. */
export const IMAGE_TIMEOUT_KEY = 'image.timeout_seconds';

/** The per-provider credential-variable key, the growth path the issue asked for. */
export function providerApiKeyEnvKey(id: ImageProviderId): string {
  return `image.${id}.api_key_env`;
}

/** Every `image.<provider>.api_key_env` key, for registry registration. */
export const IMAGE_PROVIDER_ENV_KEYS: readonly string[] = IMAGE_PROVIDER_IDS.map(providerApiKeyEnvKey);

/**
 * Default generations per server session — conservative on purpose.
 *
 * Audio's budgets protect a room from noise. This one protects a card from a runaway
 * loop, which is a different kind of harm and argues for a smaller number: six is
 * enough to iterate on one picture in one sitting and far too few to be expensive by
 * accident.
 */
export const DEFAULT_SESSION_CAP = 6;

/** Default generations per rolling 24 hours. */
export const DEFAULT_DAILY_CAP = 20;

/** Default seconds one generation may take before it is abandoned. */
export const DEFAULT_TIMEOUT_SECONDS = 120;

/** Default endpoint for the local provider — loopback, never a remote host. */
export const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:7860';

/** The provider selected when `image.provider` is unset. */
export const DEFAULT_PROVIDER_ID: ImageProviderId = DEFAULT_IMAGE_PROVIDER.id;

/**
 * The image configuration in force.
 *
 * Contains a credential *variable name* and, deliberately, nowhere to put a
 * credential value.
 */
export interface ImageConfig {
  /** True only when `image.enabled` reads exactly `'true'`. */
  readonly enabled          : boolean;
  readonly provider         : ImageProvider;
  readonly model            : string;
  readonly sessionCap       : number;
  readonly dailyCap         : number;
  readonly timeoutSeconds   : number;
  readonly localBaseUrl     : string;
  /**
   * The environment variable the credential will be read from at call time, or `null`
   * for a provider that needs none. A name. Printable. Never a value.
   */
  readonly credentialEnvVar : string | null;
}

/** Parse a stored integer tolerantly: in-range integers pass, everything else falls back. */
function intOr(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** A stored string, trimmed, or `null` when absent or blank. */
function textOr(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The environment variable one provider's credential is read from: the per-provider
 * override, then the single-key spelling, then the provider's own default.
 *
 * @param store    - the shared log store the `config` table lives in
 * @param provider - the active provider
 * @returns the variable's name, or `null` when the provider needs no credential
 *
 * @example
 *   credentialEnvVar(store, imageProvider('openai')!)   // => 'OPENAI_API_KEY'
 *   writeConfig(store, 'image.api_key_env', 'WORK_KEY');
 *   credentialEnvVar(store, imageProvider('openai')!)   // => 'WORK_KEY'
 */
export function credentialEnvVar(store: Store, provider: ImageProvider): string | null {

  if (!provider.needsCredential) { return null; }

  return textOr(readConfig(store, providerApiKeyEnvKey(provider.id)))
      ?? textOr(readConfig(store, IMAGE_API_KEY_ENV_KEY))
      ?? provider.defaultEnvVar;

}

/**
 * Read the image configuration.
 *
 * Takes no environment, and therefore cannot read a credential — the missing parameter
 * is the point of the signature, not an oversight. Readers are tolerant in the house
 * pattern: a malformed or unknown row behaves as unset.
 *
 * @param store - the shared log store the `config` table lives in
 *
 * @example
 *   imageConfig(store)
 *   // => { enabled: false, provider: <nanobanana>, credentialEnvVar: 'GEMINI_API_KEY', … }
 */
export function imageConfig(store: Store): ImageConfig {

  const named    = textOr(readConfig(store, IMAGE_PROVIDER_KEY)),
        provider = (named === null ? undefined : imageProvider(named)) ?? DEFAULT_IMAGE_PROVIDER;

  const wanted = textOr(readConfig(store, IMAGE_MODEL_KEY)),
        model  = wanted !== null && provider.models.includes(wanted) ? wanted : provider.defaultModel;

  return {
    enabled          : readConfig(store, IMAGE_ENABLED_KEY) === 'true',
    provider,
    model,
    sessionCap       : intOr(readConfig(store, IMAGE_SESSION_CAP_KEY), DEFAULT_SESSION_CAP,     0, 1000),
    dailyCap         : intOr(readConfig(store, IMAGE_DAILY_CAP_KEY),   DEFAULT_DAILY_CAP,       0, 10000),
    timeoutSeconds   : intOr(readConfig(store, IMAGE_TIMEOUT_KEY),     DEFAULT_TIMEOUT_SECONDS, 5, 900),
    localBaseUrl     : textOr(readConfig(store, IMAGE_LOCAL_BASE_URL_KEY)) ?? DEFAULT_LOCAL_BASE_URL,
    credentialEnvVar : credentialEnvVar(store, provider),
  };

}

/**
 * What is known about the credential right now.
 *
 * `value` is live and must be treated as radioactive: it is passed to
 * {@link ImageProvider.plan} and to the scrubber, and to nothing else — never a
 * ledger row, never a config row, never a reply, never a temp file.
 */
export interface CredentialState {
  /** Whether the active provider needs a credential at all. */
  readonly needed  : boolean;
  /** The variable consulted; `null` when none is needed. Printable. */
  readonly envVar  : string | null;
  /** Whether that variable held something usable. */
  readonly present : boolean;
  /** The credential, or `null`. Never stored, never rendered. */
  readonly value   : string | null;
}

/**
 * Resolve the credential from the environment — at call time, and at no other time.
 *
 * This is the whole of the facility's contact with the secret. It is called from the
 * enablement check (which discards `value` immediately and keeps only `present`) and
 * once per generation attempt.
 *
 * @param config - the configuration naming the variable
 * @param env    - the environment to read; injectable so tests never touch the real one
 * @returns whether a credential is needed, which variable was consulted, whether it
 *          held anything, and the value itself for immediate use
 *
 * @example
 *   resolveCredential(config, { GEMINI_API_KEY: 'AIza…' })
 *   // => { needed: true, envVar: 'GEMINI_API_KEY', present: true, value: 'AIza…' }
 *   resolveCredential(config, {})
 *   // => { needed: true, envVar: 'GEMINI_API_KEY', present: false, value: null }
 */
export function resolveCredential(
  config : ImageConfig,
  env    : Record<string, string | undefined> = process.env,
): CredentialState {

  if (!config.provider.needsCredential || config.credentialEnvVar === null) {
    return { needed: false, envVar: null, present: true, value: null };
  }

  const raw = env[config.credentialEnvVar]?.trim() ?? '';

  return raw === ''
    ? { needed: true, envVar: config.credentialEnvVar, present: false, value: null }
    : { needed: true, envVar: config.credentialEnvVar, present: true,  value: raw };

}

/**
 * Whether the credential is usable, without ever holding onto the credential.
 *
 * Exists so the enablement check and the startup warning can ask their question
 * without a credential value ever entering a variable that outlives the expression.
 *
 * @example
 *   credentialAvailable(config, { GEMINI_API_KEY: 'AIza…' })  // => true
 */
export function credentialAvailable(
  config : ImageConfig,
  env    : Record<string, string | undefined> = process.env,
): boolean {
  return resolveCredential(config, env).present;
}
