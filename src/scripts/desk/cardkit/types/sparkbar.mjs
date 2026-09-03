/**
 * `sparkbar` — a bar sparkline: a tiny strip of bars with no axes and no labels, where the shape
 * is the whole message.
 *
 * Tufte's sparkline is "a small intense word-sized graphic", and the two things it deliberately
 * has not got are the two things every other card here works hardest on: a scale and a set of
 * labels. That is not an omission to be fixed. A sparkline is read the way a word is read, at a
 * glance, and everything added to it — a tick, an axis, a number floating over a bar — turns it
 * back into a chart that happens to be too small. So this card has one number on it, the callout
 * for the most recent value, and the caption says out loud that the picture is for shape and not
 * for reading values off. If the reader needs to read values off, they need `chart`.
 *
 * The one decision worth arguing about is the baseline. These are BARS, and a bar encodes its
 * value as length from a baseline, so the baseline is part of what the bar claims. Bars drawn from
 * the series minimum are the classic dishonest chart: a run of 100, 101, 102 becomes one bar, two
 * bars and three bars, a threefold difference invented out of a two percent one. So the domain
 * here always contains zero, every bar runs from it, and a level series that never approaches zero
 * draws as a flat wall — which is the truthful picture of a level series. When that flat wall is
 * the wrong picture, the data wanted a LINE sparkline, and `ticker` already draws one against a
 * previous close.
 *
 * @see ./ticker.mjs — the line sparkline, baselined on a previous close rather than on zero
 * @see ./chart.mjs  — where to go the moment somebody wants to read a value off the picture
 * @see ../CONTRACT.md — `shape` is a string, `defaults` is an object, `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so build-time drawing and browser-time drawing
 * use one implementation rather than two that drift.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().scale([0, 10], [30, 0])(5);   // 15
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/sparkbar: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/sparkbar: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Thirty bars is the default because it is about a month of daily readings and about the most a
 * strip this size can show while each bar is still a bar rather than a hair. The band and the
 * callout both default on: the band is the only context a sparkline has, and the callout is the
 * only number on the card.
 *
 * @example defaults.bars;   // 30
 */
export const defaults = {
  bars:    30,
  band:    true,
  callout: true,
};

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `ranking-and-comparison` rather than `evolution`, which is the one that looks obvious. A
 * sparkline is ordered in time, but it is not read to find out what happened in March; it is read
 * to compare the end against the rest and against a reference band. The question it answers is
 * "is this one higher or lower than it has been", which is a comparison.
 *
 * @example meta.name;   // 'sparkbar'
 */
export const meta = {
  name: 'sparkbar',
  summary:
    'A word-sized strip of bars with no axes and no labels, optionally over a reference band, ' +
    'with the most recent value called out beside it.',
  shape:
    '{ values: [n], last, unit, band } — band is { lo, hi } or [lo, hi] and is drawn behind the ' +
    'bars; last defaults to the final value and is the only number on the card',
  category: 'ranking-and-comparison',
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
 * scanner desynchronises on the quote inside a `replace` call and starts blanking real code.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, comment and string contents replaced by spaces
 *
 * @example blankNonCode("var a = 'class';").indexOf('class');   // -1
 */
export function blankNonCode(src) {
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
 * The backtick is never written in this file; it is reached for as `String.fromCharCode(96)`.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/sparkbar';
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

/** The widest strip the card will draw, and the most bars it will put in one. */
const STRIP_W = 240;
const BARS_MAX = 240;

/** A finite number, or null. Used everywhere a caller's number is read for the first time. */
function num(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise whatever arrived into the payload the renderer takes.
 *
 * Non-finite samples are dropped rather than plotted as zero, and the drop is counted so the
 * caption can say it happened. A gap in a bar series has no honest drawing: a bar of length
 * nothing is a reading of zero, and no bar at all is a hole in an evenly-spaced strip that
 * silently shifts every later bar one slot to the left. Dropping and saying so is the least wrong
 * of the three.
 *
 * @param data the card's `data` block, possibly absent, malformed, or a bare array of numbers
 * @returns `{ values, last, hasLast, band, hasBand, unit, dropped, total }`
 *
 * @example readData([1, 2, 3]).values.length;                 // 3
 * @example readData({ values: [1, 'x', 3] }).dropped;         // 1
 */
function readData(data) {
  const isArr = Array.isArray(data);
  const d = !isArr && data && typeof data === 'object' ? data : {};
  const src = isArr ? data : Array.isArray(d.values) ? d.values : [];

  const values = [];
  let dropped = 0;
  for (const v of src) {
    const n = num(v);
    if (n === null) { dropped++; continue; }
    values.push(n);
  }

  /* `last` is the callout, and it may legitimately differ from the final sample: a strip of
     hourly readings with a live current value is the case this exists for. When it is absent the
     final sample stands in, which is what a reader assumes anyway. */
  const given = num(d.last);
  const last = given !== null ? given : (values.length ? values[values.length - 1] : null);

  let band = null;
  const b = d.band;
  if (Array.isArray(b) && b.length >= 2) {
    const lo = num(b[0]);
    const hi = num(b[1]);
    if (lo !== null && hi !== null) band = { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
  } else if (b && typeof b === 'object') {
    const lo = num(b.lo);
    const hi = num(b.hi);
    if (lo !== null && hi !== null) band = { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
  }

  return {
    values,
    last: last === null ? 0 : last,
    hasLast: last !== null,
    band,
    hasBand: band !== null,
    /* Capped rather than refused: twelve characters fit beside the callout; past thirty it is
       prose in the wrong field. */
    unit: d.unit == null ? '' : String(d.unit).trim().slice(0, 30),
    dropped,
    total: values.length,
  };
}

/* ── the shipped half: everything below runs in Node and in the browser, unchanged ───── */

/* ES5-shaped on purpose — var, function, no arrows, no template literals, no backticks even in
   the comments. These are emitted through Function.prototype.toString(). */

/** Two decimals, refusing a coordinate that is not a number so a silent empty draw cannot ship. */
function spFin(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/sparkbar: non-finite coordinate from ' + what + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Thousands separators, inserted into a run of digits from the right. */
function spGroup(digits) {
  var out = '';
  var i;
  for (i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) { out += ','; }
    out += digits.charAt(i);
  }
  return out;
}

/** A number at up to `dp` decimals, trailing zeros trimmed, thousands grouped. */
function spNum(v, dp) {
  var neg = v < 0;
  var s = Math.abs(v).toFixed(dp);
  var dot = s.indexOf('.');
  var whole = dot < 0 ? s : s.slice(0, dot);
  var frac = dot < 0 ? '' : s.slice(dot + 1);
  while (frac.length && frac.charAt(frac.length - 1) === '0') { frac = frac.slice(0, frac.length - 1); }
  return (neg ? '-' : '') + spGroup(whole) + (frac.length ? '.' + frac : '');
}

/** How many bars a viewer asked for, clamped to what the strip can hold. */
function spBars(v) {
  var n = Number(v);
  if (!isFinite(n)) { return 30; }
  n = Math.round(n);
  if (n < 1) { return 1; }
  if (n > 240) { return 240; }
  return n;
}

/** One rect mark. */
function spRect(x, y, w, h, cls) {
  return { t: 'rect', a: { x: spFin(x, 'rect'), y: spFin(y, 'rect'),
                           width: spFin(Math.max(0, w), 'rect'), height: spFin(Math.max(0, h), 'rect'),
                           'class': cls } };
}

/** One line mark. */
function spLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: spFin(x1, 'line'), y1: spFin(y1, 'line'),
                           x2: spFin(x2, 'line'), y2: spFin(y2, 'line'), 'class': cls } };
}

/** One text mark, used only for the empty state; a sparkline carries no labels by design. */
function spText(x, y, s, cls, anchor) {
  var a = { x: spFin(x, 'text'), y: spFin(y, 'text'), 'class': cls };
  if (anchor) { a['text-anchor'] = anchor; }
  return { t: 'text', a: a, s: String(s) };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption says the thing a sparkline cannot say for itself: that it has no scale on purpose,
 * that it is for shape rather than for reading values off, and that the bars run from zero so a
 * level series will look flat and that is the truth about a level series rather than a fault.
 */
function spNote(P, conf, shown, lo, hi) {
  var esc = CK.esc;
  var unit = P.unit ? ' ' + P.unit : '';

  var standing =
    '<span class="ck-aside">a sparkline has no scale by design: it is for the SHAPE of a run, not ' +
    'for reading values off. the bars run from zero, which is the only baseline a bar may honestly ' +
    'have, so a series that never approaches zero draws as a flat wall &mdash; that is the truth ' +
    'about a level series, and the picture it wanted was a line sparkline. to read a value, use ' +
    'chart.</span>';

  if (!shown.length) {
    return {
      aria: 'Bar sparkline with no readings.',
      caption: '<b>no readings</b> &mdash; the strip keeps its place and there is nothing in it. ' +
               standing
    };
  }

  var min = shown[0];
  var max = shown[0];
  var i;
  for (i = 1; i < shown.length; i++) {
    if (shown[i] < min) { min = shown[i]; }
    if (shown[i] > max) { max = shown[i]; }
  }
  var flat = min === max;

  var lead = '<b>' + esc(String(shown.length)) + '</b> reading' + (shown.length === 1 ? '' : 's') +
             (P.total > shown.length
               ? ' <i>(the most recent of ' + esc(String(P.total)) + ')</i>'
               : '') + ', ';
  lead += flat
    ? 'every one of them ' + esc(spNum(min, 2) + unit) + ', so the strip is level. '
    : 'from ' + esc(spNum(min, 2) + unit) + ' to ' + esc(spNum(max, 2) + unit) + '. ';

  var aria = 'Bar sparkline of ' + shown.length + ' readings' +
             (flat ? ', all ' + spNum(min, 2) + unit : ', from ' + spNum(min, 2) + unit +
              ' to ' + spNum(max, 2) + unit) + '. ';

  if (P.hasLast) {
    lead += 'the last is <b>' + esc(spNum(P.last, 2) + unit) + '</b>. ';
    aria += 'The last is ' + spNum(P.last, 2) + unit + '. ';
  }
  if (P.hasBand && conf.band !== false) {
    lead += 'the shaded band behind is the reference, ' +
            esc(spNum(P.band.lo, 2) + ' to ' + spNum(P.band.hi, 2) + unit) + '. ';
    aria += 'A reference band runs from ' + spNum(P.band.lo, 2) + ' to ' + spNum(P.band.hi, 2) + unit + '. ';
  } else if (P.hasBand) {
    lead += 'the reference band is switched off in this card settings. ';
  }
  if (lo < 0 && hi > 0) {
    lead += 'the hairline is zero; bars run from it in both directions. ';
  }
  if (P.dropped) {
    lead += esc(String(P.dropped)) + ' reading' + (P.dropped === 1 ? ' was' : 's were') +
            ' not a number and was dropped rather than drawn as zero. ';
  }

  return { aria: aria, caption: lead + standing };
}

/**
 * Every mark in the strip, the size of the box it needs, and the callout text.
 *
 * Runs in Node at build time and in the browser on every settings change, from the same text.
 *
 * @param P    the payload from {@link readData}
 * @param conf the settled settings: `bars`, `band`, `callout`
 * @returns `{ W, H, marks, note, callout, lo, hi }`
 * @throws {Error} when any coordinate comes out non-finite
 */
function spRender(P, conf) {
  var want = spBars(conf.bars);
  var showBand = conf.band !== false && P.band !== null;
  var all = P.values;
  var shown = all.length > want ? all.slice(all.length - want) : all;
  var marks = [];
  var H = 30;
  var i;

  /* The domain always contains zero. See the file header: bars drawn from anything else invent a
     difference that is not in the data, and it is the single commonest way a small chart lies. */
  var lo = 0;
  var hi = 0;
  for (i = 0; i < shown.length; i++) {
    if (shown[i] < lo) { lo = shown[i]; }
    if (shown[i] > hi) { hi = shown[i]; }
  }
  if (showBand) {
    if (P.band.lo < lo) { lo = P.band.lo; }
    if (P.band.hi > hi) { hi = P.band.hi; }
  }
  /* Everything is exactly zero, or there is nothing at all: the domain has collapsed and any
     scale over it divides by zero. Widened to 0..1 rather than handed to CK.scale, whose
     midpoint rule would float every zero bar halfway up the strip. */
  if (!(hi > lo)) { hi = lo === 0 ? 1 : 0; lo = Math.min(0, lo); }

  var callout = P.hasLast ? spNum(P.last, 2) + (P.unit ? ' ' + P.unit : '') : '\u2014';

  if (!shown.length) {
    marks.push(spText(2, 20, 'no readings', 'ck-sp-void', 'start'));
    return { W: 90, H: H, marks: marks, note: spNote(P, conf, shown, lo, hi),
             callout: callout, lo: lo, hi: hi };
  }

  /* Twelve pixels a bar until there are twenty of them, then the strip stops growing and the bars
     thin instead. A strip that kept growing would be a chart, and a chart is the other card. */
  var step = Math.min(12, Math.max(1, 240 / shown.length));
  var barW = Math.max(0.6, step * 0.72);
  var W = Math.max(24, Math.ceil(shown.length * step));

  var y = CK.scale([lo, hi], [H - 1, 1]);
  var base = y(0);

  if (showBand) {
    var b0 = y(P.band.lo);
    var b1 = y(P.band.hi);
    marks.push(spRect(0, Math.min(b0, b1), W, Math.abs(b0 - b1), 'ck-sp-band'));
  }

  if (lo < 0 && hi > 0) {
    marks.push(spLine(0, base, W, base, 'ck-sp-zero'));
  }

  for (i = 0; i < shown.length; i++) {
    var v = shown[i];
    var top = y(v);
    var a = Math.min(base, top);
    var c = Math.max(base, top);
    /* A reading of exactly zero draws one pixel rather than nothing. Zero is a measurement and a
       gap is not, and on a strip with no axis they are otherwise the same picture. */
    if (c - a < 1) { if (v >= 0) { a = c - 1; } else { c = a + 1; } }
    var lastOne = i === shown.length - 1;
    marks.push(spRect(i * step + (step - barW) / 2, a, barW, c - a,
                      lastOne && conf.callout !== false ? 'ck-sp-bar ck-sp-head' : 'ck-sp-bar'));
  }

  return { W: W, H: H, marks: marks, note: spNote(P, conf, shown, lo, hi),
           callout: callout, lo: lo, hi: hi };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [spFin, spGroup, spNum, spBars, spRect, spLine, spText, spNote, spRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsLit({ unit: '</script>' });   // '{"unit":"\\u003c/script\\u003e"}'
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
  const body = m.s != null ? CK.esc(m.s) : '';
  return s + '>' + body + '</' + m.t + '>';
}

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-sparkbar[data-card="' + id + '"]';
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
 * Not one literal colour and no `:root` block either: unlike `bullet` and `gauge`, nothing here is
 * an ordered ramp, so every mark takes a desk token as it stands. The band is `--well`, which is
 * the desk's own recessed surface and reads as behind rather than as another series.
 *
 * The strip is sized in CSS by its HEIGHT with an automatic width, so the browser derives the
 * width from the viewBox and the bars keep their aspect. Setting the width instead and letting the
 * height follow would make the strip taller in a wide column, and a sparkline that changes size
 * with its container has stopped being word-sized.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-sp-row', 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap;'],
    ['.ck-sp-plot', 'display: block; height: 30px; width: auto; max-width: 100%; flex: 0 1 auto;'],
    ['.ck-sp-plot text', 'font-family: var(--mono); font-size: 9px;'],

    ['.ck-sp-bar', 'fill: var(--ink-dim); stroke: none;'],
    /* The last bar is the one the callout names, so it is the one that carries the ink. Colour
       alone is not the encoding: it is the final bar, which is a position, and the number beside
       the strip says the same thing in text. */
    ['.ck-sp-head', 'fill: var(--accent);'],
    ['.ck-sp-band', 'fill: var(--well); stroke: none;'],
    ['.ck-sp-zero', 'stroke: var(--rule); stroke-width: 1;'],
    ['.ck-sp-void', 'fill: var(--ink-faint); font-size: 10px;'],

    ['.ck-sp-last',
     'font-family: var(--mono); font-size: 13px; color: var(--ink); ' +
     'font-variant-numeric: tabular-nums; white-space: nowrap;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  /* Written outside `scope` on purpose. `data-callout` lives on the section ITSELF, so the state
     selector must be CONCATENATED to the scope rather than made a descendant of it — the obvious
     ['[data-callout="off"] .ck-sp-last', ...] compiles to a descendant combinator and silently
     never matches, which is a switch that appears to do nothing. */
  const off = '.ck-sparkbar[data-card="' + id + '"][data-callout="off"] .ck-sp-last { display: none; }';

  return scope(id, rules) + '\n' + off + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the strip, the callout, the caption. */
function cardHtml(id, title, seed, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;

  const plot =
    '<svg class="ck-sp-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + seed.marks.map(oneMark).join('') + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-sparkbar" data-callout="' +
         (cfg.callout ? 'on' : 'off') + '">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="sparkbar settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('bars') + '">bars shown</label>\n' +
    '    <input id="' + f('bars') + '" name="bars" type="number" min="1" max="' + BARS_MAX +
           '" step="1" value="' + cfg.bars + '">\n' +
    '    <label for="' + f('band') + '">reference band</label>\n' +
    '    <input id="' + f('band') + '" name="band" type="checkbox"' +
           (cfg.band ? ' checked' : '') + '>\n' +
    '    <label for="' + f('callout') + '">call out the last</label>\n' +
    '    <input id="' + f('callout') + '" name="callout" type="checkbox"' +
           (cfg.callout ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">bars shown counts back from the most recent, and is clamped to 1' +
         '&ndash;' + BARS_MAX + '; past a few dozen the bars are thinner than the gaps between ' +
         'them and the strip is a smudge. there is no axis and there will not be one: a sparkline ' +
         'is for shape.</p>\n' +
    '  </div>\n' +
    '  <div class="ck-sp-row">' + plot +
         '<span class="ck-sp-last">' + CK.esc(seed.callout) + '</span></div>\n' +
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
    '/* sparkbar card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The callout is set with textContent rather than as markup, because it is the one\n' +
    '   value on this card that lives outside the drawing. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-sp-plot");\n' +
    '  var out0 = sec.querySelector(".ck-sp-last");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where strip decisions live. */\n' +
    '  function node(m) {\n' +
    '    var e = document.createElementNS(NS, m.t), a = m.a, k;\n' +
    '    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }\n' +
    '    if (m.s != null) { e.textContent = m.s; }\n' +
    '    return e;\n' +
    '  }\n' +
    '\n' +
    '  /* A repaint, not an append: the desk swaps its main element and replays every builder, so\n' +
    '     a render that added marks would stack a second strip of bars on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = spRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    if (out0) { out0.textContent = out.callout; }\n' +
    '    sec.setAttribute("data-callout", conf.callout === false ? "off" : "on");\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/sparkbar');
}

/**
 * Fold a caller's seed onto the defaults, rejecting anything the card cannot honour.
 *
 * @example settle({ bars: 9000 }).bars;   // 240
 */
function settle(seed) {
  const out = { ...defaults };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  out.bars = spBars(out.bars);
  out.band = !!out.band;
  out.callout = !!out.callout;
  return out;
}

/**
 * Build one sparkbar card.
 *
 * Every degenerate case has a decided answer rather than a crash:
 *
 * - **an empty series** draws an empty strip carrying the words "no readings", so the card keeps
 *   its place in the column rather than collapsing and reflowing everything under it
 * - **one value** draws one bar, twelve pixels wide, at the left of the strip. It is not
 *   stretched across the strip: a lone reading is a lone reading and should look like one
 * - **all values identical** draws equal bars, and the caption says the strip is level. Non-zero
 *   identical values draw a full-height wall, which is correct for a bar from zero
 * - **zero** draws a one-pixel stub, because on a strip with no axis a zero bar and a missing bar
 *   would otherwise be the same picture
 * - **a negative value** grows downward from a zero baseline that is drawn as a hairline whenever
 *   the series spans zero
 * - **min equal to max** — every reading exactly zero, or none at all — widens the domain to
 *   `[0, 1]` rather than dividing by zero, and every bar is a stub at the baseline
 * - **above or below the maximum** is not a case here and that is the point: a sparkline has no
 *   declared scale, so the extremes ARE the top and bottom of the drawing by construction, and
 *   there is nothing to exceed. The reference band is the only fixed thing on the card, and a
 *   series outside it widens the domain so the band stays visible rather than being clipped away
 * - **a missing max** likewise: there is no maximum to miss
 * - **a non-numeric value** is dropped and counted in the caption, rather than drawn as zero,
 *   which would be inventing a reading
 * - **a missing `last`** falls back to the final sample; a non-numeric one shows an em dash
 * - **a very long title** is the card heading and wraps; the strip carries no labels at all
 * - **a twelve-character unit** rides on the callout, which is a text node beside the strip and
 *   wraps onto its own line in a narrow column rather than clipping
 *
 * @param id    unique on the desk; becomes `data-card`, the CSS scope and the settings key
 * @param title the card's heading, rendered as plain text
 * @param data  `{ values, last, unit, band, settings }`, or a bare array of numbers
 * @param ord   the card's position on the desk
 * @returns `{ json, html, css, js }`
 * @throws {Error} from {@link guardEmitted} when the emitted script would break the desk
 *
 * @example
 * const card = build({ id: 'signups', title: 'signups, daily', ord: 60,
 *   data: { values: [4, 7, 3, 9, 12, 6, 8], unit: '/day', band: { lo: 5, hi: 10 } } });
 * card.html.indexOf('data-card="signups"') > 0;   // true
 *
 * @see meta
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'sparkbar' : id);
  const heading = String(title == null ? cardId : title);
  const d = !Array.isArray(data) && data && typeof data === 'object' ? data : {};

  const P = readData(data);
  const cfg = settle(d.settings);
  const seed = spRender(P, cfg);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      category: meta.category,
      readings: P.total,
      settings: cfg,
    },
    html: cardHtml(cardId, heading, seed, cfg),
    css: cardCss(cardId),
    js: cardJs(cardId, P, cfg),
  };
}

export default { meta, defaults, build };
