/**
 * `boxplot` — a five-number summary per group, with the quartile definition named on the card.
 *
 * There is no such thing as "the" quartile. Hyndman and Fan catalogue nine definitions and they
 * disagree, visibly, on samples small enough to fit on a desk: for n = 9 the type-7 lower
 * quartile and Tukey's lower hinge can be different observations, so the same nine numbers draw
 * two boxes of different widths. A box plot that does not say which definition it used is asking
 * to be compared against a box plot that used another one.
 *
 * This card uses **type 7** — the p-quantile at position (n-1)p in the ascending sample, with
 * linear interpolation between neighbours. It is the default in R, NumPy, pandas and Excel's
 * QUARTILE.INC, which makes it the one a reader can check: paste the numbers anywhere and the
 * same quartiles come back. What breaks under the alternative: Tukey's hinges split the sample
 * at the median and take the median of each half, which never interpolates and so always lands
 * on a real observation — pleasing, but it makes the box a step function of n, and the 1.5 IQR
 * fences move with it, so the same data flags different outliers depending on the definition.
 *
 * Whiskers follow Tukey: the fences are Q1 - 1.5 IQR and Q3 + 1.5 IQR, and the whisker is drawn
 * to the most extreme OBSERVATION inside its fence, never to the fence itself. A whisker drawn
 * at the fence is a line at a number that nothing in the sample equals.
 *
 * All statistics are computed in Node from the complete sample; the browser only paints, using
 * the very functions that drew the card here, shipped through `Function.prototype.toString()`.
 *
 * @see ./histogram.mjs  the binned sibling, which names its bin rule for the same reason
 * @see ./violin.mjs     the density sibling, which refuses small samples outright
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
 * @example loadKit().scale([0, 10], [0, 100])(5);   // 50
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/boxplot: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/boxplot: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;
const H0 = 300;
const WMAX = 2200;

/* Tukey's multiplier. Not a setting: 1.5 is what "outlier" means on a box plot, and a card that
   let it be tuned would be a card whose outliers mean nothing in particular. */
const K_FENCE = 1.5;

/* The notch half-width, from McGill, Tukey and Larsen (1978): med +/- 1.58 IQR / sqrt(n) is a
   roughly 95% confidence interval for the median, and two boxes whose notches do not overlap
   differ at about that level. 1.58 is 1.25 * 1.96 / 1.35, where 1.35 converts an IQR into a
   standard deviation for a normal sample - so the interval inherits a normality assumption that
   a skewed sample violates, which is why the caption says so rather than leaving it implied. */
const K_NOTCH = 1.58;

/* Caps on how many dots are drawn per group. Everything above the cap is thinned systematically
   from the sorted list, so the extremes survive and the middle thins - the opposite of what a
   random sample does to a picture whose whole subject is the tails. */
const OUT_CAP = 400;
const ALL_CAP = 1200;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` cannot be referenced by it at all.
 */
export const defaults = {
  notch: false,
  points: 'outliers',
  orient: 'vertical',
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'boxplot',
  summary: 'Five-number summaries with type-7 quartiles, 1.5 IQR whiskers and named outliers.',
  shape: '{ groups: [{ name, values: [number] }], xLabel, unit }',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const` and `let` false-positives on English prose, and a guard that
 * cries wolf is a guard somebody deletes. Regex literals are recognised, because otherwise the
 * scanner desynchronises on a quote inside a character class and starts blanking real code,
 * which turns a false positive into a far worse false negative.
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

/**
 * Refuse to emit browser script that would break the whole desk, and say where.
 *
 * Every card's `js` is concatenated into ONE inline block, so a single modern-syntax token — or
 * a backtick inside a comment, which `Function.prototype.toString()` ships verbatim — is a parse
 * error that blanks every card on the page rather than just this one.
 *
 * Backtick, arrow and optional chaining are scanned raw: none can appear innocently in this
 * file's output. `const`, `let` and `class` are scanned only after comment and string bodies are
 * blanked, because English prose contains all three words.
 *
 * @param src the emitted script
 * @param who a label for the error message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it checks
 * @throws {Error} naming the offending construct and its offset, with the surrounding text
 *
 * @example guardJs('var a = 1;');   // returns it
 */
export function guardJs(src, who) {
  const where = who || 'cardkit/boxplot';
  const near = (at) => src.slice(Math.max(0, at - 50), at + 50);
  const die = (what, at) => {
    throw new Error(where + ': emitted js ' + what + ' at offset ' + at + ' - near: ' + near(at));
  };

  const tick = src.indexOf(String.fromCharCode(96));
  if (tick >= 0) die('contains a backtick', tick);

  const arrow = src.indexOf(String.fromCharCode(61) + String.fromCharCode(62));
  if (arrow >= 0) die('contains an arrow function', arrow);

  const opt = src.indexOf(String.fromCharCode(63) + String.fromCharCode(46));
  if (opt >= 0) die('contains optional chaining', opt);

  /* Compared numerically rather than matched against a character class. Writing the class is how
     the class gets corrupted: an escape can be decoded one step early during emission, leaving a
     plausible-looking regex that holds the raw byte it meant to describe. */
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      die('contains control character ' + c, i);
    }
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
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting what
 * it had to refuse.
 *
 * A value is kept only when it is a `number` and finite. That is stricter than `Number(v)` on
 * purpose: `Number('')` is 0, `Number(true)` is 1 and `Number([])` is 0, so a coercing reader
 * invents observations at zero out of blanks and booleans — and on a box plot an invented zero
 * does not merely add a dot, it drags a quartile. Everything refused is counted, per group and
 * in total, and the count is named in the caption.
 *
 * Empty groups are kept, because dropping one would shift every later group onto a different
 * colour and lane, and the reader would be comparing the wrong things.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ groups, refused, kept, xLabel, unit }`
 *
 * @example readData({ groups: [{ name: 'a', values: [1, 'x'] }] }).refused;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.groups) ? d.groups : [];
  const groups = [];
  let refused = 0;
  let kept = 0;

  raw.forEach((g, i) => {
    const src = g && Array.isArray(g.values) ? g.values : [];
    const values = [];
    let bad = 0;
    for (const v of src) {
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
      else bad++;
    }
    refused += bad;
    kept += values.length;
    groups.push({
      name: String(g && g.name != null ? g.name : 'group ' + (i + 1)),
      values,
      refused: bad,
    });
  });

  return {
    groups,
    refused,
    kept,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    unit: d.unit == null ? '' : String(d.unit),
  };
}

/** Ascending copy. `Array.prototype.sort` without a comparator is lexicographic, which for numbers is a silent disaster. */
function sortAsc(values) {
  const out = values.slice();
  out.sort((a, b) => a - b);
  return out;
}

/**
 * The type-7 quantile: the definition R, NumPy, pandas and Excel's QUARTILE.INC all use.
 *
 * The p-quantile sits at position (n-1)p in the ascending sample and is interpolated linearly
 * between its neighbours. Two properties matter here. It never extrapolates beyond the sample,
 * so Q1 and Q3 are always inside [min, max] and a fence derived from them is always meaningful.
 * And it is the definition a reader's own tools will agree with, which is the whole reason for
 * picking one and printing its name.
 *
 * @param sorted the sample, already ascending; an empty sample yields 0
 * @param p      a probability in 0..1
 *
 * @example quantile7([1, 2, 3, 4], 0.25);   // 1.75
 * @example quantile7([6, 7, 15, 36, 39, 40, 41, 42, 43, 47, 49], 0.25);   // 25.5
 */
function quantile7(sorted, p) {
  const m = sorted.length;
  if (m === 0) return 0;
  if (m === 1) return sorted[0];
  const h = (m - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** The arithmetic mean, or 0 for an empty sample. */
function meanOf(values) {
  let s = 0;
  for (const v of values) s += v;
  return values.length ? s / values.length : 0;
}

/**
 * Thin a sorted list to at most `cap` entries, keeping its shape and both ends.
 *
 * Systematic — every k-th of the ascending list — rather than random, so the same data draws the
 * same picture twice and the quantiles of the kept subset converge on the quantiles of the
 * whole. The last entry is appended when the stride would otherwise miss it, because on a plot
 * about tails the largest value is the one nobody will forgive you for dropping.
 *
 * @param sorted an ascending list
 * @param cap    the most entries to keep; 0 or less keeps everything
 *
 * @example thin([1, 2, 3, 4, 5, 6, 7], 3);   // [1, 4, 7]
 */
function thin(sorted, cap) {
  if (!(cap > 0) || sorted.length <= cap) return sorted.slice();
  const k = Math.ceil(sorted.length / cap);
  const out = [];
  for (let i = 0; i < sorted.length; i += k) out.push(sorted[i]);
  const last = sorted[sorted.length - 1];
  if (out.length && out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * The whole five-number summary of one group, plus everything derived from it.
 *
 * Computed once, in Node, from the complete sample. The browser is handed the numbers, never the
 * responsibility for producing them — a quartile recomputed per viewer is a quartile that can
 * disagree with the caption, and the caption is the part a reader trusts.
 *
 * @param values the group's kept observations, in any order
 * @returns `{ n, min, max, q1, med, q3, iqr, wlo, whi, mean, out, notchLo, notchHi, notchClamped, constant }`
 *
 * @example summarise([1, 2, 3, 4, 100]).out;   // [100]
 */
function summarise(values) {
  const s = sortAsc(values);
  const n = s.length;
  if (!n) {
    return { n: 0, min: 0, max: 0, q1: 0, med: 0, q3: 0, iqr: 0, wlo: 0, whi: 0, mean: 0,
             out: [], notchLo: 0, notchHi: 0, notchClamped: false, constant: true };
  }

  const q1 = quantile7(s, 0.25);
  const med = quantile7(s, 0.5);
  const q3 = quantile7(s, 0.75);
  const iqr = q3 - q1;
  const fenceLo = q1 - K_FENCE * iqr;
  const fenceHi = q3 + K_FENCE * iqr;

  /* The whisker lands on the most extreme OBSERVATION inside the fence, not on the fence. A
     whisker at the fence is a line drawn at a number that nothing in the sample equals, and
     readers reasonably take a whisker end for a data point. */
  let wlo = s[n - 1];
  let whi = s[0];
  const out = [];
  for (const v of s) {
    if (v < fenceLo || v > fenceHi) { out.push(v); continue; }
    if (v < wlo) wlo = v;
    if (v > whi) whi = v;
  }
  /* Every value outside the fences means there is no whisker to draw; both ends collapse onto
     the median, which is the only thing left that is certainly inside. */
  if (wlo > whi) { wlo = med; whi = med; }

  const half = n > 0 ? K_NOTCH * iqr / Math.sqrt(n) : 0;
  let notchLo = med - half;
  let notchHi = med + half;
  /* A notch wider than the box is the standard signal for "the sample is too small for this
     interval to mean anything", and the standard drawing lets it fold outside the box. It reads
     as a rendering fault rather than as a statistical warning, so it is clamped and the caption
     says the clamp happened - the warning survives in words, where it cannot be mistaken. */
  const notchClamped = notchLo < q1 || notchHi > q3;
  if (notchLo < q1) notchLo = q1;
  if (notchHi > q3) notchHi = q3;

  return {
    n, min: s[0], max: s[n - 1], q1, med, q3, iqr, wlo, whi,
    mean: meanOf(s), out,
    notchLo, notchHi, notchClamped,
    constant: s[0] === s[n - 1],
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything below runs in BOTH halves: Node calls it to draw the card that ships, and the
   browser calls the identical text after a settings change. ES5 only — `var` and `function`, no
   arrow functions, no template literals, no destructuring — and nothing but `CK` from outside. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole attribute and the card
 * renders empty with nothing in the console. Throwing makes it a build failure beside the input
 * that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/boxplot: non-finite coordinate (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face. */
function tw(s) { return String(s).length * 5.42; }

/** Shorten a label to fit `max` px, keeping the head and marking the cut. */
function clipTo(s, max) {
  var str = String(s);
  var room = Math.floor(max / 5.42);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/**
 * Ticks that reach the ends of the axis rather than stopping short of them.
 *
 * `CK.ticks` only returns ticks strictly inside the domain it was handed, leaving a ragged strip
 * past the last gridline. Snapping the domain out to the step the ticks already chose closes it;
 * the ticks are stepped out rather than re-derived, because asking again with the wider range
 * can push it to the next nice step and halve the gridline count.
 *
 * @example axisTicks(0, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
 */
function axisTicks(lo, hi, want) {
  var t = CK.ticks(lo, hi, want);
  if (t.length < 2) { return { lo: lo, hi: hi, ticks: t }; }
  var step = t[1] - t[0];
  if (!(step > 0)) { return { lo: lo, hi: hi, ticks: t }; }
  var nlo = Math.floor(lo / step) * step;
  var nhi = Math.ceil(hi / step) * step;
  if (!(nhi > nlo)) { return { lo: lo, hi: hi, ticks: t }; }
  var out = [], k, v;
  for (k = 0; k < 500; k++) {
    v = nlo + k * step;
    if (v > nhi + step / 1e6) { break; }
    out.push(Math.round(v / step) * step);
  }
  return { lo: nlo, hi: nhi, ticks: out };
}

/** A display-list line. Every mark is an object of tag, attributes, optional text and tooltip. */
function mLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' } };
}

/** A display-list text run; the sixth argument carries anything unusual, such as a rotation. */
function mText(x, y, s, cls, anchor, extra) {
  var a = { x: fin(x), y: fin(y), 'class': cls || '' }, k;
  if (anchor) { a['text-anchor'] = anchor; }
  if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { a[k] = extra[k]; } } }
  return { t: 'text', a: a, s: String(s) };
}

/** A display-list rectangle; negative extents are clamped rather than emitted as invalid SVG. */
function mRect(x, y, w, h, attrs) {
  var a = { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'rect', a: a };
}

/** A display-list path; the caller owns the shape because only the caller knows it. */
function mPath(d, attrs) {
  var a = { d: d }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'path', a: a };
}

/** A display-list circle. */
function mDot(cx, cy, r, attrs) {
  var a = { cx: fin(cx), cy: fin(cy), r: fin(r) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'circle', a: a };
}

/**
 * The i-th value of the van der Corput sequence in base 2, mapped to -1..1.
 *
 * This is the deterministic stand-in for jitter. Scattering coincident points needs an offset
 * per point, and `Math.random` gives a card that draws a different picture every time it is
 * replayed - the desk swaps its main element and replays every builder, so that is not a
 * hypothetical. A low-discrepancy sequence fills the lane evenly, never repeats within a group,
 * and is a pure function of the index, so the same data draws the same dots forever.
 *
 * @param i a non-negative integer index
 * @returns an offset in -1..1
 *
 * @example vdc(0);   // 0
 * @example vdc(1);   // -0.5
 */
function vdc(i) {
  var n = i + 1, d = 0.5, r = 0;
  while (n > 0) {
    r += (n % 2) * d;
    n = Math.floor(n / 2);
    d = d / 2;
  }
  return r * 2 - 1;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the plot to anyone using one:
 * "box plot" names the genre and withholds the content, and is not an acceptable answer. The
 * caption's job is the harder one — it has to state the things that make the picture less
 * believable, because those are exactly the things a reader cannot see.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param dom  the value domain actually drawn, as `{ lo, hi }`
 * @param drew per-group counts of what was drawn, as `{ dots, outliers }`
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function bxNote(P, cfg, dom, drew) {
  var gs = P.groups, ng = gs.length, unit = P.unit ? ' ' + P.unit : '';
  var live = [], i, g;
  for (i = 0; i < ng; i++) { if (gs[i].n > 0) { live.push(gs[i]); } }

  if (!live.length) {
    return {
      aria: 'Box plot with no data: ' + (P.refused
        ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left to summarise.'
        : 'nothing was supplied.'),
      caption: 'a box plot with <b>no data</b> - the frame is drawn so the card keeps its place. ' +
        (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                     ' refused</i> for not being finite numbers. ' : '') +
        'no quartile here is an estimate of anything.',
    };
  }

  var totalN = 0, totalOut = 0, constants = 0, zeroIqr = 0, clamped = 0, thinned = 0;
  for (i = 0; i < ng; i++) {
    g = gs[i];
    totalN += g.n;
    totalOut += g.outCount;
    if (g.n > 0 && g.constant) { constants++; }
    if (g.n > 1 && !g.constant && g.iqr === 0) { zeroIqr++; }
    if (g.notchClamped && g.n > 0) { clamped++; }
    if (drew[i].thinned) { thinned++; }
  }

  /* The widest and narrowest boxes, because "which group is most spread out" is the first
     question a reader asks of a row of boxes and the picture answers it only approximately. */
  var wide = live[0], narrow = live[0];
  for (i = 1; i < live.length; i++) {
    if (live[i].iqr > wide.iqr) { wide = live[i]; }
    if (live[i].iqr < narrow.iqr) { narrow = live[i]; }
  }

  var aria = 'Box plot of ' + totalN + ' value' + (totalN === 1 ? '' : 's') + ' in ' + ng +
    ' group' + (ng === 1 ? '' : 's') + ', drawn ' + (cfg.orient === 'horizontal' ? 'horizontally' : 'vertically') +
    (P.xLabel ? ', measuring ' + P.xLabel : '') + '. ' +
    'Values run from ' + CK.fmt(dom.lo) + ' to ' + CK.fmt(dom.hi) + unit + '. ';
  for (i = 0; i < live.length && i < 8; i++) {
    g = live[i];
    aria += g.name + ': median ' + CK.fmt(g.med) + ', quartiles ' + CK.fmt(g.q1) + ' and ' +
            CK.fmt(g.q3) + ', whiskers ' + CK.fmt(g.wlo) + ' to ' + CK.fmt(g.whi) +
            (g.outCount ? ', ' + g.outCount + ' outlier' + (g.outCount === 1 ? '' : 's') : '') +
            ', n ' + g.n + '. ';
  }
  if (live.length > 8) { aria += 'The remaining ' + (live.length - 8) + ' groups are in the tooltips. '; }
  aria += 'Quartiles are the type-7 definition; whiskers reach the furthest observation within ' +
          '1.5 interquartile ranges of the box.';

  var doubts = [];
  if (P.refused) {
    doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                ' refused</i> for not being a finite number - counted, never silently dropped');
  }
  if (constants) {
    doubts.push(CK.esc(String(constants)) + ' group' + (constants === 1 ? ' is' : 's are') +
                ' constant, so there is no box at all - the marker is the single value they all share');
  }
  if (zeroIqr) {
    doubts.push(CK.esc(String(zeroIqr)) + ' group' + (zeroIqr === 1 ? ' has' : 's have') +
                ' a zero interquartile range with a non-zero spread, which puts both fences on the ' +
                'quartiles and makes every value away from the median an outlier - that is what ' +
                'the 1.5 IQR rule says, and it is why such a box is not worth reading');
  }
  if (cfg.notch && clamped) {
    doubts.push('the notch is wider than the box in ' + CK.esc(String(clamped)) + ' group' +
                (clamped === 1 ? '' : 's') + ' and has been clamped to it - that is the sample ' +
                'telling you the median is not pinned down');
  }
  if (cfg.notch) {
    doubts.push('the notch is med +/- 1.58 IQR / sqrt(n), which converts an IQR into a standard ' +
                'deviation and so assumes rough normality; on a skewed sample read it as a hint');
  }
  if (thinned) {
    doubts.push('dots in ' + CK.esc(String(thinned)) + ' group' + (thinned === 1 ? '' : 's') +
                ' were thinned to every k-th of the sorted sample, keeping both ends; the ' +
                'quartiles and the outlier COUNT are from the whole sample either way');
  }
  if (cfg.points === 'none' && totalOut) {
    doubts.push('outliers are hidden, so the axis no longer has to reach them and the boxes have ' +
                'their room back - ' + CK.esc(String(totalOut)) + ' point' + (totalOut === 1 ? ' is' : 's are') +
                ' off the picture');
  }

  var caption = '<b>' + CK.esc(String(totalN)) + '</b> value' + (totalN === 1 ? '' : 's') +
    ' in <b>' + CK.esc(String(ng)) + '</b> group' + (ng === 1 ? '' : 's') + '. ' +
    'quartiles are <i>type 7</i> - the definition R, NumPy and pandas use - and whiskers reach the ' +
    'furthest observation within <i>1.5 IQR</i> of the box, never to the fence itself. ' +
    (live.length > 1
      ? 'widest box <b>' + CK.esc(wide.name) + '</b> at ' + CK.esc(CK.fmt(wide.iqr)) + CK.esc(unit) +
        ', narrowest <b>' + CK.esc(narrow.name) + '</b> at ' + CK.esc(CK.fmt(narrow.iqr)) + CK.esc(unit) + '. '
      : 'median <b>' + CK.esc(CK.fmt(live[0].med)) + '</b>' + CK.esc(unit) + ', IQR ' +
        CK.esc(CK.fmt(live[0].iqr)) + CK.esc(unit) + '. ') +
    (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * One function rather than a geometry function and a caption function, because the caption has
 * to quote numbers the geometry settled — which points were drawn, how far the axis had to
 * reach — and computing them twice is how a caption starts describing a picture that is no
 * longer on the card.
 *
 * The value domain depends on the `points` setting, which is the one genuinely useful thing a
 * box plot's settings can do: with outliers hidden the axis only has to span the whiskers, and
 * a card whose boxes were squashed into a millimetre by one far-out value becomes readable
 * again without anyone editing the data.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settled settings: `notch`, `points`, `orient`
 * @returns `{ W, H, marks, note }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable values were refused and counted while reading
 *
 * @example bxRender(P, { notch: false, points: 'outliers', orient: 'vertical' }).marks.length;
 */
function bxRender(P, cfg) {
  var horiz = cfg.orient === 'horizontal';
  var gs = P.groups, ng = gs.length;
  var marks = [], i, j, g;

  /* What the axis must reach. With points hidden the outliers are not drawn, so they are not
     allowed to stretch the axis either - the picture and the domain always agree. */
  var showOut = cfg.points !== 'none';
  var lo = Infinity, hi = -Infinity;
  for (i = 0; i < ng; i++) {
    g = gs[i];
    if (!g.n) { continue; }
    if (showOut) {
      if (g.min < lo) { lo = g.min; }
      if (g.max > hi) { hi = g.max; }
    } else {
      if (g.wlo < lo) { lo = g.wlo; }
      if (g.whi > hi) { hi = g.whi; }
    }
  }
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) {
    /* Zero spread across every group: half the magnitude either side, so the flat summary has
       somewhere to sit and the axis has ticks. All-zero data has no magnitude to halve. */
    var e = Math.abs(lo) * 0.5 || 0.5;
    lo -= e; hi += e;
  }

  var ax = axisTicks(lo, hi, 5);
  var vLabels = [], cLabels = [];
  for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }
  for (i = 0; i < ng; i++) { cLabels.push(gs[i].name); }

  var leftTexts = horiz ? cLabels : vLabels;
  var leftW = 0;
  for (i = 0; i < leftTexts.length; i++) { leftW = Math.min(130, Math.max(leftW, tw(leftTexts[i]))); }

  var footCap = horiz
    ? (P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit)
    : '';
  var sideCap = horiz ? '' : (P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit);

  var padT = 14, padR = 16;
  var padB = 22 + (footCap ? 12 : 0);
  var padL = Math.round(leftW) + 12 + (sideCap ? 12 : 0);

  var W = P.W0, H = P.H0;
  if (horiz) {
    H = Math.max(180, padT + padB + ng * 30);
  } else if (ng) {
    var perSlot = Math.max(30, tw(clipTo(longestOf(cLabels), 90)) + 8);
    W = Math.min(P.wmax, Math.max(P.W0, padL + padR + ng * perSlot));
  }

  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  var vS = horiz ? CK.scale([ax.lo, ax.hi], [plot.x0, plot.x1])
                 : CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
  var cA = horiz ? plot.y0 : plot.x0;
  var cB = horiz ? plot.y1 : plot.x1;
  var band = ng ? (cB - cA) / ng : cB - cA;
  var boxW = Math.max(4, Math.min(46, band * 0.52));

  /* Gridlines run across the value axis; the category axis gets no rules at all, because a box
     plot's categories are names rather than positions and a rule between them implies an order. */
  for (i = 0; i < ax.ticks.length; i++) {
    var vp = vS(ax.ticks[i]);
    if (horiz) {
      marks.push(mLine(vp, plot.y0, vp, plot.y1, 'ck-rule'));
      marks.push(mText(vp, plot.y1 + 13, vLabels[i], 'ck-tk', 'middle'));
    } else {
      marks.push(mLine(plot.x0, vp, plot.x1, vp, 'ck-rule'));
      marks.push(mText(plot.x0 - 6, vp + 3.2, vLabels[i], 'ck-tk', 'end'));
    }
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  var drew = [];
  for (i = 0; i < ng; i++) {
    g = gs[i];
    var colour = CK.hue(i);
    var c = cA + (i + 0.5) * band;
    var kids = [];
    var info = { dots: 0, outliers: 0, thinned: false };

    /* The category label. Vertical plots put it under its lane and clip it to the lane, because
       a name that overruns lands on its neighbour's name and neither can be read. */
    if (horiz) {
      marks.push(mText(plot.x0 - 6, c + 3.2, clipTo(g.name, 126), 'ck-tk', 'end'));
    } else {
      marks.push(mText(c, plot.y1 + 13, clipTo(g.name, Math.max(16, band - 2)), 'ck-tk', 'middle'));
    }

    /* An empty group keeps its lane and its label and draws nothing in it. Collapsing the lane
       would renumber every group after it, and a reader comparing two renders of the same card
       would be comparing different positions. */
    if (!g.n) {
      marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: [] });
      drew.push(info);
      continue;
    }

    var pq1 = vS(g.q1), pq3 = vS(g.q3), pmed = vS(g.med);
    var pwlo = vS(g.wlo), pwhi = vS(g.whi);
    var half = boxW / 2;

    /* Whisker spine and its two caps. Drawn before the box so the box's fill covers the part of
       the spine that runs behind it. */
    if (horiz) {
      kids.push(mLine(pwlo, c, pwhi, c, 'ck-whisk'));
      kids.push(mLine(pwlo, c - half * 0.45, pwlo, c + half * 0.45, 'ck-whisk'));
      kids.push(mLine(pwhi, c - half * 0.45, pwhi, c + half * 0.45, 'ck-whisk'));
    } else {
      kids.push(mLine(c, pwlo, c, pwhi, 'ck-whisk'));
      kids.push(mLine(c - half * 0.45, pwlo, c + half * 0.45, pwlo, 'ck-whisk'));
      kids.push(mLine(c - half * 0.45, pwhi, c + half * 0.45, pwhi, 'ck-whisk'));
    }

    /* The box. A zero-IQR group has no box to draw, so it gets a bar two pixels thick instead:
       an invisible box and an absent group must not look the same. */
    var thick = Math.abs(pq3 - pq1) < 2;
    var boxAttrs = { fill: colour, 'fill-opacity': '0.28', stroke: colour, 'stroke-width': '1.4',
                     'class': 'ck-box' };
    if (cfg.notch && !thick) {
      kids.push(mPath(notchPath(horiz, c, half, pq1, pq3, pmed, vS(g.notchLo), vS(g.notchHi)), boxAttrs));
    } else if (horiz) {
      kids.push(mRect(Math.min(pq1, pq3), c - half, Math.max(2, Math.abs(pq3 - pq1)), boxW, boxAttrs));
    } else {
      kids.push(mRect(c - half, Math.min(pq1, pq3), boxW, Math.max(2, Math.abs(pq3 - pq1)), boxAttrs));
    }

    /* The median, at full strength: it is the one number on a box plot that everybody reads. */
    if (horiz) { kids.push(mLine(pmed, c - half, pmed, c + half, 'ck-med')); }
    else { kids.push(mLine(c - half, pmed, c + half, pmed, 'ck-med')); }

    if (cfg.points === 'all') {
      var pts = g.sample;
      info.thinned = g.sampleThinned;
      for (j = 0; j < pts.length; j++) {
        var off = vdc(j) * half * 0.8;
        var pv = vS(pts[j]);
        kids.push(mDot(horiz ? pv : c + off, horiz ? c + off : pv, 1.6,
                       { fill: colour, 'fill-opacity': '0.5', stroke: 'none', 'class': 'ck-obs' }));
        info.dots++;
      }
    }

    if (showOut) {
      var outs = g.outShown;
      for (j = 0; j < outs.length; j++) {
        var ov = vS(outs[j]);
        var od = mDot(horiz ? ov : c, horiz ? c : ov, 2.4,
                      { fill: 'none', stroke: colour, 'stroke-width': '1.2', 'class': 'ck-out' });
        od.ti = g.name + '  \u00b7  outlier  \u00b7  ' + CK.fmt(outs[j]) + (P.unit ? ' ' + P.unit : '');
        kids.push(od);
        info.outliers++;
      }
      if (g.outThinned) { info.thinned = true; }
    }

    /* One invisible fat target per group, carrying the whole summary. A 1.4px box edge is not a
       hit area, and a tooltip per mark would be a tooltip on a whisker cap. */
    var hit = horiz
      ? mRect(plot.x0, c - band / 2, plot.x1 - plot.x0, band, { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' })
      : mRect(c - band / 2, plot.y0, band, plot.y1 - plot.y0, { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    hit.ti = g.name + '  \u00b7  n ' + g.n +
             '  \u00b7  min ' + CK.fmt(g.min) + '  \u00b7  Q1 ' + CK.fmt(g.q1) +
             '  \u00b7  med ' + CK.fmt(g.med) + '  \u00b7  Q3 ' + CK.fmt(g.q3) +
             '  \u00b7  max ' + CK.fmt(g.max) + '  \u00b7  IQR ' + CK.fmt(g.iqr) +
             '  \u00b7  mean ' + CK.fmt(g.mean) +
             (g.outCount ? '  \u00b7  ' + g.outCount + ' outliers' : '') +
             (g.refused ? '  \u00b7  ' + g.refused + ' refused' : '');
    kids.push(hit);

    marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
    drew.push(info);
  }

  if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, footCap, 'ck-cap-ax', 'middle')); }
  if (sideCap) {
    var cy = (plot.y0 + plot.y1) / 2;
    marks.push(mText(10, cy, sideCap, 'ck-cap-ax', 'middle',
                     { transform: 'rotate(-90 10 ' + fin(cy) + ')' }));
  }

  var any = false;
  for (i = 0; i < ng; i++) { if (gs[i].n > 0) { any = true; } }
  if (!any) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, note: bxNote(P, cfg, { lo: ax.lo, hi: ax.hi }, drew) };
}

/** The longest string in a list, or the empty string — used to decide how much room labels want. */
function longestOf(list) {
  var best = '', i;
  for (i = 0; i < list.length; i++) { if (list[i].length > best.length) { best = list[i]; } }
  return best;
}

/**
 * The outline of a notched box, as a path.
 *
 * A notched box is not a rectangle, so it cannot be a rect: the sides pinch inward to the median
 * over the confidence interval. Drawn as one closed path so the fill and the stroke follow the
 * same outline, which a rect plus two triangles would not.
 *
 * @param horiz  whether the value axis runs across the screen
 * @param c      the lane centre on the category axis, in px
 * @param half   half the box's thickness, in px
 * @param pq1    Q1 in px on the value axis
 * @param pq3    Q3 in px
 * @param pmed   the median in px
 * @param pnLo   the low end of the notch in px
 * @param pnHi   the high end of the notch in px
 * @returns an SVG path `d`
 *
 * @example notchPath(false, 100, 12, 200, 100, 150, 170, 130).slice(0, 1);   // 'M'
 */
function notchPath(horiz, c, half, pq1, pq3, pmed, pnLo, pnHi) {
  var pinch = half * 0.45;
  var pts = [], i, d = '';
  if (horiz) {
    pts = [[pq1, c - half], [pnLo, c - half], [pmed, c - pinch], [pnHi, c - half], [pq3, c - half],
           [pq3, c + half], [pnHi, c + half], [pmed, c + pinch], [pnLo, c + half], [pq1, c + half]];
  } else {
    pts = [[c - half, pq1], [c - half, pnLo], [c - pinch, pmed], [c - half, pnHi], [c - half, pq3],
           [c + half, pq3], [c + half, pnHi], [c + pinch, pmed], [c + half, pnLo], [c + half, pq1]];
  }
  for (i = 0; i < pts.length; i++) {
    d += (i === 0 ? 'M' : 'L') + fin(pts[i][0]) + ' ' + fin(pts[i][1]);
  }
  return d + 'Z';
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions above the browser needs, in dependency order. Shipped as their own source rather
   than restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, axisTicks, mLine, mText, mRect, mPath, mDot, vdc,
                 longestOf, notchPath, bxNote, bxRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block
 * early, and so that no group name can put an arrow function's two characters into a file that
 * is contractually free of them. Backticks go for the same reason; the two Unicode line
 * separators go because they are newlines to a JS parser and not to `JSON.stringify`.
 *
 * @example jsLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u0060/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** One display-list mark as SVG markup, for the static render that ships in `card.html`. */
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
  const own = '.ck-boxplot[data-card="' + id + '"]';
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
 * thing that has to know anything. `prefers-color-scheme` is deliberately absent — the desk is
 * one document open in two viewers that want different answers, and the OS gives both the same.
 */
function cardCss(id, wide, W) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    /* The whisker is furniture and the median is the finding, so they are not the same weight. */
    ['.ck-plot .ck-whisk', 'stroke: var(--ink-faint); stroke-width: 1; fill: none;'],
    ['.ck-plot .ck-med', 'stroke: var(--ink); stroke-width: 1.8; fill: none;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  /* A plot too wide for the column keeps its width and scrolls inside `.ck-scroll`, so the desk
     column never widens and the page never grows a horizontal scrollbar of its own. */
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-boxplot">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="box plot settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('notch') + '">notch</label>\n' +
    '    <input id="' + f('notch') + '" name="notch" type="checkbox"' +
           (defaults.notch ? ' checked' : '') + '>\n' +
    '    <label for="' + f('points') + '">points</label>\n' +
    '    <select id="' + f('points') + '" name="points">' +
         opt('none', 'none', defaults.points) +
         opt('outliers', 'outliers only', defaults.points) +
         opt('all', 'every observation', defaults.points) + '</select>\n' +
    '    <label for="' + f('orient') + '">orientation</label>\n' +
    '    <select id="' + f('orient') + '" name="orient">' +
         opt('vertical', 'vertical', defaults.orient) +
         opt('horizontal', 'horizontal', defaults.orient) + '</select>\n' +
    '    <p class="ck-set-foot">the notch is a 95% interval for the median and assumes rough ' +
         'normality. Hiding the points also stops outliers stretching the axis, which is how a ' +
         'squashed set of boxes gets its room back.</p>\n' +
    '  </div>\n' +
    /* The picture ships drawn: a card whose plot only exists once a script has run is blank in a
       static render, and blank if one other card on the desk fails to parse. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg></div>\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped statistics, a display-list renderer, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardJs} before
 * it is returned.
 *
 * @param id       the card's id, used as its `CK.build` key
 * @param payload  the shipped summaries and drawable observations
 * @param settings the defaults object `CK.settings` reconciles against
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, settings) {
  const src =
    '/* box plot card: the quartiles, fences, whiskers and notch were all computed in Node from\n' +
    '   the complete sample. The functions below are the ones that drew the card that shipped,\n' +
    '   emitted as their own source, so a settings change re-runs them rather than a second\n' +
    '   implementation of them. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(settings) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where box plot decisions live. */\n' +
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
    '     a render that added marks would stack a second set of boxes on the first every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = bxRender(P, cfg), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    plot.style.minWidth = out.W > 640 ? out.W + "px" : "";\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so\n' +
    '       it may be assigned rather than parsed out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardJs(src, 'cardkit/boxplot');
}

/**
 * Build one box plot card from one data block.
 *
 * Every statistic comes from the complete sample, here, once. Only the DOTS are ever thinned,
 * and only for the payload's sake — the quartiles, the fences and the outlier counts the caption
 * quotes are exact even when the picture draws one dot in three.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data            an empty frame, captioned "no data"; no quartile is invented
 *   one observation    Q1, median and Q3 are all that value, the IQR is zero, and the group
 *                      draws as a 2px bar with a median rule on it — an invisible box and an
 *                      absent group must not look alike
 *   two identical      the same, with n = 2 in the tooltip
 *   all values equal   zero spread: the whole card's axis collapses, so it is padded by half
 *                      the magnitude either side and every group draws as a flat marker
 *   zero IQR, spread   the fences land ON the quartiles, so every value away from the median is
 *                      an outlier. That is what the 1.5 IQR rule says; the caption says it too
 *   an extreme outlier the axis reaches it and the boxes squash — until `points` is set to
 *                      none, at which point the axis only spans the whiskers again
 *   20 groups          lanes narrow, the plot widens past the column and scrolls inside itself
 *   n = 10,000         summarised exactly; drawn dots are capped at 1200 per group (400 for
 *                      outliers), thinned as every k-th of the sorted list so both ends survive
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ groups: [{ name, values }], xLabel, unit }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused and
 *                 counted while reading
 *
 * @example
 * build({
 *   id: 'build-times',
 *   title: 'build time by runner',
 *   data: { xLabel: 'wall clock', unit: 's',
 *           groups: [{ name: 'linux', values: [31, 33, 34, 36, 41, 88] },
 *                    { name: 'macos', values: [52, 55, 57, 60, 61] }] },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'boxplot' : id);
  const read = readData(data);

  const groups = read.groups.map((g) => {
    const s = summarise(g.values);
    const sorted = sortAsc(g.values);
    const outShown = thin(s.out, OUT_CAP);
    const sample = thin(sorted, ALL_CAP);
    return {
      name: g.name,
      refused: g.refused,
      n: s.n, min: s.min, max: s.max,
      q1: s.q1, med: s.med, q3: s.q3, iqr: s.iqr,
      wlo: s.wlo, whi: s.whi, mean: s.mean,
      notchLo: s.notchLo, notchHi: s.notchHi, notchClamped: s.notchClamped,
      constant: s.constant,
      /* `out` keeps its true length for the counts the caption quotes; `outShown` is what is
         drawn. Conflating the two is how a card ends up claiming 400 outliers because 400 is
         how many fitted. */
      /* The true count and the drawn list are separate fields on purpose. Conflating them is how
         a card ends up claiming 400 outliers because 400 is how many fitted on the page. */
      outCount: s.out.length,
      outShown,
      outThinned: s.out.length > outShown.length,
      sample,
      sampleThinned: sorted.length > sample.length,
    };
  });

  const P = {
    W0, H0, wmax: WMAX,
    unit: read.unit,
    xLabel: read.xLabel,
    refused: read.refused,
    groups,
  };

  const seed = bxRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      groups: groups.length,
      values: read.kept,
      refused: read.refused,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed),
    css: cardCss(cardId, seed.W > W0, seed.W),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
