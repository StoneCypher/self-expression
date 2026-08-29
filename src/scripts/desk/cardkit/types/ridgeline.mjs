/**
 * `ridgeline` — one density curve per group, stacked and overlapping, on one shared value axis.
 *
 * The overlap is the entire point of the form and the entire risk of it. Letting a curve rise
 * into the rows above is what makes twenty distributions comparable in the space of five: the
 * eye follows a ridge of peaks drifting left or right and reads a trend that twenty separate
 * panels would hide. It is also, unavoidably, occlusion — the curves are painted back to front,
 * so a tall near curve covers the shorter far curve behind it, and a reader who does not know
 * that will read a missing hump as an absent hump. The card therefore says so in the caption,
 * every time, and the overlap is a setting so that anyone suspicious can turn it down to zero
 * and see what was hidden.
 *
 * The estimator is the same one the violin card uses, deliberately: a Gaussian kernel with
 * Silverman's bandwidth in the form R ships as `bw.nrd0`,
 *
 *     h = 0.9 * min(sd, IQR / 1.349) * n^(-1/5)
 *
 * and the same refusal — a group with fewer than eight observations, or with none at all, gets
 * no curve. What breaks under the alternative bandwidth rules is worth restating: Scott's
 * h = 1.06 s n^(-1/5) drops the robust `min`, so on a ridgeline one group's outlier
 * oversmooths that group alone and the reader sees a shape difference that is an artefact of
 * the selector rather than of the data. That is worse here than on a single-group card,
 * because on a ridgeline the whole subject is comparison between rows.
 *
 * @see ./violin.mjs   the same estimator, mirrored, one group per lane
 * @see ./boxplot.mjs  the five-number sibling, which has no minimum n
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
  catch (e) { throw new Error('cardkit/ridgeline: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/ridgeline: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;

/**
 * The smallest sample this card will draw a density from.
 *
 * Eight, matching the violin card on purpose so that the same group drawn on both cards is
 * either drawn as a curve on both or refused on both. The reason is the same: the variance of a
 * kernel density estimate goes as 1/(n h), and with Silverman's bandwidth the effective count
 * under the kernel is roughly n^(4/5) — about four and a half at n = 7. A curve from that many
 * points shows one bump per observation and a reader has no way to tell that from a finding.
 */
const MIN_N = 8;

/* How many points each density is evaluated at. Fewer than the violin card's 96, because a
   ridgeline draws many more curves and each is shorter; 80 is still smooth at a desk column's
   width and keeps twenty rows re-rendering in a few milliseconds. */
const GRID = 80;

/* Payload budget, shared across however many rows there are. A ridgeline is usually many
   groups, so the per-group share matters more here than on a one-group card. */
const SAMPLE_CAP = 1200;
const SAMPLE_BUDGET = 12000;
const SAMPLE_FLOOR = 200;

/* At most this many observations are drawn as a rug under a row that was refused a curve. */
const RUG_CAP = 300;

/* Beyond six bandwidths a Gaussian contributes about six parts per billion of its peak, which is
   thousands of times thinner than the stroke that draws it. */
const TAIL_Z = 6;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` cannot be referenced by it at all.
 */
export const defaults = {
  overlap: 1.5,
  fill: true,
  sort: 'given',
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'ridgeline',
  summary: 'Stacked kernel densities on one axis, overlapping by a stated amount, back to front.',
  shape: '{ groups: [{ name, values: [number] }], xLabel, unit }',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const` and `let` false-positives on English prose, and a guard that
 * cries wolf is a guard somebody deletes. Regex literals are recognised, because otherwise the
 * scanner desynchronises on a quote inside a character class and starts blanking real code,
 * which turns a false positive into a far worse false negative.
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
 * Refuse to emit browser script that would break the whole desk, and say where.
 *
 * Every card's `js` is concatenated into ONE inline block, so a single modern-syntax token — or
 * a backtick inside a comment, which `Function.prototype.toString()` ships verbatim — is a parse
 * error that blanks every card on the page rather than just this one.
 *
 * @param src the emitted script
 * @param who a label for the error message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it checks
 * @throws {Error} naming the offending construct and its offset, with the surrounding text
 *
 * @example guardJs('var a = 1;');   // returns it
 */
export function guardJs(src, who) {
  const where = who || 'cardkit/ridgeline';
  const near = (at) => src.slice(Math.max(0, at - 50), at + 50);
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
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      die('contains control character ' + c, i);
    }
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
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting what
 * it had to refuse.
 *
 * A value is kept only when it is a `number` and finite. That is stricter than `Number(v)` on
 * purpose: `Number('')` is 0, `Number(true)` is 1 and `Number([])` is 0, so a coercing reader
 * invents observations at zero — and on a ridgeline an invented zero grows a bump in one row
 * and not in the others, which is exactly the kind of difference the form exists to show.
 * Everything refused is counted and the count is named in the caption.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ groups, refused, kept, xLabel, unit }`
 *
 * @example readData({ groups: [{ name: 'a', values: [1, 'x'] }] }).refused;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.groups) ? d.groups : [];
  const groups = [];
  let refused = 0;
  let kept = 0;

  raw.forEach((g, i) => {
    const src = g && Array.isArray(g.values) ? g.values : [];
    const values = [];
    let bad = 0;
    for (const v of src) {
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
      else bad++;
    }
    refused += bad;
    kept += values.length;
    groups.push({
      name: String(g && g.name != null ? g.name : 'group ' + (i + 1)),
      values,
      refused: bad,
    });
  });

  return {
    groups,
    refused,
    kept,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    unit: d.unit == null ? '' : String(d.unit),
  };
}

/** Ascending copy. `Array.prototype.sort` without a comparator is lexicographic, which for numbers is a silent disaster. */
function sortAsc(values) {
  const out = values.slice();
  out.sort((a, b) => a - b);
  return out;
}

/**
 * The type-7 quantile: the definition R, NumPy, pandas and Excel's QUARTILE.INC all use.
 *
 * Chosen for the same reason its siblings chose it — it is the definition a reader's own tools
 * agree with — and used here for the median a row can be sorted by and for the IQR inside the
 * bandwidth rule.
 *
 * @param sorted the sample, already ascending; an empty sample yields 0
 * @param p      a probability in 0..1
 *
 * @example quantile7([1, 2, 3, 4], 0.5);   // 2.5
 */
function quantile7(sorted, p) {
  const m = sorted.length;
  if (m === 0) return 0;
  if (m === 1) return sorted[0];
  const h = (m - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** The sample standard deviation, n-1 divisor; zero for a sample of one, which is correct and load-bearing here. */
function sdOf(values) {
  const m = values.length;
  if (m < 2) return 0;
  let mu = 0;
  for (const v of values) mu += v;
  mu /= m;
  let s = 0;
  for (const v of values) { const dd = v - mu; s += dd * dd; }
  return Math.sqrt(s / (m - 1));
}

/**
 * Silverman's rule of thumb for a Gaussian kernel, in the form R ships as `bw.nrd0`.
 *
 *     h = 0.9 * min(sd, IQR / 1.349) * n^(-1/5)
 *
 * The 1.349 converts an interquartile range into a standard deviation for a normal sample, so
 * the `min` picks whichever estimate of spread is smaller — the robust one whenever a tail is
 * fat. The fallback chain when that minimum is zero is R's, not an invention: the standard
 * deviation, then the magnitude of the first observation, then one. A constant sample gets no
 * curve at all, so the last two links exist only so this can never return zero and hand a
 * division by zero to the kernel.
 *
 * @param sorted the complete sample, ascending
 * @returns a strictly positive bandwidth, or 0 for an empty sample
 *
 * @example silverman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);   // about 1.72
 */
function silverman(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const sd = sdOf(sorted);
  const iqr = quantile7(sorted, 0.75) - quantile7(sorted, 0.25);
  let lo = Math.min(sd, iqr / 1.349);
  if (!(lo > 0)) lo = sd;
  if (!(lo > 0)) lo = Math.abs(sorted[0]);
  if (!(lo > 0)) lo = 1;
  return 0.9 * lo * Math.pow(n, -1 / 5);
}

/**
 * Thin a sorted list to at most `cap` entries, keeping its shape and both ends.
 *
 * Systematic — every k-th of the ascending list — rather than random, so the same data draws the
 * same picture twice. The last entry is appended when the stride would miss it, because a
 * density whose sample is missing its maximum has a tail that stops early for no reason.
 *
 * @param sorted an ascending list
 * @param cap    the most entries to keep; 0 or less keeps everything
 *
 * @example thin([1, 2, 3, 4, 5, 6, 7], 3);   // [1, 4, 7]
 */
function thin(sorted, cap) {
  if (!(cap > 0) || sorted.length <= cap) return sorted.slice();
  const k = Math.ceil(sorted.length / cap);
  const out = [];
  for (let i = 0; i < sorted.length; i += k) out.push(sorted[i]);
  const last = sorted[sorted.length - 1];
  if (out.length && out[out.length - 1] !== last) out.push(last);
  return out;
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything below runs in BOTH halves: Node calls it to draw the card that ships, and the
   browser calls the identical text after a settings change. ES5 only — `var` and `function`, no
   arrow functions, no template literals, no destructuring — and nothing but `CK` from outside. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole attribute and the row
 * renders as nothing, which on a ridgeline looks exactly like a group with no data. Throwing
 * makes it a build failure beside the input that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/ridgeline: non-finite coordinate (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face. */
function tw(s) { return String(s).length * 5.42; }

/** Shorten a label to fit `max` px, keeping the head and marking the cut. */
function clipTo(s, max) {
  var str = String(s);
  var room = Math.floor(max / 5.42);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/**
 * Ticks that reach the ends of the axis rather than stopping short of them.
 *
 * `CK.ticks` only returns ticks strictly inside the domain it was handed, leaving a ragged strip
 * past the last gridline. Snapping the domain out to the step the ticks already chose closes it;
 * the ticks are stepped out rather than re-derived, because asking again with the wider range
 * can push it to the next nice step and halve the gridline count.
 *
 * @example axisTicks(0, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
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

/** A display-list line. Every mark is an object of tag, attributes, optional text and tooltip. */
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

/** A display-list path; the caller owns the shape because only the caller knows it. */
function mPath(d, attrs) {
  var a = { d: d }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'path', a: a };
}

/**
 * A Gaussian kernel density estimate, evaluated at each point of a grid.
 *
 * The estimate at x is the mean of a unit normal density centred on every observation, scaled by
 * the bandwidth. Terms beyond `tailZ` bandwidths are skipped: at six a Gaussian is about six
 * parts per billion of its peak, thousands of times thinner than the stroke that draws it, and
 * skipping them is what lets twenty rows re-render on a settings change.
 *
 * @param sample the observations to place kernels on
 * @param h      the bandwidth; must be strictly positive
 * @param grid   the values to evaluate at
 * @param tailZ  how many bandwidths out to keep contributing
 * @returns a density per grid point, in the reciprocal of the data's unit
 *
 * @example kdeCurve([0], 1, [0], 6);   // [0.3989…]
 */
function kdeCurve(sample, h, grid, tailZ) {
  var out = [], i, j, s, z;
  var m = sample.length;
  var inv = 1 / (h * Math.sqrt(2 * Math.PI) * (m || 1));
  for (i = 0; i < grid.length; i++) {
    s = 0;
    for (j = 0; j < m; j++) {
      z = (grid[i] - sample[j]) / h;
      if (z > tailZ || z < -tailZ) { continue; }
      s += Math.exp(-0.5 * z * z);
    }
    out.push(s * inv);
  }
  return out;
}

/** An evenly spaced grid of `n` values from `lo` to `hi`, inclusive at both ends. */
function linGrid(lo, hi, n) {
  var out = [], i;
  if (n < 2) { return [lo]; }
  for (i = 0; i < n; i++) { out.push(lo + (hi - lo) * i / (n - 1)); }
  return out;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * A ridgeline is the one chart on this desk whose picture actively hides part of itself, so the
 * caption's first duty is to say that: curves are painted back to front and a taller near curve
 * covers a shorter far one. Everything else — the estimator, the refusals, the ordering — is the
 * usual list of things a reader cannot see and would otherwise assume.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param dom  the value domain actually drawn, as `{ lo, hi }`
 * @param rows the ordered rows, each carrying its render facts
 * @param overlap the overlap actually used, after clamping to 0..3
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function rdNote(P, cfg, dom, rows, overlap) {
  var unit = P.unit ? ' ' + P.unit : '';
  var i, r;
  var curves = 0, small = 0, flat = 0, thinned = 0, totalN = 0, live = 0;
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    totalN += r.g.n;
    if (r.g.n > 0) { live++; }
    if (r.density) { curves++; }
    else if (r.g.n > 0 && r.g.constant) { flat++; }
    else if (r.g.n > 0) { small++; }
    if (r.g.thinned) { thinned++; }
  }

  if (!live) {
    return {
      aria: 'Ridgeline plot with no data: ' + (P.refused
        ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left.'
        : 'nothing was supplied.'),
      caption: 'a ridgeline with <b>no data</b> - the axis is drawn so the card keeps its place. ' +
        (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                     ' refused</i> for not being finite numbers. ' : '') +
        'no density is estimated from nothing.',
    };
  }

  var order = cfg.sort === 'median' ? 'by median, largest at the top'
            : cfg.sort === 'peak' ? 'by the position of each density peak, largest at the top'
            : 'in the order the data supplied them';

  var aria = 'Ridgeline plot of ' + totalN + ' value' + (totalN === 1 ? '' : 's') + ' in ' +
    rows.length + ' row' + (rows.length === 1 ? '' : 's') +
    (P.xLabel ? ', measuring ' + P.xLabel : '') + ', on one shared axis from ' +
    CK.fmt(dom.lo) + ' to ' + CK.fmt(dom.hi) + unit + '. Rows are ordered ' + order + '. ' +
    'Curves overlap by ' + CK.fmt(overlap) + ' row heights and are painted back to front, ' +
    'so a taller near curve covers a shorter one behind it. ';
  for (i = 0; i < rows.length && i < 8; i++) {
    r = rows[i];
    if (!r.g.n) { continue; }
    aria += r.g.name + ': n ' + r.g.n + ', median ' + CK.fmt(r.g.med) +
            (r.density ? ', peak near ' + CK.fmt(r.peakAt) : ', drawn as a rug of observations') + '. ';
  }
  if (rows.length > 8) { aria += 'The remaining ' + (rows.length - 8) + ' rows are in the tooltips. '; }

  var doubts = [];
  doubts.push('<i>curves are drawn back to front</i> - the row nearest the bottom is painted last ' +
              'and covers whatever of the row behind it reaches that high, so an absent hump may ' +
              'be a hidden one; turn overlap down to 0 to see every curve whole');
  doubts.push('bandwidth is Silverman (0.9 min(sd, IQR/1.349) n^(-1/5)), one per row, from that ' +
              'row complete sample - a wider one flattens features, a narrower one invents them');
  doubts.push('every curve runs three bandwidths past its extreme observations, so the ends are ' +
              'smoothing rather than data');
  doubts.push('all rows share one density-to-height scale, so a tall ridge really is denser than ' +
              'a short one; scaling each row to its own peak would make every group look alike');
  if (small) {
    doubts.push('<i>' + CK.esc(String(small)) + ' row' + (small === 1 ? '' : 's') + ' had fewer than ' +
                CK.esc(String(P.minN)) + ' points</i>, so no curve was estimated for them - the ' +
                'observations are drawn as a rug on the baseline instead');
  }
  if (flat) {
    doubts.push('<i>' + CK.esc(String(flat)) + ' row' + (flat === 1 ? ' is' : 's are') + ' constant</i>, ' +
                'which has no density at all - the limit is a spike of infinite height and zero ' +
                'width - so a single mark stands on the baseline');
  }
  if (P.refused) {
    doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                ' refused</i> for not being a finite number - counted, never silently dropped');
  }
  if (thinned) {
    doubts.push('the curve in ' + CK.esc(String(thinned)) + ' row' + (thinned === 1 ? '' : 's') +
                ' is evaluated from every k-th value of the sorted sample; the bandwidth and the ' +
                'quoted medians come from the whole of it');
  }
  if (!cfg.fill) {
    doubts.push('unfilled, so curves cross rather than occlude - easier to trace, harder to ' +
                'attribute when three ridges pass through one point');
  }

  var caption = '<b>' + CK.esc(String(totalN)) + '</b> value' + (totalN === 1 ? '' : 's') +
    ' in <b>' + CK.esc(String(rows.length)) + '</b> row' + (rows.length === 1 ? '' : 's') + ', ' +
    '<b>' + CK.esc(String(curves)) + '</b> as a Gaussian density and <b>' +
    CK.esc(String(small + flat)) + '</b> as raw observations, ordered ' + CK.esc(order) + '. ' +
    'overlap <b>' + CK.esc(CK.fmt(overlap)) + '</b> row height' + (overlap === 1 ? '' : 's') + '. ' +
    '<span class="ck-aside">' + doubts.join('; ') + '.</span>';

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * The three settings do three different kinds of work and it is worth being explicit about
 * which. `overlap` is pure geometry — it scales the curve height against the row pitch and
 * changes nothing statistical. `fill` decides whether a row occludes the one behind it or merely
 * crosses it. `sort` reorders the rows, and only `peak` needs the densities to exist first,
 * which is why every curve is evaluated before anything is placed.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settled settings: `overlap`, `fill`, `sort`
 * @returns `{ W, H, marks, note }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable values were refused and counted while reading
 *
 * @example rdRender(P, { overlap: 1.5, fill: true, sort: 'given' }).marks.length;
 */
function rdRender(P, cfg) {
  var gs = P.groups, ng = gs.length;
  var marks = [], i, j, g;

  var overlap = Number(cfg.overlap);
  if (!isFinite(overlap) || overlap < 0) { overlap = 0; }
  if (overlap > 3) { overlap = 3; }

  /* Every curve is evaluated before anything is placed, because sorting by peak needs the peaks
     and the shared height scale needs the tallest density on the card. */
  var rows = [], lo = Infinity, hi = -Infinity, maxD = 0;
  for (i = 0; i < ng; i++) {
    g = gs[i];
    var r = { g: g, ord: i, density: false, grid: null, dens: null, peak: 0, peakAt: 0 };
    if (g.n > 0) {
      if (g.n >= P.minN && !g.constant && g.h0 > 0) {
        var glo = g.min - 3 * g.h0;
        var ghi = g.max + 3 * g.h0;
        if (!(ghi > glo)) { ghi = glo + 1; }
        r.grid = linGrid(glo, ghi, P.grid);
        r.dens = kdeCurve(g.sample, g.h0, r.grid, P.tailZ);
        r.density = true;
        for (j = 0; j < r.dens.length; j++) {
          if (r.dens[j] > r.peak) { r.peak = r.dens[j]; r.peakAt = r.grid[j]; }
        }
        if (r.peak > maxD) { maxD = r.peak; }
        if (glo < lo) { lo = glo; }
        if (ghi > hi) { hi = ghi; }
      } else {
        r.peakAt = g.med;
        if (g.min < lo) { lo = g.min; }
        if (g.max > hi) { hi = g.max; }
      }
    }
    rows.push(r);
  }

  /* Ordering. The default keeps the order the data supplied, because a ridgeline of months in
     calendar order is the commonest case and re-sorting it would be vandalism. The other two
     sort largest to the top, which puts the ridge line the eye follows on a consistent side.
     The tie-break is the original index, so the order is total and a redraw cannot reshuffle. */
  if (cfg.sort === 'median' || cfg.sort === 'peak') {
    rows.sort(function (a, b) {
      var av = cfg.sort === 'peak' ? a.peakAt : a.g.med;
      var bv = cfg.sort === 'peak' ? b.peakAt : b.g.med;
      if (!a.g.n && !b.g.n) { return a.ord - b.ord; }
      if (!a.g.n) { return 1; }
      if (!b.g.n) { return -1; }
      if (bv !== av) { return bv - av; }
      return a.ord - b.ord;
    });
  }

  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) {
    /* Zero spread across every row: half the magnitude either side, so the marks have somewhere
       to stand and the axis has ticks. All-zero data has no magnitude to halve. */
    var e = Math.abs(lo) * 0.5 || 0.5;
    lo -= e; hi += e;
  }

  var ax = axisTicks(lo, hi, 6);
  var vLabels = [], names = [];
  for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }
  for (i = 0; i < rows.length; i++) { names.push(rows[i].g.name); }

  var nameW = 0;
  for (i = 0; i < names.length; i++) { nameW = Math.min(140, Math.max(nameW, tw(names[i]))); }

  var footCap = P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit;
  var padT = 12, padR = 16;
  var padB = 22 + (footCap ? 12 : 0);
  var padL = Math.round(nameW) + 12;

  /* Row pitch shrinks as rows are added, with a floor, so four groups get generous rows and
     twenty still fit on a card somebody will scroll past rather than into. */
  var rowH = rows.length <= 1 ? 120 : Math.max(18, Math.min(60, 300 / rows.length));
  var curveH = rowH * (1 + overlap);
  var H = Math.round(padT + curveH + (Math.max(1, rows.length) - 1) * rowH + padB);
  var W = P.W0;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  var xS = CK.scale([ax.lo, ax.hi], [plot.x0, plot.x1]);
  var hS = CK.scale([0, maxD > 0 ? maxD : 1], [0, curveH]);

  /* The gridlines run the full height of the stack rather than per row: a ridgeline is read
     across rows, and a rule that stops at a row boundary makes the comparison harder. */
  for (i = 0; i < ax.ticks.length; i++) {
    var xv = xS(ax.ticks[i]);
    marks.push(mLine(xv, plot.y0, xv, plot.y1, 'ck-rule'));
    marks.push(mText(xv, plot.y1 + 13, vLabels[i], 'ck-tk', 'middle'));
  }
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  /* Back to front: row 0 is the top and the furthest away, so it is painted first and every
     later row covers it. This loop order IS the occlusion, which is why it is not a detail. */
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    g = row.g;
    var colour = CK.hue(row.ord);
    var base = padT + curveH + i * rowH;
    var kids = [];

    marks.push(mText(plot.x0 - 6, base - 2, clipTo(g.name, Math.max(20, padL - 10)), 'ck-tk', 'end'));

    if (!g.n) {
      /* An empty row keeps its place and its name. Collapsing it would move every row after it,
         and a reader comparing two renders would be comparing different positions. */
      kids.push(mLine(plot.x0, base, plot.x1, base, 'ck-base'));
      marks.push({ t: 'g', a: { 'data-series': String(row.ord), 'class': 'ck-ser' }, kids: kids });
      continue;
    }

    if (row.density) {
      var d = '';
      for (j = 0; j < row.grid.length; j++) {
        d += (j === 0 ? 'M' : 'L') + fin(xS(row.grid[j])) + ' ' + fin(base - hS(row.dens[j]));
      }
      if (cfg.fill) {
        /* Closed back along the baseline so the fill has a floor. The fill is opaque enough to
           hide what is behind it, which is the occlusion the caption warns about; making it
           translucent would look kinder and would make three overlapping ridges unreadable. */
        d += 'L' + fin(xS(row.grid[row.grid.length - 1])) + ' ' + fin(base) +
             'L' + fin(xS(row.grid[0])) + ' ' + fin(base) + 'Z';
        kids.push(mPath(d, { fill: colour, 'fill-opacity': '0.82', stroke: colour,
                             'stroke-width': '1.2', 'stroke-linejoin': 'round', 'class': 'ck-ridge' }));
      } else {
        kids.push(mPath(d, { fill: 'none', stroke: colour, 'stroke-width': '1.5',
                             'stroke-linejoin': 'round', 'class': 'ck-ridge' }));
      }
    } else {
      /* Refused a curve. The observations stand on the baseline as a rug, which is the honest
         picture of a sample too small to smooth - and a constant group becomes one tall mark,
         which is the honest picture of no spread at all. */
      for (j = 0; j < g.rug.length; j++) {
        kids.push(mLine(xS(g.rug[j]), base, xS(g.rug[j]), base - Math.min(rowH * 0.6, 14), 'ck-rug'));
      }
      kids.push(mText(plot.x1, base - 3, g.constant ? 'flat' : 'n ' + g.n, 'ck-warn', 'end'));
    }

    kids.push(mLine(plot.x0, base, plot.x1, base, 'ck-base'));

    var hit = mRect(plot.x0, base - rowH + 1, plot.x1 - plot.x0, rowH,
                    { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    hit.ti = g.name + '  \u00b7  n ' + g.n +
             '  \u00b7  median ' + CK.fmt(g.med) +
             '  \u00b7  ' + CK.fmt(g.min) + ' to ' + CK.fmt(g.max) +
             (row.density ? '  \u00b7  peak near ' + CK.fmt(row.peakAt) +
                            '  \u00b7  bandwidth ' + CK.fmt(g.h0)
                          : '  \u00b7  no density: ' + (g.constant ? 'constant' : 'n below ' + P.minN)) +
             (g.refused ? '  \u00b7  ' + g.refused + ' refused' : '');
    kids.push(hit);

    marks.push({ t: 'g', a: { 'data-series': String(row.ord), 'class': 'ck-ser' }, kids: kids });
  }

  if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, footCap, 'ck-cap-ax', 'middle')); }

  var any = false;
  for (i = 0; i < rows.length; i++) { if (rows[i].g.n > 0) { any = true; } }
  if (!any) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, note: rdNote(P, cfg, { lo: ax.lo, hi: ax.hi }, rows, overlap) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions above the browser needs, in dependency order. Shipped as their own source rather
   than restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, axisTicks, mLine, mText, mRect, mPath,
                 kdeCurve, linGrid, rdNote, rdRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block
 * early, and so that no group name can put an arrow function's two characters into a file that
 * is contractually free of them. Backticks go for the same reason; the two Unicode line
 * separators go because they are newlines to a JS parser and not to `JSON.stringify`.
 *
 * @example jsLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u0060/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** One display-list mark as SVG markup, for the static render that ships in `card.html`. */
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
  const own = '.ck-ridgeline[data-card="' + id + '"]';
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
 * Nothing here names a colour: every value is a desk token, so the light switch is the only
 * thing that has to know anything. `prefers-color-scheme` is deliberately absent — the desk is
 * one document open in two viewers that want different answers, and the OS gives both the same.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-warn', 'fill: var(--ink-faint); font-size: 8.5px; letter-spacing: .06em;'],
    /* The baseline under each ridge is furniture, not an axis: it separates rows and should not
       compete with the one real axis at the bottom of the stack. */
    ['.ck-plot .ck-base', 'stroke: var(--rule); stroke-width: .8; fill: none;'],
    ['.ck-plot .ck-rug', 'stroke: var(--ink-dim); stroke-width: 1; opacity: .7;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-ridgeline">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="ridgeline settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('overlap') + '">overlap</label>\n' +
    '    <input id="' + f('overlap') + '" name="overlap" type="number" min="0" max="3" step="0.25" ' +
           'value="' + CK.esc(defaults.overlap) + '">\n' +
    '    <label for="' + f('fill') + '">fill</label>\n' +
    '    <input id="' + f('fill') + '" name="fill" type="checkbox"' +
           (defaults.fill ? ' checked' : '') + '>\n' +
    '    <label for="' + f('sort') + '">order</label>\n' +
    '    <select id="' + f('sort') + '" name="sort">' +
         opt('given', 'as supplied', defaults.sort) +
         opt('median', 'by median', defaults.sort) +
         opt('peak', 'by density peak', defaults.sort) + '</select>\n' +
    '    <p class="ck-set-foot">overlap is how many extra row heights the tallest curve rises ' +
         'into the rows above; 0 keeps every curve inside its own row. Filled curves occlude the ' +
         'row behind them, which is what overlap costs.</p>\n' +
    '  </div>\n' +
    /* The picture ships drawn: a card whose plot only exists once a script has run is blank in a
       static render, and blank if one other card on the desk fails to parse. */
    '  <svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped estimator, a display-list renderer, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardJs} before
 * it is returned.
 *
 * @param id       the card's id, used as its `CK.build` key
 * @param payload  the shipped samples, bandwidths and summaries
 * @param settings the defaults object `CK.settings` reconciles against
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, settings) {
  const src =
    '/* ridgeline card: one bandwidth per row, computed in Node from that row complete sample.\n' +
    '   The estimator and the layout below are the source that drew the card that shipped, so\n' +
    '   changing overlap or the ordering re-runs them rather than a second implementation. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(settings) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where ridgeline decisions live. */\n' +
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
    '     a render that added marks would stack a second set of ridges on the first. */\n' +
    '  function render(cfg) {\n' +
    '    var out = rdRender(P, cfg), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so\n' +
    '       it may be assigned rather than parsed out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardJs(src, 'cardkit/ridgeline');
}

/**
 * Build one ridgeline card from one data block.
 *
 * Every bandwidth and every quoted statistic comes from the COMPLETE sample, here, once. Only
 * the observations the browser re-evaluates a curve from are thinned.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data            an axis, no rows, captioned "no data"; no density is estimated
 *   one observation    below the minimum n, so no curve: one rug tick on the baseline, the row
 *                      labelled with its n, and the caption saying why
 *   two identical      the same, and additionally constant
 *   all values equal   ZERO SPREAD. A kernel density of a constant sample does not exist — the
 *                      limit is a spike of infinite height and zero width — so the row draws one
 *                      rug tick, is marked "flat", and the caption says no density was
 *                      estimated. Nothing divides by zero: the constant case is refused before
 *                      the bandwidth is used
 *   fewer than 8       refused a curve on purpose; the observations are a rug instead
 *   an extreme outlier the shared axis reaches it and every ridge compresses toward one side —
 *                      which is what a shared axis means, and the tooltip still gives each row
 *                      its own range
 *   negative values    nothing special; the axis simply spans them
 *   20 groups          the row pitch shrinks to its floor of 18px and the card grows taller
 *   n = 10,000         bandwidth exact; the curve is evaluated from at most 1,200 values per row
 *                      (less when many rows share the 12,000 budget), taken as every k-th of the
 *                      sorted sample so both tails survive
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ groups: [{ name, values }], xLabel, unit }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused and
 *                 counted while reading
 *
 * @example
 * build({
 *   id: 'temps',
 *   title: 'daily high by month',
 *   data: { xLabel: 'high', unit: 'C',
 *           groups: [{ name: 'jan', values: [2, 3, 3, 4, 5, 5, 6, 7, 8, 9] },
 *                    { name: 'feb', values: [3, 4, 5, 5, 6, 7, 7, 8, 9, 11] }] },
 *   ord: 55,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'ridgeline' : id);
  const read = readData(data);
  const ng = read.groups.length;

  const perGroup = ng ? Math.max(SAMPLE_FLOOR, Math.min(SAMPLE_CAP, Math.floor(SAMPLE_BUDGET / ng)))
                      : SAMPLE_CAP;

  const groups = read.groups.map((g) => {
    const s = sortAsc(g.values);
    const n = s.length;
    const sample = thin(s, perGroup);
    return {
      name: g.name,
      refused: g.refused,
      n,
      min: n ? s[0] : 0,
      max: n ? s[n - 1] : 0,
      med: quantile7(s, 0.5),
      constant: !n || s[0] === s[n - 1],
      h0: n ? silverman(s) : 0,
      sample,
      thinned: s.length > sample.length,
      rug: thin(s, RUG_CAP),
    };
  });

  const P = {
    W0,
    minN: MIN_N,
    grid: GRID,
    tailZ: TAIL_Z,
    unit: read.unit,
    xLabel: read.xLabel,
    refused: read.refused,
    groups,
  };

  const seed = rdRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      groups: ng,
      values: read.kept,
      refused: read.refused,
      minN: MIN_N,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed),
    css: cardCss(cardId),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
