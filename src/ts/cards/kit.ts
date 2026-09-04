/**
 * The card kit, loaded from disk and typed for the MCP layer.
 *
 * The kit is plain JavaScript under `src/scripts/desk/cardkit/` — a catalogue of type modules
 * and the two helpers that install one. This module loads those files by dynamic `import()`
 * (which Rollup keeps native in the CJS bundle) and presents them behind a typed surface, so the
 * server can generate a tool description from the catalogue and write cards with the kit's own
 * installer rather than a second copy of it.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * What one card type declares about itself: the question it answers, the shape of its data, and
 * where it sits in the catalogue.
 *
 * @example
 * const meta: CardMeta = { name: 'clock', summary: 'The time, live, in a place.',
 *   shape: '{ tz: string }', category: 'live-and-ambient', defaults: {} };
 */
export interface CardMeta {
  readonly name: string;
  readonly summary: string;
  readonly shape: string;
  readonly category: string;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly contains?: boolean;
}

/**
 * What a type's `build()` hands back: up to four rendered assets, each optional because not
 * every type emits every kind (a data-only type may have no `js` at all).
 *
 * @example
 * const built: CardBuilt = { html: '<section data-card="x"></section>', css: '', js: '', json: {} };
 */
export interface CardBuilt {
  readonly json?: Record<string, unknown>;
  readonly html?: string;
  readonly css?: string;
  readonly js?: string;
}

/**
 * The request to build one card instance: an id, a title, the type's own data shape, and where
 * it sits in reading order.
 *
 * @example
 * const spec: CardSpec = { id: 'tokyo', title: 'Tokyo', data: { tz: 'Asia/Tokyo' }, ord: 20 };
 */
export interface CardSpec {
  readonly id: string;
  readonly title: string;
  readonly data: unknown;
  readonly ord: number;
}

/**
 * One loaded card type: its declared metadata plus the function that turns a spec into rendered
 * assets.
 *
 * @see CardMeta
 * @see CardBuilt
 */
export interface CardTypeModule {
  readonly meta: CardMeta;
  build(spec: CardSpec): CardBuilt;
}

/**
 * One category's entry in the catalogue: the question it answers and the types that answer it,
 * each summarised enough to describe without loading the type itself.
 *
 * @example
 * const group: CategoryGroup = { key: 'geographic', label: 'Geographic', question: 'Where?',
 *   members: [{ name: 'map', summary: 'A place on a map.', shape: '{ lat, lon }', settings: [] }] };
 */
export interface CategoryGroup {
  readonly key: string;
  readonly label: string;
  readonly question: string;
  readonly members: readonly { name: string; summary: string; shape: string; settings: string[] }[];
}

/**
 * One category with only its type *names* — the catalogue at index depth, for a reader who is
 * choosing a category rather than filling in a data shape.
 *
 * @example
 * const row: CategoryIndex = { key: 'geographic', label: 'Geographic', question: 'Where?',
 *   types: ['map', 'globe'] };
 *
 * @see indexCardTypes
 * @see CategoryGroup — the same category at full depth, summaries and shapes included
 */
export interface CategoryIndex {
  readonly key: string;
  readonly label: string;
  readonly question: string;
  readonly types: readonly string[];
}

/**
 * A loaded card kit: every type, grouped by category, plus the two functions that install and
 * check a card — all as they came from the kit itself, so nothing here can drift from it.
 *
 * @see loadKit
 */
export interface CardKit {
  readonly kitDir : string;
  readonly types  : ReadonlyMap<string, CardTypeModule>;
  readonly groups : readonly CategoryGroup[];
  writeCard(mod: CardTypeModule, spec: CardSpec, deck: string): string;
  audit(built: CardBuilt, opts: { contains: boolean }): string[];
}

/**
 * Where the kit sits inside an installed package, relative to the package root.
 *
 * @param root the package root — the directory holding `src/`
 * @returns the kit directory, not checked for existence
 *
 * @example
 * defaultKitDir('/opt/self-expression');   // '/opt/self-expression/src/scripts/desk/cardkit'
 */
export function defaultKitDir(root: string): string {
  return join(root, 'src', 'scripts', 'desk', 'cardkit');
}

/**
 * The first sentence of the `render_card` description: when to reach for a card, not what it does.
 *
 * @see describeKit
 */
export const RENDER_CARD_TRIGGER: string =
  'Draw the answer instead of describing it. When what you are about to say is a comparison, ' +
  'a ranking, a distribution, a schedule, a place, a diagram, or a number against a target — ' +
  'render it as a card on the desk.';

/**
 * The shape of `newcard.mjs`'s exports, as `loadKit` needs them.
 *
 * `writeCard` and `audit` are typed as function-valued properties rather than method
 * signatures: they are plain functions with no `this`, and `loadKit` re-exposes them by
 * reference on `CardKit` — a method signature would carry an implicit `this` that neither
 * function uses, tripping `@typescript-eslint/unbound-method` on the extraction for no reason.
 */
interface NewcardModule {
  catalogue: () => Promise<Map<string, CardTypeModule>>;
  writeCard: (mod: CardTypeModule, spec: CardSpec, deck: string) => string;
  audit: (built: CardBuilt, opts: { contains: boolean }) => string[];
}

/** The shape of `categories.mjs`'s exports, as `loadKit` needs them. */
interface CategoriesModule {
  groupByCategory: (rows: readonly (readonly [string, CardTypeModule])[]) => CategoryGroup[];
}

/**
 * Dynamically import one file out of a kit directory, naming the kit in the error when it is
 * missing rather than letting a bare `ENOENT` reach the caller.
 *
 * @param kitDir the kit directory to import from
 * @param file   the file name within it, e.g. `'newcard.mjs'`
 * @returns the imported module, cast to the shape the caller expects
 *
 * @throws {Error} when `file` does not exist under `kitDir`
 */
async function importKitFile<T>(kitDir: string, file: string): Promise<T> {
  const path = join(kitDir, file);
  if (!existsSync(path)) { throw new Error(`cardkit: ${path} is missing`); }
  const mod: unknown = await import(pathToFileURL(path).href);
  return mod as T;
}

/**
 * Load the kit from a directory: every type module plus its category grouping, computed once at
 * load time so the rest of the server never re-derives it.
 *
 * @param kitDir the kit directory — see {@link defaultKitDir} for the usual one
 * @returns the loaded kit
 *
 * @throws {Error} naming the missing file when `kitDir` does not hold a `newcard.mjs` or
 *   `categories.mjs` — including when `kitDir` itself does not exist
 *
 * @example
 * const kit = await loadKit(defaultKitDir(packageRoot));
 * kit.types.get('clock')?.meta.summary;
 */
export async function loadKit(kitDir: string): Promise<CardKit> {
  const newcard    = await importKitFile<NewcardModule>(kitDir, 'newcard.mjs'),
        categories = await importKitFile<CategoriesModule>(kitDir, 'categories.mjs'),
        types      = await newcard.catalogue(),
        groups     = categories.groupByCategory([...types.entries()]);
  return { kitDir, types, groups, writeCard: newcard.writeCard, audit: newcard.audit };
}

/**
 * The `render_card` tool description, generated from the catalogue so it cannot drift from it:
 * the trigger sentence, then one block per category headed by its question, then one line per
 * type within that category.
 *
 * @param kit a loaded kit, as {@link loadKit} yields
 * @returns the full description text
 *
 * @example
 * describeKit(kit).startsWith(RENDER_CARD_TRIGGER);   // true
 */
export function describeKit(kit: CardKit): string {
  const blocks = kit.groups.map(g =>
    `${g.label} — ${g.question}\n` + g.members.map(m => `- ${m.name} — ${m.summary}`).join('\n'));
  return `${RENDER_CARD_TRIGGER}\n\nOne call: render_card({ type, title, data }). The id and ord are derived; ` +
         `cards land in the answer band and age out unless kept. Types, by the question they answer:\n\n` +
         blocks.join('\n\n');
}

/**
 * Look up the catalogue's category groups, optionally narrowed to one category.
 *
 * @param kit      a loaded kit
 * @param category a category key to narrow to; omit to list every group
 * @returns the matching groups — every group when `category` is omitted, exactly one otherwise
 *
 * @throws {RangeError} when `category` is given but names no group in this kit
 *
 * @example
 * listCardTypes(kit, 'geographic').length;   // 1
 * @example
 * listCardTypes(kit).length === kit.groups.length;   // true
 */
export function listCardTypes(kit: CardKit, category?: string): readonly CategoryGroup[] {
  if (category === undefined) { return kit.groups; }
  const hit = kit.groups.filter(g => g.key === category);
  if (hit.length === 0) { throw new RangeError(`unknown category: ${category}`); }
  return hit;
}

/**
 * Drop every category down to its type names, so the whole catalogue can be offered without
 * spending a reply on it.
 *
 * The full form runs to roughly 45 KB against the real 88-type kit — some 11k tokens for a
 * question usually answered by "which category?". The names alone are a few hundred bytes and
 * are enough to pick one; {@link listCardTypes} with that category then hands back the shapes.
 *
 * @param groups the groups to reduce, as {@link listCardTypes} yields
 * @returns one row per group, in the same order, carrying only `key`, `label`, `question` and
 *   the member names
 *
 * @example
 * indexCardTypes(kit.groups)[0];
 * // { key: 'ranking-and-comparison', label: 'Ranking and comparison',
 * //   question: 'Which is bigger?', types: ['tally'] }
 *
 * @see CategoryIndex
 */
export function indexCardTypes(groups: readonly CategoryGroup[]): readonly CategoryIndex[] {
  return groups.map(g => ({
    key: g.key, label: g.label, question: g.question, types: g.members.map(m => m.name),
  }));
}
