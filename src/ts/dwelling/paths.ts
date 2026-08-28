/**
 * Where a dwelling lives, and why the plugin never decides that itself.
 *
 * `dwelling.path` names a **directory**, chosen by the user with no default — disk and
 * drive choice are genuinely the user's information, and a dwelling that appears
 * unbidden in a dotdir is furniture nobody chose. The database file inside it is always
 * `dwelling.sqlite3`, leaving room for sidecars (a pre-adoption backup, a future
 * export) without a second config key.
 *
 * The plugin creates the *file*, never the *directory*: silently creating
 * `D:\dwleling` would hide a typo forever, while refusing it surfaces the typo
 * immediately.
 *
 * @see ../channels/paths.js
 * @see ./config.js
 */

import { statSync }         from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Filename of the SQLite database inside the user-chosen dwelling directory. */
export const DWELLING_DB_FILE = 'dwelling.sqlite3';

/**
 * Whether `path` names an existing directory. Never throws — a missing or unreadable
 * path simply is not a directory.
 *
 * @example
 *   directoryExists('/tmp')          // => true (on POSIX)
 *   directoryExists('/no/such/dir')  // => false
 */
export function directoryExists(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/**
 * Validate a candidate `dwelling.path`, returning an error message or `null` when it
 * is acceptable.
 *
 * Accepted: an absolute path to a directory that already exists. `dirExists` is
 * injectable so the rules can be tested without touching the real filesystem.
 *
 * @param dir - the candidate directory path, exactly as the user supplied it
 * @returns `null` when valid; otherwise text naming what would have been accepted
 *
 * @example
 *   validateDwellingDir('D:\\claude', () => true)   // => null
 *   validateDwellingDir('claude',     () => true)   // => 'error: dwelling.path must be absolute ...'
 */
export function validateDwellingDir(
  dir       : string,
  dirExists : (p: string) => boolean = directoryExists,
): string | null {

  if (dir.trim() === '') {
    return 'error: dwelling.path must be an absolute path to an existing directory; an empty value is not accepted';
  }

  if (!isAbsolute(dir)) {
    return `error: dwelling.path must be absolute; '${dir}' is relative. An absolute path to an existing directory would be accepted`;
  }

  if (!dirExists(dir)) {
    return `error: dwelling.path directory '${dir}' does not exist. The plugin creates the database file but never the directory, so a typo is refused rather than hidden — create the directory first, or correct the path`;
  }

  return null;

}

/**
 * Full path to the dwelling database inside a validated directory.
 *
 * @example
 *   dwellingDbPath('D:\\claude')  // => 'D:\\claude\\dwelling.sqlite3'
 */
export function dwellingDbPath(dir: string): string {
  return join(dir, DWELLING_DB_FILE);
}
