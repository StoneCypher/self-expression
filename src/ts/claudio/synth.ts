/**
 * Offline leitmotif synthesis: motif specifications and a pure renderer.
 *
 * The vendored WAV assets in `assets/leitmotifs/` are generated from these
 * specifications by `src/scripts/generate_leitmotifs.mjs` — checked in beside the
 * assets exactly as the design requires, so the palette is reproducible and
 * reviewable as code rather than only as bytes. Nothing here runs at strike time;
 * the facility plays the vendored files.
 *
 * The voice is a plain sine with a soft attack and an exponential decay — a small
 * bell, not an alarm. Every motif is well under the three-second construction cap.
 *
 * @see ./wav.js
 * @see ./vocabulary.js
 */

import type { Leitmotif } from './vocabulary.js';

/** One struck tone within a motif: when it starts, what it sings, how hard. */
export interface MotifNote {
  /** Fundamental frequency, in hertz. */
  readonly freq    : number;
  /** Onset, in milliseconds from the start of the motif. */
  readonly startMs : number;
  /** Envelope length, in milliseconds. */
  readonly durMs   : number;
  /** Peak linear amplitude in [0, 1], before the anti-clip headroom. */
  readonly gain    : number;
}

/** A complete motif: its tones and its total rendered length. */
export interface MotifSpec {
  readonly notes   : readonly MotifNote[];
  /** Total length in milliseconds; must be ≤ 3000 by construction. */
  readonly totalMs : number;
}

/** Sample rate the vendored assets are rendered at, in hertz. */
export const SYNTH_SAMPLE_RATE = 16000;

/** The longest any leitmotif is allowed to be by construction, in milliseconds. */
export const MOTIF_MAX_MS = 3000;

/**
 * The shipped palette: one specification per leitmotif.
 *
 * The shapes carry the meanings: `session-open` rises gently, `quiet-completion` is
 * one low soft bell, `attention` is three bright pulses, `need-blocked` falls,
 * `spark` is a quick upward sparkle.
 */
export const MOTIF_SPECS: Record<Leitmotif, MotifSpec> = {
  'session-open': {
    totalMs : 900,
    notes   : [
      { freq: 523.25, startMs: 0,   durMs: 450, gain: 0.55 },   // C5
      { freq: 659.25, startMs: 220, durMs: 600, gain: 0.60 },   // E5
    ],
  },
  'quiet-completion': {
    totalMs : 1200,
    notes   : [
      { freq: 392.00, startMs: 0, durMs: 1150, gain: 0.50 },    // G4, alone
    ],
  },
  'attention': {
    totalMs : 1500,
    notes   : [
      { freq: 880.00, startMs: 0,    durMs: 260, gain: 0.85 },  // A5 ×3
      { freq: 880.00, startMs: 420,  durMs: 260, gain: 0.85 },
      { freq: 880.00, startMs: 840,  durMs: 500, gain: 0.90 },
    ],
  },
  'need-blocked': {
    totalMs : 1000,
    notes   : [
      { freq: 659.25, startMs: 0,   durMs: 400, gain: 0.60 },   // E5
      { freq: 493.88, startMs: 300, durMs: 620, gain: 0.60 },   // B4
    ],
  },
  'spark': {
    totalMs : 800,
    notes   : [
      { freq: 1046.50, startMs: 0,   durMs: 250, gain: 0.50 },  // C6 arpeggio
      { freq: 1318.51, startMs: 130, durMs: 250, gain: 0.50 },  // E6
      { freq: 1567.98, startMs: 260, durMs: 420, gain: 0.55 },  // G6
    ],
  },
};

/**
 * Render one motif to mono float samples in [-1, 1].
 *
 * Each note is a sine under a 10 ms linear attack and an exponential decay tuned to
 * reach roughly -40 dB by the end of the note. Overlapping notes sum; the mix is
 * scaled by 0.9 headroom and hard-clamped, so no spec can emit a clipped file.
 *
 * @param spec       - the motif to render
 * @param sampleRate - output rate in hertz; defaults to {@link SYNTH_SAMPLE_RATE}
 *
 * @example
 *   const samples = renderMotif(MOTIF_SPECS['spark']);
 *   samples.length  // => 12800 — 800 ms at 16 kHz
 */
export function renderMotif(spec: MotifSpec, sampleRate: number = SYNTH_SAMPLE_RATE): Float64Array {

  const total = Math.round((spec.totalMs / 1000) * sampleRate),
        out   = new Float64Array(total);

  for (const note of spec.notes) {

    const start   = Math.round((note.startMs / 1000) * sampleRate),
          length  = Math.min(Math.round((note.durMs / 1000) * sampleRate), total - start),
          attack  = Math.round(sampleRate * 0.010),
          decayK  = Math.log(100) / Math.max(1, length);   // ~-40 dB across the note

    for (let i = 0; i < length; i++) {
      const t        = i / sampleRate,
            envelope = (i < attack ? i / attack : 1) * Math.exp(-decayK * i),
            index    = start + i;
      out[index] = (out[index] ?? 0) + Math.sin(2 * Math.PI * note.freq * t) * note.gain * envelope;
    }

  }

  for (let i = 0; i < total; i++) {
    out[i] = Math.min(1, Math.max(-1, (out[i] ?? 0) * 0.9));
  }

  return out;

}

/**
 * Encode mono float samples as a complete 16-bit PCM WAV file.
 *
 * Emits the canonical 44-byte RIFF header followed by little-endian int16 samples —
 * the exact shape {@link parseWav} accepts and `System.Media.SoundPlayer` plays.
 *
 * @param samples    - mono samples in [-1, 1]; values outside are clamped
 * @param sampleRate - the rate the samples were rendered at, in hertz
 *
 * @example
 *   const wav = encodeWavPcm16(renderMotif(MOTIF_SPECS['attention']), SYNTH_SAMPLE_RATE);
 *   wav.length  // => 44 + 2 × sample count
 */
export function encodeWavPcm16(samples: Float64Array | readonly number[], sampleRate: number): Uint8Array {

  const dataBytes = samples.length * 2,
        out       = new Uint8Array(44 + dataBytes),
        view      = new DataView(out.buffer);

  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) { out[at + i] = text.charCodeAt(i); }
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);                 // fmt chunk size
  view.setUint16(20, 1, true);                  // PCM
  view.setUint16(22, 1, true);                  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);     // byte rate
  view.setUint16(32, 2, true);                  // block align
  view.setUint16(34, 16, true);                 // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.min(1, Math.max(-1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  return out;

}
