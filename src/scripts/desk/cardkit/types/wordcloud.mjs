/**
 * `wordcloud` — a tally of words, drawn at a size proportional to frequency and packed by a spiral.
 *
 * THIS TYPE WAS REFUSED AND THE REFUSAL WAS OVERRULED, SO THE REFUSAL LIVES HERE INSTEAD, IN THE
 * CARD'S OWN NUMBERS. `QUEUE.md` said "area encodes nothing" and left the type unbuilt. That was
 * half right in a way that matters: the *font size* is a clean proportional encoding of frequency,
 * and the reader does not read font size. A reader reads INK, and the ink a word covers is its size
 * times its letter count. So "the" at 20px out-inks "cat" at 30px, and the thing doing the
 * out-inking — how many letters English happens to spend on a word — is not in the data at all.
 *
 * The overrule's argument is that the length confound is a property of the input rather than of the
 * drawing, and that is correct. This card cannot know that `the` is uninteresting; a caller who has
 * not stripped stopwords has made a data mistake, not a chart mistake. What the card CAN do is
 * measure the confound in the data it was actually handed and print the measurement, which is what
 * the caption does. Four numbers, all computed, none of them a generic disclaimer:
 *
 *   1. **The worst inversion, by name.** The pair where a lower-frequency word covers more area
 *      than a higher-frequency one, with the ratio. When no such pair exists the caption says so,
 *      because "in this data more ink really does mean more often" is a genuinely reassuring fact
 *      and it costs one sweep to establish.
 *   2. **How many pairs invert**, out of how many pairs COULD. One named pair is an anecdote; the
 *      proportion is the finding. The denominator counts only pairs whose two words differ in
 *      frequency, because a pair of equally frequent words has no more-frequent member to out-ink
 *      and cannot invert — including them would dilute the rate with pairs that were never at
 *      risk, and in the limit it produces a sentence that is vacuously true and misleading at once.
 *   3. **The squaring.** Font size is linear in frequency, so box AREA goes as frequency squared —
 *      a distortion that exists even for two words of the same length. The caption prints the top
 *      word's frequency ratio, its size ratio and its area ratio side by side, which also exposes
 *      the opposite distortion at the other end: words pinned to the minimum readable size, where
 *      the picture overstates how often they occur.
 *   4. **How many drawn words are common English stopwords**, since that is the single likeliest
 *      reason a cloud is uninformative and the card can detect it even though it must not fix it.
 *
 * TWO MORE THINGS THE PICTURE CLAIMS AND SHOULD NOT.
 *
 * *Adjacency.* The layout is a packing. Two words end up touching because of the order they were
 * placed in and how much room was left, and for no other reason. There is no relationship between
 * neighbours, and the caption says so, because a reader who sees `risk` beside `mitigation` will
 * believe something.
 *
 * *Instability.* Most implementations seed the spiral from `Math.random()`, so the same tally draws
 * a different picture on every load and cannot be compared against itself. Here the layout is a pure
 * function of the tally: words are sorted by weight and then by code point, the only randomness is
 * one spiral phase per word drawn from a generator seeded by FNV-1a over that sorted list, and the
 * whole layout runs in Node so a builder replay repaints a display list rather than laying out
 * again. Same words, same picture, in any input order, forever.
 *
 * WHY `ranking-and-comparison` AND NOT `text-and-code`. That category asks "What does it say,
 * exactly as written?" and a word cloud's first act is to throw away word order, which is where
 * nearly all the meaning of a text lives. It does not show what the text says. The question a
 * reader actually arrives with is "which words come up most", which is "Which is bigger?" — and
 * that puts this card in the same category as `lollipop`, which answers it with position along a
 * common scale and no confound at all. That co-location is deliberate and it is `gauge`'s trick:
 * a reader browsing the category meets both entries side by side, which is exactly the comparison
 * this file wants them to make. `distribution` was the other candidate and it is the weaker one —
 * that category's members plot the spread of a continuous variable, and a tally of words has
 * categories and counts, not a spread.
 *
 * The `ranked` form is that better picture, shipped inside this card one setting away, so nobody
 * has to take the caption's word for it.
 *
 * @see ./lollipop.mjs — the same question with length as the only encoding; the `ranked` form here
 *                      is deliberately its picture
 * @see ./gauge.mjs    — the catalogue's other entry that argues against itself in its own caption
 * @see ./treemap.mjs  — where the enumerate-variants-in-Node, paint-a-display-list-in-the-browser
 *                      shape comes from, and how a card states what its area encoding does not mean
 * @see ./beeswarm.mjs — the neighbouring deterministic packing, and the shrink-then-report posture
 * @see ../CONTRACT.md — `shape` is a string, `defaults` is an object, `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so build-time drawing and browser-time drawing
 * come from one implementation rather than two that drift.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().fmt(1200);   // '1.2k'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/wordcloud: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/wordcloud: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── settings and metadata ───────────────────────────────────────────────────────────────── */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it; a binding declared after `meta` cannot be referenced by it at all.
 *
 * `layout` defaults to `cloud` rather than to the honest `ranked`, and that is a deliberate
 * restraint: somebody asking for a word cloud gets a word cloud. The caption argues; the default
 * does not editorialise.
 *
 * @example defaults.words;   // 50
 */
export const defaults = {
  layout: 'cloud',
  words: 50,
};

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `forms` is declared because the catalogue's rule is that a different QUESTION is a new type and a
 * different PICTURE is a form. The cloud and the ranked list answer one question — which words come
 * up most — with two pictures, one of which is honest about magnitude and one of which is not.
 *
 * @example meta.name;   // 'wordcloud'
 */
export const meta = {
  name: 'wordcloud',
  summary:
    'A tally of words sized in proportion to frequency and packed deterministically, with a ' +
    'caption that measures how badly word length distorts it.',
  shape:
    '{ words: [{ word, weight, group }] } or { words: { word: weight } } — weight is a count and ' +
    'must be a finite number; a negative or non-finite weight is refused and named, a zero is ' +
    'dropped as a word that did not occur, and repeated words are merged by summing',
  category: 'ranking-and-comparison',
  forms: [
    { name: 'cloud', via: "layout: 'cloud'",
      summary: 'Words packed by a spiral at a size proportional to frequency, ink confound and all.' },
    { name: 'ranked', via: "layout: 'ranked'",
      summary: 'The same tally as stems and dots on a common scale, where only length encodes count.' },
  ],
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose — a sibling card was
 * once refused because a comment said "the class is what CSS reads" — and a guard that cries wolf
 * is a guard somebody deletes. Regex literals are recognised, because a scanner that desynchronises
 * on the quote inside a character class starts blanking real code, which turns a false positive
 * into a far worse false negative.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, comment and string contents replaced by spaces
 *
 * @example blankNonCode('var a = "const";').indexOf('const');   // -1
 */
function blankNonCode(src) {
  const out = src.split('');
  let i = 0;
  let prev = '';
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      blank(i, end); i = end; continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      blank(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      blank(i + 1, k); i = k + 1; prev = ')'; continue;
    }
    if (c === '/' && !/[\w)\]]/.test(prev)) {
      let k = i + 1;
      let cls = false;
      while (k < src.length && (cls || src[k] !== '/')) {
        if (src[k] === '\\') k++;
        else if (src[k] === '[') cls = true;
        else if (src[k] === ']') cls = false;
        k++;
      }
      blank(i + 1, k); i = k + 1; prev = ')'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/** A short window of source around an offset, for a message that points at the actual text. */
function nearby(src, at) {
  return src.slice(Math.max(0, at - 50), Math.min(src.length, at + 50));
}

/**
 * Refuse to emit a browser script that would break the desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block, so a single modern-syntax token or a
 * stray backtick is a parse error that blanks every card on the page. On this type the input is the
 * most hostile in the catalogue — the words come out of somebody else's corpus — so the guard is
 * the last line rather than a formality, and {@link jsLit} is the first: it escapes `<`, `>`, the
 * backtick and `?` so that no word can put `</script>`, `=>`, a template literal or `?.` into the
 * emitted file in the first place.
 *
 * Backtick, `=>` and `?.` are scanned raw, because none of them can appear innocently here.
 * `const`, `let` and `class` are scanned only after comment and string bodies are blanked. Control
 * characters are compared numerically rather than matched against a character class, since writing
 * the class is how the class gets corrupted.
 *
 * @param src   the emitted script
 * @param where a label for the message, naming which card produced it
 * @returns `src` unchanged, so the guard can wrap the value on its way out
 * @throws {Error} naming the violation, its offset, and the source around it
 *
 * @example guardEmitted('var a = 1;', 'wordcloud');   // 'var a = 1;'
 */
export function guardEmitted(src, where) {
  const tag = 'cardkit/' + (where || 'wordcloud') + ': emitted js ';

  const tick = src.indexOf(String.fromCharCode(96));
  if (tick >= 0) throw new Error(tag + 'contains a backtick at offset ' + tick + ' - near: ' + nearby(src, tick));

  const arrow = src.indexOf(String.fromCharCode(61) + String.fromCharCode(62));
  if (arrow >= 0) throw new Error(tag + 'contains an arrow function at offset ' + arrow + ' - near: ' + nearby(src, arrow));

  const opt = src.indexOf(String.fromCharCode(63) + String.fromCharCode(46));
  if (opt >= 0) throw new Error(tag + 'contains optional chaining at offset ' + opt + ' - near: ' + nearby(src, opt));

  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      throw new Error(tag + 'contains control character ' + c + ' at offset ' + i);
    }
  }

  const code = blankNonCode(src);
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('(^|[^\\w$.])' + kw + '[\\s({]').exec(code);
    if (m) throw new Error(tag + 'declares ' + kw + ' at offset ' + m.index + ' - near: ' + nearby(src, m.index));
  }

  return src;
}

/* ── text measurement, and what the approximation costs ──────────────────────────────────── */

/**
 * The advance width of one character cell, as a fraction of the font size.
 *
 * `kit.css` sets `.ck-plot text { font-family: var(--mono) }`, and 5.42px at 9px is the desk's own
 * measured advance for that face — the number `chart`, `treemap` and `beeswarm` all lay out
 * against. Reusing it rather than inventing a second constant is the difference between three cards
 * that agree about what fits and three that drift.
 *
 * Setting the cloud in the monospace face is the whole reason a Node-side layout is possible at
 * all. There are no font metrics in Node; in a proportional face a width is a table lookup per
 * glyph per font per fallback, and the fallback is whatever the viewer happens to have. In a
 * monospace face every Latin glyph is exactly one cell, so the measurement is not an estimate.
 * The cost is that the cloud does not look like the decorative object people picture, which on this
 * card is close to a feature.
 */
const EM = 5.42 / 9;

/** The horizontal ellipsis, written as an escape so no literal can be mistyped into the source. */
const ELL = '\u2026';

/**
 * Whether a code point takes no width of its own.
 *
 * Combining marks, joiners and variation selectors attach to the previous glyph. Counting them as a
 * cell each would make `e` plus an acute accent twice as wide as `e`, which is wrong in a way that
 * shows: the box would be too big and the word would sit in a hole.
 *
 * @example zeroWidth(0x0301);   // true
 * @example zeroWidth(0x0061);   // false
 */
function zeroWidth(cp) {
  return (cp >= 0x0300 && cp <= 0x036f) ||
         (cp >= 0x0483 && cp <= 0x0489) ||
         (cp >= 0x20d0 && cp <= 0x20ff) ||
         (cp >= 0x200b && cp <= 0x200f) ||
         (cp >= 0xfe00 && cp <= 0xfe0f) ||
         (cp >= 0xfe20 && cp <= 0xfe2f) ||
         cp === 0x00ad;
}

/**
 * Whether a code point occupies two monospace cells.
 *
 * The East Asian Wide and Fullwidth ranges, plus the emoji blocks. This is the coarse version of
 * UAX #11 and it is coarse on purpose: the full property table is a few thousand ranges, the
 * browser's own answer depends on which font it substituted, and being one cell wrong on a CJK word
 * is a box that is slightly too small rather than a crash. Every word containing one of these is
 * counted and the count is printed, so a reader knows which part of the picture was measured and
 * which part was estimated.
 *
 * @example wideCell(0x4e00);   // true   — CJK
 * @example wideCell(0x1f600);  // true   — emoji
 * @example wideCell(0x0061);   // false  — 'a'
 */
function wideCell(cp) {
  return (cp >= 0x1100 && cp <= 0x115f) ||
         (cp >= 0x2e80 && cp <= 0x303e) ||
         (cp >= 0x3041 && cp <= 0x33ff) ||
         (cp >= 0x3400 && cp <= 0x4dbf) ||
         (cp >= 0x4e00 && cp <= 0x9fff) ||
         (cp >= 0xa000 && cp <= 0xa4cf) ||
         (cp >= 0xac00 && cp <= 0xd7a3) ||
         (cp >= 0xf900 && cp <= 0xfaff) ||
         (cp >= 0xfe30 && cp <= 0xfe6f) ||
         (cp >= 0xff00 && cp <= 0xff60) ||
         (cp >= 0xffe0 && cp <= 0xffe6) ||
         (cp >= 0x1f000 && cp <= 0x1f0ff) ||
         (cp >= 0x1f300 && cp <= 0x1f9ff) ||
         (cp >= 0x1fa00 && cp <= 0x1faff) ||
         (cp >= 0x20000 && cp <= 0x3fffd);
}

/**
 * How many monospace cells a word occupies, and whether anything in it was estimated rather than
 * measured.
 *
 * Iterated by code point, not by UTF-16 unit, so an astral character counts once rather than twice.
 *
 * @param word any string
 * @returns `{ cells, approx }` — the width in cells, and true when a wide or zero-width code point
 *          was involved and the true advance depends on the viewer's font
 *
 * @example cellsOf('cat');            // { cells: 3, approx: false }
 * @example cellsOf('\u732b');         // { cells: 2, approx: true }
 */
function cellsOf(word) {
  let cells = 0;
  let approx = false;
  for (const ch of String(word)) {
    const cp = ch.codePointAt(0);
    if (zeroWidth(cp)) { approx = true; continue; }
    if (wideCell(cp)) { cells += 2; approx = true; continue; }
    cells += 1;
  }
  return { cells, approx };
}

/** Width in px of a run of `cells` monospace cells at `size` px. */
function cellPx(cells, size) { return cells * EM * size; }

/** Shorten a string to fit `max` px at `size`, marking the cut, or return it whole. */
function clipTo(s, max, size) {
  const str = String(s);
  const room = Math.floor(max / (EM * size));
  if (cellsOf(str).cells <= room) return str;
  if (room < 3) return str.slice(0, 1) + ELL;
  return str.slice(0, Math.max(1, room - 1)) + ELL;
}

/* ── stopwords ───────────────────────────────────────────────────────────────────────────── */

/**
 * Common English function words, as a set.
 *
 * Written as one space-separated string rather than an array literal because the list is data and
 * a hundred quoted strings is a hundred chances to typo one. It is English only, and that is a
 * limitation the caption states: a French or Japanese corpus will report zero stopwords no matter
 * how much of it is function words, and a reader must not read that zero as a clean bill of health.
 *
 * The card counts these and never removes them. Which words are uninteresting is a property of the
 * question being asked, not of the language, and a chart that silently deleted words would be
 * answering a question nobody put to it.
 */
const STOPWORDS = new Set((
  'a about above after again against all also am an and any are as at be because been before ' +
  'being below between both but by can cannot could did do does doing down during each few for ' +
  'from further had has have having he her here hers herself him himself his how i if in into is ' +
  'it its itself just me more most my myself no nor not now of off on once only or other our ' +
  'ours ourselves out over own same she should so some such than that the their theirs them ' +
  'themselves then there these they this those through to too under until up us very was we were ' +
  'what when where which while who whom why will with would you your yours yourself yourselves'
).split(' '));

/* ── reading the tally ───────────────────────────────────────────────────────────────────── */

/* The most words this card will read out of a descriptor. Past this the tail is not read at all,
   and the count is printed — a pathological input must not make the build hang. */
const READ_CAP = 20000;

/* A word longer than this is a paste accident rather than a word, and it is truncated for the
   TALLY KEY as well as the drawing, because a 4KB key in the payload is a 4KB key on the page. */
const WORD_MAX = 300;

/**
 * Strip control characters and DEL from a string.
 *
 * Compared numerically rather than matched against a character class, because writing the class is
 * how the class gets corrupted. DEL is worth naming separately: it is the one control character
 * `JSON.stringify` does not escape, so a word carrying it survives serialisation intact and lands
 * raw in the emitted script, where nothing upstream has a reason to notice.
 *
 * @example clean('a' + String.fromCharCode(0) + 'b');   // 'ab'
 */
function clean(s) {
  const raw = String(s);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) continue;
    out += raw.charAt(i);
  }
  return out;
}

/**
 * A finite number from an untrusted field, accepting a numeric string.
 *
 * Numeric strings are accepted because tallies routinely arrive from CSV and JSON exports where
 * every value is quoted. Everything else — null, an empty string, an object, a boolean — is refused
 * rather than coerced, because `Number([])` is 0 and a silent zero is a word the card would claim
 * did not occur.
 *
 * @example numOrNull('12');   // 12
 * @example numOrNull(true);   // null
 */
function numOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Read one untrusted tally into the one shape the rest of the file may assume, counting everything
 * it had to refuse or change.
 *
 * The decisions, all of which the caption reports:
 *
 * - **Repeated words are merged by summing.** Keeping them would draw one word twice at two sizes,
 *   which is a picture that contradicts itself. The contributions are sorted ascending before they
 *   are added, so the merge is bit-identical whatever order the input arrived in — floating-point
 *   addition is not associative, and order-independence is the whole point here.
 * - **Words differing only by case are NOT merged**, because case can be the datum (`US` against
 *   `us`) and folding it is a decision the caller owns. The card counts how many such collisions
 *   exist and names them, which is detecting a likely data mistake without silently fixing it.
 * - **A negative weight is refused.** A word cannot occur minus five times, and there is no size to
 *   draw for it.
 * - **A non-finite weight is refused and the first offender is named**, because `NaN` in a tally is
 *   almost always one bad division upstream and knowing which word carries it is the whole fix.
 * - **A zero weight is dropped**, not drawn at the minimum size: a word that occurred zero times is
 *   not in the text, and drawing it at any size is a claim that it is.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ words, stats }` with `words` sorted by weight descending then by code point
 *
 * @example readTally({ words: { a: 3, b: 1 } }).words[0].w;      // 'a'
 * @example readTally({ words: [{ word: 'x', weight: -1 }] }).stats.negatives;   // 1
 */
export function readTally(data) {
  const d = data && typeof data === 'object' ? data : {};
  const stats = {
    seen: 0, negatives: 0, unreadable: 0, zeros: 0, merged: 0, caseClashes: 0,
    dropped: 0, blank: 0, trimmed: 0, stripped: 0, badName: null,
  };

  /* Both spellings of the input. An object map is what a tally naturally is, and refusing it would
     make every caller write a conversion nobody enjoys writing. */
  const rows = [];
  if (Array.isArray(d.words)) {
    for (const r of d.words) {
      if (!r || typeof r !== 'object') { stats.dropped++; continue; }
      rows.push([r.word, r.weight, r.group]);
    }
  } else if (d.words && typeof d.words === 'object') {
    for (const k of Object.keys(d.words)) rows.push([k, d.words[k], undefined]);
  }

  const bag = new Map();
  const groups = [];
  const gIndex = new Map();

  for (const [rawWord, rawWeight, rawGroup] of rows) {
    if (stats.seen >= READ_CAP) { stats.dropped++; continue; }
    stats.seen++;

    const cleaned = clean(rawWord == null ? '' : String(rawWord));
    if (cleaned !== String(rawWord == null ? '' : rawWord)) stats.stripped++;
    const trimmed = cleaned.trim();
    if (!trimmed) { stats.blank++; continue; }
    const word = trimmed.length > WORD_MAX ? trimmed.slice(0, WORD_MAX) : trimmed;
    if (word !== trimmed) stats.trimmed++;

    const n = numOrNull(rawWeight);
    if (n === null) {
      stats.unreadable++;
      if (stats.badName === null) stats.badName = word;
      continue;
    }
    if (n < 0) { stats.negatives++; continue; }
    if (n === 0) { stats.zeros++; continue; }

    let g = -1;
    if (rawGroup != null && String(rawGroup) !== '') {
      const gname = clean(String(rawGroup)).slice(0, 60);
      if (gname) {
        if (!gIndex.has(gname)) { gIndex.set(gname, groups.length); groups.push(gname); }
        g = gIndex.get(gname);
      }
    }

    if (bag.has(word)) {
      const row = bag.get(word);
      row.parts.push(n);
      stats.merged++;
      if (row.g < 0 && g >= 0) row.g = g;
    } else {
      bag.set(word, { w: word, parts: [n], g });
    }
  }

  /* Summed in a canonical order rather than in arrival order. Two callers handing over the same
     multiset of counts in different orders must get the same total to the last bit, or the seed
     changes and the picture moves. */
  const words = [];
  for (const row of bag.values()) {
    const parts = row.parts.slice().sort((a, b) => a - b);
    let total = 0;
    for (const p of parts) total += p;
    words.push({ w: row.w, n: total, g: row.g });
  }

  const lower = new Map();
  for (const row of words) {
    const k = row.w.toLowerCase();
    lower.set(k, (lower.get(k) || 0) + 1);
  }
  for (const count of lower.values()) if (count > 1) stats.caseClashes++;

  /* Weight descending, then by code point ascending. The second key is not cosmetic: without it two
     words of equal weight are ordered by whatever the Map iteration happened to be, which is
     insertion order, which is input order — and the whole determinism claim would be false for
     exactly the tie case that is most common in a small tally. */
  words.sort((a, b) => (b.n - a.n) || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));

  return { words, groups, stats };
}

/* ── the seed ────────────────────────────────────────────────────────────────────────────── */

/**
 * FNV-1a over a string, as an unsigned 32-bit integer.
 *
 * @example fnv1a('') === 0x811c9dc5;   // true
 */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32: a small, fast, fully deterministic generator over a 32-bit seed.
 *
 * @param seed any unsigned 32-bit integer
 * @returns a function yielding numbers in [0, 1)
 *
 * @example mulberry32(1)() === mulberry32(1)();   // true
 */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seed string for one tally: every word and its weight, in the sorted order.
 *
 * Built from the SORTED list, so the seed itself is independent of input order — a seed folded over
 * arrival order would make the picture depend on the thing this card promises it does not depend
 * on. The separator is printable, because a separator only has to not collide and a visible one is
 * checkable in a way an invisible one is never.
 *
 * @example seedOf([{ w: 'a', n: 2 }]);   // 'a\u00a72|'
 */
function seedOf(words) {
  let s = '';
  for (const row of words) s += row.w + '\u00a7' + row.n + '|';
  return s;
}

/* ── the cloud layout ────────────────────────────────────────────────────────────────────── */

/* The desk column is comfortable at 640. The field grows taller with the number of words, because
   a hundred words in a 380px box is a card that mostly reports what it could not fit. */
const W0 = 640;

/* The largest and smallest type the cloud will set. The maximum is what the most frequent word
   gets; the minimum is the floor below which a monospace word stops being readable in a desk
   column, and the number of words pinned to it is printed, because for those words the picture
   OVERSTATES how often they occur. */
const SIZE_MAX = 44;
const SIZE_MIN = 10;

/* The absolute floor the global shrink may reach before it gives up and starts dropping words. */
const SIZE_FLOOR = 7;

/* Padding around each word's box, in ems of its own size. The box is what the collision test sees,
   so this is also the visual gap between two neighbouring words. */
const PAD_X = 0.28;
const PAD_Y = 0.16;

/* A monospace box is drawn from its baseline; this is where the baseline sits inside the box. */
const ASCENT = 0.76;

/* The spiral: `r = GROWTH * theta`, stepped by a constant arc length so the sampling stays even as
   the radius grows. A finer step finds tighter fits and costs time; 2.6px is where the packing
   stops visibly improving on a 640px field. */
const GROWTH = 2.4;
const ARC_STEP = 2.6;
const MAX_STEPS = 24000;

/* How many times the whole size ramp is shrunk when words will not fit, and by how much each time.
   A fixed schedule rather than a search, so the outcome is a pure function of the input. */
const SHRINK_TRIES = 5;
const SHRINK_BY = 0.82;

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A NaN in an attribute is silent: the browser drops the whole element and the card renders short
 * with nothing in the console. Failing at build time turns that into a stack trace beside the input
 * that caused it.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n2(12.3456, 'word');   // 12.35
 */
function n2(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/wordcloud: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** The field a cloud of `n` words is laid out in. Taller for more words, so fewer have to be dropped. */
function fieldFor(n) {
  return { W: W0, H: Math.round(Math.max(280, Math.min(720, 280 + n * 3.1))) };
}

/**
 * The type size for one weight, quantised to a whole pixel.
 *
 * Anchored at ZERO, not at the smallest weight in the tally. Anchoring at the minimum is what most
 * implementations do and it makes size an interval encoding with an arbitrary origin: a tally of
 * 100, 101, 102 would draw a tiny word beside a huge one for a three percent difference. Anchored
 * at zero, a word twice as frequent is twice as tall, which is the only reading of "size is
 * frequency" that survives being checked.
 *
 * Quantised BEFORE anything is measured, because the collision test has to be run against the size
 * that will actually be drawn. A box computed from 22.4px and a glyph drawn at 22px is a layout
 * that believes a gap it does not have.
 *
 * @param w    the weight
 * @param wmax the largest weight in the tally
 * @param k    the global shrink factor, 1 when nothing had to shrink
 * @returns `{ size, floored }` — the whole-pixel size, and whether the floor clamped it
 *
 * @example sizeFor(50, 100, 1).size;   // 22
 */
function sizeFor(w, wmax, k) {
  const hi = SIZE_MAX * k;
  const lo = Math.max(SIZE_FLOOR, SIZE_MIN * k);
  const want = wmax > 0 ? hi * (w / wmax) : hi;
  const size = Math.max(1, Math.round(Math.min(hi, Math.max(lo, want))));
  return { size, floored: want < lo };
}

/** An axis-aligned box overlap test, exclusive at the edges so two boxes may touch. */
function hits(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Place one box on the first free point of an Archimedean spiral out from the centre.
 *
 * The spiral is stretched horizontally by the field's aspect so it sweeps a wide rectangle rather
 * than inscribing a circle in it, which is what lets a 640x380 field be used rather than the
 * 380-diameter disc inside it.
 *
 * Nothing here is random except `phase`, the angle the word's own spiral starts at, and that comes
 * from a generator seeded by the tally. Without it every word marches out along the same ray and
 * the cloud grows a visible diagonal seam; with it the seam is gone and the picture is still a pure
 * function of the data. This is the ONLY use of the generator in the whole file.
 *
 * @param box   `{ w, h }` — the size to place
 * @param phase the starting angle in radians
 * @param placed boxes already on the field
 * @param grid  a bucket index over `placed`, for the collision test
 * @param field `{ W, H }`
 * @returns `{ x, y, w, h }` or null when the spiral ran out of field
 *
 * @example placeOne({ w: 10, h: 10 }, 0, [], newGrid(), { W: 100, H: 100 }).x;   // 45
 */
function placeOne(box, phase, placed, grid, field) {
  const cx = field.W / 2;
  const cy = field.H / 2;
  const stretch = field.H > 0 ? field.W / field.H : 1;

  let theta = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = GROWTH * theta;
    const x = cx + r * stretch * Math.cos(theta + phase) - box.w / 2;
    const y = cy + r * Math.sin(theta + phase) - box.h / 2;
    theta += ARC_STEP / Math.max(r, ARC_STEP);

    if (x < 0 || y < 0 || x + box.w > field.W || y + box.h > field.H) {
      /* Off the field at this radius is not off the field forever: the spiral is stretched, so a
         point can leave through the top and come back in on the side. It only ends when the radius
         alone has passed the field's diagonal. */
      if (r > field.W + field.H) return null;
      continue;
    }

    const cand = { x, y, w: box.w, h: box.h };
    let clear = true;
    for (const other of gridNear(grid, cand)) {
      if (hits(cand, other)) { clear = false; break; }
    }
    if (clear) return cand;
  }
  return null;
}

/* The bucket edge for the collision index. Big enough that most words touch one or two buckets,
   small enough that a bucket does not hold the whole field. */
const CELL = 40;

/** A fresh bucket index for the collision test. */
function newGrid() { return new Map(); }

/** Every bucket key a box overlaps. */
function keysFor(box) {
  const out = [];
  const x0 = Math.floor(box.x / CELL);
  const x1 = Math.floor((box.x + box.w) / CELL);
  const y0 = Math.floor(box.y / CELL);
  const y1 = Math.floor((box.y + box.h) / CELL);
  for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) out.push(gx + ':' + gy);
  return out;
}

/** File a placed box into every bucket it touches. */
function gridAdd(grid, box) {
  for (const k of keysFor(box)) {
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(box);
  }
}

/** Every box that could possibly overlap `box`, deduplicated. */
function gridNear(grid, box) {
  const seen = new Set();
  const out = [];
  for (const k of keysFor(box)) {
    const bucket = grid.get(k);
    if (!bucket) continue;
    for (const b of bucket) {
      if (seen.has(b)) continue;
      seen.add(b);
      out.push(b);
    }
  }
  return out;
}

/**
 * Lay `words` out as a cloud, shrinking the whole size ramp rather than dropping words, for as long
 * as shrinking helps.
 *
 * The order of the three responses matters and is the same order `beeswarm` uses, for the same
 * reason: the response that preserves the encoding is tried first.
 *
 *   1. **Shrink the ramp**, globally, so every word keeps its size RELATIVE to every other. A ramp
 *      shrunk per word would encode density by accident, on top of frequency on purpose.
 *   2. **Drop what still will not fit**, counted and named.
 *
 * A word wider than the entire field at the smallest ramp is never drawable, and dropping it is the
 * only honest option — truncating it would change what the word is.
 *
 * @param words sorted by weight descending, as {@link readTally} returns
 * @param field `{ W, H }`
 * @returns `{ boxes, k, dropped, oversize, floored }` — one box per placed word, the ramp factor
 *          that was needed, the words that found no room, the words too big for the field at any
 *          ramp, and how many were pinned to the minimum size
 *
 * @example layoutCloud([{ w: 'a', n: 1, g: -1 }], { W: 200, H: 200 }).boxes.length;   // 1
 */
export function layoutCloud(words, field) {
  const wmax = words.length ? words[0].n : 0;
  const rnd = mulberry32(fnv1a(seedOf(words)));

  /* Every phase is drawn ONCE, before any attempt, so a shrink does not shift the generator and
     redraw a different cloud. The sequence belongs to the tally, not to the attempt. */
  const phases = words.map(() => rnd() * Math.PI * 2);

  let best = null;
  let k = 1;
  for (let attempt = 0; attempt <= SHRINK_TRIES; attempt++) {
    const grid = newGrid();
    const boxes = [];
    const dropped = [];
    const oversize = [];
    let floored = 0;

    for (let i = 0; i < words.length; i++) {
      const row = words[i];
      const s = sizeFor(row.n, wmax, k);
      if (s.floored) floored++;
      const m = cellsOf(row.w);
      const bw = cellPx(m.cells, s.size) + 2 * PAD_X * s.size;
      const bh = s.size * (1 + 2 * PAD_Y);

      if (bw > field.W || bh > field.H) { oversize.push(row); continue; }

      const at = placeOne({ w: bw, h: bh }, phases[i], boxes, grid, field);
      if (!at) { dropped.push(row); continue; }

      at.row = row;
      at.size = s.size;
      at.approx = m.approx;
      at.rank = i + 1;
      boxes.push(at);
      gridAdd(grid, at);
    }

    const out = { boxes, k, dropped, oversize, floored };
    if (!best || boxes.length > best.boxes.length) best = out;
    if (!dropped.length && !oversize.length) return out;
    if (SIZE_MAX * k * SHRINK_BY < SIZE_FLOOR) break;
    k = k * SHRINK_BY;
  }
  return best || { boxes: [], k: 1, dropped: words.slice(), oversize: [], floored: 0 };
}

/* ── measuring the confound ──────────────────────────────────────────────────────────────── */

/**
 * How badly word length distorts this particular cloud.
 *
 * The refusal that kept this type out of the catalogue was that area encodes nothing reliably. That
 * is a claim about data, and a claim about data can be checked against the data in hand rather than
 * asserted in general — which is the entire reason this function exists.
 *
 * "Ink" here is the BOX area, width times height, not the filled pixels of the glyphs. Glyph
 * coverage would need a rasteriser and would tell a slightly different story (`iii` is a thin word
 * inside a wide box). Box area is the honest approximation because it is what a reader's sense of
 * "how much of this word is there" tracks, and because it is exactly the quantity the packing
 * reserved.
 *
 * `comparable` is counted apart from `pairs` and the inversion rate is quoted against it, because a
 * pair of equally frequent words CANNOT invert — there is no more-frequent one to out-ink. Quoting
 * against every pair would dilute the rate with pairs that were never at risk, and in the limit it
 * produces a sentence that is vacuously true and actively misleading: a tally where every word has
 * the same weight would report "no pair inverts, the more frequent word always covers the larger
 * area" about a set in which no word is more frequent than any other.
 *
 * @param boxes placed boxes, each carrying its `row`
 * @returns `{ pairs, comparable, inverted, worst, equal, top }` — how many pairs there are, how
 *          many of them differ in frequency at all, how many invert, the worst inversion with its
 *          ratio, the worst equal-weight ink difference, and the top word's frequency, size and
 *          area ratios against the smallest drawn word
 *
 * @example confound([]).pairs;   // 0
 */
export function confound(boxes) {
  const items = boxes.map((b) => ({
    word: b.row.w, n: b.row.n, area: b.w * b.h, size: b.size,
  }));

  const out = {
    pairs: items.length * (items.length - 1) / 2,
    comparable: 0,
    inverted: 0,
    worst: null,
    equal: null,
    top: null,
  };
  if (items.length < 2) return out;

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.n === b.n) {
        /* Equal frequency, different ink: the confound with nothing else mixed in. Whichever of the
           two covers more area is the one a reader will read as more common. */
        const hi = a.area >= b.area ? a : b;
        const lo = a.area >= b.area ? b : a;
        const ratio = lo.area > 0 ? hi.area / lo.area : 0;
        if (ratio > 1 && (!out.equal || ratio > out.equal.ratio)) {
          out.equal = { big: hi.word, small: lo.word, n: hi.n, ratio };
        }
        continue;
      }
      out.comparable++;
      const more = a.n > b.n ? a : b;
      const less = a.n > b.n ? b : a;
      if (less.area > more.area) {
        out.inverted++;
        const ratio = more.area > 0 ? less.area / more.area : 0;
        if (!out.worst || ratio > out.worst.ratio) {
          out.worst = {
            quiet: less.word, quietN: less.n,
            loud: more.word, loudN: more.n,
            ratio,
          };
        }
      }
    }
  }

  /* The squaring, which is a distortion independent of word length: font size is linear in
     frequency, so the box a word sits in grows as the SQUARE of it. Printing the three ratios side
     by side is what makes that legible — and it exposes the opposite error at the same time, since
     the minimum-size floor compresses the quiet end rather than exaggerating it. */
  const top = items[0];
  let tail = items[0];
  for (const it of items) if (it.n < tail.n) tail = it;
  if (tail !== top && tail.n > 0 && tail.size > 0 && tail.area > 0) {
    out.top = {
      word: top.word, tailWord: tail.word,
      freq: top.n / tail.n,
      size: top.size / tail.size,
      area: top.area / tail.area,
    };
  }
  return out;
}

/* ── the display lists ───────────────────────────────────────────────────────────────────── */

/** The ink band a word is drawn in: three steps of the desk's own text colour, by frequency. */
function bandOf(w, wmax) {
  if (!(wmax > 0)) return 2;
  const share = w / wmax;
  return share >= 0.66 ? 1 : share >= 0.33 ? 2 : 3;
}

/**
 * The cloud as a display list.
 *
 * @param laid  from {@link layoutCloud}
 * @param wmax  the largest weight, for the colour band
 * @param total the whole tally, for the share in each tooltip
 * @returns `{ marks, sizes }` — the marks, and every whole-pixel size used, so the stylesheet can
 *          carry a rule for each
 */
function cloudMarks(laid, wmax, total) {
  const marks = [];
  const sizes = new Set();

  for (const b of laid.boxes) {
    sizes.add(b.size);
    const share = total > 0 ? (b.row.n / total) * 100 : 0;
    const colour = b.row.g >= 0 ? 'ck-wc-g' + ((b.row.g % 8) + 1) : 'ck-wc-b' + bandOf(b.row.n, wmax);
    marks.push({
      t: 'text',
      a: {
        x: n2(b.x + b.w / 2, 'word'),
        y: n2(b.y + PAD_Y * b.size + ASCENT * b.size, 'word'),
        class: 'ck-wc-w ck-wc-f' + b.size + ' ' + colour,
        'text-anchor': 'middle',
      },
      s: b.row.w,
      ti: b.row.w + ' \u00b7 ' + CK.fmt(b.row.n) + ' \u00b7 rank ' + b.rank +
          ' \u00b7 ' + share.toFixed(share < 1 ? 2 : 1) + '% of the tally',
    });
  }
  return { marks, sizes };
}

/* The ranked form's geometry. A row per word, a label column, a stem and a dot. */
const ROW = 15;
const LABEL_W = 148;
const NUM_W = 46;
const RANK_SIZE = 10;

/**
 * The ranked form as a display list: the same tally with position along a common scale.
 *
 * This is `lollipop`'s picture, drawn here so the comparison the caption makes is one setting away
 * rather than one card away. Length is the only encoding and word length affects nothing — a label
 * that does not fit is truncated in the LABEL COLUMN, which is a fixed width, so it cannot change
 * how long a stem looks.
 *
 * @param words sorted by weight descending
 * @param total the whole tally, for the share in each tooltip
 * @returns `{ W, H, marks }`
 */
function rankedMarks(words, total) {
  const H = Math.round(14 + words.length * ROW + 10);
  const marks = [];
  const wmax = words.length ? words[0].n : 0;
  const x0 = LABEL_W + 10;
  const x1 = W0 - NUM_W - 8;
  const len = CK.scale([0, wmax > 0 ? wmax : 1], [0, Math.max(1, x1 - x0)]);

  for (let i = 0; i < words.length; i++) {
    const row = words[i];
    const y = 14 + i * ROW + ROW / 2;
    const end = x0 + len(row.n);
    const share = total > 0 ? (row.n / total) * 100 : 0;
    const colour = row.g >= 0 ? 'ck-wc-g' + ((row.g % 8) + 1) : 'ck-wc-b' + bandOf(row.n, wmax);

    marks.push({
      t: 'text',
      a: { x: n2(LABEL_W, 'label'), y: n2(y + 3.4, 'label'), class: 'ck-wc-lb', 'text-anchor': 'end' },
      s: clipTo(row.w, LABEL_W - 6, RANK_SIZE),
      ti: row.w + ' \u00b7 ' + CK.fmt(row.n) + ' \u00b7 rank ' + (i + 1) +
          ' \u00b7 ' + share.toFixed(share < 1 ? 2 : 1) + '% of the tally',
    });
    marks.push({
      t: 'line',
      a: { x1: n2(x0, 'stem'), y1: n2(y, 'stem'), x2: n2(end, 'stem'), y2: n2(y, 'stem'),
           class: 'ck-wc-stem' },
    });
    marks.push({
      t: 'circle',
      a: { cx: n2(end, 'dot'), cy: n2(y, 'dot'), r: 3.2, class: 'ck-wc-dot ' + colour },
    });
    marks.push({
      t: 'text',
      a: { x: n2(x1 + 8, 'n'), y: n2(y + 3.4, 'n'), class: 'ck-wc-num' },
      s: CK.fmt(row.n),
    });
  }

  return { W: W0, H, marks };
}

/* ── saying what the picture shows ───────────────────────────────────────────────────────── */

/** A count with its noun pluralised the boring, correct way. */
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/** A ratio as a readable multiplier, never printing a non-finite number into a caption. */
function times(r) {
  if (!Number.isFinite(r) || r <= 0) return '\u2014';
  return (r >= 10 ? Math.round(r) : Math.round(r * 10) / 10) + '\u00d7';
}

/**
 * A percentage that is never NaN, because a caption holding one fails the catalogue check.
 *
 * The zero guard is deliberately unreachable today: every caller is inside a branch that already
 * requires at least one comparable pair. Mutation testing confirmed that — removing it changes no
 * output — and it stays anyway, because the guard costs one comparison and the failure it prevents
 * is a catalogue fault naming a token nobody wrote. It is insurance for the next caller, not for
 * the current ones, and saying so here is cheaper than someone rediscovering it.
 */
function pct(part, whole) {
  if (!(whole > 0)) return '0';
  const v = (part / whole) * 100;
  if (!Number.isFinite(v)) return '0';
  return v >= 10 || v === 0 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

/**
 * Everything the card refused, merged or could not draw, as one list of clauses.
 *
 * Kept apart from the rest of the caption because it is the same list whatever picture is being
 * drawn, and because it is the part that must never quietly go missing: a tally that dropped a
 * negative weight without saying so has told the reader the corpus is different from what it is.
 *
 * @param read from {@link readTally}
 * @param laid from {@link layoutCloud}, or null in the ranked form
 * @param shown how many words the picture draws
 * @returns a list of escaped clauses, each a complete statement without its terminal stop
 */
function refusals(read, laid, shown) {
  const st = read.stats;
  const e = CK.esc;
  const bits = [];

  /* Every clause below has a count for a subject, so every verb after it has to agree with that
     count. Getting this wrong is invisible in the common case, because the common case is plural —
     the singular branch only fires when exactly one thing was refused, which is exactly the run
     nobody eyeballs. These two helpers are the whole fix and they exist because a flattened read of
     the output found "1 word ran past 300 characters and were cut". */
  const was = (n) => (n === 1 ? 'was' : 'were');
  const verb = (n, one, many) => (n === 1 ? one : many);

  if (read.words.length > shown) {
    bits.push('<b>' + e(String(read.words.length - shown)) + '</b> less frequent word' +
              (read.words.length - shown === 1 ? ' is' : 's are') + ' not drawn at all, which is ' +
              'this card\u2019s quietest lie: a word that is missing looks exactly like a word ' +
              'that never occurred');
  }
  if (st.merged) {
    bits.push(e(plural(st.merged, 'repeated entry', 'repeated entries')) + ' merged by summing, ' +
              'because one word drawn twice at two sizes is a picture arguing with itself');
  }
  if (st.caseClashes) {
    bits.push('<b>' + e(plural(st.caseClashes, 'word')) + '</b> ' +
              verb(st.caseClashes, 'appears', 'appear') + ' in more than one case and ' +
              was(st.caseClashes) + ' <i>not</i> merged \u2014 case can be the datum, and folding ' +
              'it is the caller\u2019s decision rather than the chart\u2019s');
  }
  if (st.negatives) {
    bits.push('<b>' + e(plural(st.negatives, 'negative weight')) + '</b> refused \u2014 a word ' +
              'cannot occur a negative number of times');
  }
  if (st.unreadable) {
    bits.push('<b>' + e(plural(st.unreadable, 'weight')) + '</b> could not be read as a number' +
              (st.badName ? ', starting with <i>' + e(st.badName) + '</i>' : '') +
              ', and ' + was(st.unreadable) + ' refused rather than coerced to zero');
  }
  if (st.zeros) {
    bits.push(e(plural(st.zeros, 'word')) + ' carried a weight of zero and ' + was(st.zeros) +
              ' dropped, since a word that occurred no times is not in the text');
  }
  if (st.blank) bits.push(e(plural(st.blank, 'blank entry', 'blank entries')) + ' skipped');
  if (st.stripped) {
    /* Phrased without a second plural verb on purpose. "1 word held control characters, which were
       stripped" is correct English — the `were` belongs to the characters — but it is
       indistinguishable, to any check and to a skimming reader, from the agreement bug two clauses
       up. Writing around it keeps the rule that catches the real thing free of exceptions. */
    bits.push(e(plural(st.stripped, 'word')) + ' held control characters, stripped out before ' +
              'anything else happened to ' + verb(st.stripped, 'it', 'them'));
  }
  if (st.trimmed) {
    bits.push(e(plural(st.trimmed, 'word')) + ' ran past ' + WORD_MAX + ' characters and ' +
              was(st.trimmed) + ' cut to that length, which changes what ' +
              verb(st.trimmed, 'it says', 'they say'));
  }
  if (st.dropped) {
    bits.push(e(plural(st.dropped, 'entry', 'entries')) + ' past the ' + READ_CAP +
              '-entry ceiling ' + was(st.dropped) + ' not read');
  }
  if (laid && laid.oversize.length) {
    bits.push('<b>' + e(plural(laid.oversize.length, 'word')) + '</b> \u2014 starting with <i>' +
              e(laid.oversize[0].w.slice(0, 24)) + '</i> at ' +
              e(String(laid.oversize[0].w.length)) + ' characters \u2014 ' +
              (laid.oversize.length === 1 ? 'is' : 'are') + ' wider than the whole card at the ' +
              'smallest readable size and could not be drawn; truncating a word would change what ' +
              'it is, so it is named here instead');
  }
  if (laid && laid.dropped.length) {
    bits.push('<b>' + e(plural(laid.dropped.length, 'word')) + '</b> found no free space in the ' +
              'packing and ' + was(laid.dropped.length) +
              ' left out rather than drawn on top of something');
  }
  if (laid && laid.k < 1) {
    bits.push('the whole size ramp was shrunk to ' + e(String(Math.round(laid.k * 100))) +
              '% so more words would fit \u2014 globally, so every word kept its size relative to ' +
              'every other');
  }

  return bits;
}

/**
 * The sentence a screen reader gets and the caption a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the picture to anyone using one, and
 * on a cloud that matters more than usual: the drawing is a hundred separate text nodes with no
 * whitespace between them, so a reader who fell through to the raw contents would get one
 * unbroken word. The label therefore has to carry the tally in prose.
 *
 * @param read  from {@link readTally}
 * @param shown the words the picture draws
 * @param laid  from {@link layoutCloud}, or null for the ranked form
 * @param conf  from {@link confound}, or null for the ranked form
 * @param opt   `{ layout, words }`
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function describe(read, shown, laid, conf, opt) {
  const e = CK.esc;

  if (!read.words.length) {
    const why = read.stats.negatives || read.stats.unreadable || read.stats.zeros ||
                read.stats.blank || read.stats.dropped;
    return {
      aria: 'Word cloud with no words to draw. ' +
            (why ? 'Every entry supplied was refused: see the caption for the counts.'
                 : 'Nothing was supplied.'),
      caption: 'a word cloud with <b>no words</b> \u2014 the card keeps its place on the desk, but ' +
               'there is nothing to tally. ' +
               (why ? '<span class="ck-aside">' + refusals(read, laid, 0).join('. ') + '.</span>'
                    : 'nothing was supplied, and nothing is implied.'),
    };
  }

  const total = read.words.reduce((a, b) => a + b.n, 0);
  const top = read.words[0];
  const tail = shown.length ? shown[shown.length - 1] : top;
  const stops = shown.filter((r) => STOPWORDS.has(r.w.toLowerCase())).length;
  const drawn = laid ? laid.boxes.length : shown.length;
  const approx = laid ? laid.boxes.filter((b) => b.approx).length
                      : shown.filter((r) => cellsOf(r.w).approx).length;
  const allSame = shown.length > 1 && shown.every((r) => r.n === shown[0].n);

  /* The subject of this clause is the stopword count, so the verb agrees with THAT and not with the
     total — "1 of 5 words drawn is a common English stopword" — and a picture drawing exactly one
     word skips the fraction entirely rather than saying "1 of 1". Both read as a bug otherwise, and
     only a flattened read of the prose finds them, because they live in branches that fire when a
     count happens to be one. */
  const stopLead = drawn === 1
    ? 'the <b>one</b> word drawn is a common English stopword'
    : '<b>' + e(String(stops)) + ' of ' + e(String(drawn)) + '</b> words drawn ' +
      (stops === 1 ? 'is a common English stopword' : 'are common English stopwords');

  /** The same sentence without markup, for the aria label. */
  const stopSay = drawn === 1
    ? 'The one word drawn is a common English stopword.'
    : stops + ' of the ' + drawn + ' words drawn ' +
      (stops === 1 ? 'is a common English stopword.' : 'are common English stopwords.');

  /* ── the ranked form ──────────────────────────────────────────────────────────────────── */

  if (opt.layout === 'ranked') {
    const rankRange = drawn === 1
      ? 'The only word shown is ' + top.w + ' at ' + CK.fmt(top.n) + '.'
      : top.n === tail.n
        ? 'Every word shown occurs ' + CK.fmt(top.n) + ' times, so the stems are all one length.'
        : 'The most frequent is ' + top.w + ' at ' + CK.fmt(top.n) + ', and the last shown is ' +
          tail.w + ' at ' + CK.fmt(tail.n) + '.';

    const aria =
      'Ranked list of the ' + drawn + ' most frequent of ' +
      plural(read.words.length, 'distinct word') + ', drawn as stems on a common scale. ' +
      rankRange + ' ' +
      'Only the length of a stem encodes a count here, so the length of the word itself changes ' +
      'nothing, which is the confound the cloud form of this card cannot avoid. ' +
      (stops ? stopSay : '');

    const doubts = [
      'this is the honest form and it is the same tally: position along a common scale was the ' +
      'most accurately read of the elementary encodings Cleveland and McGill ranked, and a ' +
      'word\u2019s letter count cannot reach it',
      'the label column is a fixed width, so a truncated label cannot shorten or lengthen the ' +
      'stem beside it',
      'this is <b>lollipop</b>\u2019s picture, and <b>lollipop</b> is the card to reach for when ' +
      'the ranking is all you wanted',
    ];
    if (stops) {
      doubts.push(stopLead + '; that is a fact about the corpus rather than about the drawing, ' +
                  'and the card counts them because it must not remove them');
    }
    for (const bit of refusals(read, null, shown.length)) doubts.push(bit);

    const rankSpan = drawn === 1
      ? ', the only one being <b>' + e(top.w) + '</b> at ' + e(CK.fmt(top.n))
      : top.n === tail.n
        ? ', every one of them occurring <b>' + e(CK.fmt(top.n)) + '</b> times'
        : ', from <b>' + e(top.w) + '</b> at ' + e(CK.fmt(top.n)) + ' down to <b>' +
          e(tail.w) + '</b> at ' + e(CK.fmt(tail.n));

    const caption =
      'the top <b>' + e(String(drawn)) + '</b> of <b>' + e(String(read.words.length)) +
      '</b> distinct words, <b>' + e(CK.fmt(total)) + '</b> occurrences in all' + rankSpan + '. ' +
      '<span class="ck-aside">' + doubts.join('. ') + '.</span>';

    return { aria: aria.trim(), caption };
  }

  /* ── the cloud ────────────────────────────────────────────────────────────────────────── */

  /* One drawn word makes "from X down to X" out of the same word twice, and a tally where every
     weight is equal makes "the most frequent" out of a set with no most-frequent member. Both read
     as a bug to anybody who notices, and both are one branch to avoid. */
  const range = drawn === 1
    ? 'The only word drawn is ' + top.w + ' at ' + CK.fmt(top.n) + '.'
    : top.n === tail.n
      ? 'Every word drawn occurs ' + CK.fmt(top.n) + ' times, so none is more frequent than any other.'
      : 'The most frequent is ' + top.w + ' at ' + CK.fmt(top.n) + '; the smallest drawn is ' +
        tail.w + ' at ' + CK.fmt(tail.n) + '.';

  const ariaBits = [
    'Word cloud of ' + plural(drawn, 'word') + ' from a tally of ' +
    plural(read.words.length, 'distinct word') + ' and ' + CK.fmt(total) + ' occurrences in all.',
    range,
    'Type size is proportional to frequency, but the area a word covers also grows with how many ' +
    'letters it has, so size and ink do not say the same thing.',
  ];
  if (conf && conf.worst) {
    ariaBits.push('The worst case here is ' + conf.worst.quiet + ', which occurs ' +
      CK.fmt(conf.worst.quietN) + ' times and covers ' + times(conf.worst.ratio) +
      ' the area of ' + conf.worst.loud + ', which occurs ' + CK.fmt(conf.worst.loudN) + ' times.');
    ariaBits.push(pct(conf.inverted, conf.comparable) + ' percent of the ' +
      plural(conf.comparable, 'pair') + ' that could invert do.');
  } else if (conf && conf.comparable > 0) {
    ariaBits.push('No pair inverts: across all ' + plural(conf.comparable, 'pair') +
      ' that could, the more frequent word always covers the larger area.');
  } else if (conf && conf.pairs > 0) {
    ariaBits.push('No two words here differ in frequency, so there is no pair that could invert ' +
      'and nothing the sizes can be checked against.');
  }
  if (stops) ariaBits.push(stopSay);
  ariaBits.push('Words that sit next to each other are neighbours because of the packing and not ' +
                'because they are related in the text.');

  const doubts = [];

  doubts.push('<b>size</b> is proportional to frequency and anchored at zero, so a word twice as ' +
              'often really is twice as tall \u2014 but a reader compares <b>ink</b>, and ink is ' +
              'size times letter count, which is not in the data');

  if (conf && conf.worst) {
    doubts.push('here that shows as <i>' + e(conf.worst.quiet) + '</i>, which occurs <b>' +
                e(CK.fmt(conf.worst.quietN)) + '</b> times and covers <b>' +
                e(times(conf.worst.ratio)) + '</b> the area of <i>' + e(conf.worst.loud) +
                '</i>, which occurs <b>' + e(CK.fmt(conf.worst.loudN)) + '</b> times');
    doubts.push('<b>' + e(String(conf.inverted)) + ' of ' + e(String(conf.comparable)) +
                '</b> word pairs invert like that \u2014 ' + e(pct(conf.inverted, conf.comparable)) +
                '% of every comparison in which one word IS more frequent than the other. pairs ' +
                'of equal weight are left out of that rate, since they had nothing to get wrong');
  } else if (conf && conf.comparable > 0) {
    doubts.push('in <i>this</i> tally no pair inverts: across all <b>' +
                e(plural(conf.comparable, 'pair')) + '</b> where one word is more frequent than ' +
                'the other, it also covers the larger area \u2014 so the ink can be trusted here ' +
                'even though it cannot be trusted in general');
  } else if (conf && conf.pairs > 0) {
    doubts.push('no two words here differ in frequency at all, so there is no pair that <i>could</i> ' +
                'invert and nothing to check the sizes against');
  } else {
    doubts.push('with fewer than two words drawn there is no pair to compare, so nothing here ' +
                'encodes anything at all');
  }

  if (conf && conf.equal) {
    doubts.push('the confound with nothing else mixed in: <i>' + e(conf.equal.big) + '</i> and <i>' +
                e(conf.equal.small) + '</i> both occur <b>' + e(CK.fmt(conf.equal.n)) +
                '</b> times and are set at the same size, yet one covers <b>' +
                e(times(conf.equal.ratio)) + '</b> the area of the other');
  }

  if (conf && conf.top) {
    doubts.push('and size is squared on its way to area: <i>' + e(conf.top.word) + '</i> is <b>' +
                e(times(conf.top.freq)) + '</b> the frequency of <i>' + e(conf.top.tailWord) +
                '</i>, <b>' + e(times(conf.top.size)) + '</b> the type size, and <b>' +
                e(times(conf.top.area)) + '</b> the area');
  }
  if (laid && laid.floored) {
    doubts.push('<b>' + e(plural(laid.floored, 'word')) + '</b> ' +
                (laid.floored === 1 ? 'sits' : 'sit') + ' at the minimum readable size rather ' +
                'than at ' + (laid.floored === 1 ? 'its' : 'their') + ' own \u2014 for ' +
                (laid.floored === 1 ? 'that one the picture <i>overstates</i> how often it occurs'
                                    : 'those the picture <i>overstates</i> how often they occur') +
                ', which is the opposite error to the one above and just as real');
  }
  if (allSame) {
    doubts.push('every word here has the <b>same weight</b>, so size encodes nothing and the only ' +
                'thing separating these words on the page is how long they happen to be');
  }

  if (stops) {
    doubts.push(stopLead + ' \u2014 the usual reason a cloud says more about English ' +
                'than about the corpus. the card counts them and does <i>not</i> remove them: ' +
                'which words are uninteresting is a property of your question, not of the text');
  } else {
    doubts.push('no common English stopword is among the words drawn, which is what a stripped ' +
                'corpus looks like \u2014 though the list is English only, so a corpus in another ' +
                'language will report this same zero whatever it contains');
  }

  doubts.push('<b>adjacency means nothing</b>: the layout is a spiral packing, and two words touch ' +
              'because of the order they were placed in and how much room was left');
  doubts.push('the layout is a pure function of the tally \u2014 sorted by weight then by code ' +
              'point, with one spiral phase per word from a generator seeded by the words ' +
              'themselves \u2014 so the same data draws the same picture on every load and in any ' +
              'input order');
  doubts.push('widths are computed from a monospace cell of ' + e(String(Math.round(EM * 10000) / 10000)) +
              'em, which is exact for Latin text' +
              (approx ? ', but <b>' + e(plural(approx, 'word')) + '</b> here contain wide or ' +
                        'combining characters where the width is estimated, and a collision the ' +
                        'layout believes it avoided can still show'
                      : ' and was used for every word here'));
  doubts.push('the <b>ranked</b> setting draws this same tally as stems on a common scale, where ' +
              'length is the only encoding and letter count reaches nothing \u2014 it is ' +
              '<b>lollipop</b>\u2019s picture, and <b>lollipop</b> is the card to reach for when ' +
              'the ranking is all you wanted');

  for (const bit of refusals(read, laid, shown.length)) doubts.push(bit);

  const span = drawn === 1
    ? ', the only one being <b>' + e(top.w) + '</b> at ' + e(CK.fmt(top.n))
    : top.n === tail.n
      ? ', every one of them occurring <b>' + e(CK.fmt(top.n)) + '</b> times'
      : ', from <b>' + e(top.w) + '</b> at ' + e(CK.fmt(top.n)) +
        ' down to <b>' + e(tail.w) + '</b> at ' + e(CK.fmt(tail.n));

  const caption =
    '<b>' + e(String(drawn)) + '</b> word' + (drawn === 1 ? '' : 's') + ' of <b>' +
    e(String(read.words.length)) + '</b> distinct, <b>' + e(CK.fmt(total)) +
    '</b> occurrences in all' + span + '. ' +
    '<span class="ck-aside">' + doubts.join('. ') + '.</span>';

  return { aria: ariaBits.join(' '), caption };
}

/* ── variants ────────────────────────────────────────────────────────────────────────────── */

/** The word counts the gear offers. A select, not a free number, so the layouts stay enumerable. */
const WORD_COUNTS = [25, 50, 100];

/** The two pictures. */
const LAYOUTS = ['cloud', 'ranked'];

/* Total marks across every precomputed variant. The whole enumeration is inline JSON in a page
   where every card's script is concatenated into one block, so past this the gear offers fewer
   choices — and only the ones actually built, so no control is ever a control that does nothing. */
const MARK_BUDGET = 1600;

/**
 * Lay the card out once per enumerable setting combination, within a size budget.
 *
 * Both settings change geometry, so each pair is a separate layout. Enumerating in Node rather than
 * laying out in the browser is what makes the determinism requirement airtight: a builder replay
 * paints a display list that was settled once, so it cannot produce a different picture, and there
 * is no second implementation of the packing to drift from this one.
 *
 * The build order is an axis order rather than a distance order, exactly as `treemap` does it: every
 * word count at the card's own layout first, then every layout at the card's own word count, then
 * the rest. So when the budget runs out, what survives is a cross through the defaults, which is the
 * set the two selects can navigate one axis at a time.
 *
 * @param read from {@link readTally}
 * @param cfg  the settled settings
 * @returns `{ variants, order, def, counts, layouts, skipped, seed }`
 */
function buildVariants(read, cfg) {
  /* Two word counts that both exceed the tally draw exactly the same picture, so offering both is a
     control that does nothing AND a second copy of the same display list and caption inline in a
     page where every card's script is one block. A three-word tally used to ship six variants and
     eighteen kilobytes of identical JSON. Only the smallest count that reaches each distinct
     effective size survives. */
  const seenSize = new Set();
  const counts = WORD_COUNTS.filter((n) => {
    const eff = Math.min(n, read.words.length);
    if (seenSize.has(eff)) return false;
    seenSize.add(eff);
    return true;
  });

  /* The card may have been asked for a count that no longer exists. Snap rather than fall through,
     so the panel's selected option and the picture on the page cannot disagree. */
  if (!counts.includes(cfg.words)) {
    let near = counts[0];
    for (const n of counts) if (Math.abs(n - cfg.words) < Math.abs(near - cfg.words)) near = n;
    cfg = { ...cfg, words: near };
  }

  const countOrder = counts.slice().sort((a, b) =>
    (Math.abs(a - cfg.words) - Math.abs(b - cfg.words)) || (a - b));
  const layoutOrder = LAYOUTS.slice().sort((a, b) =>
    (a === cfg.layout ? 0 : 1) - (b === cfg.layout ? 0 : 1));

  const wanted = [];
  const seen = new Set();
  const want = (l, n) => {
    const k = l + '|' + n;
    if (seen.has(k)) return;
    seen.add(k);
    wanted.push({ l, n, k });
  };
  for (const n of countOrder) want(cfg.layout, n);
  for (const l of layoutOrder) want(l, cfg.words);
  for (const l of layoutOrder) for (const n of countOrder) want(l, n);

  const variants = {};
  const order = [];
  const sizes = new Set();
  let used = 0;
  let skipped = 0;

  for (const w of wanted) {
    if (used > MARK_BUDGET && order.length) { skipped++; continue; }
    const shown = read.words.slice(0, w.n);
    let built;
    if (w.l === 'ranked') {
      const r = rankedMarks(shown, read.words.reduce((a, b) => a + b.n, 0));
      const note = describe(read, shown, null, null, { layout: 'ranked', words: w.n });
      built = { W: r.W, H: r.H, marks: r.marks, cap: note.caption, aria: note.aria };
    } else {
      const field = fieldFor(shown.length);
      const laid = layoutCloud(shown, field);
      const conf = confound(laid.boxes);
      const cm = cloudMarks(laid, shown.length ? shown[0].n : 0,
                            read.words.reduce((a, b) => a + b.n, 0));
      const note = describe(read, shown, laid, conf, { layout: 'cloud', words: w.n });
      for (const s of cm.sizes) sizes.add(s);
      built = { W: field.W, H: field.H, marks: cm.marks, cap: note.caption, aria: note.aria };
    }
    variants[w.k] = built;
    order.push(w.k);
    used += built.marks.length;
  }

  return {
    variants, order, skipped, cfg, sizes: [...sizes].sort((a, b) => a - b),
    def: cfg.layout + '|' + cfg.words,
    counts: counts.filter((n) => variants[cfg.layout + '|' + n]),
    layouts: LAYOUTS.filter((l) => variants[l + '|' + cfg.words]),
  };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Serialise a value as a JavaScript literal that is safe inside a classic `<script>` element.
 *
 * Five escapes, and every one of them is a real failure this card can actually suffer, because its
 * strings come out of somebody else's corpus:
 *
 * - `<` and `>` so a word spelled `</script>` cannot end the block early, and so no word can put
 *   an arrow function's two characters into a file that is contractually free of them.
 * - the backtick, so a word cannot open a template literal.
 * - **`?`**, which is the one the neighbouring cards do not escape and the one this card needs
 *   most: a word ending `?` beside a key beginning `.` puts `?.` into the payload, and the guard
 *   then refuses the build with a message about optional chaining that points at a corpus.
 * - the two Unicode line separators, which are newlines to a JS parser and not to `JSON.stringify`.
 *
 * DEL goes too. `JSON.stringify` escapes the C0 controls and not `0x7f`, so a word carrying one
 * survives serialisation intact and lands raw in the emitted script. It is stripped when the tally
 * is read; this is the belt to that pair of braces, and it is written with `String.fromCharCode`
 * rather than as a literal or a character class, because writing the class is how the class gets
 * corrupted.
 *
 * @example jsLit({ w: '</script>' });   // '{"w":"\\u003c/script\\u003e"}'
 * @example jsLit({ w: 'why?' });        // '{"w":"why\\u003f"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .split(String.fromCharCode(96)).join('\\u0060')
    .split(String.fromCharCode(127)).join('\\u007f')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
}

/** One display-list mark as SVG source, so the card is already drawn before any script runs. */
function svgInner(marks) {
  const parts = [];
  for (const m of marks) {
    let s = '<' + m.t;
    for (const k of Object.keys(m.a)) {
      if (m.a[k] == null || m.a[k] === '') continue;
      s += ' ' + k + '="' + CK.esc(m.a[k]) + '"';
    }
    if (m.s == null && m.ti == null) { parts.push(s + '/>'); continue; }
    s += '>';
    if (m.ti != null) s += '<title>' + CK.esc(m.ti) + '</title>';
    if (m.s != null) s += CK.esc(m.s);
    parts.push(s + '</' + m.t + '>');
  }
  return parts.join('');
}

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-wordcloud[data-card="' + id + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The card's stylesheet.
 *
 * Not one literal colour: every value is a desk token, so the light switch is the only thing that
 * has to know anything, and `prefers-color-scheme` is deliberately absent.
 *
 * The per-size rules exist because of a specificity rule that is easy to get wrong and silent when
 * you do: `kit.css` sets `.ck-plot text { font-size: 9px }`, and ANY CSS declaration beats an SVG
 * presentation attribute. A `font-size="22"` on the element would be ignored and every word in the
 * cloud would come out 9px tall — a card that looks like a bad packing rather than like a
 * stylesheet collision. An inline `style` attribute would win, but it needs `style-src
 * 'unsafe-inline'` in a page whose whole posture is a strict CSP, so the sizes are quantised to
 * whole pixels and emitted as one class each instead. There are at most a few dozen.
 *
 * The colour bands are the desk's three text weights rather than the series palette, because on
 * this card colour must encode frequency REDUNDANTLY or nothing at all — a rainbow that means
 * nothing is the same sin as an area that means nothing. The series palette appears only when the
 * data actually supplies groups, where colour is carrying a real second variable.
 */
function cardCss(id, sizes) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot .ck-wc-w', 'font-weight: 600;'],
    ['.ck-plot .ck-wc-b1', 'fill: var(--ink);'],
    ['.ck-plot .ck-wc-b2', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-wc-b3', 'fill: var(--ink-faint);'],

    ['.ck-plot .ck-wc-lb', 'fill: var(--ink-dim); font-size: 10px;'],
    ['.ck-plot .ck-wc-num', 'fill: var(--ink-faint); font-size: 10px;'],
    ['.ck-plot .ck-wc-stem', 'stroke: var(--rule); stroke-width: 1;'],
    ['.ck-plot .ck-wc-dot', 'stroke: none;'],

    ['.ck-legend i', 'border-radius: 1px;'],
    ['.ck-cap', 'overflow-wrap: anywhere;'],
  ];

  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-plot .ck-wc-g' + i, 'fill: var(--ck-s' + i + ');']);
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }
  for (const s of sizes) {
    rules.push(['.ck-plot .ck-wc-f' + s, 'font-size: ' + s + 'px;']);
  }

  return scope(id, rules) + '\n';
}

/**
 * The legend: one entry per supplied group.
 *
 * Every entry but the last carries a trailing comma INSIDE its own span, which looks like ordinary
 * punctuation and exists for a reason worth naming: flattened to text, two adjacent inline elements
 * have nothing between them, so `newssports` is what a screen reader or a text extractor sees where
 * a sighted reader sees two words separated by a flex gap. The comma is the separator that survives
 * flattening.
 */
function legendHtml(groups) {
  if (!groups.length) return '';
  const items = groups.slice(0, 8).map((g, i) =>
    '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g) +
    (i < Math.min(groups.length, 8) - 1 || groups.length > 8 ? ',' : '') + '</span>').join('');
  const more = groups.length > 8
    ? '<span>' + CK.esc('and ' + (groups.length - 8) + ' more') + '</span>' : '';
  return '  <div class="ck-legend">' + items + more + '</div>\n';
}

/** The card's markup: heading, gear, panel, the picture already drawn, a legend, the caption. */
function cardHtml(id, title, read, seed, built, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;
  const sel = (name, values, chosen, render) =>
    '<select id="' + f(name) + '" name="' + name + '">' +
    values.map((v) => '<option value="' + CK.esc(v) + '"' +
      (String(v) === String(chosen) ? ' selected' : '') + '>' +
      CK.esc(render ? render(v) : v) + '</option>').join('') +
    '</select>';

  const foot = 'The cloud sizes each word in proportion to how often it occurs, which a reader ' +
    'then reads as area \u2014 and area also grows with letter count, which is not in your data. ' +
    'The ranked form draws the same tally on a common scale, where only length encodes a count. ' +
    'Every combination here was laid out when the card was built, so switching repaints rather ' +
    'than re-packs and the picture cannot change under you.' +
    (built.skipped
      ? ' This tally is large, so only the choices listed were laid out; the rest were left out ' +
        'rather than shipped as inline geometry.'
      : '');

  return '<section data-card="' + CK.esc(id) + '" class="ck-wordcloud">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="wordcloud settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('layout') + '">picture</label>\n' +
    '    ' + sel('layout', built.layouts, cfg.layout,
                 (v) => (v === 'ranked' ? 'ranked, on a common scale' : 'cloud, packed')) + '\n' +
    '    <label for="' + f('words') + '">words</label>\n' +
    /* "top 25" is a lie when the tally is shorter than 25, and it is the shape of lie this card is
       about, so the label says "all 3" when the count reaches the whole tally. */
    '    ' + sel('words', built.counts, cfg.words,
                 (v) => (read.words.length && v >= read.words.length
                   ? 'all ' + read.words.length : 'top ' + v)) + '\n' +
    '    <p class="ck-set-foot">' + CK.esc(foot) + '</p>\n' +
    '  </div>\n' +
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.aria) + '">' + svgInner(seed.marks) + '</svg></div>\n' +
    legendHtml(read.groups) +
    '  <div class="ck-cap">' + seed.cap + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: a display-list painter and nothing that decides anything.
 *
 * Classic script, ES5 vocabulary — `var`, `function`, no arrow functions, no template literals, no
 * optional chaining — built by concatenation and put through {@link guardEmitted} before it leaves.
 *
 * There is no packing code here at all, and that is the determinism requirement taken at its
 * strongest rather than at its cheapest. A browser-side layout seeded from the data would also be
 * reproducible, but it would be a second implementation of the spiral, it would re-run on every
 * `<main>` swap, and it would leave the static render blank. Painting a display list settled in
 * Node has none of those properties.
 *
 * `render` clears the plot before it draws, which is what makes a builder replay replace the
 * picture rather than stack a second copy of it on top.
 *
 * @param id       the card's `data-card`
 * @param payload  `{ v, def }` — every variant, keyed by layout and word count
 * @param settings the settings object `CK.settings` is seeded with
 */
function cardJs(id, payload, settings) {
  const L = [];
  L.push('/* wordcloud card: paints a display list that was packed when the card was built.');
  L.push('   The spiral, every collision test and the caption were all settled in Node, so this');
  L.push('   turns descriptions into elements and does not know what a word is. Nothing here is');
  L.push('   random, and nothing here re-lays-out: a replay repaints the same picture. */');
  L.push('CK.build(' + jsLit(id) + ', function (sec) {');
  L.push('');
  L.push('  var NS = "http://www.w3.org/2000/svg";');
  L.push('  var P = ' + jsLit(payload) + ';');
  L.push('  var DEFAULTS = ' + jsLit(settings) + ';');
  L.push('');
  L.push('  var plot = sec.querySelector("svg.ck-plot");');
  L.push('  var cap = sec.querySelector(".ck-cap");');
  L.push('  if (!plot) { return; }');
  L.push('');
  L.push('  /* One display-list entry as a real element. The attribute names are the SVG ones, so');
  L.push('     this stays a translator rather than a second place where layout decisions live. */');
  L.push('  function node(m) {');
  L.push('    var e = document.createElementNS(NS, m.t), a = m.a, k, tip;');
  L.push('    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }');
  L.push('    if (m.ti != null) {');
  L.push('      tip = document.createElementNS(NS, "title");');
  L.push('      tip.textContent = m.ti;');
  L.push('      e.appendChild(tip);');
  L.push('    }');
  L.push('    /* textContent AFTER the title, or assigning it would wipe the title back out. */');
  L.push('    if (m.s != null) { e.appendChild(document.createTextNode(m.s)); }');
  L.push('    return e;');
  L.push('  }');
  L.push('');
  L.push('  /* A select hands back a string, so a stored count of 50 and a default of 50 are a');
  L.push('     string and a number. Every lookup is built from String() so the two cannot');
  L.push('     disagree, and an unbuilt combination falls back to the one the card shipped. */');
  L.push('  function keyOf(cfg) {');
  L.push('    var k = String(cfg.layout) + "|" + String(cfg.words);');
  L.push('    return P.v[k] ? k : P.def;');
  L.push('  }');
  L.push('');
  L.push('  function render(cfg) {');
  L.push('    var V = P.v[keyOf(cfg)], i;');
  L.push('    if (!V) { return; }');
  L.push('');
  L.push('    while (plot.firstChild) { plot.removeChild(plot.firstChild); }');
  L.push('    plot.setAttribute("viewBox", "0 0 " + V.W + " " + V.H);');
  L.push('    plot.setAttribute("aria-label", V.aria);');
  L.push('');
  L.push('    for (i = 0; i < V.marks.length; i++) { plot.appendChild(node(V.marks[i])); }');
  L.push('');
  L.push('    /* The caption is markup that was escaped value by value in Node; nothing from the');
  L.push('       corpus reaches it unescaped, which is why it may be assigned rather than built. */');
  L.push('    if (cap) { cap.innerHTML = V.cap; }');
  L.push('  }');
  L.push('');
  L.push('  CK.settings(sec, DEFAULTS, render);');
  L.push('});');
  return guardEmitted(L.join('\n') + '\n', 'wordcloud');
}

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * Fold a caller's seed onto the defaults, coercing rather than refusing.
 *
 * A descriptor may be hand-edited, and a typo in `layout` should give a working cloud rather than
 * an empty box.
 *
 * @example settle({ layout: 'nope' }).layout;   // 'cloud'
 */
function settle(seed) {
  const out = { ...defaults };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  if (!LAYOUTS.includes(out.layout)) out.layout = defaults.layout;
  out.words = WORD_COUNTS.includes(Number(out.words)) ? Number(out.words) : defaults.words;
  return out;
}

/**
 * Build one wordcloud card from one tally.
 *
 * Degenerate inputs and what they draw. Every one of these is a case somebody will hit, so every
 * one of them has an answer rather than an exception:
 *
 *   no data              an empty field, captioned "no words"; the card keeps its place
 *   one word             one word at the centre at the top of the ramp. The caption says there is
 *                        no pair to compare and therefore nothing encoded
 *   two of equal weight  the same size and, unless they are the same length, different ink. This is
 *                        the confound at its purest and the caption names the pair and the ratio
 *   all weights equal    size encodes nothing; the caption says so, and says that word length is
 *                        then the only thing separating the words on the page
 *   duplicate words      MERGED by summing, counted, and reported. Contributions are sorted before
 *                        they are added, so the merge is bit-identical in any input order
 *   words differing
 *   only by case         NOT merged; counted and reported. Case can be the datum
 *   a zero weight        dropped and counted, because a word that occurred no times is not in the
 *                        text and drawing it at any size claims that it is
 *   a negative weight    REFUSED and counted; there is no size for minus five
 *   a non-finite weight  REFUSED, counted, and the first offender named, because a NaN in a tally is
 *                        one bad division upstream and knowing which word carries it is the fix
 *   2000 words           read up to 20,000, drawn up to the top 100. What is not drawn is counted
 *                        and called out as the cloud's quietest lie
 *   a word wider than
 *   the card             the whole ramp shrinks first, so relative sizes survive; a word still too
 *                        wide at the smallest readable size is dropped and NAMED, with its length.
 *                        Truncating it would change what the word is
 *   a 300-char word      cut to 300 characters at read time, counted, and then almost certainly
 *                        dropped by the case above, named both times
 *   a one-char word      nothing special; one cell wide
 *   CJK and emoji        drawn, with widths estimated at two monospace cells per character. The
 *                        count of such words is printed, because the estimate can be wrong and a
 *                        wrong estimate is an overlap the layout believes it avoided
 *   markup as a word     `</script>` and `<img src=x onerror=1>` are text: escaped into the markup
 *                        with `CK.esc`, escaped into the payload as `\u003c`, never parsed
 *   a word holding `?`   escaped as `\u003f` in the payload, so it cannot form `?.` beside the next
 *                        key and trip this file's own guard
 *   both themes          every colour is a token; there is no `prefers-color-scheme` anywhere
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ words }`, plus an optional `settings` seed — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the layout produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; malformed input never throws, it is counted and reported
 *
 * @example
 * build({
 *   id: 'terms',
 *   title: 'what the incident reports talk about',
 *   data: { words: { timeout: 41, retry: 33, deploy: 28, rollback: 12 } },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'wordcloud' : id);
  const heading = String(title == null ? 'Wordcloud' : title);
  const read = readTally(data);
  /* `buildVariants` may snap the word count onto one it actually built, so the settled config comes
     back OUT of it rather than only going in — the panel, the seed key and `card.json` all have to
     agree about which picture shipped. */
  const built = buildVariants(read, settle(data && typeof data === 'object' ? data.settings : null));
  const cfg = built.cfg;

  const seedKey = built.variants[built.def] ? built.def : built.order[0];
  const seed = built.variants[seedKey] || { W: W0, H: 200, marks: [], cap: '', aria: '' };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      title: heading,
      settings: cfg,
      distinct: read.words.length,
      occurrences: read.words.reduce((a, b) => a + b.n, 0),
      refused: read.stats.negatives + read.stats.unreadable,
      merged: read.stats.merged,
      seed: fnv1a(seedOf(read.words)),
    },
    html: cardHtml(cardId, heading, read, seed, built, cfg),
    css: cardCss(cardId, built.sizes),
    js: cardJs(cardId, { v: built.variants, def: seedKey }, cfg),
  };
}

export default {
  meta, defaults, build, guardEmitted,
  readTally, layoutCloud, confound, cellsOf, fnv1a, mulberry32,
};
