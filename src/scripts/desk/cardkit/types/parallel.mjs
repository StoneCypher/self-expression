/**
 * `parallel` -- parallel coordinates: one vertical axis per variable, one polyline per row.
 *
 * The chart exists to show a many-dimensional table as a picture, and it has exactly one trap,
 * which this card is built around: **every axis is scaled independently**. An axis runs from its
 * own column's smallest value to its own column's largest, so a line that sits high on one axis
 * and low on the next has NOT gone down in any shared sense -- it has gone from near the top of
 * one range to near the bottom of another, and those ranges may differ by six orders of
 * magnitude. A reader who assumes one shared scale reads the chart exactly backwards, and the
 * only defence is to say so where they will see it. So the caption says it, every time, first.
 *
 * The other decision worth reading is the axis ORDER. Parallel coordinates only compare
 * neighbours: a relationship between axis 1 and axis 6 is invisible, because no line segment
 * joins them. So the order decides which relationships the chart is able to show at all. This
 * card measures the thing that matters -- how many pairs of rows cross between each pair of axes
 * -- builds the whole matrix of those counts, and then orders the axes to minimise the total over
 * adjacent pairs. The count is reported before and after, and the search result is scored against
 * the order you gave, so the reordering can never make the picture worse than the one you asked
 * for.
 *
 * A crossing is not automatically bad, which is why the caption also reports correlation sign:
 * two axes that correlate strongly and negatively cross in one tidy X, and that X is a finding.
 * The objective is a proxy for legibility, not for truth, and the card says which.
 *
 * @see ./splom.mjs -- the same table, every pair of columns instead of every adjacent pair
 * @see ./arc.mjs -- the same "measure the crossings, then score the reordering" discipline
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
 * @example loadKit().scale([0, 10], [0, 1])(5);   // 0.5
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/parallel: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/parallel: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/** The desk column is comfortable at 620; wider than that scrolls inside `.ck-scroll`. */
const W0 = 620;
const H0 = 300;

/** Minimum horizontal room per axis. Below this the axis labels are unreadable whatever we clip. */
const AX_GAP_MIN = 62;

/**
 * The most axes this card will draw.
 *
 * Not a rendering limit -- it is a reading limit. Parallel coordinates only relate NEIGHBOURING
 * axes, so a chart of twenty axes offers nineteen comparisons out of the hundred and ninety that
 * exist, and the reader has no way to know which eighty-one per cent they are not being shown.
 * Past twelve the axes are also under fifty pixels apart on a desk column, which is narrower than
 * one tick label. Extra axes are named in the caption rather than silently dropped.
 */
const AX_MAX = 12;

/** How long an axis label or a value label may be before it is clipped, in px. */
const LAB_MAX = 58;

/** Past this many rows or axes the crossing matrix is not built and correlation stands in. */
const XING_ROW_CAP = 500;
const XING_AX_CAP = 16;

/** The two things `axisOrder` may say. */
const ORDER_MODES = ['given', 'correlation'];

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it.
 *
 * @example defaults.opacity;   // 0.55
 */
export const defaults = { curve: false, axisOrder: 'given', opacity: 0.55 };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'parallel'
 */
export const meta = {
  name: 'parallel',
  summary:
    'Parallel coordinates with every axis scaled independently, said out loud in the caption, ' +
    'and an axis order that minimises measured crossings between neighbours.',
  shape:
    '{ axes: [{ key, label, unit, invert, min, max }], rows: [{ key: number }], colorBy } -- ' +
    'invert flips one axis so its largest value is at the bottom; min and max only ever widen ' +
    'the axis, never clip it; colorBy names a column whose values become the line colours',
  defaults: { ...defaults },
};

/* -- small shared arithmetic ----------------------------------------------------------- */

/**
 * Round a number to two decimals, refusing to emit one that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console.
 *
 * @throws {Error} when `v` is NaN or infinite
 * @example n(0.6666, 'fraction');   // 0.67
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/parallel: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to four decimals -- fractions need more resolution than pixels do. */
function n4(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/parallel: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
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
 * `<` and `>` become escapes so a label containing `</script>` cannot close the block early, and
 * so no label can put `=>` into a file that is contractually free of arrow functions. The
 * question mark goes too, so a label reading "why?.who" cannot look like optional chaining to a
 * guard that scans raw text.
 *
 * @example jsonLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
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
  const own = '.ck-parallel[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/* -- the build-time guard -------------------------------------------------------------- */

/**
 * Blank comment and string bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose -- a card in this
 * catalogue was once refused because a comment said "the class is what CSS reads". Offsets are
 * preserved so a reported position still means something, and regex literals are recognised,
 * because otherwise the scanner desyncs on a quote inside one and blanks real code.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment and string contents replaced by spaces
 *
 * @example blankLiterals('var s = "let";').indexOf('let');   // -1
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
 * `Function.prototype.toString()`, which carries their comments along, so the backtick closes the
 * surrounding template literal early. The character is never written here; it is reached for as
 * `String.fromCharCode(96)`, which cannot be mistyped and cannot be mis-decoded.
 *
 * Two scans, deliberately different: backtick, arrow and optional chain in the RAW text, where
 * none can appear innocently; `const`, `let` and `class` only OUTSIDE comments and strings,
 * because all three are ordinary English and a guard that fires on prose gets switched off.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming every token it found and where each one is
 *
 * @example guardEmitted('var a = 1;', 'demo');       // 'var a = 1;'
 * @example guardEmitted('let a = 1;', 'demo');       // throws: the keyword let at line 1
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

  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) {
    throw new Error('cardkit/parallel: refusing to emit ' + where + ' -- ' + bad.join('; '));
  }
  return js;
}

/**
 * Walk a display list and refuse any coordinate that is not a finite number.
 *
 * The browser half computes geometry, so the usual build-time coordinate check cannot reach it.
 * Running the same function here over every configuration a viewer can select puts the check back.
 *
 * @throws {Error} on the first non-finite number, naming the attribute it was on
 * @example assertFinite([{ t: 'path', a: { d: 'M0,0' } }], 'default');   // undefined
 */
function assertFinite(marks, where) {
  for (const m of marks) {
    if (m.a) {
      for (const k of Object.keys(m.a)) {
        const v = m.a[k];
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error('cardkit/parallel: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/parallel: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/* -- reading the data ------------------------------------------------------------------ */

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * A row is dropped when any drawn axis holds something that is not a finite number, and the drop
 * is counted and named. That is the strict choice and it is deliberate: a polyline needs a point
 * on every axis, so a row with a hole leaves three options -- invent a value, break the line into
 * segments, or drop the row. Inventing lies. Breaking the line produces two short strokes that a
 * reader counts as two different rows, which lies harder. Dropping is the only one that can be
 * reported honestly, so it is reported: the caption names how many rows went and why.
 *
 * `min` and `max` on an axis only ever WIDEN the domain. An axis whose stated max is below its
 * data would otherwise clip -- drawing a value at the top of the axis as though it were the
 * maximum, which is a claim the data does not support -- so the data wins and the caption names
 * the axis and both numbers.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the counts above
 *
 * @example readData({ axes: ['a'], rows: [{ a: 1 }, { a: 3 }] }).axes[0].hi;   // 3
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawAxes = Array.isArray(d.axes) ? d.axes : [];
  const rawRows = Array.isArray(d.rows) ? d.rows : [];
  const colorBy = d.colorBy == null ? null : String(d.colorBy);

  const bad = { noKey: 0, dupeAxis: 0, badRow: 0, extraAxes: 0 };
  const axes = [];
  const seenKeys = new Set();

  for (const raw of rawAxes) {
    const o = raw && typeof raw === 'object' ? raw : { key: raw };
    if (o.key == null || String(o.key) === '') { bad.noKey++; continue; }
    const key = String(o.key);
    if (seenKeys.has(key)) { bad.dupeAxis++; continue; }
    seenKeys.add(key);
    if (axes.length >= AX_MAX) { bad.extraAxes++; continue; }
    axes.push({
      key,
      label: String(o.label == null ? key : o.label),
      unit: o.unit == null ? '' : String(o.unit),
      invert: !!o.invert,
      wantLo: Number.isFinite(Number(o.min)) ? Number(o.min) : null,
      wantHi: Number.isFinite(Number(o.max)) ? Number(o.max) : null,
    });
  }

  /* Rows are read once, whole. A row is kept only when every axis holds a finite number, so the
     later code never has to ask whether a value is there. */
  const rows = [];
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') { bad.badRow++; continue; }
    const vals = [];
    let ok = true;
    for (const ax of axes) {
      const v = r[ax.key];
      if (v == null || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) { ok = false; break; }
      const num = Number(v);
      if (!Number.isFinite(num)) { ok = false; break; }
      vals.push(num);
    }
    if (!ok || (axes.length && vals.length !== axes.length)) { bad.badRow++; continue; }
    rows.push({ vals, raw: r });
  }

  /* Domains. `pad` is deliberately absent: a parallel-coordinates axis runs from the smallest
     value to the largest and nothing else, because the top of the axis MEANS the biggest value in
     the column and padding it would make the top mean nothing in particular. */
  const clipped = [];
  axes.forEach((ax, a) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of rows) { const v = row.vals[a]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
    if (ax.wantLo != null && ax.wantLo < lo) lo = ax.wantLo;
    if (ax.wantHi != null && ax.wantHi > hi) hi = ax.wantHi;
    if (ax.wantHi != null && ax.wantHi < hi) clipped.push([ax.label, ax.wantHi, hi]);
    if (ax.wantLo != null && ax.wantLo > lo) clipped.push([ax.label, ax.wantLo, lo]);
    ax.lo = lo;
    ax.hi = hi;
    ax.flat = !(hi > lo);
  });

  /* Colour groups. Categorical by string value, because a column named as the colour is being
     used as a label whatever its type -- a run number is a name, not a quantity, the moment you
     colour by it. */
  const catIds = [];
  const catOf = [];
  if (colorBy) {
    for (const row of rows) {
      const v = row.raw[colorBy];
      const key = v == null ? '\u2014' : String(v);
      if (!catIds.includes(key)) catIds.push(key);
      catOf.push(catIds.indexOf(key));
    }
  }

  /* Exact duplicates: rows that will land on top of each other and be indistinguishable. Kept,
     because they are real rows and the count matters, but named, because a chart where six lines
     are one line looks like a chart with one line. */
  const seenTuple = new Set();
  let dupes = 0;
  for (const row of rows) {
    const key = row.vals.join('\u2502');
    if (seenTuple.has(key)) dupes++;
    else seenTuple.add(key);
  }

  return { axes, rows, colorBy, catIds, catOf, bad, clipped, dupes,
           flats: axes.filter((a) => a.flat).map((a) => a.label) };
}

/* -- the axis-order objective ----------------------------------------------------------- */

/**
 * How many pairs of rows cross between two axes.
 *
 * This is the objective, and it is a count of a thing on the page rather than a statistic about
 * the data: two rows cross between neighbouring axes exactly when their order flips, and every
 * flip is one X a reader has to untangle. Ties do not cross -- two rows equal on either axis run
 * parallel there -- which is why a constant axis crosses nothing with anybody and sorting the
 * axes will happily park it anywhere.
 *
 * @param rows  the kept rows
 * @param a     one axis index
 * @param b     the other
 * @returns the number of crossing row pairs, quadratic in rows
 *
 * @example xingBetween([{ vals: [1, 2] }, { vals: [2, 1] }], 0, 1);   // 1
 */
function xingBetween(rows, a, b) {
  let c = 0;
  for (let i = 0; i < rows.length; i++) {
    const ai = rows[i].vals[a];
    const bi = rows[i].vals[b];
    for (let j = i + 1; j < rows.length; j++) {
      const da = ai - rows[j].vals[a];
      const db = bi - rows[j].vals[b];
      if (da * db < 0) c++;
    }
  }
  return c;
}

/**
 * Pearson correlation between two axes, or null when either has no spread.
 *
 * Reported rather than optimised. It is the answer to the question the crossing count cannot
 * answer: a neighbouring pair with a great many crossings and a strong negative correlation is a
 * clean X and a genuine finding, while the same count with a correlation near zero is noise. A
 * card that only minimised crossings would quietly rank those two the same.
 *
 * Null for a constant axis, because a column with no variance has no correlation with anything --
 * the denominator is zero, and every library that returns 0 there is asserting independence it
 * has not measured.
 *
 * @example corrBetween([{ vals: [1, 2] }, { vals: [2, 4] }], 0, 1);   // 1
 */
function corrBetween(rows, a, b) {
  const m = rows.length;
  if (m < 2) return null;
  let sa = 0;
  let sb = 0;
  for (const r of rows) { sa += r.vals[a]; sb += r.vals[b]; }
  const ma = sa / m;
  const mb = sb / m;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (const r of rows) {
    const da = r.vals[a] - ma;
    const db = r.vals[b] - mb;
    num += da * db;
    va += da * da;
    vb += db * db;
  }
  if (!(va > 0) || !(vb > 0)) return null;
  return num / Math.sqrt(va * vb);
}

/** The total crossing count over adjacent axis pairs, for one axis order. */
function totalXing(order, X) {
  let s = 0;
  for (let i = 0; i + 1 < order.length; i++) s += X[order[i]][order[i + 1]];
  return s;
}

/**
 * The axis order for one `axisOrder` mode, and what it cost.
 *
 * Three stages, and each is there because the one before it stops somewhere useless:
 *
 *   1. A greedy nearest-neighbour path from every possible starting axis, keeping the best. One
 *      greedy path from one start is a coin flip; all of them is still cheap at twelve axes and
 *      is reliably better than the given order.
 *   2. Adjacent swaps to a local optimum. Only strict improvements are accepted, so this stage
 *      can never spend what stage one bought.
 *   3. A relocation pass, because a swap cannot move an axis past a neighbour that the move makes
 *      worse even when four places along is a slot that helps everything.
 *
 * Then the guard that matters: the result is scored against the order you gave and the loser is
 * discarded. The reordering therefore cannot make the picture worse than the one you asked for,
 * which is a property a test can assert -- and "your order was already the best" is a real answer.
 *
 * @param mode one of `given`, `correlation`
 * @param R    the output of {@link readData}
 * @param X    the crossing matrix, or null when it was too big to build
 * @returns `{ order, before, after, kept, skipped }`
 *
 * @example planFor('correlation', read, X).after;   // 812
 */
function planFor(mode, R, X) {
  const given = R.axes.map((_, i) => i);
  if (mode === 'given' || !X || R.axes.length < 3) {
    return { order: given, before: X ? totalXing(given, X) : 0,
             after: X ? totalXing(given, X) : 0, kept: true, skipped: !X };
  }

  const nA = R.axes.length;
  const before = totalXing(given, X);

  let best = null;
  for (let start = 0; start < nA; start++) {
    const used = new Array(nA).fill(false);
    const path = [start];
    used[start] = true;
    for (let k = 1; k < nA; k++) {
      const last = path[path.length - 1];
      let pick = -1;
      for (let c = 0; c < nA; c++) {
        if (used[c]) continue;
        if (pick < 0 || X[last][c] < X[last][pick] || (X[last][c] === X[last][pick] && c < pick)) pick = c;
      }
      path.push(pick);
      used[pick] = true;
    }
    const cost = totalXing(path, X);
    if (!best || cost < best.cost) best = { path, cost };
  }

  const order = best.path.slice();
  for (let round = 0; round < 200; round++) {
    let did = 0;
    for (let i = 0; i + 1 < nA; i++) {
      const cand = order.slice();
      cand[i] = order[i + 1];
      cand[i + 1] = order[i];
      if (totalXing(cand, X) < totalXing(order, X)) {
        order[i] = cand[i];
        order[i + 1] = cand[i + 1];
        did++;
      }
    }
    for (const k of order.slice()) {
      const at = order.indexOf(k);
      const rest = order.slice(0, at).concat(order.slice(at + 1));
      let bestAt = -1;
      let bestCost = totalXing(order, X);
      for (let j = 0; j <= rest.length; j++) {
        if (j === at) continue;
        const cost = totalXing(rest.slice(0, j).concat([k], rest.slice(j)), X);
        if (cost < bestCost) { bestCost = cost; bestAt = j; }
      }
      if (bestAt < 0) continue;
      const moved = rest.slice(0, bestAt).concat([k], rest.slice(bestAt));
      order.length = 0;
      for (const v of moved) order.push(v);
      did++;
    }
    if (!did) break;
  }

  const after = totalXing(order, X);
  if (after >= before) return { order: given, before, after: before, kept: true, skipped: false };
  return { order, before, after, kept: false, skipped: false };
}

/* -- saying what the picture shows ------------------------------------------------------ */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets, per order mode.
 *
 * The independent-scaling warning comes FIRST and is not conditional. It is the one thing a
 * reader has to know before they look, and burying it after the census would mean the people who
 * skim -- which is everybody -- get the chart without it.
 *
 * @returns `{ aria, note }`, both plain text
 * @example describe(read, plan, 'correlation').note;   // 'each axis is scaled on its own ...'
 */
function describe(R, P, mode) {
  const census = plural(R.rows.length, 'row', 'rows') + ' across ' +
                 plural(R.axes.length, 'axis', 'axes');

  if (!R.axes.length) {
    return { aria: 'An empty parallel-coordinates plot: no axes were given, so there is nothing ' +
                   'to plot against.', note: 'no axes.' };
  }
  if (!R.rows.length) {
    return { aria: 'A parallel-coordinates plot of ' + plural(R.axes.length, 'axis', 'axes') +
                   ' with no usable rows. The axes are drawn so the card keeps its place, but ' +
                   'nothing is plotted on them.',
             note: 'no usable rows, so the axes are drawn empty.' };
  }

  const warn = 'each axis is scaled on its own, from its own smallest value to its own largest, ' +
    'so a line high here and low there has not gone down -- it has moved between two ranges ' +
    'that have nothing to do with each other';

  const one = R.axes.length === 1
    ? ' with one axis there is nothing to join, so this is a strip of points rather than a plot ' +
      'of lines.'
    : '';

  const work = R.axes.length < 3 || P.skipped
    ? (P.skipped ? ' too many rows to count crossings, so the axes stay in the order given.' : '')
    : mode === 'given'
      ? ' axes in the order given; ' + plural(P.before, 'crossing', 'crossings') +
        ' between neighbours.'
      : P.kept
        ? ' the search found no axis order that crosses less than the one you gave, so that ' +
          'order stands at ' + plural(P.before, 'crossing', 'crossings') + '.'
        : ' axes reordered to cut crossings between neighbours from ' + P.before + ' to ' +
          P.after + ' (' + Math.round((1 - P.after / Math.max(1, P.before)) * 100) + '% fewer).';

  /* A crossing count on its own ranks a clean X the same as a smear, so the sign is reported
     alongside it. A neighbouring pair that crosses a great deal AND correlates strongly negative
     is one tidy X and a finding; the same count near zero correlation is noise. */
  const neg = (P.negPairs || []).length
    ? ' ' + plural(P.negPairs.length, 'neighbouring pair crosses', 'neighbouring pairs cross') +
      ' because they run opposite (' + P.negPairs.join('; ') +
      '); those crossings are a shape, not a mess.'
    : '';

  const flats = R.flats.length
    ? ' ' + plural(R.flats.length, 'axis is', 'axes are') + ' constant (' +
      R.flats.join(', ') + '); an axis with no range has no top and no bottom, so every line ' +
      'crosses it at the midpoint and its one value is printed beside it.'
    : '';

  const inverted = R.axes.filter((a) => a.invert).map((a) => a.label);
  const inv = inverted.length
    ? ' ' + plural(inverted.length, 'axis runs', 'axes run') + ' upside down (' +
      inverted.join(', ') + '), largest at the bottom.'
    : '';

  const over = R.clipped.length
    ? ' ' + plural(R.clipped.length, 'stated bound was', 'stated bounds were') +
      ' past by the data and widened rather than clipping it (' +
      R.clipped.map((c) => c[0] + ': ' + CK.fmt(c[1]) + ' to ' + CK.fmt(c[2])).join('; ') + ').'
    : '';

  const dup = R.dupes
    ? ' ' + plural(R.dupes, 'row is', 'rows are') + ' an exact duplicate of an earlier one and ' +
      'draws on top of it, so fewer lines are visible than there are rows.'
    : '';

  const junk = [];
  if (R.bad.badRow) junk.push(plural(R.bad.badRow, 'row', 'rows') +
    ' had a missing or non-numeric value and were dropped, because a line needs a point on every axis');
  if (R.bad.noKey) junk.push(plural(R.bad.noKey, 'axis', 'axes') + ' had no key');
  if (R.bad.dupeAxis) junk.push(plural(R.bad.dupeAxis, 'axis was', 'axes were') + ' a duplicate key');
  if (R.bad.extraAxes) junk.push(plural(R.bad.extraAxes, 'axis was', 'axes were') +
    ' past the limit of ' + AX_MAX + ' and not drawn');
  const junkText = junk.length ? ' ' + junk.join('; ') + '.' : '';

  const note = (warn + '.' + one + work + neg + flats + inv + over + dup + junkText)
    .replace(/\s+/g, ' ').trim();
  const aria = ('Parallel coordinates, ' + census + '. ' + warn + '.' + one + work + neg + flats +
                inv + over + dup + junkText).replace(/\s+/g, ' ').trim();
  return { aria, note };
}

/* -- the browser half ------------------------------------------------------------------- */

/**
 * Every axis, tick and line as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so
 * the function a test calls here is textually the function the page runs.
 *
 * Positions arrive already normalised: `model.vals[r][a]` is the fraction of that axis's range
 * the value sits at, computed in Node through the real `CK.scale` -- including its zero-width
 * domain guard, which is what parks every row at 0.5 on a constant axis instead of dividing by
 * zero. This function only turns fractions into pixels, so there is exactly one place where a
 * value becomes a position and a test can check it against the arithmetic rather than against a
 * path string.
 *
 * @param model the precomputed model: axes, fractions, colours, orders
 * @param cfg   `{ axisOrder, curve, opacity }`
 * @returns `{ w, h, marks, pts }` -- `pts[r]` is the row's screen points, so the mapping from
 *          value to position is checkable without parsing a path
 *
 * @example parallelGeom(model, { axisOrder: 'given', curve: false, opacity: 0.5 }).pts[0][0];
 */
function parallelGeom(model, cfg) {
  var i, a, r;
  var order = model.orders[cfg.axisOrder] ? model.orders[cfg.axisOrder] : model.orders.given;
  var nA = order.length;
  var nR = model.vals.length;

  function r2(v) { return Math.round(v * 100) / 100; }

  if (!nA) { return { w: 100, h: 40, marks: [], pts: [] }; }

  var gap = nA > 1 ? (model.w0 - model.padL - model.padR) / (nA - 1) : 0;
  if (nA > 1 && gap < model.gapMin) { gap = model.gapMin; }
  var w = nA > 1 ? model.padL + model.padR + gap * (nA - 1) : model.padL + model.padR + 40;
  var h = model.h0;
  var y0 = model.padT;
  var y1 = h - model.padB;

  function xAt(slot) { return nA > 1 ? model.padL + slot * gap : w / 2; }
  function yAt(frac) { return y1 - frac * (y1 - y0); }

  var kids = [];

  for (i = 0; i < nA; i++) {
    a = order[i];
    var x = xAt(i);
    kids.push({ t: 'line', a: { x1: r2(x), y1: r2(y0), x2: r2(x), y2: r2(y1), "class": 'ax' } });
    for (var t = 0; t < model.ticks[a].length; t++) {
      var tf = model.ticks[a][t];
      kids.push({ t: 'line', a: { x1: r2(x - 3), y1: r2(yAt(tf[0])), x2: r2(x + 3),
                                  y2: r2(yAt(tf[0])), "class": 'tick' } });
    }
    kids.push({ t: 'text', a: { x: r2(x), y: r2(y0 - 15), "class": 'axlab', 'text-anchor': 'middle' },
                s: model.axClip[a], ti: model.axTip[a] });
    if (model.axFlat[a]) {
      kids.push({ t: 'text', a: { x: r2(x), y: r2(yAt(0.5) - 5), "class": 'axval',
                                  'text-anchor': 'middle' }, s: model.axHiLab[a] });
    } else {
      kids.push({ t: 'text', a: { x: r2(x), y: r2(y0 - 4), "class": 'axval', 'text-anchor': 'middle' },
                  s: model.axTopLab[a] });
      kids.push({ t: 'text', a: { x: r2(x), y: r2(y1 + 10), "class": 'axval', 'text-anchor': 'middle' },
                  s: model.axBotLab[a] });
    }
  }

  var op = Number(cfg.opacity);
  if (!(op > 0)) { op = 0.55; }
  if (op > 1) { op = 1; }

  var pts = [];
  for (r = 0; r < nR; r++) {
    var row = model.vals[r];
    var pl = [];
    for (i = 0; i < nA; i++) { pl.push([r2(xAt(i)), r2(yAt(row[order[i]]))]); }
    pts.push(pl);

    var d;
    if (nA === 1) {
      /* One axis is a strip of points, not a line: a path with a single M and no L renders as
         literally nothing, which is the most common way a plot comes out blank. */
      kids.push({ t: 'circle', a: { cx: pl[0][0], cy: pl[0][1], r: 2.6, "class": 'dot',
                                    fill: model.rowCol[r], opacity: r2(op) }, ti: model.rowTip[r] });
      continue;
    }
    d = 'M' + pl[0][0] + ',' + pl[0][1];
    for (i = 1; i < nA; i++) {
      if (cfg.curve) {
        var hx = r2((pl[i - 1][0] + pl[i][0]) / 2);
        d += 'C' + hx + ',' + pl[i - 1][1] + ' ' + hx + ',' + pl[i][1] + ' ' + pl[i][0] + ',' + pl[i][1];
      } else {
        d += 'L' + pl[i][0] + ',' + pl[i][1];
      }
    }
    /* Two paths per row inside one group: a fat invisible one that is easy to hover and a thin
       visible one that is easy to read. The highlight is then pure CSS -- the group dims when the
       plot is hovered and lifts when the group is -- with no listener to leak across a swap. */
    kids.push({ t: 'g', a: { "class": 'ln', opacity: r2(op) },
                kids: [
                  { t: 'path', a: { d: d, "class": 'hit' }, ti: model.rowTip[r] },
                  { t: 'path', a: { d: d, "class": 'wire', stroke: model.rowCol[r] } },
                ] });
  }

  return { w: r2(w), h: r2(h), marks: kids, pts: pts };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every line on the second pass.
 *
 * @example paintList(svg, [{ t: 'circle', a: { r: 4 } }]);
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
 * Nothing here names a colour; every value is a desk token. `prefers-color-scheme` is
 * deliberately absent: the desk is one document open in two viewers that want different answers.
 *
 * The highlight is done here rather than in script, which is the whole reason the rows are drawn
 * as groups of two paths. A hover listener would have to be attached per line, guarded against
 * the `<main>` swap, and removed on redraw; two CSS rules cannot leak, cannot double-fire, and
 * keep working while the tab is in the background.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-pc-scroll', 'margin-top: 2px;'],
    ['svg.ck-pc', 'display: block; width: 100%; height: auto;'],
    ['svg.ck-pc text', 'font-family: var(--mono); font-size: 9px;'],

    ['.ck-pc .ax', 'stroke: var(--rule); stroke-width: 1;'],
    ['.ck-pc .tick', 'stroke: var(--ck-grid); stroke-width: 1;'],
    ['.ck-pc .axlab', 'fill: var(--ink-dim);'],
    ['.ck-pc .axval', 'fill: var(--ink-faint); font-size: 8.5px;'],

    ['.ck-pc .wire', 'fill: none; stroke-width: 1.1; stroke-linejoin: round; stroke-linecap: round;'],
    ['.ck-pc .hit', 'fill: none; stroke: transparent; stroke-width: 7; pointer-events: stroke;'],
    ['.ck-pc .ln', 'transition: opacity .1s linear;'],
    ['.ck-pc:hover .ln', 'opacity: .07;'],
    ['.ck-pc .ln:hover', 'opacity: 1;'],
    ['.ck-pc .ln:hover .wire', 'stroke-width: 2.2;'],
    ['.ck-pc .dot', 'stroke: none;'],

    ['.ck-pc-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="number"]', 'width: 6.5em;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n' +
    '@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-pc .ln', 'transition: none;']]) +
    '\n}\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the plot and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The part that changes with the settings is an
 * empty `<i>` the script fills with `textContent`.
 */
function cardHtml(id, title, R, plan) {
  const e = CK.esc;

  const void_ = R.axes.length ? '' :
    '  <div class="ck-pc-void">nothing to draw &mdash; no axes were given</div>\n';

  const svg = R.axes.length
    ? '  <div class="ck-scroll ck-pc-scroll">\n' +
      '    <svg class="ck-pc" role="img" viewBox="0 0 100 40" aria-label="' + e(plan.aria) + '"></svg>\n' +
      '  </div>\n'
    : '';

  const legend = R.catIds.map((c, i) =>
    '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + e(c) + '</span>').join('');

  return '<section data-card="' + e(id) + '" class="ck-parallel">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-axisOrder">axis order</label>\n' +
    '    <select id="' + e(id) + '-axisOrder" name="axisOrder">\n' +
    ORDER_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-curve">curved</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-curve" name="curve">\n' +
    '    <label for="' + e(id) + '-opacity">line opacity</label>\n' +
    '    <input type="number" id="' + e(id) + '-opacity" name="opacity" min="0.03" max="1" step="0.05">\n' +
    '    <div class="ck-set-foot">every axis is scaled on its own; the numbers beside each axis ' +
    'are its own top and bottom, and nothing about height is comparable between two axes.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(R.rows.length)) + '</b> ' +
    (R.rows.length === 1 ? 'row' : 'rows') + ' across <b>' + e(String(R.axes.length)) + '</b> ' +
    (R.axes.length === 1 ? 'axis' : 'axes') + '. <i class="ck-pc-note">' + e(plan.note) + '</i></div>\n' +
    (legend ? '  <div class="ck-legend">' + legend + '</div>\n' : '') +
    '</section>\n';
}

/**
 * The browser half: pick the axis order the settings name, map fractions to pixels, paint.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated on the way in: they come out
 * of `localStorage`, which is a text file the viewer can edit.
 */
function cardJs(id, model, inst) {
  const js =
    '/* parallel card: domains, fractions and the axis order computed in Node; only the mapping\n' +
    '   from fraction to pixel happens here, because the plot width depends on the viewport. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    parallelGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-pc");\n' +
    '  var note = sec.querySelector(".ck-pc-note");\n\n' +
    '  function pick(v, list, fallback) {\n' +
    '    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }\n' +
    '    return fallback;\n' +
    '  }\n\n' +
    '  function draw(cfg) {\n' +
    '    var ord = pick(cfg.axisOrder, MODEL.modes, DEF.axisOrder);\n' +
    '    if (note) { note.textContent = MODEL.notes[ord]; }\n' +
    '    if (!box || !MODEL.nA) { return; }\n' +
    '    var op = Number(cfg.opacity);\n' +
    '    if (!isFinite(op) || op <= 0 || op > 1) { op = DEF.opacity; }\n' +
    '    var got = parallelGeom(MODEL, { axisOrder: ord, curve: !!cfg.curve, opacity: op });\n' +
    '    paintList(box, got.marks);\n' +
    '    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);\n' +
    '    box.style.minWidth = Math.ceil(got.w) + "px";\n' +
    '    box.setAttribute("aria-label", MODEL.arias[ord]);\n' +
    '  }\n\n' +
    '  CK.settings(sec, DEF, draw);\n' +
    '});\n';
  return guardEmitted(js, id);
}

/**
 * Build one parallel-coordinates card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the crossing counts and the per-axis
 *          domains, so a reader can check the caption without re-deriving anything
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'runs',
 *   title: 'every benchmark run, five measures at once',
 *   data: {
 *     axes: [{ key: 'ms', label: 'latency', unit: 'ms', invert: true }, { key: 'mb', label: 'peak RSS' }],
 *     rows: [{ ms: 91, mb: 210, host: 'a' }, { ms: 140, mb: 180, host: 'b' }],
 *     colorBy: 'host',
 *   },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'parallel' : id);
  const R = readData(data);

  /* The crossing matrix is the objective and it is quadratic in rows, so it is built once and
     only when it is affordable. Past the caps the axis order simply stays as given and the
     caption says why -- a card that quietly stopped optimising would be worse than one that
     never did. */
  let X = null;
  if (R.rows.length && R.rows.length <= XING_ROW_CAP && R.axes.length <= XING_AX_CAP) {
    X = R.axes.map(() => R.axes.map(() => 0));
    for (let a = 0; a < R.axes.length; a++) {
      for (let b = a + 1; b < R.axes.length; b++) {
        const c = xingBetween(R.rows, a, b);
        X[a][b] = c;
        X[b][a] = c;
      }
    }
  }

  /* Correlation is measured but never optimised. It is what tells a clean X apart from a smear,
     and a search that chased it would push the most informative pairs -- the strongly negative
     ones -- as far apart as it could, on the grounds that they cross a lot. */
  const C = R.axes.map(() => R.axes.map(() => null));
  if (R.rows.length && R.axes.length <= XING_AX_CAP) {
    for (let a = 0; a < R.axes.length; a++) {
      for (let b = a + 1; b < R.axes.length; b++) {
        const r = corrBetween(R.rows, a, b);
        C[a][b] = r;
        C[b][a] = r;
      }
    }
  }

  const plans = {};
  for (const m of ORDER_MODES) {
    const p = planFor(m, R, X);
    p.negPairs = [];
    for (let i = 0; i + 1 < p.order.length; i++) {
      const r = C[p.order[i]][p.order[i + 1]];
      if (r != null && r <= -0.5) {
        p.negPairs.push(R.axes[p.order[i]].label + ' vs ' + R.axes[p.order[i + 1]].label +
                        ', r ' + (Math.round(r * 100) / 100));
      }
    }
    plans[m] = { ...p, ...describe(R, p, m) };
  }

  /* Every value becomes a fraction of its own axis through the real `CK.scale`. Its zero-width
     domain guard is doing load-bearing work here: a constant column has `lo === hi`, every naive
     normaliser divides by zero there, and `CK.scale` instead parks the value at the midpoint of
     the output range -- which is exactly the honest picture, since nothing distinguishes the
     rows on that axis. Inversion is applied to the fraction rather than to the domain, so the
     numbers printed beside the axis stay the real minimum and maximum. */
  const toFrac = R.axes.map((ax) => CK.scale([ax.lo, ax.hi], [0, 1]));
  const vals = R.rows.map((row) =>
    row.vals.map((v, a) => {
      const f = toFrac[a](v);
      return n4(R.axes[a].invert ? 1 - f : f, 'fraction');
    }));

  const ticks = R.axes.map((ax, a) => {
    if (ax.flat) return [[0.5, CK.fmt(ax.lo)]];
    return CK.ticks(ax.lo, ax.hi, 4)
      .filter((t) => t >= ax.lo - 1e-9 && t <= ax.hi + 1e-9)
      .map((t) => {
        const f = toFrac[a](t);
        return [n4(ax.invert ? 1 - f : f, 'tick'), CK.fmt(t)];
      });
  });

  const axClip = R.axes.map((ax) => clip(ax.label, LAB_MAX));
  const unitOf = (ax) => (ax.unit ? ' ' + ax.unit : '');
  const axTip = R.axes.map((ax) =>
    ax.label + unitOf(ax) + ' \u00b7 ' +
    (ax.flat ? 'constant at ' + CK.fmt(ax.lo)
             : CK.fmt(ax.lo) + ' to ' + CK.fmt(ax.hi) + (ax.invert ? ' (inverted)' : '')));

  const rowCol = R.rows.map((_, i) =>
    (R.colorBy ? CK.hue(R.catOf[i]) : 'var(--accent)'));
  const rowTip = R.rows.map((row, i) =>
    (R.colorBy ? String(row.raw[R.colorBy] == null ? '\u2014' : row.raw[R.colorBy]) + ' \u00b7 ' : '') +
    R.axes.map((ax, a) => ax.label + ' ' + CK.fmt(row.vals[a]) + unitOf(ax)).join(' \u00b7 '));

  const labW = axClip.reduce((m, s) => Math.max(m, textW(s)), 0);

  const model = {
    nA: R.axes.length,
    w0: W0,
    h0: H0,
    padL: Math.max(24, Math.round(labW / 2) + 6),
    padR: Math.max(24, Math.round(labW / 2) + 6),
    padT: 28,
    padB: 16,
    gapMin: AX_GAP_MIN,
    axClip,
    axTip,
    axFlat: R.axes.map((ax) => (ax.flat ? 1 : 0)),
    axTopLab: R.axes.map((ax) => CK.fmt(ax.invert ? ax.lo : ax.hi)),
    axBotLab: R.axes.map((ax) => CK.fmt(ax.invert ? ax.hi : ax.lo)),
    axHiLab: R.axes.map((ax) => CK.fmt(ax.hi)),
    ticks,
    vals,
    rowCol,
    rowTip,
    modes: ORDER_MODES.slice(),
    orders: {},
    notes: {},
    arias: {},
  };
  for (const m of ORDER_MODES) {
    model.orders[m] = plans[m].order;
    model.notes[m] = plans[m].note;
    model.arias[m] = plans[m].aria;
  }

  /* The browser half is exercised here over every configuration a viewer can reach, so a
     degenerate input that would produce a NaN coordinate is caught at build time next to the data
     that caused it rather than at paint time, where the browser drops the attribute in silence. */
  if (R.axes.length) {
    for (const m of ORDER_MODES) {
      for (const curve of [true, false]) {
        for (const op of [0.03, defaults.opacity, 1]) {
          const got = parallelGeom(model, { axisOrder: m, curve, opacity: op });
          assertFinite(got.marks, m + '/curve ' + curve + '/opacity ' + op);
        }
      }
    }
  }

  const active = plans[defaults.axisOrder];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'parallel',
      axes: R.axes.length,
      rows: R.rows.length,
      constantAxes: R.flats,
      invertedAxes: R.axes.filter((a) => a.invert).map((a) => a.label),
      duplicateRows: R.dupes,
      refused: { rows: R.bad.badRow, axesWithoutKey: R.bad.noKey,
                 duplicateAxes: R.bad.dupeAxis, axesPastLimit: R.bad.extraAxes },
      domains: R.axes.map((a) => ({ label: a.label, lo: a.lo, hi: a.hi, invert: a.invert })),
      crossings: Object.fromEntries(ORDER_MODES.map((m) => [m, plans[m].after])),
      crossingsGiven: plans.given.before,
      keptGivenOrder: active.kept,
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active),
    css: cardCss(cardId),
    js: cardJs(cardId, model, { ...defaults }),
  };
}

/* Exported for the verifier only: the geometry the browser runs and the objective it is judged
   against, so a test can assert that a value lands at the right fraction of its own axis using
   the same text the page gets. */
export { parallelGeom, xingBetween, corrBetween, planFor, readData };
