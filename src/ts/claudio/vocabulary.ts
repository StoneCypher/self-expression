/**
 * The closed leitmotif vocabulary for the claudio audio facility (issue #44).
 *
 * A leitmotif is a **meaning**, not a sound file — the meaning→waveform mapping is
 * configuration (`audio.wav.<leitmotif>` keys), so a user can re-skin the palette
 * without the vocabulary drifting. The vocabulary is a runtime `const` array in the
 * exact pattern of `channels/vocabulary.ts`, because it is needed in places types
 * cannot reach: the `strike` tool's enum schema, the ledger's CHECK constraint, and
 * the per-strike validation. The five-week drift measurement that motivated closed
 * vocabularies there applies with more force to sounds, which have no text to grep
 * afterward.
 *
 * Capped deliberately at six meanings; five ship.
 *
 * @see ../channels/vocabulary.js
 * @see ../../superpowers/spec/2026-08-27-voluntary-audio-design.md
 */

/** Every sound-meaning the assistant can choose to strike. One strike, one meaning. */
export const LEITMOTIFS = [
  'session-open',      // the session greeting; at most once per session
  'quiet-completion',  // long work finished while attention was elsewhere
  'attention',         // something's wrong, come look; the highest-privilege strike
  'need-blocked',      // a need was filed and work is stopped on it
  'spark',             // the audible form of the idea channel's delight; rarest of all
] as const;

/** What kind of audio event a ledger row records. */
export const STRIKE_KINDS = [
  'strike',    // a leitmotif struck as expression
  'audition',  // a low-volume palette review during configuration
  'say',       // local TTS, behind its own consent tier
] as const;

export type Leitmotif  = typeof LEITMOTIFS[number];
export type StrikeKind = typeof STRIKE_KINDS[number];

/**
 * Whether `value` names a leitmotif, narrowing its type when it does.
 *
 * Takes `unknown` rather than `string` for the same reason `channels/vocabulary.ts`'s
 * `isMember` does: values arriving from a tool call have not been checked yet.
 *
 * @example
 *   isLeitmotif('attention')  // => true
 *   isLeitmotif('doorbell')   // => false — the involuntary predecessor's shape
 */
export function isLeitmotif(value: unknown): value is Leitmotif {
  return typeof value === 'string' && (LEITMOTIFS as readonly string[]).includes(value);
}
