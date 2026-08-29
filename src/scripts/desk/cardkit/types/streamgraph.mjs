/**
 * `streamgraph` — a stacked area on a moving baseline, captioned with what the baseline costs.
 *
 * A streamgraph is the one form on this desk that is deliberately unreadable in one dimension.
 * Byron and Wattenberg's wiggle baseline exists to make each individual band's SHAPE legible by
 * letting the whole stack slide up and down; the price is that no band rests on a fixed axis, so
 * a reader cannot recover an absolute value from any of them. That trade is the entire point of
 * the form and it is invisible in the picture, so the caption states it every time, naming the
 * baseline actually in force. A streamgraph that does not say which baseline it is drawn on is a
 * chart that misleads by default.
 *
 * Everything geometric is computed from the shipped values by {@link sgRender}, which is the same
 * function in Node and in the browser: Node runs it once to draw the picture that ships inside
 * `card.html`, and the browser re-runs it when a setting changes. There is no second
 * implementation to drift, and `Function.prototype.toString()` guarantees the thing tested is
 * textually the thing that runs.
 *
 * `CK` is loaded out of `kit.js` in a `node:vm` context, so `CK.scale`, `CK.ticks` and `CK.hue`
 * here are the same functions the page has.
 *
 * @see ./stackedarea.mjs — the zero-baseline sibling, which can be read against an axis
 * @see ./horizon.mjs     — the other dense many-series time display, folded rather than stacked
 */

import { readFileSync }    from 'node:fs';
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
 * @example loadKit().ticks(0, 97, 5);   // [0, 20, 40, 60, 80, 100]
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/streamgraph: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/streamgraph: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

/* The desk column is comfortable at 640; a wider plot scrolls inside `.ck-scroll` rather than
   widening the page, and stops growing at WMAX so a 5,000-point series does not become a mile
   of canvas. */
const W0   = 640;
const H0   = 300;
const WMAX = 2200;

/* How many x positions may be drawn, and how many series-by-x cells may be shipped. Both are
   caps on the PAYLOAD, not on the arithmetic: every summary in the caption is computed from the
   complete data before any thinning happens. */
const XCAP   = 720;
const BUDGET = 24000;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 *
 * The defaults are the paper's streamgraph: weighted-wiggle baseline, inside-out order, smooth
 * curve. A zero baseline with a given order is a different chart and this catalogue already has
 * it, under `stackedarea`.
 */
export const defaults = {
  baseline: 'wiggle',
  order:    'inside-out',
  curve:    'smooth',
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'streamgraph',
  summary: 'A stacked area on a wiggle baseline, captioned with the absolute values it hides.',
  shape: '{ series: [{ name, points: [{ x, y }] }], xLabel, yLabel, unit } — x numeric or a date string, y a non-negative number',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one card
 * in this catalogue was refused because a comment said "the class is what CSS reads" — and a
 * guard that cries wolf is a guard somebody switches off. Offsets are preserved so a reported
 * position still points at the right place. Regex literals are recognised, because otherwise the
 * scanner desynchronises on the quote inside `replace(/'/g, x)` and starts blanking real code,
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
 * Refuse to emit browser script that would break the whole desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in
 * a comment as readily as in code, because `Function.prototype.toString()` ships comments
 * verbatim — closes the surrounding template literal early and blanks every card on the desk,
 * not only this one. The backtick is never written here; it is reached for as
 * `String.fromCharCode(96)`, which cannot be mistyped and cannot be mis-decoded during emission.
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
 * @example guardEmitted('var a = 1;');                    // returns it
 * @example guardEmitted('var f = function () {};');       // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/streamgraph';
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

  /* Compared numerically rather than matched against a character class. Writing the class is how
     the class gets corrupted: an escape can be decoded one step early during emission, leaving a
     plausible-looking regex holding the raw byte it meant to describe. */
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

/* ── reading and aligning the data ───────────────────────────────────────────────────── */

/**
 * One x value as a number, plus whether it came from a date.
 *
 * A date string is accepted because a time series is usually written that way, and it is turned
 * into epoch milliseconds so the axis is a real number line rather than a row of strings. A
 * string that does not parse is refused rather than coerced: `Number('')` is 0 and `new
 * Date('soon')` is not a time, and either one invents a reading at a position nobody supplied.
 *
 * @param x a number, a Date, or a date string
 * @returns `{ v, date }`, or null when the value is not a position on a time or number line
 *
 * @example readX('2024-03-01').date;   // true
 * @example readX('soon');              // null
 */
function readX(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? { v: x, date: false } : null;
  if (x instanceof Date) return Number.isFinite(x.getTime()) ? { v: x.getTime(), date: true } : null;
  if (typeof x === 'string') {
    const t = Date.parse(x);
    return Number.isFinite(t) ? { v: t, date: true } : null;
  }
  return null;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting every
 * refusal so the caption can name it.
 *
 * A y value is kept only when it is a `number` and finite. That is stricter than `Number(y)` on
 * purpose: `Number('')`, `Number([])` and `Number(false)` are all 0, so a coercing reader plants
 * a band of thickness zero where a measurement was actually missing, and on a stacked chart an
 * invented zero is indistinguishable from a real one.
 *
 * DUPLICATE x WITHIN ONE SERIES: the last occurrence wins, and the overwrite is counted. A series
 * is normally appended to over time, so a second record at the same x is a correction rather than
 * a second reading; summing them would silently double a value, and keeping the first would
 * discard the correction. Whichever rule is chosen it must be stated, so it is counted and named.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ series, isTime, xLabel, yLabel, unit, refused, dupes, negSeries, kept }`
 *
 * @example readData({ series: [{ name: 'a', points: [{ x: 1, y: 2 }, { x: 1, y: 3 }] }] }).dupes;  // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.series) ? d.series : [];

  let refused = 0;
  let dupes = 0;
  let kept = 0;
  let dated = 0;
  let plain = 0;

  const series = raw.map((s, i) => {
    const src = s && Array.isArray(s.points) ? s.points : [];
    const at = new Map();
    let bad = 0;
    let dup = 0;
    let neg = 0;

    for (const p of src) {
      if (!p || typeof p !== 'object') { bad++; continue; }
      const rx = readX(p.x);
      const y = p.y;
      if (!rx || typeof y !== 'number' || !Number.isFinite(y)) { bad++; continue; }
      if (rx.date) dated++; else plain++;
      if (y < 0) neg++;
      if (at.has(rx.v)) dup++;
      at.set(rx.v, y);
    }

    refused += bad;
    dupes += dup;
    kept += at.size;

    const pts = [...at.entries()].map(([x, y]) => ({ x, y }));
    pts.sort((a, b) => a.x - b.x);
    return { name: String(s && s.name != null ? s.name : 'series ' + (i + 1)), pts, neg };
  });

  return {
    series,
    /* One non-date x anywhere makes the whole axis a plain number line: mixing epoch
       milliseconds and a count on one axis has no honest reading, so the weaker one wins. */
    isTime: dated > 0 && plain === 0,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    yLabel: d.yLabel == null ? '' : String(d.yLabel),
    unit:   d.unit   == null ? '' : String(d.unit),
    refused, dupes, kept,
  };
}

/**
 * The union of every series' x positions, sorted, thinned to the payload budget.
 *
 * Thinning is by STRIDE over the sorted union, always keeping the first and last position. Every
 * drawn x is therefore a real x carrying real values, which is what lets the numeric claim "a
 * band's thickness equals its value at that x" stay true after thinning. Averaging into buckets
 * would keep the extremes and break that claim; stride keeps the claim and loses the extremes
 * between drawn positions, and the caption says so.
 *
 * @param series the normalised series
 * @param rows   how many series will be drawn, which is what the cell budget is spent on
 * @returns `{ xs, from }` — the drawn positions and the count before thinning
 *
 * @example alignX([{ pts: [{ x: 1 }, { x: 3 }] }, { pts: [{ x: 2 }] }], 2).xs;   // [1, 2, 3]
 */
function alignX(series, rows) {
  const seen = new Set();
  for (const s of series) for (const p of s.pts) seen.add(p.x);
  const all = [...seen].sort((a, b) => a - b);

  const cap = Math.max(2, Math.min(XCAP, rows > 0 ? Math.floor(BUDGET / rows) : XCAP));
  if (all.length <= cap) return { xs: all, from: all.length };

  const step = Math.ceil(all.length / cap);
  const xs = [];
  for (let i = 0; i < all.length; i += step) xs.push(all[i]);
  if (xs[xs.length - 1] !== all[all.length - 1]) xs.push(all[all.length - 1]);
  return { xs, from: all.length };
}

/**
 * One series' values on the shared x grid, with a stated rule for every position it never met.
 *
 * The rule, which the caption repeats because it is not visible in the picture:
 *
 *   - a position the series actually measured takes that measurement;
 *   - a position INSIDE the series' own first-to-last span is linearly interpolated between its
 *     bracketing measurements, and counted;
 *   - a position OUTSIDE that span is zero.
 *
 * Interpolation rather than carry-forward, because carry-forward invents a plateau and gives the
 * last reading before a gap the weight of every position in it — on a stacked chart that plateau
 * pushes every band above it, so a gap in one series would be read as a change in another.
 * Interpolation is the smallest assumption that keeps the bands above a gap honest.
 *
 * Zero rather than a gap outside the span, because a stack has no total at a position where a
 * member has no value, and because "this series had not started yet" is what a leading absence
 * means in the data streamgraphs are made of. It is also what makes inside-out ordering mean
 * anything: onset is the first position at which a band is not zero.
 *
 * @param pts the series' own measurements, ascending by x and unique
 * @param xs  the shared grid
 * @returns `{ v, interp }` — the values, and how many of them were interpolated
 *
 * @example onGrid([{ x: 0, y: 0 }, { x: 2, y: 4 }], [0, 1, 2, 3]);   // { v: [0, 2, 4, 0], interp: 1 }
 */
function onGrid(pts, xs) {
  const v = new Array(xs.length).fill(0);
  let interp = 0;
  if (!pts.length) return { v, interp };

  const lo = pts[0].x;
  const hi = pts[pts.length - 1].x;
  let k = 0;

  for (let j = 0; j < xs.length; j++) {
    const x = xs[j];
    if (x < lo || x > hi) { v[j] = 0; continue; }
    while (k + 1 < pts.length && pts[k + 1].x < x) k++;
    if (pts[k].x === x) { v[j] = pts[k].y; continue; }
    const a = pts[k];
    const b = pts[k + 1] !== undefined ? pts[k + 1] : a;
    if (b.x === x) { v[j] = b.y; continue; }
    const span = b.x - a.x;
    v[j] = span === 0 ? a.y : a.y + (x - a.x) * (b.y - a.y) / span;
    interp++;
  }
  return { v, interp };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────── */
/* Everything from here to the SHIPPED list is written in the browser's vocabulary — `var` and
   `function`, no arrows, no template literals, no backtick in any comment — because it is emitted
   verbatim through `Function.prototype.toString()` and also run here to draw the picture that
   ships inside card.html. One source, two runtimes, nothing to drift. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole `d` attribute and the card
 * renders empty with nothing in the console. Failing here turns that into a stack trace next to
 * the input that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (!isFinite(v)) { throw new Error('streamgraph: non-finite coordinate (' + v + ')'); }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face; measured, not guessed. */
function tw(s) { return String(s).length * 5.42; }

/** Two digits, so a month or a day sorts and aligns like the rest of the label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A compact label for one x position, in the units the axis is actually in.
 *
 * UTC getters throughout. A date written as a plain day parses to UTC midnight, so reading it
 * back in the viewer's zone can print the day before — a chart whose axis disagrees with the
 * strings it was given is worse than one with a coarse axis.
 *
 * @param x    the position, epoch milliseconds when isTime
 * @param span the axis width in the same units, which decides how much of the date to show
 *
 * @example fmtX(1709251200000, 86400000 * 400, true);   // '2024-03'
 */
function fmtX(x, span, isTime) {
  if (!isTime) { return CK.fmt(x); }
  var d = new Date(x);
  var DAY = 86400000;
  if (span > DAY * 1100) { return String(d.getUTCFullYear()); }
  if (span > DAY * 70) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  if (span > DAY * 2) { return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

/**
 * Ticks that reach the ends of the value axis instead of stopping short of them.
 *
 * `CK.ticks` only returns ticks strictly inside the domain it is handed, which leaves a ragged
 * strip above the last gridline. Snapping the domain out to the step the ticks already chose
 * closes it; the ticks are stepped out rather than re-derived, because asking again with the
 * wider range can push it to the next nice step and halve the gridline count.
 *
 * @example axisTicks(3, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
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

/** A display-list line. Every mark is a tag, attributes, optional text and an optional tooltip. */
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

/** A display-list path; the caller owns the shape, because only the caller knows it. */
function mPath(d, attrs) {
  var a = { d: d }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'path', a: a };
}

/**
 * Expand a point list so a step curve is just a polyline through more points.
 *
 * Step-after: the value holds from one reading until the next. That is a CLAIM about the data —
 * that nothing happened in between — which is true of a counter and false of a sample, so the
 * settings panel says as much beside the control.
 *
 * @example stepExpand([{ x: 0, y: 1 }, { x: 1, y: 5 }]).length;   // 3
 */
function stepExpand(p) {
  var out = [], i;
  if (!p.length) { return out; }
  out.push(p[0]);
  for (i = 1; i < p.length; i++) {
    out.push({ x: p[i].x, y: p[i - 1].y });
    out.push(p[i]);
  }
  return out;
}

/**
 * Monotone cubic segments through ascending points, by Fritsch and Carlson's method.
 *
 * A Catmull-Rom or natural spline OVERSHOOTS: between two readings it can leave the interval
 * their values span. On a stacked chart that is not a cosmetic difference — an overshoot on the
 * upper edge of a band draws a thickness the data does not have, and on a streamgraph it can push
 * one band through the one below it, which reads as a value going negative. The Fritsch-Carlson
 * limiter clamps the end slopes of every segment into the circle of radius 3, which is exactly
 * the condition under which a cubic Hermite cannot leave its interval.
 *
 * @param p points ascending in x, at least two, with no repeated x
 * @returns one cubic segment per interval, as absolute control points and an end point
 *
 * @example monoSegs([{ x: 0, y: 0 }, { x: 1, y: 1 }]).length;   // 1
 */
function monoSegs(p) {
  var n = p.length, i, segs = [], dx = [], dy = [], del = [], m = [];
  if (n < 2) { return segs; }
  for (i = 0; i < n - 1; i++) {
    dx.push(p[i + 1].x - p[i].x);
    dy.push(p[i + 1].y - p[i].y);
    del.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
  }
  m.push(del[0]);
  for (i = 1; i < n - 1; i++) { m.push((del[i - 1] + del[i]) / 2); }
  m.push(del[n - 2]);
  for (i = 0; i < n - 1; i++) {
    if (del[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    var a = m[i] / del[i], b = m[i + 1] / del[i], s = a * a + b * b;
    if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * del[i]; m[i + 1] = t * b * del[i]; }
  }
  for (i = 0; i < n - 1; i++) {
    var h = dx[i] / 3;
    segs.push({
      c1x: p[i].x + h,     c1y: p[i].y + m[i] * h,
      c2x: p[i + 1].x - h, c2y: p[i + 1].y - m[i + 1] * h,
      x:   p[i + 1].x,     y:   p[i + 1].y,
    });
  }
  return segs;
}

/**
 * One edge of an area, as path commands, walked forward or backward.
 *
 * Backward matters: an area is its top edge forward and its bottom edge in reverse, and a
 * reversed cubic is the same curve with its control points swapped — so the closing edge of a
 * smooth band is exactly the curve the next band's opening edge will be drawn on. Generating the
 * reverse pass by re-fitting a spline to reversed points would give a subtly different curve, and
 * the seam between two bands would show it.
 *
 * @param pts     the edge's points, ascending in x
 * @param curve   'linear', 'step' or 'smooth'
 * @param forward true to open the subpath with M, false to continue an open one with L
 *
 * @example edgeCmds([{ x: 0, y: 0 }, { x: 1, y: 1 }], 'linear', true);   // 'M0 0 L1 1'
 */
function edgeCmds(pts, curve, forward) {
  var p = curve === 'step' ? stepExpand(pts) : pts, i, out = [];
  if (!p.length) { return ''; }
  if (curve !== 'smooth' || p.length < 2) {
    if (forward) {
      for (i = 0; i < p.length; i++) { out.push((i ? 'L' : 'M') + fin(p[i].x) + ' ' + fin(p[i].y)); }
    } else {
      for (i = p.length - 1; i >= 0; i--) { out.push('L' + fin(p[i].x) + ' ' + fin(p[i].y)); }
    }
    return out.join(' ');
  }
  var segs = monoSegs(p);
  if (forward) {
    out.push('M' + fin(p[0].x) + ' ' + fin(p[0].y));
    for (i = 0; i < segs.length; i++) {
      out.push('C' + fin(segs[i].c1x) + ' ' + fin(segs[i].c1y) + ' ' +
                     fin(segs[i].c2x) + ' ' + fin(segs[i].c2y) + ' ' +
                     fin(segs[i].x) + ' ' + fin(segs[i].y));
    }
    return out.join(' ');
  }
  out.push('L' + fin(p[p.length - 1].x) + ' ' + fin(p[p.length - 1].y));
  for (i = segs.length - 1; i >= 0; i--) {
    out.push('C' + fin(segs[i].c2x) + ' ' + fin(segs[i].c2y) + ' ' +
                   fin(segs[i].c1x) + ' ' + fin(segs[i].c1y) + ' ' +
                   fin(p[i].x) + ' ' + fin(p[i].y));
  }
  return out.join(' ');
}

/**
 * Settle the settings, and record where one of them overrode another.
 *
 * `inside-out` is not a third baseline. In the literature it is an ORDERING, and the paper's
 * streamgraph figure is the weighted-wiggle baseline drawn with it; it is offered here as a
 * baseline choice because that pairing is what people mean when they ask for one. Choosing it
 * therefore sets the order too, and the card says so rather than quietly ignoring the order
 * control the reader just looked at.
 *
 * @example sgConfig({ baseline: 'inside-out', order: 'given' }).order;   // 'inside-out'
 */
function sgConfig(cfg) {
  var c = cfg || {};
  var base = c.baseline === 'zero' || c.baseline === 'wiggle' || c.baseline === 'inside-out'
    ? c.baseline : 'wiggle';
  var order = c.order === 'given' || c.order === 'inside-out' || c.order === 'descending'
    ? c.order : 'inside-out';
  var curve = c.curve === 'linear' || c.curve === 'step' || c.curve === 'smooth'
    ? c.curve : 'smooth';
  var preset = base === 'inside-out';
  return {
    baseline: preset ? 'wiggle' : base,
    chose: base,
    order: preset ? 'inside-out' : order,
    overrode: preset && order !== 'inside-out' ? order : '',
    curve: curve,
  };
}

/**
 * The stacking order, as a list of indices into the rows.
 *
 * `inside-out` is Byron and Wattenberg's: sort by ONSET — the first position at which a series is
 * not zero — then deal the sorted list alternately onto two piles, always onto whichever pile has
 * the smaller running total, and read the bottom pile back outward. The effect is that the
 * earliest and largest bands sit in the middle where the baseline moves least, and late arrivals
 * land on the outside where a new band is actually visible.
 *
 * Onset rather than the index of the peak, which is the proxy d3 uses: for a series that runs the
 * whole width and peaks late, the peak index says "arrived late" and onset says "was always
 * there", and only one of those is true. The peak index is kept as the tiebreak, and the given
 * order as the tiebreak of last resort, so the ordering is total and stable.
 *
 * @param vals one array of values per row, all on the shared grid
 * @param mode 'given', 'descending' or 'inside-out'
 * @returns row indices, bottom of the stack first
 *
 * @example sgOrder([[0, 1], [2, 2]], 'descending');   // [1, 0]
 */
function sgOrder(vals, mode) {
  var n = vals.length, i, j, idx = [];
  for (i = 0; i < n; i++) { idx.push(i); }
  if (mode === 'given' || n < 2) { return idx; }

  var sums = [], onset = [], peak = [];
  for (i = 0; i < n; i++) {
    var s = 0, on = vals[i].length, pk = 0, best = -Infinity;
    for (j = 0; j < vals[i].length; j++) {
      s += vals[i][j];
      if (on === vals[i].length && vals[i][j] !== 0) { on = j; }
      if (vals[i][j] > best) { best = vals[i][j]; pk = j; }
    }
    sums.push(s); onset.push(on); peak.push(pk);
  }

  if (mode === 'descending') {
    idx.sort(function (a, b) { return sums[b] - sums[a] || a - b; });
    return idx;
  }

  idx.sort(function (a, b) { return onset[a] - onset[b] || peak[a] - peak[b] || a - b; });
  var top = 0, bot = 0, tops = [], bots = [];
  for (i = 0; i < idx.length; i++) {
    if (top < bot) { top += sums[idx[i]]; tops.push(idx[i]); }
    else { bot += sums[idx[i]]; bots.push(idx[i]); }
  }
  bots.reverse();
  return bots.concat(tops);
}

/**
 * The baseline the whole stack rides on, one value per x.
 *
 * `zero` is the flat axis: every band's lower edge is the running total below it, and the bottom
 * band can be read against a real number line.
 *
 * `wiggle` is Byron and Wattenberg's WEIGHTED wiggle, the one their paper recommends and the one
 * d3 calls `stackOffsetWiggle`. Its derivative is
 *
 *     g0' = -(1 / sum f_i) * sum_i [ (sum_{k<i} f_k') + f_i'/2 ] * f_i
 *
 * which is the baseline slope that minimises the sum of each band's squared slope WEIGHTED by
 * that band's thickness — thick bands are the ones a reader is trying to follow, so their wiggle
 * is what should be spent the baseline's freedom on. It is integrated by accumulating one step at
 * a time, starting at zero, so the leftmost column is the anchor.
 *
 * The unweighted variant would minimise total wiggle regardless of thickness and would spend the
 * baseline's freedom smoothing a hairline nobody can see; the symmetric ThemeRiver baseline
 * (-sum/2) centres the stack and does not minimise anything.
 *
 * A column whose total is zero contributes no step: there is nothing to weight and the division
 * would be by zero.
 *
 * @param vals  values per row, in stacking order, all on the shared grid
 * @param mode  'zero' or 'wiggle'
 * @returns the lower edge of the bottom band at each x
 *
 * @example sgBaseline([[1, 1]], 'zero');   // [0, 0]
 */
function sgBaseline(vals, mode) {
  var nx = vals.length ? vals[0].length : 0, n = vals.length, g = [], j, i, k;
  if (mode !== 'wiggle') {
    for (j = 0; j < nx; j++) { g.push(0); }
    return g;
  }
  if (!nx) { return g; }
  var y = 0;
  g.push(0);
  for (j = 1; j < nx; j++) {
    var s1 = 0, s2 = 0;
    for (i = 0; i < n; i++) {
      var vi = vals[i][j], s3 = (vi - vals[i][j - 1]) / 2;
      for (k = 0; k < i; k++) { s3 += vals[k][j] - vals[k][j - 1]; }
      s1 += vi;
      s2 += s3 * vi;
    }
    if (s1) { y -= s2 / s1; }
    g.push(y);
  }
  return g;
}

/**
 * The whole picture, as a display list, from the shipped values and the settled settings.
 *
 * Called in Node to draw the copy that ships inside card.html, and in the browser on every
 * settings change. Nothing about the data is recomputed differently in the two places, so the
 * caption cannot come to disagree with the picture.
 *
 * @param P   the shipped payload: grid, rows, labels, refusal counts
 * @param cfg the settings, unsettled; {@link sgConfig} settles them
 * @returns `{ W, H, marks, note }`
 *
 * @example sgRender(payload, { baseline: 'zero' }).note.aria;
 */
function sgRender(P, cfg) {
  var conf = sgConfig(cfg);
  var xs = P.xs, nx = xs.length, rows = P.rows, n = rows.length, i, j;

  var vals = [], names = [];
  for (i = 0; i < n; i++) { vals.push(rows[i].v); names.push(rows[i].name); }

  var ord = sgOrder(vals, conf.order);
  var ovals = [], onames = [], ocolour = [];
  for (i = 0; i < ord.length; i++) {
    ovals.push(vals[ord[i]]); onames.push(names[ord[i]]); ocolour.push(CK.hue(ord[i]));
  }

  var g0 = sgBaseline(ovals, conf.baseline);

  /* Lower and upper edge of every band, in value units, by accumulating away from the baseline.
     The band's thickness is its own value by construction: upper is lower plus the value, and the
     next band starts where this one ended. */
  var lower = [], upper = [], totals = [];
  for (j = 0; j < nx; j++) { totals.push(0); }
  for (i = 0; i < ovals.length; i++) { lower.push([]); upper.push([]); }
  for (j = 0; j < nx; j++) {
    var acc = g0[j];
    for (i = 0; i < ovals.length; i++) {
      lower[i].push(acc);
      acc = acc + ovals[i][j];
      upper[i].push(acc);
      totals[j] += ovals[i][j];
    }
  }

  var vlo = 0, vhi = 0, maxTotal = 0;
  if (nx) {
    vlo = Infinity; vhi = -Infinity;
    for (j = 0; j < nx; j++) {
      var bot = g0[j], top = g0[j] + totals[j];
      if (bot < vlo) { vlo = bot; }
      if (top > vhi) { vhi = top; }
      if (totals[j] > maxTotal) { maxTotal = totals[j]; }
    }
    if (!(vhi > vlo)) { var e = Math.abs(vhi) * 0.5 || 1; vlo = vlo - e; vhi = vhi + e; }
  } else { vlo = 0; vhi = 1; }

  var zeroBase = conf.baseline === 'zero';
  var snapped = zeroBase ? axisTicks(Math.min(0, vlo), vhi, 5) : { lo: vlo, hi: vhi, ticks: [] };
  var lo = zeroBase ? snapped.lo : vlo;
  var hi = zeroBase ? snapped.hi : vhi;

  /* A wiggle baseline earns no value axis: no band sits on a fixed line, so tick numbers down the
     side would be numbers a reader cannot use, and printing them would be the lie the caption
     spends its first sentence denying. A thickness key goes there instead. */
  var leftTexts = [], t;
  if (zeroBase) { for (i = 0; i < snapped.ticks.length; i++) { leftTexts.push(CK.fmt(snapped.ticks[i])); } }
  var leftW = 0;
  for (i = 0; i < leftTexts.length; i++) { leftW = Math.max(leftW, tw(leftTexts[i])); }

  var padT = 14;
  var padR = zeroBase ? 14 : 58;
  var padB = 24 + (P.xLabel ? 12 : 0);
  var padL = Math.round(Math.min(120, leftW)) + 12 + (P.yLabel && zeroBase ? 12 : 0);

  var W = Math.min(P.WMAX, Math.max(P.W0, padL + padR + nx * 1.6));
  var H = P.H0;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  var xlo = nx ? xs[0] : 0, xhi = nx ? xs[nx - 1] : 1;
  var xScale = CK.scale([xlo, xhi], [plot.x0, plot.x1]);
  var vScale = CK.scale([lo, hi], [plot.y1, plot.y0]);

  var marks = [];

  /* Furniture first, so the bands sit on top of it. */
  for (i = 0; i < snapped.ticks.length; i++) {
    t = snapped.ticks[i];
    var ty = vScale(t);
    marks.push(mLine(plot.x0, ty, plot.x1, ty, 'ck-rule'));
    marks.push(mText(plot.x0 - 6, ty + 3.2, CK.fmt(t), 'ck-tk', 'end'));
  }
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));
  if (zeroBase) { marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis')); }

  if (nx) {
    var want = Math.max(2, Math.min(7, Math.floor((plot.x1 - plot.x0) / 74)));
    var span = xhi - xlo;
    for (i = 0; i <= want; i++) {
      var at = nx === 1 ? 0 : Math.round(i * (nx - 1) / want);
      var px = xScale(xs[at]);
      marks.push(mLine(px, plot.y0, px, plot.y1, 'ck-rule'));
      marks.push(mText(px, plot.y1 + 13, fmtX(xs[at], span, P.isTime), 'ck-tk',
                       i === 0 ? 'start' : i === want ? 'end' : 'middle'));
      if (nx === 1) { break; }
    }
  }

  if (P.xLabel) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, P.xLabel, 'ck-cap-ax', 'middle')); }
  if (P.yLabel && zeroBase) {
    var cy = (plot.y0 + plot.y1) / 2;
    marks.push(mText(10, cy, P.yLabel, 'ck-cap-ax', 'middle',
                     { transform: 'rotate(-90 ' + fin(10) + ' ' + fin(cy) + ')' }));
  }

  /* The bands. One group per series so the tooltip and the hover lift have somewhere to hang. */
  for (i = 0; i < ovals.length; i++) {
    var topPts = [], botPts = [], any = false;
    for (j = 0; j < nx; j++) {
      topPts.push({ x: xScale(xs[j]), y: vScale(upper[i][j]) });
      botPts.push({ x: xScale(xs[j]), y: vScale(lower[i][j]) });
      if (ovals[i][j] !== 0) { any = true; }
    }
    if (nx < 2) {
      /* One column has no area. A tick of the band's thickness is drawn instead, so a
         one-reading streamgraph is a visible thing rather than an empty frame. */
      if (nx === 1) {
        marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: [
          mLine(topPts[0].x, topPts[0].y, botPts[0].x, botPts[0].y, 'ck-stub'),
        ] });
      }
      continue;
    }
    var d = edgeCmds(topPts, conf.curve, true) + ' ' + edgeCmds(botPts, conf.curve, false) + ' Z';
    var band = mPath(d, { fill: ocolour[i], 'fill-opacity': any ? '0.82' : '0.25', stroke: 'none' });
    band.ti = onames[i] + ' \u00b7 peak ' + CK.fmt(rowPeak(ovals[i])) +
              (P.unit ? ' ' + P.unit : '') + ' \u00b7 total ' + CK.fmt(rowSum(ovals[i]));
    marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: [band] });
  }

  /* The thickness key: the only quantity a wiggle baseline lets a reader recover. */
  if (!zeroBase && nx) {
    var step = maxTotal > 0 ? CK.ticks(0, maxTotal, 4) : [0, 1];
    var u = step.length > 1 ? step[1] - step[0] : (maxTotal || 1);
    var ky = plot.y0 + 18;
    var kx = plot.x1 + 12;
    var kh = Math.abs(vScale(0) - vScale(u));
    marks.push(mLine(kx, ky, kx, ky + kh, 'ck-key-bar'));
    marks.push(mLine(kx - 3, ky, kx + 3, ky, 'ck-key-bar'));
    marks.push(mLine(kx - 3, ky + kh, kx + 3, ky + kh, 'ck-key-bar'));
    marks.push(mText(kx + 6, ky + kh / 2 + 3.2, CK.fmt(u), 'ck-tk', 'start'));
    marks.push(mText(kx + 6, ky + kh / 2 + 13, P.unit || 'thick', 'ck-tk', 'start'));
  }

  if (!nx) { marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle')); }

  return { W: W, H: H, marks: marks, note: sgNote(P, conf, onames, ovals, totals, maxTotal, xlo, xhi) };
}

/** The largest value in one row, or 0 for an empty one. */
function rowPeak(v) {
  var best = 0, i;
  for (i = 0; i < v.length; i++) { if (v[i] > best) { best = v[i]; } }
  return best;
}

/** The sum of one row. */
function rowSum(v) {
  var s = 0, i;
  for (i = 0; i < v.length; i++) { s += v[i]; }
  return s;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The first clause is always the baseline and what it costs, because that is the fact the picture
 * cannot carry and the one a reader will otherwise assume wrongly. Under a wiggle baseline the
 * chart has no value axis at all, and saying "values run from A to B" would be quoting a range
 * nobody can measure against — so it quotes the largest TOTAL and the thickness key instead,
 * which are the two quantities that survive a moving baseline.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function sgNote(P, conf, onames, ovals, totals, maxTotal, xlo, xhi) {
  var n = onames.length, nx = P.xs.length, unit = P.unit ? ' ' + P.unit : '';
  var span = nx ? fmtX(xlo, xhi - xlo, P.isTime) + ' to ' + fmtX(xhi, xhi - xlo, P.isTime) : '';
  var wiggle = conf.baseline === 'wiggle';

  if (!n || !nx) {
    return {
      aria: 'Streamgraph with no data: nothing is stacked.',
      caption: 'a streamgraph with <b>no data</b> &mdash; the frame is drawn so the card keeps ' +
               'its place, but there is nothing in it.',
    };
  }

  var orderWord = conf.order === 'inside-out' ? 'inside-out, by onset'
                : conf.order === 'descending' ? 'largest total at the bottom'
                : 'as supplied';

  var costA = wiggle
    ? 'The baseline moves, so no band rests on a fixed axis and absolute values cannot be read ' +
      'off this chart at all. Only thickness is meaningful, and the key at the right says how ' +
      'much one unit of thickness is.'
    : 'The baseline is flat at zero, so the bottom band can be read against the axis; every band ' +
      'above it can only be read by its thickness, because its lower edge is the sum of the ones ' +
      'below.';

  var aria =
    'Streamgraph of ' + n + ' series on a ' + (wiggle ? 'weighted-wiggle' : 'zero') + ' baseline, ' +
    'stacked ' + orderWord + ', across ' + span + '. ' + costA + ' The largest column total is ' +
    CK.fmt(maxTotal) + unit + '. Series, bottom to top: ' + onames.join(', ') + '.';

  var bits = [];
  if (P.negSeries.length) {
    bits.push('<b>' + P.negSeries.length + '</b> series held a negative value and ' +
              (P.negSeries.length === 1 ? 'was' : 'were') + ' refused (' +
              CK.esc(P.negSeries.join(', ')) + ') &mdash; a stacked band cannot have negative ' +
              'thickness, and clamping one to zero would draw a measurement that was never taken.');
  }
  if (P.refused) { bits.push('<b>' + P.refused + '</b> point' + (P.refused === 1 ? '' : 's') + ' had no usable x or y and ' + (P.refused === 1 ? 'was' : 'were') + ' dropped.'); }
  if (P.dupes) { bits.push('<b>' + P.dupes + '</b> duplicate x within a series; the last value at each x wins.'); }
  if (P.interp) { bits.push('<b>' + P.interp + '</b> value' + (P.interp === 1 ? '' : 's') + ' interpolated between a series own readings; outside a series own span it counts as zero.'); }
  if (P.thinnedFrom > nx) { bits.push('drawn at <b>' + nx + '</b> of <b>' + P.thinnedFrom + '</b> x positions, every ' + Math.ceil(P.thinnedFrom / nx) + 'th; the drawn values are exact and the extremes between them are not shown.'); }
  if (conf.overrode) { bits.push('the inside-out preset is the paper recipe &mdash; wiggle baseline <i>and</i> inside-out order &mdash; so it overrode the <i>' + CK.esc(conf.overrode) + '</i> order you picked.'); }

  var caption =
    'streamgraph on a <b>' + (wiggle ? 'weighted-wiggle' : 'zero') + '</b> baseline, ' +
    '<b>' + n + '</b> band' + (n === 1 ? '' : 's') + ' stacked <i>' + CK.esc(orderWord) + '</i> ' +
    'across ' + CK.esc(span) + '. ' +
    '<i>' + costA + '</i> ' +
    'largest column total <b>' + CK.esc(CK.fmt(maxTotal) + unit) + '</b>. ' +
    bits.join(' ');

  return { aria: aria, caption: caption };
}

/* The browser gets exactly these, in this order, as text. Order matters only in that a function
   must be defined before it is called, and they are all hoisted declarations, so it does not. */
const SHIPPED = [fin, tw, pad2, fmtX, axisTicks, mLine, mText, mPath,
                 stepExpand, monoSegs, edgeCmds, sgConfig, sgOrder, sgBaseline,
                 rowPeak, rowSum, sgNote, sgRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so a series name containing `</script>` cannot close the block early
 * — which has the useful side effect that no name can ever put an arrow into a file that is
 * contractually free of them. The two line separators go too: they are newlines to a JS parser
 * and not to `JSON.stringify`.
 *
 * @example jsLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
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
  const own = '.ck-streamgraph[data-card="' + id + '"]';
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
 * Nothing here names a colour: every value is a desk token, so the light switch is the only thing
 * that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent — the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 */
function cardCss(id, wide, W, multi) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-key-bar', 'stroke: var(--ink-faint); stroke-width: 1;'],
    ['.ck-plot .ck-stub', 'stroke: var(--accent); stroke-width: 3;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  /* The legend swatch takes its colour from a data attribute rather than an inline style: the
     desk's CSP is about scripts today and the same argument applies to style attributes, and a
     rule here is one place to change rather than one per swatch. */
  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);

  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  if (!multi) return scope(id, rules) + '\n';

  /* Hover lifts a whole band rather than the mark under the pointer: on a streamgraph the useful
     question is which band, and the band is the mark, so this is the only affordance that answers
     "where does this one go" without a reader tracing it by eye. */
  rules.push(['.ck-plot .ck-ser', 'transition: opacity .12s linear;']);
  rules.push(['.ck-plot:hover .ck-ser', 'opacity: .35;']);
  rules.push(['.ck-plot .ck-ser:hover', 'opacity: 1;']);
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, wide, legend) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-streamgraph">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="streamgraph settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('baseline') + '">baseline</label>\n' +
    '    <select id="' + f('baseline') + '" name="baseline">' +
         opt('wiggle', 'weighted wiggle', defaults.baseline) +
         opt('zero', 'zero (readable axis)', defaults.baseline) +
         opt('inside-out', 'inside-out preset', defaults.baseline) + '</select>\n' +
    '    <label for="' + f('order') + '">order</label>\n' +
    '    <select id="' + f('order') + '" name="order">' +
         opt('inside-out', 'inside-out, by onset', defaults.order) +
         opt('given', 'as supplied', defaults.order) +
         opt('descending', 'largest at the bottom', defaults.order) + '</select>\n' +
    '    <label for="' + f('curve') + '">curve</label>\n' +
    '    <select id="' + f('curve') + '" name="curve">' +
         opt('smooth', 'smooth (monotone)', defaults.curve) +
         opt('linear', 'straight', defaults.curve) +
         opt('step', 'step', defaults.curve) + '</select>\n' +
    '    <p class="ck-set-foot">the wiggle baseline makes each band readable and makes absolute ' +
         'values unreadable; zero gives the bottom band a real axis and lets the top of the stack ' +
         'jump. step claims the value held constant between readings, which is true of a counter ' +
         'and false of a sample.</p>\n' +
    '  </div>\n' +
    '  ' + (wide ? '<div class="ck-scroll">' + plot + '</div>' : plot) + legend + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned.
 *
 * @param id      the card's id, used as its `CK.build` key
 * @param payload the aligned grid and values
 * @param cfg     the defaults object `CK.settings` reconciles against
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* streamgraph card: the same renderer that drew the copy in card.html, re-run when a\n' +
    '   setting changes. The baseline arithmetic is not duplicated here; it is the shipped\n' +
    '   source of the function that produced the picture. */\n' +
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
    '     stays a translator rather than a second place where streamgraph decisions live. */\n' +
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
    '     a render that added marks would stack a second set of bands on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = sgRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so\n' +
    '       it may be assigned rather than parsed back out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/streamgraph');
}

/**
 * Build one streamgraph card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame, captioned "no data"; nothing is stacked
 *   one series           one band, which is the whole stack; the wiggle baseline for a single
 *                        band is its own negative half, so it centres
 *   one point per series a single column has no area, so each band draws a short thickness tick
 *                        rather than an invisible degenerate polygon
 *   different x sets     aligned on the union of every x; interior gaps interpolated from the
 *                        series own neighbours, positions outside its span counted as zero, both
 *                        counted and named in the caption
 *   all values zero      every band has zero thickness and the baseline is flat; the caption
 *                        still names the baseline, and the domain is padded so the axis draws
 *   a negative value     the SERIES holding it is refused, counted and named. A stacked band
 *                        cannot have negative thickness; clamping to zero would draw a
 *                        measurement nobody took, and dropping the point would let the
 *                        interpolator invent a positive one in its place
 *   50 series            50 bands, colours cycling every 8; the payload budget cuts the drawn x
 *                        positions to 480 so the emitted script stays a sensible size
 *   5,000 points         thinned by stride to at most 720 drawn positions, first and last always
 *                        kept; every drawn value is exact, extremes between them are not shown
 *   a non-numeric value  refused while reading, counted, named. Not coerced: Number('') is 0
 *   duplicate x          the last value at that x wins, and the overwrite is counted
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ series: [{ name, points: [{ x, y }] }], xLabel, yLabel, unit }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is `card.json` as an object, the other three are
 *          file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused while
 *                 reading rather than propagated
 *
 * @example
 * build({
 *   id: 'genres',
 *   title: 'weekly listening by genre',
 *   data: { unit: 'hours', xLabel: 'week',
 *           series: [{ name: 'jazz',  points: [{ x: '2024-01-01', y: 3 }, { x: '2024-01-08', y: 5 }] },
 *                    { name: 'noise', points: [{ x: '2024-01-01', y: 1 }, { x: '2024-01-08', y: 8 }] }] },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'streamgraph' : id);
  const read = readData(data);

  /* Negative-bearing series are refused whole, before alignment. Refusing the POINT would leave a
     hole that the interpolator would fill with a positive number, which is a worse lie than
     dropping the series: it would show a measurement that contradicts the one taken.
     ONE partition rather than two filters, deliberately. Written as a pair of filters, the list
     the caption names and the list the picture draws are two independent statements of the same
     rule, and a change to one leaves the other saying something else — which a mutation test
     caught here: dropping the exclusion left the count still reporting a refusal that had not
     happened. Partitioning once makes that particular disagreement unsayable. */
  const negSeries = [];
  const usable = [];
  for (const s of read.series) {
    if (s.neg > 0) negSeries.push(s.name);
    else usable.push(s);
  }

  const { xs, from } = alignX(usable, usable.length);
  let interp = 0;
  const rows = usable.map((s) => {
    const g = onGrid(s.pts, xs);
    interp += g.interp;
    return { name: s.name, v: g.v };
  });

  const P = {
    xs, rows, negSeries, interp,
    isTime: read.isTime,
    xLabel: read.xLabel,
    yLabel: read.yLabel,
    unit: read.unit,
    refused: read.refused,
    dupes: read.dupes,
    thinnedFrom: from,
    W0, H0, WMAX,
  };

  const seed = sgRender(P, defaults);
  const wide = seed.W > W0;
  const legend = rows.length > 1
    ? '\n  <div class="ck-legend">' +
      rows.map((r, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(r.name) + '</span>').join('') +
      '</div>'
    : '';

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      series: rows.length,
      x: xs.length,
      refusedSeries: negSeries.length,
      refusedPoints: read.refused,
      interpolated: interp,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, wide, legend),
    css: cardCss(cardId, wide, seed.W, rows.length > 1),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
