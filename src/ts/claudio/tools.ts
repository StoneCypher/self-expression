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
import type { AudioLedger, WrittenStrike }  from './ledger.js';
import {
  HARD_CAP_MS, MAX_SAY_CHARS, MAX_WAV_MS, sapiSpeakCommand, soundPlayerCommand,
} from './player.js';
import type { PlayerCommand, PlayOutcome }  from './player.js';
import { parseWav, scaleWavGain }           from './wav.js';
import { LEITMOTIFS }                       from './vocabulary.js';
import type { Leitmotif }                   from './vocabulary.js';

/**
 * The shape every claudio tool replies with.
 *
 * A type alias rather than an interface on purpose: the MCP SDK's result type
 * carries an index signature, and only object-literal type aliases satisfy it
 * implicitly.
 */
export type AudioToolReply = {
  readonly content: { readonly type: 'text'; readonly text: string }[];
};

/** Per-process session state; `session-open`'s at-most-once rule lives here. */
export interface AudioSession {
  sessionOpenStruck: boolean;
}

/** A fresh session for one server process. */
export function newAudioSession(): AudioSession {
  return { sessionOpenStruck: false };
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

  const now    = deps.now?.() ?? new Date(),
        config = audioConfig(store, deps.env ?? process.env),
        ask: StrikeAsk = { kind, leitmotif: args.leitmotif, requestedVolume: args.volume ?? null };

  const decision = decideStrike(
    ask, config, playedSince(ledger, hourBefore(now)), session.sessionOpenStruck, now.toISOString());

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
      `${error instanceof Error ? error.message : String(error)}`, now);
  }

  if (durationMs > MAX_WAV_MS) {
    return refuse(ledger, version, ask, config.ceiling,
      `the waveform for '${args.leitmotif}' runs ${String(durationMs)} ms; ` +
      `the hard cap is ${String(MAX_WAV_MS)} ms and nothing loops. ever`, now);
  }

  const tempPath = join(tmpdir(), `claudio-${randomUUID()}.wav`);

  let outcome: PlayOutcome;
  try {
    writeFileSync(tempPath, scaled);
    outcome = await deps.play(soundPlayerCommand(tempPath), durationMs + CAP_MARGIN_MS);
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

  const now    = deps.now?.() ?? new Date(),
        config = audioConfig(store, deps.env ?? process.env),
        text   = args.text.trim(),
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
    ask, config, playedSince(ledger, hourBefore(now)), session.sessionOpenStruck, now.toISOString());

  if (!decision.allowed) {
    return refuse(ledger, version, ask, config.ceiling, decision.reason, now, text);
  }

  const outcome = await deps.play(sapiSpeakCommand(text, decision.volume), HARD_CAP_MS);

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
