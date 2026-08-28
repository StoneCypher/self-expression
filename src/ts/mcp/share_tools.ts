/**
 * The `share` MCP tool: preview, export, and status for public aggregation (#31).
 *
 * A thin wrapper by design — every row that leaves the machine is shaped by
 * `channels/public_export.ts`, the single enforcement point; this module never touches
 * a column itself. Its one piece of state is the preview gate: the `export` verb
 * refuses unless a preview was rendered for the same options in this server session,
 * making "the user saw exactly what goes" mechanical rather than aspirational.
 *
 * v1 deliberately ships no transport: `export` produces a local JSON document (a file
 * when `path` is given, tool text otherwise) the user can inspect and send however
 * they choose.
 *
 * @see ../channels/public_export.js
 */

import { writeFileSync } from 'node:fs';
import { McpServer }     from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }             from 'zod';

import {
  exportPublicRows, previewPublicExport, freshSalt, shareWindow,
} from '../channels/public_export.js';
import type { TimeGranularity } from '../channels/public_export.js';
import { effectiveValue }       from '../channels/config.js';
import type { Store }           from '../channels/store.js';
import type { ToolReply }       from './chart_tools.js';

/** Wraps a value as the text content an MCP tool result carries. Copied from `tools.ts`. */
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/**
 * What a caller supplies to `share`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as the other tool argument
 * interfaces; the registration call site keeps it honest against the zod shape.
 */
export interface ShareArgs {
  readonly op           : 'preview' | 'export' | 'status';
  readonly granularity? : TimeGranularity | undefined;
  readonly path?        : string | undefined;
}

/**
 * The per-server-session preview gate: which option sets have been previewed.
 *
 * Deliberately in-memory and per-process — a preview seen last week does not count as
 * seeing *this* export, so the gate resets with the server.
 */
export interface ShareSession {
  readonly previewed : Set<TimeGranularity>;
}

/**
 * A fresh preview-gate state, one per server process.
 *
 * @example
 *   const session = makeShareSession();
 *   session.previewed.has('hour')  // => false until a preview renders
 */
export function makeShareSession(): ShareSession {
  return { previewed: new Set<TimeGranularity>() };
}

/**
 * The granularity in force: the explicit argument when given, else the configured
 * `share.time_granularity`, else `hour`.
 *
 * Read tolerantly — anything but exactly `'day'` resolves to `hour`, the default the
 * spec names.
 *
 * @example
 *   resolveGranularity(store, 'day')      // => 'day'
 *   resolveGranularity(store, undefined)  // => 'hour' on a fresh install
 */
export function resolveGranularity(store: Store, argument: TimeGranularity | undefined): TimeGranularity {
  if (argument !== undefined) { return argument; }
  return effectiveValue(store, 'share.time_granularity') === 'day' ? 'day' : 'hour';
}

/**
 * Handles `share`: render the preview, produce the export, or report opt-in status.
 *
 * The verbs enforce the #31 ordering: `preview` renders the exporter's actual output
 * and unlocks `export` for the same granularity in this session; `export` refuses —
 * with an `error: ` reply in the `configure` style, writing nothing — when sharing is
 * not affirmatively on, when no opt-in moment is on record, or when no preview for
 * these options has been rendered; `status` reports the gate's facts without touching
 * a row.
 *
 * @param store         the local database
 * @param session       the per-process preview gate from {@link makeShareSession}
 * @param pluginVersion stamped into the export's meta block
 * @param args          the validated tool arguments
 *
 * @example
 *   handleShare(store, session, '0.2.1', { op: 'preview' })
 *   // => { content: [{ type: 'text', text: 'public export preview — …' }] }
 *   handleShare(store, session, '0.2.1', { op: 'export' })
 *   // => the full JSON submission document, now that the preview above unlocked it
 *
 * @see ../channels/public_export.js exportPublicRows
 */
export function handleShare(
  store         : Store,
  session       : ShareSession,
  pluginVersion : string,
  args          : ShareArgs,
): ToolReply {

  const granularity = resolveGranularity(store, args.granularity);

  if (args.op === 'preview') {
    const preview = previewPublicExport(store, { granularity, pluginVersion });
    session.previewed.add(granularity);
    return reply(preview.rendered);
  }

  if (args.op === 'status') {
    const window = shareWindow(store),
          count  = exportPublicRows(store, freshSalt(), { granularity, pluginVersion }).meta.row_count;
    return reply(JSON.stringify({
      share_enabled    : window.enabled,
      opted_in_utc     : window.optedInUtc,
      time_granularity : granularity,
      eligible_rows    : count,
      previewed        : [...session.previewed],
    }, null, 2));
  }

  // op === 'export'
  const window = shareWindow(store);

  if (!window.enabled) {
    return reply(
      'error: sharing is off — public aggregation is opt-in and off by default. ' +
      "set share.enabled to exactly 'true' with the configure tool to opt in; nothing was exported");
  }

  if (window.optedInUtc === null) {
    return reply(
      'error: no opt-in moment is on record, so no rows are eligible. ' +
      're-set share.enabled to true to record one; nothing was exported');
  }

  if (!session.previewed.has(granularity)) {
    return reply(
      `error: no preview has been rendered for granularity '${granularity}' in this session — ` +
      'every export requires seeing exactly what would be sent first. ' +
      "run share with op 'preview', then export; nothing was exported");
  }

  const document = exportPublicRows(store, freshSalt(), { granularity, pluginVersion }),
        json     = JSON.stringify(document, null, 2);

  if (args.path === undefined) { return reply(json); }

  try {
    writeFileSync(args.path, json);
  } catch (error) {
    return reply(`error: could not write ${args.path}: ${String(error)}; nothing was exported`);
  }

  return reply(
    `exported ${String(document.meta.row_count)} rows (submission ${document.meta.submission_id}, ` +
    `granularity ${granularity}) to ${args.path}`);

}

/**
 * Register the `share` tool on `server`, with a fresh preview gate for this process.
 *
 * @example
 *   registerShareTools(server, store, '0.2.1');
 */
export function registerShareTools(server: McpServer, store: Store, pluginVersion: string): void {

  const session = makeShareSession();

  server.registerTool('share', {
    title       : 'Share',
    description :
      'Preview, export, or check the status of the public-aggregation export. ' +
      'Structured fields only, never free text: every column is shaped by an allowlist ' +
      '(verbatim closed vocabularies, coarsened counts and times, per-submission salted ' +
      'hashes, validated derivations) and everything unlisted stays on the machine. ' +
      'Off by default; opt-in is an event and never retroactive. preview renders exactly ' +
      'what an export would produce; export refuses until a preview for the same options ' +
      'has been seen this session, then emits one JSON document (to path when given). ' +
      'No network transport exists in v1 — the user sends the file, or does not.',
    inputSchema : {
      op          : z.enum(['preview', 'export', 'status']).describe(
        'preview renders the actual export output; export produces it; status reports the opt-in gate'),
      granularity : z.enum(['hour', 'day']).optional().describe(
        "timestamp coarsening for this run; defaults to the share.time_granularity config key, else 'hour'"),
      path        : z.string().optional().describe(
        'export only: write the JSON document to this file instead of returning it as text'),
    },
  }, (args) => handleShare(store, session, pluginVersion, args));

}
