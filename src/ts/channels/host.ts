/**
 * Which Claude Code host process a hook or a server is running under (issue #130).
 *
 * Several sessions can share one store, and until this module the MCP server had no way
 * to tell which of them it belonged to. So an `express` call that named no session was
 * stamped with the newest turn of *any* session. The Stop gate checks the exact
 * (session, prompt_id) pair, so it then refused a turn that had in fact signed off, and
 * the misfiled row went on to pollute every per-session read.
 *
 * The fix is to name the host. Each session runs one host process. That host launches
 * the session's MCP server and runs its hooks, so its pid is the one fact both sides can
 * observe without trusting the model:
 *
 * - **The hook** reads `CLAUDE_PID`. Claude Code puts the host's pid there for hook
 *   commands, which saves walking the process tree on every turn. When it is absent (an
 *   older host, or another harness), the hook falls back to its own parent pid, which is
 *   the host whenever the hook command is spawned directly and not through a shell.
 * - **The server** uses its own parent pid, and deliberately *not* `CLAUDE_PID`. The
 *   host does not set that variable for MCP servers, so a server inherits whatever an
 *   enclosing session left in the environment. A probe of a nested `claude -p` showed the
 *   server seeing the *outer* host's pid there, while its parent pid was its real host.
 *   The server also keeps `CLAUDE_CODE_SESSION_ID`, the session it was launched into, as
 *   a second-choice scope for when no pid-matched row exists yet.
 *
 * A pid is only unique among live processes. So a server matches a row by pid only when
 * the row is newer than the server itself ({@link HostIdentity.since}). A dead host that
 * once had the same pid wrote its rows before this server started.
 *
 * @see ./context.js latestContext
 * @see ./store.js Store
 */

import { stamp }      from './time.js';
import type { Store } from './store.js';

/**
 * What one process knows about the Claude Code host it runs under. Every field is `null`
 * when the process could not learn it, and each `null` just skips that rung of the
 * lookup in {@link ./context.js latestContext}.
 */
export interface HostIdentity {
  /** The host process's pid, or `null` when it could not be determined. */
  readonly pid     : number | null;
  /**
   * The earliest `ts_utc` a row may carry and still be matched by {@link pid}, as an ISO
   * string. It is the server's own start time, which guards against a reused pid. `null`
   * means no recency guard at all, which is what the hook uses: the hook scopes by pid
   * only when the payload carried no session, and it never needs the guard.
   */
  readonly since   : string | null;
  /** The session the host said it was running when it launched this process, if any. */
  readonly session : string | null;
}

/** A host identity that knows nothing, so every lookup falls back to the old global one. */
export const UNKNOWN_HOST: HostIdentity = Object.freeze({ pid: null, since: null, session: null });

/**
 * A pid as a positive integer, or `null` when the value cannot name a real host.
 *
 * Pids 0 and 1 are rejected as well as garbage. A POSIX process whose parent died is
 * re-parented to pid 1 (init or launchd), and on Windows pid 0 is the idle process. A
 * row stamped with either would match every other orphan, which is the misfiling this
 * module exists to prevent.
 *
 * @param raw a pid from the environment (a string) or from `process.ppid` (a number)
 * @returns the pid, or `null` when it is absent, non-numeric, non-integral, or at most 1
 *
 * @example
 *   validPid('39700')   // => 39700
 *   validPid(1)         // => null (orphaned to init)
 *   validPid('abc')     // => null
 */
export function validPid(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === '') { return null; }
  const pid = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/**
 * The host pid a hook process runs under. It is `CLAUDE_PID` when the host set it, and
 * otherwise the hook's own parent pid.
 *
 * This reads only the environment and one number, with no process-tree walk, so it adds
 * nothing measurable to a hook that runs on every turn. Walking the tree would cost a
 * process spawn on Windows (tens to hundreds of milliseconds), and nothing needs it:
 * current hosts set `CLAUDE_PID`, and the fallback is right whenever the hook command
 * is spawned directly, which is how this plugin's `hooks.claude.json` launches it.
 *
 * @param env  the hook's environment
 * @param ppid the hook's parent pid, used only when `CLAUDE_PID` is absent or unusable
 *
 * @example
 *   hookHostPid({ CLAUDE_PID: '54736' }, 36732)   // => 54736
 *   hookHostPid({}, 36732)                        // => 36732
 *   hookHostPid({}, 1)                            // => null
 */
export function hookHostPid(env: Readonly<Record<string, string | undefined>>, ppid: number): number | null {
  return validPid(env['CLAUDE_PID']) ?? validPid(ppid);
}

/**
 * The host identity a hook process runs with: the pid from {@link hookHostPid}, with no
 * recency guard and no session.
 *
 * The hook's payload names its session, so the pid serves two purposes. The hook stamps
 * it on the rows it writes, and it scopes the one read that can happen without a
 * session: a `Stop` payload that carries no `session_id`.
 *
 * @param env  the hook's environment
 * @param ppid the hook's parent pid
 *
 * @example
 *   hookHostIdentity({ CLAUDE_PID: '54736' }, 36732)   // => { pid: 54736, since: null, session: null }
 */
export function hookHostIdentity(
  env  : Readonly<Record<string, string | undefined>>,
  ppid : number,
): HostIdentity {
  return { pid: hookHostPid(env, ppid), since: null, session: null };
}

/**
 * The host identity an MCP server runs with: its parent pid, its own start time as the
 * pid-reuse guard, and the session it was launched into.
 *
 * `CLAUDE_PID` is ignored here on purpose; the module header explains why. The session
 * from `CLAUDE_CODE_SESSION_ID` goes stale after a `/clear`, because the host keeps the
 * same server running under a new session id. That is why it is only the second rung of
 * the lookup: rows the hook stamps with this host's pid carry the new session and take
 * precedence.
 *
 * @param env     the server's environment
 * @param ppid    the server's parent pid, which is the host when the host spawns it directly
 * @param started when the server started; rows older than this never match by pid
 *
 * @example
 *   serverHostIdentity({ CLAUDE_CODE_SESSION_ID: 'eae8…' }, 54736, new Date('2026-09-26T10:00:00Z'))
 *   // => { pid: 54736, since: '2026-09-26T10:00:00.000Z', session: 'eae8…' }
 */
export function serverHostIdentity(
  env     : Readonly<Record<string, string | undefined>>,
  ppid    : number,
  started : Date,
): HostIdentity {
  const session = env['CLAUDE_CODE_SESSION_ID'];
  return {
    pid     : validPid(ppid),
    since   : stamp(started).utc,
    session : session === undefined || session === '' ? null : session,
  };
}

/**
 * The same store with a host identity attached. The database handle is shared, not
 * reopened, so closing either copy closes both.
 *
 * The identity rides on the store because the store is already threaded through every
 * tool and hook handler. A separate parameter would have had to be added to dozens of
 * signatures to reach the handful of lookups that use it.
 *
 * @example
 *   const store = withHost(openStore(), serverHostIdentity(process.env, process.ppid, new Date()));
 *
 * @see ./context.js latestContext
 */
export function withHost(store: Store, host: HostIdentity): Store {
  return { ...store, host };
}
