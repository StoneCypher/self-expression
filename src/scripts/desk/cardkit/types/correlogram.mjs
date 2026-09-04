/**
 * `correlogram` -- the correlation matrix of a table as a grid, seriated so blocks fall together.
 *
 * **How this differs from `splom`, which also computes correlations.** A scatterplot matrix draws
 * the SHAPES: n squared little scatter panels, each column's own distribution down the diagonal,
 * and r printed in the upper triangle as an annotation on the pictures. It answers "what does this
 * pair actually look like". Because every panel needs enough pixels to be a picture, it caps at
 * eight columns -- sixty-four panels is already past what a reader compares.
 *
 * A correlogram draws the NUMBERS and nothing else. That is a real loss and a real gain. The loss
 * is the one `splom` exists to prevent: r is a single number and it cannot tell a clean line from
 * a line plus one outlier doing all the work. The gain is that a cell costs fifteen pixels instead
 * of seventy-six, so twenty or thirty columns fit where eight was the limit -- and at that size a
 * different question becomes answerable, which is "which GROUPS of variables move together". That
 * question needs the ordering, and the ordering is the other thing this card has that a splom does
 * not: the columns are permuted to bring correlated ones adjacent, so a block of mutual
 * correlation becomes a visible square instead of a scatter of dark cells nobody can group by eye.
 *
 * The two are complements, not rivals, and the honest workflow uses both: a correlogram over
 * everything to find which handful of columns are worth looking at, then a splom over that handful
 * to find out whether r was telling the truth about them.
 *
 * **What r cannot see, said here because the picture cannot say it.** Pearson's r measures LINEAR
 * association only. A perfect parabola -- y equal to x squared, sampled symmetrically about its
 * vertex -- scores exactly zero, and this card will paint that cell blank while the two columns
 * are as related as two columns can be. It is also not causation, and a grid of numbers is
 * unusually good at implying that it is; it is sensitive to a single outlier, which can create or
 * destroy a strong r by itself; and it is undefined for a column that never varies, where it is
 * shown as an em dash and never as zero, because zero asserts an independence nobody measured.
 *
 * @see ./splom.mjs -- the same pairs as pictures, for the handful this card says are interesting
 * @see ./matrix.mjs -- the same seriation idea on an incidence matrix rather than a correlation one
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. A bare context carrying a `window` object is enough to run it.
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
  catch (e) {
    throw new Error('cardkit/correlogram: cannot read ' + where.pathname + ' -- ' + e.message);
  }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/correlogram: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* -- constants ------------------------------------------------------------------------- */

/** Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/**
 * The most columns this card will draw, and why the number is not eight.
 *
 * A splom caps at eight because a panel needs pixels to be a picture. A correlogram's cell is one
 * fill and at most four characters, so the binding constraint is different: it is the point at
 * which the row and column labels stop fitting beside a cell small enough to keep the whole grid
 * on one screen. Thirty columns is 435 distinct pairs at fifteen pixels a cell, which is a
 * readable block structure and an unreadable list of numbers -- which is exactly the trade this
 * card is for. Columns past the cap are NAMED in the caption, never silently dropped.
 */
const COL_MAX = 30;

/** How small a cell may get before a printed number is a smudge rather than a value. */
const VALUE_FLOOR = 18;

/** The three things `show` may say, and the two things `order` may say. */
const SHOW_MODES = ['value', 'colour', 'both'];
const ORDER_MODES = ['given', 'cluster'];

/**
 * The faintest and strongest a cell's fill may get, and the cap when a number sits on top of it.
 *
 * A cell at r of zero is still a measurement and gets the floor rather than nothing, so "measured
 * and near zero" and "not measurable" are different pictures. The cap exists because the value
 * text is drawn in `--ink` over the fill: past about six tenths, a dark-blue fill in the light
 * theme swallows near-black text. So the ramp reaches its full strength only when there is no
 * number on it.
 */
const FILL_LO = 0.08;
const FILL_HI = 0.92;
const FILL_TEXT_CAP = 0.6;

/* -- small shared arithmetic ------------------------------------------------------------ */

/**
 * Round to two decimals, refusing to emit a number that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console.
 *
 * @throws {Error} when `v` is NaN or infinite
 * @example n(1.005, 'x');   // 1
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/correlogram: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to four decimals -- a correlation needs more resolution than a pixel does. */
function n4(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/correlogram: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 10000) / 10000;
}

/** Width in px of a string set in the card's 9px mono face. */
function textW(s) { return String(s).length * CHW; }

/** Shorten a label to `max` px, keeping the head and marking the cut. */
function clip(s, max) {
  const str = String(s);
  const room = Math.floor(max / CHW);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a label containing a closing script tag cannot end the block
 * early, and so no label can put an arrow-function token into a file that is contractually free
 * of them. The question mark goes too, so a label with one before a dot cannot look like optional
 * chaining to a guard that scans raw text.
 *
 * @example jsonLit({ label: 'a>b' });   // '{"label":"a\\u003eb"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(/[`]/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The card's id as it may appear inside a double-quoted CSS attribute selector. */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-correlogram[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/* -- the build-time guard --------------------------------------------------------------- */

/**
 * Blank comment and string bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose -- one card was
 * refused because a comment said "the class is what CSS reads". Offsets are preserved so a
 * reported position still means something, and regex literals are recognised, because otherwise
 * the scanner desyncs on a quote inside one and blanks real code, turning a false positive into
 * the far worse false negative.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment and string contents replaced by spaces
 *
 * @example blankLiterals('var s = "class";').indexOf('class');   // -1
 */
function blankLiterals(src) {
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

/** Where an offset falls, said the way a stack trace would say it. */
function atOffset(src, off) {
  return 'line ' + (src.slice(0, off).split('\n').length) + ', offset ' + off;
}

/**
 * Refuse to emit a script that would take the whole desk down.
 *
 * Every card's script is concatenated into ONE inline block, so a single modern-syntax token in
 * one card is a parse error that blanks every card on the page. The hazard that actually bites is
 * a backtick inside a doc comment: the browser halves of these types ship through
 * `Function.prototype.toString()`, which carries their comments along. The character is never
 * written in this file; it is reached for as `String.fromCharCode(96)`.
 *
 * Two scans, deliberately different. Backtick, arrow and optional chain are hunted in the RAW
 * text, where none can appear innocently. `const`, `let` and `class` are hunted only OUTSIDE
 * comments and strings, because all three are ordinary English and a guard that fires on prose is
 * a guard somebody deletes.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming every token it found and where each one is
 *
 * @example guardEmitted('var a = 1;', 'demo');   // 'var a = 1;'
 * @example guardEmitted('let a = 1;', 'demo');   // throws: the keyword let at line 1
 */
export function guardEmitted(js, where) {
  const bad = [];
  const tick = String.fromCharCode(96);

  for (const [needle, what] of [[tick, 'a backtick'], ['=>', 'an arrow function'],
                                ['?.', 'optional chaining']]) {
    const at = js.indexOf(needle);
    if (at >= 0) bad.push(what + ' at ' + atOffset(js, at));
  }

  const code = blankLiterals(js);
  for (const word of ['const', 'let', 'class']) {
    const hit = new RegExp('(^|[^\\w$.])' + word + '[\\s({]').exec(code);
    if (hit) bad.push('the keyword ' + word + ' at ' + atOffset(js, hit.index));
  }

  /* Compared numerically rather than matched against a character class, because writing the
     class is how the class gets corrupted. Tab, newline and carriage return are text and stay. */
  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) {
    throw new Error('cardkit/correlogram: refusing to emit ' + where + ' -- ' + bad.join('; '));
  }
  return js;
}

/**
 * Walk a display list and refuse any coordinate that is not a finite number.
 *
 * @throws {Error} on the first non-finite number, naming the attribute it was on
 * @example assertFinite([{ t: 'rect', a: { width: 4 } }], 'default');   // undefined
 */
function assertFinite(marks, where) {
  for (const m of marks) {
    if (m.a) {
      for (const k of Object.keys(m.a)) {
        const v = m.a[k];
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error('cardkit/correlogram: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/correlogram: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.s != null && /NaN|Infinity/.test(String(m.s))) {
      throw new Error('cardkit/correlogram: text reads "' + m.s + '" in ' + where);
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/** Refuse prose that carries a non-number into the page, where it reads as a measurement. */
function assertClean(text, where) {
  if (/NaN|Infinity/.test(String(text))) {
    throw new Error('cardkit/correlogram: ' + where + ' reads "' + text + '"');
  }
  return text;
}

/* -- what the card is ------------------------------------------------------------------- */

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it rather than two sources that can disagree.
 *
 * @example defaults.order;   // 'cluster'
 */
export const defaults = { order: 'cluster', show: 'both', absolute: false };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.category;   // 'correlation-and-multivariate'
 */
export const meta = {
  name: 'correlogram',
  summary:
    'The correlation matrix of a table as a grid, on a diverging ramp centred at zero, with the ' +
    'columns permuted so correlated groups sit together.',
  shape:
    '{ columns: [{ key, label }], rows: [{ key: number }] } -- ' +
    'at most ' + COL_MAX + ' columns are drawn and the rest are named in the caption; a cell ' +
    'that is not a number removes its row from the pairs using that column and from no others; ' +
    'a column that never varies has an undefined r everywhere, shown as an em dash and never ' +
    'as zero',
  category: 'correlation-and-multivariate',
  defaults: { ...defaults },
};

/* -- reading the data ------------------------------------------------------------------- */

/** A refused value, quoted short enough to sit in a caption. */
function shortLit(v) {
  if (v === undefined) return 'absent';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? '"' + v + '"' : String(v);
  return s.length > 18 ? s.slice(0, 17) + '\u2026' : s;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * The interesting choice is the per-cell one, and it is the same one `splom` makes: a row with a
 * bad value in one column is KEPT, and simply does not take part in the pairs that use that
 * column. Dropping the whole row is what a table-shaped reader does, and on twenty columns one bad
 * cell would throw away nineteen good measurements. The consequence is that different pairs are
 * computed over different numbers of rows, so the count per pair is reported in the tooltip and
 * the total number of unusable cells is named in the caption.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ cols, rows, extra, bad, names }`
 *
 * @example readData({ columns: ['a'], rows: [{ a: 1 }] }).cols[0].key;   // 'a'
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawCols = Array.isArray(d.columns) ? d.columns : [];
  const rawRows = Array.isArray(d.rows) ? d.rows : [];

  const bad = { noKey: 0, dupe: 0, badCell: 0, badRow: 0 };
  const names = [];
  const cols = [];
  const extra = [];
  const seen = new Set();

  for (const raw of rawCols) {
    const o = raw && typeof raw === 'object' ? raw : { key: raw };
    if (o.key == null || String(o.key) === '') { bad.noKey++; continue; }
    const key = String(o.key);
    if (seen.has(key)) { bad.dupe++; continue; }
    seen.add(key);
    const label = String(o.label == null ? key : o.label);
    if (cols.length >= COL_MAX) { extra.push(label); continue; }
    cols.push({ key, label });
  }

  const rows = [];
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') { bad.badRow++; continue; }
    const vals = cols.map((c) => {
      const v = r[c.key];
      if (v == null || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) {
        bad.badCell++;
        if (names.length < 3) names.push(c.label + ': ' + shortLit(v));
        return null;
      }
      const num = Number(v);
      if (!Number.isFinite(num)) {
        bad.badCell++;
        if (names.length < 3) names.push(c.label + ': ' + shortLit(v));
        return null;
      }
      return num;
    });
    rows.push({ vals });
  }

  cols.forEach((c, a) => {
    let lo = Infinity;
    let hi = -Infinity;
    let count = 0;
    for (const row of rows) {
      const v = row.vals[a];
      if (v == null) continue;
      count++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!count) { lo = 0; hi = 0; }
    c.lo = lo;
    c.hi = hi;
    c.count = count;
    c.flat = !(hi > lo);
  });

  return { cols, rows, extra, bad, names, flats: cols.filter((c) => c.flat).map((c) => c.label) };
}

/**
 * Pearson correlation between two columns, over the rows where BOTH are numbers.
 *
 * Null when either column has no spread across those rows, or when fewer than two rows survive.
 * Returning zero there -- the common shortcut -- asserts an independence that nothing measured,
 * and on a grid of numbers a zero is indistinguishable from a measurement while a dash is not.
 *
 * The self-correlation is not special-cased to one, and that is deliberate: r of a constant column
 * with itself is zero over zero, which is undefined for exactly the same reason as its correlation
 * with anything else. A diagonal that prints 1.00 for a column that never varies would be the card
 * asserting the one thing it is careful never to assert.
 *
 * @param rows the kept rows
 * @param a    one column index
 * @param b    the other
 * @returns `{ r, m }` -- r in [-1, 1] or null, and the number of rows both columns had
 *
 * @example pearson([{ vals: [1, 2] }, { vals: [2, 4] }], 0, 1).r;   // 1
 */
function pearson(rows, a, b) {
  let m = 0;
  let sa = 0;
  let sb = 0;
  for (const r of rows) {
    if (r.vals[a] == null || r.vals[b] == null) continue;
    m++;
    sa += r.vals[a];
    sb += r.vals[b];
  }
  if (m < 2) return { r: null, m };
  const ma = sa / m;
  const mb = sb / m;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (const r of rows) {
    if (r.vals[a] == null || r.vals[b] == null) continue;
    const da = r.vals[a] - ma;
    const db = r.vals[b] - mb;
    num += da * db;
    va += da * da;
    vb += db * db;
  }
  if (!(va > 0) || !(vb > 0)) return { r: null, m };
  const out = num / Math.sqrt(va * vb);
  if (!Number.isFinite(out)) return { r: null, m };
  /* Float arithmetic can land a hair outside the range the statistic is defined on, and a
     correlation of 1.0000000000000002 printed as "1.00" is fine but stored is a lie. */
  return { r: Math.max(-1, Math.min(1, out)), m };
}

/* -- the seriation -------------------------------------------------------------------- */

/**
 * How unlike two columns are, for the purpose of deciding what to draw next to what.
 *
 * One minus the absolute correlation: two columns that move together belong side by side whether
 * they move the same way or opposite ways, because a strong negative correlation is exactly as
 * much of a relationship as a strong positive one and putting them apart would hide the block.
 *
 * An undefined r -- a constant column -- gets the maximum distance. That is a choice with a
 * consequence worth stating: constant columns drift to the ENDS of the ordering, which is where a
 * column that relates to nothing belongs. Giving them zero distance would sink them into whatever
 * block they happened to be adjacent to and imply a membership nobody measured.
 *
 * @example distOf([[null, 0.9], [0.9, null]], 0, 1);   // 0.09999999999999998
 */
function distOf(corr, a, b) {
  const r = corr[a][b];
  return r == null ? 1 : 1 - Math.abs(r);
}

/**
 * The total unlikeness between neighbours down one ordering.
 *
 * This is the bond-energy reading of a matrix: how much does each column differ from the one drawn
 * beside it? A low total means like sits beside like, which is what produces a visible block. It
 * is a proxy rather than a truth -- it cannot tell an interesting block from a boring one -- but
 * it is a proxy that can be MEASURED, so the caption can report what the reordering actually
 * bought and a test can assert the passes never spent it.
 *
 * @param order the column order to score
 * @param corr  the correlation matrix
 * @returns the total, zero for an ordering with fewer than two columns
 *
 * @example costOf([0, 1], [[null, 1], [1, null]], 2);   // 0
 */
function costOf(order, corr) {
  let s = 0;
  for (let i = 0; i + 1 < order.length; i++) s += distOf(corr, order[i], order[i + 1]);
  return s;
}

/**
 * A greedy chain: start from the closest pair and keep hanging the nearest column on an end.
 *
 * This is the global move. It finds the gross structure in one pass and optimises nothing in
 * particular, which is why two local passes follow it. Ties are broken by column index and every
 * comparison is strict, so the result does not depend on iteration luck and two builds of the same
 * data give the same ordering.
 *
 * @param corr the correlation matrix
 * @param k    how many columns
 * @returns an ordering of column indices
 *
 * @example greedyChain([[null, 0.9, 0], [0.9, null, 0], [0, 0, null]], 3);   // [2, 0, 1]
 */
function greedyChain(corr, k) {
  if (k < 2) {
    const trivial = [];
    for (let i = 0; i < k; i++) trivial.push(i);
    return trivial;
  }

  let bestA = 0;
  let bestB = 1;
  let bestD = Infinity;
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const d = distOf(corr, a, b);
      if (d < bestD) { bestD = d; bestA = a; bestB = b; }
    }
  }

  const chain = [bestA, bestB];
  const used = new Set(chain);
  while (chain.length < k) {
    let pick = -1;
    let head = false;
    let near = Infinity;
    for (let c = 0; c < k; c++) {
      if (used.has(c)) continue;
      const dh = distOf(corr, c, chain[0]);
      const dt = distOf(corr, c, chain[chain.length - 1]);
      if (dh < near) { near = dh; pick = c; head = true; }
      if (dt < near) { near = dt; pick = c; head = false; }
    }
    if (pick < 0) break;
    used.add(pick);
    if (head) chain.unshift(pick); else chain.push(pick);
  }
  return chain;
}

/**
 * Adjacent swaps to a local optimum. Only strict improvements are taken, so this cannot lose.
 *
 * @param order the ordering, permuted in place
 * @param corr  the correlation matrix
 * @returns how many swaps were made
 *
 * @example swapPass([1, 0], [[null, 0.5], [0.5, null]], 2);   // 0
 */
function swapPass(order, corr) {
  let total = 0;
  for (let round = 0; round < 200; round++) {
    let did = 0;
    for (let i = 0; i + 1 < order.length; i++) {
      const before = costOf(order, corr);
      const tmp = order[i];
      order[i] = order[i + 1];
      order[i + 1] = tmp;
      if (costOf(order, corr) < before - 1e-12) { did++; }
      else { order[i + 1] = order[i]; order[i] = tmp; }
    }
    total += did;
    if (!did) break;
  }
  return total;
}

/**
 * Lift each column out once and put it back wherever it fits best.
 *
 * Adjacent swaps cannot move a column past a neighbour that the move makes worse, even when six
 * places along there is a slot that makes everything better. Relocation is the cheapest repair for
 * that. One pass, in the current order, first best position wins, strict improvements only.
 *
 * @param order the ordering, permuted in place
 * @param corr  the correlation matrix
 * @returns how many columns moved
 *
 * @example relocatePass([0, 1, 2], corr);   // 0
 */
function relocatePass(order, corr) {
  let moves = 0;
  for (let pass = 0; pass < order.length; pass++) {
    const from = pass;
    const who = order[from];
    const rest = order.slice(0, from).concat(order.slice(from + 1));
    let bestAt = from;
    let bestCost = costOf(order, corr);
    for (let at = 0; at <= rest.length; at++) {
      if (at === from) continue;
      const trial = rest.slice(0, at).concat([who], rest.slice(at));
      const c = costOf(trial, corr);
      if (c < bestCost - 1e-12) { bestCost = c; bestAt = at; }
    }
    if (bestAt !== from) {
      moves++;
      const next = rest.slice(0, bestAt).concat([who], rest.slice(bestAt));
      for (let i = 0; i < next.length; i++) order[i] = next[i];
    }
  }
  return moves;
}

/**
 * The clustered ordering, or the given one when clustering did not actually help.
 *
 * Scored against the order the author supplied and DISCARDED when it is not strictly better. That
 * matters more than it sounds: a seriation always produces an ordering, and an ordering always
 * looks like it means something. Keeping one that scores worse than the order the author already
 * chose would be the card inventing a finding, so the comparison is made and the loser is thrown
 * away with the caption saying it happened.
 *
 * @param corr the correlation matrix
 * @param k    how many columns
 * @returns `{ order, given, cost, givenCost, kept, swaps, moves }`
 *
 * @example seriate([[null, 1], [1, null]], 2).kept;   // false
 */
function seriate(corr, k) {
  const given = [];
  for (let i = 0; i < k; i++) given.push(i);
  const givenCost = costOf(given, corr);
  if (k < 3) {
    return { order: given.slice(), given, cost: givenCost, givenCost, kept: false, swaps: 0, moves: 0 };
  }

  const order = greedyChain(corr, k);
  const swaps = swapPass(order, corr);
  const moves = relocatePass(order, corr);
  const cost = costOf(order, corr);

  if (!(cost < givenCost - 1e-12)) {
    return { order: given.slice(), given, cost, givenCost, kept: false, swaps, moves };
  }
  return { order, given, cost, givenCost, kept: true, swaps, moves };
}

/* -- the browser half ------------------------------------------------------------------- */

/**
 * The whole grid as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so the
 * function a test calls in Node is textually the function the page runs.
 *
 * The ramp is DIVERGING and centred at zero, which is the one thing a correlation ramp must get
 * right: r has a meaningful midpoint, and a sequential ramp over minus one to one would put the
 * most interesting value in the middle of a lightness run where nobody can find it. Two hues, one
 * per sign, each growing in strength away from zero, meeting at a neutral that means "measured,
 * and near nothing". An UNDEFINED r is not on that ramp at all: it gets no fill and a dashed
 * outline, a difference in kind rather than in degree, because a viewer cannot tell a very pale
 * shade from a slightly less pale one and "no measurement" shaded as "weak" is the single most
 * misleading thing this card could do.
 *
 * @param model the precomputed model: labels, the matrix, both orderings, the cell size
 * @param cfg   `{ order, show, absolute }`
 * @returns `{ w, h, marks, note, aria }`
 *
 * @example corrGeom(model, { order: 'given', show: 'both', absolute: false }).w;   // 316
 */
function corrGeom(model, cfg) {
  var i, j;
  var k = model.k;

  function r2(v) { return Math.round(v * 100) / 100; }
  function pick(v, list, fallback) {
    for (var q = 0; q < list.length; q++) { if (list[q] === v) { return v; } }
    return fallback;
  }

  var showMode = pick(cfg.show, model.showModes, model.showDef);
  var orderMode = pick(cfg.order, model.orderModes, model.orderDef);
  var absolute = cfg.absolute === true || cfg.absolute === 'true';

  if (!k) {
    return { w: 200, h: 40, marks: [], note: model.emptyNote, aria: model.emptyAria };
  }

  var order = orderMode === 'cluster' ? model.clusterOrder : model.givenOrder;
  var cell = model.cell;
  var labW = model.labW;
  var labH = model.labH;
  var w = labW + k * cell + 8;
  var h = labH + k * cell + 34;

  /* A number needs room. When the cell is too small to hold one legibly the card falls back to
     colour alone and says so, rather than printing a smudge and letting the reader squint. */
  var fs = Math.min(11, cell * 0.36);
  var roomForValues = cell >= model.valueFloor;
  var wantValues = showMode !== 'colour';
  var showValues = wantValues && roomForValues;
  var showFill = showMode !== 'value';
  var capped = showValues && showFill;

  var marks = [];

  for (i = 0; i < k; i++) {
    var rowCol = order[i];
    var y = labH + i * cell;
    marks.push({ t: 'text', a: { x: r2(labW - 5), y: r2(y + cell / 2 + 3.2), "class": 'lab',
                                 'text-anchor': 'end' }, s: model.clipRow[rowCol],
                 ti: model.colTip[rowCol] });

    var cx = labW + i * cell + cell / 2;
    marks.push({ t: 'text', a: { x: r2(cx), y: r2(labH - 5), "class": 'lab',
                                 'text-anchor': 'start',
                                 transform: 'rotate(-90 ' + r2(cx) + ' ' + r2(labH - 5) + ')' },
                 s: model.clipCol[rowCol], ti: model.colTip[rowCol] });
  }

  for (i = 0; i < k; i++) {
    for (j = 0; j < k; j++) {
      var a = order[i];
      var b = order[j];
      var rv = model.corr[a][b];
      var x = labW + j * cell;
      var yy = labH + i * cell;

      if (rv == null) {
        marks.push({ t: 'rect', a: { x: r2(x + 0.5), y: r2(yy + 0.5), width: r2(cell - 1),
                                     height: r2(cell - 1), "class": 'nil' },
                     ti: model.cellTip[a][b] });
        if (showValues) {
          marks.push({ t: 'text', a: { x: r2(x + cell / 2), y: r2(yy + cell / 2 + fs * 0.35),
                                       'font-size': r2(fs), "class": 'vnil',
                                       'text-anchor': 'middle' }, s: '\u2014' });
        }
        continue;
      }

      var mag = Math.abs(rv);
      if (showFill) {
        var hiCap = capped ? model.fillTextCap : model.fillHi;
        var op = model.fillLo + (hiCap - model.fillLo) * mag;
        var cls = absolute ? 'cpos' : (rv < 0 ? 'cneg' : 'cpos');
        if (!absolute && mag < 0.02) { cls = 'cmid'; }
        marks.push({ t: 'rect', a: { x: r2(x + 0.5), y: r2(yy + 0.5), width: r2(cell - 1),
                                     height: r2(cell - 1), "class": cls,
                                     'fill-opacity': r2(op) },
                     ti: model.cellTip[a][b] });
      } else {
        marks.push({ t: 'rect', a: { x: r2(x + 0.5), y: r2(yy + 0.5), width: r2(cell - 1),
                                     height: r2(cell - 1), "class": 'bare' },
                     ti: model.cellTip[a][b] });
      }

      if (showValues) {
        var shown = absolute ? model.absLab[a][b] : model.corrLab[a][b];
        marks.push({ t: 'text', a: { x: r2(x + cell / 2), y: r2(yy + cell / 2 + fs * 0.35),
                                     'font-size': r2(fs), "class": 'val',
                                     'text-anchor': 'middle' }, s: shown });
      }
    }
  }

  /* The ramp, drawn rather than described: thirteen swatches from one end of the scale to the
     other, so the reader can see that the middle is a middle and not a step. */
  var steps = 13;
  var lw = Math.min(190, Math.max(90, k * cell * 0.5));
  var lx = labW;
  var ly = h - 12;
  var sw = lw / steps;
  for (i = 0; i < steps; i++) {
    var t = absolute ? i / (steps - 1) : (i / (steps - 1)) * 2 - 1;
    var lmag = Math.abs(t);
    var lcls = absolute ? 'cpos' : (t < 0 ? 'cneg' : 'cpos');
    if (!absolute && lmag < 0.02) { lcls = 'cmid'; }
    marks.push({ t: 'rect', a: { x: r2(lx + i * sw), y: r2(ly - 8), width: r2(sw), height: 8,
                                 "class": lcls,
                                 'fill-opacity': r2(model.fillLo + (model.fillHi - model.fillLo) * lmag) } });
  }
  marks.push({ t: 'text', a: { x: r2(lx), y: r2(ly + 8), "class": 'tk', 'text-anchor': 'start' },
               s: absolute ? '0' : '-1' });
  marks.push({ t: 'text', a: { x: r2(lx + lw / 2), y: r2(ly + 8), "class": 'tk',
                               'text-anchor': 'middle' }, s: absolute ? '0.5' : '0' });
  marks.push({ t: 'text', a: { x: r2(lx + lw), y: r2(ly + 8), "class": 'tk', 'text-anchor': 'end' },
               s: '1' });
  marks.push({ t: 'text', a: { x: r2(lx + lw + 8), y: r2(ly - 1), "class": 'tk',
                               'text-anchor': 'start' },
               s: absolute ? 'strength, sign discarded' : 'r, two hues about zero' });

  var orderText = orderMode === 'cluster'
    ? (model.clusterKept
        ? 'the columns are permuted so correlated ones sit together; the reordering cut the ' +
          'neighbour distance from ' + model.givenCostLab + ' to ' + model.costLab + '. '
        : 'the clustering was scored against the given order and DISCARDED, because it did not ' +
          'beat it (' + model.costLab + ' against ' + model.givenCostLab + '); the given order ' +
          'stands. ')
    : 'the columns are in the order they were given. ';

  var absText = absolute
    ? 'the sign is discarded, so a strong negative and a strong positive look identical -- ' +
      'useful for finding structure, and a bad way to read a single pair. '
    : '';

  var smallText = wantValues && !roomForValues
    ? 'the cells are too small to print a number in, so the value is in the tooltip and the ' +
      'colour carries the reading. '
    : '';

  var note = orderText + absText + smallText + model.censusNote + model.caveat;
  var aria = 'Correlation matrix of ' + plural(k, 'column', 'columns') + ' over ' +
    plural(model.rowCount, 'row', 'rows') + '. ' + orderText + absText + model.censusNote +
    model.caveat;

  return { w: r2(w), h: r2(h), marks: marks, note: note, aria: aria };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every cell on the second pass.
 *
 * @example paintList(svg, [{ t: 'rect', a: { width: 4 } }]);
 */
function paintList(box, marks) {
  var NS = 'http://www.w3.org/2000/svg';
  function node(m) {
    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (m.s != null) { e.textContent = m.s; }
    if (m.ti != null) {
      tip = document.createElementNS(NS, 'title');
      tip.textContent = m.ti;
      e.appendChild(tip);
    }
    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }
    return e;
  }
  while (box.firstChild) { box.removeChild(box.firstChild); }
  var frag = document.createDocumentFragment();
  for (var j = 0; j < marks.length; j++) { frag.appendChild(node(marks[j])); }
  box.appendChild(frag);
}

/* -- emit -------------------------------------------------------------------------------- */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour; every value is a desk token. The diverging ramp is exactly two
 * series tokens and one ink, declared once each, so the two hues cannot silently become three.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-cg-scroll', 'max-height: 74vh; overflow-y: auto; margin-top: 2px;'],
    ['svg.ck-cg', 'display: block; width: 100%; height: auto;'],
    ['svg.ck-cg text', 'font-family: var(--mono); font-size: 9px;'],

    ['.ck-cg .cpos', 'fill: var(--ck-s6); stroke: var(--hairline); stroke-width: 0.5;'],
    ['.ck-cg .cneg', 'fill: var(--ck-s1); stroke: var(--hairline); stroke-width: 0.5;'],
    ['.ck-cg .cmid', 'fill: var(--ink); stroke: var(--hairline); stroke-width: 0.5;'],
    ['.ck-cg .bare', 'fill: var(--well); stroke: var(--hairline); stroke-width: 0.5;'],
    ['.ck-cg .nil',
     'fill: var(--ink); fill-opacity: .04; stroke: var(--rule); stroke-width: 0.6; ' +
     'stroke-dasharray: 2.5 2;'],

    ['.ck-cg .lab', 'fill: var(--ink-dim);'],
    ['.ck-cg .val', 'fill: var(--ink);'],
    ['.ck-cg .vnil', 'fill: var(--ink-faint);'],
    ['.ck-cg .tk', 'fill: var(--ink-faint); font-size: 8.5px;'],

    ['.ck-cg-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scope(id, rules) + '\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the grid and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The part that changes with the settings is an
 * empty element the script fills with `textContent`, never with markup.
 */
function cardHtml(id, title, R, said) {
  const e = CK.esc;
  const k = R.cols.length;

  const void_ = k ? '' :
    '  <div class="ck-cg-void">nothing to correlate &mdash; no columns were given</div>\n';

  const svg = k
    ? '  <div class="ck-scroll ck-cg-scroll">\n' +
      '    <svg class="ck-cg" role="img" viewBox="0 0 200 40" aria-label="' + e(said.aria) +
      '"></svg>\n  </div>\n'
    : '';

  return '<section data-card="' + e(id) + '" class="ck-correlogram">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-order">column order</label>\n' +
    '    <select id="' + e(id) + '-order" name="order">\n' +
    ORDER_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-show">each cell shows</label>\n' +
    '    <select id="' + e(id) + '-show" name="show">\n' +
    SHOW_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-absolute">strength only</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-absolute" name="absolute">\n' +
    '    <div class="ck-set-foot">the clustered order is scored against the given one and thrown ' +
    'away when it does not beat it, so a reordering you can see is a reordering that earned its ' +
    'place. at most ' + COL_MAX + ' columns are drawn.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(k)) + '</b> ' + (k === 1 ? 'column' : 'columns') +
    ' by <b>' + e(String(R.rows.length)) + '</b> ' + (R.rows.length === 1 ? 'row' : 'rows') +
    '. <i class="ck-cg-note">' + e(said.note) + '</i></div>\n' +
    '</section>\n';
}

/**
 * The browser half: pick the ordering the settings name, lay out the grid, paint it.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated on the way in: they come out
 * of `localStorage`, which is a text file the viewer can edit, and a mode read straight out of it
 * and used as a property name would reach `Object.prototype` on the string "constructor".
 */
function cardJs(id, model, inst) {
  const js =
    '/* correlogram card: the correlations and the seriation were computed in Node;\n' +
    '   only the grid layout happens here, because the ordering and the cell contents are\n' +
    '   viewer settings. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    'function plural(count, one, many) { return count + " " + (count === 1 ? one : many); }\n\n' +
    corrGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-cg");\n' +
    '  var note = sec.querySelector(".ck-cg-note");\n\n' +
    '  function draw(cfg) {\n' +
    '    var got = corrGeom(MODEL, cfg);\n' +
    '    if (note) { note.textContent = got.note; }\n' +
    '    if (!box || !MODEL.k) { return; }\n' +
    '    paintList(box, got.marks);\n' +
    '    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);\n' +
    '    box.style.minWidth = Math.ceil(got.w) + "px";\n' +
    '    box.setAttribute("aria-label", got.aria);\n' +
    '  }\n\n' +
    '  CK.settings(sec, DEF, draw);\n' +
    '});\n';
  return guardEmitted(js, id);
}

/**
 * Build one correlogram card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the whole matrix, both orderings and their
 *          scores, so a reader can check the caption without re-deriving anything
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'bench',
 *   title: 'which measures move together',
 *   data: {
 *     columns: [{ key: 'ms', label: 'latency' }, { key: 'mb', label: 'peak RSS' }],
 *     rows: [{ ms: 91, mb: 210 }, { ms: 140, mb: 180 }, { ms: 120, mb: 195 }],
 *   },
 *   ord: 44,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'correlogram' : id);
  const R = readData(data);
  const k = R.cols.length;

  const corr = R.cols.map(() => R.cols.map(() => null));
  const pairN = R.cols.map(() => R.cols.map(() => 0));
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      const got = pearson(R.rows, a, b);
      const v = got.r == null ? null : n4(got.r, 'corr');
      corr[a][b] = v;
      corr[b][a] = v;
      pairN[a][b] = got.m;
      pairN[b][a] = got.m;
    }
  }

  const ser = seriate(corr, k);

  /* The cell shrinks as the grid grows, with a floor: past the floor the grid would stop being
     readable at all, and the answer to that is fewer columns rather than smaller cells. */
  const cell = k ? Math.max(15, Math.min(40, Math.round(420 / Math.max(1, k)))) : 20;
  const longest = R.cols.reduce((m, c) => Math.max(m, textW(c.label)), 0);
  const labW = Math.round(Math.min(120, Math.max(26, longest))) + 6;
  const labH = Math.round(Math.min(96, Math.max(22, longest))) + 6;

  const clipRow = R.cols.map((c) => clip(c.label, labW - 8));
  const clipCol = R.cols.map((c) => clip(c.label, labH - 8));

  const corrLab = corr.map((row) => row.map((v) =>
    v == null ? '\u2014' : (v >= 0 ? '' : '\u2212') + Math.abs(v).toFixed(2)));
  const absLab = corr.map((row) => row.map((v) =>
    v == null ? '\u2014' : Math.abs(v).toFixed(2)));

  const cellTip = R.cols.map((ca, a) => R.cols.map((cb, b) =>
    (a === b ? ca.label + ' with itself' : ca.label + ' vs ' + cb.label) + ' \u00b7 ' +
    (corr[a][b] == null
      ? 'r undefined -- ' + (ca.flat || cb.flat ? 'a column that never varies has no correlation'
                                                : 'fewer than two rows have both values')
      : 'r ' + corr[a][b].toFixed(3)) +
    ' \u00b7 over ' + plural(pairN[a][b], 'row', 'rows')));

  const colTip = R.cols.map((c) =>
    c.label + ' \u00b7 ' + (c.flat ? 'constant at ' + CK.fmt(c.lo)
                                   : CK.fmt(c.lo) + ' to ' + CK.fmt(c.hi)) +
    ' \u00b7 ' + plural(c.count, 'value', 'values'));

  /* The census and the caveat travel with the model rather than being rebuilt in the browser,
     because both are statements about the DATA and neither changes with a setting. */
  const junk = [];
  if (R.flats.length) {
    junk.push(plural(R.flats.length, 'column never varies', 'columns never vary') + ' (' +
      R.flats.join(', ') + '), so r is undefined for every pair they are in and every one of ' +
      'those cells is a dash rather than a zero');
  }
  if (R.bad.badCell) {
    junk.push(plural(R.bad.badCell, 'cell was', 'cells were') + ' not a number' +
      (R.names.length ? ' (' + R.names.join(', ') + ')' : '') +
      ', so each pair is computed over the rows that had both values');
  }
  if (R.extra.length) {
    junk.push(plural(R.extra.length, 'column was', 'columns were') + ' past the limit of ' +
      COL_MAX + ' and is not drawn: ' + R.extra.join(', '));
  }
  if (R.bad.noKey) junk.push(plural(R.bad.noKey, 'column', 'columns') + ' had no key');
  if (R.bad.dupe) junk.push(plural(R.bad.dupe, 'column was', 'columns were') + ' a duplicate key');
  if (R.bad.badRow) junk.push(plural(R.bad.badRow, 'row was', 'rows were') + ' not an object');

  const censusNote = junk.length ? junk.join('; ') + '. ' : '';

  const caveat =
    'r is linear only: a parabola sampled symmetrically about its vertex scores exactly zero ' +
    'while being perfectly determined, so a blank cell means no LINE was found and not that ' +
    'nothing is there. it is also not causation, and one outlier can make or break a strong r.';

  const model = {
    k,
    rowCount: R.rows.length,
    cell, labW, labH,
    valueFloor: VALUE_FLOOR,
    fillLo: FILL_LO, fillHi: FILL_HI, fillTextCap: FILL_TEXT_CAP,
    corr, corrLab, absLab, cellTip, colTip, clipRow, clipCol,
    givenOrder: ser.given.slice(),
    clusterOrder: ser.order.slice(),
    clusterKept: ser.kept,
    costLab: k ? String(Math.round(ser.cost * 1000) / 1000) : '0',
    givenCostLab: k ? String(Math.round(ser.givenCost * 1000) / 1000) : '0',
    showModes: SHOW_MODES.slice(),
    orderModes: ORDER_MODES.slice(),
    showDef: defaults.show,
    orderDef: defaults.order,
    censusNote,
    caveat,
    emptyNote: 'no columns were given, so there is no matrix to draw.',
    emptyAria: 'An empty correlation matrix: no columns were given.',
  };

  const inst = { ...defaults };

  /* The browser half is exercised here over every configuration a viewer can reach, so a
     degenerate input that would produce a NaN coordinate is caught at build time next to the data
     that caused it rather than at paint time, where the browser drops the attribute in silence. */
  let active = null;
  for (const orderMode of ORDER_MODES) {
    for (const show of SHOW_MODES) {
      for (const absolute of [false, true]) {
        const got = corrGeom(model, { order: orderMode, show, absolute });
        assertFinite(got.marks, orderMode + '/' + show + '/absolute ' + absolute);
        assertClean(got.note, 'note for ' + orderMode + '/' + show);
        assertClean(got.aria, 'aria for ' + orderMode + '/' + show);
        if (orderMode === inst.order && show === inst.show && absolute === inst.absolute) {
          active = got;
        }
      }
    }
  }
  if (!active) active = corrGeom(model, inst);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'correlogram',
      columns: k,
      columnLimit: COL_MAX,
      columnsNotDrawn: R.extra,
      rows: R.rows.length,
      constantColumns: R.flats,
      correlation: corr,
      pairRows: pairN,
      order: { given: ser.given, cluster: ser.order, kept: ser.kept,
               cost: n4(ser.cost, 'cost'), givenCost: n4(ser.givenCost, 'cost'),
               swaps: ser.swaps, moves: ser.moves },
      refused: { columnsWithoutKey: R.bad.noKey, duplicateColumns: R.bad.dupe,
                 nonNumericCells: R.bad.badCell, badRows: R.bad.badRow },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active),
    css: cardCss(cardId),
    js: cardJs(cardId, model, inst),
  };
}

/* Exported for the verifier only: the statistics and the seriation beneath the picture, so a test
   can check r against a hand-computed Pearson and check that the reordering never spends its own
   objective. */
export { pearson, distOf, costOf, greedyChain, swapPass, relocatePass, seriate, corrGeom, readData };
