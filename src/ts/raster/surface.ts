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

import { GLYPH_HEIGHT, GLYPH_SPACING, GLYPH_WIDTH, glyphColumns } from './font.js';

/** One color as red, green, blue, alpha bytes (0–255 each). */
export type Rgba = readonly [number, number, number, number];

/** A pixel buffer: `data` is row-major RGBA, `4 * width * height` bytes. */
export interface Surface {
  readonly width  : number;
  readonly height : number;
  readonly data   : Uint8Array;
}

/**
 * A translated, clipped drawing window onto a surface. All drawing coordinates
 * are relative to the region's own top-left corner.
 */
export interface Region {
  readonly surface : Surface;
  /** The region's left edge, in surface coordinates. */
  readonly x       : number;
  /** The region's top edge, in surface coordinates. */
  readonly y       : number;
  readonly width   : number;
  readonly height  : number;
}

// --- palette --------------------------------------------------------------------

/** Background. */
export const WHITE: Rgba = [255, 255, 255, 255];

/** Ink for frames, axes, and text. */
export const INK: Rgba = [40, 40, 40, 255];

/** Neutral grey for null / steady / unknown categories. */
export const GREY: Rgba = [153, 153, 153, 255];

/** Light grey for background bars and gridlines. */
export const LIGHT_GREY: Rgba = [220, 220, 220, 255];

/** Okabe–Ito orange. */
export const ORANGE: Rgba = [230, 159, 0, 255];

/** Okabe–Ito sky blue. */
export const SKY: Rgba = [86, 180, 233, 255];

/** Okabe–Ito bluish green. */
export const GREEN: Rgba = [0, 158, 115, 255];

/** Okabe–Ito yellow. */
export const YELLOW: Rgba = [240, 228, 66, 255];

/** Okabe–Ito blue. */
export const BLUE: Rgba = [0, 114, 178, 255];

/** Okabe–Ito vermillion. */
export const VERMILLION: Rgba = [213, 94, 0, 255];

/** Okabe–Ito reddish purple. */
export const PURPLE: Rgba = [204, 121, 167, 255];

// --- construction ---------------------------------------------------------------

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
export function makeSurface(width: number, height: number, fill: Rgba): Surface {

  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError(
      `makeSurface: width and height must be positive integers; got ${String(width)}×${String(height)}`
    );
  }

  const data = new Uint8Array(4 * width * height);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }

  return { width, height, data };

}

/**
 * The region covering an entire surface.
 *
 * @example
 *   const everywhere = fullRegion(makeSurface(4, 4, WHITE));
 */
export function fullRegion(surface: Surface): Region {
  return { surface, x: 0, y: 0, width: surface.width, height: surface.height };
}

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
export function subRegion(region: Region, x: number, y: number, width: number, height: number): Region {

  const left   = Math.max(region.x, region.x + x),
        top    = Math.max(region.y, region.y + y),
        right  = Math.min(region.x + region.width,  region.x + x + width),
        bottom = Math.min(region.y + region.height, region.y + y + height);

  return {
    surface : region.surface,
    x       : left,
    y       : top,
    width   : Math.max(0, right - left),
    height  : Math.max(0, bottom - top),
  };

}

// --- drawing --------------------------------------------------------------------

/**
 * Set one pixel, region-relative. Coordinates outside the region are silently
 * skipped — clipping, not clamping, so a stray coordinate never smears the edge.
 *
 * @example
 *   pixel(fullRegion(s), 0, 0, INK);
 */
export function pixel(region: Region, x: number, y: number, color: Rgba): void {

  const px = Math.round(x), py = Math.round(y);
  if (px < 0 || py < 0 || px >= region.width || py >= region.height) { return; }

  const sx = region.x + px, sy = region.y + py;
  const i  = 4 * (sy * region.surface.width + sx);

  region.surface.data[i]     = color[0];
  region.surface.data[i + 1] = color[1];
  region.surface.data[i + 2] = color[2];
  region.surface.data[i + 3] = color[3];

}

/**
 * Horizontal run of pixels starting at (`x`, `y`), `length` wide.
 *
 * @example
 *   hline(region, 0, 10, 50, INK);
 */
export function hline(region: Region, x: number, y: number, length: number, color: Rgba): void {
  for (let i = 0; i < length; i++) { pixel(region, x + i, y, color); }
}

/**
 * Vertical run of pixels starting at (`x`, `y`), `length` tall.
 *
 * @example
 *   vline(region, 10, 0, 50, INK);
 */
export function vline(region: Region, x: number, y: number, length: number, color: Rgba): void {
  for (let i = 0; i < length; i++) { pixel(region, x, y + i, color); }
}

/**
 * Solid filled rectangle with its top-left at (`x`, `y`).
 *
 * @example
 *   fillRect(region, 2, 2, 4, 4, BLUE);
 */
export function fillRect(region: Region, x: number, y: number, width: number, height: number, color: Rgba): void {
  for (let row = 0; row < height; row++) { hline(region, x, y + row, width, color); }
}

/**
 * One-pixel rectangle outline with its top-left at (`x`, `y`) — the panel frame.
 *
 * @example
 *   rect(region, 0, 0, region.width, region.height, INK);
 */
export function rect(region: Region, x: number, y: number, width: number, height: number, color: Rgba): void {
  hline(region, x, y,              width,  color);
  hline(region, x, y + height - 1, width,  color);
  vline(region, x, y,              height, color);
  vline(region, x + width - 1, y,  height, color);
}

/** Bresenham segment between two points, endpoints included. File-private: callers use {@link polyline}. */
function segment(region: Region, x0: number, y0: number, x1: number, y1: number, color: Rgba): void {

  let cx = Math.round(x0), cy = Math.round(y0);
  const tx = Math.round(x1), ty = Math.round(y1);

  const dx = Math.abs(tx - cx), sx = cx < tx ? 1 : -1,
        dy = -Math.abs(ty - cy), sy = cy < ty ? 1 : -1;

  let err = dx + dy;

  for (;;) {
    pixel(region, cx, cy, color);
    if (cx === tx && cy === ty) { break; }
    const doubled = 2 * err;
    if (doubled >= dy) { err += dy; cx += sx; }
    if (doubled <= dx) { err += dx; cy += sy; }
  }

}

/**
 * Connected line segments through `points`, drawn with Bresenham's algorithm.
 * A single point draws one pixel; an empty list draws nothing.
 *
 * @param points region-relative `[x, y]` vertices, in drawing order
 *
 * @example
 *   polyline(region, [[0, 10], [5, 2], [10, 8]], BLUE);
 */
export function polyline(region: Region, points: readonly (readonly [number, number])[], color: Rgba): void {

  const [first] = points;
  if (first === undefined) { return; }
  if (points.length === 1) { pixel(region, first[0], first[1], color); return; }

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    if (from !== undefined && to !== undefined) {
      segment(region, from[0], from[1], to[0], to[1], color);
    }
  }

}

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
export function text(region: Region, x: number, y: number, content: string, color: Rgba, scale = 1): void {

  const step = (GLYPH_WIDTH + GLYPH_SPACING) * scale;

  for (let index = 0; index < content.length; index++) {

    const columns = glyphColumns(content.charAt(index));
    if (columns === null) { continue; }

    for (let col = 0; col < GLYPH_WIDTH; col++) {
      const bits = columns[col] ?? 0;
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        if (((bits >> row) & 1) === 1) {
          fillRect(region, x + index * step + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }

  }

}

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
export function upscale(surface: Surface, factor: number): Surface {

  if (!Number.isInteger(factor) || factor < 1) {
    throw new RangeError(`upscale: factor must be a positive integer; got ${String(factor)}`);
  }

  const width  = surface.width  * factor,
        height = surface.height * factor,
        data   = new Uint8Array(4 * width * height);

  for (let y = 0; y < height; y++) {
    const sourceRow = Math.floor(y / factor);
    for (let x = 0; x < width; x++) {
      const from = 4 * (sourceRow * surface.width + Math.floor(x / factor)),
            to   = 4 * (y * width + x);
      data[to]     = surface.data[from]     ?? 0;
      data[to + 1] = surface.data[from + 1] ?? 0;
      data[to + 2] = surface.data[from + 2] ?? 0;
      data[to + 3] = surface.data[from + 3] ?? 0;
    }
  }

  return { width, height, data };

}

/**
 * Read one pixel back, region-relative — the assertion primitive the pixel tests
 * are written against. Out-of-region reads return `null`.
 *
 * @example
 *   readPixel(region, 0, 0)  // => [255, 255, 255, 255]
 */
export function readPixel(region: Region, x: number, y: number): Rgba | null {

  if (x < 0 || y < 0 || x >= region.width || y >= region.height) { return null; }

  const i = 4 * ((region.y + y) * region.surface.width + (region.x + x));
  const d = region.surface.data;

  return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0];

}
