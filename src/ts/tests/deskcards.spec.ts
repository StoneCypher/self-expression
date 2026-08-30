/**
 * Unit tests for the desk's card deck (`src/scripts/desk/deskcards.mjs`).
 *
 * Every test builds a real deck on disk and calls the real module against it: the
 * mechanism's entire claim is that the filesystem is the only state, so a mocked
 * filesystem would test the claim by assuming it.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir }    from 'node:os';
import { join }      from 'node:path';

import { KINDS, listCards, render, removeCard, assemble } from '../../scripts/desk/deskcards.mjs';

/** One card to write to disk. `json: null` writes no `card.json` at all. */
interface CardSpec {
  id:    string;
  json?: string | null;
  html?: string;
  css?:  string;
  js?:   string;
}

const made: string[] = [];

afterEach(() => {
  while (made.length) rmSync(made.pop() as string, { recursive: true, force: true });
});

/**
 * Build a real deck directory and return its path.
 *
 * @param cards the cards to write, in whatever order
 * @returns the deck directory, cleaned up after the test
 */
function makeDeck(cards: CardSpec[]): string {
  const root = mkdtempSync(join(tmpdir(), 'se-desk-'));
  made.push(root);
  const deck = join(root, 'cards');
  mkdirSync(deck);
  for (const c of cards) {
    const dir = join(deck, c.id);
    mkdirSync(dir, { recursive: true });
    if (c.json !== null) writeFileSync(join(dir, 'card.json'), c.json ?? '{"ord":0}');
    if (c.html !== undefined) writeFileSync(join(dir, 'card.html'), c.html);
    if (c.css  !== undefined) writeFileSync(join(dir, 'card.css'),  c.css);
    if (c.js   !== undefined) writeFileSync(join(dir, 'card.js'),   c.js);
  }
  return deck;
}

/** A deck path inside a temp root that is never created, for absent-directory cases. */
function missingDeck(): string {
  const root = mkdtempSync(join(tmpdir(), 'se-desk-'));
  made.push(root);
  return join(root, 'no-such-deck');
}

describe('KINDS', () => {

  test('pins one file name per asset kind — the card contract in three strings', () => {
    expect(KINDS).toEqual({ css: 'card.css', html: 'card.html', js: 'card.js' });
  });

});

describe('listCards', () => {

  test('orders by ord, lowest first, whatever order the directory reads in', () => {
    const deck = makeDeck([
      { id: 'zulu',  json: '{"ord":10}' },
      { id: 'alpha', json: '{"ord":30}' },
      { id: 'mike',  json: '{"ord":20}' },
    ]);
    expect(listCards(deck).map(c => c.id)).toEqual(['zulu', 'mike', 'alpha']);
  });

  test('breaks an ord tie by id, so a deck without ords still has a stable order', () => {
    const deck = makeDeck([
      { id: 'charlie', json: '{"ord":5}' },
      { id: 'alpha',   json: '{"ord":5}' },
      { id: 'bravo',   json: '{"ord":5}' },
    ]);
    expect(listCards(deck).map(c => c.id)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  test('skips a directory with no card.json — half a card stays off the desk', () => {
    const deck = makeDeck([
      { id: 'ready',    json: '{"ord":1}', html: '<section data-card="ready"></section>' },
      { id: 'halfdone', json: null,        html: '<section data-card="halfdone"></section>' },
    ]);
    expect(listCards(deck).map(c => c.id)).toEqual(['ready']);
    expect(existsSync(join(deck, 'halfdone'))).toBe(true);   // skipped, not deleted
  });

  test('skips a directory whose card.json will not parse', () => {
    const deck = makeDeck([
      { id: 'good',   json: '{"ord":1}' },
      { id: 'broken', json: '{ord: 1,,,' },
    ]);
    expect(listCards(deck).map(c => c.id)).toEqual(['good']);
  });

  test('ignores loose files at the deck root — only directories are cards', () => {
    const deck = makeDeck([{ id: 'real', json: '{"ord":1}' }]);
    writeFileSync(join(deck, 'notes.txt'), 'scratch');
    writeFileSync(join(deck, 'card.json'), '{"ord":0}');
    expect(listCards(deck).map(c => c.id)).toEqual(['real']);
  });

  test('a missing deck directory is an empty deck, not a crash', () => {
    expect(listCards(missingDeck())).toEqual([]);
  });

  test('reads ord as 0 when absent or unusable, and fixed only when truthy', () => {
    const deck = makeDeck([
      { id: 'bare',  json: '{}' },
      { id: 'junk',  json: '{"ord":"soon"}' },
      { id: 'inbox', json: '{"ord":99,"fixed":true}' },
    ]);
    const rows = listCards(deck);
    expect(rows.map(c => [c.id, c.ord, c.fixed]))
      .toEqual([['bare', 0, false], ['junk', 0, false], ['inbox', 99, true]]);
  });

  test('reports each card its own directory, ready to read files from', () => {
    const deck = makeDeck([{ id: 'art', json: '{"ord":1}' }]);
    expect(listCards(deck)[0]?.dir).toBe(join(deck, 'art'));
  });

});

describe('render', () => {

  test('concatenates one kind across cards in display order', () => {
    const deck = makeDeck([
      { id: 'third',  json: '{"ord":30}', html: '<c>3</c>' },
      { id: 'first',  json: '{"ord":10}', html: '<c>1</c>' },
      { id: 'second', json: '{"ord":20}', html: '<c>2</c>' },
    ]);
    expect(render(deck, 'html')).toBe('<c>1</c>\n<c>2</c>\n<c>3</c>');
  });

  test('a card that does not contribute a kind contributes nothing, not a blank line', () => {
    const deck = makeDeck([
      { id: 'styled',  json: '{"ord":10}', css: '.a{}' },
      { id: 'plain',   json: '{"ord":20}', html: '<c>x</c>' },
      { id: 'styled2', json: '{"ord":30}', css: '.b{}' },
    ]);
    expect(render(deck, 'css')).toBe('.a{}\n.b{}');
  });

  test('each kind reads its own file and no other', () => {
    const deck = makeDeck([{ id: 'one', json: '{"ord":1}',
                             html: 'H', css: 'C', js: 'J' }]);
    expect(render(deck, 'html')).toBe('H');
    expect(render(deck, 'css')).toBe('C');
    expect(render(deck, 'js')).toBe('J');
  });

  test('an empty or missing deck renders the empty string', () => {
    expect(render(makeDeck([]), 'js')).toBe('');
    expect(render(missingDeck(), 'js')).toBe('');
  });

  test('an unknown kind throws rather than rendering nothing, which would look like an empty deck', () => {
    const deck = makeDeck([{ id: 'one', json: '{"ord":1}', html: 'H' }]);
    const loose = render as unknown as (dir: string, kind: string) => string;
    expect(() => loose(deck, 'sass')).toThrow(TypeError);
    expect(() => loose(deck, 'sass')).toThrow(/unknown asset kind: sass/);
  });

});

describe('removeCard', () => {

  test('takes the whole directory, so markup, styles and script leave together', () => {
    const deck = makeDeck([
      { id: 'keep',   json: '{"ord":10}', html: 'K' },
      { id: 'sankey', json: '{"ord":20}', html: 'S', css: '.s{}', js: 'boom()' },
    ]);
    expect(removeCard(deck, 'sankey')).toBe(true);
    expect(existsSync(join(deck, 'sankey'))).toBe(false);
    expect(listCards(deck).map(c => c.id)).toEqual(['keep']);
    expect(render(deck, 'js')).toBe('');            // the orphaned-script failure, gone
  });

  test('refuses an unknown id and removes nothing', () => {
    const deck = makeDeck([{ id: 'here', json: '{"ord":1}' }]);
    expect(removeCard(deck, 'elsewhere')).toBe(false);
    expect(readdirSync(deck)).toEqual(['here']);
  });

  test('refuses a fixed card — structure is the shell\'s, not the deck\'s', () => {
    const deck = makeDeck([{ id: 'inbox', json: '{"ord":99,"fixed":true}', html: 'I' }]);
    expect(removeCard(deck, 'inbox')).toBe(false);
    expect(existsSync(join(deck, 'inbox'))).toBe(true);
  });

  test('refuses an id that is a path rather than a name', () => {
    const deck = makeDeck([{ id: 'here', json: '{"ord":1}' }]);
    for (const bad of ['..', '../..', 'a/b', 'a\\b', '.', '']) {
      expect(removeCard(deck, bad)).toBe(false);
    }
    expect(existsSync(deck)).toBe(true);
    expect(readdirSync(deck)).toEqual(['here']);
  });

  test('is idempotent: removing twice is one removal and one refusal', () => {
    const deck = makeDeck([{ id: 'gone', json: '{"ord":1}' }]);
    expect(removeCard(deck, 'gone')).toBe(true);
    expect(removeCard(deck, 'gone')).toBe(false);
  });

});

describe('assemble', () => {

  const SHELL = [
    '<style>/*base*/', '<!--CARD-CSS-->', '</style>',
    '<main>', '<!--CARD-HTML-->', '</main>',
    '<script>', '<!--CARD-JS-->', '</script>',
  ].join('\n');

  test('fills all three placeholders from one deck', () => {
    const deck = makeDeck([
      { id: 'a', json: '{"ord":10}', html: '<c>A</c>', css: '.a{}', js: 'initA()' },
      { id: 'b', json: '{"ord":20}', html: '<c>B</c>', css: '.b{}', js: 'initB()' },
    ]);
    const page = assemble(SHELL, deck);
    expect(page).not.toContain('<!--CARD-');
    expect(page).toBe([
      '<style>/*base*/', '.a{}\n.b{}', '</style>',
      '<main>', '<c>A</c>\n<c>B</c>', '</main>',
      '<script>', 'initA()\ninitB()', '</script>',
    ].join('\n'));
  });

  test('an empty deck leaves the shell whole, with the placeholders emptied out', () => {
    const page = assemble(SHELL, makeDeck([]));
    expect(page).not.toContain('<!--CARD-');
    expect(page).toContain('<style>/*base*/\n\n</style>');
  });

  test('$& inside a card is text, not a replacement pattern', () => {
    const deck = makeDeck([{ id: 'money', json: '{"ord":1}',
                             html: 'cost: $& and $$ and $\' and $` and $1' }]);
    expect(assemble(SHELL, deck)).toContain('cost: $& and $$ and $\' and $` and $1');
  });

  test('$& in one region cannot leak into another', () => {
    const deck = makeDeck([{ id: 'x', json: '{"ord":1}',
                             css: '/* $& */', html: '<!-- $` -->', js: '// $\'' }]);
    const page = assemble(SHELL, deck);
    expect(page).toContain('/* $& */');
    expect(page).toContain('<!-- $` -->');
    expect(page).toContain('// $\'');
  });

  test('a shell with no placeholders comes back unchanged', () => {
    const deck = makeDeck([{ id: 'a', json: '{"ord":1}', html: '<c>A</c>' }]);
    expect(assemble('<html>nothing to fill</html>', deck)).toBe('<html>nothing to fill</html>');
  });

  test('replaces the first occurrence only, so a placeholder named in a comment stays put', () => {
    const deck = makeDeck([{ id: 'a', json: '{"ord":1}', html: 'A' }]);
    const twice = '<!--CARD-HTML-->\nlater: <!--CARD-HTML-->';
    expect(assemble(twice, deck)).toBe('A\nlater: <!--CARD-HTML-->');
  });

});
