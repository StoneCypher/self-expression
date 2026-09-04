/**
 * Stochastic property tests for the player's kill-deadline clamp.
 *
 * `effectiveCapMs` is the one place "how long can this sound run" is decided (spec
 * rule 5: nothing loops, ever), so its invariant is pinned property-style rather
 * than at a handful of example points: for any requested capMs, the effective
 * deadline never exceeds {@link HARD_CAP_MS} and never drops to zero or below.
 *
 * This replaces a fake test that asserted `HARD_CAP_MS <= 12000` — a constant
 * compared against itself, never exercising the clamp at all.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { effectiveCapMs, HARD_CAP_MS } from '../claudio/player.js';

const arbCapMs = fc.integer({ min: -1_000_000, max: 1_000_000 });

describe('effectiveCapMs invariants', () => {

  it('never exceeds HARD_CAP_MS and never drops to zero or below', () => {
    fc.assert(fc.property(arbCapMs, capMs => {
      const effective = effectiveCapMs(capMs);
      expect(effective).toBeLessThanOrEqual(HARD_CAP_MS);
      expect(effective).toBeGreaterThan(0);
    }));
  });

  it('is exactly min(max(1, capMs), HARD_CAP_MS) — the documented clamp, restated independently', () => {
    fc.assert(fc.property(arbCapMs, capMs => {
      expect(effectiveCapMs(capMs)).toBe(Math.min(Math.max(1, capMs), HARD_CAP_MS));
    }));
  });

  it('passes an in-range request through unchanged', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: HARD_CAP_MS }), capMs => {
      expect(effectiveCapMs(capMs)).toBe(capMs);
    }));
  });

  it('is idempotent: clamping an already-effective value changes nothing', () => {
    fc.assert(fc.property(arbCapMs, capMs => {
      const once  = effectiveCapMs(capMs),
            twice = effectiveCapMs(once);
      expect(twice).toBe(once);
    }));
  });

});
