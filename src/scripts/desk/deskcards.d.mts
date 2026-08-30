/**
 * Types for `deskcards.mjs`, so the tests and any TypeScript caller see its contract.
 *
 * Hand-written rather than emitted: the module is deliberately plain ESM that runs under
 * `node` with no build step, which is the property that lets the desk server be started
 * and killed without installing anything. This file is the one place that has to be kept
 * in step with it by hand; the module is four functions, and the tests exercise the real
 * code rather than these declarations, so drift shows up as a failing test.
 *
 * @see ./deskcards.mjs
 */

/** The asset kinds a card may contribute, one file each. */
export type CardKind = 'css' | 'html' | 'js';

/** One card on the desk: a directory, and what its `card.json` says about it. */
export interface Card {
  /** The directory name, which is the card's identity everywhere else. */
  id: string;
  /** The card directory's path, ready to join a file name onto. */
  dir: string;
  /** Display order; lower sits higher on the desk. Missing or unparsable reads as 0. */
  ord: number;
  /** Structural cards refuse deletion — the shell, not the deck, is where they belong. */
  fixed: boolean;
}

/** File name per asset kind: `card.css`, `card.html`, `card.js`. */
export declare const KINDS: Readonly<Record<CardKind, string>>;

/** Every card in a deck directory, lowest `ord` first, ties broken by id. */
export declare function listCards(dir: string): Card[];

/** One kind of asset concatenated across every card, in display order. */
export declare function render(dir: string, kind: CardKind): string;

/** Delete a card's whole directory; false for an unknown, unsafe, or fixed id. */
export declare function removeCard(dir: string, id: string): boolean;

/** Fill a shell document's three card placeholders from a deck directory. */
export declare function assemble(shell: string, dir: string): string;
