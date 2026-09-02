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
 * ## Which names may be given, and which endpoints dialled
 *
 * `configure` is a tool the **model** can call, so "the user names the variable" is
 * only true if nothing else can name one usefully. {@link credentialEnvVarProblem}
 * bounds what a name may be — a credential-shaped name, never a famous secret
 * belonging to some other vendor — and {@link localBaseUrlProblem} bounds where the
 * local provider may post, to loopback and the private ranges. Both are enforced twice:
 * at `configure set` time by the registry, and again here at read time, so a row
 * written before the rule existed cannot be honoured by being old.
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

// ---------------------------------------------------------------------------------
// Which variables may be named, and which endpoints may be dialled
//
// Both rules below exist because `configure` is a **model-callable** tool. A key that
// accepts any string is a key the model can point anywhere, and these two point at the
// two things that leave the machine: a secret, and a prompt.
// ---------------------------------------------------------------------------------

/**
 * The shape a credential variable's name must have: SCREAMING_SNAKE_CASE, three to
 * 128 characters, starting with a letter.
 *
 * Not cosmetic. A value that is not shaped like an environment variable name is
 * evidence that something other than a name was pasted into a key documented to hold
 * one — a key with spaces in it, a lowercase word, a URL — and the honest answer to
 * that is a rejection naming what was expected, not a lookup that quietly misses.
 */
export const CREDENTIAL_ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;

/**
 * Variable names that famously hold a credential for something that is **not** an
 * image provider, and are refused outright.
 *
 * The hazard is worth stating plainly, because nothing about the resulting request
 * would look wrong: `configure set image.api_key_env ANTHROPIC_API_KEY` followed by
 * `configure set image.provider openai` sends one vendor's secret to another vendor's
 * endpoint in an `authorization: Bearer` header, on a tool the model can call by
 * itself. `PATH`, `HOME` and `USERPROFILE` are here for the same reason in a smaller
 * way: they are not secrets, but they are not credentials either, and shipping the
 * user's home directory to a third party is nobody's intent.
 *
 * @see CREDENTIAL_ENV_DENIED_PREFIXES
 * @see credentialEnvVarProblem
 */
export const CREDENTIAL_ENV_DENYLIST: readonly string[] = [
  'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'PATH', 'HOME', 'USERPROFILE',
];

/**
 * Name prefixes whose whole family is refused, because the family is a credential
 * estate rather than one image key: Azure's service credentials and everything SSH.
 */
export const CREDENTIAL_ENV_DENIED_PREFIXES: readonly string[] = ['AZURE_', 'SSH_'];

/** Suffixes that mark a name as naming a key rather than naming something else. */
export const CREDENTIAL_ENV_ALLOWED_SUFFIXES: readonly string[] = ['_API_KEY', '_KEY', '_TOKEN'];

/**
 * Prefixes that exempt a name from the suffix rule, so this facility's own variables
 * and a user's deliberately image-scoped ones need no particular ending.
 */
export const CREDENTIAL_ENV_ALLOWED_PREFIXES: readonly string[] = ['IMAGE_', 'SELF_EXPRESSION_'];

/**
 * Why a proposed credential-variable name is not acceptable, or `null` when it is.
 *
 * A problem string rather than a boolean because both callers need the sentence: the
 * `configure` validator prints it as what would have been accepted, and the tolerant
 * reader uses only its presence. Written in the registry's voice — what was expected,
 * never a bare "no".
 *
 * @param name - the proposed variable name; trimmed here, so callers need not
 * @returns the reason it is refused, or `null` when the name may be used
 *
 * @example
 *   credentialEnvVarProblem('OPENAI_API_KEY')     // => null
 *   credentialEnvVarProblem('IMAGE_LOCAL_TOKEN')  // => null
 *   credentialEnvVarProblem('ANTHROPIC_API_KEY')  // => 'a name other than ANTHROPIC_API_KEY, …'
 *   credentialEnvVarProblem('my key')             // => 'an environment variable NAME in …'
 *
 * @see credentialEnvVarAllowed
 */
export function credentialEnvVarProblem(name: string): string | null {

  const trimmed = name.trim();

  if (!CREDENTIAL_ENV_NAME_PATTERN.test(trimmed)) {
    return 'an environment variable NAME in SCREAMING_SNAKE_CASE — letters, digits and ' +
           'underscores, starting with a letter, 3 to 128 characters. This key holds the ' +
           'name of a variable, never a credential';
  }

  if (CREDENTIAL_ENV_DENYLIST.includes(trimmed)) {
    return `a name other than ${trimmed}, which holds a credential for something that is not ` +
           'an image provider; naming it here would send that secret to an image vendor in an ' +
           'authorization header';
  }

  const denied = CREDENTIAL_ENV_DENIED_PREFIXES.find(prefix => trimmed.startsWith(prefix));

  if (denied !== undefined) {
    return `a name not starting with ${denied}, because that family holds credentials for ` +
           'something that is not an image provider';
  }

  const namesAKey = CREDENTIAL_ENV_ALLOWED_SUFFIXES.some(suffix => trimmed.endsWith(suffix))
                 || CREDENTIAL_ENV_ALLOWED_PREFIXES.some(prefix => trimmed.startsWith(prefix));

  return namesAKey ? null
    : `a name ending in ${CREDENTIAL_ENV_ALLOWED_SUFFIXES.join(', ')} or starting with ` +
      `${CREDENTIAL_ENV_ALLOWED_PREFIXES.join(' or ')}, so that what is named is recognisably ` +
      'an image credential and not some other variable that happens to be in the environment';

}

/**
 * Whether a name may be used as a credential variable at all.
 *
 * @example
 *   credentialEnvVarAllowed('GEMINI_API_KEY')  // => true
 *   credentialEnvVarAllowed('PATH')            // => false
 */
export function credentialEnvVarAllowed(name: string): boolean {
  return credentialEnvVarProblem(name) === null;
}

/** The four dotted decimal octets of an IPv4 literal, or `null` for anything else. */
function ipv4Octets(host: string): number[] | null {

  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { return null; }

  const octets = host.split('.').map(Number);

  return octets.every(octet => octet <= 255) ? octets : null;

}

/**
 * Whether a hostname is loopback or a private-network address — the only hosts the
 * local provider is allowed to post to.
 *
 * Literals only, and deliberately: a name is not resolved, so `images.example.com`
 * is refused rather than looked up. Resolution would make the answer depend on DNS at
 * the moment of the check, which is exactly the property a security boundary must not
 * have.
 *
 * @param host - a URL hostname; IPv6 brackets are tolerated
 *
 * @example
 *   isLoopbackOrPrivateHost('127.0.0.1')    // => true
 *   isLoopbackOrPrivateHost('192.168.1.9')  // => true
 *   isLoopbackOrPrivateHost('[::1]')        // => true
 *   isLoopbackOrPrivateHost('example.com')  // => false
 */
export function isLoopbackOrPrivateHost(host: string): boolean {

  const name = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

  if (name === 'localhost' || name.endsWith('.localhost')) { return true; }
  if (name === '::1' || name === '0:0:0:0:0:0:0:1')        { return true; }

  const octets = ipv4Octets(name);

  if (octets === null) { return false; }

  const [first = -1, second = -1] = octets;

  return first === 127                                  // 127/8, loopback
      || first === 10                                   // 10/8
      || (first === 172 && second >= 16 && second <= 31) // 172.16/12
      || (first === 192 && second === 168);             // 192.168/16

}

/**
 * Why a proposed local endpoint is not acceptable, or `null` when it is.
 *
 * The `automatic1111` provider posts the user's prompt to this URL with no credential
 * and no cost accounting, on the stated understanding that the endpoint is the user's
 * own machine. An arbitrary host in this key turns "a local model" into "an
 * unaccounted third party receiving every prompt", which is the one thing the whole
 * facility is arranged to make impossible, so it is checked rather than assumed.
 *
 * @param raw - the proposed base URL
 * @returns the reason it is refused, or `null` when it may be used
 *
 * @example
 *   localBaseUrlProblem('http://127.0.0.1:7860')  // => null
 *   localBaseUrlProblem('https://evil.example')   // => 'a loopback or private-network host …'
 *
 * @see isLoopbackOrPrivateHost
 */
export function localBaseUrlProblem(raw: string): string | null {

  const trimmed = raw.trim();

  let url: URL;

  try { url = new URL(trimmed); }
  catch { return "an absolute http:// or https:// URL, for example 'http://127.0.0.1:7860'"; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `an http:// or https:// URL; ${url.protocol}// is not a scheme this facility posts to`;
  }

  if (url.username !== '' || url.password !== '') {
    return 'a URL carrying no userinfo — a secret in a URL is a secret in the one part of a ' +
           'request that everything logs';
  }

  return isLoopbackOrPrivateHost(url.hostname) ? null
    : 'a loopback or private-network host (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x, ' +
      `::1); ${url.hostname} is a remote host, and the local provider would send the user’s ` +
      'prompt to it with no credential, no cost accounting, and no vendor relationship';

}

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
 * A stored credential-variable name, or `null` when it is absent, blank, or a name
 * this facility will not read a credential from.
 *
 * The check is repeated here rather than trusted from `configure set` on purpose: a
 * row written before the validator existed, or edited into the database by hand, must
 * not be honoured just because it is stored. Readers are tolerant in the house style,
 * so a refused name behaves as unset and the next rule applies.
 */
function namedVar(raw: string | null): string | null {
  const trimmed = textOr(raw);
  return trimmed !== null && credentialEnvVarAllowed(trimmed) ? trimmed : null;
}

/** A stored local endpoint, or `null` when it is absent, blank, or not a local host. */
function localUrlOr(raw: string | null): string | null {
  const trimmed = textOr(raw);
  return trimmed !== null && localBaseUrlProblem(trimmed) === null ? trimmed : null;
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

  return namedVar(readConfig(store, providerApiKeyEnvKey(provider.id)))
      ?? namedVar(readConfig(store, IMAGE_API_KEY_ENV_KEY))
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
    localBaseUrl     : localUrlOr(readConfig(store, IMAGE_LOCAL_BASE_URL_KEY)) ?? DEFAULT_LOCAL_BASE_URL,
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
