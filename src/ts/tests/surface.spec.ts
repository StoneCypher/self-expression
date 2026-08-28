import {
  BLUE, INK, WHITE,
  fillRect, fullRegion, hline, makeSurface, pixel, polyline, readPixel, rect,
  subRegion, text, upscale, vline,
} from '../raster/surface.js';
import type { Region } from '../raster/surface.js';
import { GLYPHS } from '../raster/font.js';

/** A fresh white 16×16 surface region, the canvas most tests draw on. */
function canvas(): Region {
  return fullRegion(makeSurface(16, 16, WHITE));
}

describe('makeSurface', () => {

  test('allocates 4 bytes per pixel, all set to the fill color', () => {
    const s = makeSurface(3, 2, BLUE);
    expect(s.data.length).toBe(24);
    for (let i = 0; i < s.data.length; i += 4) {
      expect([...s.data.subarray(i, i + 4)]).toEqual([...BLUE]);
    }
  });

  test.each([[0, 4], [4, 0], [1.5, 4]])('rejects %p × %p', (w, h) => {
    expect(() => makeSurface(w, h, WHITE)).toThrow(RangeError);
  });

});

describe('pixel and readPixel', () => {

  test('a written pixel reads back exactly; its neighbors stay white', () => {
    const region = canvas();
    pixel(region, 5, 7, INK);
    expect(readPixel(region, 5, 7)).toEqual([...INK]);
    expect(readPixel(region, 4, 7)).toEqual([...WHITE]);
    expect(readPixel(region, 5, 6)).toEqual([...WHITE]);
  });

  test('out-of-region writes are skipped, not clamped onto the edge', () => {
    const region = canvas();
    pixel(region, -1, 0, INK);
    pixel(region, 0, -1, INK);
    pixel(region, 16, 0, INK);
    pixel(region, 0, 16, INK);
    for (let x = 0; x < 16; x++) {
      expect(readPixel(region, x, 0)).toEqual([...WHITE]);
      expect(readPixel(region, x, 15)).toEqual([...WHITE]);
    }
  });

  test('out-of-region reads return null', () => {
    expect(readPixel(canvas(), -1, 0)).toBeNull();
    expect(readPixel(canvas(), 0, 16)).toBeNull();
  });

});

describe('lines and rectangles', () => {

  test('hline covers exactly its span', () => {
    const region = canvas();
    hline(region, 2, 3, 5, INK);
    for (let x = 0; x < 16; x++) {
      expect(readPixel(region, x, 3)).toEqual(x >= 2 && x < 7 ? [...INK] : [...WHITE]);
    }
  });

  test('vline covers exactly its span', () => {
    const region = canvas();
    vline(region, 4, 1, 3, INK);
    for (let y = 0; y < 16; y++) {
      expect(readPixel(region, 4, y)).toEqual(y >= 1 && y < 4 ? [...INK] : [...WHITE]);
    }
  });

  test('rect inks the border and leaves the interior untouched', () => {
    const region = canvas();
    rect(region, 1, 1, 6, 5, INK);
    expect(readPixel(region, 1, 1)).toEqual([...INK]);   // corners
    expect(readPixel(region, 6, 1)).toEqual([...INK]);
    expect(readPixel(region, 1, 5)).toEqual([...INK]);
    expect(readPixel(region, 6, 5)).toEqual([...INK]);
    expect(readPixel(region, 3, 3)).toEqual([...WHITE]); // interior
    expect(readPixel(region, 0, 0)).toEqual([...WHITE]); // outside
  });

  test('fillRect fills exactly its rectangle', () => {
    const region = canvas();
    fillRect(region, 2, 2, 3, 2, BLUE);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const inside = x >= 2 && x < 5 && y >= 2 && y < 4;
        expect(readPixel(region, x, y)).toEqual(inside ? [...BLUE] : [...WHITE]);
      }
    }
  });

});

describe('polyline', () => {

  test('draws both endpoints of a segment', () => {
    const region = canvas();
    polyline(region, [[1, 1], [9, 6]], INK);
    expect(readPixel(region, 1, 1)).toEqual([...INK]);
    expect(readPixel(region, 9, 6)).toEqual([...INK]);
  });

  test('a horizontal segment is a straight run', () => {
    const region = canvas();
    polyline(region, [[2, 4], [7, 4]], INK);
    for (let x = 2; x <= 7; x++) { expect(readPixel(region, x, 4)).toEqual([...INK]); }
    expect(readPixel(region, 1, 4)).toEqual([...WHITE]);
    expect(readPixel(region, 8, 4)).toEqual([...WHITE]);
  });

  test('a single point draws one pixel; an empty list draws nothing', () => {
    const one = canvas();
    polyline(one, [[3, 3]], INK);
    expect(readPixel(one, 3, 3)).toEqual([...INK]);

    const none = canvas();
    polyline(none, [], INK);
    for (let i = 0; i < none.surface.data.length; i += 4) {
      expect(none.surface.data[i]).toBe(255);
    }
  });

  test('a multi-vertex polyline passes through every vertex', () => {
    const region = canvas();
    polyline(region, [[0, 10], [5, 2], [10, 8]], INK);
    expect(readPixel(region, 0, 10)).toEqual([...INK]);
    expect(readPixel(region, 5, 2)).toEqual([...INK]);
    expect(readPixel(region, 10, 8)).toEqual([...INK]);
  });

});

describe('text', () => {

  test("a rendered 'A' matches its glyph pattern pixel-for-pixel", () => {
    const region = canvas();
    text(region, 0, 0, 'A', INK, 1);
    const columns = GLYPHS['A'] ?? [];
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) {
        const inked = (((columns[col] ?? 0) >> row) & 1) === 1;
        expect(readPixel(region, col, row)).toEqual(inked ? [...INK] : [...WHITE]);
      }
    }
  });

  test('scale 2 doubles every font pixel into a 2×2 block', () => {
    const region = fullRegion(makeSurface(24, 16, WHITE));
    text(region, 0, 0, 'A', INK, 2);
    const columns = GLYPHS['A'] ?? [];
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) {
        const inked    = (((columns[col] ?? 0) >> row) & 1) === 1,
              expected = inked ? [...INK] : [...WHITE];
        expect(readPixel(region, 2 * col,     2 * row)).toEqual(expected);
        expect(readPixel(region, 2 * col + 1, 2 * row + 1)).toEqual(expected);
      }
    }
  });

  test('a character without a glyph renders blank without shifting its neighbors', () => {
    const plain = canvas(), accented = canvas();
    text(plain,    0, 0, ' A', INK, 1);
    text(accented, 0, 0, 'éA', INK, 1);
    expect([...accented.surface.data]).toEqual([...plain.surface.data]);
  });

});

describe('subRegion', () => {

  test('translates drawing coordinates', () => {
    const region = canvas();
    const sub    = subRegion(region, 4, 6, 8, 8);
    pixel(sub, 0, 0, INK);
    expect(readPixel(region, 4, 6)).toEqual([...INK]);
  });

  test('clips a child to its parent — drawing outside the sub-region is confined', () => {
    const region = canvas();
    const sub    = subRegion(region, 10, 10, 20, 20);   // asks past the parent edge
    expect(sub.width).toBe(6);
    expect(sub.height).toBe(6);
    fillRect(sub, 0, 0, 100, 100, INK);
    expect(readPixel(region, 9, 9)).toEqual([...WHITE]);
    expect(readPixel(region, 10, 10)).toEqual([...INK]);
    expect(readPixel(region, 15, 15)).toEqual([...INK]);
  });

  test('a sub-region wholly outside the parent degenerates to zero size', () => {
    const sub = subRegion(canvas(), 100, 100, 5, 5);
    expect(sub.width).toBe(0);
    expect(sub.height).toBe(0);
  });

});

describe('upscale', () => {

  test('factor 2 doubles dimensions and replicates each pixel into a 2×2 block', () => {
    const small = makeSurface(2, 1, WHITE);
    pixel(fullRegion(small), 1, 0, BLUE);

    const big    = upscale(small, 2),
          region = fullRegion(big);

    expect(big.width).toBe(4);
    expect(big.height).toBe(2);
    expect(readPixel(region, 0, 0)).toEqual([...WHITE]);
    expect(readPixel(region, 1, 1)).toEqual([...WHITE]);
    expect(readPixel(region, 2, 0)).toEqual([...BLUE]);
    expect(readPixel(region, 3, 1)).toEqual([...BLUE]);
  });

  test('factor 1 is an identical copy, not the same buffer', () => {
    const s = makeSurface(3, 3, BLUE);
    const copy = upscale(s, 1);
    expect([...copy.data]).toEqual([...s.data]);
    expect(copy.data).not.toBe(s.data);
  });

  test('rejects a non-positive or fractional factor', () => {
    expect(() => upscale(makeSurface(1, 1, WHITE), 0)).toThrow(RangeError);
    expect(() => upscale(makeSurface(1, 1, WHITE), 1.5)).toThrow(RangeError);
  });

});
