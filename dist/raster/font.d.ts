/**
 * A vendored 5×7 bitmap font covering printable ASCII — pure data, no drawing.
 *
 * The PNG renderer has no font stack, so text comes from bit patterns: the same
 * class of column-packed 5×7 font every oscilloscope and BIOS uses. Each glyph is
 * five column bytes; in each byte, bit 0 is the top row and bit 6 the bottom, so
 * `(column >> row) & 1` answers "is this pixel inked". Codes outside 32–126 have
 * no pattern and render as blank space rather than throwing — a chart label must
 * never be the reason a render fails.
 *
 * @see ./surface.js — `text()` blits these patterns onto a surface
 * @see ../../superpowers/spec/2026-08-27-png-history-design.md
 */
/** Width of every glyph cell in pixels, excluding inter-glyph spacing. */
export declare const GLYPH_WIDTH = 5;
/** Height of every glyph cell in pixels. */
export declare const GLYPH_HEIGHT = 7;
/** Blank columns between adjacent glyphs. */
export declare const GLYPH_SPACING = 1;
/** Character code of the first glyph in the table (space). */
export declare const FIRST_CODE = 32;
/** Character code of the last glyph in the table (tilde). */
export declare const LAST_CODE = 126;
/**
 * Every printable-ASCII glyph's five column bytes, keyed by the character itself.
 *
 * @example
 *   GLYPHS['A']  // => [0x7e, 0x11, 0x11, 0x11, 0x7e]
 *   GLYPHS['€']  // => undefined — outside printable ASCII, drawn as blank
 *
 * @see glyphColumns
 */
export declare const GLYPHS: Readonly<Record<string, readonly number[]>>;
/**
 * The column bytes for one character, or `null` when the character has no glyph.
 *
 * Exists beside {@link GLYPHS} so drawing code gets an explicit "no pattern" answer
 * instead of an `undefined` property read.
 *
 * @example
 *   glyphColumns('A')  // => [0x7e, 0x11, 0x11, 0x11, 0x7e]
 *   glyphColumns('é')  // => null
 */
export declare function glyphColumns(character: string): readonly number[] | null;
/**
 * The width in pixels a string occupies at scale 1: five columns per character
 * plus one spacing column between adjacent characters. An empty string is 0 wide.
 *
 * Characters without a glyph still occupy a full cell — they render blank, but
 * their neighbours must not shift.
 *
 * @example
 *   measureText('')      // => 0
 *   measureText('A')     // => 5
 *   measureText('days')  // => 23
 */
export declare function measureText(text: string): number;
//# sourceMappingURL=font.d.ts.map