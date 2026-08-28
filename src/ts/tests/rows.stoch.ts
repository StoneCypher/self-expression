/**
 * Stochastic property tests for the charts/rows.ts renderers.
 *
 * Validates the invariants the exact-string spec cannot fully exercise: every
 * `renderComparison` row's bar/dot track is always exactly `width` cells and every
 * row's label column is uniformly padded, and `renderTileGrid` always preserves one
 * rendered line per input grid row (plus the two-line legend for `'abbr-shade'`).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderComparison, renderTileGrid } from '../charts/rows.js';
import type { ComparisonRow, TileCell } from '../charts/rows.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const labelArb = fc
  .array(fc.constantFrom(...ALPHABET), { minLength: 1, maxLength: 10 })
  .map(chars => chars.join(''));

const positiveValueArb = fc.float({ min: Math.fround(0.01), max: 1000, noNaN: true });
const rowArb: fc.Arbitrary<ComparisonRow> = fc.record({ label: labelArb, value: positiveValueArb });
const rowsArb = fc.array(rowArb, { minLength: 1, maxLength: 8 });
const widthArb = fc.integer({ min: 1, max: 40 });
const formArb = fc.constantFrom<'bar' | 'dot'>('bar', 'dot');

const TRACK_GLYPHS = new Set(['\u{2588}', '\u{2591}', '\u{25CF}']); // █ ░ ●

describe('renderComparison — stochastic invariants', () => {

  it('every row\'s bar/dot track is exactly `width` cells, drawn from the track glyphs', () => {
    fc.assert(
      fc.property(rowsArb, widthArb, formArb, (rows, width, form) => {
        const rendered = renderComparison(rows, width, form);
        const lines = rendered.split('\n');
        const labelWidth = Math.max(...rows.map(r => r.label.length)) + 2;
        expect(lines).toHaveLength(rows.length);
        for (const line of lines) {
          const chars = [...line];
          const track = chars.slice(labelWidth, labelWidth + width);
          expect(track).toHaveLength(width);
          for (const glyph of track) { expect(TRACK_GLYPHS.has(glyph)).toBe(true); }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('every row\'s label column is padded to the same width — the longest label plus two', () => {
    fc.assert(
      fc.property(rowsArb, widthArb, formArb, (rows, width, form) => {
        const rendered = renderComparison(rows, width, form);
        const lines = rendered.split('\n');
        const labelWidth = Math.max(...rows.map(r => r.label.length)) + 2;
        rows.forEach((row, i) => {
          const line = lines[i] ?? '';
          expect([...line].slice(0, labelWidth).join('')).toBe(row.label.padEnd(labelWidth));
        });
      }),
      { numRuns: 200 }
    );
  });

});

const cellArb: fc.Arbitrary<TileCell> = fc.record({
  label: labelArb,
  value: fc.float({ min: 0, max: 100, noNaN: true }),
});
const gridRowArb = fc.array(fc.option(cellArb, { nil: null }), { minLength: 1, maxLength: 5 });
const gridArb = fc.array(gridRowArb, { minLength: 1, maxLength: 5 });

describe('renderTileGrid — stochastic invariants', () => {

  it('abbr-shade preserves row count, plus the fixed two-line legend', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const rendered = renderTileGrid(grid, 'abbr-shade');
        const lines = rendered.split('\n');
        expect(lines).toHaveLength(grid.length + 2);
        expect(lines[grid.length]).toBe('');
        expect(lines[grid.length + 1]).toBe('low \u{2591} \u{2592} \u{2593} \u{2588} high');
      }),
      { numRuns: 200 }
    );
  });

  it('pixel preserves row count exactly, one rendered line per grid row', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const rendered = renderTileGrid(grid, 'pixel');
        const lines = rendered.split('\n');
        expect(lines).toHaveLength(grid.length);
      }),
      { numRuns: 200 }
    );
  });

});
