/**
 * `choropleth` -- regions shaded by a value joined to them, with the join reported out loud.
 *
 * The drawing is the easy half. `_geo` already knows how to get a region onto the page in three
 * projections without tearing it at the antimeridian or drawing its far side through its near
 * side, and this type does not reimplement one line of that. What it adds is the two things a
 * choropleth actually gets wrong.
 *
 * **The join.** A choropleth is a join between a shapefile and a value table, and a join is the
 * one operation in this whole card that can fail completely while looking fine. If the keys do
 * not match -- `ISO_A3` against `iso_a3`, a country renamed, a leading zero eaten by a
 * spreadsheet -- the map draws every unmatched region in the no-data colour, which reads to a
 * viewer as "there is no data for these places". Nothing errors. Nobody notices. So this card
 * counts the join four ways and prints all four in the caption every time, including when they
 * are zero: a statistic that appears only when it is bad is a statistic nobody learns to read.
 *
 * **The classification.** Where the class breaks fall decides what the map says, more than the
 * data does. The default is quantile and that is a considered choice, not a coin toss -- see
 * {@link RULES} for what each rule does and what it breaks.
 *
 * Everything is computed in Node: three projections of every region, twenty-one classifications
 * (seven class counts by three rules) and forty-two palettes. The browser picks one of each and
 * sets a class on a path. That is deliberate -- a viewer changing the class count must not pay
 * for a re-projection, and arithmetic that runs in Node is arithmetic a test can watch.
 *
 * @see ./_geo.mjs -- the projections, the seam, the horizon, the join and the guard
 * @see ./cartogram.mjs -- the other joined type, and the other answer to the same question
 */

import {
  CK, PROJECTIONS, SCALE_MIN, SCALE_MAX,
  fin, num, jsonLit, clean, plural, cssId, scoped,
  projector, projectionNote, centredOn, frameFor,
  regionPath, readRegions, readView, joinValues,
  builtinRegions, builtinValues, REGION_NOTE, guardEmitted,
} from './_geo.mjs';

/* ── constants ────────────────────────────────────────────────────────────────────────── */

/** How few and how many classes a reader can still tell apart on a map. */
const BIN_MIN = 3;
const BIN_MAX = 9;

/**
 * The three binning rules, and what each one is wrong about.
 *
 * `quantile` puts an equal *count* in every class. It is the default, and the reason is that
 * real regional data is skewed: incomes, populations, case rates and rainfall all have a long
 * right tail and a crowd near the bottom. Under equal-interval that crowd -- which is to say
 * almost every region -- lands in class one and the map becomes a single flat colour with two
 * outliers, showing nothing except that a maximum exists. Quantile always uses every class, so
 * the map always has contrast. What it costs is that the classes are not equal in *width*: two
 * regions in different classes may be a hair apart, and the legend is the only thing that says
 * so, which is why the legend prints the actual break values rather than "low" and "high".
 *
 * `equal` cuts the range into equal widths. It is the honest one when the reader's question is
 * about magnitude rather than rank -- a temperature map, a percentage -- and it is the wrong one
 * whenever the distribution is skewed, for the reason above.
 *
 * `jenks` minimises within-class variance, by Fisher's exact dynamic program rather than the
 * usual iterative approximation. It finds the natural gaps, which is what a reader believes a
 * class break means. What it costs is stability: add one region and every break can move, so two
 * jenks maps of the same quantity in different years are not comparable, and that is a real trap
 * because they look comparable.
 */
const RULES = ['quantile', 'equal', 'jenks'];

/** A sequential ramp for ordered data, a diverging one for data with a meaningful middle. */
const RAMPS = ['sequential', 'diverging'];

/**
 * Nine opacity steps of ONE hue, which is what a sequential ramp is.
 *
 * A sequential ramp must not use hue to carry order, and the reason is not taste. Hue is not
 * ordered -- there is no fact about red and green that makes one of them larger, so a reader
 * asked to rank a rainbow has to consult the legend for every single region and the map has
 * stopped being a map. Lightness *is* ordered, pre-attentively and without a legend, so one hue
 * at nine strengths reads as one scale. This is also why the diverging ramp gets exactly two
 * hues and a neutral in the middle: two ordered runs, meeting at a value that means something.
 */
const OPACITIES = [0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82, 0.92];

/** How much of the ink a no-data region gets. Enough to be a shape, too little to be a class. */
const NODATA_OPACITY = 0.05;

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * `scale` names the binning rule, not a zoom. That collision is real -- `map` uses `scale` for
 * the zoom -- and it is resolved by type rather than by renaming either: in this card's `data`,
 * a `scale` that is one of {@link RULES} is the rule and a `scale` that is a number is the zoom,
 * and `zoom` is accepted as an unambiguous alias. The setting itself is only ever the rule,
 * because the zoom belongs to the card's data rather than to the viewer, exactly as it does on
 * `map`.
 *
 * @example defaults.scale;   // 'quantile'
 */
export const defaults = {
  projection: 'equirectangular',
  bins: 5,
  scale: 'quantile',
  ramp: 'sequential',
  legend: true,
};

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'choropleth'
 */
export const meta = {
  name: 'choropleth',
  summary:
    'Regions shaded by a joined value, classed by quantile, equal interval or Fisher-Jenks ' +
    'natural breaks, with the join reported region by region.',
  shape:
    '{ features, key, values: [{ key, value, of }], unit, midpoint, projection, ' +
    'center: { lon, lat }, scale, zoom, bins, ramp, legend } -- ' +
    'features is GeoJSON whose Features carry a join key in the property named by key ' +
    '(default "key"), or is omitted for the twenty built-in coarse subregions; values joins ' +
    'to it by that key and may be a list of rows or a plain object of key to value; the ' +
    'optional "of" on a row is a denominator, used only when every matched row has one; scale names the ' +
    'binning rule when it is a string and the zoom when it is a number, and zoom is the ' +
    'unambiguous alias; midpoint is where a diverging ramp turns',
  category: 'geographic',
  defaults: { ...defaults },
};

/* ── classification ───────────────────────────────────────────────────────────────────── */

/**
 * The class edges for equal-count classes, by linear interpolation between order statistics.
 *
 * Interpolated rather than snapped to an actual observation, because snapping makes the break
 * a value that exists in the data and then a reader cannot tell whether the region holding it
 * is above or below its own break.
 *
 * @param sorted values ascending, at least two of them, not all identical
 * @param k      how many classes
 * @returns `k + 1` edges, first the minimum and last the maximum
 *
 * @example quantileEdges([1, 2, 3, 4, 5], 2);   // [1, 3, 5]
 */
function quantileEdges(sorted, k) {
  const n = sorted.length;
  const edges = [];
  for (let i = 0; i <= k; i++) {
    const h = (n - 1) * (i / k);
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    edges.push(sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]));
  }
  return edges;
}

/**
 * The class edges for equal-width classes.
 *
 * @param sorted values ascending, not all identical
 * @param k      how many classes
 * @returns `k + 1` edges, evenly spaced from minimum to maximum
 *
 * @example equalEdges([0, 1, 10], 2);   // [0, 5, 10]
 */
function equalEdges(sorted, k) {
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const edges = [];
  for (let i = 0; i <= k; i++) edges.push(lo + (hi - lo) * (i / k));
  return edges;
}

/**
 * The class edges that minimise the total within-class sum of squares -- Fisher-Jenks, exactly.
 *
 * This is Fisher's dynamic program, not the iterative Jenks approximation that most libraries
 * ship, and the distinction is worth stating because "jenks" in the wild usually means the
 * approximation. The recurrence is
 *
 *     best(c, j) = min over i of ( best(c - 1, i) + ssd(i .. j - 1) )
 *
 * over the sorted values, where `ssd` is the sum of squared deviations of a contiguous run.
 * Contiguity is what makes an exact answer cheap: the optimal partition of *sorted* data into
 * `k` groups is always into runs, so the search is over cut positions rather than over
 * assignments. With prefix sums each `ssd` is constant time and the whole thing is O(k n squared)
 * -- about a hundred and eighty thousand operations for two hundred regions and nine classes,
 * which is nothing, and which buys the exact optimum rather than a local one.
 *
 * `ssd` is computed from prefix sums as `sum of squares - (sum squared) / count`, which is
 * mathematically exact and numerically capable of coming out very slightly negative when every
 * value in the run is identical. It is clamped at zero rather than left to be a tiny negative,
 * because a negative cost would let the search prefer a split that has no reason to exist.
 *
 * @param sorted values ascending, not all identical
 * @param k      how many classes; more classes than distinct values is allowed and collapses
 * @returns the start INDEX of each class, strictly increasing and beginning at zero
 *
 * @example jenksStarts([1, 2, 3, 50, 51, 52], 2);   // [0, 3]
 */
function jenksStarts(sorted, kAsked) {
  const n = sorted.length;
  /* More classes than values is not a hard case, it is a meaningless one: the dynamic program
     has no way to fill the extra classes and its backtrack walks off the front of the table,
     handing back index minus one and a class top of `undefined`. Clamping here is the fix, and
     the caller still learns about it, because the resulting class count comes back smaller than
     the one that was asked for and the caption says so. Found by the brute-force comparison
     tripping over a two-region card asked for nine classes. */
  const k = Math.max(1, Math.min(kAsked, n));
  const s1 = new Float64Array(n + 1);
  const s2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    s1[i + 1] = s1[i] + sorted[i];
    s2[i + 1] = s2[i] + sorted[i] * sorted[i];
  }
  const ssd = (i, j) => {
    const c = j - i + 1;
    const sum = s1[j + 1] - s1[i];
    const v = (s2[j + 1] - s2[i]) - sum * sum / c;
    return v > 0 ? v : 0;
  };

  const w = n + 1;
  const cost = new Float64Array((k + 1) * w).fill(Infinity);
  const back = new Int32Array((k + 1) * w);
  cost[0] = 0;

  for (let c = 1; c <= k; c++) {
    for (let j = c; j <= n; j++) {
      let best = Infinity;
      let bi = c - 1;
      for (let i = c - 1; i < j; i++) {
        const prev = cost[(c - 1) * w + i];
        if (!Number.isFinite(prev)) continue;
        const cur = prev + ssd(i, j - 1);
        if (cur < best) { best = cur; bi = i; }
      }
      cost[c * w + j] = best;
      back[c * w + j] = bi;
    }
  }

  const starts = [];
  let j = n;
  for (let c = k; c >= 1; c--) {
    const i = back[c * w + j];
    starts.unshift(i);
    j = i;
  }
  return starts;
}

/**
 * Strictly increasing class tops, so no class can be empty by construction.
 *
 * A class is named by its TOP -- the largest value it holds -- rather than by a pair of edges,
 * and that choice is not cosmetic. Under an edge-pair representation a class holding only the
 * maximum has a lower edge equal to its upper edge, and any tidying pass that removes equal
 * consecutive edges deletes a class that has a region in it. That bug was live here for one
 * build and was caught by the brute-force Fisher-Jenks comparison, which is exactly the sort of
 * thing an independent check is for.
 *
 * With tops, membership is "the first class whose top is at least this value", class zero is
 * closed at the bottom, and two equal tops mean one genuinely empty class, which is the only
 * thing worth collapsing. A legend row reading "12 to 12: 0 regions" is a puzzle the reader has
 * to solve; saying "the data supports only four of the five classes you asked for" is not.
 *
 * @param tops each class's largest value, ascending, the last being the data maximum
 * @returns the same tops with duplicates removed; always at least one
 *
 * @example dedupeTops([1, 1, 2, 3, 3]);   // [1, 2, 3]
 */
function dedupeTops(tops) {
  const out = [tops[0]];
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] > out[out.length - 1]) out.push(tops[i]);
  }
  return out;
}

/**
 * Assign every region to a class, and say what the classes turned out to be.
 *
 * Membership is `tops[j - 1] < v <= tops[j]`, with the first class closed at the bottom. That
 * is a partition: every value is in exactly one class, there is no gap between classes and no
 * value is in two. Stated because it is checkable, and it is checked -- including against a
 * brute-force search over every possible partition, for the jenks rule.
 *
 * **All values identical** is the case every rule divides by zero on, and each divides by a
 * different zero: quantile's interpolation between two equal order statistics, equal interval's
 * width, and jenks's zero total variance which makes every partition tie. Rather than let the
 * three fail three ways, it is caught before any of them runs and drawn as ONE class holding
 * everything, which is the truthful picture: there is no variation to shade.
 *
 * @param values  per region, `null` where the join found nothing
 * @param kAsked  the number of classes asked for, between {@link BIN_MIN} and {@link BIN_MAX};
 *                capped at the number of distinct values, since more classes than that leaves
 *                some of them provably empty
 * @param rule    one of {@link RULES}
 * @returns `{ bounds, of, counts, used, state }` -- `bounds` has `used + 1` entries, the data
 *          minimum followed by each class's top; `of[i]` is a class index or -1 for no data;
 *          `state` is `ok`, `identical` or `empty`
 *
 * @example classify([1, 2, 3, 4], 2, 'equal').of;   // [0, 0, 1, 1]
 */
function classify(values, kAsked, rule) {
  const finite = values.filter((v) => v != null && Number.isFinite(v));
  const of = values.map(() => -1);

  if (!finite.length) return { bounds: [], of, counts: [], used: 0, state: 'empty' };

  const sorted = finite.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const lo = sorted[0];
  const hi = sorted[n - 1];

  if (!(hi > lo)) {
    for (let i = 0; i < values.length; i++) if (values[i] != null && Number.isFinite(values[i])) of[i] = 0;
    return { bounds: [lo, hi], of, counts: [finite.length], used: 1, state: 'identical' };
  }

  /* More classes than DISTINCT values is not a hard case, it is an impossible one, and it is
     capped for every rule rather than for the one that crashed on it. Two observations cannot be
     put into five classes with anything in all five: quantile interpolates five intervals over
     two points and three of them come back empty, equal interval cuts five widths that two
     values cannot occupy, and jenks has nowhere to put the extra breaks at all. An empty class
     is a legend row saying "minus 5.6 to minus 3.2: 0 regions", which the reader has to work out
     is not a fact about the world. Capping and reporting the smaller number is the honest
     answer, and the caption says so in as many words. */
  const distinct = new Set(sorted).size;
  const k = Math.max(1, Math.min(kAsked, distinct));

  /* Jenks names its classes by where the sorted run breaks, so the top of a class is the last
     value actually in it -- never an interpolated number that no region holds. The other two
     rules name theirs by a cut on the value axis, so their tops are the cuts. Both end at the
     data maximum, which is what makes the top class closed. */
  let tops;
  if (rule === 'jenks') {
    const starts = jenksStarts(sorted, k);
    tops = [];
    for (let c = 1; c < starts.length; c++) tops.push(sorted[starts[c] - 1]);
    tops.push(hi);
  } else {
    const edges = rule === 'equal' ? equalEdges(sorted, k) : quantileEdges(sorted, k);
    tops = edges.slice(1);
    tops[tops.length - 1] = hi;
  }

  tops = dedupeTops(tops);
  const used = tops.length;
  const counts = new Array(used).fill(0);

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    let j = used - 1;
    for (let e = 0; e < used; e++) if (v <= tops[e]) { j = e; break; }
    of[i] = j;
    counts[j]++;
  }

  return { bounds: [lo].concat(tops), of, counts, used, state: 'ok' };
}

/* ── the palette ──────────────────────────────────────────────────────────────────────── */

/** The opacity class name for a step from 0 to 8. */
function opClass(step) { return 'ck-o' + (step + 1); }

/**
 * The class names one ramp gives one classification, one name per class.
 *
 * Sequential spreads the nine opacity steps evenly over however many classes there are, so three
 * classes get the faintest, the middle and the strongest rather than the first three -- a
 * three-class map with three nearly identical washes is a map with no classes at all.
 *
 * Diverging asks a different question of every class: is this class below the midpoint, above
 * it, or does it straddle it. Below and above get the two hues, at a strength that grows with
 * distance from the middle; the straddling class gets neutral ink at the faintest step, because
 * it is the class that means "about the midpoint" and colouring it either hue would claim a
 * direction the data does not have.
 *
 * @param used     how many classes the classification actually produced
 * @param ramp     one of {@link RAMPS}
 * @param bounds   the data minimum followed by each class's top, needed only by diverging
 * @param midpoint the value a diverging ramp turns at
 * @returns one class-name string per class
 *
 * @example paletteFor(3, 'sequential', [0, 1, 2, 3], 0);   // ['ck-hA ck-o1', 'ck-hA ck-o5', 'ck-hA ck-o9']
 */
function paletteFor(used, ramp, bounds, midpoint) {
  const out = [];
  if (ramp !== 'diverging') {
    for (let j = 0; j < used; j++) {
      const step = used === 1 ? 4 : Math.round(j * (OPACITIES.length - 1) / (used - 1));
      out.push('ck-hA ' + opClass(step));
    }
    return out;
  }

  /* Which classes are on which side, decided by the class INTERVAL rather than by a
     representative value: a class whose range contains the midpoint genuinely straddles it and
     is not "mostly below". */
  const side = [];
  for (let j = 0; j < used; j++) {
    if (bounds[j + 1] <= midpoint) side.push(-1);
    else if (bounds[j] >= midpoint) side.push(1);
    else side.push(0);
  }
  const lows = side.filter((s) => s < 0).length;
  const highs = side.filter((s) => s > 0).length;

  let li = 0;
  let hi = 0;
  for (let j = 0; j < used; j++) {
    if (side[j] === 0) { out.push('ck-hN ck-o1'); continue; }
    if (side[j] < 0) {
      /* Distance from the middle, counted outward: the first class from the left is the
         farthest below and gets the strongest low hue. */
      const step = lows <= 1 ? OPACITIES.length - 1
        : Math.round((lows - 1 - li) * (OPACITIES.length - 1) / (lows - 1));
      li++;
      out.push('ck-hA ' + opClass(step));
    } else {
      const step = highs <= 1 ? OPACITIES.length - 1
        : Math.round(hi * (OPACITIES.length - 1) / (highs - 1));
      hi++;
      out.push('ck-hB ' + opClass(step));
    }
  }
  return out;
}

/* ── reading the data ─────────────────────────────────────────────────────────────────── */

/**
 * Normalise the whole `data` block into the one shape the rest of the file may assume.
 *
 * `features` absent means "use the built-in subregions", and when the values are absent too the
 * built-in demonstration figures come with them -- population over land area, so the default
 * card shows a RATE rather than a count. That is the behaviour worth demonstrating: a choropleth
 * of raw population is a map of where people are, which every reader already knows.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including every refusal and every join statistic
 *
 * @example readData({}).regions.length;   // 20
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const builtin = d.features == null;
  const keyProp = typeof d.key === 'string' && d.key ? d.key : 'key';
  const read = readRegions(builtin ? builtinRegions() : d.features, keyProp);

  /* The `scale` collision, resolved by type and nowhere else. A string that names a rule is the
     rule; anything else is offered to `readView` as the zoom, which refuses it if it is not a
     number in range and says so in the caption. */
  const ruleFromScale = RULES.indexOf(d.scale) >= 0 ? d.scale : null;
  const zoomish = d.zoom == null ? (ruleFromScale === null ? d.scale : undefined) : d.zoom;
  const view = readView({ ...d, scale: zoomish, graticule: false },
                        { projection: defaults.projection, graticule: false });

  const rows = builtin && d.values == null ? builtinValues() : d.values;
  const join = joinValues(read.regions, rows);

  const askedBins = num(d.bins, BIN_MIN, BIN_MAX);
  const bins = askedBins === null ? defaults.bins : Math.round(askedBins);
  const badBins = d.bins != null && askedBins === null;

  const ramp = RAMPS.indexOf(d.ramp) >= 0 ? d.ramp : defaults.ramp;
  const rule = ruleFromScale === null
    ? (RULES.indexOf(d.rule) >= 0 ? d.rule : defaults.scale)
    : ruleFromScale;

  /* The diverging midpoint belongs to the DATA, not to the panel. It is a claim about what the
     numbers mean -- zero for a change, a hundred for an index, the national rate for a
     comparison -- and a viewer dragging it would be inventing a claim rather than reading one.
     The same argument `map` makes about its centre and its zoom. */
  const finite = join.values.filter((v) => v != null && Number.isFinite(v));
  const given = Number(d.midpoint);
  let midpoint = 0;
  let midFrom = 'zero';
  if (Number.isFinite(given)) { midpoint = given; midFrom = 'given'; }
  else if (finite.length) {
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    if (lo < 0 && hi > 0) { midpoint = 0; midFrom = 'zero'; }
    else {
      const s = finite.slice().sort((a, b) => a - b);
      midpoint = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
      midFrom = 'median';
    }
  }

  return {
    regions: read.regions, counts: read.counts,
    values: join.values, stats: join.stats,
    builtin, keyProp,
    centre: view.centre, zoom: view.zoom, given: view.given,
    badCentre: view.badCentre, badScale: view.badScale,
    bins, badBins, rule, ramp, midpoint, midFrom,
    unit: clean(d.unit),
    legend: d.legend == null ? defaults.legend : !!d.legend,
    vertices: read.regions.reduce((s, r) =>
      s + r.polys.reduce((t, poly) => t + poly.reduce((u, ring) => u + ring.length, 0), 0), 0),
  };
}

/* ── projecting ───────────────────────────────────────────────────────────────────────── */

/**
 * Every region's path under one projection, computed once at build time.
 *
 * @param name one of `PROJECTIONS`
 * @param R    the output of {@link readData}
 * @returns the plan the browser is handed
 *
 * @example planFor('mercator', R).shapes.length;   // one per region
 */
function planFor(name, R) {
  const P = projector(name);
  const shapes = [];
  let hidden = 0;
  for (const reg of R.regions) {
    const d = regionPath(reg.polys, P, R.centre, R.zoom, 'region');
    shapes.push(d);
    if (!d) hidden++;
  }

  const frame = frameFor(P, R.zoom);
  const drawn = R.regions.length - hidden;
  const aria = (R.builtin ? 'Built-in world choropleth' : 'Choropleth') + ', ' + name + ', ' +
    centredOn(R.centre, P.cylindrical) + '. ' +
    plural(drawn, 'region', 'regions') + ' drawn of ' + R.regions.length + ', ' +
    plural(R.stats.matched, 'with a joined value', 'with joined values') + '. ' +
    projectionNote(name).charAt(0).toUpperCase() + projectionNote(name).slice(1) + '.';

  return {
    view: frame.view, rect: frame.rect, disc: frame.disc, fs: frame.fs,
    shapes, hidden, aria,
  };
}

/**
 * The sentence the caption shows for one classification, and it names the trade.
 *
 * Written per classification rather than once, because the honest thing to say changes with the
 * rule: quantile has to admit that its classes are unequal in width, equal interval has to admit
 * what skew does to it, and jenks has to admit that its breaks move when the data does.
 *
 * @param R    the output of {@link readData}
 * @param k    the class count asked for
 * @param rule one of {@link RULES}
 * @param C    the output of {@link classify}
 * @returns plain text; it is set with `textContent`, so it must not be markup
 *
 * @example ruleNote(R, 5, 'quantile', C);
 */
function ruleNote(R, k, rule, C) {
  if (C.state === 'empty') {
    return 'no region carried a usable value, so every one of them is drawn in the no-data ' +
      'hatch rather than shaded -- nothing here is a class.';
  }
  if (C.state === 'identical') {
    return 'every value is identical (' + CK.fmt(C.bounds[0]) + unitTail(R) + '), which is the ' +
      'case all three rules divide by zero on: quantile interpolates between two equal order ' +
      'statistics, equal interval has zero width and Fisher-Jenks has zero variance to ' +
      'minimise. Rather than pick one of those failures, it is drawn as one class holding ' +
      'everything, which is the truthful picture: there is no variation to shade.';
  }

  const short = C.used < k
    ? ' The data has too few distinct values for ' + k + ' classes, so ' + C.used +
      ' were used -- an empty class is a legend row a reader has to interpret.'
    : '';

  const emptyClasses = C.counts.filter((n) => n === 0).length;
  const how = rule === 'equal'
    ? 'equal interval: the range cut into ' + C.used + ' equal widths. Honest about magnitude, ' +
      'and wrong whenever the data is skewed, because the crowd near the bottom all lands in ' +
      'class one and the map goes flat.' +
      (emptyClasses
        ? ' ' + plural(emptyClasses, 'class holds', 'classes hold') + ' no regions at all, ' +
          'which is not a fault in the binning -- it is the skew itself, showing as a gap that ' +
          'wide in the distribution, and it is why quantile is the default here.'
        : '')
    : rule === 'jenks'
      ? 'Fisher-Jenks natural breaks, by the exact dynamic program rather than the iterative ' +
        'approximation: ' + C.used + ' classes chosen to minimise within-class variance, so the ' +
        'breaks fall in the gaps. They also move when the data does, so two of these maps from ' +
        'different years are not comparable however much they look it.'
      : 'quantile: ' + C.used + ' classes of equal count. The default, because real regional ' +
        'data is skewed and equal-interval bins would put nearly everything in one class. The ' +
        'cost is that the classes are not equal in width, which is why the legend prints the ' +
        'break values rather than calling them low and high.';

  return how + short;
}

/** The unit, with its leading space, or nothing at all. */
function unitTail(R) { return R.unit ? ' ' + R.unit : ''; }

/**
 * What the values are, said plainly enough that nobody has to guess.
 *
 * A choropleth of raw counts is a population map -- the biggest regions are the darkest, and
 * that is a fact about area rather than about the quantity. So the card either divided or it
 * says it did not, in the caption, every time.
 *
 * @param R the output of {@link readData}
 * @returns plain text
 *
 * @example normalNote(R);
 */
function normalNote(R) {
  if (!R.stats.matched) return '';
  if (R.stats.normalised) {
    return 'Values are normalised: every matched row carried a denominator and the card ' +
      'divided, so the shading is a rate.';
  }
  if (R.stats.withDenominator) {
    return 'Values are AS GIVEN and are not normalised. ' +
      plural(R.stats.withDenominator, 'row', 'rows') + ' of ' + R.stats.matched +
      ' carried a denominator, and a map half in rates and half in counts cannot be compared ' +
      'to itself, so none of them were used. If these are counts, this is a population map.';
  }
  return 'Values are AS GIVEN -- no denominator was supplied, so nothing was normalised. ' +
    'If these are counts, this is a population map: the shading follows how many people are ' +
    'in a region, not how the quantity varies.';
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. The two ramp hues are series tokens and the neutral is ink, so
 * the light switch is the only thing that has to know anything.
 *
 * The no-data fill is deliberately not simply "the faintest class". A viewer cannot tell a very
 * pale shade from a slightly-less-pale one, so a no-data region shaded like class zero reads as
 * a low value, which is the single most misleading thing a choropleth can do. It gets a dashed
 * outline instead -- a difference in kind rather than in degree, legible at a glance and legible
 * to someone who cannot separate the hues at all.
 */
function cardCss(id) {
  const own = '.ck-choropleth[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-cho-wrap', 'margin-top: 2px;'],
    ['svg.ck-cho-art', 'display: block; width: 100%; height: auto; overflow: hidden;'],

    ['.ck-cho-art .ck-sphere', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-cho-art .ck-cell', 'stroke: var(--rule); stroke-width: 0.45;'],
    ['.ck-cho-art .ck-hA, .ck-legsw .ck-hA', 'fill: var(--ck-s6);'],
    ['.ck-cho-art .ck-hB, .ck-legsw .ck-hB', 'fill: var(--ck-s1);'],
    ['.ck-cho-art .ck-hN, .ck-legsw .ck-hN', 'fill: var(--ink);'],
    ['.ck-cho-art .ck-nodata, .ck-legsw .ck-nodata',
     'fill: var(--ink); fill-opacity: ' + NODATA_OPACITY + '; stroke-dasharray: 2.5 2;'],

    ['.ck-cho-legend',
     'display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 9px; ' +
     'font-family: var(--mono); font-size: 9.5px; color: var(--ink-faint);'],
    ['.ck-cho-legend span', 'display: inline-flex; align-items: center; gap: 5px;'],
    ['.ck-legsw', 'display: block; width: 9px; height: 9px; overflow: visible;'],
    ['.ck-legsw rect', 'stroke: var(--rule); stroke-width: 0.6;'],
    ['.ck-cho-legend b', 'color: var(--ink-dim); font-weight: 400;'],

    ['.ck-cho-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  for (let i = 0; i < OPACITIES.length; i++) {
    rules.push(['.ck-cho-art .ck-o' + (i + 1) + ', .ck-legsw .ck-o' + (i + 1),
                'fill-opacity: ' + OPACITIES[i] + ';']);
  }
  return scoped(own, rules) + '\n';
}

/**
 * The card's markup: one section, a gear, the settings panel, the map, a legend and the caption.
 *
 * The join statistics are written into the markup rather than left to the script, because they
 * do not change with any setting and because they are the part a reader must see even if the
 * script never runs.
 *
 * The classification sentence goes in too, for the settings this instance opens with, even
 * though the script rewrites it on every change. An empty `<i>` waiting to be filled means a
 * reader whose script did not run gets a caption with the whole explanation of the class breaks
 * missing -- and a caption that is silent about its binning rule is exactly the choropleth this
 * card was written to stop being.
 */
function cardHtml(id, title, R, plan, note) {
  const e = CK.esc;
  const s = R.stats;

  const junk = [];
  const c = R.counts;
  if (c.outOfRange) junk.push(plural(c.outOfRange, 'shape', 'shapes') +
    ' held a coordinate off the Earth and ' + (c.outOfRange === 1 ? 'was' : 'were') + ' refused');
  if (c.tooFew) junk.push(plural(c.tooFew, 'ring', 'rings') + ' had fewer than three distinct points');
  if (c.badGeom) junk.push(plural(c.badGeom, 'geometry', 'geometries') + ' was of a kind this card does not draw');
  if (c.noKey) junk.push(plural(c.noKey, 'feature has', 'features have') +
    ' no "' + R.keyProp + '" property, so nothing can ever join to ' +
    (c.noKey === 1 ? 'it' : 'them'));
  if (c.duplicate) junk.push(plural(c.duplicate, 'feature shares', 'features share') +
    ' a key with another and ' + (c.duplicate === 1 ? 'takes' : 'take') + ' the same value');
  if (s.nonNumeric) junk.push(plural(s.nonNumeric, 'value was', 'values were') + ' not a number');
  if (s.keyless) junk.push(plural(s.keyless, 'value row has', 'value rows have') + ' no key');
  if (s.duplicateRows) junk.push(plural(s.duplicateRows, 'value row was', 'value rows were') +
    ' a repeat of a key already seen, and the last one won');
  if (s.negative) junk.push(plural(s.negative, 'value is', 'values are') +
    ' negative, which a diverging ramp can show and a sequential one cannot order');
  if (R.badBins) junk.push('the bin count was outside ' + BIN_MIN + ' to ' + BIN_MAX + ' and was refused');
  if (R.badCentre) junk.push('the centre was off the Earth and was refused');
  if (R.badScale) junk.push('the zoom was outside ' + SCALE_MIN + ' to ' + SCALE_MAX + ' and was refused');

  const empty = R.regions.length ? '' :
    '  <div class="ck-cho-void">nothing to draw &mdash; ' +
    (R.builtin ? 'the built-in regions came back empty' : 'no usable regions in the features') +
    '</div>\n';

  const joinLine =
    '<b>' + e(String(s.matched)) + '</b> of <b>' + e(String(R.regions.length)) + '</b> ' +
    (R.regions.length === 1 ? 'region' : 'regions') + ' matched a value; <b>' +
    e(String(s.noValue)) + '</b> ' + (s.noValue === 1 ? 'region has' : 'regions have') +
    ' no value; <b>' + e(String(s.noFeature)) + '</b> ' +
    (s.noFeature === 1 ? 'value matched no region' : 'values matched no region') + '. ';

  return '<section data-card="' + e(id) + '" class="ck-choropleth">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-projection">projection</label>\n' +
    '    <select id="' + e(id) + '-projection" name="projection">\n' +
    PROJECTIONS.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-scale">binning</label>\n' +
    '    <select id="' + e(id) + '-scale" name="scale">\n' +
    RULES.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-bins">classes</label>\n' +
    '    <input type="number" id="' + e(id) + '-bins" name="bins" min="' + BIN_MIN +
    '" max="' + BIN_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-ramp">ramp</label>\n' +
    '    <select id="' + e(id) + '-ramp" name="ramp">\n' +
    RAMPS.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-legend">legend</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-legend" name="legend">\n' +
    '    <div class="ck-set-foot">' +
    'the centre, the zoom and the diverging midpoint belong to this card&rsquo;s data, not to ' +
    'you &mdash; a midpoint is a claim about what the numbers mean. ' +
    e('midpoint ' + CK.fmt(R.midpoint) + ' (' +
      (R.midFrom === 'given' ? 'given' : R.midFrom === 'zero' ? 'zero, since the values straddle it'
        : 'the median, since the values do not straddle zero') + ').') +
    '</div>\n' +
    '  </div>\n' +
    empty +
    '  <div class="ck-cho-wrap ck-scroll">\n' +
    '    <svg class="ck-cho-art" role="img" viewBox="' + e(plan.view) +
    '" aria-label="' + e(plan.aria) + '"></svg>\n' +
    '  </div>\n' +
    '  <div class="ck-cho-legend"></div>\n' +
    '  <div class="ck-cap">' + joinLine +
    '<i class="ck-cho-note">' + e(note) + '</i> ' +
    '<span class="ck-aside">' + e(normalNote(R)) +
    (R.builtin ? ' ' + REGION_NOTE.charAt(0).toUpperCase() + REGION_NOTE.slice(1) + '.' : '') +
    (junk.length ? ' ' + e(junk.join('; ')) + '.' : '') +
    '</span></div>\n' +
    '</section>\n';
}

/**
 * The browser half: pick a projection, a classification and a palette, and paint.
 *
 * Shipped by `Function.prototype.toString()`, so the text a test exercises is the text the page
 * runs. **The comments in here ship with it**, which is why none of them contains a backtick --
 * one would close the surrounding literal early and blank every card on the desk, not just this
 * one. {@link guardEmitted} refuses the build if one appears.
 *
 * Nothing here classifies anything. Twenty-one classifications and forty-two palettes were
 * computed in Node; this looks one up and sets a class on a path.
 *
 * @param sec the card's section
 * @param M   the emitted model
 * @param DEF this instance's fallbacks, same key set as the exported defaults
 */
function choroDraw(sec, M, DEF) {
  var NS = "http://www.w3.org/2000/svg";
  var art = sec.querySelector("svg.ck-cho-art");
  var note = sec.querySelector(".ck-cho-note");
  var leg = sec.querySelector(".ck-cho-legend");

  function el(t, a, txt) {
    var e = document.createElementNS(NS, t), k;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function hel(t, cls, txt) {
    var e = document.createElement(t);
    if (cls) { e.className = cls; }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  /* A stored setting is a string out of localStorage, which is a text file the viewer can edit.
     Checked with hasOwn against the table it selects from, so the string "constructor" cannot
     reach anything off Object.prototype. */
  function pick(v, table, fallback) {
    return typeof v === "string" && Object.hasOwn(table, v) ? v : fallback;
  }

  function flag(v, fallback) {
    if (v === true || v === "true" || v === 1) { return true; }
    if (v === false || v === "false" || v === 0) { return false; }
    return fallback;
  }

  /* A number field comes back as a number from the panel and as anything at all from a
     hand-edited store, so it is rounded and range-checked rather than trusted. */
  function intIn(v, lo, hi, fallback) {
    var x = Number(v);
    if (v === true || v === false || v === null || v === "") { return fallback; }
    if (!isFinite(x)) { return fallback; }
    x = Math.round(x);
    return x < lo || x > hi ? fallback : x;
  }

  function swatch(cls) {
    var s = el("svg", { "class": "ck-legsw", viewBox: "0 0 10 10" });
    s.appendChild(el("rect", { "class": cls, x: 0, y: 0, width: 10, height: 10 }));
    return s;
  }

  function draw(cfg) {
    var pname = pick(cfg.projection, M.proj, DEF.projection);
    var P = M.proj[pname];
    var rule = pick(cfg.scale, M.rules, DEF.scale);
    var ramp = pick(cfg.ramp, M.ramps, DEF.ramp);
    var bins = intIn(cfg.bins, M.binMin, M.binMax, DEF.bins);
    var wantLeg = flag(cfg.legend, DEF.legend);
    var ckey = bins + "-" + rule;
    var pkey = ckey + "-" + ramp;
    var C, SW, frag, i, j, d, path, row, box, label;

    if (!Object.hasOwn(M.cls, ckey)) { ckey = DEF.bins + "-" + DEF.scale; pkey = ckey + "-" + ramp; }
    if (!Object.hasOwn(M.pal, pkey)) { pkey = ckey + "-" + DEF.ramp; }
    C = M.cls[ckey];
    SW = M.pal[pkey];

    if (note) { note.textContent = C.note; }
    if (!art) { return; }

    frag = document.createDocumentFragment();

    if (P.disc > 0) {
      frag.appendChild(el("circle", { "class": "ck-sphere", cx: 0, cy: 0, r: P.disc }));
    } else if (P.rect) {
      frag.appendChild(el("rect", { "class": "ck-sphere", x: P.rect[0], y: P.rect[1],
                                    width: P.rect[2], height: P.rect[3] }));
    }

    for (i = 0; i < P.shapes.length; i++) {
      d = P.shapes[i];
      if (!d) { continue; }
      j = C.of[i];
      path = el("path", {
        "class": "ck-cell " + (j < 0 ? "ck-nodata" : SW[j]),
        "fill-rule": "evenodd",
        d: d,
      });
      path.appendChild(el("title", null,
        M.names[i] + (j < 0 ? " " + M.nodataWord : " " + M.vals[i])));
      frag.appendChild(path);
    }

    while (art.firstChild) { art.removeChild(art.firstChild); }
    art.appendChild(frag);
    art.setAttribute("viewBox", P.view);
    art.setAttribute("aria-label", P.aria + " " + C.note);

    if (!leg) { return; }
    while (leg.firstChild) { leg.removeChild(leg.firstChild); }
    if (!wantLeg) { return; }
    for (j = 0; j < C.ranges.length; j++) {
      row = hel("span", null, null);
      row.appendChild(swatch(SW[j]));
      label = hel("b", null, C.ranges[j]);
      row.appendChild(label);
      row.appendChild(document.createTextNode(String(C.counts[j])));
      leg.appendChild(row);
    }
    if (C.nodata > 0) {
      row = hel("span", null, null);
      row.appendChild(swatch("ck-nodata"));
      row.appendChild(hel("b", null, M.nodataWord));
      row.appendChild(document.createTextNode(String(C.nodata)));
      leg.appendChild(row);
    }
  }

  CK.settings(sec, DEF, draw);
}

/**
 * The emitted script.
 *
 * The function is inlined by `toString()` rather than rewritten as a string literal, so there is
 * one written source for it and a test can call the same text the page runs.
 */
function cardJs(id, model, inst) {
  return '/* choropleth card: projections and classifications computed in Node. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n' +
    choroDraw.toString() + '\n' +
    '  choroDraw(sec, ' + jsonLit(model) + ', ' + jsonLit(inst) + ');\n' +
    '});\n';
}

/**
 * Build one choropleth card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape; omit `features` for the built-in subregions
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries every join statistic and every class
 *          break, so a reader or a test can check the caption's claim without re-classifying
 *
 * @throws {Error} when the arithmetic produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input is counted
 *                 and refused while reading, so neither of these means bad data.
 *
 * @example
 * build({
 *   id: 'rates',
 *   title: 'permits per thousand',
 *   data: {
 *     key: 'iso_a3',
 *     values: [{ key: 'USA', value: 412, of: 331 }, { key: 'CAN', value: 88, of: 38 }],
 *     scale: 'jenks',
 *     bins: 6,
 *     unit: 'per million',
 *   },
 *   ord: 20,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'choropleth' : id);
  const R = readData(data);

  const plans = {};
  for (const p of PROJECTIONS) plans[p] = planFor(p, R);

  /* Twenty-one classifications and forty-two palettes, all in Node. The class count and the
     rule are viewer settings, and a viewer nudging the class count must not pay for a
     re-projection -- nor should the browser hold a second copy of Fisher's dynamic program. */
  const cls = {};
  const pal = {};
  for (let k = BIN_MIN; k <= BIN_MAX; k++) {
    for (const rule of RULES) {
      const C = classify(R.values, k, rule);
      const ranges = [];
      for (let j = 0; j < C.used; j++) {
        const a = CK.fmt(fin(C.bounds[j], 'break'));
        const b = CK.fmt(fin(C.bounds[j + 1], 'break'));
        ranges.push(a === b ? a + unitTail(R) : a + ' to ' + b + unitTail(R));
      }
      cls[k + '-' + rule] = {
        of: C.of, ranges, counts: C.counts, used: C.used,
        /* Straight off the assignment rather than off the join statistics: a region can be
           unclassed because nothing joined to it OR because what joined was not a number, and
           the legend's no-data row has to count both or it will not add up to the region
           count -- which is the first thing a suspicious reader checks. */
        nodata: C.of.filter((j) => j < 0).length,
        note: ruleNote(R, k, rule, C),
      };
      for (const ramp of RAMPS) {
        pal[k + '-' + rule + '-' + ramp] = paletteFor(C.used, ramp, C.bounds, R.midpoint);
      }
    }
  }

  const model = {
    proj: {},
    cls, pal,
    rules: Object.fromEntries(RULES.map((r) => [r, 1])),
    ramps: Object.fromEntries(RAMPS.map((r) => [r, 1])),
    binMin: BIN_MIN, binMax: BIN_MAX,
    names: R.regions.map((r) => r.name || r.key || 'unnamed region'),
    vals: R.values.map((v) => (v == null || !Number.isFinite(v) ? '' : CK.fmt(v) + unitTail(R))),
    nodataWord: 'no data',
  };
  for (const p of PROJECTIONS) {
    const q = plans[p];
    model.proj[p] = {
      view: q.view, rect: q.rect, disc: q.disc, fs: q.fs,
      shapes: q.shapes, aria: q.aria,
    };
  }

  const inst = {
    projection: R.given, bins: R.bins, scale: R.rule, ramp: R.ramp, legend: R.legend,
  };
  const active = plans[R.given];
  const activeCls = cls[R.bins + '-' + R.rule];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'choropleth',
      projection: R.given,
      builtin: R.builtin,
      regions: R.regions.length,
      vertices: R.vertices,
      join: { ...R.stats },
      binning: { rule: R.rule, asked: R.bins, used: activeCls.used, breaks: activeCls.ranges,
                 counts: activeCls.counts },
      ramp: R.ramp,
      midpoint: R.midpoint,
      midpointFrom: R.midFrom,
      normalised: R.stats.normalised,
      center: R.centre,
      scale: R.zoom,
      refused: { ...R.counts, bins: R.badBins, centre: R.badCentre, zoom: R.badScale },
      hidden: Object.fromEntries(PROJECTIONS.map((p) => [p, plans[p].hidden])),
    },
    html: cardHtml(cardId, title == null ? cardId : clean(title), R, active, activeCls.note),
    css: cardCss(cardId),
    js: guardEmitted(cardJs(cardId, model, inst), cardId),
  };
}
