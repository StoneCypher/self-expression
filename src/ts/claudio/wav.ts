/**
 * Pure WAV handling: header parsing, duration, and gain scaling.
 *
 * Exists because the pinned playback mechanism — `System.Media.SoundPlayer` in a
 * spawned PowerShell child — has no volume control of its own. Rather than reach for
 * P/Invoke or a media stack, the facility scales the PCM samples in Node before the
 * file is handed to the player: pure arithmetic, zero dependencies, and exactly
 * testable. The same parse also yields the duration the hard cap is enforced against.
 *
 * Only 16-bit PCM is accepted. That is the format the vendored leitmotifs ship in and
 * the format the generation script emits; a user-supplied replacement WAV in any other
 * encoding is refused with a message rather than played at unknown volume.
 *
 * @see ./synth.js
 * @see ./player.js
 */

/** The facts about a WAV file the facility needs: shape, location of samples, length. */
export interface WavInfo {
  /** WAVE format tag; 1 is integer PCM, the only accepted value. */
  readonly format        : number;
  /** Interleaved channel count; 1 for the vendored assets. */
  readonly channels      : number;
  /** Samples per second per channel. */
  readonly sampleRate    : number;
  /** Bits per sample; 16 is the only accepted value. */
  readonly bitsPerSample : number;
  /** Byte offset of the first sample within the file. */
  readonly dataOffset    : number;
  /** Length of the sample data in bytes. */
  readonly dataBytes     : number;
  /** Play length in milliseconds, derived from the data length and the format. */
  readonly durationMs    : number;
}

/** Reads a 4-byte ASCII chunk tag at `at`, or `''` when the buffer is too short. */
function tag(bytes: Uint8Array, at: number): string {
  if (at + 4 > bytes.length) { return ''; }
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

/**
 * Parse a WAV file's RIFF structure into {@link WavInfo}.
 *
 * Walks the chunk list rather than assuming the canonical 44-byte layout, because
 * real-world WAVs carry LIST/fact chunks between `fmt ` and `data`.
 *
 * @param bytes - the complete file content
 *
 * @example
 *   const info = parseWav(readFileSync('attention.wav'));
 *   info.durationMs  // => 1500
 *
 * @throws {Error} When the bytes are not RIFF/WAVE, when `fmt ` or `data` chunks are
 *                 missing, or when the sample encoding is not 16-bit integer PCM.
 */
export function parseWav(bytes: Uint8Array): WavInfo {

  if (tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new Error('not a WAV file: missing RIFF/WAVE header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let format = 0, channels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataOffset = -1, dataBytes = 0, sawFmt = false;

  let at = 12;
  while (at + 8 <= bytes.length) {

    const chunk = tag(bytes, at),
          size  = view.getUint32(at + 4, true);

    if (chunk === 'fmt ' && at + 24 <= bytes.length) {
      sawFmt        = true;
      format        = view.getUint16(at + 8,  true);
      channels      = view.getUint16(at + 10, true);
      sampleRate    = view.getUint32(at + 12, true);
      bitsPerSample = view.getUint16(at + 22, true);
    }

    if (chunk === 'data') {
      dataOffset = at + 8;
      dataBytes  = Math.min(size, bytes.length - dataOffset);
    }

    at += 8 + size + (size % 2);   // chunks are word-aligned

  }

  if (!sawFmt)          { throw new Error('not a playable WAV: no fmt chunk'); }
  if (dataOffset === -1) { throw new Error('not a playable WAV: no data chunk'); }

  if (format !== 1 || bitsPerSample !== 16) {
    throw new Error(
      `unsupported WAV encoding: format ${String(format)} at ${String(bitsPerSample)} bits; ` +
      'only 16-bit integer PCM is accepted');
  }

  if (channels < 1 || sampleRate < 1) {
    throw new Error('unsupported WAV encoding: zero channels or zero sample rate');
  }

  const bytesPerSecond = sampleRate * channels * 2,
        durationMs     = Math.round((dataBytes / bytesPerSecond) * 1000);

  return { format, channels, sampleRate, bitsPerSample, dataOffset, dataBytes, durationMs };

}

/**
 * Return a copy of a 16-bit PCM WAV with every sample scaled by `factor`.
 *
 * This is how a chosen volume becomes audible under a player with no volume knob:
 * `factor` is linear amplitude in `[0, 1]`, so `volume / 100` maps the facility's
 * 0–100 volume scale onto it. Samples are rounded and clamped to the int16 range;
 * everything outside the data chunk — headers, any extra chunks — is byte-identical.
 *
 * @param bytes  - the complete WAV file content; not modified
 * @param factor - linear amplitude multiplier, clamped into [0, 1] — the ceiling rule
 *                 means this function can only ever make a sound quieter
 * @returns a new buffer holding the scaled file
 *
 * @example
 *   const half = scaleWavGain(original, 0.5);   // same length, samples halved
 *
 * @throws {Error} When the bytes are not a 16-bit PCM WAV (via {@link parseWav}).
 */
export function scaleWavGain(bytes: Uint8Array, factor: number): Uint8Array {

  const info    = parseWav(bytes),
        clamped = Math.min(1, Math.max(0, factor)),
        out     = new Uint8Array(bytes),
        view    = new DataView(out.buffer, out.byteOffset, out.byteLength),
        end     = info.dataOffset + info.dataBytes - 1;

  for (let at = info.dataOffset; at < end; at += 2) {
    const sample = view.getInt16(at, true),
          scaled = Math.round(sample * clamped);
    view.setInt16(at, Math.min(32767, Math.max(-32768, scaled)), true);
  }

  return out;

}
