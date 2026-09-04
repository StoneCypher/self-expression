/**
 * `bullet` — Stephen Few's bullet graph: a measure bar, a target tick, and ordered qualitative
 * bands behind both, stackable as a small multiple that shares one scale.
 *
 * Few designed this in 2006 explicitly as the replacement for the dashboard gauge, and the
 * argument is worth restating because it is the reason this file is built before `gauge.mjs`
 * rather than after it. A gauge spends a large disc on one number and encodes it as an angle,
 * which readers judge less accurately than position along a line. A bullet encodes the same
 * number as position along a line, in one row, and has room left over for two things a gauge
 * has nowhere to put: a target, and the qualitative ranges the number is supposed to be read
 * against. It is not a smaller gauge. It is a gauge that answers two more questions.
 *
 * The bands are shades of ONE hue, and that is a constraint rather than a taste. A range set is
 * ordered — poor, fair, good — and lightness is an ordered channel, so a reader can rank three
 * shades without a legend. Hue is not ordered: nobody can say whether teal is more than violet,
 * so a three-hue band set makes the reader learn a key to read a background. The shades are
 * defined as this card's own tokens on bare `:root` with a light-theme override, which is the
 * one place `CONTRACT.md` sanctions a literal colour.
 *
 * All geometry is computed by {@link blRender}, which is the same function in Node and in the
 * browser: Node runs it once for the drawing that ships inside `card.html`, and the browser
 * re-runs it when the reader changes orientation, size, or whether the bands show. Shipping the
 * function by `Function.prototype.toString()` rather than writing a browser twin is what stops
 * the two from disagreeing about where a bar ends.
 *
 * @see ./gauge.mjs   — the thing this replaces; its own caption says so and names this file
 * @see ./chart.mjs   — the general plotter, and the source of the display-list idiom used here
 * @see ../CONTRACT.md — `shape` is a string, `defaults` is an object, and `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so build-time drawing and browser-time drawing
 * use one implementation rather than two that drift.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level defines only functions and one array, and nothing reaches for
 * `document` until a DOM-bound function is called — none of which this file calls — so a bare
 * context carrying an empty `window` is enough to run it.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().scale([0, 10], [0, 100])(5);   // 50
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/bullet: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/bullet: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all without a
 * temporal-dead-zone error, which is how six earlier types shipped an undefined `meta.defaults`.
 *
 * `horizontal` is the default because the bullet's whole claim is that it reads like a line of
 * text — label, bar, number — and a column of vertical bullets gives that up for nothing.
 * `showRanges` defaults on because a bullet without its ranges is a bar chart of one bar.
 *
 * @example defaults.size;   // 'normal'
 */
export const defaults = {
  orient:     'horizontal',
  showRanges: true,
  size:       'normal',
};

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `ranking-and-comparison` because every question a bullet answers is a comparison: this number
 * against its target, and this number against the bands somebody decided were poor, fair and
 * good. It never answers "what changed" or "how does it divide".
 *
 * @example meta.name;   // 'bullet'
 */
export const meta = {
  name: 'bullet',
  summary:
    'A bullet graph: one measure bar against a target tick and ordered qualitative bands, ' +
    'stackable as a small multiple on a single shared scale.',
  shape:
    "{ label, value, target, ranges: [n], unit, format } — or { bullets: [that], unit, format } " +
    "for a small multiple sharing one scale; ranges are ascending band boundaries, at most three, " +
    "and format is 'auto' | 'plain' | 'percent'",
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
 * scanner desynchronises on the quote inside a `replace` call and starts blanking real code,
 * which turns a false positive into a far worse false negative.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, comment and string contents replaced by spaces
 *
 * @example blankNonCode('var a = "const";').indexOf('const');   // -1
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
    /* A slash is a regex only where a value cannot precede it. Tracking the previous significant
       character is the cheap approximation that gets this right for real code. */
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
 * The backtick is never written in this file; it is reached for as `String.fromCharCode(96)`,
 * which cannot be mistyped and cannot be mis-decoded during emission.
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
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/bullet';
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
 * At most three band boundaries, which is at most three bands plus bare track beyond the last.
 *
 * Few's own limit, and it is a limit about reading rather than about drawing: a reader can rank
 * three shades of one hue at a glance and cannot rank five. A fourth boundary is dropped and the
 * caption says how many were dropped, because silently ignoring input is how a card teaches
 * somebody that their data was accepted when it was not.
 */
const MAX_BANDS = 3;

/** The units a caller may ask a value to be printed in. Anything else falls back to `auto`. */
const FORMATS = ['auto', 'plain', 'percent'];

/** A finite number, or null. Used everywhere a caller's number is read for the first time. */
function num(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * One caller row folded into the shape the renderer may assume, with every number already vetted.
 *
 * A non-numeric `value` is not coerced to zero. Zero is a measurement and a missing reading is
 * not one, and a bullet that draws a missing value as a bar of length nothing has claimed the
 * measure was taken and came back empty. It draws its bands and its target and no bar, and the
 * caption counts it.
 *
 * @param raw    a caller's bullet; every field is untrusted
 * @param unit   the card-level unit, used when this row does not carry its own
 * @param format the card-level format, likewise
 * @returns a vetted row, plus `hasValue` / `hasTarget` so the renderer never tests for null
 *
 * @example readOne({ label: 'p95', value: 240, target: 300, ranges: [200, 400] }, 'ms', 'auto');
 */
function readOne(raw, unit, format) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const value = num(r.value);
  const target = num(r.target);

  /* Sorted, deduped and capped. Unsorted boundaries would paint bands over each other in the
     order they were written, which draws a picture that is wrong rather than one that is ugly. */
  const seen = [];
  const src = Array.isArray(r.ranges) ? r.ranges : [];
  let overRanges = 0;
  for (const v of src) {
    const n = num(v);
    if (n === null) continue;
    if (seen.indexOf(n) < 0) seen.push(n);
  }
  seen.sort((a, b) => a - b);
  if (seen.length > MAX_BANDS) { overRanges = seen.length - MAX_BANDS; seen.length = MAX_BANDS; }

  const ownUnit = r.unit == null ? unit : String(r.unit);
  const ownFmt = FORMATS.indexOf(String(r.format)) >= 0 ? String(r.format) : format;

  return {
    label:     r.label == null ? '' : String(r.label),
    value:     value === null ? 0 : value,
    hasValue:  value !== null,
    target:    target === null ? 0 : target,
    hasTarget: target !== null,
    ranges:    seen,
    overRanges,
    /* Capped rather than refused: a unit is a caption, not an identifier, and a caller who typed
       twelve characters of unit gets twelve characters. Past thirty it is prose in the wrong
       field and it would eat the whole readout column. */
    unit:      String(ownUnit == null ? '' : ownUnit).trim().slice(0, 30),
    format:    ownFmt,
    badValue:  value === null && r.value != null,
  };
}

/**
 * Normalise whatever arrived into the payload the renderer takes, including the shared scale.
 *
 * The domain is the single most important decision this file makes, because the whole point of a
 * small multiple is that every bar is measured against the same ruler. It always contains zero:
 * a bar is read from a baseline, and a baseline that floats at the data minimum turns a 2%
 * difference into a bar twice as long as its neighbour. It contains every value, every target and
 * every band boundary, so nothing a caller supplied can fall off the end of the drawing.
 *
 * The zero-range case — no finite numbers anywhere, or every one of them exactly zero — collapses
 * `lo` and `hi` onto each other and would divide by zero in any scale. It is widened to `[0, 1]`
 * rather than handed to `CK.scale`'s midpoint rule, because a bullet's zero must stay at the left
 * edge: parking a zero measure in the middle of its track would draw a half-full bar for a value
 * of nothing, which is the worst available lie.
 *
 * @param data the card's `data` block, possibly absent, an array, or one bullet
 * @returns `{ bullets, lo, hi, count, dropped, overRanges }`
 *
 * @example readData({ bullets: [{ label: 'a', value: 3 }] }).hi;   // 3
 * @example readData(undefined).count;                              // 0
 */
function readData(data) {
  const isArr = Array.isArray(data);
  const d = !isArr && data && typeof data === 'object' ? data : {};
  const unit = d.unit == null ? '' : String(d.unit);
  const format = FORMATS.indexOf(String(d.format)) >= 0 ? String(d.format) : 'auto';

  const src = isArr ? data : Array.isArray(d.bullets) ? d.bullets : [d];
  const rows = src.map((r) => readOne(r, unit, format));

  /* A row nobody supplied anything for is not a bullet. Without this the probe build — which
     `check.mjs` runs with `data: undefined` — would draw one empty bar and call it a card. */
  const bullets = rows.filter((r) => r.hasValue || r.hasTarget || r.ranges.length || r.label);

  let lo = 0;
  let hi = 0;
  for (const b of bullets) {
    if (b.hasValue) { lo = Math.min(lo, b.value); hi = Math.max(hi, b.value); }
    if (b.hasTarget) { lo = Math.min(lo, b.target); hi = Math.max(hi, b.target); }
    for (const r of b.ranges) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
  }
  if (!(hi > lo)) { lo = Math.min(0, lo); hi = lo === 0 ? 1 : 0; }

  return {
    bullets,
    lo,
    hi,
    count: bullets.length,
    dropped: rows.reduce((a, r) => a + (r.badValue ? 1 : 0), 0),
    overRanges: rows.reduce((a, r) => a + r.overRanges, 0),
  };
}

/* ── the shipped half: everything below runs in Node and in the browser, unchanged ───── */

/* These are ES5-shaped on purpose — var, function, no arrows, no template literals, no backticks
   even in their comments. They are emitted through Function.prototype.toString() into a page that
   ships no transpiler and concatenates every card's script into one inline block, so a modern
   token here takes the whole desk down rather than this one card. */

/** Two decimals, refusing a coordinate that is not a number so a silent empty draw cannot ship. */
function blFin(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/bullet: non-finite coordinate from ' + what + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Two decimals, for a value already known to be finite. */
function blN2(v) { return Math.round(v * 100) / 100; }

/* Advance width of the 9px monospace kit.css sets on plot text. Measured rather than guessed, and
   deliberately a hair pessimistic: being half a pixel wide clips a label that would just have fit,
   which is the safe way to be wrong. */
function blTw(s) { return String(s).length * 5.42; }

/** Shorten a label to a pixel budget, keeping the head and marking the cut. */
function blClip(s, max) {
  var str = String(s);
  var room = Math.floor(max / 5.42);
  if (str.length <= room) { return str; }
  if (room < 2) { return '\u2026'; }
  return str.slice(0, room - 1) + '\u2026';
}

/** Thousands separators, inserted into a run of digits from the right. */
function blGroup(digits) {
  var out = '';
  var i;
  for (i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) { out += ','; }
    out += digits.charAt(i);
  }
  return out;
}

/** A number at up to `dp` decimals, trailing zeros trimmed, thousands grouped. */
function blNum(v, dp) {
  var neg = v < 0;
  var s = Math.abs(v).toFixed(dp);
  var dot = s.indexOf('.');
  var whole = dot < 0 ? s : s.slice(0, dot);
  var frac = dot < 0 ? '' : s.slice(dot + 1);
  while (frac.length && frac.charAt(frac.length - 1) === '0') { frac = frac.slice(0, frac.length - 1); }
  return (neg ? '-' : '') + blGroup(whole) + (frac.length ? '.' + frac : '');
}

/**
 * A value as the reader should see it, in the format the caller asked for.
 *
 * An absent value is an em dash and never a zero. The three formats are the three honest answers:
 * auto hands the number to CK.fmt and gets 1.2k for a quantity nobody counts exactly, plain keeps
 * every digit for a quantity somebody does, and percent states the unit in the glyph.
 */
function blFmtVal(v, has, unit, format) {
  if (!has) { return '\u2014'; }
  var s;
  if (format === 'percent') { s = blNum(v, 1) + '%'; }
  else if (format === 'plain') { s = blNum(v, 2); }
  else { s = CK.fmt(v); }
  return unit ? s + ' ' + unit : s;
}

/** One rect mark. Attribute names are the real SVG ones, so the browser half stays a translator. */
function blRect(x, y, w, h, cls, extra) {
  var a = { x: blFin(x, 'rect'), y: blFin(y, 'rect'),
            width: blFin(Math.max(0, w), 'rect'), height: blFin(Math.max(0, h), 'rect'),
            'class': cls };
  var k;
  if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { a[k] = extra[k]; } } }
  return { t: 'rect', a: a };
}

/** One line mark. */
function blLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: blFin(x1, 'line'), y1: blFin(y1, 'line'),
                           x2: blFin(x2, 'line'), y2: blFin(y2, 'line'), 'class': cls } };
}

/** One text mark. The body is set with textContent in the browser, never with markup. */
function blText(x, y, s, cls, anchor) {
  var a = { x: blFin(x, 'text'), y: blFin(y, 'text'), 'class': cls };
  if (anchor) { a['text-anchor'] = anchor; }
  return { t: 'text', a: a, s: String(s) };
}

/**
 * A bar spanning two positions on the value axis, on whichever screen axis that currently is.
 *
 * This is the one idea that keeps the file from having two of every drawing routine. A bullet has
 * a value axis and a cross axis; horizontal hangs the value axis on x and vertical hangs it on y,
 * and everything else about the drawing is identical.
 */
function blSpan(horiz, a, b, c, thick, cls, extra) {
  var lo = Math.min(a, b);
  var hi = Math.max(a, b);
  if (horiz) { return blRect(lo, c, hi - lo, thick, cls, extra); }
  return blRect(c, lo, thick, hi - lo, cls, extra);
}

/** A tick perpendicular to the value axis, at value-axis position `v`, spanning `c0` to `c1`. */
function blTick(horiz, v, c0, c1, cls) {
  if (horiz) { return blLine(v, c0, v, c1, cls); }
  return blLine(c0, v, c1, v, cls);
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * role="img" hides the SVG internals, so the aria label is the entire drawing to anyone using it.
 * "Bullet graph" is therefore not an acceptable answer: it names the genre and withholds the
 * content. This says what the measure is, what it is aimed at, and how far off it is.
 *
 * The caption states the two things about the drawing that a reader cannot recover from the
 * drawing: that the bands are shades of one hue because a range set is ordered and hue is not,
 * and that every bullet in a multiple is on one scale, which is the only reason the bars may be
 * compared to each other at all.
 */
function blNote(P, conf) {
  var esc = CK.esc;
  var i, b;

  if (!P.count) {
    return {
      aria: 'Bullet graph with no measure supplied; nothing is drawn.',
      caption: 'a bullet graph with <b>no measure</b> &mdash; the card keeps its place, but there ' +
               'is nothing in it. give it a value, and a target and ranges to read the value against.'
    };
  }

  var many = P.count > 1;
  var noVal = 0;
  var noTgt = 0;
  var pastBand = 0;
  var bandMax = 0;
  for (i = 0; i < P.bullets.length; i++) {
    b = P.bullets[i];
    if (!b.hasValue) { noVal++; }
    if (!b.hasTarget) { noTgt++; }
    if (b.ranges.length > bandMax) { bandMax = b.ranges.length; }
    if (b.hasValue && b.ranges.length && b.value > b.ranges[b.ranges.length - 1]) { pastBand++; }
  }

  var first = P.bullets[0];
  var lead;
  var ariaLead;
  if (many) {
    lead = '<b>' + esc(String(P.count)) + '</b> bullets on one scale, ' +
           esc(CK.fmt(P.lo)) + ' to ' + esc(CK.fmt(P.hi)) + '. ';
    ariaLead = P.count + ' bullet graphs sharing one scale from ' + CK.fmt(P.lo) +
               ' to ' + CK.fmt(P.hi) + '. ';
  } else {
    var shown = blFmtVal(first.value, first.hasValue, first.unit, first.format);
    var tgt = blFmtVal(first.target, first.hasTarget, first.unit, first.format);
    lead = (first.label ? '<i>' + esc(first.label) + '</i> at ' : '') + '<b>' + esc(shown) + '</b>' +
           (first.hasTarget ? ' against a target of <b>' + esc(tgt) + '</b>' : ', with no target') + '. ';
    ariaLead = (first.label ? first.label + ': ' : '') + shown +
               (first.hasTarget ? ', against a target of ' + tgt : ', with no target') + '. ';
    if (first.hasValue && first.hasTarget && first.target !== 0) {
      var pct = blNum(first.value / Math.abs(first.target) * 100, 0);
      lead += 'that is <b>' + esc(pct) + '%</b> of target. ';
      ariaLead += 'That is ' + pct + ' percent of target. ';
    }
  }

  var band = bandMax
    ? '<i>' + esc(String(bandMax)) + '</i> qualitative band' + (bandMax === 1 ? '' : 's') +
      ' behind the bar, in ordered shades of one hue &mdash; a range set is ordered and hue is not, ' +
      'so lightness carries the ranking and no key is needed to read it. '
    : '<i>no qualitative ranges</i> were given, so the bar has nothing behind it to be judged ' +
      'against and the card is a bar chart of one bar. ';

  var extra = '';
  if (many) { extra += 'the scale is shared, which is the only reason the bars may be compared to each other. '; }
  if (noVal) { extra += '<i>' + esc(String(noVal)) + '</i> ha' + (noVal === 1 ? 's' : 've') +
                        ' no value and draw' + (noVal === 1 ? 's' : '') + ' bands only &mdash; a missing reading is not a zero. '; }
  if (noTgt && many) { extra += esc(String(noTgt)) + ' carr' + (noTgt === 1 ? 'ies' : 'y') + ' no target tick. '; }
  if (pastBand) { extra += '<i>' + esc(String(pastBand)) + '</i> run' + (pastBand === 1 ? 's' : '') +
                           ' past the last band, on bare track. '; }
  if (P.dropped) { extra += esc(String(P.dropped)) + ' value' + (P.dropped === 1 ? ' was' : 's were') +
                            ' not a number and was dropped. '; }
  if (P.overRanges) { extra += esc(String(P.overRanges)) + ' band boundar' + (P.overRanges === 1 ? 'y' : 'ies') +
                               ' past the third were dropped; three shades is the most a reader can rank unaided. '; }
  if (conf.showRanges === false && bandMax) { extra += '<span class="ck-aside">bands are switched off in this card settings.</span> '; }

  return {
    aria: (ariaLead + (bandMax ? bandMax + ' qualitative bands are drawn behind the bar.' : '')).replace('  ', ' '),
    caption: (lead + band + extra).replace('  ', ' ')
  };
}

/**
 * Every mark in the drawing, and the size of the box it needs.
 *
 * Runs in Node at build time and in the browser on every settings change, from the same text.
 *
 * @param P    the payload from {@link readData}
 * @param conf the settled settings: `orient`, `showRanges`, `size`
 * @returns `{ W, H, marks, note }`
 * @throws {Error} when any coordinate comes out non-finite, which means a bug here rather than
 *                 bad input: every number was vetted while reading
 */
function blRender(P, conf) {
  var horiz = conf.orient !== 'vertical';
  var compact = conf.size === 'compact';
  var showBands = conf.showRanges !== false;
  var list = P.bullets;
  var marks = [];
  var note = blNote(P, conf);
  var i, j, b;

  var W0 = 640;
  if (!list.length) {
    marks.push(blText(W0 / 2, 40, 'no measure supplied', 'ck-bl-void', 'middle'));
    return { W: W0, H: 72, marks: marks, note: note };
  }

  /* Label and readout widths are measured from the text that actually has to fit rather than
     fixed, because a five-character label and a thirty-character one want different rooms and a
     constant is wrong for one of them. Both are capped: past the cap the text is clipped with the
     cut marked, which is more useful than a track two inches wide. */
  var labels = [];
  var reads = [];
  var labW = 0;
  var readW = 0;
  for (i = 0; i < list.length; i++) {
    b = list[i];
    labels.push(b.label);
    reads.push(blFmtVal(b.value, b.hasValue, b.unit, b.format));
    if (b.label) { labW = Math.max(labW, blTw(b.label)); }
    readW = Math.max(readW, blTw(reads[i]));
  }
  labW = Math.min(compact ? 110 : 150, labW);
  readW = Math.min(compact ? 92 : 124, readW);

  var ticks = CK.ticks(P.lo, P.hi, 5);
  var tickW = 0;
  for (i = 0; i < ticks.length; i++) { tickW = Math.max(tickW, blTw(CK.fmt(ticks[i]))); }

  var trackThick = compact ? 11 : 17;
  var barThick = compact ? 5 : 7;
  var W, H, vs, axisAt, cross0, step;

  if (horiz) {
    step = compact ? 20 : 30;
    var x0 = labW ? Math.round(labW) + 10 : 3;
    var x1 = W0 - (readW ? Math.round(readW) + 8 : 4);
    if (x1 - x0 < 80) { x0 = 3; x1 = W0 - 4; }
    W = W0;
    H = 6 + list.length * step + 22;
    vs = CK.scale([P.lo, P.hi], [x0, x1]);
    axisAt = 6 + list.length * step + 0.5;
    cross0 = 6;

    /* Two rules and no box: the axis under the stack, and nothing else. A full frame reads as a
       container, and a bullet is supposed to read as a line of text with a bar in it. */
    marks.push(blLine(x0, axisAt, x1, axisAt, 'ck-bl-axis'));
    for (i = 0; i < ticks.length; i++) {
      var tp = vs(ticks[i]);
      if (tp < x0 - 0.5 || tp > x1 + 0.5) { continue; }
      marks.push(blLine(tp, axisAt, tp, axisAt + 3, 'ck-bl-tick'));
      marks.push(blText(tp, axisAt + 13, CK.fmt(ticks[i]), 'ck-bl-tk', 'middle'));
    }
  } else {
    var colW = Math.min(170, Math.max(50, Math.round(Math.max(labW, readW)) + 12));
    var axisW = Math.min(78, Math.round(tickW) + 14);
    W = Math.max(300, axisW + list.length * colW + 12);
    H = compact ? 174 : 232;
    var y1 = 18;
    var y0 = H - 24;
    vs = CK.scale([P.lo, P.hi], [y0, y1]);
    axisAt = axisW - 4;
    cross0 = axisW;
    step = colW;

    marks.push(blLine(axisAt, y1, axisAt, y0, 'ck-bl-axis'));
    for (i = 0; i < ticks.length; i++) {
      var tq = vs(ticks[i]);
      if (tq > y0 + 0.5 || tq < y1 - 0.5) { continue; }
      marks.push(blLine(axisAt - 3, tq, axisAt, tq, 'ck-bl-tick'));
      marks.push(blText(axisAt - 6, tq + 3.2, CK.fmt(ticks[i]), 'ck-bl-tk', 'end'));
    }
  }

  /* Zero is always inside the domain by construction, so the baseline never needs clamping and a
     bar can never start off the drawing. */
  var base = vs(0);

  for (i = 0; i < list.length; i++) {
    b = list[i];
    var slot = cross0 + i * step;
    /* The cross-axis arithmetic is the same in both orientations, which is the whole reason the
       marks are built through blSpan: a bullet centred in its row and a bullet centred in its
       column are one calculation, not two that have to be kept in step. */
    var trackAt = slot + (step - trackThick) / 2;
    var barAt = trackAt + (trackThick - barThick) / 2;
    var mid = trackAt + trackThick / 2;

    marks.push(blSpan(horiz, vs(P.lo), vs(P.hi), trackAt, trackThick, 'ck-bl-track'));

    if (showBands) {
      var prev = P.lo;
      for (j = 0; j < b.ranges.length; j++) {
        var to = b.ranges[j];
        if (to > prev) {
          marks.push(blSpan(horiz, vs(prev), vs(to), trackAt, trackThick,
                            'ck-bl-band ck-bl-b' + (j + 1)));
        }
        prev = Math.max(prev, to);
      }
    }

    if (b.hasValue) {
      var a = blN2(base);
      var c = blN2(vs(b.value));
      var s = Math.min(a, c);
      var e = Math.max(a, c);
      /* A measure of exactly zero is drawn one pixel thick rather than skipped. Zero is a
         measurement and should be visible as one, and a card that draws nothing for zero looks
         identical to a card whose value never arrived. The stub grows in the direction the bar
         would have grown, so it never lands on the wrong side of the baseline. */
      if (e - s < 1) {
        if (horiz === (b.value >= 0)) { e = s + 1; } else { s = e - 1; }
      }
      var bar = horiz
        ? blRect(s, barAt, e - s, barThick, 'ck-bl-bar')
        : blRect(barAt, s, barThick, e - s, 'ck-bl-bar');
      bar.ti = (b.label ? b.label + ' \u00b7 ' : '') + reads[i] +
               (b.hasTarget ? ' \u00b7 target ' + blFmtVal(b.target, true, b.unit, b.format) : '');
      marks.push(bar);
    }

    if (b.hasTarget) {
      marks.push(blTick(horiz, vs(b.target), trackAt - 3, trackAt + trackThick + 3, 'ck-bl-target'));
    }

    if (horiz) {
      if (labW && b.label) {
        marks.push(blText(Math.round(labW), mid + 3.2, blClip(b.label, labW), 'ck-bl-lab', 'end'));
      }
      if (readW) {
        marks.push(blText(W0 - 4, mid + 3.2, blClip(reads[i], readW), 'ck-bl-val', 'end'));
      }
    } else {
      marks.push(blText(slot + step / 2, 12, blClip(reads[i], step - 4), 'ck-bl-val', 'middle'));
      if (b.label) {
        marks.push(blText(slot + step / 2, H - 8, blClip(b.label, step - 4), 'ck-bl-lab', 'middle'));
      }
    }
  }

  return { W: W, H: H, marks: marks, note: note };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [blFin, blN2, blTw, blClip, blGroup, blNum, blFmtVal, blRect, blLine, blText,
                 blSpan, blTick, blNote, blRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so a label containing a closing script tag cannot end the block
 * early, with the useful side effect that no label can put an arrow into a file that is
 * contractually free of them. The two line separators go too: they are newlines to a JS parser
 * and not to `JSON.stringify`.
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
  const own = '.ck-bullet[data-card="' + id + '"]';
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
 * The four band shades are this card's own tokens, defined on bare `:root` and overridden under
 * `:root[data-theme="light"]`, which is exactly the escape hatch `CONTRACT.md` describes. They
 * cannot come from `--ck-s1..s8`, because those are eight separated HUES chosen so that no series
 * reads as louder than another — the opposite of what a band ramp needs. One hue at four
 * lightnesses, monotonic in both themes, so the ordering survives the light switch.
 *
 * The ramp runs strong-to-faint from the bottom of the scale upward in both themes. That direction
 * is a choice and worth stating: the lowest band is where a reader looks to find out whether a
 * measure is in trouble, so it is the band that gets the contrast.
 */
function cardCss(id) {
  const tokens =
    ':root {\n' +
    '  --ck-bl-1: oklch(0.46 0.016 250);\n' +
    '  --ck-bl-2: oklch(0.38 0.013 250);\n' +
    '  --ck-bl-3: oklch(0.31 0.011 250);\n' +
    '  --ck-bl-4: oklch(0.25 0.009 250);\n' +
    '}\n' +
    ':root[data-theme="light"] {\n' +
    '  --ck-bl-1: oklch(0.74 0.016 250);\n' +
    '  --ck-bl-2: oklch(0.82 0.013 250);\n' +
    '  --ck-bl-3: oklch(0.88 0.010 250);\n' +
    '  --ck-bl-4: oklch(0.93 0.008 250);\n' +
    '}\n';

  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-bl-plot', 'display: block; width: 100%; height: auto;'],
    ['.ck-bl-plot text', 'font-family: var(--mono); font-size: 9px;'],

    ['.ck-bl-track', 'fill: var(--well); stroke: none;'],
    ['.ck-bl-band', 'stroke: none;'],
    ['.ck-bl-b1', 'fill: var(--ck-bl-1);'],
    ['.ck-bl-b2', 'fill: var(--ck-bl-2);'],
    ['.ck-bl-b3', 'fill: var(--ck-bl-3);'],
    ['.ck-bl-b4', 'fill: var(--ck-bl-4);'],

    /* The measure is the darkest thing on the card in dark theme and the darkest in light theme
       too, because it is `--ink`: the bar is the reading, and everything else is context for it. */
    ['.ck-bl-bar', 'fill: var(--ink); stroke: none;'],
    /* The target is a different token from the bar rather than a different lightness of it. It is
       not a quantity on the same ramp; it is a claim about where the quantity ought to be. */
    ['.ck-bl-target', 'stroke: var(--accent); stroke-width: 2.5; fill: none;'],

    ['.ck-bl-lab', 'fill: var(--ink-dim);'],
    ['.ck-bl-val', 'fill: var(--ink); font-size: 10px;'],
    ['.ck-bl-tk', 'fill: var(--ink-faint);'],
    ['.ck-bl-axis', 'stroke: var(--rule); stroke-width: 1; fill: none;'],
    ['.ck-bl-tick', 'stroke: var(--ck-grid); stroke-width: 1; fill: none;'],
    ['.ck-bl-void', 'fill: var(--ink-faint); font-size: 11px;'],

    /* kit.css stretches every settings field to its cell; a stretched checkbox is a wide hit area
       with a glyph adrift inside it, so the checkbox opts out. */
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return tokens + scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the drawing, and the caption. */
function cardHtml(id, title, seed, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' +
    CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-bl-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + seed.marks.map(oneMark).join('') + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-bullet">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="bullet settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('orient') + '">orientation</label>\n' +
    '    <select id="' + f('orient') + '" name="orient">' +
         opt('horizontal', 'horizontal', cfg.orient) +
         opt('vertical', 'vertical', cfg.orient) + '</select>\n' +
    '    <label for="' + f('showRanges') + '">qualitative bands</label>\n' +
    '    <input id="' + f('showRanges') + '" name="showRanges" type="checkbox"' +
           (cfg.showRanges ? ' checked' : '') + '>\n' +
    '    <label for="' + f('size') + '">size</label>\n' +
    '    <select id="' + f('size') + '" name="size">' +
         opt('normal', 'normal', cfg.size) +
         opt('compact', 'compact', cfg.size) + '</select>\n' +
    '    <p class="ck-set-foot">switching the bands off leaves the bar with nothing to be judged ' +
         'against, which is a bar chart of one bar. horizontal is the orientation the form was ' +
         'designed for: it reads as a line of text with a bar in it.</p>\n' +
    '  </div>\n' +
    '  ' + plot + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned — so a backtick that got into a shipped function comment cannot reach the
 * page, where it would close the desk's one inline script block early and blank every card on it.
 *
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* bullet card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. Nothing is recomputed differently here, so the drawing cannot drift from what\n' +
    '   the caption claims about it. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-bl-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where bullet decisions live. */\n' +
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
    '     a render that added marks would stack a second set of bars on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = blRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/bullet');
}

/**
 * Fold a caller's seed onto the defaults, rejecting anything the card cannot honour.
 *
 * Coercive rather than strict: a card descriptor may be hand-edited, and a typo in `size` should
 * give a working bullet at the normal size rather than an empty box.
 *
 * @example settle({ size: 'huge' }).size;   // 'normal'
 */
function settle(seed) {
  const out = { ...defaults };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  out.orient = out.orient === 'vertical' ? 'vertical' : 'horizontal';
  out.size = out.size === 'compact' ? 'compact' : 'normal';
  out.showRanges = !!out.showRanges;
  return out;
}

/**
 * Build one bullet card.
 *
 * Every degenerate case has a decided answer rather than a crash, and each one is drawn rather
 * than suppressed:
 *
 * - **zero** draws a one-pixel stub at the baseline, so it cannot be mistaken for a missing value
 * - **the maximum exactly** ends the bar on the last tick, at the end of the track
 * - **above the maximum** widens the shared domain to contain it; the bar runs past the last band
 *   onto bare track, and the caption counts how many did
 * - **below the minimum** and **a negative value** grow the bar leftward from the zero baseline,
 *   which is always inside the domain because the domain is built to contain zero
 * - **min equal to max** — no finite numbers at all, or every one of them exactly zero — widens
 *   the domain to `[0, 1]` rather than dividing by zero. `CK.scale`'s midpoint rule is refused
 *   here on purpose: it would park a zero measure in the middle of its track
 * - **a non-numeric value** draws bands and target and no bar, and is counted in the caption
 * - **a missing target** draws no tick and the caption says there is none
 * - **a missing max** is not a case here: a bullet has no declared maximum, only the scale its
 *   own numbers imply
 * - **a very long label** is clipped to the label column with the cut marked, and the full text
 *   survives in the bar tooltip
 * - **a twelve-character unit** widens the readout column, which is measured rather than fixed
 *
 * @param id    unique on the desk; becomes `data-card`, the CSS scope and the settings key
 * @param title the card's heading, rendered as plain text
 * @param data  one bullet, an array of them, or `{ bullets, unit, format, settings }`; every
 *              value in it is untrusted and escaped
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }`
 * @throws {Error} from {@link guardEmitted} when the emitted script would break the desk
 *
 * @example
 * const card = build({ id: 'latency', title: 'p95 latency', ord: 20, data: {
 *   unit: 'ms', bullets: [
 *     { label: 'api',  value: 240, target: 300, ranges: [200, 400, 800] },
 *     { label: 'edge', value: 410, target: 300, ranges: [200, 400, 800] },
 *   ] } });
 * card.html.indexOf('data-card="latency"') > 0;   // true
 *
 * @see meta
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'bullet' : id);
  const heading = String(title == null ? cardId : title);
  const d = !Array.isArray(data) && data && typeof data === 'object' ? data : {};

  const P = readData(data);
  const cfg = settle(d.settings);
  const seed = blRender(P, cfg);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      category: meta.category,
      bullets: P.count,
      settings: cfg,
    },
    html: cardHtml(cardId, heading, seed, cfg),
    css: cardCss(cardId),
    js: cardJs(cardId, P, cfg),
  };
}

export default { meta, defaults, build };
