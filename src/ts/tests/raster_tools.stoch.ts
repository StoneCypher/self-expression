/**
 * Stochastic end-to-end properties for the PNG history pipeline: whatever mix of
 * entries a store holds and whatever options a caller picks, `renderHistoryToFile`
 * always writes a structurally valid PNG (signature, IHDR-consistent dimensions,
 * every chunk CRC verified against independent recomputation) at the path it
 * returns, and its row counts never exceed what was recorded.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { crc32 }               from 'node:zlib';

import { dirname }               from 'node:path';

import { openStore, closeStore } from '../channels/store.js';
import { recordEntry, localHour, isoWeekKey } from '../channels/entries.js';
import { renderHistoryToFile, resolveRenderPath } from '../mcp/chart_tools.js';
import { HISTORY_CHARTS }        from '../raster/compose.js';

const VERSION = '0.2.0';
const WHEN    = new Date('2026-08-27T21:15:04.000Z');

const entryArb = fc.record({
  channel  : fc.constantFrom('signature', 'need', 'checklist', 'idea') as fc.Arbitrary<'signature' | 'need' | 'checklist' | 'idea'>,
  stem     : fc.option(fc.constantFrom('flow', 'spark', 'drag', 'fog', 'strain', 'still') as fc.Arbitrary<'flow' | 'spark' | 'drag' | 'fog' | 'strain' | 'still'>, { nil: undefined }),
  delta    : fc.option(fc.constantFrom('up', 'down', 'steady') as fc.Arbitrary<'up' | 'down' | 'steady'>, { nil: undefined }),
  uncertain: fc.boolean(),
  percent  : fc.integer({ min: 0, max: 100 }),
  series   : fc.constantFrom('alpha', 'beta', 'gamma'),
  promptId : fc.constantFrom('p1', 'p2', 'p3', 'p4'),
  daysBack : fc.integer({ min: 0, max: 100 }),
});

const optionsArb = fc.record({
  days  : fc.integer({ min: 1, max: 120 }),
  chart : fc.constantFrom(...HISTORY_CHARTS),
  scale : fc.constantFrom(1, 2) as fc.Arbitrary<1 | 2>,
});

/** Structural PNG validation: signature, chunk walk consuming the file, CRCs. */
function assertValidPng(png: Buffer): void {

  expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);

  let offset = 8;
  const types: string[] = [];
  while (offset < png.length) {
    const length  = png.readUInt32BE(offset),
          typeAnd = png.subarray(offset + 4, offset + 8 + length),
          claimed = png.readUInt32BE(offset + 8 + length);
    types.push(png.subarray(offset + 4, offset + 8).toString('latin1'));
    expect(claimed).toBe(crc32(typeAnd) >>> 0);
    offset += 12 + length;
  }

  expect(offset).toBe(png.length);
  expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);

}

describe('renderHistoryToFile — stochastic end-to-end', () => {

  it('always writes a structurally valid PNG whose counts never exceed the record', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 12 }), optionsArb, (entries, options) => {

        const dir   = mkdtempSync(join(tmpdir(), 'se-raster-stoch-')),
              store = openStore(join(dir, 'log.sqlite3'));

        try {

          let signaturesRecorded = 0;

          for (const entry of entries) {
            const at = new Date(WHEN.getTime() - entry.daysBack * 86_400_000);
            if (entry.channel === 'signature') {
              signaturesRecorded++;
              recordEntry(store, {
                channel: 'signature', text: 'sig', session: 's1', promptId: entry.promptId,
                stem: entry.stem, delta: entry.delta, uncertain: entry.uncertain,
              }, VERSION, at);
            } else if (entry.channel === 'checklist') {
              recordEntry(store, {
                channel: 'checklist', text: '- x', session: 's1',
                seriesKey: entry.series, percent: entry.percent,
              }, VERSION, at);
            } else {
              recordEntry(store, { channel: entry.channel, text: 'note', session: 's1', promptId: entry.promptId }, VERSION, at);
            }
          }

          const result = renderHistoryToFile(store, {
            days: options.days, chart: options.chart, scale: options.scale,
            out: 'render.png',
          }, WHEN);

          const png = readFileSync(result.path);
          assertValidPng(png);

          const scaledWidth = png.readUInt32BE(16);
          expect(scaledWidth).toBe(960 * options.scale);

          expect(result.signatureCount).toBeLessThanOrEqual(signaturesRecorded);
          expect(result.weekCount).toBeGreaterThanOrEqual(0);
          expect(result.seriesCount).toBeLessThanOrEqual(3);

        } finally {
          closeStore(store);
          rmSync(dir, { recursive: true, force: true });
        }

      }),
      { numRuns: 10 }
    );
  }, 60_000);

});

describe('localHour — stochastic invariants', () => {

  it('recovers the hour for every rendered clock time', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (hour, minute) => {
        const suffix  = hour >= 12 ? 'pm' : 'am',
              twelve  = hour % 12 === 0 ? 12 : hour % 12,
              rendered = `${String(twelve)}:${String(minute).padStart(2, '0')} ${suffix} PDT`;
        expect(localHour(rendered)).toBe(hour);
      }),
      { numRuns: 200 }
    );
  });

});

describe('isoWeekKey — stochastic invariants', () => {

  it('every instant lands in a well-formed week, and week keys are monotone over time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        (daysA, daysB) => {
          const base    = Date.parse('2020-01-01T12:00:00Z'),
                earlier = new Date(base + Math.min(daysA, daysB) * 86_400_000),
                later   = new Date(base + Math.max(daysA, daysB) * 86_400_000);
          const keyEarlier = isoWeekKey(earlier), keyLater = isoWeekKey(later);
          expect(keyEarlier).toMatch(/^\d{4}-W\d{2}$/);
          expect(keyEarlier <= keyLater).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

});

describe('resolveRenderPath — stochastic invariants', () => {

  it('for any string, out either throws or resolves inside <dataDir>/renders/', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (out) => {
        const dataDir = 'C:/data', rendersDir = join(dataDir, 'renders');
        try {
          const path = resolveRenderPath(dataDir, out);
          expect(dirname(path)).toBe(rendersDir);
        } catch (err) {
          expect(err).toBeInstanceOf(RangeError);
        }
      }),
      { numRuns: 300 }
    );
  });

});
