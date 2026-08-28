/**
 * Stochastic property tests for per-channel text length (issue #76).
 *
 * Three properties, each exercising the real write path through `handleExpress` against
 * a real store — never a hand-built expected object:
 *
 * - **The boundary is exact.** For any channel and any limit in range, text of exactly
 *   the limit records and text one character longer is refused. An off-by-one here is
 *   the single most likely bug in a length check, and it is invisible to example tests
 *   that only try obviously-short and obviously-long strings.
 * - **A limit is scoped to the channel it names.** Twelve flat keys are only worth
 *   their table width if setting one genuinely leaves the other eleven alone.
 * - **Limits govern writes only.** A row stored under a generous limit survives a
 *   later, much smaller one: unchanged text, still returned by reads, never pruned.
 *
 * @see ../channels/config.js channelMaxChars
 * @see ../mcp/tools.js handleExpress
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { recentEntries }                      from '../channels/entries.js';
import { pruneExpired }                       from '../channels/retention.js';
import {
  DEFAULT_CHANNEL_MAX_CHARS, MIN_CHANNEL_MAX_CHARS, channelMaxChars, channelMaxCharsKey,
} from '../channels/config.js';
import { CHANNELS }      from '../channels/vocabulary.js';
import type { Channel }  from '../channels/vocabulary.js';
import { handleExpress } from '../mcp/tools.js';

const VERSION = '0.2.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-length-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** A string of exactly `n` characters, which is the unit every limit is measured in. */
function chars(n: number): string { return 'x'.repeat(n); }

/** Whether the real handler accepted this text on this channel. */
function accepts(store: Store, channel: Channel, text: string): boolean {
  try { handleExpress(store, VERSION, { channel, text }); return true; }
  catch { return false; }
}

const channelArb = fc.constantFrom(...CHANNELS);

// Bounded well below MAX_TEXT_CEILING on purpose: the properties below are about the
// boundary and the scoping, not about throughput, and 400-character writes a hundred
// times over cost real disk for no extra coverage. The ceiling itself is pinned by an
// example test in tools.spec.ts, where one exact value is the whole point.
const limitArb = fc.integer({ min: MIN_CHANNEL_MAX_CHARS, max: 400 });

describe('the configured limit is the exact boundary', () => {

  it('accepts text of exactly the limit and refuses one character more, for every channel', () => {
    withStore(s => {
      fc.assert(fc.property(channelArb, limitArb, (channel, limit) => {

        writeConfig(s, channelMaxCharsKey(channel), String(limit));
        expect(channelMaxChars(s, channel)).toBe(limit);

        expect(accepts(s, channel, chars(limit))).toBe(true);
        expect(accepts(s, channel, chars(limit + 1))).toBe(false);

      }));
    });
    // Store-backed: every property run writes to disk through a real store, so the
    // default 5s vitest timeout is a flake margin under a concurrent build rather
    // than a correctness bound.
  }, 60_000);

  it('refuses everything above the limit and accepts everything at or below it', () => {
    withStore(s => {
      fc.assert(fc.property(
        channelArb, limitArb, fc.integer({ min: 1, max: 500 }),
        (channel, limit, length) => {

          writeConfig(s, channelMaxCharsKey(channel), String(limit));
          expect(accepts(s, channel, chars(length))).toBe(length <= limit);

        }));
    });
  }, 60_000);

});

describe('a limit is scoped to the channel it names', () => {

  it('setting one channel leaves every other channel at its own limit', () => {
    withStore(s => {
      fc.assert(fc.property(channelArb, limitArb, (channel, limit) => {

        // Start from a clean slate each run, so the property is about this one write
        // rather than about whatever earlier runs happened to leave behind.
        for (const other of CHANNELS) {
          writeConfig(s, channelMaxCharsKey(other), String(DEFAULT_CHANNEL_MAX_CHARS));
        }
        writeConfig(s, channelMaxCharsKey(channel), String(limit));

        for (const other of CHANNELS) {
          expect(channelMaxChars(s, other))
            .toBe(other === channel ? limit : DEFAULT_CHANNEL_MAX_CHARS);
        }

        // And the scoping is real at the write path, not just in the accessor: a
        // length only the untouched channels allow is refused by exactly one of them.
        if (limit < DEFAULT_CHANNEL_MAX_CHARS) {
          expect(accepts(s, channel, chars(DEFAULT_CHANNEL_MAX_CHARS))).toBe(false);
          for (const other of CHANNELS.filter(c => c !== channel)) {
            expect(accepts(s, other, chars(DEFAULT_CHANNEL_MAX_CHARS))).toBe(true);
          }
        }

      }), { numRuns: 30 });
    });
  }, 60_000);

});

describe('limits govern writes only — stored rows are never retroactively invalid', () => {

  it('a row written under a generous limit survives a much smaller one, unchanged', () => {
    withStore(s => {
      fc.assert(fc.property(
        channelArb,
        fc.integer({ min: 2, max: 400 }),
        (channel, length) => {

          writeConfig(s, channelMaxCharsKey(channel), '400');
          const before = chars(length);
          expect(accepts(s, channel, before)).toBe(true);

          const id = Number(s.db.prepare('SELECT MAX(id) id FROM entries').get()?.['id']);

          // Now lower the limit below what was written — as low as it goes.
          writeConfig(s, channelMaxCharsKey(channel), String(MIN_CHANNEL_MAX_CHARS));

          // The text is untouched.
          const row = s.db.prepare('SELECT text FROM entries WHERE id = ?').get(id);
          expect(row?.['text']).toBe(before);

          // The read path still returns it — a length check never becomes a filter.
          expect(recentEntries(s, 5).some(e => e['text'] === before)).toBe(true);

          // And a prune pass leaves it alone: deletion belongs to age, not to length.
          expect(pruneExpired(s).entries).toBe(0);
          expect(s.db.prepare('SELECT COUNT(*) c FROM entries WHERE id = ?').get(id)?.['c']).toBe(1);

        }), { numRuns: 40 });
    });
  }, 60_000);

  it('an over-long row survives a retention pass that has a horizon but does not reach it', () => {
    withStore(s => {
      fc.assert(fc.property(fc.integer({ min: 210, max: 400 }), (length) => {

        writeConfig(s, channelMaxCharsKey('pattern'), '400');
        expect(accepts(s, 'pattern', chars(length))).toBe(true);

        const id = Number(s.db.prepare('SELECT MAX(id) id FROM entries').get()?.['id']);

        writeConfig(s, channelMaxCharsKey('pattern'), '40');
        writeConfig(s, 'retention.days', '30');

        expect(pruneExpired(s).entries).toBe(0);
        expect(String(s.db.prepare('SELECT text FROM entries WHERE id = ?').get(id)?.['text']))
          .toHaveLength(length);

      }), { numRuns: 40 });
    });
  }, 60_000);

});
