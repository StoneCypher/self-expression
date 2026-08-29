/**
 * `horizon` — one row per series, the value folded into colour-stepped bands.
 *
 * A horizon chart is the densest honest time-series display there is. It buys that density by
 * FOLDING: the value range is cut into `bands` slices of equal height, each slice is drawn from
 * the same baseline at the row's full height, and the slices are distinguished by colour rather
 * than by position. A row that would need 120px as a line chart reads at 28px, so fifty series
 * fit on one screen sharing one x axis.
 *
 * What it trades is the thing folding removes: POSITION. Reading an exact value means counting
 * colour steps and then estimating a fraction of the top one, which is slow and approximate, and
 * a reader who does not know the fold is there will read a dark band as a different quantity
 * rather than as a larger one. What it buys is that fifty rows are directly comparable, because
 * every row shares one baseline, one x axis and one band unit.
 *
 * That last point is a real decision and the caption names it: the band unit is SHARED across
 * rows, not computed per row. A per-row unit makes every row use its full height and makes rows
 * incomparable, which throws away the only reason to draw fifty of them together.
 *
 * `CK` is loaded out of `kit.js` in a `node:vm` context, so `CK.scale` and `CK.ticks` here are the
 * same functions the page has.
 *
 * @see ./streamgraph.mjs — the other dense many-series time display, stacked rather than folded
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
 * @example loadKit().fmt(1200);   // '1.2k'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/horizon: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/horizon: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const WMAX = 2200;

/* Caps on the PAYLOAD, not on the arithmetic: every summary in the caption is computed from the
   complete data before any thinning happens. A horizon is usually many rows, so the per-row share
   of the cell budget matters more here than on a one-row card. */
const XCAP   = 600;
const BUDGET = 12000;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 *
 * Three bands is the usual recommendation and the one this card defaults to: two is barely a fold
 * and four asks a reader to distinguish four steps of one hue at 28px, which is past what the eye
 * does reliably. The control is capped at 2 to 4 for that reason rather than left open.
 */
export const defaults = {
  bands:     3,
  mirror:    true,
  rowHeight: 28,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'horizon',
  summary: 'One row per series, the value folded into colour-stepped bands on a shared unit.',
  shape: '{ series: [{ name, points: [{ x, y }] }], xLabel, yLabel, unit } — x numeric or a date string, y numeric and may be negative',
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
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/horizon';
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
 * `new Date('soon')` is not a time, and either one invents a reading nobody supplied.
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
 * purpose: every coercion lands on 0, and a zero in a horizon row is a visible statement that the
 * measurement was taken and came out flat.
 *
 * DUPLICATE x WITHIN ONE SERIES: the last occurrence wins and the overwrite is counted. A series
 * is normally appended to over time, so a second record at one x is a correction; summing would
 * silently double a value, keeping the first would discard the correction.
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

    for (const p of src) {
      if (!p || typeof p !== 'object') { bad++; continue; }
      const rx = readX(p.x);
      const y = p.y;
      if (!rx || typeof y !== 'number' || !Number.isFinite(y)) { bad++; continue; }
      if (rx.date) dated++; else plain++;
      if (at.has(rx.v)) dup++;
      at.set(rx.v, y);
    }

    refused += bad;
    dupes += dup;
    kept += at.size;

    const pts = [...at.entries()].map(([x, y]) => ({ x, y }));
    pts.sort((a, b) => a.x - b.x);
    return { name: String(s && s.name != null ? s.name : 'series ' + (i + 1)), pts };
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
 * every drawn x is a real x carrying real values — which is what lets the claim "the bands at a
 * position sum back to the value there" survive thinning. Bucket-averaging would keep the
 * extremes and break the claim; stride keeps the claim and loses extremes between drawn
 * positions, and the caption says so.
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
 *   - a position OUTSIDE that span is a GAP — `null` — and the row's band simply stops there.
 *
 * Interpolation inside rather than carry-forward, because carry-forward invents a plateau; on a
 * folded band a plateau at exactly a band boundary paints a solid block of the darkest colour
 * across a stretch where nothing was measured, which is the loudest possible way to show nothing.
 *
 * A gap rather than zero outside the span, which is where this differs from the stacked types:
 * a horizon row is independent of the others, so it owes no value to a total, and a row drawn at
 * zero would claim a measurement of zero was taken.
 *
 * @returns `{ v, interp }` — values with `null` for gaps, and how many were interpolated
 *
 * @example onGrid([{ x: 0, y: 0 }, { x: 2, y: 4 }], [0, 1, 2, 3]);   // { v: [0, 2, 4, null], interp: 1 }
 */
function onGrid(pts, xs) {
  const v = new Array(xs.length).fill(null);
  let interp = 0;
  if (!pts.length) return { v, interp };

  const lo = pts[0].x;
  const hi = pts[pts.length - 1].x;
  let k = 0;

  for (let j = 0; j < xs.length; j++) {
    const x = xs[j];
    if (x < lo || x > hi) continue;
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
 * A non-finite number in a path is silent: the browser drops the whole `d` and the row renders
 * empty with nothing in the console.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (!isFinite(v)) { throw new Error('horizon: non-finite coordinate (' + v + ')'); }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face; measured, not guessed. */
function tw(s) { return String(s).length * 5.42; }

/** Shorten a label to fit `max` px, keeping the head and marking the cut. */
function clipTo(s, max) {
  var str = String(s);
  var room = Math.floor(max / 5.42);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/** Two digits, so a month or a day aligns with the rest of the label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A compact label for one x position, in the units the axis is actually in.
 *
 * UTC getters throughout: a date written as a plain day parses to UTC midnight, so reading it back
 * in the viewer's zone can print the day before, and an axis that disagrees with the strings it
 * was handed is worse than a coarse one.
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

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function hzConfig(cfg) {
  var c = cfg || {};
  var b = Math.round(Number(c.bands));
  var rh = Math.round(Number(c.rowHeight));
  return {
    bands: isFinite(b) ? Math.max(2, Math.min(4, b)) : 3,
    mirror: c.mirror !== false,
    rowHeight: isFinite(rh) ? Math.max(14, Math.min(80, rh)) : 28,
  };
}

/**
 * The band boundaries, in value units, for a given peak magnitude.
 *
 * The last boundary is set to `peak` EXACTLY rather than computed as `peak * bands / bands`,
 * because the whole reconstruction claim rests on it: a layer's value is the difference of two
 * clamped boundaries, so the layers of one reading telescope to `min(|v|, last) - min(|v|, 0)`,
 * which is `|v|` exactly only when `last` is exactly the peak. Computing the last boundary by
 * arithmetic leaves it a few ulps under, and every reading at the peak then loses a sliver from
 * its darkest band — invisible on screen and fatal to the test that says the bands add up.
 *
 * @param peak the largest magnitude across every row, which is what the fold is scaled to
 * @param n    how many bands, 2 to 4
 * @returns n + 1 boundaries, ascending, starting at 0 and ending exactly at `peak`
 *
 * @example bandEdges(9, 3);   // [0, 3, 6, 9]
 */
function bandEdges(peak, n) {
  var out = [], i;
  for (i = 0; i < n; i++) { out.push(peak * i / n); }
  out.push(peak);
  return out;
}

/**
 * How much of one reading falls in each band.
 *
 * Written as the difference of two clamped magnitudes rather than as `clamp(|v| - edge, 0, u)`.
 * The two are algebraically identical; only this one telescopes, so the parts of a reading sum
 * back to the reading with no rounding residue at all. That is the property the whole form
 * depends on — a horizon chart claims its colour steps ADD UP to the value, and a chart that
 * cannot prove its own claim is decoration.
 *
 * @param mag   the magnitude of a reading, at most the last edge
 * @param edges from {@link bandEdges}
 * @returns one value per band, summing exactly to `mag`
 *
 * @example bandParts(7, [0, 3, 6, 9]);   // [3, 3, 1]
 */
function bandParts(mag, edges) {
  var out = [], i;
  for (i = 0; i < edges.length - 1; i++) {
    out.push(Math.min(mag, edges[i + 1]) - Math.min(mag, edges[i]));
  }
  return out;
}

/**
 * Drop points that lie on a straight horizontal run, losslessly.
 *
 * A folded band spends most of its length clamped flat — at zero where the value is below the
 * band, at the full height where it is above — so a 600-position row usually needs a couple of
 * dozen vertices. Removing the interior of a flat run changes nothing about the polygon and cuts
 * the emitted markup by an order of magnitude on the wide cases.
 *
 * @example simplify([{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }]).length;   // 2
 */
function simplify(pts) {
  var out = [], i;
  for (i = 0; i < pts.length; i++) {
    if (i > 0 && i < pts.length - 1 && pts[i].y === pts[i - 1].y && pts[i].y === pts[i + 1].y) { continue; }
    out.push(pts[i]);
  }
  return out;
}

/**
 * Contiguous runs of positions where a row actually has a value.
 *
 * A gap has to break the polygon rather than be bridged: a band drawn across a gap claims a
 * measurement that was never taken, and on a chart whose whole proposition is density that claim
 * is invisible.
 *
 * @example runsOf([1, null, 2, 3]);   // [[0, 0], [2, 3]]
 */
function runsOf(v) {
  var out = [], start = -1, i;
  for (i = 0; i < v.length; i++) {
    if (v[i] === null) {
      if (start >= 0) { out.push([start, i - 1]); start = -1; }
    } else if (start < 0) { start = i; }
  }
  if (start >= 0) { out.push([start, v.length - 1]); }
  return out;
}

/**
 * The whole picture, as a display list, from the shipped values and the settled settings.
 *
 * Called in Node to draw the copy that ships inside card.html, and in the browser on every
 * settings change, so the caption cannot come to disagree with the picture.
 *
 * There is deliberately no curve setting. A smooth curve through folded bands overshoots across a
 * band boundary, which paints the next colour step where the data never reached it — on a chart
 * that encodes magnitude AS colour, that is not a cosmetic overshoot, it is a wrong reading.
 *
 * @param P   the shipped payload: grid, rows, labels, refusal counts
 * @param cfg the settings, unsettled; {@link hzConfig} settles them
 * @returns `{ W, H, marks, note }`
 *
 * @example hzRender(payload, { bands: 4 }).note.aria;
 */
function hzRender(P, cfg) {
  var conf = hzConfig(cfg);
  var xs = P.xs, nx = xs.length, rows = P.rows, nr = rows.length, i, j, b;

  var peak = 0, anyNeg = false, live = 0;
  for (i = 0; i < nr; i++) {
    for (j = 0; j < nx; j++) {
      var v = rows[i].v[j];
      if (v === null) { continue; }
      if (v < 0) { anyNeg = true; }
      if (Math.abs(v) > peak) { peak = Math.abs(v); }
    }
    if (rows[i].n > 0) { live++; }
  }

  var mirror = conf.mirror || !anyNeg;
  var rowH = conf.rowHeight;
  var lane = mirror ? rowH : rowH * 2;
  var gap = 6;

  var labelW = 0;
  for (i = 0; i < nr; i++) { labelW = Math.max(labelW, tw(clipTo(rows[i].name, 110))); }

  var padT = 26;
  var padR = 8 + Math.max(tw('-' + CK.fmt(peak)), tw(P.unit)) + 6;
  var padB = 22 + (P.xLabel ? 12 : 0);
  var padL = Math.round(Math.min(110, labelW)) + 10;

  var W = Math.min(P.WMAX, Math.max(P.W0, padL + padR + nx * 1.4));
  var H = padT + padB + Math.max(lane, nr * (lane + gap));
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: padT + Math.max(lane, nr * (lane + gap)) };

  var xlo = nx ? xs[0] : 0, xhi = nx ? xs[nx - 1] : 1;
  var xScale = CK.scale([xlo, xhi], [plot.x0, plot.x1]);
  var edges = bandEdges(peak, conf.bands);
  var u = peak > 0 ? peak / conf.bands : 0;
  var pxPerUnit = u > 0 ? rowH / u : 0;

  var marks = [];

  /* The band key, up top. Without it the colour steps are decoration: a reader has no way to turn
     "two steps and a bit" into a number, which is the one thing folding makes hard. */
  if (peak > 0) {
    marks.push(mText(plot.x0, 12, 'each colour step = ' + CK.fmt(u) + (P.unit ? ' ' + P.unit : '') +
                     ' \u00b7 ' + conf.bands + ' bands to ' + CK.fmt(peak) +
                     (mirror && anyNeg ? ' \u00b7 negatives folded up' : anyNeg ? ' \u00b7 negatives run down' : ''),
                     'ck-key', 'start'));
  }

  if (nx) {
    var want = Math.max(2, Math.min(7, Math.floor((plot.x1 - plot.x0) / 74)));
    var xspan = xhi - xlo;
    for (i = 0; i <= want; i++) {
      var at = nx === 1 ? 0 : Math.round(i * (nx - 1) / want);
      var px = xScale(xs[at]);
      marks.push(mLine(px, plot.y0, px, plot.y1, 'ck-rule'));
      marks.push(mText(px, plot.y1 + 13, fmtX(xs[at], xspan, P.isTime), 'ck-tk',
                       i === 0 ? 'start' : i === want ? 'end' : 'middle'));
      if (nx === 1) { break; }
    }
  }
  if (P.xLabel) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, P.xLabel, 'ck-cap-ax', 'middle')); }

  for (i = 0; i < nr; i++) {
    var row = rows[i];
    var top = plot.y0 + i * (lane + gap);
    var base = mirror ? top + lane : top + rowH;
    var kids = [];

    kids.push(mLine(plot.x0, base, plot.x1, base, 'ck-base'));
    marks.push(mText(plot.x0 - 6, base - (mirror ? lane / 2 : 0) + 3.2,
                     clipTo(row.name, 110), 'ck-row', 'end'));
    marks.push(mText(plot.x1 + 5, top + 9, row.n ? CK.fmt(row.max) : 'no data', 'ck-tk', 'start'));
    if (row.n && row.min < 0) { marks.push(mText(plot.x1 + 5, base + 3.2, CK.fmt(row.min), 'ck-tk', 'start')); }

    if (peak > 0) {
      var runs = runsOf(row.v);
      for (b = 0; b < conf.bands; b++) {
        kids.push.apply(kids, bandPaths(row.v, runs, b, edges, 1, xScale, xs, base, pxPerUnit, mirror, conf.bands));
        if (anyNeg) {
          kids.push.apply(kids, bandPaths(row.v, runs, b, edges, -1, xScale, xs, base, pxPerUnit, mirror, conf.bands));
        }
      }
    }

    var g = { t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids };
    g.ti = row.name + ' \u00b7 ' + (row.n
      ? CK.fmt(row.min) + ' to ' + CK.fmt(row.max) + (P.unit ? ' ' + P.unit : '') + ' \u00b7 ' + row.n + ' readings'
      : 'no readings');
    marks.push(g);
  }

  if (!nr || !nx) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  } else if (peak === 0) {
    marks.push(mText((plot.x0 + plot.x1) / 2, plot.y0 - 14, 'every value is zero', 'ck-key', 'middle'));
  }

  return {
    W: W, H: H, marks: marks,
    note: hzNote(P, conf, mirror, anyNeg, peak, u, live, xlo, xhi),
  };
}

/**
 * One band of one row, as area paths — one per contiguous run of readings.
 *
 * `sign` picks which half of the data this band draws: +1 takes readings at or above zero, -1
 * takes the ones below. A reading of the other sign contributes height zero rather than breaking
 * the polygon, because a positive band genuinely IS zero where the value is negative, and that is
 * different from having no reading at all.
 *
 * Under `mirror` a negative band grows upward from the same baseline as the positive one, which is
 * the canonical horizon fold: the row costs one row height instead of two and the sign is carried
 * by hue. Without it the negative band grows downward and the row is twice as tall — honest about
 * direction, and half as dense, which is the thing this chart was chosen for.
 *
 * @returns display-list marks, possibly none when this band is empty across every run
 */
function bandPaths(v, runs, b, edges, sign, xScale, xs, base, pxPerUnit, mirror, nbands) {
  var out = [], r, i, pts, any, mag, part, h, d, dir;
  dir = sign > 0 || mirror ? -1 : 1;

  for (r = 0; r < runs.length; r++) {
    pts = [];
    any = false;
    for (i = runs[r][0]; i <= runs[r][1]; i++) {
      mag = sign > 0 ? Math.max(0, v[i]) : Math.max(0, -v[i]);
      part = bandParts(mag, edges)[b];
      h = part * pxPerUnit;
      if (h > 0.01) { any = true; }
      pts.push({ x: xScale(xs[i]), y: base + dir * h });
    }
    if (!any) { continue; }
    pts = simplify(pts);
    if (pts.length === 1) {
      out.push(mLine(pts[0].x, base, pts[0].x, pts[0].y, 'ck-tick-' + (sign > 0 ? 'p' : 'n')));
      continue;
    }
    d = 'M' + fin(pts[0].x) + ' ' + fin(base);
    for (i = 0; i < pts.length; i++) { d += ' L' + fin(pts[i].x) + ' ' + fin(pts[i].y); }
    d += ' L' + fin(pts[pts.length - 1].x) + ' ' + fin(base) + ' Z';
    out.push(mPath(d, {
      fill: sign > 0 ? 'var(--ck-hz-pos)' : 'var(--ck-hz-neg)',
      'fill-opacity': String(Math.round((0.30 + 0.70 * (b + 1) / nbands) * 100) / 100),
      stroke: 'none',
    }));
  }
  return out;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so this text IS the chart to anyone using it — and on a
 * horizon chart the picture is unusually hard to describe, because the encoding itself has to be
 * explained before any number means anything. So the first clause says the fold is there and what
 * one step is worth, and the second says what the form is good and bad at.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function hzNote(P, conf, mirror, anyNeg, peak, u, live, xlo, xhi) {
  var nr = P.rows.length, nx = P.xs.length, unit = P.unit ? ' ' + P.unit : '';
  var span = nx ? fmtX(xlo, xhi - xlo, P.isTime) + ' to ' + fmtX(xhi, xhi - xlo, P.isTime) : '';

  if (!nr || !nx) {
    return {
      aria: 'Horizon chart with no data: no rows are drawn.',
      caption: 'a horizon chart with <b>no data</b> &mdash; the frame is drawn so the card keeps ' +
               'its place, but there is nothing in it.',
    };
  }

  var trade =
    'Folding is what makes this readable at ' + conf.rowHeight + 'px a row: the value is cut into ' +
    conf.bands + ' steps of ' + CK.fmt(u) + unit + ' each and the steps are told apart by colour ' +
    'rather than by height. Reading an exact value is therefore slow - count the steps, then judge ' +
    'a fraction of the top one - and comparing rows is fast, because every row shares one baseline, ' +
    'one x axis and one step size.';

  var signWord = !anyNeg ? ''
    : mirror
      ? ' Negative readings are folded UP from the same baseline in the second hue, so a row costs ' +
        'one row height and the sign is carried entirely by colour.'
      : ' Negative readings run DOWN from a mid-row baseline, so direction is visible and each row ' +
        'costs twice the height, which is half the density this chart was chosen for.';

  var aria =
    'Horizon chart of ' + nr + ' series across ' + span + '. ' + trade + signWord +
    ' The largest magnitude anywhere is ' + CK.fmt(peak) + unit + '.';

  var bits = [];
  if (live < nr) { bits.push('<b>' + (nr - live) + '</b> of the ' + nr + ' rows had no usable readings at all and ' + (nr - live === 1 ? 'is' : 'are') + ' drawn as an empty lane.'); }
  if (P.refused) { bits.push('<b>' + P.refused + '</b> point' + (P.refused === 1 ? '' : 's') + ' had no usable x or y and ' + (P.refused === 1 ? 'was' : 'were') + ' dropped.'); }
  if (P.dupes) { bits.push('<b>' + P.dupes + '</b> duplicate x within a series; the last value at each x wins.'); }
  if (P.interp) { bits.push('<b>' + P.interp + '</b> value' + (P.interp === 1 ? '' : 's') + ' interpolated between a series own readings; outside a series own span the row is a gap rather than a zero.'); }
  if (P.thinnedFrom > nx) { bits.push('drawn at <b>' + nx + '</b> of <b>' + P.thinnedFrom + '</b> x positions, every ' + Math.ceil(P.thinnedFrom / nx) + 'th; the drawn values are exact and the extremes between them are not shown.'); }
  if (peak === 0) { bits.push('<i>every value is zero</i>, so there is nothing to fold and every row is flat on its baseline.'); }

  var caption =
    'horizon chart, <b>' + nr + '</b> row' + (nr === 1 ? '' : 's') + ' &times; <b>' + nx + '</b> ' +
    'position' + (nx === 1 ? '' : 's') + ' across ' + CK.esc(span) + ', folded into <b>' +
    conf.bands + '</b> bands of <b>' + CK.esc(CK.fmt(u) + unit) + '</b>. ' +
    '<i>' + CK.esc(trade + signWord) + '</i> ' +
    bits.join(' ');

  return { aria: aria, caption: caption };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, pad2, fmtX, mLine, mText, mPath, hzConfig, bandEdges,
                 bandParts, simplify, runsOf, bandPaths, hzNote, hzRender];

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
  const own = '.ck-horizon[data-card="' + id + '"]';
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
 * The two horizon hues are named as tokens on bare `:root` and overridden under
 * `:root[data-theme="light"]`, which is the one sanctioned way for a type to need its own colour.
 * They are NOT the series palette: on a horizon chart colour encodes magnitude and sign, not
 * identity — the row label carries identity — so giving each row its own hue would overload the
 * only channel the fold has left.
 */
function cardCss(id, wide, W) {
  /* Defined once on bare `:root` and NOT overridden per theme, because each already resolves
     through a desk token that themes itself. A second definition under `[data-theme="light"]`
     would be the same two words written twice, and the next person to change a hue would change
     one of them. */
  const roots =
    ':root {\n' +
    '  --ck-hz-pos: var(--ck-s6);\n' +
    '  --ck-hz-neg: var(--ck-s1);\n' +
    '}\n';

  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-row', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-key', 'fill: var(--ink-faint); letter-spacing: .03em;'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-base', 'stroke: var(--rule); stroke-width: .8; fill: none;'],
    ['.ck-plot .ck-tick-p', 'stroke: var(--ck-hz-pos); stroke-width: 1.4;'],
    ['.ck-plot .ck-tick-n', 'stroke: var(--ck-hz-neg); stroke-width: 1.4;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    /* Hover lifts a whole row. On fifty rows the useful question is which row, and the row is the
       unit of meaning; highlighting the one band under the pointer answers a question nobody has. */
    ['.ck-plot .ck-ser', 'transition: opacity .12s linear;'],
    ['.ck-plot:hover .ck-ser', 'opacity: .4;'],
    ['.ck-plot .ck-ser:hover', 'opacity: 1;'],
  ];
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  return roots + scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, wide) {
  const f = (name) => CK.esc(id) + '-' + name;

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-horizon">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="horizon settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('bands') + '">bands</label>\n' +
    '    <input id="' + f('bands') + '" name="bands" type="number" min="2" max="4" step="1" ' +
           'value="' + CK.esc(defaults.bands) + '">\n' +
    '    <label for="' + f('mirror') + '">fold negatives up</label>\n' +
    '    <input id="' + f('mirror') + '" name="mirror" type="checkbox"' +
           (defaults.mirror ? ' checked' : '') + '>\n' +
    '    <label for="' + f('rowHeight') + '">row height</label>\n' +
    '    <input id="' + f('rowHeight') + '" name="rowHeight" type="number" min="14" max="80" step="2" ' +
           'value="' + CK.esc(defaults.rowHeight) + '">\n' +
    '    <p class="ck-set-foot">more bands means a shorter row and more colour steps to count; ' +
         'four is about where one hue stops being reliably ordered by eye. Folding negatives up ' +
         'halves the height and moves sign into colour; unfolding them makes direction visible ' +
         'and doubles the height.</p>\n' +
    '  </div>\n' +
    '  ' + (wide ? '<div class="ck-scroll">' + plot + '</div>' : plot) + '\n' +
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
    '/* horizon card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The band arithmetic is the shipped source of the function that produced the\n' +
    '   picture, so changing the band count cannot produce a fold the caption does not describe. */\n' +
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
    '     stays a translator rather than a second place where horizon decisions live. */\n' +
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
    '     a render that added marks would draw a second set of rows over the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = hzRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/horizon');
}

/**
 * Build one horizon card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame, captioned "no data"
 *   one series           one row, which is a folded area chart; the form still earns its keep
 *                        because the fold is what makes it 28px tall
 *   one point per series a run of one position has no polygon, so it draws a vertical tick at its
 *                        height rather than an invisible degenerate area
 *   different x sets     aligned on the union; interior gaps interpolated from the series own
 *                        neighbours and counted, positions outside a series own span left as
 *                        GAPS in that row rather than drawn as zero
 *   all values zero      the peak is zero, so there is nothing to fold: every row is flat on its
 *                        baseline, no band key is drawn, and the caption says so outright
 *   a negative value     drawn. This is the one form on the desk that handles negatives natively:
 *                        folded up in the second hue by default, or run downward with `mirror` off
 *   50 series            50 rows at 28px plus gaps, about 1,700px tall; the payload budget cuts
 *                        the drawn x positions to 240 so the emitted script stays sensible
 *   5,000 points         thinned by stride to at most 600 drawn positions, first and last kept
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
 *   id: 'latency',
 *   title: 'p99 latency by region',
 *   data: { unit: 'ms', xLabel: 'day',
 *           series: [{ name: 'us-east', points: [{ x: '2024-01-01', y: 120 }, { x: '2024-01-02', y: 240 }] },
 *                    { name: 'eu-west', points: [{ x: '2024-01-01', y: 90 },  { x: '2024-01-02', y: 95 }] }] },
 *   ord: 45,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'horizon' : id);
  const read = readData(data);

  const { xs, from } = alignX(read.series, read.series.length);
  let interp = 0;
  const rows = read.series.map((s) => {
    const g = onGrid(s.pts, xs);
    interp += g.interp;
    /* The quoted extremes come from the COMPLETE series, before thinning: a row's label should say
       what the series did, not what survived a payload budget. */
    let min = 0;
    let max = 0;
    if (s.pts.length) {
      min = s.pts[0].y;
      max = s.pts[0].y;
      for (const p of s.pts) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
      }
    }
    return { name: s.name, v: g.v, n: s.pts.length, min, max };
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
    W0, WMAX,
  };

  const seed = hzRender(P, defaults);
  const wide = seed.W > W0;

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      series: rows.length,
      x: xs.length,
      refusedPoints: read.refused,
      interpolated: interp,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, wide),
    css: cardCss(cardId, wide, seed.W),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
