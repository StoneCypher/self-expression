/**
 * Stochastic property tests for serving the conventions.
 *
 * Two properties, each a claim about every input rather than one:
 *
 * - **the root search is sound and bounded.** Any path under the real package finds the
 *   real root; any path outside it finds nothing, however deep — and the depth bound is
 *   honoured rather than approximated;
 * - **the pointer stays a pointer.** For any subset of the registry, it names the count
 *   and the core resource, names every skill in the subset, and never grows into the
 *   text it points at.
 *
 * @see ../channels/conventions.js
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }               from 'node:os';
import { join }                 from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  CONVENTION_DOCS, ROOT_ANCHOR, conventionDoc, conventionUri, conventionsPointer,
  findPackageRoot, readConvention,
} from '../channels/conventions.js';
import type { ConventionDoc } from '../channels/conventions.js';

/** The repository root, which is also the package root under the test runner. */
const ROOT = findPackageRoot(process.cwd()) ?? '';

/** Directory segments that exist somewhere under the package, for building real paths. */
const SEGMENTS = ['src', 'ts', 'channels', 'mcp', 'tests', 'skills', 'dist', 'assets'];

describe('the root search is sound, and bounded', () => {

  it('any real directory under the package finds the package root', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(...SEGMENTS), { maxLength: 4 }),
      segments => {
        // The depth bound has to cover the walk back up, which is what makes it a bound
        // rather than a hard-coded relative path.
        expect(findPackageRoot(join(ROOT, ...segments), segments.length + 1)).toBe(ROOT);
      }));
  });

  it('a path outside the package finds nothing, at any depth', () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-conv-stoch-'));
    try {
      fc.assert(fc.property(fc.integer({ min: 1, max: 12 }), depth => {
        expect(findPackageRoot(dir, depth)).toBeNull();
      }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a depth too small to reach the anchor finds nothing — the bound is real', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(...SEGMENTS), { minLength: 1, maxLength: 4 }),
      segments => {
        expect(findPackageRoot(join(ROOT, ...segments), segments.length)).toBeNull();
      }));
  });

  it('the anchor is what is being found: the root always holds it', () => {
    expect(findPackageRoot(join(ROOT, ...ROOT_ANCHOR.slice(0, -1)))).toBe(ROOT);
  });

});

describe('the pointer stays a pointer, for any subset of the registry', () => {

  const subsetArb: fc.Arbitrary<ConventionDoc[]> =
    fc.subarray([...CONVENTION_DOCS], { minLength: 1 });

  it('it names how many documents there are', () => {
    fc.assert(fc.property(subsetArb, docs => {
      expect(conventionsPointer(docs) ?? '').toContain(String(docs.length));
    }));
  });

  it('it always points at the core document, whatever else is in the set', () => {
    fc.assert(fc.property(subsetArb, docs => {
      expect(conventionsPointer(docs) ?? '').toContain(conventionUri('self-expression'));
    }));
  });

  it('every skill in the set is named, so a host can recognise what it already has', () => {
    fc.assert(fc.property(subsetArb, docs => {
      const line = conventionsPointer(docs) ?? '';
      for (const doc of docs) {
        if (doc.skill !== null) { expect(line).toContain(doc.skill); }
      }
    }));
  });

  it('a set with no skills in it never claims a host already loaded one', () => {
    // 'read nothing' is the tail of the skip clause, so its absence is the whole clause's
    // absence — asserting on a phrase the pointer never uses would prove nothing.
    fc.assert(fc.property(
      fc.subarray([...CONVENTION_DOCS].filter(d => d.skill === null), { minLength: 1 }),
      docs => { expect(conventionsPointer(docs) ?? '').not.toContain('read nothing'); }));
  });

  it('a set with any skill in it always carries the skip clause', () => {
    fc.assert(fc.property(
      fc.subarray([...CONVENTION_DOCS].filter(d => d.skill !== null), { minLength: 1 }),
      docs => { expect(conventionsPointer(docs) ?? '').toContain('read nothing'); }));
  });

  it('it never grows into the text it points at', () => {
    const core = readConvention(ROOT, conventionDoc('self-expression') as ConventionDoc) ?? '';
    fc.assert(fc.property(subsetArb, docs => {
      expect((conventionsPointer(docs) ?? '').length).toBeLessThan(core.length / 20);
    }));
  });

  it('the empty set is no pointer at all, never a pointer to nothing', () => {
    expect(conventionsPointer([])).toBeNull();
  });

});

describe('uris round-trip', () => {

  it('every registry id survives being turned into a uri and looked back up', () => {
    fc.assert(fc.property(fc.constantFrom(...CONVENTION_DOCS.map(d => d.id)), id => {
      const uri = conventionUri(id);
      expect(conventionDoc(uri.split('/').pop() ?? '')?.id).toBe(id);
    }));
  });

  it('an id the registry never had looks up to nothing, whatever it is', () => {
    const known = new Set(CONVENTION_DOCS.map(d => d.id));
    fc.assert(fc.property(fc.string(), id => {
      if (known.has(id)) { return; }
      expect(conventionDoc(id)).toBeUndefined();
    }));
  });

});
