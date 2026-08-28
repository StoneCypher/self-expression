/**
 * The MCP checklist tool surface: the status-checklist logger and validator, ported
 * from the old skill's `log-checklist.mjs` and `check-checklist.mjs` Bash-plus-scratch-
 * file flow into three tools (issue #10).
 *
 * What the port deletes: the scratch-file JSON payload, the `--file` flag that existed
 * only because heredocs break permission prefix matching, and the hardcoded install
 * paths in permission rules — a tool is permissioned by name. What it adds: the trend
 * series comes back in the log reply, so the sparkline is computed from the record
 * rather than remembered, and the checklist rows land in the same `entries` table as
 * every other channel instead of a second database.
 *
 * The series is keyed by `seriesKey`, which is required and explicit — chosen once at
 * the checklist's first render and repeated verbatim on every re-render, never the
 * display title. The old logger keyed on the title, which silently forked the series
 * whenever a checklist was renamed (issue #27); #54 made the explicit stable key the
 * record's contract, and this tool holds the same line rather than reintroducing the
 * title default it replaced.
 *
 * Handler bodies are exported as pure functions separate from registration, matching
 * `chart_tools.ts`, so they can be exercised in tests without a transport.
 *
 * @see ./chart_tools.js
 * @see ./tools.js
 * @see ../charts/verify.js
 * @see ../channels/entries.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';

import { verifyChecklist, parseSummaryCounts } from '../charts/verify.js';
import { recordEntry, recentChecklists, seriesPercents } from '../channels/entries.js';
import { latestContext } from '../channels/context.js';
import { privacyFlags }  from '../channels/privacy.js';
import { FORMAT_VERSION, effectiveValue } from '../channels/config.js';
import { stamp }         from '../channels/time.js';
import type { Store }     from '../channels/store.js';
import type { ToolReply } from './chart_tools.js';

/**
 * Compile-time exact type equality — the same invariant comparison `chart_tools.ts`
 * documents at length; copied rather than imported because the house pattern keeps
 * these tiny helpers local to whichever file needs them.
 *
 * `A` and `B` each appear exactly once in the body by necessity — that is the whole
 * shape of this comparison — so `no-unnecessary-type-parameters` is disabled for this
 * one declaration.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- A and B each referenced exactly once is the point of this comparison
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Fails to compile unless `T` is exactly `true`; otherwise returns what it was given.
 * Called once per `*Args`/`*_SHAPE` pair, exactly as in `chart_tools.ts`.
 */
function expectType<T extends true>(value: T): T { return value; }

/** Wraps a value as the text content an MCP tool result carries. Copied from `tools.ts`. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/** What the MCP handshake reports about the connected host. */
interface ClientIdentity {
  readonly name?    : string | undefined;
  readonly version? : string | undefined;
}

// ---------------------------------------------------------------------------------
// log_checklist
// ---------------------------------------------------------------------------------

/** The raw zod shape backing `log_checklist`'s `inputSchema`. */
const LOG_CHECKLIST_SHAPE = {
  block: z.string().min(1).describe(
    'the rendered checklist block, summary line included — the fenced-block content, ' +
    'exactly as surfaced'),
  title: z.string().min(1).describe(
    "the checklist's display title; free to change between renders"),
  seriesKey: z.string().min(1).describe(
    'stable identifier grouping re-renders into one trend series; chosen once at the ' +
    "checklist's first render and repeated verbatim on every re-render — never the " +
    'display title, which may be reworded freely without splitting the series'),
  project: z.string().optional().describe('narrows the series when titles collide across projects'),
  session: z.string().optional().describe(
    'usually omit — the hook supplies it, and an observed session beats a claimed one'),
  promptId: z.string().optional().describe('turn identifier; groups a turn'),
};

/**
 * What a caller supplies to `log_checklist`, after schema validation.
 *
 * Hand-written rather than `z.infer`-derived for the same `isolatedDeclarations`
 * reason as `chart_tools.ts`'s `SeriesArgs`; kept honest against
 * {@link LOG_CHECKLIST_SHAPE} by the `expectType` assertion below.
 */
export interface LogChecklistArgs {
  block: string;
  title: string;
  seriesKey: string;
  project?: string | undefined;
  session?: string | undefined;
  promptId?: string | undefined;
}

// Fails to compile if LogChecklistArgs drifts from LOG_CHECKLIST_SHAPE.
expectType<Equal<LogChecklistArgs, z.infer<z.ZodObject<typeof LOG_CHECKLIST_SHAPE>>>>(true);

/**
 * Handles `log_checklist`: records one rendered checklist as a `checklist` channel
 * entry, and replies with the timestamp plus the series' full percent history — this
 * row included — so the next trend render is derived from the record, not from memory.
 *
 * The summary triple and percent are parsed out of the block rather than accepted as
 * arguments, exactly as the old logger did: a block without a parseable
 * `S/A/F items (P%)` line is rejected with an `error:` reply (never a protocol fault),
 * because a checklist that was never summarized has no business in the trend series.
 *
 * Context the hook observed (session, turn, effort, cwd, and the rest) is adopted for
 * anything the caller did not supply, mirroring the `express` tool — including the
 * second privacy gate on the path-carrying fields, and the declarative
 * `format.version` stamp (issue #30, D7): a checklist row is an entry row, and the
 * convention label must never be NULL on any writer's rows.
 *
 * @param store         the open store to record into
 * @param pluginVersion stamped onto the row, as on every entry
 * @param args           the validated tool arguments
 * @param client         what the MCP handshake reported about the host, if anything
 *
 * @example
 *   handleLogChecklist(store, '0.2.1', {
 *     block: '- ✅ shipped\n- ❌ broke\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1',
 *     title: 'Release 12',
 *     seriesKey: 'release-12',
 *   })
 *   // => { content: [{ type: 'text', text: "[9:14 am PDT] recorded #7 …\nseries 'release-12': 50" }] }
 *
 * @see ../charts/verify.js parseSummaryCounts
 */
export function handleLogChecklist(
  store         : Store,
  pluginVersion : string,
  args          : LogChecklistArgs,
  client?       : ClientIdentity,
): ToolReply {

  const summary = parseSummaryCounts(args.block);
  if (summary === null) {
    return reply(
      "error: log_checklist requires 'block' to contain a `S/A/F items (P%)` summary " +
      'line — render the checklist (see render_checklist_summary) before logging it'
    );
  }

  const context = latestContext(store, args.session),
        privacy = privacyFlags(store),
        str     = (k: string): string | undefined => {
          const v = context?.[k];
          return typeof v === 'string' && v !== '' ? v : undefined;
        },
        num     = (k: string): number | undefined => {
          const v = context?.[k];
          return typeof v === 'number' ? v : undefined;
        };

  const when = new Date();

  // Anything the caller supplied wins; everything else is adopted from what the hook
  // observed, with the same 'no-hook' sentinel and privacy re-gate as `express`.
  const written = recordEntry(store, {
    channel        : 'checklist',
    text           : args.block,
    title          : args.title,
    seriesKey      : args.seriesKey,
    succ           : summary.success,
    active         : summary.active,
    fail           : summary.failure,
    percent        : summary.percent,
    session        : args.session ?? str('session') ?? 'no-hook',
    promptId       : args.promptId ?? str('prompt_id'),
    turn           : str('turn') as never,
    effort         : str('effort') as never,
    turnIndex      : num('turn_index'),
    cwd            : privacy.storeCwd ? str('cwd') : undefined,
    gitBranch      : privacy.storeCwd ? str('git_branch') : undefined,
    project        : privacy.storeCwd ? args.project : undefined,
    permissionMode : str('permission_mode'),
    agentId        : str('agent_id'),
    agentType      : str('agent_type'),
    compactions    : num('compactions'),
    host           : client?.name,
    hostVersion    : client?.version,
    formatVersion  : effectiveValue(store, 'format.version') ?? FORMAT_VERSION,
  }, pluginVersion, when);

  const series = seriesPercents(store, args.seriesKey);

  return reply(
    `[${stamp(when).local}] recorded #${String(written.id)} ${written.uuid}\n` +
    `series '${args.seriesKey}': ${series.join(' ')}`
  );

}

// ---------------------------------------------------------------------------------
// recall_checklists
// ---------------------------------------------------------------------------------

/** The raw zod shape backing `recall_checklists`'s `inputSchema`. */
const RECALL_CHECKLISTS_SHAPE = {
  seriesKey: z.string().optional().describe(
    "also return this series' chronological percent history, exactly as stored"),
  limit: z.number().int().min(1).max(100).optional().describe(
    'how many recent checklist rows to return; defaults to 10'),
};

/**
 * What a caller supplies to `recall_checklists`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link LogChecklistArgs};
 * kept honest against {@link RECALL_CHECKLISTS_SHAPE} the same way.
 */
export interface RecallChecklistsArgs {
  seriesKey?: string | undefined;
  limit?: number | undefined;
}

// Fails to compile if RecallChecklistsArgs drifts from RECALL_CHECKLISTS_SHAPE.
expectType<Equal<RecallChecklistsArgs, z.infer<z.ZodObject<typeof RECALL_CHECKLISTS_SHAPE>>>>(true);

/**
 * Handles `recall_checklists`: the read half of the old logger (`tail` and `series`
 * ops) as one tool — recent checklist rows, plus one series' percent history when a
 * `seriesKey` is named.
 *
 * @param store the store to read from
 * @param args   the validated tool arguments
 *
 * @example
 *   handleRecallChecklists(store, { seriesKey: 'coverage', limit: 5 })
 *   // => { content: [{ type: 'text', text: '{ "recent": […], "series": [62, 71, 84] }' }] }
 */
export function handleRecallChecklists(store: Store, args: RecallChecklistsArgs): ToolReply {

  const recent = recentChecklists(store, args.limit ?? 10);

  if (args.seriesKey === undefined) {
    return reply(JSON.stringify({ recent }, null, 2));
  }

  return reply(JSON.stringify({ recent, series: seriesPercents(store, args.seriesKey) }, null, 2));

}

// ---------------------------------------------------------------------------------
// check_checklist
// ---------------------------------------------------------------------------------

/** The raw zod shape backing `check_checklist`'s `inputSchema`. */
const CHECK_CHECKLIST_SHAPE = {
  block: z.string().min(1).describe(
    'the rendered checklist to validate — a bare block, or a Markdown document ' +
    'containing one fenced block (the first fence pair is used)'),
};

/**
 * What a caller supplies to `check_checklist`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link LogChecklistArgs};
 * kept honest against {@link CHECK_CHECKLIST_SHAPE} the same way.
 */
export interface CheckChecklistArgs {
  block: string;
}

// Fails to compile if CheckChecklistArgs drifts from CHECK_CHECKLIST_SHAPE.
expectType<Equal<CheckChecklistArgs, z.infer<z.ZodObject<typeof CHECK_CHECKLIST_SHAPE>>>>(true);

/**
 * Handles `check_checklist`: runs the full validator over a rendered checklist and
 * replies with its report — one `FAIL:` line per broken rule, or a clean bill.
 *
 * Pure passthrough to {@link verifyChecklist}; a failing checklist is a normal reply,
 * not an error, because the report *is* the answer being asked for.
 *
 * @param args the validated tool arguments
 *
 * @example
 *   handleCheckChecklist({ block: '- ✅ a\n- ❌ b\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1' })
 *   // => { content: [{ type: 'text', text: 'ok: 2 items parsed\nok: all checks passed' }] }
 */
export function handleCheckChecklist(args: CheckChecklistArgs): ToolReply {
  return reply(verifyChecklist(args.block).report);
}

// ---------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------

/**
 * Registers the three checklist tools on `server`.
 *
 * `pluginVersion` is stamped onto each logged row, exactly as `registerTools` does for
 * the expression channels.
 *
 * @example
 *   const server = new McpServer({ name: 'self-expression', version: '0.2.1' });
 *   registerChecklistTools(server, store, '0.2.1');
 */
export function registerChecklistTools(server: McpServer, store: Store, pluginVersion: string): void {

  server.registerTool('log_checklist', {
    title       : 'Log checklist',
    description :
      'Record one rendered status checklist so its re-renders form a queryable trend ' +
      'series. Pass the full block, summary line included — the S/A/F counts and ' +
      'percent are parsed out of it, and a block with no summary line is rejected. The ' +
      "reply carries the series' full percent history, so the next trend sparkline is " +
      'computed from the record instead of remembered. seriesKey is the series identity: ' +
      'chosen once at the first render and repeated verbatim on every re-render — never ' +
      'the display title, which may change freely.',
    inputSchema : LOG_CHECKLIST_SHAPE,
  }, (args) => handleLogChecklist(store, pluginVersion, args, server.server.getClientVersion()));

  server.registerTool('recall_checklists', {
    title       : 'Recall checklists',
    description :
      'Read back logged checklists: the most recent rows, and — when seriesKey is ' +
      "given — that series' chronological percent history. Use before re-rendering a " +
      'checklist so the trend comes from the record rather than from memory, which ' +
      'degrades quietly.',
    inputSchema : RECALL_CHECKLISTS_SHAPE,
  }, (args) => handleRecallChecklists(store, args));

  server.registerTool('check_checklist', {
    title       : 'Check checklist',
    description :
      'Validate a rendered status checklist mechanically: marker vocabulary, ' +
      'indentation, bucket partition (🛳️ may count as success or active), percent, ' +
      'the 10-cell anti-aliased bar, and the icon-list sort, wrap, and placement ' +
      'rules. Replies with one FAIL line per broken rule, or a clean bill. Use it on ' +
      'any checklist assembled or edited by hand rather than rendered by ' +
      'render_checklist_summary.',
    inputSchema : CHECK_CHECKLIST_SHAPE,
  }, (args) => handleCheckChecklist(args));

}
