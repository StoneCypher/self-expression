import { parseWav, scaleWavGain }                          from '../claudio/wav.js';
import { encodeWavPcm16, renderMotif, MOTIF_SPECS, SYNTH_SAMPLE_RATE } from '../claudio/synth.js';

/** A tiny valid mono 16-bit PCM WAV from raw sample values. */
function wavOf(samples: readonly number[], rate = 8000): Uint8Array {
  return encodeWavPcm16(samples.map(s => s / 32767), rate);
}

describe('parseWav', () => {

  test('reads back what encodeWavPcm16 wrote', () => {
    const wav  = wavOf([0, 1000, -1000, 32767], 8000),
          info = parseWav(wav);
    expect(info.format).toBe(1);
    expect(info.channels).toBe(1);
    expect(info.sampleRate).toBe(8000);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataOffset).toBe(44);
    expect(info.dataBytes).toBe(8);
    expect(info.durationMs).toBe(1);   // 4 samples at 8 kHz => 0.5 ms, rounded
  });

  test('derives duration from data length and rate', () => {
    const oneSecond = wavOf(Array.from({ length: 8000 }, () => 0), 8000);
    expect(parseWav(oneSecond).durationMs).toBe(1000);
  });

  test('refuses non-RIFF bytes', () => {
    expect(() => parseWav(new Uint8Array([1, 2, 3, 4]))).toThrow(/RIFF/);
  });

  test('refuses a RIFF that is not WAVE', () => {
    const wav = wavOf([0]);
    wav[8] = 0x41;   // corrupt 'WAVE'
    expect(() => parseWav(wav)).toThrow(/RIFF\/WAVE/);
  });

  test('refuses a WAV with no data chunk', () => {
    const wav = wavOf([0, 0]);
    // rename 'data' to 'dete' so the chunk walk never finds it
    wav[38] = 0x65;
    expect(() => parseWav(wav)).toThrow(/no data chunk/);
  });

  test('refuses a WAV with no fmt chunk', () => {
    const wav = wavOf([0, 0]);
    wav[13] = 0x41;   // corrupt 'fmt '
    expect(() => parseWav(wav)).toThrow(/no fmt chunk/);
  });

  test('refuses non-PCM and non-16-bit encodings — never plays at unknown volume', () => {
    const float = wavOf([0, 0]);
    new DataView(float.buffer).setUint16(20, 3, true);   // IEEE float format tag
    expect(() => parseWav(float)).toThrow(/only 16-bit integer PCM/);

    const eightBit = wavOf([0, 0]);
    new DataView(eightBit.buffer).setUint16(34, 8, true);
    expect(() => parseWav(eightBit)).toThrow(/only 16-bit integer PCM/);
  });

  test('refuses zero channels or zero rate', () => {
    const noChannels = wavOf([0, 0]);
    new DataView(noChannels.buffer).setUint16(22, 0, true);
    expect(() => parseWav(noChannels)).toThrow(/zero channels or zero sample rate/);
  });

  test('walks past an interposed chunk to find data', () => {
    const base  = wavOf([100, -100]),
          extra = new Uint8Array(base.length + 12),
          view  = new DataView(extra.buffer);
    // splice a 4-byte 'LIST' chunk between fmt and data
    extra.set(base.subarray(0, 36), 0);
    extra.set([0x4c, 0x49, 0x53, 0x54], 36);   // 'LIST'
    view.setUint32(40, 4, true);
    extra.set(base.subarray(36), 48);
    view.setUint32(4, extra.length - 8, true);
    const info = parseWav(extra);
    expect(info.dataOffset).toBe(56);
    expect(info.dataBytes).toBe(4);
  });

});

describe('scaleWavGain', () => {

  test('factor 1 leaves samples numerically intact', () => {
    const wav    = wavOf([0, 1000, -1000, 32767, -32768]),
          scaled = scaleWavGain(wav, 1),
          view   = new DataView(scaled.buffer, scaled.byteOffset);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(1000);
    expect(view.getInt16(48, true)).toBe(-1000);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32767);   // the encoder clamps at -1, which lands on -32767
  });

  test('factor 0.5 halves samples, rounding', () => {
    const scaled = scaleWavGain(wavOf([1000, -999]), 0.5),
          view   = new DataView(scaled.buffer, scaled.byteOffset);
    expect(view.getInt16(44, true)).toBe(500);
    expect(view.getInt16(46, true)).toBe(-499);   // Math.round(-499.5) rounds toward +Infinity
  });

  test('factor 0 silences everything', () => {
    const scaled = scaleWavGain(wavOf([32767, -32768, 123]), 0),
          view   = new DataView(scaled.buffer, scaled.byteOffset);
    for (const at of [44, 46, 48]) { expect(view.getInt16(at, true)).toBe(0); }
  });

  test('factors above 1 are clamped — the seam can only make sound quieter', () => {
    const scaled = scaleWavGain(wavOf([1000]), 7),
          view   = new DataView(scaled.buffer, scaled.byteOffset);
    expect(view.getInt16(44, true)).toBe(1000);
  });

  test('does not modify the input buffer', () => {
    const wav  = wavOf([1000]),
          copy = new Uint8Array(wav);
    scaleWavGain(wav, 0.25);
    expect([...wav]).toEqual([...copy]);
  });

  test('header bytes are byte-identical after scaling', () => {
    const wav    = wavOf([1000, 2000]),
          scaled = scaleWavGain(wav, 0.3);
    expect([...scaled.subarray(0, 44)]).toEqual([...wav.subarray(0, 44)]);
  });

  test('propagates the parser refusal for a malformed file', () => {
    expect(() => scaleWavGain(new Uint8Array([9, 9, 9, 9]), 0.5)).toThrow(/RIFF/);
  });

});

describe('the vendored palette pipeline', () => {

  test('every motif renders, encodes, and parses back at its declared length', () => {
    for (const spec of Object.values(MOTIF_SPECS)) {
      const wav  = encodeWavPcm16(renderMotif(spec), SYNTH_SAMPLE_RATE),
            info = parseWav(wav);
      expect(info.sampleRate).toBe(SYNTH_SAMPLE_RATE);
      expect(Math.abs(info.durationMs - spec.totalMs)).toBeLessThanOrEqual(1);
    }
  });

});
