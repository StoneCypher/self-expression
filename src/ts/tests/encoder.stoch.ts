/**
 * Stochastic property tests for the PNG encoder.
 *
 * For random dimensions and random RGBA content: the IHDR honors the requested
 * width and height, every chunk's CRC validates against an independent
 * recomputation, and inflating the IDAT payload reproduces scanlines re-derived
 * from the input — never from the encoder's own intermediate state.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { crc32, inflateSync } from 'node:zlib';

import { encodePng } from '../raster/encoder.js';

const dimensionArb = fc.integer({ min: 1, max: 24 });

/** Random dimensions plus exactly-fitting random pixel bytes. */
const imageArb = fc
  .tuple(dimensionArb, dimensionArb)
  .chain(([width, height]) =>
    fc.tuple(
      fc.constant(width),
      fc.constant(height),
      fc.uint8Array({ minLength: 4 * width * height, maxLength: 4 * width * height }),
    ));

/** Walk the chunks after the signature as `[type, payload, claimedCrc]` triples. */
function chunksOf(png: Buffer): [string, Buffer, number][] {
  const out: [string, Buffer, number][] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    out.push([
      png.subarray(offset + 4, offset + 8).toString('latin1'),
      png.subarray(offset + 8, offset + 8 + length),
      png.readUInt32BE(offset + 8 + length),
    ]);
    offset += 12 + length;
  }
  return out;
}

describe('encodePng — stochastic invariants', () => {

  it('IHDR honors the requested width and height, whatever the content', () => {
    fc.assert(
      fc.property(imageArb, ([width, height, rgba]) => {
        const png    = encodePng(width, height, rgba);
        const [ihdr] = chunksOf(png);
        expect(ihdr?.[0]).toBe('IHDR');
        expect(ihdr?.[1].readUInt32BE(0)).toBe(width);
        expect(ihdr?.[1].readUInt32BE(4)).toBe(height);
      }),
      { numRuns: 100 }
    );
  });

  it('every chunk CRC validates against an independent recomputation', () => {
    fc.assert(
      fc.property(imageArb, ([width, height, rgba]) => {
        for (const [type, payload, claimed] of chunksOf(encodePng(width, height, rgba))) {
          expect(claimed).toBe(crc32(payload, crc32(Buffer.from(type, 'latin1'))) >>> 0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('decode-what-you-encoded: inflated IDAT equals scanlines re-derived from the input', () => {
    fc.assert(
      fc.property(imageArb, ([width, height, rgba]) => {

        const chunks = chunksOf(encodePng(width, height, rgba)),
              idat   = chunks.find(([type]) => type === 'IDAT');
        expect(idat).toBeDefined();

        const raw    = inflateSync(idat?.[1] ?? Buffer.alloc(0)),
              stride = 4 * width;

        expect(raw.length).toBe((stride + 1) * height);

        for (let y = 0; y < height; y++) {
          expect(raw[y * (stride + 1)]).toBe(0);
          const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
          expect(Buffer.compare(line, Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)))).toBe(0);
        }

      }),
      { numRuns: 100 }
    );
  });

  it('a wrong-length buffer always throws RangeError, never encodes garbage', () => {
    fc.assert(
      fc.property(dimensionArb, dimensionArb, fc.integer({ min: -8, max: 8 }), (width, height, offBy) => {
        fc.pre(offBy !== 0);
        const wrong = 4 * width * height + offBy;
        fc.pre(wrong >= 0);
        expect(() => encodePng(width, height, new Uint8Array(wrong))).toThrow(RangeError);
      }),
      { numRuns: 100 }
    );
  });

});
