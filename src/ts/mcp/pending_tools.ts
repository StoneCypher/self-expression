/**
 * The pending-notice tool layer (issue #98): the `claim_pending` tool, and the reply
 * carrier that rides the notice out on `express`, `annotate`, `begin_turn` and `recall`.
 *
 * **Why a carrier rather than a tool of its own.** A desk request or an unread note is
 * only useful if the session hears about it, and the only channel that reaches *every*
 * host is a tool reply — hooks fire on Claude Code and nowhere else. So the notice rides
 * replies the session was already going to read, appended as one short line after
 * whatever the reply actually said. {@link ../channels/pending.js pendingNotice} keeps it
 * from becoming wallpaper: it speaks only when the pending set changes, so a carrier
 * usually appends nothing at all, and all four carriers share one fingerprint row — a
 * hook or a tool that already spoke this turn leaves the rest silent.
 *
 * **Why the carrier fails open.** {@link withPendingNotice} wraps everything it does in a
 * try/catch and returns the reply untouched on any throw. The notice is an accessory to
 * someone else's answer; a broken `questions.json` or a missing table must never cost a
 * caller the `recorded #7` it actually asked for. That is the same posture
 * {@link ../channels/pending.js collectPending} takes per source, one layer up.
 *
 * **What claiming means.** `claim_pending` is the other half: it takes the items the
 * notice mentioned, and it takes them by *doing the thing that makes them not pending* —
 * stamping a desk row `claimed`, writing a message's delivery receipt. Both are
 * irreversible, so both hand back the item's full text in the same reply. A claim that
 * consumed a message without showing it would have destroyed the only copy the session
 * was ever going to see, which is a worse state than the backlog it cleared.
 *
 * @see ../channels/pending.js
 * @see ../channels/desk_questions.js
 * @see ../channels/messages.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import { effectiveValue }                          from '../channels/config.js';
import { latestContext, NO_HOOK_SESSION }          from '../channels/context.js';
import { claimIntent, openIntents, readQuestions } from '../channels/desk_questions.js';
import { receiptMessages, unreadRows }             from '../channels/messages.js';
import type { Reader }                             from '../channels/messages.js';
import { collectPending, pendingNotice }           from '../channels/pending.js';
import type { PendingItem }                        from '../channels/pending.js';
import type { Store }                              from '../channels/store.js';
import type { ToolReply }                          from './chart_tools.js';

/** Wraps a value as the text content an MCP tool result carries. Copied from `tools.ts`. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/** String-typed field out of a context row, empty treated as absent. */
function ctxStr(context: Record<string, unknown> | null, key: string): string | undefined {
  const value = context?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Append the pending notice to a tool reply, when there is one to append.
 *
 * The line goes on the **last** text block, after everything already there — after
 * `annotate`'s rendered anchor block, after the `no-hook` notice, after `recall`'s JSON —
 * separated by a blank line and led by an em dash, so it reads as an aside rather than
 * as part of the answer, and so a caller parsing the reply can cut it off at the last
 * `\n\n— `. A reply carrying no text block at all is returned untouched: there is nothing
 * to append to, and inventing a block would put the aside where the answer belongs.
 *
 * **Fail-open.** Anything thrown while computing the notice — a corrupt `questions.json`,
 * a missing `pending_notice` table — is swallowed and the reply comes back exactly as it
 * was handed over. The notice is never worth losing somebody else's answer for.
 *
 * The input reply is never mutated; the returned one is a fresh object over fresh blocks.
 *
 * @param session whose pending set to check, and whose fingerprint row records that it
 *                was told — pass the same session the handler stamped its own work with,
 *                so one turn's carriers agree about who is being spoken to
 * @param out     the reply to decorate, returned unchanged when there is nothing to say
 * @param now     injectable clock, threaded to the notice; defaults to now
 *
 * @example
 *   withPendingNotice(store, 'sess-1', reply('recorded #7'))
 *   // => { content: [{ type: 'text',
 *   //      text: 'recorded #7\n\n— pending: 1 desk request (self-expression claim_pending)' }] }
 *
 * @example
 *   withPendingNotice(store, 'sess-1', reply('recorded #8'))
 *   // => { content: [{ type: 'text', text: 'recorded #8' }] }  — nothing changed since #7
 *
 * @see ../channels/pending.js pendingNotice
 */
export function withPendingNotice(
  store   : Store,
  session : string,
  out     : ToolReply,
  now?    : Date,
): ToolReply {

  try {

    const blocks = out.content,
          last   = blocks.length - 1;

    // Before the notice is computed, not after: `pendingNotice` records that the session
    // was told the moment it speaks, so asking it a question this reply cannot carry the
    // answer to would swallow the line for good.
    if (blocks[last] === undefined) { return out; }

    const notice = pendingNotice(store, session, now);
    if (notice === null) { return out; }

    return {
      ...out,
      content: blocks.map((block, index) =>
        index === last ? { ...block, text: `${block.text}\n\n— ${notice}` } : block),
    };

  } catch {
    // Fail-open (module docblock): the caller's own answer is worth more than the aside.
    return out;
  }

}

/** What a caller supplies to `claim_pending`, after schema validation. */
export interface ClaimArgs {
  /** Claim only this source's items; omit to claim both. */
  readonly kind?    : PendingItem['kind'] | undefined;
  /** Claim only this item — a desk question id, or a message id as a string. */
  readonly key?     : string | undefined;
  /**
   * Fallback claiming identity, used only when no hook ever observed one. Read by
   * {@link claimSession}, which the tool registration applies before calling
   * {@link handleClaimPending}; the handler itself is given the already-resolved session
   * and does not consult this field.
   */
  readonly session? : string | undefined;
}

/**
 * The identity a `claim_pending` call runs under: **observed beats claimed**.
 *
 * `latestContext(store)` first, `args.session` only as a fallback, the visible `no-hook`
 * placeholder when neither exists — the same precedence
 * {@link ./message_tools.js handleReadMessages} uses, and deliberately the opposite of
 * `post_message`'s caller-wins order. Posting is a caller describing its own message;
 * claiming is an irreversible write against a session's mail and a desk row that will
 * carry that name forever, so a claimed identity must never displace an observed one.
 *
 * @param args the tool arguments, whose `session` is the lowest-precedence source
 * @returns the session to stamp desk claims and message receipts with
 *
 * @example
 *   claimSession(store, {})                    // => 'sess-1' when a hook observed it
 *   claimSession(store, { session: 'mine' })   // => 'sess-1' still — observed wins
 *   claimSession(store, { session: 'mine' })   // => 'mine' on a host with no hook
 *   claimSession(store, {})                    // => 'no-hook' when nothing is known
 *
 * @see ../channels/context.js NO_HOOK_SESSION
 */
export function claimSession(store: Store, args: ClaimArgs): string {
  return ctxStr(latestContext(store), 'session') ?? args.session ?? NO_HOOK_SESSION;
}

/**
 * One item `claim_pending` took, reported back with the text that was waiting in it.
 *
 * The same four fields {@link ../channels/pending.js PendingItem} carries, with one
 * deliberate difference: `label` is the item's **whole** text, not the notice's
 * 60-character summary. The claim is the moment the session actually receives the thing,
 * and truncating it here would leave the caller having consumed a message it can only
 * read the first line of.
 */
export interface ClaimedItem {
  readonly kind  : PendingItem['kind'];
  readonly key   : string;
  readonly label : string;
  readonly since : string;
}

/**
 * Take the open desk intents this call selected, stamping each one `claimed`.
 *
 * A row that stops being claimable between the read and the stamp — another session got
 * there first — is skipped rather than reported, so `claimed` never names something this
 * caller did not actually take.
 *
 * @throws {SyntaxError} If `desk.path` is set and its `questions.json` will not parse.
 *                       Loud on purpose: the notice under-counts quietly (that is
 *                       `collectPending`'s fail-open contract), but a caller that asked
 *                       to claim and got nothing deserves to know the queue is unreadable
 *                       rather than to read `claimed: []` as "nothing was waiting".
 */
function claimDeskIntents(store: Store, session: string, args: ClaimArgs, now: Date): ClaimedItem[] {

  if (args.kind === 'message') { return []; }

  const path = effectiveValue(store, 'desk.path');
  if (path === null) { return []; }

  const open    = openIntents(readQuestions(path)),
        wanted  = args.key === undefined ? open : open.filter(row => row.id === args.key),
        claimed : ClaimedItem[] = [];

  for (const row of wanted) {
    const stamped = claimIntent(path, row.id, session, now);
    if (stamped === null) { continue; }
    claimed.push({
      kind  : 'desk_intent',
      key   : stamped.id,
      label : stamped.text,
      since : stamped.queuedAt ?? stamped.asked,
    });
  }

  return claimed;

}

/**
 * Take the unread `self` messages this call selected, writing each one's delivery receipt.
 *
 * Peek-then-receipt rather than {@link ../channels/messages.js readMessages}: that reads
 * and receipts as one act over the oldest unread rows under a limit, so a `key` naming
 * the newest of three would silently consume the two older ones — mail the caller never
 * asked for and never gets back. {@link ../channels/messages.js unreadRows} sees the same
 * unread set without consuming it, and
 * {@link ../channels/messages.js receiptMessages} then stamps exactly the rows being
 * reported, through the same single receipt insert `readMessages` uses.
 *
 * Gated on `messages.enabled` for the same reason the notice's message source is: a
 * switched-off messagebox must not be quietly drained by a claim.
 *
 * Only the ids `receiptMessages` reports as actually stamped are returned, the same way
 * a desk row `claimIntent` refused is skipped rather than reported: `claimed` names what
 * this call really took, never what it merely tried to take.
 */
function claimMessages(store: Store, session: string, args: ClaimArgs, now: Date): ClaimedItem[] {

  if (args.kind === 'desk_intent') { return []; }
  if (effectiveValue(store, 'messages.enabled') === 'false') { return []; }

  const unread = unreadRows(store, session, now),
        wanted = args.key === undefined ? unread : unread.filter(row => String(row['id']) === args.key);

  if (wanted.length === 0) { return []; }

  const context = latestContext(store, session),
        reader  : Reader = {
          reader   : 'model',
          session,
          agentId  : ctxStr(context, 'agent_id'),
          promptId : ctxStr(context, 'prompt_id'),
        };

  const stamped = new Set(
    receiptMessages(store, wanted.map(row => Number(row['id'])), reader, now));

  return wanted.filter(row => stamped.has(Number(row['id']))).map((row): ClaimedItem => {
    const body = row['text'];
    return {
      kind  : 'message',
      key   : String(row['id']),
      label : typeof body === 'string' ? body : '',
      since : String(row['ts_utc']),
    };
  });

}

/**
 * Handles `claim_pending`: takes the pending items the notice named, and hands back what
 * was waiting in each of them.
 *
 * Desk requests come first, then messages — the order
 * {@link ../channels/pending.js describePending} names them in, so the reply reads in the
 * same sequence as the line that prompted it. `remaining` counts everything still pending
 * for the session afterwards, across **both** sources regardless of any narrowing, because
 * it answers the question the caller actually has next: is there more.
 *
 * The reply **echoes the session it ran under**, the way `read_messages` echoes the
 * reader identity the server resolved. Claiming is irreversible — a desk row carries the
 * claiming name forever, and a receipt cannot be un-written — so the one thing a caller
 * must never have to guess at afterwards is whose name it happened in. A claim that ran
 * under `no-hook`, or under a session the caller did not expect, is then visible in the
 * reply instead of only in the desk file.
 *
 * Claiming is not gated on `pending.enabled`. That key governs whether the notice is
 * *spoken*; a session that knows about an item by any other route — the desk in front of
 * it, a previous reply — must still be able to take it.
 *
 * @param session the claiming identity, already resolved by {@link claimSession}: stamped
 *                into each desk row and each receipt, echoed in the reply, and the fence
 *                on which messages are even visible. `args.session` is *not* consulted
 *                here; it is the registration layer's lowest-precedence fallback and is
 *                folded into this parameter before the call.
 * @param args    `kind` narrows to one source, `key` to one item; both omitted claims
 *                everything waiting
 * @param now     injectable clock for the claim stamps and receipts; defaults to now
 *
 * @example
 *   handleClaimPending(store, 'sess-1', {})
 *   // => {"session":"sess-1",
 *   //     "claimed":[{"kind":"desk_intent","key":"q1","label":"merge #21?","since":"…"}],
 *   //     "remaining":0}
 *
 * @example
 *   handleClaimPending(store, 'sess-1', { key: 'no-such-thing' })
 *   // => {"session":"sess-1","claimed":[],"remaining":2}
 *   //    nothing taken, whose name nothing was taken in, and what is still waiting
 *
 * @throws {SyntaxError} If `desk.path` names a `questions.json` that will not parse and
 *                       the call did not narrow to `kind: 'message'`; nothing is claimed
 *                       and nothing is consumed, so the call is safe to repeat.
 *
 * @see withPendingNotice
 * @see ../channels/desk_questions.js claimIntent
 */
export function handleClaimPending(
  store   : Store,
  session : string,
  args    : ClaimArgs,
  now     : Date = new Date(),
): ToolReply {

  const claimed = [
    ...claimDeskIntents(store, session, args, now),
    ...claimMessages(store, session, args, now),
  ];

  return reply(JSON.stringify({
    session,
    claimed,
    remaining: collectPending(store, session, now).length,
  }, null, 2));

}

/**
 * Register `claim_pending` on `server`.
 *
 * The `session` argument is a *fallback*, not an override: {@link claimSession} takes the
 * hook-observed session first and reaches for this only on a host where nothing was ever
 * observed. Claiming stamps a desk row and burns a message receipt in somebody's name, so
 * a claimed identity must never displace an observed one — the same precedence
 * `read_messages` keeps, and deliberately not `post_message`'s.
 *
 * Registered unconditionally — `pending.enabled` is a runtime switch over the *notice*,
 * checked per call, not a reason to hide the tool that acts on what the notice named.
 *
 * @example
 *   registerPendingTools(server, store);
 *
 * @see ./server.js buildServer
 * @see handleClaimPending
 * @see claimSession
 */
export function registerPendingTools(server: McpServer, store: Store): void {

  server.registerTool('claim_pending', {
    title       : 'Claim pending items',
    description :
      'Take the pending desk requests and unread messages the notice mentioned: stamps ' +
      'desk rows as claimed by this session and receipts messages, returning their ' +
      'text. Call it when you are about to act on them, not to make the line go away.',
    inputSchema : {
      kind    : z.enum(['message', 'desk_intent']).optional().describe('claim only this kind'),
      key     : z.string().optional().describe(
        'claim only this item — a desk question id or a message id'),
      session : z.string().optional().describe(
        'fallback identity when no hook context has been observed; an observed session always wins'),
    },
  }, (args) => handleClaimPending(store, claimSession(store, args), args));

}
