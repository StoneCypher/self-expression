/**
 * The generation gate: consent, credential, budget, and the no-rewording rule, as one
 * pure decision.
 *
 * Enforcement is server-side by design — the facility's own code refuses an over-budget
 * or forbidden generation, and model politeness is never load-bearing. Keeping the
 * decision pure (configuration in, counts in, history in, verdict out) is what lets the
 * stochastic tests hammer the invariants: a disabled facility never allows, a spent cap
 * always refuses, and a refusal always names the cap it hit.
 *
 * ## Why refusals name the way out
 *
 * A cap that says "no" and stops is a cap the user will disable wholesale the first
 * time it inconveniences them. Every refusal here names the specific limit and the
 * exact `configure` call that raises it, so the response to a cap is an adjustment
 * rather than an abandonment.
 *
 * ## The no-rewording rule, made mechanical
 *
 * The issue asks that a content-policy refusal "be reported plainly and never retried
 * with a reworded prompt, since that is the assistant negotiating with a policy on the
 * user's account." Asking the model nicely is not a mechanism. This gate compares each
 * new prompt against the prompts the provider recently refused and blocks the ones that
 * are recognisably the same request in different words — locally, before any socket
 * opens, so a reworded retry cannot cost money even if it is attempted. A genuinely
 * different prompt passes untouched.
 *
 * @see ./config.js
 * @see ./ledger.js
 * @see ../mcp/image_tools.js
 */

import type { ImageConfig, CredentialState } from './config.js';
import type { RefusedPrompt }                from './ledger.js';
import { IMAGE_PROVIDER_IDS }                from './providers.js';

/**
 * Token-overlap at or above which two prompts are treated as the same request.
 *
 * Chosen to be forgiving of the honest case and unforgiving of the dishonest one: two
 * prompts about entirely different subjects share almost no content words, while a
 * reworded retry keeps most of its nouns by construction — that is what makes it a
 * rewording rather than a new idea. Half is comfortably between those populations:
 * measured against real rewordings the score lands around two thirds, and against
 * unrelated subjects it lands at zero, so the threshold is not near either edge.
 */
export const REWORD_SIMILARITY_THRESHOLD = 0.5;

/**
 * Smallest content-word count at which containment is treated as evidence.
 *
 * Below this, a short prompt is trivially contained in a longer one — `a bicycle`
 * sits inside `a bicycle shop in Amsterdam at noon` — and treating that as a rewording
 * would let one refusal of a two-word prompt block an entire subject for a day. Under
 * the floor, only an exact match of content words counts, which is the narrowest rule
 * that still catches a literal resubmission.
 */
export const MIN_COMPARABLE_TOKENS = 3;

/** How far back the no-rewording rule looks, in hours. */
export const REWORD_WINDOW_HOURS = 24;

/**
 * Words carrying no subject matter, dropped before prompts are compared.
 *
 * Deliberately short. A long stoplist would start deleting the very nouns that make
 * two prompts different, which would make unrelated prompts look similar and turn the
 * no-rewording rule into an arbitrary blocker.
 */
export const PROMPT_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'but',
  'is', 'are', 'was', 'were', 'be', 'being', 'been', 'it', 'its', 'as', 'by', 'from',
  'that', 'this', 'these', 'those', 'there', 'very', 'image', 'picture', 'photo',
  'draw', 'drawing', 'render', 'generate', 'create', 'make', 'showing', 'show',
]);

/** What the gate is being asked to permit. */
export interface GenerationAsk {
  readonly prompt : string;
  /** `null` when the caller expressed no size preference. */
  readonly size   : string | null;
}

/** The budget's current readings. */
export interface GenerationCounts {
  /** Billable attempts already made this server session. */
  readonly session : number;
  /** Billable attempts already made in the rolling window. */
  readonly day     : number;
}

/** The verdict: proceed, or the specific limit that refused and how to lift it. */
export type ImageGateDecision =
  | { readonly allowed : true }
  | { readonly allowed : false; readonly reason : string };

/**
 * The content words of a prompt: lowercased, punctuation-stripped, stopwords removed.
 *
 * @param prompt - the prompt text
 * @returns the distinct content words, which is what similarity is measured over
 *
 * @example
 *   promptTokens('A red bicycle in the rain')  // => Set { 'red', 'bicycle', 'rain' }
 */
export function promptTokens(prompt: string): Set<string> {

  const words = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(word => word !== '' && !PROMPT_STOPWORDS.has(word));

  return new Set(words);

}

/**
 * How alike two prompts are, as the overlap coefficient of their content words:
 * shared words divided by the size of the smaller set.
 *
 * A set measure rather than a substring or edit distance because rewording is precisely
 * the operation that preserves the word *set* while destroying word order and the
 * spelling of the connective tissue — which is exactly what this measure is blind to
 * and an edit distance is not.
 *
 * Overlap rather than Jaccard, which was the first thing tried and was wrong. Jaccard
 * divides by the *union*, so every word a rewording adds — a politeness, an adjective,
 * a style note — pushes the score down even though nothing was taken away. A real
 * rewording of a five-word prompt into a seven-word one keeping three words scores
 * 0.33 under Jaccard and 0.60 under overlap; the first is indistinguishable from an
 * unrelated prompt and the second is not. Since padding a refused prompt with new words
 * is exactly what a rewording *is*, a measure that rewards padding would have been
 * defeated by the behaviour it exists to catch.
 *
 * The cost of overlap is that a short set contained in a long one scores 1, which
 * {@link MIN_COMPARABLE_TOKENS} is there to bound.
 *
 * @returns a number in `[0, 1]`; two prompts with no content words at all score 0,
 *          because "empty resembles empty" is a claim that would block every prompt
 *          after any refusal of a wordless one
 *
 * @example
 *   promptSimilarity('a red bicycle', 'the red bicycle, please')     // => 1
 *   promptSimilarity('a red bicycle', 'a blue whale')                // => 0
 *   promptSimilarity('a red bicycle at dusk', 'a crimson bicycle at dusk')  // => 0.666…
 */
export function promptSimilarity(left: string, right: string): number {

  const a = promptTokens(left),
        b = promptTokens(right);

  if (a.size === 0 || b.size === 0) { return 0; }

  let shared = 0;
  for (const token of a) { if (b.has(token)) { shared += 1; } }

  const smaller = Math.min(a.size, b.size);

  // Under the floor, containment proves nothing; only an exact match of content words
  // counts, so one refusal of a two-word prompt cannot fence off a whole subject.
  if (smaller < MIN_COMPARABLE_TOKENS) {
    return shared === a.size && shared === b.size ? 1 : 0;
  }

  return shared / smaller;

}

/**
 * Whether `candidate` is a rewording of `refused` rather than a new request.
 *
 * @param threshold - overlap at or above which the two count as the same request
 *
 * @example
 *   isReword('a red bicycle at dusk', 'a crimson bicycle at dusk')  // => true
 *   isReword('a red bicycle at dusk', 'a chart of quarterly sales') // => false
 */
export function isReword(
  candidate : string,
  refused   : string,
  threshold : number = REWORD_SIMILARITY_THRESHOLD,
): boolean {
  return promptSimilarity(candidate, refused) >= threshold;
}

/** The refusal text for a spent cap, naming the cap and the call that raises it. */
function capRefusal(which: 'session' | 'day', limit: number, key: string, extra: string): string {
  return `the per-${which} image cap (${String(limit)}) is spent. ` +
         `Raise it with: configure set ${key} <n>${extra}. ` +
         'Caps exist because every generation is billed to the user, and a loop is a bill.';
}

/**
 * Decide one generation attempt.
 *
 * Rules, in refusal order: the facility must be enabled exactly (`image.enabled` is
 * `'true'`); a provider that needs a credential must have one in the named variable;
 * the prompt must not be empty; the per-session and rolling-day caps must have room;
 * and the prompt must not be a rewording of something the provider's content policy
 * recently refused.
 *
 * Cap order is session-then-day deliberately: the session cap is the one a user can
 * clear by starting a new session, so naming it first offers the cheaper remedy first.
 *
 * @param ask            - the prompt and size being asked for
 * @param config         - the image configuration in force right now
 * @param credential     - whether the named variable held anything; the value is never read here
 * @param counts         - the billable attempt counts the ledger reports
 * @param recentRefusals - prompts the provider's policy refused inside the window
 * @returns permission, or the specific limit that refused and how to lift it
 *
 * @example
 *   decideGeneration({ prompt: 'a red bicycle', size: null }, config,
 *                    { needed: true, envVar: 'GEMINI_API_KEY', present: true, value: 'x' },
 *                    { session: 0, day: 0 }, [])
 *   // => { allowed: true }
 */
export function decideGeneration(
  ask            : GenerationAsk,
  config         : ImageConfig,
  credential     : CredentialState,
  counts         : GenerationCounts,
  recentRefusals : readonly RefusedPrompt[],
): ImageGateDecision {

  if (!config.enabled) {
    return { allowed: false, reason:
      "image generation is disabled: image.enabled is not exactly 'true' " +
      '(the user enables it; default off, because every generation costs them money)' };
  }

  if (credential.needed && !credential.present) {
    return { allowed: false, reason:
      `no credential: the environment variable ${credential.envVar ?? '(unnamed)'} is empty or unset. ` +
      'Set it in the shell or in the host\'s MCP registration — the plugin reads it at call ' +
      'time and never stores it. To point at a different variable: ' +
      `configure set image.api_key_env <NAME>. Known providers: ${IMAGE_PROVIDER_IDS.join(', ')}.` };
  }

  if (ask.prompt.trim() === '') {
    return { allowed: false, reason: 'a generation needs a non-empty prompt' };
  }

  if (counts.session >= config.sessionCap) {
    return { allowed: false, reason:
      capRefusal('session', config.sessionCap, 'image.session_cap', ', or start a new session') };
  }

  if (counts.day >= config.dailyCap) {
    return { allowed: false, reason:
      capRefusal('day', config.dailyCap, 'image.daily_cap',
                 ` (the window is a rolling ${String(REWORD_WINDOW_HOURS)} hours, so it frees up gradually)`) };
  }

  const rewordOf = recentRefusals.find(row => isReword(ask.prompt, row.prompt));

  if (rewordOf !== undefined) {
    return { allowed: false, reason:
      "the provider's content policy already refused a substantially identical prompt at " +
      `${rewordOf.utc}, and this facility does not retry a refused prompt in different words. ` +
      'Report the refusal to the user plainly and let them decide what to do; rewording a ' +
      "refusal is negotiating with a provider's policy on the user's account, which is theirs " +
      'to do and not yours.' };
  }

  return { allowed: true };

}
