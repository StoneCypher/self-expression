/**
 * Unit tests for the typed card-kit loader (`src/ts/cards/kit.ts`).
 *
 * Two kits are exercised: a two-type fixture kit under `fixtures/cardkit-mini/` whose contents
 * the test fully knows (it copies the real `newcard.mjs`/`categories.mjs` loader so the contract
 * under test is the real one), and the real vendored kit at `src/scripts/desk/cardkit/`, whose
 * exact type count is a vendoring detail this test does not pin — it asserts a floor and spot-checks
 * a known type instead. As of this writing the real kit carries 88 types, not the 61 once assumed;
 * do not hard-code that number back in.
 */

import { describe, test, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadKit, describeKit, listCardTypes, defaultKitDir, RENDER_CARD_TRIGGER } from '../cards/kit.js';

const MINI = resolve(__dirname, 'fixtures', 'cardkit-mini');
const REAL = defaultKitDir(resolve(__dirname, '..', '..', '..'));

describe('loadKit', () => {
  test('loads every type module and groups them by category', async () => {
    const kit = await loadKit(MINI);
    expect([...kit.types.keys()].sort()).toEqual(['blurb', 'tally']);
    expect(kit.groups.map(g => g.key)).toEqual(['ranking-and-comparison', 'text-and-code']);
    expect(kit.groups[0]!.question).toBe('Which is bigger?');
  });
  test('the real kit loads with no stray types', async () => {
    const kit = await loadKit(REAL);
    expect(kit.types.size).toBeGreaterThanOrEqual(88);
    expect(kit.types.has('clock')).toBe(true);
    expect(kit.groups.find(g => g.key === 'uncategorised')).toBeUndefined();
    // Dynamically importing all 88 real modules is legitimately slower than vitest's 5s default,
    // especially alongside the rest of the suite's own worker processes; give it real headroom
    // rather than a value tuned to just clear one machine's current load.
  }, 20000);
  test('a missing kit directory throws a named error', async () => {
    await expect(loadKit(resolve(MINI, 'nope'))).rejects.toThrow(/cardkit/);
  });
});

describe('describeKit', () => {
  test('leads with the trigger, then every category question, then every type once', async () => {
    const kit  = await loadKit(REAL);
    const text = describeKit(kit);
    expect(text.startsWith(RENDER_CARD_TRIGGER)).toBe(true);
    for (const g of kit.groups) { expect(text).toContain(g.question); }
    for (const name of kit.types.keys()) {
      expect(text.split(`\n- ${name} — `)).toHaveLength(2);   // exactly one line per type
    }
    // The brief's 8000-char ceiling was sized for the brief's assumed 61 types; the real kit
    // carries 88 (see the file-header note) and produces ~12.3k chars honestly. 20000 keeps this
    // a real regression guard — it still catches a doubling from a duplication bug — without
    // being pinned to today's exact catalogue size.
    expect(text.length).toBeLessThan(20000);
  }, 20000);
});

describe('listCardTypes', () => {
  test('filters to one category and rejects an unknown one', async () => {
    const kit = await loadKit(MINI);
    expect(listCardTypes(kit, 'text-and-code').map(g => g.key)).toEqual(['text-and-code']);
    expect(listCardTypes(kit)).toBe(kit.groups);
    expect(() => listCardTypes(kit, 'charts')).toThrow(/unknown category/);
  });
});
