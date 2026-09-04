/**
 * `contour` -- a two-dimensional kernel density over a scatter, drawn as isolines.
 *
 * A hexbin tells you how many points are in a cell. A contour tells you where the level sets of
 * the underlying density are, which is a different and sometimes better question: it has no cell
 * boundaries to invent structure at, it interpolates across the gaps a sparse sample leaves, and
 * two modes separated by a saddle are visible as two closed rings rather than as two clumps of
 * darker cells. The price is that everything you see is a function of the bandwidth, which is a
 * choice and not a measurement -- so the bandwidth is a setting the viewer can move, and the
 * caption says what it is.
 *
 * Three decisions worth reading:
 *
 *   1. **The density is a binned grid convolved with a separable Gaussian, not a sum over points
 *      at every grid node.** The naive form is O(grid times n) and gets slow exactly when the
 *      picture gets interesting. Binning first is O(n) once, and a Gaussian is separable, so the
 *      blur is two one-dimensional passes and its cost does not depend on n at all. Ten thousand
 *      points and ten cost the browser the same, which is why nothing is downsampled here.
 *   2. **The isolines are marching squares with the asymptotic decider on the two ambiguous
 *      cases.** Cases 5 and 10 have no single right answer from the four corner values alone, and
 *      the choice is not cosmetic -- it decides whether two peaks are drawn joined or separate,
 *      which is usually the whole finding. See {@link isoRings}.
 *   3. **The grid's outer ring is forced to zero, so every contour is a closed ring.** A density
 *      estimated from a finite window really does fall to zero outside that window, so this is a
 *      statement about the estimate rather than a trick to make the paths close. What it buys is
 *      that a filled band is a fill and not a guess about how to seal an open curve.
 *
 * @see ./hexbin.mjs -- the same cloud as an exact tally rather than a smooth estimate
 * @see ./heatmap.mjs -- a grid whose cells are given rather than derived
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
  catch (e) { throw new Error('cardkit/contour: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/contour: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* -- constants ------------------------------------------------------------------------- */

/** The drawing box. The SVG scales to the column; these are its internal units. */
const W0 = 620;
const H0 = 356;

/** Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/**
 * The spacing of the density grid, in drawing units.
 *
 * Five is a compromise with a floor under it: the grid has to be fine enough that an isoline
 * reads as a curve rather than as a staircase, and coarse enough that the whole array can travel
 * to the browser as a literal. At five the plot is roughly 115 by 55 nodes, which is six thousand
 * integers -- small enough to ship, fine enough that a contour's facets are under a pixel on a
 * normal display.
 */
const PITCH = 5;

/** Kernel bandwidth in drawing units, and the range the setting may reach. */
const BW_MIN = 4;
const BW_MAX = 80;
const BW_DEF = 18;

/** How many isolines. One is not a contour plot and past a dozen they stop being separable. */
const LEV_MIN = 2;
const LEV_MAX = 12;
const LEV_DEF = 6;

/**
 * Below this many points the contours are not drawn at all, and the caption says why.
 *
 * A kernel density of one point IS the kernel; of two points it is two kernels. The isolines that
 * come back are a picture of the bandwidth setting with the data's positions as their only input,
 * and a reader looking at two neat concentric blobs will read them as a finding. Drawing the
 * points and refusing the contours is the honest answer, and three is where a density starts to
 * be able to say something the points alone do not.
 */
const MIN_POINTS = 3;

/** Past this many points the raw dots stop being drawn over the contours, and are not shipped. */
const DOT_CAP = 400;

/**
 * The composite opacity each filled band is meant to reach, faintest to strongest.
 *
 * ONE hue at ordered strengths, never a rainbow. Hue is unordered -- there is no fact about coral
 * and teal that makes one of them larger -- so a reader asked to rank a rainbow consults the
 * legend for every band and the picture has stopped being a picture. Lightness is ordered
 * pre-attentively and needs no legend at all.
 */
const FILL_LO = 0.12;
const FILL_HI = 0.86;

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
    throw new Error('cardkit/contour: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to one decimal -- the resolution point positions travel at, finer than any pixel. */
function n1(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/contour: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
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
  const own = '.ck-contour[data-card="' + cssId(id) + '"]';
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
    throw new Error('cardkit/contour: refusing to emit ' + where + ' -- ' + bad.join('; '));
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
          throw new Error('cardkit/contour: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/contour: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.s != null && /NaN|Infinity/.test(String(m.s))) {
      throw new Error('cardkit/contour: text reads "' + m.s + '" in ' + where);
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/** Refuse prose that carries a non-number into the page, where it reads as a measurement. */
function assertClean(text, where) {
  if (/NaN|Infinity/.test(String(text))) {
    throw new Error('cardkit/contour: ' + where + ' reads "' + text + '"');
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
 * @example defaults.bandwidth;   // 18
 */
export const defaults = { levels: LEV_DEF, bandwidth: BW_DEF, fill: true };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.category;   // 'correlation-and-multivariate'
 */
export const meta = {
  name: 'contour',
  summary:
    'A two-dimensional kernel density over a scatter, traced into isolines by marching squares ' +
    'and drawn as bands or as lines.',
  shape:
    '{ points: [{ x, y }], bandwidth, levels, unit, xLabel, yLabel } -- ' +
    'x and y must both be numbers or the point is refused and counted; bandwidth is the ' +
    'Gaussian standard deviation in drawing units and seeds a setting the viewer can move; ' +
    'levels is how many isolines; unit is a string for both axes or { x, y } for one each',
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
 * A point with a non-numeric coordinate is refused rather than repaired, counted, and up to three
 * of the offending values are quoted -- "14 points were refused" sends a reader through their
 * whole file, and "14 were refused, the first was x: 'n/a'" sends them to the column.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ pts, bad, names, bandwidth, levels, unit, xLabel, yLabel }`
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

  const askedBw = numOf(d.bandwidth);
  const askedLv = numOf(d.levels);

  return {
    pts, bad, names,
    bandwidth: askedBw === null ? BW_DEF : Math.max(BW_MIN, Math.min(BW_MAX, Math.round(askedBw))),
    levels: askedLv === null ? LEV_DEF : Math.max(LEV_MIN, Math.min(LEV_MAX, Math.round(askedLv))),
    badBandwidth: d.bandwidth != null && askedBw === null,
    badLevels: d.levels != null && askedLv === null,
    unit: readUnit(d),
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    yLabel: d.yLabel == null ? '' : String(d.yLabel),
  };
}

/**
 * One axis: a padded domain snapped outward to whole ticks, with those ticks.
 *
 * `CK.ticks` only returns ticks INSIDE the domain it is given, so a raw data domain leaves a
 * ragged strip above the last gridline and the top of the plot has no rule on it. Snapping the
 * ends to the step the ticks already chose closes that, and the ticks are stepped out rather than
 * re-derived -- asking `CK.ticks` again with the wider range can push it to the next nice step and
 * halve the number of gridlines.
 *
 * A collapsed domain -- every value identical, or a single point -- is widened by half its own
 * magnitude, or by one when the magnitude is zero, so the picture has somewhere to be drawn.
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
 * emitted as a display list the browser prepends. Only the density and its isolines are recomputed.
 *
 * @param R       the output of {@link readData}
 * @param legendH how much room to keep under the plot for the level ramp
 * @returns `{ plot, sx, sy, marks, W, H, ax, ay }`
 *
 * @example makeFrame(readData({ points: [{ x: 0, y: 0 }] }), 26).plot.y0;   // 10
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

  /* Two baselines and no box. A full frame reads as a container; two rules read as axes. */
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

/* -- the density and its isolines: emitted to the browser, tested here ------------------ */

/**
 * A count grid convolved with a Gaussian, in two separable one-dimensional passes.
 *
 * The naive kernel density evaluates a sum over every point at every grid node, which is
 * O(nodes times n) and is slow exactly when the picture is worth drawing. Binning the points into
 * the grid first is O(n) and happens once, at build time; the blur that follows costs the same
 * whether ten points went in or ten thousand. Separability is what makes it cheap: a
 * two-dimensional Gaussian is the product of two one-dimensional ones, so a radius-r blur is
 * 2(2r+1) multiplies per node rather than (2r+1) squared.
 *
 * The kernel is normalised to sum to one, so the grid's total mass is the point count and a
 * bandwidth change moves the density around without inventing or destroying any of it. At the
 * edges the kernel is truncated rather than reflected, which is the same statement the forced-zero
 * border makes: a density estimated from a finite window falls off outside that window rather than
 * folding back into it.
 *
 * @param counts flat grid of point counts, row-major, length gw times gh
 * @param gw     nodes across
 * @param gh     nodes down
 * @param sigma  the standard deviation, in NODES rather than drawing units
 * @returns a new flat grid of densities, with its outer ring forced to zero
 *
 * @example blurGrid([0, 1, 0, 0], 2, 2, 0)[1];   // 0
 */
function blurGrid(counts, gw, gh, sigma) {
  var i, j, k, s, ii, jj;
  var size = gw * gh;
  var tmp = new Array(size);
  var out = new Array(size);

  for (i = 0; i < size; i++) { tmp[i] = 0; out[i] = 0; }

  var rad = Math.ceil(sigma * 3);
  if (!(sigma > 0)) { rad = 0; }
  if (rad > 160) { rad = 160; }

  var ker = [];
  var tot = 0;
  for (k = -rad; k <= rad; k++) {
    var w = rad === 0 ? 1 : Math.exp(-0.5 * (k / sigma) * (k / sigma));
    ker.push(w);
    tot += w;
  }
  for (k = 0; k < ker.length; k++) { ker[k] = ker[k] / tot; }

  for (j = 0; j < gh; j++) {
    for (i = 0; i < gw; i++) {
      s = 0;
      for (k = -rad; k <= rad; k++) {
        ii = i + k;
        if (ii < 0 || ii >= gw) { continue; }
        s += counts[j * gw + ii] * ker[k + rad];
      }
      tmp[j * gw + i] = s;
    }
  }
  for (j = 0; j < gh; j++) {
    for (i = 0; i < gw; i++) {
      s = 0;
      for (k = -rad; k <= rad; k++) {
        jj = j + k;
        if (jj < 0 || jj >= gh) { continue; }
        s += tmp[jj * gw + i] * ker[k + rad];
      }
      out[j * gw + i] = s;
    }
  }

  /* The outer ring is pinned to zero so that no isoline can reach the boundary and every one of
     them closes. This is a statement about the estimate and not a trick: outside the window there
     is no sample, so there is no density. What it buys downstream is that a filled band is an
     actual fill rather than a guess about how to seal an open curve against the frame. */
  for (i = 0; i < gw; i++) { out[i] = 0; out[(gh - 1) * gw + i] = 0; }
  for (j = 0; j < gh; j++) { out[j * gw] = 0; out[j * gw + gw - 1] = 0; }

  return out;
}

/**
 * The closed rings of one level set, by marching squares with the asymptotic decider.
 *
 * Marching squares walks every cell of the grid, reads which of its four corners are at or above
 * the threshold, and emits the line segments that separate them. Fourteen of the sixteen corner
 * patterns have exactly one reading. Two do not, and they are the whole reason this function has a
 * doc comment.
 *
 * **Cases 5 and 10 -- the saddle.** When the two ABOVE corners are diagonally opposite, all four
 * edges carry a crossing, and the four crossing points can be joined two ways. Either the above
 * region passes through the middle of the cell as one connected neck, or it does not and the cell
 * holds two separate corners of it. The four corner values cannot tell you which; that information
 * lives between them. Picking one arbitrarily -- which is what most quick implementations do, and
 * the usual pick is "always separate" -- means the card decides whether two peaks are ONE peak
 * with a ridge or TWO peaks with a gap, and that is normally the entire finding.
 *
 * **The convention chosen here is the asymptotic decider.** Take the bilinear interpolant over the
 * cell -- the unique surface that matches the four corners and is linear along each edge, and the
 * same surface the edge interpolation already assumes -- and evaluate it at its saddle point. That
 * value is `(g00 g11 - g10 g01) / (g00 + g11 - g10 - g01)` on corner values measured RELATIVE to
 * the threshold. If it is at or above the threshold the neck exists and the above corners are
 * joined; otherwise they are separated. It is not a coin toss: it is the answer the interpolation
 * used everywhere else in the cell already implies, so the isolines stay consistent with the
 * surface the edge crossings were computed from.
 *
 * The denominator cannot be zero in an ambiguous case, which is worth knowing rather than
 * assuming: in case 5 the two above corners contribute positive terms and the two below
 * contribute negative ones, so the sum is strictly positive, and in case 10 it is strictly
 * negative. A guard is kept anyway, and falls back to "separated", because a degenerate cell where
 * two corners sit exactly on the threshold should not be allowed to invent a connection.
 *
 * Segments are keyed by the EDGE they cross rather than by their coordinates. Two neighbouring
 * cells share an edge, so they compute the same crossing from the same two corner values -- but
 * joining on floating-point coordinates would still be a bet on bit-identical arithmetic. An edge
 * identity is exact, and each edge carries at most one crossing, so every crossing point has
 * degree at most two and the segment graph is a disjoint union of simple paths and cycles. With
 * the border pinned to zero there are no paths: everything closes.
 *
 * @param g     the density grid, row-major
 * @param gw    nodes across
 * @param gh    nodes down
 * @param level the threshold
 * @param x0    the drawing x of node column zero
 * @param y0    the drawing y of node row zero
 * @param pitch the node spacing in drawing units
 * @returns `{ rings, open, saddles, joined }` -- rings are arrays of `[x, y]`, `open` counts any
 *          ring that failed to close, which should always be zero
 *
 * @example isoRings([0,0,0, 0,9,0, 0,0,0], 3, 3, 4, 0, 0, 10).rings.length;   // 1
 */
function isoRings(g, gw, gh, level, x0, y0, pitch) {
  var i, j, k;
  var pos = {};
  var inc = {};
  var segs = [];
  var saddles = 0;
  var joined = 0;

  function edgeH(ci, cj) {
    var key = 'h' + ci + '_' + cj;
    if (!Object.hasOwn(pos, key)) {
      var a = g[cj * gw + ci];
      var b = g[cj * gw + ci + 1];
      var t = (b - a) === 0 ? 0.5 : (level - a) / (b - a);
      if (!(t >= 0)) { t = 0; }
      if (t > 1) { t = 1; }
      pos[key] = [x0 + (ci + t) * pitch, y0 + cj * pitch];
    }
    return key;
  }

  function edgeV(ci, cj) {
    var key = 'v' + ci + '_' + cj;
    if (!Object.hasOwn(pos, key)) {
      var a = g[cj * gw + ci];
      var b = g[(cj + 1) * gw + ci];
      var t = (b - a) === 0 ? 0.5 : (level - a) / (b - a);
      if (!(t >= 0)) { t = 0; }
      if (t > 1) { t = 1; }
      pos[key] = [x0 + ci * pitch, y0 + (cj + t) * pitch];
    }
    return key;
  }

  function join(a, b) {
    var at = segs.length;
    segs.push([a, b]);
    if (!Object.hasOwn(inc, a)) { inc[a] = []; }
    if (!Object.hasOwn(inc, b)) { inc[b] = []; }
    inc[a].push(at);
    inc[b].push(at);
  }

  for (j = 0; j + 1 < gh; j++) {
    for (i = 0; i + 1 < gw; i++) {
      var tl = g[j * gw + i];
      var tr = g[j * gw + i + 1];
      var br = g[(j + 1) * gw + i + 1];
      var bl = g[(j + 1) * gw + i];

      var code = (tl >= level ? 1 : 0) + (tr >= level ? 2 : 0) +
                 (br >= level ? 4 : 0) + (bl >= level ? 8 : 0);
      if (code === 0 || code === 15) { continue; }

      var top = 0;
      var right = 0;
      var bottom = 0;
      var leftE = 0;

      if (code === 1 || code === 14) { join(edgeV(i, j), edgeH(i, j)); continue; }
      if (code === 2 || code === 13) { join(edgeH(i, j), edgeV(i + 1, j)); continue; }
      if (code === 3 || code === 12) { join(edgeV(i, j), edgeV(i + 1, j)); continue; }
      if (code === 4 || code === 11) { join(edgeV(i + 1, j), edgeH(i, j + 1)); continue; }
      if (code === 6 || code === 9) { join(edgeH(i, j), edgeH(i, j + 1)); continue; }
      if (code === 7 || code === 8) { join(edgeV(i, j), edgeH(i, j + 1)); continue; }

      /* Cases 5 and 10: the saddle. Corner values relative to the threshold, so the decider is a
         comparison against zero and the arithmetic is the same for both cases. */
      saddles++;
      var a00 = tl - level;
      var a10 = tr - level;
      var a11 = br - level;
      var a01 = bl - level;
      var den = a00 + a11 - a10 - a01;
      var neck = false;
      if (den !== 0) { neck = ((a00 * a11 - a10 * a01) / den) >= 0; }

      top = edgeH(i, j);
      right = edgeV(i + 1, j);
      bottom = edgeH(i, j + 1);
      leftE = edgeV(i, j);

      if (neck) { joined++; }

      if (code === 5) {
        /* Above at top-left and bottom-right. Joining left-to-top and right-to-bottom cuts two
           corner triangles off and leaves the above region in two pieces; joining top-to-right
           and bottom-to-left cuts the BELOW corners off instead and lets the above region through
           the middle. */
        if (neck) { join(top, right); join(bottom, leftE); }
        else { join(leftE, top); join(right, bottom); }
      } else {
        /* Case 10: above at top-right and bottom-left, and the two readings swap. */
        if (neck) { join(leftE, top); join(right, bottom); }
        else { join(top, right); join(bottom, leftE); }
      }
    }
  }

  /* Every crossing point has degree at most two, so walking from an unused segment and taking the
     other unused segment at each end traces one whole ring and never branches. */
  var used = [];
  for (k = 0; k < segs.length; k++) { used.push(0); }

  var rings = [];
  var open = 0;
  for (k = 0; k < segs.length; k++) {
    if (used[k]) { continue; }
    used[k] = 1;
    var startKey = segs[k][0];
    var here = segs[k][1];
    var cur = k;
    var ring = [pos[startKey], pos[here]];

    while (true) {
      var list = inc[here];
      var next = -1;
      for (i = 0; i < list.length; i++) {
        if (list[i] !== cur && !used[list[i]]) { next = list[i]; break; }
      }
      if (next < 0) { break; }
      used[next] = 1;
      var other = segs[next][0] === here ? segs[next][1] : segs[next][0];
      ring.push(pos[other]);
      here = other;
      cur = next;
    }

    if (here === startKey) { ring.pop(); }
    else { open++; }
    if (ring.length > 2) { rings.push(ring); }
  }

  return { rings: rings, open: open, saddles: saddles, joined: joined };
}

/**
 * The whole density picture as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so the
 * function a test calls in Node is textually the function the page runs.
 *
 * The filled mode does something worth explaining. Each band is painted as its own path over the
 * one below it, and the level sets nest -- a higher threshold's region is a subset of every lower
 * one's -- so the alphas COMPOSITE. Painting each band at the strength it is meant to look would
 * therefore be wrong: the innermost region would show the sum of every layer over it. Instead each
 * layer's alpha is solved backwards from the composite it is supposed to produce,
 * `a = (T - Tprev) / (1 - Tprev)`, so the visible strength of band k is exactly the k-th step of
 * an evenly spaced ladder, and that is checkable rather than eyeballed.
 *
 * @param model the precomputed model: the count grid, the plot rectangle, the ramp limits
 * @param cfg   `{ levels, bandwidth, fill }`
 * @returns `{ marks, note, aria, rings, open, saddles, joined, alphas }`
 *
 * @example contourGeom(model, { levels: 6, bandwidth: 18, fill: true }).open;   // 0
 */
function contourGeom(model, cfg) {
  var i, j, k;
  var plot = model.plot;

  var bw = Math.round(Number(cfg.bandwidth));
  if (!isFinite(bw)) { bw = model.bwDef; }
  if (bw < model.bwMin) { bw = model.bwMin; }
  if (bw > model.bwMax) { bw = model.bwMax; }

  var lv = Math.round(Number(cfg.levels));
  if (!isFinite(lv)) { lv = model.levDef; }
  if (lv < model.levMin) { lv = model.levMin; }
  if (lv > model.levMax) { lv = model.levMax; }

  var filled = cfg.fill === true || cfg.fill === 'true';
  var marks = [];

  function r2(v) { return Math.round(v * 100) / 100; }

  function dots() {
    var out = [];
    var p = model.pts;
    for (var q = 0; q < p.length; q += 2) {
      out.push({ t: 'circle', a: { cx: r2(p[q]), cy: r2(p[q + 1]), r: 1.6, "class": 'pt' } });
    }
    return out;
  }

  /* The grid is only shipped when there is a density worth estimating, so its size is checked
     rather than assumed: reading past the end of a shorter array yields undefined, and undefined
     times a kernel weight is a NaN that would reach the page as a dropped attribute. */
  if (model.count < model.minPoints || model.grid.length !== model.gw * model.gh) {
    marks = marks.concat(dots());
    return { marks: marks, note: model.fewNote, aria: model.fewAria, rings: 0, open: 0,
             saddles: 0, joined: 0, alphas: [], levels: lv, bandwidth: bw };
  }

  var g = blurGrid(model.grid, model.gw, model.gh, bw / model.pitch);
  var peak = 0;
  for (i = 0; i < g.length; i++) { if (g[i] > peak) { peak = g[i]; } }

  if (!(peak > 0)) {
    marks = marks.concat(dots());
    return { marks: marks, note: model.flatNote, aria: model.flatAria, rings: 0, open: 0,
             saddles: 0, joined: 0, alphas: [], levels: lv, bandwidth: bw };
  }

  /* Thresholds are evenly spaced fractions of the peak, and neither end is included: a contour at
     zero is the whole plot and one at the peak is a single node. */
  var rings = 0;
  var open = 0;
  var saddles = 0;
  var joined = 0;
  var alphas = [];
  var prevT = 0;

  for (k = 0; k < lv; k++) {
    var share = (k + 1) / (lv + 1);
    var level = peak * share;
    var got = isoRings(g, model.gw, model.gh, level, plot.x0, plot.y0, model.pitch);
    rings += got.rings.length;
    open += got.open;
    saddles += got.saddles;
    joined += got.joined;

    var d = '';
    for (i = 0; i < got.rings.length; i++) {
      var ring = got.rings[i];
      for (j = 0; j < ring.length; j++) {
        d += (j ? 'L' : 'M') + r2(ring[j][0]) + ',' + r2(ring[j][1]);
      }
      d += 'Z';
    }
    if (!d) { continue; }

    var target = lv === 1 ? (model.fillLo + model.fillHi) / 2
      : model.fillLo + (model.fillHi - model.fillLo) * k / (lv - 1);

    if (filled) {
      /* Solved backwards from the composite each band is meant to reach, because the bands nest
         and their alphas therefore stack. */
      var a = (target - prevT) / (1 - prevT);
      if (!(a > 0)) { a = 0.02; }
      if (a > 1) { a = 1; }
      alphas.push(Math.round(a * 1000) / 1000);
      prevT = target;
      marks.push({ t: 'path', a: { d: d, "class": 'band', 'fill-rule': 'evenodd',
                                   'fill-opacity': Math.round(a * 1000) / 1000 } });
    } else {
      alphas.push(Math.round(target * 1000) / 1000);
      marks.push({ t: 'path', a: { d: d, "class": 'iso',
                                   'stroke-opacity': Math.round(target * 1000) / 1000 } });
    }
  }

  if (model.pts.length) { marks = marks.concat(dots()); }

  /* The ramp lives inside the drawing rather than beside it, because it changes with the level
     count and a legend that lags the picture is worse than no legend. */
  var lw = Math.min(200, Math.max(90, lv * 18));
  var lx = plot.x1 - lw;
  var ly = model.H - 12;
  var sw = lw / lv;
  for (k = 0; k < lv; k++) {
    var lt = lv === 1 ? (model.fillLo + model.fillHi) / 2
      : model.fillLo + (model.fillHi - model.fillLo) * k / (lv - 1);
    marks.push({ t: 'rect', a: { x: r2(lx + k * sw), y: r2(ly - 8), width: r2(sw - 1), height: 8,
                                 "class": 'band', 'fill-opacity': Math.round(lt * 1000) / 1000 } });
  }
  marks.push({ t: 'text', a: { x: r2(lx - 5), y: r2(ly - 1), "class": 'ck-tk',
                               'text-anchor': 'end' }, s: 'share of peak density' });
  marks.push({ t: 'text', a: { x: r2(lx), y: r2(ly + 8), "class": 'ck-tk',
                               'text-anchor': 'start' },
               s: Math.round(100 / (lv + 1)) + '%' });
  marks.push({ t: 'text', a: { x: r2(lx + lw), y: r2(ly + 8), "class": 'ck-tk',
                               'text-anchor': 'end' },
               s: Math.round(100 * lv / (lv + 1)) + '%' });

  var shared = plural(model.count, 'point', 'points') + ' as a Gaussian density at bandwidth ' +
    bw + ', traced at ' + plural(lv, 'level', 'levels') + ' into ' +
    plural(rings, 'closed ring', 'closed rings') + '. ' +
    (saddles
      ? plural(saddles, 'cell was', 'cells were') + ' an ambiguous saddle, ' + joined +
        ' of them resolved as joined by the asymptotic decider on the bilinear surface -- the ' +
        'other reading would have drawn those necks as gaps. '
      : 'no cell was an ambiguous saddle at these levels. ') +
    model.spreadNote;

  var note = shared + (filled
    ? 'bands are one hue at ordered strengths, solved so the stacked alphas land on an even ladder.'
    : 'lines are one hue at ordered strengths, faintest outside.');
  var aria = 'Density contours of ' + shared + model.axisAria;

  return { marks: marks, note: note, aria: aria, rings: rings, open: open, saddles: saddles,
           joined: joined, alphas: alphas, levels: lv, bandwidth: bw };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every contour on the second pass.
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
 * that has to know anything. `prefers-color-scheme` is deliberately absent: the desk is one
 * document open in two viewers that want different answers, and the OS gives both the same answer.
 *
 * Bands and lines share ONE fill and stroke token and vary only in opacity, which is the
 * sequential-ramp argument expressed as CSS: there is exactly one place a hue is named, so a
 * rainbow cannot creep in later by accident.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['svg.ck-ct', 'display: block; width: 100%; height: auto;'],
    ['.ck-ct text', 'font-family: var(--mono); font-size: 9px;'],
    ['.ck-ct .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-ct .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],

    ['.ck-ct .band', 'fill: var(--ck-s6); stroke: none;'],
    ['.ck-ct .iso', 'fill: none; stroke: var(--ck-s6); stroke-width: 1.3; stroke-linejoin: round;'],
    ['.ck-ct .pt', 'fill: var(--ink-dim); fill-opacity: .5; stroke: none;'],

    ['.ck-ct-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
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
    '  <div class="ck-ct-void">nothing to estimate &mdash; no usable points were given</div>\n';

  const svg = hasPts
    ? '  <svg class="ck-plot ck-ct" role="img" viewBox="0 0 ' + W0 + ' ' + H0 +
      '" aria-label="' + e(said.aria) + '"></svg>\n'
    : '';

  return '<section data-card="' + e(id) + '" class="ck-contour">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-levels">levels</label>\n' +
    '    <input type="number" id="' + e(id) + '-levels" name="levels" min="' + LEV_MIN +
    '" max="' + LEV_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-bandwidth">bandwidth</label>\n' +
    '    <input type="number" id="' + e(id) + '-bandwidth" name="bandwidth" min="' + BW_MIN +
    '" max="' + BW_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-fill">filled bands</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-fill" name="fill">\n' +
    '    <div class="ck-set-foot">the bandwidth is a choice, not a measurement: a small one ' +
    'shows every clump and a large one shows one hill, and the data is the same either way. ' +
    'ambiguous cells are resolved by the asymptotic decider, so a neck is drawn where the ' +
    'bilinear surface actually has one.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(R.pts.length)) + '</b> ' +
    (R.pts.length === 1 ? 'point' : 'points') + '. <i class="ck-ct-note">' + e(said.note) +
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
  if (R.badBandwidth) bits.push('the given bandwidth was not a number and the default stands');
  if (R.badLevels) bits.push('the given level count was not a number and the default stands');
  if (!bits.length) return '';
  const named = R.names.length ? ' (' + R.names.join(', ') + ')' : '';
  return ' <span class="ck-aside">' + e(bits.join('; ') + named + '; refused, not repaired.') +
         '</span>';
}

/**
 * The browser half: read the settings, blur, trace, paint, and say what came out.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated inside the geometry function
 * on every draw, because they come out of `localStorage`, which is a text file the viewer can
 * edit, and a bandwidth of zero or of the word "wide" must land on something drawable rather than
 * on a division by zero.
 */
function cardJs(id, model, inst) {
  const js =
    '/* contour card: the count grid, the plot frame and the axes were computed in Node;\n' +
    '   the blur and the isolines happen here, because both change with viewer settings. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    'function plural(count, one, many) { return count + " " + (count === 1 ? one : many); }\n\n' +
    blurGrid.toString() + '\n\n' +
    isoRings.toString() + '\n\n' +
    contourGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-ct");\n' +
    '  var note = sec.querySelector(".ck-ct-note");\n\n' +
    '  function draw(cfg) {\n' +
    '    var got = contourGeom(MODEL, cfg);\n' +
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
 * Build one contour card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the grid size, the axis domains and the
 *          saddle census, so a reader can check the caption without re-deriving anything
 *
 * @throws {Error} when the geometry produces a number that is not finite, when a contour fails to
 *                 close, or when the emitted script contains a token that would break the desk.
 *                 Malformed input never throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'cloud',
 *   title: 'where the measurements actually are',
 *   data: { points: [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 1 }], bandwidth: 24 },
 *   ord: 42,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'contour' : id);
  const R = readData(data);
  const frame = makeFrame(R, 26);
  const plot = frame.plot;

  /* The node grid spans the plot rectangle exactly, so the ring that gets pinned to zero is the
     plot's own boundary and no contour can ever be drawn outside the axes. */
  const gw = Math.max(4, Math.round((plot.x1 - plot.x0) / PITCH) + 1);
  const gh = Math.max(4, Math.round((plot.y1 - plot.y0) / PITCH) + 1);
  const grid = new Array(gw * gh).fill(0);

  let onBorder = 0;
  for (const p of R.pts) {
    const px = frame.sx(p.x);
    const py = frame.sy(p.y);
    let gi = Math.round((px - plot.x0) / PITCH);
    let gj = Math.round((py - plot.y0) / PITCH);
    /* A point that rounds onto the pinned border would be erased by the pin, so it is moved one
       node inward. That is a shift of at most half a grid step, and the alternative is a sample
       that silently contributes nothing. */
    if (gi < 1) { gi = 1; onBorder++; }
    if (gi > gw - 2) { gi = gw - 2; onBorder++; }
    if (gj < 1) { gj = 1; onBorder++; }
    if (gj > gh - 2) { gj = gh - 2; onBorder++; }
    grid[gj * gw + gi] += 1;
  }

  const flatX = R.pts.length > 1 && R.pts.every((p) => p.x === R.pts[0].x);
  const flatY = R.pts.length > 1 && R.pts.every((p) => p.y === R.pts[0].y);

  const spreadNote = flatX && flatY
    ? 'every point sits at the same x and y, so what is drawn is the kernel and not the data: ' +
      'concentric rings around one place. '
    : flatX ? 'every point sits at the same x, so the picture is a vertical band of the kernel. '
    : flatY ? 'every point sits at the same y, so the picture is a horizontal band of the kernel. '
    : onBorder
      ? plural(onBorder, 'sample was', 'samples were') + ' moved one grid node inward off the ' +
        'pinned boundary, which is a shift of at most half a grid step. '
      : '';

  const pts = [];
  if (R.pts.length && R.pts.length <= DOT_CAP) {
    for (const p of R.pts) pts.push(n1(frame.sx(p.x), 'px'), n1(frame.sy(p.y), 'py'));
  }

  const axisAria =
    ' The horizontal axis runs from ' + CK.fmt(frame.ax.lo) + ' to ' + CK.fmt(frame.ax.hi) +
    (R.unit.x ? ' ' + R.unit.x : '') + ' and the vertical from ' + CK.fmt(frame.ay.lo) +
    ' to ' + CK.fmt(frame.ay.hi) + (R.unit.y ? ' ' + R.unit.y : '') + '.';

  const model = {
    plot: { x0: n(plot.x0, 'plot'), y0: n(plot.y0, 'plot'),
            x1: n(plot.x1, 'plot'), y1: n(plot.y1, 'plot') },
    H: H0,
    gw, gh,
    /* An empty grid rather than six thousand literal zeros when there is nothing to estimate: the
       geometry checks the length before it blurs, so a short grid is a refusal and not a crash. */
    grid: R.pts.length >= MIN_POINTS ? grid : [],
    pitch: PITCH,
    pts,
    count: R.pts.length,
    minPoints: MIN_POINTS,
    bwMin: BW_MIN, bwMax: BW_MAX, bwDef: BW_DEF,
    levMin: LEV_MIN, levMax: LEV_MAX, levDef: LEV_DEF,
    fillLo: FILL_LO, fillHi: FILL_HI,
    frame: frame.marks,
    spreadNote,
    axisAria,
    fewNote: R.pts.length
      ? 'fewer than ' + MIN_POINTS + ' points, so no density is drawn: the isolines of one or ' +
        'two samples are a picture of the bandwidth setting and not of the data. the points ' +
        'themselves are drawn instead.'
      : 'no usable points, so there is nothing to estimate; the axes are drawn so the card ' +
        'keeps its place.',
    fewAria: R.pts.length
      ? 'A density plot with too few points to estimate one: ' + plural(R.pts.length, 'point is', 'points are') +
        ' drawn on their own, because contours from fewer than ' + MIN_POINTS +
        ' samples show the kernel rather than the data.'
      : 'An empty density plot: no usable points were given.',
    flatNote: 'the density came out flat at zero, so there is nothing to trace.',
    flatAria: 'A density plot whose estimate is everywhere zero, so no contour is drawn.',
  };

  const inst = { levels: R.levels, bandwidth: R.bandwidth, fill: defaults.fill };

  /* The browser half is exercised here over the corners of the setting space, so a degenerate
     input that would produce a NaN coordinate -- or an isoline that fails to close -- is caught at
     build time next to the data that caused it rather than at paint time, where the browser drops
     the attribute in silence. */
  let active = null;
  const bwTry = [...new Set([BW_MIN, inst.bandwidth, BW_MAX])];
  const lvTry = [...new Set([LEV_MIN, inst.levels, LEV_MAX])];
  for (const bw of bwTry) {
    for (const levels of lvTry) {
      for (const fill of [true, false]) {
        const got = contourGeom(model, { levels, bandwidth: bw, fill });
        assertFinite(got.marks, 'bandwidth ' + bw + '/levels ' + levels);
        assertClean(got.note, 'note at bandwidth ' + bw);
        assertClean(got.aria, 'aria at bandwidth ' + bw);
        if (got.open) {
          throw new Error('cardkit/contour: ' + got.open + ' isoline(s) failed to close at ' +
                          'bandwidth ' + bw + ', levels ' + levels);
        }
        if (bw === inst.bandwidth && levels === inst.levels && fill === inst.fill) active = got;
      }
    }
  }
  if (!active) active = contourGeom(model, inst);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'contour',
      points: R.pts.length,
      minPoints: MIN_POINTS,
      grid: { across: gw, down: gh, pitch: PITCH },
      bandwidth: R.bandwidth,
      levels: R.levels,
      rings: active.rings,
      openRings: active.open,
      saddleCells: active.saddles,
      saddlesJoined: active.joined,
      bandAlphas: active.alphas,
      xDomain: [frame.ax.lo, frame.ax.hi],
      yDomain: [frame.ay.lo, frame.ay.hi],
      refused: { nonNumericX: R.bad.badX, nonNumericY: R.bad.badY, notObjects: R.bad.notObject },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active, R.pts.length > 0),
    css: cardCss(cardId),
    js: cardJs(cardId, model, inst),
  };
}

/* Exported for the verifier only: the density and the tracer the browser runs, so a test can
   check a saddle resolution and a closed ring using the same text the page gets. */
export { blurGrid, isoRings, contourGeom, readData, axisOf, makeFrame };
