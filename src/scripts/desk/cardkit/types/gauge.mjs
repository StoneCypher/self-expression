/**
 * `gauge` — an arc with a filled sweep or a needle, for one number against a bounded scale.
 *
 * THIS TYPE ARGUES AGAINST ITSELF, ON PURPOSE, IN ITS OWN CAPTION. That is the honest thing for
 * it to do and it is worth writing down why rather than leaving it as a tone.
 *
 * Everything a gauge does, `bullet` in this same catalogue does better and in a tenth of the
 * area. Cleveland and McGill ranked the elementary perceptual tasks by how accurately people
 * perform them, and position along a common scale came first while angle came fourth; a gauge
 * asks the reader to do the fourth thing to learn what the first thing would have told them. A
 * partial arc also has no natural zero — the reader must first find where the scale starts before
 * the picture means anything, which is a step a bar does not have. And the area cost is enormous:
 * this card spends a disc on a single number that a bullet fits into one line of text, with its
 * target and its qualitative ranges still in the picture.
 *
 * So why does the file exist. Because the demand is real and the alternative to a gauge in the
 * catalogue is a gauge outside it — hand-rolled, with literal colours, a `prefers-color-scheme`
 * media query and a charting library pulled past the CSP. A catalogue that contains an entry
 * arguing against itself teaches the comparison at the moment somebody is choosing; a catalogue
 * that quietly omits the thing people came for teaches nothing at all. There is also one case a
 * gauge genuinely wins: a bounded physical quantity with a culturally fixed dial — speed, fuel,
 * temperature, disk — read at a glance from across a room. A desk card is read at arm's length in
 * a narrow column, so that case is not this surface, and the caption says so.
 *
 * The span is capped at 350 degrees and never reaches 360. That is not a rounding cushion: an SVG
 * elliptical arc is defined by its endpoints, and one covering the whole circle has the same point
 * at both ends, so the specification says it is omitted from the path and the gauge silently draws
 * nothing. A ring is a different card. Use `progressring`, which handles that case by emitting a
 * `<circle>` instead of an arc.
 *
 * @see ./bullet.mjs       — the replacement; same job, a tenth of the area, more accurate reading
 * @see ./progressring.mjs — the closed-ring form, and how the 360-degree case must be drawn
 * @see ../CONTRACT.md     — `shape` is a string, `defaults` is an object, `category` is required
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
 * @example loadKit().fmt(1200);   // '1.2k'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/gauge: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/gauge: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * `sweep` is the default and `needle` is the option, which is the opposite of what a dashboard
 * habit would pick. A filled sweep encodes the value as arc LENGTH, and length is a quantity the
 * reader can compare; a needle encodes it as angle alone and adds a hub, a taper and a shadow of
 * skeuomorphism for nothing. The needle is here because people ask for it by name.
 *
 * 240 degrees is the default span because it is the widest arc that still leaves the two ends
 * clearly separated at the bottom, so a reader can see where the scale starts and stops.
 *
 * `zones` here is the display switch for the qualitative bands supplied in `data.zones`. The two
 * share a name and are different things: the data says where the bands are, the setting says
 * whether to draw them.
 *
 * @example defaults.span;   // 240
 */
export const defaults = {
  style: 'sweep',
  span:  240,
  zones: true,
};

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `ranking-and-comparison`, the same category as `bullet`, and deliberately so: a reader browsing
 * that category meets both entries side by side, which is exactly the comparison this file wants
 * them to make.
 *
 * @example meta.name;   // 'gauge'
 */
export const meta = {
  name: 'gauge',
  summary:
    'A dial: one number as a filled sweep or a needle on a bounded arc, with a caption that ' +
    'states what the form costs and names the bullet graph that does the same job smaller.',
  shape:
    '{ value, min, max, target, zones, unit } — zones are ascending band boundaries, either ' +
    'numbers or { to, label }, at most four; min defaults to 0 and a missing or collapsed max ' +
    'leaves the gauge with no scale to draw',
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
 * @example blankNonCode('var a = "let";').indexOf('let');   // -1
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
  const where = who || 'cardkit/gauge';
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
 * The narrowest and widest arc the card will draw.
 *
 * The upper bound is the load-bearing one. At exactly 360 degrees an SVG arc has identical
 * endpoints and the specification omits it from the path, so the gauge draws nothing at all and
 * does it silently. 350 keeps a visible gap that also tells the reader where the scale begins.
 * Below 30 degrees the arc is a dash and the angular encoding has stopped meaning anything.
 */
const SPAN_MIN = 30;
const SPAN_MAX = 350;

/** At most four zones, for the same reason a bullet has at most three bands: readers rank shades. */
const MAX_ZONES = 4;

/** A finite number, or null. Used everywhere a caller's number is read for the first time. */
function num(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise whatever arrived into the payload the renderer takes.
 *
 * The scale is the decision worth reading. A gauge without both ends of its scale is not a gauge
 * that needs a default; it is a gauge with nothing to draw, so `hasScale` is false and the card
 * shows its track, its number, and a caption saying why the dial is empty. That is deliberately
 * different from `progressring`, which assumes a maximum of 100 when none is given — a *fraction*
 * has a conventional denominator and an arbitrary bounded scale does not, and inventing one here
 * would put a needle at a position nobody supplied.
 *
 * A reversed pair is swapped rather than refused, and the caption says it was: a caller who wrote
 * min and max the wrong way round meant the range between them.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ value, hasValue, min, max, hasScale, swapped, target, hasTarget, zones, unit, ... }`
 *
 * @example readData({ value: 42, max: 100 }).hasScale;   // true
 * @example readData({ value: 42 }).hasScale;             // false
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};

  const value = num(d.value);
  let min = num(d.min);
  let max = num(d.max);
  if (min === null) min = 0;

  let swapped = false;
  if (max !== null && max < min) { const t = min; min = max; max = t; swapped = true; }

  const hasScale = max !== null && max > min;
  const target = num(d.target);

  /* Zones accept either bare boundaries or labelled ones. Both end up as { to, label } so the
     renderer and the caption never have to ask which form arrived. */
  const zones = [];
  let overZones = 0;
  if (Array.isArray(d.zones)) {
    const seen = [];
    for (const z of d.zones) {
      const to = z && typeof z === 'object' ? num(z.to) : num(z);
      if (to === null) continue;
      if (seen.indexOf(to) >= 0) continue;
      seen.push(to);
      zones.push({ to, label: z && typeof z === 'object' && z.label != null ? String(z.label) : '' });
    }
    zones.sort((a, b) => a.to - b.to);
    if (zones.length > MAX_ZONES) { overZones = zones.length - MAX_ZONES; zones.length = MAX_ZONES; }
  }

  return {
    value: value === null ? 0 : value,
    hasValue: value !== null,
    badValue: value === null && d.value != null,
    min,
    max: hasScale ? max : min,
    hasScale,
    noMax: max === null,
    swapped,
    target: target === null ? 0 : target,
    hasTarget: target !== null,
    zones,
    overZones,
    /* Capped rather than refused: a unit is a caption, not an identifier. Twelve characters fit;
       past thirty it is prose in the wrong field and would run off the dial. */
    unit: d.unit == null ? '' : String(d.unit).trim().slice(0, 30),
  };
}

/* ── the shipped half: everything below runs in Node and in the browser, unchanged ───── */

/* ES5-shaped on purpose — var, function, no arrows, no template literals, no backticks even in
   the comments. These are emitted through Function.prototype.toString() into a page that ships no
   transpiler and concatenates every card's script into one inline block. */

/** Two decimals, refusing a coordinate that is not a number so a silent empty draw cannot ship. */
function gaFin(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/gauge: non-finite coordinate from ' + what + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Advance width of the 9px monospace, deliberately a hair pessimistic. */
function gaTw(s, size) { return String(s).length * 5.42 * ((size || 9) / 9); }

/** Shorten a string to a pixel budget, keeping the head and marking the cut. */
function gaClip(s, max, size) {
  var str = String(s);
  var per = 5.42 * ((size || 9) / 9);
  var room = Math.floor(max / per);
  if (str.length <= room) { return str; }
  if (room < 2) { return '\u2026'; }
  return str.slice(0, room - 1) + '\u2026';
}

/** Thousands separators, inserted into a run of digits from the right. */
function gaGroup(digits) {
  var out = '';
  var i;
  for (i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) { out += ','; }
    out += digits.charAt(i);
  }
  return out;
}

/** A number at up to `dp` decimals, trailing zeros trimmed, thousands grouped. */
function gaNum(v, dp) {
  var neg = v < 0;
  var s = Math.abs(v).toFixed(dp);
  var dot = s.indexOf('.');
  var whole = dot < 0 ? s : s.slice(0, dot);
  var frac = dot < 0 ? '' : s.slice(dot + 1);
  while (frac.length && frac.charAt(frac.length - 1) === '0') { frac = frac.slice(0, frac.length - 1); }
  return (neg ? '-' : '') + gaGroup(whole) + (frac.length ? '.' + frac : '');
}

/**
 * The span the card will actually draw, in degrees.
 *
 * Clamped rather than refused, because the span is a viewer setting and a viewer who types 400
 * meant as much arc as they can have. The upper clamp is the one that matters: at 360 an SVG arc
 * has identical endpoints and is omitted from the path, so the honest maximum is the largest
 * value that still leaves two ends.
 */
function gaSpan(v) {
  var n = Number(v);
  if (!isFinite(n)) { return 240; }
  n = Math.round(n);
  if (n < 30) { return 30; }
  if (n > 350) { return 350; }
  return n;
}

/** A point on the dial, from an angle in degrees clockwise from twelve o'clock. */
function gaPt(cx, cy, r, deg) {
  var rad = deg * Math.PI / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/** One arc as a stroked path mark, running clockwise from `d0` to `d1`. */
function gaArc(cx, cy, r, d0, d1, cls, extra) {
  var a = gaPt(cx, cy, r, d0);
  var b = gaPt(cx, cy, r, d1);
  var big = Math.abs(d1 - d0) > 180 ? 1 : 0;
  var rr = gaFin(r, 'arc radius');
  var at = {
    d: 'M' + gaFin(a[0], 'arc') + ' ' + gaFin(a[1], 'arc') +
       'A' + rr + ' ' + rr + ' 0 ' + big + ' ' + (d1 >= d0 ? 1 : 0) + ' ' +
       gaFin(b[0], 'arc') + ' ' + gaFin(b[1], 'arc'),
    'class': cls
  };
  var k;
  if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { at[k] = extra[k]; } } }
  return { t: 'path', a: at };
}

/** One line mark. */
function gaLine(x1, y1, x2, y2, cls, extra) {
  var a = { x1: gaFin(x1, 'line'), y1: gaFin(y1, 'line'),
            x2: gaFin(x2, 'line'), y2: gaFin(y2, 'line'), 'class': cls };
  var k;
  if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { a[k] = extra[k]; } } }
  return { t: 'line', a: a };
}

/** One circle mark. */
function gaDot(cx, cy, r, cls) {
  return { t: 'circle', a: { cx: gaFin(cx, 'dot'), cy: gaFin(cy, 'dot'), r: gaFin(r, 'dot'), 'class': cls } };
}

/** One text mark. The body is set with textContent in the browser, never with markup. */
function gaText(x, y, s, cls, anchor) {
  var a = { x: gaFin(x, 'text'), y: gaFin(y, 'text'), 'class': cls };
  if (anchor) { a['text-anchor'] = anchor; }
  return { t: 'text', a: a, s: String(s) };
}

/**
 * Where a value sits on the dial, as a fraction of the span and as an angle.
 *
 * The clamp is the whole function. A value past the maximum must not keep travelling round the
 * dial, because past the arc end there is nothing for it to mean and past a full turn it would
 * come back looking small. It stops at the end, the caller is told it stopped, and the drawing
 * grows a mark outside the track saying there is more.
 */
function gaAt(P, span, v) {
  if (!P.hasScale) { return { frac: 0, deg: -span / 2, over: false, under: false }; }
  var raw = (v - P.min) / (P.max - P.min);
  var frac = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return { frac: frac, deg: -span / 2 + frac * span, over: raw > 1, under: raw < 0 };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption ends with a standing paragraph that states what this form costs and names the card
 * that does the job better. It is not an apology and it is not decoration: a reader choosing a
 * card type reads captions, and the moment they are looking at a gauge is the only moment the
 * comparison is useful to them.
 */
function gaNote(P, conf, span, at) {
  var esc = CK.esc;
  var unit = P.unit ? ' ' + P.unit : '';
  var shown = P.hasValue ? gaNum(P.value, 2) + unit : '\u2014';

  var cost =
    '<span class="ck-aside">this form costs: it spends a large area on one number, an angle is ' +
    'judged less accurately than a position along a line, and a partial arc has no natural zero, ' +
    'so the reader must find where the scale starts before the picture means anything. ' +
    '<b>bullet</b> draws the same measure, the same target and the same qualitative bands as ' +
    'position along a line, in one row.</span>';

  if (!P.hasScale) {
    var why = P.noMax ? 'no maximum was supplied' : 'the minimum and the maximum are the same number';
    return {
      aria: 'Gauge with no scale: ' + why + ', so nothing is drawn on the arc. The value is ' + shown + '.',
      caption: 'the reading is <b>' + esc(shown) + '</b>, and the dial is empty because ' +
               esc(why) + ' &mdash; a bounded arc with no bounds has no position to put anything at. ' +
               'the number is stated rather than drawn, which is the honest picture of a gauge that ' +
               'cannot be scaled. ' + cost
    };
  }

  var pct = gaNum(at.frac * 100, 0);
  var range = gaNum(P.min, 2) + ' to ' + gaNum(P.max, 2) + unit;

  var lead = 'the reading is <b>' + esc(shown) + '</b> on a scale of ' + esc(range) +
             ', which is <b>' + esc(pct) + '%</b> of the way along a ' + esc(String(span)) +
             '&deg; arc. ';
  var aria = 'Gauge: ' + shown + ' on a scale of ' + range + ', ' + pct +
             ' percent of the way along a ' + span + ' degree arc. ';

  if (P.hasTarget) {
    lead += 'the tick across the band is the target, <b>' + esc(gaNum(P.target, 2) + unit) + '</b>. ';
    aria += 'The target is ' + gaNum(P.target, 2) + unit + '. ';
  }
  if (at.over) {
    lead += '<i>the value is past the maximum</i> and is clamped to the end of the arc; the mark ' +
            'outside the track says there is more. it is not wrapped, because a wrapped 137% looks ' +
            'exactly like 37%. ';
    aria += 'The value is past the maximum and is clamped to the end of the arc. ';
  }
  if (at.under) {
    lead += '<i>the value is below the minimum</i> and is clamped to the start of the arc, with a ' +
            'mark outside the track at that end. ';
    aria += 'The value is below the minimum and is clamped to the start of the arc. ';
  }
  if (!P.hasValue) {
    lead += '<i>no value was supplied</i>, so the dial carries its scale and nothing else. ';
  }
  if (P.swapped) {
    lead += 'the minimum and maximum arrived the wrong way round and were swapped. ';
  }
  if (P.zones.length && conf.zones !== false) {
    lead += esc(String(P.zones.length)) + ' qualitative zone' + (P.zones.length === 1 ? '' : 's') +
            ' sit behind the reading, in ordered shades of one hue &mdash; zones are ranked and hue ' +
            'is not, so lightness carries the order. ';
  } else if (P.zones.length) {
    lead += 'the qualitative zones are switched off in this card settings. ';
  }
  if (P.overZones) {
    lead += esc(String(P.overZones)) + ' zone' + (P.overZones === 1 ? '' : 's') +
            ' past the fourth were dropped. ';
  }
  if (P.badValue) { lead += 'the value supplied was not a number. '; }

  return { aria: aria, caption: lead + cost };
}

/**
 * Every mark in the dial, and the size of the box it needs.
 *
 * Runs in Node at build time and in the browser on every settings change, from the same text.
 *
 * @param P    the payload from {@link readData}
 * @param conf the settled settings: `style`, `span`, `zones`
 * @returns `{ W, H, marks, note, span, deg }` — `deg` is the needle or sweep-end angle, kept on
 *          the result so a test can check the angle against the geometry it produced
 * @throws {Error} when any coordinate comes out non-finite
 */
function gaRender(P, conf) {
  var span = gaSpan(conf.span);
  var needle = conf.style === 'needle';
  var showZones = conf.zones !== false;
  var marks = [];
  var i;

  var R = 78;
  var T = 14;
  var OUT = T / 2 + 8;
  var h = span / 2;
  var hr = h * Math.PI / 180;
  var mx = h >= 90 ? 1 : Math.sin(hr);

  var W = Math.max(240, Math.ceil((R * mx + OUT + 2) * 2));
  var cx = W / 2;
  var cy = 4 + R + OUT;
  var yTop = cy - R - OUT;
  var yEnd = cy - R * Math.cos(hr);
  var yBot = yEnd + OUT;
  /* Where the big number goes depends on whether the arc encloses anything. Past about 100
     degrees of half-span the ends have swung below the horizontal and there is a dial interior to
     put the number in; below that the arc is a shallow cap and the interior is where the arc
     itself is, so the number goes underneath it instead. Getting this wrong is not subtle: a
     22px number laid over the track is the whole card unreadable. */
  var yRead = h >= 100 ? cy - R * 0.18 : yEnd + T / 2 + 26;
  var yLab = yEnd + T / 2 + 13;
  var H = Math.ceil(Math.max(yBot + 6, yLab + 8, yRead + 30));

  var at = gaAt(P, span, P.value);
  var note = gaNote(P, conf, span, at);

  /* The track first, and always: a dial with no reading still has to show its own shape, or an
     empty gauge is indistinguishable from a card that failed to build. */
  marks.push(gaArc(cx, cy, R, -h, h, 'ck-ga-track'));

  if (P.hasScale && showZones) {
    var prev = P.min;
    for (i = 0; i < P.zones.length; i++) {
      var to = P.zones[i].to;
      if (to > prev) {
        var a0 = gaAt(P, span, prev);
        var a1 = gaAt(P, span, to);
        if (a1.deg > a0.deg) {
          marks.push(gaArc(cx, cy, R, a0.deg, a1.deg, 'ck-ga-band ck-ga-b' + (i + 1)));
        }
      }
      prev = Math.max(prev, to);
    }
  }

  if (P.hasScale && P.hasValue) {
    if (needle) {
      var tip = gaPt(cx, cy, R + T / 2 - 1, at.deg);
      var tail = gaPt(cx, cy, -10, at.deg);
      marks.push(gaLine(tail[0], tail[1], tip[0], tip[1], 'ck-ga-needle',
                        { 'data-deg': gaFin(at.deg, 'needle') }));
      marks.push(gaDot(cx, cy, 4.5, 'ck-ga-hub'));
    } else if (at.deg > -h) {
      /* A sweep of zero length is skipped rather than drawn. A zero-length stroked arc with a
         round cap renders as a dot floating at the start of the scale, which reads as a value
         somebody put there. */
      marks.push(gaArc(cx, cy, R, -h, at.deg, 'ck-ga-sweep',
                       { 'data-deg': gaFin(at.deg, 'sweep') }));
    }
  }

  if (P.hasScale && P.hasTarget) {
    var td = gaAt(P, span, P.target).deg;
    var t0 = gaPt(cx, cy, R - T / 2 - 2, td);
    var t1 = gaPt(cx, cy, R + T / 2 + 2, td);
    marks.push(gaLine(t0[0], t0[1], t1[0], t1[1], 'ck-ga-target'));
  }

  /* Overflow and underflow are DRAWN, not merely clamped. A value silently stopped at the end of
     the scale is a value the reader will believe; a short arc sitting outside the track past that
     end says the measurement kept going after the picture stopped. */
  if (at.over) { marks.push(gaArc(cx, cy, R + T / 2 + 5, h - 9, h, 'ck-ga-over')); }
  if (at.under) { marks.push(gaArc(cx, cy, R + T / 2 + 5, -h, -h + 9, 'ck-ga-over')); }

  if (P.hasScale) {
    var lo = gaPt(cx, cy, R, -h);
    var hi = gaPt(cx, cy, R, h);
    marks.push(gaText(lo[0] - 3, yLab, gaClip(gaNum(P.min, 2), 70), 'ck-ga-end', 'end'));
    marks.push(gaText(hi[0] + 3, yLab, gaClip(gaNum(P.max, 2), 70), 'ck-ga-end', 'start'));
  }

  var shown = P.hasValue ? gaNum(P.value, 2) : '\u2014';
  marks.push(gaText(cx, yRead, gaClip(shown, W - 16, 22), 'ck-ga-read', 'middle'));
  if (P.unit) {
    marks.push(gaText(cx, yRead + 15, gaClip(P.unit, W - 16, 10), 'ck-ga-unit', 'middle'));
  }

  return { W: W, H: H, marks: marks, note: note, span: span, deg: at.deg, frac: at.frac };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [gaFin, gaTw, gaClip, gaGroup, gaNum, gaSpan, gaPt, gaArc, gaLine, gaDot, gaText,
                 gaAt, gaNote, gaRender];

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
  const body = (m.s != null ? CK.esc(m.s) : '') +
               (m.ti != null ? '<title>' + CK.esc(m.ti) + '</title>' : '');
  return s + '>' + body + '</' + m.t + '>';
}

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-gauge[data-card="' + id + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The card's stylesheet, including the one place a literal colour is allowed.
 *
 * The four zone shades are this card's own tokens on bare `:root`, overridden under
 * `:root[data-theme="light"]`. They are shades of one hue rather than the traffic-light green,
 * amber and red a gauge usually wears, and the reason is the same as `bullet`'s: a zone set is
 * ordered, lightness is an ordered channel and hue is not, and the traffic-light convention is
 * additionally unreadable to a good fraction of readers and to every greyscale screenshot.
 */
function cardCss(id) {
  const tokens =
    ':root {\n' +
    '  --ck-ga-1: oklch(0.46 0.016 250);\n' +
    '  --ck-ga-2: oklch(0.38 0.013 250);\n' +
    '  --ck-ga-3: oklch(0.31 0.011 250);\n' +
    '  --ck-ga-4: oklch(0.25 0.009 250);\n' +
    '}\n' +
    ':root[data-theme="light"] {\n' +
    '  --ck-ga-1: oklch(0.74 0.016 250);\n' +
    '  --ck-ga-2: oklch(0.82 0.013 250);\n' +
    '  --ck-ga-3: oklch(0.88 0.010 250);\n' +
    '  --ck-ga-4: oklch(0.93 0.008 250);\n' +
    '}\n';

  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-ga-plot', 'display: block; width: 100%; max-width: 320px; height: auto; margin: 0 auto;'],
    ['.ck-ga-plot text', 'font-family: var(--mono); font-size: 9px;'],

    /* Butt caps everywhere on the scale. A round cap adds half the stroke width to each end, so
       the track would reach past the span it claims and a sweep would end past its own value —
       a rendering detail that becomes a lie about a number. */
    ['.ck-ga-track', 'fill: none; stroke: var(--well); stroke-width: 14; stroke-linecap: butt;'],
    ['.ck-ga-band', 'fill: none; stroke-width: 14; stroke-linecap: butt;'],
    ['.ck-ga-b1', 'stroke: var(--ck-ga-1);'],
    ['.ck-ga-b2', 'stroke: var(--ck-ga-2);'],
    ['.ck-ga-b3', 'stroke: var(--ck-ga-3);'],
    ['.ck-ga-b4', 'stroke: var(--ck-ga-4);'],

    ['.ck-ga-sweep', 'fill: none; stroke: var(--ink); stroke-width: 14; stroke-linecap: butt;'],
    ['.ck-ga-needle', 'stroke: var(--ink); stroke-width: 2.6; stroke-linecap: round;'],
    ['.ck-ga-hub', 'fill: var(--ink); stroke: var(--ground); stroke-width: 1.5;'],
    ['.ck-ga-target', 'stroke: var(--accent); stroke-width: 2.5; fill: none;'],
    ['.ck-ga-over', 'fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round;'],

    ['.ck-ga-read', 'fill: var(--ink); font-size: 22px; font-family: var(--disp), var(--mono);'],
    ['.ck-ga-unit', 'fill: var(--ink-dim); font-size: 10px;'],
    ['.ck-ga-end', 'fill: var(--ink-faint);'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return tokens + scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the dial, and the caption. */
function cardHtml(id, title, seed, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' +
    CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-ga-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + seed.marks.map(oneMark).join('') + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-gauge">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="gauge settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('style') + '">style</label>\n' +
    '    <select id="' + f('style') + '" name="style">' +
         opt('sweep', 'filled sweep', cfg.style) +
         opt('needle', 'needle', cfg.style) + '</select>\n' +
    '    <label for="' + f('span') + '">arc span, degrees</label>\n' +
    '    <input id="' + f('span') + '" name="span" type="number" min="' + SPAN_MIN + '" max="' +
           SPAN_MAX + '" step="5" value="' + cfg.span + '">\n' +
    '    <label for="' + f('zones') + '">qualitative zones</label>\n' +
    '    <input id="' + f('zones') + '" name="zones" type="checkbox"' +
           (cfg.zones ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">the sweep encodes the value as arc length, which a reader can ' +
         'compare; the needle encodes it as angle alone. the span is clamped to ' + SPAN_MIN +
         '&ndash;' + SPAN_MAX + '&deg;: at 360 an SVG arc has identical endpoints and is omitted ' +
         'from the path, so the dial would silently draw nothing. for a closed ring use the ' +
         'progressring card.</p>\n' +
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
    '/* gauge card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The span clamp lives in the shipped code, so a viewer typing 400 into the panel\n' +
    '   gets 350 rather than an arc with identical endpoints that draws nothing. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-ga-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where dial decisions live. */\n' +
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
    '     a render that added marks would stack a second dial on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = gaRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/gauge');
}

/**
 * Fold a caller's seed onto the defaults, rejecting anything the card cannot honour.
 *
 * @example settle({ span: 400 }).span;   // 350
 */
function settle(seed) {
  const out = { ...defaults };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  out.style = out.style === 'needle' ? 'needle' : 'sweep';
  out.span = gaSpan(out.span);
  out.zones = !!out.zones;
  return out;
}

/**
 * Build one gauge card.
 *
 * Every degenerate case has a decided answer rather than a crash:
 *
 * - **zero** with a minimum of zero draws no sweep at all, rather than a round-capped dot at the
 *   start of the scale that would read as a small value somebody put there
 * - **the maximum exactly** ends the sweep at the far end of the arc, with no overflow mark
 * - **above the maximum** clamps to the end AND draws a short arc outside the track past that
 *   end, so the reader can see the measurement kept going after the picture stopped. It is never
 *   wrapped: a wrapped 137% is pixel-identical to 37%
 * - **below the minimum** and **a negative value** clamp to the start, with the same mark at that
 *   end
 * - **min equal to max** is the zero-range case and every fraction here would divide by zero.
 *   The card draws its track, states the number in the middle, and says in the caption that a
 *   bounded arc with no bounds has nowhere to put anything
 * - **a missing max** is the same state, and deliberately NOT defaulted. `progressring` assumes
 *   100 because a fraction has a conventional denominator; an arbitrary bounded scale does not,
 *   and inventing one would put a needle where nobody asked for it
 * - **a non-numeric value** draws the scale, the zones and no reading, with an em dash in the
 *   middle
 * - **a missing target** draws no tick
 * - **a very long unit** is clipped to the dial width with the cut marked
 * - **a twelve-character unit** fits; the readout is centred and measured rather than fixed
 * - **min greater than max** is swapped, and the caption says it was
 *
 * @param id    unique on the desk; becomes `data-card`, the CSS scope and the settings key
 * @param title the card's heading, rendered as plain text
 * @param data  `{ value, min, max, target, zones, unit, settings }`; everything is untrusted
 * @param ord   the card's position on the desk
 * @returns `{ json, html, css, js }`
 * @throws {Error} from {@link guardEmitted} when the emitted script would break the desk
 *
 * @example
 * const card = build({ id: 'disk', title: 'disk used', ord: 40, data: {
 *   value: 812, max: 1000, target: 900, unit: 'GB', zones: [600, 850] } });
 * card.html.indexOf('data-card="disk"') > 0;   // true
 *
 * @see meta
 * @see ./bullet.mjs — what this card should almost always have been
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'gauge' : id);
  const heading = String(title == null ? cardId : title);
  const d = data && typeof data === 'object' ? data : {};

  const P = readData(data);
  const cfg = settle(d.settings);
  const seed = gaRender(P, cfg);

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
