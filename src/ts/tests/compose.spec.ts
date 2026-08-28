import { crc32, inflateSync } from 'node:zlib';

import { HISTORY_CHARTS, LOGICAL_HEIGHT, LOGICAL_WIDTH, renderHistoryPng } from '../raster/compose.js';
import type { HistoryData } from '../raster/compose.js';

const EMPTY: HistoryData = {
  signatures: [], needWeeks: [], checklistSeries: [],
  days: 90, endUtc: '2026-08-27T21:15:04.000Z',
};

const SOME: HistoryData = {
  signatures: [
    { id: 1, tsUtc: '2026-08-27T16:00:00.000Z', hourLocal: 9,  stem: 'flow', delta: 'up',   uncertain: false, project: 'p' },
    { id: 2, tsUtc: '2026-08-27T20:00:00.000Z', hourLocal: 13, stem: null,   delta: 'down', uncertain: true,  project: null },
  ],
  needWeeks: [{ week: '2026-W35', turns: 12, needs: 3 }],
  checklistSeries: [{ seriesKey: 'coverage', percents: [40, 60, 80] }],
  days: 90, endUtc: '2026-08-27T21:15:04.000Z',
};

/** Reads IHDR's width and height out of an encoded PNG. */
function dimensions(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

/** Validates the signature and every chunk CRC — the structural "is this a PNG" check. */
function structurallyValid(png: Buffer): boolean {

  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { return false; }

  let offset = 8;
  while (offset < png.length) {
    const length  = png.readUInt32BE(offset),
          typeAnd = png.subarray(offset + 4, offset + 8 + length),
          claimed = png.readUInt32BE(offset + 8 + length);
    if (claimed !== (crc32(typeAnd) >>> 0)) { return false; }
    offset += 12 + length;
  }

  return offset === png.length;

}

describe('renderHistoryPng', () => {

  test('the default dashboard is a structurally valid PNG at 2× (1920×1440)', () => {
    const png = renderHistoryPng(SOME);
    expect(structurallyValid(png)).toBe(true);
    expect(dimensions(png)).toEqual([LOGICAL_WIDTH * 2, LOGICAL_HEIGHT * 2]);
  });

  test('scale 1 renders at logical size', () => {
    expect(dimensions(renderHistoryPng(SOME, { scale: 1 }))).toEqual([LOGICAL_WIDTH, LOGICAL_HEIGHT]);
  });

  test('an entirely empty store still renders a valid dashboard — five empty panels, not zero', () => {
    const png = renderHistoryPng(EMPTY);
    expect(structurallyValid(png)).toBe(true);
    expect(png.length).toBeGreaterThan(1000);
  });

  test.each(HISTORY_CHARTS)("chart '%s' renders a structurally valid PNG", (chart) => {
    expect(structurallyValid(renderHistoryPng(SOME, { chart, scale: 1 }))).toBe(true);
  });

  test('a single-panel render differs from the dashboard — the option is actually honored', () => {
    const dashboard = renderHistoryPng(SOME, { scale: 1 });
    const single    = renderHistoryPng(SOME, { chart: 'delta', scale: 1 });
    expect(dashboard.equals(single)).toBe(false);
  });

  test('data with content renders more scanline variety than an empty render', () => {

    // Decode both rasters and compare: the seeded render must actually differ.
    const inflate = (png: Buffer): Buffer => {
      let offset = 8;
      const parts: Buffer[] = [];
      while (offset < png.length) {
        const length = png.readUInt32BE(offset),
              type   = png.subarray(offset + 4, offset + 8).toString('latin1');
        if (type === 'IDAT') { parts.push(png.subarray(offset + 8, offset + 8 + length)); }
        offset += 12 + length;
      }
      return inflateSync(Buffer.concat(parts));
    };

    expect(inflate(renderHistoryPng(SOME,  { scale: 1 }))
      .equals(inflate(renderHistoryPng(EMPTY, { scale: 1 })))).toBe(false);

  });

  test('a non-positive or fractional day window throws RangeError', () => {
    expect(() => renderHistoryPng({ ...EMPTY, days: 0 })).toThrow(RangeError);
    expect(() => renderHistoryPng({ ...EMPTY, days: 1.5 })).toThrow(RangeError);
  });

});
