/**
 * `histogram` — binned counts of one or more samples, with the bin rule named on the card.
 *
 * A histogram is the one chart whose picture is mostly an argument about its own parameters. The
 * same thousand numbers are unimodal at eight bins and a comb at two hundred, and neither picture
 * is wrong — so a histogram that does not say how wide its bins are is withholding the only thing
 * a reader needs in order to disbelieve it. This card therefore states the rule it used, the
 * width that rule produced, and what that rule is bad at, in the caption, every time.
 *
 * Three rules are implemented and one is chosen:
 *
 *   Freedman-Diaconis   h = 2 IQR n^(-1/3)     the default
 *   Scott               h = 3.49 s n^(-1/3)
 *   Sturges             k = ceil(log2 n) + 1   the fallback
 *
 * All statistics are computed in Node from the complete sample. Only the drawing is redone in the
 * browser, and it is redone by the very functions that ran here — shipped through
 * `Function.prototype.toString()` — so a settings change cannot produce a picture that this
 * module has never seen. `CK` itself comes out of `kit.js` through a `node:vm` context, so
 * `CK.scale`, `CK.ticks` and `CK.hue` here are the same code the browser runs, not a Node-shaped
 * twin of it.
 *
 * @see ./boxplot.mjs   the five-number sibling
 * @see ./violin.mjs    the kernel-density sibling, which refuses small samples outright
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it.
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
  catch (e) { throw new Error('cardkit/histogram: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/histogram: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants that both halves need ─────────────────────────────────────────────────── */

/* The drawing surface. Fixed rather than derived from the bin count: a histogram's bins are
   equal-width by definition, so a wider canvas buys nothing that a wider bin does not, and a
   card that changes size when a setting changes is a card that makes the desk jump. */
const W = 640;
const H = 300;

/* An automatic bin count is capped here. Freedman-Diaconis divides the RANGE by a width derived
   from the IQR, so one observation a hundred interquartile ranges out asks for thousands of bins,
   almost all of them empty. The cap turns that into a comb with a note rather than into a
   1400-element display list. */
const NB_CAP = 120;

/* An explicit bin count is capped higher, because it was asked for on purpose. */
const NB_HARD = 200;

/* At most this many observations are shipped to the browser. A histogram's display list is
   bin-sized, not sample-sized, so this only bounds the payload; above it the sample is thinned
   systematically and the counts are scaled back up, which the caption says out loud. The number
   is a payload budget, not a statistical one: 4,000 values is roughly 80KB of inline literal,
   and a 12-bin histogram of a 1-in-3 systematic sample has column heights within a fraction of
   a percent of the truth. */
const SHIP_MAX = 4000;

/* Below this n, Freedman-Diaconis and Scott are not used at all. Both scale as n^(-1/3) off an
   estimate of spread, and with nine numbers that estimate has no precision: the pair routinely
   return one bin or forty from samples that differ by a single point. Sturges is a function of n
   alone, so it degrades quietly instead. */
const TINY_N = 10;

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css. Measured, not guessed; being a
   touch pessimistic reserves a little too much room, which is the safe way to be wrong. */
const CHW = 5.42;
const TXT = 9;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it. A separate binding declared *after* `meta` cannot be referenced by it — that is a
 * temporal dead zone error, and it is how six types shipped `meta.defaults === undefined`.
 */
export const defaults = {
  bins: 0,
  rule: 'fd',
  cumulative: false,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'histogram',
  summary: 'Binned counts with the bin rule, its width and its weakness stated on the card.',
  shape: '{ groups: [{ name, values: [number] }], xLabel, unit }',
  category: 'distribution',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const` and `let` false-positives on English prose, and a guard that
 * cries wolf is a guard somebody deletes. Offsets are preserved so a reported position still
 * points at the right character, and regex literals are recognised — without that the scanner
 * desynchronises on the quote inside a character class and starts blanking real code, which
 * turns a false positive into a far worse false negative.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, with comment and string contents replaced by spaces
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
 * Every card's `js` is concatenated into ONE inline block. A single modern-syntax token, or a
 * backtick inside a doc comment that `Function.prototype.toString()` faithfully shipped, is a
 * parse error that blanks every card on the page rather than just this one. Five types have
 * failed exactly that way, so this throws at build time instead of trusting a review.
 *
 * Backtick, arrow and optional chaining are scanned raw: none of them can appear innocently in
 * this file's output. `const`, `let` and `class` are scanned only after comment and string
 * bodies have been blanked, because English prose contains all three words.
 *
 * @param src the emitted script
 * @param who a label for the error message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it checks
 * @throws {Error} naming the offending construct and its offset, with the surrounding text
 *
 * @example guardJs('var a = 1;');                       // returns it
 * @example guardJs('var f = function () {}; var g = 0;') // returns it
 */
export function guardJs(src, who) {
  const where = who || 'cardkit/histogram';
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
     the class gets corrupted: an escape can be decoded one step early during emission, and the
     result is a plausible-looking regex holding the raw byte it meant to describe. */
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
 * silently invents observations at zero out of blanks and booleans, and the histogram grows a
 * spike nobody put there. Anything refused is COUNTED, per group and in total, and the count is
 * named in the caption — dropping data quietly is the failure this guards against, not the
 * dropping itself.
 *
 * Empty groups are kept rather than removed, because removing one would shift every later group
 * onto a different colour and the legend would stop matching the picture.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ groups, refused, kept, xLabel, unit }`
 *
 * @example
 * readData({ groups: [{ name: 'ms', values: [1, 2, 'x'] }] }).refused;   // 1
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

/** Ascending copy. `Array.prototype.sort` is lexicographic without a comparator, which for a bag of numbers is a silent disaster. */
function sortAsc(values) {
  const out = values.slice();
  out.sort((a, b) => a - b);
  return out;
}

/**
 * The type-7 quantile: the definition R, NumPy, pandas and Excel's QUARTILE.INC all use.
 *
 * There are nine quantile definitions in Hyndman and Fan and they disagree on small samples;
 * this one places the p-quantile at position `(n-1)p` in the sorted sample and interpolates
 * linearly between neighbours. It is chosen because it is the one a reader can check: anybody
 * who pastes the numbers into R or NumPy gets back exactly what the card drew.
 *
 * @param sorted the sample, already ascending
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

/** The arithmetic mean, or 0 for an empty sample. */
function meanOf(values) {
  let s = 0;
  for (const v of values) s += v;
  return values.length ? s / values.length : 0;
}

/**
 * The sample standard deviation, with the n-1 divisor.
 *
 * n-1 rather than n because the sample mean is estimated from the same data, and Scott's rule is
 * written for the unbiased estimate. With n = 1 there is no spread to estimate and this returns
 * zero, which is what sends Scott to the Sturges fallback rather than to a division by zero.
 */
function sdOf(values) {
  const m = values.length;
  if (m < 2) return 0;
  const mu = meanOf(values);
  let s = 0;
  for (const v of values) { const dd = v - mu; s += dd * dd; }
  return Math.sqrt(s / (m - 1));
}

/**
 * Thin a sorted sample to at most `cap` values, keeping its shape.
 *
 * Systematic: every k-th value of the ASCENDING sample. On sorted data that is a stratified
 * sample of the distribution rather than a random one — the quantiles of the thinned sample
 * converge on the quantiles of the whole — and it is deterministic, so the picture does not
 * change between two renders of the same card.
 *
 * @param sorted an ascending sample
 * @param cap    the most values to keep; 0 or less keeps everything
 * @returns the thinned sample, always including the first value
 *
 * @example thin([1,2,3,4,5,6], 3);   // [1, 3, 5]
 */
function thin(sorted, cap) {
  if (!(cap > 0) || sorted.length <= cap) return sorted.slice();
  const k = Math.ceil(sorted.length / cap);
  const out = [];
  for (let i = 0; i < sorted.length; i += k) out.push(sorted[i]);
  return out;
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything below this line runs in BOTH halves: Node calls it to draw the card that ships,
   and the browser calls the identical text to redraw after a settings change. It is therefore
   written in ES5 — `var` and `function`, no arrow functions, no template literals, no
   destructuring, no optional chaining — and it may only reach for `CK`, which exists as a
   module constant here and as a global there. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole `d` attribute and the
 * card renders empty with nothing in the console. Throwing turns that into a stack trace beside
 * the input that caused it, at build time, where a test can see it.
 *
 * @param v the coordinate
 * @throws {Error} when `v` is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/histogram: non-finite coordinate (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face. */
function tw(s) { return String(s).length * 5.42; }

/**
 * Ticks that reach the ends of the axis rather than stopping short of them.
 *
 * `CK.ticks` only returns ticks strictly inside the domain it was handed, which leaves a ragged
 * strip above the last gridline. Snapping the domain out to the step the ticks already chose
 * closes it; the ticks are then stepped out rather than re-derived, because asking `CK.ticks`
 * again with the wider range can push it to the next nice step and halve the gridline count.
 *
 * @param lo   the low end of the data
 * @param hi   the high end of the data
 * @param want roughly how many ticks are wanted
 * @returns `{ lo, hi, ticks }` with the domain widened to whole ticks
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

/** A display-list line. Every mark is `{ t: tagName, a: attributes, s: text, ti: tooltip }`. */
function mLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' } };
}

/** A display-list text run. `extra` carries anything unusual, such as a rotation transform. */
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

/** A display-list path. `d` is built by the caller, which is the only place that knows the shape. */
function mPath(d, attrs) {
  var a = { d: d }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'path', a: a };
}

/**
 * Choose the bin width, and be able to say why.
 *
 * The whole point of this card is that the answer is explained, so this returns the reasoning
 * along with the number. The order of precedence is: an explicit bin count wins outright; a
 * zero-width sample cannot be binned by any rule; a tiny sample is forced to Sturges; a rule
 * that returns a zero width falls back to Sturges; otherwise the asked-for rule is used.
 *
 * What breaks under each alternative, since that is the reason there is a choice at all:
 *
 *   Freedman-Diaconis  h = 2 IQR n^(-1/3). The IQR ignores the tails, so an extreme outlier
 *                      cannot widen the bins - it can only widen the range, which is why the
 *                      resulting count is capped rather than trusted.
 *   Scott              h = 3.49 s n^(-1/3). Optimal for a genuinely normal sample and nothing
 *                      else: the standard deviation is not robust, so a single value a hundred
 *                      interquartile ranges out inflates h until the entire body of the data
 *                      falls into one column.
 *   Sturges            k = ceil(log2 n) + 1. A function of n alone. It comes from a binomial
 *                      approximation to the normal and takes no notice of spread at all, so
 *                      past roughly n = 200 it asks for too few bins and smooths a bimodal
 *                      sample into a single hump.
 *
 * @param P   the shipped payload; only `P.pool` is read
 * @param cfg the settled settings: `bins`, `rule`
 * @returns `{ rule, nb, h, why }` — `why` is one sentence of plain text for the caption
 *
 * @example hgRule({ pool: { n: 100, min: 0, max: 10, iqr: 4, sd: 3 } }, { rule: 'fd', bins: 0 }).nb;
 */
function hgRule(P, cfg) {
  var pool = P.pool;
  var want = cfg.rule === 'scott' ? 'scott' : cfg.rule === 'sturges' ? 'sturges' : 'fd';
  var asked = Math.round(Number(cfg.bins));
  var r = { rule: want, nb: 1, h: 0, why: '' };
  if (!(asked > 0)) { asked = 0; }

  if (pool.n === 0) {
    r.rule = 'none'; r.nb = 0; r.h = 0;
    r.why = 'there is nothing to bin.';
    return r;
  }

  var span = pool.max - pool.min;

  if (asked > 0) {
    r.rule = 'explicit';
    r.nb = Math.min(P.nbHard, asked);
    r.h = span > 0 ? span / r.nb : 0;
    r.why = 'the bin count was set by hand to ' + asked +
            (r.nb !== asked ? ', clamped to ' + r.nb : '') + ', so no rule was consulted.';
    return r;
  }

  if (!(span > 0)) {
    r.rule = 'degenerate'; r.nb = 1; r.h = 0;
    r.why = 'every kept value is the same number, so all three rules ask for a bin of zero ' +
            'width and none of them is usable; one nominal bin holds the whole sample.';
    return r;
  }

  var sturges = Math.max(1, Math.ceil(Math.log(pool.n) / Math.LN2) + 1);

  if (pool.n < P.tinyN) {
    r.rule = 'sturges'; r.nb = sturges; r.h = span / sturges;
    r.why = 'n is ' + pool.n + ', under ' + P.tinyN + '. Freedman-Diaconis and Scott both scale ' +
            'as n^(-1/3) off an estimate of spread, and at this size that estimate has no ' +
            'precision left, so Sturges - which is a function of n alone - was used instead.';
    return r;
  }

  if (want === 'sturges') {
    r.nb = sturges; r.h = span / sturges;
    r.why = 'Sturges: bins = ceil(log2 n) + 1. It takes no notice of spread at all, so past ' +
            'about n = 200 it asks for too few bins and can smooth a two-humped sample into one.';
    return r;
  }

  var h = want === 'scott'
    ? 3.49 * pool.sd * Math.pow(pool.n, -1 / 3)
    : 2 * pool.iqr * Math.pow(pool.n, -1 / 3);

  if (!(h > 0)) {
    r.rule = 'sturges'; r.nb = sturges; r.h = span / sturges;
    r.why = (want === 'scott' ? 'Scott' : 'Freedman-Diaconis') + ' asked for a bin of zero ' +
            'width, because the ' + (want === 'scott' ? 'standard deviation' : 'interquartile range') +
            ' of this sample is zero - which happens when over half the values share one number - ' +
            'so Sturges was used instead.';
    return r;
  }

  var raw = Math.max(1, Math.ceil(span / h));
  r.h = h;
  r.nb = Math.max(1, Math.min(P.nbCap, raw));
  r.why = (want === 'scott'
    ? 'Scott: h = 3.49 s n^(-1/3), optimal for a normal sample and nothing else - the standard ' +
      'deviation is not robust, so one far-out value widens every bin.'
    : 'Freedman-Diaconis: h = 2 IQR n^(-1/3). The interquartile range ignores the tails, so an ' +
      'outlier cannot widen the bins, only the range.') +
    ' h = ' + CK.fmt(h) + ', which is ' + raw + ' bins' +
    (raw > r.nb ? ', capped at ' + r.nb + ' - the extra bins would all have been empty' : '') + '.';
  return r;
}

/**
 * Count a sample into `nb` equal bins across `lo`..`hi`.
 *
 * Bins are half-open, `[edge, nextEdge)`, except the last, which is closed on the right so the
 * maximum observation lands in the top bin instead of falling off the end. Values outside the
 * range are clamped into the end bins rather than dropped: the range comes from the same sample,
 * so an out-of-range value can only be floating-point slop at an edge, and dropping it would
 * make the counts fail to add up to n.
 *
 * @param sample the observations, in any order
 * @param lo     the left edge of the first bin
 * @param hi     the right edge of the last bin
 * @param nb     how many bins; 0 returns an empty array
 *
 * @example hgCount([0, 1, 2, 3], 0, 4, 2);   // [2, 2]
 */
function hgCount(sample, lo, hi, nb) {
  var out = [], i, b;
  var w = nb > 0 ? (hi - lo) / nb : 0;
  for (i = 0; i < nb; i++) { out.push(0); }
  if (nb === 0) { return out; }
  for (i = 0; i < sample.length; i++) {
    if (!(w > 0)) { out[0]++; continue; }
    b = Math.floor((sample[i] - lo) / w);
    if (b < 0) { b = 0; }
    if (b >= nb) { b = nb - 1; }
    out[b]++;
  }
  return out;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the chart to anyone using one.
 * "Histogram" is therefore not an acceptable answer: it names the genre and withholds the
 * content. The caption's job is different and more awkward — it has to say the things that make
 * the picture less believable, because those are the things a reader cannot see.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param rule the outcome of {@link hgRule}
 * @param cnt  per-group count arrays, already scaled and accumulated
 * @param maxC the tallest column
 * @param lo   left edge of the first bin
 * @param hi   right edge of the last bin
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function hgNote(P, cfg, rule, cnt, maxC, lo, hi) {
  var unit = P.unit ? ' ' + P.unit : '';
  var ng = P.groups.length;
  var cum = cfg.cumulative ? ' cumulative' : '';
  var i, j;

  if (P.pool.n === 0) {
    return {
      aria: 'Histogram with no data: ' + (P.refused
        ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left to bin.'
        : 'nothing was supplied.'),
      caption: 'a histogram with <b>no data</b> - the frame is drawn so the card keeps its place. ' +
        (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                     ' refused</i> for not being finite numbers. ' : '') +
        'nothing here is an estimate of anything.',
    };
  }

  /* The tallest bin, searched across every group, so a multi-group card names the peak that is
     actually the tallest thing drawn rather than the first group's peak. */
  var peak = { c: -1, g: 0, b: 0 };
  for (i = 0; i < cnt.length; i++) {
    for (j = 0; j < cnt[i].length; j++) {
      if (cnt[i][j] > peak.c) { peak = { c: cnt[i][j], g: i, b: j }; }
    }
  }
  var w = rule.nb > 0 ? (hi - lo) / rule.nb : 0;
  var pa = lo + peak.b * w;
  var pb = pa + w;

  var names = [];
  for (i = 0; i < P.groups.length; i++) { names.push(P.groups[i].name); }

  var aria = 'Histogram of ' + P.pool.n + ' value' + (P.pool.n === 1 ? '' : 's') +
    (ng > 1 ? ' in ' + ng + ' groups (' + names.join(', ') + ')' : '') +
    ' in ' + rule.nb + ' bin' + (rule.nb === 1 ? '' : 's') +
    ' from ' + CK.fmt(lo) + ' to ' + CK.fmt(hi) + unit +
    (P.xLabel ? ', measuring ' + P.xLabel : '') + '. ' +
    'The' + cum + ' counts run from 0 to ' + CK.fmt(maxC) + '. ' +
    'The tallest column is ' + CK.fmt(pa) + ' to ' + CK.fmt(pb) + unit +
    (ng > 1 ? ' in ' + names[peak.g] : '') + ', holding ' + CK.fmt(peak.c) + '. ' +
    'Bin width was chosen by ' + rule.rule + '.';

  var doubts = [];
  if (P.refused) {
    doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                ' refused</i> for not being a finite number - counted, never silently dropped');
  }
  if (P.thinned) {
    doubts.push('the sample was thinned to <b>' + CK.esc(String(P.shipped)) + '</b> values ' +
                '(every ' + CK.esc(String(P.stride)) + 'th of the sorted sample) and the counts ' +
                'scaled back up, so each column is within a few of its true height');
  }
  if (rule.rule === 'degenerate') {
    doubts.push('<i>zero spread</i> - one nominal bin, one column, and no shape to read');
  }
  if (rule.nb >= P.nbCap && rule.rule !== 'explicit') {
    doubts.push('the bin count hit its cap of ' + CK.esc(String(P.nbCap)));
  }
  if (ng > 1) {
    doubts.push('groups share one set of bin edges and are drawn as outlines, not filled bars, ' +
                'because filled bars hide each other and the hidden one is always the shorter');
  }

  var caption = '<b>' + CK.esc(String(P.pool.n)) + '</b> value' + (P.pool.n === 1 ? '' : 's') +
    (ng > 1 ? ' in <b>' + CK.esc(String(ng)) + '</b> groups' : '') +
    ' in <b>' + CK.esc(String(rule.nb)) + '</b>' + cum + ' bin' + (rule.nb === 1 ? '' : 's') +
    ' of width ' + CK.esc(CK.fmt(w)) + CK.esc(unit) + '. ' +
    '<i>rule: ' + CK.esc(rule.rule) + '</i> - ' + CK.esc(rule.why) + ' ' +
    (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * One function rather than a geometry function and a caption function, because the caption has
 * to quote numbers the geometry computed — the peak bin, the bin width actually used, the rule
 * that actually won — and computing them twice is how a caption starts describing a picture
 * that is no longer on the card.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settled settings: `bins`, `rule`, `cumulative`
 * @returns `{ W, H, marks, note }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable values were refused and counted while reading
 *
 * @example hgRender(P, { bins: 0, rule: 'fd', cumulative: false }).marks.length;
 */
function hgRender(P, cfg) {
  var rule = hgRule(P, cfg);
  var lo = P.lo, hi = P.hi, nb = rule.nb;
  var cum = !!cfg.cumulative;
  var marks = [], cnt = [], maxC = 0;
  var i, j, g, c, run;

  for (i = 0; i < P.groups.length; i++) {
    g = P.groups[i];
    c = hgCount(g.sample, lo, hi, nb);
    for (j = 0; j < c.length; j++) { c[j] = Math.round(c[j] * g.f); }
    if (cum) { run = 0; for (j = 0; j < c.length; j++) { run += c[j]; c[j] = run; } }
    for (j = 0; j < c.length; j++) { if (c[j] > maxC) { maxC = c[j]; } }
    cnt.push(c);
  }

  var ax = axisTicks(0, maxC > 0 ? maxC : 1, 5);
  var leftW = 0;
  for (i = 0; i < ax.ticks.length; i++) { leftW = Math.max(leftW, tw(CK.fmt(ax.ticks[i]))); }

  var footCap = P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit;
  var sideCap = cum ? 'cumulative count' : 'count';
  var padT = 14, padR = 16;
  var padB = 22 + (footCap ? 12 : 0);
  var padL = Math.round(leftW) + 12 + 12;
  var plot = { x0: padL, y0: padT, x1: P.W - padR, y1: P.H - padB };

  var yS = CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
  var xS = CK.scale([lo, hi], [plot.x0, plot.x1]);

  /* Furniture first, so every drawn count sits on top of its own gridline rather than under it. */
  for (i = 0; i < ax.ticks.length; i++) {
    var yv = yS(ax.ticks[i]);
    marks.push(mLine(plot.x0, yv, plot.x1, yv, 'ck-rule'));
    marks.push(mText(plot.x0 - 6, yv + 3.2, CK.fmt(ax.ticks[i]), 'ck-tk', 'end'));
  }
  var xt = CK.ticks(lo, hi, 6);
  for (i = 0; i < xt.length; i++) {
    var xv = xS(xt[i]);
    if (xv < plot.x0 - 0.5 || xv > plot.x1 + 0.5) { continue; }
    marks.push(mText(xv, plot.y1 + 13, CK.fmt(xt[i]), 'ck-tk', 'middle'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  var w = nb > 0 ? (hi - lo) / nb : 0;
  var solo = P.groups.length === 1;

  for (i = 0; i < P.groups.length; i++) {
    var colour = CK.hue(i);
    var kids = [];
    for (j = 0; j < nb; j++) {
      var xa = xS(lo + j * w), xb = xS(lo + (j + 1) * w);
      var yb = yS(cnt[i][j]);
      if (solo) {
        /* A filled bar for a lone group: the count IS the area, and a filled area reads as one.
           An empty bin is left empty rather than drawn one pixel tall - zero and absent mean the
           same thing in a histogram, unlike in a bar chart. */
        if (cnt[i][j] > 0) {
          kids.push(mRect(xa + 0.5, yb, Math.max(0.5, xb - xa - 1), plot.y1 - yb,
                          { fill: colour, 'fill-opacity': '0.55', stroke: colour,
                            'stroke-width': '1', 'class': 'ck-bin' }));
        }
      }
    }
    if (!solo && nb > 0) {
      /* Two or more groups become step outlines over shared edges. Overlaid filled bars hide
         each other and the hidden one is always the shorter, which reverses the comparison the
         reader came for; an outline crosses another outline and stays readable. */
      var d = '';
      for (j = 0; j < nb; j++) {
        var ea = xS(lo + j * w), eb = xS(lo + (j + 1) * w), ey = yS(cnt[i][j]);
        d += (j === 0 ? 'M' + fin(ea) + ' ' + fin(plot.y1) + 'L' + fin(ea) + ' ' + fin(ey)
                      : 'L' + fin(ea) + ' ' + fin(ey));
        d += 'L' + fin(eb) + ' ' + fin(ey);
      }
      d += 'L' + fin(xS(hi)) + ' ' + fin(plot.y1);
      kids.push(mPath(d, { fill: 'none', stroke: colour, 'stroke-width': '1.6',
                           'stroke-linejoin': 'round', 'class': 'ck-step' }));
    }
    marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
  }

  /* One invisible hit target per bin, carrying every group's count for that bin. A 4px column
     is not a hit area, and a tooltip per group per bin would be nb x groups elements. */
  for (j = 0; j < nb; j++) {
    var ha = xS(lo + j * w), hb = xS(lo + (j + 1) * w);
    var parts = [];
    for (i = 0; i < P.groups.length; i++) {
      parts.push((P.groups.length > 1 ? P.groups[i].name + ' ' : '') + CK.fmt(cnt[i][j]));
    }
    var hit = mRect(ha, plot.y0, Math.max(1, hb - ha), plot.y1 - plot.y0,
                    { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    hit.ti = CK.fmt(lo + j * w) + ' to ' + CK.fmt(lo + (j + 1) * w) +
             (P.unit ? ' ' + P.unit : '') + '  \u00b7  ' + parts.join('  \u00b7  ');
    marks.push(hit);
  }

  if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, P.H - 4, footCap, 'ck-cap-ax', 'middle')); }
  marks.push(mText(10, (plot.y0 + plot.y1) / 2, sideCap, 'ck-cap-ax', 'middle',
                   { transform: 'rotate(-90 10 ' + fin((plot.y0 + plot.y1) / 2) + ')' }));

  if (P.pool.n === 0) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return { W: P.W, H: P.H, marks: marks, note: hgNote(P, cfg, rule, cnt, maxC, lo, hi) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions above that the browser needs, in dependency order. Shipped as their own source
   rather than restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, axisTicks, mLine, mText, mRect, mPath, hgRule, hgCount, hgNote, hgRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding `</script>` cannot close the block early — and
 * so that no group name can ever put an arrow function's two characters into a file that is
 * contractually free of them. Backticks go for the same reason, and the two Unicode line
 * separators because they are newlines to a JS parser and not to `JSON.stringify`.
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
  const own = '.ck-histogram[data-card="' + id + '"]';
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
function cardCss(id, groupCount) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-bin', 'shape-rendering: crispEdges;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);

  if (groupCount > 1) {
    /* Hover lifts a whole outline rather than the mark under the pointer: with shared bin edges
       the useful question is which group, and one highlighted step answers a question nobody
       asked. Only worth doing when there is something to pick from. */
    rules.push(['.ck-plot .ck-ser', 'transition: opacity .12s linear;']);
    rules.push(['.ck-plot:hover .ck-ser', 'opacity: .35;']);
    rules.push(['.ck-plot .ck-ser:hover', 'opacity: 1;']);
    return scope(id, rules) +
      '\n@media (prefers-reduced-motion: reduce) {\n' +
      scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) + '\n}\n';
  }
  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, P, seed) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const legend = P.groups.length > 1
    ? '\n  <div class="ck-legend">' +
      P.groups.map((g, i) =>
        '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g.name) + '</span>').join('') +
      '</div>'
    : '';

  return '<section data-card="' + CK.esc(id) + '" class="ck-histogram">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="histogram settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('bins') + '">bins</label>\n' +
    '    <input id="' + f('bins') + '" name="bins" type="number" min="0" max="' + P.nbHard +
           '" step="1" value="' + CK.esc(defaults.bins) + '">\n' +
    '    <label for="' + f('rule') + '">rule</label>\n' +
    '    <select id="' + f('rule') + '" name="rule">' +
         opt('fd', 'Freedman-Diaconis', defaults.rule) +
         opt('sturges', 'Sturges', defaults.rule) +
         opt('scott', 'Scott', defaults.rule) + '</select>\n' +
    '    <label for="' + f('cumulative') + '">cumulative</label>\n' +
    '    <input id="' + f('cumulative') + '" name="cumulative" type="checkbox"' +
           (defaults.cumulative ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">bins 0 asks the rule. Freedman-Diaconis is robust to outliers; ' +
         'Scott is optimal for a normal sample and fooled by one far-out value; Sturges ignores ' +
         'spread entirely and oversmooths past about n = 200.</p>\n' +
    '  </div>\n' +
    /* The picture ships drawn. A card whose plot only exists once a script has run is blank in a
       static render and blank if one other card on the desk fails to parse. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg></div>' + legend + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped statistics, a display-list renderer, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardJs} before
 * it is returned. Every card's script is concatenated into one inline block on the desk, so a
 * single backtick — including one inside a comment, which `Function.prototype.toString()` ships
 * verbatim — is a parse error that blanks the whole page rather than this card.
 *
 * @param id       the card's id, used as its `CK.build` key
 * @param payload  the shipped data and precomputed statistics
 * @param settings the defaults object `CK.settings` reconciles against
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, settings) {
  const src =
    '/* histogram card: the bin rule, the counts and the caption are all decided by the very\n' +
    '   functions that drew this card at build time, shipped here rather than restated. A\n' +
    '   settings change re-runs them; it does not run a second implementation of them. */\n' +
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
    '     stays a translator rather than a second place where histogram decisions live. */\n' +
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
    '  /* A repaint, not an append: the desk swaps <main> and replays every builder, and a render\n' +
    '     that added marks would draw a second histogram over the first on every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = hgRender(P, cfg), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so\n' +
    '       it may be assigned rather than parsed out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardJs(src, 'cardkit/histogram');
}

/**
 * Build one histogram card from one data block.
 *
 * Every statistic is computed here, once, from the COMPLETE sample: the pooled minimum, maximum,
 * interquartile range and standard deviation that the bin rules consume are exact even when the
 * observations shipped to the browser have been thinned. That separation is the point — the
 * numbers are exact, the picture is a faithful thinning of them, and the caption says which is
 * which.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data            an empty frame, captioned "no data"; nothing is estimated
 *   one observation    Sturges is forced (n under 10) and gives 1 bin holding it
 *   identical values   zero spread: every rule wants a zero-width bin, so one nominal bin of
 *                      half the magnitude either side holds the whole sample, and the caption
 *                      says there is no shape to read
 *   an extreme outlier the range stretches, the FD width does not, and the resulting bin count
 *                      is capped at 120 with a note rather than drawn as 4000 empty columns
 *   20 groups          shared bin edges, one step outline each, colours cycling every 8
 *   n = 10,000         thinned to every 3rd value of the sorted sample and the counts scaled
 *                      back up by 3, because the pooled sample passes the 4,000 payload budget;
 *                      the caption names the stride. Under 4,000 nothing is thinned at all
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
 *                 counted while reading rather than propagated
 *
 * @example
 * build({
 *   id: 'latency',
 *   title: 'request latency, one day',
 *   data: { xLabel: 'latency', unit: 'ms',
 *           groups: [{ name: 'p50 sample', values: [12, 14, 19, 22, 31, 44, 51] }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'histogram' : id);
  const read = readData(data);

  /* The pool is every kept value from every group. Bin edges must be shared or the groups cannot
     be compared, and the rules need spread statistics of the thing being binned. */
  const pooled = sortAsc(read.groups.reduce((a, g) => a.concat(g.values), []));
  const pool = {
    n: pooled.length,
    min: pooled.length ? pooled[0] : 0,
    max: pooled.length ? pooled[pooled.length - 1] : 1,
    iqr: quantile7(pooled, 0.75) - quantile7(pooled, 0.25),
    sd: sdOf(pooled),
  };

  /* A zero-width range gets half its own magnitude either side, so the single bin has a width a
     reader can see and the axis has ticks. All-zero data has no magnitude to take half of, so it
     gets a unit instead. Same move `chart` makes for a flat series, for the same reason. */
  let lo = pool.min;
  let hi = pool.max;
  if (!(hi > lo)) {
    const e = Math.abs(lo) * 0.5 || 0.5;
    lo -= e;
    hi += e;
  }

  const stride = pool.n > SHIP_MAX ? Math.ceil(pool.n / SHIP_MAX) : 1;
  let shipped = 0;
  const groups = read.groups.map((g) => {
    const sorted = sortAsc(g.values);
    const sample = stride === 1 ? sorted : thin(sorted, Math.ceil(sorted.length / stride));
    shipped += sample.length;
    return {
      name: g.name,
      n: g.values.length,
      refused: g.refused,
      sample,
      /* The factor that turns a thinned count back into an estimate of the real one. Exactly 1
         when nothing was thinned, so the common case is not an estimate at all. */
      f: sample.length ? g.values.length / sample.length : 1,
    };
  });

  const P = {
    W, H,
    nbCap: NB_CAP,
    nbHard: NB_HARD,
    tinyN: TINY_N,
    unit: read.unit,
    xLabel: read.xLabel,
    refused: read.refused,
    thinned: stride > 1,
    stride,
    shipped,
    lo,
    hi,
    pool,
    groups,
  };

  const seed = hgRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      groups: groups.length,
      values: pool.n,
      refused: read.refused,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), P, seed),
    css: cardCss(cardId, groups.length),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
