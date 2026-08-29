/**
 * Unit tests for serving the conventions over MCP: the registry against the files that
 * actually ship, root discovery from both the installed and the checked-out layouts, the
 * pointer that rides `instructions`, and the resources that carry the text.
 *
 * The reads are deliberately against the **real** packaged files rather than fixtures.
 * The claim under test is "the served copy is the same file a skill-loading host reads",
 * and a fixture would be a second copy — which is the exact failure the whole design
 * exists to avoid.
 *
 * @see ../channels/conventions.js
 * @see ../mcp/resources.js
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }                 from 'node:os';
import { join, sep }              from 'node:path';
import { describe, test, expect } from 'vitest';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import {
  CONVENTION_DOCS, CONVENTION_SCHEME, ROOT_ANCHOR, availableConventions, conventionDoc,
  conventionPath, conventionUri, conventionsPointer, defaultConventionsRoot,
  findPackageRoot, packageRoot, readConvention,
} from '../channels/conventions.js';
import type { ConventionDoc } from '../channels/conventions.js';
import {
  CONVENTION_IDS, CONVENTION_MIME, missingConventionBody, registerConventionResources,
} from '../mcp/resources.js';
import { buildServer, serverInstructions } from '../mcp/server.js';
import { handleOnboard } from '../mcp/tools.js';

/** The repository root, which is also the package root under the test runner. */
const ROOT = findPackageRoot(process.cwd());

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-conventions-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** A throwaway directory with no anchor in it or above it we control. */
function withEmptyDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-noroot-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('the registry — one entry per shipped file, and no prose of its own', () => {

  test('ids are unique', () => {
    expect(new Set(CONVENTION_IDS).size).toBe(CONVENTION_DOCS.length);
  });

  test('every document names a file that actually ships', () => {
    expect(ROOT).not.toBeNull();
    for (const doc of CONVENTION_DOCS) {
      expect(existsSync(conventionPath(ROOT ?? '', doc)), `${doc.id} is missing`).toBe(true);
    }
  });

  test('every path is under skills/ or the packaged reference directory', () => {
    for (const doc of CONVENTION_DOCS) {
      const head = doc.path[0];
      expect(head === 'skills' || head === 'src', `${doc.id} lives somewhere unpackaged`).toBe(true);
    }
  });

  test('each skill-backed document names the skill directory it is read from', () => {
    for (const doc of CONVENTION_DOCS.filter(d => d.skill !== null && d.path[0] === 'skills')) {
      expect(doc.path[1]).toBe(doc.skill);
    }
  });

  test('the core conventions lead, because that is the one to read first', () => {
    expect(CONVENTION_IDS[0]).toBe('self-expression');
  });

  test('every document carries a title and a description worth listing', () => {
    for (const doc of CONVENTION_DOCS) {
      expect(doc.title.length, doc.id).toBeGreaterThan(0);
      expect(doc.description.length, doc.id).toBeGreaterThan(20);
    }
  });

  test('lookup finds a known id and refuses an invented one', () => {
    expect(conventionDoc('self-expression')?.skill).toBe('self-expression');
    expect(conventionDoc('vibes')).toBeUndefined();
  });

  test('the uri is the scheme plus the id, and round-trips back to its document', () => {
    for (const doc of CONVENTION_DOCS) {
      const uri = conventionUri(doc.id);
      expect(uri.startsWith(`${CONVENTION_SCHEME}://conventions/`)).toBe(true);
      expect(conventionDoc(uri.split('/').pop() ?? '')).toEqual(doc);
    }
  });

});

describe('finding the package root — the installed layout and the checked-out one', () => {

  test('the anchor is the core skill, not a package.json that exists everywhere', () => {
    expect([...ROOT_ANCHOR]).toEqual(['skills', 'self-expression', 'SKILL.md']);
  });

  test('a directory holding the anchor is itself the root', () => {
    expect(findPackageRoot(ROOT ?? '')).toBe(ROOT);
  });

  test('the search climbs — dist/ finds the package above it', () => {
    expect(findPackageRoot(join(ROOT ?? '', 'dist'))).toBe(ROOT);
    expect(findPackageRoot(join(ROOT ?? '', 'src', 'ts', 'mcp'))).toBe(ROOT);
  });

  test('it gives up rather than climbing forever', () => withEmptyDir(dir => {
    expect(findPackageRoot(dir)).toBeNull();
  }));

  test('the depth bound is real: one level short of the anchor finds nothing', () => {
    expect(findPackageRoot(join(ROOT ?? '', 'src', 'ts', 'mcp'), 1)).toBeNull();
    expect(findPackageRoot(join(ROOT ?? '', 'src', 'ts', 'mcp'), 4)).toBe(ROOT);
  });

  test('packageRoot is the bundle-dir shortcut, one level up and no search', () => {
    expect(packageRoot(join('C:', 'x', 'self-expression', 'dist')))
      .toBe(join('C:', 'x', 'self-expression'));
  });

  test('the default prefers the running script and falls back to the working directory', () => {
    expect(defaultConventionsRoot(join(ROOT ?? '', 'dist', 'cli.cjs'), tmpdir())).toBe(ROOT);
    expect(defaultConventionsRoot(undefined, ROOT ?? '')).toBe(ROOT);
    expect(defaultConventionsRoot('', ROOT ?? '')).toBe(ROOT);
  });

  test('neither route finding one is null, not a throw', () => withEmptyDir(dir => {
    expect(defaultConventionsRoot(join(dir, 'nothing.cjs'), dir)).toBeNull();
  }));

});

describe('reading — the served copy is the file, never a copy of it', () => {

  test('each document reads back non-empty from the real package', () => {
    for (const doc of CONVENTION_DOCS) {
      expect((readConvention(ROOT ?? '', doc) ?? '').length, doc.id).toBeGreaterThan(500);
    }
  });

  test('a skill document is served with its frontmatter, exactly as the file has it', () => {
    const doc  = conventionDoc('self-expression'),
          body = doc === undefined ? '' : readConvention(ROOT ?? '', doc) ?? '';
    // Line endings are whatever the checkout has; the claim is that the frontmatter is
    // present and intact, not that the file was normalized on its way out.
    expect(body.startsWith('---')).toBe(true);
    expect(body.split(/\r?\n/)[1]).toBe('name: self-expression');
  });

  test('the core document really carries the conventions a hookless host would lack', () => {
    const doc  = conventionDoc('self-expression'),
          body = doc === undefined ? '' : readConvention(ROOT ?? '', doc) ?? '';
    for (const needle of ['signature', 'express', 'retract', 'anchor', 'silence']) {
      expect(body.toLowerCase(), needle).toContain(needle);
    }
  });

  test('the marker reference really carries the marker vocabulary', () => {
    const doc  = conventionDoc('checklist-markers'),
          body = doc === undefined ? '' : readConvention(ROOT ?? '', doc) ?? '';
    expect(body).toContain('canonical order');
    expect(body).toContain('✅');
  });

  test('a missing file reads as null rather than throwing', () => {
    const absent: ConventionDoc = {
      id: 'nope', title: 'Nope', description: 'x', skill: null, path: ['no', 'such.md'] };
    expect(readConvention(ROOT ?? '', absent)).toBeNull();
  });

  test('availableConventions lists what exists, and nothing at all without a root', () => {
    expect(availableConventions(ROOT).map(d => d.id)).toEqual([...CONVENTION_IDS]);
    expect(availableConventions(null)).toEqual([]);
  });

  test('a root with no files present yields an empty list, not a broken one', () => withEmptyDir(dir => {
    expect(availableConventions(dir)).toEqual([]);
  }));

  test('the path is built from segments, so it is right on this platform', () => {
    const doc = conventionDoc('dwelling');
    expect(doc).toBeDefined();
    if (doc !== undefined) {
      expect(conventionPath('root', doc)).toBe(['root', ...doc.path].join(sep));
    }
  });

});

describe('the pointer — short, and it tells a skill-having host to stop', () => {

  test('it names the count and the core resource uri', () => {
    const line = conventionsPointer(availableConventions(ROOT)) ?? '';
    expect(line).toContain(String(CONVENTION_DOCS.length));
    expect(line).toContain(conventionUri('self-expression'));
  });

  test('it names the skills, so a host that loaded them can recognise itself', () => {
    const line = conventionsPointer(availableConventions(ROOT)) ?? '';
    for (const doc of CONVENTION_DOCS.filter(d => d.skill !== null)) {
      expect(line, doc.id).toContain(doc.skill ?? '');
    }
  });

  test('it says explicitly not to read them twice', () => {
    const line = conventionsPointer(availableConventions(ROOT)) ?? '';
    expect(line).toContain('already');
    expect(line).toContain('read nothing');
  });

  test('it stays short — this is paid for on every handshake on every host', () => {
    expect((conventionsPointer(availableConventions(ROOT)) ?? '').length).toBeLessThan(700);
  });

  test('it carries no conventions text of its own — the resources are the text', () => {
    const line = conventionsPointer(availableConventions(ROOT)) ?? '',
          core = readConvention(ROOT ?? '', conventionDoc('self-expression') as ConventionDoc) ?? '';
    expect(line.length).toBeLessThan(core.length / 20);
  });

  test('nothing available means no pointer at all, rather than a dangling one', () => {
    expect(conventionsPointer([])).toBeNull();
  });

  test('a set with no skills omits the skip clause instead of naming an empty list', () => {
    const bare: ConventionDoc[] = [
      { id: 'checklist-markers', title: 't', description: 'd', skill: null, path: ['x.md'] }];
    const full = conventionsPointer(availableConventions(ROOT)) ?? '',
          line = conventionsPointer(bare) ?? '';
    expect(full).toContain('read nothing');    // the clause exists when skills do…
    expect(line).not.toContain('read nothing');// …and is absent, whole, when they do not
    expect(line).toContain('1 document');
    expect(line).toContain(conventionUri('self-expression'));
  });

});

describe('serverInstructions — two independent things on one transport', () => {

  test('a fresh store carries onboarding and the pointer, in that order', () => withStore(s => {
    const line = serverInstructions(s, availableConventions(ROOT)) ?? '';
    expect(line).toContain('Onboarding pending');
    expect(line).toContain(conventionUri('self-expression'));
    expect(line.indexOf('Onboarding pending')).toBeLessThan(line.indexOf(CONVENTION_SCHEME));
  }));

  test('a settled store carries only the pointer', () => withStore(s => {
    handleOnboard(s, { op: 'skip' });
    const line = serverInstructions(s, availableConventions(ROOT)) ?? '';
    expect(line).not.toContain('Onboarding pending');
    expect(line).toContain(conventionUri('self-expression'));
  }));

  test('no conventions found leaves onboarding alone', () => withStore(s => {
    const line = serverInstructions(s, []) ?? '';
    expect(line).toContain('Onboarding pending');
    expect(line).not.toContain(CONVENTION_SCHEME);
  }));

  test('neither half present is null, not an empty string', () => withStore(s => {
    handleOnboard(s, { op: 'skip' });
    expect(serverInstructions(s, [])).toBeNull();
  }));

});

describe('registering the resources', () => {

  /** A server stub capturing what would have been registered. */
  function capture(): { calls: { name: string; uri: string; config: Record<string, unknown>;
                                 read: (uri: URL) => { contents: { uri: string; mimeType?: string;
                                                                   text?: string }[] } }[];
                        server: Parameters<typeof registerConventionResources>[0] } {
    const calls: { name: string; uri: string; config: Record<string, unknown>;
                   read: (uri: URL) => { contents: { uri: string; mimeType?: string;
                                                     text?: string }[] } }[] = [];
    const stub = {
      registerResource: (name: string, uri: string, config: Record<string, unknown>,
                         read: unknown): void => {
        calls.push({ name, uri, config,
                     read: read as (u: URL) => { contents: { uri: string; mimeType?: string;
                                                             text?: string }[] } });
      },
    };
    return { calls, server: stub as unknown as Parameters<typeof registerConventionResources>[0] };
  }

  test('one resource per available document, at its own uri', () => {
    const { calls, server } = capture();
    expect(registerConventionResources(server, ROOT)).toBe(CONVENTION_DOCS.length);
    expect(calls.map(c => c.uri)).toEqual(CONVENTION_IDS.map(conventionUri));
  });

  test('each carries its title, description, and markdown type', () => {
    const { calls, server } = capture();
    registerConventionResources(server, ROOT);
    for (const [index, call] of calls.entries()) {
      expect(call.config['title']).toBe(CONVENTION_DOCS[index]?.title);
      expect(call.config['description']).toBe(CONVENTION_DOCS[index]?.description);
      expect(call.config['mimeType']).toBe(CONVENTION_MIME);
    }
  });

  test('reading one hands back the real file, not a summary of it', () => {
    const { calls, server } = capture();
    registerConventionResources(server, ROOT);
    const core = calls.find(c => c.uri === conventionUri('self-expression'));
    expect(core).toBeDefined();
    const uri  = conventionUri('self-expression'),
          body = core?.read(new URL(uri)).contents[0];
    expect(body?.uri).toBe(uri);
    expect(body?.mimeType).toBe(CONVENTION_MIME);
    expect(body?.text)
      .toBe(readConvention(ROOT ?? '', conventionDoc('self-expression') as ConventionDoc));
  });

  test('no root registers nothing, and the server still builds', () => withStore(s => {
    const { calls, server } = capture();
    expect(registerConventionResources(server, null)).toBe(0);
    expect(calls).toEqual([]);
    expect(() => buildServer(s, '0.0.0', null, null)).not.toThrow();
  }));

  test('a root with none of the files present registers nothing', () => withEmptyDir(dir => {
    const { server } = capture();
    expect(registerConventionResources(server, dir)).toBe(0);
  }));

  test('a file that vanishes after registration answers, and says the install is incomplete', () => {
    const absent: ConventionDoc = {
      id: 'nope', title: 'Nope', description: 'x', skill: null, path: ['no', 'such.md'] };
    const body = missingConventionBody(absent);
    expect(body).toContain('unknown');
    expect(body).toContain('no/such.md');
    expect(body).toContain('incomplete');
  });

  test('buildServer registers them against a real root without throwing', () => withStore(s => {
    expect(() => buildServer(s, '0.0.0', null, ROOT)).not.toThrow();
    expect(() => buildServer(s, '0.0.0', null)).not.toThrow();
  }));

});
