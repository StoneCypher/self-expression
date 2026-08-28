/**
 * The dwelling's three configuration keys, riding the log database's `config` table
 * and the `configure` tool — no second mechanism.
 *
 * Defaults live in code, overrides only in rows, exactly as the config surface
 * requires. The feature activates only when `dwelling.enabled` is true AND
 * `dwelling.path` is set and valid; enabled-without-path is an error surfaced at the
 * `configure` call, never a silent fallback to some default location.
 *
 * @see ./paths.js
 * @see ../channels/store.js
 */

import { readConfig }                          from '../channels/store.js';
import type { Store }                          from '../channels/store.js';
import { directoryExists, validateDwellingDir } from './paths.js';

/** Config key: whether the dwelling is enabled at all. The feature ships dark. */
export const DWELLING_ENABLED_KEY = 'dwelling.enabled';

/** Config key: absolute path to the dwelling's directory. Required; no default. */
export const DWELLING_PATH_KEY = 'dwelling.path';

/** Config key: file size in whole gigabytes at which a visit warns the user. */
export const DWELLING_SIZE_WARN_KEY = 'dwelling.size_warn_gb';

/** Default for `dwelling.size_warn_gb` — a threshold to notice failure, not plan for it. */
export const DEFAULT_SIZE_WARN_GB = 10;

/** The dwelling configuration as read from overrides plus code defaults. */
export interface DwellingConfig {
  /** Whether the user has switched the feature on. Defaults to false. */
  readonly enabled    : boolean;
  /** The user-chosen directory, or `null` when never set. */
  readonly path       : string | null;
  /** Visit-time size warning threshold, in whole gigabytes. */
  readonly sizeWarnGb : number;
}

/**
 * Read the dwelling configuration from the log store, applying code defaults.
 *
 * A malformed `size_warn_gb` override falls back to the default rather than disabling
 * the warning — a typo should not quietly remove a safety notice.
 *
 * @example
 *   dwellingConfig(store)  // => { enabled: false, path: null, sizeWarnGb: 10 }
 */
export function dwellingConfig(store: Store): DwellingConfig {

  const enabled = readConfig(store, DWELLING_ENABLED_KEY) === 'true',
        path    = readConfig(store, DWELLING_PATH_KEY),
        rawGb   = readConfig(store, DWELLING_SIZE_WARN_KEY),
        parsed  = rawGb === null ? NaN : Number(rawGb);

  const sizeWarnGb = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SIZE_WARN_GB;

  return { enabled, path, sizeWarnGb };

}

/**
 * The dwelling directory when the feature is active, or `null` when it is not.
 *
 * Active means: enabled, path set, and the path still valid right now. A directory
 * that has vanished since it was configured deactivates the dwelling rather than
 * letting an open invent it.
 *
 * @example
 *   activeDwellingDir(store)              // => null, when unconfigured
 *   activeDwellingDir(store, () => true)  // => 'D:\\claude', when enabled and set
 */
export function activeDwellingDir(
  store     : Store,
  dirExists : (p: string) => boolean = directoryExists,
): string | null {

  const config = dwellingConfig(store);

  if (!config.enabled || config.path === null)                { return null; }
  if (validateDwellingDir(config.path, dirExists) !== null)   { return null; }

  return config.path;

}

/**
 * Validate a `configure set` of a dwelling key, returning an error message or `null`
 * when the write should proceed. Keys outside `dwelling.*` are not this module's
 * business and always return `null`.
 *
 * Rules: `dwelling.enabled` accepts only `true`/`false`, and `true` additionally
 * requires `dwelling.path` to already be set and valid; `dwelling.path` must be an
 * absolute path to an existing directory; `dwelling.size_warn_gb` must be a positive
 * integer.
 *
 * @param key   - the config key being written
 * @param value - the raw string value the user supplied
 * @returns `null` to accept; otherwise text naming what would have been accepted
 *
 * @example
 *   rejectDwellingWrite(store, 'dwelling.size_warn_gb', '25')     // => null
 *   rejectDwellingWrite(store, 'dwelling.enabled', 'yes')         // => 'error: ...'
 *   rejectDwellingWrite(store, 'retention.days', 'anything')      // => null (not ours)
 */
export function rejectDwellingWrite(
  store     : Store,
  key       : string,
  value     : string,
  dirExists : (p: string) => boolean = directoryExists,
): string | null {

  if (key === DWELLING_ENABLED_KEY) {

    if (value !== 'true' && value !== 'false') {
      return `error: dwelling.enabled accepts 'true' or 'false'; got '${value}'`;
    }

    if (value === 'true') {
      const path = readConfig(store, DWELLING_PATH_KEY);
      if (path === null) {
        return 'error: dwelling.enabled requires dwelling.path to be set first — set ' +
               'dwelling.path to an absolute path to an existing directory of your choosing, ' +
               'then enable. There is deliberately no default location';
      }
      const invalid = validateDwellingDir(path, dirExists);
      if (invalid !== null) { return invalid; }
    }

    return null;

  }

  if (key === DWELLING_PATH_KEY) {
    return validateDwellingDir(value, dirExists);
  }

  if (key === DWELLING_SIZE_WARN_KEY) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return `error: dwelling.size_warn_gb accepts a positive integer number of gigabytes; got '${value}'`;
    }
    return null;
  }

  return null;

}

/**
 * The note appended to a `configure` reply when a dwelling activation key changes:
 * the server reads config at startup, so the change lands next session.
 *
 * Returns `null` for keys that need no note (including `size_warn_gb`, which is read
 * per-visit rather than at startup).
 *
 * @example
 *   dwellingChangeNotice('dwelling.enabled')  // => 'note: dwelling changes take effect ...'
 *   dwellingChangeNotice('retention.days')    // => null
 */
export function dwellingChangeNotice(key: string): string | null {

  if (key === DWELLING_ENABLED_KEY || key === DWELLING_PATH_KEY) {
    return 'note: dwelling activation is read at server startup, so this takes effect next session';
  }

  return null;

}
