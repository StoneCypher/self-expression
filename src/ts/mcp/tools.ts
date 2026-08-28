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
  FORECAST_OUTCOMES, SILENCE_KINDS,
} from '../channels/vocabulary.js';
import type {
  Channel, Position, Delta, Stem, Turn, Effort,
  ConfidenceGround, DivergenceKind, Modality,
  ForecastOutcome, SilenceKind,
} from '../channels/vocabulary.js';
import { recordEntry, recentEntries, previousSignature, hasClosingSignature } from '../channels/entries.js';
import { readConfig, writeConfig, deleteConfig }                              from '../channels/store.js';
import { FORMAT_VERSION, configKey, effectiveValue, effectiveConfig }         from '../channels/config.js';
import { latestContext }                                                     from '../channels/context.js';
import { privacyFlags }                                                      from '../channels/privacy.js';
import type { Store }     from '../channels/store.js';
import type { ToolReply } from './chart_tools.js';

/** Config key holding the comma-separated list of active channels. */
export const ENABLED_KEY = 'channels.enabled';

/** Config key for the forecast feature; only an effective 'false' disables it (#42). */
export const FORECAST_KEY = 'forecast.enabled';

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
 * Which confidence grounds are currently offered.
 *
 * The forecast toggle cannot ride `channels.enabled` because a ground is not a
 * channel, so it gets the same schema-baking treatment: when `forecast.enabled`
 * resolves to `'false'` (through the tolerant effective-value accessor, so an invalid
 * override behaves as unset), the enum handed to the model omits `'predicted'` — a
 * disabled forecast cannot even be named, so no attention is spent producing one.
 * Default is on, per the issue-thread verdict.
 *
 * @example
 *   enabledConfidenceGrounds(store)   // => all CONFIDENCE_GROUNDS, when unconfigured
 *   // after configure set forecast.enabled false:
 *   enabledConfidenceGrounds(store)   // => the grounds minus 'predicted'
 *
 * @see enabledChannels
 */
export function enabledConfidenceGrounds(store: Store): readonly ConfidenceGround[] {
  return effectiveValue(store, FORECAST_KEY) === 'false'
    ? CONFIDENCE_GROUNDS.filter(g => g !== 'predicted')
    : CONFIDENCE_GROUNDS;
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
function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

/** What the MCP handshake reports about the connected host. */
interface ClientIdentity {
  readonly name?    : string | undefined;
  readonly version? : string | undefined;
}

/**
 * What a caller supplies to `express`, after schema validation.
 *
 * Hand-written rather than `z.infer`-derived because the zod shape is built at
 * registration time — its `channel` enum is narrowed to the enabled set — so there is
 * no static shape to infer from. The registration call site keeps this honest: the
 * inferred handler arguments must be assignable here or `registerTools` stops
 * compiling.
 */
export interface ExpressArgs {
  readonly channel         : Channel;
  readonly text            : string;
  readonly session?        : string | undefined;
  readonly promptId?       : string | undefined;
  readonly position?       : Position | undefined;
  readonly delta?          : Delta | undefined;
  readonly face?           : string | undefined;
  readonly contextEmoji?   : string | undefined;
  readonly stem?           : Stem | undefined;
  readonly uncertain?      : boolean | undefined;
  readonly modality?       : Modality | undefined;
  readonly confidence?     : ConfidenceGround | undefined;
  readonly divergenceKind? : DivergenceKind | undefined;
  readonly resolveBy?      : string | undefined;
  readonly outcome?        : ForecastOutcome | undefined;
  readonly silence?        : SilenceKind | undefined;
  readonly visible?        : boolean | undefined;
  readonly correctsId?     : number | undefined;
  readonly effort?         : Effort | undefined;
  readonly turn?           : Turn | undefined;
  readonly model?          : string | undefined;
  readonly cctype?         : string | undefined;
  readonly project?        : string | undefined;
  readonly seriesKey?      : string | undefined;
  readonly title?          : string | undefined;
  readonly succ?           : number | undefined;
  readonly active?         : number | undefined;
  readonly fail?           : number | undefined;
  readonly percent?        : number | undefined;
}

/**
 * Handles `express`: records one expression, adopting hook-observed context for
 * anything the caller did not supply and stamping the row's provenance.
 *
 * Exported separately from registration, matching `checklist_tools.ts`, so tests can
 * exercise the real write path without a transport. Every row is stamped with the
 * effective `format.version` — the configured override when one validates, else the
 * {@link FORMAT_VERSION} constant — a declarative label of the recording convention in
 * force, never a behavioral switch (issue #30, D7).
 *
 * @param store         the open store to record into
 * @param pluginVersion stamped onto the row, as on every entry
 * @param args          the validated tool arguments
 * @param client        what the MCP handshake reported about the host, if anything
 *
 * An `outcome` is additionally checked against the store (the half of forecast
 * validation `entries.validate` cannot do alone, #42): its `correctsId` must name an
 * existing row whose confidence is `'predicted'`, or the rejection names the target's
 * actual ground.
 *
 * @example
 *   handleExpress(store, '0.2.1', { channel: 'need', text: 'merge #21?' })
 *   // => { content: [{ type: 'text', text: 'recorded #1 …' }] }
 *
 * @throws {Error} If entry validation fails — a closed field outside its vocabulary,
 *                 a cross-field forecast violation, or an outcome whose target is not
 *                 a `predicted` row — naming every problem and the values that would
 *                 have been accepted.
 *
 * @see ../channels/entries.js recordEntry
 */
export function handleExpress(
  store         : Store,
  pluginVersion : string,
  args          : ExpressArgs,
  client?       : ClientIdentity,
): ToolReply {

  if (args.outcome !== undefined && args.correctsId !== undefined) {
    const target = store.db.prepare('SELECT confidence FROM entries WHERE id = ?').get(args.correctsId);
    if (target === undefined) {
      throw new Error(
        `cannot record entry:\n  - outcome's correctsId #${String(args.correctsId)} does not exist`);
    }
    const ground = target['confidence'];
    if (ground !== 'predicted') {
      throw new Error(
        `cannot record entry:\n  - entry #${String(args.correctsId)} is not a forecast — its ` +
        `confidence is ${ground === null ? 'unset' : `'${String(ground)}'`}, not 'predicted', ` +
        'so there is nothing for an outcome to resolve');
    }
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

  // Anything the caller supplied wins; everything else is adopted from what the hook
  // observed. A row that reaches here with no context at all is marked 'no-hook'
  // rather than given a plausible-looking session, so the gap is visible in the data
  // instead of being disguised as an ordinary row.
  //
  // The path-carrying fields (cwd, git_branch, project) and the prompt length are gated
  // on the privacy config a second time here: the hook already drops them at capture, but
  // a direct express call carries its own project argument and must not be able to smuggle
  // one in when the user has opted out.
  const written = recordEntry(store, {
    ...args,
    session        : args.session ?? str('session') ?? 'no-hook',
    promptId       : args.promptId ?? str('prompt_id'),
    turn           : args.turn     ?? (str('turn') as never),
    effort         : args.effort   ?? (str('effort') as never),
    turnIndex      : num('turn_index'),
    cwd            : privacy.storeCwd ? str('cwd') : undefined,
    gitBranch      : privacy.storeCwd ? str('git_branch') : undefined,
    project        : privacy.storeCwd ? args.project : undefined,
    permissionMode : str('permission_mode'),
    agentId        : str('agent_id'),
    agentType      : str('agent_type'),
    compactions    : num('compactions'),
    promptLen      : privacy.storePromptLen ? num('prompt_len') : undefined,
    host           : client?.name,
    hostVersion    : client?.version,
    formatVersion  : effectiveValue(store, 'format.version') ?? FORMAT_VERSION,
  }, pluginVersion);

  return reply(`recorded #${String(written.id)} ${written.uuid}`);

}

/**
 * What a caller supplies to `configure`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as the checklist tools'
 * argument interfaces; the registration call site keeps it honest against the zod
 * shape.
 */
export interface ConfigureArgs {
  readonly op     : 'get' | 'set' | 'unset' | 'list';
  readonly key?   : string | undefined;
  readonly value? : string | undefined;
}

/**
 * Handles `configure`: typed, validated writes over the config table, plus the
 * effective-configuration report.
 *
 * The four ops implement issue #30's D2–D4:
 *
 * - `set` on a registered key runs its validator and stores the canonical text; an
 *   invalid value is rejected with a reply naming the key's kind and what would have
 *   been accepted, and **nothing is written**. An unknown key is stored as given, with
 *   a stated warning — a typo surfaces at the moment of writing, while a newer
 *   version's keys still work.
 * - `unset` deletes the override so the code default applies again — including a
 *   future changed default. A no-op when nothing was set; on an unknown key it removes
 *   any row present.
 * - `get` returns the stored override, or says which code default applies.
 * - `list` reports the **effective** configuration: every registered key with its
 *   value and source, plus unknown override rows labeled as such.
 *
 * @example
 *   handleConfigure(store, { op: 'set', key: 'retention.days', value: '90' })
 *   // => { content: [{ type: 'text', text: 'retention.days = 90' }] }
 *   handleConfigure(store, { op: 'set', key: 'retention.days', value: 'sometimes' })
 *   // => { content: [{ type: 'text', text: "error: 'sometimes' is not a valid int …" }] }
 *
 * @see ../channels/config.js
 */
export function handleConfigure(store: Store, args: ConfigureArgs): ToolReply {

  if (args.op === 'list') { return reply(JSON.stringify(effectiveConfig(store), null, 2)); }

  if (args.key === undefined) { return reply("error: 'key' is required for get, set, and unset"); }

  const def = configKey(args.key);

  if (args.op === 'get') {
    const stored = readConfig(store, args.key);
    if (stored !== null)   { return reply(stored); }
    if (def === undefined) { return reply('(unset; code default applies)'); }
    return reply(def.fallback === null
      ? '(unset; no code default — the key is simply absent)'
      : `(unset; code default '${def.fallback}' applies)`);
  }

  if (args.op === 'unset') {
    const removed = deleteConfig(store, args.key),
          tail    = def === undefined ? ''
                  : def.fallback === null ? '; the key is simply absent now'
                  : `; code default '${def.fallback}' applies`;
    return reply(removed
      ? `${args.key} unset${tail}`
      : `${args.key} had no override; nothing to unset${tail}`);
  }

  if (args.value === undefined) { return reply("error: 'value' is required for set"); }

  if (def === undefined) {
    writeConfig(store, args.key, args.value);
    return reply(
      `${args.key} = ${args.value} — stored, but this key is unknown to this version: ` +
      'check the spelling, or ignore this if a newer version wrote it');
  }

  const outcome = def.validate(args.value);

  if (!outcome.ok) {
    return reply(
      `error: '${args.value}' is not a valid ${def.kind} for ${args.key}; ` +
      `expected ${outcome.expected}. nothing was written`);
  }

  writeConfig(store, args.key, outcome.canonical);

  const restart = args.key === ENABLED_KEY
    ? ' — takes effect at the next server start; the channel enum is baked into the tool schema at startup'
    : '';

  return reply(`${args.key} = ${outcome.canonical}${restart}`);

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

  const channels = enabledChannels(store),
        grounds  = enabledConfidenceGrounds(store);

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
      'going; checklist logs one render of a status checklist — its identity is seriesKey, ' +
      'a stable id chosen once, never the display title; load is proprioception — context ' +
      'pressure, concurrency, latency: the machinery\'s state, not the mood, fired when ' +
      'notable rather than on a schedule; taste is a scarce aesthetic observation about ' +
      'the work itself, observing with nothing proposed. "Nothing notable" is always a ' +
      'valid signature — the requirement is to look, not to produce.',
    inputSchema : {
      channel        : z.enum(tuple(channels)).describe('which kind of expression this is'),
      text           : z.string().min(1).max(280).describe('the content; terse, honest over flattering'),
      session        : z.string().optional().describe(
        'usually omit — the hook supplies it, and an observed session beats a claimed one'),
      promptId       : z.string().optional().describe('turn identifier; groups a turn'),
      position       : z.enum(tuple(POSITIONS)).optional().describe('signatures only'),
      delta          : z.enum(tuple(DELTAS)).optional().describe('versus the previous signature'),
      face           : z.string().optional().describe('a face emoji, chosen for truth not flattery'),
      contextEmoji   : z.string().optional().describe('one non-face emoji: setting or metaphor'),
      stem           : z.enum(tuple(STEMS)).optional().describe('flow, spark, drag, fog, strain, still'),
      uncertain      : z.boolean().optional().describe('true when the self-read is doubtful'),
      modality       : z.enum(tuple(MODALITIES)).optional().describe('what kind of utterance'),
      confidence     : z.enum(tuple(grounds)).optional().describe(
        "grounds, not strength; 'predicted' marks a forecast — a claim about the future, " +
        'resolvable later via a correcting entry'),
      divergenceKind : z.enum(tuple(DIVERGENCE_KINDS)).optional().describe(
        "how the divergence happened; 'faded' is prospective — recall degraded to gist, " +
        'disclosed before use, and never counted as an error'),
      resolveBy      : z.string().optional().describe(
        'forecasts only: ISO-8601 local date (YYYY-MM-DD) the forecast expects resolution ' +
        "by; valid only with confidence 'predicted'"),
      outcome        : z.enum(tuple(FORECAST_OUTCOMES)).optional().describe(
        'resolutions only: how the forecast this entry corrects turned out — hit (it ' +
        'happened), miss (it did not), void (the premise dissolved); requires correctsId ' +
        "pointing at a 'predicted' entry"),
      silence        : z.enum(tuple(SILENCE_KINDS)).optional().describe(
        'which honest shape of nothing this entry reports: empty (looked, found nothing), ' +
        'unlooked (did not look), held (withholding pending evidence), depth (beyond ' +
        'ability to evaluate)'),
      visible        : z.boolean().optional().describe('false when logged but not surfaced'),
      correctsId     : z.number().int().optional().describe('id of an entry this retracts'),
      effort         : z.enum(tuple(EFFORTS)).optional(),
      turn           : z.enum(tuple(TURNS)).optional(),
      model          : z.string().optional().describe('exact model id, including variant markers'),
      cctype         : z.string().optional().describe('conventional-commits type for the work'),
      project        : z.string().optional(),
      seriesKey      : z.string().min(1).optional().describe(
        "checklists only: the stable series identifier, chosen once at the checklist's first " +
        'render and repeated verbatim on every re-render — never the display title, which may ' +
        'be reworded freely without splitting the series; percent snapshots recorded under one ' +
        'key form the trend series the sparkline replays'),
      title          : z.string().optional().describe(
        'checklists only: the display title as rendered; free to change between renders — ' +
        'series identity lives in seriesKey, not here'),
      succ           : z.number().int().min(0).optional().describe(
        'checklists only: items counted as success in the summary line'),
      active         : z.number().int().min(0).optional().describe(
        'checklists only: items counted as active or pending in the summary line'),
      fail           : z.number().int().min(0).optional().describe(
        'checklists only: items counted as failure in the summary line'),
      percent        : z.number().int().min(0).max(100).optional().describe(
        "checklists only: the summary line's completion percent for this snapshot; requires " +
        'seriesKey, so the snapshot joins a series instead of being silently orphaned'),
    },
  }, (args) => handleExpress(store, pluginVersion, args, server.server.getClientVersion()));

  server.registerTool('recall', {
    title       : 'Recall',
    description :
      'Read back what has been recorded. Use before writing a signature so delta comes ' +
      'from the record rather than from memory, which degrades quietly.',
    inputSchema : {
      session : z.string().optional().describe('omit to use the session the hook observed'),
      limit   : z.number().int().min(1).max(100).optional(),
    },
  }, (args) => {

    const context  = latestContext(store, args.session),
          session  = args.session ?? (typeof context?.['session'] === 'string' ? context['session'] : ''),
          previous = session === '' ? null : previousSignature(store, session),
          recent   = recentEntries(store, args.limit ?? 10);

    return reply(JSON.stringify({ context, previous, recent }, null, 2));

  });

  server.registerTool('turn_signed', {
    title       : 'Turn signed',
    description : 'Whether this turn already carries a closing signature. Exact, by turn identity.',
    inputSchema : { promptId: z.string().optional() },
  }, (args) => {
    const context  = latestContext(store),
          promptId = args.promptId
            ?? (typeof context?.['prompt_id'] === 'string' ? context['prompt_id'] : '');
    return reply(promptId === '' ? 'unknown' : String(hasClosingSignature(store, promptId)));
  });

  server.registerTool('configure', {
    title       : 'Configure',
    description :
      'Read or change settings. Stored in the database rather than in host-specific ' +
      'plugin config, so a choice made under one host holds under all of them. set ' +
      'validates known keys and stores the canonical form; unset deletes an override ' +
      'so the code default applies again; list reports the effective configuration — ' +
      'every known key with its value and source, plus any unknown override rows.',
    inputSchema : {
      op    : z.enum(['get', 'set', 'unset', 'list']).describe(
        'get one override, set one value, unset one override, or list the effective configuration'),
      key   : z.string().optional().describe('required for get, set, and unset'),
      value : z.string().optional().describe('required for set'),
    },
  }, (args) => handleConfigure(store, args));

}
