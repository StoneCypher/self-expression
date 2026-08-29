/**
 * `stackedarea` — a stacked area on a zero baseline, with a percent mode that says what it hides.
 *
 * Percent mode is the quiet liar of data display. Normalising every column to 100 removes the
 * total from the picture entirely, so a band that is shrinking as a SHARE while growing in
 * absolute terms looks exactly like decline — and there is nothing in the drawing to tell a
 * reader which of the two they are looking at. This card answers that in two ways rather than
 * one: the caption states in words whether the total is shown, and the card draws the absolute
 * total as its own strip above the percentages so the missing dimension is on the page.
 *
 * Percent shares are built from CUMULATIVE fractions rather than by dividing each value by the
 * total, so a column sums to exactly 100 and the top band actually reaches the 100 line. Dividing
 * per band leaves a hairline of rounding under the top rule, which reads as a category the chart
 * forgot.
 *
 * Everything geometric is computed by {@link saRender}, which is the same function in Node and in
 * the browser: Node runs it once for the picture that ships inside `card.html`, the browser
 * re-runs it on a settings change. `CK` is loaded out of `kit.js` in a `node:vm` context, so
 * `CK.scale`, `CK.ticks` and `CK.hue` here are the ones the page has.
 *
 * @see ./chart.mjs       — which already stacks areas; the overlap is real and is discussed under
 *                          {@link build}
 * @see ./streamgraph.mjs — the same stack on a moving baseline, readable in shape and not in value
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
  catch (e) { throw new Error('cardkit/stackedarea: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/stackedarea: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const H0   = 300;
const WMAX = 2200;

/* Caps on the PAYLOAD, not on the arithmetic: every summary in the caption is computed from the
   complete data before any thinning happens. */
const XCAP   = 720;
const BUDGET = 24000;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `absolute` is the default because it is the mode that cannot mislead: the top of the stack is
 * the total, and every question about magnitude has an answer on the axis. Percent has to be
 * asked for.
 */
export const defaults = {
  mode:  'absolute',
  order: 'given',
  curve: 'linear',
  total: true,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'stackedarea',
  summary: 'A zero-baseline stacked area with a percent mode that keeps the total on the page.',
  shape: '{ series: [{ name, points: [{ x, y }] }], xLabel, yLabel, unit } — x numeric or a date string, y numeric',
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
 * verbatim — closes the surrounding template literal early and blanks every card on the desk.
 * The backtick is never written here; it is reached for as `String.fromCharCode(96)`, which
 * cannot be mistyped and cannot be mis-decoded during emission.
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
 * @example guardEmitted('var a = 1;');   // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/stackedarea';
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

/* ── reading and aligning the data ───────────────────────────────────────────────────── */

/**
 * One x value as a number, plus whether it came from a date.
 *
 * A string that does not parse is refused rather than coerced: `Number('')` is 0 and
 * `new Date('soon')` is not a time, and either one invents a reading at a position nobody gave.
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
 * A y value is kept only when it is a `number` and finite, which is stricter than `Number(y)` on
 * purpose: the coercions all land on 0, and on a stacked chart an invented zero is
 * indistinguishable from a measured one.
 *
 * DUPLICATE x WITHIN ONE SERIES: the last occurrence wins and the overwrite is counted. A series
 * is normally appended to over time, so a second record at one x is a correction; summing would
 * silently double a value and keeping the first would discard the correction.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ series, isTime, xLabel, yLabel, unit, refused, dupes, kept }`
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
 * Thinning is by STRIDE over the sorted union, always keeping the first and last position, so
 * every drawn x is a real x carrying real values. That is what lets the claim "a band's thickness
 * is its value at that x" survive thinning; bucket-averaging would break it. The cost is that an
 * extreme lying between two drawn positions is not shown, and the caption says so.
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
 *   - a measured position takes its measurement;
 *   - a position INSIDE the series' own first-to-last span is linearly interpolated between its
 *     bracketing measurements, and counted;
 *   - a position OUTSIDE that span counts as zero.
 *
 * Interpolation rather than carry-forward, because carry-forward invents a plateau and pushes
 * every band above the gap, so one series' missing reading would be read as another series
 * changing. Zero outside the span rather than a gap, because a stack has no total at a position
 * where a member has no value at all, and "had not started yet" is what a leading absence means.
 *
 * @returns `{ v, interp }` — the values, and how many were interpolated
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
/* Written in the browser's vocabulary from here to the SHIPPED list — var and function, no
   arrows, no template literals, no backtick in any comment — because it is emitted verbatim
   through Function.prototype.toString() and also run here to draw the copy that ships inside
   card.html. One source, two runtimes, nothing to drift. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole `d` and the card renders
 * empty with nothing in the console.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (!isFinite(v)) { throw new Error('stackedarea: non-finite coordinate (' + v + ')'); }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face; measured, not guessed. */
function tw(s) { return String(s).length * 5.42; }

/** Two digits, so a month or a day aligns with the rest of the label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A compact label for one x position, in the units the axis is actually in.
 *
 * UTC getters throughout: a date written as a plain day parses to UTC midnight, so reading it
 * back in the viewer's zone can print the day before, and an axis that disagrees with the strings
 * it was handed is worse than a coarse one.
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
 * Ticks that reach the ends of the axis instead of stopping short of them.
 *
 * `CK.ticks` only returns ticks strictly inside the domain it is handed, leaving a ragged strip
 * above the last gridline. Snapping the domain out to the step the ticks already chose closes it;
 * the ticks are stepped out rather than re-derived, because asking again with the wider range can
 * push it to the next nice step and halve the gridline count.
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

/** A display-list line. */
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
 * that nothing happened in between — true of a counter and false of a sample, so the settings
 * panel says as much beside the control.
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
 * their values span. On a stacked chart that is not cosmetic — an overshoot on a band's upper
 * edge draws a thickness the data does not have, and can push the band through the one below it,
 * which reads as a value going negative. The Fritsch-Carlson limiter clamps each segment's end
 * slopes into the circle of radius 3, which is exactly the condition under which a cubic Hermite
 * cannot leave its interval.
 *
 * @param p points ascending in x, at least two, with no repeated x
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
 * One edge of an area as path commands, walked forward or backward.
 *
 * The backward pass reverses the SEGMENTS rather than re-fitting a spline to reversed points: a
 * reversed cubic is the same curve with its control points swapped, so the closing edge of one
 * band is exactly the curve the next band opens on and the seam between them cannot show.
 *
 * @param forward true to open a subpath with M, false to continue an open one with L
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

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function saConfig(cfg) {
  var c = cfg || {};
  return {
    mode:  c.mode === 'percent' ? 'percent' : 'absolute',
    order: c.order === 'descending' || c.order === 'inside-out' ? c.order : 'given',
    curve: c.curve === 'smooth' || c.curve === 'step' ? c.curve : 'linear',
    total: c.total !== false,
  };
}

/**
 * The stacking order, as a list of indices into the rows.
 *
 * `descending` puts the largest total at the bottom, where a band has a straight lower edge and
 * is easiest to read; every band above it is read against a wobbling floor, so the order is a
 * decision about which series the chart is FOR.
 *
 * `inside-out` is Byron and Wattenberg's, by onset — the first position at which a series is not
 * zero — dealt alternately onto two piles by running total and read back outward from the bottom
 * pile. It matters less on a zero baseline than on a wiggle one, but it is the ordering that puts
 * late arrivals on the outside where they can be seen, which is still true here.
 *
 * @example saOrder([[0, 1], [2, 2]], 'descending');   // [1, 0]
 */
function saOrder(vals, mode) {
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
 * Every band's lower and upper edge in VALUE units, for one column.
 *
 * Absolute mode accumulates positives away from zero upward and negatives away from zero
 * downward, so a column holding both signs grows in both directions from the baseline rather than
 * cancelling: a category with +3 and -4 reaches from -4 to +3, not to -1. Either way the band's
 * thickness is exactly the magnitude of its value, which is the property the whole form rests on.
 *
 * Percent mode divides CUMULATIVE partial sums by the total rather than dividing each value by
 * it. The two are algebraically the same and numerically are not: dividing per band leaves the
 * shares summing to 99.999-something, so the top band stops a hairline short of the 100 rule and
 * a reader sees a category the chart forgot. Because the total here IS the last partial sum, the
 * final cumulative fraction is exactly 1 and the shares telescope to exactly 100.
 *
 * A column whose total is zero has no percentages at all — every share would be a division by
 * zero — so every band gets zero thickness there and the column is reported as undefined.
 *
 * @param col  one value per band, in stacking order
 * @param mode 'absolute' or 'percent'
 * @returns `{ lo, hi, total, undef }` — arrays of edges, the column total, and whether percent
 *          mode had nothing to divide by
 *
 * @example stackColumn([1, 3], 'percent').hi;   // [25, 100]
 */
function stackColumn(col, mode) {
  var n = col.length, i, lo = [], hi = [];

  if (mode === 'percent') {
    var pre = [], run = 0;
    for (i = 0; i < n; i++) { run += col[i]; pre.push(run); }
    if (!(run > 0)) {
      for (i = 0; i < n; i++) { lo.push(0); hi.push(0); }
      return { lo: lo, hi: hi, total: run, undef: true };
    }
    var prev = 0;
    for (i = 0; i < n; i++) {
      var cum = pre[i] / run * 100;
      lo.push(prev);
      hi.push(cum);
      prev = cum;
    }
    return { lo: lo, hi: hi, total: run, undef: false };
  }

  var up = 0, dn = 0, tot = 0;
  for (i = 0; i < n; i++) {
    var v = col[i];
    tot += v;
    if (v >= 0) { lo.push(up); hi.push(up + v); up = up + v; }
    else { hi.push(dn); lo.push(dn + v); dn = dn + v; }
  }
  return { lo: lo, hi: hi, total: tot, undef: false };
}

/**
 * The whole picture, as a display list, from the shipped values and the settled settings.
 *
 * Called in Node to draw the copy that ships inside card.html, and in the browser on every
 * settings change, so the caption cannot come to disagree with the picture.
 *
 * @param P   the shipped payload: grid, rows, labels, refusal counts
 * @param cfg the settings, unsettled; {@link saConfig} settles them
 * @returns `{ W, H, marks, note }`
 *
 * @example saRender(payload, { mode: 'percent' }).note.aria;
 */
function saRender(P, cfg) {
  var conf = saConfig(cfg);
  var xs = P.xs, nx = xs.length, i, j;

  /* Percent mode refuses a series holding a negative value, and it has to be refused HERE rather
     than at build time because the mode is a setting the reader can change. A share of a total
     that mixes signs is not a share: the total can be zero with data in it, or the wrong sign,
     and the band would be a percentage of something meaningless. */
  var keep = [], negNames = [];
  for (i = 0; i < P.rows.length; i++) {
    if (conf.mode === 'percent' && P.rows[i].neg > 0) { negNames.push(P.rows[i].name); }
    else { keep.push(i); }
  }

  var vals = [], names = [], srcIdx = [];
  for (i = 0; i < keep.length; i++) {
    vals.push(P.rows[keep[i]].v); names.push(P.rows[keep[i]].name); srcIdx.push(keep[i]);
  }

  var ord = saOrder(vals, conf.order);
  var ovals = [], onames = [], ohue = [];
  for (i = 0; i < ord.length; i++) {
    ovals.push(vals[ord[i]]); onames.push(names[ord[i]]); ohue.push(CK.hue(srcIdx[ord[i]]));
  }

  var lower = [], upper = [], totals = [], undef = 0;
  for (i = 0; i < ovals.length; i++) { lower.push([]); upper.push([]); }
  for (j = 0; j < nx; j++) {
    var col = [];
    for (i = 0; i < ovals.length; i++) { col.push(ovals[i][j]); }
    var st = stackColumn(col, conf.mode);
    for (i = 0; i < ovals.length; i++) { lower[i].push(st.lo[i]); upper[i].push(st.hi[i]); }
    totals.push(st.total);
    if (st.undef) { undef++; }
  }

  var vlo = 0, vhi = conf.mode === 'percent' ? 100 : 1;
  var tlo = 0, thi = 0;
  if (nx && ovals.length) {
    if (conf.mode === 'percent') { vlo = 0; vhi = 100; }
    else {
      vlo = 0; vhi = 0;
      for (j = 0; j < nx; j++) {
        for (i = 0; i < ovals.length; i++) {
          if (lower[i][j] < vlo) { vlo = lower[i][j]; }
          if (upper[i][j] > vhi) { vhi = upper[i][j]; }
        }
      }
      if (!(vhi > vlo)) { var e = Math.abs(vhi) * 0.5 || 1; vlo = vlo - e; vhi = vhi + e; }
    }
    tlo = totals[0]; thi = totals[0];
    for (j = 0; j < nx; j++) {
      if (totals[j] < tlo) { tlo = totals[j]; }
      if (totals[j] > thi) { thi = totals[j]; }
    }
  }

  var snapped = conf.mode === 'percent'
    ? { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100] }
    : axisTicks(vlo, vhi, 5);

  var leftW = 0;
  for (i = 0; i < snapped.ticks.length; i++) { leftW = Math.max(leftW, tw(CK.fmt(snapped.ticks[i]))); }
  if (conf.mode === 'percent') { leftW = Math.max(leftW, tw('100%')); }

  /* The absolute-total strip only exists in percent mode, where the total is the thing the
     picture has thrown away. In absolute mode the top of the stack already IS the total, so a
     separate strip would be the same line drawn twice. */
  var strip = conf.mode === 'percent' && conf.total && nx > 1 ? 46 : 0;

  var padT = 14 + strip;
  var padR = 14;
  var padB = 24 + (P.xLabel ? 12 : 0);
  var padL = Math.round(Math.min(120, leftW)) + 12 + (P.yLabel ? 12 : 0);

  var W = Math.min(P.WMAX, Math.max(P.W0, padL + padR + nx * 1.6));
  var H = P.H0 + strip;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  var xlo = nx ? xs[0] : 0, xhi = nx ? xs[nx - 1] : 1;
  var xScale = CK.scale([xlo, xhi], [plot.x0, plot.x1]);
  var vScale = CK.scale([snapped.lo, snapped.hi], [plot.y1, plot.y0]);

  var marks = [], t, ty, px;

  for (i = 0; i < snapped.ticks.length; i++) {
    t = snapped.ticks[i];
    ty = vScale(t);
    marks.push(mLine(plot.x0, ty, plot.x1, ty,
                     t === 0 && snapped.lo < 0 && snapped.hi > 0 ? 'ck-axis' : 'ck-rule'));
    marks.push(mText(plot.x0 - 6, ty + 3.2, CK.fmt(t) + (conf.mode === 'percent' ? '%' : ''), 'ck-tk', 'end'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  if (nx) {
    var want = Math.max(2, Math.min(7, Math.floor((plot.x1 - plot.x0) / 74)));
    var xspan = xhi - xlo;
    for (i = 0; i <= want; i++) {
      var at = nx === 1 ? 0 : Math.round(i * (nx - 1) / want);
      px = xScale(xs[at]);
      marks.push(mLine(px, plot.y0, px, plot.y1, 'ck-rule'));
      marks.push(mText(px, plot.y1 + 13, fmtX(xs[at], xspan, P.isTime), 'ck-tk',
                       i === 0 ? 'start' : i === want ? 'end' : 'middle'));
      if (nx === 1) { break; }
    }
  }

  if (P.xLabel) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, P.xLabel, 'ck-cap-ax', 'middle')); }
  if (P.yLabel) {
    var cy = (plot.y0 + plot.y1) / 2;
    marks.push(mText(10, cy, conf.mode === 'percent' ? P.yLabel + ' (share)' : P.yLabel, 'ck-cap-ax', 'middle',
                     { transform: 'rotate(-90 ' + fin(10) + ' ' + fin(cy) + ')' }));
  }

  for (i = 0; i < ovals.length; i++) {
    var topPts = [], botPts = [];
    for (j = 0; j < nx; j++) {
      topPts.push({ x: xScale(xs[j]), y: vScale(upper[i][j]) });
      botPts.push({ x: xScale(xs[j]), y: vScale(lower[i][j]) });
    }
    if (nx < 2) {
      if (nx === 1) {
        marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: [
          mLine(topPts[0].x, topPts[0].y, botPts[0].x, botPts[0].y, 'ck-stub'),
        ] });
      }
      continue;
    }
    var d = edgeCmds(topPts, conf.curve, true) + ' ' + edgeCmds(botPts, conf.curve, false) + ' Z';
    var band = mPath(d, { fill: ohue[i], 'fill-opacity': '0.82', stroke: 'none' });
    band.ti = onames[i] + ' \u00b7 ' + (conf.mode === 'percent'
      ? 'share of each column total'
      : 'total ' + CK.fmt(colSum(ovals[i])) + (P.unit ? ' ' + P.unit : ''));
    marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: [band] });
  }

  /* Columns with no total at all. Marked rather than silently blank: an empty column and a column
     of genuine zeroes look identical, and only one of them means the percentages do not exist. */
  if (conf.mode === 'percent' && undef && nx) {
    for (j = 0; j < nx; j++) {
      if (totals[j] > 0) { continue; }
      px = xScale(xs[j]);
      marks.push(mLine(px, plot.y1, px, plot.y1 - 5, 'ck-undef'));
    }
  }

  /* The total. In absolute mode it is a stroke along the top of the stack, which is where the
     total already is; in percent mode it is the strip above, which is the only place the total
     exists at all. */
  if (conf.total && nx > 1 && ovals.length) {
    if (conf.mode === 'percent') {
      var sy0 = 14, sy1 = padT - 10;
      var tScale = CK.scale(thi > tlo ? [tlo, thi] : [tlo - 1, thi + 1], [sy1, sy0]);
      var tp = [];
      for (j = 0; j < nx; j++) { tp.push({ x: xScale(xs[j]), y: tScale(totals[j]) }); }
      marks.push(mPath(edgeCmds(tp, conf.curve, true),
                       { fill: 'none', stroke: 'var(--accent)', 'stroke-width': '1.4' }));
      marks.push(mText(plot.x0, sy0 - 4, 'total ' + CK.fmt(tlo) + ' to ' + CK.fmt(thi) +
                       (P.unit ? ' ' + P.unit : ''), 'ck-tk', 'start'));
    } else {
      var ap = [];
      for (j = 0; j < nx; j++) { ap.push({ x: xScale(xs[j]), y: vScale(totals[j]) }); }
      marks.push(mPath(edgeCmds(ap, conf.curve, true),
                       { fill: 'none', stroke: 'var(--ink-dim)', 'stroke-width': '1.2',
                         'stroke-dasharray': '3 3' }));
    }
  }

  if (!nx || !ovals.length) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return {
    W: W, H: H, marks: marks,
    note: saNote(P, conf, onames, negNames, undef, tlo, thi, xlo, xhi),
  };
}

/** The sum of one row, which is the series total across the drawn grid. */
function colSum(v) {
  var s = 0, i;
  for (i = 0; i < v.length; i++) { s += v[i]; }
  return s;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * In percent mode the caption's job is to name the missing dimension before anything else. A band
 * that shrinks as a share while growing in absolute terms is the classic misreading, and the only
 * defence a chart has is to say so and to put the total somewhere on the page — so the caption
 * states whether the total is shown, and says what to do when it is not.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function saNote(P, conf, onames, negNames, undef, tlo, thi, xlo, xhi) {
  var n = onames.length, nx = P.xs.length, unit = P.unit ? ' ' + P.unit : '';
  var span = nx ? fmtX(xlo, xhi - xlo, P.isTime) + ' to ' + fmtX(xhi, xhi - xlo, P.isTime) : '';
  var pct = conf.mode === 'percent';
  var shown = conf.total && nx > 1 && n > 0;

  if (!n || !nx) {
    return {
      aria: 'Stacked area with no data: nothing is stacked.',
      caption: 'a stacked area with <b>no data</b> &mdash; the frame is drawn so the card keeps ' +
               'its place, but there is nothing in it.',
    };
  }

  var costA = pct
    ? (shown
        ? 'Every column is normalised to 100, so the total is not in the bands at all. It is drawn ' +
          'as the strip above, running from ' + CK.fmt(tlo) + ' to ' + CK.fmt(thi) + unit + ' - read ' +
          'the two together, because a band can shrink here while its absolute value grows.'
        : 'Every column is normalised to 100, so the total is NOT SHOWN. A band shrinking here may ' +
          'be growing in absolute terms and this chart cannot tell you which; switch the total line ' +
          'on, or read the absolute mode.')
    : 'The baseline is flat at zero and the top of the stack is the total, so magnitudes can be ' +
      'read off the axis; a band above the bottom one is still read by thickness, because its ' +
      'lower edge is the sum of everything under it.';

  var orderWord = conf.order === 'descending' ? 'largest total at the bottom'
                : conf.order === 'inside-out' ? 'inside-out, by onset'
                : 'as supplied';

  var aria =
    'Stacked area of ' + n + ' series in ' + (pct ? 'percent' : 'absolute') + ' mode, stacked ' +
    orderWord + ', across ' + span + '. ' + costA + ' Series, bottom to top: ' + onames.join(', ') + '.';

  var bits = [];
  if (negNames.length) {
    bits.push('<b>' + negNames.length + '</b> series held a negative value and ' +
              (negNames.length === 1 ? 'is' : 'are') + ' not shown in percent mode (' +
              CK.esc(negNames.join(', ')) + ') &mdash; a share of a total that mixes signs is not a ' +
              'share. Absolute mode draws them, running downward from zero.');
  }
  if (undef) {
    bits.push('<b>' + undef + '</b> column' + (undef === 1 ? '' : 's') + ' had a total of zero, so ' +
              (undef === 1 ? 'its' : 'their') + ' percentages do not exist; ' +
              (undef === 1 ? 'it is' : 'they are') + ' marked on the axis rather than drawn as flat.');
  }
  if (P.refused) { bits.push('<b>' + P.refused + '</b> point' + (P.refused === 1 ? '' : 's') + ' had no usable x or y and ' + (P.refused === 1 ? 'was' : 'were') + ' dropped.'); }
  if (P.dupes) { bits.push('<b>' + P.dupes + '</b> duplicate x within a series; the last value at each x wins.'); }
  if (P.interp) { bits.push('<b>' + P.interp + '</b> value' + (P.interp === 1 ? '' : 's') + ' interpolated between a series own readings; outside a series own span it counts as zero.'); }
  if (P.thinnedFrom > nx) { bits.push('drawn at <b>' + nx + '</b> of <b>' + P.thinnedFrom + '</b> x positions, every ' + Math.ceil(P.thinnedFrom / nx) + 'th; the drawn values are exact and the extremes between them are not shown.'); }

  var caption =
    '<b>' + (pct ? 'percent' : 'absolute') + '</b> stacked area, <b>' + n + '</b> band' +
    (n === 1 ? '' : 's') + ' stacked <i>' + CK.esc(orderWord) + '</i> across ' + CK.esc(span) + '. ' +
    '<i>' + CK.esc(costA) + '</i> ' +
    (pct ? '' : 'peak total <b>' + CK.esc(CK.fmt(thi) + unit) + '</b>. ') +
    bits.join(' ');

  return { aria: aria, caption: caption };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, pad2, fmtX, axisTicks, mLine, mText, mPath, stepExpand, monoSegs,
                 edgeCmds, saConfig, saOrder, stackColumn, colSum, saNote, saRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so a series name containing `</script>` cannot close the block early,
 * with the useful side effect that no name can put an arrow into a file contractually free of them.
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
  const own = '.ck-stackedarea[data-card="' + id + '"]';
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
 * that has to know anything. `prefers-color-scheme` is deliberately absent — the desk is one
 * document open in two viewers that want different answers.
 */
function cardCss(id, wide, W, multi) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-stub', 'stroke: var(--accent); stroke-width: 3;'],
    ['.ck-plot .ck-undef', 'stroke: var(--ink-faint); stroke-width: 1.4;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  if (!multi) return scope(id, rules) + '\n';

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

  return '<section data-card="' + CK.esc(id) + '" class="ck-stackedarea">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="stacked area settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('mode') + '">mode</label>\n' +
    '    <select id="' + f('mode') + '" name="mode">' +
         opt('absolute', 'absolute', defaults.mode) +
         opt('percent', 'percent of total', defaults.mode) + '</select>\n' +
    '    <label for="' + f('order') + '">order</label>\n' +
    '    <select id="' + f('order') + '" name="order">' +
         opt('given', 'as supplied', defaults.order) +
         opt('descending', 'largest at the bottom', defaults.order) +
         opt('inside-out', 'inside-out, by onset', defaults.order) + '</select>\n' +
    '    <label for="' + f('curve') + '">curve</label>\n' +
    '    <select id="' + f('curve') + '" name="curve">' +
         opt('linear', 'straight', defaults.curve) +
         opt('smooth', 'smooth (monotone)', defaults.curve) +
         opt('step', 'step', defaults.curve) + '</select>\n' +
    '    <label for="' + f('total') + '">total line</label>\n' +
    '    <input id="' + f('total') + '" name="total" type="checkbox"' +
           (defaults.total ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">percent mode hides the total, so a band can shrink here while its ' +
         'absolute value grows; the total line puts that dimension back on the page and the ' +
         'caption says whether it is on. step claims the value held constant between readings.</p>\n' +
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
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* stacked area card: the same renderer that drew the copy in card.html, re-run when a\n' +
    '   setting changes. Percent shares are rebuilt from cumulative fractions here too, so a\n' +
    '   column still sums to exactly one hundred after the reader switches mode. */\n' +
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
    '     a render that added marks would stack a second set of bands on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = saRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/stackedarea');
}

/**
 * Build one stacked-area card from one data block.
 *
 * ON WHETHER THIS TYPE SHOULD EXIST. `chart` already draws a stacked area, with the same
 * two-directional accumulation for mixed signs, so the ABSOLUTE mode here is largely a duplicate
 * of `chart` with `kind: 'area', stacked: true`. What is not duplicated is percent mode and its
 * exact-hundred construction, the absolute-total strip, alignment of series that do not share an
 * x set, the ordering and curve choices, and a caption that names what percent mode hides. If the
 * catalogue were being designed once rather than grown, those would be modes of `chart` and this
 * file would not exist. It exists because `chart` deliberately has no settings at all — no
 * `defaults`, no gear — and four settings is not a change to make to another type's contract
 * while six agents are editing the same directory.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame, captioned "no data"
 *   one series           one band, whose top is the total; the total line is then the same line
 *                        and is still drawn, dashed, because switching it off should be the
 *                        reader's decision rather than a special case
 *   one point per series a single column has no area, so each band draws a short thickness tick
 *   different x sets     aligned on the union; interior gaps interpolated from the series own
 *                        neighbours, positions outside its span counted as zero, both counted
 *   all values zero      absolute mode draws a flat empty stack on a padded axis; percent mode
 *                        has no total to divide by, so every column is marked undefined and the
 *                        caption says the percentages do not exist
 *   a negative value     absolute mode stacks it downward from zero, so the band keeps its true
 *                        thickness; percent mode refuses the whole series, counts it and names
 *                        it, because a share of a mixed-sign total is not a share
 *   50 series            50 bands, colours cycling every 8; the budget cuts drawn x positions to
 *                        480 so the emitted script stays a sensible size
 *   5,000 points         thinned by stride to at most 720 drawn positions, first and last kept
 *   a non-numeric value  refused while reading, counted, named; never coerced
 *   duplicate x          the last value at that x wins, and the overwrite is counted
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ series: [{ name, points: [{ x, y }] }], xLabel, yLabel, unit }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'revenue',
 *   title: 'revenue by product line',
 *   data: { unit: 'USD', yLabel: 'revenue',
 *           series: [{ name: 'core', points: [{ x: '2024-01-01', y: 40 }, { x: '2024-02-01', y: 44 }] },
 *                    { name: 'cloud', points: [{ x: '2024-01-01', y: 5 }, { x: '2024-02-01', y: 22 }] }] },
 *   ord: 35,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'stackedarea' : id);
  const read = readData(data);

  const { xs, from } = alignX(read.series, read.series.length);
  let interp = 0;
  const rows = read.series.map((s) => {
    const g = onGrid(s.pts, xs);
    interp += g.interp;
    return { name: s.name, v: g.v, neg: s.neg };
  });

  const P = {
    xs, rows, interp,
    isTime: read.isTime,
    xLabel: read.xLabel,
    yLabel: read.yLabel,
    unit: read.unit,
    refused: read.refused,
    dupes: read.dupes,
    thinnedFrom: from,
    W0, H0, WMAX,
  };

  const seed = saRender(P, defaults);
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
      negativeSeries: rows.filter((r) => r.neg > 0).length,
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
