/**
 * `cycletime` — one dot per completed item, with percentiles and no mean anywhere on the card.
 *
 * This is the scatter that replaces estimation. Completion date on x, cycle time on y, one dot per
 * finished item, and horizontal lines at the 50th, 85th and 95th percentiles. A team that has this
 * chart does not need to estimate a ticket; it needs to know that 85 of its last hundred finished
 * in nine days or less, and to say nine days.
 *
 * THERE IS NO MEAN ON THIS CARD AND THERE WILL NOT BE ONE. Cycle-time distributions are
 * right-skewed — a long tail of items that got stuck behind something — so the mean sits above the
 * median and describes almost nobody: it is larger than most items and smaller than the ones that
 * actually hurt. The tail is the entire reason anybody asks how long things take, and an average
 * is precisely the summary that hides it.
 *
 * THE PERCENTILE METHOD IS NEAREST-RANK, and that choice is not cosmetic. The p-th percentile is
 * the value at position `ceil(p n / 100)` in the ascending sample, so it is always a cycle time
 * some real item actually had, and the claim it licenses is literally true: "85 of every 100 items
 * finished in this or less". The interpolating definitions — type 7, which `histogram` and
 * `boxplot` in this catalogue use — return a number between two observations, which can be BELOW
 * the 85th item and so cannot support that sentence. Interpolation is right for describing a
 * continuous distribution and wrong for making a promise about a count of tickets.
 *
 * A PERCENTILE FROM NINE ITEMS IS A NUMBER PRETENDING TO BE A STATISTIC, so each one is drawn only
 * when the sample can carry it. The rule is derived rather than asserted: a percentile is drawn
 * when the two-sided 95 per cent distribution-free confidence interval for its RANK fits inside
 * the sample. That works out at 8 items for the 50th, 22 for the 85th and 73 for the 95th —
 * numbers this card computes rather than hard-codes, in {@link minN}. Below the threshold the line
 * is not drawn and the caption says what the threshold is and how far short the sample fell.
 *
 * Everything geometric is computed by {@link ctRender}, the same function in Node and in the
 * browser: Node runs it once for the picture that ships inside `card.html`, the browser re-runs it
 * when a setting changes. `CK` is loaded out of `kit.js` in a `node:vm` context, so `CK.scale`,
 * `CK.ticks` and `CK.hue` here are the ones the page has.
 *
 * @see ./cfd.mjs         the same quantity inferred from a stack instead of measured per item
 * @see ./montecarlo.mjs  the forward-looking sibling; this describes the past, that forecasts
 * @see ./histogram.mjs   type-7 quantiles, deliberately a different definition; see above
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
 * @example loadKit().ticks(0, 100, 5);   // [0, 50, 100]
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/cycletime: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/cycletime: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets and constants ───────────────────────────────────────────────────────────── */

const W0   = 660;
const H0   = 330;
const WMAX = 2200;

/* Every item is a dot AND a line of the card's static markup, so this is a real budget rather than
   a payload one. Above it the sample is thinned systematically over the completion-date order —
   which is independent of cycle time, so the percentiles of the thinned sample estimate the same
   quantity — and the caption names the stride. */
const SHIP_MAX = 2000;

/* Per-dot tooltips stop being worth their weight around here: a thousand title elements is a
   thousand nodes for a hover nobody will land on. */
const TIP_CAP = 400;

/* The percentiles this card draws. Fifty, eighty-five and ninety-five: the middle, the number a
   team can commit to, and the number a team should quote when somebody asks for a guarantee. */
const PS = [50, 85, 95];

/* The normal quantile for a two-sided 95 per cent interval. It appears in the rank confidence
   interval and therefore in the minimum sample size for every percentile, so it is written once. */
const Z95 = 1.959964;

/* A label longer than this is cut. Labels ride in the payload once per item. */
const LABEL_MAX = 60;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `split` is off by default and the caption is sceptical of it when it is on, because splitting a
 * hundred items five ways leaves five samples of twenty, and a 95th percentile does not exist at
 * twenty. The setting is offered because the split is sometimes real; the scepticism is attached
 * because it usually is not.
 */
export const defaults = {
  split: false,
  logY:  false,
  bands: true,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'cycletime',
  summary: 'One dot per completed item with nearest-rank percentiles, and never a mean.',
  shape: '{ items: [{ id, started, completed, group, label }], unit } — unit is days or hours',
  category: 'distribution',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one card
 * in this catalogue was refused because a comment said "the class is what CSS reads" — and a guard
 * that cries wolf is a guard somebody switches off. Offsets are preserved so a reported position
 * still points at the right place. Regex literals are recognised, because otherwise the scanner
 * desynchronises on the quote inside `replace(/'/g, x)` and starts blanking real code, which turns
 * a false positive into a far worse false negative.
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
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in a
 * comment as readily as in code, because `Function.prototype.toString()` ships comments verbatim —
 * closes the surrounding template literal early and blanks every card on the desk. The backtick is
 * never written here; it is reached for as `String.fromCharCode(96)`, which cannot be mistyped and
 * cannot be mis-decoded during emission.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/cycletime';
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
     plausible-looking regex that holds the raw byte it meant to describe. */
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
 * One timestamp as epoch milliseconds, or `null`.
 *
 * A string that does not parse is refused rather than coerced: `Number('')` is 0 and
 * `new Date('soon')` is not a time, and either would place a dot at the epoch and stretch the axis
 * back to 1970 until every real dot is one pixel wide.
 *
 * @example readT('2024-03-01');   // 1709251200000
 * @example readT('soon');         // null
 */
function readT(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting every
 * refusal so the caption can name it.
 *
 * A NEGATIVE cycle time is refused and counted separately from an unparseable date, because it
 * means something different: the dates parsed fine and the item finished before it started, which
 * is a defect in the source system rather than in the export. Clamping it to zero would put a dot
 * on the floor that looks like an item that took no time, which is a different and false claim.
 *
 * A ZERO cycle time is KEPT. An item started and finished in the same instant is a real event on a
 * board where the ticket is written after the work, and refusing it would quietly delete the
 * fastest part of the distribution.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ items, groups, unit, divisor, badDate, negative, refused }`
 *
 * @example readData({ items: [{ started: 0, completed: 86400000 }] }).items[0].y;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.items) ? d.items : [];
  const unit = String(d.unit || 'days') === 'hours' ? 'hours' : 'days';
  const divisor = unit === 'hours' ? 3600000 : 86400000;

  const groups = [];
  const index = new Map();
  const items = [];
  let badDate = 0;
  let negative = 0;
  let refused = 0;

  for (const it of raw) {
    if (!it || typeof it !== 'object') { refused++; continue; }
    const a = readT(it.started);
    const b = readT(it.completed);
    if (a === null || b === null) { badDate++; continue; }
    if (b < a) { negative++; continue; }

    const gname = it.group == null || String(it.group) === '' ? '(all items)' : String(it.group);
    if (!index.has(gname)) { index.set(gname, groups.length); groups.push(gname); }

    items.push({
      x: b,
      y: (b - a) / divisor,
      g: index.get(gname),
      l: it.label == null ? (it.id == null ? '' : String(it.id)) : String(it.label),
    });
  }
  for (const it of items) it.l = it.l.slice(0, LABEL_MAX);

  return { items, groups, unit, divisor, badDate, negative, refused };
}

/**
 * Thin a list to at most `cap` entries by taking every k-th, keeping the last.
 *
 * Systematic over the COMPLETION-DATE order, which is independent of cycle time, so the kept
 * subset is a stratified sample in time rather than a biased one in the quantity being estimated —
 * the percentiles of the thinned sample estimate the same numbers as the percentiles of the whole.
 * Deterministic, so a replay draws the same picture.
 *
 * @example thin([1, 2, 3, 4, 5, 6, 7], 3);   // [1, 4, 7]
 */
function thin(list, cap) {
  if (!(cap > 0) || list.length <= cap) return list.slice();
  const k = Math.ceil(list.length / cap);
  const out = [];
  for (let i = 0; i < list.length; i += k) out.push(list[i]);
  if (out.length && out[out.length - 1] !== list[list.length - 1]) out.push(list[list.length - 1]);
  return out;
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything from here to the SHIPPED list runs in BOTH halves: Node calls it to draw the card
   that ships, and the browser calls the identical text after a settings change. It is therefore
   written in the browser's vocabulary — var and function, no arrows, no template literals, no
   backtick in any comment — and it may only reach for CK, which is a module constant here and a
   global there. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite centre makes a circle vanish with nothing in the console, and here a vanished
 * circle is a lost observation rather than a cosmetic fault.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) { throw new Error('cardkit/cycletime: non-finite coordinate (' + v + ')'); }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face; measured, not guessed. */
function tw(s) { return String(s).length * 5.42; }

/** Two digits, so a month or a day aligns with the rest of the label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A compact label for one instant, at a resolution the window can support.
 *
 * UTC getters throughout: a date written as a plain day parses to UTC midnight, so reading it back
 * in the viewer's zone can print the day before, and an axis that disagrees with the strings it
 * was handed is worse than a coarse one.
 *
 * @example fmtT(1709251200000, 86400000 * 400);   // '2024-03'
 */
function fmtT(x, span) {
  var d = new Date(x), DAY = 86400000;
  if (span > DAY * 1100) { return String(d.getUTCFullYear()); }
  if (span > DAY * 70) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  if (span > DAY * 2) { return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

/**
 * Ticks that reach the ends of the axis instead of stopping short of them.
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

/** Ticks at 1, 2 and 5 times each power of ten inside a decade-snapped log domain. */
function logTicks(lo, hi) {
  var out = [], e, m, v, mult = [1, 2, 5];
  var e0 = Math.floor(Math.log(lo) / Math.LN10);
  var e1 = Math.ceil(Math.log(hi) / Math.LN10);
  for (e = e0; e <= e1; e++) {
    for (m = 0; m < 3; m++) {
      v = mult[m] * Math.pow(10, e);
      if (v >= lo * 0.999 && v <= hi * 1.001) { out.push(v); }
    }
  }
  if (out.length < 2) { return [lo, hi]; }
  return out;
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

/** A display-list rectangle; negative extents are clamped rather than emitted as invalid SVG. */
function mRect(x, y, w, h, attrs) {
  var a = { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'rect', a: a };
}

/** A display-list circle. */
function mDot(cx, cy, r, attrs) {
  var a = { cx: fin(cx), cy: fin(cy), r: fin(r) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'circle', a: a };
}

/**
 * The nearest-rank percentile: the value at position `ceil(p n)` of the ascending sample.
 *
 * Always an observation the sample actually contains, which is the property the card's whole claim
 * rests on — "85 of every 100 finished in this or less" is literally true of a nearest-rank
 * percentile and is not true of an interpolated one, which can fall between the 85th item and the
 * 84th and so be beaten by fewer than 85 of them.
 *
 * @param sorted the sample, already ascending
 * @param p      a probability in 0..1
 * @returns the percentile, or 0 for an empty sample
 *
 * @example nearRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.85);   // 9
 */
function nearRank(sorted, p) {
  var n = sorted.length;
  if (!n) { return 0; }
  var k = Math.ceil(p * n);
  if (k < 1) { k = 1; }
  if (k > n) { k = n; }
  return sorted[k - 1];
}

/**
 * The distribution-free confidence interval for the RANK of a percentile.
 *
 * The number of observations below the p-quantile is binomial with parameters `n` and `p`, whatever
 * the underlying distribution is — which is what makes this interval free of any assumption about
 * the shape of the cycle-time distribution, and cycle times are the last thing anybody should
 * assume a shape for. The normal approximation to that binomial gives the rank interval
 * `np +/- z sqrt(np(1-p))`, and the sample values at those ranks are the interval's endpoints.
 *
 * `ok` is false when either end of the interval falls outside the sample. That is the honest
 * failure: an upper bound of rank 74 in a sample of 60 does not mean the percentile is the maximum,
 * it means the sample cannot say where the percentile is.
 *
 * @param n the sample size
 * @param p a probability in 0..1
 * @param z the normal quantile for the wanted confidence, 1.96 for 95 per cent
 * @returns `{ lo, hi, ok }` — one-based ranks
 *
 * @example rankCI(100, 0.85, 1.959964);   // { lo: 78, hi: 92, ok: true }
 */
function rankCI(n, p, z) {
  var k = n * p;
  var sd = Math.sqrt(n * p * (1 - p));
  var lo = Math.floor(k - z * sd);
  var hi = Math.ceil(k + z * sd);
  return { lo: lo, hi: hi, ok: n > 0 && lo >= 1 && hi <= n };
}

/**
 * The smallest sample in which a percentile's rank interval fits, found by search.
 *
 * Searched rather than solved, because the closed form is a quadratic in the square root of n and
 * a sign slip in it would produce a plausible wrong threshold that nothing else in the file would
 * contradict. The search is by construction consistent with {@link rankCI}: the answer is the
 * first `n` at which that function says yes.
 *
 * At 95 per cent confidence this gives 8 for the 50th percentile, 22 for the 85th and 73 for the
 * 95th. That last number is the one worth staring at: a 95th percentile needs about seventy-three
 * completed items before it is a statistic rather than a rumour, and it is roughly where the
 * practitioners' rule of thumb — three to six months of a team's throughput — independently
 * landed.
 *
 * @param p a probability in 0..1
 * @param z the normal quantile for the wanted confidence
 * @returns the smallest usable sample size, or the search cap when none is found
 *
 * @example minN(0.95, 1.959964);   // 73
 */
function minN(p, z) {
  var n;
  for (n = 1; n <= 5000; n++) { if (rankCI(n, p, z).ok) { return n; } }
  return 5000;
}

/**
 * Every percentile row for one sample, with its interval and its verdict.
 *
 * @param vals an unsorted list of cycle times
 * @param P    the shipped payload, for `ps` and `z`
 * @returns `{ sorted, n, min, max, rows }`; each row is
 *          `{ p, n, ok, v, lo, hi, need }` and `ok` false means the line is not drawn
 *
 * @example ctStats([1, 2, 3], { ps: [50], z: 1.959964 }).rows[0].ok;   // false
 */
function ctStats(vals, P) {
  var s = vals.slice(), i, p, ci, rows = [];
  s.sort(function (a, b) { return a - b; });
  for (i = 0; i < P.ps.length; i++) {
    p = P.ps[i] / 100;
    ci = rankCI(s.length, p, P.z);
    rows.push({
      p: P.ps[i], n: s.length, ok: ci.ok,
      v: nearRank(s, p),
      lo: ci.ok ? s[ci.lo - 1] : 0,
      hi: ci.ok ? s[ci.hi - 1] : 0,
      need: minN(p, P.z),
    });
  }
  return { sorted: s, n: s.length, min: s.length ? s[0] : 0, max: s.length ? s[s.length - 1] : 0, rows: rows };
}

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function ctConfig(cfg) {
  var c = cfg || {};
  return { split: !!c.split, logY: !!c.logY, bands: c.bands !== false };
}

/**
 * The vertical scale, linear or logarithmic, with the ticks that go with it.
 *
 * A log axis is offered because one item that took two hundred days flattens every other dot onto
 * the bottom rule, and the flattened dots are the ones the team actually delivers. It is not the
 * default, because a log axis makes a distribution look tamer than it is and the tail is the point
 * of the card.
 *
 * A cycle time of exactly zero has no place on a log axis. It is not dropped and it is not moved:
 * it is pinned to the floor rule, drawn with its own class, and counted, so that the reader can
 * see that the bottom line holds items rather than nothing.
 *
 * @returns `{ log, lo, hi, ticks, f }` — `f` maps a value to a y pixel
 *
 * @example ctScaleY({ logY: false }, { hi: 10, loPos: 1 }, { y0: 0, y1: 100 }).log;   // false
 */
function ctScaleY(conf, dom, plot) {
  var a, b, s;
  if (conf.logY && dom.loPos > 0 && dom.hi > 0) {
    a = Math.floor(Math.log(dom.loPos) / Math.LN10);
    b = Math.ceil(Math.log(dom.hi) / Math.LN10);
    if (b <= a) { b = a + 1; }
    s = CK.scale([a, b], [plot.y1, plot.y0]);
    return {
      log: true, lo: Math.pow(10, a), hi: Math.pow(10, b),
      ticks: logTicks(Math.pow(10, a), Math.pow(10, b)),
      f: function (v) { return v > 0 ? s(Math.log(v) / Math.LN10) : plot.y1; },
    };
  }
  var ax = axisTicks(0, dom.hi > 0 ? dom.hi : 1, 5);
  var s2 = CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
  return { log: false, lo: ax.lo, hi: ax.hi, ticks: ax.ticks, f: s2 };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption states the percentile method, states what the 85th line MEANS in the only words that
 * are true of it, and refuses to summarise with an average. Where a percentile could not be drawn
 * it says the threshold and the shortfall, because a missing line with no explanation reads as a
 * rendering bug rather than as a refusal.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function ctNote(P, conf, lanes, dom, zeros, drawn) {
  var u = P.unit === 'hours' ? ' h' : ' d';
  var i, j, r;

  if (!P.items.length) {
    return {
      aria: 'Cycle-time scatter with no data: nothing completed, so no percentile is claimed.',
      caption: 'a cycle-time scatter with <b>no data</b> &mdash; the frame is drawn so the card ' +
        'keeps its place. ' +
        (P.badDate ? '<i>' + CK.esc(String(P.badDate)) + ' item' + (P.badDate === 1 ? ' had' : 's had') +
          ' an unparseable start or completion date</i> and were refused. ' : '') +
        (P.negative ? '<i>' + CK.esc(String(P.negative)) + ' item' + (P.negative === 1 ? '' : 's') +
          ' finished before starting</i> and were refused rather than clamped to zero. ' : '') +
        'no percentile is drawn, because there is nothing to rank.',
    };
  }

  var main = lanes[0];
  var p85 = null, p50 = null, p95 = null;
  for (i = 0; i < main.stats.rows.length; i++) {
    r = main.stats.rows[i];
    if (r.p === 50) { p50 = r; }
    if (r.p === 85) { p85 = r; }
    if (r.p === 95) { p95 = r; }
  }

  var aria = 'Cycle-time scatter of ' + drawn + ' completed item' + (drawn === 1 ? '' : 's') +
    (lanes.length > 1 ? ' in ' + lanes.length + ' groups' : '') +
    ', completion date across and cycle time up, from ' + CK.fmt(main.stats.min) + u +
    ' to ' + CK.fmt(main.stats.max) + u + '. ' +
    (p85 && p85.ok
      ? 'Eighty-five in every hundred finished in ' + CK.fmt(p85.v) + u + ' or less' +
        (p50 && p50.ok ? ', half in ' + CK.fmt(p50.v) + u + ' or less' : '') +
        (p95 && p95.ok ? ', ninety-five in ' + CK.fmt(p95.v) + u + ' or less' : '') + '. '
      : 'No percentile line could be drawn: the sample is too small for its rank interval to fit ' +
        'inside it. ') +
    'Percentiles are nearest-rank, so each is a cycle time some item actually had. There is no ' +
    'mean on this chart, because the distribution is right-skewed and a mean would describe ' +
    'almost nobody.';

  var lead = '<b>' + CK.esc(String(drawn)) + '</b> completed item' + (drawn === 1 ? '' : 's') +
    (drawn !== P.total ? ' of <b>' + CK.esc(String(P.total)) + '</b>' : '') +
    (lanes.length > 1 ? ' in <b>' + CK.esc(String(lanes.length)) + '</b> groups' : '') + '. ';

  var head = [];
  for (i = 0; i < lanes.length; i++) {
    var parts = [];
    for (j = 0; j < lanes[i].stats.rows.length; j++) {
      r = lanes[i].stats.rows[j];
      if (r.ok) { parts.push('p' + r.p + ' <b>' + CK.esc(CK.fmt(r.v) + u) + '</b>'); }
    }
    if (parts.length) {
      head.push((lanes.length > 1 ? CK.esc(lanes[i].name) + ': ' : '') + parts.join(', '));
    }
  }
  lead += head.length ? head.join(' &middot; ') + '. ' : '';

  lead += '<i>the 85th percentile means 85 of every 100 finished in that or less. It does not ' +
    'mean most take about that.</i> Percentiles are <b>nearest-rank</b> \u2014 the value at ' +
    'position ceil(p n) of the sorted sample, so every line is a cycle time some item really had. ' +
    'There is no mean anywhere on this card: cycle times are right-skewed, so the mean sits above ' +
    'the median and describes almost nobody. ';

  var bits = [];

  /* Every percentile the sample could not carry, named with its threshold. A line that is simply
     missing reads as a rendering fault; a line that is missing with a number attached reads as a
     refusal, which is what it is. */
  for (i = 0; i < lanes.length; i++) {
    for (j = 0; j < lanes[i].stats.rows.length; j++) {
      r = lanes[i].stats.rows[j];
      if (r.ok) { continue; }
      bits.push('the <b>' + r.p + 'th percentile</b>' +
        (lanes.length > 1 ? ' for ' + CK.esc(lanes[i].name) : '') +
        ' is not drawn: it needs <b>' + r.need + '</b> items before its 95 per cent rank interval ' +
        'fits inside the sample, and there ' + (r.n === 1 ? 'is' : 'are') + ' ' + r.n);
    }
  }

  if (conf.split && lanes.length > 1) {
    var thin85 = 0;
    for (i = 0; i < lanes.length; i++) {
      for (j = 0; j < lanes[i].stats.rows.length; j++) {
        if (lanes[i].stats.rows[j].p === 85 && !lanes[i].stats.rows[j].ok) { thin85++; }
      }
    }
    if (thin85) {
      bits.push('<i>the split is doing harm</i>: ' + thin85 + ' of ' + lanes.length +
        ' groups cannot support even an 85th percentile once divided. A percentile drawn from a ' +
        'handful of items is a number pretending to be a statistic; the pooled sample is the one ' +
        'that can answer the question');
    }
  } else if (!conf.split && P.groups.length > 1) {
    bits.push('all <b>' + P.groups.length + '</b> groups are pooled into one sample; splitting ' +
      'them is a setting, and the card will say if the split leaves any group too thin to rank');
  }

  if (conf.bands) {
    bits.push('the faint band around each line is the distribution-free 95 per cent confidence ' +
      'interval for that percentile, taken from the binomial interval on its RANK \u2014 it ' +
      'assumes nothing about the shape of the distribution, which is the only safe assumption to ' +
      'make about cycle times');
  }
  if (conf.logY) {
    bits.push('the vertical axis is logarithmic, which makes the tail look tamer than it is; the ' +
      'percentile values above are unchanged by it');
  }
  if (zeros) {
    bits.push('<b>' + zeros + '</b> item' + (zeros === 1 ? '' : 's') + ' had a cycle time of zero ' +
      'and cannot be placed on a log axis; they are pinned to the floor rule and marked, not dropped');
  }
  if (P.sameDay) {
    bits.push('every item completed within one day, so the dots stack in a single column and only ' +
      'the vertical spread is readable');
  }
  if (p95 && p95.ok && main.stats.max > p95.v * 3) {
    bits.push('the slowest item took ' + CK.esc(CK.fmt(main.stats.max) + u) + ', more than three ' +
      'times the 95th percentile \u2014 it is the reason the linear axis looks flat, and it is a ' +
      'real item rather than an error');
  }
  if (P.negative) {
    bits.push('<b>' + P.negative + '</b> item' + (P.negative === 1 ? '' : 's') +
      ' finished before starting and were <i>refused</i>, not clamped to zero: a clamped one would ' +
      'sit on the floor looking like an item that took no time');
  }
  if (P.badDate) {
    bits.push('<b>' + P.badDate + '</b> item' + (P.badDate === 1 ? '' : 's') +
      ' had a start or completion date that would not parse and were refused; never coerced, ' +
      'because a failed parse becomes the epoch');
  }
  if (P.refused) {
    bits.push('<b>' + P.refused + '</b> row' + (P.refused === 1 ? '' : 's') + ' were not objects at all');
  }
  if (P.thinned) {
    bits.push('the sample was thinned to <b>' + P.shipped + '</b> of <b>' + P.total +
      '</b> items, every ' + P.stride + 'th in completion order \u2014 which is independent of ' +
      'cycle time, so the percentiles estimate the same numbers');
  }
  if (!P.tips) {
    bits.push('per-dot labels are off above ' + P.tipCap + ' dots');
  }

  return {
    aria: aria,
    caption: lead + (bits.length ? '<span class="ck-aside">' + bits.join('; ') + '.</span>' : ''),
  };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settled settings: `split`, `logY`, `bands`
 * @returns `{ W, H, marks, note }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable items were refused and counted while reading
 *
 * @example ctRender(P, { split: false, logY: false, bands: true }).marks.length;
 */
function ctRender(P, cfg) {
  var conf = ctConfig(cfg);
  var marks = [], i, j, r;
  var pts = P.items;
  var n = pts.length;

  /* The lanes: one per group when split, one pooled lane otherwise. Statistics are computed per
     lane, because a percentile of a pooled sample is not the percentile of any of its parts. */
  var lanes = [];
  if (conf.split && P.groups.length > 0) {
    for (i = 0; i < P.groups.length; i++) { lanes.push({ name: P.groups[i], gi: i, vals: [] }); }
    for (i = 0; i < n; i++) { lanes[pts[i].g].vals.push(pts[i].y); }
  } else {
    lanes.push({ name: P.groups.length === 1 ? P.groups[0] : 'all items', gi: 0, vals: [] });
    for (i = 0; i < n; i++) { lanes[0].vals.push(pts[i].y); }
  }
  for (i = 0; i < lanes.length; i++) { lanes[i].stats = ctStats(lanes[i].vals, P); }

  var xlo = Infinity, xhi = -Infinity, ymax = 0, yloPos = Infinity, zeros = 0;
  for (i = 0; i < n; i++) {
    if (pts[i].x < xlo) { xlo = pts[i].x; }
    if (pts[i].x > xhi) { xhi = pts[i].x; }
    if (pts[i].y > ymax) { ymax = pts[i].y; }
    if (pts[i].y > 0 && pts[i].y < yloPos) { yloPos = pts[i].y; }
    if (pts[i].y === 0) { zeros++; }
  }
  if (!isFinite(xlo)) { xlo = 0; xhi = 86400000; }
  if (!isFinite(yloPos)) { yloPos = 1; }
  if (!(xhi > xlo)) { xlo -= 43200000; xhi += 43200000; }

  var ax = axisTicks(0, ymax > 0 ? ymax : 1, 5);
  var leftW = 0;
  for (i = 0; i < ax.ticks.length; i++) { leftW = Math.max(leftW, tw(CK.fmt(ax.ticks[i]))); }

  var padT = 16, padR = 62, padB = 34;
  var padL = Math.round(Math.min(90, leftW)) + 12 + 12;
  var W = P.W0;
  var H = P.H0;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  var xS = CK.scale([xlo, xhi], [plot.x0, plot.x1]);
  var yA = ctScaleY(conf, { hi: ymax, loPos: yloPos }, plot);
  var u = P.unit === 'hours' ? ' h' : ' d';

  for (i = 0; i < yA.ticks.length; i++) {
    var ty = yA.f(yA.ticks[i]);
    if (ty < plot.y0 - 0.5 || ty > plot.y1 + 0.5) { continue; }
    marks.push(mLine(plot.x0, ty, plot.x1, ty, 'ck-rule'));
    marks.push(mText(plot.x0 - 6, ty + 3.2, CK.fmt(yA.ticks[i]), 'ck-tk', 'end'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  var xspan = xhi - xlo;
  var want = Math.max(2, Math.min(6, Math.floor((plot.x1 - plot.x0) / 82)));
  for (i = 0; i <= want; i++) {
    var xv = xlo + (xspan * i) / want;
    var px = xS(xv);
    marks.push(mText(px, plot.y1 + 13, fmtT(xv, xspan), 'ck-tk',
                     i === 0 ? 'start' : i === want ? 'end' : 'middle'));
  }
  marks.push(mText(10, (plot.y0 + plot.y1) / 2,
                   'cycle time (' + (P.unit === 'hours' ? 'hours' : 'days') + ')' +
                   (yA.log ? ', log' : ''), 'ck-cap-ax', 'middle',
                   { transform: 'rotate(-90 10 ' + fin((plot.y0 + plot.y1) / 2) + ')' }));
  marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, 'completion date', 'ck-cap-ax', 'middle'));

  /* The confidence bands go down first, so every dot and every line sits on top of them. */
  if (conf.bands) {
    for (i = 0; i < lanes.length; i++) {
      for (j = 0; j < lanes[i].stats.rows.length; j++) {
        r = lanes[i].stats.rows[j];
        if (!r.ok || r.hi <= r.lo) { continue; }
        var by0 = yA.f(r.hi), by1 = yA.f(r.lo);
        var band = mRect(plot.x0, Math.min(by0, by1), plot.x1 - plot.x0, Math.abs(by1 - by0),
                         { fill: lanes.length > 1 ? CK.hue(lanes[i].gi) : 'var(--accent)',
                           'fill-opacity': '0.12', stroke: 'none', 'class': 'ck-ci' });
        band.ti = 'p' + r.p + (lanes.length > 1 ? ' \u00b7 ' + lanes[i].name : '') +
                  ' \u00b7 95% rank interval ' + CK.fmt(r.lo) + u + ' to ' + CK.fmt(r.hi) + u;
        marks.push(band);
      }
    }
  }

  var tips = n <= P.tipCap;
  var kids = [];
  for (i = 0; i < n; i++) {
    var dot = mDot(xS(pts[i].x), yA.f(pts[i].y), 2.6, {
      fill: CK.hue(pts[i].g), 'fill-opacity': '0.7', stroke: 'none',
      'class': yA.log && pts[i].y === 0 ? 'ck-dot ck-floor' : 'ck-dot',
    });
    if (tips) {
      dot.ti = (pts[i].l ? pts[i].l + '  \u00b7  ' : '') + CK.fmt(pts[i].y) + u +
               '  \u00b7  ' + fmtT(pts[i].x, xspan) +
               (P.groups.length > 1 ? '  \u00b7  ' + P.groups[pts[i].g] : '');
    }
    kids.push(dot);
  }
  marks.push({ t: 'g', a: { 'class': 'ck-dots' }, kids: kids });

  /* The percentile lines last, and labelled in the right margin rather than over the dots: the
     dots are the point of the card and a label sitting on them hides the observations it is a
     summary of. */
  for (i = 0; i < lanes.length; i++) {
    for (j = 0; j < lanes[i].stats.rows.length; j++) {
      r = lanes[i].stats.rows[j];
      if (!r.ok) { continue; }
      var ly = yA.f(r.v);
      if (ly < plot.y0 - 0.5 || ly > plot.y1 + 0.5) { continue; }
      var line = mLine(plot.x0, ly, plot.x1, ly, r.p === 50 ? 'ck-p ck-p50' : 'ck-p');
      line.ti = 'p' + r.p + (lanes.length > 1 ? ' \u00b7 ' + lanes[i].name : '') + ' \u00b7 ' +
                r.p + ' of every 100 finished in ' + CK.fmt(r.v) + u + ' or less  \u00b7  n ' + r.n;
      marks.push(line);
      marks.push(mText(plot.x1 + 5, ly + 3.2,
                       'p' + r.p + ' ' + CK.fmt(r.v) + u, 'ck-plab', 'start'));
    }
  }

  if (!n) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return {
    W: W, H: H, marks: marks,
    note: ctNote(P, conf, lanes, { lo: yA.lo, hi: yA.hi }, yA.log ? zeros : 0, n),
  };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, pad2, fmtT, axisTicks, logTicks, mLine, mText, mRect, mDot,
                 nearRank, rankCI, minN, ctStats, ctConfig, ctScaleY, ctNote, ctRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so an item label containing `</script>` cannot close the block early,
 * with the useful side effect that no label can put an arrow into a file contractually free of them.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsLit({ l: '</script>' });   // '{"l":"\\u003c/script\\u003e"}'
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
  const own = '.ck-cycletime[data-card="' + id + '"]';
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
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-dot', 'stroke: none;'],
    /* An item pinned to the floor of a log axis is marked in the drawing as well as in the
       caption: a reader looking at a row of dots on the bottom rule should be able to see that
       they are pinned rather than measured. */
    ['.ck-plot .ck-floor', 'stroke: var(--ink-faint); stroke-width: .6;'],
    ['.ck-plot .ck-p', 'stroke: var(--accent); stroke-width: 1.4;'],
    /* The 50th is drawn weakest on purpose. It is the line people misread as "the" cycle time,
       and it is the one that promises the least. */
    ['.ck-plot .ck-p50', 'stroke: var(--ink-dim); stroke-width: 1; stroke-dasharray: 3 3;'],
    ['.ck-plot .ck-plab', 'fill: var(--ink-dim); font-size: 9.5px;'],
    ['.ck-plot .ck-ci', 'stroke: none;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, legend) {
  const f = (name) => CK.esc(id) + '-' + name;

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-cycletime">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="cycle time settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('split') + '">split by group</label>\n' +
    '    <input id="' + f('split') + '" name="split" type="checkbox"' +
           (defaults.split ? ' checked' : '') + '>\n' +
    '    <label for="' + f('logY') + '">log cycle-time axis</label>\n' +
    '    <input id="' + f('logY') + '" name="logY" type="checkbox"' +
           (defaults.logY ? ' checked' : '') + '>\n' +
    '    <label for="' + f('bands') + '">confidence bands</label>\n' +
    '    <input id="' + f('bands') + '" name="bands" type="checkbox"' +
           (defaults.bands ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">splitting divides the sample, and a percentile needs 8 items for ' +
         'the 50th, 22 for the 85th and 73 for the 95th before its confidence interval fits ' +
         'inside the sample at all; any percentile a group cannot carry is not drawn and the ' +
         'caption says so. A log axis makes the tail look tamer than it is.</p>\n' +
    '  </div>\n' +
    '  ' + plot + legend + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped statistics, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned.
 *
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* cycle-time card: the percentile rule, the rank interval and the caption are all decided by\n' +
    '   the very functions that drew this card at build time, shipped here rather than restated.\n' +
    '   Splitting by group re-runs them per group; it does not run a second implementation. */\n' +
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
    '     stays a translator rather than a second place where percentile decisions live. */\n' +
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
    '     a render that added marks would stack a second scatter on the first every swap. */\n' +
    '  function render(conf) {\n' +
    '    var out = ctRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/cycletime');
}

/**
 * Build one cycle-time scatter from one data block.
 *
 * Cycle time is computed here from the two dates rather than accepted as a number, so that an item
 * which finished before it started can be detected and refused. A pre-computed cycle time cannot
 * be checked against anything.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame, captioned "no data"; no percentile is claimed
 *   one item             one dot and no percentile line at all, since the smallest sample any
 *                        percentile can carry is 8
 *   nine items, p95      the 95th is NOT drawn; the caption says it needs 73 and there are 9
 *   all identical        one flat row of dots; every percentile is the same number, which is true
 *   a zero cycle time    kept, and drawn on the floor. On a log axis it cannot be placed, so it is
 *                        pinned to the floor rule, marked with its own class, and counted
 *   a negative one       refused and counted, never clamped: a clamped one would sit on the floor
 *                        looking like an item that took no time
 *   an unparseable date  refused and counted; never coerced, because a failed parse is the epoch
 *   all on the same day  the x domain is padded by half a day either side so the single column has
 *                        an axis; the caption says only the vertical spread is readable
 *   one huge outlier     the linear axis stretches to it and the body flattens, which is what an
 *                        outlier does; the log setting is the remedy and the caption names both
 *   duplicate ids        nothing special; an id is a label here, not a key, and two items with one
 *                        id are two completions
 *   500 items            all drawn; tooltips stop above 400 dots
 *   20 groups            pooled by default; splitting them is a setting, and the caption objects
 *                        when the split leaves a group too thin to rank
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ items: [{ id, started, completed, group, label }], unit }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'flow',
 *   title: 'cycle time, last quarter',
 *   data: { unit: 'days',
 *           items: [{ id: 'PR-1', started: '2024-01-02', completed: '2024-01-05', group: 'bug' },
 *                   { id: 'PR-2', started: '2024-01-03', completed: '2024-01-19', group: 'feature' }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'cycletime' : id);
  const read = readData(data);

  const byDate = read.items.slice().sort((a, b) => a.x - b.x);
  const kept = thin(byDate, SHIP_MAX);
  const stride = byDate.length > kept.length ? Math.ceil(byDate.length / SHIP_MAX) : 1;

  const sameDay = kept.length > 1 && kept[kept.length - 1].x - kept[0].x < 86400000;

  const P = {
    W0, H0, WMAX,
    items: kept,
    groups: read.groups,
    unit: read.unit,
    ps: PS,
    z: Z95,
    tipCap: TIP_CAP,
    tips: kept.length <= TIP_CAP,
    total: read.items.length,
    shipped: kept.length,
    thinned: stride > 1,
    stride,
    sameDay,
    badDate: read.badDate,
    negative: read.negative,
    refused: read.refused,
  };

  const seed = ctRender(P, defaults);
  const legend = read.groups.length > 1
    ? '\n  <div class="ck-legend">' +
      read.groups.map((g, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g) + '</span>').join('') +
      '</div>'
    : '';

  const pooled = ctStats(kept.map((p) => p.y), P);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      items: read.items.length,
      drawn: kept.length,
      groups: read.groups.length,
      unit: read.unit,
      percentiles: pooled.rows.map((r) => ({ p: r.p, value: r.ok ? r.v : null, needs: r.need })),
      refusedNegative: read.negative,
      refusedDate: read.badDate,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, legend),
    css: cardCss(cardId),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
