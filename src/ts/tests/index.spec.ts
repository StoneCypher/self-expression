/**
 * Unit tests for the package's top-level barrel (`src/ts/index.ts`).
 *
 * Nothing else in the suite imports through `../index.js` — every other spec reaches
 * into the module that defines a symbol directly. That leaves the barrel's own
 * re-export wiring unguarded: a typo'd `export *`, a deleted `export { … } from`, or a
 * renamed symbol that silently drops out of the public surface would pass every other
 * test in the suite. This file imports through the barrel itself and checks that the
 * package's advertised public API is actually reachable from it, with the shape a
 * caller depends on.
 */

import * as pkg from '../index.js';

describe('the package barrel exports its documented public surface', () => {

  test('the stub functions are exported and callable', () => {
    expect(typeof pkg.double).toBe('function');
    expect(pkg.double(3)).toBe(6);
    expect(typeof pkg.unhandled_external).toBe('function');
  });

  test('a representative symbol from each re-exported module group is reachable', () => {
    // charts/index.js
    expect(typeof pkg.absoluteIndex).toBe('function');
    expect(Array.isArray(pkg.EIGHTHS)).toBe(true);
    expect(typeof pkg.renderFsl).toBe('function');
    // diagrams/index.js
    expect(typeof pkg.parseFsl).toBe('function');
    // raster/index.js
    expect(typeof pkg.encodePng).toBe('function');
    expect(Buffer.isBuffer(pkg.PNG_SIGNATURE)).toBe(true);
    expect([...pkg.PNG_SIGNATURE]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test('unhandled_internal is not re-exported — the barrel is a curated surface, not a dump', () => {
    expect((pkg as Record<string, unknown>)['unhandled_internal']).toBeUndefined();
  });

});
