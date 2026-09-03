/**
 * `connectedscatter` -- a scatter whose points are joined in time order, so the PATH is the story.
 *
 * A scatter of x against y answers "how do these two move together". Joining the points in the
 * order they were measured answers a strictly larger question: how did the pair get from where it
 * started to where it ended, and did it ever come back. That is the shape a plain scatter cannot
 * show and a pair of time series can only show by asking the reader to hold two lines in their
 * head at once. A loop in the path is a hysteresis; a switchback is a reversal; a long straight
 * run is a period when the two moved in lockstep.
 *
 * The whole form fails on one detail, though, and it is the detail most implementations skip:
 * **a path with no readable direction is worse than no path**, because a reader will assume a
 * direction anyway -- usually left to right -- and half the time they will assume the wrong one
 * and read the story backwards. So direction is never implicit here. It is carried by arrowheads
 * along the path, or by a light-to-dark progression from the first measurement to the last, or by
 * both; the setting says which, and the caption says which channel is carrying it under the
 * setting in force. The first and last points are labelled whatever else is switched off, because
 * those are the two the whole reading is anchored on.
 *
 * A note about the smoothing setting, which is off by default and deliberately so. A curve through
 * the measurements asserts positions between them that were never measured. On a slow, densely
 * sampled path that assertion is harmless and the curve is easier to follow; on a sparse one it
 * invents an entire trajectory. Straight segments claim only what is there.
 *
 * @see ./chart.mjs -- the same two columns as two lines against time, when the order is the axis
 * @see ./bubble.mjs -- the same scatter with a third variable as area rather than as sequence
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. A bare context carrying a `window` object is enough to run it.
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
  catch (e) {
    throw new Error('cardkit/connectedscatter: cannot read ' + where.pathname + ' -- ' + e.message);
  }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) {
    throw new Error('cardkit/connectedscatter: kit.js no longer defines window.CK');
  }
  return sandbox.window.CK;
}

const CK = loadKit();

/* -- constants ------------------------------------------------------------------------- */

/** The drawing box. The SVG scales to the column; these are its internal units. */
const W0 = 620;
const H0 = 330;

/** Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/** The three things `direction` may say, and the three things `labels` may say. */
const DIR_MODES = ['arrows', 'ramp', 'both'];
const LABEL_MODES = ['ends', 'all', 'none'];

/**
 * The faintest and strongest a path segment may be drawn under the light-to-dark ramp.
 *
 * The floor is not zero. A first segment at zero opacity is a first segment that is not drawn, and
 * the beginning of the path is exactly the part a reader needs to find in order to know which way
 * to read the rest.
 */
const RAMP_LO = 0.22;
const RAMP_HI = 1;

/**
 * The most separately-shaded chunks the ramp is drawn in.
 *
 * A ramp needs one element per shade, and a path of ten thousand measurements would be ten
 * thousand elements for a gradient nobody can see the steps of anyway. Past the cap the segments
 * are grouped into this many contiguous chunks, each one path at one opacity -- the ramp is
 * unchanged to look at and the DOM stops growing with the data.
 */
const RAMP_CAP = 600;

/** The most arrowheads drawn along the path. Past this they are texture rather than direction. */
const ARROW_CAP = 40;

/** Past this many points the dots thin out; the path itself is one element and always complete. */
const DOT_CAP = 500;

/** Past this many marks a per-point tooltip stops being worth its own DOM node. */
const TIP_CAP = 1200;

/* -- small shared arithmetic ------------------------------------------------------------ */

/**
 * Round to two decimals, refusing to emit a number that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console.
 *
 * @throws {Error} when `v` is NaN or infinite
 * @example n(1.005, 'x');   // 1
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/connectedscatter: non-finite value from ' + (what || 'geometry') +
                    ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to one decimal -- the resolution positions travel at, finer than any pixel. */
function n1(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/connectedscatter: non-finite value from ' + (what || 'geometry') +
                    ' (' + v + ')');
  }
  return Math.round(v * 10) / 10;
}

/** Two decimals, for path data built in the browser as well as in Node. One rounding, one place. */
function r2(v) { return Math.round(v * 100) / 100; }

/** Width in px of a string set in the card's 9px mono face. */
function textW(s) { return String(s).length * CHW; }

/** Shorten a label to `max` px, keeping the head and marking the cut. */
function clip(s, max) {
  const str = String(s);
  const room = Math.floor(max / CHW);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * A number, or null when the value is not one.
 *
 * Booleans and blank strings are refused rather than coerced: `Number(true)` is 1 and
 * `Number('')` is 0, and both are a measurement invented out of a value that was not one.
 *
 * @example numOf('3.5');   // 3.5
 * @example numOf(true);    // null
 */
function numOf(v) {
  if (v == null || typeof v === 'boolean') return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * A sort key from a `t`, accepting a number, a Date, or a date string.
 *
 * Returns null when the value cannot be ordered, which is what makes the whole-or-nothing rule
 * below possible: a path ordered by t for some points and by array position for the rest is a path
 * whose shape is an artefact of the mixture, and there is no way for a reader to know.
 *
 * @example timeOf('2024-03-01') > timeOf('2024-02-01');   // true
 * @example timeOf('later');                               // null
 */
function timeOf(v) {
  if (v == null || typeof v === 'boolean') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const asNum = Number(s);
  if (Number.isFinite(asNum)) return asNum;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a label containing a closing script tag cannot end the block
 * early, and so no label can put an arrow-function token into a file that is contractually free
 * of them. The question mark goes too, so a label with one before a dot cannot look like optional
 * chaining to a guard that scans raw text.
 *
 * @example jsonLit({ label: 'a>b' });   // '{"label":"a\\u003eb"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(/[`]/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The card's id as it may appear inside a double-quoted CSS attribute selector. */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-connectedscatter[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/* -- the build-time guard --------------------------------------------------------------- */

/**
 * Blank comment and string bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose -- one card was
 * refused because a comment said "the class is what CSS reads". Offsets are preserved so a
 * reported position still means something, and regex literals are recognised, because otherwise
 * the scanner desyncs on a quote inside one and blanks real code, turning a false positive into
 * the far worse false negative.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment and string contents replaced by spaces
 *
 * @example blankLiterals('var s = "class";').indexOf('class');   // -1
 */
function blankLiterals(src) {
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

/** Where an offset falls, said the way a stack trace would say it. */
function atOffset(src, off) {
  return 'line ' + (src.slice(0, off).split('\n').length) + ', offset ' + off;
}

/**
 * Refuse to emit a script that would take the whole desk down.
 *
 * Every card's script is concatenated into ONE inline block, so a single modern-syntax token in
 * one card is a parse error that blanks every card on the page. The hazard that actually bites is
 * a backtick inside a doc comment: the browser halves of these types ship through
 * `Function.prototype.toString()`, which carries their comments along. The character is never
 * written in this file; it is reached for as `String.fromCharCode(96)`.
 *
 * Two scans, deliberately different. Backtick, arrow and optional chain are hunted in the RAW
 * text, where none can appear innocently. `const`, `let` and `class` are hunted only OUTSIDE
 * comments and strings, because all three are ordinary English and a guard that fires on prose is
 * a guard somebody deletes.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming every token it found and where each one is
 *
 * @example guardEmitted('var a = 1;', 'demo');   // 'var a = 1;'
 * @example guardEmitted('let a = 1;', 'demo');   // throws: the keyword let at line 1
 */
export function guardEmitted(js, where) {
  const bad = [];
  const tick = String.fromCharCode(96);

  for (const [needle, what] of [[tick, 'a backtick'], ['=>', 'an arrow function'],
                                ['?.', 'optional chaining']]) {
    const at = js.indexOf(needle);
    if (at >= 0) bad.push(what + ' at ' + atOffset(js, at));
  }

  const code = blankLiterals(js);
  for (const word of ['const', 'let', 'class']) {
    const hit = new RegExp('(^|[^\\w$.])' + word + '[\\s({]').exec(code);
    if (hit) bad.push('the keyword ' + word + ' at ' + atOffset(js, hit.index));
  }

  /* Compared numerically rather than matched against a character class, because writing the
     class is how the class gets corrupted. Tab, newline and carriage return are text and stay. */
  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) {
    throw new Error('cardkit/connectedscatter: refusing to emit ' + where + ' -- ' + bad.join('; '));
  }
  return js;
}

/**
 * Walk a display list and refuse any coordinate that is not a finite number.
 *
 * @throws {Error} on the first non-finite number, naming the attribute it was on
 * @example assertFinite([{ t: 'rect', a: { width: 4 } }], 'default');   // undefined
 */
function assertFinite(marks, where) {
  for (const m of marks) {
    if (m.a) {
      for (const k of Object.keys(m.a)) {
        const v = m.a[k];
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error('cardkit/connectedscatter: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/connectedscatter: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.s != null && /NaN|Infinity/.test(String(m.s))) {
      throw new Error('cardkit/connectedscatter: text reads "' + m.s + '" in ' + where);
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/** Refuse prose that carries a non-number into the page, where it reads as a measurement. */
function assertClean(text, where) {
  if (/NaN|Infinity/.test(String(text))) {
    throw new Error('cardkit/connectedscatter: ' + where + ' reads "' + text + '"');
  }
  return text;
}

/* -- what the card is ------------------------------------------------------------------- */

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it rather than two sources that can disagree.
 *
 * @example defaults.direction;   // 'both'
 */
export const defaults = { direction: 'both', labels: 'ends', curve: false };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.category;   // 'correlation-and-multivariate'
 */
export const meta = {
  name: 'connectedscatter',
  summary:
    'A scatter joined in time order, with the direction of travel carried by arrowheads, by a ' +
    'light-to-dark ramp along the path, or by both.',
  shape:
    '{ points: [{ x, y, t, label }], unit, xLabel, yLabel } -- ' +
    'x and y must be numbers or the point is refused and counted; t may be a number, a Date or ' +
    'a date string and orders the path, but only when EVERY point has a usable one, otherwise ' +
    'the given array order is used and the caption says so; label names a point and the first ' +
    'and last are always labelled; unit is a string for both axes or { x, y }',
  category: 'correlation-and-multivariate',
  defaults: { ...defaults },
};

/* -- reading the data ------------------------------------------------------------------- */

/**
 * Axis units, from either a bare string or a per-axis object.
 *
 * @example readUnit({ unit: 'ms' }).x;          // 'ms'
 * @example readUnit({ unit: { y: 'MB' } }).y;   // 'MB'
 */
function readUnit(d) {
  const u = d.unit;
  if (u == null) return { x: '', y: '' };
  if (typeof u === 'object') {
    return { x: u.x == null ? '' : String(u.x), y: u.y == null ? '' : String(u.y) };
  }
  const s = String(u);
  return { x: s, y: s };
}

/** A refused value, quoted short enough to sit in a caption. */
function shortLit(v) {
  if (v === undefined) return 'absent';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? '"' + v + '"' : String(v);
  return s.length > 18 ? s.slice(0, 17) + '\u2026' : s;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * The ordering rule is all-or-nothing on purpose. If every point has a `t` that can be ordered,
 * the path follows it; if even one does not, the whole path follows the given array order and the
 * caption says which rule was used. The mixture -- sort the ones that have a t, leave the others
 * where they were -- produces a path whose shape depends on how the two rules interleaved, and
 * nothing on the card could tell a reader that had happened.
 *
 * Ties in `t` keep their arrival order, so two measurements stamped the same second are drawn in
 * the order they were written rather than in whatever order the sort happened to leave them.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ pts, ordered, bad, names, unit, xLabel, yLabel }`
 *
 * @example readData({ points: [{ x: 1, y: 2, t: 5 }] }).ordered;   // true
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const src = Array.isArray(d.points) ? d.points : [];
  const bad = { notObject: 0, badXY: 0, noTime: 0 };
  const names = [];
  const raw = [];

  for (const p of src) {
    if (!p || typeof p !== 'object') { bad.notObject++; continue; }
    const x = numOf(p.x);
    const y = numOf(p.y);
    if (x === null || y === null) {
      bad.badXY++;
      if (names.length < 3) {
        names.push((x === null ? 'x: ' : 'y: ') + shortLit(x === null ? p.x : p.y));
      }
      continue;
    }
    const t = timeOf(p.t);
    if (t === null) {
      bad.noTime++;
      if (names.length < 3 && p.t !== undefined) names.push('t: ' + shortLit(p.t));
    }
    raw.push({ x, y, t, tRaw: p.t, label: p.label == null ? '' : String(p.label),
               at: raw.length });
  }

  const ordered = raw.length > 0 && raw.every((p) => p.t !== null);
  const pts = ordered
    ? raw.slice().sort((a, b) => (a.t - b.t) || (a.at - b.at))
    : raw;

  return {
    pts, ordered, bad, names,
    unit: readUnit(d),
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    yLabel: d.yLabel == null ? '' : String(d.yLabel),
  };
}

/**
 * One axis: a padded domain snapped outward to whole ticks, with those ticks.
 *
 * `CK.ticks` only returns ticks INSIDE the domain it is given, so a raw data domain leaves a
 * ragged strip above the last gridline. Snapping the ends to the step the ticks already chose
 * closes that, and the ticks are stepped out rather than re-derived -- asking `CK.ticks` again
 * with the wider range can push it to the next nice step and halve the number of gridlines.
 *
 * A collapsed domain -- every value identical, or a single point -- is widened by half its own
 * magnitude, or by one when the magnitude is zero, so the path has somewhere to sit.
 *
 * @param lo   the data minimum
 * @param hi   the data maximum
 * @param want roughly how many ticks to aim for
 * @returns `{ lo, hi, ticks }`
 *
 * @example axisOf(3, 97, 5).ticks;   // [0, 20, 40, 60, 80, 100]
 */
function axisOf(lo, hi, want) {
  let a = lo;
  let b = hi;
  if (!(b > a)) {
    const e = Math.abs(a) * 0.5 || 1;
    a -= e; b += e;
  } else {
    const e = (b - a) * 0.07;
    a -= e; b += e;
  }
  const t = CK.ticks(a, b, want);
  if (t.length < 2) return { lo: a, hi: b, ticks: t };
  const step = t[1] - t[0];
  if (!(step > 0)) return { lo: a, hi: b, ticks: t };
  const nlo = Math.floor(a / step) * step;
  const nhi = Math.ceil(b / step) * step;
  if (!(nhi > nlo)) return { lo: a, hi: b, ticks: t };

  const ticks = [];
  for (let k = 0; k < 400; k++) {
    const v = nlo + k * step;
    if (v > nhi + step / 1e6) break;
    ticks.push(Math.round(v / step) * step);
  }
  return { lo: nlo, hi: nhi, ticks };
}

/**
 * The plot rectangle, the two scales and the furniture that never changes with a setting.
 *
 * @param R the output of {@link readData}
 * @returns `{ plot, sx, sy, marks, ax, ay }`
 *
 * @example makeFrame(readData({ points: [{ x: 0, y: 0 }] })).plot.y0;   // 10
 */
function makeFrame(R) {
  let xlo = Infinity;
  let xhi = -Infinity;
  let ylo = Infinity;
  let yhi = -Infinity;
  for (const p of R.pts) {
    if (p.x < xlo) xlo = p.x;
    if (p.x > xhi) xhi = p.x;
    if (p.y < ylo) ylo = p.y;
    if (p.y > yhi) yhi = p.y;
  }
  if (!Number.isFinite(xlo)) { xlo = 0; xhi = 0; ylo = 0; yhi = 0; }

  const ax = axisOf(xlo, xhi, 6);
  const ay = axisOf(ylo, yhi, 5);

  const xcap = R.xLabel + (R.unit.x ? (R.xLabel ? ' (' + R.unit.x + ')' : R.unit.x) : '');
  const ycap = R.yLabel + (R.unit.y ? (R.yLabel ? ' (' + R.unit.y + ')' : R.unit.y) : '');

  const leftW = ay.ticks.reduce((m, t) => Math.max(m, textW(CK.fmt(t))), 0);
  const padL = Math.round(leftW) + 10 + (ycap ? 12 : 0);
  const padR = 14;
  const padT = 10;
  const padB = 20 + (xcap ? 12 : 0);

  const plot = { x0: padL, y0: padT, x1: W0 - padR, y1: H0 - padB };

  const sx = CK.scale([ax.lo, ax.hi], [plot.x0, plot.x1]);
  const sy = CK.scale([ay.lo, ay.hi], [plot.y1, plot.y0]);

  const marks = [];
  for (const t of ay.ticks) {
    const y = sy(t);
    marks.push({ t: 'line', a: { x1: n(plot.x0, 'grid'), y1: n(y, 'grid'),
                                 x2: n(plot.x1, 'grid'), y2: n(y, 'grid'), "class": 'ck-rule' } });
    marks.push({ t: 'text', a: { x: n(plot.x0 - 6, 'tk'), y: n(y + 3.2, 'tk'),
                                 "class": 'ck-tk', 'text-anchor': 'end' }, s: CK.fmt(t) });
  }
  for (const t of ax.ticks) {
    const x = sx(t);
    marks.push({ t: 'line', a: { x1: n(x, 'grid'), y1: n(plot.y0, 'grid'),
                                 x2: n(x, 'grid'), y2: n(plot.y1, 'grid'), "class": 'ck-rule' } });
    marks.push({ t: 'text', a: { x: n(x, 'tk'), y: n(plot.y1 + 13, 'tk'),
                                 "class": 'ck-tk', 'text-anchor': 'middle' }, s: CK.fmt(t) });
  }

  marks.push({ t: 'line', a: { x1: n(plot.x0, 'ax'), y1: n(plot.y0, 'ax'),
                               x2: n(plot.x0, 'ax'), y2: n(plot.y1, 'ax'), "class": 'ck-axis' } });
  marks.push({ t: 'line', a: { x1: n(plot.x0, 'ax'), y1: n(plot.y1, 'ax'),
                               x2: n(plot.x1, 'ax'), y2: n(plot.y1, 'ax'), "class": 'ck-axis' } });

  if (xcap) {
    marks.push({ t: 'text', a: { x: n((plot.x0 + plot.x1) / 2, 'cap'), y: n(plot.y1 + 25, 'cap'),
                                 "class": 'ck-cap-ax', 'text-anchor': 'middle' }, s: xcap });
  }
  if (ycap) {
    const cx = 10;
    const cy = (plot.y0 + plot.y1) / 2;
    marks.push({ t: 'text', a: { x: n(cx, 'cap'), y: n(cy, 'cap'), "class": 'ck-cap-ax',
                                 'text-anchor': 'middle',
                                 transform: 'rotate(-90 ' + n(cx, 'cap') + ' ' + n(cy, 'cap') + ')' },
                 s: ycap });
  }

  return { plot, sx, sy, marks, ax, ay };
}

/* -- the browser half: emitted here, tested here ---------------------------------------- */

/**
 * The path data for ONE segment, straight or smoothed, without its leading move.
 *
 * There is one of these rather than two path builders because the whole path and each individual
 * segment have to agree exactly: the ramp draws segments separately and the plain mode draws them
 * as one path, and a reader switching between the two must not see the line move. Building both
 * from the same tail is what makes that true by construction rather than by care.
 *
 * The smoothing is Catmull-Rom converted to a cubic Bezier, with the ends duplicated so the first
 * and last segments have neighbours. It passes exactly through every measured point -- that part
 * is not negotiable, a smoothed line that misses its own data is a drawing rather than a chart --
 * but between them it asserts a position nobody measured, which is why it is off by default.
 *
 * @param px    flat array of positions, x then y
 * @param i     the segment index; the segment runs from point i to point i + 1
 * @param curve whether to smooth
 * @returns the path tail, beginning with L or C
 *
 * @example segTail([0, 0, 10, 10], 0, false);   // 'L10,10'
 */
function segTail(px, i, curve) {
  var x1 = px[i * 2];
  var y1 = px[i * 2 + 1];
  var x2 = px[(i + 1) * 2];
  var y2 = px[(i + 1) * 2 + 1];
  if (!curve) { return 'L' + r2(x2) + ',' + r2(y2); }

  var last = px.length / 2 - 1;
  var i0 = i - 1 < 0 ? i : i - 1;
  var i3 = i + 2 > last ? i + 1 : i + 2;
  var x0 = px[i0 * 2];
  var y0 = px[i0 * 2 + 1];
  var x3 = px[i3 * 2];
  var y3 = px[i3 * 2 + 1];

  var c1x = x1 + (x2 - x0) / 6;
  var c1y = y1 + (y2 - y0) / 6;
  var c2x = x2 - (x3 - x1) / 6;
  var c2y = y2 - (y3 - y1) / 6;
  return 'C' + r2(c1x) + ',' + r2(c1y) + ' ' + r2(c2x) + ',' + r2(c2y) + ' ' +
         r2(x2) + ',' + r2(y2);
}

/**
 * The whole path picture as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so the
 * function a test calls in Node is textually the function the page runs.
 *
 * The arrowheads are the one place a zero can divide. A segment between two identical measurements
 * has no direction -- the vector is the zero vector and its angle is undefined -- so those
 * segments simply do not get an arrowhead rather than getting one pointed at an arbitrary
 * `Math.atan2(0, 0)`, which is zero and would draw a confident east-pointing arrow on a
 * measurement that did not move.
 *
 * @param model the precomputed model: positions, labels, the plot rectangle
 * @param cfg   `{ direction, labels, curve }`
 * @returns `{ marks, note, aria, arrows, segments }`
 *
 * @example connGeom(model, { direction: 'both', labels: 'ends', curve: false }).segments;   // 11
 */
function connGeom(model, cfg) {
  var i;
  var plot = model.plot;
  var px = model.pts;
  var count = px.length / 2;

  function pick(v, list, fallback) {
    for (var q = 0; q < list.length; q++) { if (list[q] === v) { return v; } }
    return fallback;
  }

  var dir = pick(cfg.direction, model.dirModes, model.dirDef);
  var labMode = pick(cfg.labels, model.labelModes, model.labelDef);
  var curve = cfg.curve === true || cfg.curve === 'true';

  var marks = [];
  if (!count) {
    return { marks: marks, note: model.emptyNote, aria: model.emptyAria, arrows: 0, segments: 0 };
  }

  var segs = count - 1;
  var ramp = dir === 'ramp' || dir === 'both';
  var arrows = dir === 'arrows' || dir === 'both';

  if (segs > 0) {
    if (ramp) {
      /* One element per shade. Past the cap the segments are grouped into contiguous chunks so
         the number of elements stops growing with the data; the gradient is unchanged. */
      var chunks = segs < model.rampCap ? segs : model.rampCap;
      var per = segs / chunks;
      for (i = 0; i < chunks; i++) {
        var from = Math.floor(i * per);
        var to = Math.floor((i + 1) * per);
        if (to <= from) { to = from + 1; }
        if (to > segs) { to = segs; }
        var d = 'M' + r2(px[from * 2]) + ',' + r2(px[from * 2 + 1]);
        for (var s = from; s < to; s++) { d += segTail(px, s, curve); }
        var op = chunks < 2 ? model.rampHi
          : model.rampLo + (model.rampHi - model.rampLo) * i / (chunks - 1);
        marks.push({ t: 'path', a: { d: d, "class": 'trail',
                                     'stroke-opacity': Math.round(op * 1000) / 1000 } });
      }
    } else {
      var whole = 'M' + r2(px[0]) + ',' + r2(px[1]);
      for (i = 0; i < segs; i++) { whole += segTail(px, i, curve); }
      marks.push({ t: 'path', a: { d: whole, "class": 'trail', 'stroke-opacity': 1 } });
    }
  }

  var drawn = 0;
  if (arrows && segs > 0) {
    var stride = Math.ceil(segs / model.arrowCap);
    if (stride < 1) { stride = 1; }
    for (i = 0; i < segs; i += stride) {
      var ax1 = px[i * 2];
      var ay1 = px[i * 2 + 1];
      var ax2 = px[(i + 1) * 2];
      var ay2 = px[(i + 1) * 2 + 1];
      var dx = ax2 - ax1;
      var dy = ay2 - ay1;
      /* No direction to draw when the two measurements are the same point. */
      if (dx === 0 && dy === 0) { continue; }
      var ang = Math.atan2(dy, dx) * 180 / Math.PI;
      var mx = (ax1 + ax2) / 2;
      var my = (ay1 + ay2) / 2;
      drawn++;
      marks.push({ t: 'path', a: { d: 'M-3.2,-2.6L3.4,0L-3.2,2.6Z', "class": 'arrow',
                                   transform: 'translate(' + r2(mx) + ',' + r2(my) + ') rotate(' +
                                              r2(ang) + ')' } });
    }
  }

  /* Dots. The path is one element and always complete; the dots are the part that has to thin. */
  var stepDot = Math.ceil(count / model.dotCap);
  if (stepDot < 1) { stepDot = 1; }
  for (i = 0; i < count; i++) {
    var isEnd = i === 0 || i === count - 1;
    if (!isEnd && (i % stepDot)) { continue; }
    var cls = i === 0 ? 'first' : (i === count - 1 ? 'last' : 'node');
    var mark = { t: 'circle', a: { cx: r2(px[i * 2]), cy: r2(px[i * 2 + 1]),
                                   r: isEnd ? 4 : 2.4, "class": cls } };
    if (model.tipOn) { mark.ti = model.tip[i]; }
    marks.push(mark);
  }

  if (labMode !== 'none') {
    for (i = 0; i < count; i++) {
      var end = i === 0 || i === count - 1;
      if (labMode === 'ends' && !end) { continue; }
      var text = model.lab[i];
      if (!text) { continue; }
      var lx = px[i * 2];
      var ly = px[i * 2 + 1];
      var anchor = lx > (plot.x0 + plot.x1) / 2 ? 'end' : 'start';
      var off = anchor === 'end' ? -7 : 7;
      marks.push({ t: 'text', a: { x: r2(lx + off), y: r2(ly - 6), "class": end ? 'elab' : 'nlab',
                                   'text-anchor': anchor }, s: text });
    }
  }

  var channel = dir === 'both'
    ? 'direction is carried twice over -- arrowheads along the path AND a light-to-dark ramp from ' +
      'the first measurement to the last -- because a reader who misses one still has the other. '
    : dir === 'arrows'
      ? 'direction is carried by the arrowheads alone; the line is one weight throughout. '
      : 'direction is carried by the shade alone: the path runs from faint at the first ' +
        'measurement to solid at the last. ';

  var curveLine = curve
    ? 'the line is smoothed, so it passes through every measurement and INVENTS the positions ' +
      'between them. '
    : 'segments are straight, so the line claims only the measurements it was given. ';

  var note = channel + curveLine + model.orderNote + model.census;
  var aria = 'Connected scatter of ' + plural(count, 'point', 'points') + ' joined in ' +
    (model.ordered ? 'time order' : 'the order they were given') + '. ' + channel +
    model.endsAria + model.axisAria;

  return { marks: marks, note: note, aria: aria, arrows: drawn, segments: segs };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of the whole path on the second pass.
 *
 * @example paintList(svg, [{ t: 'circle', a: { r: 4 } }]);
 */
function paintList(box, marks) {
  var NS = 'http://www.w3.org/2000/svg';
  function node(m) {
    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (m.s != null) { e.textContent = m.s; }
    if (m.ti != null) {
      tip = document.createElementNS(NS, 'title');
      tip.textContent = m.ti;
      e.appendChild(tip);
    }
    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }
    return e;
  }
  while (box.firstChild) { box.removeChild(box.firstChild); }
  var frag = document.createDocumentFragment();
  for (var j = 0; j < marks.length; j++) { frag.appendChild(node(marks[j])); }
  box.appendChild(frag);
}

/* -- emit -------------------------------------------------------------------------------- */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour; every value is a desk token. The first point is hollow and the last
 * is solid, which is a third, redundant direction cue that costs nothing and survives both a
 * greyscale print and a viewer who has switched the ramp off.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['svg.ck-cs', 'display: block; width: 100%; height: auto;'],
    ['.ck-cs text', 'font-family: var(--mono); font-size: 9px;'],
    ['.ck-cs .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-cs .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],

    ['.ck-cs .trail',
     'fill: none; stroke: var(--ck-s6); stroke-width: 1.7; stroke-linecap: round; ' +
     'stroke-linejoin: round;'],
    ['.ck-cs .arrow', 'fill: var(--ck-s6); stroke: none;'],
    ['.ck-cs .node', 'fill: var(--ck-s6); stroke: var(--ground); stroke-width: 0.8;'],
    ['.ck-cs .first', 'fill: var(--ground); stroke: var(--ck-s6); stroke-width: 1.6;'],
    ['.ck-cs .last', 'fill: var(--ck-s6); stroke: var(--ground); stroke-width: 1.2;'],
    ['.ck-cs .elab', 'fill: var(--ink);'],
    ['.ck-cs .nlab', 'fill: var(--ink-faint);'],

    ['.ck-cs-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scope(id, rules) + '\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the plot, a legend and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The part that changes with the settings is an
 * empty element the script fills with `textContent`, never with markup.
 */
function cardHtml(id, title, R, said, hasPts) {
  const e = CK.esc;

  const void_ = hasPts ? '' :
    '  <div class="ck-cs-void">nothing to join &mdash; no usable points were given</div>\n';

  const svg = hasPts
    ? '  <svg class="ck-plot ck-cs" role="img" viewBox="0 0 ' + W0 + ' ' + H0 +
      '" aria-label="' + e(said.aria) + '"></svg>\n'
    : '';

  return '<section data-card="' + e(id) + '" class="ck-connectedscatter">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-direction">direction shown by</label>\n' +
    '    <select id="' + e(id) + '-direction" name="direction">\n' +
    DIR_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <select id="' + e(id) + '-labels" name="labels">\n' +
    LABEL_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-curve">smooth the line</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-curve" name="curve">\n' +
    '    <div class="ck-set-foot">the hollow mark is the first measurement and the solid one is ' +
    'the last, whatever else is switched off. smoothing passes through every point and invents ' +
    'the positions between them, which is why it starts off.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(R.pts.length)) + '</b> ' +
    (R.pts.length === 1 ? 'point' : 'points') + '. <i class="ck-cs-note">' + e(said.note) +
    '</i>' + refusalHtml(R) + '</div>\n' +
    '</section>\n';
}

/** The refusals, said in the caption, because a silently dropped point is a silently wrong plot. */
function refusalHtml(R) {
  const e = CK.esc;
  const bits = [];
  if (R.bad.badXY) bits.push(plural(R.bad.badXY, 'point', 'points') + ' had no numeric position');
  if (R.bad.notObject) bits.push(plural(R.bad.notObject, 'entry was', 'entries were') + ' not an object');
  if (!bits.length) return '';
  const named = R.names.length ? ' (' + R.names.join(', ') + ')' : '';
  return ' <span class="ck-aside">' + e(bits.join('; ') + named + '; refused, not repaired.') +
         '</span>';
}

/**
 * The browser half: read the settings, build the path, place the arrows, paint.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated inside the geometry function
 * on every draw, because they come out of `localStorage`, which is a text file the viewer can
 * edit, and a mode read straight out of it and used as a property name would reach
 * `Object.prototype` on the string "constructor".
 */
function cardJs(id, model, inst) {
  const js =
    '/* connected scatter: positions, the ordering and the frame were computed in Node;\n' +
    '   the path, the arrowheads and the labels happen here, because all three change with\n' +
    '   viewer settings. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    'function plural(count, one, many) { return count + " " + (count === 1 ? one : many); }\n\n' +
    'function r2(v) { return Math.round(v * 100) / 100; }\n\n' +
    segTail.toString() + '\n\n' +
    connGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-cs");\n' +
    '  var note = sec.querySelector(".ck-cs-note");\n\n' +
    '  function draw(cfg) {\n' +
    '    var got = connGeom(MODEL, cfg);\n' +
    '    if (note) { note.textContent = got.note; }\n' +
    '    if (!box) { return; }\n' +
    '    paintList(box, MODEL.frame.concat(got.marks));\n' +
    '    box.setAttribute("aria-label", got.aria);\n' +
    '  }\n\n' +
    '  CK.settings(sec, DEF, draw);\n' +
    '});\n';
  return guardEmitted(js, id);
}

/**
 * Build one connected-scatter card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the ordering rule, the endpoints and the
 *          axis domains, so a reader can check the caption without re-deriving anything
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'phillips',
 *   title: 'unemployment against inflation, year by year',
 *   data: { points: [{ x: 5.2, y: 1.4, t: 2019, label: '19' },
 *                    { x: 8.1, y: 1.2, t: 2020, label: '20' }],
 *           unit: '%' },
 *   ord: 48,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'connectedscatter' : id);
  const R = readData(data);
  const frame = makeFrame(R);

  const pts = [];
  for (const p of R.pts) pts.push(n1(frame.sx(p.x), 'px'), n1(frame.sy(p.y), 'py'));

  const stamp = (p) => (p.t === null ? '' : (typeof p.tRaw === 'string' ? p.tRaw : CK.fmt(p.t)));
  const nameOf = (p, i) =>
    p.label || stamp(p) || (CK.fmt(p.x) + ', ' + CK.fmt(p.y));

  const lab = R.pts.map((p, i) => clip(nameOf(p, i), 90));
  const tip = R.pts.map((p, i) =>
    '#' + (i + 1) + (p.label ? ' \u00b7 ' + p.label : '') +
    (p.t === null ? '' : ' \u00b7 ' + stamp(p)) +
    ' \u00b7 ' + CK.fmt(p.x) + (R.unit.x ? ' ' + R.unit.x : '') +
    ', ' + CK.fmt(p.y) + (R.unit.y ? ' ' + R.unit.y : ''));

  const same = R.pts.length > 1 &&
    R.pts.every((p) => p.x === R.pts[0].x && p.y === R.pts[0].y);

  const orderNote = R.pts.length < 2
    ? (R.pts.length === 1
        ? 'one point, so there is no path: a path needs two measurements and a direction between ' +
          'them. the point is drawn where it was measured. '
        : '')
    : R.ordered
      ? 'the points are joined in the order of their t. '
      : plural(R.bad.noTime, 'point had', 'points had') + ' no usable t, so the WHOLE path ' +
        'follows the order the points were given in rather than mixing two rules -- a path ' +
        'ordered two ways is a shape nobody can read back. ';

  const dupNote = same
    ? 'every point sits at the same position, so the path has no length and no segment has a ' +
      'direction to draw an arrowhead on. '
    : '';
  const thinNote = R.pts.length > DOT_CAP
    ? 'the path is drawn complete and the dots are thinned: at ' + R.pts.length +
      ' measurements a dot per point is a solid band rather than a set of marks. '
    : '';
  const census = dupNote + thinNote;

  const first = R.pts.length ? nameOf(R.pts[0], 0) : '';
  const last = R.pts.length ? nameOf(R.pts[R.pts.length - 1], R.pts.length - 1) : '';
  const endsAria = R.pts.length > 1
    ? 'It starts at ' + first + ' and ends at ' + last + '. '
    : '';

  const axisAria =
    'The horizontal axis runs from ' + CK.fmt(frame.ax.lo) + ' to ' + CK.fmt(frame.ax.hi) +
    (R.unit.x ? ' ' + R.unit.x : '') + ' and the vertical from ' + CK.fmt(frame.ay.lo) +
    ' to ' + CK.fmt(frame.ay.hi) + (R.unit.y ? ' ' + R.unit.y : '') + '.';

  const model = {
    plot: { x0: n(frame.plot.x0, 'plot'), y0: n(frame.plot.y0, 'plot'),
            x1: n(frame.plot.x1, 'plot'), y1: n(frame.plot.y1, 'plot') },
    pts, lab, tip,
    ordered: R.ordered,
    rampLo: RAMP_LO, rampHi: RAMP_HI, rampCap: RAMP_CAP,
    arrowCap: ARROW_CAP, dotCap: DOT_CAP,
    dirModes: DIR_MODES.slice(),
    labelModes: LABEL_MODES.slice(),
    dirDef: defaults.direction,
    labelDef: defaults.labels,
    tipOn: R.pts.length <= TIP_CAP ? 1 : 0,
    frame: frame.marks,
    orderNote, census, endsAria, axisAria,
    emptyNote: 'no usable points, so there is nothing to join; the axes are drawn so the card ' +
               'keeps its place.',
    emptyAria: 'An empty connected scatter: no usable points were given.',
  };

  const inst = { ...defaults };

  /* The browser half is exercised here over every configuration a viewer can reach, so a
     degenerate input that would produce a NaN coordinate -- an arrowhead on a zero-length segment
     is the one that bites -- is caught at build time next to the data that caused it. */
  let active = null;
  for (const direction of DIR_MODES) {
    for (const labels of LABEL_MODES) {
      for (const curve of [false, true]) {
        const got = connGeom(model, { direction, labels, curve });
        assertFinite(got.marks, direction + '/' + labels + '/curve ' + curve);
        assertClean(got.note, 'note for ' + direction);
        assertClean(got.aria, 'aria for ' + direction);
        if (direction === inst.direction && labels === inst.labels && curve === inst.curve) {
          active = got;
        }
      }
    }
  }
  if (!active) active = connGeom(model, inst);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'connectedscatter',
      points: R.pts.length,
      orderedBy: R.ordered ? 't' : 'given',
      pointsWithoutTime: R.bad.noTime,
      segments: active.segments,
      arrowheads: active.arrows,
      first, last,
      allSamePosition: same,
      xDomain: [frame.ax.lo, frame.ax.hi],
      yDomain: [frame.ay.lo, frame.ay.hi],
      refused: { badPositions: R.bad.badXY, notObjects: R.bad.notObject },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active, R.pts.length > 0),
    css: cardCss(cardId),
    js: cardJs(cardId, model, inst),
  };
}

/* Exported for the verifier only: the path builder and the geometry the browser runs, so a test
   can check that a segment and the whole path agree and that a zero-length step grows no arrow. */
export { segTail, connGeom, timeOf, readData, axisOf, makeFrame };
