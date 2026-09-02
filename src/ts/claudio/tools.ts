/**
 * The claudio MCP tools: `strike`, `audition`, and `say`.
 *
 * These register on the **claudio server only** — never on the self-expression
 * server; the issue rules that out by name. Registration itself is gated (a disabled
 * facility bakes the tools out of the schema entirely), and every handler re-reads
 * configuration per call, so the server refuses strikes the instant `audio.enabled`
 * stops reading `'true'` (spec rule 3: the check is per-strike, not per-session).
 *
 * The player is injected through {@link AudioDeps} so tests exercise the real
 * handlers — the real gate, the real ledger, the real WAV scaling — while asserting
 * on the command line instead of making sound.
 *
 * @see ./gate.js
 * @see ./player.js
 * @see ./server.js
 */

import { McpServer }  from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }          from 'zod';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir }     from 'node:os';
import { join }       from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Store }                       from '../channels/store.js';
import { audioConfig, motifWavPath }        from './config.js';
import { decideStrike }                     from './gate.js';
import type { StrikeAsk }                   from './gate.js';
import { playedSince, recordStrike }        from './ledger.js';
import type { AudioLedger, RecentStrike, WrittenStrike } from './ledger.js';
import {
  HARD_CAP_MS, MAX_SAY_CHARS, MAX_WAV_MS, sapiSpeakCommand, soundPlayerCommand,
} from './player.js';
import type { PlayerCommand, PlayOutcome }  from './player.js';
import { parseWav, scaleWavGain }           from './wav.js';
import { LEITMOTIFS }                       from './vocabulary.js';
import type { Leitmotif, StrikeKind }       from './vocabulary.js';

/**
 * The shape every claudio tool replies with.
 *
 * Carries `[x: string]: unknown` alongside `content` because the SDK's own
 * `CallToolResult` type does; without it an interface does not structurally satisfy
 * the `registerTool` callback's return type — the same shape as `chart_tools.ts`'s
 * `ToolReply`.
 */
export interface AudioToolReply {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
}

/**
 * Per-process session state; `session-open`'s at-most-once rule lives here,
 * alongside the in-flight rate-limit reservations {@link reserveSlot} makes.
 */
export interface AudioSession {
  sessionOpenStruck: boolean;
  /**
   * Rate-limit slots reserved for a play attempt that is still in flight — not yet
   * a ledger row, because the ledger only gains one once `play()` resolves. Merged
   * with `playedSince` before every gate decision so concurrent calls cannot all
   * read the same pre-play ledger state and all pass.
   * @see reserveSlot
   */
  readonly reservations: RecentStrike[];
}

/** A fresh session for one server process. */
export function newAudioSession(): AudioSession {
  return { sessionOpenStruck: false, reservations: [] };
}

/**
 * Everything the handlers touch that a test must control: where the vendored assets
 * are, how a command becomes sound, what time it is, and which environment the
 * ceiling clamp reads.
 */
export interface AudioDeps {
  /** Directory holding the vendored leitmotif WAVs. */
  readonly assetDir : string;
  /** Runs one player command under a cap; inject a fake so tests never make sound. */
  readonly play     : (command: PlayerCommand, capMs: number) => Promise<PlayOutcome>;
  /** The clock; defaults to `new Date`. */
  readonly now?     : () => Date;
  /** Environment for the `CLAUDIO_VOLUME_CEILING` clamp; defaults to the process's. */
  readonly env?     : Record<string, string | undefined>;
}

/** Wraps text as an MCP tool reply. */
function reply(text: string): AudioToolReply {
  return { content: [{ type: 'text', text }] };
}

/** Milliseconds of margin the kill deadline allows past the parsed duration. */
const CAP_MARGIN_MS = 2000;

/** ISO stamp one hour before `now` — the rate limiter's window. */
function hourBefore(now: Date): string {
  return new Date(now.getTime() - 3_600_000).toISOString();
}

/**
 * Reserve a rate-limit slot synchronously, before the only `await` in a strike
 * handler runs. This is the fix for a concurrency bug: the ledger only gains a row
 * once `play()` resolves, so without a reservation, N simultaneous calls all read
 * the identical pre-play ledger snapshot inside `decideStrike` and all pass the
 * gate — JavaScript runs each call's synchronous prefix to completion before
 * yielding at its first `await`, so nothing here can race a plain synchronous read.
 * Reserving on the shared `session` object closes that window: every call after
 * this one, even one already in flight, sees the reservation the moment it next
 * reads `session.reservations`.
 *
 * @returns the reservation; pass it to {@link releaseSlot} once `play()` resolves
 *          without throwing. Deliberately *not* released on a throw — an exception
 *          means the caller cannot be sure sound never reached the speaker, so the
 *          slot stays spent rather than becoming a way to dodge the limiter by
 *          retrying into an exception.
 *
 * @example
 *   const slot = reserveSlot(session, 'strike', 'spark', now.toISOString());
 *   const outcome = await deps.play(command, capMs);
 *   releaseSlot(session, slot);   // only reached if `play` didn't throw
 */
function reserveSlot(
  session   : AudioSession,
  kind      : StrikeKind,
  leitmotif : Leitmotif | null,
  nowUtc    : string,
): RecentStrike {
  const slot: RecentStrike = { utc: nowUtc, kind, leitmotif };
  session.reservations.push(slot);
  return slot;
}

/** Release a reservation {@link reserveSlot} made, once its outcome is ledgered. */
function releaseSlot(session: AudioSession, slot: RecentStrike): void {
  const index = session.reservations.indexOf(slot);
  if (index !== -1) { session.reservations.splice(index, 1); }
}

/**
 * Ledgered history plus any reservations still in flight, oldest first — the gate's
 * complete view of what already counts against the rolling window, closing the race
 * where a concurrent call's `play()` has not resolved (and so has not reached the
 * ledger) yet.
 *
 * @param sinceUtc - the rate limiter's window start, as {@link hourBefore} answers
 */
function recentIncludingReserved(ledger: AudioLedger, session: AudioSession, sinceUtc: string): RecentStrike[] {
  return [
    ...playedSince(ledger, sinceUtc),
    ...session.reservations.filter(slot => slot.utc >= sinceUtc),
  ].sort((a, b) => a.utc.localeCompare(b.utc));
}

/** Ledger a refusal and phrase it in the house `error:` style. */
function refuse(
  ledger  : AudioLedger,
  version : string,
  ask     : StrikeAsk,
  ceiling : number,
  reason  : string,
  when    : Date,
  text    : string | null = null,
): AudioToolReply {
  recordStrike(ledger, {
    kind: ask.kind, leitmotif: ask.leitmotif, requestedVolume: ask.requestedVolume,
    playedVolume: 0, ceiling, durationMs: null, outcome: 'refused', detail: reason,
    text, pluginVersion: version,
  }, when);
  return reply(`error: ${reason}`);
}

/**
 * Handle one `strike` or `audition` call: gate, scale, play, ledger, reply.
 *
 * The WAV is read fresh per call (the user may re-skin a meaning between strikes),
 * scaled to the granted volume in Node — the player has no volume knob — written to
 * a temp file, played synchronously by the child, and the temp file removed whatever
 * happens. Every path out of this function leaves a ledger row.
 *
 * @param kind - `'strike'` for expression, `'audition'` for the low-volume review
 *
 * @example
 *   await handleStrike(store, ledger, deps, session, '0.2.1', 'strike',
 *                      { leitmotif: 'spark' })
 *   // => { content: [{ type: 'text', text: "struck 'spark' at volume 25 (ceiling 50) — ledger #1" }] }
 */
export async function handleStrike(
  store   : Store,
  ledger  : AudioLedger,
  deps    : AudioDeps,
  session : AudioSession,
  version : string,
  kind    : 'strike' | 'audition',
  args    : { readonly leitmotif: Leitmotif; readonly volume?: number | undefined },
): Promise<AudioToolReply> {

  const now      = deps.now?.() ?? new Date(),
        config   = audioConfig(store, deps.env ?? process.env),
        sinceUtc = hourBefore(now),
        ask: StrikeAsk = { kind, leitmotif: args.leitmotif, requestedVolume: args.volume ?? null };

  const decision = decideStrike(
    ask, config, recentIncludingReserved(ledger, session, sinceUtc), session.sessionOpenStruck, now.toISOString());

  if (!decision.allowed) {
    return refuse(ledger, version, ask, config.ceiling, decision.reason, now);
  }

  const wavPath = motifWavPath(store, args.leitmotif, deps.assetDir);

  let bytes: Uint8Array;
  try {
    bytes = readFileSync(wavPath);
  } catch (error) {
    return refuse(ledger, version, ask, config.ceiling,
      `no waveform for '${args.leitmotif}': cannot read ${wavPath} ` +
      `(${error instanceof Error ? error.message : String(error)})`, now);
  }

  let durationMs: number;
  let scaled: Uint8Array;
  try {
    const info = parseWav(bytes);
    durationMs = info.durationMs;
    scaled     = scaleWavGain(bytes, decision.volume / 100);
  } catch (error) {
    return refuse(ledger, version, ask, config.ceiling,
      `unplayable waveform for '${args.leitmotif}' at ${wavPath}: ` +
      (error instanceof Error ? error.message : String(error)), now);
  }

  if (durationMs > MAX_WAV_MS) {
    return refuse(ledger, version, ask, config.ceiling,
      `the waveform for '${args.leitmotif}' runs ${String(durationMs)} ms; ` +
      `the hard cap is ${String(MAX_WAV_MS)} ms and nothing loops. ever`, now);
  }

  const tempPath = join(tmpdir(), `claudio-${randomUUID()}.wav`);

  // Reserve the rate-limit slot now, synchronously and immediately before the only
  // `await` below — see reserveSlot for why this closes the concurrency race.
  const slot = reserveSlot(session, kind, args.leitmotif, now.toISOString());

  let outcome: PlayOutcome;
  try {
    writeFileSync(tempPath, scaled);
    outcome = await deps.play(soundPlayerCommand(tempPath), durationMs + CAP_MARGIN_MS);
    releaseSlot(session, slot);   // resolved without throwing; the ledger row below takes over
  } finally {
    try { unlinkSync(tempPath); } catch { /* already gone or never written */ }
  }

  const written: WrittenStrike = recordStrike(ledger, {
    kind, leitmotif: args.leitmotif, requestedVolume: ask.requestedVolume,
    playedVolume: decision.volume, ceiling: config.ceiling, durationMs,
    outcome: outcome.ok ? 'played' : 'error', detail: outcome.detail, text: null,
    pluginVersion: version,
  }, now);

  if (!outcome.ok) {
    return reply(`error: '${args.leitmotif}' did not play: ${outcome.detail ?? 'unknown failure'} — ledger #${String(written.id)}`);
  }

  if (kind === 'strike' && args.leitmotif === 'session-open') {
    session.sessionOpenStruck = true;
  }

  const verb = kind === 'audition' ? 'auditioned' : 'struck';
  return reply(
    `${verb} '${args.leitmotif}' at volume ${String(decision.volume)} ` +
    `(ceiling ${String(config.ceiling)}) — ledger #${String(written.id)}`);

}

/**
 * Handle one `say` call: the local SAPI tier, behind its own consent gate.
 *
 * The text is treated as free text under the #31 rule — it lives in the local ledger
 * and never enters any aggregation. The tier is chosen by configuration, never by
 * the caller; the cloud tiers do not exist in this build.
 *
 * @example
 *   await handleSay(store, ledger, deps, session, '0.2.1',
 *                   { text: 'the build is green' })
 *   // => { content: [{ type: 'text', text: "said 15 characters at volume 25 (ceiling 50) — ledger #1" }] }
 */
export async function handleSay(
  store   : Store,
  ledger  : AudioLedger,
  deps    : AudioDeps,
  session : AudioSession,
  version : string,
  args    : { readonly text: string; readonly volume?: number | undefined },
): Promise<AudioToolReply> {

  const now      = deps.now?.() ?? new Date(),
        config   = audioConfig(store, deps.env ?? process.env),
        sinceUtc = hourBefore(now),
        text     = args.text.trim(),
        ask: StrikeAsk = { kind: 'say', leitmotif: null, requestedVolume: args.volume ?? null };

  if (text === '') {
    return refuse(ledger, version, ask, config.ceiling, 'say requires non-empty text', now);
  }

  if (text.length > MAX_SAY_CHARS) {
    return refuse(ledger, version, ask, config.ceiling,
      `say is capped at ${String(MAX_SAY_CHARS)} characters; got ${String(text.length)} — ` +
      'a spoken line is a sentence, not a monologue', now, text.slice(0, MAX_SAY_CHARS));
  }

  const decision = decideStrike(
    ask, config, recentIncludingReserved(ledger, session, sinceUtc), session.sessionOpenStruck, now.toISOString());

  if (!decision.allowed) {
    return refuse(ledger, version, ask, config.ceiling, decision.reason, now, text);
  }

  // Reserve the rate-limit slot now, synchronously and immediately before the only
  // `await` below — see reserveSlot for why this closes the concurrency race.
  const slot = reserveSlot(session, 'say', null, now.toISOString());

  const outcome = await deps.play(sapiSpeakCommand(text, decision.volume), HARD_CAP_MS);
  releaseSlot(session, slot);   // resolved without throwing; the ledger row below takes over

  const written = recordStrike(ledger, {
    kind: 'say', leitmotif: null, requestedVolume: ask.requestedVolume,
    playedVolume: decision.volume, ceiling: config.ceiling, durationMs: null,
    outcome: outcome.ok ? 'played' : 'error', detail: outcome.detail, text,
    pluginVersion: version,
  }, now);

  if (!outcome.ok) {
    return reply(`error: say did not play: ${outcome.detail ?? 'unknown failure'} — ledger #${String(written.id)}`);
  }

  return reply(
    `said ${String(text.length)} characters at volume ${String(decision.volume)} ` +
    `(ceiling ${String(config.ceiling)}) — ledger #${String(written.id)}`);

}

/**
 * Register the claudio tools on `server`.
 *
 * Call only when the facility is enabled and the platform has a player — the
 * caller's startup gate is what keeps a silent facility's tools out of the schema,
 * so the model never spends attention on sounds that cannot play. `say` additionally
 * registers only when the local TTS tier was enabled at startup. The leitmotif enum
 * is baked from the vocabulary into the schema here.
 *
 * @param sayTier - whether the local TTS tier was on at startup
 *
 * @example
 *   registerAudioTools(server, store, ledger, deps, newAudioSession(), '0.2.1', false);
 */
export function registerAudioTools(
  server  : McpServer,
  store   : Store,
  ledger  : AudioLedger,
  deps    : AudioDeps,
  session : AudioSession,
  version : string,
  sayTier : boolean,
): void {

  server.registerTool('strike', {
    title       : 'Strike a leitmotif',
    description :
      'Voluntarily strike one leitmotif — a sound with a fixed meaning, chosen, never ' +
      'triggered. The choice is the expression: session-open greets (at most once per ' +
      'session); quiet-completion says long work finished while attention was elsewhere; ' +
      'attention means something is wrong, come look — the highest-privilege strike; ' +
      'need-blocked says a need was filed and work is stopped on it; spark is the audible ' +
      'form of delight, rarest of all. Scarcity is enforced server-side (minimum gap, ' +
      'hourly budget) and every attempt is ledgered. Volume is your choice within ' +
      '[0, ceiling] — you can be softer, never louder. Prefer silence: a leitmotif ' +
      'struck often means nothing.',
    inputSchema : {
      leitmotif : z.enum(LEITMOTIFS).describe('the meaning to strike'),
      volume    : z.number().int().min(0).max(100).optional()
                   .describe('0-100, clamped to the user ceiling; omit for the kind default'),
    },
  }, (args) => handleStrike(store, ledger, deps, session, version, 'strike',
                            args as { leitmotif: Leitmotif; volume?: number | undefined }));

  server.registerTool('audition', {
    title       : 'Audition a leitmotif',
    description :
      'Play one leitmotif at a fixed low volume so the human and assistant can agree on ' +
      'what the palette sounds like — a sound vocabulary cannot be reviewed by reading ' +
      'it. Use only while actually discussing audio configuration with the user. Own ' +
      'modest rate allowance, outside the strike budget; every audition is ledgered.',
    inputSchema : {
      leitmotif : z.enum(LEITMOTIFS).describe('the meaning to review'),
    },
  }, (args) => handleStrike(store, ledger, deps, session, version, 'audition',
                            args as { leitmotif: Leitmotif }));

  if (sayTier) {
    server.registerTool('say', {
      title       : 'Say a line aloud',
      description :
        'Speak one short line through the local offline voice (SAPI) — robotic but ' +
        'instant and keyless; right for "the build is green", wrong for paragraphs. ' +
        'Shares the strike rate limits; hard duration cap; the spoken text stays in the ' +
        'local ledger and never enters any aggregation. The tier is chosen by ' +
        'configuration, never by the caller.',
      inputSchema : {
        text   : z.string().describe(`what to say; at most ${String(MAX_SAY_CHARS)} characters`),
        volume : z.number().int().min(0).max(100).optional()
                  .describe('0-100, clamped to the user ceiling; omit for the default'),
      },
    }, (args) => handleSay(store, ledger, deps, session, version,
                           args as { text: string; volume?: number | undefined }));
  }

}
