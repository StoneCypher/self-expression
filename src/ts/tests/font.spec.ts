import {
  FIRST_CODE, GLYPHS, GLYPH_HEIGHT, GLYPH_SPACING, GLYPH_WIDTH, LAST_CODE,
  glyphColumns, measureText,
} from '../raster/font.js';

/** Renders one glyph's bits as 7 strings of '#'/'.', for readable pattern pins. */
function pattern(columns: readonly number[]): string[] {
  const rows: string[] = [];
  for (let row = 0; row < GLYPH_HEIGHT; row++) {
    rows.push(columns.map(column => ((column >> row) & 1) === 1 ? '#' : '.').join(''));
  }
  return rows;
}

describe('GLYPHS coverage', () => {

  test('covers every printable ASCII character, 95 in all', () => {
    expect(Object.keys(GLYPHS)).toHaveLength(95);
    for (let code = FIRST_CODE; code <= LAST_CODE; code++) {
      expect(GLYPHS[String.fromCharCode(code)]).toBeDefined();
    }
  });

  test('every glyph is exactly five column bytes, each within seven bits', () => {
    for (const columns of Object.values(GLYPHS)) {
      expect(columns).toHaveLength(GLYPH_WIDTH);
      for (const column of columns) {
        expect(Number.isInteger(column)).toBe(true);
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThanOrEqual(0x7f);
      }
    }
  });

  test('space is entirely blank; no other glyph is', () => {
    expect(GLYPHS[' ']).toEqual([0, 0, 0, 0, 0]);
    for (const [character, columns] of Object.entries(GLYPHS)) {
      if (character !== ' ') {
        expect(columns.some(column => column !== 0)).toBe(true);
      }
    }
  });

});

describe('exact glyph patterns', () => {

  test("'A' renders its pinned 5×7 pattern", () => {
    expect(pattern(GLYPHS['A'] ?? [])).toEqual([
      '.###.',
      '#...#',
      '#...#',
      '#...#',
      '#####',
      '#...#',
      '#...#',
    ]);
  });

  test("'1' renders its pinned 5×7 pattern", () => {
    expect(pattern(GLYPHS['1'] ?? [])).toEqual([
      '..#..',
      '.##..',
      '..#..',
      '..#..',
      '..#..',
      '..#..',
      '.###.',
    ]);
  });

});

describe('glyphColumns', () => {

  test('returns the table entry for a covered character', () => {
    expect(glyphColumns('A')).toEqual(GLYPHS['A']);
  });

  test.each(['é', '€', '\n', '\t'])('returns null for %j, which has no glyph', (character) => {
    expect(glyphColumns(character)).toBeNull();
  });

});

describe('measureText', () => {

  test('an empty string is zero wide', () => {
    expect(measureText('')).toBe(0);
  });

  test('one character is one glyph cell with no trailing spacing', () => {
    expect(measureText('A')).toBe(GLYPH_WIDTH);
  });

  test('n characters are n cells plus n-1 spacing columns', () => {
    expect(measureText('days')).toBe(4 * GLYPH_WIDTH + 3 * GLYPH_SPACING);
  });

  test('characters without a glyph still occupy a full cell', () => {
    expect(measureText('aé')).toBe(measureText('ab'));
  });

});
