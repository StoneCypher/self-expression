/**
 * `splom` -- a scatterplot matrix: every numeric column against every other, all at once.
 *
 * The reason to draw one is that a table of correlations tells you the strength of a relationship
 * and nothing about its shape. Two columns with r = 0.0 can be a shapeless cloud or a perfect
 * parabola; two with r = 0.9 can be a clean line or a line plus one outlier doing all the work.
 * A scatterplot matrix is the cheapest way to see which, across every pair, before deciding what
 * to model. The diagonal carries each column's own distribution, because a pair of panels is
 * unreadable until you know whether either column is bimodal or piled against a boundary.
 *
 * Three decisions worth reading:
 *
 *   1. **The column count is capped, and the cap is about reading rather than pixels.** Eight
 *      columns is sixty-four panels and twenty-eight distinct pairs; a reader can hold neither.
 *      Columns past the cap are NAMED in the caption rather than silently dropped, because a
 *      chart that quietly stopped showing a variable is worse than one that says it did.
 *   2. **A missing or non-numeric cell removes that row from the panels that use its column, and
 *      from no others.** Dropping the whole row would throw away the eleven good measurements
 *      that came with the one bad one, and a splom is exactly the chart where those eleven are
 *      still worth seeing. The count of bad cells is reported.
 *   3. **A constant column is drawn rather than hidden.** It comes out as a single line of dots
 *      through the middle of every panel it touches -- `CK.scale` parks a zero-width domain at
 *      the midpoint of its range rather than dividing by zero -- its own diagonal is one
 *      full-height bar, and its correlation with everything is undefined and prints as a dash.
 *      Reporting zero correlation there, which is what most libraries do, asserts an
 *      independence nobody measured.
 *
 * @see ./parallel.mjs -- the same table, neighbours only, in one picture instead of n squared
 * @see ./chart.mjs -- the scatter of one pair, with the axes and labels a single plot can afford
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
  catch (e) { throw new Error('cardkit/splom: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/splom: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/**
 * The most columns this card will draw, and why the number is small.
 *
 * An n-column matrix is n squared panels and n(n-1)/2 distinct pairs. At eight that is
 * sixty-four panels and twenty-eight pairs, which is already past what a reader compares rather
 * than skims. It is also the point where each panel, at the smallest size the settings allow,
 * stops being able to hold the two axis numbers that say what it is a picture of. Nine columns
 * would be eighty-one panels and thirty-six pairs for one more variable -- a bad trade every
 * time. Columns past the cap are named in the caption, never silently dropped.
 */
const COL_MAX = 8;

/** Panel size in px, and the range the setting may reach. Below the floor a scatter is a smudge. */
const SIZE_MIN = 44;
const SIZE_MAX = 160;
const SIZE_DEF = 76;

/** Gap between panels, and how much room the outer axis numbers get. */
const GAP = 5;

/** How long a column label may be before it is clipped, in px at the label size. */
const LAB_MAX = 82;

/**
 * Past this many drawn dots the rows are systematically sampled and the caption says so.
 *
 * Every dot is an SVG element, and a splom multiplies rows by panels: two hundred rows over
 * sixty-four panels is nearly thirteen thousand circles, which a browser will draw but will not
 * enjoy. Sampling is systematic -- every k-th row -- rather than random, so the picture is the
 * same on every build and a reader comparing two builds is comparing the data.
 */
const DOT_CAP = 24000;

/** Past this many dots a per-point tooltip stops being worth its own DOM node. */
const TIP_CAP = 2000;

/** The three things `diagonal` may say, and the three things `upper` may say. */
const DIAG_MODES = ['histogram', 'density', 'name'];
const UPPER_MODES = ['same', 'correlation', 'blank'];

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it.
 *
 * @example defaults.upper;   // 'correlation'
 */
export const defaults = { diagonal: 'histogram', size: SIZE_DEF, upper: 'correlation' };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'splom'
 */
export const meta = {
  name: 'splom',
  summary:
    'A scatterplot matrix of every numeric column against every other, with each column own ' +
    'distribution on the diagonal and correlation, a mirror or nothing above it.',
  shape:
    '{ columns: [{ key, label }], rows: [{ key: number }], colorBy } -- ' +
    'at most ' + COL_MAX + ' columns are drawn and the rest are named in the caption; a cell ' +
    'that is not a number removes its row from the panels using that column only; colorBy names ' +
    'a column whose values become the dot colours',
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
 * @example n(1.005, 'x');   // 1
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/splom: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to four decimals -- fractions need more resolution than pixels do. */
function n4(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/splom: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
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
 * question mark goes too, so a label reading "why?.this" cannot look like optional chaining to a
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
  const own = '.ck-splom[data-card="' + cssId(id) + '"]';
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
 * A raw scan for `const` / `let` / `class` false-positives on English prose. Offsets are
 * preserved so a reported position still means something, and regex literals are recognised,
 * because otherwise the scanner desyncs on a quote inside one and blanks real code -- turning a
 * false positive into the far worse false negative.
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
 * written here; it is reached for as `String.fromCharCode(96)`.
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
 * @example guardEmitted('var a = 1;', 'demo');            // 'var a = 1;'
 * @example guardEmitted('class X {}', 'demo');            // throws: the keyword class at line 1
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
    throw new Error('cardkit/splom: refusing to emit ' + where + ' -- ' + bad.join('; '));
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
 * @example assertFinite([{ t: 'rect', a: { width: 4 } }], 'default');   // undefined
 */
function assertFinite(marks, where) {
  for (const m of marks) {
    if (m.a) {
      for (const k of Object.keys(m.a)) {
        const v = m.a[k];
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error('cardkit/splom: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/splom: ' + k + ' reads "' + v + '" in ' + where);
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
 * The interesting choice is the per-cell one. A row with a bad value in one column is kept, and
 * simply does not appear in the fifteen panels that use that column -- it still appears in the
 * other forty-nine. Dropping the whole row is what a table-shaped reader does, and it throws away
 * every good measurement that arrived beside the bad one, which is precisely what a splom exists
 * to look at. The count of bad cells is reported so the reader knows the panels do not all hold
 * the same number of points.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the counts
 *
 * @example readData({ columns: ['a'], rows: [{ a: 1 }] }).cols[0].hi;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawCols = Array.isArray(d.columns) ? d.columns : [];
  const rawRows = Array.isArray(d.rows) ? d.rows : [];
  const colorBy = d.colorBy == null ? null : String(d.colorBy);

  const bad = { noKey: 0, dupe: 0, badCell: 0, badRow: 0 };
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

  /* A row is a vector with holes. `null` means "not a number here", and every panel checks both
     of its coordinates before drawing a dot. */
  const rows = [];
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') { bad.badRow++; continue; }
    const vals = cols.map((c) => {
      const v = r[c.key];
      if (v == null || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) {
        bad.badCell++;
        return null;
      }
      const num = Number(v);
      if (!Number.isFinite(num)) { bad.badCell++; return null; }
      return num;
    });
    rows.push({ vals, raw: r });
  }

  cols.forEach((c, a) => {
    let lo = Infinity;
    let hi = -Infinity;
    let count = 0;
    let sum = 0;
    for (const row of rows) {
      const v = row.vals[a];
      if (v == null) continue;
      count++;
      sum += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!count) { lo = 0; hi = 0; }
    c.lo = lo;
    c.hi = hi;
    c.count = count;
    c.mean = count ? sum / count : 0;
    c.flat = !(hi > lo);
  });

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

  return { cols, rows, extra, colorBy, catIds, catOf, bad,
           flats: cols.filter((c) => c.flat).map((c) => c.label) };
}

/**
 * Pearson correlation between two columns, over the rows where both are numbers.
 *
 * Null when either column has no spread across those rows, or when fewer than two rows survive.
 * Returning zero there -- the common shortcut -- asserts independence that nothing measured, and
 * on a grid of numbers a zero is indistinguishable from a measurement. A dash is not.
 *
 * @param rows the kept rows
 * @param a    one column index
 * @param b    the other
 * @returns r in [-1, 1], or null
 *
 * @example pearson([{ vals: [1, 2] }, { vals: [2, 4] }], 0, 1);   // 1
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
  if (m < 2) return null;
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
  if (!(va > 0) || !(vb > 0)) return null;
  const out = num / Math.sqrt(va * vb);
  return Number.isFinite(out) ? out : null;
}

/**
 * A column's histogram, as bar heights in 0..1 over its own domain.
 *
 * The bin count follows the square root of the sample, clamped: too few bins hides a second mode
 * and too many turns a distribution into a comb of ones. A constant column gets a single bin, and
 * that bin is the whole column, which is the honest picture of a variable that never varies.
 *
 * @returns `{ bins, heights }` -- heights are relative to the fullest bin, so the tallest bar
 *          always fills the panel and the shape is comparable between columns even when the
 *          counts are not
 *
 * @example histOf([{ vals: [1] }, { vals: [2] }], 0, { lo: 1, hi: 2, flat: false }).bins;   // 4
 */
function histOf(rows, a, col) {
  if (col.flat || !col.count) return { bins: 1, heights: [1] };
  const bins = Math.max(4, Math.min(14, Math.round(Math.sqrt(col.count))));
  const counts = new Array(bins).fill(0);
  const span = col.hi - col.lo;
  for (const r of rows) {
    const v = r.vals[a];
    if (v == null) continue;
    let k = Math.floor(((v - col.lo) / span) * bins);
    if (k >= bins) k = bins - 1;
    if (k < 0) k = 0;
    counts[k]++;
  }
  const top = Math.max(1, ...counts);
  return { bins, heights: counts.map((c) => c / top) };
}

/**
 * A column's density curve, sampled as `[fraction across, height]` pairs in 0..1.
 *
 * A Gaussian kernel with Silverman's rule for the bandwidth -- the standard default, and a
 * default is the right thing here because a bandwidth control on a card with sixty-four panels
 * would be a knob nobody could evaluate the effect of.
 *
 * A column with no spread has a bandwidth of zero, where the kernel is a division by zero. It
 * falls back to the single full-height bar the histogram would have drawn, which is the same
 * answer arrived at honestly rather than a curve of NaNs.
 *
 * @returns 40 sample points, or a single-bar fallback flagged by `flat`
 *
 * @example densityOf(rows, 0, col).points.length;   // 40
 */
function densityOf(rows, a, col) {
  const xs = [];
  for (const r of rows) if (r.vals[a] != null) xs.push(r.vals[a]);
  if (col.flat || xs.length < 2) return { flat: true, points: [] };

  const m = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / m;
  let varc = 0;
  for (const v of xs) varc += (v - mean) * (v - mean);
  const sd = Math.sqrt(varc / Math.max(1, m - 1));
  const h = 1.06 * sd * Math.pow(m, -0.2);
  if (!(h > 0)) return { flat: true, points: [] };

  const N = 40;
  const span = col.hi - col.lo;
  const ys = [];
  for (let i = 0; i < N; i++) {
    const x = col.lo + (span * i) / (N - 1);
    let s = 0;
    for (const v of xs) {
      const z = (x - v) / h;
      s += Math.exp(-0.5 * z * z);
    }
    ys.push(s / (m * h * Math.sqrt(2 * Math.PI)));
  }
  const top = Math.max(...ys) || 1;
  return { flat: false, points: ys.map((y, i) => [i / (N - 1), y / top]) };
}

/* -- saying what the picture shows ------------------------------------------------------ */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets, per configuration.
 *
 * `role="img"` hides the SVG's internals, so this is the whole picture to anyone using it. A
 * splom's aria label cannot list sixty-four panels, so it says what the grid is, what the
 * diagonal and the upper triangle are showing under the current settings, and then the two things
 * that change how every panel should be read: which columns are constant, and how many cells were
 * unusable.
 *
 * @returns `{ aria, note }`, both plain text
 * @example describe(read, 'histogram', 'correlation', info).note;
 */
function describe(R, diag, upper, info) {
  const k = R.cols.length;
  const pairs = (k * (k - 1)) / 2;
  const census = plural(k, 'column', 'columns') + ' and ' + plural(R.rows.length, 'row', 'rows') +
                 ', ' + plural(pairs, 'pair', 'pairs');

  if (!k) {
    return { aria: 'An empty scatterplot matrix: no columns were given, so there is nothing to ' +
                   'plot against anything.', note: 'no columns.' };
  }
  if (k === 1) {
    return {
      aria: 'A scatterplot matrix of one column, which is a distribution and not a matrix: with ' +
            'nothing to plot it against, only its own panel on the diagonal can be drawn.',
      note: 'one column, so there is no pair to plot; only its own distribution is drawn.',
    };
  }
  if (!R.rows.length) {
    return {
      aria: 'A scatterplot matrix of ' + plural(k, 'column', 'columns') + ' with no usable rows. ' +
            'The grid is drawn so the card keeps its place, but every panel is empty.',
      note: 'no usable rows, so every panel is drawn empty.',
    };
  }

  const diagText = diag === 'histogram'
    ? 'the diagonal is each column own histogram, binned on the square root of its count'
    : diag === 'density'
      ? 'the diagonal is each column own density, Gaussian kernel with Silverman bandwidth'
      : 'the diagonal names each column and gives its range';

  const upperText = upper === 'same'
    ? 'the upper triangle mirrors the lower one with the axes swapped, which is the same ' +
      'information seen from the other side'
    : upper === 'correlation'
      ? 'the upper triangle prints Pearson r for each pair, sized by strength; a dash means one ' +
        'of the two columns never varies, so r is undefined rather than zero'
      : 'the upper triangle is blank, because it holds nothing the lower one does not';

  const flats = R.flats.length
    ? ' ' + plural(R.flats.length, 'column is', 'columns are') + ' constant (' + R.flats.join(', ') +
      '); a column with no range draws as one line of dots through the middle of every panel it ' +
      'is in, and correlates with nothing.'
    : '';

  const sampled = info.step > 1
    ? ' every ' + info.step + 'th row is drawn -- ' + info.drawn + ' of ' + R.rows.length +
      ' -- because ' + R.rows.length + ' rows over ' + (k * k) + ' panels is ' +
      (R.rows.length * k * k) + ' dots and the sampling is systematic, so the picture is the ' +
      'same on every build.'
    : '';

  const extra = R.extra.length
    ? ' ' + plural(R.extra.length, 'column was', 'columns were') + ' past the limit of ' + COL_MAX +
      ' and is not drawn: ' + R.extra.join(', ') + '.'
    : '';

  const junk = [];
  if (R.bad.badCell) junk.push(plural(R.bad.badCell, 'cell was', 'cells were') +
    ' not a number, so those rows are missing from the panels using that column and present in ' +
    'the rest');
  if (R.bad.noKey) junk.push(plural(R.bad.noKey, 'column', 'columns') + ' had no key');
  if (R.bad.dupe) junk.push(plural(R.bad.dupe, 'column was', 'columns were') + ' a duplicate key');
  if (R.bad.badRow) junk.push(plural(R.bad.badRow, 'row was', 'rows were') + ' not an object');
  const junkText = junk.length ? ' ' + junk.join('; ') + '.' : '';

  const note = (diagText + '; ' + upperText + '.' + flats + sampled + extra + junkText)
    .replace(/\s+/g, ' ').trim();
  const aria = ('Scatterplot matrix, ' + census + '. ' + diagText + '; ' + upperText + '.' +
                flats + sampled + extra + junkText).replace(/\s+/g, ' ').trim();
  return { aria, note };
}

/* -- the browser half ------------------------------------------------------------------- */

/**
 * Every panel of the matrix as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so
 * the function a test calls here is textually the function the page runs.
 *
 * Positions arrive already normalised: `model.frac[r][c]` is the fraction of that column's range
 * the value sits at, computed in Node through the real `CK.scale` -- including its zero-width
 * domain guard, which is what puts a constant column's dots on the panel's centre line instead of
 * dividing by zero. This function turns fractions into pixels and nothing else, so there is
 * exactly one place where a value becomes a position.
 *
 * @param model the precomputed model: columns, fractions, histograms, densities, correlations
 * @param cfg   `{ diagonal, size, upper }`
 * @returns `{ w, h, marks }` -- the viewBox and the display list to paint in it
 *
 * @example splomGeom(model, { diagonal: 'histogram', size: 76, upper: 'blank' }).w;   // 316
 */
function splomGeom(model, cfg) {
  var i, j, r;
  var k = model.k;

  function r2(v) { return Math.round(v * 100) / 100; }

  if (!k) { return { w: 100, h: 40, marks: [] }; }

  var size = Math.round(Number(cfg.size));
  if (!isFinite(size)) { size = model.sizeDef; }
  if (size < model.sizeMin) { size = model.sizeMin; }
  if (size > model.sizeMax) { size = model.sizeMax; }

  var pitch = size + model.gap;
  var padL = model.padL;
  var padT = 4;
  var padB = 14;
  var w = padL + k * pitch + 4;
  var h = padT + k * pitch + padB;

  function px(col) { return padL + col * pitch; }
  function py(row) { return padT + row * pitch; }

  var dot = Math.max(1.1, Math.min(2.6, size / 34));
  var kids = [];

  for (i = 0; i < k; i++) {
    for (j = 0; j < k; j++) {
      var x = px(j);
      var y = py(i);
      var upperCell = j > i;
      if (upperCell && cfg.upper === 'blank') { continue; }

      kids.push({ t: 'rect', a: { x: r2(x), y: r2(y), width: size, height: size, "class": 'pan' } });

      if (i === j) {
        kids.push({ t: 'text', a: { x: r2(x + size / 2), y: r2(y + 11), "class": 'name',
                                    'text-anchor': 'middle' },
                    s: model.clipLab[i], ti: model.colTip[i] });
        if (cfg.diagonal === 'name') {
          kids.push({ t: 'text', a: { x: r2(x + size / 2), y: r2(y + size / 2 + 4), "class": 'rng',
                                      'text-anchor': 'middle' }, s: model.rangeLab[i] });
          continue;
        }
        var useDensity = cfg.diagonal === 'density' && !model.dens[i].flat;
        if (useDensity) {
          var pts = model.dens[i].points;
          var d = 'M' + r2(x) + ',' + r2(y + size);
          for (r = 0; r < pts.length; r++) {
            d += 'L' + r2(x + pts[r][0] * size) + ',' + r2(y + size - pts[r][1] * (size - 16));
          }
          d += 'L' + r2(x + size) + ',' + r2(y + size) + 'Z';
          kids.push({ t: 'path', a: { d: d, "class": 'dens' } });
        } else {
          var hs = model.hist[i].heights;
          var bw = size / hs.length;
          for (r = 0; r < hs.length; r++) {
            var bh = hs[r] * (size - 16);
            kids.push({ t: 'rect', a: { x: r2(x + r * bw + 0.5), y: r2(y + size - bh),
                                        width: r2(Math.max(0.5, bw - 1)), height: r2(bh),
                                        "class": 'bar' } });
          }
        }
        continue;
      }

      if (upperCell && cfg.upper === 'correlation') {
        var rv = model.corr[i][j];
        var fs = rv == null ? 11 : 10 + Math.abs(rv) * Math.min(20, size * 0.22);
        kids.push({ t: 'text',
                    a: { x: r2(x + size / 2), y: r2(y + size / 2 + fs * 0.35), 'font-size': r2(fs),
                         "class": rv == null ? 'rnil' : (rv < 0 ? 'rneg' : 'rpos'),
                         'text-anchor': 'middle' },
                    s: model.corrLab[i][j], ti: model.corrTip[i][j] });
        continue;
      }

      /* A dot needs both coordinates. A row missing one of them is absent HERE and present in
         every panel whose two columns it does have, which is the whole reason the holes are kept
         per cell rather than the row being dropped. */
      for (r = 0; r < model.pick.length; r++) {
        var ri = model.pick[r];
        var fx = model.frac[ri][j];
        var fy = model.frac[ri][i];
        if (fx == null || fy == null) { continue; }
        var mark = { t: 'circle',
                     a: { cx: r2(x + fx * size), cy: r2(y + size - fy * size), r: r2(dot),
                          "class": 'pt', fill: model.rowCol[ri] } };
        if (model.tipOn) { mark.ti = model.rowTip[ri]; }
        kids.push(mark);
      }
    }
  }

  /* Axis numbers only on the outer edge. A number beside every panel would be sixty-four pairs of
     labels for eight facts, and the fact is the column range, which does not change down a row. */
  for (i = 0; i < k; i++) {
    kids.push({ t: 'text', a: { x: r2(padL - 4), y: r2(py(i) + 8), "class": 'tk',
                                'text-anchor': 'end' }, s: model.hiLab[i] });
    kids.push({ t: 'text', a: { x: r2(padL - 4), y: r2(py(i) + size - 2), "class": 'tk',
                                'text-anchor': 'end' }, s: model.loLab[i] });
    kids.push({ t: 'text', a: { x: r2(px(i) + 2), y: r2(padT + k * pitch + 9), "class": 'tk',
                                'text-anchor': 'start' }, s: model.loLab[i] });
    kids.push({ t: 'text', a: { x: r2(px(i) + size - 2), y: r2(padT + k * pitch + 9), "class": 'tk',
                                'text-anchor': 'end' }, s: model.hiLab[i] });
  }

  return { w: r2(w), h: r2(h), marks: kids };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every dot on the second pass.
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
 * A positive and a negative correlation get different series tokens rather than different
 * lightnesses, because the sign is a category and not a magnitude -- the magnitude is already
 * carried by the type size.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-sp-scroll', 'max-height: 74vh; overflow-y: auto; margin-top: 2px;'],
    ['svg.ck-sp', 'display: block; width: 100%; height: auto;'],
    ['svg.ck-sp text', 'font-family: var(--mono); font-size: 9px;'],

    ['.ck-sp .pan', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-sp .pt', 'stroke: none; fill-opacity: .75;'],
    ['.ck-sp .bar', 'fill: var(--ink-dim); opacity: .55;'],
    ['.ck-sp .dens', 'fill: var(--ink-dim); opacity: .35; stroke: var(--ink-dim); stroke-width: 1;'],
    ['.ck-sp .name', 'fill: var(--ink-dim);'],
    ['.ck-sp .rng, .ck-sp .tk', 'fill: var(--ink-faint); font-size: 8.5px;'],
    ['.ck-sp .rpos', 'fill: var(--ck-s6);'],
    ['.ck-sp .rneg', 'fill: var(--ck-s1);'],
    ['.ck-sp .rnil', 'fill: var(--ink-faint);'],

    ['.ck-sp-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-legend i.sw-pos', 'background: var(--ck-s6);'],
    ['.ck-legend i.sw-neg', 'background: var(--ck-s1);'],
    ['.ck-set input[type="number"]', 'width: 6.5em;'],
  ];

  return scope(id, rules) + '\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the grid and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The part that changes with the settings is an
 * empty `<i>` the script fills with `textContent`.
 */
function cardHtml(id, title, R, said) {
  const e = CK.esc;
  const k = R.cols.length;

  const void_ = k ? '' :
    '  <div class="ck-sp-void">nothing to draw &mdash; no columns were given</div>\n';

  const svg = k
    ? '  <div class="ck-scroll ck-sp-scroll">\n' +
      '    <svg class="ck-sp" role="img" viewBox="0 0 100 40" aria-label="' + e(said.aria) + '"></svg>\n' +
      '  </div>\n'
    : '';

  const legend = [];
  if (k > 1) {
    legend.push('<span><i class="sw-pos"></i>r positive</span>');
    legend.push('<span><i class="sw-neg"></i>r negative</span>');
  }
  R.catIds.forEach((c, i) => {
    legend.push('<span><i data-s="' + ((i % 8) + 1) + '"></i>' + e(c) + '</span>');
  });

  return '<section data-card="' + e(id) + '" class="ck-splom">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-diagonal">diagonal</label>\n' +
    '    <select id="' + e(id) + '-diagonal" name="diagonal">\n' +
    DIAG_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-upper">above the diagonal</label>\n' +
    '    <select id="' + e(id) + '-upper" name="upper">\n' +
    UPPER_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-size">panel (px)</label>\n' +
    '    <input type="number" id="' + e(id) + '-size" name="size" min="' + SIZE_MIN +
    '" max="' + SIZE_MAX + '" step="2">\n' +
    '    <div class="ck-set-foot">at most ' + COL_MAX + ' columns are drawn: ' + COL_MAX +
    ' is already ' + (COL_MAX * COL_MAX) + ' panels and ' + ((COL_MAX * (COL_MAX - 1)) / 2) +
    ' distinct pairs, which is more than anyone compares.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(k)) + '</b> ' + (k === 1 ? 'column' : 'columns') +
    ' by <b>' + e(String(R.rows.length)) + '</b> ' + (R.rows.length === 1 ? 'row' : 'rows') +
    '. <i class="ck-sp-note">' + e(said.note) + '</i></div>\n' +
    (legend.length ? '  <div class="ck-legend">' + legend.join('') + '</div>\n' : '') +
    '</section>\n';
}

/**
 * The browser half: pick the notes the settings name, lay out the grid, paint it.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated on the way in: they come out
 * of `localStorage`, which is a text file the viewer can edit, and a mode read straight out of it
 * and used as a property name would reach `Object.prototype` on the string `constructor`.
 */
function cardJs(id, model, inst) {
  const js =
    '/* splom card: domains, fractions, histograms, densities and correlations computed in Node;\n' +
    '   only the grid happens here, because the panel size is a viewer setting. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    splomGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-sp");\n' +
    '  var note = sec.querySelector(".ck-sp-note");\n\n' +
    '  function pick(v, list, fallback) {\n' +
    '    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }\n' +
    '    return fallback;\n' +
    '  }\n\n' +
    '  function draw(cfg) {\n' +
    '    var diag = pick(cfg.diagonal, MODEL.diagModes, DEF.diagonal);\n' +
    '    var up = pick(cfg.upper, MODEL.upperModes, DEF.upper);\n' +
    '    var key = diag + "/" + up;\n' +
    '    if (note) { note.textContent = MODEL.notes[key]; }\n' +
    '    if (!box || !MODEL.k) { return; }\n' +
    '    var got = splomGeom(MODEL, { diagonal: diag, upper: up, size: cfg.size });\n' +
    '    paintList(box, got.marks);\n' +
    '    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);\n' +
    '    box.style.minWidth = Math.ceil(got.w) + "px";\n' +
    '    box.setAttribute("aria-label", MODEL.arias[key]);\n' +
    '  }\n\n' +
    '  CK.settings(sec, DEF, draw);\n' +
    '});\n';
  return guardEmitted(js, id);
}

/**
 * Build one scatterplot-matrix card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the correlation matrix and every column's
 *          domain, so a reader can check the caption without re-deriving anything
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'bench',
 *   title: 'every measure against every other',
 *   data: {
 *     columns: [{ key: 'ms', label: 'latency' }, { key: 'mb', label: 'peak RSS' }],
 *     rows: [{ ms: 91, mb: 210, host: 'a' }, { ms: 140, mb: 180, host: 'b' }],
 *     colorBy: 'host',
 *   },
 *   ord: 45,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'splom' : id);
  const R = readData(data);
  const k = R.cols.length;

  /* Every value becomes a fraction of its own column through the real `CK.scale`. Its
     zero-width-domain guard is load-bearing: a constant column has `lo === hi`, every naive
     normaliser divides by zero there, and `CK.scale` parks the value at the midpoint instead --
     which draws that column as one line of dots through the middle of its panels, the honest
     picture of a variable that never varies. */
  const toFrac = R.cols.map((c) => CK.scale([c.lo, c.hi], [0, 1]));
  const frac = R.rows.map((row) =>
    row.vals.map((v, a) => (v == null ? null : n4(toFrac[a](v), 'fraction'))));

  /* Systematic sampling, decided once against the worst case -- every panel drawn -- so the
     caption can state a number that stays true when the viewer switches the upper triangle on. */
  const worst = R.rows.length * Math.max(1, k * k);
  const step = worst > DOT_CAP ? Math.ceil(worst / DOT_CAP) : 1;
  const pick = [];
  for (let i = 0; i < R.rows.length; i += step) pick.push(i);
  const info = { step, drawn: pick.length };

  const corr = R.cols.map(() => R.cols.map(() => null));
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const r = pearson(R.rows, a, b);
      corr[a][b] = r == null ? null : n4(r, 'corr');
      corr[b][a] = corr[a][b];
    }
  }

  const hist = R.cols.map((c, a) => {
    const h = histOf(R.rows, a, c);
    return { bins: h.bins, heights: h.heights.map((v) => n4(v, 'hist')) };
  });
  const dens = R.cols.map((c, a) => {
    const dd = densityOf(R.rows, a, c);
    return { flat: dd.flat, points: dd.points.map(([x, y]) => [n4(x, 'dx'), n4(y, 'dy')]) };
  });

  const clipLab = R.cols.map((c) => clip(c.label, LAB_MAX));
  const loLab = R.cols.map((c) => CK.fmt(c.lo));
  const hiLab = R.cols.map((c) => CK.fmt(c.hi));
  const rangeLab = R.cols.map((c) => (c.flat ? CK.fmt(c.lo) : CK.fmt(c.lo) + ' \u2013 ' + CK.fmt(c.hi)));

  const corrLab = corr.map((row) => row.map((v) => (v == null ? '\u2014' : (v >= 0 ? '' : '\u2212') + Math.abs(v).toFixed(2))));
  const corrTip = R.cols.map((ca, a) => R.cols.map((cb, b) =>
    ca.label + ' vs ' + cb.label + ' \u00b7 ' +
    (corr[a][b] == null ? 'r undefined, one of them never varies' : 'r ' + corr[a][b].toFixed(3))));
  const colTip = R.cols.map((c) =>
    c.label + ' \u00b7 ' + (c.flat ? 'constant at ' + CK.fmt(c.lo)
                                   : CK.fmt(c.lo) + ' to ' + CK.fmt(c.hi)) +
    ' \u00b7 ' + plural(c.count, 'value', 'values'));

  const rowCol = R.rows.map((_, i) => (R.colorBy ? CK.hue(R.catOf[i]) : 'var(--accent)'));
  const rowTip = R.rows.map((row) =>
    (R.colorBy ? String(row.raw[R.colorBy] == null ? '\u2014' : row.raw[R.colorBy]) + ' \u00b7 ' : '') +
    R.cols.map((c, a) => c.label + ' ' + (row.vals[a] == null ? '\u2014' : CK.fmt(row.vals[a])))
      .join(' \u00b7 '));

  const model = {
    k,
    gap: GAP,
    sizeMin: SIZE_MIN,
    sizeMax: SIZE_MAX,
    sizeDef: SIZE_DEF,
    padL: Math.max(20, Math.round(hiLab.concat(loLab).reduce((m, s) => Math.max(m, textW(s)), 0)) + 6),
    clipLab, loLab, hiLab, rangeLab,
    corr, corrLab, corrTip, colTip,
    hist, dens,
    frac, pick, rowCol, rowTip,
    tipOn: pick.length * Math.max(1, k * k) <= TIP_CAP ? 1 : 0,
    diagModes: DIAG_MODES.slice(),
    upperModes: UPPER_MODES.slice(),
    notes: {},
    arias: {},
  };

  for (const diag of DIAG_MODES) {
    for (const up of UPPER_MODES) {
      const said = describe(R, diag, up, info);
      model.notes[diag + '/' + up] = said.note;
      model.arias[diag + '/' + up] = said.aria;
    }
  }

  /* The browser half is exercised here over every configuration a viewer can reach, so a
     degenerate input that would produce a NaN coordinate is caught at build time next to the data
     that caused it rather than at paint time, where the browser drops the attribute in silence. */
  if (k) {
    for (const diag of DIAG_MODES) {
      for (const up of UPPER_MODES) {
        for (const size of [SIZE_MIN, SIZE_DEF, SIZE_MAX]) {
          const got = splomGeom(model, { diagonal: diag, upper: up, size });
          assertFinite(got.marks, diag + '/' + up + '/size ' + size);
        }
      }
    }
  }

  const active = describe(R, defaults.diagonal, defaults.upper, info);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'splom',
      columns: k,
      columnLimit: COL_MAX,
      columnsNotDrawn: R.extra,
      rows: R.rows.length,
      rowsDrawn: pick.length,
      sampleStep: step,
      constantColumns: R.flats,
      refused: { columnsWithoutKey: R.bad.noKey, duplicateColumns: R.bad.dupe,
                 nonNumericCells: R.bad.badCell, badRows: R.bad.badRow },
      domains: R.cols.map((c) => ({ label: c.label, lo: c.lo, hi: c.hi, values: c.count })),
      correlation: corr,
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active),
    css: cardCss(cardId),
    js: cardJs(cardId, model, { ...defaults }),
  };
}

/* Exported for the verifier only: the geometry the browser runs and the statistics beneath it, so
   a test can check a dot lands where its value says using the same text the page gets. */
export { splomGeom, pearson, histOf, densityOf, readData };
