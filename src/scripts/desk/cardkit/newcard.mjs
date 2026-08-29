/**
 * Put a card on the desk from a type and some data.
 *
 * This is the piece that makes a catalogue a catalogue. Without it there are seventeen modules
 * that can each describe a card and no way to get one onto a desk, which is a library rather
 * than a workshop.
 *
 * A card instance stays exactly what it was before any of this existed — a directory of four
 * plain files — so nothing downstream had to change: the server still assembles the deck by
 * reading it, dismissal is still one `rmSync`, and a card written by hand sits beside a
 * generated one without either knowing.
 *
 *     node newcard.mjs <type> <id> [--title T] [--ord N] [--data file.json] [--deck dir]
 *     node newcard.mjs list
 *     node newcard.mjs show <type>
 *
 * @example
 * node newcard.mjs clock desk-clock --title "Tokyo" --data tokyo.json --ord 20
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath }  from 'node:url';

const HERE  = dirname(fileURLToPath(import.meta.url));
const TYPES = join(HERE, 'types');
const DECK  = join(HERE, '..', 'cards');

/** A card id becomes a directory name, so it must not be able to become a path. */
const ID_OK = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Every type in the catalogue, loaded.
 *
 * Files beginning with `_` are shared internals rather than types, and a module that fails to
 * load is reported and skipped rather than taking the whole catalogue down — one broken type
 * should not stop you making a card of a different one.
 *
 * @returns a map of name to module
 *
 * @example
 * (await catalogue()).get('clock').meta.summary;
 */
export async function catalogue() {
  const out = new Map();
  for (const file of readdirSync(TYPES)) {
    if (file.startsWith('_') || !file.endsWith('.mjs')) continue;
    const name = file.slice(0, -4);
    try {
      const mod = await import(new URL(`./types/${file}`, import.meta.url));
      if (typeof mod.build === 'function') out.set(name, mod);
      else console.error(`${name}: no build(), skipped`);
    } catch (e) {
      console.error(`${name}: failed to load — ${e.message}`);
    }
  }
  return out;
}

/**
 * Write one card instance into a deck directory.
 *
 * The four files are written together, and `card.json` is written LAST on purpose: the server
 * treats a directory without it as unfinished and leaves it off the desk, so a card can never
 * appear half-built even if this process dies mid-write.
 *
 * @param mod  a loaded type module
 * @param spec `{ id, title, data, ord }`
 * @param deck the deck directory to write into
 * @returns the directory written
 *
 * @throws {TypeError} when the id could become a path rather than a name
 *
 * @example
 * writeCard(clockMod, { id: 'tokyo', title: 'Tokyo', data: { tz: 'Asia/Tokyo' }, ord: 20 }, DECK);
 */
export function writeCard(mod, spec, deck) {
  if (!ID_OK.test(spec.id)) {
    throw new TypeError(`bad card id: ${spec.id} — lowercase letters, digits and hyphens only`);
  }
  const built = mod.build({ id: spec.id, title: spec.title, data: spec.data, ord: spec.ord });
  const dir   = join(deck, spec.id);
  mkdirSync(dir, { recursive: true });

  for (const [file, body] of [['card.html', built.html], ['card.css', built.css],
                              ['card.js', built.js]]) {
    writeFileSync(join(dir, file), body ?? '');
  }
  const meta = typeof built.json === 'object' && built.json !== null ? built.json : {};
  writeFileSync(join(dir, 'card.json'),
                JSON.stringify({ ord: spec.ord, type: mod.meta?.name, ...meta }, null, 2) + '\n');
  return dir;
}

/**
 * Refuse to write a card whose emitted code would break the desk.
 *
 * The whole deck's scripts are concatenated into ONE inline block, so a single modern-syntax
 * token in one card is a parse error that blanks every card on the page — which has happened.
 * Checking here rather than trusting each type means a card written by a future hand is held to
 * the same bar as one written tonight.
 *
 * @param built the `{ html, css, js }` a type produced
 * @returns a list of complaints, empty when the card is safe to install
 *
 * @example
 * audit({ js: 'var f = () => 1;' });   // ['js: contains an arrow function']
 */
/**
 * Build one card inside another, with an id that cannot collide.
 *
 * A container that renders two `pie`s would otherwise hand both children the same `data-card`,
 * and `CK.card` resolves by `querySelector` — so the first would paint twice and the second would
 * be markup nobody ever draws into. Namespacing by the parent's id makes that impossible rather
 * than unlikely.
 *
 * The child's assets come back separately because the parent owns where they go: its markup is
 * nested into the parent's section, while its CSS and JS are concatenated at the top level exactly
 * as a standalone card's would be. Nothing about a child card is different from a card — that is
 * the property worth keeping, because it means every type is nestable without knowing it is.
 *
 * @param mod    the child's type module
 * @param parent the containing card's id
 * @param slot   a name for this child within the parent, unique among its siblings
 * @param spec   `{ title, data, ord }` for the child
 * @returns `{ id, html, css, js, json }`
 *
 * @throws {TypeError} when the composed id would not be a plain name
 *
 * @example
 * const a = nest(pieMod, 'dash', 'left',  { title: 'spend', data: spend });
 * const b = nest(pieMod, 'dash', 'right', { title: 'plan',  data: plan  });
 * // ids 'dash--left' and 'dash--right'; two pies, no collision
 */
export function nest(mod, parent, slot, spec = {}) {
  const id = `${parent}--${slot}`;
  if (!ID_OK.test(id)) throw new TypeError(`bad nested card id: ${id}`);
  const built = mod.build({ id, title: spec.title ?? slot, data: spec.data, ord: spec.ord ?? 0 });
  return { id, html: built.html ?? '', css: built.css ?? '', js: built.js ?? '',
           json: built.json ?? {} };
}

export function audit(built, opts = {}) {
  const bad = [];
  const js  = built.js ?? '', css = built.css ?? '', html = built.html ?? '';

  if (/=>/.test(js))            bad.push('js: contains an arrow function');
  if (/\?\./.test(js))          bad.push('js: contains optional chaining');
  if (/`/.test(js))             bad.push('js: contains a backtick');
  if (/^\s*(const|let)\s/m.test(js)) bad.push('js: declares const/let at the top level');

  /* Every byte below 0x20 that is not tab, LF or CR. Compared numerically rather than matched
     against a character class, because writing the class is how the class gets corrupted —
     seven separate incidents in one evening, one of them inside the warning about it. */
  for (const [what, text] of [['js', js], ['css', css], ['html', html]]) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
        bad.push(`${what}: control character ${c} at offset ${i}`);
        break;
      }
    }
  }

  /* A container may hold many sections; everything else may hold exactly one. Either way no id
     may appear twice, because `CK.card` resolves by `querySelector` and a repeat is dead markup. */
  const sections = (html.match(/<section\b/g) ?? []).length;
  if (opts.contains === true) {
    if (sections < 1) bad.push('html: declares contains but emits no <section>');
  } else if (sections !== 1) {
    bad.push(`html: expected exactly one <section>, found ${sections}`);
  }
  const ids = [...html.matchAll(/data-card="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) bad.push(`html: duplicate data-card ids — ${ids.join(', ')}`);

  if (/prefers-color-scheme/.test(css)) bad.push('css: keys off prefers-color-scheme');

  return bad;
}

/* ── the command line ──────────────────────────────────────────────────────────────────── */

/* Only when run directly. Without this guard, `import { writeCard } from './newcard.mjs'` runs the
   whole CLI as a side effect of the import — which is exactly what happened the first time another
   script reused `writeCard`, printing the full catalogue in the middle of its own output. A module
   that does something merely because it was loaded is a module that cannot be reused. */
const RUN = process.argv[1] !== undefined &&
             fileURLToPath(import.meta.url) === resolve(process.argv[1]);

const argv = RUN ? process.argv.slice(2) : ['--not-the-entry-point'];
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
};

if (!RUN) {
  /* imported for its exports; do nothing */
} else if (argv[0] === 'list' || argv.length === 0) {
  const cat = await catalogue();
  console.log(`${cat.size} card types\n`);
  /* Sorted by name explicitly: the default comparator stringifies each entry, and an entry here
     is [name, module] — stringifying a module throws rather than sorting. */
  for (const [name, mod] of [...cat].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${name.padEnd(12)} ${mod.meta?.summary ?? ''}`);
  }
} else if (argv[0] === 'show') {
  const mod = (await catalogue()).get(argv[1]);
  if (!mod) { console.error(`unknown type: ${argv[1]}`); process.exit(1); }
  console.log(`${mod.meta.name} — ${mod.meta.summary}`);
  console.log(`data:     ${typeof mod.meta.shape === 'string'
    ? mod.meta.shape : JSON.stringify(mod.meta.shape)}`);
  console.log(`settings: ${JSON.stringify(mod.meta.defaults ?? {}, null, 2)}`);
} else {
  const [type, id] = argv;
  const mod = (await catalogue()).get(type);
  if (!mod) { console.error(`unknown type: ${type} — try: node newcard.mjs list`); process.exit(1); }

  const dataFile = flag('data', null);
  const spec = {
    id,
    title: flag('title', id),
    ord:   Number(flag('ord', 50)),
    data:  dataFile === null ? undefined : JSON.parse(readFileSync(dataFile, 'utf8')),
  };

  const complaints = audit(mod.build({ ...spec }), { contains: mod.meta?.contains === true });
  if (complaints.length) {
    console.error(`refusing to install ${id}:`);
    for (const c of complaints) console.error(`  ${c}`);
    process.exit(1);
  }

  const deck = flag('deck', DECK);
  if (!existsSync(deck)) mkdirSync(deck, { recursive: true });
  console.log(`wrote ${writeCard(mod, spec, deck)}`);
}
