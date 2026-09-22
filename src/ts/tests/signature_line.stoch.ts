import * as fc from 'fast-check';

import { renderSignatureLine, parseSignatureLine, sameSignatureText } from '../channels/signature_line.js';
import { DELTAS } from '../channels/vocabulary.js';

/** Signature text: non-empty, single-line, no backticks, and not starting with a space. */
const text = fc.stringMatching(/^[a-z;,.' ]{0,60}$/).map(s => `x${s}`.trimEnd());

const parts = fc.record({
  tsLocal      : fc.option(fc.constantFrom('9:14 am PDT', '12:03 pm UTC', '11:59 pm CEST'), { nil: null }),
  delta        : fc.option(fc.constantFrom(...DELTAS), { nil: null }),
  showDelta    : fc.boolean(),
  uncertain    : fc.boolean(),
  face         : fc.option(fc.constantFrom('🙂', '😬', '🤔', '😑'), { nil: null }),
  contextEmoji : fc.option(fc.constantFrom('🧭', '⛈️', '🌫️ 📐'), { nil: null }),
  cctype       : fc.option(fc.constantFrom('feat', 'fix', 'docs', 'test'), { nil: null }),
  text,
});

describe('signature line stochastic', () => {

  test('every rendered line parses, and its text survives the round trip', () => {
    fc.assert(fc.property(parts, p => {
      const parsed = parseSignatureLine(renderSignatureLine(p));
      expect(parsed).not.toBeNull();
      expect(sameSignatureText(parsed?.text ?? '', p.text)).toBe(true);
      expect(parsed?.stamp).toBe(p.tsLocal ?? '--:--');
    }), { numRuns: 500 });
  });

  test('a rendered line is always exactly one line', () => {
    fc.assert(fc.property(parts, p => {
      expect(renderSignatureLine(p)).not.toContain('\n');
    }), { numRuns: 200 });
  });

  test('the arrow appears exactly when a delta is present and shown', () => {
    fc.assert(fc.property(parts, p => {
      const line  = renderSignatureLine(p),
            arrow = /[⬆⬇➡]/u.test(line);
      expect(arrow).toBe(p.showDelta && p.delta !== null);
    }), { numRuns: 300 });
  });

});
