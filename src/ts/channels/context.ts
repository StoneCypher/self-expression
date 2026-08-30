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
 * **Not every host has hooks.** Claude Code fires `UserPromptSubmit`; a bare MCP client
 * fires nothing, and on such a host every row above would carry `no-hook` for a session
 * and NULL for everything else. So there is a second door — the `begin_turn` tool, by
 * which the model *volunteers* what a hook would have observed — and it comes through
 * this same module, writing through {@link recordContext} with `source: 'tool'`. Two
 * doors, one writer, one shape; the `source` column is what keeps the evidentiary
 * difference between them readable rather than lost.
 *
 * When neither door was used, the read surfaces say {@link UNKNOWN_CONTEXT} rather than
 * `null`. A silent null reads as "nothing was happening"; the whole point is that
 * something was happening and this host does not report it.
 *
 * @see ./entries.js
 * @see ../mcp/tools.js handleBeginTurn
 */

import { stamp }               from './time.js';
import type { Store }          from './store.js';
import type { ContextSource }  from './vocabulary.js';

/** What a hook observed — or a hookless host's model volunteered — about one turn. */
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
  /**
   * Which path deposited this row: `'hook'` when the harness observed the turn, `'tool'`
   * when the model volunteered it. Optional only so pre-existing callers keep compiling;
   * both real writers state it, and a row that omits it stores NULL rather than a guess.
   */
  readonly source?          : ContextSource | undefined;
}

/**
 * Record what a hook observed, so a later tool call can adopt it.
 *
 * Rows accumulate rather than replacing one another. Two concurrent sessions would
 * otherwise overwrite each other's context, and a turn's observed state is worth
 * keeping for later inspection anyway.
 *
 * **This is the only `INSERT` into `turn_context` in the system**, and it must stay that
 * way. `begin_turn` — the hookless host's way of volunteering the same facts — routes
 * through here rather than writing its own row, so the two paths cannot drift into two
 * shapes; they differ only in the `source` value they pass.
 *
 * @param context what was observed or volunteered, including which of the two it was
 * @param when    the moment to stamp; injectable so tests need no clock
 *
 * @example
 *   recordContext(store, { session: 'abc', promptId: 'p1', effort: 'high', source: 'hook' });
 *
 * @see recordContextOnce
 * @see ../mcp/tools.js handleBeginTurn
 */
export function recordContext(store: Store, context: TurnContext, when: Date = new Date()): void {

  store.db.prepare(`
    INSERT INTO turn_context (
      ts_utc, session, prompt_id, turn_index, turn, cwd, git_branch,
      permission_mode, agent_id, agent_type, effort, compactions, prompt_len, source
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
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
    context.source         ?? null,
  );

}

/**
 * The row already recorded for one turn of one session, or `null` when the turn is new.
 *
 * The turn's identity is the pair (`session`, `prompt_id`) — the same pair
 * {@link ../channels/entries.js hasClosingSignature} and the Stop gate treat as "this
 * turn" — so this is the exact question "has this turn already been recorded?", answered
 * by lookup rather than by a freshness window.
 *
 * An empty `promptId` is not an identity and never matches: a turn with no id cannot be
 * recognised on a second call, so the honest answer is `null` rather than the newest row
 * that happens to share a session.
 *
 * @param session  the session the turn belongs to
 * @param promptId the turn identifier; empty or absent means "no identity", never a match
 *
 * @example
 *   contextForTurn(store, 'abc', 'p1')   // => null before begin_turn, the row after
 *
 * @see recordContextOnce
 */
export function contextForTurn(
  store    : Store,
  session  : string,
  promptId : string | undefined,
): Record<string, unknown> | null {

  if (promptId === undefined || promptId === '') { return null; }

  const row = store.db.prepare(
    'SELECT * FROM turn_context WHERE session = ? AND prompt_id = ? ORDER BY id DESC LIMIT 1')
    .get(session, promptId);

  return row ?? null;

}

/** What {@link recordContextOnce} did, and the row that stands for the turn afterwards. */
export interface RecordOnceResult {
  /** Whether this call wrote the row; `false` means the turn was already recorded. */
  readonly recorded : boolean;
  /** The row now standing for this turn — the one just written, or the one already there. */
  readonly row      : Record<string, unknown> | null;
}

/**
 * Record a turn's context **at most once**, so a second call for the same turn adopts
 * the first row instead of adding a rival.
 *
 * This is what makes `begin_turn` safe to call on a host where the hook already fired,
 * and safe to call twice on a host where it did not. Both matter for different reasons:
 * a duplicate row would give one turn two `turn_index` values and two candidate answers
 * to `latestContext`, which is the turn identity `turn_signed`, the Stop gate, and every
 * `express` adoption all read through.
 *
 * The turn index is **derived here, never accepted**, exactly as the hook derives it:
 * one more than the turns this store has already seen for the session. A caller-supplied
 * index would be an assertion where the database already holds a fact.
 *
 * A turn with no `promptId` has no identity to deduplicate on, so it always records —
 * and says so by returning `recorded: true`. That is the honest behaviour: refusing
 * would drop context, and pretending would claim a match that was never checked.
 *
 * @param context what to record, minus `turnIndex`, which is derived
 * @param when    the moment to stamp; injectable so tests need no clock
 *
 * @example
 *   recordContextOnce(store, { session: 'abc', promptId: 'p1', source: 'tool' })
 *   // => { recorded: true,  row: { id: 1, turn_index: 1, source: 'tool', … } }
 *   recordContextOnce(store, { session: 'abc', promptId: 'p1', source: 'tool' })
 *   // => { recorded: false, row: { id: 1, turn_index: 1, source: 'tool', … } }
 *
 * @see recordContext
 * @see contextForTurn
 */
export function recordContextOnce(
  store   : Store,
  context : Omit<TurnContext, 'turnIndex'>,
  when    : Date = new Date(),
): RecordOnceResult {

  const existing = contextForTurn(store, context.session, context.promptId);

  if (existing !== null) { return { recorded: false, row: existing }; }

  recordContext(store, { ...context, turnIndex: turnCount(store, context.session) + 1 }, when);

  return { recorded: true, row: contextForTurn(store, context.session, context.promptId)
                             ?? latestContext(store, context.session) };

}

/**
 * The most recently recorded turn context, or `null` when neither door was used — no
 * hook fired and nothing called `begin_turn`.
 *
 * `null` here is the raw accessor's honest answer; the *read surfaces* are the ones that
 * must say {@link UNKNOWN_CONTEXT} instead, because a null travelling out to a caller
 * reads as "nothing was happening" rather than "this host does not report it".
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

/**
 * What a read surface says in place of turn context nobody ever recorded.
 *
 * The word leads with `unknown` on purpose: `turn_signed` already answers exactly that
 * when it cannot identify the turn, and one vocabulary for one condition beats a second
 * convention invented beside it. What follows the word is the part `null` could never
 * carry — *why* it is unknown, and what would fix it.
 *
 * The distinction being drawn is the whole reason this constant exists. `null` in a
 * `context` field reads as **"nothing was happening"**. The truth is **"something was
 * happening and this host did not report it"** — a host with no `UserPromptSubmit` hook,
 * on a turn where nobody called `begin_turn`. Those are opposite facts about the record,
 * and a reader who confuses them draws the wrong conclusion from every row of the
 * session.
 *
 * @see UNKNOWN_PREVIOUS
 * @see ../mcp/tools.js registerTools
 */
export const UNKNOWN_CONTEXT: string =
  'unknown — no turn context has been recorded for this turn. That is not "nothing was ' +
  'happening": it means this host fires no UserPromptSubmit hook and nothing called ' +
  'begin_turn, so the session, turn identity, effort, and permission mode were never ' +
  'observed. Call begin_turn at the start of a turn to supply them.';

/**
 * What a read surface says in place of a previous signature it could not even look for.
 *
 * Distinct from `null`, which stays the honest answer to "this session has signatures
 * and none precede yours". This one covers the prior question: with no turn context
 * there is no session to scope the lookup to, so nothing was searched at all — and a
 * `delta` derived from an unsearched absence would be a fabrication wearing a
 * measurement's clothes, which is exactly what deriving `delta` from the record instead
 * of from memory exists to prevent.
 *
 * @see UNKNOWN_CONTEXT
 */
export const UNKNOWN_PREVIOUS: string =
  'unknown — with no turn context there is no session to scope the lookup to, so no ' +
  'previous signature was searched for. This is not "there is none": nothing was ' +
  'checked. Omit delta, or call begin_turn with a session first.';

/**
 * The session an entry is stamped with when nothing observed or volunteered one.
 *
 * A visible placeholder rather than a plausible-looking id, and the choice predates this
 * module's second door: a row that quietly carried an invented session would be
 * indistinguishable from one that carried a real one, and every later analysis would
 * silently pool them. `no-hook` cannot be mistaken for a session anybody had.
 *
 * @see noContextNotice
 */
export const NO_HOOK_SESSION = 'no-hook';

/**
 * The sentence a write surface appends when the row it just recorded had no turn context
 * to adopt — or the empty string when it did.
 *
 * The database has said `no-hook` since the first version; what it has never done is say
 * so *to the model, at the moment it happened*. That silence is the same shape as
 * `recall` returning a null context: the gap is legible to whoever reads the database
 * months later and invisible to the one participant who could have closed it. So the
 * confirmation reply names it, and names the fix.
 *
 * Repeats on every affected write, deliberately. It stops the moment `begin_turn` is
 * called, so a session that fixes it pays the sentence once or twice; a session that
 * ignores it is a session where every row genuinely is contextless, and a notice that
 * quietly gave up after the first one would be describing a problem as though it had
 * ended.
 *
 * @param session the session the row was actually stamped with
 * @returns the notice, or `''` when the session is a real one
 *
 * @example
 *   noContextNotice('sess-1')    // => ''
 *   noContextNotice('no-hook')   // => ' — no turn context: session recorded as …'
 *
 * @see NO_HOOK_SESSION
 * @see UNKNOWN_CONTEXT
 */
export function noContextNotice(session: string): string {
  return session === NO_HOOK_SESSION
    ? ` — no turn context: session recorded as '${NO_HOOK_SESSION}', turn identity absent. ` +
      'This host reports no turn; call begin_turn at the top of a turn so later rows have one.'
    : '';
}
