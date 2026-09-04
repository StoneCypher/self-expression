/**
 * Stochastic property tests for the drawing surface.
 *
 * The load-bearing invariant: no drawing operation, with any coordinates
 * whatsoever, ever writes a byte outside its region — which is what lets a
 * panel be handed a region and trusted not to scribble on its neighbor.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  INK, WHITE,
  fillRect, fullRegion, hline, makeSurface, pixel, polyline, rect, subRegion, text, upscale, vline,
} from '../raster/surface.js';
import type { Region } from '../raster/surface.js';

const coordinateArb = fc.integer({ min: -40, max: 40 });
const spanArb       = fc.integer({ min: -10, max: 40 });

/** A 20×20 surface with a random interior sub-region to draw through. */
const regionSetupArb = fc.record({
  x      : fc.integer({ min: 0, max: 12 }),
  y      : fc.integer({ min: 0, max: 12 }),
  width  : fc.integer({ min: 1, max: 8 }),
  height : fc.integer({ min: 1, max: 8 }),
});

/** Asserts every pixel outside `region` on its surface is still white. */
function assertOutsideUntouched(region: Region): void {
  const { surface } = region;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const inside = x >= region.x && x < region.x + region.width
                  && y >= region.y && y < region.y + region.height;
      if (!inside) {
        const i = 4 * (y * surface.width + x);
        expect([...surface.data.subarray(i, i + 4)]).toEqual([...WHITE]);
      }
    }
  }
}

describe('region confinement — stochastic invariants', () => {

  it('pixel never writes outside its region', () => {
    fc.assert(
      fc.property(regionSetupArb, coordinateArb, coordinateArb, (setup, x, y) => {
        const region = subRegion(fullRegion(makeSurface(20, 20, WHITE)), setup.x, setup.y, setup.width, setup.height);
        pixel(region, x, y, INK);
        assertOutsideUntouched(region);
      }),
      { numRuns: 150 }
    );
  }, 30_000);

  it('hline, vline, fillRect, and rect never write outside their region', () => {
    fc.assert(
      fc.property(regionSetupArb, coordinateArb, coordinateArb, spanArb, spanArb, (setup, x, y, w, h) => {
        const region = subRegion(fullRegion(makeSurface(20, 20, WHITE)), setup.x, setup.y, setup.width, setup.height);
        hline(region, x, y, w, INK);
        vline(region, x, y, h, INK);
        fillRect(region, x, y, w, h, INK);
        rect(region, x, y, w, h, INK);
        assertOutsideUntouched(region);
      }),
      { numRuns: 150 }
    );
  }, 30_000);

  it('polyline never writes outside its region, whatever its vertices', () => {
    fc.assert(
      fc.property(
        regionSetupArb,
        fc.array(fc.tuple(coordinateArb, coordinateArb), { minLength: 0, maxLength: 6 }),
        (setup, vertices) => {
          const region = subRegion(fullRegion(makeSurface(20, 20, WHITE)), setup.x, setup.y, setup.width, setup.height);
          polyline(region, vertices, INK);
          assertOutsideUntouched(region);
        }
      ),
      { numRuns: 150 }
    );
  }, 30_000);

  it('polyline always terminates, even with non-finite vertices among arbitrary floats', () => {
    // The load-bearing regression: a non-finite coordinate used to make the Bresenham
    // walk's `cx === tx && cy === ty` termination test never true, hanging forever. Every
    // generated vertex list — NaN, ±Infinity, and huge finite floats all included — must
    // finish drawing (each segment capped at |dx|+|dy|+1 steps) and stay confined.
    const floatArb  = fc.double({ noNaN: false, noDefaultInfinity: false, min: -1e6, max: 1e6 });
    const vertexArb = fc.tuple(floatArb, floatArb);
    fc.assert(
      fc.property(
        regionSetupArb,
        fc.array(vertexArb, { minLength: 0, maxLength: 8 }),
        (setup, vertices) => {
          const region = subRegion(fullRegion(makeSurface(20, 20, WHITE)), setup.x, setup.y, setup.width, setup.height);
          polyline(region, vertices, INK);
          assertOutsideUntouched(region);
        }
      ),
      { numRuns: 200 }
    );
  }, 30_000);

  it('text never writes outside its region, whatever the string and position', () => {
    fc.assert(
      fc.property(
        regionSetupArb, coordinateArb, coordinateArb,
        fc.string({ maxLength: 6 }),
        fc.integer({ min: 1, max: 3 }),
        (setup, x, y, content, scale) => {
          const region = subRegion(fullRegion(makeSurface(20, 20, WHITE)), setup.x, setup.y, setup.width, setup.height);
          text(region, x, y, content, INK, scale);
          assertOutsideUntouched(region);
        }
      ),
      { numRuns: 150 }
    );
  }, 30_000);

});

describe('upscale — stochastic invariants', () => {

  it('every physical pixel equals its logical source pixel', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 3 }),
        fc.infiniteStream(fc.integer({ min: 0, max: 255 })),
        (width, height, factor, bytes) => {

          const surface  = makeSurface(width, height, WHITE);
          const iterator = bytes[Symbol.iterator]();
          for (let i = 0; i < surface.data.length; i++) {
            surface.data[i] = iterator.next().value ?? 0;
          }

          const big = upscale(surface, factor);
          expect(big.width).toBe(width * factor);
          expect(big.height).toBe(height * factor);

          for (let y = 0; y < big.height; y++) {
            for (let x = 0; x < big.width; x++) {
              const from = 4 * (Math.floor(y / factor) * width + Math.floor(x / factor)),
                    to   = 4 * (y * big.width + x);
              expect([...big.data.subarray(to, to + 4)])
                .toEqual([...surface.data.subarray(from, from + 4)]);
            }
          }

        }
      ),
      { numRuns: 60 }
    );
  });

});
