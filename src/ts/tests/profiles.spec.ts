import {
  PROFILES, PROFILE_NAMES, profileForNoun,
  CHECKLIST_PROFILE, FINDINGS_PROFILE, OPTIONS_PROFILE, DIFF_PROFILE, RESULTS_PROFILE,
} from '../charts/profiles.js';
import { CANONICAL_ORDER, SUCCESS_MARKERS, FAILURE_MARKERS } from '../charts/markers.js';

const ALL = Object.values(PROFILES);
const VOCABULARY = new Set<string>(CANONICAL_ORDER);

describe('profile data invariants', () => {

  test('PROFILE_NAMES and the PROFILES record agree, and each profile knows its own name', () => {
    expect(Object.keys(PROFILES).sort()).toEqual([...PROFILE_NAMES].sort());
    for (const [key, profile] of Object.entries(PROFILES)) {
      expect(profile.name).toBe(key);
    }
  });

  test('bucket ids are unique within each profile', () => {
    for (const profile of ALL) {
      const ids = profile.buckets.map(b => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('the residual bucket is always one of the declared buckets', () => {
    for (const profile of ALL) {
      expect(profile.buckets.some(b => b.id === profile.residual)).toBe(true);
    }
  });

  test('a scalar axis, when declared, names a declared bucket', () => {
    for (const profile of ALL) {
      if (profile.scalar !== undefined) {
        expect(profile.buckets.some(b => b.id === profile.scalar)).toBe(true);
      }
    }
  });

  test('overallOrder covers exactly the declared bucket ids', () => {
    for (const profile of ALL) {
      expect([...profile.overallOrder].sort()).toEqual(profile.buckets.map(b => b.id).sort());
    }
  });

  test('bucket marker lists are disjoint within each profile (the partition never overlaps)', () => {
    for (const profile of ALL) {
      const seen = new Set<string>();
      for (const bucket of profile.buckets) {
        for (const marker of bucket.markers) {
          expect(seen.has(marker)).toBe(false);
          seen.add(marker);
        }
      }
    }
  });

  test('every marker any profile names exists in the shared markers.md vocabulary', () => {
    // Spec rule: new glyphs are added to markers.md (the single vocabulary file),
    // never to a profile privately — bucket lists and attention lists both.
    for (const profile of ALL) {
      for (const bucket of profile.buckets) {
        for (const marker of bucket.markers) { expect(VOCABULARY.has(marker)).toBe(true); }
      }
      for (const marker of profile.attention) { expect(VOCABULARY.has(marker)).toBe(true); }
    }
  });

  test('unit nouns are unique across profiles — the noun is the profile-inference key', () => {
    const nouns = ALL.map(p => p.noun);
    expect(new Set(nouns).size).toBe(nouns.length);
  });

  test('the checklist profile reproduces the markers.ts bucket lists exactly', () => {
    expect(CHECKLIST_PROFILE.buckets.map(b => b.id)).toEqual(['success', 'active', 'failure']);
    expect(CHECKLIST_PROFILE.buckets[0]?.markers).toEqual([...SUCCESS_MARKERS]);
    expect(CHECKLIST_PROFILE.buckets[2]?.markers).toEqual([...FAILURE_MARKERS]);
    expect(CHECKLIST_PROFILE.residual).toBe('active');
    expect(CHECKLIST_PROFILE.scalar).toBe('success');
  });

  test('only the checklist profile has a scalar axis; only the diff profile has the +N −M tail', () => {
    for (const profile of ALL) {
      expect(profile.scalar !== undefined).toBe(profile === CHECKLIST_PROFILE);
      expect(profile.plusMinus === true).toBe(profile === DIFF_PROFILE);
    }
  });

  test('the spec bucket table is transcribed: findings, options, diff, results', () => {
    expect(FINDINGS_PROFILE.buckets.map(b => b.id)).toEqual(['blocking', 'degraded', 'note']);
    expect(FINDINGS_PROFILE.buckets[0]?.markers).toEqual(['❗', '🦹', '🌋', '❌', '🚫']);
    expect(FINDINGS_PROFILE.buckets[1]?.markers).toEqual(['⚠️', '🌗', '🐛', '🤡', '😕']);
    expect(OPTIONS_PROFILE.buckets.map(b => b.id)).toEqual(['chosen', 'open', 'rejected']);
    expect(OPTIONS_PROFILE.buckets[0]?.markers).toEqual(['✅', '👍']);
    expect(OPTIONS_PROFILE.buckets[2]?.markers).toEqual(['❌', '👎', '✋']);
    expect(DIFF_PROFILE.buckets.map(b => b.id)).toEqual(['added', 'modified', 'removed']);
    expect(DIFF_PROFILE.buckets.every(b => b.markers.length === 0)).toBe(true);
    expect(RESULTS_PROFILE.buckets.map(b => b.id)).toEqual(['matched', 'partial', 'missed']);
    expect(RESULTS_PROFILE.residual).toBe('matched');
  });

});

describe('profileForNoun', () => {

  test('round-trips every registered profile through its noun', () => {
    for (const profile of ALL) {
      expect(profileForNoun(profile.noun)).toBe(profile);
    }
  });

  test('an unknown noun returns undefined', () => {
    expect(profileForNoun('zebras')).toBeUndefined();
    expect(profileForNoun('')).toBeUndefined();
  });

});
