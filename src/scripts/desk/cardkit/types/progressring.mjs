/**
 * `progressring` — one fraction as a ring, with the two traps that make rings go wrong handled
 * explicitly rather than hoped over.
 *
 * TRAP ONE: THE FULL CIRCLE. An SVG elliptical arc is defined by its endpoints. A sweep of exactly
 * 360 degrees puts the same point at both ends, and the specification says an arc whose endpoints
 * are identical is omitted from the path — so the commonest case a progress ring exists for, one
 * hundred percent, draws NOTHING, and does it silently with no console error and no clue. This was
 * found and solved once already in this catalogue by `portfolio.mjs`, whose donut hits it whenever
 * a book holds one position. The fix is the same here and it lives in exactly one function,
 * {@link prRing}: a full turn is emitted as a stroked `<circle>`, which has no endpoints to
 * collapse. Every ring on this card goes through that function, including the track and the
 * overflow indicator, so the case cannot be handled in one place and forgotten in another.
 *
 * TRAP TWO: THE VALUE PAST THE MAXIMUM. A ring is periodic and a quantity is not. Drawing 137
 * percent as an arc of 137 percent of a turn produces a picture that is pixel-identical to 37
 * percent, so the one reading a progress ring must never get wrong — "we are over" — comes out as
 * "we are barely started". The default is therefore to clamp, to keep showing the true number in
 * the middle, and to draw a second arc OUTSIDE the ring for the excess, so being over looks like
 * being over. `overflow: 'wrap'` exists because people ask for it; it is documented here as the
 * thing it is, and its own caption says what it costs.
 *
 * @see ./portfolio.mjs — where the identical-endpoints arc bug was first found and written down
 * @see ./gauge.mjs     — the open-arc form, whose span is capped at 350 for the same reason
 * @see ../CONTRACT.md  — `shape` is a string, `defaults` is an object, `category` is required
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
 * @example loadKit().esc('<b>');   // '&lt;b&gt;'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/progressring: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/progressring: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * `clamp` is the default overflow mode and the choice is the whole argument of the file: a wrapped
 * ring past one hundred percent is indistinguishable from a small ring, so wrapping turns the one
 * reading that matters into its opposite. Zero degrees is twelve o'clock, which is where a reader
 * starts looking at anything round.
 *
 * @example defaults.overflow;   // 'clamp'
 */
export const defaults = {
  thickness:  10,
  startAngle: 0,
  overflow:   'clamp',
};

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `ranking-and-comparison`: a ring answers "how far along is this against its whole", which is a
 * comparison of one number against one other number. It is not `part-of-a-whole` — that category
 * is for a quantity DIVIDED among members, and a ring has exactly one member and its complement.
 *
 * @example meta.name;   // 'progressring'
 */
export const meta = {
  name: 'progressring',
  summary:
    'One fraction as a ring, emitting a real circle at a full turn and drawing an over-maximum ' +
    'value outside the ring rather than wrapping it back to something small.',
  shape:
    "{ value, max, label, unit, thickness } — max defaults to 100 when absent; a max of zero or " +
    "less leaves no fraction to draw; thickness seeds the setting of the same name",
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
 * @example blankNonCode('/* let it be *' + '/ var a = 1;').indexOf('let');   // -1
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
  const where = who || 'cardkit/progressring';
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

/** The thinnest and thickest ring the card will draw. Below two it is a hairline, past 28 a disc. */
const THICK_MIN = 2;
const THICK_MAX = 28;

/** The denominator assumed when none is given. See {@link readData} for why this card has one. */
const MAX_ASSUMED = 100;

/** A finite number, or null. Used everywhere a caller's number is read for the first time. */
function num(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise whatever arrived into the payload the renderer takes.
 *
 * A missing maximum defaults to 100 here, and `gauge` refuses to default one at all. The two are
 * not inconsistent: a PROGRESS ring is by name a fraction, and a fraction has a conventional
 * denominator that everybody reaches for when none is stated. A gauge is an arbitrary bounded
 * scale — knots, degrees, gigabytes — and there is no convention to reach for, so inventing one
 * would put a needle at a position nobody supplied. The assumption is stated in the caption rather
 * than made quietly, which is the part that makes it acceptable.
 *
 * A maximum of zero or less is a different thing again, and is not defaulted: it is an explicit
 * instruction to divide by nothing. The card draws its track, states the raw value, and says why
 * there is no fraction.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ value, hasValue, max, hasScale, assumed, ratio, label, unit, thickness }`
 *
 * @example readData({ value: 42 }).max;            // 100
 * @example readData({ value: 42, max: 0 }).hasScale;   // false
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};

  const value = num(d.value);
  const givenMax = num(d.max);
  const assumed = givenMax === null;
  const max = assumed ? MAX_ASSUMED : givenMax;
  const hasScale = max > 0;

  return {
    value: value === null ? 0 : value,
    hasValue: value !== null,
    badValue: value === null && d.value != null,
    max,
    hasScale,
    assumed,
    /* The ratio is computed once, here, and never recomputed downstream. Two places computing one
       division is two places that can disagree about a degenerate denominator. */
    ratio: hasScale && value !== null ? value / max : 0,
    label: d.label == null ? '' : String(d.label),
    /* Capped rather than refused: twelve characters fit under the number; past thirty it is prose
       in the wrong field and would spill out of the ring. */
    unit: d.unit == null ? '' : String(d.unit).trim().slice(0, 30),
    /* The seed for the setting of the same name. `meta.defaults` stays the static declaration a
       validator reads; this is what the panel opens showing. */
    thickness: num(d.thickness),
  };
}

/* ── the shipped half: everything below runs in Node and in the browser, unchanged ───── */

/* ES5-shaped on purpose — var, function, no arrows, no template literals, no backticks even in
   the comments. These are emitted through Function.prototype.toString(). */

/** Two decimals, refusing a coordinate that is not a number so a silent empty draw cannot ship. */
function prFin(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/progressring: non-finite coordinate from ' + what + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Thousands separators, inserted into a run of digits from the right. */
function prGroup(digits) {
  var out = '';
  var i;
  for (i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) { out += ','; }
    out += digits.charAt(i);
  }
  return out;
}

/** A number at up to `dp` decimals, trailing zeros trimmed, thousands grouped. */
function prNum(v, dp) {
  var neg = v < 0;
  var s = Math.abs(v).toFixed(dp);
  var dot = s.indexOf('.');
  var whole = dot < 0 ? s : s.slice(0, dot);
  var frac = dot < 0 ? '' : s.slice(dot + 1);
  while (frac.length && frac.charAt(frac.length - 1) === '0') { frac = frac.slice(0, frac.length - 1); }
  return (neg ? '-' : '') + prGroup(whole) + (frac.length ? '.' + frac : '');
}

/** Shorten a string to a pixel budget at a given font size, marking the cut. */
function prClip(s, max, size) {
  var str = String(s);
  var per = 5.42 * ((size || 9) / 9);
  var room = Math.floor(max / per);
  if (str.length <= room) { return str; }
  if (room < 2) { return '\u2026'; }
  return str.slice(0, room - 1) + '\u2026';
}

/** The ring thickness the card will actually draw, clamped to what a ring can be. */
function prThick(v) {
  var n = Number(v);
  if (!isFinite(n)) { return 10; }
  n = Math.round(n * 10) / 10;
  if (n < 2) { return 2; }
  if (n > 28) { return 28; }
  return n;
}

/** A start angle normalised into one turn, measured clockwise from twelve o'clock. */
function prStart(v) {
  var n = Number(v);
  if (!isFinite(n)) { return 0; }
  n = Math.round(n * 10) / 10;
  return ((n % 360) + 360) % 360;
}

/** A point on the ring, from an angle in degrees clockwise from twelve o'clock. */
function prPt(cx, cy, r, deg) {
  var rad = deg * Math.PI / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/**
 * One ring segment, as the element that can actually draw it.
 *
 * THIS IS THE FUNCTION THE FULL-CIRCLE TRAP LIVES IN, and it is the only place in the file that
 * decides between a circle and a path. An SVG arc is defined by its endpoints; a sweep of a whole
 * turn has the same point at both ends, and the specification omits such an arc from the path
 * entirely. So a hundred percent, the case the card exists for, would silently draw nothing. A
 * full turn is therefore a stroked circle, which has no endpoints to collapse.
 *
 * Every ring the card draws goes through here — the track, the fill, the overflow indicator —
 * which is what stops the case from being solved once and forgotten somewhere else.
 *
 * @param cx    centre x
 * @param cy    centre y
 * @param r     the radius of the CENTRE of the stroke; the stroke width is its thickness
 * @param from  the start angle, clockwise from twelve o'clock
 * @param sweep how far it runs, in degrees; zero or less draws nothing at all
 * @param w     the stroke width
 * @param cls   the mark class
 * @returns a mark, or null when there is nothing to draw
 *
 * @example prRing(60, 60, 50, 0, 360, 10, 'x').t;   // 'circle'
 * @example prRing(60, 60, 50, 0, 90, 10, 'x').t;    // 'path'
 */
function prRing(cx, cy, r, from, sweep, w, cls) {
  /* Nothing at all rather than a zero-length arc. With a round cap a zero-length stroke renders
     as a dot sitting at the start of the ring, which reads as a small value somebody put there;
     with a butt cap it renders as nothing anyway, but through a path element that exists. */
  if (!(sweep > 0)) { return null; }

  var rr = prFin(r, 'ring radius');
  var ww = prFin(w, 'ring width');

  if (sweep >= 359.99) {
    return { t: 'circle', a: { cx: prFin(cx, 'ring'), cy: prFin(cy, 'ring'), r: rr,
                               'stroke-width': ww, 'class': cls } };
  }

  var a = prPt(cx, cy, r, from);
  var b = prPt(cx, cy, r, from + sweep);
  return { t: 'path', a: {
    d: 'M' + prFin(a[0], 'ring') + ' ' + prFin(a[1], 'ring') +
       'A' + rr + ' ' + rr + ' 0 ' + (sweep > 180 ? 1 : 0) + ' 1 ' +
       prFin(b[0], 'ring') + ' ' + prFin(b[1], 'ring'),
    'stroke-width': ww, 'class': cls
  } };
}

/** One text mark. The body is set with textContent in the browser, never with markup. */
function prText(x, y, s, cls) {
  return { t: 'text', a: { x: prFin(x, 'text'), y: prFin(y, 'text'),
                           'text-anchor': 'middle', 'class': cls }, s: String(s) };
}

/**
 * How much of a turn to fill, under the chosen overflow rule.
 *
 * `clamp` stops at a whole turn and lets the caller draw the excess elsewhere. `wrap` takes the
 * fractional part, WITH one correction that matters: an exact multiple of the maximum has a
 * fractional part of zero, so 100 percent and 200 percent would both draw an empty ring. They
 * draw a full one instead. That correction makes wrap less wrong; it does not make it right, and
 * nothing can — 137 percent wrapped is the same picture as 37 percent, which is the whole reason
 * clamp is the default.
 *
 * @example prFrac(1.37, 'clamp');   // 1
 * @example prFrac(1.37, 'wrap');    // 0.37 (approximately)
 * @example prFrac(2, 'wrap');       // 1
 */
function prFrac(ratio, mode) {
  if (mode === 'wrap') {
    if (!(ratio > 0)) { return 0; }
    var f = ratio - Math.floor(ratio);
    return f === 0 ? 1 : f;
  }
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption states both traps, because both are decisions the reader cannot see from the
 * picture: that a full ring is a real circle rather than an arc, and what happened to a value
 * that ran past its maximum.
 */
function prNote(P, conf, mode) {
  var esc = CK.esc;
  var unit = P.unit ? ' ' + P.unit : '';
  var shownVal = P.hasValue ? prNum(P.value, 2) + unit : '\u2014';

  if (!P.hasScale) {
    return {
      aria: 'Progress ring with no fraction: the maximum is ' + prNum(P.max, 2) +
            ', so there is nothing to divide by. The value is ' + shownVal + '.',
      caption: 'the value is <b>' + esc(shownVal) + '</b> and there is <b>no fraction</b>: the ' +
               'maximum is ' + esc(prNum(P.max, 2)) + ', so the division has no answer. the ring ' +
               'keeps its track and states the number instead of drawing a position nobody ' +
               'supplied. '
    };
  }

  var pct = prNum(P.ratio * 100, P.ratio * 100 < 10 ? 1 : 0);
  var over = P.ratio > 1;
  var under = P.ratio < 0;

  var lead = '<b>' + esc(pct) + '%</b> &mdash; ' + esc(shownVal) + ' of ' +
             esc(prNum(P.max, 2) + unit) + '. ';
  var aria = 'Progress ring at ' + pct + ' percent: ' + shownVal + ' of ' + prNum(P.max, 2) + unit + '. ';

  if (P.assumed) {
    lead += '<i>no maximum was given</i>, so ' + esc(String(P.max)) + ' is assumed &mdash; a ' +
            'fraction has a conventional denominator where an arbitrary scale does not, which is ' +
            'why the gauge card refuses to assume one and this card will. ';
  }

  if (P.ratio >= 1 && mode === 'clamp') {
    lead += 'a full turn is drawn as a real circle rather than as an arc: an arc whose endpoints ' +
            'are identical is omitted from the path by the SVG specification, so a hundred percent ' +
            'drawn the obvious way is a ring that silently renders nothing. ';
  }
  if (over && mode === 'clamp') {
    lead += '<i>the value is past its maximum</i> by ' +
            esc(prNum((P.ratio - 1) * 100, 0)) + '%, and the ring is clamped at a full turn with ' +
            'the excess drawn as the thin arc outside it. it is not wrapped, because a wrapped ' +
            '137% is the same picture as 37% and the one reading this card must not get wrong is ' +
            'whether we are over. ';
    aria += 'The value is past its maximum by ' + prNum((P.ratio - 1) * 100, 0) + ' percent. ';
  }
  if (over && mode === 'wrap') {
    lead += '<span class="ck-aside"><i>wrap is on</i>, so the ring shows only the fractional part ' +
            'of ' + esc(prNum(P.ratio, 2)) + ' turns. that is what wrap is: at this setting a ' +
            'ring at ' + esc(pct) + '% is drawn identically to one at ' +
            esc(prNum(prFrac(P.ratio, 'wrap') * 100, 0)) + '%, and only the number in the middle ' +
            'tells them apart. clamp is the honest mode.</span> ';
    aria += 'Wrap is on; the ring shows only the fractional part of ' + prNum(P.ratio, 2) + ' turns. ';
  }
  if (under) {
    lead += '<i>the value is below zero</i>, so the ring is empty and the shortfall is drawn as ' +
            'the thin arc outside it, running backwards from the start. ';
    aria += 'The value is below zero. ';
  }
  if (!P.hasValue) {
    lead += '<i>no value was supplied</i>, so the ring carries its track and nothing else. ';
  }
  if (P.badValue) { lead += 'the value supplied was not a number. '; }

  return { aria: aria, caption: lead };
}

/**
 * Every mark in the ring, and the size of the box it needs.
 *
 * Runs in Node at build time and in the browser on every settings change, from the same text.
 *
 * @param P    the payload from {@link readData}
 * @param conf the settled settings: `thickness`, `startAngle`, `overflow`
 * @returns `{ W, H, marks, note, frac, thickness, start }`
 * @throws {Error} when any coordinate comes out non-finite
 */
function prRender(P, conf) {
  var t = prThick(conf.thickness);
  var start = prStart(conf.startAngle);
  var mode = conf.overflow === 'wrap' ? 'wrap' : 'clamp';
  var marks = [];

  var BOX = 140;
  var cx = BOX / 2;
  var cy = BOX / 2;
  /* The OUTER edge of the ring sits at a constant radius whatever the thickness, so the overflow
     arc outside it never has to move and never has to be checked against the viewBox. */
  var R = BOX / 2 - 8 - t / 2;
  var rOut = BOX / 2 - 4;
  var inner = R - t / 2;

  var frac = P.hasScale && P.hasValue ? prFrac(P.ratio, mode) : 0;
  var note = prNote(P, conf, mode);

  /* The track is a circle for the same reason the full fill is: it is a whole turn, and building
     it as an arc would put the identical-endpoints bug on every single card rather than only on
     the ones that reach a hundred percent. */
  marks.push(prRing(cx, cy, R, start, 360, t, 'ck-pr-track'));

  var fill = prRing(cx, cy, R, start, frac * 360, t,
                    P.ratio > 1 && mode === 'clamp' ? 'ck-pr-fill ck-pr-full' : 'ck-pr-fill');
  if (fill) { marks.push(fill); }

  if (P.hasScale && P.hasValue && mode === 'clamp') {
    if (P.ratio > 1) {
      var excess = Math.min(1, P.ratio - 1);
      var ov = prRing(cx, cy, rOut, start, excess * 360, 3, 'ck-pr-over');
      if (ov) { marks.push(ov); }
    } else if (P.ratio < 0) {
      var short = Math.min(1, -P.ratio);
      var un = prRing(cx, cy, rOut, start - short * 360, short * 360, 3, 'ck-pr-over');
      if (un) { marks.push(un); }
    }
  }

  /* Three tiers inside the hole, and each one clipped to the chord it has to fit across rather
     than to the diameter. A string sized against the diameter overflows a ring the moment the
     thickness setting goes up. */
  var room = Math.max(20, inner * 1.42);
  var big = P.hasScale
    ? prNum(P.ratio * 100, P.ratio * 100 < 10 ? 1 : 0) + '%'
    : (P.hasValue ? prNum(P.value, 2) : '\u2014');
  marks.push(prText(cx, cy + (P.label || P.unit ? -1 : 7), prClip(big, room, 21), 'ck-pr-read'));

  var sub = P.hasScale && P.hasValue
    ? prNum(P.value, 2) + (P.unit ? ' ' + P.unit : '') + ' / ' + prNum(P.max, 2)
    : (P.unit || '');
  if (sub) { marks.push(prText(cx, cy + 13, prClip(sub, room, 9), 'ck-pr-sub')); }
  if (P.label) {
    var lab = prText(cx, cy + (sub ? 25 : 15), prClip(P.label, room, 9), 'ck-pr-lab');
    /* The full label survives as a tooltip when the drawn one was cut, so clipping loses nothing
       a reader could not get back. */
    lab.ti = P.label;
    marks.push(lab);
  }

  return { W: BOX, H: BOX, marks: marks, note: note, frac: frac, thickness: t, start: start,
           mode: mode };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [prFin, prGroup, prNum, prClip, prThick, prStart, prPt, prRing, prText, prFrac,
                 prNote, prRender];

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
 * @example jsLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(TICK_RE, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * One display-list mark as SVG markup, for the copy that ships drawn inside `card.html`.
 *
 * Only `m.a` becomes attributes, so a mark may carry bookkeeping the element never sees. Font size
 * is never among the attributes: it belongs to the stylesheet, and a size written onto the element
 * would win over the theme.
 */
function oneMark(m) {
  let s = '<' + m.t;
  for (const k in m.a) {
    if (Object.hasOwn(m.a, k) && m.a[k] != null && m.a[k] !== '') s += ' ' + k + '="' + CK.esc(m.a[k]) + '"';
  }
  const body = (m.s != null ? CK.esc(m.s) : '') +
               (m.ti != null ? '<title>' + CK.esc(m.ti) + '</title>' : '');
  return s + '>' + body + '</' + m.t + '>';
}

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-progressring[data-card="' + id + '"]';
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
 * No literal colour and no `:root` block: nothing on this card is an ordered ramp, so every mark
 * takes a desk token as it stands.
 *
 * `stroke-width` is deliberately absent from every ring rule. It is set as a presentation
 * ATTRIBUTE on each mark, because it is the thickness setting and therefore data rather than
 * style, and a CSS declaration would win over the attribute and silently pin every ring to one
 * width no matter what the reader chose.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-pr-plot', 'display: block; width: 100%; max-width: 190px; height: auto; margin: 0 auto;'],
    ['.ck-pr-plot text', 'font-family: var(--mono);'],

    ['.ck-pr-track', 'fill: none; stroke: var(--well);'],
    ['.ck-pr-fill', 'fill: none; stroke: var(--accent); stroke-linecap: butt;'],
    /* A ring past its maximum takes the ink colour as well as growing an outer arc, so being over
       is legible without the second mark — colour alone is never the encoding here, it is the
       third copy of a fact the number and the outer arc already carry. */
    ['.ck-pr-full', 'stroke: var(--ink);'],
    ['.ck-pr-over', 'fill: none; stroke: var(--accent); stroke-linecap: round;'],

    ['.ck-pr-read', 'fill: var(--ink); font-size: 21px; font-family: var(--disp), var(--mono);'],
    ['.ck-pr-sub', 'fill: var(--ink-dim); font-size: 9px;'],
    ['.ck-pr-lab', 'fill: var(--ink-faint); font-size: 9px;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the ring, and the caption. */
function cardHtml(id, title, seed, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' +
    CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-pr-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + seed.marks.map(oneMark).join('') + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-progressring">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="progress ring settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('thickness') + '">ring thickness</label>\n' +
    '    <input id="' + f('thickness') + '" name="thickness" type="number" min="' + THICK_MIN +
           '" max="' + THICK_MAX + '" step="1" value="' + cfg.thickness + '">\n' +
    '    <label for="' + f('startAngle') + '">start angle, degrees</label>\n' +
    '    <input id="' + f('startAngle') + '" name="startAngle" type="number" min="0" max="359" ' +
           'step="15" value="' + cfg.startAngle + '">\n' +
    '    <label for="' + f('overflow') + '">past the maximum</label>\n' +
    '    <select id="' + f('overflow') + '" name="overflow">' +
         opt('clamp', 'clamp, and show the excess outside', cfg.overflow) +
         opt('wrap', 'wrap around the ring', cfg.overflow) + '</select>\n' +
    '    <p class="ck-set-foot">wrap draws only the fractional part of a turn, so 137% and 37% ' +
         'come out as the same picture and only the number in the middle tells them apart. it is ' +
         'offered because people ask for it; clamp is the mode that cannot mislead. zero degrees ' +
         'is twelve o\u2019clock and the fill runs clockwise.</p>\n' +
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
    '/* progress ring card: the same renderer that drew the copy in card.html, re-run when a\n' +
    '   setting changes. The full-turn case goes through prRing in both, so a ring the reader\n' +
    '   thickens at a hundred percent stays a circle rather than becoming an arc that draws\n' +
    '   nothing. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-pr-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where ring decisions live. */\n' +
    '  function node(m) {\n' +
    '    var e = document.createElementNS(NS, m.t), a = m.a, k, tip;\n' +
    '    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }\n' +
    '    if (m.s != null) { e.textContent = m.s; }\n' +
    '    if (m.ti != null) {\n' +
    '      tip = document.createElementNS(NS, "title");\n' +
    '      tip.textContent = m.ti;\n' +
    '      e.appendChild(tip);\n' +
    '    }\n' +
    '    return e;\n' +
    '  }\n' +
    '\n' +
    '  /* A repaint, not an append: the desk swaps its main element and replays every builder, so\n' +
    '     a render that added marks would stack a second ring on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = prRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { if (out.marks[i]) { plot.appendChild(node(out.marks[i])); } }\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/progressring');
}

/**
 * Fold a caller's seed onto the defaults, rejecting anything the card cannot honour.
 *
 * `data.thickness` seeds the setting when the descriptor carried one, so a card can ship at the
 * width its author wanted without the viewer having to ask for it. `meta.defaults` stays the
 * static declaration a validator reads.
 *
 * @example settle({ overflow: 'nope' }, null).overflow;   // 'clamp'
 */
function settle(seed, dataThickness) {
  const out = { ...defaults };
  if (dataThickness !== null && dataThickness !== undefined) out.thickness = dataThickness;
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  out.thickness = prThick(out.thickness);
  out.startAngle = prStart(out.startAngle);
  out.overflow = out.overflow === 'wrap' ? 'wrap' : 'clamp';
  return out;
}

/**
 * Build one progress ring card.
 *
 * Every degenerate case has a decided answer rather than a crash:
 *
 * - **zero** draws no fill at all rather than a round-capped dot at the start angle, which would
 *   read as a small amount of progress somebody made
 * - **the maximum exactly** draws a `<circle>` and NO path. That is the trap this card exists to
 *   handle: an arc of exactly 360 degrees has identical endpoints and the SVG specification omits
 *   it, so the obvious implementation renders nothing at a hundred percent
 * - **above the maximum** clamps the ring at a full turn, colours it differently, AND draws the
 *   excess as a thin arc outside the ring, with the true percentage still in the middle. Under
 *   `overflow: 'wrap'` it wraps instead, which is documented in the caption as the thing it is:
 *   137% drawn as 37%, distinguishable only by the number
 * - **below the minimum** and **a negative value** empty the ring and draw the shortfall as an
 *   outer arc running backwards from the start angle
 * - **min equal to max** is `max` of zero: the division has no answer, so the card draws its
 *   track, states the raw value in the middle, and says why there is no fraction
 * - **a missing max** assumes 100 and SAYS SO in the caption. `gauge` refuses the same assumption,
 *   and the difference is deliberate: a fraction has a conventional denominator, an arbitrary
 *   bounded scale does not
 * - **a non-numeric value** draws the track and an em dash
 * - **a missing target** is not a case: a ring has no target, only a maximum. Use `bullet` when
 *   the number needs a target as well as a bound
 * - **a very long label** is clipped to the chord it must fit across — measured against the hole,
 *   which shrinks as the thickness setting grows — with the full text kept in a tooltip
 * - **a twelve-character unit** rides on the middle line beside the value, and is clipped by the
 *   same rule
 *
 * @param id    unique on the desk; becomes `data-card`, the CSS scope and the settings key
 * @param title the card's heading, rendered as plain text
 * @param data  `{ value, max, label, unit, thickness, settings }`; everything is untrusted
 * @param ord   the card's position on the desk
 * @returns `{ json, html, css, js }`
 * @throws {Error} from {@link guardEmitted} when the emitted script would break the desk
 *
 * @example
 * const card = build({ id: 'quota', title: 'build minutes', ord: 25,
 *   data: { value: 2400, max: 3000, label: 'this month', unit: 'min' } });
 * card.html.indexOf('data-card="quota"') > 0;   // true
 *
 * @see meta
 * @see ./portfolio.mjs — the same full-circle rule, found there first
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'progressring' : id);
  const heading = String(title == null ? cardId : title);
  const d = data && typeof data === 'object' ? data : {};

  const P = readData(data);
  const cfg = settle(d.settings, P.thickness);
  const seed = prRender(P, cfg);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      category: meta.category,
      hasScale: P.hasScale,
      settings: cfg,
    },
    html: cardHtml(cardId, heading, seed, cfg),
    css: cardCss(cardId),
    js: cardJs(cardId, P, cfg),
  };
}

export default { meta, defaults, build };
