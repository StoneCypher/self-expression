import {
  CHANNELS, POSITIONS, DELTAS, TURNS, EFFORTS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES,
  isMember, describeVocabulary,
} from '../channels/vocabulary.js';

const ALL: readonly (readonly string[])[] = [
  CHANNELS, POSITIONS, DELTAS, TURNS, EFFORTS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES,
];

describe('vocabularies', () => {

  test('every vocabulary is non-empty', () => {
    for (const v of ALL) { expect(v.length).toBeGreaterThan(0); }
  });

  test('no vocabulary contains duplicates', () => {
    for (const v of ALL) { expect(new Set(v).size).toBe(v.length); }
  });

  test('every term is lowercase and free of whitespace', () => {
    for (const v of ALL) {
      for (const term of v) { expect(term).toMatch(/^[a-z]+$/); }
    }
  });

  test('the drift values that corrupted 12% of the previous log are rejected', () => {
    expect(isMember(DELTAS, 'flat')).toBe(false);
    expect(isMember(DELTAS, 'right')).toBe(false);
    expect(isMember(DELTAS, 'steady')).toBe(true);
  });

  test('both new channels are present', () => {
    expect(isMember(CHANNELS, 'unanswerable')).toBe(true);
    expect(isMember(CHANNELS, 'pattern')).toBe(true);
  });

  test('confidence records grounds, not a numeric strength', () => {
    for (const g of CONFIDENCE_GROUNDS) { expect(g).not.toMatch(/^(high|medium|low|\d+)$/); }
    expect(isMember(CONFIDENCE_GROUNDS, 'verified')).toBe(true);
    expect(isMember(CONFIDENCE_GROUNDS, 'high')).toBe(false);
  });

  test('unverified and assumed are distinct divergence kinds', () => {
    expect(isMember(DIVERGENCE_KINDS, 'unverified')).toBe(true);
    expect(isMember(DIVERGENCE_KINDS, 'assumed')).toBe(true);
  });

});

describe('isMember', () => {

  test('rejects non-strings without throwing', () => {
    for (const bad of [7, null, undefined, {}, [], true]) {
      expect(isMember(DELTAS, bad)).toBe(false);
    }
  });

  test('is case sensitive', () => {
    expect(isMember(DELTAS, 'Up')).toBe(false);
    expect(isMember(DELTAS, 'up')).toBe(true);
  });

  test('does not match on prefixes or substrings', () => {
    expect(isMember(DELTAS, 'u')).toBe(false);
    expect(isMember(DELTAS, 'upward')).toBe(false);
  });

});

describe('describeVocabulary', () => {

  test('quotes each term and separates with commas', () => {
    expect(describeVocabulary(DELTAS)).toBe("'up', 'down', 'steady'");
  });

  test('names every term, so a rejection says what would have worked', () => {
    const described = describeVocabulary(CHANNELS);
    for (const c of CHANNELS) { expect(described).toContain(`'${c}'`); }
  });

});
