/**
 * Stochastic property tests for the strike gate.
 *
 * The gate is the whole safety story — consent, ceiling, scarcity — so its
 * invariants are pinned property-style: whatever the configuration, history, and
 * request, a disabled facility never allows, an allowed volume never exceeds the
 * ceiling, and a spent budget always refuses.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { decideStrike }      from '../claudio/gate.js';
import type { StrikeAsk }    from '../claudio/gate.js';
import type { AudioConfig }  from '../claudio/config.js';
import type { RecentStrike } from '../claudio/ledger.js';
import { LEITMOTIFS, STRIKE_KINDS } from '../claudio/vocabulary.js';

const NOW = '2026-08-28T12:00:00.000Z';

const arbConfig: fc.Arbitrary<AudioConfig> = fc.record({
  enabled               : fc.boolean(),
  ttsLocal              : fc.boolean(),
  ceiling               : fc.integer({ min: 0, max: 100 }),
  minGapSeconds         : fc.integer({ min: 0, max: 3600 }),
  hourlyBudget          : fc.integer({ min: 0, max: 20 }),
  hourlyBudgetAttention : fc.integer({ min: 0, max: 20 }),
});

const arbAsk: fc.Arbitrary<StrikeAsk> = fc.record({
  kind            : fc.constantFrom(...STRIKE_KINDS),
  leitmotif       : fc.constantFrom(...LEITMOTIFS),
  requestedVolume : fc.option(fc.integer({ min: -50, max: 200 })),
}).map(ask => ask.kind === 'say' ? { ...ask, leitmotif: null } : ask);

/** Recent played history: ages in seconds within the hour, oldest first. */
const arbRecent: fc.Arbitrary<RecentStrike[]> = fc.array(
  fc.record({
    age  : fc.integer({ min: 0, max: 3599 }),
    kind : fc.constantFrom(...STRIKE_KINDS),
  }),
  { maxLength: 30 },
).map(rows => rows
  .sort((a, b) => b.age - a.age)
  .map(row => ({
    utc       : new Date(Date.parse(NOW) - row.age * 1000).toISOString(),
    kind      : row.kind,
    leitmotif : row.kind === 'say' ? null : 'spark',
  })));

describe('gate invariants', () => {

  it('a disabled facility never allows anything', () => {
    fc.assert(fc.property(arbConfig, arbAsk, arbRecent, fc.boolean(), (config, ask, recent, opened) => {
      const out = decideStrike(ask, { ...config, enabled: false }, recent, opened, NOW);
      expect(out.allowed).toBe(false);
      if (!out.allowed) { expect(out.reason).toContain('audio.enabled'); }
    }));
  });

  it('an allowed volume always lands in [0, ceiling]', () => {
    fc.assert(fc.property(arbConfig, arbAsk, arbRecent, fc.boolean(), (config, ask, recent, opened) => {
      const out = decideStrike(ask, config, recent, opened, NOW);
      if (out.allowed) {
        expect(out.volume).toBeGreaterThanOrEqual(0);
        expect(out.volume).toBeLessThanOrEqual(config.ceiling);
        expect(Number.isInteger(out.volume)).toBe(true);
      }
    }));
  });

  it('a spent audible budget always refuses strikes and says', () => {
    fc.assert(fc.property(arbConfig, arbAsk, arbRecent, (config, ask, recent) => {
      fc.pre(ask.kind !== 'audition');
      const audible = recent.filter(r => r.kind !== 'audition'),
            budget  = ask.leitmotif === 'attention' ? config.hourlyBudgetAttention : config.hourlyBudget;
      fc.pre(audible.length >= budget);
      const out = decideStrike(ask, { ...config, enabled: true, ttsLocal: true }, recent, false, NOW);
      expect(out.allowed).toBe(false);
    }));
  });

  it('a fresh history with an open budget always allows an in-gap-free strike', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 20 }),
      fc.integer({ min: 0, max: 100 }),
      fc.constantFrom(...LEITMOTIFS),
      (budget, ceiling, leitmotif) => {
        const config: AudioConfig = {
          enabled: true, ttsLocal: false, ceiling,
          minGapSeconds: 30, hourlyBudget: budget, hourlyBudgetAttention: budget,
        };
        const out = decideStrike(
          { kind: 'strike', leitmotif, requestedVolume: null }, config, [], false, NOW);
        expect(out.allowed).toBe(true);
      }));
  });

  it('the decision is pure: identical inputs give identical verdicts', () => {
    fc.assert(fc.property(arbConfig, arbAsk, arbRecent, fc.boolean(), (config, ask, recent, opened) => {
      const a = decideStrike(ask, config, recent, opened, NOW),
            b = decideStrike(ask, config, recent, opened, NOW);
      expect(a).toEqual(b);
    }));
  });

});
