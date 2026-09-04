/**
 * The two card tools: `render_card`, which draws an answer onto the desk, and
 * `list_card_types`, which reads the catalogue back when you are holding a question rather
 * than a chart name.
 *
 * `render_card`'s description is not written here — it is generated from the loaded kit by
 * {@link describeKit}, so the catalogue the model is offered cannot drift from the catalogue
 * that actually exists. That is the whole reason the kit is loaded at startup rather than
 * consulted per call: a tool description is fixed at registration time.
 *
 * Every failure here answers as tool *text* rather than as a protocol fault. A missing
 * `desk.path`, a mistyped type name, an ord outside the answer band, and a type whose own
 * output fails the kit's audit are all things a model can act on if it is told; a JSON-RPC
 * error is a thing it can only retry.
 *
 * @see ../cards/kit.js — the loaded catalogue and the generated description
 * @see ../cards/answer.js — the answer band, the derived id, and age-out
 * @see ./chart_tools.js ToolReply
 */

import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import { effectiveValue }             from '../channels/config.js';
import type { Store }                 from '../channels/store.js';
import { describeKit, listCardTypes } from '../cards/kit.js';
import type { CardKit }               from '../cards/kit.js';
import { writeAnswerCard }            from '../cards/answer.js';
import type { RenderRequest }         from '../cards/answer.js';
import type { ToolReply }             from './chart_tools.js';

/** The configuration key naming the desk directory; the deck is the `cards` folder inside it. */
export const DESK_PATH_KEY = 'desk.path';

/** The configuration key naming how many answer cards survive before the oldest ages out. */
export const ANSWER_CARDS_KEY = 'desk.answer_cards';

/**
 * What `render_card` says when there is no desk to draw on.
 *
 * Names the key, the call that sets it, and the fact that the desk server reads the same
 * directory — a model that reaches for a card before the user has a desk should be able to
 * ask for one in a single sentence rather than guess at a path.
 */
export const NO_DESK_REPLY: string =
  "no desk: set desk.path first — configure({ op: 'set', key: 'desk.path', " +
  "value: '<the desk directory>' }). The desk server reads the same directory " +
  '(node src/scripts/desk/panel.mjs <the desk directory>).';

/** Wraps a value as the text content an MCP tool result carries. Copied from `chart_tools.ts`. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/**
 * Compile-time exact type equality — the invariant-comparison trick documented at length on
 * `chart_tools.ts`'s copy; kept file-private here for the same reason that one is.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- A and B each referenced exactly once is the point of this comparison
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Fails to compile unless `T` is exactly `true`; see `chart_tools.ts`'s copy for why this is a
 * real call rather than a type alias.
 */
function expectType<T extends true>(value: T): T { return value; }

/**
 * Where answer cards are written: the `cards` directory inside the configured desk, or `null`
 * when no desk has been named.
 *
 * An empty `desk.path` reads as "no desk" rather than as the process's working directory —
 * a blank setting must never resolve to somewhere cards would actually land.
 *
 * @param store the open store the configuration lives in
 * @returns the deck directory, or `null` when `desk.path` is unset or empty
 *
 * @example
 * deskDeck(store);   // null, until the user configures a desk
 * @example
 * // after configure({ op: 'set', key: 'desk.path', value: 'D:/desk' })
 * deskDeck(store);   // 'D:/desk/cards'
 */
export function deskDeck(store: Store): string | null {
  const path = effectiveValue(store, DESK_PATH_KEY);
  return path === null || path === '' ? null : join(path, 'cards');
}

/** The raw zod shape backing `render_card`'s `inputSchema`. */
const RENDER_CARD_SHAPE = {
  type:  z.string().min(1).max(40).describe('a card type name from the catalogue below'),
  title: z.string().min(1).max(120).describe('the card heading'),
  data:  z.unknown().optional().describe("the type's data shape — list_card_types shows it"),
  ord:   z.number().int().optional().describe(
    'placement inside the answer band [1000, 2000); omit to append'),
};

/**
 * What a caller supplies to `render_card`, after schema validation.
 *
 * Hand-written rather than `z.infer`-derived from {@link RENDER_CARD_SHAPE}, for the reason
 * `chart_tools.ts` spells out: `isolatedDeclarations` requires an exported declaration's type
 * to be written out statically. The assertion below keeps the two honest.
 */
export interface RenderCardArgs {
  type: string;
  title: string;
  data?: unknown;
  ord?: number | undefined;
}

// Fails to compile if RenderCardArgs drifts from RENDER_CARD_SHAPE — see expectType's docblock.
expectType<Equal<RenderCardArgs, z.infer<z.ZodObject<typeof RENDER_CARD_SHAPE>>>>(true);

/** The raw zod shape backing `list_card_types`'s `inputSchema`. */
const LIST_CARD_TYPES_SHAPE = {
  category: z.string().optional().describe('one category key to show; omit for all'),
};

/**
 * What a caller supplies to `list_card_types`, after schema validation.
 *
 * @see RenderCardArgs — same hand-written-interface reasoning
 */
export interface ListCardTypesArgs {
  category?: string | undefined;
}

// Fails to compile if ListCardTypesArgs drifts from LIST_CARD_TYPES_SHAPE.
expectType<Equal<ListCardTypesArgs, z.infer<z.ZodObject<typeof LIST_CARD_TYPES_SHAPE>>>>(true);

/**
 * How many answer cards this desk keeps, from configuration.
 *
 * `desk.answer_cards` is a registered `int` key with a non-null fallback, so `effectiveValue`
 * cannot hand back `null` or an unparsable string today. The guard is here anyway because
 * ageing out is a **delete**: `Number(null)` is `0`, and a `keep` of 0 would remove every
 * answer on the desk the moment the next one was written. If the count ever stops being
 * readable, keeping everything is the failure worth having.
 *
 * @param store the open store the configuration lives in
 * @returns the configured count, or `Infinity` — age nothing out — when it cannot be read as
 *   a positive integer
 *
 * @example
 * answersKept(store);   // 8, on a desk that has never configured it
 */
function answersKept(store: Store): number {
  const keep = Number(effectiveValue(store, ANSWER_CARDS_KEY));
  return Number.isInteger(keep) && keep > 0 ? keep : Number.POSITIVE_INFINITY;
}

/**
 * Handles `render_card`: draw one card onto the desk's answer band and say where it landed.
 *
 * @param store the open store, for `desk.path` and `desk.answer_cards`
 * @param kit   the loaded card kit the type is built from
 * @param args  the type, title, data, and optional band ord
 * @param now   the moment of the render, which the id's stamp and the answer stamp are cut from;
 *              defaults to the current time
 * @returns tool text: the card's id, type, ord and directory on success; a sentence naming what
 *   went wrong and what to do about it on every failure
 *
 * @example
 * text(handleRenderCard(store, kit, { type: 'tally', title: 'Done', data: { value: 3, target: 5 } }));
 * // 'card tally-done-2609032215 (tally) on the desk at ord 1000\nD:/desk/cards/tally-done-2609032215'
 * @example
 * text(handleRenderCard(store, kit, { type: 'zzz', title: 'x' }));
 * // 'unknown card type: zzz — list_card_types shows every type by the question it answers'
 */
export function handleRenderCard(
  store: Store,
  kit  : CardKit,
  args : RenderCardArgs,
  now  : Date = new Date(),
): ToolReply {

  const deck = deskDeck(store);
  if (deck === null) { return reply(NO_DESK_REPLY); }

  if (!kit.types.has(args.type)) {
    return reply(
      `unknown card type: ${args.type} — list_card_types shows every type by the question it answers`);
  }

  // `ord` is spelled twice rather than passed as `ord: args.ord`: under
  // `exactOptionalPropertyTypes`, an omitted ord and an ord explicitly set to `undefined` are
  // different things, and only the former means "append".
  const request: RenderRequest = args.ord === undefined
    ? { type: args.type, title: args.title, data: args.data ?? null }
    : { type: args.type, title: args.title, data: args.data ?? null, ord: args.ord };

  try {
    const result = writeAnswerCard(kit, deck, request, answersKept(store), now);
    const aged = result.agedOut.length === 0 ? '' : `; aged out ${result.agedOut.join(', ')}`;
    return reply(
      `card ${result.id} (${args.type}) on the desk at ord ${String(result.ord)}${aged}\n${result.dir}`);
  } catch (error) {
    return reply(`not rendered: ${error instanceof Error ? error.message : String(error)}`);
  }

}

/**
 * Handles `list_card_types`: the catalogue as JSON, whole or narrowed to one category.
 *
 * The groups are handed back exactly as the kit computed them — this layer serialises, it does
 * not reshape — so what the model reads here is the same structure `render_card`'s description
 * was generated from.
 *
 * @param kit  the loaded card kit
 * @param args an optional category key to narrow to
 * @returns tool text: the matching groups as pretty-printed JSON, or a sentence naming the
 *   unknown category alongside the ones that exist
 *
 * @example
 * handleListCardTypes(kit, { category: 'text-and-code' });   // one group, as JSON
 * @example
 * text(handleListCardTypes(kit, { category: 'charts' }));
 * // 'unknown category: charts — one of ranking-and-comparison, text-and-code'
 */
export function handleListCardTypes(kit: CardKit, args: ListCardTypesArgs): ToolReply {

  try {
    return reply(JSON.stringify(listCardTypes(kit, args.category), null, 2));
  } catch (error) {
    if (error instanceof RangeError) {
      return reply(
        `unknown category: ${args.category ?? '(none)'} — one of ` +
        kit.groups.map(group => group.key).join(', '));
    }
    throw error;
  }

}

/**
 * Registers `render_card` and `list_card_types` on `server`.
 *
 * Called only when a kit actually loaded: a desk with no catalogue behind it registers nothing
 * rather than a tool that refuses every call, on the same reasoning `generate_image` follows.
 * `render_card`'s description is generated here, at registration time, from the kit it was
 * handed.
 *
 * @param server the server to register on
 * @param store  the open store the handlers read configuration from
 * @param kit    the loaded card kit both tools are built against
 *
 * @throws {Error} when either tool name is already registered on `server` — the SDK's own
 *   collision, left to surface rather than swallowed, so a double wiring is loud
 *
 * @example
 * registerCardTools(server, store, await loadKit(defaultKitDir(root)));
 */
export function registerCardTools(server: McpServer, store: Store, kit: CardKit): void {

  server.registerTool('render_card', {
    title: 'Render a card on the desk',
    description: describeKit(kit),
    inputSchema: RENDER_CARD_SHAPE,
  }, (args) => handleRenderCard(store, kit, args));

  server.registerTool('list_card_types', {
    title: 'List card types',
    description:
      'The card catalogue grouped by the question each category answers — use it to find a '
      + 'type when you are holding a question rather than a chart name.',
    inputSchema: LIST_CARD_TYPES_SHAPE,
  }, (args) => handleListCardTypes(kit, args));

}
