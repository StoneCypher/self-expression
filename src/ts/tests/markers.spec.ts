import {
  SUCCESS_MARKERS, FAILURE_MARKERS, CANONICAL_ORDER,
  classifyMarker, canonicalRank,
} from '../charts/markers.js';

describe('classifyMarker', () => {

  test('classifies a known success marker', () => {
    expect(classifyMarker('✅')).toBe('success');
  });

  test('classifies a known failure marker', () => {
    expect(classifyMarker('❌')).toBe('failure');
  });

  test('classifies a running/queued marker as active', () => {
    expect(classifyMarker('🔜')).toBe('active');
  });

  test('classifies an unrecognized marker as active', () => {
    expect(classifyMarker('🤷')).toBe('active');
  });

  test('an override wins outright, for markers whose bucket the glyph cannot carry', () => {
    expect(classifyMarker('🛳️', 'success')).toBe('success');
    expect(classifyMarker('🛳️', 'failure')).toBe('failure');
    expect(classifyMarker('🛳️')).toBe('active');
  });

  test('an override applies even to an otherwise-classified marker', () => {
    expect(classifyMarker('✅', 'failure')).toBe('failure');
  });

});

describe('canonicalRank', () => {

  test('💯 ranks immediately after ✅', () => {
    expect(canonicalRank('💯')).toBe(canonicalRank('✅') + 1);
  });

  test('✅ is first in canonical order', () => {
    expect(canonicalRank('✅')).toBe(0);
  });

  test('an unrecognized marker ranks after every known marker', () => {
    expect(canonicalRank('🤷')).toBe(CANONICAL_ORDER.length);
  });

  test('every marker has a distinct rank', () => {
    const ranks = CANONICAL_ORDER.map(m => canonicalRank(m));
    expect(new Set(ranks).size).toBe(CANONICAL_ORDER.length);
  });

});

describe('SUCCESS_MARKERS and FAILURE_MARKERS', () => {

  test('every success marker appears in CANONICAL_ORDER', () => {
    for (const m of SUCCESS_MARKERS) {
      expect((CANONICAL_ORDER as readonly string[]).includes(m)).toBe(true);
    }
  });

  test('every failure marker appears in CANONICAL_ORDER', () => {
    for (const m of FAILURE_MARKERS) {
      expect((CANONICAL_ORDER as readonly string[]).includes(m)).toBe(true);
    }
  });

  test('no marker appears in both bucket arrays', () => {
    const failureSet = new Set<string>(FAILURE_MARKERS);
    for (const m of SUCCESS_MARKERS) {
      expect(failureSet.has(m)).toBe(false);
    }
  });

  test('neither bucket array contains duplicates', () => {
    expect(new Set(SUCCESS_MARKERS).size).toBe(SUCCESS_MARKERS.length);
    expect(new Set(FAILURE_MARKERS).size).toBe(FAILURE_MARKERS.length);
  });

  test('🛳️ is classified only via override, never a static bucket member', () => {
    expect((SUCCESS_MARKERS as readonly string[]).includes('🛳️')).toBe(false);
    expect((FAILURE_MARKERS as readonly string[]).includes('🛳️')).toBe(false);
  });

});

describe('CANONICAL_ORDER', () => {

  test('has no duplicate markers', () => {
    expect(new Set(CANONICAL_ORDER).size).toBe(CANONICAL_ORDER.length);
  });

  test('is non-empty and every entry is a non-empty string', () => {
    expect(CANONICAL_ORDER.length).toBeGreaterThan(0);
    for (const m of CANONICAL_ORDER) {
      expect(typeof m).toBe('string');
      expect(m.length).toBeGreaterThan(0);
    }
  });

});

describe('multi-code-point marker fidelity (regression guard)', () => {
  // Regression guard for a silently dropped U+FE0F variation selector. The
  // markers below are written here as literals independent of
  // SUCCESS_MARKERS/FAILURE_MARKERS/CANONICAL_ORDER, and exercised through
  // classifyMarker's *real* matching path (no override) and canonicalRank's
  // real lookup — not read back out of the arrays under test — so a future
  // edit that strips a variation selector from the source arrays breaks
  // these assertions instead of passing vacuously.

  test("this file's own '⚠️' literal is still the two-code-point VS-16 form", () => {
    expect([...'⚠️'].length).toBe(2);
  });

  test("this file's own '🛠️' literal is still the two-code-point VS-16 form", () => {
    expect([...'🛠️'].length).toBe(2);
  });

  test('⚠️ (caution / worked-with-a-caveat) classifies success via the real match path, not an override', () => {
    expect(classifyMarker('⚠️')).toBe('success');
  });

  test('🛠️ (deferred to a skill) classifies active via the real fall-through path, not an override', () => {
    expect(classifyMarker('🛠️')).toBe('active');
  });

  test('⚠️ has a fixed, independently-known canonical rank', () => {
    expect(canonicalRank('⚠️')).toBe(18);
  });

  test('🛠️ has a fixed, independently-known canonical rank', () => {
    expect(canonicalRank('🛠️')).toBe(5);
  });

});
