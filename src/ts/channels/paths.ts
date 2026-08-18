/**
 * Where the log lives, and how that location is decided.
 *
 * This is the one setting that cannot live in the database, because it is how the
 * database is found. Everything else is config; this is bootstrap.
 *
 * Deliberately host-neutral. Claude Code offers `${CLAUDE_PLUGIN_DATA}` under
 * `~/.claude/`, which would be exactly right for a Claude-only plugin — but this one
 * also runs under Codex and Gemini, and a Claude-specific path would mean each host
 * writing to a different place. The record would fragment by host, destroying the
 * continuity that is the entire point of keeping it.
 *
 * An environment variable needs no host cooperation at all: every host's MCP
 * registration accepts an `env` block, and a user can override it from any shell.
 *
 * @see ../../doc_md/plugin-layout.md
 */

import { homedir } from 'node:os';
import { join }    from 'node:path';

/** The environment variable that relocates the whole data directory. */
export const HOME_VAR = 'SELF_EXPRESSION_HOME';

/** Directory name used under the user's home when the variable is unset. */
export const DEFAULT_DIR = '.self-expression';

/** Filename of the SQLite database inside the data directory. */
export const DB_FILE = 'log.sqlite3';

/**
 * The data directory, honouring `SELF_EXPRESSION_HOME` and otherwise defaulting to
 * `~/.self-expression`.
 *
 * `env` and `home` are injectable so the resolution rules can be tested without
 * touching the real environment or the real home directory. A variable set to an
 * empty or whitespace-only string is treated as unset rather than as a request to
 * write to the filesystem root, which is the more likely intent and the safer reading.
 *
 * A dotdir in home matches the convention every agent tool in this space already uses
 * — `~/.claude`, `~/.codex`, `~/.gemini` — and `os.homedir()` resolves it correctly on
 * Windows without any platform branching.
 *
 * @example
 *   dataDir({}, '/Users/ada')                              // => '/Users/ada/.self-expression'
 *   dataDir({ SELF_EXPRESSION_HOME: '/tmp/x' }, '/h')      // => '/tmp/x'
 *   dataDir({ SELF_EXPRESSION_HOME: '   ' }, '/Users/ada') // => '/Users/ada/.self-expression'
 */
export function dataDir(
  env  : Record<string, string | undefined> = process.env,
  home : string                             = homedir(),
): string {

  const override = env[HOME_VAR];

  if (typeof override === 'string' && override.trim() !== '') { return override; }

  return join(home, DEFAULT_DIR);

}

/**
 * Full path to the SQLite database.
 *
 * @example
 *   dbPath({}, '/Users/ada')  // => '/Users/ada/.self-expression/log.sqlite3'
 */
export function dbPath(
  env  : Record<string, string | undefined> = process.env,
  home : string                             = homedir(),
): string {
  return join(dataDir(env, home), DB_FILE);
}
