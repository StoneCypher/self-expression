/**
 * Stochastic property tests for the WAV pipeline.
 *
 * Pins the invariants the volume story rests on: encode→parse is a faithful round
 * trip, and gain scaling can only ever make samples smaller — the ceiling rule
 * reduced to arithmetic.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { parseWav, scaleWavGain }  from '../claudio/wav.js';
import { encodeWavPcm16 }          from '../claudio/synth.js';

const arbSamples = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 400 });
const arbRate    = fc.integer({ min: 1000, max: 48000 });

/** Read every int16 sample out of an encoded WAV. */
function samplesOf(wav: Uint8Array): number[] {
  const info = parseWav(wav),
        view = new DataView(wav.buffer, wav.byteOffset),
        out: number[] = [];
  for (let at = info.dataOffset; at < info.dataOffset + info.dataBytes; at += 2) {
    out.push(view.getInt16(at, true));
  }
  return out;
}

describe('encode→parse round trip', () => {

  it('preserves rate, sample count, and the PCM16 shape for any input', () => {
    fc.assert(fc.property(arbSamples, arbRate, (samples, rate) => {
      const wav  = encodeWavPcm16(samples, rate),
            info = parseWav(wav);
      expect(info.sampleRate).toBe(rate);
      expect(info.channels).toBe(1);
      expect(info.bitsPerSample).toBe(16);
      expect(info.dataBytes).toBe(samples.length * 2);
      expect(info.durationMs).toBe(Math.round((samples.length / rate) * 1000));
    }));
  });

  it('every encoded sample is the clamped, scaled original', () => {
    fc.assert(fc.property(arbSamples, (samples) => {
      const decoded    = samplesOf(encodeWavPcm16(samples, 8000)),
            mismatches = samples.filter((sample, i) =>
              decoded[i] !== Math.round(Math.min(1, Math.max(-1, sample)) * 32767));
      expect(mismatches).toEqual([]);
    }));
  });

});

describe('gain scaling', () => {

  it('never increases any sample magnitude, for any factor', () => {
    fc.assert(fc.property(arbSamples, fc.double({ min: 0, max: 2, noNaN: true }), (samples, factor) => {
      const wav    = encodeWavPcm16(samples, 8000),
            before = samplesOf(wav),
            after  = samplesOf(scaleWavGain(wav, factor)),
            louder = after.filter((value, i) =>
              Math.abs(value) > Math.abs(before[i] ?? 0) || Math.abs(value) > 32768);
      expect(louder).toEqual([]);
    }));
  });

  it('factor 1 is the identity on the whole file', () => {
    fc.assert(fc.property(arbSamples, arbRate, (samples, rate) => {
      const wav = encodeWavPcm16(samples, rate);
      expect([...scaleWavGain(wav, 1)]).toEqual([...wav]);
    }));
  });

  it('factor 0 silences every sample', () => {
    fc.assert(fc.property(arbSamples, (samples) => {
      const silent = samplesOf(scaleWavGain(encodeWavPcm16(samples, 8000), 0));
      expect(silent.filter(value => value !== 0)).toEqual([]);
    }));
  });

  it('scaling is monotone: a smaller factor never yields a louder sample', () => {
    fc.assert(fc.property(
      arbSamples,
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      (samples, f1, f2) => {
        const [lo, hi]   = f1 <= f2 ? [f1, f2] : [f2, f1],
              wav        = encodeWavPcm16(samples, 8000),
              soft       = samplesOf(scaleWavGain(wav, lo)),
              loud       = samplesOf(scaleWavGain(wav, hi)),
              violations = soft.filter((value, i) => Math.abs(value) > Math.abs(loud[i] ?? 0) + 1);
        expect(violations).toEqual([]);
      }));
  });

});
