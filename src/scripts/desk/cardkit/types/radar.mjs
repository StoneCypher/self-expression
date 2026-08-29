/**
 * `radar` -- a radar/spider chart, drawn honestly and told on itself in its own caption.
 *
 * This is a chart with real problems, and the card says so where the reader will see it rather
 * than in a comment nobody opens. Two of them are not matters of taste:
 *
 *   1. **Area is the square of value.** The eye reads the enclosed shape, and a series twice as
 *      far out on every axis encloses four times the area. So a 2x difference in the numbers
 *      looks like a 4x difference in the picture, always, in every radar chart ever drawn. This
 *      is not a flaw in this implementation; it is what a radial axis does, and nothing short of
 *      a square-root radial scale fixes it -- which would then make the axis labels lie instead.
 *   2. **The shape depends on the axis order, which is arbitrary.** Permuting the axes permutes
 *      the polygon, and the enclosed area changes with it: the area is proportional to the sum of
 *      products of ADJACENT radii, so which axes sit next to each other decides how big the shape
 *      looks. The card measures this rather than asserting it -- it searches axis orders for the
 *      smallest and largest area the very same numbers can enclose, and prints the swing. On real
 *      data the swing is routinely tens of per cent, and none of it is data.
 *
 * Everything else here follows from taking those two seriously. Series are capped, because past
 * half a dozen overlapping polygons the card is a plaid and no shape can be traced. `shared`
 * scaling is offered but flagged, because one scale across axes with different units compares
 * apples to volts. A negative value is refused rather than clamped, because clamping it to zero
 * changes the area -- the thing the eye actually reads -- by an amount the reader will attribute
 * to the data.
 *
 * @see ./parallel.mjs -- the same many-variable comparison without the area artefact
 * @see ./chart.mjs -- when the axes share a unit, a grouped column chart says it without the trap
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
 * @example loadKit().hue(2);   // 'var(--ck-s3)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/radar: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/radar: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/** Outer radius in user units. The viewBox scales, so this is a ratio and not a size. */
const R_MAX = 108;

/** How many grid rings. Four is enough to read a quarter without becoming a target. */
const RINGS = 4;

/**
 * The most series this card will draw, and why the number is small.
 *
 * Radar polygons overlap by construction -- they all start at the same centre and radiate through
 * the same spokes -- so every series added multiplies the number of crossings rather than adding
 * to them. Past six the card is a plaid: no single shape can be traced from one axis to the next,
 * which is the only thing a radar chart is for. Series past the cap are NAMED in the caption
 * rather than silently dropped.
 */
const SERIES_MAX = 6;

/** The most axes worth drawing. Past this the spokes are closer than their own labels. */
const AX_MAX = 16;

/** Past this many axes the exact area swing is too expensive and a local search stands in. */
const EXACT_AX = 8;

/** How long an axis or series label may be before it is clipped, in px at the label size. */
const LAB_MAX = 74;

/** The two things `scale` may say, and the two things `gridShape` may say. */
const SCALE_MODES = ['per-axis', 'shared'];
const GRID_SHAPES = ['polygon', 'circle'];

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it.
 *
 * @example defaults.scale;   // 'per-axis'
 */
export const defaults = { fill: true, scale: 'per-axis', gridShape: 'polygon' };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'radar'
 */
export const meta = {
  name: 'radar',
  summary:
    'A radar chart that reports its own two lies: enclosed area grows as the square of the ' +
    'values, and the shape changes when the arbitrary axis order does.',
  shape:
    '{ axes: [{ key, label, max }], series: [{ name, values: { key: number } }] } -- ' +
    'max is optional and is raised to the data rather than clipping it; at most ' + SERIES_MAX +
    ' series are drawn and the rest are named; a series holding a negative or non-numeric value ' +
    'is refused whole, because a hole filled with zero changes the area the eye reads',
  defaults: { ...defaults },
};

/* -- small shared arithmetic ----------------------------------------------------------- */

/**
 * Round a number to two decimals, refusing to emit one that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console.
 *
 * @throws {Error} when `v` is NaN or infinite
 * @example n(107.999, 'radius');   // 108
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/radar: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Round to four decimals -- fractions need more resolution than pixels do. */
function n4(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/radar: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 10000) / 10000;
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
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a name containing `</script>` cannot close the block early, and so
 * no name can put `=>` into a file that is contractually free of arrow functions. The question
 * mark goes too, so a name reading "ready?.set" cannot look like optional chaining to a guard
 * that scans raw text.
 *
 * @example jsonLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
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
  const own = '.ck-radar[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/* -- the build-time guard -------------------------------------------------------------- */

/**
 * Blank comment and string bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose. Offsets are preserved
 * so a reported position still means something, and regex literals are recognised, because
 * otherwise the scanner desyncs on a quote inside one and blanks real code -- turning a false
 * positive into the far worse false negative.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment and string contents replaced by spaces
 *
 * @example blankLiterals("var s = 'const';").indexOf('const');   // -1
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
 * `Function.prototype.toString()`, which carries their comments along, so the backtick closes the
 * surrounding template literal early. The character is never written here; it is reached for as
 * `String.fromCharCode(96)`, which cannot be mistyped and cannot be mis-decoded.
 *
 * Two scans, deliberately different: backtick, arrow and optional chain in the RAW text, where
 * none can appear innocently; `const`, `let` and `class` only OUTSIDE comments and strings,
 * because all three are ordinary English and a guard that fires on prose gets switched off.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming every token it found and where each one is
 *
 * @example guardEmitted('var a = 1;', 'demo');   // 'var a = 1;'
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

  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) {
    throw new Error('cardkit/radar: refusing to emit ' + where + ' -- ' + bad.join('; '));
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
 * @example assertFinite([{ t: 'circle', a: { r: 4 } }], 'default');   // undefined
 */
function assertFinite(marks, where) {
  for (const m of marks) {
    if (m.a) {
      for (const k of Object.keys(m.a)) {
        const v = m.a[k];
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error('cardkit/radar: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/radar: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/* -- reading the data ------------------------------------------------------------------ */

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * The strict rule -- a series is drawn only when every axis holds a finite value that is not
 * negative -- is the one decision here worth arguing with, so here is the argument. The thing a
 * reader takes from a radar chart is the enclosed shape, and the shape is a function of every
 * vertex. Filling a hole with zero pulls that vertex to the centre and shrinks the area by an
 * amount the reader will read as data. Clamping a negative to zero does the same. Skipping the
 * vertex and joining its neighbours does it too, and hides that anything happened. There is no
 * repair that leaves the area honest, so the series is refused and counted, and the caption names
 * both the count and the reason.
 *
 * A stated `max` below the data is RAISED to the data rather than clipping it. Clipping would
 * draw a value at the outer ring as though it were the maximum, which is a claim the data
 * contradicts; the caption names the axis and both numbers.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the counts
 *
 * @example readData({ axes: ['a'], series: [{ name: 's', values: { a: 3 } }] }).axes[0].max;   // 3
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawAxes = Array.isArray(d.axes) ? d.axes : [];
  const rawSeries = Array.isArray(d.series) ? d.series : [];

  const bad = { noKey: 0, dupeAxis: 0, extraAxes: 0, negVals: 0, badVals: 0,
                droppedSeries: 0, badSeries: 0 };
  const axes = [];
  const seenKeys = new Set();

  for (const raw of rawAxes) {
    const o = raw && typeof raw === 'object' ? raw : { key: raw };
    if (o.key == null || String(o.key) === '') { bad.noKey++; continue; }
    const key = String(o.key);
    if (seenKeys.has(key)) { bad.dupeAxis++; continue; }
    seenKeys.add(key);
    if (axes.length >= AX_MAX) { bad.extraAxes++; continue; }
    axes.push({
      key,
      label: String(o.label == null ? key : o.label),
      wantMax: Number.isFinite(Number(o.max)) && Number(o.max) > 0 ? Number(o.max) : null,
    });
  }

  const series = [];
  const extra = [];
  for (const raw of rawSeries) {
    if (!raw || typeof raw !== 'object') { bad.badSeries++; continue; }
    const name = String(raw.name == null ? 'series ' + (series.length + 1) : raw.name);
    const vals = raw.values && typeof raw.values === 'object' ? raw.values : {};
    const out = [];
    let ok = true;
    for (const ax of axes) {
      const v = vals[ax.key];
      if (v == null || typeof v === 'boolean' || (typeof v === 'string' && !String(v).trim())) {
        bad.badVals++; ok = false; continue;
      }
      const num = Number(v);
      if (!Number.isFinite(num)) { bad.badVals++; ok = false; continue; }
      if (num < 0) { bad.negVals++; ok = false; continue; }
      out.push(num);
    }
    if (!ok || out.length !== axes.length) { bad.droppedSeries++; continue; }
    if (series.length >= SERIES_MAX) { extra.push(name); continue; }
    series.push({ name, vals: out });
  }

  /* Per-axis maxima. The floor is the data; a stated max only ever raises it. */
  const raised = [];
  axes.forEach((ax, a) => {
    let hi = 0;
    for (const s of series) if (s.vals[a] > hi) hi = s.vals[a];
    ax.dataMax = hi;
    if (ax.wantMax != null && ax.wantMax >= hi) ax.max = ax.wantMax;
    else {
      ax.max = hi;
      if (ax.wantMax != null) raised.push([ax.label, ax.wantMax, hi]);
    }
    ax.zero = !(ax.max > 0);
  });

  const shared = axes.reduce((m, ax) => Math.max(m, ax.max), 0);

  return { axes, series, extra, bad, raised, shared,
           zeroAxes: axes.filter((a) => a.zero).map((a) => a.label) };
}

/* -- the chart's own confession, measured ----------------------------------------------- */

/**
 * The area a regular polygon encloses, given one radius per vertex in drawn order.
 *
 * With the vertices at equal angles the area collapses to a tidy form -- half the sine of the
 * step angle, times the sum of products of ADJACENT radii around the ring. That form is the whole
 * argument: the area does not depend on the multiset of values, it depends on which values are
 * NEXT TO each other, and their order is a choice nobody made deliberately.
 *
 * Zero for fewer than three vertices, because two points enclose nothing and one encloses less.
 *
 * @param rs radii in drawn order
 * @returns the enclosed area in the same squared units as the radii
 *
 * @example polyArea([1, 1, 1]);   // 1.299...
 */
function polyArea(rs) {
  const m = rs.length;
  if (m < 3) return 0;
  let s = 0;
  for (let i = 0; i < m; i++) s += rs[i] * rs[(i + 1) % m];
  return 0.5 * Math.sin((2 * Math.PI) / m) * s;
}

/**
 * The smallest and largest area the SAME numbers can enclose under some axis order.
 *
 * This is the card's evidence for its own second warning, and it is measured rather than
 * asserted. Two regimes:
 *
 *   - up to {@link EXACT_AX} axes, every cyclic order is tried. The first position is held fixed,
 *     which removes rotations without removing any distinct shape, so eight axes is 5040 orders
 *     rather than 40320 -- exact, and cheap enough to do per series.
 *   - beyond that, a deterministic pairwise-swap search runs from two starts (descending and
 *     alternating) and climbs to a local optimum in each direction. The answer is then a bound
 *     rather than the truth, and the caption says "at least", because claiming an exact swing
 *     from a heuristic would be the same species of overreach the card is warning about.
 *
 * @param rs radii for one series, in the given axis order
 * @returns `{ lo, hi, exact }` -- areas, and whether the search was exhaustive
 *
 * @example areaSwing([1, 2, 3]).exact;   // true
 */
function areaSwing(rs) {
  const m = rs.length;
  if (m < 3) return { lo: 0, hi: 0, exact: true };

  if (m <= EXACT_AX) {
    let lo = Infinity;
    let hi = -Infinity;
    const head = rs[0];
    const tail = rs.slice(1);
    const walk = (chosen, left) => {
      if (!left.length) {
        const a = polyArea([head].concat(chosen));
        if (a < lo) lo = a;
        if (a > hi) hi = a;
        return;
      }
      for (let i = 0; i < left.length; i++) {
        walk(chosen.concat([left[i]]), left.slice(0, i).concat(left.slice(i + 1)));
      }
    };
    walk([], tail);
    return { lo, hi, exact: true };
  }

  const climb = (start, wantMax) => {
    const o = start.slice();
    let best = polyArea(o);
    for (let round = 0; round < 60; round++) {
      let did = false;
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          const t = o[i]; o[i] = o[j]; o[j] = t;
          const got = polyArea(o);
          if (wantMax ? got > best : got < best) { best = got; did = true; }
          else { const u = o[i]; o[i] = o[j]; o[j] = u; }
        }
      }
      if (!did) break;
    }
    return best;
  };

  const desc = rs.slice().sort((a, b) => b - a);
  /* The organ-pipe arrangement -- largest in the middle, then alternating outward -- is the known
     maximiser of a cyclic sum of adjacent products, so the climb starts there and usually has
     nothing left to do. The reversed one is a decent opening for the minimum. */
  const pipe = [];
  desc.forEach((v, i) => { if (i % 2) pipe.push(v); else pipe.unshift(v); });
  return { lo: climb(pipe.slice().reverse(), false), hi: climb(pipe, true), exact: false };
}

/* -- saying what the picture shows ------------------------------------------------------ */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets, per scale mode.
 *
 * The two confessions come first and are never conditional on anything but there being a shape at
 * all. A reader who takes a radar chart at face value has been misled by the medium rather than
 * by the data, and the only correction that works is one they read before they look.
 *
 * @returns `{ aria, note }`, both plain text
 * @example describe(read, 'per-axis', swing).note;   // 'area grows as the square of ...'
 */
function describe(R, mode, swing) {
  const nA = R.axes.length;
  const nS = R.series.length;
  const census = plural(nS, 'series', 'series') + ' across ' + plural(nA, 'axis', 'axes');

  if (!nA) {
    return { aria: 'An empty radar chart: no axes were given, so there is nothing to radiate ' +
                   'from the centre.', note: 'no axes.' };
  }
  if (!nS) {
    return { aria: 'A radar chart of ' + plural(nA, 'axis', 'axes') + ' with no drawable series. ' +
                   'The grid is drawn so the card keeps its place, but nothing is plotted on it.',
             note: 'no drawable series, so only the grid is drawn.' };
  }

  const squared = 'area grows as the square of the values, so a series twice as far out on every ' +
    'axis encloses four times the shape and reads as four times as much; that is what a radial ' +
    'axis does and no radar chart escapes it';

  const orderWarn = nA < 3
    ? 'with fewer than three axes there is no enclosed area at all, so this is a set of spokes ' +
      'rather than a shape'
    : swing && swing.collapses
      ? 'the shape depends on the axis order, which nothing in the data chose: the numbers for ' +
        swing.name + ' enclose no area at all under some axis orders and ' + CK.fmt(swing.hi) +
        ' square units under others, so the outline is an artefact of a list'
    : swing && swing.pct != null
      ? 'the shape depends on the axis order, which nothing in the data chose: the same numbers ' +
        'for ' + swing.name + ' enclose ' + (swing.exact ? '' : 'at least ') + swing.pct +
        '% more area under the best axis order than under the worst, so the outline is partly an ' +
        'artefact of a list'
    : 'the shape depends on the axis order, which nothing in the data chose';

  const scaleText = mode === 'shared'
    ? 'one scale across every axis, so the rings mean the same number everywhere -- which is only ' +
      'honest when the axes share a unit, and this card cannot check that they do'
    : 'each axis scaled to its own maximum, so the rings are quarters of that axis and NOT ' +
      'comparable between spokes';

  /* The degeneracy that catches everybody. Per-axis scaling takes each axis's maximum from the
     data, so with a single series that maximum IS the series' own value on every axis -- every
     vertex lands on the outer ring and the polygon is a perfect regular n-gon whatever the numbers
     were. It looks like a finished chart and carries nothing. Found by measuring the area swing
     and getting exactly zero. */
  const regular = mode === 'per-axis' && nS === 1 && nA >= 3 &&
                  R.axes.every((ax) => ax.wantMax == null)
    ? ' careful: with one series and no stated maxima, every axis maximum IS this series own ' +
      'value, so the outline is a regular ' + nA + '-gon whatever the numbers are and its shape ' +
      'carries nothing. give the axes a max, switch to the shared scale, or add a series to ' +
      'compare against.'
    : '';

  const zero = R.zeroAxes.length
    ? ' ' + plural(R.zeroAxes.length, 'axis has', 'axes have') + ' a maximum of zero (' +
      R.zeroAxes.join(', ') + '); every series sits at the centre on ' +
      (R.zeroAxes.length === 1 ? 'that spoke' : 'those spokes') + ', because zero out of zero is ' +
      'the centre and not the midpoint.'
    : '';

  const raised = R.raised.length
    ? ' ' + plural(R.raised.length, 'stated maximum was', 'stated maxima were') +
      ' below the data and was raised rather than clipping it (' +
      R.raised.map((c) => c[0] + ': ' + CK.fmt(c[1]) + ' to ' + CK.fmt(c[2])).join('; ') + ').'
    : '';

  const extra = R.extra.length
    ? ' ' + plural(R.extra.length, 'series was', 'series were') + ' past the limit of ' +
      SERIES_MAX + ' and is not drawn: ' + R.extra.join(', ') + '.'
    : '';

  const junk = [];
  if (R.bad.droppedSeries) junk.push(plural(R.bad.droppedSeries, 'series was', 'series were') +
    ' refused whole for holding a value that was negative or not a number, because filling the ' +
    'hole with zero would shrink the area the eye reads');
  if (R.bad.negVals) junk.push(plural(R.bad.negVals, 'value was', 'values were') + ' negative');
  if (R.bad.badVals) junk.push(plural(R.bad.badVals, 'value was', 'values were') +
    ' missing or not a number');
  if (R.bad.noKey) junk.push(plural(R.bad.noKey, 'axis', 'axes') + ' had no key');
  if (R.bad.dupeAxis) junk.push(plural(R.bad.dupeAxis, 'axis was', 'axes were') + ' a duplicate key');
  if (R.bad.extraAxes) junk.push(plural(R.bad.extraAxes, 'axis was', 'axes were') +
    ' past the limit of ' + AX_MAX);
  const junkText = junk.length ? ' ' + junk.join('; ') + '.' : '';

  const note = ('two things to know before reading this: ' + squared + '; and ' + orderWarn +
                '. ' + scaleText + '.' + regular + zero + raised + extra + junkText)
    .replace(/\s+/g, ' ').trim();
  const aria = ('Radar chart, ' + census + '. Two things to know before reading it: ' + squared +
                '; and ' + orderWarn + '. ' + scaleText + '.' + regular + zero + raised + extra +
                junkText).replace(/\s+/g, ' ').trim();
  return { aria, note };
}

/* -- the browser half ------------------------------------------------------------------- */

/**
 * Every ring, spoke, label and polygon as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so the
 * function a test calls here is textually the function the page runs.
 *
 * Radii arrive already normalised: `model.frac[mode][s][a]` is the value over that axis's maximum,
 * computed in Node. A vertex therefore sits at exactly `frac * rMax` from the centre, which is
 * the invariant the verification asserts -- and the reason the fraction is computed once, in one
 * place, rather than being rederived from a path string.
 *
 * @param model the precomputed model: axes, fractions, ring labels, colours
 * @param cfg   `{ fill, scale, gridShape }`
 * @returns `{ w, h, marks, verts }` -- `verts[s]` is the series' screen points, so a test can
 *          check the radius of a vertex without parsing a path
 *
 * @example radarGeom(model, { fill: true, scale: 'per-axis', gridShape: 'polygon' }).w;
 */
function radarGeom(model, cfg) {
  var a, s, k;
  var nA = model.nA;
  var mode = model.frac[cfg.scale] ? cfg.scale : 'per-axis';
  var frac = model.frac[mode];
  var ringLab = model.ringLab[mode];

  function r2(v) { return Math.round(v * 100) / 100; }

  if (!nA) { return { w: 100, h: 40, marks: [], verts: [] }; }

  var room = model.labW + 12;
  var size = 2 * (model.rMax + room);
  var c = size / 2;

  /* Angles start at twelve o'clock and run clockwise, which is what every reader expects and what
     makes the first axis in the list the one at the top. */
  var ang = [];
  for (a = 0; a < nA; a++) { ang.push(-Math.PI / 2 + (2 * Math.PI * a) / nA); }

  function pt(a2, rad) {
    return [r2(c + rad * Math.cos(ang[a2])), r2(c + rad * Math.sin(ang[a2]))];
  }

  var kids = [];

  /* A polygon ring needs three corners; with one or two axes it would be a line or a point, so
     the rings fall back to circles and the card still says how far out a value is. */
  var poly = cfg.gridShape !== 'circle' && nA >= 3;

  for (k = 1; k <= model.rings; k++) {
    var rad = (model.rMax * k) / model.rings;
    if (poly) {
      var d = '';
      for (a = 0; a < nA; a++) {
        var p = pt(a, rad);
        d += (a ? 'L' : 'M') + p[0] + ',' + p[1];
      }
      kids.push({ t: 'path', a: { d: d + 'Z', "class": 'ring' } });
    } else {
      kids.push({ t: 'circle', a: { cx: r2(c), cy: r2(c), r: r2(rad), "class": 'ring' } });
    }
    kids.push({ t: 'text', a: { x: r2(c + 3), y: r2(c - rad + 3), "class": 'ringlab' },
                s: ringLab[k - 1] });
  }

  for (a = 0; a < nA; a++) {
    var e = pt(a, model.rMax);
    kids.push({ t: 'line', a: { x1: r2(c), y1: r2(c), x2: e[0], y2: e[1], "class": 'spoke' } });
    var lp = pt(a, model.rMax + 7);
    var cosA = Math.cos(ang[a]);
    kids.push({ t: 'text',
                a: { x: lp[0], y: lp[1], "class": model.axZero[a] ? 'axlab zero' : 'axlab',
                     'dominant-baseline': 'middle',
                     'text-anchor': cosA > 0.2 ? 'start' : (cosA < -0.2 ? 'end' : 'middle') },
                s: model.axClip[a], ti: model.axTip[mode][a] });
  }

  var verts = [];
  for (s = 0; s < frac.length; s++) {
    var pts = [];
    for (a = 0; a < nA; a++) { pts.push(pt(a, frac[s][a] * model.rMax)); }
    verts.push(pts);

    if (nA >= 2) {
      var pd = '';
      for (a = 0; a < nA; a++) { pd += (a ? 'L' : 'M') + pts[a][0] + ',' + pts[a][1]; }
      if (nA >= 3) { pd += 'Z'; }
      kids.push({ t: 'path',
                  a: { d: pd, "class": 'poly', stroke: model.serCol[s],
                       fill: cfg.fill && nA >= 3 ? model.serCol[s] : 'none',
                       'fill-opacity': cfg.fill && nA >= 3 ? model.fillOp : 0 },
                  ti: model.serTip[mode][s] });
    }
    for (a = 0; a < nA; a++) {
      kids.push({ t: 'circle', a: { cx: pts[a][0], cy: pts[a][1], r: 2.4, "class": 'vtx',
                                    fill: model.serCol[s] }, ti: model.vtxTip[mode][s][a] });
    }
  }

  return { w: r2(size), h: r2(size), marks: kids, verts: verts };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every polygon on the second pass.
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
 * Nothing here names a colour; every value is a desk token. `prefers-color-scheme` is deliberately
 * absent: the desk is one document open in two viewers that want different answers.
 *
 * Hover lifts one polygon and dims the rest, in CSS alone. With overlapping shapes that is not a
 * nicety -- it is the only way to trace one series across the axes, and it is the reason the
 * series cap can be as high as six rather than three.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['svg.ck-rd', 'display: block; width: 100%; height: auto; max-height: 70vh; margin: 0 auto;'],
    ['svg.ck-rd text', 'font-family: var(--mono); font-size: 9px;'],

    ['.ck-rd .ring', 'fill: none; stroke: var(--ck-grid); stroke-width: 1;'],
    ['.ck-rd .spoke', 'stroke: var(--rule); stroke-width: 1;'],
    ['.ck-rd .ringlab', 'fill: var(--ink-faint); font-size: 8px;'],
    ['.ck-rd .axlab', 'fill: var(--ink-dim);'],
    ['.ck-rd .axlab.zero', 'fill: var(--ink-faint);'],
    ['.ck-rd .poly', 'stroke-width: 1.6; stroke-linejoin: round; transition: opacity .12s linear;'],
    ['.ck-rd .vtx', 'stroke: none;'],
    ['.ck-rd:hover .poly', 'opacity: .22;'],
    ['.ck-rd .poly:hover', 'opacity: 1;'],

    ['.ck-rd-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n' +
    '@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-rd .poly', 'transition: none;']]) +
    '\n}\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the web and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The part that changes with the settings is an
 * empty `<i>` the script fills with `textContent`.
 */
function cardHtml(id, title, R, said) {
  const e = CK.esc;

  const void_ = R.axes.length ? '' :
    '  <div class="ck-rd-void">nothing to draw &mdash; no axes were given</div>\n';

  const svg = R.axes.length
    ? '  <svg class="ck-rd" role="img" viewBox="0 0 100 100" aria-label="' + e(said.aria) + '"></svg>\n'
    : '';

  const legend = R.series.map((s, i) =>
    '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + e(s.name) + '</span>').join('');

  return '<section data-card="' + e(id) + '" class="ck-radar">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-scale">scale</label>\n' +
    '    <select id="' + e(id) + '-scale" name="scale">\n' +
    SCALE_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-gridShape">grid</label>\n' +
    '    <select id="' + e(id) + '-gridShape" name="gridShape">\n' +
    GRID_SHAPES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-fill">fill</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-fill" name="fill">\n' +
    '    <div class="ck-set-foot">fill makes the area easier to see and the area is the part ' +
    'that exaggerates, so turning it off is a reasonable way to read this chart.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(R.series.length)) + '</b> ' +
    (R.series.length === 1 ? 'series' : 'series') + ' across <b>' +
    e(String(R.axes.length)) + '</b> ' + (R.axes.length === 1 ? 'axis' : 'axes') +
    '. <i class="ck-rd-note">' + e(said.note) + '</i></div>\n' +
    (legend ? '  <div class="ck-legend">' + legend + '</div>\n' : '') +
    '</section>\n';
}

/**
 * The browser half: pick the scale the settings name, turn fractions into radii, paint.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated on the way in: they come out
 * of `localStorage`, which is a text file the viewer can edit, and a mode read straight out of it
 * and used as a property name would reach `Object.prototype` on the string `constructor`.
 */
function cardJs(id, model, inst) {
  const js =
    '/* radar card: maxima, fractions and the axis-order area swing computed in Node; only the\n' +
    '   web itself is drawn here, because the grid shape and the fill are viewer settings. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    radarGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-rd");\n' +
    '  var note = sec.querySelector(".ck-rd-note");\n\n' +
    '  function pick(v, list, fallback) {\n' +
    '    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }\n' +
    '    return fallback;\n' +
    '  }\n\n' +
    '  function draw(cfg) {\n' +
    '    var sc = pick(cfg.scale, MODEL.scales, DEF.scale);\n' +
    '    var gs = pick(cfg.gridShape, MODEL.grids, DEF.gridShape);\n' +
    '    if (note) { note.textContent = MODEL.notes[sc]; }\n' +
    '    if (!box || !MODEL.nA) { return; }\n' +
    '    var got = radarGeom(MODEL, { scale: sc, gridShape: gs, fill: cfg.fill !== false });\n' +
    '    paintList(box, got.marks);\n' +
    '    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);\n' +
    '    box.setAttribute("aria-label", MODEL.arias[sc]);\n' +
    '  }\n\n' +
    '  CK.settings(sec, DEF, draw);\n' +
    '});\n';
  return guardEmitted(js, id);
}

/**
 * Build one radar card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the measured area swing, every axis's
 *          maximum and every refusal count, so a reader can check the confession
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'skills',
 *   title: 'two candidates against the same rubric',
 *   data: {
 *     axes: [{ key: 'sql', label: 'SQL', max: 10 }, { key: 'ops', label: 'ops', max: 10 }],
 *     series: [{ name: 'a', values: { sql: 7, ops: 4 } }, { name: 'b', values: { sql: 5, ops: 9 } }],
 *   },
 *   ord: 55,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'radar' : id);
  const R = readData(data);
  const nA = R.axes.length;

  /* Fractions, one set per scale mode. `CK.scale` does the work everywhere the domain has width;
     an axis whose maximum is zero is the one place its zero-width guard is WRONG for this chart,
     because that guard parks an unknowable value at the midpoint of the range, and on a radial
     axis the midpoint is a specific claim -- half the maximum. Zero out of zero is the centre, so
     that case is written out here instead of borrowed. */
  const perAxis = R.axes.map((ax) => (ax.max > 0 ? CK.scale([0, ax.max], [0, 1]) : () => 0));
  const sharedScale = R.shared > 0 ? CK.scale([0, R.shared], [0, 1]) : () => 0;

  const frac = {
    'per-axis': R.series.map((s) => s.vals.map((v, a) => n4(perAxis[a](v), 'fraction'))),
    shared: R.series.map((s) => s.vals.map((v) => n4(sharedScale(v), 'fraction'))),
  };

  /* The swing is measured on the series that swings most, because that is the honest headline:
     a caption quoting the calmest series would understate the artefact it exists to warn about. */
  /* The swing is measured per scale mode, because the radii differ between them and a caption
     that quoted a number from the other mode would be describing a picture the reader is not
     looking at. Within a mode it is measured on the series that swings most: quoting the calmest
     one would understate the artefact the sentence exists to warn about. */
  const swings = {};
  for (const m of SCALE_MODES) {
    let swing = null;
    if (nA >= 3) {
      for (let s = 0; s < R.series.length; s++) {
        const got = areaSwing(frac[m][s].map((f) => f * R_MAX));
        if (!(got.hi > 0)) continue;
        /* A series with only two non-zero axes encloses NOTHING when they are placed apart and
           something when they are placed together, so the ratio is infinite and the honest report
           is the collapse rather than a percentage with nine digits in it. */
        const collapses = !(got.lo > 1e-9);
        const pct = collapses ? null : Math.round((got.hi / got.lo - 1) * 100);
        if (pct != null && !Number.isFinite(pct)) continue;
        if (!collapses && pct === 0) continue;         // a regular polygon has nothing to report
        const rank = collapses ? Infinity : pct;
        const bestRank = !swing ? -1 : (swing.collapses ? Infinity : swing.pct);
        if (!swing || rank > bestRank) {
          swing = { name: R.series[s].name, lo: n(got.lo, 'area'), hi: n(got.hi, 'area'),
                    pct, collapses, exact: got.exact };
        }
      }
    }
    swings[m] = swing;
  }

  const said = {};
  for (const m of SCALE_MODES) said[m] = describe(R, m, swings[m]);

  const axClip = R.axes.map((ax) => clip(ax.label, LAB_MAX));
  const labW = axClip.reduce((m, s) => Math.max(m, textW(s)), 0);

  /* Ring labels differ by mode on purpose. Under `shared` the rings are real numbers and are
     printed as such. Under `per-axis` a ring means a different number on every spoke, so printing
     any one of them would be a lie about the other spokes -- it gets the percentage instead, which
     is true everywhere. */
  const ringLab = {
    'per-axis': [],
    shared: [],
  };
  for (let k = 1; k <= RINGS; k++) {
    ringLab['per-axis'].push(Math.round((100 * k) / RINGS) + '%');
    ringLab.shared.push(CK.fmt((R.shared * k) / RINGS));
  }

  const axTip = {};
  const serTip = {};
  const vtxTip = {};
  for (const m of SCALE_MODES) {
    const topOf = (a) => (m === 'shared' ? R.shared : R.axes[a].max);
    axTip[m] = R.axes.map((ax, a) =>
      ax.label + ' \u00b7 ' + (topOf(a) > 0 ? 'full ring is ' + CK.fmt(topOf(a))
                                            : 'maximum is zero, everything sits at the centre'));
    serTip[m] = R.series.map((s) =>
      s.name + ' \u00b7 ' + R.axes.map((ax, a) => ax.label + ' ' + CK.fmt(s.vals[a])).join(' \u00b7 '));
    vtxTip[m] = R.series.map((s) =>
      R.axes.map((ax, a) =>
        s.name + ' \u00b7 ' + ax.label + ' ' + CK.fmt(s.vals[a]) +
        (topOf(a) > 0 ? ' of ' + CK.fmt(topOf(a)) : '')));
  }

  const model = {
    nA,
    rMax: R_MAX,
    rings: RINGS,
    fillOp: 0.18,
    labW: n(labW, 'labW'),
    axClip,
    axZero: R.axes.map((ax) => (ax.zero ? 1 : 0)),
    axTip,
    frac,
    ringLab,
    serCol: R.series.map((_, i) => CK.hue(i)),
    serTip,
    vtxTip,
    scales: SCALE_MODES.slice(),
    grids: GRID_SHAPES.slice(),
    notes: {},
    arias: {},
  };
  for (const m of SCALE_MODES) {
    model.notes[m] = said[m].note;
    model.arias[m] = said[m].aria;
  }

  /* The browser half is exercised here over every configuration a viewer can reach, so a
     degenerate input that would produce a NaN coordinate is caught at build time next to the data
     that caused it rather than at paint time, where the browser drops the attribute in silence. */
  if (nA) {
    for (const sc of SCALE_MODES) {
      for (const gs of GRID_SHAPES) {
        for (const fill of [true, false]) {
          const got = radarGeom(model, { scale: sc, gridShape: gs, fill });
          assertFinite(got.marks, sc + '/' + gs + '/fill ' + fill);
        }
      }
    }
  }

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'radar',
      axes: nA,
      series: R.series.length,
      seriesLimit: SERIES_MAX,
      seriesNotDrawn: R.extra,
      zeroAxes: R.zeroAxes,
      maxRaised: R.raised.map(([label, stated, actual]) => ({ label, stated, actual })),
      refused: { series: R.bad.droppedSeries, negativeValues: R.bad.negVals,
                 nonNumericValues: R.bad.badVals, axesWithoutKey: R.bad.noKey,
                 duplicateAxes: R.bad.dupeAxis, axesPastLimit: R.bad.extraAxes },
      maxima: R.axes.map((ax) => ({ label: ax.label, max: ax.max, stated: ax.wantMax })),
      areaSwing: swings,
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, said[defaults.scale]),
    css: cardCss(cardId),
    js: cardJs(cardId, model, { ...defaults }),
  };
}

/* Exported for the verifier only: the geometry the browser runs and the area arithmetic beneath
   the card's own confession, so a test can check that a vertex sits at the radius its value asks
   for using the same text the page gets. */
export { radarGeom, polyArea, areaSwing, readData };
