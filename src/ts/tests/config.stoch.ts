/**
 * Stochastic property tests for the config registry in channels/config.ts.
 *
 * Pins the two write-path invariants issue #30's D2 rests on: canonicalization is a
 * fixed point (validating a canonical value returns it unchanged, so store→read→
 * validate round-trips are stable), and an invalid value never writes — checked
 * through the real `configure` handler against a real store, never a hand-built
 * expected object.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, writeConfig, readConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  intValidator, validateBool, validateChannelList, stringValidator, effectiveValue,
} from '../channels/config.js';
import { CHANNELS } from '../channels/vocabulary.js';
import { handleConfigure } from '../mcp/tools.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-config-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

const daysValidator = intValidator(0, 3650);

describe('canonicalization is a fixed point', () => {

  it('ints: any in-range integer, however zero-padded or spaced, round-trips store→read→validate', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.integer({ min: 0, max: 3650 }),
        fc.nat({ max: 3 }),
        (n, pad) => {

          const raw     = ` ${'0'.repeat(pad)}${String(n)} `,
                outcome = daysValidator(raw);

          expect(outcome).toEqual({ ok: true, canonical: String(n) });
          if (!outcome.ok) { return; }

          writeConfig(s, 'retention.days', outcome.canonical);
          const stored = readConfig(s, 'retention.days');
          expect(stored).toBe(outcome.canonical);
          expect(daysValidator(stored ?? '')).toEqual(outcome);
          expect(effectiveValue(s, 'retention.days')).toBe(outcome.canonical);

        }));
    });
    // 100 property runs each write to disk through a real store; under a concurrent
    // build the default 5s vitest timeout is a flake margin, not a correctness bound.
  }, 60_000);

  it('lists: any non-empty subsequence of the channels, however spaced, canonicalizes stably', () => {
    fc.assert(fc.property(
      fc.subarray([...CHANNELS], { minLength: 1 }),
      fc.array(fc.constantFrom('', ' ', '  '), { minLength: 12, maxLength: 12 }),
      (channels, pads) => {

        const raw     = channels.map((c, i) => `${pads[i] ?? ''}${c}${pads[11 - i] ?? ''}`).join(','),
              outcome = validateChannelList(raw);

        expect(outcome).toEqual({ ok: true, canonical: channels.join(',') });
        if (outcome.ok) { expect(validateChannelList(outcome.canonical)).toEqual(outcome); }

      }));
  });

  it('strings: any trimmed non-empty value within the cap validates to itself', () => {
    const version = stringValidator(64);
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 64 }).filter(v => v.trim() === v && v !== ''),
      (value) => {
        const outcome = version(value);
        expect(outcome).toEqual({ ok: true, canonical: value });
      }));
  });

  it('bools: any casing of true/false canonicalizes to lowercase, and the fixed point holds', () => {
    fc.assert(fc.property(
      fc.constantFrom('true', 'false'),
      fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
      (word, upper) => {
        const raw     = [...word].map((ch, i) => (upper[i % 5] ?? false) ? ch.toUpperCase() : ch).join(''),
              outcome = validateBool(raw);
        expect(outcome).toEqual({ ok: true, canonical: word });
        if (outcome.ok) { expect(validateBool(outcome.canonical)).toEqual(outcome); }
      }));
  });

});

describe('invalid values never write', () => {

  it('arbitrary non-integer strings are rejected by set and leave the table untouched', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.string({ maxLength: 20 }).filter(v => !/^\d+$/.test(v.trim())),
        (raw) => {

          const before = readConfig(s, 'retention.days'),
                out    = handleConfigure(s, { op: 'set', key: 'retention.days', value: raw });

          expect(out.content[0]?.text).toMatch(/^error: /);
          expect(readConfig(s, 'retention.days')).toBe(before);

        }));
    });
    // Store-backed like the ints property above: the default 5s vitest timeout is a
    // flake margin under a concurrent build, not a correctness bound.
  }, 60_000);

  it('arbitrary non-boolean strings are rejected for every bool key', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.string({ maxLength: 12 }).filter(v => !['true', 'false'].includes(v.trim().toLowerCase())),
        fc.constantFrom('gate.signature', 'gate.checklist', 'time.hook', 'dwelling.enabled',
                        'privacy.store_cwd', 'privacy.store_prompt_len'),
        (raw, key) => {

          const out = handleConfigure(s, { op: 'set', key, value: raw });

          expect(out.content[0]?.text).toMatch(/^error: /);
          expect(readConfig(s, key)).toBeNull();

        }));
    });
    // Store-backed like the ints property above; same flake margin, same widening.
  }, 60_000);

  it('a stored garbage row never leaks through the tolerant accessor', () => {
    withStore(s => {
      fc.assert(fc.property(
        fc.string({ maxLength: 20 }).filter(v => !/^\d+$/.test(v.trim())),
        (raw) => {
          writeConfig(s, 'retention.days', raw);   // simulate a hand-edited database
          expect(effectiveValue(s, 'retention.days')).toBe('0');
        }));
    });
    // Store-backed like the ints property above; same flake margin, same widening.
  }, 60_000);

});
