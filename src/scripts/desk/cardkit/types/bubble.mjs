/**
 * `bubble` -- a scatter with a third variable carried by the AREA of each mark.
 *
 * The one thing this card exists to get right is in its first sentence, and it is the thing most
 * bubble charts get wrong. A third variable added to a scatter has to become the mark's AREA, not
 * its radius. A reader compares two discs by how much ink each one has, which is area, so if the
 * radius carries the value then a value four times larger looks SIXTEEN times larger and the chart
 * has silently squared its own data. It is not a subtle distortion: on any real range it is the
 * difference between "twice as big" and "an order of magnitude bigger", and it always exaggerates.
 *
 * So the radius here is the square root of the value, scaled to the largest mark -- see
 * {@link radiusFor}, which is the only place a size becomes a length, and which is checkable:
 * quadruple the value and the radius doubles.
 *
 * Two further decisions worth reading:
 *
 *   1. **Overlap is inherent and is drawn rather than avoided.** A bubble chart with no overlap is
 *      a bubble chart whose marks are too small to read the area of. So the marks are painted
 *      LARGEST FIRST, which puts every small one on top of every large one it lands in -- the
 *      alternative buries small values under big ones and they simply vanish -- and they are
 *      painted at a fill opacity the viewer can move, so a pile-up reads as a pile-up.
 *   2. **A size of zero is drawn, and it is the one mark on the card whose area is a lie.** Zero
 *      has no area, so an honest encoding would draw nothing, and "no measurement" and "measured
 *      zero" would look identical. It gets a dot at the floor radius and its own class, and the
 *      caption says so. A NEGATIVE size is refused outright: there is no such disc. The point is
 *      still drawn, as a dashed hollow ring, because its x and y are perfectly good measurements
 *      and throwing them away to punish a bad third column would lose more than it saves.
 *
 * @see ./chart.mjs -- the same scatter without the third variable, when two is all there is
 * @see ./hexbin.mjs -- when the third variable is just "how many points are here"
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
  catch (e) { throw new Error('cardkit/bubble: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/bubble: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* -- constants ------------------------------------------------------------------------- */

/** The drawing box. The SVG scales to the column; these are its internal units. */
const W0 = 620;
const H0 = 330;

/** Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;
const TXT = 9;

/**
 * The radius of the largest bubble, and the range the setting may reach.
 *
 * The ceiling is not arbitrary. At 48 the biggest disc is 96 units across against a plot roughly
 * 270 tall, which is already a third of the picture; past that the largest value stops being a
 * mark and becomes a background, and the size legend that has to sit beside it stops fitting.
 */
const MAXR_MIN = 6;
const MAXR_MAX = 48;
const MAXR_DEF = 24;

/**
 * The floor radius, worn by a size of zero and by a point whose size was refused.
 *
 * A size of zero has no area at all, so this is the one place on the card where the mark's size
 * does not encode its value. It is a deliberate exception with a reason: zero is a measurement and
 * a reader has to be able to tell it from a point that was never measured.
 */
const MIN_R = 1.6;

/** Fill opacity, and the range the setting may reach. Under the floor a pile-up is invisible. */
const OP_MIN = 0.15;
const OP_MAX = 1;
const OP_DEF = 0.55;

/** The three things `labels` may say. */
const LABEL_MODES = ['none', 'fit', 'all'];

/**
 * Past this many points the marks are sampled, and the rule is stated rather than hidden.
 *
 * The sample is taken AFTER sorting by size, descending, and takes every k-th -- so the largest
 * bubble is always kept, the sample spans the whole size range evenly, and two builds of the same
 * data give the same picture. Sampling in arrival order would be simpler and would sometimes drop
 * the one bubble the chart is about.
 */
const DOT_CAP = 3000;

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
    throw new Error('cardkit/bubble: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to one decimal -- the resolution positions travel at, finer than any pixel. */
function n1(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/bubble: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 10) / 10;
}

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
  const own = '.ck-bubble[data-card="' + cssId(id) + '"]';
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
    throw new Error('cardkit/bubble: refusing to emit ' + where + ' -- ' + bad.join('; '));
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
          throw new Error('cardkit/bubble: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/bubble: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.s != null && /NaN|Infinity/.test(String(m.s))) {
      throw new Error('cardkit/bubble: text reads "' + m.s + '" in ' + where);
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/** Refuse prose that carries a non-number into the page, where it reads as a measurement. */
function assertClean(text, where) {
  if (/NaN|Infinity/.test(String(text))) {
    throw new Error('cardkit/bubble: ' + where + ' reads "' + text + '"');
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
 * @example defaults.maxSize;   // 24
 */
export const defaults = { maxSize: MAXR_DEF, labels: 'fit', opacity: OP_DEF };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.category;   // 'correlation-and-multivariate'
 */
export const meta = {
  name: 'bubble',
  summary:
    'A scatter whose third variable is the area of each mark, with a nested size legend and an ' +
    'overlap the reader can see through.',
  shape:
    '{ points: [{ x, y, size, label, group }], unit, xLabel, yLabel } -- ' +
    'x and y must be numbers or the point is refused and counted; size becomes AREA, so the ' +
    'radius is its square root; a size of zero is drawn at the floor radius and a negative one ' +
    'is refused as a size while the point keeps its position; group colours the marks and ' +
    'builds a legend; unit is a string for both axes or { x, y, size }',
  category: 'correlation-and-multivariate',
  defaults: { ...defaults },
};

/* -- reading the data ------------------------------------------------------------------- */

/**
 * Axis and size units, from either a bare string or a per-axis object.
 *
 * @example readUnit({ unit: 'ms' }).x;              // 'ms'
 * @example readUnit({ unit: { size: 'GB' } }).size; // 'GB'
 */
function readUnit(d) {
  const u = d.unit;
  if (u == null) return { x: '', y: '', size: '' };
  if (typeof u === 'object') {
    return { x: u.x == null ? '' : String(u.x), y: u.y == null ? '' : String(u.y),
             size: u.size == null ? '' : String(u.size) };
  }
  const s = String(u);
  return { x: s, y: s, size: '' };
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
 * The refusals are graded rather than uniform, and the grading is the point. A point with no
 * numeric x or y has no position and cannot be drawn at all, so it goes. A point with a bad SIZE
 * still has a perfectly good position, so it stays and loses only its third dimension -- drawn as
 * a dashed hollow ring, which reads as "here, unsized" rather than as "here, tiny". A negative
 * size is in that second class: there is no disc of negative area, and refusing the value while
 * keeping the measurement is the only reading that throws nothing away.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ pts, groups, bad, names, unit, xLabel, yLabel }`
 *
 * @example readData({ points: [{ x: 1, y: 2, size: 4 }] }).pts[0].size;   // 4
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const src = Array.isArray(d.points) ? d.points : [];
  const bad = { notObject: 0, badXY: 0, negSize: 0, badSize: 0, noSize: 0, zeroSize: 0 };
  const names = [];
  const pts = [];
  const groups = [];

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

    let size = null;
    let kind = 0;
    if (p.size === undefined || p.size === null) { bad.noSize++; kind = 2; }
    else {
      const s = numOf(p.size);
      if (s === null) {
        bad.badSize++;
        kind = 2;
        if (names.length < 3) names.push('size: ' + shortLit(p.size));
      } else if (s < 0) {
        bad.negSize++;
        kind = 2;
        if (names.length < 3) names.push('size: ' + shortLit(p.size));
      } else {
        size = s;
        if (s === 0) { bad.zeroSize++; kind = 1; }
      }
    }

    const group = p.group == null ? null : String(p.group);
    if (group !== null && !groups.includes(group)) groups.push(group);

    pts.push({ x, y, size, kind, group,
               label: p.label == null ? '' : String(p.label) });
  }

  return {
    pts, groups, bad, names,
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
 * magnitude, or by one when the magnitude is zero, so the marks have somewhere to sit.
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
    const e = (b - a) * 0.06;
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
 * The radius that gives a mark the right AREA for its value.
 *
 * This is the whole card in four lines, and the reason it is its own function is that it is the
 * one piece a reader should be able to check by inspection. Area is pi r squared, so encoding a
 * value in area means the radius is proportional to the square root of the value: quadruple the
 * value and the radius doubles, which is what a reader's eye already assumes it is being told.
 *
 * The alternative -- radius proportional to the value -- makes area proportional to the value
 * SQUARED. A value four times larger then covers sixteen times the ink. That is not a rounding
 * error; on a range of a hundred to one it is the difference between a bubble ten times wider and
 * one a hundred times wider, and it always exaggerates the big values, which are the ones a reader
 * is most likely to quote.
 *
 * Zero is the documented exception: it has no area, so it gets the floor radius and its own class
 * rather than vanishing, because "measured zero" and "not measured" must not look the same.
 *
 * @param size    the value to encode; zero or negative gets the floor
 * @param sizeMax the largest value in the data, which the largest radius corresponds to
 * @param maxR    the radius the largest value should get
 * @param minR    the floor radius
 * @returns the radius in drawing units
 *
 * @example radiusFor(100, 100, 24, 1.6);   // 24
 * @example radiusFor(25, 100, 24, 1.6);    // 12   (a quarter of the value, half the radius)
 */
function radiusFor(size, sizeMax, maxR, minR) {
  if (!(sizeMax > 0) || !(size > 0)) { return minR; }
  var f = size / sizeMax;
  if (f > 1) { f = 1; }
  var r = maxR * Math.sqrt(f);
  return r < minR ? minR : r;
}

/**
 * A greedy label placer that will only put a label where nothing else already is.
 *
 * "Where they fit" is the whole feature in `fit` mode: an unfiltered bubble chart labels every
 * mark and the labels turn into a grey smear over the picture they annotate. Candidates are tried
 * in order -- right of the mark, left, above, below -- and the first box that clears the plot
 * edges and every label already down wins. Anything that fits nowhere is not drawn, which is
 * right: the label is still in the tooltip.
 *
 * The pass runs in draw order, which is largest bubble first, so the biggest marks get first
 * refusal on contested space. That is a deliberate bias: on a bubble chart the large marks are the
 * ones a reader wants named.
 *
 * @param taken an array that accumulates the boxes already used
 * @param text  the label
 * @param cands candidate `{ x, y, anchor }` positions
 * @param plot  the plot bounds; nothing is placed outside them
 * @param force when true, take the first candidate inside the plot regardless of collisions
 * @returns the chosen candidate, or null
 *
 * @example placeLabel([], 'a', [{ x: 10, y: 10, anchor: 'start' }], plot, false);
 */
function placeLabel(taken, text, cands, plot, force) {
  var w = String(text).length * 5.42;
  var i, j;
  for (i = 0; i < cands.length; i++) {
    var c = cands[i];
    var left = c.anchor === 'middle' ? c.x - w / 2 : c.anchor === 'end' ? c.x - w : c.x;
    var box = { x0: left - 1.5, y0: c.y - 9 + 0.5, x1: left + w + 1.5, y1: c.y + 2.5 };
    if (box.x0 < plot.x0 - 2 || box.x1 > plot.x1 + 2) { continue; }
    if (box.y0 < plot.y0 - 2 || box.y1 > plot.y1 + 2) { continue; }
    if (!force) {
      var clash = false;
      for (j = 0; j < taken.length; j++) {
        var b = taken[j];
        if (box.x1 <= b.x0 || box.x0 >= b.x1 || box.y1 <= b.y0 || box.y0 >= b.y1) { continue; }
        clash = true;
        break;
      }
      if (clash) { continue; }
    }
    taken.push(box);
    return c;
  }
  return null;
}

/**
 * The whole bubble picture as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so the
 * function a test calls in Node is textually the function the page runs.
 *
 * The marks are already sorted largest first in the model, and they are drawn in that order, so
 * every small bubble lands on top of every large one it sits inside. The opposite order is what a
 * naive implementation does -- data order -- and it buries small values completely.
 *
 * @param model the precomputed model: positions, sizes, colours, the plot rectangle
 * @param cfg   `{ maxSize, labels, opacity }`
 * @returns `{ marks, note, aria, labelled, hidden }`
 *
 * @example bubbleGeom(model, { maxSize: 24, labels: 'fit', opacity: 0.55 }).labelled;   // 12
 */
function bubbleGeom(model, cfg) {
  var i;
  var plot = model.plot;

  function r2(v) { return Math.round(v * 100) / 100; }
  function pick(v, list, fallback) {
    for (var q = 0; q < list.length; q++) { if (list[q] === v) { return v; } }
    return fallback;
  }

  var maxR = Math.round(Number(cfg.maxSize));
  if (!isFinite(maxR)) { maxR = model.maxRDef; }
  if (maxR < model.maxRMin) { maxR = model.maxRMin; }
  if (maxR > model.maxRMax) { maxR = model.maxRMax; }

  var op = Number(cfg.opacity);
  if (!isFinite(op)) { op = model.opDef; }
  if (op < model.opMin) { op = model.opMin; }
  if (op > model.opMax) { op = model.opMax; }

  var labMode = pick(cfg.labels, model.labelModes, model.labelDef);
  var marks = [];
  var pts = model.pts;

  if (!pts.length) {
    return { marks: marks, note: model.emptyNote, aria: model.emptyAria, labelled: 0, hidden: 0 };
  }

  for (i = 0; i < pts.length; i++) {
    var p = pts[i];
    var r = radiusFor(p[2], model.sizeMax, maxR, model.minR);
    var cls = p[4] === 2 ? 'unsized' : (p[4] === 1 ? 'zero' : 'bub');
    var a = { cx: r2(p[0]), cy: r2(p[1]), r: r2(r), "class": cls };
    if (p[4] === 0) {
      a.fill = model.hue[p[3]];
      a['fill-opacity'] = r2(op);
    } else if (p[4] === 1) {
      a.fill = model.hue[p[3]];
    }
    var mark = { t: 'circle', a: a };
    if (model.tipOn) { mark.ti = model.tip[i]; }
    marks.push(mark);
  }

  /* Labels come after every mark, so no bubble is drawn over a name. */
  var labelled = 0;
  if (labMode !== 'none') {
    var taken = [];
    for (i = 0; i < pts.length; i++) {
      var q = pts[i];
      var text = model.lab[i];
      if (!text) { continue; }
      var rr = radiusFor(q[2], model.sizeMax, maxR, model.minR);
      var spot = placeLabel(taken, text, [
        { x: q[0] + rr + 4, y: q[1] + 3.2, anchor: 'start' },
        { x: q[0] - rr - 4, y: q[1] + 3.2, anchor: 'end' },
        { x: q[0], y: q[1] - rr - 4, anchor: 'middle' },
        { x: q[0], y: q[1] + rr + 11, anchor: 'middle' }
      ], plot, labMode === 'all');
      if (spot) {
        labelled++;
        marks.push({ t: 'text', a: { x: r2(spot.x), y: r2(spot.y), "class": 'blab',
                                     'text-anchor': spot.anchor }, s: text });
      }
    }
  }

  /* The nested size legend: circles sharing a bottom tangent, stroke only so the data under them
     stays readable. Nested rather than side by side because that is the arrangement in which a
     reader compares areas rather than diameters. */
  if (model.legend.length && model.sizeMax > 0) {
    var big = radiusFor(model.legend[0], model.sizeMax, maxR, model.minR);
    var baseY = plot.y1 - 6;
    var cx = plot.x0 + big + 10;
    for (i = 0; i < model.legend.length; i++) {
      var lr = radiusFor(model.legend[i], model.sizeMax, maxR, model.minR);
      marks.push({ t: 'circle', a: { cx: r2(cx), cy: r2(baseY - lr), r: r2(lr), "class": 'lgc' } });
      marks.push({ t: 'line', a: { x1: r2(cx), y1: r2(baseY - 2 * lr), x2: r2(cx + big + 6),
                                   y2: r2(baseY - 2 * lr), "class": 'lgl' } });
      marks.push({ t: 'text', a: { x: r2(cx + big + 9), y: r2(baseY - 2 * lr + 3),
                                   "class": 'tk', 'text-anchor': 'start' }, s: model.legendLab[i] });
    }
  }

  var areaLine = 'size is AREA, so the radius is its square root: four times the value is twice ' +
    'the radius, not four times. ';
  var orderLine = 'marks are drawn largest first, so a small bubble inside a large one stays ' +
    'visible; overlap is inherent to the form and is shown rather than hidden. ';

  var note = areaLine + orderLine + model.census +
    (labMode === 'all'
      ? 'every label is drawn, so some of them overlap. '
      : labMode === 'fit'
        ? plural(labelled, 'label', 'labels') + ' fitted without colliding; the rest are in the ' +
          'tooltips. '
        : '');
  var aria = 'Bubble chart of ' + plural(model.count, 'point', 'points') + '. ' + areaLine +
    model.census + model.axisAria;

  return { marks: marks, note: note, aria: aria, labelled: labelled, hidden: 0 };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every bubble on the second pass.
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
 * Nothing here names a colour; every value is a desk token. The unsized ring is a dashed outline
 * rather than a faint fill on purpose: a viewer cannot tell a very pale disc from a slightly less
 * pale one, so "no size" shaded like "small size" would be the most misleading thing this card
 * could do. A difference in KIND is legible at a glance.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['svg.ck-bb', 'display: block; width: 100%; height: auto;'],
    ['.ck-bb text', 'font-family: var(--mono); font-size: 9px;'],
    ['.ck-bb .ck-tk, .ck-bb .tk', 'fill: var(--ink-faint);'],
    ['.ck-bb .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],

    ['.ck-bb .bub', 'stroke: var(--ground); stroke-width: 0.6;'],
    ['.ck-bb .zero', 'stroke: none;'],
    ['.ck-bb .unsized',
     'fill: none; stroke: var(--ink-faint); stroke-width: 0.9; stroke-dasharray: 2 1.6;'],
    ['.ck-bb .lgc', 'fill: none; stroke: var(--ink-faint); stroke-width: 0.8;'],
    ['.ck-bb .lgl', 'stroke: var(--ink-faint); stroke-width: 0.5;'],
    ['.ck-bb .blab', 'fill: var(--ink-dim);'],

    ['.ck-bb-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="number"]', 'width: 6.5em;'],
  ];

  /* The group legend's swatches. kit.css gives `.ck-legend i` its box and nothing else, so the
     fill has to be declared per series here, the same way `chart` does it. */
  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }
  return scope(id, rules) + '\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the plot, a group legend, the caption.
 *
 * Every interpolated value goes through `CK.esc`. The part that changes with the settings is an
 * empty element the script fills with `textContent`, never with markup.
 */
function cardHtml(id, title, R, said, hasPts) {
  const e = CK.esc;

  const void_ = hasPts ? '' :
    '  <div class="ck-bb-void">nothing to draw &mdash; no usable points were given</div>\n';

  const svg = hasPts
    ? '  <svg class="ck-plot ck-bb" role="img" viewBox="0 0 ' + W0 + ' ' + H0 +
      '" aria-label="' + e(said.aria) + '"></svg>\n'
    : '';

  const legend = R.groups.length
    ? '  <div class="ck-legend">' +
      R.groups.map((g, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + e(g) + '</span>')
        .join('') + '</div>\n'
    : '';

  return '<section data-card="' + e(id) + '" class="ck-bubble">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-maxSize">largest radius</label>\n' +
    '    <input type="number" id="' + e(id) + '-maxSize" name="maxSize" min="' + MAXR_MIN +
    '" max="' + MAXR_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <select id="' + e(id) + '-labels" name="labels">\n' +
    LABEL_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-opacity">fill opacity</label>\n' +
    '    <input type="number" id="' + e(id) + '-opacity" name="opacity" min="' + OP_MIN +
    '" max="' + OP_MAX + '" step="0.05">\n' +
    '    <div class="ck-set-foot">the radius is the square root of the size, so the AREA is ' +
    'proportional to the value. a larger radius setting scales every mark together and never ' +
    'changes which is bigger.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(R.pts.length)) + '</b> ' +
    (R.pts.length === 1 ? 'point' : 'points') + '. <i class="ck-bb-note">' + e(said.note) +
    '</i>' + refusalHtml(R) + '</div>\n' + legend +
    '</section>\n';
}

/** The refusals, said in the caption, because a silently dropped point is a silently wrong plot. */
function refusalHtml(R) {
  const e = CK.esc;
  const bits = [];
  if (R.bad.badXY) bits.push(plural(R.bad.badXY, 'point', 'points') + ' had no numeric position');
  if (R.bad.negSize) {
    bits.push(plural(R.bad.negSize, 'size was', 'sizes were') + ' negative, which is not an area; ' +
      'those points keep their position and lose their size');
  }
  if (R.bad.badSize) bits.push(plural(R.bad.badSize, 'size was', 'sizes were') + ' not a number');
  if (R.bad.notObject) bits.push(plural(R.bad.notObject, 'entry was', 'entries were') + ' not an object');
  if (!bits.length) return '';
  const named = R.names.length ? ' (' + R.names.join(', ') + ')' : '';
  return ' <span class="ck-aside">' + e(bits.join('; ') + named + '.') + '</span>';
}

/**
 * The browser half: read the settings, size the marks, place the labels, paint.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated inside the geometry function
 * on every draw, because they come out of `localStorage`, which is a text file the viewer can
 * edit, and a radius of zero or of the word "huge" must land on something drawable.
 */
function cardJs(id, model, inst) {
  const js =
    '/* bubble card: positions, sizes, colours and the frame were computed in Node;\n' +
    '   the radii and the label placement happen here, because both change with the settings. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    'function plural(count, one, many) { return count + " " + (count === 1 ? one : many); }\n\n' +
    radiusFor.toString() + '\n\n' +
    placeLabel.toString() + '\n\n' +
    bubbleGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-bb");\n' +
    '  var note = sec.querySelector(".ck-bb-note");\n\n' +
    '  function draw(cfg) {\n' +
    '    var got = bubbleGeom(MODEL, cfg);\n' +
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
 * Build one bubble card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the size domain, the legend values and the
 *          refusal census, so a reader can check the caption without re-deriving anything
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'repos',
 *   title: 'stars against age, sized by open issues',
 *   data: { points: [{ x: 3, y: 900, size: 41, label: 'kit', group: 'core' }],
 *           unit: { x: 'years', size: 'issues' } },
 *   ord: 46,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'bubble' : id);
  const R = readData(data);
  const frame = makeFrame(R);

  let sizeMax = 0;
  for (const p of R.pts) if (p.size !== null && p.size > sizeMax) sizeMax = p.size;

  /* Largest first, then sampled every k-th through that order. The sort is the draw order and the
     sample rides on it, so the biggest bubble survives any cap and the sample spans the whole
     size range rather than the first however-many rows. */
  const sorted = R.pts.slice().sort((a, b) => (b.size === null ? -1 : b.size) - (a.size === null ? -1 : a.size));
  const step = sorted.length > DOT_CAP ? Math.ceil(sorted.length / DOT_CAP) : 1;
  const kept = [];
  for (let i = 0; i < sorted.length; i += step) kept.push(sorted[i]);

  const pts = kept.map((p) => [
    n1(frame.sx(p.x), 'px'), n1(frame.sy(p.y), 'py'),
    p.size === null ? 0 : p.size,
    /* A point with no group indexes one past the last group, where the neutral accent lives, so a
       chart that mixes grouped and ungrouped points cannot silently paint the ungrouped ones in
       the first group's colour. With no groups at all that index is zero and the array holds
       exactly the neutral. */
    p.group === null ? R.groups.length : R.groups.indexOf(p.group),
    p.kind,
  ]);

  const lab = kept.map((p) => clip(p.label, 90));
  const tip = kept.map((p) =>
    (p.label ? p.label + ' \u00b7 ' : '') +
    (p.group ? p.group + ' \u00b7 ' : '') +
    CK.fmt(p.x) + (R.unit.x ? ' ' + R.unit.x : '') + ', ' +
    CK.fmt(p.y) + (R.unit.y ? ' ' + R.unit.y : '') +
    (p.kind === 2 ? ' \u00b7 size refused'
                  : ' \u00b7 size ' + CK.fmt(p.size) + (R.unit.size ? ' ' + R.unit.size : '')));

  /* Legend values are round numbers from the same tick chooser the axes use, so the size key
     reads like the axes rather than like three arbitrary samples of the data. */
  let legend = [];
  if (sizeMax > 0) {
    const cands = CK.ticks(0, sizeMax, 5).filter((t) => t > 0 && t <= sizeMax);
    legend = cands.slice(-3).sort((a, b) => b - a);
    /* A nested legend with one circle in it is not a nested legend, and a size scale a reader
       cannot interpolate along is a size scale they will not trust. When the tick chooser has
       only one round number to offer, the fallback is the maximum and the quarters of it --
       which are exactly a half and a quarter of the largest RADIUS, so the nesting reads. */
    if (legend.length < 2) {
      legend = [sizeMax, sizeMax / 4, sizeMax / 16].filter((v) => v > 0);
    }
  }
  const legendLab = legend.map((v) => CK.fmt(v) + (R.unit.size ? ' ' + R.unit.size : ''));

  const zeroLine = R.bad.zeroSize
    ? plural(R.bad.zeroSize, 'point has', 'points have') + ' a size of exactly zero, drawn at the ' +
      'floor radius because zero has no area and would otherwise be invisible -- those are the ' +
      'only marks on the card whose size does not encode their value. '
    : '';
  const unsizedLine = R.bad.noSize + R.bad.badSize + R.bad.negSize
    ? plural(R.bad.noSize + R.bad.badSize + R.bad.negSize, 'point is', 'points are') +
      ' drawn as a dashed hollow ring: the position is a measurement and the size was not. '
    : '';
  const sampleLine = step > 1
    ? 'every ' + step + 'th mark is drawn through the size order -- ' + kept.length + ' of ' +
      R.pts.length + ' -- so the largest is always kept and the sample spans the whole range. '
    : '';
  const flatLine = !(sizeMax > 0) && R.pts.length
    ? 'no point has a positive size, so every mark is the same and this is a scatter with a ' +
      'third column that says nothing. '
    : '';

  const census = zeroLine + unsizedLine + sampleLine + flatLine;

  const axisAria =
    ' The horizontal axis runs from ' + CK.fmt(frame.ax.lo) + ' to ' + CK.fmt(frame.ax.hi) +
    (R.unit.x ? ' ' + R.unit.x : '') + ' and the vertical from ' + CK.fmt(frame.ay.lo) +
    ' to ' + CK.fmt(frame.ay.hi) + (R.unit.y ? ' ' + R.unit.y : '') +
    (sizeMax > 0 ? '. The largest size is ' + CK.fmt(sizeMax) + '.' : '.');

  const model = {
    plot: { x0: n(frame.plot.x0, 'plot'), y0: n(frame.plot.y0, 'plot'),
            x1: n(frame.plot.x1, 'plot'), y1: n(frame.plot.y1, 'plot') },
    pts, lab, tip,
    count: R.pts.length,
    sizeMax,
    minR: MIN_R,
    maxRMin: MAXR_MIN, maxRMax: MAXR_MAX, maxRDef: MAXR_DEF,
    opMin: OP_MIN, opMax: OP_MAX, opDef: OP_DEF,
    labelModes: LABEL_MODES.slice(),
    labelDef: defaults.labels,
    hue: R.groups.map((_, i) => CK.hue(i)).concat(['var(--accent)']),
    legend, legendLab,
    tipOn: kept.length <= TIP_CAP ? 1 : 0,
    frame: frame.marks,
    census,
    axisAria,
    emptyNote: 'no usable points, so there is nothing to draw; the axes are drawn so the card ' +
               'keeps its place.',
    emptyAria: 'An empty bubble chart: no usable points were given.',
  };

  const inst = { ...defaults };

  /* The browser half is exercised here over the corners of the setting space, so a degenerate
     input that would produce a NaN coordinate is caught at build time next to the data that
     caused it rather than at paint time, where the browser drops the attribute in silence. */
  let active = null;
  for (const maxSize of [MAXR_MIN, MAXR_DEF, MAXR_MAX]) {
    for (const labels of LABEL_MODES) {
      for (const opacity of [OP_MIN, OP_DEF, OP_MAX]) {
        const got = bubbleGeom(model, { maxSize, labels, opacity });
        assertFinite(got.marks, 'maxSize ' + maxSize + '/' + labels);
        assertClean(got.note, 'note at maxSize ' + maxSize);
        assertClean(got.aria, 'aria at maxSize ' + maxSize);
        if (maxSize === inst.maxSize && labels === inst.labels && opacity === inst.opacity) {
          active = got;
        }
      }
    }
  }
  if (!active) active = bubbleGeom(model, inst);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'bubble',
      points: R.pts.length,
      pointsDrawn: kept.length,
      sampleStep: step,
      sizeMax,
      legendValues: legend,
      groups: R.groups,
      encoding: 'area',
      xDomain: [frame.ax.lo, frame.ax.hi],
      yDomain: [frame.ay.lo, frame.ay.hi],
      refused: { badPositions: R.bad.badXY, negativeSizes: R.bad.negSize,
                 nonNumericSizes: R.bad.badSize, absentSizes: R.bad.noSize,
                 zeroSizes: R.bad.zeroSize, notObjects: R.bad.notObject },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active, R.pts.length > 0),
    css: cardCss(cardId),
    js: cardJs(cardId, model, inst),
  };
}

/* Exported for the verifier only: the area rule and the geometry the browser runs, so a test can
   prove that quadrupling a value doubles a radius rather than quadrupling it. */
export { radiusFor, placeLabel, bubbleGeom, readData, axisOf, makeFrame };
