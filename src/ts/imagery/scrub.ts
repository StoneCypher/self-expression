/**
 * The credential scrubber: the one place a secret is removed from text, and the
 * reason the rest of this facility can be careless without being dangerous.
 *
 * The credential rule for image generation is that **configuration names the
 * environment variable and never holds the key**. That rule is only worth as much as
 * the weakest path text takes out of the facility, and the weakest path is always the
 * same one: a provider rejects a request, its client echoes the request it sent —
 * headers included — into an error message, and the error message goes to a log. That
 * is how keys reach logs in every language and every SDK, and it is not a hypothetical
 * this facility gets to opt out of.
 *
 * Two independent mechanisms live here, and neither depends on the other:
 *
 * - {@link scrubSecrets} removes credential values the caller *holds* — the string
 *   `resolveCredential` just read out of the environment — in every form a request
 *   plausibly carries it: literal, percent-encoded, and base64 (HTTP basic auth).
 * - {@link scrubUnknown} removes credential *shapes* the caller does not hold: an
 *   `sk-` token, a Google `AIza` key, a bearer header, a `?key=` query parameter, a
 *   JSON `"api_key"` field. This catches a key that arrived from somewhere the caller
 *   never looked, and it needs no secret to work — which is exactly why the ledger can
 *   apply it structurally, with no access to the credential at all.
 *
 * {@link scrub} runs both, in that order, and is what every outward path calls.
 *
 * Scrubbing too much is a cosmetic defect. Scrubbing too little is a disclosed
 * credential. Every judgement call in this file is resolved in that direction.
 *
 * @see ./client.js
 * @see ./ledger.js
 * @see ../mcp/image_tools.js
 */

/** What a removed credential is replaced with, everywhere. */
export const REDACTION = '[redacted]';

/**
 * Shortest secret {@link scrubSecrets} will replace literally, in characters.
 *
 * A configured variable holding one or two characters is not a credential, and
 * replacing every occurrence of `a` would destroy the text it was meant to protect —
 * turning a cosmetic problem into an unreadable one without protecting anything. Four
 * is comfortably below every real API key and comfortably above the range where
 * literal replacement does more harm than good; shapes shorter than this are still
 * covered by {@link scrubUnknown} if they look like credentials at all.
 */
export const MIN_LITERAL_SECRET_CHARS = 4;

/**
 * Credential *shapes*, removed whether or not the caller holds the value.
 *
 * Every pattern keeps its label and destroys only the value: a scrubbed line still
 * reads `Authorization: [redacted]`, so a human debugging a failure can still see that
 * an authorization header was sent, which is the diagnostic they actually needed.
 *
 * Ordered longest-context-first, so the header and query forms claim their text before
 * the bare-token patterns can nibble at the middle of them.
 */
export const CREDENTIAL_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [

  // `Authorization: Bearer xyz` / `"authorization": "Basic xyz"`, in headers, JSON, or prose.
  // The optional quote after the name is what makes the JSON spelling match too — a
  // stringified headers object is the single likeliest thing to be in an error message.
  { pattern     : /(\bauthorization\b["']?\s*[:=]\s*)(?:"|')?(?:bearer|basic|token)?\s*[A-Za-z0-9._~+/=-]{4,}(?:"|')?/gi,
    replacement : `$1${REDACTION}` },

  // A bare bearer token with no header name in front of it.
  { pattern     : /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement : `Bearer ${REDACTION}` },

  // Vendor key headers and their JSON/prose spellings.
  { pattern     : /(\b(?:x-goog-api-key|x-api-key|api[-_]?key|apikey|access[-_]?token|secret[-_]?key)\b["']?\s*[:=]\s*)(?:"|')?[A-Za-z0-9._~+/=-]{4,}(?:"|')?/gi,
    replacement : `$1${REDACTION}` },

  // Credential-bearing query parameters, whichever separator introduced them.
  { pattern     : /([?&](?:key|api_key|apikey|access_token|token|auth)=)[^&\s"'#]+/gi,
    replacement : `$1${REDACTION}` },

  // OpenAI-style project and user keys.
  { pattern     : /\bsk-[A-Za-z0-9_-]{12,}/g,
    replacement : REDACTION },

  // Google API keys.
  { pattern     : /\bAIza[A-Za-z0-9_-]{20,}/g,
    replacement : REDACTION },

  // Anthropic-style keys, since a user may well have one in the same environment.
  { pattern     : /\bsk-ant-[A-Za-z0-9_-]{12,}/g,
    replacement : REDACTION },

];

/** Escape a string for literal use inside a regular expression. */
function escapeForRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every textual form one secret plausibly appears in, longest first.
 *
 * A request carries its credential in more than one encoding: a header holds it
 * literally, a query string percent-encodes it, and HTTP basic auth base64s it. A
 * scrubber that only knew the literal form would pass the other two straight through,
 * which is the failure mode worth spending twenty lines to avoid.
 *
 * @param secret - the credential value, already known non-empty
 * @returns the distinct encodings to search for, longest first so a longer form is
 *          consumed before a shorter one can split it; encodings shorter than
 *          {@link MIN_LITERAL_SECRET_CHARS} are dropped for the same reason short
 *          secrets are
 *
 * @example
 *   secretForms('a b c')  // => ['a%20b%20c', 'YSBiIGM=', 'OmEgYiBj', 'a b c']
 */
export function secretForms(secret: string): string[] {

  const forms = new Set<string>([secret]);

  forms.add(encodeURIComponent(secret));
  forms.add(Buffer.from(secret, 'utf8').toString('base64'));
  forms.add(Buffer.from(`:${secret}`, 'utf8').toString('base64'));

  return [...forms]
    .filter(form => form.length >= MIN_LITERAL_SECRET_CHARS)
    .sort((a, b) => b.length - a.length);

}

/**
 * Remove every occurrence of every held secret, in every encoding, from `text`.
 *
 * Secrets shorter than {@link MIN_LITERAL_SECRET_CHARS} and secrets that are empty or
 * whitespace-only are skipped: they are not credentials, and replacing them would
 * shred the text without protecting anything.
 *
 * @param text    - the text about to leave the facility
 * @param secrets - credential values the caller holds right now; never stored, never
 *                  logged, and discarded by the caller as soon as the call ends
 * @returns the same text with every held secret replaced by {@link REDACTION}
 *
 * @example
 *   scrubSecrets('sent x-goog-api-key: AIzaFAKEKEY0123456789', ['AIzaFAKEKEY0123456789'])
 *   // => 'sent x-goog-api-key: [redacted]'
 *
 * @see scrubUnknown
 */
export function scrubSecrets(text: string, secrets: readonly string[]): string {

  let out = text;

  for (const secret of secrets) {

    if (secret.trim() === '' || secret.length < MIN_LITERAL_SECRET_CHARS) { continue; }

    for (const form of secretForms(secret)) {
      out = out.replace(new RegExp(escapeForRegExp(form), 'g'), REDACTION);
    }

  }

  return out;

}

/**
 * Remove credential *shapes* from `text`, holding no secret at all.
 *
 * This is the half of the scrubber that works when the caller has nothing to compare
 * against — the ledger, which deliberately never sees a credential, applies exactly
 * this to every text column it writes.
 *
 * @param text - the text about to be written or returned
 * @returns the same text with recognised credential shapes replaced, labels kept
 *
 * @example
 *   scrubUnknown('POST /v1?key=AIzaFAKE01234567890123456 failed')
 *   // => 'POST /v1?key=[redacted] failed'
 *
 * @see CREDENTIAL_PATTERNS
 */
export function scrubUnknown(text: string): string {

  let out = text;

  for (const { pattern, replacement } of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, replacement);
  }

  return out;

}

/**
 * The scrub every outward path runs: held secrets first, then credential shapes.
 *
 * Order matters. Held secrets are removed literally, which is exact; the shape
 * patterns then sweep whatever the literal pass could not have known about. Running
 * them the other way round would let a pattern rewrite the surroundings of a held
 * secret and leave the secret itself stranded in text the literal pass no longer
 * matches.
 *
 * @param text    - the text about to leave the facility
 * @param secrets - credential values held right now; pass `[]` where none are held
 *
 * @example
 *   scrub('Bearer sk-fake-0123456789abcdef rejected', ['sk-fake-0123456789abcdef'])
 *   // => 'Bearer [redacted] rejected'
 */
export function scrub(text: string, secrets: readonly string[] = []): string {
  return scrubUnknown(scrubSecrets(text, secrets));
}

/**
 * Turn any thrown value into one scrubbed line.
 *
 * Deliberately reads `message` and `cause` and never `stack`: a stack is the classic
 * place a request body ends up, it is useless to the user in a tool reply, and the
 * cheapest way to guarantee it never leaks a credential is to never read it.
 *
 * @param error   - whatever was thrown
 * @param secrets - credential values held right now
 * @returns a single scrubbed line describing the failure
 *
 * @example
 *   scrubError(new Error('401 for key sk-fake-0123456789abcdef'), [])
 *   // => '401 for key [redacted]'
 */
export function scrubError(error: unknown, secrets: readonly string[] = []): string {

  if (!(error instanceof Error)) { return scrub(String(error), secrets); }

  return scrub(`${error.message}${describeCause(error.cause)}`, secrets);

}

/**
 * One scrubbable line describing an error's `cause`, or the empty string when there is
 * none.
 *
 * `fetch` puts the real failure in `cause`, so it is worth reading — but `cause` is
 * `unknown`, and a bare template interpolation would render most objects as
 * `[object Object]`, which is a diagnostic that costs a line and says nothing.
 *
 * @example
 *   describeCause(new Error('ECONNREFUSED'))  // => ' (cause: ECONNREFUSED)'
 *   describeCause(undefined)                  // => ''
 */
function describeCause(cause: unknown): string {

  if (cause === undefined || cause === null) { return ''; }
  if (cause instanceof Error)                { return ` (cause: ${cause.message})`; }
  if (typeof cause === 'string')             { return ` (cause: ${cause})`; }

  // `JSON.stringify` throws on a circular structure and yields the literal text
  // `undefined` for a function or a symbol; both are fine outcomes for a diagnostic,
  // and both are better than the `[object Object]` a template interpolation would give.
  try   { return ` (cause: ${JSON.stringify(cause)})`; }
  catch { return ' (cause: unprintable)'; }

}

/**
 * A URL safe to show a human: every credential-bearing query value removed, the rest
 * of the URL intact so the endpoint remains identifiable.
 *
 * Exists because "which endpoint did we call" is a question worth answering in an
 * error, and answering it by printing the raw URL is how a key in a query string
 * becomes a key in a log.
 *
 * @param url - the URL that was or would have been requested
 * @returns the same URL with credential parameter values redacted; unparseable input
 *          is returned scrubbed rather than thrown over, because a failure to parse a
 *          URL must never become a failure to redact it
 *
 * @example
 *   redactUrl('https://x.test/v1:run?key=AIzaFAKE01234567890123456&alt=sse')
 *   // => 'https://x.test/v1:run?key=[redacted]&alt=sse'
 */
export function redactUrl(url: string): string {
  return scrubUnknown(url);
}
