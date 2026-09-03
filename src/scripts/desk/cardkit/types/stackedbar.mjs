/**
 * `stackedbar` — stacked bars and columns, with a percent mode that lands on an exact hundred
 * and a caption that names what stacking hides.
 *
 * ON WHETHER THIS TYPE SHOULD EXIST, since `chart` with `kind: 'bar' | 'column'` and
 * `stacked: true` already draws a stacked bar and already accumulates positive and negative
 * parts away from zero in opposite directions. The honest accounting is under {@link build};
 * the short version is that the *drawing* overlaps `chart` almost completely and the *card*
 * does not, because a mode reachable only by setting a boolean on a generic type is a mode
 * nobody browsing a 56-type gallery will ever find.
 *
 * What is genuinely not in `chart`: a percent mode built from cumulative fractions so a bar
 * sums to exactly 100 rather than to 99.97; an absolute-total label at the end of every bar,
 * which in percent mode is the one number normalisation deletes; per-segment labels under a
 * reader-controlled policy rather than a fixed one; and a caption that states stacking's
 * central flaw out loud — that only the bottom band shares a baseline, so only the bottom band
 * can be compared across bars by eye.
 *
 * Everything geometric is computed by {@link sbRender}, which is the same function in Node and
 * in the browser: Node runs it once for the picture that ships inside `card.html`, and the
 * browser re-runs it when the reader changes a setting. `CK` is loaded out of `kit.js` in a
 * `node:vm` context, so `CK.scale`, `CK.ticks`, `CK.fmt` and `CK.hue` here are the ones the
 * page has, rather than a private copy that drifts.
 *
 * @see ./chart.mjs       — the generic plotter, which already stacks; the overlap is discussed
 *                          under {@link build} rather than glossed over
 * @see ./stackedarea.mjs — the same stack over a continuous x, and the same percent argument
 * @see ./pie.mjs         — one bar's worth of part-of-a-whole, without the comparison across bars
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it — nothing reaches for `document` until a function that
 * needs the DOM is called, and none of those are called here.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().ticks(0, 97, 5);    // [0, 20, 40, 60, 80] — 100 is past max
 * @example loadKit().ticks(0, 100, 5);   // [0, 50, 100]
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/stackedbar: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/stackedbar: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const H0   = 300;
const WMAX = 2200;

/* Caps on the PAYLOAD, not on the arithmetic: every count in the caption is taken from the
   complete data before anything is dropped, and the drop is itself reported. */
const CATCAP = 400;
const SERCAP = 40;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `absolute` is the default because it is the mode that cannot mislead — the end of the bar is
 * the total, and every question about magnitude has an answer on the axis. `fit` is the default
 * label policy for the same reason a chart does not label every point: a number that does not
 * fit inside its segment is a smear over the picture it was meant to annotate.
 */
export const defaults = {
  orient: 'column',
  mode:   'absolute',
  labels: 'fit',
  total:  true,
};

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `part-of-a-whole` rather than `ranking-and-comparison`, which is where `chart` lives, and the
 * split is the point: a stacked bar answers "how does each bar divide?" first and "which bar is
 * bigger?" second. A reader arriving with the division question would never think to look under
 * comparison, which is most of the case for this file existing at all.
 */
export const meta = {
  name: 'stackedbar',
  summary:
    'Stacked bars and columns, with a percent mode that lands on an exact hundred and a caption ' +
    'that names what stacking hides.',
  shape:
    "{ series: [{ name, points: [{ x, y }] }], orient: 'column' | 'bar', " +
    "mode: 'absolute' | 'percent', xLabel, yLabel, unit } — x a category, y numeric",
  category: 'part-of-a-whole',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one
 * card in this catalogue was refused because a comment said "the class is what CSS reads" — and
 * a guard that cries wolf is a guard somebody switches off. Offsets are preserved so a reported
 * position still points at the right place. Regex literals are recognised, because otherwise the
 * scanner desynchronises on the quote inside a `replace` call and starts blanking real code,
 * which turns a false positive into a far worse false negative.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, comment and string contents replaced by spaces
 *
 * @example blankNonCode('var a = "const";').indexOf('const');   // -1
 */
export function blankNonCode(src) {
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
    /* A slash is a regex only where a value cannot precede it. Tracking the previous significant
       character is the cheap approximation that gets this right for real code. */
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

/**
 * Refuse to emit browser script that would break the whole desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in
 * a comment as readily as in code, because `Function.prototype.toString()` ships comments
 * verbatim — closes the surrounding template literal early and blanks every card on the desk.
 * The backtick is never written in this file; it is reached for as `String.fromCharCode(96)`,
 * which cannot be mistyped and cannot be mis-decoded during emission.
 *
 * Backtick, arrow and optional chaining are scanned raw, because none of them can appear
 * innocently. The declaration keywords are scanned only after {@link blankNonCode}, because they
 * can and do appear innocently in English.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/stackedbar';
  const near = (at) => src.slice(Math.max(0, at - 45), at + 45);
  const die = (what, at) => {
    throw new Error(where + ': emitted js ' + what + ' at offset ' + at + ' - near: ' + near(at));
  };

  const tick = src.indexOf(String.fromCharCode(96));
  if (tick >= 0) die('contains a backtick', tick);

  const arrow = src.indexOf(String.fromCharCode(61) + String.fromCharCode(62));
  if (arrow >= 0) die('contains an arrow function', arrow);

  const opt = src.indexOf(String.fromCharCode(63) + String.fromCharCode(46));
  if (opt >= 0) die('contains optional chaining', opt);

  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) die('contains control character ' + c, i);
  }

  const code = blankNonCode(src);
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('(^|[^\\w$.])' + kw + '[\\s({]').exec(code);
    if (m) die('declares ' + kw, m.index);
  }

  return src;
}

/* ── reading the data ────────────────────────────────────────────────────────────────── */

/**
 * Normalise whatever arrived into the one shape the renderer may assume.
 *
 * Points with a non-finite `y` or an absent `x` are refused and counted rather than coerced: a
 * missing reading is missing, and a stack that silently treats it as zero has invented a
 * contribution nobody supplied. An absent category is different from a zero one and is kept as
 * such — `has` records which is which — because a band that is genuinely nothing and a band that
 * was never measured must not draw the same.
 *
 * Empty series are kept, because dropping one would shift every later series onto a different
 * colour and the legend would stop matching the picture.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns the payload {@link sbRender} takes, plus the counts the caption reports
 *
 * @example
 * readData({ series: [{ name: 'core', points: [{ x: 'Jan', y: 4 }] }] }).cats[0].label;   // 'Jan'
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.series) ? d.series : [];

  const seen = new Map();
  let refused = 0;
  let dupes = 0;
  let numeric = true;

  const kept = [];
  let droppedSeries = 0;

  for (let i = 0; i < raw.length; i++) {
    if (kept.length >= SERCAP) { droppedSeries++; continue; }
    const s = raw[i];
    const pts = s && Array.isArray(s.points) ? s.points : [];
    const byCat = new Map();

    for (const p of pts) {
      if (!p || typeof p !== 'object' || p.x == null) { refused++; continue; }
      const y = Number(p.y);
      if (!Number.isFinite(y)) { refused++; continue; }
      const key = String(p.x);
      if (typeof p.x !== 'number' || !Number.isFinite(p.x)) numeric = false;
      if (byCat.has(key)) dupes++;
      byCat.set(key, y);
      if (!seen.has(key)) seen.set(key, { key, x: typeof p.x === 'number' ? p.x : 0 });
    }

    kept.push({ name: String(s && s.name != null ? s.name : 'series ' + (i + 1)), byCat });
  }

  /* Numeric categories sort numerically, because 2 before 10 is the only ordering a reader will
     accept; string categories keep first-appearance order across the series, which is the order
     the author wrote them in and therefore the order they meant. */
  let cats = [...seen.values()];
  if (numeric) cats.sort((a, b) => a.x - b.x);
  const droppedCats = Math.max(0, cats.length - CATCAP);
  cats = cats.slice(0, CATCAP).map((c) => ({ key: c.key, label: numeric ? CK.fmt(c.x) : c.key }));

  let gaps = 0;
  const rows = kept.map((s, si) => {
    const v = [];
    const has = [];
    let neg = 0;
    let zero = 0;
    for (const c of cats) {
      const there = s.byCat.has(c.key);
      const y = there ? s.byCat.get(c.key) : 0;
      if (!there) gaps++;
      else if (y < 0) neg++;
      else if (y === 0) zero++;
      v.push(y);
      has.push(there);
    }
    return { name: s.name, si, v, has, neg, zero };
  });

  const orient = d.orient === 'bar' || d.orient === 'column' ? d.orient : null;
  const mode = d.mode === 'percent' || d.mode === 'absolute' ? d.mode : null;

  return {
    cats,
    rows,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    yLabel: d.yLabel == null ? '' : String(d.yLabel),
    unit:   d.unit   == null ? '' : String(d.unit),
    refused, dupes, gaps, droppedSeries, droppedCats,
    orient, mode,
    W0, H0, WMAX,
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────── */
/* Written in the browser's vocabulary from here down to the SHIPPED list — var and function, no
   arrows, no template literals, no backtick in any comment — because every one of these is
   emitted verbatim through Function.prototype.toString() and is ALSO run here, in Node, to draw
   the copy that ships inside card.html. One source, two runtimes, nothing to drift. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path or an attribute is silent: the browser drops the whole value and
 * the card renders empty with nothing in the console. Failing here turns that into a stack trace
 * next to the input that caused it.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/stackedbar: non-finite coordinate (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/**
 * Width in px of a string set in the plot's 9px mono face.
 *
 * Measured rather than guessed: the advance is a hair under 5.42px in the mono stacks the desk
 * ships. It only has to be close, because it decides which segment labels are dropped, and being
 * half a pixel pessimistic drops one that would just have fitted, which is the safe way to be wrong.
 *
 * @example tw('1.2k');   // about 21.7
 */
function tw(s, size) { return String(s).length * 5.42 * ((size || 9) / 9); }

/** Shorten a label to `max` px, keeping the head and marking the cut with an ellipsis. */
function clipTo(s, max, size) {
  var str = String(s);
  var per = 5.42 * ((size || 9) / 9);
  var room = Math.floor(max / per);
  if (str.length <= room) { return str; }
  return str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/** The unit as a suffix, with the space that makes it read as a unit rather than as a digit. */
function unitOf(P) { return P && P.unit ? ' ' + P.unit : ''; }

/* Display-list primitives. Every mark is { t: tagName, a: attributes, s: text, ti: tooltip },
   with real SVG attribute names and no abbreviation table, so the browser-side translator knows
   nothing about stacking and a mark in a debugger reads as the element it becomes. */

function mLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' } };
}

function mText(x, y, s, cls, anchor) {
  return { t: 'text', a: { x: fin(x), y: fin(y), 'class': cls || '', 'text-anchor': anchor || 'start' },
           s: String(s) };
}

function mRect(x, y, w, h, cls, fill) {
  return { t: 'rect', a: { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)),
                           'class': cls || '', fill: fill || 'none' } };
}

/**
 * Settle a settings object into the four values the renderer may assume.
 *
 * Called with nothing it must return exactly {@link defaults}; the test suite asserts that, so
 * the shipped copy and the declared metadata cannot drift apart without something failing.
 *
 * @example sbConfig({ mode: 'percent' }).labels;   // 'fit'
 */
function sbConfig(conf) {
  var c = conf && typeof conf === 'object' ? conf : {};
  return {
    orient: c.orient === 'bar' ? 'bar' : 'column',
    mode:   c.mode === 'percent' ? 'percent' : 'absolute',
    labels: c.labels === 'none' || c.labels === 'all' ? c.labels : 'fit',
    total:  c.total === undefined || c.total === null ? true : !!c.total
  };
}

/**
 * Round a domain outward to whole ticks, so the top gridline is the top of the plot.
 *
 * `CK.ticks` only returns ticks that fall inside the domain it is given, so a raw data domain
 * leaves a ragged strip above the last gridline. The ticks are then stepped out rather than
 * re-derived: asking `CK.ticks` again with the wider range can push it up to the next nice step
 * and halve the number of gridlines, which loses the tick at the top all over again.
 *
 * @example sbSnap(3, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
 */
function sbSnap(lo, hi, want) {
  var t = CK.ticks(lo, hi, want), step, nlo, nhi, out, k, v;
  if (t.length < 2) { return { lo: lo, hi: hi, ticks: t }; }
  step = t[1] - t[0];
  if (!(step > 0)) { return { lo: lo, hi: hi, ticks: t }; }
  nlo = Math.floor(lo / step) * step;
  nhi = Math.ceil(hi / step) * step;
  if (!(nhi > nlo)) { return { lo: lo, hi: hi, ticks: t }; }
  out = [];
  for (k = 0; k < 400; k++) {
    v = nlo + k * step;
    if (v > nhi + step / 1e6) { break; }
    out.push(Math.round(v / step) * step);
  }
  return { lo: nlo, hi: nhi, ticks: out };
}

/**
 * One bar's worth of stacking: where every segment starts and ends, in value space.
 *
 * Absolute mode keeps two running offsets, one climbing away from zero and one falling, so a
 * category holding +3 and -4 reaches from -4 to +3 rather than cancelling to -1.
 *
 * Percent mode is built from CUMULATIVE fractions rather than by dividing each value by the
 * total. The difference matters: dividing per segment leaves a hairline of rounding under the
 * top rule, which reads as a band the chart forgot. Here the last boundary is `total / total`
 * scaled by a hundred, and `x / x` is exactly one in IEEE-754 for every finite non-zero `x`, so
 * the top of the bar lands on exactly 100 — not on 99.97 and not on 100.00000000000001. The
 * running total is accumulated by the same additions in the same order as the running cumulative,
 * so the two agree bit for bit.
 *
 * A percent bar whose entries sum to zero has no total to divide by. It is marked `undef` rather
 * than drawn as anything, because every possible drawing would be a claim about shares that do
 * not exist.
 *
 * @param cats the ordered categories
 * @param rows the retained series, each with `v` and `has` aligned to `cats`
 * @param pct  whether to normalise each bar to a hundred
 * @returns one entry per category: `{ segs, up, dn, total, undef }`
 *
 * @example sbStack([{key:'a'}], [{v:[3],has:[true]},{v:[1],has:[true]}], true)[0].segs[1].hi;  // 100
 */
function sbStack(cats, rows, pct) {
  var out = [], ci, ri, k, present, v, up, dn, segs, total, cum, prev, b;

  for (ci = 0; ci < cats.length; ci++) {
    present = [];
    for (ri = 0; ri < rows.length; ri++) {
      if (rows[ri].has[ci]) { present.push({ ri: ri, v: rows[ri].v[ci] }); }
    }

    segs = []; up = 0; dn = 0; total = 0;

    if (pct) {
      for (k = 0; k < present.length; k++) { total += present[k].v; }
      if (!(total > 0)) {
        out.push({ segs: [], up: 0, dn: 0, total: total, undef: true });
        continue;
      }
      cum = 0; prev = 0;
      for (k = 0; k < present.length; k++) {
        cum += present[k].v;
        b = cum / total * 100;
        segs.push({ ri: present[k].ri, v: present[k].v, lo: prev, hi: b, share: b - prev });
        prev = b;
      }
      out.push({ segs: segs, up: prev, dn: 0, total: total, undef: false });
    } else {
      for (k = 0; k < present.length; k++) {
        v = present[k].v;
        if (v >= 0) {
          segs.push({ ri: present[k].ri, v: v, lo: up, hi: up + v, share: v });
          up = up + v;
        } else {
          segs.push({ ri: present[k].ri, v: v, lo: dn, hi: dn + v, share: v });
          dn = dn + v;
        }
      }
      out.push({ segs: segs, up: up, dn: dn, total: up + dn, undef: false });
    }
  }
  return out;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire chart to anyone using it —
 * "stacked bar chart" names the genre and withholds the content, which is not an acceptable
 * answer. Both sentences say what stacking costs, because that cost is the single thing a reader
 * of a stacked bar most needs told and the drawing itself cannot say it.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function sbNote(P, c, cols, rows, dropped, undefCols) {
  var pct = c.mode === 'percent';
  var word = (c.orient === 'bar' ? 'stacked bar chart' : 'stacked column chart');
  var unit = unitOf(P);
  var i, bits = [], lo = 0, hi = 0, drew = 0;

  if (!rows.length || !P.cats.length) {
    return {
      aria: word.charAt(0).toUpperCase() + word.slice(1) + ' with no data: nothing is stacked.',
      caption: 'a ' + CK.esc(word) + ' with <b>no data</b> &mdash; the frame is drawn so the card ' +
               'keeps its place, but there is nothing in it.'
    };
  }

  for (i = 0; i < cols.length; i++) {
    if (cols[i].undef) { continue; }
    drew++;
    if (cols[i].up > hi) { hi = cols[i].up; }
    if (cols[i].dn < lo) { lo = cols[i].dn; }
  }

  var totals = [];
  for (i = 0; i < cols.length; i++) { if (!cols[i].undef) { totals.push(cols[i].total); } }
  var tlo = totals.length ? Math.min.apply(null, totals) : 0;
  var thi = totals.length ? Math.max.apply(null, totals) : 0;

  var span = P.cats.length + ' ' + (P.cats.length === 1 ? 'category' : 'categories');
  var nser = rows.length + ' ' + (rows.length === 1 ? 'band' : 'bands');

  /* The flaw, stated rather than implied. A stacked bar moves every baseline above the first,
     so the eye can compare the bottom band across bars and cannot compare any other. */
  var flaw = rows.length > 1
    ? 'only the bottom band starts at zero in every bar, so only it can be compared across the ' +
      'chart by eye; every band above it begins wherever the ones beneath it happened to end.'
    : 'one band, so nothing is hidden by stacking here: the bar and the band are the same thing.';

  var aria =
    word.charAt(0).toUpperCase() + word.slice(1) + ' of ' + nser + ' across ' + span + ', ' +
    (pct ? 'each bar normalised to 100 percent, with the absolute total printed at the end of the bar'
         : 'totals running from ' + CK.fmt(tlo) + ' to ' + CK.fmt(thi) + unit) + '. ' + flaw;

  if (P.refused)       bits.push('<i>' + P.refused + ' point' + (P.refused === 1 ? '' : 's') + ' refused</i> for a missing category or a value that was not a finite number.');
  if (P.dupes)         bits.push('<i>' + P.dupes + ' duplicate' + (P.dupes === 1 ? '' : 's') + '</i> at a category the last value won.');
  if (P.gaps)          bits.push('<i>' + P.gaps + ' gap' + (P.gaps === 1 ? '' : 's') + '</i> where a band had no reading; those contribute nothing and draw nothing, which is not the same as zero.');
  if (P.droppedSeries) bits.push('<i>' + P.droppedSeries + ' series past the drawing budget</i> were left out.');
  if (P.droppedCats)   bits.push('<i>' + P.droppedCats + ' categories past the drawing budget</i> were left out.');
  if (dropped.length)  bits.push('<i>percent mode refuses ' + CK.esc(dropped.join(', ')) + '</i>, which go negative: a share of a mixed-sign total is not a share.');
  if (undefCols)       bits.push('<i>' + undefCols + ' bar' + (undefCols === 1 ? '' : 's') + ' sum to zero</i>, so there is no total to take a share of and they are drawn as an empty slot.');

  var caption =
    '<b>' + (pct ? 'percent' : 'absolute') + '</b> ' + CK.esc(word) + ' &mdash; <b>' +
    CK.esc(String(rows.length)) + '</b> ' + (rows.length === 1 ? 'band' : 'bands') + ' across <b>' +
    CK.esc(String(drew)) + '</b> ' + (drew === 1 ? 'bar' : 'bars') + '. ' +
    (pct
      ? 'every bar sums to <b>exactly 100%</b> &mdash; the shares are cumulative fractions, not ' +
        'per-band divisions, so the top band reaches the rule instead of stopping a hair under it. ' +
        (c.total ? 'the absolute total is printed at the end of each bar, because that is the one ' +
                   'number normalising removes. ' : '<i>the total is switched off, so nothing on ' +
                   'this card says how big any bar actually is.</i> ')
      : 'totals run from <b>' + CK.esc(CK.fmt(tlo) + unit) + '</b> to <b>' +
        CK.esc(CK.fmt(thi) + unit) + '</b>. ') +
    '<i>' + flaw + '</i> ' +
    (lo < 0 ? '<i>the accented rule is zero</i> &mdash; negative bands stack downward from it, so a ' +
              'band keeps its true thickness instead of cancelling one above it. ' : '') +
    bits.join(' ');

  return { aria: aria, caption: caption };
}

/**
 * Everything the card draws, from the payload and one settings object.
 *
 * The same function in Node and in the browser: Node runs it to produce the picture inside
 * `card.html`, the browser re-runs it when the reader changes orientation, mode, label policy or
 * the total. Because it is one function, the caption can never describe a drawing that is not
 * the drawing on the screen.
 *
 * @param P    the payload from {@link readData}
 * @param conf a settings object, settled by {@link sbConfig}
 * @returns `{ W, H, marks, note, dropped, cols }`
 *
 * @example sbRender(P, { mode: 'percent' }).cols[0].segs.length;
 */
function sbRender(P, conf) {
  var c = sbConfig(conf);
  var horiz = c.orient === 'bar';
  var pct = c.mode === 'percent';
  var cats = P.cats, i, j, k;

  /* Percent has no honest reading for a series that ever goes negative: the total it would be a
     share of is a sum of things pointing in opposite directions. The series is refused whole
     rather than clamped, and named in the caption, so the reader knows a band is missing. */
  var rows = [], dropped = [];
  for (i = 0; i < P.rows.length; i++) {
    if (pct && P.rows[i].neg > 0) { dropped.push(P.rows[i].name); }
    else { rows.push(P.rows[i]); }
  }

  var cols = sbStack(cats, rows, pct);
  var undefCols = 0;
  for (i = 0; i < cols.length; i++) { if (cols[i].undef) { undefCols++; } }

  /* The value domain. Percent is 0..100 by definition; absolute is the extent of the two running
     offsets, and always contains zero because a bar is drawn from it. */
  var lo = 0, hi = 0;
  if (pct) { hi = 100; }
  else {
    for (i = 0; i < cols.length; i++) {
      if (cols[i].up > hi) { hi = cols[i].up; }
      if (cols[i].dn < lo) { lo = cols[i].dn; }
    }
  }
  if (!(hi > lo)) { hi = lo + 1; }

  var snapd = pct ? { lo: 0, hi: 100, ticks: CK.ticks(0, 100, 10) } : sbSnap(lo, hi, 5);
  var tickTxt = [];
  for (i = 0; i < snapd.ticks.length; i++) {
    tickTxt.push(CK.fmt(snapd.ticks[i]) + (pct ? '%' : ''));
  }

  /* Total labels, computed before the margins because on a bar chart they decide the right one.
     In percent mode this is the ABSOLUTE total: the number normalising deleted. */
  var unit = unitOf(P);
  var totalTxt = [], negTxt = [], widestTotal = 0;
  for (i = 0; i < cols.length; i++) {
    totalTxt.push(cols[i].undef ? '' : CK.fmt(pct ? cols[i].total : cols[i].up) + unit);
    negTxt.push(!pct && cols[i].dn < 0 ? CK.fmt(cols[i].dn) + unit : '');
    if (tw(totalTxt[i]) > widestTotal) { widestTotal = tw(totalTxt[i]); }
    if (tw(negTxt[i]) > widestTotal) { widestTotal = tw(negTxt[i]); }
  }

  /* The axis captions describe the DATA axes. On a horizontal bar chart the value axis is drawn
     across the bottom, so yLabel is the bottom caption and xLabel runs up the side; putting them
     on fixed screen edges would mislabel every bar chart the card ever draws. */
  var vCap = (pct ? (P.yLabel ? P.yLabel + ' (share)' : 'share of the bar') : P.yLabel);
  var sideCap = horiz ? P.xLabel : vCap;
  var footCap = horiz ? vCap : P.xLabel;

  var leftTexts = horiz ? [] : tickTxt, longest = '';
  if (horiz) { for (i = 0; i < cats.length; i++) { leftTexts.push(cats[i].label); } }
  for (i = 0; i < cats.length; i++) { if (cats[i].label.length > longest.length) { longest = cats[i].label; } }
  var leftW = 0;
  for (i = 0; i < leftTexts.length; i++) { if (tw(leftTexts[i]) > leftW) { leftW = tw(leftTexts[i]); } }
  leftW = Math.min(130, leftW);

  var padT = 14 + (!horiz && c.total ? 12 : 0);
  var padR = 16 + (horiz && c.total ? Math.ceil(widestTotal) + 8 : 0);
  var padB = 22 + (footCap ? 12 : 0);
  var padL = Math.round(leftW) + 12 + (sideCap ? 12 : 0);

  var W = P.W0, H = P.H0, thin = 1, perSlot;
  if (horiz) {
    perSlot = 22;
    H = Math.max(180, padT + padB + cats.length * perSlot);
  } else if (cats.length) {
    perSlot = Math.max(tw(clipTo(longest, 90)) + 10, 22);
    W = Math.min(P.WMAX, Math.max(P.W0, padL + padR + cats.length * perSlot));
    /* Past the width cap the chart stops growing and the LABELS thin instead: every k-th
       category is named. Every bar still draws; it is the text that could not fit, not the data. */
    thin = Math.max(1, Math.ceil((tw(clipTo(longest, 90)) + 8) /
                                 Math.max(1, (W - padL - padR) / cats.length)));
  }

  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  var vScale = horiz
    ? CK.scale([snapd.lo, snapd.hi], [plot.x0, plot.x1])
    : CK.scale([snapd.lo, snapd.hi], [plot.y1, plot.y0]);

  var cA = horiz ? plot.y0 : plot.x0;
  var cB = horiz ? plot.y1 : plot.x1;
  var band = cats.length ? (cB - cA) / cats.length : (cB - cA);
  var thick = Math.max(2, Math.min(band * 0.66, 48));

  function cPos(ix) { return cA + (ix + 0.5) * band; }
  function place(cv, vv) { return horiz ? { x: vv, y: cv } : { x: cv, y: vv }; }

  var marks = [];

  /* ── furniture ── */
  for (i = 0; i < snapd.ticks.length; i++) {
    var tv = vScale(snapd.ticks[i]);
    var a = place(horiz ? plot.y0 : plot.x0, tv);
    var b2 = place(horiz ? plot.y1 : plot.x1, tv);
    var isZero = snapd.ticks[i] === 0 && snapd.lo < 0 && snapd.hi > 0;
    marks.push(mLine(a.x, a.y, b2.x, b2.y, isZero ? 'ck-axis' : 'ck-rule'));
    if (horiz) { marks.push(mText(tv, plot.y1 + 13, tickTxt[i], 'ck-tk', 'middle')); }
    else { marks.push(mText(plot.x0 - 6, tv + 3.2, tickTxt[i], 'ck-tk', 'end')); }
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  for (i = 0; i < cats.length; i++) {
    if (i % thin) { continue; }
    var cp = cPos(i);
    if (horiz) { marks.push(mText(plot.x0 - 6, cp + 3.2, clipTo(cats[i].label, 128), 'ck-tk', 'end')); }
    else { marks.push(mText(cp, plot.y1 + 13, clipTo(cats[i].label, Math.max(18, band * thin - 2)), 'ck-tk', 'middle')); }
  }

  if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, footCap, 'ck-cap-ax', 'middle')); }
  if (sideCap) {
    var sx = 10, sy = (plot.y0 + plot.y1) / 2;
    var rot = mText(sx, sy, sideCap, 'ck-cap-ax', 'middle');
    rot.a.transform = 'rotate(-90 ' + fin(sx) + ' ' + fin(sy) + ')';
    marks.push(rot);
  }

  if (!cats.length || !rows.length) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
    return { W: W, H: H, marks: marks, cols: cols, dropped: dropped,
             note: sbNote(P, c, cols, rows, dropped, undefCols) };
  }

  /* ── the bars ── */
  var groups = [];
  for (i = 0; i < rows.length; i++) {
    groups.push({ t: 'g', a: { 'data-series': String(rows[i].si), 'class': 'ck-ser' }, kids: [] });
  }

  for (i = 0; i < cols.length; i++) {
    var col = cols[i];
    var near = cPos(i) - thick / 2;

    if (col.undef) {
      /* A percent bar with nothing to divide by. An empty slot with a rule through it, so it
         cannot be mistaken for a bar of zero height, which would be a claim. */
      var uA = place(near, vScale(snapd.lo));
      var uB = place(near + thick, vScale(snapd.hi));
      var ur = mRect(Math.min(uA.x, uB.x), Math.min(uA.y, uB.y),
                     Math.abs(uB.x - uA.x), Math.abs(uB.y - uA.y), 'ck-undef');
      ur.ti = cats[i].label + ' \u00b7 nothing to take a share of';
      marks.push(ur);
      continue;
    }

    for (j = 0; j < col.segs.length; j++) {
      var seg = col.segs[j];
      var row = rows[seg.ri];
      var pLo = vScale(seg.lo);
      var pHi = vScale(seg.hi);
      var span = Math.abs(pHi - pLo);
      var start = Math.min(pLo, pHi);

      /* A segment of exactly zero is drawn one pixel thick rather than skipped: zero is a
         measurement and should be visible as one, while an absent reading has no segment at all
         and a reader has to be able to tell those two apart. The stub grows in the direction the
         segment would have grown, so it never lands on the wrong side of the baseline. */
      var stub = span < 1;
      if (stub) { span = 1; if (horiz ? seg.v < 0 : seg.v >= 0) { start -= 1; } }

      var rect = horiz
        ? mRect(start, near, span, thick, 'ck-seg', CK.hue(row.si))
        : mRect(near, start, thick, span, 'ck-seg', CK.hue(row.si));
      rect.ti = row.name + ' \u00b7 ' + cats[i].label + ' \u00b7 ' + CK.fmt(seg.v) + unit +
                (pct ? ' \u00b7 ' + CK.fmt(Math.round(seg.share * 10) / 10) + '% of the bar' : '');
      groups[seg.ri].kids.push(rect);

      if (c.labels === 'none') { continue; }
      var txt = pct ? CK.fmt(Math.round(seg.share * 10) / 10) + '%' : CK.fmt(seg.v);
      /* A segment only earns a label when the segment can actually hold it. That is the whole
         feature: an unfiltered stack labels every band and the numbers turn into a grey smear
         over the picture they were meant to annotate. */
      var room = horiz ? (span > tw(txt) + 6 && thick > 11) : (thick > tw(txt) + 4 && span > 12);
      if (c.labels === 'all' || room) {
        var mid = place(near + thick / 2, (pLo + pHi) / 2);
        groups[seg.ri].kids.push(mText(mid.x, mid.y + 3.2, txt, 'ck-val', 'middle'));
      }
    }

    if (c.total) {
      if (totalTxt[i]) {
        var tp = horiz
          ? { x: vScale(col.up) + 5, y: cPos(i) + 3.2, an: 'start' }
          : { x: cPos(i), y: vScale(col.up) - 5, an: 'middle' };
        marks.push(mText(tp.x, tp.y, totalTxt[i], 'ck-total', tp.an));
      }
      if (negTxt[i]) {
        var np = horiz
          ? { x: vScale(col.dn) - 5, y: cPos(i) + 3.2, an: 'end' }
          : { x: cPos(i), y: vScale(col.dn) + 11, an: 'middle' };
        marks.push(mText(np.x, np.y, negTxt[i], 'ck-total', np.an));
      }
    }
  }

  for (i = 0; i < groups.length; i++) { marks.push(groups[i]); }

  return { W: W, H: H, marks: marks, cols: cols, dropped: dropped,
           note: sbNote(P, c, cols, rows, dropped, undefCols) };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, unitOf, mLine, mText, mRect, sbConfig, sbSnap, sbStack,
                 sbNote, sbRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into
   the thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so a series name containing a closing script tag cannot end the
 * block early, with the useful side effect that no name can put an arrow into a file that is
 * contractually free of them.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(TICK_RE, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** One display-list mark as SVG markup, for the copy that ships drawn inside `card.html`. */
function oneMark(m) {
  let s = '<' + m.t;
  for (const k in m.a) {
    if (Object.hasOwn(m.a, k) && m.a[k] != null && m.a[k] !== '') s += ' ' + k + '="' + CK.esc(m.a[k]) + '"';
  }
  const kids = (m.kids || []).map(oneMark).join('');
  const body = (m.s != null ? CK.esc(m.s) : '') +
               (m.ti != null ? '<title>' + CK.esc(m.ti) + '</title>' : '') + kids;
  return s + '>' + body + '</' + m.t + '>';
}

/** The whole display list as markup. */
function svgInner(marks) { return marks.map(oneMark).join(''); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-stackedbar[data-card="' + id + '"]';
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
 * Nothing here names a colour: every value is a desk token, so the light switch is the only
 * thing that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent — the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 */
function cardCss(id, wide, W, multi) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-val', 'fill: var(--ground); font-size: 8.5px;'],
    ['.ck-plot .ck-total', 'fill: var(--ink-dim); font-size: 9.5px;'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-seg', 'stroke: var(--ground); stroke-width: 0.5;'],
    ['.ck-plot .ck-undef',
     'stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 3 3; fill: none;'],
    ['.ck-legend span[data-dropped="1"]', 'opacity: .35; text-decoration: line-through;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  if (!multi) return scope(id, rules) + '\n';

  /* Hover lifts a whole band rather than the one segment under the pointer: on a stacked chart
     the useful question is which band, and one highlighted rectangle answers a question nobody
     asked. Worth doing only when there is something to pick from. */
  rules.push(['.ck-plot .ck-ser', 'transition: opacity .12s linear;']);
  rules.push(['.ck-plot:hover .ck-ser', 'opacity: .35;']);
  rules.push(['.ck-plot .ck-ser:hover', 'opacity: 1;']);

  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, P, seed, cfg, wide) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const droppedSet = new Set(seed.dropped);
  const legend = P.rows.length > 1
    ? '\n  <div class="ck-legend">' +
      P.rows.map((r) =>
        '<span data-series="' + r.si + '"' + (droppedSet.has(r.name) ? ' data-dropped="1"' : '') +
        '><i data-s="' + ((r.si % 8) + 1) + '"></i>' + CK.esc(r.name) + '</span>').join('') +
      '</div>'
    : '';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-stackedbar">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="stacked bar settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('orient') + '">orientation</label>\n' +
    '    <select id="' + f('orient') + '" name="orient">' +
         opt('column', 'columns, upward', cfg.orient) +
         opt('bar', 'bars, rightward', cfg.orient) + '</select>\n' +
    '    <label for="' + f('mode') + '">mode</label>\n' +
    '    <select id="' + f('mode') + '" name="mode">' +
         opt('absolute', 'absolute', cfg.mode) +
         opt('percent', 'percent of each bar', cfg.mode) + '</select>\n' +
    '    <label for="' + f('labels') + '">segment labels</label>\n' +
    '    <select id="' + f('labels') + '" name="labels">' +
         opt('none', 'none', cfg.labels) +
         opt('fit', 'only where they fit', cfg.labels) +
         opt('all', 'all, even where they collide', cfg.labels) + '</select>\n' +
    '    <label for="' + f('total') + '">total label</label>\n' +
    '    <input id="' + f('total') + '" name="total" type="checkbox"' +
           (cfg.total ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">percent mode deletes the magnitude, so the total label carries the ' +
         'absolute figure back onto the page; switching it off in percent mode leaves nothing here ' +
         'saying how big a bar is. all labels will collide on thin segments, which is the reader ' +
         'trading legibility for completeness rather than the card deciding.</p>\n' +
    '  </div>\n' +
    '  ' + (wide ? '<div class="ck-scroll">' + plot + '</div>' : plot) + legend + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned — so a backtick that got into a doc comment cannot reach the page, where
 * it would close the desk's one inline script block early and blank every card on it.
 *
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* stacked bar card: the same renderer that drew the copy in card.html, re-run when a\n' +
    '   setting changes. The percent shares are rebuilt from cumulative fractions here too, so\n' +
    '   a bar still lands on exactly one hundred after the reader switches mode. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where stacking decisions live. */\n' +
    '  function node(m) {\n' +
    '    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;\n' +
    '    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }\n' +
    '    if (m.s != null) { e.textContent = m.s; }\n' +
    '    if (m.ti != null) {\n' +
    '      tip = document.createElementNS(NS, "title");\n' +
    '      tip.textContent = m.ti;\n' +
    '      e.appendChild(tip);\n' +
    '    }\n' +
    '    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }\n' +
    '    return e;\n' +
    '  }\n' +
    '\n' +
    '  /* A repaint, not an append: the desk swaps its main element and replays every builder, so\n' +
    '     a render that added marks would stack a second set of bars on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = sbRender(P, conf), i, keys, dropped;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '\n' +
    '    /* The legend lives in the markup rather than in the drawing, so it is struck through\n' +
    '       here when percent mode refuses a band; otherwise a colour would sit in the key with\n' +
    '       nothing answering to it on the chart. */\n' +
    '    dropped = {};\n' +
    '    for (i = 0; i < out.dropped.length; i++) { dropped[out.dropped[i]] = 1; }\n' +
    '    keys = sec.querySelectorAll(".ck-legend span[data-series]");\n' +
    '    for (i = 0; i < keys.length; i++) {\n' +
    '      if (dropped[keys[i].textContent]) { keys[i].setAttribute("data-dropped", "1"); }\n' +
    '      else { keys[i].removeAttribute("data-dropped"); }\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/stackedbar');
}

/**
 * Build one stacked-bar card from one data block.
 *
 * ON WHETHER THIS TYPE SHOULD EXIST, honestly. `chart` with `kind: 'bar' | 'column'` and
 * `stacked: true` already draws this picture, and already gets the hard part right: positive and
 * negative parts accumulate away from zero in opposite directions, so a category holding +3 and
 * -4 spans -4 to +3. About seventy percent of the geometry below is that same idea written again,
 * and if the catalogue were designed once rather than grown, this file would be four modes of
 * `chart` instead of a type.
 *
 * It is a type anyway, for two reasons that are not the same reason.
 *
 * The first is discoverability, and it is the stronger one. The gallery is the surface a newcomer
 * uses to find out what exists, and it lists TYPES. A stacked bar hiding as a boolean on a type
 * filed under `ranking-and-comparison` is unreachable by anyone who arrives holding the question
 * "how does each of these divide?" — which is the question a stacked bar answers. Filed here
 * under `part-of-a-whole`, it is found by the reader who needs it. A mode nobody can search for
 * is a mode nobody uses.
 *
 * The second is that four things here should not be modes of a generic plotter even if they
 * could be: an exact-hundred percent mode, an absolute-total label that exists specifically to
 * undo what percent mode hides, a reader-controlled label policy, and a caption that names
 * stacking's central flaw. `chart` deliberately has no settings at all — no `defaults`, no gear —
 * because everything it draws is decided by its data. Bolting four settings onto it would change
 * its contract, and it is the wrong file to change while six agents are editing this directory.
 *
 * The counter-argument, stated fairly: two files now compute the same stack, and they can drift.
 * The mitigation is that both derive their arithmetic from `CK` rather than from each other, and
 * that `check.mjs` holds both to the same contract. If the catalogue is ever consolidated, this
 * is one of the first two files to fold in — the other being `stackedarea`, whose author reached
 * the same conclusion about its absolute mode.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame captioned "no data"; the card keeps its place
 *   one series           one band per bar, and the caption says stacking hides nothing here
 *   one category         one bar, the axis padded so it has somewhere to stand
 *   an absent reading    no segment at all, counted as a gap; NOT drawn as zero
 *   a zero reading       a one-pixel stub, so zero and absent never look the same
 *   all values zero      absolute mode draws stubs on a padded axis; percent mode has no total
 *                        to divide by, so every bar is an empty dashed slot and says so
 *   a negative value     absolute mode stacks it downward from zero and accents the zero rule;
 *                        percent mode refuses the whole series, counts it and names it
 *   duplicate x          the last value at that category wins, and the overwrite is counted
 *   a non-finite y       refused while reading, counted, never coerced
 *   400+ categories      the first 400 draw and the rest are counted; labels thin past the
 *                        width cap while every bar still draws
 *   40+ series           the first 40 draw and the rest are counted
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ series, orient, mode, xLabel, yLabel, unit }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'spend',
 *   title: 'spend by department',
 *   data: { unit: 'USD', yLabel: 'spend', mode: 'percent',
 *           series: [{ name: 'salary', points: [{ x: 'Q1', y: 40 }, { x: 'Q2', y: 44 }] },
 *                    { name: 'cloud',  points: [{ x: 'Q1', y: 12 }, { x: 'Q2', y: 19 }] }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'stackedbar' : id);
  const P = readData(data);

  /* The instance's own defaults: the type's fallbacks, overridden by anything the DATA asked for.
     `meta.defaults` stays the type's answer — that is what a validator inspects — while the gear
     opens showing what this particular card actually shipped with. */
  const cfg = {
    ...defaults,
    ...(P.orient ? { orient: P.orient } : {}),
    ...(P.mode ? { mode: P.mode } : {}),
  };

  const seed = sbRender(P, cfg);
  const wide = seed.W > W0;

  /* The payload the browser re-renders from carries no settings and no geometry — only the data
     and the budgets — so the browser and Node cannot disagree about anything except the config. */
  const payload = {
    cats: P.cats, rows: P.rows,
    xLabel: P.xLabel, yLabel: P.yLabel, unit: P.unit,
    refused: P.refused, dupes: P.dupes, gaps: P.gaps,
    droppedSeries: P.droppedSeries, droppedCats: P.droppedCats,
    W0, H0, WMAX,
  };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      series: P.rows.length,
      categories: P.cats.length,
      negativeSeries: P.rows.filter((r) => r.neg > 0).length,
      refusedPoints: P.refused,
      duplicates: P.dupes,
      settings: { ...cfg },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), P, seed, cfg, wide),
    css:  cardCss(cardId, wide, seed.W, P.rows.length > 1),
    js:   cardJs(cardId, payload, cfg),
  };
}

/* Exported for the type's own verification, which executes the geometry rather than only reading
   it: a static check can prove the script parses and cannot prove a bar sums to its total. */
export const _internals = { readData, sbRender, sbStack, sbConfig, sbSnap, SHIPPED };
