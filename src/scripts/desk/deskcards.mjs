/**
 * The desk's cards, as files rather than as text to be operated on.
 *
 * Cards used to live as markup inside `desk.html`, which meant adding one was an edit and
 * removing one was surgery — find the section, find its CSS, find its script, cut each out
 * by index. That worked until it did not: an attribute in an unexpected order hid a card
 * from its own deletion, and the JavaScript for three deleted cards outlived them and threw
 * on every load.
 *
 * Here one card is one directory and its assets are the files inside it. Removal is
 * deleting the directory, which cannot half-succeed, and the page is assembled from what
 * is present rather than edited toward what should be. There is no state to drift.
 *
 *     cards/
 *       sankey/
 *         card.json     { "ord": 30 }
 *         card.html     one <section data-card="sankey"> …
 *         card.css      rules this card owns, and nothing else
 *         card.js       a DESK.inits.push(…) builder
 *
 * The directory name is the card's identity. A readable name beats a uuid here for the
 * same reason the whole change is worth making: the thing a human has to reason about
 * should say what it is.
 */

import { readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Asset kinds a card may contribute, each concatenated into its own region of the page. */
export const KINDS = { css: 'card.css', html: 'card.html', js: 'card.js' };

/**
 * Every card in a deck directory, in display order.
 *
 * A directory missing `card.json` is skipped rather than guessed at: a half-written card
 * should stay off the desk until it is finished, not appear in an unpredictable position.
 *
 * @param dir the deck directory
 * @returns rows of `{ id, dir, ord, fixed }`, lowest `ord` first
 *
 * @example
 * listCards('./cards');   // [{ id: 'art', ord: 20, … }, { id: 'sankey', ord: 30, … }]
 */
export function listCards(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const id of readdirSync(dir)) {
    const path = join(dir, id);
    if (!statSync(path).isDirectory()) continue;
    let meta;
    try { meta = JSON.parse(readFileSync(join(path, 'card.json'), 'utf8')); }
    catch { continue; }                       // unfinished or unreadable: not on the desk
    out.push({ id, dir: path, ord: Number(meta.ord) || 0, fixed: !!meta.fixed });
  }
  return out.sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id));
}

/**
 * Concatenate one kind of asset across every card, in display order.
 *
 * A card that does not contribute a kind simply has no such file; absence is normal and
 * silent, which is what lets a markup-only card exist without ceremony.
 *
 * @param dir  the deck directory
 * @param kind a key of {@link KINDS}
 * @returns the joined text, empty when nothing contributes
 *
 * @example
 * render('./cards', 'css');    // every card's styles, ready for the shell's <style>
 */
export function render(dir, kind) {
  if (!Object.hasOwn(KINDS, kind)) throw new TypeError(`unknown asset kind: ${kind}`);
  return listCards(dir).map(c => {
    try { return readFileSync(join(c.dir, KINDS[kind]), 'utf8'); }
    catch { return ''; }
  }).filter(Boolean).join('\n');
}

/**
 * Remove a card and everything it contributed.
 *
 * The whole directory goes at once, so markup, styles and script leave together or not at
 * all — precisely the guarantee that editing the document by hand could not offer.
 *
 * @param dir the deck directory
 * @param id  the card's directory name
 * @returns whether a card was removed; false for an unknown or structural card
 *
 * @example
 * removeCard('./cards', 'sankey');   // true
 * removeCard('./cards', 'inbox');    // false — fixed cards refuse
 */
export function removeCard(dir, id) {
  if (!/^[\w-]+$/.test(id)) return false;     // it becomes a path; keep it a plain name
  const card = listCards(dir).find(c => c.id === id);
  if (!card || card.fixed) return false;
  rmSync(card.dir, { recursive: true, force: true });
  return true;
}

/**
 * Fill a shell document's placeholders with the assembled cards.
 *
 * The shell owns everything structural — head, header, the ask card, the inbox, the core
 * scripts — and carries one comment per region. A card owns nothing but its own files,
 * which is what makes it removable without consequence.
 *
 * Replacements are given as functions so a `$&` or `$'` inside a card's source is treated
 * as text rather than as a replacement pattern.
 *
 * @param shell the shell document text
 * @param dir   the deck directory
 * @returns the assembled page
 *
 * @example
 * assemble(readFileSync(SHELL, 'utf8'), './cards');
 */
export function assemble(shell, dir) {
  return shell.replace('<!--CARD-CSS-->',  () => render(dir, 'css'))
              .replace('<!--CARD-HTML-->', () => render(dir, 'html'))
              .replace('<!--CARD-JS-->',   () => render(dir, 'js'));
}
