/**
 * `hexbin` -- a dense scatter binned onto a hexagonal lattice and shaded by count.
 *
 * The reason to draw one is that a scatter plot stops answering its own question as soon as the
 * dots start landing on each other. Ten thousand points at 3px each cover the plot; the picture
 * that comes back is the SHAPE of the cloud and nothing about where inside it the mass is. Every
 * usual repair is a compromise: transparency saturates and then lies in exactly the region you
 * care about most, jitter invents positions, sampling throws away the thing being measured. A
 * binned count is none of those. It is an exact tally over a partition of the plane, every point
 * is in exactly one cell, and the counts sum to n -- so an overplotted scatter shows density
 * nowhere and this shows it everywhere.
 *
 * Three decisions worth reading:
 *
 *   1. **The lattice is pointy-top, and the assignment is cube rounding.** Both are explained
 *      where they happen -- see {@link hexAxial}. The short version: the naive "round the two
 *      lattice coordinates independently" is WRONG, visibly and systematically, because the two
 *      axial axes are sixty degrees apart rather than orthogonal, and independent rounding
 *      assigns a band of points near every hex boundary to a neighbour. It does not look like
 *      noise. It looks like a faint grid of over- and under-full cells, which a reader will read
 *      as structure in the data.
 *   2. **Hexagons rather than squares.** A hexagon has six equidistant neighbours where a square
 *      has four edge-neighbours and four diagonal ones at a different distance, so a square grid
 *      carries a direction the data does not have. A hexagon is also the closest a tiling gets to
 *      a circle, so a hex cell's count is closer to "points within a radius" than a square's is.
 *   3. **Count becomes opacity of ONE hue, never a rainbow.** Hue is not ordered -- there is no
 *      fact about coral and teal that makes one of them larger -- so a reader asked to rank a
 *      rainbow has to consult the legend for every single cell, and the picture has stopped
 *      being a picture. Lightness is ordered pre-attentively. One hue, nine strengths.
 *
 * @see ./contour.mjs -- the same cloud as a smooth density rather than a tally
 * @see ./splom.mjs -- the pairs of a whole table, when the question is which pair to look at
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. A bare context carrying a `window` object is enough to run it, because nothing at its
 * top level reaches for the DOM.
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
  catch (e) { throw new Error('cardkit/hexbin: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/hexbin: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* -- constants ------------------------------------------------------------------------- */

/** The drawing box. The SVG scales to the column; these are its internal units. */
const W0 = 620;
const H0 = 356;

/** Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/** Hex radius, centre to vertex, in the drawing's units. Below the floor a hex is a speck. */
const R_MIN = 3;
const R_MAX = 40;
const R_DEF = 8;

/** How many density classes the ramp may have. Past nine a reader stops distinguishing steps. */
const BINS_MIN = 2;
const BINS_MAX = 9;
const BINS_DEF = 6;

/**
 * Nine opacity steps of ONE hue, which is what a sequential ramp is.
 *
 * Not a rainbow, and the reason is not taste. Hue is unordered; lightness is ordered without a
 * legend. The faintest step is deliberately not near-invisible: an occupied hex must be legible
 * as occupied, because "one point here" and "no points here" are different findings.
 */
const OPACITIES = [0.14, 0.24, 0.34, 0.44, 0.54, 0.64, 0.74, 0.84, 0.94];

/**
 * The most point positions that are shipped to the browser.
 *
 * The binning itself is O(n) and the browser would not notice ten thousand points; what it would
 * notice is the payload, because the lattice changes with a viewer setting and so the positions
 * have to travel. Past the cap the rows are sampled systematically -- every k-th -- rather than
 * randomly, so two builds of the same data give the same picture, and the caption says so.
 */
const POINT_CAP = 20000;

/** Past this many hexes a per-hex tooltip stops being worth its own DOM node. */
const TIP_CAP = 1200;

/* -- small shared arithmetic ------------------------------------------------------------ */

/**
 * Round to two decimals, refusing to emit a number that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console. Failing here puts a stack trace next to the input instead.
 *
 * @throws {Error} when `v` is NaN or infinite
 * @example n(1.005, 'x');   // 1
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/hexbin: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to one decimal -- the resolution point positions travel at, finer than any pixel. */
function n1(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/hexbin: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 10) / 10;
}

/** Width in px of a string set in the card's 9px mono face. */
function textW(s) { return String(s).length * CHW; }

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * A number, or null when the value is not one.
 *
 * Booleans and blank strings are refused rather than coerced: `Number(true)` is 1 and
 * `Number('')` is 0, and both of those are a measurement invented out of a value that was not one.
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
 * of them. The question mark goes too, so a label reading "why.this" with a question mark in the
 * middle cannot look like optional chaining to a guard that scans raw text.
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

/** The card's id reduced to something legal and unique as an XML id. */
function domId(id) { return 'ckhx-' + String(id).replace(/[^A-Za-z0-9_-]/g, '-'); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-hexbin[data-card="' + cssId(id) + '"]';
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
 * `Function.prototype.toString()`, which carries their comments along, and a backtick inside one
 * closes the surrounding literal early. The character is never written in this file; it is
 * reached for as `String.fromCharCode(96)`.
 *
 * Two scans, deliberately different. Backtick, arrow and optional chain are hunted in the RAW
 * text, where none of them can appear innocently. `const`, `let` and `class` are hunted only
 * OUTSIDE comments and strings, because all three are ordinary English words and a guard that
 * fires on prose is a guard somebody deletes.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming every token it found and where each one is
 *
 * @example guardEmitted('var a = 1;', 'demo');       // 'var a = 1;'
 * @example guardEmitted('let a = 1;', 'demo');       // throws: the keyword let at line 1
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
    throw new Error('cardkit/hexbin: refusing to emit ' + where + ' -- ' + bad.join('; '));
  }
  return js;
}

/**
 * Walk a display list and refuse any coordinate that is not a finite number.
 *
 * The browser half computes geometry, so the usual build-time coordinate check cannot reach it.
 * Running the same function here over every configuration a viewer can select puts the check back.
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
          throw new Error('cardkit/hexbin: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/hexbin: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.s != null && /NaN|Infinity/.test(String(m.s))) {
      throw new Error('cardkit/hexbin: text reads "' + m.s + '" in ' + where);
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/** Refuse prose that carries a non-number into the page, where it reads as a measurement. */
function assertClean(text, where) {
  if (/NaN|Infinity/.test(String(text))) {
    throw new Error('cardkit/hexbin: ' + where + ' reads "' + text + '"');
  }
  return text;
}

/* -- reading the data ------------------------------------------------------------------- */

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it rather than two sources that can disagree.
 *
 * @example defaults.radius;   // 8
 */
export const defaults = { radius: R_DEF, bins: BINS_DEF, outline: false };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.category;   // 'correlation-and-multivariate'
 */
export const meta = {
  name: 'hexbin',
  summary:
    'A dense scatter binned onto a hexagonal lattice and shaded by count, so an overplotted ' +
    'cloud shows where its mass actually is.',
  shape:
    '{ points: [{ x, y }], radius, unit, xLabel, yLabel } -- ' +
    'x and y must both be numbers or the point is refused and counted; radius seeds the hex ' +
    'radius in drawing units and the viewer can change it; unit is a string for both axes or ' +
    '{ x, y } for one each, and is shown in the axis captions and the tooltips',
  category: 'correlation-and-multivariate',
  defaults: { ...defaults },
};

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

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * A point with a non-numeric coordinate is refused rather than repaired. There is no honest
 * repair: dropping it to zero puts a measurement on the plot that nobody made, and dropping it to
 * the mean puts one there that is worse because it looks plausible. The count of refusals is
 * reported and up to three of the offending values are quoted, because "14 points were refused"
 * sends a reader looking through their data and "14 points were refused, the first was
 * x: 'n/a'" sends them straight to the column.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ pts, unit, xLabel, yLabel, bad, names, radius }`
 *
 * @example readData({ points: [{ x: 1, y: 2 }] }).pts.length;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const src = Array.isArray(d.points) ? d.points : [];
  const bad = { notObject: 0, badX: 0, badY: 0 };
  const names = [];
  const pts = [];

  for (const p of src) {
    if (!p || typeof p !== 'object') { bad.notObject++; continue; }
    const x = numOf(p.x);
    const y = numOf(p.y);
    if (x === null || y === null) {
      if (x === null) bad.badX++;
      if (y === null) bad.badY++;
      if (names.length < 3) {
        names.push((x === null ? 'x: ' : 'y: ') + shortLit(x === null ? p.x : p.y));
      }
      continue;
    }
    pts.push({ x, y });
  }

  const askedR = numOf(d.radius);
  const radius = askedR === null ? R_DEF
    : Math.max(R_MIN, Math.min(R_MAX, Math.round(askedR)));

  return {
    pts, bad, names, radius,
    badRadius: d.radius != null && askedR === null,
    unit: readUnit(d),
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    yLabel: d.yLabel == null ? '' : String(d.yLabel),
  };
}

/** A refused value, quoted short enough to sit in a caption. */
function shortLit(v) {
  if (v === undefined) return 'absent';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? '"' + v + '"' : String(v);
  return s.length > 18 ? s.slice(0, 17) + '\u2026' : s;
}

/**
 * One axis: a padded domain snapped outward to whole ticks, with those ticks.
 *
 * Snapping matters for a reason that is easy to miss. `CK.ticks` only returns ticks INSIDE the
 * domain it is given, so a raw data domain leaves a ragged strip above the last gridline and the
 * top of the plot has no rule on it. Snapping the ends to the step the ticks already chose closes
 * that, and the ticks are then stepped out rather than re-derived -- asking `CK.ticks` again with
 * the wider range can push it to the next nice step and halve the number of gridlines.
 *
 * A collapsed domain -- every value identical, or a single point -- is widened by half its own
 * magnitude, or by one when the magnitude is zero, so a lattice has somewhere to be drawn.
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
    const e = (b - a) * 0.04;
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
 * Everything here is independent of the viewer's settings, so it is computed once in Node and
 * emitted as a display list the browser simply prepends. Only the hexes are recomputed when the
 * radius changes.
 *
 * @param R the output of {@link readData}
 * @param legendH how much room to keep under the plot for the density ramp
 * @returns `{ plot, sx, sy, marks, W, H }`
 *
 * @example makeFrame(readData({ points: [{ x: 0, y: 0 }] }), 26).plot.x0;   // 30
 */
function makeFrame(R, legendH) {
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
  const padB = 20 + (xcap ? 12 : 0) + legendH;

  const W = W0;
  const H = H0;
  const plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

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

  /* Two baselines and no box. A full frame reads as a container; two rules read as axes. */
  marks.push({ t: 'line', a: { x1: n(plot.x0, 'ax'), y1: n(plot.y0, 'ax'),
                               x2: n(plot.x0, 'ax'), y2: n(plot.y1, 'ax'), "class": 'ck-axis' } });
  marks.push({ t: 'line', a: { x1: n(plot.x0, 'ax'), y1: n(plot.y1, 'ax'),
                               x2: n(plot.x1, 'ax'), y2: n(plot.y1, 'ax'), "class": 'ck-axis' } });

  if (xcap) {
    marks.push({ t: 'text', a: { x: n((plot.x0 + plot.x1) / 2, 'cap'),
                                 y: n(plot.y1 + 25, 'cap'), "class": 'ck-cap-ax',
                                 'text-anchor': 'middle' }, s: xcap });
  }
  if (ycap) {
    const cx = 10;
    const cy = (plot.y0 + plot.y1) / 2;
    marks.push({ t: 'text', a: { x: n(cx, 'cap'), y: n(cy, 'cap'), "class": 'ck-cap-ax',
                                 'text-anchor': 'middle',
                                 transform: 'rotate(-90 ' + n(cx, 'cap') + ' ' + n(cy, 'cap') + ')' },
                 s: ycap });
  }

  return { plot, sx, sy, marks, W, H, ax, ay };
}

/* -- the hex lattice: emitted to the browser, tested here ------------------------------- */

/**
 * The axial coordinates of the hexagon containing a point, by cube rounding.
 *
 * This is the one piece of arithmetic in the card that is easy to get wrong in a way that looks
 * like a finding, so it is worth being explicit about what breaks.
 *
 * A pointy-top hex lattice has two axes sixty degrees apart, not ninety. Converting a pixel to
 * fractional axial coordinates is exact; the question is which integer lattice site that fraction
 * belongs to. The naive answer -- round q and round r independently -- is what a reader expects
 * to be right and is not. Independent rounding is nearest-site in a SHEARED metric, so it claims a
 * triangular sliver on each of a hexagon's six edges for the wrong neighbour. It is not noise: the
 * error is the same shape in every cell, so the picture grows a regular pattern of alternately
 * over- and under-full hexes. That is a lattice artefact, and a reader will read it as structure
 * in the data, which is the worst failure a density plot has available to it.
 *
 * Cube coordinates make the fix trivial to state. Map axial to three cube coordinates that must
 * sum to zero. Round all three. If they no longer sum to zero, exactly one of them was rounded the
 * wrong way -- and it is the one whose rounding moved it furthest, because the constraint plane is
 * what the rounding violated. Reset that one from the other two. The result is provably the
 * nearest hex centre in the real Euclidean metric, so every point lands in exactly one hex and the
 * counts sum to n.
 *
 * Pointy-top rather than flat-top, for two reasons that both point the same way. The lattice rows
 * of a pointy-top tiling are horizontal, so a horizontal slice of the plot -- "what is the density
 * at this value of y" -- is one row of hexes rather than a zigzag of two. And a pointy-top hex is
 * wider than it is tall (width is the root of three times the radius, height is twice it), which
 * suits a plot that is wider than it is tall: the cells stay closer to square on screen.
 *
 * @param px  x in drawing units, relative to the lattice origin
 * @param py  y in drawing units, relative to the lattice origin
 * @param rad the hex radius, centre to vertex
 * @param out a two-element array that receives q and r, so the hot loop allocates nothing
 *
 * @example var a = [0, 0]; hexAxial(0, 0, 8, a); a;   // [0, 0]
 */
function hexAxial(px, py, rad, out) {
  var s3 = Math.sqrt(3);
  var q = (s3 / 3 * px - py / 3) / rad;
  var r = (2 / 3 * py) / rad;

  var cx = q;
  var cz = r;
  var cy = -cx - cz;

  var rx = Math.round(cx);
  var ry = Math.round(cy);
  var rz = Math.round(cz);

  var dx = Math.abs(rx - cx);
  var dy = Math.abs(ry - cy);
  var dz = Math.abs(rz - cz);

  /* One of the three was rounded across the constraint plane. It is the one that moved
     furthest, and it is recovered from the other two rather than nudged. */
  if (dx > dy && dx > dz) { rx = -ry - rz; }
  else if (dy > dz) { ry = -rx - rz; }
  else { rz = -rx - ry; }

  out[0] = rx;
  out[1] = rz;
}

/**
 * The centre of a hexagon in drawing units, relative to the lattice origin.
 *
 * The exact inverse of the fractional half of {@link hexAxial}, which is what makes the pair
 * checkable: the centre of the hex a point lands in must be within one radius of that point.
 *
 * @param q   the axial column
 * @param r   the axial row
 * @param rad the hex radius, centre to vertex
 * @param out a two-element array that receives x and y
 *
 * @example var c = [0, 0]; hexCentre(0, 1, 8, c); Math.round(c[1]);   // 12
 */
function hexCentre(q, r, rad, out) {
  var s3 = Math.sqrt(3);
  out[0] = rad * (s3 * q + s3 / 2 * r);
  out[1] = rad * (1.5 * r);
}

/**
 * The whole binned picture as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so the
 * function a test calls in Node is textually the function the page runs. The binning happens here
 * rather than in Node because the hex radius is a viewer setting and the lattice changes with it.
 *
 * Classes are equal intervals of the SQUARE ROOT of the count. A linear ladder is wrong for a
 * two-dimensional density in a specific way: counts in a peaked cloud are heavily skewed, so nine
 * tenths of the occupied hexes land in the faintest class and the ramp shows one peak against a
 * uniform wash. The square root is the natural transform for a count over an area, and it spreads
 * the classes over the part of the range that has hexes in it.
 *
 * @param model the precomputed model: point positions, plot rectangle, ramp limits
 * @param cfg   `{ radius, bins, outline }`
 * @returns `{ marks, note, aria, hexes, filled, top }`
 *
 * @example hexbinGeom(model, { radius: 8, bins: 6, outline: false }).hexes;   // 96
 */
function hexbinGeom(model, cfg) {
  var i, j, k;
  var plot = model.plot;

  var rad = Math.round(Number(cfg.radius));
  if (!isFinite(rad)) { rad = model.rDef; }
  if (rad < model.rMin) { rad = model.rMin; }
  if (rad > model.rMax) { rad = model.rMax; }

  var bins = Math.round(Number(cfg.bins));
  if (!isFinite(bins)) { bins = model.binsDef; }
  if (bins < model.binsMin) { bins = model.binsMin; }
  if (bins > model.binsMax) { bins = model.binsMax; }

  var outline = cfg.outline === true || cfg.outline === 'true';
  var pts = model.pts;
  var count = pts.length / 2;

  function r2(v) { return Math.round(v * 100) / 100; }

  /* One pass, one hash lookup per point. Keys are two integers joined by a colon, which cannot
     collide with anything on Object.prototype, and every read is guarded anyway. */
  var bag = {};
  var keys = [];
  var ax = [0, 0];
  var key;
  for (i = 0; i < count; i++) {
    hexAxial(pts[i * 2] - plot.x0, pts[i * 2 + 1] - plot.y0, rad, ax);
    key = ax[0] + ':' + ax[1];
    if (Object.hasOwn(bag, key)) { bag[key].c++; }
    else { bag[key] = { q: ax[0], r: ax[1], c: 1 }; keys.push(key); }
  }

  var top = 0;
  var sum = 0;
  for (i = 0; i < keys.length; i++) {
    if (bag[keys[i]].c > top) { top = bag[keys[i]].c; }
    sum += bag[keys[i]].c;
  }

  var marks = [];
  var clip = model.clipId;

  if (keys.length) {
    var vx = [];
    var vy = [];
    for (k = 0; k < 6; k++) {
      var ang = Math.PI / 180 * (60 * k - 30);
      vx.push(rad * Math.cos(ang));
      vy.push(rad * Math.sin(ang));
    }

    /* The lattice is anchored at the plot's own origin, so a hex holding a point at the very edge
       of the plot may hang over the axis by up to one radius. The overhang is clipped and the
       COUNT is untouched -- trimming the tally to fit the frame would be the one thing a binned
       plot must never do. */
    marks.push({ t: 'defs', kids: [ { t: 'clipPath', a: { id: clip }, kids: [
      { t: 'rect', a: { x: r2(plot.x0), y: r2(plot.y0),
                        width: r2(plot.x1 - plot.x0), height: r2(plot.y1 - plot.y0) } } ] } ] });

    var kids = [];
    var span = Math.sqrt(top) - 1;
    var c = [0, 0];
    for (i = 0; i < keys.length; i++) {
      var h = bag[keys[i]];
      hexCentre(h.q, h.r, rad, c);
      var hx = c[0] + plot.x0;
      var hy = c[1] + plot.y0;

      var step;
      if (!(span > 0)) { step = bins - 1; }
      else {
        step = Math.floor((Math.sqrt(h.c) - 1) / span * bins);
        if (step > bins - 1) { step = bins - 1; }
        if (step < 0) { step = 0; }
      }
      var op = model.opacity[Math.round(step * (model.opacity.length - 1) / Math.max(1, bins - 1))];

      var d = '';
      for (k = 0; k < 6; k++) {
        d += (k ? 'L' : 'M') + r2(hx + vx[k]) + ',' + r2(hy + vy[k]);
      }
      d += 'Z';

      var mark = { t: 'path', a: { d: d, "class": outline ? 'hx hxo' : 'hx',
                                   'fill-opacity': op } };
      if (model.tipOn) {
        mark.ti = plural(h.c, 'point', 'points') + ' in this hex';
      }
      kids.push(mark);
    }
    marks.push({ t: 'g', a: { 'clip-path': 'url(#' + clip + ')' }, kids: kids });

    /* The ramp lives inside the drawing rather than beside it, because it has to change when the
       radius changes and a legend that lags the picture is worse than no legend. */
    var lw = Math.min(190, Math.max(90, bins * 22));
    var lx = plot.x1 - lw;
    var ly = model.H - 12;
    var sw = lw / bins;
    for (j = 0; j < bins; j++) {
      var lop = model.opacity[Math.round(j * (model.opacity.length - 1) / Math.max(1, bins - 1))];
      marks.push({ t: 'rect', a: { x: r2(lx + j * sw), y: r2(ly - 8), width: r2(sw - 1), height: 8,
                                   "class": 'hx', 'fill-opacity': lop } });
    }
    var loN = 1;
    var hiN = top;
    marks.push({ t: 'text', a: { x: r2(lx - 5), y: r2(ly - 1), "class": 'ck-tk',
                                 'text-anchor': 'end' }, s: 'points per hex' });
    marks.push({ t: 'text', a: { x: r2(lx), y: r2(ly + 8), "class": 'ck-tk',
                                 'text-anchor': 'start' }, s: String(loN) });
    marks.push({ t: 'text', a: { x: r2(lx + lw), y: r2(ly + 8), "class": 'ck-tk',
                                 'text-anchor': 'end' }, s: String(hiN) });
  }

  var note;
  var aria;
  if (!count) {
    note = model.emptyNote;
    aria = model.emptyAria;
  } else {
    var shared = plural(count, 'point', 'points') + ' fell into ' +
      plural(keys.length, 'hexagon', 'hexagons') + ' of radius ' + rad +
      '; the fullest holds ' + top + '. ' +
      (top === 1
        ? 'no hexagon holds more than one point, so the lattice is finer than the data and every cell is its own point. '
        : 'classes are equal intervals of the square root of the count, because a linear ladder puts a peaked density into one class. ') +
      model.sampleNote;
    note = shared + 'an overplotted scatter shows density nowhere; this shows it everywhere.';
    aria = 'Hexagonal binning of ' + shared + ' Darker hexagons hold more points. ' + model.axisAria;
  }

  return { marks: marks, note: note, aria: aria, hexes: keys.length, filled: sum, top: top,
           radius: rad, bins: bins };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every hexagon on the second pass.
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
 * Nothing here names a colour; every value is a desk token, so the light switch is the only thing
 * that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 *
 * The hexagons carry ONE fill and vary only in `fill-opacity`, which is the whole sequential-ramp
 * argument expressed as CSS: there is exactly one place a hue is named, so a rainbow cannot creep
 * in later by accident.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['svg.ck-hx', 'display: block; width: 100%; height: auto;'],
    ['.ck-hx text', 'font-family: var(--mono); font-size: 9px;'],
    ['.ck-hx .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-hx .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],

    ['.ck-hx .hx', 'fill: var(--ck-s6); stroke: none;'],
    ['.ck-hx .hxo', 'stroke: var(--ground); stroke-width: 0.6;'],

    ['.ck-hx-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="number"]', 'width: 6.5em;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scope(id, rules) + '\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the plot and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The part that changes with the settings is an
 * empty element the script fills with `textContent`, never with markup.
 */
function cardHtml(id, title, R, said, hasPts) {
  const e = CK.esc;

  const void_ = hasPts ? '' :
    '  <div class="ck-hx-void">nothing to bin &mdash; no usable points were given</div>\n';

  const svg = hasPts
    ? '  <svg class="ck-plot ck-hx" role="img" viewBox="0 0 ' + W0 + ' ' + H0 +
      '" aria-label="' + e(said.aria) + '"></svg>\n'
    : '';

  return '<section data-card="' + e(id) + '" class="ck-hexbin">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-radius">hex radius</label>\n' +
    '    <input type="number" id="' + e(id) + '-radius" name="radius" min="' + R_MIN +
    '" max="' + R_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-bins">density steps</label>\n' +
    '    <input type="number" id="' + e(id) + '-bins" name="bins" min="' + BINS_MIN +
    '" max="' + BINS_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-outline">outline the cells</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-outline" name="outline">\n' +
    '    <div class="ck-set-foot">a smaller radius is a finer lattice and a noisier count; a ' +
    'larger one is a smoother picture of fewer, bigger cells. the steps are one hue at ordered ' +
    'strengths, never a rainbow, because hue has no order for a reader to read.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(R.pts.length)) + '</b> ' +
    (R.pts.length === 1 ? 'point' : 'points') + '. <i class="ck-hx-note">' + e(said.note) +
    '</i>' + refusalHtml(R) + '</div>\n' +
    '</section>\n';
}

/** The refusals, said in the caption, because a silently dropped point is a silently wrong plot. */
function refusalHtml(R) {
  const e = CK.esc;
  const bits = [];
  if (R.bad.badX) bits.push(plural(R.bad.badX, 'point', 'points') + ' had no numeric x');
  if (R.bad.badY) bits.push(plural(R.bad.badY, 'point', 'points') + ' had no numeric y');
  if (R.bad.notObject) bits.push(plural(R.bad.notObject, 'entry was', 'entries were') + ' not an object');
  if (R.badRadius) bits.push('the given radius was not a number and the default stands');
  if (!bits.length) return '';
  const named = R.names.length ? ' (' + R.names.join(', ') + ')' : '';
  return ' <span class="ck-aside">' + e(bits.join('; ') + named + '; refused, not repaired.') +
         '</span>';
}

/**
 * The browser half: read the settings, bin, paint, and say what came out.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated inside the geometry function
 * on every draw, because they come out of `localStorage`, which is a text file the viewer can
 * edit, and a radius of "0" or of the word "big" must land on something drawable rather than on
 * a division by zero.
 */
function cardJs(id, model, inst) {
  const js =
    '/* hexbin card: point positions, the plot frame and the axes were computed in Node;\n' +
    '   the binning happens here, because the lattice changes with the viewer radius. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    hexAxial.toString() + '\n\n' +
    hexCentre.toString() + '\n\n' +
    'function plural(count, one, many) { return count + " " + (count === 1 ? one : many); }\n\n' +
    hexbinGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-hx");\n' +
    '  var note = sec.querySelector(".ck-hx-note");\n\n' +
    '  function draw(cfg) {\n' +
    '    var got = hexbinGeom(MODEL, cfg);\n' +
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
 * Build one hexbin card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the point census and the axis domains, so
 *          a reader can check the caption without re-deriving anything
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted, quoted and named in the caption.
 *
 * @example
 * build({
 *   id: 'latency',
 *   title: 'request latency against payload size',
 *   data: { points: [{ x: 12, y: 91 }, { x: 14, y: 88 }], unit: { x: 'kB', y: 'ms' } },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'hexbin' : id);
  const R = readData(data);

  /* Systematic sampling, never random: two builds of the same data must give the same picture,
     or a reader comparing them is comparing the sampler. */
  const step = R.pts.length > POINT_CAP ? Math.ceil(R.pts.length / POINT_CAP) : 1;
  const kept = [];
  for (let i = 0; i < R.pts.length; i += step) kept.push(R.pts[i]);

  const frame = makeFrame(R, 26);

  const flatX = R.pts.length > 1 && R.pts.every((p) => p.x === R.pts[0].x);
  const flatY = R.pts.length > 1 && R.pts.every((p) => p.y === R.pts[0].y);

  const pts = [];
  for (const p of kept) {
    pts.push(n1(frame.sx(p.x), 'px'), n1(frame.sy(p.y), 'py'));
  }

  const sampleNote = step > 1
    ? 'every ' + step + 'th point is shipped to the browser -- ' + kept.length + ' of ' +
      R.pts.length + ' -- because the lattice changes with the radius setting and the positions ' +
      'have to travel; the sampling is systematic, so the picture is the same on every build. '
    : (flatX && flatY
        ? 'every point has the same x and the same y, so they all land in one hexagon and the ' +
          'axes are padded around a single value. '
        : flatX ? 'every point has the same x, so the lattice is one column wide. '
        : flatY ? 'every point has the same y, so the lattice is one row tall. '
        : '');

  const axisAria =
    'The horizontal axis runs from ' + CK.fmt(frame.ax.lo) + ' to ' + CK.fmt(frame.ax.hi) +
    (R.unit.x ? ' ' + R.unit.x : '') + ' and the vertical from ' + CK.fmt(frame.ay.lo) +
    ' to ' + CK.fmt(frame.ay.hi) + (R.unit.y ? ' ' + R.unit.y : '') + '.';

  const model = {
    plot: { x0: n(frame.plot.x0, 'plot'), y0: n(frame.plot.y0, 'plot'),
            x1: n(frame.plot.x1, 'plot'), y1: n(frame.plot.y1, 'plot') },
    H: H0,
    pts,
    opacity: OPACITIES.slice(),
    rMin: R_MIN, rMax: R_MAX, rDef: R_DEF,
    binsMin: BINS_MIN, binsMax: BINS_MAX, binsDef: BINS_DEF,
    clipId: domId(cardId),
    tipOn: 1,
    frame: frame.marks,
    sampleNote,
    axisAria,
    emptyNote: 'no usable points, so there is nothing to bin; the axes are drawn so the card ' +
               'keeps its place.',
    emptyAria: 'An empty hexagonal binning: no usable points were given, so the lattice has ' +
               'nothing in it.',
  };

  const inst = { radius: R.radius, bins: defaults.bins, outline: defaults.outline };

  /* The browser half is exercised here over the corners of the setting space, so a degenerate
     input that would produce a NaN coordinate is caught at build time next to the data that
     caused it rather than at paint time, where the browser drops the attribute in silence. */
  let active = null;
  for (const rad of [R_MIN, inst.radius, R_DEF, R_MAX]) {
    for (const bins of [BINS_MIN, BINS_DEF, BINS_MAX]) {
      for (const outline of [false, true]) {
        const got = hexbinGeom(model, { radius: rad, bins, outline });
        assertFinite(got.marks, 'radius ' + rad + '/bins ' + bins);
        assertClean(got.note, 'note at radius ' + rad);
        assertClean(got.aria, 'aria at radius ' + rad);
        if (rad === inst.radius && bins === defaults.bins && outline === defaults.outline) {
          active = got;
        }
      }
    }
  }
  if (!active) active = hexbinGeom(model, inst);

  /* Tooltips are decided after the first real binning: at the default radius a dense cloud can
     fill more cells than a tooltip per cell is worth as DOM. */
  model.tipOn = active.hexes <= TIP_CAP ? 1 : 0;

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'hexbin',
      points: R.pts.length,
      pointsShipped: kept.length,
      sampleStep: step,
      radius: R.radius,
      hexes: active.hexes,
      binnedPoints: active.filled,
      fullestHex: active.top,
      xDomain: [frame.ax.lo, frame.ax.hi],
      yDomain: [frame.ay.lo, frame.ay.hi],
      refused: { nonNumericX: R.bad.badX, nonNumericY: R.bad.badY, notObjects: R.bad.notObject },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active, R.pts.length > 0),
    css: cardCss(cardId),
    js: cardJs(cardId, model, inst),
  };
}

/* Exported for the verifier only: the lattice arithmetic and the geometry the browser runs, so a
   test can check that a point lands in the hex nearest it using the same text the page gets. */
export { hexAxial, hexCentre, hexbinGeom, readData, axisOf, makeFrame };
