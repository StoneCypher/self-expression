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
/** The eight fixed bytes every PNG file starts with. */
export declare const PNG_SIGNATURE: Buffer;
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
export declare function encodePng(width: number, height: number, rgba: Uint8Array): Buffer;
//# sourceMappingURL=encoder.d.ts.map