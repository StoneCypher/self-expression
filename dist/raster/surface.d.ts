/**
 * A minimal drawing surface over a flat RGBA array, plus the chart palette.
 *
 * Every operation draws through a {@link Region} — a translated, clipped window
 * onto a surface — so panel code can be handed its own rectangle and physically
 * cannot scribble on a neighbouring panel: out-of-region pixels are silently
 * skipped rather than clamped onto the edge or thrown over. Pure throughout — no
 * I/O, no clock, no randomness — so every operation is directly assertable
 * pixel-by-pixel.
 *
 * Colors are opaque and overwrite; there is no blending and no anti-aliasing,
 * which is what keeps 2× upscaling crisp.
 *
 * @see ./font.js
 * @see ./panels.js
 * @see ./encoder.js
 */
/** One color as red, green, blue, alpha bytes (0–255 each). */
export type Rgba = readonly [number, number, number, number];
/** A pixel buffer: `data` is row-major RGBA, `4 * width * height` bytes. */
export interface Surface {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
}
/**
 * A translated, clipped drawing window onto a surface. All drawing coordinates
 * are relative to the region's own top-left corner.
 */
export interface Region {
    readonly surface: Surface;
    /** The region's left edge, in surface coordinates. */
    readonly x: number;
    /** The region's top edge, in surface coordinates. */
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** Background. */
export declare const WHITE: Rgba;
/** Ink for frames, axes, and text. */
export declare const INK: Rgba;
/** Neutral grey for null / steady / unknown categories. */
export declare const GREY: Rgba;
/** Light grey for background bars and gridlines. */
export declare const LIGHT_GREY: Rgba;
/** Okabe–Ito orange. */
export declare const ORANGE: Rgba;
/** Okabe–Ito sky blue. */
export declare const SKY: Rgba;
/** Okabe–Ito bluish green. */
export declare const GREEN: Rgba;
/** Okabe–Ito yellow. */
export declare const YELLOW: Rgba;
/** Okabe–Ito blue. */
export declare const BLUE: Rgba;
/** Okabe–Ito vermillion. */
export declare const VERMILLION: Rgba;
/** Okabe–Ito reddish purple. */
export declare const PURPLE: Rgba;
/**
 * Allocate a surface filled with one color.
 *
 * @param width  surface width in pixels; a positive integer
 * @param height surface height in pixels; a positive integer
 * @param fill   the color every pixel starts as
 *
 * @example
 *   const s = makeSurface(960, 720, WHITE);
 *
 * @throws {RangeError} When `width` or `height` is not a positive integer.
 */
export declare function makeSurface(width: number, height: number, fill: Rgba): Surface;
/**
 * The region covering an entire surface.
 *
 * @example
 *   const everywhere = fullRegion(makeSurface(4, 4, WHITE));
 */
export declare function fullRegion(surface: Surface): Region;
/**
 * A translated sub-window of an existing region, clipped so it can never extend
 * past its parent — the mechanism by which a panel is confined to its rectangle.
 *
 * A sub-region requested wholly outside the parent degenerates to zero size
 * rather than erroring; drawing into it is then a no-op.
 *
 * @param region the parent window
 * @param x      the sub-window's left edge, relative to the parent
 * @param y      the sub-window's top edge, relative to the parent
 *
 * @example
 *   const panel = subRegion(fullRegion(s), 8, 8, 592, 336);
 */
export declare function subRegion(region: Region, x: number, y: number, width: number, height: number): Region;
/**
 * Set one pixel, region-relative. Coordinates outside the region are silently
 * skipped — clipping, not clamping, so a stray coordinate never smears the edge.
 *
 * @example
 *   pixel(fullRegion(s), 0, 0, INK);
 */
export declare function pixel(region: Region, x: number, y: number, color: Rgba): void;
/**
 * Horizontal run of pixels starting at (`x`, `y`), `length` wide.
 *
 * @example
 *   hline(region, 0, 10, 50, INK);
 */
export declare function hline(region: Region, x: number, y: number, length: number, color: Rgba): void;
/**
 * Vertical run of pixels starting at (`x`, `y`), `length` tall.
 *
 * @example
 *   vline(region, 10, 0, 50, INK);
 */
export declare function vline(region: Region, x: number, y: number, length: number, color: Rgba): void;
/**
 * Solid filled rectangle with its top-left at (`x`, `y`).
 *
 * @example
 *   fillRect(region, 2, 2, 4, 4, BLUE);
 */
export declare function fillRect(region: Region, x: number, y: number, width: number, height: number, color: Rgba): void;
/**
 * One-pixel rectangle outline with its top-left at (`x`, `y`) — the panel frame.
 *
 * @example
 *   rect(region, 0, 0, region.width, region.height, INK);
 */
export declare function rect(region: Region, x: number, y: number, width: number, height: number, color: Rgba): void;
/**
 * Connected line segments through `points`, drawn with Bresenham's algorithm.
 * A single point draws one pixel; an empty list draws nothing.
 *
 * @param points region-relative `[x, y]` vertices, in drawing order
 *
 * @example
 *   polyline(region, [[0, 10], [5, 2], [10, 8]], BLUE);
 */
export declare function polyline(region: Region, points: readonly (readonly [number, number])[], color: Rgba): void;
/**
 * Blit a string using the 5×7 bitmap font, top-left at (`x`, `y`), each font
 * pixel drawn as a `scale`×`scale` block. Characters without a glyph occupy a
 * blank cell, so mixed text never shifts alignment.
 *
 * @param scale integer magnification; 1 for small labels, 2 for titles
 *
 * @example
 *   text(region, 4, 4, 'stems by hour', INK, 1);
 *
 * @see ./font.js
 */
export declare function text(region: Region, x: number, y: number, content: string, color: Rgba, scale?: number): void;
/**
 * Nearest-neighbour integer upscale of a whole surface — how the logical
 * 960×720 dashboard becomes the crisp 1920×1440 physical raster without any
 * anti-aliasing.
 *
 * @param factor integer magnification, at least 1; 1 returns a copy
 *
 * @example
 *   const big = upscale(s, 2);   // 960×720 -> 1920×1440
 *
 * @throws {RangeError} When `factor` is not a positive integer.
 */
export declare function upscale(surface: Surface, factor: number): Surface;
/**
 * Read one pixel back, region-relative — the assertion primitive the pixel tests
 * are written against. Out-of-region reads return `null`.
 *
 * @example
 *   readPixel(region, 0, 0)  // => [255, 255, 255, 255]
 */
export declare function readPixel(region: Region, x: number, y: number): Rgba | null;
//# sourceMappingURL=surface.d.ts.map