import {
  decideStrike, AUDITION_VOLUME, AUDITION_MIN_GAP_SECONDS, AUDITION_HOURLY_BUDGET,
} from '../claudio/gate.js';
import type { StrikeAsk }    from '../claudio/gate.js';
import type { AudioConfig }  from '../claudio/config.js';
import type { RecentStrike } from '../claudio/ledger.js';

const NOW = '2026-08-28T12:00:00.000Z';

/** A permissive enabled config; individual tests tighten what they exercise. */
function config(overrides: Partial<AudioConfig> = {}): AudioConfig {
  return {
    enabled: true, ttsLocal: false, ceiling: 50,
    minGapSeconds: 30, hourlyBudget: 6, hourlyBudgetAttention: 8,
    ...overrides,
  };
}

function strike(leitmotif: StrikeAsk['leitmotif'] = 'spark', requestedVolume: number | null = null): StrikeAsk {
  return { kind: 'strike', leitmotif, requestedVolume };
}

/** A played row `secondsAgo` before NOW. */
function played(secondsAgo: number, kind: RecentStrike['kind'] = 'strike', leitmotif: string | null = 'spark'): RecentStrike {
  return { utc: new Date(Date.parse(NOW) - secondsAgo * 1000).toISOString(), kind, leitmotif };
}

describe('consent gates', () => {

  test('disabled refuses everything, naming the exact-affirmative rule', () => {
    const out = decideStrike(strike(), config({ enabled: false }), [], false, NOW);
    expect(out).toEqual({ allowed: false, reason: expect.stringContaining("audio.enabled is not exactly 'true'") });
  });

  test('say needs its own tier gate even when audio is enabled', () => {
    const ask: StrikeAsk = { kind: 'say', leitmotif: null, requestedVolume: null };
    const off = decideStrike(ask, config({ ttsLocal: false }), [], false, NOW);
    expect(off.allowed).toBe(false);
    if (!off.allowed) { expect(off.reason).toContain('audio.tts_local'); }
    const on = decideStrike(ask, config({ ttsLocal: true }), [], false, NOW);
    expect(on.allowed).toBe(true);
  });

  test('session-open plays at most once per session', () => {
    const ask = strike('session-open');
    expect(decideStrike(ask, config(), [], false, NOW).allowed).toBe(true);
    const again = decideStrike(ask, config(), [], true, NOW);
    expect(again.allowed).toBe(false);
    if (!again.allowed) { expect(again.reason).toContain('once per session'); }
  });

  test('the session-open once rule does not bind auditions', () => {
    const ask: StrikeAsk = { kind: 'audition', leitmotif: 'session-open', requestedVolume: null };
    expect(decideStrike(ask, config(), [], true, NOW).allowed).toBe(true);
  });

});

describe('volume and the ceiling', () => {

  test('an allowed volume is clamped to the ceiling — softer is a choice, louder is not', () => {
    const out = decideStrike(strike('spark', 100), config({ ceiling: 40 }), [], false, NOW);
    expect(out).toEqual({ allowed: true, volume: 40 });
  });

  test('a volume below the ceiling passes through unchanged', () => {
    expect(decideStrike(strike('spark', 15), config({ ceiling: 40 }), [], false, NOW))
      .toEqual({ allowed: true, volume: 15 });
  });

  test('negative requests clamp to zero rather than refusing', () => {
    expect(decideStrike(strike('spark', -5), config(), [], false, NOW))
      .toEqual({ allowed: true, volume: 0 });
  });

  test('the default is half the ceiling; attention defaults to the full ceiling', () => {
    expect(decideStrike(strike('spark', null), config({ ceiling: 50 }), [], false, NOW))
      .toEqual({ allowed: true, volume: 25 });
    expect(decideStrike(strike('attention', null), config({ ceiling: 50, hourlyBudgetAttention: 8 }), [], false, NOW))
      .toEqual({ allowed: true, volume: 50 });
  });

});

describe('rate limits', () => {

  test('a strike inside the minimum gap is refused, naming the wait', () => {
    const out = decideStrike(strike(), config({ minGapSeconds: 30 }), [played(10)], false, NOW);
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.reason).toContain('minimum gap');
      expect(out.reason).toContain('20 s remain');
    }
  });

  test('a strike outside the gap and under budget is allowed', () => {
    expect(decideStrike(strike(), config({ minGapSeconds: 30 }), [played(45)], false, NOW).allowed).toBe(true);
  });

  test('the hourly budget refuses once spent', () => {
    const recent = Array.from({ length: 6 }, (_, i) => played(3000 - i * 120));
    const out = decideStrike(strike(), config({ hourlyBudget: 6 }), recent, false, NOW);
    expect(out.allowed).toBe(false);
    if (!out.allowed) { expect(out.reason).toContain('budget'); }
  });

  test('attention draws from its own, slightly larger budget', () => {
    const recent = Array.from({ length: 6 }, (_, i) => played(3000 - i * 120));
    expect(decideStrike(strike('attention'), config({ hourlyBudget: 6, hourlyBudgetAttention: 8 }), recent, false, NOW).allowed).toBe(true);
  });

  test('say shares the audible gap and budget', () => {
    const ask: StrikeAsk = { kind: 'say', leitmotif: null, requestedVolume: null };
    const out = decideStrike(ask, config({ ttsLocal: true, minGapSeconds: 30 }), [played(5)], false, NOW);
    expect(out.allowed).toBe(false);
  });

  test('auditions neither consume nor suffer the strike budget', () => {
    const spent = Array.from({ length: 6 }, (_, i) => played(3000 - i * 120));
    const audition: StrikeAsk = { kind: 'audition', leitmotif: 'spark', requestedVolume: null };
    expect(decideStrike(audition, config({ hourlyBudget: 6 }), spent, false, NOW).allowed).toBe(true);

    const auditions = Array.from({ length: 3 }, (_, i) => played(3000 - i * 300, 'audition'));
    expect(decideStrike(strike(), config({ hourlyBudget: 6, minGapSeconds: 30 }), auditions, false, NOW).allowed).toBe(true);
  });

});

describe('auditions', () => {

  const audition: StrikeAsk = { kind: 'audition', leitmotif: 'spark', requestedVolume: null };

  test('play at the fixed low volume, clamped by a lower ceiling', () => {
    expect(decideStrike(audition, config({ ceiling: 50 }), [], false, NOW))
      .toEqual({ allowed: true, volume: AUDITION_VOLUME });
    expect(decideStrike(audition, config({ ceiling: 10 }), [], false, NOW))
      .toEqual({ allowed: true, volume: 10 });
  });

  test('obey their own minimum gap', () => {
    const out = decideStrike(audition, config(), [played(AUDITION_MIN_GAP_SECONDS - 1, 'audition')], false, NOW);
    expect(out.allowed).toBe(false);
    if (!out.allowed) { expect(out.reason).toContain('audition minimum gap'); }
  });

  test('obey their own hourly budget', () => {
    const recent = Array.from({ length: AUDITION_HOURLY_BUDGET },
      (_, i) => played(3500 - i * 60, 'audition'));
    const out = decideStrike(audition, config(), recent, false, NOW);
    expect(out.allowed).toBe(false);
    if (!out.allowed) { expect(out.reason).toContain('audition budget'); }
  });

});
