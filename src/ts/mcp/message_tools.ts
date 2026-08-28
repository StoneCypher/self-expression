/**
 * The messagebox MCP tools (issue #41): `post_message` and `read_messages`.
 *
 * Two tools rather than one op-multiplexed tool because posting and reading have
 * almost disjoint schemas, and the schema is the documentation the model actually
 * reads; `configure` multiplexes because its three ops share one tiny shape.
 *
 * Delivery is pull — `read_messages` is the portable path and the mechanism of
 * record on every host, with the hooks (`SessionStart`, the per-turn count line) as
 * pull triggers where the host supports them.
 *
 * @see ../channels/messages.js
 * @see ./hooks.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import { AUDIENCES }      from '../channels/vocabulary.js';
import type { Audience }  from '../channels/vocabulary.js';
import {
  postMessage, readMessages, MESSAGE_TEXT_MAX,
} from '../channels/messages.js';
import type { Reader }    from '../channels/messages.js';
import { effectiveValue } from '../channels/config.js';
import { latestContext }  from '../channels/context.js';
import type { Store }     from '../channels/store.js';
import type { ToolReply } from './chart_tools.js';

/** Config key gating the whole facility; only an effective 'false' disables it. */
export const MESSAGES_ENABLED_KEY = 'messages.enabled';

/** The reply every entry point returns while the facility is switched off. */
export const MESSAGES_DISABLED_REPLY = 'error: messages are disabled (configure messages.enabled)';

/** Wraps a value as the text content an MCP tool result carries. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/**
 * Whether the messagebox is switched off — read through the tolerant accessor, so an
 * invalid stored override behaves as the default (enabled).
 *
 * @example
 *   messagesDisabled(store)  // => false on a fresh install
 */
export function messagesDisabled(store: Store): boolean {
  return effectiveValue(store, MESSAGES_ENABLED_KEY) === 'false';
}

/**
 * What a caller supplies to `post_message`, after schema validation.
 *
 * Hand-written rather than `z.infer`-derived, matching `ExpressArgs`; the
 * registration call site keeps it honest against the zod shape.
 */
export interface PostMessageArgs {
  readonly audience    : Audience;
  readonly text        : string;
  readonly box?        : string | undefined;
  readonly replyTo?    : number | undefined;
  readonly expiresUtc? : string | undefined;
  readonly session?    : string | undefined;
}

/**
 * What a caller supplies to `read_messages`, after schema validation.
 */
export interface ReadMessagesArgs {
  readonly audience? : Audience | undefined;
  readonly box?      : string | undefined;
  readonly ack?      : boolean | undefined;
  readonly limit?    : number | undefined;
  readonly session?  : string | undefined;
}

/** String-typed field out of a context row, empty treated as absent. */
function ctxStr(context: Record<string, unknown> | null, key: string): string | undefined {
  const v = context?.[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * Handles `post_message`: posts one audience-tagged message, adopting hook-observed
 * sender identity for anything the caller did not supply — exactly as `express` does.
 * A row that reaches here with no context at all is marked `no-hook` rather than
 * given a plausible-looking session, so the gap is visible in the data.
 *
 * @example
 *   handlePostMessage(store, '0.2.1', { audience: 'self', text: 'resume at step 3' })
 *   // => { content: [{ type: 'text', text: 'posted #1 …' }] }
 *
 * @throws {Error} If message validation fails — see `postMessage` — naming every
 *                 problem and what would have been accepted.
 *
 * @see ../channels/messages.js postMessage
 */
export function handlePostMessage(
  store         : Store,
  pluginVersion : string,
  args          : PostMessageArgs,
): ToolReply {

  if (messagesDisabled(store)) { return reply(MESSAGES_DISABLED_REPLY); }

  const context = latestContext(store, args.session);

  const written = postMessage(store, {
    audience   : args.audience,
    text       : args.text,
    box        : args.box,
    replyTo    : args.replyTo,
    expiresUtc : args.expiresUtc,
    session    : args.session ?? ctxStr(context, 'session') ?? 'no-hook',
    promptId   : ctxStr(context, 'prompt_id'),
    agentId    : ctxStr(context, 'agent_id'),
    agentType  : ctxStr(context, 'agent_type'),
  }, pluginVersion);

  return reply(`posted #${String(written.id)} ${written.uuid}`);

}

/**
 * Handles `read_messages`: collects for the model reader, replying with the matching
 * messages *and* the reader identity the server resolved, so a wrong-identity read is
 * visible in the reply rather than silent.
 *
 * The reader session comes from the hook observation when one exists; the `session`
 * argument only fills in when no hook has run — `self` collection must never follow a
 * claimed identity past an observed one (spec, § Privacy). Reading `agents` requires
 * a `box`, mirroring the posting rule: an unscoped read would sweep every concurrent
 * job's coordination traffic.
 *
 * @example
 *   handleReadMessages(store, {})
 *   // => { content: [{ type: 'text', text: '{ "reader": …, "messages": […] }' }] }
 *
 * @see ../channels/messages.js readMessages
 */
export function handleReadMessages(store: Store, args: ReadMessagesArgs): ToolReply {

  if (messagesDisabled(store)) { return reply(MESSAGES_DISABLED_REPLY); }

  if (args.audience === 'agents' && (args.box === undefined || args.box.trim() === '')) {
    return reply(
      "error: reading audience 'agents' requires a box — an unscoped read would sweep " +
      "every concurrent job's coordination traffic; the box comes from the dispatch prompt");
  }

  const context = latestContext(store),
        reader: Reader = {
          reader   : 'model',
          session  : ctxStr(context, 'session') ?? args.session ?? 'no-hook',
          agentId  : ctxStr(context, 'agent_id'),
          promptId : ctxStr(context, 'prompt_id'),
        };

  const messages = readMessages(store, reader, {
    audience : args.audience,
    box      : args.box,
    ack      : args.ack,
    limit    : args.limit,
  });

  return reply(JSON.stringify({ reader, messages }, null, 2));

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
 * Register the two messagebox tools on `server`.
 *
 * Registered even while `messages.enabled` is off — the toggle is a runtime kill
 * switch checked per call, not a schema-baking choice like `channels.enabled`, so
 * flipping it takes effect immediately rather than at the next server start.
 *
 * @example
 *   registerMessageTools(server, store, '0.2.1');
 *
 * @see ./server.js buildServer
 */
export function registerMessageTools(server: McpServer, store: Store, pluginVersion: string): void {

  server.registerTool('post_message', {
    title       : 'Post message',
    description :
      'Send one audience-tagged message into the messagebox — the store carries it, ' +
      'never the transcript. self is a note to this session\'s future self, surviving ' +
      'compaction; agents coordinates sibling agents on a named box (box REQUIRED, ' +
      'from the dispatch prompt); user is an aside for the human to read later rather ' +
      'than now; record is for posterity, with no expected reader. Not memory, not a ' +
      'rendered channel: nothing posted here appears in the visible text.',
    inputSchema : {
      audience   : z.enum(tuple(AUDIENCES)).describe('who this is addressed to'),
      text       : z.string().min(1).max(MESSAGE_TEXT_MAX).describe(
        'the payload; a message needing more than 2000 characters is a file, whose path is the message'),
      box        : z.string().optional().describe(
        "named coordination topic; REQUIRED when audience is 'agents', optional topic otherwise"),
      replyTo    : z.number().int().optional().describe('id of a message this replies to'),
      expiresUtc : z.string().optional().describe(
        'ISO instant; excluded from delivery after this — never deleted by it'),
      session    : z.string().optional().describe(
        'usually omit — the hook supplies it, and an observed session beats a claimed one'),
    },
  }, (args) => handlePostMessage(store, pluginVersion, args));

  server.registerTool('read_messages', {
    title       : 'Read messages',
    description :
      'Collect messagebox mail. Default: your unread self notes (plus unread agents ' +
      'mail when a box is given). ack true (the default) writes delivery receipts so ' +
      'nothing is handed to you twice; ack false peeks at recent history without ' +
      'consuming anything. user mail is returned without receipting regardless of ack ' +
      '— relaying is not reading; the human receipts through the CLI. record is ' +
      'consultable history, never unread. The reply includes the reader identity the ' +
      'server resolved, so a wrong-identity read is visible.',
    inputSchema : {
      audience : z.enum(tuple(AUDIENCES)).optional().describe(
        'omit for everything addressed to you: unread self, plus agents when box is given'),
      box      : z.string().optional().describe(
        "coordination topic filter; REQUIRED when reading 'agents'"),
      ack      : z.boolean().optional().describe(
        'default true: write receipts (delivery); false: peek at recent history'),
      limit    : z.number().int().min(1).max(100).optional(),
      session  : z.string().optional().describe(
        'usually omit — a hook-observed session beats a claimed one for collection'),
    },
  }, (args) => handleReadMessages(store, args));

}
