/**
 * `slope` — Tufte's slopegraph: two time points, one line per series, labels at both ends.
 *
 * The form is almost nothing — two columns of numbers and the segments between them — and that is
 * the point: rank, magnitude and change are all readable at once, without a single axis. The whole
 * engineering problem is LABEL COLLISION. A slopegraph with twenty series has forty labels wanting
 * forty specific heights, many of them the same height, and the classic failure is a picture where
 * the lines are perfect and the names are an unreadable pile.
 *
 * So there is a real de-overlap pass here — cluster-and-centre followed by a monotone sweep, see
 * {@link packLabels} — and, more importantly, a stated answer for when it CANNOT be solved. Below
 * a floor of `n * pitch` pixels no arrangement exists, and rather than shrink the type past
 * legibility or let labels overprint, the labels that do not fit are dropped by a stated priority,
 * counted, and named in the caption. Every LINE is still drawn; it is the text that would not fit,
 * not the data.
 *
 * `CK` is loaded out of `kit.js` in a `node:vm` context, so `CK.scale` and `CK.ticks` here are the
 * same functions the page has.
 *
 * @see ./bump.mjs — the many-point sibling, which plots rank rather than value
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
  catch (e) { throw new Error('cardkit/slope: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/slope: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

const W0 = 640;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `highlight` is a series NAME rather than an index, because a name survives the data being
 * reordered and an index does not — and a viewer's stored setting outlives the data it was set
 * against.
 */
export const defaults = {
  values:    true,
  highlight: '',
  scale:     'shared',
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'slope',
  summary: 'A two-point slopegraph with a real de-overlap pass on the end labels.',
  shape: '{ series: [{ name, points: [{ x, y }] }], xLabel, yLabel, unit } — exactly two x positions; more and the first and last are used',
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
  const where = who || 'cardkit/slope';
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
 * Normalise whatever arrived, reduce it to two endpoints, and count every refusal.
 *
 * MORE THAN TWO x POSITIONS: a slopegraph has exactly two, so the FIRST and LAST across all series
 * are used and everything between them is ignored and counted. Refusing the data outright would be
 * unhelpful — asking "what changed between the ends" of a long series is a reasonable question —
 * but doing it silently would let a reader believe the middle was considered, so the caption names
 * both the positions used and the number of positions skipped.
 *
 * A series missing either endpoint has no slope at all and is refused, counted and named. There is
 * no interpolation: the two endpoints are the entire content of this chart, and inventing one of
 * them would invent the answer.
 *
 * DUPLICATE x WITHIN ONE SERIES: the last occurrence wins and the overwrite is counted.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ rows, x0, x1, isTime, xLabel, yLabel, unit, refused, dupes, skippedX, noEnds }`
 *
 * @example
 * readData({ series: [{ name: 'a', points: [{ x: 1, y: 2 }, { x: 9, y: 5 }] }] }).rows[0].b;   // 5
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.series) ? d.series : [];

  let refused = 0;
  let dupes = 0;
  let dated = 0;
  let plain = 0;
  const positions = new Set();

  const parsed = raw.map((s, i) => {
    const src = s && Array.isArray(s.points) ? s.points : [];
    const at = new Map();
    for (const p of src) {
      if (!p || typeof p !== 'object') { refused++; continue; }
      const rx = readX(p.x);
      const y = p.y;
      if (!rx || typeof y !== 'number' || !Number.isFinite(y)) { refused++; continue; }
      if (rx.date) dated++; else plain++;
      if (at.has(rx.v)) dupes++;
      at.set(rx.v, y);
      positions.add(rx.v);
    }
    return { name: String(s && s.name != null ? s.name : 'series ' + (i + 1)), at };
  });

  const all = [...positions].sort((a, b) => a - b);
  const x0 = all.length ? all[0] : 0;
  const x1 = all.length > 1 ? all[all.length - 1] : x0;

  const rows = [];
  const noEnds = [];
  for (const p of parsed) {
    if (all.length > 1 && p.at.has(x0) && p.at.has(x1)) rows.push({ name: p.name, a: p.at.get(x0), b: p.at.get(x1) });
    else if (all.length > 1) noEnds.push(p.name);
    else if (p.at.has(x0)) rows.push({ name: p.name, a: p.at.get(x0), b: p.at.get(x0) });
    else noEnds.push(p.name);
  }

  return {
    rows, x0, x1,
    onePoint: all.length < 2,
    isTime: dated > 0 && plain === 0,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    yLabel: d.yLabel == null ? '' : String(d.yLabel),
    unit:   d.unit   == null ? '' : String(d.unit),
    refused, dupes,
    skippedX: Math.max(0, all.length - 2),
    noEnds,
  };
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
  if (!isFinite(v)) { throw new Error('slope: non-finite coordinate (' + v + ')'); }
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
 * A compact label for one endpoint, in the units the axis is actually in.
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
function mLine(x1, y1, x2, y2, cls, attrs) {
  var a = { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'line', a: a };
}

/** A display-list text run; the sixth argument carries anything unusual, such as a rotation. */
function mText(x, y, s, cls, anchor, extra) {
  var a = { x: fin(x), y: fin(y), 'class': cls || '' }, k;
  if (anchor) { a['text-anchor'] = anchor; }
  if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { a[k] = extra[k]; } } }
  return { t: 'text', a: a, s: String(s) };
}

/** A display-list circle. */
function mDot(cx, cy, r, attrs) {
  var a = { cx: fin(cx), cy: fin(cy), r: fin(r) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'circle', a: a };
}

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function slConfig(cfg) {
  var c = cfg || {};
  return {
    values: c.values !== false,
    highlight: c.highlight == null ? '' : String(c.highlight),
    scale: c.scale === 'indexed' ? 'indexed' : 'shared',
  };
}

/**
 * Push overlapping labels apart, and leave every line exactly where it was.
 *
 * Cluster-and-centre, then a monotone sweep. Labels are walked in y order; each starts as its own
 * cluster, and while the newest cluster overlaps the one before it the two are merged and
 * re-centred on the mean of their members' wanted positions. That is the standard one-dimensional
 * de-overlap: merging only ever moves a cluster's centre toward the labels inside it, so the pass
 * settles without iterating. Clamping the clusters into the plot can re-introduce an overlap the
 * cluster pass has already finished with, which is what the two sweeps afterwards are for — they
 * guarantee the final spacing is at least `gap` whenever the region is tall enough to hold it.
 *
 * WHEN IT CANNOT BE SOLVED: `n * gap` is a hard floor. Below it no arrangement exists and this
 * function does not pretend otherwise — the caller checks the floor first, drops the labels that
 * will not fit by a stated priority, and the caption names how many. Shrinking the type instead
 * would trade a visible failure for an illegible one.
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
 * The values actually plotted, under whichever scale is in force, and what had to be refused.
 *
 * `shared` plots the numbers as given, on one axis, and answers "who is bigger, and who moved".
 *
 * `indexed` divides every series by its OWN first value and multiplies by 100, so every line
 * starts at 100 and the right-hand column is percent of its own start. That is a DIFFERENT
 * QUESTION: it answers "who grew fastest" and it deliberately destroys the comparison of
 * magnitudes — a series that went from 2 to 3 and one that went from 2,000 to 3,000 land on
 * exactly the same line. The caption says which question the chart is currently answering,
 * because the picture is otherwise identical in shape.
 *
 * A series whose first value is zero or negative cannot be indexed and is refused rather than
 * fudged. Zero is a division by zero. Negative is worse than that: dividing by it flips the sign,
 * so a value that fell would be drawn rising, and the chart would be confidently backwards about
 * the one thing it claims to show.
 *
 * @param rows  `{ name, a, b }` per series
 * @param scale 'shared' or 'indexed'
 * @returns `{ plot, refusedNames }`
 *
 * @example scaled([{ name: 'x', a: 50, b: 75 }], 'indexed').plot[0].b;   // 150
 */
function scaled(rows, scale) {
  var out = [], bad = [], i;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (scale !== 'indexed') { out.push({ name: r.name, a: r.a, b: r.b, ra: r.a, rb: r.b, i: i }); continue; }
    if (!(r.a > 0)) { bad.push(r.name); continue; }
    out.push({ name: r.name, a: 100, b: r.b / r.a * 100, ra: r.a, rb: r.b, i: i });
  }
  return { plot: out, refusedNames: bad };
}

/**
 * The whole picture, as a display list, from the shipped rows and the settled settings.
 *
 * Called in Node to draw the copy that ships inside card.html, and in the browser on every
 * settings change — including a change of scale, which re-derives every plotted value rather than
 * rescaling the drawing.
 *
 * @param P   the shipped payload: rows, endpoints, labels, refusal counts
 * @param cfg the settings, unsettled; {@link slConfig} settles them
 * @returns `{ W, H, marks, note }`
 *
 * @example slRender(payload, { scale: 'indexed' }).note.aria;
 */
function slRender(P, cfg) {
  var conf = slConfig(cfg);
  var sc = scaled(P.rows, conf.scale);
  var rows = sc.plot, n = rows.length, i;

  var pct = conf.scale === 'indexed';
  var suffix = pct ? '' : (P.unit ? ' ' + P.unit : '');

  var lo = 0, hi = 1;
  if (n) {
    lo = rows[0].a; hi = rows[0].a;
    for (i = 0; i < n; i++) {
      if (rows[i].a < lo) { lo = rows[i].a; }
      if (rows[i].b < lo) { lo = rows[i].b; }
      if (rows[i].a > hi) { hi = rows[i].a; }
      if (rows[i].b > hi) { hi = rows[i].b; }
    }
    if (!(hi > lo)) { var e = Math.abs(hi) * 0.5 || 1; lo = lo - e; hi = hi + e; }
  }

  var nameW = 0, valW = 0;
  for (i = 0; i < n; i++) {
    nameW = Math.max(nameW, tw(clipTo(rows[i].name, 120)));
    valW = Math.max(valW, tw(CK.fmt(rows[i].a) + suffix), tw(CK.fmt(rows[i].b) + suffix));
  }
  nameW = Math.min(120, nameW);
  if (!conf.values) { valW = 0; }

  var gutter = nameW + (conf.values ? valW + 8 : 0) + 16;
  var axisW = conf.values ? 0 : 34;

  var padT = 26;
  var padB = 16;
  var padL = gutter + axisW;
  var padR = gutter;

  var pitch = 11;
  var W = P.W0;
  /* The plot grows to hold its labels and then STOPS. Past about 720px a slopegraph is taller than
     the screen it is read on, so the two ends can no longer be compared at a glance, which is the
     only thing the form is for. Beyond that the de-overlap genuinely cannot be solved, and the
     card says how many labels it had to drop rather than growing into a column of text. */
  var inner = Math.max(120, Math.min(720, n * pitch + 20));
  var H = padT + padB + inner;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: padT + inner };

  var vScale = CK.scale([lo, hi], [plot.y1, plot.y0]);
  var marks = [];

  /* The two column rules ARE the chart's structure; there is no frame, because a frame would read
     as a container and these read as the two moments being compared. */
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-col'));
  marks.push(mLine(plot.x1, plot.y0, plot.x1, plot.y1, 'ck-col'));

  var xspan = P.x1 - P.x0;
  marks.push(mText(plot.x0, plot.y0 - 10, fmtX(P.x0, xspan, P.isTime), 'ck-head', 'middle'));
  marks.push(mText(plot.x1, plot.y0 - 10, fmtX(P.x1, xspan, P.isTime), 'ck-head', 'middle'));
  if (P.yLabel || pct) {
    marks.push(mText(plot.x0, 11, pct ? 'indexed: each series own start = 100' : P.yLabel,
                     'ck-key', 'start'));
  }

  /* A faint value axis only when the numbers are switched off. With them on, the numbers ARE the
     axis - which is the whole Tufte argument - and a second scale beside them is noise. */
  if (!conf.values && n) {
    var ticks = CK.ticks(lo, hi, 4), k;
    for (k = 0; k < ticks.length; k++) {
      marks.push(mText(plot.x0 - gutter + 4, vScale(ticks[k]) + 3.2, CK.fmt(ticks[k]), 'ck-tk', 'start'));
    }
  }

  var hit = -1;
  for (i = 0; i < n; i++) { if (conf.highlight && rows[i].name === conf.highlight) { hit = i; } }

  for (i = 0; i < n; i++) {
    var r = rows[i];
    var ya = vScale(r.a), yb = vScale(r.b);
    var on = hit < 0 || i === hit;
    var kids = [
      mLine(plot.x0, ya, plot.x1, yb, on ? 'ck-slope' : 'ck-slope ck-mute',
            { stroke: hit === i ? 'var(--accent)' : CK.hue(r.i),
              'stroke-width': hit === i ? '2.4' : '1.5' }),
      mDot(plot.x0, ya, 2.2, { fill: hit === i ? 'var(--accent)' : CK.hue(r.i), stroke: 'none' }),
      mDot(plot.x1, yb, 2.2, { fill: hit === i ? 'var(--accent)' : CK.hue(r.i), stroke: 'none' }),
    ];
    var g = { t: 'g', a: { 'data-series': String(r.i), 'class': on ? 'ck-ser' : 'ck-ser ck-mute' }, kids: kids };
    g.ti = r.name + ' \u00b7 ' + CK.fmt(r.ra) + ' to ' + CK.fmt(r.rb) + (P.unit ? ' ' + P.unit : '') +
           ' \u00b7 ' + (r.rb === r.ra ? 'no change'
             : (r.rb > r.ra ? '+' : '') + CK.fmt(r.rb - r.ra) +
               (r.ra > 0 ? ' (' + (r.rb > r.ra ? '+' : '') + CK.fmt((r.rb / r.ra - 1) * 100) + '%)' : ''));
    marks.push(g);
  }

  var dropped = 0;
  dropped += sideLabels(marks, rows, vScale, plot, pitch, 'a', nameW, valW, conf, hit, suffix);
  dropped += sideLabels(marks, rows, vScale, plot, pitch, 'b', nameW, valW, conf, hit, suffix);

  if (!n) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return {
    W: W, H: H, marks: marks,
    note: slNote(P, conf, rows, sc.refusedNames, dropped, hit, lo, hi),
  };
}

/**
 * One side's labels: packed, drawn, and leadered back to the endpoint they were moved away from.
 *
 * A leader is drawn only when a label actually moved more than 2px, so a chart whose labels all
 * fit shows no leaders at all and stays as quiet as Tufte intended. Without them a pushed label
 * silently claims the height it was pushed to, which on a chart whose only encoding is height is
 * the exact error the de-overlap was supposed to prevent.
 *
 * On the indexed scale every series starts at 100, so every LEFT label wants the identical height
 * and the pack has nothing to order them by. They are ordered by their right-hand value instead,
 * so the fan of names matches the fan of lines and the leaders do not cross each other.
 *
 * @param side 'a' for the left column, 'b' for the right
 * @returns how many labels had to be dropped
 */
function sideLabels(marks, rows, vScale, plot, pitch, side, nameW, valW, conf, hit, suffix) {
  var n = rows.length, i, order = [], dropped = 0;
  if (!n) { return 0; }
  var left = side === 'a';
  var x = left ? plot.x0 - 8 : plot.x1 + 8;

  for (i = 0; i < n; i++) { order.push(i); }

  var room = Math.floor((plot.y1 - plot.y0) / pitch);
  if (n > room) {
    /* Priority when it cannot be solved: the highlighted series first, because it is the one the
       reader asked for, then the largest values, because a slopegraph is read from the top. */
    order.sort(function (p, q) {
      if (p === hit) { return -1; }
      if (q === hit) { return 1; }
      return rows[q][side] - rows[p][side] || p - q;
    });
    dropped = n - room;
    order = order.slice(0, room);
  }

  order.sort(function (p, q) {
    return rows[p][side] === rows[q][side]
      ? (left ? rows[q].b - rows[p].b : rows[q].a - rows[p].a) || p - q
      : rows[q][side] - rows[p][side];
  });

  var want = [], m;
  for (i = 0; i < order.length; i++) { want.push(vScale(rows[order[i]][side])); }
  var placed = packLabels(want, pitch, plot.y0, plot.y1);

  for (i = 0; i < order.length; i++) {
    m = rows[order[i]];
    var y = placed[i] + 3.2;
    var accent = hit === order[i];
    if (Math.abs(placed[i] - want[i]) > 2) {
      marks.push(mLine(left ? plot.x0 - 5 : plot.x1 + 5, want[i],
                       left ? plot.x0 - 8 : plot.x1 + 8, placed[i], 'ck-lead'));
    }
    if (conf.values) {
      marks.push(mText(x, y, CK.fmt(m[side]) + suffix, accent ? 'ck-val ck-on' : 'ck-val',
                       left ? 'end' : 'start'));
      marks.push(mText(left ? x - valW - 6 : x + valW + 6, y, clipTo(m.name, nameW),
                       accent ? 'ck-name ck-on' : 'ck-name', left ? 'end' : 'start'));
    } else {
      marks.push(mText(x, y, clipTo(m.name, nameW), accent ? 'ck-name ck-on' : 'ck-name',
                       left ? 'end' : 'start'));
    }
  }
  return dropped;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The scale is named first, because `shared` and `indexed` produce pictures of identical shape
 * that answer different questions, and a reader who assumes the wrong one reads every line
 * backwards in magnitude. Everything the de-overlap had to give up is named too: a dropped label
 * is a fact about the picture, not an implementation detail.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function slNote(P, conf, rows, refusedNames, dropped, hit, lo, hi) {
  var n = rows.length, unit = P.unit ? ' ' + P.unit : '';
  var span = fmtX(P.x0, P.x1 - P.x0, P.isTime) + ' to ' + fmtX(P.x1, P.x1 - P.x0, P.isTime);
  var pct = conf.scale === 'indexed';

  if (!n) {
    return {
      aria: 'Slopegraph with no data: no series has both endpoints.',
      caption: 'a slopegraph with <b>no data</b> &mdash; nothing here has a value at both ends, ' +
               'so there is no slope to draw.',
    };
  }

  var up = 0, down = 0, flat = 0, i, best = rows[0], worst = rows[0];
  for (i = 0; i < n; i++) {
    var d = rows[i].rb - rows[i].ra;
    if (d > 0) { up++; } else if (d < 0) { down++; } else { flat++; }
    if (rows[i].rb - rows[i].ra > best.rb - best.ra) { best = rows[i]; }
    if (rows[i].rb - rows[i].ra < worst.rb - worst.ra) { worst = rows[i]; }
  }

  var scaleSentence = pct
    ? 'INDEXED: every series is divided by its own first value and starts at 100, so this chart ' +
      'answers who grew fastest and NOT who is bigger - a series going 2 to 3 and one going 2,000 ' +
      'to 3,000 draw the same line.'
    : 'SHARED scale: both ends are the values as given, so rank, magnitude and change are all ' +
      'readable at once.';

  var aria =
    'Slopegraph of ' + n + ' series between ' + span + '. ' + scaleSentence + ' ' +
    up + ' rose, ' + down + ' fell, ' + flat + ' were unchanged. The largest rise is ' +
    best.name + ', ' + CK.fmt(best.ra) + ' to ' + CK.fmt(best.rb) + unit + '; the largest fall is ' +
    worst.name + ', ' + CK.fmt(worst.ra) + ' to ' + CK.fmt(worst.rb) + unit + '.';

  var bits = [];
  if (dropped) {
    bits.push('<b>' + dropped + '</b> end label' + (dropped === 1 ? '' : 's') + ' could not be ' +
              'placed: ' + n + ' names need <b>' + (n * 11) + 'px</b> at the 11px minimum pitch and ' +
              'this plot is capped at 720px, so below that floor <i>no arrangement exists</i> and ' +
              'spreading them further would only make them wrong. The <i>lines are all still ' +
              'drawn</i>; the highlighted series and the largest values kept their labels.');
  }
  if (refusedNames.length) {
    bits.push('<b>' + refusedNames.length + '</b> series could not be indexed because ' +
              (refusedNames.length === 1 ? 'its' : 'their') + ' first value is zero or negative (' +
              CK.esc(refusedNames.join(', ')) + ') &mdash; dividing by it would be undefined, or ' +
              'would flip the sign and draw a fall as a rise.');
  }
  if (P.noEnds.length) {
    bits.push('<b>' + P.noEnds.length + '</b> series lacked a value at one of the two positions and ' +
              (P.noEnds.length === 1 ? 'is' : 'are') + ' not drawn (' + CK.esc(P.noEnds.join(', ')) +
              ') &mdash; the two endpoints are the whole content here, so neither is interpolated.');
  }
  if (P.skippedX) {
    bits.push('the data had <b>' + (P.skippedX + 2) + '</b> x positions; a slopegraph has two, so the ' +
              'first and last are drawn and <b>' + P.skippedX + '</b> between them ' +
              (P.skippedX === 1 ? 'is' : 'are') + ' <i>not considered at all</i>.');
  }
  if (P.onePoint) { bits.push('<i>only one x position exists</i>, so both ends are the same reading and every line is flat.'); }
  if (conf.highlight && hit < 0) { bits.push('the highlighted name <i>' + CK.esc(conf.highlight) + '</i> matches no series here.'); }
  if (P.refused) { bits.push('<b>' + P.refused + '</b> point' + (P.refused === 1 ? '' : 's') + ' had no usable x or y and ' + (P.refused === 1 ? 'was' : 'were') + ' dropped.'); }
  if (P.dupes) { bits.push('<b>' + P.dupes + '</b> duplicate x within a series; the last value at each x wins.'); }

  var caption =
    'slopegraph, <b>' + n + '</b> series between <b>' + CK.esc(span) + '</b>. ' +
    '<i>' + CK.esc(scaleSentence) + '</i> ' +
    '<b>' + up + '</b> up, <b>' + down + '</b> down, <b>' + flat + '</b> flat. ' +
    bits.join(' ');

  return { aria: aria, caption: caption };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, pad2, fmtX, mLine, mText, mDot, slConfig, packLabels,
                 scaled, sideLabels, slNote, slRender];

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
  const own = '.ck-slope[data-card="' + id + '"]';
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
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-name', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-val', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-on', 'fill: var(--accent);'],
    ['.ck-plot .ck-head', 'fill: var(--ink); font-size: 10px; letter-spacing: .05em;'],
    ['.ck-plot .ck-key', 'fill: var(--ink-faint); letter-spacing: .03em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-col', 'stroke: var(--rule); stroke-width: 1;'],
    /* The leader is deliberately fainter than everything it connects: it is an apology for having
       moved a label, not a mark the reader is meant to follow first. */
    ['.ck-plot .ck-lead', 'stroke: var(--ink-faint); stroke-width: .7; opacity: .55;'],
    ['.ck-plot .ck-mute', 'opacity: .28;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    ['.ck-plot .ck-ser', 'transition: opacity .12s linear;'],
    ['.ck-plot .ck-ser:hover', 'opacity: 1;'],
  ];
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-slope">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="slopegraph settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('scale') + '">scale</label>\n' +
    '    <select id="' + f('scale') + '" name="scale">' +
         opt('shared', 'shared values', defaults.scale) +
         opt('indexed', 'indexed to 100', defaults.scale) + '</select>\n' +
    '    <label for="' + f('values') + '">show numbers</label>\n' +
    '    <input id="' + f('values') + '" name="values" type="checkbox"' +
           (defaults.values ? ' checked' : '') + '>\n' +
    '    <label for="' + f('highlight') + '">highlight</label>\n' +
    '    <input id="' + f('highlight') + '" name="highlight" type="text" placeholder="a series name" ' +
           'value="' + CK.esc(defaults.highlight) + '">\n' +
    '    <p class="ck-set-foot">indexing sets every series own first value to 100, which changes ' +
         'the question from who is bigger to who grew fastest; magnitudes become uncomparable. ' +
         'With numbers off, a faint value scale appears in their place.</p>\n' +
    '  </div>\n' +
    '  ' + plot + '\n' +
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
    '/* slopegraph card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The de-overlap pass runs here too, so a label that fits at one setting and not at\n' +
    '   another is dropped and counted rather than silently overprinted. */\n' +
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
    '     stays a translator rather than a second place where slopegraph decisions live. */\n' +
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
    '     a render that added marks would draw a second set of slopes over the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = slRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/slope');
}

/**
 * Build one slopegraph card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame, captioned "no data"
 *   one series           one line, which is a perfectly good slopegraph: it still says the
 *                        direction, the size of the change and both magnitudes
 *   one x position only  both ends are the same reading, so every line is flat; the caption says
 *                        so rather than letting a flat chart look like a finding
 *   more than two x      the FIRST and LAST are drawn and everything between is ignored and
 *                        counted; the caption names how many positions were not considered
 *   a missing endpoint   the series has no slope and is refused, counted and named. Neither
 *                        endpoint is interpolated, because the two endpoints are the entire
 *                        content of this chart
 *   all values zero      the domain collapses, so it is padded and every line is flat at zero;
 *                        indexed mode refuses every series, since none can be divided by its start
 *   a negative value     drawn on the shared scale like any other. On the indexed scale a series
 *                        whose FIRST value is negative or zero is refused: dividing by it is
 *                        undefined or flips the sign, drawing a fall as a rise
 *   50 series            50 labels a side need 550px at the 11px pitch; the plot grows to fit, and
 *                        where it cannot, labels are dropped by priority and counted while every
 *                        line is still drawn
 *   5,000 points         only two of them can be drawn; the rest are counted as skipped positions
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
 *   id: 'spend',
 *   title: 'health spending per head, 1970 and 2020',
 *   data: { unit: 'USD',
 *           series: [{ name: 'US', points: [{ x: 1970, y: 350 }, { x: 2020, y: 11800 }] },
 *                    { name: 'UK', points: [{ x: 1970, y: 160 }, { x: 2020, y: 5000 }] }] },
 *   ord: 38,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'slope' : id);
  const read = readData(data);

  const P = {
    rows: read.rows,
    x0: read.x0,
    x1: read.x1,
    onePoint: read.onePoint,
    isTime: read.isTime,
    xLabel: read.xLabel,
    yLabel: read.yLabel,
    unit: read.unit,
    refused: read.refused,
    dupes: read.dupes,
    skippedX: read.skippedX,
    noEnds: read.noEnds,
    W0,
  };

  const seed = slRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      series: read.rows.length,
      droppedSeries: read.noEnds.length,
      skippedX: read.skippedX,
      refusedPoints: read.refused,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed),
    css: cardCss(cardId),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
