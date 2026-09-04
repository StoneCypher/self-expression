/**
 * Answer cards: what `render_card` puts on the desk, as opposed to what a person places by hand.
 *
 * An answer card is any card whose `card.json` has an `answer: { at: ISO }` field — written by
 * {@link writeAnswerCard}, never by hand. Its `ord` is one past the highest ord already sitting
 * in the answer band, or `ANSWER_ORD_BASE` when the band is empty — derived from the *maximum*
 * rather than the count, so answers still read newest-last after age-out has thinned the deck
 * and the count has stopped growing. When the band runs out, {@link renumberAnswerCards} packs
 * the survivors back down to `ANSWER_ORD_BASE` in `answer.at` order and the ord is recomputed;
 * an explicit `req.ord` is honoured only if it is inside `[ANSWER_ORD_BASE, ANSWER_ORD_BASE +
 * ANSWER_ORD_SPAN)`, otherwise `RangeError`. Age-out keeps the `keep` newest by `answer.at` and
 * removes the rest, skipping `fixed` (a card the owner has pinned is not an answer any more).
 * Removal is `rmSync(dir, { recursive: true, force: true })` on a dir whose name matched
 * `CARD_ID_PATTERN` — the same guard `deskcards.mjs` `removeCard` uses.
 *
 * @see ./kit.js — the loaded catalogue this module writes through
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CardKit, CardSpec, CardTypeModule } from './kit.js';

/** The first ord an answer card can take. Every hand-placed card sits below this. */
export const ANSWER_ORD_BASE = 1000;

/** How much of the ord space belongs to answers: the band is `[ANSWER_ORD_BASE, ANSWER_ORD_BASE + ANSWER_ORD_SPAN)`. */
export const ANSWER_ORD_SPAN = 1000;

/**
 * What a card id must look like: it becomes a directory name, so it must not be able to become
 * a path. Identical to `newcard.mjs`'s `ID_OK`, kept in sync deliberately rather than imported,
 * since the vendored kit is plain JavaScript this module does not otherwise depend on structurally.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- isolatedDeclarations requires the annotation
export const CARD_ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * One answer card as it sits on disk: its id, its directory, where it reads in the deck, when it
 * was answered, and whether the owner has pinned it against age-out.
 *
 * @example
 * const card: AnswerCard = { id: 'tally-done-2609032215', dir: '/desk/cards/tally-done-2609032215',
 *   ord: 1000, at: '2026-09-03T22:15:00.000Z', fixed: false };
 */
export interface AnswerCard {
  readonly id: string;
  readonly dir: string;
  readonly ord: number;
  readonly at: string;
  readonly fixed: boolean;
}

/**
 * What a caller asks for when it wants an answer drawn: a type from the catalogue, a title, the
 * type's own data shape, and optionally a specific band ord instead of the next free one.
 *
 * @example
 * const req: RenderRequest = { type: 'tally', title: 'Done', data: { value: 3, target: 5 } };
 */
export interface RenderRequest {
  readonly type: string;
  readonly title: string;
  readonly data: unknown;
  readonly ord?: number;
}

/**
 * What {@link writeAnswerCard} hands back: where the new card landed, and which older answers it
 * pushed off the desk in the same call.
 *
 * @example
 * const result: RenderResult = { id: 'tally-done-2609032215', dir: '/desk/cards/tally-done-2609032215',
 *   ord: 1000, agedOut: [] };
 */
export interface RenderResult {
  readonly id: string;
  readonly dir: string;
  readonly ord: number;
  readonly agedOut: readonly string[];
}

/**
 * Turn a title into the id-safe fragment `deriveCardId` builds around: lowercase, non-alphanumeric
 * runs collapsed to a single hyphen, no leading or trailing hyphen.
 *
 * @param title any human-written title
 * @returns a string of only `[a-z0-9-]`, possibly empty when `title` had no alphanumeric characters
 *
 * @example
 * slugTitle('Income vs. Spending — Q3');   // 'income-vs-spending-q3'
 * @example
 * slugTitle('!!!');   // ''
 */
export function slugTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Derive a card id from a type, a title and the moment it is written: a type, a slug of the
 * title, and the minute, joined so the id reads as what it is and sorts roughly by time.
 *
 * The slug is truncated (never the type or the stamp) so the result never exceeds 40 characters
 * — {@link CARD_ID_PATTERN}'s limit — however long `title` is. A title that slugs to nothing
 * (e.g. all punctuation) falls back to `type-stamp` with no doubled hyphen.
 *
 * @param type the card type name, as it appears in the catalogue
 * @param title the card's title
 * @param now the moment the card is written; only the minute is kept
 * @returns an id matching {@link CARD_ID_PATTERN}
 *
 * @example
 * deriveCardId('hexbin', 'Income vs. Spending — Q3', new Date('2026-09-03T22:15:00Z'));
 * // 'hexbin-income-vs-spending-q3-2609032215'
 */
export function deriveCardId(type: string, title: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(2, 12);   // yymmddhhmm
  const room  = 40 - type.length - stamp.length - 2;                     // two hyphens
  const slug  = slugTitle(title).slice(0, Math.max(0, room)).replace(/-+$/, '');
  return slug.length === 0 ? `${type}-${stamp}` : `${type}-${slug}-${stamp}`;
}

/**
 * `deriveCardId`, with room reserved at the end for a numeric collision suffix.
 *
 * Used only when the plain id from {@link deriveCardId} is already taken in the deck — the
 * common, uncontended case never runs this arithmetic at all.
 *
 * @param type the card type name
 * @param title the card's title
 * @param now the moment the card is written
 * @param n the suffix number, 2 and up
 * @returns an id at most 40 characters, still matching {@link CARD_ID_PATTERN}
 */
function deriveCardIdSuffixed(type: string, title: string, now: Date, n: number): string {
  const stamp  = now.toISOString().replace(/[-:T]/g, '').slice(2, 12);
  const suffix = `-${String(n)}`;
  const room   = 40 - type.length - stamp.length - 2 - suffix.length;
  const slug   = slugTitle(title).slice(0, Math.max(0, room)).replace(/-+$/, '');
  const base   = slug.length === 0 ? `${type}-${stamp}` : `${type}-${slug}-${stamp}`;
  return `${base}${suffix}`;
}

/**
 * Read one card directory's `card.json` and pull out the fields an answer card needs, narrowing
 * from `JSON.parse`'s `unknown` by hand rather than trusting a cast — a directory that is not a
 * card, or a card that is not an answer, should be skipped rather than crash the listing.
 *
 * @param dir a card directory
 * @returns the parsed fields, or `undefined` when `dir` holds no readable `card.json`, or the
 *   card is not an answer card (no string `answer.at`)
 */
function readAnswerMeta(dir: string): { ord: number; at: string; fixed: boolean } | undefined {
  let meta: unknown;
  try { meta = JSON.parse(readFileSync(join(dir, 'card.json'), 'utf8')); }
  catch { return undefined; }
  if (typeof meta !== 'object' || meta === null) return undefined;
  if (!('answer' in meta)) return undefined;

  const answer = meta.answer;
  if (typeof answer !== 'object' || answer === null || !('at' in answer) || typeof answer.at !== 'string') {
    return undefined;
  }
  const ord   = 'ord' in meta && typeof meta.ord === 'number' ? meta.ord : 0;
  const fixed = 'fixed' in meta && meta.fixed === true;
  return { ord, at: answer.at, fixed };
}

/**
 * Every answer card in a deck, oldest first.
 *
 * A missing deck directory reads as empty rather than an error — a desk with no answers yet is
 * a normal state, not a fault. A directory that is not a readable answer card (no `card.json`,
 * or one with no string `answer.at`) is skipped rather than guessed at, the same discipline
 * `listCards` in `deskcards.mjs` uses for unfinished cards.
 *
 * @param deck the deck directory to read
 * @returns rows of `{ id, dir, ord, at, fixed }`, sorted by `at` ascending
 *
 * @example
 * listAnswerCards('/desk/cards').map(c => c.id);   // ['tally-done-2609032215', …]
 */
export function listAnswerCards(deck: string): AnswerCard[] {
  let ids: string[];
  try { ids = readdirSync(deck); }
  catch { return []; }

  const rows: AnswerCard[] = [];
  for (const id of ids) {
    const dir  = join(deck, id);
    const meta = readAnswerMeta(dir);
    if (meta === undefined) continue;
    rows.push({ id, dir, ord: meta.ord, at: meta.at, fixed: meta.fixed });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/** True for an ord inside `[ANSWER_ORD_BASE, ANSWER_ORD_BASE + ANSWER_ORD_SPAN)`. */
function inBand(ord: number): boolean {
  return ord >= ANSWER_ORD_BASE && ord < ANSWER_ORD_BASE + ANSWER_ORD_SPAN;
}

/**
 * The ord the next answer card should take: one past the highest ord already in the band, so
 * answers read newest-last within their band however many of them have since aged out.
 *
 * Derived from the maximum rather than the count on purpose. Age-out caps the count at `keep`,
 * so a count-derived ord stops moving on the `keep`-th render and every answer after it lands
 * on the same number — at which point the desk's `id.localeCompare` tiebreak decides the order
 * and the newest card can read anywhere in the band. Ords outside the band are ignored rather
 * than counted: only the answer band is this function's to allocate from.
 *
 * @param deck the deck directory to read
 * @returns an ord — `ANSWER_ORD_BASE` for a deck with nothing in the band, otherwise one past
 *   the highest ord in it. That is exactly `ANSWER_ORD_BASE + ANSWER_ORD_SPAN` once the band is
 *   exhausted (a card already sits on its last ord), which {@link writeAnswerCard} answers by
 *   renumbering rather than by spilling into hand-placed territory
 *
 * @example
 * nextAnswerOrd('/desk/cards');   // 1000, for an empty or answer-free deck
 * @example
 * // a deck whose only surviving answer sits at 1004, its older siblings aged out
 * nextAnswerOrd('/desk/cards');   // 1005, not 1001
 *
 * @see renumberAnswerCards — what reclaims the band when this reaches its end
 */
export function nextAnswerOrd(deck: string): number {
  const ords = listAnswerCards(deck).map(c => c.ord).filter(inBand);
  if (ords.length === 0) { return ANSWER_ORD_BASE; }
  return ords.reduce((hi, ord) => (ord > hi ? ord : hi), ANSWER_ORD_BASE) + 1;
}

/**
 * Pack every answer card back down to the bottom of the band, in `answer.at` order, so a desk
 * that has exhausted the band can keep rendering without the ords losing their meaning.
 *
 * Reachable only after `ANSWER_ORD_SPAN` renders on one desk, since {@link nextAnswerOrd} hands
 * out one ord per render and never reuses one. Fixed cards are renumbered too: pinning takes a
 * card out of age-out's accounting, but it still occupies an ord in the band, so leaving it
 * behind would strand exactly the cards the owner cared about above the repacked ones. Relative
 * order is preserved — the survivors keep reading oldest-first — and only `ord` is touched, so
 * `answer`, `fixed`, `spec` and everything else in a `card.json` travel through unchanged.
 *
 * A card whose `card.json` has become unreadable between the listing and the rewrite is skipped
 * rather than guessed at, the same discipline {@link listAnswerCards} uses.
 *
 * @param deck the deck directory to renumber
 * @returns how many `card.json` files were actually rewritten; a card already sitting on its new
 *   ord is left alone, so a deck that needs nothing returns 0
 *
 * @example
 * // a deck whose three answers sit at 1997, 1998 and 1999
 * renumberAnswerCards('/desk/cards');   // 3, and they now sit at 1000, 1001 and 1002
 *
 * @see nextAnswerOrd — what goes back to handing out ords once this has run
 */
export function renumberAnswerCards(deck: string): number {
  let rewritten = 0;

  for (const [index, card] of listAnswerCards(deck).entries()) {
    const ord = ANSWER_ORD_BASE + index;
    if (card.ord === ord) { continue; }

    const path = join(card.dir, 'card.json');
    let meta: unknown;
    try { meta = JSON.parse(readFileSync(path, 'utf8')); }
    catch { continue; }
    if (typeof meta !== 'object' || meta === null) { continue; }

    writeFileSync(path, JSON.stringify({ ...(meta as Record<string, unknown>), ord }, null, 2) + '\n');
    rewritten += 1;
  }

  return rewritten;
}

/**
 * The ord one render should land on: the caller's own when it gave one, otherwise the next free
 * ord in the band — reclaiming the band first when it has run out.
 *
 * An explicit `req.ord` is passed straight through, out of range or not, so {@link writeAnswerCard}
 * still refuses it by name: a caller that named a number wants that number or an error, not a
 * silent substitution. Only the derived path renumbers, and only when it has to, so the rewrite
 * costs at most `keep` plus the pinned cards once per `ANSWER_ORD_SPAN` renders.
 *
 * @param deck the deck directory the render is landing in
 * @param req  the render request, read only for its optional explicit `ord`
 * @returns the ord to write, not yet checked against the band
 */
function ordForRender(deck: string, req: RenderRequest): number {
  if (req.ord !== undefined) { return req.ord; }

  const next = nextAnswerOrd(deck);
  if (inBand(next)) { return next; }

  renumberAnswerCards(deck);
  return nextAnswerOrd(deck);
}

/**
 * Render one answer card onto the desk: pick its id and ord, build and audit it through the
 * kit, write it, stamp it as an answer, then age the deck out to `keep`.
 *
 * The build runs twice by design — once here to audit before anything touches disk, once again
 * inside `kit.writeCard` — so a card that fails its audit never gets a directory at all. The
 * `card.json` rewrite that adds the `answer` stamp is a second write after `kit.writeCard`
 * finishes (which itself writes `card.json` last, after html/css/js): between those two writes
 * the card briefly exists on disk without its answer stamp, so if this process died in that
 * exact window the card would be found and inert rather than counted as an answer. That window
 * is one `writeFileSync` wide and considered acceptable — the alternative is duplicating
 * `kit.writeCard`'s own file-writing here to fold the stamp into its single write, which would
 * make this module responsible for the deck's on-disk format instead of the kit.
 *
 * When `req.ord` is omitted and the band has been used up — the 1000th render on one desk —
 * {@link renumberAnswerCards} packs the surviving answers back down to `ANSWER_ORD_BASE` and the
 * ord is recomputed, so the band is a ring rather than a quota. An explicit `req.ord` never
 * triggers that and is still refused by name when it is outside the band.
 *
 * @param kit a loaded card kit, as {@link loadKit} yields
 * @param deck the deck directory to write into
 * @param req the type, title, data and optional explicit ord to render
 * @param keep how many answers to keep after this write; {@link ageOutAnswers} removes the rest
 * @param now the moment of the render; defaults to the current time
 * @returns the id, directory and ord written, plus the ids of any answers this write aged out
 *
 * @throws {RangeError} when `req.type` names no type in `kit`, or `req.ord` falls outside
 *   `[ANSWER_ORD_BASE, ANSWER_ORD_BASE + ANSWER_ORD_SPAN)` — or, for a derived ord, when even a
 *   renumbering left no room, which takes more than `ANSWER_ORD_SPAN` pinned cards on one desk
 * @throws {Error} when the type's own output fails `kit.audit`, naming the complaints
 *
 * @example
 * writeAnswerCard(kit, '/desk/cards', { type: 'tally', title: 'Done', data: { value: 3, target: 5 } }, 8);
 *
 * @see renumberAnswerCards — the band reclamation this triggers when the band runs out
 */
export function writeAnswerCard(
  kit: CardKit, deck: string, req: RenderRequest, keep: number, now: Date = new Date(),
): RenderResult {
  const mod: CardTypeModule | undefined = kit.types.get(req.type);
  if (mod === undefined) { throw new RangeError(`unknown card type: ${req.type}`); }

  const ord = ordForRender(deck, req);
  if (!inBand(ord)) {
    throw new RangeError(
      `ord ${String(ord)} is outside the answer band [${String(ANSWER_ORD_BASE)}, ` +
      `${String(ANSWER_ORD_BASE + ANSWER_ORD_SPAN)})`);
  }

  let id = deriveCardId(req.type, req.title, now);
  for (let n = 2; existsSync(join(deck, id)); n += 1) {
    id = deriveCardIdSuffixed(req.type, req.title, now, n);
  }

  const spec: CardSpec = { id, title: req.title, data: req.data, ord };
  const built = mod.build(spec);
  const bad   = kit.audit(built, { contains: mod.meta.contains === true });
  if (bad.length > 0) {
    throw new Error(`refusing to render ${req.type}: ${bad.join('; ')}`);
  }

  mkdirSync(deck, { recursive: true });
  const dir = kit.writeCard(mod, spec, deck);

  const raw: unknown = JSON.parse(readFileSync(join(dir, 'card.json'), 'utf8'));
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`writeAnswerCard: ${join(dir, 'card.json')} did not parse to an object`);
  }
  const stamped = { ...(raw as Record<string, unknown>), answer: { at: now.toISOString() } };
  writeFileSync(join(dir, 'card.json'), JSON.stringify(stamped, null, 2) + '\n');

  const agedOut = ageOutAnswers(deck, keep);
  return { id, dir, ord, agedOut };
}

/**
 * Remove all but the `keep` newest answer cards, never touching a `fixed` card or a card that
 * was never an answer (no `answer.at`) in the first place.
 *
 * A `fixed` answer is excluded from the count entirely rather than merely protected — pinning
 * a card takes it out of the newest-`keep` accounting the same way it takes it out of the
 * "answer" role conceptually (see the module doc). Removal is gated on {@link CARD_ID_PATTERN},
 * the same guard `deskcards.mjs`'s `removeCard` uses, so a directory name that could not have
 * been produced by this module is never handed to `rmSync`.
 *
 * @param deck the deck directory to age out
 * @param keep how many of the newest non-fixed answers to keep; a negative or zero value keeps
 *   none, but a fixed answer still survives
 * @returns the ids removed, oldest first
 *
 * @example
 * ageOutAnswers('/desk/cards', 8);   // ['tally-old-2609020900']
 */
export function ageOutAnswers(deck: string, keep: number): string[] {
  const rows   = listAnswerCards(deck).filter(c => !c.fixed);
  const doomed = rows.slice(0, Math.max(0, rows.length - keep));

  const removed: string[] = [];
  for (const c of doomed) {
    if (CARD_ID_PATTERN.test(c.id)) {
      rmSync(c.dir, { recursive: true, force: true });
      removed.push(c.id);
    }
  }
  return removed;
}
