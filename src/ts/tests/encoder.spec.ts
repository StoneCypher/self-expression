import { crc32, inflateSync } from 'node:zlib';

import { encodePng, PNG_SIGNATURE } from '../raster/encoder.js';

/** One parsed chunk: its type, payload, and the CRC the file claims for it. */
interface ParsedChunk {
  readonly type    : string;
  readonly payload : Buffer;
  readonly crc     : number;
}

/**
 * Walk a PNG's chunks after the 8-byte signature. Written here, independently of
 * the encoder, so every structural assertion below re-derives the format from
 * the bytes rather than trusting the encoder's own intermediate state.
 */
function parseChunks(png: Buffer): ParsedChunk[] {

  const chunks: ParsedChunk[] = [];
  let offset = 8;

  while (offset < png.length) {
    const length  = png.readUInt32BE(offset),
          type    = png.subarray(offset + 4, offset + 8).toString('latin1'),
          payload = png.subarray(offset + 8, offset + 8 + length),
          crc     = png.readUInt32BE(offset + 8 + length);
    chunks.push({ type, payload, crc });
    offset += 12 + length;
  }

  return chunks;

}

/** The CRC a chunk should carry: crc32 over its type bytes then its payload. */
function expectedCrc(chunk: ParsedChunk): number {
  return crc32(chunk.payload, crc32(Buffer.from(chunk.type, 'latin1'))) >>> 0;
}

/** A 2×3 raster with every pixel byte distinct, for roundtrip assertions. */
function distinctRgba(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(4 * width * height);
  for (let i = 0; i < rgba.length; i++) { rgba[i] = i % 256; }
  return rgba;
}

describe('encodePng structure', () => {

  const png    = encodePng(2, 3, distinctRgba(2, 3));
  const chunks = parseChunks(png);

  test('starts with the eight PNG signature bytes', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([...PNG_SIGNATURE]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test('carries exactly IHDR, IDAT, IEND, in that order', () => {
    expect(chunks.map(c => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  test('the chunk walk consumes the file exactly — no trailing bytes', () => {
    const total = 8 + chunks.reduce((sum, c) => sum + 12 + c.payload.length, 0);
    expect(total).toBe(png.length);
  });

  test('IHDR is 13 bytes: width, height, 8-bit, truecolor+alpha, no interlace', () => {
    const [ihdr] = chunks;
    expect(ihdr?.payload.length).toBe(13);
    expect(ihdr?.payload.readUInt32BE(0)).toBe(2);
    expect(ihdr?.payload.readUInt32BE(4)).toBe(3);
    expect([...(ihdr?.payload.subarray(8) ?? [])]).toEqual([8, 6, 0, 0, 0]);
  });

  test('every chunk CRC matches an independent recomputation', () => {
    for (const chunk of chunks) {
      expect(chunk.crc).toBe(expectedCrc(chunk));
    }
  });

  test('inflating IDAT reproduces the filter-byte-prefixed scanlines exactly', () => {

    const idat = chunks[1];
    expect(idat).toBeDefined();
    const raw = inflateSync(idat?.payload ?? Buffer.alloc(0));

    // Re-derive from the input, never from the encoder: 3 scanlines of
    // (1 filter byte + 8 pixel bytes) each.
    const rgba     = distinctRgba(2, 3);
    const expected = Buffer.alloc(3 * 9);
    for (let y = 0; y < 3; y++) {
      expected[y * 9] = 0;
      expected.set(rgba.subarray(y * 8, (y + 1) * 8), y * 9 + 1);
    }

    expect([...raw]).toEqual([...expected]);

  });

  test('IEND is empty', () => {
    expect(chunks[2]?.payload.length).toBe(0);
  });

});

describe('encodePng pinned fixture', () => {

  test('a 4×4 two-color raster encodes byte-for-byte to the pinned output', () => {

    // Top two rows opaque red, bottom two rows opaque blue.
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = 4 * (y * 4 + x);
        if (y < 2) { rgba[i]     = 255; rgba[i + 3] = 255; }
        else       { rgba[i + 2] = 255; rgba[i + 3] = 255; }
      }
    }

    expect(encodePng(4, 4, rgba).toString('hex')).toBe(
      '89504e470d0a1a0a0000000d4948445200000004000000040806000000a9f19e7e' +
      '0000001549444154789c63f8cfc0f01f19336008a0f13105002c501fe1f50c6f2d' +
      '0000000049454e44ae426082'
    );

  });

});

describe('encodePng rejection', () => {

  test('a wrong-length buffer throws RangeError naming the expected length', () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow(RangeError);
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow('16');
  });

  test.each([
    [0, 4], [4, 0], [-1, 4], [2.5, 4], [4, 2.5], [Number.NaN, 4],
  ])('width %p × height %p throws RangeError', (width, height) => {
    expect(() => encodePng(width, height, new Uint8Array(0))).toThrow(RangeError);
  });

});
