/**
 * Stochastic property tests for session-start conventions injection.
 *
 * - **stripping is exact.** For any frontmatter block and any body, stripping hands back
 *   the body and nothing of the block; for any text that does not open with a fence, it
 *   hands back the text untouched.
 * - **the mode table is total.** For any source string at all — including ones no host
 *   sends today — `off` never injects, `always` always does, and `startup-only` does
 *   exactly when the source is `startup`.
 *
 * @see ../channels/conventions.js stripFrontmatter
 * @see ../mcp/hooks.js shouldInjectConventions
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { stripFrontmatter } from '../channels/conventions.js';
import { shouldInjectConventions } from '../mcp/hooks.js';

/** One frontmatter line: no line breaks of its own, and never itself a fence. */
const fmLine = fc.string().filter(s => !/[\r\n]/.test(s) && !/^---[ \t]*$/.test(s));

/** A body that does not begin with a blank line, which stripping would rightly consume. */
const body = fc.string().filter(s => !/^[ \t]*\r?\n/.test(s));

const newline = fc.constantFrom('\n', '\r\n');

describe('stripFrontmatter is exact', () => {

  it('returns the body, whatever the block held and whichever line endings it used', () => {
    fc.assert(fc.property(fc.array(fmLine, { maxLength: 6 }), body, newline, fc.nat({ max: 3 }),
      (lines, text, nl, blanks) => {
        const doc = `---${nl}${lines.map(l => `${l}${nl}`).join('')}---${nl}${nl.repeat(blanks)}${text}`;
        expect(stripFrontmatter(doc)).toBe(text);
      }));
  });

  it('leaves text that does not open with a fence untouched', () => {
    fc.assert(fc.property(fc.string().filter(s => !s.replace(String.fromCharCode(0xFEFF), '').startsWith('---')), text => {
      expect(stripFrontmatter(text)).toBe(text);
    }));
  });

  it('leaves an opening fence that never closes untouched', () => {
    fc.assert(fc.property(fc.array(fmLine, { maxLength: 6 }), newline, (lines, nl) => {
      const doc = `---${nl}${lines.join(nl)}`;
      expect(stripFrontmatter(doc)).toBe(doc);
    }));
  });

});

describe('the mode table is total over sources', () => {

  const source = fc.option(fc.oneof(
    fc.constantFrom('startup', 'resume', 'clear', 'compact', 'fork'), fc.string()), { nil: undefined });

  it('off never injects', () => {
    fc.assert(fc.property(source, s => { expect(shouldInjectConventions('off', s)).toBe(false); }));
  });

  it('always always injects', () => {
    fc.assert(fc.property(source, s => { expect(shouldInjectConventions('always', s)).toBe(true); }));
  });

  it('startup-only injects exactly on startup', () => {
    fc.assert(fc.property(source, s => {
      expect(shouldInjectConventions('startup-only', s)).toBe(s === 'startup');
    }));
  });

});
