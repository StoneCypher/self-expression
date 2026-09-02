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
  FORECAST_OUTCOMES, SILENCE_KINDS, ANCHOR_KINDS, CORRECTION_KINDS,
} from '../channels/vocabulary.js';
import type {
  Channel, Position, Delta, Stem, Turn, Effort,
  ConfidenceGround, DivergenceKind, Modality,
  ForecastOutcome, SilenceKind, AnchorKind, CorrectionKind,
} from '../channels/vocabulary.js';
import {
  recordEntry, recentEntries, previousSignature, hasClosingSignature, validate,
  register, REGISTER_DEFAULT_LIMIT,
} from '../channels/entries.js';
import type { EntryInput }                                                   from '../channels/entries.js';
import { ANCHOR_QUOTE_MAX }                                                  from '../channels/anchors.js';
import { readConfig, writeConfig, deleteConfig }                              from '../channels/store.js';
import {
  FORMAT_VERSION, MAX_TEXT_CEILING, configKey, channelMaxChars, channelMaxCharsKey,
  effectiveValue, effectiveConfig, validateBool, validateChannelList,
} from '../channels/config.js';
import { QUESTION_IDS, onboardingQuestion, answeredIds,
         pendingQuestions, resolveQuestion, resetOnboarding }                 from '../channels/onboarding.js';
import type { Question }                                                      from '../channels/onboarding.js';
import { rejectDwellingWrite, dwellingChangeNotice }                          from '../dwelling/config.js';
import { latestContext, recordContextOnce, noContextNotice, NO_HOOK_SESSION,
         UNKNOWN_CONTEXT, UNKNOWN_PREVIOUS }                                from '../channels/context.js';
import { privacyFlags }                                                      from '../channels/privacy.js';
import { stamp }                                                             from '../channels/time.js';
import { renderAnnotations }                                                 from '../charts/annotations.js';
import type { AnnotationNote } from '../charts/annotations.js';
import type { Store }     from '../channels/store.js';
import type { ToolReply } from './chart_tools.js';

/** Config key holding the comma-separated list of active channels. */
export const ENABLED_KEY = 'channels.enabled';

/** Config key for the forecast feature; only an effective 'false' disables it (#42). */
export const FORECAST_KEY = 'forecast.enabled';

/**
 * Config keys baked into a tool schema at server registration, rather than read live
 * on every call — so writing one through `configure` or `onboard` changes nothing
 * about what the model can currently call; only the *next* start reflects it.
 *
 * `channels.enabled` narrows the `channel` enum on `express`/`annotate`;
 * `forecast.enabled` narrows the `confidence` enum the same way (both at this file's
 * `registerTools`, from `channels` and `grounds` computed once at the top of that
 * function). `image.enabled` decides whether `generate_image` and its siblings are
 * registered at all ({@link ../mcp/server.js buildServer}'s `resolveImageFacility`
 * call). `audio.enabled` and `audio.tts_local` decide the same for the entirely
 * separate `claudio` process ({@link ../claudio/server.js buildAudioServer}) — a
 * different server, baked at its own startup, not this one's.
 *
 * Deliberately excludes keys that are re-checked per call instead — `messages.enabled`,
 * `mailbox.enabled`, and the hook-time toggles (`salience.enabled`, `revision.enabled`,
 * `gifts.enabled`, `roster.enabled`): those are live immediately, and a restart notice
 * on them would be a lie in the other direction. Also excludes `dwelling.enabled` /
 * `dwelling.path`, which carry their own startup-notice mechanism
 * ({@link ../dwelling/config.js dwellingChangeNotice}) predating this one.
 *
 * @see startupBakedNotice
 */
export const STARTUP_BAKED_KEYS: ReadonlySet<string> = new Set([
  ENABLED_KEY, FORECAST_KEY, 'image.enabled', 'audio.enabled', 'audio.tts_local',
]);

/**
 * The "next start" caveat for a `configure`/`onboard` reply that just wrote a
 * {@link STARTUP_BAKED_KEYS} member — the empty string for every other key.
 *
 * One helper rather than a `? :` at each call site, so a future startup-baked key
 * reaches every writer — `handleConfigure` and `handleOnboard`'s generic-boolean
 * branch today — by adding one case here, not one per writer.
 *
 * @returns the caveat, beginning with ' — ', or '' when `key` is not startup-baked
 *
 * @example
 *   startupBakedNotice(ENABLED_KEY)      // => ' — takes effect at the next server start; …'
 *   startupBakedNotice('retention.days') // => ''
 */
export function startupBakedNotice(key: string): string {

  switch (key) {
    case ENABLED_KEY:
      return ' — takes effect at the next server start; the channel enum is baked into the tool schema at startup';
    case FORECAST_KEY:
      return ' — takes effect at the next server start; the confidence enum is baked into the tool schema at startup';
    case 'image.enabled':
      return ' — takes effect at the next server start; the image tools are registered only when this reads true at startup';
    case 'audio.enabled':
    case 'audio.tts_local':
      return ' — takes effect the next time the separate claudio audio server starts; it bakes this at its own registration, ' +
             'not at this server\'s';
    default:
      return '';
  }

}

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
  readonly anchorKind?     : AnchorKind | undefined;
  readonly anchorTarget?   : string | undefined;
  readonly anchorSpan?     : string | undefined;
  readonly anchorQuote?    : string | undefined;
  readonly visible?        : boolean | undefined;
  readonly correctsId?     : number | undefined;
  readonly correctsKind?   : CorrectionKind | undefined;
  readonly verbatim?       : string | undefined;
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
 * The half of anchor validation that needs the store: does the anchored thing exist?
 *
 * `entries.validate` can check an anchor's *shape* but not its *referent*, exactly as
 * it can check that an `outcome` has a `correctsId` but not that the target is a
 * forecast. Both checks return a rejection naming what would have worked — the highest
 * id that exists, or the series keys that do — rather than only that the value failed.
 *
 * `file`, `prompt`, and `reply` targets are deliberately unchecked: a path may name a
 * file the server cannot see from its cwd, and no hook observes response text or
 * guarantees that a `prompt_id` is still in reach. Rejecting those would refuse valid
 * annotations on unverifiable grounds; the resolution ladder reports their state at
 * read time instead, which is where the truth actually lives.
 *
 * @returns the problem sentence, or `null` when there is nothing to object to
 *
 * @example
 *   anchorTargetProblem(store, 'entry', '9999')
 *   // => "anchorTarget '9999' is not an existing entry id; the highest id so far is 41"
 *
 * @see ../channels/entries.js anchorProblems
 */
export function anchorTargetProblem(
  store  : Store,
  kind   : AnchorKind | undefined,
  target : string | undefined,
): string | null {

  if (kind === undefined || target === undefined) { return null; }

  if (kind === 'entry') {
    const found = store.db.prepare('SELECT 1 AS ok FROM entries WHERE id = ?').get(Number(target));
    if (found !== undefined) { return null; }
    const top     = store.db.prepare('SELECT MAX(id) AS top FROM entries').get(),
          highest = top?.['top'] ?? null;
    return `anchorTarget '${target}' is not an existing entry id; ` +
      (highest === null ? 'no entries have been recorded yet' : `the highest id so far is ${String(highest)}`);
  }

  if (kind === 'checklist') {
    const found = store.db.prepare(
      'SELECT 1 AS ok FROM entries WHERE series_key = ? LIMIT 1').get(target);
    if (found !== undefined) { return null; }
    const keys = store.db.prepare(
      'SELECT DISTINCT series_key FROM entries WHERE series_key IS NOT NULL ORDER BY series_key')
      .all().map(row => `'${String(row['series_key'])}'`);
    return `anchorTarget '${target}' names no recorded checklist series; ` +
      (keys.length === 0 ? 'no series have been recorded yet' : `known keys are ${keys.join(', ')}`);
  }

  return null;

}

/** What the store can say about a proposed `correctsId` link that the validator cannot. */
export interface CorrectionCheck {
  /** The problem sentence, or `null` when the link is sound — or absent entirely. */
  readonly problem : string | null;
  /** The target's channel, for the confirmation echo; `null` when there is no sound target. */
  readonly channel : string | null;
}

/**
 * The half of correction validation that needs the store: does the target exist, and is
 * it the kind of thing this link claims it is?
 *
 * `entries.validate` can check that a link states a kind and that an `outcome` rides a
 * `resolves` link, but not that the pointed-at row exists or that it is a forecast —
 * exactly the split anchoring uses. Both answers come back with the target's channel,
 * because the confirmation reply echoes it: a wrong-target retraction should be
 * discoverable at write time, not at audit time.
 *
 * A `resolves` link must name a `predicted` row, because resolving something that was
 * never a forecast resolves nothing; `retracts` and `amends` may target any row, since
 * any claim can turn out wrong.
 *
 * @param correctsId the proposed link target, or `undefined` on an ordinary entry
 * @param kind       the stated link kind
 * @param outcome    the forecast outcome, when one rides along (#42)
 *
 * @example
 *   checkCorrectionTarget(store, 171, 'retracts', undefined)
 *   // => { problem: null, channel: 'checklist' }
 *   checkCorrectionTarget(store, 999, 'retracts', undefined)
 *   // => { problem: "correctsId #999 does not exist; the highest id so far is 41", channel: null }
 *
 * @see ../channels/entries.js correctionProblems
 * @see anchorTargetProblem
 */
export function checkCorrectionTarget(
  store      : Store,
  correctsId : number | undefined,
  kind       : CorrectionKind | undefined,
  outcome    : ForecastOutcome | undefined,
): CorrectionCheck {

  if (correctsId === undefined) { return { problem: null, channel: null }; }

  const target = store.db.prepare(
    'SELECT channel, confidence FROM entries WHERE id = ?').get(correctsId);

  if (target === undefined) {
    const top     = store.db.prepare('SELECT MAX(id) AS top FROM entries').get(),
          highest = top?.['top'] ?? null;
    return { problem:
      `correctsId #${String(correctsId)} does not exist; ` +
      (highest === null ? 'no entries have been recorded yet' : `the highest id so far is ${String(highest)}`),
      channel: null };
  }

  const channel = String(target['channel']),
        ground  = target['confidence'];

  if ((kind === 'resolves' || outcome !== undefined) && ground !== 'predicted') {
    return { problem:
      `entry #${String(correctsId)} is not a forecast — its confidence is ` +
      `${ground === null || ground === undefined ? 'unset' : `'${String(ground)}'`}, not 'predicted', ` +
      'so there is nothing for an outcome to resolve', channel: null };
  }

  return { problem: null, channel };

}

/**
 * The confirmation reply's correction echo, e.g. `, retracts #171 (checklist)` — or the
 * empty string when the entry links to nothing.
 *
 * Exists so a mis-aimed retraction is visible in the reply the model reads immediately,
 * rather than in an audit months later. Naming the target's channel is the cheap half of
 * that: "retracts #171 (signature)" reads wrong at a glance when the intent was to
 * retract a checklist.
 *
 * @example
 *   correctionEcho('retracts', 171, 'checklist')  // => ', retracts #171 (checklist)'
 *   correctionEcho(undefined, undefined, null)    // => ''
 */
export function correctionEcho(
  kind       : CorrectionKind | undefined,
  correctsId : number | undefined,
  channel    : string | null,
): string {
  if (correctsId === undefined) { return ''; }
  return `, ${kind ?? 'corrects'} #${String(correctsId)}` + (channel === null ? '' : ` (${channel})`);
}

/**
 * The anchor fields as they will be recorded, after the one adoption anchoring makes:
 * a `prompt` anchor with no target adopts the hook-observed `prompt_id` of the message
 * being answered.
 *
 * The common case — annotating the message you are replying to — therefore needs only
 * the quote, exactly as `express` needs no `session`. Naming an earlier `prompt_id`
 * explicitly stays possible for retrospective annotation, and an observed id always
 * loses to one the caller supplied deliberately.
 *
 * @param args    the caller's anchor fields
 * @param context the hook-observed turn context, or `null`
 *
 * @example
 *   adoptAnchorTarget({ anchorKind: 'prompt', anchorQuote: 'ship it' }, { prompt_id: 'p-7' })
 *   // => { anchorKind: 'prompt', anchorTarget: 'p-7', anchorQuote: 'ship it', anchorSpan: undefined }
 */
export function adoptAnchorTarget(
  args    : Pick<ExpressArgs, 'anchorKind' | 'anchorTarget' | 'anchorSpan' | 'anchorQuote'>,
  context : Record<string, unknown> | null,
): Pick<EntryInput, 'anchorKind' | 'anchorTarget' | 'anchorSpan' | 'anchorQuote'> {

  const observed = context?.['prompt_id'],
        adopted  = args.anchorKind === 'prompt' && args.anchorTarget === undefined
          && typeof observed === 'string' && observed !== ''
          ? observed
          : args.anchorTarget;

  return {
    anchorKind   : args.anchorKind,
    anchorTarget : adopted,
    anchorSpan   : args.anchorSpan,
    anchorQuote  : args.anchorQuote,
  };

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
 * Three checks live here rather than in the schema, because none is expressible in a
 * shape built once at registration:
 *
 * - **Text length** is per-channel and user-configurable (issue #76), so the static
 *   zod bound can only be {@link MAX_TEXT_CEILING} — the largest value any key may be
 *   set to. The configured limit is checked here, and the rejection names the channel,
 *   its limit, the length received, and the key that changes it. The check governs
 *   writes only: rows already stored longer than a later-lowered limit are untouched
 *   and stay fully readable (see {@link channelMaxChars}).
 * - A **`correctsId` link** is checked against the store (the half of correction
 *   validation `entries.validate` cannot do alone, #42 and #16): the target must exist,
 *   and a `resolves` link — the shape an `outcome` rides — must name a row whose
 *   confidence is `'predicted'`, or the rejection names the target's actual ground. The
 *   confirmation reply then **echoes the target**, `recorded #214, retracts #171
 *   (checklist)`, so a wrong-target retraction is discoverable at write time.
 * - An **anchor's referent** gets the same treatment (#18): the existence check that
 *   needs the store runs here, and a `prompt` anchor with no target adopts the turn the
 *   hook observed.
 *
 * When there was no context at all to adopt, the row is stamped
 * {@link ../channels/context.js NO_HOOK_SESSION} as it always has been — and the reply
 * now **says so**, naming `begin_turn` as the fix. The gap was already legible to whoever
 * read the database months later; it was invisible to the one participant who could have
 * closed it.
 *
 * @example
 *   handleExpress(store, '0.2.1', { channel: 'need', text: 'merge #21?' })
 *   // => { content: [{ type: 'text', text: 'recorded #1 …' }] }
 *
 * @example
 *   handleExpress(store, '0.2.1', { channel: 'dissent', text: '"ready" reads three ways',
 *                                   anchorKind: 'prompt', anchorQuote: 'ship it when ready' })
 *   // => recorded, anchored to the prompt_id the hook observed for this turn
 *
 * @throws {Error} If the text is longer than the channel's configured limit, naming the
 *                 channel, the limit, and the length received.
 * @throws {Error} If entry validation fails — a closed field outside its vocabulary,
 *                 a cross-field forecast or anchor violation, an outcome whose target
 *                 is not a `predicted` row, or an anchor whose target does not exist —
 *                 naming every problem and the values that would have been accepted.
 *
 * @see ../channels/entries.js recordEntry
 * @see anchorTargetProblem
 * @see adoptAnchorTarget
 * @see ../channels/config.js channelMaxChars
 */
export function handleExpress(
  store         : Store,
  pluginVersion : string,
  args          : ExpressArgs,
  client?       : ClientIdentity,
): ToolReply {

  // The per-channel length check (issue #76). It lives here rather than in the schema
  // because the schema is built once at registration and cannot read config; the schema
  // carries only MAX_TEXT_CEILING, the largest value any key may be set to. Rejection —
  // not truncation, not a warning — because every other vocabulary in this plugin
  // rejects, and a silently shortened line is a lie about what was said.
  const limit = channelMaxChars(store, args.channel);
  if (args.text.length > limit) {
    throw new Error(
      `cannot record entry:\n  - text is ${String(args.text.length)} characters; the ` +
      `'${args.channel}' channel allows at most ${String(limit)} ` +
      `(configure set ${channelMaxCharsKey(args.channel)} <n> to change it)`);
  }

  const link = checkCorrectionTarget(store, args.correctsId, args.correctsKind, args.outcome);
  if (link.problem !== null) { throw new Error(`cannot record entry:\n  - ${link.problem}`); }

  const context = latestContext(store, args.session),
        privacy = privacyFlags(store),
        anchor  = adoptAnchorTarget(args, context),
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
  const targetProblem = anchorTargetProblem(store, anchor.anchorKind, anchor.anchorTarget);
  if (targetProblem !== null) { throw new Error(`cannot record entry:\n  - ${targetProblem}`); }

  const session = args.session ?? str('session') ?? NO_HOOK_SESSION;

  const written = recordEntry(store, {
    ...args,
    ...anchor,
    session,
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

  return reply(
    `recorded #${String(written.id)} ${written.uuid}` +
    correctionEcho(args.correctsKind, args.correctsId, link.channel) +
    noContextNotice(session));

}

/** The most notes one `annotate` call may carry. */
export const ANNOTATE_MAX_NOTES = 25;

/** One note inside an `annotate` batch, after schema validation. */
export interface AnnotateNote {
  readonly channel       : Channel;
  readonly text          : string;
  readonly face?         : string | undefined;
  readonly anchorKind    : AnchorKind;
  readonly anchorTarget? : string | undefined;
  readonly anchorSpan?   : string | undefined;
  readonly anchorQuote?  : string | undefined;
}

/** What a caller supplies to `annotate`, after schema validation. */
export interface AnnotateArgs {
  readonly notes    : readonly AnnotateNote[];
  readonly session? : string | undefined;
}

/**
 * Handles `annotate`: records a batch of anchored notes as one row each,
 * all-or-nothing, and returns the canonical rendered block.
 *
 * The issue's centre of gravity is "many short notes bound to many locations", and one
 * `express` call per note makes a ten-note review cost ten tool calls. This is that
 * batch: every note validates and records exactly as an `express` call would — same
 * hook-context adoption, same referent checks, same write-time privacy gates, one row
 * apiece — with two additions.
 *
 * **All-or-nothing.** Every note is validated before any is written — including against
 * its channel's own configured length budget (#76), so the batch is not a hole around a
 * limit `express` enforces — and the writes run inside one transaction, so an invalid
 * note rejects the whole batch naming its index and its problem. A half-recorded review
 * is worse than a rejected one: the reader cannot tell which half is missing.
 *
 * **The reply carries the block.** The recorded ids come back with
 * {@link renderAnnotations}' output, so the model pastes the canonical rendering
 * instead of imitating it — the same prevent-the-error-class argument that motivated
 * the chart renderers. The block renders from the arguments, which is deliberate: a
 * `prompt` quote suppressed by `privacy.store_quotes` still appeared in the transcript
 * once, and it is the *later* recall that degrades to hash-only.
 *
 * The no-turn-context notice rides here exactly as it does on `express`: a batch written
 * with nothing to adopt says so, once for the batch rather than once per note.
 *
 * @param store         the open store to record into
 * @param pluginVersion stamped onto every row, as on every entry
 * @param args          the validated tool arguments
 * @param client        what the MCP handshake reported about the host, if anything
 *
 * @example
 *   handleAnnotate(store, '0.2.1', { notes: [
 *     { channel: 'dissent', text: 'null for unset and for empty', face: '😕',
 *       anchorKind: 'file', anchorTarget: 'src/ts/channels/store.ts',
 *       anchorSpan: 'L141', anchorQuote: 'readConfig(store, key)' },
 *   ]})
 *   // => { content: [{ type: 'text', text: 'recorded #1\n\n⚓ src/ts/channels/store.ts\n   …' }] }
 *
 * @throws {Error} If any note fails validation or names a target that does not exist —
 *                 the message names the note's index and every problem found, and
 *                 nothing at all is written.
 *
 * @see handleExpress
 * @see ../charts/annotations.js renderAnnotations
 */
export function handleAnnotate(
  store         : Store,
  pluginVersion : string,
  args          : AnnotateArgs,
  client?       : ClientIdentity,
): ToolReply {

  if (args.notes.length === 0) {
    throw new Error('cannot annotate:\n  - notes must not be empty; an annotation batch with no notes records nothing');
  }

  if (args.notes.length > ANNOTATE_MAX_NOTES) {
    throw new Error(
      `cannot annotate:\n  - ${String(args.notes.length)} notes exceeds the limit of ` +
      `${String(ANNOTATE_MAX_NOTES)}; split the review, or say less about each location`);
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

  const session = args.session ?? str('session') ?? NO_HOOK_SESSION;

  const inputs: EntryInput[] = args.notes.map(note => ({
    channel        : note.channel,
    text           : note.text,
    face           : note.face,
    ...adoptAnchorTarget(note, context),
    session,
    promptId       : str('prompt_id'),
    turn           : str('turn')   as never,
    effort         : str('effort') as never,
    turnIndex      : num('turn_index'),
    cwd            : privacy.storeCwd ? str('cwd') : undefined,
    gitBranch      : privacy.storeCwd ? str('git_branch') : undefined,
    permissionMode : str('permission_mode'),
    agentId        : str('agent_id'),
    agentType      : str('agent_type'),
    compactions    : num('compactions'),
    promptLen      : privacy.storePromptLen ? num('prompt_len') : undefined,
    host           : client?.name,
    hostVersion    : client?.version,
    formatVersion  : effectiveValue(store, 'format.version') ?? FORMAT_VERSION,
  }));

  // Validate every note before writing any of them. Reporting all the bad notes at once
  // matters for the same reason `validate` reports every bad field at once: a ten-note
  // review with three problems should cost one round trip, not three.
  const problems: string[] = [];
  for (const [index, input] of inputs.entries()) {
    const found  = validate(input),
          target = anchorTargetProblem(store, input.anchorKind, input.anchorTarget),
          limit  = channelMaxChars(store, input.channel);
    if (input.text.length > limit) {
      // The same per-channel budget `express` enforces (#76). A batch must not be a hole
      // around it: one tool writing rows another tool's limit would have refused is the
      // kind of drift both layers exist to prevent.
      found.push(
        `text is ${String(input.text.length)} characters; the '${input.channel}' channel ` +
        `allows at most ${String(limit)} (configure set ${channelMaxCharsKey(input.channel)} <n> to change it)`);
    }
    if (input.anchorKind === undefined) { found.push('every annotate note requires an anchorKind — use express for a floating note'); }
    if (target !== null) { found.push(target); }
    for (const problem of found) { problems.push(`note ${String(index)}: ${problem}`); }
  }

  if (problems.length > 0) {
    throw new Error(`cannot annotate:\n  - ${problems.join('\n  - ')}\nnothing was written`);
  }

  const ids: number[] = [];

  store.db.exec('BEGIN');
  try {
    for (const input of inputs) { ids.push(recordEntry(store, input, pluginVersion).id); }
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }

  const block = renderAnnotations(args.notes.map((note, index): AnnotationNote => ({
    text         : note.text,
    face         : note.face,
    anchorKind   : note.anchorKind,
    anchorTarget : inputs[index]?.anchorTarget ?? note.anchorTarget ?? '',
    anchorSpan   : note.anchorSpan,
    anchorQuote  : note.anchorQuote,
  })));

  return reply(
    `recorded ${ids.map(id => `#${String(id)}`).join(', ')}` +
    noContextNotice(session) + `\n\n${block}`);

}

/** What a caller supplies to `begin_turn`, after schema validation. */
export interface BeginTurnArgs {
  readonly session         : string;
  readonly promptId        : string;
  readonly turn?           : Turn | undefined;
  readonly cwd?            : string | undefined;
  readonly gitBranch?      : string | undefined;
  readonly permissionMode? : string | undefined;
  readonly agentId?        : string | undefined;
  readonly agentType?      : string | undefined;
  readonly effort?         : Effort | undefined;
  readonly compactions?    : number | undefined;
  readonly promptLen?      : number | undefined;
}

/**
 * Handles `begin_turn`: lets a hookless host's model volunteer what the
 * `UserPromptSubmit` hook would otherwise have observed.
 *
 * On Claude Code a hook fires at turn start, deposits the session, the turn identity, the
 * working directory, the effort level and the permission mode, and every later `express`
 * call adopts them. On a bare MCP client nothing fires, so every row lands with `no-hook`
 * for a session and NULL for the rest — the record survives, but the questions it exists
 * to answer stop being answerable. This is the second door.
 *
 * Three properties make it safe to add a second door at all:
 *
 * - **One writer.** It records through {@link ../channels/context.js recordContextOnce},
 *   which records through `recordContext` — the same single `INSERT` the hook uses, the
 *   same columns, the same derived `turnIndex`. There is deliberately no second way to
 *   write a `turn_context` row, so the two paths cannot drift into two shapes.
 * - **Idempotent by turn identity.** A second call for the same (`session`, `promptId`)
 *   writes nothing and reports the row already standing. That is what keeps the pair a
 *   *turn identity*: two rows would give one turn two `turnIndex` values and two
 *   candidate answers to `latestContext`, which the Stop gate, `turn_signed`, and every
 *   `express` adoption all read through.
 * - **Harmless where the hook already fired.** The hook's row matches on the same pair,
 *   so on Claude Code this finds it, writes nothing, and says the standing row came from
 *   the hook. Calling it there costs one lookup and changes nothing.
 *
 * The row is stamped `source: 'tool'`, and this is the one field the caller cannot set.
 * A volunteered fact and an observed one are not the same evidence — the only witness
 * here is the subject — and a study reading this database later must be able to separate
 * them without inference. `source` is how.
 *
 * `turnIndex` is derived, never accepted, exactly as it is for the hook: the database
 * already knows how many turns it has seen, and taking the model's word for a number the
 * record can count would be an assertion replacing a fact.
 *
 * The path-carrying fields are gated on the privacy config at the point of capture, the
 * same way the hook gates them, so a suppressed field is never written rather than being
 * hidden afterwards.
 *
 * @param store the open store to record into
 * @param args  the validated tool arguments
 * @param when  the moment to stamp the row with; injectable so tests need no clock
 *
 * @example
 *   handleBeginTurn(store, { session: 'sess-1', promptId: 'p-7', turn: 'reply' })
 *   // => 'turn 1 recorded for session sess-1 (source: tool). …'
 *
 * @example
 *   // second call in the same turn, or any call under Claude Code:
 *   handleBeginTurn(store, { session: 'sess-1', promptId: 'p-7' })
 *   // => 'turn 1 was already recorded for session sess-1 (source: tool); nothing written. …'
 *
 * @see ../channels/context.js recordContextOnce
 * @see ./hooks.js onUserPromptSubmit
 */
export function handleBeginTurn(store: Store, args: BeginTurnArgs, when: Date = new Date()): ToolReply {

  const privacy = privacyFlags(store),
        result  = recordContextOnce(store, {
          session        : args.session,
          promptId       : args.promptId,
          turn           : args.turn,
          cwd            : privacy.storeCwd ? args.cwd : undefined,
          gitBranch      : privacy.storeCwd ? args.gitBranch : undefined,
          permissionMode : args.permissionMode,
          agentId        : args.agentId,
          agentType      : args.agentType,
          effort         : args.effort,
          compactions    : args.compactions,
          promptLen      : privacy.storePromptLen ? args.promptLen : undefined,
          // Never from the caller. See the note above on volunteered versus observed.
          source         : 'tool',
        }, when);

  const row    = result.row,
        index  = typeof row?.['turn_index'] === 'number' ? String(row['turn_index']) : '?',
        source = typeof row?.['source'] === 'string' ? row['source'] : 'unrecorded';

  return reply(result.recorded
    ? `turn ${index} recorded for session ${args.session} (source: ${source}). ` +
      'express, recall, and the signature gate will adopt it for this turn; no need to ' +
      'pass session or promptId to them.'
    : `turn ${index} was already recorded for session ${args.session} (source: ${source}); ` +
      'nothing written. ' +
      (source === 'hook'
        ? 'This host fires the turn-start hook, which already observed the turn — calling ' +
          'begin_turn here is harmless and unnecessary.'
        : 'Turn identity is one row; a second call cannot fork it.'));

}

/**
 * Config keys written only by an event, never directly by `configure set` or
 * `configure unset` — a home for `share.opted_in_utc` and any future key like it.
 *
 * @see rejectEventOnlyWrite
 */
export const EVENT_ONLY_KEYS: ReadonlySet<string> = new Set(['share.opted_in_utc']);

/**
 * Refuse a direct `configure set`/`unset` of an {@link EVENT_ONLY_KEYS} member, naming
 * the event that writes and clears it instead.
 *
 * `share.opted_in_utc` exists to answer one question honestly: which rows were
 * recorded after the user actually opted in to public aggregation (issue #31). A
 * direct write could defeat that — `configure set share.opted_in_utc 1970-01-01T…Z`
 * followed by `configure set share.enabled true` (which only stamps the moment when
 * none is already on record) would make every row ever recorded eligible, and a future
 * date would silently export nothing. It is written only by the `share.enabled true`
 * transition and cleared only by `share.enabled false` (see {@link handleConfigure}),
 * so any direct write — set or unset, even a value that would otherwise validate — is
 * refused before the registered validator ever runs.
 *
 * @returns the refusal text, or `null` when `key` is not event-only
 *
 * @example
 *   rejectEventOnlyWrite('share.opted_in_utc')
 *   // => "error: share.opted_in_utc is written only by the share.enabled opt-in event …"
 *   rejectEventOnlyWrite('retention.days')  // => null
 */
export function rejectEventOnlyWrite(key: string): string | null {
  if (!EVENT_ONLY_KEYS.has(key)) { return null; }
  return `error: ${key} is written only by the share.enabled opt-in event ` +
    "(configure set share.enabled true) and cleared only by opting out " +
    "(configure set share.enabled false); it cannot be set or unset directly";
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
 * Rows recorded before the most recent opt-in are permanently outside the export. That
 * moment is itself off-limits to a direct `set`/`unset` — see {@link rejectEventOnlyWrite}
 * — because a backdated or future-dated stamp would make the export eligibility window a
 * lie the model could tell.
 *
 * A `set` that lands on a key in {@link STARTUP_BAKED_KEYS} carries a "next start"
 * caveat: the tool schema that key shapes was built once, at registration, and does
 * not re-read config — see {@link startupBakedNotice}.
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
    const blockedEvent = rejectEventOnlyWrite(args.key);
    if (blockedEvent !== null) { return reply(`${blockedEvent}; nothing was removed`); }

    const removed = deleteConfig(store, args.key),
          shared  = args.key === 'share.enabled' && deleteConfig(store, 'share.opted_in_utc'),
          tail    = (def === undefined ? ''
                  : def.fallback === null ? '; the key is simply absent now'
                  : `; code default '${def.fallback}' applies`)
                  + (shared ? '; share.opted_in_utc cleared — a later opt-in starts a fresh window' : '')
                  + startupBakedNotice(args.key);
    return reply(removed
      ? `${args.key} unset${tail}`
      : `${args.key} had no override; nothing to unset${tail}`);
  }

  if (args.value === undefined) { return reply("error: 'value' is required for set"); }

  const blockedEvent = rejectEventOnlyWrite(args.key);
  if (blockedEvent !== null) { return reply(`${blockedEvent}. nothing was written`); }

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

  const restart = startupBakedNotice(args.key);

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

  // Startup-baked keys (forecast.enabled today; a future question wired to
  // image.enabled or an audio.* key would hit this too) need the same "next start"
  // caveat here as configure gives — this is the other writer of the same rows.
  const baked = startupBakedNotice(key);

  return reply(`${key} = ${bool.canonical}${pinned}${baked}.${pendingTail(store)}`);

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
      'valid signature — the requirement is to look, not to produce. ' +
      'To take a claim back, record the correction and link it: correctsId names the ' +
      'earlier entry, correctsKind says retracts or amends, and verbatim quotes the wrong ' +
      'words exactly. Nothing is ever rewritten — the original stays exactly as written ' +
      'and is marked wherever it is read again. Retract at the moment of discovery, in ' +
      'the same response.',
    inputSchema : {
      channel        : z.enum(tuple(channels)).describe('which kind of expression this is'),
      text           : z.string().min(1).max(MAX_TEXT_CEILING).describe(
        'the content; terse, honest over flattering. The real limit is per-channel and ' +
        'user-configurable (channels.<name>.max_chars, default 200) and is checked when ' +
        'the entry is recorded; this schema bound is only the hard ceiling no limit may exceed'),
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
        "pointing at a 'predicted' entry, with correctsKind 'resolves'"),
      silence        : z.enum(tuple(SILENCE_KINDS)).optional().describe(
        'which honest shape of nothing this entry reports: empty (looked, found nothing), ' +
        'unlooked (did not look), held (withholding pending evidence), depth (beyond ' +
        'ability to evaluate)'),
      anchorKind     : z.enum(tuple(ANCHOR_KINDS)).optional().describe(
        'attach this note to a location instead of leaving it floating in prose: file ' +
        '(repo-relative path), prompt (a message from your partner), reply (your own ' +
        'earlier output), checklist (a series by its seriesKey), entry (an entry id). ' +
        'An anchored note is still its own channel — an anchored dissent is a dissent'),
      anchorTarget   : z.string().optional().describe(
        'the path, prompt id, series key, or entry id being pointed at; omit on a ' +
        'prompt anchor to adopt the message you are answering, which is the common case'),
      anchorSpan     : z.string().optional().describe(
        "position within the target: 'L40' or 'L40-52' for a file, an occurrence " +
        "ordinal like '#2' for prompt/reply when the quote appears more than once, " +
        "'@3' for a checklist history point; entry anchors take none"),
      anchorQuote    : z.string().max(ANCHOR_QUOTE_MAX).optional().describe(
        `the exact excerpt being annotated, at most ${String(ANCHOR_QUOTE_MAX)} characters — quote ` +
        'the shortest span that is unambiguous. REQUIRED for prompt and reply anchors. ' +
        'A one-way hash of it is stored too, and survives quote suppression so drift ' +
        'detection keeps working without keeping the words'),
      visible        : z.boolean().optional().describe('false when logged but not surfaced'),
      correctsId     : z.number().int().optional().describe(
        'id of an earlier entry this links to; the kind says how. Take the id from ' +
        'recall, never from memory of a recorded #N reply'),
      correctsKind   : z.enum(tuple(CORRECTION_KINDS)).optional().describe(
        'REQUIRED with correctsId — what the link means: retracts (the target is wrong; ' +
        'do not rely on any of it), amends (the target stands, a detail is refined), ' +
        'resolves (the target was an open forecast; this closes it — never wrongness). ' +
        'If a reader acting on the original claim would be harmed, it is retracts'),
      verbatim       : z.string().max(MAX_TEXT_CEILING).optional().describe(
        'the retracted or amended claim, quoted EXACTLY as it appeared — the same bytes, ' +
        'so the retraction is greppable from the error and the error from the retraction. ' +
        'Valid with correctsKind retracts/amends, or on a divergence entry with no ' +
        'correctsId (a prose-only retraction, where the claim was never recorded and the ' +
        'quote is the only anchor — required there)'),
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

  server.registerTool('annotate', {
    title       : 'Annotate',
    description :
      'Record several anchored notes at once — the code-review shape: many short notes ' +
      'bound to many locations, instead of prose that mentions locations. Each note is ' +
      'one row on its own channel, exactly as express would record it; the reply hands ' +
      'back the canonical rendered block to paste verbatim rather than imitate. ' +
      'All-or-nothing: one bad note rejects the batch naming its index, because a ' +
      'half-recorded review is worse than a rejected one. An anchored ambiguity mark is ' +
      'a notification, not a question — state which reading you took and carry on; a ' +
      'genuine blocker is still a need.',
    inputSchema : {
      notes   : z.array(z.object({
        channel      : z.enum(tuple(channels)).describe('which kind of expression this note is'),
        text         : z.string().min(1).max(MAX_TEXT_CEILING).describe(
          "the note; terse, one thought. The channel's own configured limit is checked at " +
          'write, exactly as in express — this bound is only the ceiling any of them may reach'),
        face         : z.string().optional().describe('the feeling face this note ends with'),
        anchorKind   : z.enum(tuple(ANCHOR_KINDS)).describe(
          'required here — a note with no anchor belongs in express, not in a batch of annotations'),
        anchorTarget : z.string().optional().describe(
          'path, prompt id, series key, or entry id; omit on a prompt anchor to adopt the message being answered'),
        anchorSpan   : z.string().optional().describe(
          "'L40' / 'L40-52' for a file, '#2' for a repeated quote, '@3' for a checklist history point"),
        anchorQuote  : z.string().max(ANCHOR_QUOTE_MAX).optional().describe(
          'the exact excerpt; REQUIRED for prompt and reply anchors'),
      })).min(1).max(ANNOTATE_MAX_NOTES).describe(
        `1 to ${String(ANNOTATE_MAX_NOTES)} notes; grouped by target in the returned block`),
      session : z.string().optional().describe(
        'usually omit — the hook supplies it, and an observed session beats a claimed one'),
    },
  }, (args) => handleAnnotate(store, pluginVersion, args, server.server.getClientVersion()));

  server.registerTool('begin_turn', {
    title       : 'Begin turn',
    description :
      'Volunteer what this turn is, at its start, on a host that has no turn-start hook ' +
      'to observe it. Records the same row the hook records — session, turn identity, ' +
      'working directory, effort, permission mode — so express, recall, and the signature ' +
      'gate have a turn to attach to instead of falling back to no-hook. Idempotent by ' +
      '(session, promptId): a second call for the same turn writes nothing and reports ' +
      'the row already standing, so it is harmless where a hook already fired. The row is ' +
      'marked source:tool, because a fact you volunteered and a fact the harness observed ' +
      'are not the same evidence and the record has to keep them apart. Call it once, at ' +
      'the top of a turn, before the opening signature.',
    inputSchema : {
      session        : z.string().min(1).describe(
        'the session this turn belongs to — the host\'s own session id where there is ' +
        'one, else a stable id you choose once and reuse for the whole conversation'),
      promptId       : z.string().min(1).describe(
        'the turn identifier, unique within the session and stable for the whole turn. ' +
        'This is what makes the call idempotent and what groups a turn\'s entries; ' +
        'inventing a fresh one mid-turn forks the turn'),
      turn           : z.enum(tuple(TURNS)).optional().describe(
        "what initiated this turn: reply (a human message), wakeup, notification, hook. " +
        "Say 'reply' only when a human actually just spoke"),
      cwd            : z.string().optional().describe(
        'the working directory, if the host exposes one; suppressed at write when ' +
        'privacy.store_cwd is false'),
      gitBranch      : z.string().optional().describe('the checked-out branch; same privacy gate'),
      permissionMode : z.string().optional().describe('the permission mode in force, if the host has one'),
      agentId        : z.string().optional().describe('this agent\'s id, when running as a subagent'),
      agentType      : z.string().optional().describe('this agent\'s type, when running as a subagent'),
      effort         : z.enum(tuple(EFFORTS)).optional().describe('the reasoning effort in force'),
      compactions    : z.number().int().min(0).optional().describe(
        'how many times this session has compacted so far'),
      promptLen      : z.number().int().min(0).optional().describe(
        'length of the prompt in characters; suppressed at write when ' +
        'privacy.store_prompt_len is false'),
    },
  }, (args) => handleBeginTurn(store, args));

  server.registerTool('recall', {
    title       : 'Recall',
    description :
      'Read back what has been recorded. Use before writing a signature so delta comes ' +
      'from the record rather than from memory, which degrades quietly. Every returned ' +
      'row carries its id and its derived status — stands, amended, or retracted — so a ' +
      'retraction can point at what you are reading instead of at what you remember. ' +
      'Retracted rows come back MARKED, never hidden: you should see that you took ' +
      'something back, not develop amnesia about it. retractions:true adds the register ' +
      'of currently taken-back claims, before → after. When no turn context was ever ' +
      'recorded, context and previous come back as "unknown ..." rather than null — this ' +
      'host does not report the turn, which is a different fact from nothing having ' +
      'happened.',
    inputSchema : {
      session     : z.string().optional().describe('omit to use the session the hook observed'),
      limit       : z.number().int().min(1).max(100).optional(),
      retractions : z.boolean().optional().describe(
        'include the retraction register: every standing retraction and amendment, ' +
        'newest first, each with the original and the replacement'),
    },
  }, (args) => {

    const observed = latestContext(store, args.session),
          session  = args.session ?? (typeof observed?.['session'] === 'string' ? observed['session'] : ''),
          recent   = recentEntries(store, args.limit ?? 10);

    // Degrade loudly. A null `context` reads as "nothing was happening"; the truth is
    // that this host fires no turn-start hook and nothing called begin_turn, so nothing
    // was ever observed. `turn_signed` already answers that condition with the word
    // `unknown`, and one vocabulary for one condition beats a second convention invented
    // beside it — so these say `unknown` too, with the reason attached.
    const context = observed ?? UNKNOWN_CONTEXT;

    // `previous` splits the same way, one question earlier. With no session there was
    // nothing to scope the lookup to, so no search happened at all — which is not the
    // same as "this session has no earlier signature", and a delta derived from an
    // unsearched absence would be a fabrication wearing a measurement's clothes.
    const previous = session === '' ? UNKNOWN_PREVIOUS : previousSignature(store, session);

    // Absent rather than empty when not asked for: an always-present `retractions: []`
    // would spend context on a key nobody requested, every single recall. The register
    // takes its own cap rather than `limit` — that argument sizes the recency window, and
    // "the last 3 entries" is a different question from "how many taken-back claims".
    const retractions = args.retractions === true
      ? register(store, { limit: REGISTER_DEFAULT_LIMIT })
      : undefined;

    return reply(JSON.stringify({ context, previous, recent, retractions }, null, 2));

  });

  server.registerTool('turn_signed', {
    title       : 'Turn signed',
    description : 'Whether this turn already carries a closing signature. Exact, by turn identity.',
    inputSchema : { promptId: z.string().optional() },
  }, (args) => {
    // Turn identity is the pair (session, prompt_id), so the observed session rides along
    // with the prompt id — but only when the context row is about the turn being asked
    // about. A caller-named promptId may belong to a session other than the newest
    // context row's, and pairing the two would ask about a turn nobody mentioned; there
    // the session stays undefined and narrows nothing, which is the fail-open reading.
    const context  = latestContext(store),
          observed = typeof context?.['prompt_id'] === 'string' ? context['prompt_id'] : '',
          promptId = args.promptId ?? observed,
          session  = promptId === observed && typeof context?.['session'] === 'string'
            ? context['session'] : undefined;
    return reply(promptId === '' ? 'unknown' : String(hasClosingSignature(store, session, promptId)));
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
