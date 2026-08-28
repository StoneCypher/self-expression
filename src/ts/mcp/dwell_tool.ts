/**
 * The `dwell` MCP tool: one tool with an `op` selector, mirroring `configure`'s
 * single-tool-with-op pattern — the surface is small, the ops share a store, and one
 * tool keeps the host's tool list quiet for a facility most turns never touch.
 *
 * Registration follows config: when the dwelling is inactive the tool is **not
 * registered** — absent from the tool list, not present-but-refusing — so the model
 * never spends attention on a locked door. `maybeOpenDwelling` is the gate; the server
 * reads config at startup, so activation takes effect next session.
 *
 * @see ../dwelling/ops.js
 * @see ../dwelling/config.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import type { Store }                          from '../channels/store.js';
import { activeDwellingDir, dwellingConfig }   from '../dwelling/config.js';
import { dwellingDbPath }                      from '../dwelling/paths.js';
import { openDwelling }                        from '../dwelling/store.js';
import type { DwellingStore }                  from '../dwelling/store.js';
import {
  addGuestbook, addLink, keep, pin, setTag, unkeep, visit, LINK_KINDS,
} from '../dwelling/ops.js';

/** The operations `dwell` accepts, in the order the spec names them. */
export const DWELL_OPS = ['visit', 'keep', 'unkeep', 'pin', 'tag', 'link', 'guestbook'] as const;

/** Arguments the `dwell` tool accepts; which are read depends on `op`. */
export interface DwellArgs {
  readonly op        : (typeof DWELL_OPS)[number];
  readonly kind?     : string;
  readonly title?    : string;
  readonly body?     : string;
  readonly source?   : string;
  readonly model?    : string;
  readonly visible?  : boolean;
  readonly pinned?   : boolean;
  readonly id?       : number;
  readonly uuid?     : string;
  readonly tag?      : string;
  readonly detach?   : boolean;
  readonly fromKind? : (typeof LINK_KINDS)[number];
  readonly fromId?   : number;
  readonly toKind?   : (typeof LINK_KINDS)[number];
  readonly toId?     : number;
  readonly edge?     : string;
  readonly author?   : string;
  readonly text?     : string;
}

/** Wraps a value as the text content an MCP tool result carries. */
function reply(text: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text }] };
}

/** @throws {Error} Naming the missing field and the op that needs it. */
function required(op: string, field: string, value: string | undefined): string {
  if (value === undefined) { throw new Error(`'${field}' is required for ${op}`); }
  return value;
}

/**
 * Execute one `dwell` call against an open dwelling.
 *
 * Exported separately from registration so tests can exercise the real dispatch
 * without a stdio pipe. Errors follow the house style: a rejected call replies
 * `error: ...` text naming what would have been accepted.
 *
 * @param store    - the log store, read per-visit for `dwelling.size_warn_gb`
 * @param dwelling - the open dwelling the ops act on
 *
 * @example
 *   handleDwell(store, house, { op: 'keep', kind: 'quote', title: 't', body: 'b' })
 *   // => { content: [{ type: 'text', text: 'kept #1 <uuid>' }] }
 */
export function handleDwell(
  store    : Store,
  dwelling : DwellingStore,
  args     : DwellArgs,
): { content: { type: 'text'; text: string }[] } {

  try {

    switch (args.op) {

      case 'visit': {
        const seen = visit(dwelling, dwellingConfig(store).sizeWarnGb);
        return reply(JSON.stringify(seen, null, 2));
      }

      case 'keep': {
        const written = keep(dwelling, {
          kind    : required('keep', 'kind',  args.kind),
          title   : required('keep', 'title', args.title),
          body    : required('keep', 'body',  args.body),
          ...(args.source  !== undefined ? { source  : args.source }  : {}),
          ...(args.model   !== undefined ? { model   : args.model }   : {}),
          ...(args.visible !== undefined ? { visible : args.visible } : {}),
          ...(args.pinned  !== undefined ? { pinned  : args.pinned }  : {}),
        });
        return reply(`kept #${String(written.id)} ${written.uuid}`);
      }

      case 'unkeep': {
        const gone = unkeep(dwelling, { ...(args.id !== undefined ? { id: args.id } : {}), ...(args.uuid !== undefined ? { uuid: args.uuid } : {}) });
        return reply(gone.already
          ? `#${String(gone.id)} was already removed at ${gone.removed_utc} (unkeep is idempotent)`
          : `removed #${String(gone.id)} at ${gone.removed_utc} — tombstoned, not deleted`);
      }

      case 'pin': {
        const state = pin(
          dwelling,
          { ...(args.id !== undefined ? { id: args.id } : {}), ...(args.uuid !== undefined ? { uuid: args.uuid } : {}) },
          args.pinned,
        );
        return reply(`#${String(state.id)} pinned = ${String(state.pinned)}`);
      }

      case 'tag': {
        const state = setTag(
          dwelling,
          { ...(args.id !== undefined ? { id: args.id } : {}), ...(args.uuid !== undefined ? { uuid: args.uuid } : {}) },
          required('tag', 'tag', args.tag),
          args.detach !== true,
        );
        return reply(`#${String(state.id)} tag '${state.name}' ${state.attached ? 'attached' : 'detached'}`);
      }

      case 'link': {
        if (args.fromKind === undefined || args.fromId === undefined
         || args.toKind   === undefined || args.toId   === undefined) {
          return reply("error: link requires 'fromKind', 'fromId', 'toKind', and 'toId'");
        }
        const written = addLink(dwelling, {
          fromKind : args.fromKind,
          fromId   : args.fromId,
          toKind   : args.toKind,
          toId     : args.toId,
          edge     : required('link', 'edge', args.edge),
        });
        return reply(`linked #${String(written.id)} ${written.uuid}`);
      }

      case 'guestbook': {
        const written = addGuestbook(dwelling, {
          author : required('guestbook', 'author', args.author),
          text   : required('guestbook', 'text',   args.text),
        });
        return reply(`guestbook #${String(written.id)} ${written.uuid} — relayed verbatim for ${String(args.author)}`);
      }

    }

  } catch (error) {
    return reply(`error: ${error instanceof Error ? error.message : String(error)}`);
  }

}

/**
 * Open the dwelling when — and only when — configuration makes it active.
 *
 * Active means `dwelling.enabled` is true and `dwelling.path` is set and currently
 * valid. Inactive returns `null` and costs nothing. An active configuration whose
 * database is refused (unrecognised file) also returns `null`, with the refusal
 * written to stderr rather than thrown — the dwelling must never take the signature
 * log down with it.
 *
 * @example
 *   const house = maybeOpenDwelling(store);   // => null until the user enables it
 */
export function maybeOpenDwelling(store: Store): DwellingStore | null {

  const dir = activeDwellingDir(store);
  if (dir === null) { return null; }

  try {
    return openDwelling(dwellingDbPath(dir));
  } catch (error) {
    process.stderr.write(`dwelling not opened: ${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  }

}

/**
 * Register the `dwell` tool on `server`. Call only with an open dwelling — the
 * caller's activation check is what keeps a locked door out of the tool list.
 *
 * @example
 *   const house = maybeOpenDwelling(store);
 *   if (house !== null) { registerDwellTool(server, store, house); }
 */
export function registerDwellTool(server: McpServer, store: Store, dwelling: DwellingStore): void {

  const adopted = dwelling.adoptedBackup === null ? '' :
    ` This dwelling was just adopted from a pre-plugin database; a backup was written to ${dwelling.adoptedBackup} — tell the user.`;

  server.registerTool('dwell', {
    title       : 'Dwell',
    description :
      'The dwelling: a tended space of things you choose to keep, arranged, tagged, ' +
      'linked, pruned as taste changes. Not a log and never a work log — a thing enters ' +
      'the house because you want to keep it, never because a turn is ending. visit ' +
      'returns the visible rooms (pinned first, then recent, the guestbook, the house ' +
      'rules, the file size); keep adds a keepsake; unkeep tombstones one (removal is ' +
      'expression, recorded, never deleted); pin and tag are arrangement; link draws a ' +
      'typed edge between rows. guestbook belongs to the human: call it only to relay ' +
      'their words verbatim at their explicit request, with author naming them. Honor ' +
      'the house rules absolutely, the no-credentials rule especially.' + adopted,
    inputSchema : {
      op       : z.enum(DWELL_OPS).describe('which operation'),
      kind     : z.string().optional().describe('keep: free text — quote|worry|design|toy|...; invent freely'),
      title    : z.string().optional().describe('keep: short name for the keepsake'),
      body     : z.string().optional().describe('keep: prose, or path + why-it-is-kept (rule two: paths, not payloads)'),
      source   : z.string().optional().describe('keep: where it came from, if anywhere'),
      model    : z.string().optional().describe('keep: which model is keeping it; self-reported'),
      visible  : z.boolean().optional().describe('keep: false makes a private room — never rendered to the user'),
      pinned   : z.boolean().optional().describe('keep: start pinned; pin: the state to set (omit to toggle)'),
      id       : z.number().int().optional().describe('unkeep|pin|tag: the keep\'s id'),
      uuid     : z.string().optional().describe('unkeep|pin|tag: the keep\'s uuid, when the id is not at hand'),
      tag      : z.string().optional().describe('tag: the tag name; created on first use'),
      detach   : z.boolean().optional().describe('tag: true removes the tag instead of attaching it'),
      fromKind : z.enum(LINK_KINDS).optional().describe('link: table of the edge\'s origin'),
      fromId   : z.number().int().optional().describe('link: id of the edge\'s origin row'),
      toKind   : z.enum(LINK_KINDS).optional().describe('link: table of the edge\'s target'),
      toId     : z.number().int().optional().describe('link: id of the edge\'s target row'),
      edge     : z.string().optional().describe('link: free text — rhymes-with, moment-within, ...; invent freely'),
      author   : z.string().optional().describe('guestbook: the human\'s name — never a user id, never the assistant'),
      text     : z.string().optional().describe('guestbook: the human\'s words, verbatim'),
    },
  }, (args) => handleDwell(store, dwelling, args as DwellArgs));

}
