/**
 * A zero-dependency PNG encoder: RGBA bytes in, a complete PNG file `Buffer` out.
 *
 * PNG is a signature, a few length-prefixed chunks each carrying a CRC32, and
 * scanlines compressed with deflate — and Node supplies both non-trivial halves
 * (`zlib.deflateSync` always, `zlib.crc32` since v22.2.0). Since `node:sqlite`
 * already requires Node ≥ 22.5, any install that can open the store can encode a
 * PNG, so no CRC table fallback is carried.
 *
 * Output is deliberately the simplest valid encoding: 8-bit truecolor+alpha
 * (color type 6), filter type 0 (None) on every scanline, one `IDAT` chunk.
 * Chart rasters are large runs of flat color, which deflate at its default level
 * compresses well enough that smarter per-scanline filters are not worth their
 * code.
 *
 * @see ./surface.js
 * @see ./compose.js
 * @see ../../superpowers/spec/2026-08-27-png-history-design.md
 */

import { deflateSync, crc32 } from 'node:zlib';

/** The eight fixed bytes every PNG file starts with. */
export const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * One complete PNG chunk: 4-byte big-endian payload length, 4-byte ASCII type,
 * payload, then the CRC32 of type-plus-payload.
 *
 * File-private: callers deal in whole images, never loose chunks.
 */
function chunk(type: string, payload: Buffer): Buffer {

  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 'latin1');

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload, crc32(head.subarray(4, 8))) >>> 0, 0);

  return Buffer.concat([head, payload, crc]);

}

/**
 * Encode raw RGBA pixels as a complete PNG file.
 *
 * `rgba` is row-major, four bytes per pixel (red, green, blue, alpha), top row
 * first — exactly the layout `surface.ts` maintains — and must be exactly
 * `4 * width * height` bytes long.
 *
 * @param width  image width in pixels; a positive integer
 * @param height image height in pixels; a positive integer
 * @param rgba   the pixel bytes, row-major RGBA, length exactly `4 * width * height`
 * @returns the bytes of a valid PNG file, ready to write to disk
 *
 * @example
 *   const rgba = new Uint8Array(4 * 2 * 2).fill(255);   // a 2×2 white square
 *   const png  = encodePng(2, 2, rgba);
 *   writeFileSync('white.png', png);
 *
 * @throws {RangeError} When `width` or `height` is not a positive integer, or when
 *                      `rgba.length` is not `4 * width * height` — the message names
 *                      the expected length.
 *
 * @see ./compose.js
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {

  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError(
      `encodePng: width and height must be positive integers; got ${String(width)}×${String(height)}`
    );
  }

  const expected = 4 * width * height;
  if (rgba.length !== expected) {
    throw new RangeError(
      `encodePng: rgba must be exactly 4*width*height = ${String(expected)} bytes; got ${String(rgba.length)}`
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;   // bit depth
  ihdr[9]  = 6;   // color type: truecolor with alpha
  ihdr[10] = 0;   // compression: deflate
  ihdr[11] = 0;   // filter method: adaptive (per-scanline filter bytes)
  ihdr[12] = 0;   // interlace: none

  const stride = 4 * width;
  const raw    = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;   // filter type 0 (None) for this scanline
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);

}
