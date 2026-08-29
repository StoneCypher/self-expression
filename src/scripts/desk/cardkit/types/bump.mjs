/**
 * `bump` — rank over time, with the tie rule written down and drawn.
 *
 * Rank is DERIVED here and never supplied. A bump chart whose ranks arrive in the data is a line
 * chart of numbers somebody else computed, and the reader has no way to know what "second" meant;
 * a point carrying a `rank` property is therefore ignored, counted, and named in the caption.
 *
 * TIES ARE THE WHOLE PROBLEM and this card commits to an answer:
 *
 *   COMPETITION RANKING — 1, 2, 2, 4. A series' rank is one plus the number of series strictly
 *   ahead of it, so tied series share the better rank and the next distinct value resumes after
 *   all of them. Tied series are then FANNED a few pixels apart so both lines are visible, and the
 *   fan is bracketed at that position so it cannot be misread as a rank difference.
 *
 * The alternatives and what breaks under them:
 *
 *   DENSE RANKING (1, 2, 2, 3) counts distinct values, so after a two-way tie for second the next
 *   series is called third. With four series and a tie for second, nobody is in third place —
 *   somebody is fourth — and the chart would print a number that is simply not what a reader
 *   means by rank.
 *
 *   ORDINAL RANKING (1, 2, 3, 4) has to break the tie with something the data does not contain:
 *   input order, or the name. The tied lines then cross, uncross and swap over time as unrelated
 *   values move, and a bump chart's entire vocabulary is crossings. Inventing one is the single
 *   most misleading thing this form can do, so it is the one option not offered.
 *
 * `CK` is loaded out of `kit.js` in a `node:vm` context, so `CK.scale` and `CK.hue` here are the
 * same functions the page has.
 *
 * @see ./slope.mjs — the two-point sibling, which plots value rather than rank
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
 * @example loadKit().hue(0);   // 'var(--ck-s1)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/bump: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/bump: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const WMAX = 2200;

/* A bump chart is read by following individual lines through crossings, which stops working long
   before 300 columns; the cap is a legibility limit as much as a payload one. */
const XCAP   = 300;
const BUDGET = 9000;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 */
export const defaults = {
  direction: 'high-is-first',
  labels:    'both',
  dots:      true,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'bump',
  summary: 'Rank over time, derived from values, with ties shared and drawn as ties.',
  shape: '{ series: [{ name, points: [{ x, value }] }], xLabel, unit } — x numeric or a date string; rank is derived, never supplied',
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
 * scanner desynchronises on the quote inside `replace(/'/g, x)` and starts blanking real code.
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
 * The backtick is never written here; it is reached for as `String.fromCharCode(96)`.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/bump';
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
 * `new Date('soon')` is not a time, and either one invents a position nobody supplied.
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
 * A value is kept only when it is a `number` and finite. `y` is accepted as a synonym for `value`
 * because every other card on this desk calls it that and a data block should not have to be
 * rewritten to try a different picture of it.
 *
 * A SUPPLIED `rank` IS IGNORED and counted. Rank is what this chart computes; accepting one would
 * let the picture disagree with the values printed in its own tooltips, and the reader would have
 * no way to see which of the two was wrong.
 *
 * DUPLICATE x WITHIN ONE SERIES: the last occurrence wins and the overwrite is counted — a second
 * record at one x is a correction rather than a second reading.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ series, isTime, xLabel, unit, refused, dupes, suppliedRanks, kept }`
 *
 * @example readData({ series: [{ name: 'a', points: [{ x: 1, value: 2 }] }] }).kept;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.series) ? d.series : [];

  let refused = 0;
  let dupes = 0;
  let kept = 0;
  let dated = 0;
  let plain = 0;
  let suppliedRanks = 0;

  const series = raw.map((s, i) => {
    const src = s && Array.isArray(s.points) ? s.points : [];
    const at = new Map();
    let bad = 0;
    let dup = 0;

    for (const p of src) {
      if (!p || typeof p !== 'object') { bad++; continue; }
      if (p.rank !== undefined) suppliedRanks++;
      const rx = readX(p.x);
      const v = p.value !== undefined ? p.value : p.y;
      if (!rx || typeof v !== 'number' || !Number.isFinite(v)) { bad++; continue; }
      if (rx.date) dated++; else plain++;
      if (at.has(rx.v)) dup++;
      at.set(rx.v, v);
    }

    refused += bad;
    dupes += dup;
    kept += at.size;

    const pts = [...at.entries()].map(([x, v]) => ({ x, v }));
    pts.sort((a, b) => a.x - b.x);
    return { name: String(s && s.name != null ? s.name : 'series ' + (i + 1)), pts };
  });

  return {
    series,
    isTime: dated > 0 && plain === 0,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    unit:   d.unit   == null ? '' : String(d.unit),
    refused, dupes, kept, suppliedRanks,
  };
}

/**
 * The union of every series' x positions, sorted, thinned to the budget.
 *
 * Thinning is by STRIDE, always keeping the first and last position, so every drawn column is a
 * real column of real values and the ranks in it are the ranks that actually held. Aggregating a
 * bucket would require averaging values in order to rank them, which invents a standing nobody
 * ever occupied.
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
 * One series' values on the shared x grid, with NO interpolation at all.
 *
 * This is where bump parts company with the stacked types on this desk, deliberately. There, a
 * missing value is interpolated so the bands above it stay honest. Here, a rank is a STANDING
 * AGAINST OTHERS, and interpolating a value to derive a rank would invent a placement the series
 * never held — it could be shown overtaking somebody on a day it filed no number at all. So an
 * unmeasured position is simply not ranked: the series is absent from that column's standings,
 * the remaining series are ranked among themselves, and the line breaks.
 *
 * @returns values on the grid, with `null` wherever the series had no reading
 *
 * @example onGrid([{ x: 0, v: 5 }, { x: 2, v: 7 }], [0, 1, 2]);   // [5, null, 7]
 */
function onGrid(pts, xs) {
  const v = new Array(xs.length).fill(null);
  const at = new Map(pts.map((p) => [p.x, p.v]));
  for (let j = 0; j < xs.length; j++) if (at.has(xs[j])) v[j] = at.get(xs[j]);
  return v;
}

/* ── the shipped half ────────────────────────────────────────────────────────────────── */
/* Written in the browser's vocabulary from here to the SHIPPED list — var and function, no
   arrows, no template literals, no backtick in any comment — because it is emitted verbatim
   through Function.prototype.toString() and also run here to draw the copy that ships inside
   card.html. One source, two runtimes, nothing to drift. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (!isFinite(v)) { throw new Error('bump: non-finite coordinate (' + v + ')'); }
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
 * in the viewer's zone can print the day before.
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

/** A display-list circle. */
function mDot(cx, cy, r, attrs) {
  var a = { cx: fin(cx), cy: fin(cy), r: fin(r) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'circle', a: a };
}

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function bpConfig(cfg) {
  var c = cfg || {};
  return {
    direction: c.direction === 'low-is-first' ? 'low-is-first' : 'high-is-first',
    labels: c.labels === 'left' || c.labels === 'right' ? c.labels : 'both',
    dots: c.dots !== false,
  };
}

/**
 * Competition ranks for one column, plus where each tied series sits inside its tie.
 *
 * A series' rank is one plus the number of series STRICTLY ahead of it at this position, so a
 * two-way tie for second is 2, 2 and the next series is fourth. Only series with a reading here
 * are ranked at all; the rest are absent from the standings rather than placed last, because
 * "did not report" and "came last" are different facts and a chart that conflates them is wrong
 * about the one that matters.
 *
 * The slot inside a tie is by the series' own index, which never changes, so a tie does not
 * reshuffle itself as its membership changes from one column to the next. The slot is a DRAWING
 * device with no meaning: it exists so two tied lines are both visible, and the bracket drawn
 * across it says as much.
 *
 * @param vals one array of values per series, `null` where a series has no reading
 * @param j    the column
 * @param dir  'high-is-first' or 'low-is-first'
 * @returns `{ rank, slot, size }` — parallel arrays, `null` for an unranked series
 *
 * @example ranksAt([[5], [5], [1]], 0, 'high-is-first').rank;   // [1, 1, 3]
 */
function ranksAt(vals, j, dir) {
  var n = vals.length, i, present = [], rank = [], slot = [], size = [];
  for (i = 0; i < n; i++) { rank.push(null); slot.push(null); size.push(null); if (vals[i][j] !== null) { present.push(i); } }
  if (!present.length) { return { rank: rank, slot: slot, size: size }; }

  var hi = dir !== 'low-is-first';
  present.sort(function (a, b) {
    var d = hi ? vals[b][j] - vals[a][j] : vals[a][j] - vals[b][j];
    return d || a - b;
  });

  i = 0;
  while (i < present.length) {
    var end = i;
    while (end + 1 < present.length && vals[present[end + 1]][j] === vals[present[i]][j]) { end++; }
    var g = end - i + 1, m;
    for (m = i; m <= end; m++) {
      rank[present[m]] = i + 1;
      slot[present[m]] = m - i;
      size[present[m]] = g;
    }
    i = end + 1;
  }
  return { rank: rank, slot: slot, size: size };
}

/**
 * Push overlapping labels apart, and say which ones could not be placed at all.
 *
 * Cluster-and-centre, then a monotone sweep. Labels are walked in y order; each starts as its own
 * cluster, and while the newest cluster overlaps the one before it the two are merged and
 * re-centred on the mean of their members' wanted positions. That is the standard one-dimensional
 * de-overlap and it settles in one pass, because merging only ever moves a cluster's centre
 * toward the labels inside it. The two sweeps afterwards fix the overlap that CLAMPING to the
 * plot edges can re-introduce, which the cluster pass by itself does not handle.
 *
 * WHEN IT CANNOT BE SOLVED: with n labels and a minimum pitch there is a hard floor of
 * `n * gap` pixels, and no arrangement fits below it. Rather than shrink the type until it is
 * unreadable or let labels sit on top of each other, the caller is told how many fit, drops the
 * rest by a stated priority, and the caption names the number dropped. The lines all stay — it is
 * the text that would not fit, not the data.
 *
 * @param ys  wanted positions, ascending
 * @param gap the minimum centre-to-centre distance
 * @param lo  top of the region labels may occupy
 * @param hi  bottom of it
 * @returns placed positions, in the same order
 *
 * @example packLabels([10, 11], 8, 0, 100);   // [6.5, 14.5]
 */
function packLabels(ys, gap, lo, hi) {
  var n = ys.length, groups = [], i, m, out = [];
  for (i = 0; i < n; i++) {
    groups.push({ sum: ys[i], n: 1 });
    while (groups.length > 1) {
      var a = groups[groups.length - 2], b = groups[groups.length - 1];
      var aBot = a.sum / a.n + a.n * gap / 2;
      var bTop = b.sum / b.n - b.n * gap / 2;
      if (bTop >= aBot - 1e-9) { break; }
      groups.pop(); groups.pop();
      groups.push({ sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  for (i = 0; i < groups.length; i++) {
    var g = groups[i], top = g.sum / g.n - g.n * gap / 2;
    if (top < lo) { top = lo; }
    if (top + g.n * gap > hi) { top = hi - g.n * gap; }
    for (m = 0; m < g.n; m++) { out.push(top + gap / 2 + m * gap); }
  }
  for (i = 1; i < out.length; i++) { if (out[i] < out[i - 1] + gap) { out[i] = out[i - 1] + gap; } }
  for (i = out.length - 2; i >= 0; i--) { if (out[i] > out[i + 1] - gap) { out[i] = out[i + 1] - gap; } }
  return out;
}

/**
 * The whole picture, as a display list, from the shipped values and the settled settings.
 *
 * Called in Node to draw the copy that ships inside card.html, and in the browser on every
 * settings change — including a change of `direction`, which recomputes every rank, so the
 * inversion is genuinely the same arithmetic rather than a mirror of the drawing.
 *
 * @param P   the shipped payload: grid, rows, labels, refusal counts
 * @param cfg the settings, unsettled; {@link bpConfig} settles them
 * @returns `{ W, H, marks, note }`
 *
 * @example bpRender(payload, { direction: 'low-is-first' }).note.aria;
 */
function bpRender(P, cfg) {
  var conf = bpConfig(cfg);
  var xs = P.xs, nx = xs.length, rows = P.rows, n = rows.length, i, j;

  var vals = [];
  for (i = 0; i < n; i++) { vals.push(rows[i].v); }

  /* Every column's standings, once. The tie count is a caption fact, so it is gathered here
     rather than recomputed by the note. */
  var cols = [], ties = 0, tiedCols = 0;
  for (j = 0; j < nx; j++) {
    var r = ranksAt(vals, j, conf.direction);
    var had = false;
    for (i = 0; i < n; i++) { if (r.size[i] > 1) { had = true; } }
    if (had) { tiedCols++; }
    for (i = 0; i < n; i++) { if (r.size[i] > 1 && r.slot[i] === 0) { ties++; } }
    cols.push(r);
  }

  var pitch = n > 0 ? Math.max(14, Math.min(30, Math.round(420 / n))) : 20;
  var fan = Math.min(pitch * 0.30, 5);

  var wantLeft = conf.labels === 'both' || conf.labels === 'left';
  var wantRight = conf.labels === 'both' || conf.labels === 'right';
  var nameW = 0;
  for (i = 0; i < n; i++) { nameW = Math.max(nameW, tw(clipTo(rows[i].name, 110))); }
  nameW = Math.min(110, nameW);

  var rankW = tw(String(Math.max(1, n))) + 8;
  var padT = 16;
  var padB = 22 + (P.xLabel ? 12 : 0);
  var padL = rankW + (wantLeft ? nameW + 12 : 8);
  var padR = (wantRight ? nameW + 12 : 12);

  var W = Math.min(P.WMAX, Math.max(P.W0, padL + padR + nx * 22));
  var H = padT + padB + Math.max(pitch, n * pitch);
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: padT + Math.max(pitch, n * pitch) };

  var xlo = nx ? xs[0] : 0, xhi = nx ? xs[nx - 1] : 1;
  var xScale = CK.scale([xlo, xhi], [plot.x0, plot.x1]);
  var rowY = function (rank) { return plot.y0 + (rank - 0.5) * pitch; };
  var yAt = function (i2, j2) {
    var c = cols[j2];
    if (c.rank[i2] === null) { return null; }
    return rowY(c.rank[i2]) + (c.slot[i2] - (c.size[i2] - 1) / 2) * fan;
  };

  var marks = [], k;

  for (k = 1; k <= n; k++) {
    marks.push(mLine(plot.x0, rowY(k), plot.x1, rowY(k), 'ck-rule'));
    marks.push(mText(rankW - 6, rowY(k) + 3.2, String(k), 'ck-tk', 'end'));
  }

  if (nx) {
    var xspan = xhi - xlo;
    var every = Math.max(1, Math.ceil(nx / Math.max(1, Math.floor((plot.x1 - plot.x0) / 62))));
    for (j = 0; j < nx; j++) {
      if (j % every && j !== nx - 1) { continue; }
      var px = xScale(xs[j]);
      marks.push(mText(px, plot.y1 + 13, fmtX(xs[j], xspan, P.isTime), 'ck-tk',
                       j === 0 ? 'start' : j === nx - 1 ? 'end' : 'middle'));
    }
  }
  if (P.xLabel) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, P.xLabel, 'ck-cap-ax', 'middle')); }

  /* Tie brackets, under the lines: a short rule joining the fanned members so the offset reads as
     "these are level" rather than as a rank difference of a third of a row. */
  for (j = 0; j < nx; j++) {
    for (i = 0; i < n; i++) {
      if (cols[j].size[i] > 1 && cols[j].slot[i] === 0) {
        var yTop = rowY(cols[j].rank[i]) - (cols[j].size[i] - 1) / 2 * fan;
        var yBot = rowY(cols[j].rank[i]) + (cols[j].size[i] - 1) / 2 * fan;
        marks.push(mLine(xScale(xs[j]), yTop, xScale(xs[j]), yBot, 'ck-tie'));
      }
    }
  }

  var leftWant = [], leftIdx = [], rightWant = [], rightIdx = [];

  for (i = 0; i < n; i++) {
    var kids = [], run = [], first = null, last = null;
    for (j = 0; j < nx; j++) {
      var y = yAt(i, j);
      if (y === null) {
        if (run.length) { kids.push.apply(kids, strokeRun(run, CK.hue(i), conf.dots)); run = []; }
        continue;
      }
      if (first === null) { first = { x: xScale(xs[j]), y: y }; }
      last = { x: xScale(xs[j]), y: y };
      run.push({ x: xScale(xs[j]), y: y, v: vals[i][j], r: cols[j].rank[i], j: j });
    }
    if (run.length) { kids.push.apply(kids, strokeRun(run, CK.hue(i), conf.dots)); }

    if (first && wantLeft) { leftWant.push(first.y); leftIdx.push(i); }
    if (last && wantRight) { rightWant.push(last.y); rightIdx.push(i); }

    var g = { t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids };
    g.ti = rows[i].name + (rows[i].n ? ' \u00b7 ' + rows[i].n + ' readings' : ' \u00b7 no readings');
    marks.push(g);
  }

  var dropped = 0;
  dropped += edgeLabels(marks, leftWant, leftIdx, rows, plot, pitch, plot.x0 - 6, 'end', nameW, cols, 0);
  dropped += edgeLabels(marks, rightWant, rightIdx, rows, plot, pitch, plot.x1 + 6, 'start', nameW, cols, nx - 1);

  if (!n || !nx) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return {
    W: W, H: H, marks: marks,
    note: bpNote(P, conf, ties, tiedCols, dropped, xlo, xhi),
  };
}

/** One unbroken run of a series as a polyline, with optional dots and a tooltip per reading. */
function strokeRun(run, colour, dots) {
  var out = [], i, d;
  if (run.length > 1) {
    d = '';
    for (i = 0; i < run.length; i++) { d += (i ? ' L' : 'M') + fin(run[i].x) + ' ' + fin(run[i].y); }
    out.push(mPath(d, { fill: 'none', stroke: colour, 'stroke-width': '1.8',
                        'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  for (i = 0; i < run.length; i++) {
    if (dots || run.length === 1) {
      out.push(mDot(run[i].x, run[i].y, run.length === 1 ? 3.2 : 2.6, { fill: colour, stroke: 'none' }));
    }
  }
  return out;
}

/**
 * Place one edge's labels, dropping the ones that cannot fit and reporting how many.
 *
 * When the labels need more room than the plot has, the ones kept are the BEST RANKED at that
 * edge. That is a stated priority rather than a neutral one: a bump chart is read from the top,
 * and if only some names can be printed the ones at the top are the ones a reader is looking for.
 *
 * @returns how many labels were dropped
 */
function edgeLabels(marks, want, idx, rows, plot, pitch, x, anchor, nameW, cols, col) {
  if (!want.length) { return 0; }
  var gap = 11, i, order = [], keep = [], dropped = 0;

  for (i = 0; i < want.length; i++) { order.push(i); }
  var room = Math.floor((plot.y1 - plot.y0) / gap);
  if (order.length > room) {
    order.sort(function (a, b) {
      var ra = cols[col] && cols[col].rank[idx[a]] !== null ? cols[col].rank[idx[a]] : 1e9;
      var rb = cols[col] && cols[col].rank[idx[b]] !== null ? cols[col].rank[idx[b]] : 1e9;
      return ra - rb || want[a] - want[b];
    });
    dropped = order.length - room;
    order = order.slice(0, room);
  }
  order.sort(function (a, b) { return want[a] - want[b] || a - b; });
  for (i = 0; i < order.length; i++) { keep.push(want[order[i]]); }

  var placed = packLabels(keep, gap, plot.y0, plot.y1);
  for (i = 0; i < order.length; i++) {
    marks.push(mText(x, placed[i] + 3.2, clipTo(rows[idx[order[i]]].name, nameW), 'ck-name', anchor));
  }
  return dropped;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * Two facts have to be in every caption because neither is in the picture: which direction is
 * rank 1, and what happens to a tie. A bump chart read with the wrong end up is not a slightly
 * wrong reading, it is the opposite one.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function bpNote(P, conf, ties, tiedCols, dropped, xlo, xhi) {
  var n = P.rows.length, nx = P.xs.length, unit = P.unit ? ' ' + P.unit : '';
  var span = nx ? fmtX(xlo, xhi - xlo, P.isTime) + ' to ' + fmtX(xhi, xhi - xlo, P.isTime) : '';
  var hi = conf.direction !== 'low-is-first';

  if (!n || !nx) {
    return {
      aria: 'Bump chart with no data: nothing is ranked.',
      caption: 'a bump chart with <b>no data</b> &mdash; the frame is drawn so the card keeps its ' +
               'place, but there is nothing in it.',
    };
  }

  var dirSentence = 'Rank 1 is the ' + (hi ? 'HIGHEST' : 'LOWEST') + ' value' + unit +
    ' at each position, and rank 1 is drawn at the top.';
  var tieSentence = ties
    ? 'Ties share the better rank and the next distinct value resumes below all of them, so a ' +
      'two-way tie for second is followed by fourth. Tied series are drawn a few pixels apart with ' +
      'a bracket between them; that offset is a drawing device and is not a rank difference.'
    : 'No two series were ever level, so no tie rule was needed; had one been, tied series would ' +
      'share the better rank and be drawn a few pixels apart under a bracket.';

  var aria =
    'Bump chart of ' + n + ' series across ' + nx + ' positions, ' + span + '. ' + dirSentence + ' ' +
    tieSentence + (n === 1 ? ' With one series there is nothing to rank against: it is first everywhere.' : '');

  var bits = [];
  if (n === 1) { bits.push('<i>one series ranks against nothing</i> and is first at every position; a bump chart of one line carries no information.'); }
  if (ties) { bits.push('<b>' + ties + '</b> tie' + (ties === 1 ? '' : 's') + ' across <b>' + tiedCols + '</b> position' + (tiedCols === 1 ? '' : 's') + ', drawn fanned under a bracket.'); }
  if (dropped) { bits.push('<b>' + dropped + '</b> end label' + (dropped === 1 ? '' : 's') + ' could not fit at the stated minimum pitch and ' + (dropped === 1 ? 'was' : 'were') + ' dropped, best-ranked kept first; every line is still drawn.'); }
  if (P.suppliedRanks) { bits.push('<b>' + P.suppliedRanks + '</b> point' + (P.suppliedRanks === 1 ? '' : 's') + ' carried a rank, which was <i>ignored</i> &mdash; rank is derived here, so a supplied one could disagree with the values in the tooltips.'); }
  if (P.refused) { bits.push('<b>' + P.refused + '</b> point' + (P.refused === 1 ? '' : 's') + ' had no usable x or value and ' + (P.refused === 1 ? 'was' : 'were') + ' dropped.'); }
  if (P.dupes) { bits.push('<b>' + P.dupes + '</b> duplicate x within a series; the last value at each x wins.'); }
  if (P.gaps) { bits.push('<b>' + P.gaps + '</b> series-position' + (P.gaps === 1 ? '' : 's') + ' had no reading; those are <i>not ranked and not interpolated</i>, so the line breaks and the rest of the column is ranked among itself.'); }
  if (P.thinnedFrom > nx) { bits.push('drawn at <b>' + nx + '</b> of <b>' + P.thinnedFrom + '</b> x positions, every ' + Math.ceil(P.thinnedFrom / nx) + 'th; the standings shown are the standings that held at those positions.'); }

  var caption =
    'bump chart, <b>' + n + '</b> series across <b>' + nx + '</b> position' + (nx === 1 ? '' : 's') +
    ' (' + CK.esc(span) + '). <i>' + CK.esc(dirSentence) + '</i> ' + CK.esc(tieSentence) + ' ' +
    bits.join(' ');

  return { aria: aria, caption: caption };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, pad2, fmtX, mLine, mText, mPath, mDot, bpConfig, ranksAt,
                 packLabels, strokeRun, edgeLabels, bpNote, bpRender];

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
  const own = '.ck-bump[data-card="' + id + '"]';
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
    ['.ck-plot .ck-name', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    /* The tie bracket is drawn in the accent rather than in a series colour: it belongs to the
       pair, not to either member, and a series colour would suggest it did. */
    ['.ck-plot .ck-tie', 'stroke: var(--accent); stroke-width: 1.2; opacity: .55;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  if (!multi) return scope(id, rules) + '\n';

  /* Hover lifts one whole line. Following a single series through a crossing is the entire task a
     bump chart sets, and this is the only affordance that does it without a reader tracing by eye. */
  rules.push(['.ck-plot .ck-ser', 'transition: opacity .12s linear;']);
  rules.push(['.ck-plot:hover .ck-ser', 'opacity: .3;']);
  rules.push(['.ck-plot .ck-ser:hover', 'opacity: 1;']);
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, wide) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-bump">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="bump settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('direction') + '">rank 1 is</label>\n' +
    '    <select id="' + f('direction') + '" name="direction">' +
         opt('high-is-first', 'the highest value', defaults.direction) +
         opt('low-is-first', 'the lowest value', defaults.direction) + '</select>\n' +
    '    <label for="' + f('labels') + '">labels</label>\n' +
    '    <select id="' + f('labels') + '" name="labels">' +
         opt('both', 'both ends', defaults.labels) +
         opt('left', 'left only', defaults.labels) +
         opt('right', 'right only', defaults.labels) + '</select>\n' +
    '    <label for="' + f('dots') + '">dots</label>\n' +
    '    <input id="' + f('dots') + '" name="dots" type="checkbox"' +
           (defaults.dots ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">rank is computed from the values, never read from the data. Ties ' +
         'share the better rank and are drawn fanned apart under a bracket; the fan is a drawing ' +
         'device and carries no ordering.</p>\n' +
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
    '/* bump card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. Flipping the direction recomputes every rank from the values rather than\n' +
    '   mirroring the drawing, so a tie stays a tie and the caption stays true. */\n' +
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
    '     stays a translator rather than a second place where ranking decisions live. */\n' +
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
    '     a render that added marks would draw a second set of lines over the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = bpRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/bump');
}

/**
 * Build one bump card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame, captioned "no data"
 *   one series           one flat line at rank 1, and the caption says outright that a bump chart
 *                        of one series carries no information: it ranks against nothing
 *   one point per series a single column, so no line exists; each series draws a labelled dot at
 *                        its rank, which is the whole of what one column can say
 *   different x sets     aligned on the union, and a series with no reading at a position is NOT
 *                        RANKED there rather than interpolated: its line breaks and the others are
 *                        ranked among themselves. Interpolating a value to derive a rank would
 *                        show a series overtaking somebody on a day it reported nothing
 *   all values zero      every series is tied at rank 1 at every position, fanned and bracketed;
 *                        the caption counts the ties
 *   a negative value     ranked like any other; sign has no special meaning to an ordering
 *   50 series            50 rank rows at the 14px floor, about 730px tall; end labels are packed
 *                        and any that will not fit are dropped best-ranked-first, and counted
 *   5,000 points         thinned by stride to at most 300 columns; the standings shown are the
 *                        standings that actually held at the drawn positions
 *   a non-numeric value  refused while reading, counted, named; never coerced
 *   duplicate x          the last value at that x wins, and the overwrite is counted
 *   a supplied rank      ignored and counted; rank is derived here
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ series: [{ name, points: [{ x, value }] }], xLabel, unit }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'langs',
 *   title: 'language popularity by year',
 *   data: { unit: 'repos', xLabel: 'year',
 *           series: [{ name: 'rust', points: [{ x: 2022, value: 12 }, { x: 2023, value: 31 }] },
 *                    { name: 'go',   points: [{ x: 2022, value: 30 }, { x: 2023, value: 31 }] }] },
 *   ord: 42,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'bump' : id);
  const read = readData(data);

  const { xs, from } = alignX(read.series, read.series.length);
  let gaps = 0;
  const rows = read.series.map((s) => {
    const v = onGrid(s.pts, xs);
    for (const one of v) if (one === null) gaps++;
    return { name: s.name, v, n: s.pts.length };
  });

  const P = {
    xs, rows, gaps,
    isTime: read.isTime,
    xLabel: read.xLabel,
    unit: read.unit,
    refused: read.refused,
    dupes: read.dupes,
    suppliedRanks: read.suppliedRanks,
    thinnedFrom: from,
    W0, WMAX,
  };

  const seed = bpRender(P, defaults);
  const wide = seed.W > W0;

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      series: rows.length,
      x: xs.length,
      unranked: gaps,
      refusedPoints: read.refused,
      ignoredRanks: read.suppliedRanks,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, wide),
    css: cardCss(cardId, wide, seed.W, rows.length > 1),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
