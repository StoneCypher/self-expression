/**
 * Stochastic property tests for the public-aggregation boundary (issue #31).
 *
 * The load-bearing property is sentinel prose: a unique random marker planted in
 * *every* open-string field of every recorded row must never appear anywhere in the
 * serialized export — through the exporter directly and through the `share` tool's
 * preview and export verbs. The sentinel alphabet includes characters that cannot
 * occur in hex digests, so a hash carrying the marker would also be caught.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { recordEntry } from '../channels/entries.js';
import {
  CC_TYPES, exportPublicRows, freshSalt, pow2Bucket, capCount,
  coarsenTimestamp, localPeriod, closedOrNull, singleEmoji,
} from '../channels/public_export.js';
import { makeShareSession, handleShare } from '../mcp/share_tools.js';

const V    = '0.0.0-test',
      OPTS = { granularity: 'hour', pluginVersion: V } as const;

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-pubexp-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

function optIn(s: Store): void {
  writeConfig(s, 'share.enabled', 'true');
  writeConfig(s, 'share.opted_in_utc', '2020-01-01T00:00:00.000Z');
}

// 'z', 'q', and 'x' never occur in a hex digest, so the marker cannot hide inside one.
const sentinelArb = fc.integer({ min: 0, max: 2 ** 30 }).map(n => `zqx${n.toString(36)}xqz`);

// Printable-ASCII strings, built without relying on fc.string's default alphabet.
const asciiArb = fc.array(fc.integer({ min: 32, max: 126 }), { minLength: 0, maxLength: 24 })
  .map(codes => String.fromCharCode(...codes));

describe('sentinel prose — no free text survives export, anywhere', () => {

  it('a marker planted in every open-string field never appears in any serialized output', () => {
    fc.assert(fc.property(sentinelArb, (sentinel) => {
      withStore(s => {

        optIn(s);

        for (let i = 0; i < 3; i += 1) {
          recordEntry(s, {
            channel        : 'signature',
            text           : `prose about ${sentinel} client work ${String(i)}`,
            session        : `${sentinel}-session`,
            promptId       : `${sentinel}-prompt-${String(i)}`,
            title          : `${sentinel} status`,
            cwd            : `/home/me/${sentinel}`,
            project        : `${sentinel}-app`,
            gitBranch      : `feat/${sentinel}`,
            seriesKey      : `${sentinel}-series`,
            agentType      : `${sentinel}-reviewer`,
            agentId        : `${sentinel}-agent`,
            permissionMode : sentinel,
            contextEmoji   : sentinel,
            face           : sentinel,
            cctype         : sentinel,
            hostVersion    : sentinel,
          }, V);
        }

        const doc = exportPublicRows(s, freshSalt(), OPTS);
        expect(doc.rows.length).toBe(3);
        expect(JSON.stringify(doc)).not.toContain(sentinel);

        const session  = makeShareSession(),
              preview  = handleShare(s, session, V, { op: 'preview' }),
              exported = handleShare(s, session, V, { op: 'export' });
        expect(preview.content[0]?.text).not.toContain(sentinel);
        expect(exported.content[0]?.text).not.toContain(sentinel);
        expect(exported.content[0]?.text).not.toMatch(/^error/);

      });
    }), { numRuns: 10 });
  });

});

describe('linkage — grouping inside a submission, nothing across submissions', () => {

  const HASHED = ['uuid', 'session', 'prompt_id', 'machine_id', 'agent_id', 'series_key', 'corrects_uuid'] as const;

  function hashedValues(rows: readonly Record<string, unknown>[]): Set<string> {
    const out = new Set<string>();
    for (const row of rows) {
      for (const field of HASHED) {
        const value = row[field];
        if (typeof value === 'string') { out.add(value); }
      }
    }
    return out;
  }

  it('two exports of one store share no hashed value; one export hashes equal inputs equally', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 2 ** 30 }),
      (seed) => {
        withStore(s => {

          optIn(s);
          const session = `session-${seed.toString(36)}`;
          recordEntry(s, { channel: 'signature', text: 'a', session, seriesKey: 'k' }, V);
          recordEntry(s, { channel: 'need',      text: 'b', session, seriesKey: 'k' }, V);

          const docA = exportPublicRows(s, freshSalt(), OPTS),
                docB = exportPublicRows(s, freshSalt(), OPTS);

          // Within one export: the shared session and series group.
          expect(docA.rows[0]?.['session']).toBe(docA.rows[1]?.['session']);
          expect(docA.rows[0]?.['series_key']).toBe(docA.rows[1]?.['series_key']);

          // Across exports: fresh salt, zero overlap of any hashed value.
          const a = hashedValues(docA.rows), b = hashedValues(docB.rows);
          for (const value of a) { expect(b.has(value)).toBe(false); }
          expect(a.size).toBeGreaterThan(0);

        });
      }), { numRuns: 10 });
  });

});

describe('coarsening properties', () => {

  it('pow2Bucket is monotone and brackets its input', () => {
    fc.assert(fc.property(
      fc.nat({ max: 2 ** 31 }), fc.nat({ max: 2 ** 31 }),
      (x, y) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        expect(pow2Bucket(lo)).toBeLessThanOrEqual(pow2Bucket(hi));
        const bucket = pow2Bucket(hi);
        expect(hi).toBeLessThanOrEqual(2 ** bucket);
        if (bucket >= 2) { expect(hi).toBeGreaterThan(2 ** (bucket - 1)); }
      }));
  });

  it('capCount is the identity below the ceiling and 33+ above it', () => {
    fc.assert(fc.property(fc.nat({ max: 10_000 }), (n) => {
      expect(capCount(n)).toBe(n <= 32 ? n : '33+');
    }));
  });

  it('hour truncation is a prefix of the input ending :00:00Z; day is the ten-character date', () => {
    fc.assert(fc.property(
      fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }),
      (when) => {
        const iso  = when.toISOString(),
              hour = coarsenTimestamp(iso, 'hour'),
              day  = coarsenTimestamp(iso, 'day');
        expect(hour).toBe(`${iso.slice(0, 13)}:00:00Z`);
        expect(day).toBe(iso.slice(0, 10));
      }));
  });

  it('localPeriod maps every clock reading into its six-hour band', () => {
    fc.assert(fc.property(
      fc.nat({ max: 23 }), fc.nat({ max: 59 }),
      (hour, minute) => {
        const h12      = hour % 12 === 0 ? 12 : hour % 12,
              suffix   = hour >= 12 ? 'pm' : 'am',
              rendered = `${String(h12)}:${String(minute).padStart(2, '0')} ${suffix} PDT`,
              expected = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
        expect(localPeriod(rendered)).toBe(expected);
      }));
  });

});

describe('validator fuzzing', () => {

  it('singleEmoji rejects every printable-ASCII string', () => {
    fc.assert(fc.property(asciiArb, (value) => {
      expect(singleEmoji(value)).toBeNull();
    }));
  });

  it('singleEmoji rejects an emoji with anything appended', () => {
    fc.assert(fc.property(
      fc.constantFrom('🙂', '🌊', '👍🏽', '👨‍👩‍👧'),
      fc.constantFrom('🙂', 'a', ' ', '.', '0'),
      (emoji, tail) => {
        expect(singleEmoji(emoji + tail)).toBeNull();
      }));
  });

  it('closedOrNull keeps members and rejects everything else', () => {
    fc.assert(fc.property(asciiArb, (value) => {
      const kept = closedOrNull(CC_TYPES, value);
      if ((CC_TYPES as readonly string[]).includes(value)) { expect(kept).toBe(value); }
      else { expect(kept).toBeNull(); }
    }));
    for (const member of CC_TYPES) { expect(closedOrNull(CC_TYPES, member)).toBe(member); }
  });

});
