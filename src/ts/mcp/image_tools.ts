/**
 * The `generate_image` MCP tool: the whole of the image facility's surface.
 *
 * Registration follows the credential, not the configuration. When the facility is off,
 * or on with no usable credential, the tool is **not registered at all** — absent from
 * the tool list rather than present and refusing — following the same precedent as the
 * `dwell` tool and the claudio server: a locked door should cost no attention. What a
 * misconfiguration produces instead is a line on stderr naming the variable that is
 * empty, which is legible without being fatal and without being silent.
 *
 * ## Three independent scrubs
 *
 * A credential could leave by three doors, and each has its own lock, none of which
 * relies on the others holding:
 *
 *  1. **the error path** — `client.ts` scrubs every outcome detail with the held key;
 *  2. **the ledger path** — `ledger.ts` pattern-scrubs every text column, holding no
 *     key at all;
 *  3. **the tool-reply path** — this module scrubs the finished reply text with the
 *     held key as the last thing it does before returning.
 *
 * The tests break each lock separately and check the others still hold.
 *
 * ## Why this blocks, and what watches it anyway
 *
 * Generation takes seconds to a minute, and the issue asks whether the tool should
 * block or hand back a handle. It blocks — a handle would need a second tool, a job
 * store, a pruner, and a model that remembers to poll, which is four new things to be
 * wrong. The handle exists anyway and costs nothing: the ledger row is written as
 * `pending` **before** the request is sent, so a panel watching `images.sqlite3` sees
 * the generation in flight, sees it settle, and sees a crashed process leave a
 * `pending` row behind — which is the one outcome an after-the-fact ledger could never
 * record and is also the one that may still have been billed.
 *
 * @see ../imagery/gate.js
 * @see ../imagery/client.js
 * @see ../imagery/ledger.js
 */

import { McpServer }  from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }          from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }       from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Store } from '../channels/store.js';
import {
  imageConfig, resolveCredential, credentialAvailable, IMAGE_ENABLED_KEY,
} from '../imagery/config.js';
import type { ImageConfig }        from '../imagery/config.js';
import { decideGeneration, REWORD_WINDOW_HOURS } from '../imagery/gate.js';
import { callProvider, nodeSend }  from '../imagery/client.js';
import type { HttpSend }           from '../imagery/client.js';
import { estimateCost, IMAGE_SIZES, IMAGE_PROVIDER_IDS } from '../imagery/providers.js';
import type { ImageSize }          from '../imagery/providers.js';
import {
  billableInSession, billableSince, closeImageLedger, openImageLedger,
  policyRefusalsSince, recordAttempt, recordRefusal, settleAttempt,
} from '../imagery/ledger.js';
import type { AttemptRecord, ImageLedger } from '../imagery/ledger.js';
import { imageDbPath, imagesDir, imageFileName } from '../imagery/paths.js';
import { PROMPT_SOURCES }  from '../imagery/schema.js';
import type { PromptSource } from '../imagery/schema.js';
import { scrub }           from '../imagery/scrub.js';

/** The tool's name, which is also what a host's permission cache keys on. */
export const IMAGE_TOOL_NAME = 'generate_image';

/**
 * The shape every image tool reply carries.
 *
 * Carries `[x: string]: unknown` alongside `content` because the SDK's own
 * `CallToolResult` type does, matching `chart_tools.ts`'s `ToolReply` and
 * `claudio/tools.ts`'s `AudioToolReply`.
 */
export interface ImageToolReply {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
}

/** Everything the handler touches that a test must control. */
export interface ImageDeps {
  /** How a planned request becomes a reply; inject a fake so tests never leave the box. */
  readonly send       : HttpSend;
  /** Directory generated images are written into. */
  readonly imagesRoot : string;
  /** The per-process session id the session cap is counted against. */
  readonly sessionId  : string;
  /** Environment the credential variable is read from; defaults to the process's. */
  readonly env?       : Record<string, string | undefined>;
  /** The clock; defaults to `new Date`. */
  readonly now?       : () => Date;
}

/** What a caller supplies to `generate_image`, after schema validation. */
export interface GenerateImageArgs {
  readonly prompt        : string;
  readonly source        : PromptSource;
  readonly source_detail? : string | undefined;
  readonly size?         : ImageSize | undefined;
}

/** Wraps text as an MCP tool reply. */
function reply(text: string): ImageToolReply {
  return { content: [{ type: 'text', text }] };
}

/** ISO stamp one rolling window before `now`. */
function windowStart(now: Date): string {
  return new Date(now.getTime() - REWORD_WINDOW_HOURS * 3_600_000).toISOString();
}

/** A cost figure as a short human string, or a note that none is known. */
function describeCost(usd: number | null, source: string): string {
  return usd === null
    ? 'cost unknown'
    : `about $${usd.toFixed(3)} (${source === 'provider' ? 'provider-reported' : 'list-price estimate'})`;
}

/**
 * A fresh per-process session id, which the session cap is counted against.
 *
 * @example
 *   newImageSessionId()  // => '5f2e…'
 */
export function newImageSessionId(): string {
  return randomUUID();
}

/**
 * Whether the facility should register its tool, and what to say if it should not.
 *
 * The three states are deliberately distinct. Off is silent — a facility nobody asked
 * for should not lecture. Configured-but-unavailable is a warning naming the variable,
 * because that is a user who meant to turn this on and will otherwise be left
 * wondering why nothing happened. On is a line saying which provider and which
 * variable, so the configuration is legible from the log without ever printing a key.
 *
 * @param store - the shared log store the `config` table lives in
 * @param env   - the environment the credential variable is read from
 * @returns whether to register, and the stderr line to print (`null` for silence)
 *
 * @example
 *   imageFacility(store, {})
 *   // => { register: false, note: null }                       — off, and quiet about it
 *   writeConfig(store, 'image.enabled', 'true');
 *   imageFacility(store, {})
 *   // => { register: false, note: 'image generation is enabled but GEMINI_API_KEY …' }
 */
export function imageFacility(
  store : Store,
  env   : Record<string, string | undefined> = process.env,
): { register: boolean; note: string | null; config: ImageConfig } {

  const config = imageConfig(store);

  if (!config.enabled) { return { register: false, note: null, config }; }

  if (!credentialAvailable(config, env)) {
    return { register: false, config, note:
      `image generation is enabled (provider ${config.provider.id}) but the environment ` +
      `variable ${config.credentialEnvVar ?? '(unnamed)'} is empty or unset, so the ` +
      `${IMAGE_TOOL_NAME} tool is not registered. Set that variable, or point at another ` +
      'with: configure set image.api_key_env <NAME>. The plugin reads the variable at call ' +
      'time and never stores its value.' };
  }

  return { register: true, config, note:
    `image generation enabled — provider ${config.provider.id}, model ${config.model}, ` +
    `credential from ${config.credentialEnvVar ?? '(none needed)'}, caps ` +
    `${String(config.sessionCap)}/session and ${String(config.dailyCap)}/day` };

}

/**
 * Open the generation ledger when — and only when — the facility will register.
 *
 * Returns `null` and costs nothing otherwise. A ledger that cannot be opened is fatal
 * here rather than survivable, mirroring the audio facility: a thing that spends money
 * must not run when it cannot record having done so.
 *
 * @example
 *   const ledger = maybeOpenImageLedger(store);   // => null until the user enables it
 *
 * @throws {Error} If the ledger file cannot be created or opened.
 */
export function maybeOpenImageLedger(
  store : Store,
  env   : Record<string, string | undefined> = process.env,
): ImageLedger | null {
  return imageFacility(store, env).register ? openImageLedger(imageDbPath(env)) : null;
}

/**
 * Handle one `generate_image` call: gate, ledger, request, write, settle, reply.
 *
 * Every path out of this function leaves a ledger row, and every path out of this
 * function returns text that has been scrubbed with the credential in hand. The bytes
 * are written to `<dataDir>/images/` and only the **path** is returned — inlining image
 * data into a tool reply would put a megabyte of base64 into the model's context for no
 * benefit, and would put the user's generated art through the transport a second time.
 *
 * @param store   - the log store, read fresh per call so a disable takes hold at once
 * @param ledger  - the open generation ledger
 * @param deps    - sender, output directory, session id, clock, environment
 * @param version - the plugin version, stamped on the ledger row
 * @param args    - the validated tool arguments
 *
 * @example
 *   await handleGenerateImage(store, ledger, deps, '0.2.1',
 *                             { prompt: 'a red bicycle', source: 'composed' })
 *   // => { content: [{ type: 'text', text: 'wrote C:\\…\\images\\openai_….png …' }] }
 */
export async function handleGenerateImage(
  store   : Store,
  ledger  : ImageLedger,
  deps    : ImageDeps,
  version : string,
  args    : GenerateImageArgs,
): Promise<ImageToolReply> {

  const now        = deps.now?.() ?? new Date(),
        env        = deps.env ?? process.env,
        config     = imageConfig(store),
        credential = resolveCredential(config, env),
        secrets    = credential.value === null ? [] : [credential.value];

  const size = args.size ?? null,
        ask  = { prompt: args.prompt, size };

  const attempt: AttemptRecord = {
    sessionId          : deps.sessionId,
    provider           : config.provider.id,
    model              : config.model,
    prompt             : args.prompt,
    promptSource       : args.source,
    promptSourceDetail : args.source_detail ?? null,
    size,
    credentialEnvVar   : config.credentialEnvVar,
    pluginVersion      : version,
  };

  const decision = decideGeneration(
    ask, config, credential,
    { session : billableInSession(ledger, deps.sessionId),
      day     : billableSince(ledger, windowStart(now)) },
    policyRefusalsSince(ledger, windowStart(now)),
  );

  if (!decision.allowed) {
    const written = recordRefusal(ledger, attempt, decision.reason, now);
    return reply(scrub(`error: ${decision.reason} — ledger #${String(written.id)}`, secrets));
  }

  const written = recordAttempt(ledger, attempt, now);

  const outcome = await callProvider(
    config.provider,
    config.provider.plan({
      prompt     : args.prompt,
      model      : config.model,
      // Belt and braces, and deliberately unobservable today: no current provider both
      // declares `supportsSize: false` and reads `input.size`, so removing this guard
      // changes nothing a test could see. The invariant that actually protects the
      // behaviour lives in the registry contract test ('supportsSize tells the truth in
      // both directions'); this line is what keeps that contract cheap to honour when a
      // future provider is added.
      size       : config.provider.supportsSize ? size : null,
      credential : credential.value,
      baseUrl    : config.localBaseUrl,
    }),
    deps.send,
    config.timeoutSeconds * 1000,
    secrets,
  );

  if (outcome.kind === 'policy') {
    settleAttempt(ledger, written.id, {
      outcome: 'policy_refused', detail: outcome.detail, imageCount: 0, bytes: null,
      path: null, costEstimateUsd: null, costSource: 'none', providerRequestId: null,
    }, now);
    return reply(scrub(
      `refused by provider policy: ${outcome.detail} — ledger #${String(written.id)}. ` +
      'Report this to the user in plain words and stop. Do not reword the prompt and try ' +
      "again: this facility blocks a reworded retry for the next " +
      `${String(REWORD_WINDOW_HOURS)} hours, and negotiating with a provider's content ` +
      "policy on the user's account and the user's money is the user's decision, not yours.",
      secrets));
  }

  if (outcome.kind === 'error') {
    settleAttempt(ledger, written.id, {
      outcome: 'error', detail: outcome.detail, imageCount: 0, bytes: null,
      path: null, costEstimateUsd: null, costSource: 'none', providerRequestId: null,
    }, now);
    return reply(scrub(`error: ${outcome.detail} — ledger #${String(written.id)}`, secrets));
  }

  const cost  = estimateCost(config.provider, outcome),
        paths : string[] = [];

  let total = 0;

  try {
    mkdirSync(deps.imagesRoot, { recursive: true });
    for (const [index, image] of outcome.images.entries()) {
      const path = join(deps.imagesRoot,
        imageFileName(config.provider.id, now, written.uuid, image.extension, index));
      writeFileSync(path, image.bytes);
      paths.push(path);
      total += image.bytes.length;
    }
  } catch (error) {
    const detail = `the image could not be written to ${deps.imagesRoot}: ` +
                   (error instanceof Error ? error.message : String(error));
    settleAttempt(ledger, written.id, {
      outcome: 'error', detail, imageCount: 0, bytes: null, path: null,
      costEstimateUsd: cost.usd, costSource: cost.source,
      providerRequestId: outcome.providerRequestId,
    }, now);
    return reply(scrub(
      `error: ${detail} — the provider was still billed; ledger #${String(written.id)}`, secrets));
  }

  settleAttempt(ledger, written.id, {
    outcome: 'generated', detail: null, imageCount: paths.length, bytes: total,
    path: paths[0] ?? null, costEstimateUsd: cost.usd, costSource: cost.source,
    providerRequestId: outcome.providerRequestId,
  }, now);

  return reply(scrub(
    `${paths.join('\n')}\n` +
    `${String(paths.length)} image(s), ${String(total)} bytes, ${config.provider.id}/${config.model}, ` +
    `${describeCost(cost.usd, cost.source)} — ledger #${String(written.id)}. ` +
    'The file is on the user’s disk; give them the path rather than the picture.',
    secrets));

}

/**
 * Register `generate_image` on `server`.
 *
 * Call only when {@link imageFacility} says to — the caller's check is what keeps a
 * keyless facility's tool out of the schema entirely.
 *
 * @example
 *   const state = imageFacility(store);
 *   if (state.register) { registerImageTools(server, store, ledger, deps, version); }
 */
export function registerImageTools(
  server  : McpServer,
  store   : Store,
  ledger  : ImageLedger,
  deps    : ImageDeps,
  version : string,
): void {

  const config = imageConfig(store);

  server.registerTool(IMAGE_TOOL_NAME, {
    title       : 'Generate an image',
    description :
      'Generate one image from a prompt through the user’s own paid provider account, ' +
      `currently ${config.provider.label}. **Every call spends the user's money.** ` +
      'Per-session and per-day caps are enforced server-side and every attempt is ' +
      'ledgered; a refusal names the cap and how to raise it. The image is written to a ' +
      'file and you are handed the path — never the bytes. Declare where the prompt’s ' +
      'words came from with `source`: prompts assembled from a file, a page, or a repo ' +
      'send content of unknown provenance to a third party on the user’s account, and the ' +
      'ledger records which it was. If the provider’s content policy refuses, say so ' +
      'plainly and stop — do not reword and retry; that is negotiating with a policy on ' +
      'someone else’s account, and it is blocked here anyway.',
    inputSchema : {
      prompt        : z.string().min(1).describe('what to generate; composed deliberately, not pasted from elsewhere without saying so'),
      source        : z.enum(PROMPT_SOURCES).describe(
        "where the prompt's words came from: 'composed' (you wrote them), 'user' (they " +
        "did), 'file', 'web', 'repository', or 'other' — recorded in the ledger so what " +
        'was sent to a third party can be reconstructed'),
      source_detail : z.string().optional().describe(
        'when source is not composed: the path, URL, or reference the words came from'),
      size          : z.enum(IMAGE_SIZES).optional().describe(
        `output size; honoured only by providers that support it (${IMAGE_PROVIDER_IDS.join(', ')} vary)`),
    },
  }, (args) => handleGenerateImage(store, ledger, deps, version, args as GenerateImageArgs));

}

/**
 * Build the dependencies the real server runs with: `fetch`, the resolved images
 * directory, and a fresh session id.
 *
 * @example
 *   const deps = defaultImageDeps();
 */
export function defaultImageDeps(
  env : Record<string, string | undefined> = process.env,
): ImageDeps {
  return { send: nodeSend, imagesRoot: imagesDir(env), sessionId: newImageSessionId(), env };
}

/** Close the generation ledger if one is open. */
export function closeImageFacility(ledger: ImageLedger | null): void {
  if (ledger !== null) { closeImageLedger(ledger); }
}

/** Config key re-exported so the server's warning path names it without a second import. */
export { IMAGE_ENABLED_KEY };
