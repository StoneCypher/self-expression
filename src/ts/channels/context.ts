/**
 * The bridge between the hooks and the server.
 *
 * These are two processes that cannot see each other. A hook knows the session, the
 * turn, the working directory, the permission mode and the effort level — and cannot
 * write an expression. The server can write expressions — and knows none of that.
 * Neither is fixable alone.
 *
 * So the hook deposits what it observes, and the server reads it back when recording.
 * The effect is that session identity stops being something the model derives by
 * string-parsing its own scratchpad path, which is how the previous implementation had
 * to do it and the most fragile field in that schema.
 *
 * @see ./entries.js
 */

import { stamp }      from './time.js';
import type { Store } from './store.js';

/** What a hook observed about the turn it fired on. */
export interface TurnContext {
  readonly session          : string;
  readonly promptId?        : string | undefined;
  readonly turnIndex?       : number | undefined;
  readonly turn?            : string | undefined;
  readonly cwd?             : string | undefined;
  readonly gitBranch?       : string | undefined;
  readonly permissionMode?  : string | undefined;
  readonly agentId?         : string | undefined;
  readonly agentType?       : string | undefined;
  readonly effort?          : string | undefined;
  readonly compactions?     : number | undefined;
  readonly promptLen?       : number | undefined;
}

/**
 * Record what a hook observed, so a later tool call can adopt it.
 *
 * Rows accumulate rather than replacing one another. Two concurrent sessions would
 * otherwise overwrite each other's context, and a turn's observed state is worth
 * keeping for later inspection anyway.
 *
 * @example
 *   recordContext(store, { session: 'abc', promptId: 'p1', effort: 'high' });
 */
export function recordContext(store: Store, context: TurnContext, when: Date = new Date()): void {

  store.db.prepare(`
    INSERT INTO turn_context (
      ts_utc, session, prompt_id, turn_index, turn, cwd, git_branch,
      permission_mode, agent_id, agent_type, effort, compactions, prompt_len
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    stamp(when).utc,
    context.session,
    context.promptId       ?? null,
    context.turnIndex      ?? null,
    context.turn           ?? null,
    context.cwd            ?? null,
    context.gitBranch      ?? null,
    context.permissionMode ?? null,
    context.agentId        ?? null,
    context.agentType      ?? null,
    context.effort         ?? null,
    context.compactions    ?? null,
    context.promptLen      ?? null,
  );

}

/**
 * The most recently observed turn context, or `null` when no hook has run.
 *
 * When `session` is given, the newest context for that session is returned; otherwise
 * the newest of any session. The unscoped form is what a tool call uses to discover
 * which session it is in — the server has no other way to know, since neither the MCP
 * handshake nor any tool argument carries it.
 *
 * That unscoped lookup is exact for a single active session and a best guess when two
 * run concurrently against one database. The mitigation is that a caller supplying its
 * own session is always believed; this only fills what was not supplied.
 *
 * @example
 *   latestContext(store)          // => { session: 'abc', promptId: 'p1', … }
 *   latestContext(store, 'zzz')   // => null, when that session has no context
 */
export function latestContext(store: Store, session?: string): Record<string, unknown> | null {

  const row = session === undefined
    ? store.db.prepare('SELECT * FROM turn_context ORDER BY id DESC LIMIT 1').get()
    : store.db.prepare('SELECT * FROM turn_context WHERE session = ? ORDER BY id DESC LIMIT 1').get(session);

  return row ?? null;

}

/**
 * How many turns this session has recorded context for, which is the turn index.
 *
 * Derived rather than tracked, so a restarted hook process cannot lose the count.
 *
 * @example
 *   turnCount(store, 'abc')  // => 12
 */
export function turnCount(store: Store, session: string): number {
  const row = store.db.prepare(
    'SELECT COUNT(*) AS n FROM turn_context WHERE session = ?').get(session);
  return Number(row?.['n'] ?? 0);
}
