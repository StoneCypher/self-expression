/**
 * @file cardkit card type: `candles` — OHLC candlesticks with a volume lane beneath.
 *
 * The desk's CSP is `script-src 'self'`, so there is no charting library and there is not going
 * to be one. That is the premise rather than the obstacle: every decision a library would have
 * made — where the price domain starts, which ticks to draw, how thin a body may get before it
 * stops being visible, what a bar with the high below the low means — is a decision, and a
 * decision made in a file somebody can read is worth more than one made in a minified bundle.
 *
 * Unlike `chart`, this card cannot compute its geometry once at build time and be done: four of
 * its settings (`bars`, `ma`, `logScale`, `volume`) change the drawing, and the viewer changes
 * them in the browser. So the geometry engine has to exist in the browser. Rather than write it
 * twice — once in Node for the static render and once in ES5 for the page, which is two sources
 * of truth and therefore eventually two different pictures — the engine is written once here, in
 * ES5 vocabulary, and emitted into the page verbatim through `Function.prototype.toString`. Node
 * calls the same functions directly to produce the card's initial markup, its aria label and its
 * caption. There is exactly one candlestick renderer in this project and both halves run it.
 *
 * That constraint is why every function in the "engine" section is written in `var` and
 * `function` with no arrow, no template literal and no `const`: its own source is shipped.
 *
 * No timer. `CK.timer` is the right tool for a card that polls, and a wrong tool here — this
 * card draws what it was handed and redraws only when the viewer changes a setting, so a
 * repeating callback would be a heater with no output.
 *
 * @see ../kit.js  — `CK.scale`, `CK.ticks`, `CK.fmt`, `CK.hue`, `CK.esc`, `CK.settings`, `CK.build`
 * @see ../kit.css — `.ck-plot`, `.ck-rule`, `.ck-axis`, `.ck-legend`, `.ck-gear`, `.ck-set`,
 *                   `.ck-cap`, `.ck-scroll`, `--ck-s1`..`--ck-s8`, `--ck-grid`
 * @see ./chart.mjs — the sibling that plots series; same emit contract, same token discipline
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level defines functions and one array and touches no DOM, so a bare context
 * carrying an empty `window` is enough to run it.
 *
 * Loading it rather than reimplementing it is the point: the ticks this file draws at build time
 * are the ticks `CK.ticks` would choose in the browser, down to the float-drift rounding.
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
  catch (e) { throw new Error('cardkit/candles: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/candles: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every constant the engine reads, in one object so it can be serialised into the page.
 *
 * Two copies of a magic number is one copy too many when one of them lives in Node and the other
 * in a string: the emitted script gets this object verbatim, so a change here changes both halves
 * at once and neither can drift.
 *
 * `CHW` is the advance of the 9px monospace `.ck-plot text` sets in kit.css. Measured rather than
 * guessed; it only decides which labels are thinned out, and being half a pixel pessimistic drops
 * a label that would just have fitted, which is the safe direction to be wrong in.
 */
const K = {
  CHW: 5.42,        // px per character at TXT
  TXT: 9,           // plot text size, matching kit.css
  W0: 640,          // the desk column's comfortable width
  H0: 300,          // card height; the volume lane is carved out of it, not added to it
  WMAX: 2400,       // past this the plot stops widening and the time labels thin instead
  MINSLOT: 4.5,     // px per bar below which candles stop reading as candles
  VOLFRAC: 0.20,    // share of the plot the volume lane takes
  GAP: 10,          // dead space between the price lane and the volume lane
  MAXBODY: 26,      // a lone candle should not become a billboard
  TIPMAX: 400,      // per-bar tooltips stop being worth their markup past this many bars
};

/**
 * Every setting the card understands, with the value it falls back to.
 *
 * `ma` is a window length in bars and `0` means off; `1` is also off, because a one-bar moving
 * average is the close and drawing the close twice is not an overlay. `bars` is how many of the
 * most recent bars to show, and `0` means all of them.
 */
const DEFAULTS = { bars: 90, ma: 0, logScale: false, volume: true };

/**
 * What this card type is, for a picker or a deck index.
 *
 * `shape` is the data literal a caller writes; `defaults` is the settings panel's contract. The
 * two are separate on purpose and the word `bars` is why: in `data` it is the array of quotes, in
 * the settings it is how many of the most recent of them to draw. Reading either one as the other
 * gives a card that looks configured and shows nothing.
 *
 * `defaults` is exposed beyond the base contract so a validator can check the settings panel
 * against it without having to build a card first — the panel and this object have to name the
 * same four things or a control silently does nothing.
 *
 * @example meta.name;   // 'candles'
 */
export const meta = {
  name: 'candles',
  summary:
    'OHLC candlesticks with a volume lane beneath — hollow bodies rise, filled bodies fall, ' +
    'with an optional moving average, a log price scale and a right-hand price axis.',
  shape: '{ symbol, bars: [{ t, o, h, l, c, v }], currency } — t a date string, epoch or label; o/h/l/c prices; v volume',
  defaults: { ...DEFAULTS },
};

/* ── engine ───────────────────────────────────────────────────────────────────────────────
 *
 * Everything from here to the emit section is shipped to the browser as its own source. ES5
 * vocabulary only: `var`, function declarations, no arrows, no template literals, no `const`.
 * These functions may only reference each other, `K`, and the global `CK`.
 */

/**
 * Round a coordinate to two places, refusing to emit one that is not a number.
 *
 * A `NaN` inside a path or an attribute is silent: the browser drops the whole value and the card
 * renders as an empty box with nothing in the console. Throwing here turns that into a stack
 * trace next to the input that caused it, which is the difference between a bug and a mystery —
 * and at build time it turns it into a failing test.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which piece of geometry broke
 * @throws {Error} when `v` is not a finite number
 *
 * @example ckN(12.3456, 'wick');   // 12.35
 */
function ckN(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/candles: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's mono face. */
function ckTw(s) { return String(s).length * K.CHW; }

/** Shorten a label to `max` px, keeping the head and marking the cut. */
function ckClip(s, max) {
  var str = String(s);
  var room = Math.floor(max / K.CHW);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/**
 * Fold a settings object into the four values the engine may assume.
 *
 * Coercive rather than strict, and deliberately: these values arrive from `localStorage`, where a
 * viewer may have hand-edited them, and from a card descriptor, where somebody may have typed
 * `"90"`. A bad value should give a working chart with the default, never an empty card.
 *
 * @param cfg partial or complete settings; anything unrecognised is ignored
 *
 * @example ckSettle({ bars: '30', ma: 1 });
 * // { bars: 30, ma: 0, logScale: false, volume: true }
 */
function ckSettle(cfg) {
  var c = cfg && typeof cfg === 'object' ? cfg : {};
  var ma = Math.floor(Number(c.ma));
  var bars = Math.floor(Number(c.bars));
  return {
    /* A window of 1 is the close line drawn on top of itself, so it counts as off. */
    ma: isFinite(ma) && ma > 1 ? Math.min(ma, 400) : 0,
    logScale: !!c.logScale,
    volume: c.volume == null ? true : !!c.volume,
    /* 0 or negative reads as "no limit"; the ceiling stops a bad feed from asking for a
       hundred thousand candles at a pixel and a half each. */
    bars: isFinite(bars) && bars > 0 ? Math.min(bars, 2000) : 0,
  };
}

/**
 * Read the caller's `data` into the one shape the rest of the engine may assume.
 *
 * Two kinds of bar are refused rather than repaired, and they are counted separately because they
 * mean different things to whoever has to fix the feed:
 *
 * - a bar whose high is below its low is not a bar. There is no candle for it — the wick would
 *   run backwards and the body would be somewhere outside its own range — and a renderer that
 *   quietly swapped the two would be inventing a price that was never quoted. It is dropped, and
 *   the caption says how many went.
 * - a bar with a non-numeric price is missing, and a missing price plotted as zero is a lie that
 *   also destroys the axis.
 *
 * Volume is treated more gently: absent volume is `0`, because a bar with no volume figure is
 * still a real bar with real prices, and the lane knows how to say that it has nothing to show.
 *
 * @param data the card's data block, possibly absent or malformed
 * @returns `{ rows, badHL, badNum, symbol, currency }`
 *
 * @example
 * ckBars({ symbol: 'X', bars: [{ t: '2024-01-02', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }).rows.length;  // 1
 */
function ckBars(data) {
  var d = data && typeof data === 'object' ? data : {};
  var src = Object.prototype.toString.call(d.bars) === '[object Array]' ? d.bars : [];
  var rows = [], badHL = 0, badNum = 0, i, b, o, h, l, c, v;

  for (i = 0; i < src.length; i++) {
    b = src[i];
    if (!b || typeof b !== 'object') { badNum++; continue; }
    o = Number(b.o); h = Number(b.h); l = Number(b.l); c = Number(b.c); v = Number(b.v);
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) { badNum++; continue; }
    if (h < l) { badHL++; continue; }
    rows.push({
      t: b.t == null ? i + 1 : b.t,
      o: o, h: h, l: l, c: c,
      v: isFinite(v) && v > 0 ? v : 0,
    });
  }

  return {
    rows: rows,
    badHL: badHL,
    badNum: badNum,
    symbol: d.symbol == null ? '' : String(d.symbol),
    currency: d.currency == null ? '' : String(d.currency),
  };
}

/**
 * A bar's time as a stable, locale-independent label.
 *
 * Deliberately not `Intl`: the same card is rendered once in Node to produce its static markup
 * and again in the browser whenever a setting changes, and an `Intl` format would give those two
 * renders different axes on a machine whose locale is not the server's. UTC calendar fields are
 * the same everywhere, so the axis is the same everywhere.
 *
 * A number is only read as a clock when it is big enough to be one. Bar 3 of a synthetic series
 * is the number three, not three seconds after 1970, and `1970-01-01` down the whole axis is a
 * worse answer than `3`.
 *
 * @param t        whatever the feed put in the bar's `t`
 * @param withYear include the year; the caller drops it when every bar shares one
 *
 * @example ckStamp('2024-03-05T00:00:00Z', false);   // '03-05'
 * @example ckStamp(1709596800000, true);             // '2024-03-05'
 * @example ckStamp(3, true);                         // '3'
 */
function ckStamp(t, withYear) {
  var ms = null, d, y, m, day;

  if (typeof t === 'number' && isFinite(t)) {
    if (Math.abs(t) >= 1e11) ms = t;               // milliseconds
    else if (Math.abs(t) >= 1e8) ms = t * 1000;    // seconds
    else return String(t);                         // an index, a week number, a plain label
  } else if (typeof t === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return withYear ? t.slice(0, 10) : t.slice(5, 10);
    return t;
  } else {
    return String(t);
  }

  d = new Date(ms);
  if (isNaN(d.getTime())) return String(t);
  y = d.getUTCFullYear();
  m = d.getUTCMonth() + 1;
  day = d.getUTCDate();
  return (withYear ? y + '-' : '') + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * A trailing simple moving average of the closes, `null` until the window is full.
 *
 * `null` rather than a partial average on purpose: a three-bar average of the first bar is the
 * first close, and drawing it would put the overlay exactly on the price for the first few bars
 * and then let it drift away, which reads as the average converging rather than as it not
 * existing yet.
 *
 * @param rows sanitised bars
 * @param w    window length in bars, at least 2
 *
 * @example ckSma([{ c: 1 }, { c: 2 }, { c: 3 }], 2);   // [null, 1.5, 2.5]
 */
function ckSma(rows, w) {
  var out = [], sum = 0, i;
  for (i = 0; i < rows.length; i++) {
    sum += rows[i].c;
    if (i >= w) sum -= rows[i - w].c;
    out.push(i >= w - 1 ? sum / w : null);
  }
  return out;
}

/**
 * Widen a collapsed domain so a flat series still has somewhere to be drawn.
 *
 * `frac` is 5% here where `chart` uses 50%, and the difference is the point. A price is a ratio
 * scale: half again as much is a different security, and padding a flat $100 series out to
 * $50–$150 would draw a chart whose axis implies a range nothing in the data ever had. Five
 * percent gives the flat line room and keeps the axis honest about the neighbourhood.
 *
 * @example ckPad(100, 100, 0.05);   // [95, 105]
 * @example ckPad(0, 0, 0.05);       // [-1, 1]
 */
function ckPad(lo, hi, frac) {
  var e;
  if (lo < hi) return [lo, hi];
  e = Math.abs(lo) * frac || 1;
  return [lo - e, hi + e];
}

/**
 * Round a domain outward to whole ticks, so the top gridline is the top of the plot.
 *
 * `CK.ticks` only returns ticks inside the domain it was given, which leaves a ragged strip above
 * the last gridline. Snapping the ends to the step the ticks already chose closes it, and the
 * ticks are then stepped out rather than re-derived: asking `CK.ticks` again with the wider range
 * can push it up to the next nice step and halve the gridlines, which loses the tick at the top
 * all over again.
 *
 * @example ckSnap(3, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
 */
function ckSnap(lo, hi, want) {
  var t = CK.ticks(lo, hi, want), step, nlo, nhi, ticks, k, v;
  if (t.length < 2) return { lo: lo, hi: hi, ticks: t };
  step = t[1] - t[0];
  if (!(step > 0)) return { lo: lo, hi: hi, ticks: t };
  nlo = Math.floor(lo / step) * step;
  nhi = Math.ceil(hi / step) * step;
  if (!(nhi > nlo)) return { lo: lo, hi: hi, ticks: t };

  ticks = [];
  for (k = 0; k < 400; k++) {
    v = nlo + k * step;
    if (v > nhi + step / 1e6) break;
    ticks.push(Math.round(v / step) * step);      // kill float drift at the tick
  }
  return { lo: nlo, hi: nhi, ticks: ticks };
}

/**
 * Ticks for a logarithmic price axis, in price space.
 *
 * The ticks a log axis wants are round *prices* — 20, 50, 100, 200 — placed at their logarithms,
 * not round logarithms placed at whatever price they happen to name. Handing `CK.ticks` the log
 * domain would give the second thing, and an axis labelled 4.6, 4.8, 5.0 is an axis nobody can
 * read a price off.
 *
 * A range narrower than one decade may not contain three of those round prices; when it does not,
 * the linear ticks are borrowed and simply positioned logarithmically, which is correct — the
 * spacing still compresses upward, there are just more label choices to pick from.
 *
 * @param lo the lowest price on the axis, strictly positive
 * @param hi the highest price on the axis
 *
 * @example ckLogTicks(9, 210);   // [10, 20, 50, 100, 200]
 */
function ckLogTicks(lo, hi) {
  var mant = [1, 2, 5], out = [], k, m, v, k0, k1, lin, i;
  k0 = Math.floor(Math.log(lo) / Math.LN10);
  k1 = Math.ceil(Math.log(hi) / Math.LN10);
  for (k = k0; k <= k1; k++) {
    for (m = 0; m < mant.length; m++) {
      v = mant[m] * Math.pow(10, k);
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  }
  if (out.length >= 3) return out;

  out = [];
  lin = CK.ticks(lo, hi, 5);
  for (i = 0; i < lin.length; i++) if (lin[i] > 0) out.push(lin[i]);
  return out.length ? out : [lo, hi];
}

/**
 * A price, with as many decimals as the axis step actually distinguishes and no abbreviation.
 *
 * `CK.fmt` is right for volume and wrong for prices: it turns 1852.34 into `1.9k`, and a price
 * axis that cannot tell 1852 from 1949 is not a price axis. The step decides the decimals, so a
 * penny stock gets its cents and an index gets whole points without either being told to.
 *
 * Which step is passed matters, and the two callers pass different ones deliberately. The axis
 * gets the gap between its own ticks, because a gridline labelled to a precision finer than the
 * gap to the next gridline is noise. Quoted prices — tooltips, the caption, the aria label — get
 * a much finer step, because those are the actual figures and rounding 187.14 to 187 there throws
 * away the thing the reader came for.
 *
 * @param v    the price
 * @param step the quantum worth distinguishing; 0 falls back to one part in a hundred of `v`
 *
 * @example ckPrice(185.2, 20);    // '185'
 * @example ckPrice(1.2345, 0.05); // '1.23'
 */
function ckPrice(v, step) {
  var s = step > 0 ? step : Math.abs(v) / 100 || 1;
  var d = Math.max(0, Math.min(6, -Math.floor(Math.log(s) / Math.LN10)));
  return v.toFixed(d);
}

/** One `<line>`, with both ends checked. */
function ckLine(x1, y1, x2, y2, cls) {
  return '<line x1="' + ckN(x1, 'line') + '" y1="' + ckN(y1, 'line') +
         '" x2="' + ckN(x2, 'line') + '" y2="' + ckN(y2, 'line') + '" class="' + cls + '"/>';
}

/** One `<rect>`, clamped to a non-negative size so a reversed pair cannot emit a negative width. */
function ckRect(x, y, w, h, cls) {
  return '<rect x="' + ckN(x, 'rect') + '" y="' + ckN(y, 'rect') +
         '" width="' + ckN(Math.max(0, w), 'rect') + '" height="' + ckN(Math.max(0, h), 'rect') +
         '" class="' + cls + '"/>';
}

/** One `<text>`; the content is escaped because every string here came from the feed. */
function ckText(x, y, s, cls, anchor) {
  return '<text x="' + ckN(x, 'text') + '" y="' + ckN(y, 'text') + '" class="' + cls + '"' +
         (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + CK.esc(s) + '</text>';
}

/**
 * Everything geometric about the plot, computed once from the bars and the settings.
 *
 * The right margin is measured from the price labels that actually have to fit rather than fixed:
 * a four-digit index and a two-digit penny stock want different amounts of room and any constant
 * is wrong for one of them.
 *
 * The two lanes are carved out of one height rather than stacked into a taller card, so turning
 * the volume lane off gives the prices more room instead of leaving a hole.
 *
 * @param rows  sanitised bars, already trimmed to the visible window
 * @param logOk whether a log price scale is actually usable on this data
 * @param volOn whether the volume lane is being drawn
 * @returns the frame: domain, ticks, scales, lane bounds, slot geometry
 *
 * @example ckFrame(rows, false, true).slot;   // 6.52
 */
function ckFrame(rows, logOk, volOn) {
  var F = { n: rows.length, logOk: logOk, volOn: volOn };
  var loP = Infinity, hiP = -Infinity, maxV = 0, i, b, lo, hi, p, sn, a, z, w, gap, innerH;

  for (i = 0; i < rows.length; i++) {
    b = rows[i];
    lo = Math.min(b.l, b.o, b.c);
    hi = Math.max(b.h, b.o, b.c);
    if (lo < loP) loP = lo;
    if (hi > hiP) hiP = hi;
    if (b.v > maxV) maxV = b.v;
  }
  /* An empty window is a legitimate state — a card seeded with no bars, or a feed that has not
     answered yet — and it gets a frame with nothing in it rather than an exception. */
  if (!isFinite(loP) || !isFinite(hiP)) { loP = 0; hiP = 1; }
  F.loP = loP; F.hiP = hiP; F.maxV = maxV;

  if (logOk) {
    a = Math.log(loP);
    z = Math.log(hiP);
    /* One price, or a run of identical ones: widen by 5% either side in price space, which is a
       constant distance in log space and therefore centres the flat line. */
    if (!(z > a)) { a = Math.log(loP * 0.95); z = Math.log(hiP * 1.05); }
    F.dlo = a; F.dhi = z;
    F.ticks = ckLogTicks(Math.exp(a), Math.exp(z));
  } else {
    p = ckPad(loP, hiP, 0.05);
    sn = ckSnap(p[0], p[1], 5);
    F.dlo = sn.lo; F.dhi = sn.hi; F.ticks = sn.ticks;
  }

  /* The label step is the smallest gap between adjacent ticks, which on a log axis is the gap at
     the bottom — the tightest one, and therefore the one that decides how many decimals the whole
     axis needs to stay distinguishable. */
  F.step = 0;
  for (i = 1; i < F.ticks.length; i++) {
    w = Math.abs(F.ticks[i] - F.ticks[i - 1]);
    if (w > 0 && (F.step === 0 || w < F.step)) F.step = w;
  }

  /* The quantum for a *quoted* price, as opposed to an axis label: about one part in two hundred
     of the visible range, which is roughly a pixel of the price lane. Fine enough that no two
     distinguishable prices print the same, coarse enough that a tooltip does not offer six
     decimals of a number that only ever moves in cents. */
  F.vstep = (F.hiP - F.loP) / 200;

  F.padT = 12;
  F.padB = 22;
  F.padL = 8;
  w = 0;
  for (i = 0; i < F.ticks.length; i++) w = Math.max(w, ckTw(ckPrice(F.ticks[i], F.step)));
  if (volOn && maxV > 0) w = Math.max(w, ckTw(CK.fmt(maxV)));
  F.padR = Math.round(Math.min(90, w)) + 12;

  F.W = K.W0;
  a = F.padL + F.padR + F.n * K.MINSLOT;
  if (a > K.W0) F.W = Math.min(K.WMAX, a);
  F.H = K.H0;

  innerH = F.H - F.padT - F.padB;
  gap = volOn ? K.GAP : 0;
  F.volH = volOn ? Math.round((innerH - gap) * K.VOLFRAC) : 0;
  F.priceY0 = F.padT;
  F.priceY1 = F.padT + (innerH - gap - F.volH);
  F.volY0 = F.priceY1 + gap;
  F.volY1 = F.padT + innerH;
  F.x0 = F.padL;
  F.x1 = F.W - F.padR;

  F.plotW = F.x1 - F.x0;
  F.slot = F.plotW / Math.max(1, F.n);
  F.body = Math.max(1, Math.min(K.MAXBODY, F.slot * 0.62));

  F.yPrice = CK.scale([F.dlo, F.dhi], [F.priceY1, F.priceY0]);
  F.yVol = CK.scale([0, maxV > 0 ? maxV : 1], [F.volY1, F.volY0]);

  /** Screen x of the centre of bar number i. */
  F.cx = function (i) { return F.x0 + (i + 0.5) * F.slot; };
  /** A price in whichever space the value axis is currently in. */
  F.space = function (v) { return logOk ? Math.log(v) : v; };

  return F;
}

/**
 * Gridlines, price ticks, the two baselines and the volume lane's one label.
 *
 * Two rules and no box: a full frame reads as a container, two rules read as axes. The volume
 * lane gets a single label at its ceiling instead of a second tick set, because the question a
 * volume lane answers is "how does this bar compare to the others", and one number is enough to
 * scale that.
 *
 * @param F a frame from {@link ckFrame}
 */
function ckDrawGrid(F) {
  var out = [], i, t, y;

  for (i = 0; i < F.ticks.length; i++) {
    t = F.ticks[i];
    if (F.logOk && !(t > 0)) continue;
    y = F.yPrice(F.space(t));
    if (y < F.priceY0 - 0.5 || y > F.priceY1 + 0.5) continue;
    out.push(ckLine(F.x0, y, F.x1, y, 'ck-rule'));
    out.push(ckText(F.x1 + 5, y + 3.2, ckPrice(t, F.step), 'ck-tk', 'start'));
  }

  out.push(ckLine(F.x1, F.priceY0, F.x1, F.priceY1, 'ck-axis'));
  out.push(ckLine(F.x0, F.priceY1, F.x1, F.priceY1, 'ck-axis'));

  if (F.volOn) {
    out.push(ckLine(F.x0, F.volY1, F.x1, F.volY1, 'ck-axis'));
    out.push(ckText(F.x1 + 5, F.volY0 + 6.5, CK.fmt(F.maxV), 'ck-tk', 'start'));
  }

  return out.join('');
}

/**
 * The candles themselves.
 *
 * Three decisions worth naming, because each of them is a case that draws wrong by default:
 *
 * - **A doji must not vanish.** When open and close land on the same pixel row the body would be
 *   a zero-height rectangle, which renders as nothing at all. The body is forced to a minimum of
 *   one pixel, centred on where it was, so an open equal to a close draws as the horizontal line
 *   that convention says it is.
 * - **The wick is drawn in two pieces, above and below the body, rather than as one line behind
 *   it.** A hollow body with a wick running through it does not read as hollow, and hollow is
 *   half of how this card says "up" — the half that survives colourblindness.
 * - **Up and down are hollow and filled first, coloured second.** Green-up and red-down is a
 *   convention that fails for roughly one man in twelve and inverts outright in several markets.
 *   The fill carries the meaning; the token carries the emphasis, and it is a token rather than a
 *   colour so the light and dark themes each get a version that works.
 *
 * @param F a frame from {@link ckFrame}
 * @param rows the visible bars
 * @param withYear whether tooltips should spell the year out
 */
function ckDrawCandles(F, rows, withYear) {
  var out = [], i, b, cx, yH, yL, yO, yC, top, bot, mid, up, cls, tip;
  var tips = rows.length <= K.TIPMAX;

  for (i = 0; i < rows.length; i++) {
    b = rows[i];
    cx = F.cx(i);
    yH = F.yPrice(F.space(b.h));
    yL = F.yPrice(F.space(b.l));
    yO = F.yPrice(F.space(b.o));
    yC = F.yPrice(F.space(b.c));
    top = Math.min(yO, yC);
    bot = Math.max(yO, yC);

    /* A body thinner than a pixel is still a body. Growing it symmetrically about its own
       midpoint keeps it on the price it belongs to rather than nudging the bar up or down. */
    if (bot - top < 1) { mid = (top + bot) / 2; top = mid - 0.5; bot = mid + 0.5; }

    /* An unchanged bar counts as up, which is the convention: the body is hollow, and a reader
       who cares that it closed exactly flat has the tooltip. */
    up = b.c >= b.o;
    cls = up ? 'ck-up' : 'ck-dn';

    if (tips) {
      tip = ckStamp(b.t, withYear) +
            '  O ' + ckPrice(b.o, F.vstep) + '  H ' + ckPrice(b.h, F.vstep) +
            '  L ' + ckPrice(b.l, F.vstep) + '  C ' + ckPrice(b.c, F.vstep) +
            (b.v > 0 ? '  V ' + CK.fmt(b.v) : '');
      out.push('<g class="ck-cd ' + cls + '"><title>' + CK.esc(tip) + '</title>');
    } else {
      out.push('<g class="ck-cd ' + cls + '">');
    }

    /* Zero-length wicks are skipped rather than emitted: a line whose ends coincide draws a dot
       under a round linecap, and a row of stray dots along the body edge is noise. */
    if (top - yH > 0.4) out.push(ckLine(cx, yH, cx, top, 'ck-wick'));
    if (yL - bot > 0.4) out.push(ckLine(cx, bot, cx, yL, 'ck-wick'));
    out.push(ckRect(cx - F.body / 2, top, F.body, bot - top, 'ck-body'));
    out.push('</g>');
  }

  return out.join('');
}

/**
 * The volume lane, sharing the time axis with the candles above it.
 *
 * Volume bars take the same up/down token as their candle, and the same redundancy problem: at
 * four pixels wide a hollow bar is indistinguishable from a filled one, so the second channel
 * here is density rather than outline. An up bar is drawn faint and a down bar solid, which is a
 * difference in lightness and therefore survives every kind of colour vision.
 *
 * A bar of exactly zero volume still draws one pixel. Zero traded is a measurement; no bar at all
 * would be indistinguishable from a bar that is not there.
 *
 * @param F a frame from {@link ckFrame}
 * @param rows the visible bars
 */
function ckDrawVolume(F, rows) {
  var out = [], i, b, y, h, cls;
  if (!F.volOn) return '';

  for (i = 0; i < rows.length; i++) {
    b = rows[i];
    y = F.yVol(b.v);
    h = Math.max(1, F.volY1 - y);
    cls = 'ck-vol ' + (b.c >= b.o ? 'ck-up' : 'ck-dn');
    out.push(ckRect(F.cx(i) - F.body / 2, F.volY1 - h, F.body, h, cls));
  }
  return out.join('');
}

/**
 * The moving-average overlay, as one path per unbroken run of defined values.
 *
 * Runs rather than one path because the average is undefined until its window fills, and a single
 * path across a gap would draw a straight line through the hole as if the average had been there
 * all along.
 *
 * @param F a frame from {@link ckFrame}
 * @param ma the output of {@link ckSma}, `null` where undefined
 */
function ckDrawMa(F, ma) {
  var out = [], run = [], i, d, j;

  function flush() {
    if (run.length > 1) {
      d = [];
      for (j = 0; j < run.length; j++) d.push((j ? 'L' : 'M') + run[j][0] + ' ' + run[j][1]);
      out.push('<path class="ck-ma" d="' + d.join(' ') + '"/>');
    } else if (run.length === 1) {
      /* One defined point is drawn as a dot. A path with an M and no L renders as literally
         nothing, which is the most common way an overlay goes missing without an error. */
      out.push('<circle class="ck-ma-dot" cx="' + run[0][0] + '" cy="' + run[0][1] + '" r="1.8"/>');
    }
    run = [];
  }

  for (i = 0; i < ma.length; i++) {
    if (ma[i] == null) { flush(); continue; }
    run.push([ckN(F.cx(i), 'ma'), ckN(F.yPrice(F.space(ma[i])), 'ma')]);
  }
  flush();
  return out.join('');
}

/**
 * The time axis: labels at the bars they belong to, thinned until they stop colliding.
 *
 * Thinning rather than rotating. A rotated axis buys about forty percent more labels and costs
 * every reader a head tilt; at this size dropping every second label loses nothing, because the
 * axis is being read for shape and endpoints rather than for lookup.
 *
 * The last bar is labelled whenever it fits even if the thinning would have skipped it: the right
 * edge is where a reader looks for "as of when", and an axis that stops three bars early looks
 * like data that stops three bars early.
 *
 * @param F a frame from {@link ckFrame}
 * @param rows the visible bars
 * @param withYear whether the labels carry their year
 */
function ckDrawTime(F, rows, withYear) {
  var out = [], labels = [], i, wide = 0, k, y, last, prev;
  if (!rows.length) return '';

  for (i = 0; i < rows.length; i++) {
    labels.push(ckStamp(rows[i].t, withYear));
    wide = Math.max(wide, ckTw(labels[i]));
  }
  k = Math.max(1, Math.ceil((wide + 10) / Math.max(0.01, F.slot)));
  y = F.H - 6;

  prev = -Infinity;
  for (i = 0; i < rows.length; i += k) {
    out.push(ckText(F.cx(i), y, ckClip(labels[i], Math.max(18, F.slot * k)), 'ck-tk', 'middle'));
    prev = F.cx(i);
  }

  last = rows.length - 1;
  if (last % k !== 0 && F.cx(last) - prev >= wide + 6) {
    out.push(ckText(F.cx(last), y, ckClip(labels[last], Math.max(18, F.slot * k)), 'ck-tk', 'middle'));
  }
  return out.join('');
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label *is* the chart to anyone using one.
 * "Candlestick chart" is therefore not an acceptable answer: it names the genre and withholds
 * everything. This says what is priced, over what window, which way it went and by how much, and
 * what the extremes were — which is what a sighted reader takes from the first second of looking.
 *
 * The caption is the same content for someone who can see the picture, plus every refusal and
 * fallback the engine made. A chart that silently dropped two bars is a chart that is lying by
 * omission; saying so costs one clause.
 *
 * @returns `{ aria, caption }` — plain text, and markup whose data has been escaped
 *
 * @example ckDescribe(F, read, rows, cfg, notes, true).aria.slice(0, 11);   // 'Candlestick'
 */
function ckDescribe(F, read, rows, cfg, notes, withYear) {
  var sym = read.symbol, cur = read.currency;
  var n = rows.length, first, last, o, c, delta, pct, dir, aria, cap, bits = [];

  if (!n) {
    aria = 'Candlestick chart' + (sym ? ' of ' + sym : '') +
           ' with no bars: the axes are drawn but nothing is plotted.';
    cap = 'no bars to plot' + (sym ? ' for <b>' + CK.esc(sym) + '</b>' : '') +
          ' &mdash; <i>the frame is drawn so the card keeps its place</i>.';
    if (notes.badHL || notes.badNum) {
      cap += ' <b>' + (notes.badHL + notes.badNum) + '</b> bar' +
             (notes.badHL + notes.badNum === 1 ? ' was' : 's were') + ' refused as bad data.';
    }
    return { aria: aria, caption: cap };
  }

  first = ckStamp(rows[0].t, true);
  last = ckStamp(rows[n - 1].t, true);
  o = rows[0].o;
  c = rows[n - 1].c;
  delta = c - o;
  pct = o !== 0 ? (delta / Math.abs(o)) * 100 : null;
  dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  cur = cur ? ' ' + cur : '';

  aria = 'Candlestick chart' + (sym ? ' of ' + sym : '') + ': ' + n + ' bar' + (n === 1 ? '' : 's') +
    (n > 1 ? ' from ' + first + ' to ' + last : ' at ' + first) + '. ' +
    (dir === 'flat'
      ? 'It opened and closed at ' + ckPrice(o, F.vstep) + cur + ', unchanged'
      : 'It opened at ' + ckPrice(o, F.vstep) + ' and closed at ' + ckPrice(c, F.vstep) + cur +
        ', ' + dir + ' ' + ckPrice(Math.abs(delta), F.vstep) +
        (pct == null ? '' : ' or ' + CK.fmt(Math.abs(pct)) + ' percent')) + '. ' +
    'Prices ran between ' + ckPrice(F.loP, F.vstep) + ' and ' + ckPrice(F.hiP, F.vstep) + '. ' +
    'Bodies are hollow on days that closed up and filled on days that closed down. ' +
    (F.volOn ? 'A volume lane below shares the time axis; the busiest bar traded ' + CK.fmt(F.maxV) + '. ' : '') +
    (cfg.ma > 1 && notes.maDrawn ? 'A ' + cfg.ma + '-bar moving average is drawn over the prices. ' : '') +
    (F.logOk ? 'The price axis is logarithmic. ' : '');

  bits.push('<b>' + CK.esc(String(n)) + '</b> bar' + (n === 1 ? '' : 's') +
            (sym ? ' of <b>' + CK.esc(sym) + '</b>' : '') +
            (n > 1 ? ' &middot; ' + CK.esc(first) + ' to ' + CK.esc(last) : ' &middot; ' + CK.esc(first)));
  bits.push(dir === 'flat'
    ? '<i>closed exactly where it opened</i>, at ' + CK.esc(ckPrice(c, F.vstep) + cur)
    : 'close <b>' + CK.esc(ckPrice(c, F.vstep) + cur) + '</b> against an open of ' +
      CK.esc(ckPrice(o, F.vstep)) + ', ' + dir + ' ' + CK.esc(ckPrice(Math.abs(delta), F.vstep)) +
      (pct == null ? '' : ' (' + CK.esc(CK.fmt(Math.abs(pct))) + '%)'));

  if (notes.trimmed) {
    bits.push('<span class="ck-aside">showing the most recent ' + CK.esc(String(n)) +
              ' of ' + CK.esc(String(notes.total)) + '</span>');
  }
  if (notes.badHL) {
    bits.push('<b>' + CK.esc(String(notes.badHL)) + '</b> bar' + (notes.badHL === 1 ? '' : 's') +
              ' refused: <i>the high was below the low</i>, which is a broken quote rather than a shape');
  }
  if (notes.badNum) {
    bits.push('<b>' + CK.esc(String(notes.badNum)) + '</b> bar' + (notes.badNum === 1 ? '' : 's') +
              ' refused for a missing or non-numeric price');
  }
  if (notes.logFell) {
    bits.push('<i>log scale asked for but drawn linear</i> &mdash; a price of ' +
              CK.esc(ckPrice(F.loP, F.vstep)) + ' has no logarithm');
  }
  if (notes.volMissing) {
    bits.push('<span class="ck-aside">no volume in this data, so the lane is hidden</span>');
  }
  if (cfg.ma > 1 && !notes.maDrawn) {
    bits.push('<span class="ck-aside">a ' + CK.esc(String(cfg.ma)) +
              '-bar average needs more bars than are shown</span>');
  }

  return { aria: aria.trim(), caption: bits.join('. ') + '.' };
}

/**
 * Plan one drawing: the whole card's picture, its description and its size, from data plus
 * settings.
 *
 * This is the single entry point both halves of the card use. Node calls it at build time to
 * produce the static markup, and the emitted browser script calls it again on every settings
 * change. Because it is one function rather than two implementations, the caption cannot come to
 * describe a picture the browser is no longer drawing.
 *
 * The two fallbacks it can make are recorded rather than hidden. A log axis is impossible on data
 * containing a zero or negative price, so the axis quietly becomes linear — and says so. A volume
 * lane with no volume in it is an empty box pretending to be a chart, so it is dropped — and says
 * so.
 *
 * @param data the card's raw data block
 * @param cfg  settings; passed through {@link ckSettle} first
 * @returns `{ w, h, svg, aria, caption, volOn, maOn }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input — malformed bars are refused while reading
 *
 * @example ckPlan({ bars: [{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 5 }] }, { bars: 0 }).w;   // 640
 */
function ckPlan(data, cfg) {
  var c = ckSettle(cfg);
  var read = ckBars(data);
  var all = read.rows;
  var want = c.bars > 0 ? c.bars : all.length;
  var rows = all.length > want ? all.slice(all.length - want) : all;
  var notes = {
    badHL: read.badHL, badNum: read.badNum, total: all.length,
    trimmed: all.length > rows.length, logFell: false, volMissing: false, maDrawn: false,
  };
  var i, maxV = 0, minP = Infinity, logOk, volOn, F, ma, withYear, yr, note, svg;

  for (i = 0; i < rows.length; i++) {
    if (rows[i].v > maxV) maxV = rows[i].v;
    if (Math.min(rows[i].l, rows[i].o, rows[i].c) < minP) minP = Math.min(rows[i].l, rows[i].o, rows[i].c);
  }

  logOk = c.logScale && rows.length > 0 && minP > 0;
  notes.logFell = c.logScale && !logOk && rows.length > 0;

  volOn = c.volume && maxV > 0;
  notes.volMissing = c.volume && maxV <= 0 && rows.length > 0;

  F = ckFrame(rows, logOk, volOn);

  /* Spell the year out only when the window straddles more than one. On a three-month chart the
     year is the same four characters on every label, and four characters of nothing is the
     difference between labelling every bar and labelling every third. */
  withYear = false;
  yr = null;
  for (i = 0; i < rows.length; i++) {
    note = ckStamp(rows[i].t, true);
    if (!/^\d{4}-/.test(note)) { withYear = true; break; }
    if (yr === null) yr = note.slice(0, 4);
    else if (yr !== note.slice(0, 4)) { withYear = true; break; }
  }

  ma = c.ma > 1 && rows.length >= c.ma ? ckSma(rows, c.ma) : null;
  notes.maDrawn = !!ma;

  svg = ckDrawGrid(F) +
        ckDrawVolume(F, rows) +
        ckDrawCandles(F, rows, withYear) +
        (ma ? ckDrawMa(F, ma) : '') +
        ckDrawTime(F, rows, withYear);

  note = ckDescribe(F, read, rows, c, notes, withYear);

  return {
    w: ckN(F.W, 'view'), h: ckN(F.H, 'view'),
    svg: svg, aria: note.aria, caption: note.caption,
    volOn: volOn, maOn: notes.maDrawn,
  };
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/** The engine functions, in dependency-free order, shipped to the page as their own source. */
const ENGINE = [
  ckN, ckTw, ckClip, ckSettle, ckBars, ckStamp, ckSma, ckPad, ckSnap, ckLogTicks, ckPrice,
  ckLine, ckRect, ckText, ckFrame, ckDrawGrid, ckDrawCandles, ckDrawVolume, ckDrawMa,
  ckDrawTime, ckDescribe, ckPlan,
];

/**
 * The engine's own source, checked against the contract it is about to be pasted into.
 *
 * Shipping a function by its `toString` ships its inner comments too, and a comment is exactly
 * where a backtick or an arrow sneaks in — nothing here is executed differently, the module keeps
 * working, and the only symptom is a card that will not parse on a viewer with no transpiler.
 * That is a silent failure with a long fuse, so it is turned into a loud one at build time.
 *
 * @returns the concatenated ES5 source of every engine function
 * @throws {Error} when a function's source contains syntax the emitted script may not carry
 *
 * @example engineSource().indexOf('function ckPlan') > 0;   // true
 */
function engineSource() {
  const src = ENGINE.map((fn) => fn.toString()).join('\n\n');
  const banned = [['`', 'a template literal or a backtick in a comment'],
                  ['=>', 'an arrow function'],
                  ['?.', 'optional chaining']];
  for (const [needle, why] of banned) {
    const at = src.indexOf(needle);
    if (at >= 0) {
      throw new Error('cardkit/candles: the emitted engine carries ' + why + ' — near "' +
                      src.slice(Math.max(0, at - 60), at + 20).replace(/\n/g, ' ') + '"');
    }
  }
  if (/(^|[^.\w])(const|let)\s/.test(src)) {
    throw new Error('cardkit/candles: the emitted engine declares const or let');
  }
  return src;
}

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` becomes an escape so a symbol containing `</script>` cannot close the block early; `>` goes
 * with it, which has the side effect that no piece of data can ever put `=>` into a file that is
 * contractually free of arrow functions. Backticks go too, for the same contract, and the two
 * line separators because they are newlines to a JS parser and not to `JSON.stringify`.
 *
 * @example jsonLit({ symbol: '</script>' });   // '{"symbol":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v == null ? null : v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** HTML-escape, mirroring `CK.esc` so build-time and browser markup cannot disagree. */
function esc(s) { return CK.esc(s); }

/**
 * The card's markup: heading, gear, settings panel, the plot with its initial drawing, a legend
 * and the caption.
 *
 * The plot is emitted already drawn rather than as an empty box for the script to fill. A card
 * whose picture only exists after JavaScript has run is a card that flashes empty on every page
 * load and shows nothing at all in a static capture of the desk; the script's job here is to
 * *re*draw when a setting changes, not to draw for the first time.
 *
 * The gear is emitted empty on purpose — `CK.settings` fills it with the kit's drawn gear, and a
 * glyph typed here would be a second source of truth for a shape the kit already owns.
 */
function markup(id, title, plan, cfg) {
  const f = (name) => esc(id) + '-' + name;

  return '<section data-card="' + esc(id) + '" class="ck-candles"' +
    ' data-ma="' + (plan.maOn ? 'on' : 'off') + '" data-vol="' + (plan.volOn ? 'on' : 'off') + '">' +
    '<h2>' + esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="candlestick settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('bars') + '">bars</label>' +
      '<input id="' + f('bars') + '" name="bars" type="number" min="0" max="2000" step="1"' +
        ' value="' + esc(cfg.bars) + '">' +

      '<label for="' + f('ma') + '">moving avg</label>' +
      '<input id="' + f('ma') + '" name="ma" type="number" min="0" max="400" step="1"' +
        ' value="' + esc(cfg.ma) + '">' +

      '<label for="' + f('logScale') + '">log scale</label>' +
      '<input id="' + f('logScale') + '" name="logScale" type="checkbox"' +
        (cfg.logScale ? ' checked' : '') + '>' +

      '<label for="' + f('volume') + '">volume</label>' +
      '<input id="' + f('volume') + '" name="volume" type="checkbox"' +
        (cfg.volume ? ' checked' : '') + '>' +

      '<p class="ck-set-foot">Bars 0 shows everything. Moving average 0 turns the overlay off.</p>' +
    '</div>' +

    '<div class="ck-scroll">' +
      '<svg class="ck-plot" role="img" viewBox="0 0 ' + plan.w + ' ' + plan.h + '"' +
      ' aria-label="' + esc(plan.aria) + '">' + plan.svg + '</svg>' +
    '</div>' +

    '<div class="ck-legend">' +
      '<span><i class="ck-k-up"></i>closed up</span>' +
      '<span><i class="ck-k-dn"></i>closed down</span>' +
      '<span class="ck-k-ma"><i></i>moving average</span>' +
    '</div>' +

    '<div class="ck-cap">' + plan.caption + '</div>' +
  '</section>';
}

/**
 * Every rule, scoped under the card's own class.
 *
 * Nothing here names a colour. The desk is one document open in a browser and in an editor that
 * want opposite themes, so a hex would be correct in exactly one of them; every value is a token,
 * and the light switch is the only thing that has to know anything. `prefers-color-scheme` is
 * deliberately absent for the same reason — the OS gives both viewers the same answer, and the
 * viewer's own choice has to beat it.
 *
 * Up and down are separated twice over. `--ck-s4` against `--ck-s1` is the hue channel, which
 * roughly one man in twelve does not receive; hollow against filled is the shape channel, which
 * everybody receives. Neither is decoration for the other.
 *
 * @param id   the card's id, used only for the width rule so two candle cards can differ
 * @param wide whether this card's plot is wider than the desk column
 * @param w    that width in px
 */
function styles(id, wide, w) {
  const own = '.ck-candles';
  const rules = [
    [own, 'position: relative;'],
    [own + ' h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    [own + ' .ck-plot .ck-tk', 'fill: var(--ink-faint);'],

    /* The two series tokens. Everything that belongs to a rising bar takes its stroke from one
       and everything that belongs to a falling bar from the other, so the drawing code never
       names a colour and the theme is free to redefine both. */
    [own + ' .ck-up', 'stroke: var(--ck-s4);'],
    [own + ' .ck-dn', 'stroke: var(--ck-s1);'],

    [own + ' .ck-wick', 'stroke-width: 1; fill: none;'],
    [own + ' .ck-body', 'stroke-width: 1;'],

    /* Hollow up, filled down: the traditional encoding, and the one that still works in
       greyscale or with either red-green deficiency. */
    [own + ' .ck-up .ck-body', 'fill: none;'],
    [own + ' .ck-dn .ck-body', 'fill: var(--ck-s1);'],

    /* In the volume lane the bars are too narrow for an outline to read, so the redundant
       channel there is density instead: faint for up, solid for down. */
    [own + ' .ck-vol', 'stroke: none;'],
    [own + ' .ck-vol.ck-up', 'fill: var(--ck-s4); fill-opacity: .30;'],
    [own + ' .ck-vol.ck-dn', 'fill: var(--ck-s1); fill-opacity: .62;'],

    [own + ' .ck-ma', 'fill: none; stroke: var(--ck-s6); stroke-width: 1.4;' +
      ' stroke-linejoin: round; stroke-linecap: round;'],
    [own + ' .ck-ma-dot', 'fill: var(--ck-s6); stroke: none;'],

    [own + ' .ck-legend i', 'width: 8px; height: 8px; border-radius: 1px;'],
    /* The legend repeats the hollow/filled distinction rather than showing two colour chips,
       because a key that only differs by hue teaches the wrong thing about the picture. */
    [own + ' .ck-legend .ck-k-up', 'background: none; box-shadow: inset 0 0 0 1.5px var(--ck-s4);'],
    [own + ' .ck-legend .ck-k-dn', 'background: var(--ck-s1);'],
    [own + ' .ck-legend .ck-k-ma i', 'background: var(--ck-s6); height: 2px; border-radius: 0;'],
    [own + '[data-ma="off"] .ck-legend .ck-k-ma', 'display: none;'],

    [own + ' .ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    [own + ' .ck-cap', 'overflow-wrap: anywhere;'],
  ];

  /* A plot too wide for the column keeps its own width and scrolls inside `.ck-scroll`, so the
     desk column never widens and the page never grows a horizontal scrollbar of its own. The
     rule is keyed to this card's id because the width depends on how many bars it is showing;
     once the viewer changes that, the script sets the width inline and this stops mattering. */
  if (wide) {
    rules.push([own + '[data-card="' + id + '"] .ck-plot', 'min-width: ' + Math.round(w) + 'px;']);
  }

  return rules.map(([sel, body]) => sel + ' { ' + body + ' }').join('\n') + '\n';
}

/**
 * The browser half: the same engine, plus the twenty lines that hang it off the settings panel.
 *
 * Classic script, ES5 vocabulary, wrapped in an IIFE — the engine declares a dozen functions and
 * a desk holding two candle cards would otherwise have them fight over the global namespace.
 *
 * @param id   the card's `data-card` value
 * @param data the card's data block, serialised
 */
function script(id, data) {
  return '(function () {\n' +
    "  'use strict';\n\n" +
    '  var ID = ' + jsonLit(id) + ';\n' +
    '  var DEFAULTS = ' + jsonLit(DEFAULTS) + ';\n' +
    '  var DATA = ' + jsonLit(data && typeof data === 'object' ? data : {}) + ';\n' +
    '  var K = ' + jsonLit(K) + ';\n\n' +
    engineSource() + '\n\n' +
    '  CK.build(ID, function (sec) {\n' +
    '\n' +
    '    var plot = sec.querySelector("svg.ck-plot");\n' +
    '    var cap = sec.querySelector(".ck-cap");\n' +
    '    if (!plot) { return; }\n' +
    '\n' +
    '    /* Redraw from data plus settings. Every setting this card has changes the geometry, so\n' +
    '       there is nothing to patch in place: the honest move is to plan the picture again. It\n' +
    '       is a few hundred string concatenations, which is nothing next to the layout the\n' +
    '       browser then does anyway. */\n' +
    '    function apply(cfg) {\n' +
    '      var p;\n' +
    '      try {\n' +
    '        p = ckPlan(DATA, cfg);\n' +
    '      } catch (e) {\n' +
    '        /* A throw here means the geometry went non-finite, which is a bug in this card and\n' +
    '           not in the data. Say so where somebody will see it rather than leaving the last\n' +
    '           good drawing up and pretending it is current. */\n' +
    '        if (cap) { cap.textContent = "this chart could not be drawn: " + e.message; }\n' +
    '        return;\n' +
    '      }\n' +
    '      plot.setAttribute("viewBox", "0 0 " + p.w + " " + p.h);\n' +
    '      plot.setAttribute("aria-label", p.aria);\n' +
    '      plot.style.minWidth = p.w > K.W0 ? p.w + "px" : "";\n' +
    '      plot.innerHTML = p.svg;\n' +
    '      if (cap) { cap.innerHTML = p.caption; }\n' +
    '      sec.setAttribute("data-ma", p.maOn ? "on" : "off");\n' +
    '      sec.setAttribute("data-vol", p.volOn ? "on" : "off");\n' +
    '    }\n' +
    '\n' +
    '    /* CK.settings wires the gear and the panel idempotently and calls back with the settled\n' +
    '       config immediately, so this one line is also the first redraw after a DOM swap. */\n' +
    '    CK.settings(sec, DEFAULTS, apply);\n' +
    '  });\n' +
    '})();\n';
}

/**
 * Build one candlestick card.
 *
 * @param id    unique on the desk; becomes `data-card` and the settings storage key
 * @param title the card's heading
 * @param data  `{ symbol, bars, currency }` — see {@link meta}; bad bars are refused, not repaired
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }` — the descriptor, the markup with its drawing already in it,
 *          scoped CSS, and a classic script
 *
 * @throws {Error} when the geometry produces a non-finite coordinate; that is a bug in this file
 *                 rather than bad input, because malformed bars are dropped while reading
 *
 * @example
 * const card = build({
 *   id: 'aapl',
 *   title: 'AAPL, daily',
 *   data: { symbol: 'AAPL', currency: 'USD', bars: [
 *     { t: '2024-01-02', o: 187.1, h: 188.4, l: 183.9, c: 185.6, v: 82_000_000 },
 *     { t: '2024-01-03', o: 184.2, h: 185.9, l: 183.4, c: 184.3, v: 58_000_000 },
 *   ] },
 *   ord: 20,
 * });
 * card.json.type;   // 'candles'
 *
 * @see meta
 * @see ckPlan
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'candles' : id);
  const heading = String(title == null ? 'Candles' : title);
  const seed = data && typeof data === 'object' ? data : {};
  const cfg = ckSettle(DEFAULTS);
  const plan = ckPlan(seed, cfg);

  return {
    json: {
      id: cardId, type: meta.name, title: heading,
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      settings: cfg,
      symbol: seed.symbol == null ? null : String(seed.symbol),
    },
    html: markup(cardId, heading, plan, cfg),
    css: styles(cardId, plan.w > K.W0, plan.w),
    js: script(cardId, seed),
  };
}

export default { meta, build };
