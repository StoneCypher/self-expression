import {
  MOTIF_SPECS, MOTIF_MAX_MS, SYNTH_SAMPLE_RATE, renderMotif, encodeWavPcm16,
} from '../claudio/synth.js';
import { LEITMOTIFS } from '../claudio/vocabulary.js';

describe('the motif specifications', () => {

  test('exactly one spec per leitmotif — the palette and the vocabulary cannot drift', () => {
    expect(Object.keys(MOTIF_SPECS).sort()).toEqual([...LEITMOTIFS].sort());
  });

  test('every motif respects the 3-second construction cap', () => {
    for (const spec of Object.values(MOTIF_SPECS)) {
      expect(spec.totalMs).toBeLessThanOrEqual(MOTIF_MAX_MS);
      expect(spec.totalMs).toBeGreaterThan(0);
    }
  });

  test('every note fits inside its motif and carries sane parameters', () => {
    for (const spec of Object.values(MOTIF_SPECS)) {
      for (const note of spec.notes) {
        expect(note.startMs).toBeGreaterThanOrEqual(0);
        expect(note.startMs + note.durMs).toBeLessThanOrEqual(spec.totalMs + 100);
        expect(note.freq).toBeGreaterThan(20);
        expect(note.gain).toBeGreaterThan(0);
        expect(note.gain).toBeLessThanOrEqual(1);
      }
    }
  });

});

describe('renderMotif', () => {

  test('emits exactly totalMs worth of samples', () => {
    const spec = MOTIF_SPECS['spark'];
    expect(renderMotif(spec).length).toBe(Math.round((spec.totalMs / 1000) * SYNTH_SAMPLE_RATE));
  });

  test('every sample stays inside [-1, 1] — no spec can emit a clipped file', () => {
    for (const spec of Object.values(MOTIF_SPECS)) {
      const samples = renderMotif(spec);
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(-1);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  test('actually makes sound: peak amplitude is well above silence', () => {
    for (const spec of Object.values(MOTIF_SPECS)) {
      const peak = renderMotif(spec).reduce((m, s) => Math.max(m, Math.abs(s)), 0);
      expect(peak).toBeGreaterThan(0.1);
    }
  });

  test('honours an alternate sample rate', () => {
    const spec = MOTIF_SPECS['quiet-completion'];
    expect(renderMotif(spec, 8000).length).toBe(Math.round((spec.totalMs / 1000) * 8000));
  });

});

describe('encodeWavPcm16', () => {

  test('emits the canonical 44-byte header plus two bytes per sample', () => {
    const wav = encodeWavPcm16([0, 0.5, -0.5], 16000);
    expect(wav.length).toBe(44 + 6);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE');
  });

  test('clamps out-of-range samples instead of wrapping', () => {
    const wav  = encodeWavPcm16([2, -2], 16000),
          view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
  });

});
