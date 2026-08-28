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
import { FORMAT_VERSION, configKey, effectiveValue, effectiveConfig,
         validateBool, validateChannelList }                                  from '../channels/config.js';
import { QUESTION_IDS, onboardingQuestion, answeredIds,
         pendingQuestions, resolveQuestion, resetOnboarding }                 from '../channels/onboarding.js';
import type { Question }                                                      from '../channels/onboarding.js';
import { rejectDwellingWrite, dwellingChangeNotice }                          from '../dwelling/config.js';
import { latestContext }                                                     from '../channels/context.js';
import { privacyFlags }                                                      from '../channels/privacy.js';
import { stamp }                                                             from '../channels/time.js';
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
 * One key carries an event (issue #31): opting in to public aggregation is a moment,
 * not a flag. Setting `share.enabled` to `true` stamps `share.opted_in_utc` when no
 * moment is on record; setting it `false` — or unsetting it — clears the moment, so a
 * later re-opt-in starts a fresh window and deliberately forfeits everything earlier.
 * Rows recorded before the most recent opt-in are permanently outside the export.
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
          shared  = args.key === 'share.enabled' && deleteConfig(store, 'share.opted_in_utc'),
          tail    = (def === undefined ? ''
                  : def.fallback === null ? '; the key is simply absent now'
                  : `; code default '${def.fallback}' applies`)
                  + (shared ? '; share.opted_in_utc cleared — a later opt-in starts a fresh window' : '');
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

  // The dwelling's cross-key semantics (issue #45) sit atop the registry's type
  // validation: enabling requires dwelling.path to already be set and valid, and the
  // path itself must name an existing absolute directory — the plugin creates the
  // database file, never the directory, so a typo is refused rather than hidden.
  const rejected = rejectDwellingWrite(store, args.key, outcome.canonical);
  if (rejected !== null) { return reply(`${rejected}. nothing was written`); }

  writeConfig(store, args.key, outcome.canonical);

  // Opt-in is an event, not a flag (issue #31): enabling sharing records the moment,
  // and only rows at or after the *most recent* moment are ever exported. Disabling
  // clears the moment, so a re-opt-in later starts a fresh window rather than quietly
  // resurrecting eligibility for the gap — failing toward exporting less.
  let shareNote = '';
  if (args.key === 'share.enabled') {
    if (outcome.canonical === 'true') {
      if (readConfig(store, 'share.opted_in_utc') === null) {
        const moment = stamp().utc;
        writeConfig(store, 'share.opted_in_utc', moment);
        shareNote = ` — opt-in moment recorded at ${moment}; only rows from now on are eligible, never earlier ones`;
      }
    } else if (deleteConfig(store, 'share.opted_in_utc')) {
      shareNote = ' — opt-in moment cleared; a later re-opt-in starts a fresh window';
    }
  }

  const restart = args.key === ENABLED_KEY
    ? ' — takes effect at the next server start; the channel enum is baked into the tool schema at startup'
    : '';

  const dwelling = dwellingChangeNotice(args.key);

  return reply(`${args.key} = ${outcome.canonical}${restart}${shareNote}${dwelling === null ? '' : ` — ${dwelling}`}`);

}

/**
 * What a caller supplies to `onboard`, after schema validation.
 *
 * Hand-written for the same `isolatedDeclarations` reason as {@link ConfigureArgs};
 * the registration call site keeps it honest against the zod shape.
 */
export interface OnboardArgs {
  readonly op     : 'status' | 'answer' | 'skip' | 'reset';
  readonly id?    : string | undefined;
  readonly value? : string | undefined;
  readonly path?  : string | undefined;
}

/** The `status` op's report of one still-pending question. */
interface PendingReport {
  readonly id      : string;
  readonly prompt  : string;
  readonly kind    : string;
  readonly default : string;
  readonly keys    : readonly string[];
}

/** Shapes one question for the `status` op's JSON report. */
function pendingReport(question: Question): PendingReport {
  return { id: question.id, prompt: question.prompt, kind: question.kind,
           default: question.defaultAnswer, keys: question.keys };
}

/** The `N question(s) still pending` tail every mutating onboard reply carries. */
function pendingTail(store: Store): string {
  const remaining = pendingQuestions(store).length;
  return remaining === 0
    ? ' Onboarding is complete.'
    : ` ${String(remaining)} question${remaining === 1 ? '' : 's'} still pending.`;
}

/**
 * Answers the taste question by editing the channel's membership in
 * `channels.enabled` — taste is a channel, not a flag, so there is no
 * `taste.enabled` row to write (#42, #30).
 *
 * Enabling when no override exists writes nothing: the default already offers the
 * channel, and pinning the entire channel list to record one membership would
 * silently freeze every *other* channel against future default changes — the exact
 * bug #30's defaults-live-in-code rule exists to prevent. Disabling always writes
 * the trimmed list, and both directions note the startup baking caveat when a row
 * changes.
 *
 * @returns the reply text, or an error line when the trim would empty the set
 */
function answerChannelMembership(store: Store, channel: Channel, enable: boolean): string {

  const stored  = readConfig(store, ENABLED_KEY),
        current = enabledChannels(store),
        caveat  = ' Takes full effect next server start; the channel enum is baked into the tool schema at startup.';

  if (enable) {
    if (current.includes(channel)) {
      return stored === null
        ? `'${channel}' is already offered by default; no config row written, so a later default change still reaches you.`
        : `'${channel}' is already in the enabled set; nothing to write.`;
    }
    const grown = CHANNELS.filter(c => current.includes(c) || c === channel);
    writeConfig(store, ENABLED_KEY, grown.join(','));
    return `${ENABLED_KEY} = ${grown.join(',')} — '${channel}' restored.${caveat}`;
  }

  if (!current.includes(channel)) {
    return `'${channel}' is already absent from the enabled set; nothing to write.`;
  }

  const trimmed = current.filter(c => c !== channel);

  if (trimmed.length === 0) {
    return `error: disabling '${channel}' would leave no channels enabled; nothing was written`;
  }

  writeConfig(store, ENABLED_KEY, trimmed.join(','));
  return `${ENABLED_KEY} = ${trimmed.join(',')} — '${channel}' trimmed.${caveat}`;

}

/**
 * Answers the dwelling question: a path-gated boolean, where enabling **must**
 * carry a user-chosen directory — there is deliberately no default path (#45).
 *
 * The path rides the same validation the `configure` tool applies
 * ({@link rejectDwellingWrite}): an absolute path to an existing directory, refused
 * otherwise, so onboarding cannot record a config state `configure` itself would
 * have rejected. A refusal writes nothing and leaves the question pending.
 *
 * @returns the reply text; `error:`-prefixed lines mean nothing was written
 */
function answerDwelling(store: Store, enable: boolean, path: string | undefined): string {

  if (!enable) {
    writeConfig(store, 'dwelling.enabled', 'false');
    return "dwelling.enabled = false — an explicit no, recorded so a later default flip cannot un-choose it." +
           (path === undefined ? '' : ' The path argument was ignored; nothing enables.');
  }

  if (path === undefined) {
    return 'error: enabling the dwelling requires a path argument — a directory of the ' +
           "user's choosing; there is deliberately no default location. Ask the user " +
           'for a directory (drive and disk space are their call), then answer again ' +
           'with it. nothing was written';
  }

  const def = configKey('dwelling.path');
  if (def === undefined) { return 'error: dwelling.path is not registered; nothing was written'; }

  const outcome = def.validate(path);
  if (!outcome.ok) { return `error: '${path}' is not ${outcome.expected}. nothing was written`; }

  const rejected = rejectDwellingWrite(store, 'dwelling.path', outcome.canonical);
  if (rejected !== null) { return `${rejected}. nothing was written`; }

  writeConfig(store, 'dwelling.path', outcome.canonical);
  writeConfig(store, 'dwelling.enabled', 'true');

  return `dwelling.path = ${outcome.canonical}; dwelling.enabled = true — ` +
         (dwellingChangeNotice('dwelling.enabled') ?? '');

}

/**
 * Handles `onboard`: the first-run questionnaire over the config table (issue #40).
 *
 * Four ops:
 *
 * - `status` — read-only: the pending questions, the ledger, and whether the
 *   questionnaire is complete. A session that only ever calls `status` writes
 *   nothing, so the offer recurs next session — that is the implicit "defer".
 * - `answer` — one question per call: validates the value against the question's
 *   kind, writes the config key(s) through the same `writeConfig` path `configure`
 *   uses, and marks the id resolved. An explicit answer writes its row even when it
 *   equals the current default — the user chose the value, and a later default flip
 *   must not silently un-choose it. A dwelling enable without `path` is refused.
 * - `skip` — marks every currently-pending question resolved and writes no config
 *   rows, so code defaults apply — including future changed defaults. This is the
 *   "defaults are fine" fast path.
 * - `reset` — clears the ledger only; config values are untouched, and hand-set
 *   keys still count as answered, so only never-configured questions re-ask.
 *
 * @example
 *   handleOnboard(store, { op: 'answer', id: 'roster', value: 'true' })
 *   // => { content: [{ type: 'text', text: 'roster.enabled = true …' }] }
 *
 * @see ../channels/onboarding.js
 * @see handleConfigure
 */
export function handleOnboard(store: Store, args: OnboardArgs): ToolReply {

  if (args.op === 'status') {
    const pending = pendingQuestions(store);
    return reply(JSON.stringify({
      pending  : pending.map(pendingReport),
      answered : answeredIds(store),
      complete : pending.length === 0,
    }, null, 2));
  }

  if (args.op === 'reset') {
    const cleared = resetOnboarding(store);
    return reply((cleared
      ? 'onboarding ledger cleared — the questionnaire is pending again. '
      : 'the ledger was already empty. ')
      + 'Config values are untouched, and hand-configured keys still count as '
      + 'answered; a truly blank slate means clearing those keys through configure.'
      + pendingTail(store));
  }

  if (args.op === 'skip') {
    const pending = pendingQuestions(store);
    if (pending.length === 0) { return reply('nothing pending; onboarding is already complete.'); }
    for (const question of pending) { resolveQuestion(store, question.id); }
    return reply(
      `marked ${String(pending.length)} pending question${pending.length === 1 ? '' : 's'} resolved; ` +
      'no config rows were written, so code defaults apply — including future changed ' +
      "defaults. Change any single choice later with configure, or re-run onboarding " +
      "with onboard {op:'reset'}.");
  }

  if (args.id === undefined)    { return reply("error: 'id' is required for answer"); }
  if (args.value === undefined) { return reply("error: 'value' is required for answer"); }

  const question = onboardingQuestion(args.id);
  if (question === undefined) {
    return reply(`error: '${args.id}' is not a question this version knows; ` +
                 `valid ids: ${QUESTION_IDS.join(', ')}`);
  }

  if (question.kind === 'channel-list') {
    const outcome = validateChannelList(args.value);
    if (!outcome.ok) { return reply(`error: ${outcome.expected}. nothing was written`); }
    writeConfig(store, ENABLED_KEY, outcome.canonical);
    resolveQuestion(store, question.id);
    return reply(`${ENABLED_KEY} = ${outcome.canonical} — takes full effect next server ` +
                 'start; the channel enum is baked into the tool schema at startup.' +
                 pendingTail(store));
  }

  const bool = validateBool(args.value);
  if (!bool.ok) { return reply(`error: '${args.value}' is not ${bool.expected}. nothing was written`); }
  const enable = bool.canonical === 'true';

  if (question.kind === 'path-gated boolean') {
    const text = answerDwelling(store, enable, args.path);
    if (text.startsWith('error:')) { return reply(text); }
    resolveQuestion(store, question.id);
    return reply(text + pendingTail(store));
  }

  if (question.channel !== undefined) {
    const text = answerChannelMembership(store, question.channel, enable);
    if (text.startsWith('error:')) { return reply(text); }
    resolveQuestion(store, question.id);
    return reply(text + pendingTail(store));
  }

  const [key] = question.keys;
  if (key === undefined) { return reply(`error: question '${question.id}' names no config key`); }

  writeConfig(store, key, bool.canonical);
  resolveQuestion(store, question.id);

  const pinned = bool.canonical === question.defaultAnswer
    ? ' — matches the current default, and written anyway: an explicit choice holds even if a later release flips the default'
    : '';

  return reply(`${key} = ${bool.canonical}${pinned}.${pendingTail(store)}`);

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

  server.registerTool('onboard', {
    title       : 'Onboard',
    description :
      'The first-run preference questionnaire, shared across hosts through the ' +
      'database. Etiquette is normative: onboarding is an offer, never a gate. Never ' +
      "hijack the first turn — do the user's actual task first, and offer at the " +
      'first natural pause, once per session at most. One short offer naming the ' +
      "count and the fast path; \"defaults\" means op skip, which writes nothing and " +
      'is done forever. If the user talks past the offer, drop it for the session — ' +
      'a status-only session writes nothing and the offer recurs next session. ' +
      'status lists what is pending; answer records one question (a dwelling enable ' +
      'requires a user-chosen path — ask for the directory, never guess one); skip ' +
      'resolves everything pending with code defaults; reset re-runs the ' +
      'questionnaire without touching config values.',
    inputSchema : {
      op    : z.enum(['status', 'answer', 'skip', 'reset']).describe(
        'status lists pending questions read-only; answer records one; skip accepts ' +
        'the defaults for everything pending; reset makes the questionnaire pending again'),
      id    : z.enum(tuple([...QUESTION_IDS])).optional().describe('required for answer: which question'),
      value : z.string().optional().describe(
        "required for answer: 'true'/'false' for the yes/no questions, or the " +
        'comma-separated channel list for the channels question'),
      path  : z.string().optional().describe(
        'dwelling only: the user-chosen directory, required when enabling — there is ' +
        'deliberately no default location'),
    },
  }, (args) => handleOnboard(store, args));

}
