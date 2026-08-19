/**
 * The MCP tool surface.
 *
 * Registration is separated from transport so the tools can be exercised in tests
 * without a stdio pipe, and so the enabled-channel set can be resolved once at startup
 * and baked into the schema.
 *
 * That baking is the mechanism behind "a disabled channel is neither logged nor
 * offered". Skills are static Markdown and cannot vary by configuration, so a skill
 * that enumerated the channels would keep offering a disabled one no matter what the
 * write path did. Narrowing the `channel` enum here means a disabled channel cannot
 * even be named — the argument will not validate — so the model never spends attention
 * producing something destined to be discarded.
 *
 * @see ../channels/vocabulary.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import {
  CHANNELS, POSITIONS, DELTAS, STEMS, EFFORTS, TURNS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES,
} from '../channels/vocabulary.js';
import type { Channel }        from '../channels/vocabulary.js';
import { recordEntry, recentEntries, previousSignature, hasClosingSignature } from '../channels/entries.js';
import { readConfig, writeConfig, allConfig }                                 from '../channels/store.js';
import type { Store } from '../channels/store.js';

/** Config key holding the comma-separated list of active channels. */
export const ENABLED_KEY = 'channels.enabled';

/**
 * Which channels are currently active.
 *
 * Defaults to all of them, because the default in code — not a seeded row — is what
 * lets a later change to the default actually reach existing installations. An
 * override naming no recognised channel is ignored rather than obeyed: a typo should
 * not silently disable the entire plugin.
 *
 * @example
 *   enabledChannels(store)  // => all CHANNELS, when unconfigured
 */
export function enabledChannels(store: Store): readonly Channel[] {

  const raw = readConfig(store, ENABLED_KEY);
  if (raw === null) { return CHANNELS; }

  const named = raw.split(',').map(s => s.trim()).filter(s => s !== ''),
        valid = CHANNELS.filter(c => named.includes(c));

  return valid.length > 0 ? valid : CHANNELS;

}

/**
 * A non-empty tuple, which is what `z.enum` requires, preserving the literal types.
 *
 * Generic rather than `string[]` so the enum's inferred type stays the narrow union —
 * otherwise every validated argument would widen to `string` and the type system would
 * stop distinguishing a channel from any other text.
 *
 * @throws {Error} If the vocabulary is empty, which would mean a tool with an
 *                 unsatisfiable argument.
 */
function tuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) { throw new Error('vocabulary must not be empty'); }
  return [first, ...rest];
}

/** Wraps a value as the text content an MCP tool result carries. */
function reply(text: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text }] };
}

/**
 * Register every tool on `server`.
 *
 * `pluginVersion` is stamped onto each row so a future reader can tell which release
 * wrote it — a question the previous log cannot answer for any of its 1,380 rows.
 *
 * @example
 *   const server = new McpServer({ name: 'self-expression', version: '0.2.0' });
 *   registerTools(server, store, '0.2.0');
 */
export function registerTools(server: McpServer, store: Store, pluginVersion: string): void {

  const channels = enabledChannels(store);

  server.registerTool('express', {
    title       : 'Express',
    description :
      'Record one expression. The channel says what kind: a signature is the per-turn ' +
      'affect line; need is a concrete ask that expects an answer; idea is an offer with ' +
      'nothing owed; divergence records that your read turned out wrong; dissent is a ' +
      'reservation below the threshold worth interrupting for; conflict reports that the ' +
      "instructions contradict each other and you picked one; confidence records how you " +
      'know what you just claimed; unanswerable records that something cannot be resolved ' +
      'with what is available; pattern is an observation about how the collaboration is ' +
      'going. "Nothing notable" is always a valid signature — the requirement is to look, ' +
      'not to produce.',
    inputSchema : {
      channel        : z.enum(tuple(channels)).describe('which kind of expression this is'),
      text           : z.string().min(1).max(280).describe('the content; terse, honest over flattering'),
      session        : z.string().min(1).describe('session identifier'),
      promptId       : z.string().optional().describe('turn identifier; groups a turn'),
      position       : z.enum(tuple(POSITIONS)).optional().describe('signatures only'),
      delta          : z.enum(tuple(DELTAS)).optional().describe('versus the previous signature'),
      face           : z.string().optional().describe('a face emoji, chosen for truth not flattery'),
      contextEmoji   : z.string().optional().describe('one non-face emoji: setting or metaphor'),
      stem           : z.enum(tuple(STEMS)).optional().describe('flow, spark, drag, fog, strain, still'),
      uncertain      : z.boolean().optional().describe('true when the self-read is doubtful'),
      modality       : z.enum(tuple(MODALITIES)).optional().describe('what kind of utterance'),
      confidence     : z.enum(tuple(CONFIDENCE_GROUNDS)).optional().describe('grounds, not strength'),
      divergenceKind : z.enum(tuple(DIVERGENCE_KINDS)).optional(),
      visible        : z.boolean().optional().describe('false when logged but not surfaced'),
      correctsId     : z.number().int().optional().describe('id of an entry this retracts'),
      effort         : z.enum(tuple(EFFORTS)).optional(),
      turn           : z.enum(tuple(TURNS)).optional(),
      model          : z.string().optional().describe('exact model id, including variant markers'),
      cctype         : z.string().optional().describe('conventional-commits type for the work'),
      project        : z.string().optional(),
    },
  }, (args) => {

    const client = server.server.getClientVersion();

    const written = recordEntry(store, {
      ...args,
      host        : client?.name,
      hostVersion : client?.version,
    }, pluginVersion);

    return reply(`recorded #${String(written.id)} ${written.uuid}`);

  });

  server.registerTool('recall', {
    title       : 'Recall',
    description :
      'Read back what has been recorded. Use before writing a signature so delta comes ' +
      'from the record rather than from memory, which degrades quietly.',
    inputSchema : {
      session : z.string().min(1),
      limit   : z.number().int().min(1).max(100).optional(),
    },
  }, (args) => {

    const previous = previousSignature(store, args.session),
          recent   = recentEntries(store, args.limit ?? 10);

    return reply(JSON.stringify({ previous, recent }, null, 2));

  });

  server.registerTool('turn_signed', {
    title       : 'Turn signed',
    description : 'Whether this turn already carries a closing signature. Exact, by turn identity.',
    inputSchema : { promptId: z.string().min(1) },
  }, (args) => reply(String(hasClosingSignature(store, args.promptId))));

  server.registerTool('configure', {
    title       : 'Configure',
    description :
      'Read or change settings. Stored in the database rather than in host-specific ' +
      'plugin config, so a choice made under one host holds under all of them.',
    inputSchema : {
      op    : z.enum(['get', 'set', 'list']),
      key   : z.string().optional(),
      value : z.string().optional(),
    },
  }, (args) => {

    if (args.op === 'list') { return reply(JSON.stringify(allConfig(store), null, 2)); }

    if (args.key === undefined) { return reply("error: 'key' is required for get and set"); }

    if (args.op === 'get') { return reply(readConfig(store, args.key) ?? '(unset; code default applies)'); }

    if (args.value === undefined) { return reply("error: 'value' is required for set"); }

    writeConfig(store, args.key, args.value);
    return reply(`${args.key} = ${args.value}`);

  });

}
