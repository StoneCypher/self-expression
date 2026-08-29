/**
 * `violin` — a mirrored kernel density per group, and a refusal to draw one from too few points.
 *
 * A violin is the most confident-looking chart in common use and the easiest to make lie with.
 * A Gaussian kernel density estimate is a sum of one bump per observation; with a handful of
 * points and a bandwidth that shrinks as n^(-1/5), the "modes" a reader sees ARE the individual
 * observations, dressed as structure. The picture does not get less smooth as the evidence gets
 * thinner — it gets more interesting. That is the failure mode, and it is why this card refuses
 * to draw a density below a stated n and draws the observations instead, saying so on the card.
 *
 * The kernel is Gaussian and the bandwidth is Silverman's rule of thumb, in the form R ships as
 * `bw.nrd0`:
 *
 *     h = 0.9 * min(sd, IQR / 1.349) * n^(-1/5)
 *
 * The `min` is the robust part and the whole reason to prefer this over Scott's h = 1.06 s
 * n^(-1/5): the standard deviation is not robust, so one observation a hundred interquartile
 * ranges out inflates s and oversmooths every feature of the distribution into a single hump.
 * What breaks under the OTHER alternative — a plug-in selector such as Sheather-Jones — is
 * different and worse for a desk: it is better on genuinely multimodal data, but it needs an
 * iterative solve that can fail to converge, and a bandwidth selector that sometimes does not
 * return is worse than one that is sometimes twenty percent too wide.
 *
 * The bandwidth itself is computed in Node from the COMPLETE sample, so the number the caption
 * quotes is exact even when the observations shipped to the browser have been thinned. Only the
 * curve is re-evaluated when the multiplier changes, and it is re-evaluated by the very
 * functions that drew this card, shipped through `Function.prototype.toString()`.
 *
 * @see ./boxplot.mjs    the five-number sibling, which has no minimum n
 * @see ./ridgeline.mjs  the same density, one curve per row, overlapping
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
 * @example loadKit().hue(0);   // 'var(--ck-s1)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/violin: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/violin: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;
const H0 = 320;
const WMAX = 2200;

/**
 * The smallest sample this card will draw a density from.
 *
 * Eight, and the number is a judgement rather than a theorem, so here is the judgement. The
 * variance of a kernel density estimate at a point goes as 1/(n h); with Silverman's h the
 * effective number of observations under the kernel is roughly n^(4/5), which at n = 7 is about
 * four and a half. Four and a half points cannot distinguish a bimodal distribution from a
 * unimodal one, but a KDE from them will happily show two humps — one per cluster of
 * observations — and a reader has no way to tell that apart from a finding. Below this, the card
 * draws the observations, which is the honest picture of a small sample.
 */
const MIN_N = 8;

/* How many points the density is evaluated at. 96 is enough that the curve is smooth at the
   width of a desk column and small enough that twenty groups re-evaluate in a few milliseconds
   when the bandwidth slider moves. */
const GRID = 96;

/* Payload budget. The bandwidth and every quoted statistic come from the complete sample; only
   the observations the browser re-evaluates the curve from are thinned, systematically. */
const SAMPLE_CAP = 2000;
const SAMPLE_BUDGET = 12000;
const SAMPLE_FLOOR = 250;

/* At most this many observations are drawn as sticks in the inner plot. Past it they are a grey
   block rather than a rug, so nothing is lost by thinning them. */
const STICK_CAP = 300;

/* Beyond six bandwidths a Gaussian contributes about six parts per billion of its peak. Skipping
   those terms changes the curve by far less than the width of the stroke that draws it and turns
   the sweep from O(n * grid) into something a 10,000-point sample survives. */
const TAIL_Z = 6;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` cannot be referenced by it at all.
 */
export const defaults = {
  bandwidth: 1,
  inner: 'box',
  trim: true,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'violin',
  summary: 'Mirrored Gaussian densities with a Silverman bandwidth, refused below eight points.',
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
 * @param src the emitted script
 * @param who a label for the error message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it checks
 * @throws {Error} naming the offending construct and its offset, with the surrounding text
 *
 * @example guardJs('var a = 1;');   // returns it
 */
export function guardJs(src, who) {
  const where = who || 'cardkit/violin';
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
 * invents observations at zero out of blanks and booleans — and a kernel density does not merely
 * add a dot for an invented zero, it grows a whole bump there. Everything refused is counted and
 * the count is named in the caption.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ groups, refused, kept, xLabel, unit }`
 *
 * @example readData({ groups: [{ name: 'a', values: [1, null] }] }).refused;   // 1
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
 * The p-quantile sits at position (n-1)p in the ascending sample, interpolated linearly between
 * neighbours. Chosen for the same reason the box plot card chose it: it is the definition a
 * reader's own tools will agree with, and the inner box here has to be comparable with the box
 * plot card sitting next to it on the same desk.
 *
 * @param sorted the sample, already ascending; an empty sample yields 0
 * @param p      a probability in 0..1
 *
 * @example quantile7([1, 2, 3, 4], 0.25);   // 1.75
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

/** The sample standard deviation, n-1 divisor; zero for a sample of one, which is correct and load-bearing here. */
function sdOf(values) {
  const m = values.length;
  if (m < 2) return 0;
  let s = 0;
  let mu = 0;
  for (const v of values) mu += v;
  mu /= m;
  for (const v of values) { const dd = v - mu; s += dd * dd; }
  return Math.sqrt(s / (m - 1));
}

/**
 * Silverman's rule of thumb for a Gaussian kernel, in the form R ships as `bw.nrd0`.
 *
 *     h = 0.9 * min(sd, IQR / 1.349) * n^(-1/5)
 *
 * The 1.349 converts an interquartile range into a standard deviation for a normal sample, so
 * the `min` picks whichever estimate of spread is smaller — which is the robust one whenever a
 * tail is fat. The fallback chain when that minimum is zero is R's, not an invention: fall back
 * to the standard deviation, then to the magnitude of the first observation, then to one. A
 * sample with zero standard deviation is constant and gets no density at all, so the last two
 * links exist only so that this function can never return zero and hand a division by zero to
 * the kernel.
 *
 * @param sorted the complete sample, ascending
 * @returns a strictly positive bandwidth, or 0 for an empty sample
 *
 * @example silverman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);   // about 1.72
 */
function silverman(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const sd = sdOf(sorted);
  const iqr = quantile7(sorted, 0.75) - quantile7(sorted, 0.25);
  let lo = Math.min(sd, iqr / 1.349);
  if (!(lo > 0)) lo = sd;
  if (!(lo > 0)) lo = Math.abs(sorted[0]);
  if (!(lo > 0)) lo = 1;
  return 0.9 * lo * Math.pow(n, -1 / 5);
}

/**
 * Thin a sorted list to at most `cap` entries, keeping its shape and both ends.
 *
 * Systematic — every k-th of the ascending list — rather than random, so the same data draws the
 * same picture twice and the quantiles of the kept subset converge on the quantiles of the
 * whole. The last entry is appended when the stride would miss it, because a density estimated
 * from a sample missing its maximum has a tail that stops early for no reason.
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

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything below runs in BOTH halves: Node calls it to draw the card that ships, and the
   browser calls the identical text after a settings change. ES5 only — `var` and `function`, no
   arrow functions, no template literals, no destructuring — and nothing but `CK` from outside. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole attribute and the card
 * renders empty with nothing in the console. Throwing makes it a build failure beside the input
 * that caused it — which for a density means beside the bandwidth that went to zero.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/violin: non-finite coordinate (' + v + ')');
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

/** The longest string in a list, or the empty string — used to decide how much room labels want. */
function longestOf(list) {
  var best = '', i;
  for (i = 0; i < list.length; i++) { if (list[i].length > best.length) { best = list[i]; } }
  return best;
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
 * The deterministic stand-in for jitter. Scattering coincident points needs an offset per point,
 * and `Math.random` gives a card that draws a different picture every time it is replayed - the
 * desk swaps its main element and replays every builder, so that is not hypothetical. A
 * low-discrepancy sequence fills the lane evenly and is a pure function of the index.
 *
 * @param i a non-negative integer index
 * @returns an offset in -1..1
 *
 * @example vdc(0);   // 0
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
 * A Gaussian kernel density estimate, evaluated at each point of a grid.
 *
 * The estimate at x is the mean of a unit normal density centred on every observation, scaled by
 * the bandwidth. Terms beyond six bandwidths are skipped: at that distance a Gaussian is about
 * six parts per billion of its peak, which is thousands of times smaller than the stroke that
 * will draw the curve, and skipping them is what lets a 2000-point sample re-evaluate on every
 * move of the bandwidth control.
 *
 * @param sample the observations to place kernels on
 * @param h      the bandwidth; must be strictly positive
 * @param grid   the values to evaluate at
 * @param tailZ  how many bandwidths out to keep contributing
 * @returns a density per grid point, in the reciprocal of the data's unit
 *
 * @example kdeCurve([0], 1, [0, 1], 6);   // [0.3989…, 0.2419…]
 */
function kdeCurve(sample, h, grid, tailZ) {
  var out = [], i, j, s, z;
  var m = sample.length;
  var inv = 1 / (h * Math.sqrt(2 * Math.PI) * (m || 1));
  for (i = 0; i < grid.length; i++) {
    s = 0;
    for (j = 0; j < m; j++) {
      z = (grid[i] - sample[j]) / h;
      if (z > tailZ || z < -tailZ) { continue; }
      s += Math.exp(-0.5 * z * z);
    }
    out.push(s * inv);
  }
  return out;
}

/** An evenly spaced grid of `n` values from `lo` to `hi`, inclusive at both ends. */
function linGrid(lo, hi, n) {
  var out = [], i;
  if (n < 2) { return [lo]; }
  for (i = 0; i < n; i++) { out.push(lo + (hi - lo) * i / (n - 1)); }
  return out;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the plot to anyone using one.
 * The caption's job is the harder one: on this card it has to say how much smoothing was
 * applied, which groups were refused a density and why, and that a violin's width is an estimate
 * rather than a count — the three things a reader cannot see and would otherwise assume.
 *
 * @param P     the shipped payload
 * @param cfg   the settled settings
 * @param dom   the value domain actually drawn, as `{ lo, hi }`
 * @param drawn per-group render facts: `{ density, h, thinned }`
 * @param mult  the bandwidth multiplier actually used, after clamping
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function vlNote(P, cfg, dom, drawn, mult) {
  var gs = P.groups, ng = gs.length, unit = P.unit ? ' ' + P.unit : '';
  var i, g;
  var live = 0, curves = 0, refusedSmall = 0, refusedFlat = 0, thinned = 0, totalN = 0;
  for (i = 0; i < ng; i++) {
    g = gs[i];
    totalN += g.n;
    if (g.n > 0) { live++; }
    if (drawn[i].density) { curves++; }
    else if (g.n > 0 && g.constant) { refusedFlat++; }
    else if (g.n > 0) { refusedSmall++; }
    if (drawn[i].thinned) { thinned++; }
  }

  if (!live) {
    return {
      aria: 'Violin plot with no data: ' + (P.refused
        ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left.'
        : 'nothing was supplied.'),
      caption: 'a violin plot with <b>no data</b> - the frame is drawn so the card keeps its place. ' +
        (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                     ' refused</i> for not being finite numbers. ' : '') +
        'no density is estimated from nothing.',
    };
  }

  var aria = 'Violin plot of ' + totalN + ' value' + (totalN === 1 ? '' : 's') + ' in ' + ng +
    ' group' + (ng === 1 ? '' : 's') + (P.xLabel ? ', measuring ' + P.xLabel : '') + '. ' +
    'Values run from ' + CK.fmt(dom.lo) + ' to ' + CK.fmt(dom.hi) + unit + '. ' +
    curves + ' group' + (curves === 1 ? '' : 's') + ' are drawn as a mirrored density; ' +
    (refusedSmall + refusedFlat) + ' as their individual observations. ';
  for (i = 0; i < ng && i < 8; i++) {
    g = gs[i];
    if (!g.n) { continue; }
    aria += g.name + ': n ' + g.n + ', median ' + CK.fmt(g.med) +
            ', from ' + CK.fmt(g.min) + ' to ' + CK.fmt(g.max) +
            (drawn[i].density ? ', bandwidth ' + CK.fmt(drawn[i].h) : ', drawn as points') + '. ';
  }
  aria += 'Width is an estimated density, not a count. Wider means more of the sample lands near ' +
          'that value.';

  var doubts = [];
  doubts.push('bandwidth is Silverman (0.9 min(sd, IQR/1.349) n^(-1/5))' +
              (mult !== 1 ? ' scaled by ' + CK.esc(CK.fmt(mult)) : '') +
              ' - widen it and every feature flattens, narrow it and noise becomes structure');
  if (refusedSmall) {
    doubts.push('<i>' + CK.esc(String(refusedSmall)) + ' group' + (refusedSmall === 1 ? '' : 's') +
                ' had fewer than ' + CK.esc(String(P.minN)) + ' points</i>, so no density was drawn ' +
                'for them - at that size a kernel estimate shows one bump per observation and calls ' +
                'it a mode; the observations are drawn instead');
  }
  if (refusedFlat) {
    doubts.push('<i>' + CK.esc(String(refusedFlat)) + ' group' + (refusedFlat === 1 ? ' is' : 's are') +
                ' constant</i>, which has no density at all - the limit is a spike of infinite ' +
                'height and zero width - so the observations are drawn as a single stack');
  }
  if (P.refused) {
    doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                ' refused</i> for not being a finite number - counted, never silently dropped');
  }
  if (thinned) {
    doubts.push('the curve in ' + CK.esc(String(thinned)) + ' group' + (thinned === 1 ? '' : 's') +
                ' is evaluated from every k-th value of the sorted sample; the bandwidth and every ' +
                'quoted number come from the whole of it');
  }
  if (!cfg.trim) {
    doubts.push('<i>untrimmed</i> - the curve runs three bandwidths past the smallest and largest ' +
                'observation, so it shows density where nothing was observed and, for a bounded ' +
                'quantity, where nothing could be');
  }
  if (curves > 1) {
    doubts.push('all violins share one density-to-width scale, so a fat one really is denser than ' +
                'a thin one; scaling each to its own peak - the common default - would make every ' +
                'group look equally well determined');
  }

  var caption = '<b>' + CK.esc(String(totalN)) + '</b> value' + (totalN === 1 ? '' : 's') +
    ' in <b>' + CK.esc(String(ng)) + '</b> group' + (ng === 1 ? '' : 's') + ', ' +
    '<b>' + CK.esc(String(curves)) + '</b> drawn as a Gaussian density and <b>' +
    CK.esc(String(refusedSmall + refusedFlat)) + '</b> as raw points. ' +
    'the inner mark is <i>' + CK.esc(String(cfg.inner)) + '</i>. ' +
    '<span class="ck-aside">' + doubts.join('; ') + '.</span>';

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * The bandwidth multiplier is the only setting that changes the arithmetic, and it changes it in
 * exactly one place: `h = h0 * multiplier`, where `h0` came from the complete sample in Node. So
 * a reader dragging the multiplier is looking at the same estimator with a different smoothing
 * parameter, not at a different estimator.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settled settings: `bandwidth`, `inner`, `trim`
 * @returns `{ W, H, marks, note }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable values were refused and counted while reading
 *
 * @example vlRender(P, { bandwidth: 1, inner: 'box', trim: true }).marks.length;
 */
function vlRender(P, cfg) {
  var gs = P.groups, ng = gs.length;
  var marks = [], i, j, g;

  /* Clamped rather than trusted: the control is a number field and a viewer can type anything
     into it, including 0, which would divide by zero inside the kernel. */
  var mult = Number(cfg.bandwidth);
  if (!(mult > 0) || !isFinite(mult)) { mult = 1; }
  if (mult < 0.1) { mult = 0.1; }
  if (mult > 5) { mult = 5; }

  var trim = !!cfg.trim;
  var drawn = [];

  var lo = Infinity, hi = -Infinity, maxD = 0;
  for (i = 0; i < ng; i++) {
    g = gs[i];
    var d = { density: false, h: 0, grid: null, dens: null, thinned: !!g.thinned };
    if (g.n > 0) {
      if (g.n >= P.minN && !g.constant && g.h0 > 0) {
        d.h = g.h0 * mult;
        var glo = trim ? g.min : g.min - 3 * d.h;
        var ghi = trim ? g.max : g.max + 3 * d.h;
        if (!(ghi > glo)) { ghi = glo + 1; }
        d.grid = linGrid(glo, ghi, P.grid);
        d.dens = kdeCurve(g.sample, d.h, d.grid, P.tailZ);
        d.density = true;
        for (j = 0; j < d.dens.length; j++) { if (d.dens[j] > maxD) { maxD = d.dens[j]; } }
        if (glo < lo) { lo = glo; }
        if (ghi > hi) { hi = ghi; }
      } else {
        if (g.min < lo) { lo = g.min; }
        if (g.max > hi) { hi = g.max; }
      }
    }
    drawn.push(d);
  }

  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) {
    /* Zero spread across everything drawn: half the magnitude either side, so the flat stack has
       somewhere to sit and the axis has ticks. All-zero data has no magnitude to halve. */
    var e = Math.abs(lo) * 0.5 || 0.5;
    lo -= e; hi += e;
  }

  var ax = axisTicks(lo, hi, 5);
  var vLabels = [], cLabels = [];
  for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }
  for (i = 0; i < ng; i++) { cLabels.push(gs[i].name); }

  var leftW = 0;
  for (i = 0; i < vLabels.length; i++) { leftW = Math.max(leftW, tw(vLabels[i])); }

  var sideCap = P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit;
  var padT = 14, padR = 16;
  var padB = 22;
  var padL = Math.round(leftW) + 12 + (sideCap ? 12 : 0);

  var perSlot = Math.max(46, tw(clipTo(longestOf(cLabels), 90)) + 8);
  var W = ng ? Math.min(P.wmax, Math.max(P.W0, padL + padR + ng * perSlot)) : P.W0;
  var H = P.H0;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  var vS = CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
  var band = ng ? (plot.x1 - plot.x0) / ng : plot.x1 - plot.x0;
  var half = Math.max(3, Math.min(60, band * 0.42));
  /* One density-to-width scale for every group, so width means the same thing across the card. */
  var wS = CK.scale([0, maxD > 0 ? maxD : 1], [0, half]);

  for (i = 0; i < ax.ticks.length; i++) {
    var vp = vS(ax.ticks[i]);
    marks.push(mLine(plot.x0, vp, plot.x1, vp, 'ck-rule'));
    marks.push(mText(plot.x0 - 6, vp + 3.2, vLabels[i], 'ck-tk', 'end'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  for (i = 0; i < ng; i++) {
    g = gs[i];
    var colour = CK.hue(i);
    var c = plot.x0 + (i + 0.5) * band;
    var kids = [];

    marks.push(mText(c, plot.y1 + 13, clipTo(g.name, Math.max(16, band - 2)), 'ck-tk', 'middle'));

    if (!g.n) {
      /* An empty group keeps its lane. Collapsing it would renumber every group after it, and a
         reader comparing two renders of the same card would be comparing different positions. */
      marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
      continue;
    }

    var dr = drawn[i];
    if (dr.density) {
      /* Up the right side, back down the left. One closed path rather than two mirrored curves,
         so the fill and the stroke follow the same outline and a half-transparent fill does not
         double up along the seam. */
      var dd = '';
      for (j = 0; j < dr.grid.length; j++) {
        dd += (j === 0 ? 'M' : 'L') + fin(c + wS(dr.dens[j])) + ' ' + fin(vS(dr.grid[j]));
      }
      for (j = dr.grid.length - 1; j >= 0; j--) {
        dd += 'L' + fin(c - wS(dr.dens[j])) + ' ' + fin(vS(dr.grid[j]));
      }
      kids.push(mPath(dd + 'Z', { fill: colour, 'fill-opacity': '0.26', stroke: colour,
                                  'stroke-width': '1.4', 'stroke-linejoin': 'round',
                                  'class': 'ck-violin' }));

      if (cfg.inner === 'box') {
        /* A miniature box plot: the same type-7 quartiles and 1.5 IQR whiskers the box plot card
           draws, so the two cards on one desk cannot disagree about the same group. */
        var bw = Math.max(2.5, half * 0.16);
        kids.push(mLine(c, vS(g.wlo), c, vS(g.whi), 'ck-whisk'));
        kids.push(mRect(c - bw / 2, Math.min(vS(g.q1), vS(g.q3)), bw,
                        Math.max(1.5, Math.abs(vS(g.q3) - vS(g.q1))),
                        { fill: 'var(--ground)', stroke: 'var(--ink-dim)', 'stroke-width': '1',
                          'class': 'ck-innerbox' }));
        kids.push(mDot(c, vS(g.med), Math.max(1.4, bw * 0.42),
                       { fill: 'var(--ink)', stroke: 'none', 'class': 'ck-med' }));
      } else if (cfg.inner === 'stick') {
        for (j = 0; j < g.sticks.length; j++) {
          kids.push(mLine(c - half * 0.3, vS(g.sticks[j]), c + half * 0.3, vS(g.sticks[j]), 'ck-stick'));
        }
      }
    } else {
      /* Refused a density. The observations are the picture instead, spread across the lane by a
         deterministic low-discrepancy offset so that ties are visible as a column of dots rather
         than as one dot with nine hiding behind it. */
      for (j = 0; j < g.sticks.length; j++) {
        kids.push(mDot(c + vdc(j) * half * 0.55, vS(g.sticks[j]), 2.2,
                       { fill: colour, 'fill-opacity': '0.7', stroke: 'none', 'class': 'ck-obs' }));
      }
      kids.push(mText(c, plot.y0 + 9,
                      g.constant ? 'flat' : 'n ' + g.n, 'ck-warn', 'middle'));
    }

    var hit = mRect(c - band / 2, plot.y0, band, plot.y1 - plot.y0,
                    { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    hit.ti = g.name + '  \u00b7  n ' + g.n +
             '  \u00b7  median ' + CK.fmt(g.med) +
             '  \u00b7  IQR ' + CK.fmt(g.q3 - g.q1) +
             '  \u00b7  ' + CK.fmt(g.min) + ' to ' + CK.fmt(g.max) +
             (dr.density ? '  \u00b7  bandwidth ' + CK.fmt(dr.h) : '  \u00b7  no density: ' +
               (g.constant ? 'constant' : 'n below ' + P.minN)) +
             (g.refused ? '  \u00b7  ' + g.refused + ' refused' : '');
    kids.push(hit);

    marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
  }

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

  return { W: W, H: H, marks: marks, note: vlNote(P, cfg, { lo: ax.lo, hi: ax.hi }, drawn, mult) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions above the browser needs, in dependency order. Shipped as their own source rather
   than restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, longestOf, axisTicks, mLine, mText, mRect, mPath, mDot,
                 vdc, kdeCurve, linGrid, vlNote, vlRender];

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
  const own = '.ck-violin[data-card="' + id + '"]';
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
    /* The refusal note reads as a label, not as an alarm: it is a correct outcome, not an error. */
    ['.ck-plot .ck-warn', 'fill: var(--ink-faint); font-size: 8.5px; letter-spacing: .06em;'],
    ['.ck-plot .ck-whisk', 'stroke: var(--ink-dim); stroke-width: 1; fill: none;'],
    ['.ck-plot .ck-stick', 'stroke: var(--ink-dim); stroke-width: .8; opacity: .5;'],
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

  return '<section data-card="' + CK.esc(id) + '" class="ck-violin">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="violin settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('bandwidth') + '">bandwidth</label>\n' +
    '    <input id="' + f('bandwidth') + '" name="bandwidth" type="number" min="0.1" max="5" ' +
           'step="0.1" value="' + CK.esc(defaults.bandwidth) + '">\n' +
    '    <label for="' + f('inner') + '">inner</label>\n' +
    '    <select id="' + f('inner') + '" name="inner">' +
         opt('box', 'quartile box', defaults.inner) +
         opt('stick', 'one stick per point', defaults.inner) +
         opt('none', 'nothing', defaults.inner) + '</select>\n' +
    '    <label for="' + f('trim') + '">trim to data</label>\n' +
    '    <input id="' + f('trim') + '" name="trim" type="checkbox"' +
           (defaults.trim ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">bandwidth multiplies Silverman rule of thumb, clamped to 0.1-5. ' +
         'Untrimmed curves run three bandwidths past the data, showing density where nothing was ' +
         'observed. Groups under ' + MIN_N + ' points are drawn as points, not curves.</p>\n' +
    '  </div>\n' +
    /* The picture ships drawn: a card whose plot only exists once a script has run is blank in a
       static render, and blank if one other card on the desk fails to parse. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg></div>\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped estimator, a display-list renderer, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardJs} before
 * it is returned.
 *
 * @param id       the card's id, used as its `CK.build` key
 * @param payload  the shipped samples, bandwidths and summaries
 * @param settings the defaults object `CK.settings` reconciles against
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, settings) {
  const src =
    '/* violin card: the bandwidth came from the complete sample in Node and is a number here.\n' +
    '   The estimator below is the source that drew the card that shipped, so moving the\n' +
    '   multiplier re-runs it rather than a second implementation of it. */\n' +
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
    '     stays a translator rather than a second place where violin decisions live. */\n' +
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
    '     a render that added marks would stack a second set of violins on the first. */\n' +
    '  function render(cfg) {\n' +
    '    var out = vlRender(P, cfg), i;\n' +
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

  return guardJs(src, 'cardkit/violin');
}

/**
 * Build one violin card from one data block.
 *
 * The bandwidth and every quoted statistic come from the COMPLETE sample, here, once. Only the
 * observations the browser re-evaluates the curve from are thinned.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data            an empty frame, captioned "no data"; no density is estimated
 *   one observation    below the minimum n, so no curve: the single point is drawn, labelled
 *                      with its n, and the caption says why there is no violin
 *   two identical      the same, and additionally constant
 *   all values equal   ZERO SPREAD. A kernel density of a constant sample does not exist — the
 *                      limit is a spike of infinite height and zero width — so the card draws
 *                      the observations as one stack, marks the lane "flat", and says in the
 *                      caption that no density was estimated. Nothing divides by zero, because
 *                      the constant case is refused before the bandwidth is ever used
 *   fewer than 8       refused a density on purpose; the points are drawn instead
 *   an extreme outlier the axis reaches it, and the Silverman `min` means the bandwidth does not
 *                      inflate with it — which is the whole reason for using the robust form
 *   negative values    nothing special; the axis simply spans them
 *   20 groups          lanes narrow, the plot widens past the column and scrolls inside itself
 *   n = 10,000         summarised and bandwidthed exactly; the curve is evaluated from at most
 *                      2,000 values per group (less when many groups share the 12,000 budget),
 *                      taken as every k-th of the sorted sample so both tails survive
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
 *   id: 'response',
 *   title: 'response time by region',
 *   data: { xLabel: 'response', unit: 'ms',
 *           groups: [{ name: 'eu', values: [12, 14, 15, 17, 19, 21, 24, 28, 33, 41] },
 *                    { name: 'us', values: [22, 24, 25, 27, 29, 31, 34, 38, 43, 51] }] },
 *   ord: 45,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'violin' : id);
  const read = readData(data);
  const ng = read.groups.length;

  /* The per-group sample cap shares one payload budget between however many groups there are,
     with a floor: a density from 250 points is already stable, and twenty groups of 250 is a
     payload a desk can carry. */
  const perGroup = ng ? Math.max(SAMPLE_FLOOR, Math.min(SAMPLE_CAP, Math.floor(SAMPLE_BUDGET / ng)))
                      : SAMPLE_CAP;

  const groups = read.groups.map((g) => {
    const s = sortAsc(g.values);
    const n = s.length;
    const q1 = quantile7(s, 0.25);
    const med = quantile7(s, 0.5);
    const q3 = quantile7(s, 0.75);
    const iqr = q3 - q1;

    /* The same Tukey whiskers the box plot card draws, so the inner box on this card and the box
       on that one cannot disagree about the same group. */
    let wlo = n ? s[n - 1] : 0;
    let whi = n ? s[0] : 0;
    for (const v of s) {
      if (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) continue;
      if (v < wlo) wlo = v;
      if (v > whi) whi = v;
    }
    if (!n || wlo > whi) { wlo = med; whi = med; }

    const sample = thin(s, perGroup);
    return {
      name: g.name,
      refused: g.refused,
      n,
      min: n ? s[0] : 0,
      max: n ? s[n - 1] : 0,
      q1, med, q3, wlo, whi,
      constant: !n || s[0] === s[n - 1],
      h0: n ? silverman(s) : 0,
      sample,
      thinned: s.length > sample.length,
      sticks: thin(s, STICK_CAP),
    };
  });

  const P = {
    W0, H0, wmax: WMAX,
    minN: MIN_N,
    grid: GRID,
    tailZ: TAIL_Z,
    unit: read.unit,
    xLabel: read.xLabel,
    refused: read.refused,
    groups,
  };

  const seed = vlRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      groups: ng,
      values: read.kept,
      refused: read.refused,
      minN: MIN_N,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed),
    css: cardCss(cardId, seed.W > W0, seed.W),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
