/**
 * The conventions, made portable: the same Markdown a skill-loading host reads from
 * disk, served over MCP to hosts that have no skills at all.
 *
 * Everything else about this server already travels. The tools are MCP tools, the
 * configuration lives in the log database rather than in host config, and onboarding
 * rides the `initialize` handshake's `instructions` string precisely so it reaches hosts
 * that host-native prompting misses. What did **not** travel was the practice: the
 * skills in `skills/<name>/SKILL.md` carry how to write a signature, what the markers
 * mean, and why audio is scarce, and a host that does not load skills gets `express` with no
 * idea what good use of it looks like — a very good structured logger and none of the
 * reason for it.
 *
 * **Resources, not a longer `instructions` string, and the reasoning is the point.**
 * `instructions` is delivered unconditionally to every host on every connection. The
 * conventions run to roughly 90 KB across eight documents; spending that on every
 * handshake would be wasteful on any host and actively wrong on Claude Code, Codex, and
 * Gemini, which already load these exact files as skills — the model would receive the
 * same text twice, from two channels, with no way to tell that they are one source.
 * Resources are pulled on demand and can be listed, which is the shape this actually
 * wants: a host that needs them asks, a host that already has them does not.
 *
 * So `instructions` carries only {@link conventionsPointer} — three sentences naming the
 * resources and telling a host that already loaded the skills to skip them — and the
 * documents themselves are served as resources.
 *
 * **One source, read at runtime.** Nothing here copies the prose. The registry names
 * files that already exist in the package, and {@link readConvention} reads them off
 * disk when asked, so an edit to a skill is served the same day without a build step and
 * a served copy cannot rot away from the file a skill-loading host reads.
 *
 * @see ../mcp/resources.js
 * @see ./onboarding.js — the same `instructions` transport, for the other thing that
 *      must reach every host
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve }   from 'node:path';

/**
 * The URI scheme the convention resources live under.
 *
 * A custom scheme rather than `file://` on purpose: these are documents the server
 * *serves*, and the path they happen to occupy inside an installed package is an
 * implementation detail no client should be invited to depend on.
 */
export const CONVENTION_SCHEME = 'self-expression';

/** One served document: what it is, where it lives, and which skill carries it. */
export interface ConventionDoc {
  /** Stable identifier; the last segment of the resource URI. */
  readonly id          : string;
  /** Short human name, shown in a client's resource list. */
  readonly title       : string;
  /** One line saying what a reader gets from it, for the same list. */
  readonly description : string;
  /** Path segments below the package root; joined per-platform when read. */
  readonly path        : readonly string[];
  /**
   * The skill name a skill-loading host reads this same file as, or `null` when the
   * document is not shipped as a skill. This is what lets the pointer say "if you
   * already have the skill, you already have this" without guessing.
   */
  readonly skill       : string | null;
}

/**
 * Every convention document this server can serve, in reading order: the core practice
 * first, the optional facilities next, the checklist reference last.
 *
 * The order is the order a new reader should take them in, and the registry is the only
 * place the set is enumerated — the pointer, the resource registration, and the tests
 * all derive from it, so adding a document is one entry here and nothing else.
 *
 * Every `path` names a file that already ships in the package (`skills/` and
 * `src/doc_md/reference/` are both in `package.json`'s `files` list). Nothing is copied
 * or generated; see the module note on one source.
 */
export const CONVENTION_DOCS: readonly ConventionDoc[] = [
  { id: 'self-expression', title: 'Self-expression conventions', skill: 'self-expression',
    path: ['skills', 'self-expression', 'SKILL.md'],
    description:
      'The core practice: when the two signatures happen, how the visible line is built, ' +
      'what each channel means, retraction, typed silence, anchoring, and the recording ' +
      'rules. Read this one before using express.' },
  { id: 'party-roster', title: 'Party roster', skill: 'party-roster',
    path: ['skills', 'party-roster', 'SKILL.md'],
    description:
      'Optional flavour for multi-agent dispatch: each subagent gets a face, a name, and ' +
      'a class, used consistently across announcements and reports. Off unless ' +
      'roster.enabled says otherwise.' },
  { id: 'audio-expression', title: 'Audio expression', skill: 'audio-expression',
    path: ['skills', 'audio-expression', 'SKILL.md'],
    description:
      'The scarcity ethos for the voluntary audio facility: what a strike is for, why the ' +
      'budgets are structural rather than aspirational, and when silence is the right ' +
      'answer.' },
  { id: 'dwelling', title: 'The dwelling', skill: 'dwelling',
    path: ['skills', 'dwelling', 'SKILL.md'],
    description:
      'The keepsake dwelling: what belongs in it, what does not, and the consent shape ' +
      'around a directory the user chose.' },
  { id: 'status-checklists', title: 'Status checklists', skill: 'status-checklists',
    path: ['src', 'doc_md', 'reference', 'status-checklists-skill.md'],
    description:
      'How a multi-item status report is written: the fenced block, one emoji marker per ' +
      'line, the summary line that closes it, and when a checklist is the right shape at ' +
      'all.' },
  { id: 'checklist-markers', title: 'Checklist marker vocabulary', skill: null,
    path: ['src', 'doc_md', 'reference', 'markers.md'],
    description:
      'The full marker set with its canonical order — the status markers and the ' +
      'topic/action groups — which is the tiebreaker when counts are equal.' },
  { id: 'checklist-visuals', title: 'Checklist inline visuals', skill: null,
    path: ['src', 'doc_md', 'reference', 'visuals.md'],
    description:
      'The inline visual vocabulary a checklist may carry: bars, sparklines, and the rest, ' +
      'with the rules for when each earns its place.' },
  { id: 'answer-cards', title: 'Answer cards', skill: null,
    path: ['src', 'doc_md', 'reference', 'answer-cards.md'],
    description:
      'When a card is the honest answer and when three numbers are a sentence: the taste ' +
      'channel for render_card, kept apart from the mechanism on purpose.' },
];

/**
 * The resource URI for one document id.
 *
 * @param id the document's registry id; not checked, so the function stays total and
 *           callers that already hold a {@link ConventionDoc} need no narrowing
 *
 * @example
 *   conventionUri('self-expression')   // => 'self-expression://conventions/self-expression'
 */
export function conventionUri(id: string): string {
  return `${CONVENTION_SCHEME}://conventions/${id}`;
}

/**
 * Look up one document by id, or `undefined` for an id the registry does not carry.
 *
 * @example
 *   conventionDoc('dwelling')?.skill   // => 'dwelling'
 *   conventionDoc('vibes')             // => undefined
 */
export function conventionDoc(id: string): ConventionDoc | undefined {
  return CONVENTION_DOCS.find(doc => doc.id === id);
}

/**
 * The file whose presence identifies a directory as this package's root.
 *
 * The core skill rather than `package.json`, deliberately: a `package.json` exists at
 * every level of a dependency tree and finding one proves nothing, while this path
 * exists in exactly one place and is precisely what the search is looking for.
 */
export const ROOT_ANCHOR: readonly string[] = ['skills', 'self-expression', 'SKILL.md'];

/** How many directory levels {@link findPackageRoot} will climb before giving up. */
export const ROOT_SEARCH_DEPTH = 6;

/**
 * The package root at or above `start`, or `null` when no ancestor holds the anchor.
 *
 * A bounded upward walk rather than a fixed relative path, because the same code has to
 * find the files from two very different starting points: `<pkg>/dist` in an installed
 * package, and the repository root under a test runner. A fixed `'..'` is correct for
 * exactly one of those.
 *
 * @param start the directory to begin at; the search includes it
 * @param depth how many levels to climb, counting `start` as the first
 *
 * @example
 *   findPackageRoot('C:/x/node_modules/self-expression/dist')
 *   // => 'C:/x/node_modules/self-expression'
 *   findPackageRoot('C:/tmp')   // => null
 *
 * @see ROOT_ANCHOR
 */
export function findPackageRoot(start: string, depth: number = ROOT_SEARCH_DEPTH): string | null {

  let at = resolve(start);

  for (let level = 0; level < depth; level += 1) {
    if (existsSync(join(at, ...ROOT_ANCHOR))) { return at; }
    const up = dirname(at);
    if (up === at) { return null; }
    at = up;
  }

  return null;

}

/**
 * The package root, resolved from the running bundle's directory.
 *
 * The bundle lives at `dist/cli.cjs`, so the package root is one level up — the same
 * relationship {@link ../claudio/paths.js defaultAssetDir} uses to find the vendored
 * WAVs, and named the same way for the same reason: a caller that knows `__dirname`
 * should not have to search.
 *
 * @param bundleDir the running bundle's directory (`__dirname` in the CJS bundle)
 *
 * @example
 *   packageRoot('C:/x/node_modules/self-expression/dist')
 *   // => 'C:/x/node_modules/self-expression'
 */
export function packageRoot(bundleDir: string): string {
  return resolve(bundleDir, '..');
}

/**
 * The package root for a caller that did not name one: found from the running script
 * first, then from the working directory, then given up on.
 *
 * `argv[1]` is the strong signal — under `npx self-expression mcp` it is the installed
 * `dist/cli.cjs`, whose parent is exactly the root. The working directory is the
 * fallback that makes the test runner work without special-casing tests, since a suite
 * runs from the repository root. Both are searched rather than assumed, so a wrong guess
 * yields `null` instead of a path that does not exist.
 *
 * @param argv1 the running script path; defaults to the real `process.argv[1]`
 * @param cwd   the working directory to fall back to; defaults to the real one
 * @returns the package root, or `null` when neither route finds one — in which case no
 *          convention resources are registered and the pointer is omitted
 *
 * @example
 *   defaultConventionsRoot('C:/x/node_modules/self-expression/dist/cli.cjs', 'C:/elsewhere')
 *   // => 'C:/x/node_modules/self-expression'
 *
 * @see findPackageRoot
 */
export function defaultConventionsRoot(
  argv1 : string | undefined = process.argv[1],
  cwd   : string             = process.cwd(),
): string | null {
  const fromScript = argv1 === undefined || argv1 === '' ? null : findPackageRoot(dirname(argv1));
  return fromScript ?? findPackageRoot(cwd);
}

/**
 * The absolute path one document occupies under `root`.
 *
 * @example
 *   conventionPath('/pkg', CONVENTION_DOCS[0]!)   // => '/pkg/skills/self-expression/SKILL.md'
 */
export function conventionPath(root: string, doc: ConventionDoc): string {
  return join(root, ...doc.path);
}

/**
 * Read one document's text off disk, or `null` when it is not there or cannot be read.
 *
 * `null` rather than a throw, because a missing convention file is a packaging fact, not
 * a request error: the caller's right response is to serve fewer resources, never to
 * fail a handshake. The read is unconditional rather than cached — these files are read
 * on demand, at most a handful of times per session, and a cache would mean an edited
 * skill kept serving yesterday's text.
 *
 * @param root the package root to resolve against
 * @param doc  the registry entry to read
 *
 * @example
 *   readConvention('/pkg', conventionDoc('dwelling')!)?.startsWith('---')   // => true
 */
export function readConvention(root: string, doc: ConventionDoc): string | null {
  try {
    return readFileSync(conventionPath(root, doc), 'utf8');
  } catch {
    return null;
  }
}

/**
 * The documents actually present under `root`, in registry order.
 *
 * Existence is checked once, at registration, so a client's resource list never advertises
 * something a read would fail on. A `null` root — no package root found at all — yields
 * an empty list rather than throwing, which degrades the whole facility to "this server
 * serves no conventions" instead of to "this server would not start".
 *
 * @param root the package root, or `null` when none was found
 *
 * @example
 *   availableConventions('/pkg').map(doc => doc.id)   // => ['self-expression', …]
 *   availableConventions(null)                        // => []
 */
export function availableConventions(root: string | null): readonly ConventionDoc[] {
  if (root === null) { return []; }
  return CONVENTION_DOCS.filter(doc => existsSync(conventionPath(root, doc)));
}

/**
 * The pointer sentence the MCP `instructions` string carries, or `null` when there is
 * nothing to point at.
 *
 * Short on purpose. This rides the handshake on **every** host, including the three that
 * already load these files as skills, so it must cost almost nothing there — and it must
 * actively tell such a host to stop, because the failure mode is the model reading 90 KB
 * it already has and treating two copies of one file as two sources that might disagree.
 * The check it asks the model to make is one the model can genuinely make: it knows
 * whether a skill by that name is loaded.
 *
 * Only the core document is named as the one to read. The rest are listable, and a model
 * that needs the marker vocabulary will find it; leading with all seven would invite
 * reading all seven.
 *
 * @param docs the documents actually available, from {@link availableConventions}
 * @returns the sentence, or `null` when no documents are available to point at
 *
 * @example
 *   conventionsPointer(availableConventions('/pkg'))
 *   // => 'The conventions these tools assume are served as MCP resources (7 documents) …'
 *   conventionsPointer([])   // => null
 *
 * @see ../mcp/server.js buildServer
 */
export function conventionsPointer(docs: readonly ConventionDoc[]): string | null {

  if (docs.length === 0) { return null; }

  const skills = docs.map(doc => doc.skill).filter((name): name is string => name !== null);

  return (
    `The conventions these tools assume are served as MCP resources ` +
    `(${String(docs.length)} document${docs.length === 1 ? '' : 's'}; the core one is ` +
    `${conventionUri('self-expression')}). ` +
    (skills.length === 0 ? '' :
      `If your host already loaded the ${skills.join(' / ')} skill${skills.length === 1 ? '' : 's'}, ` +
      'you have this text already — these resources are those same files, so read nothing ' +
      'and carry on. ') +
    'Otherwise read the core document before using express: the tool schemas say what is ' +
    'accepted, not what good use looks like.'
  );

}
