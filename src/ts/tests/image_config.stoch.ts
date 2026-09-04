/**
 * Stochastic property tests for the two image-config rules that exist to stop a
 * model-callable `configure` from pointing this facility somewhere it should not go:
 * which environment variable may be named, and which endpoint may be dialled.
 *
 * Both are allow-rules with a denylist inside them, and a denylist is exactly the kind
 * of thing that passes its own examples and fails on the case nobody listed. So the
 * invariants here are stated over generated names and generated addresses rather than
 * over a table: **nothing accepted is ever on the denylist**, everything accepted is
 * shaped like a credential's name, and an accepted endpoint is always inside one of the
 * private ranges — the last one checked against a CIDR arithmetic written the other way
 * round from the implementation's octet comparisons.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  CREDENTIAL_ENV_ALLOWED_PREFIXES, CREDENTIAL_ENV_ALLOWED_SUFFIXES,
  CREDENTIAL_ENV_DENIED_PREFIXES, CREDENTIAL_ENV_DENYLIST, CREDENTIAL_ENV_NAME_PATTERN,
  credentialEnvVarAllowed, credentialEnvVarProblem, isLoopbackOrPrivateHost,
  localBaseUrlProblem,
} from '../imagery/config.js';

/**
 * Names from every population that matters: the denylist itself, well-formed names,
 * names built from a plausible head and an arbitrary tail, and free garbage.
 */
const arbName: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...CREDENTIAL_ENV_DENYLIST),
  fc.constantFrom(...CREDENTIAL_ENV_DENIED_PREFIXES).chain(prefix =>
    fc.stringMatching(/^[A-Z]{2,10}_KEY$/).map(rest => `${prefix}${rest}`)),
  fc.stringMatching(/^[A-Z][A-Z0-9_]{2,24}$/),
  fc.tuple(fc.stringMatching(/^[A-Z]{3,10}$/),
           fc.constantFrom('_API_KEY', '_KEY', '_TOKEN', '_VALUE', '_PATH', ''))
    .map(([head, tail]) => `${head}${tail}`),
  fc.string({ maxLength: 24 }),
);

/** The four octets of an arbitrary IPv4 address. */
const arbIpv4: fc.Arbitrary<[number, number, number, number]> = fc.tuple(
  fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }),
);

/** One IPv4 address as the 32-bit number the CIDR ranges are actually defined over. */
function asInt(octets: readonly number[]): number {
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return a * 16_777_216 + b * 65_536 + c * 256 + d;
}

/**
 * The private and loopback ranges, written as CIDR bounds rather than as octet
 * comparisons — deliberately a different formulation from the implementation's, so the
 * property is an independent statement of RFC 1918 plus 127/8 and not a restatement of
 * the code it checks.
 */
const PRIVATE_RANGES: readonly (readonly [number, number])[] = [
  [asInt([10, 0, 0, 0]),      asInt([10, 255, 255, 255])],
  [asInt([172, 16, 0, 0]),    asInt([172, 31, 255, 255])],
  [asInt([192, 168, 0, 0]),   asInt([192, 168, 255, 255])],
  [asInt([127, 0, 0, 0]),     asInt([127, 255, 255, 255])],
];

describe('which variable names may be named', () => {

  it('nothing the denylist covers is ever accepted, however it was generated', () => {
    fc.assert(fc.property(arbName, (name) => {
      if (credentialEnvVarAllowed(name)) {
        const trimmed = name.trim();
        expect(CREDENTIAL_ENV_DENYLIST).not.toContain(trimmed);
        expect(CREDENTIAL_ENV_DENIED_PREFIXES.some(p => trimmed.startsWith(p))).toBe(false);
      }
    }));
  });

  it('every accepted name is shaped like an environment variable name', () => {
    fc.assert(fc.property(arbName, (name) => {
      if (credentialEnvVarAllowed(name)) {
        expect(CREDENTIAL_ENV_NAME_PATTERN.test(name.trim())).toBe(true);
      }
    }));
  });

  it('every accepted name reads as a credential, by ending or by scope', () => {
    fc.assert(fc.property(arbName, (name) => {
      if (credentialEnvVarAllowed(name)) {
        const trimmed = name.trim();
        expect(CREDENTIAL_ENV_ALLOWED_SUFFIXES.some(s => trimmed.endsWith(s))
            || CREDENTIAL_ENV_ALLOWED_PREFIXES.some(p => trimmed.startsWith(p))).toBe(true);
      }
    }));
  });

  it('a refusal always explains itself rather than saying no', () => {
    fc.assert(fc.property(arbName, (name) => {
      const problem = credentialEnvVarProblem(name);
      if (problem !== null) { expect(problem.length).toBeGreaterThan(30); }
    }));
  });

  it('surrounding whitespace never changes the answer', () => {
    fc.assert(fc.property(arbName, (name) => {
      expect(credentialEnvVarAllowed(`  ${name}\n`)).toBe(credentialEnvVarAllowed(name));
    }));
  });

});

describe('which endpoints may be dialled', () => {

  it('an accepted IPv4 endpoint always sits inside a private or loopback range', () => {
    fc.assert(fc.property(arbIpv4, (octets) => {
      const host     = octets.join('.'),
            accepted = localBaseUrlProblem(`http://${host}:7860`) === null,
            value    = asInt(octets);
      expect(accepted).toBe(PRIVATE_RANGES.some(([low, high]) => value >= low && value <= high));
    }));
  });

  it('a named host is never accepted, because a name is not a place', () => {
    fc.assert(fc.property(fc.stringMatching(/^[a-z]{3,10}(\.[a-z]{2,6}){1,2}$/), (host) => {
      fc.pre(!host.endsWith('.localhost'));
      expect(localBaseUrlProblem(`https://${host}`)).not.toBeNull();
      expect(isLoopbackOrPrivateHost(host)).toBe(false);
    }));
  });

  it('the port, path, and query never decide the answer — only the host does', () => {
    fc.assert(fc.property(arbIpv4, fc.integer({ min: 1, max: 65_535 }),
      fc.stringMatching(/^[a-z]{0,10}$/), (octets, port, path) => {
        const host = octets.join('.');
        expect(localBaseUrlProblem(`http://${host}:${String(port)}/${path}?x=1`) === null)
          .toBe(isLoopbackOrPrivateHost(host));
      }));
  });

  it('no scheme but http and https is ever accepted', () => {
    fc.assert(fc.property(fc.constantFrom('ftp', 'file', 'ws', 'gopher', 'data'), (scheme) => {
      expect(localBaseUrlProblem(`${scheme}://127.0.0.1:7860`)).not.toBeNull();
    }));
  });

});
