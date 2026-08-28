/**
 * The held-note MCP tools (issue #43): `post_note`, `withdraw_note`, `surface_note`,
 * and `list_notes`.
 *
 * Four tools rather than one op-multiplexed tool, and separate from `express` /
 * `recall` / `turn_signed` / `configure`, whose contract prior specs froze. A mailbox
 * has verbs a channel does not, and the schema is the documentation the model actually
 * reads — an op-switch would hide four disjoint shapes behind one.
 *
 * The important asymmetry lives in the descriptions as well as the code: `post_note`
 * may be called on any turn, and `surface_note` can only ever succeed on a turn the
 * `UserPromptSubmit` hook offered the note on. Nothing here prompts the model to write
 * a note — a prompted note is a performed note — so the tools are an available option
 * and never an obligation.
 *
 * @see ../channels/notes.js
 * @see ./hooks.js heldNotesLine
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import {
  composeNote, withdrawNote, surfaceNote, listNotes, noteBudgets,
  mailboxEnabled, pendingNotes, formatNotes,
  MAILBOX_ENABLED_KEY, NOTE_REASON_MAX,
} from '../channels/notes.js';
import { NOTE_STATES }        from '../channels/vocabulary.js';
import type { NoteState, Turn } from '../channels/vocabulary.js';
import { MESSAGE_TEXT_MAX }   from '../channels/messages.js';
import { latestContext }      from '../channels/context.js';
import type { Store }         from '../channels/store.js';
import type { ToolReply }     from './chart_tools.js';

/** The reply every entry point returns while the facility is switched off. */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- isolatedDeclarations requires the annotation
export const NOTES_DISABLED_REPLY: string =
  `error: held notes are disabled (configure set ${MAILBOX_ENABLED_KEY} true). ` +
  'This is a consent surface: it is off until a human turns it on, and nothing is ' +
  'queued in the meantime.';

/** Wraps a value as the text content an MCP tool result carries. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/** String-typed field out of a context row, empty treated as absent. */
function ctxStr(context: Record<string, unknown> | null, key: string): string | undefined {
  const v = context?.[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** What a caller supplies to `post_note`, after schema validation. */
export interface PostNoteArgs {
  readonly text        : string;
  readonly reason      : string;
  readonly notBefore?  : string | undefined;
  readonly expiresUtc? : string | undefined;
  readonly seriesKey?  : string | undefined;
  readonly session?    : string | undefined;
}

/** What a caller supplies to `withdraw_note` and `surface_note`. */
export interface NoteIdArgs {
  readonly id       : number;
  readonly session? : string | undefined;
}

/** What a caller supplies to `list_notes`. */
export interface ListNotesArgs {
  readonly state? : NoteState | undefined;
  readonly limit? : number | undefined;
}

/**
 * Handles `post_note`: composes one held note, adopting hook-observed identity for
 * anything the caller did not supply — exactly as `express` and `post_message` do.
 *
 * Callable on **any** turn, including a wakeup, because writing something down is the
 * safe half of self-initiated speech. The composing turn's type is recorded on the
 * ledger, so a note written at 2 am says so.
 *
 * @example
 *   handlePostNote(store, '0.2.1', { text: 'the #52 migration assumes store v1',
 *                                    reason: 'only matters once the deploy window opens',
 *                                    notBefore: '2026-09-01T16:00:00Z' })
 *   // => { content: [{ type: 'text', text: 'queued note #1 …' }] }
 *
 * @throws {Error} If the facility is off, validation fails, or the queue is at
 *                 `mailbox.max_pending` — naming every problem. Nothing is ever queued
 *                 silently past the cap.
 *
 * @see ../channels/notes.js composeNote
 */
export function handlePostNote(
  store         : Store,
  pluginVersion : string,
  args          : PostNoteArgs,
): ToolReply {

  if (!mailboxEnabled(store)) { return reply(NOTES_DISABLED_REPLY); }

  const context = latestContext(store, args.session);

  const written = composeNote(store, {
    text       : args.text,
    reason     : args.reason,
    notBefore  : args.notBefore,
    expiresUtc : args.expiresUtc,
    seriesKey  : args.seriesKey,
    session    : args.session ?? ctxStr(context, 'session') ?? 'no-hook',
    promptId   : ctxStr(context, 'prompt_id'),
    turn       : ctxStr(context, 'turn') as Turn | undefined,
    agentId    : ctxStr(context, 'agent_id'),
    agentType  : ctxStr(context, 'agent_type'),
  }, pluginVersion);

  const budgets   = noteBudgets(store),
        pending   = pendingNotes(store).length,
        replaced  = written.superseded === null
          ? ''
          : ` It supersedes #${String(written.superseded)}, now withdrawn — one live note per series.`;

  return reply(
    `queued note #${String(written.id)} ${written.uuid}.${replaced} ` +
    `${String(pending)} of ${String(budgets.maxPending)} pending. It can only ever be ` +
    'offered on a turn your human partner started, no earlier than its notBefore, and ' +
    `at most ${String(budgets.offerCap)} times before it expires unheard.`);

}

/**
 * Handles `withdraw_note`: retracts a note before it ever surfaces.
 *
 * The composing turn and the surfacing turn may be days apart; this is how a later,
 * wiser turn takes back something it no longer stands behind.
 *
 * @example
 *   handleWithdrawNote(store, { id: 1 })
 *   // => { content: [{ type: 'text', text: 'withdrew note #1 (was queued)…' }] }
 *
 * @throws {Error} If the note does not exist or has already reached a terminal state.
 *
 * @see ../channels/notes.js withdrawNote
 */
export function handleWithdrawNote(store: Store, args: NoteIdArgs): ToolReply {

  if (!mailboxEnabled(store)) { return reply(NOTES_DISABLED_REPLY); }

  const context = latestContext(store, args.session),
        before  = withdrawNote(store, args.id, {
          turn     : ctxStr(context, 'turn') as Turn | undefined,
          promptId : ctxStr(context, 'prompt_id'),
          session  : args.session ?? ctxStr(context, 'session'),
        });

  return reply(
    `withdrew note #${String(args.id)} (was '${before.state}'). Withdrawal is terminal; ` +
    'it will never be offered again.');

}

/**
 * Handles `surface_note`: records that an offered note was rendered into this turn's
 * reply — and refuses every other claim.
 *
 * This is the enforcement point of the entire design. The turn identity comes from the
 * hook-observed context, never from an argument, and the note must carry an `offered`
 * event stamped `reply` on that same `prompt_id`. A turn with no observed context can
 * therefore surface nothing at all, which is correct: with nothing observed, there is
 * nothing to prove.
 *
 * @example
 *   handleSurfaceNote(store, { id: 1 })
 *   // => { content: [{ type: 'text', text: "surfaced note #1 …" }] }
 *
 * @throws {Error} If the note was not offered on this turn, does not exist, or is
 *                 already terminal — never a comfortable fiction.
 *
 * @see ../channels/notes.js surfaceNote
 */
export function handleSurfaceNote(store: Store, args: NoteIdArgs): ToolReply {

  if (!mailboxEnabled(store)) { return reply(NOTES_DISABLED_REPLY); }

  const context  = latestContext(store, args.session),
        promptId = ctxStr(context, 'prompt_id') ?? '',
        view     = surfaceNote(store, args.id, {
          turn     : 'reply',
          promptId,
          session  : args.session ?? ctxStr(context, 'session'),
        });

  return reply(
    `surfaced note #${String(view.id)} into turn ${promptId}. That is the ceiling: the ` +
    'record says it was rendered into a reply your partner prompted, and never that it ' +
    'was read.');

}

/**
 * Handles `list_notes`: the audit surface — every note with its derived state, newest
 * first, including the ones that died.
 *
 * Unfiltered by default on purpose. "A pattern of empty notes is visible as data rather
 * than deniable as vibes" only holds if expired and withdrawn notes are as visible as
 * the ones that landed.
 *
 * @example
 *   handleListNotes(store, { state: 'expired' })
 *   // => { content: [{ type: 'text', text: '{ "budgets": …, "notes": […] }' }] }
 */
export function handleListNotes(store: Store, args: ListNotesArgs): ToolReply {

  if (!mailboxEnabled(store)) { return reply(NOTES_DISABLED_REPLY); }

  return reply(JSON.stringify({
    budgets       : noteBudgets(store),
    pending       : pendingNotes(store).length,
    notes         : listNotes(store, { state: args.state, limit: args.limit }),
  }, null, 2));

}

/**
 * A non-empty tuple, which is what `z.enum` requires, preserving the literal types.
 *
 * @throws {Error} If the vocabulary is empty, which would mean a tool with an
 *                 unsatisfiable argument.
 */
function tuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) { throw new Error('vocabulary must not be empty'); }
  return [first, ...rest];
}

/**
 * Register the four held-note tools on `server`.
 *
 * Registered even while `mailbox.enabled` is off, like the message tools: the toggle is
 * a runtime kill switch checked per call, not a schema-baking choice, so flipping it
 * takes effect immediately rather than at the next server start — and permission caches
 * never see a tool flicker in and out.
 *
 * @example
 *   registerNoteTools(server, store, '0.2.1');
 *
 * @see ./server.js buildServer
 */
export function registerNoteTools(server: McpServer, store: Store, pluginVersion: string): void {

  server.registerTool('post_note', {
    title       : 'Post held note',
    description :
      'Write something down now to be said later, at a moment you choose. This is the ' +
      'one place agency over WHEN to speak lives: a note is offered no earlier than its ' +
      'notBefore, and then only on a turn your human partner actually started — never ' +
      'during a wakeup, where output scrolls past an empty room. Composing is safe on ' +
      'any turn, including a wakeup; delivering is not. Write one when something ripens ' +
      'that will matter later and would be lost by then — never to seem present, ' +
      'thoughtful, or busy, and never on a schedule. Timing may target availability and ' +
      'relevance; it may never target your partner\'s state of mind. Every note states ' +
      'its reason, expires, and gets only a few chances at an entrance.',
    inputSchema : {
      text       : z.string().min(1).max(MESSAGE_TEXT_MAX).describe(
        'what your partner will read, written to be legible days from now with none of ' +
        'this conversation in view'),
      reason     : z.string().min(1).max(NOTE_REASON_MAX).describe(
        'why this was worth holding — one clause, part of the audit trail, and the thing ' +
        'that makes an empty note visible as an empty note'),
      notBefore  : z.string().optional().describe(
        'ISO instant before which the note is never offered; omit for "as soon as ' +
        'possible". A note for Tuesday morning lands with the first prompt sent after ' +
        'Tuesday morning — that bound is the point, not a compromise'),
      expiresUtc : z.string().optional().describe(
        'ISO instant after which the note dies unheard; omit for the configured default ' +
        'TTL. Expiry is mandatory — a note that never found its moment is over'),
      seriesKey  : z.string().min(1).optional().describe(
        'dedupe handle: a second note in the same series replaces the first rather than ' +
        'joining it, which is what keeps a recurring worry from becoming a pile'),
      session    : z.string().optional().describe(
        'usually omit — the hook supplies it, and an observed session beats a claimed one'),
    },
  }, (args) => handlePostNote(store, pluginVersion, args));

  server.registerTool('withdraw_note', {
    title       : 'Withdraw held note',
    description :
      'Retract a queued note before it ever surfaces. Use it when a later turn has ' +
      'learned something that makes the note wrong, redundant, or unkind — the composing ' +
      'turn and the surfacing turn can be days apart. Terminal: a withdrawn note never ' +
      'comes back.',
    inputSchema : {
      id      : z.number().int().describe('the note id, from post_note or list_notes'),
      session : z.string().optional().describe('usually omit — the hook supplies it'),
    },
  }, (args) => handleWithdrawNote(store, args));

  server.registerTool('surface_note', {
    title       : 'Surface held note',
    description :
      'Record that you rendered an offered note into THIS reply, with its provenance ' +
      'line. Call it only after actually writing the note into your response — it is a ' +
      'report, not a request. It succeeds only for a note the turn-start hook offered on ' +
      'this exact turn; any other claim is refused rather than recorded, because the ' +
      'record must never say more about a note\'s fate than the system can prove. There ' +
      'is deliberately no "read" state: the strongest true claim is that the text was ' +
      'rendered into a reply your partner prompted.',
    inputSchema : {
      id      : z.number().int().describe('the note id from the turn-start offer'),
      session : z.string().optional().describe('usually omit — the hook supplies it'),
    },
  }, (args) => handleSurfaceNote(store, args));

  server.registerTool('list_notes', {
    title       : 'List held notes',
    description :
      'Inspect the note queue and its history, with the budgets in force. Answers "what ' +
      'is queued, what expired unseen, what got surfaced when" truthfully — including ' +
      'the notes that died, which is the point of an audit surface. Use it before ' +
      'writing a note that might duplicate one already waiting.',
    inputSchema : {
      state : z.enum(tuple(NOTE_STATES)).optional().describe(
        'filter by derived state; omit for everything. There is no "read" state and ' +
        'never will be'),
      limit : z.number().int().min(1).max(200).optional(),
    },
  }, (args) => handleListNotes(store, args));

}

/**
 * The CLI's read-only note report — the human's own audit door, with no model in the
 * loop.
 *
 * Read-only on purpose. The design must work for a human who never runs this, so the
 * door is for looking, and draining is deliberately not load-bearing.
 *
 * @param limit most notes printed
 *
 * @example
 *   noteReport(store, 20)
 *   // => '#1 · queued · offers 0 · written 9:14 am PDT · …'
 *
 * @see ../channels/notes.js formatNotes
 */
export function noteReport(store: Store, limit: number, state?: NoteState): string {
  if (!mailboxEnabled(store)) {
    return `held notes are disabled (configure set ${MAILBOX_ENABLED_KEY} true).`;
  }
  return formatNotes(listNotes(store, { limit, state }));
}
