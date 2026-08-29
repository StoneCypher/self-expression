/**
 * `bubblemap` -- circles on a map, with AREA proportional to value.
 *
 * **Area, not radius, and the difference is two orders of magnitude.** A circle drawn with its
 * radius proportional to value exaggerates by the square of the ratio: a value of one hundred
 * against a value of one gets a hundred times the radius and TEN THOUSAND times the ink. The
 * reader is measuring ink, because that is what an eye does with a disc, so a radius-proportional
 * bubble map does not merely overstate the big values -- it multiplies every ratio in the picture
 * by itself. Taking the square root first is the whole fix, and it is one line, which is why
 * getting it wrong is inexcusable rather than merely unfortunate.
 *
 * The scale is anchored at zero rather than fitted to the observed range, which is the second
 * half of the same argument. A range-fitted scale makes the smallest datum visible and makes the
 * ratio of two areas *not* the ratio of two values, so the map is legible and unmeasurable. This
 * anchors at zero: area over area equals value over value everywhere. The price is paid honestly
 * -- a datum at one per cent of the maximum draws at one tenth of the radius, which at card size
 * is a dot, and a datum of zero draws nothing and is counted in the caption.
 *
 * Where a bubble map beats a choropleth: it is not lying about area. A choropleth gives Greenland
 * more ink than India because Greenland is bigger on a mercator, not because its value is larger.
 * Where it loses: bubbles occlude each other, which is what `dodge` and `spikemap` are for.
 *
 * @see ./_geo.mjs -- the projections, the seam, the horizon and the shared radius scales
 * @see ./spikemap.mjs -- the same data when the points are too dense for discs
 */

import {
  CK, PROJECTIONS, SCALE_MIN, SCALE_MAX,
  fin, jsonLit, clean, plural, spoken, cssId, scoped,
  projector, projectionNote, centredOn, frameFor,
  regionPath, projectPoint, readRegions, readView, joinValues, polysCentroid,
  proportionalRadius, fitMaxRadius, position,
  builtinRegions, builtinValues, REGION_NOTE, guardEmitted,
} from './_geo.mjs';

/* ── constants ────────────────────────────────────────────────────────────────────────── */

/**
 * The radius the largest value draws at, in view units, where the world is 360 wide.
 *
 * Chosen so the biggest bubble is about a fourteenth of the world's width: large enough to be
 * the subject of the picture, small enough that two neighbours at the maximum do not merge into
 * one blob before the dodge has a chance to separate them.
 */
const R_MAX = 26;

/**
 * How much of the world box the bubbles may cover together before the scale shrinks.
 *
 * Higher than the cartogram's, because occlusion is expected here and separation is optional --
 * but not unbounded, because two hundred bubbles at a fixed maximum radius is not a map, it is a
 * fill. Shrinking every radius by one factor preserves proportionality exactly.
 */
const BUB_FILL = 0.55;

/** Gap held between two dodged circles, so touching reads as touching rather than as overlap. */
const DODGE_PAD = 0.6;

/** How hard a dodged circle is pulled back toward where it belongs, per iteration. */
const DODGE_HOME = 0.12;

/** When a relaxation pass moves nothing further than this, it has converged. */
const DODGE_TOL = 0.02;

/** The ceiling on settling passes, so a pathological input cannot hang a build. */
const DODGE_ITERS = 240;

/**
 * The ceiling on polishing passes, which run with the pull home switched off.
 *
 * Separation and the pull home reach an equilibrium rather than a solution: the pull re-opens a
 * sliver of overlap every pass and the separation closes it again, forever. A dodge that still
 * overlaps is a dodge that did not do its one job, so a bounded second phase runs the separation
 * alone. Both counts are reported.
 */
const DODGE_POLISH = 120;

/** The three reference sizes in the legend, as fractions of the maximum value. */
const LEGEND_STOPS = [1, 0.25, 0.0625];

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * `dodge` is off by default and that is deliberate: dodging moves a circle off the place it is
 * about, which is a different lie from occlusion and not obviously a smaller one. The caption
 * says how far the worst one moved, so the viewer turning it on can see what it cost.
 *
 * @example defaults.dodge;   // false
 */
export const defaults = {
  projection: 'equirectangular',
  labels: false,
  legend: true,
  dodge: false,
};

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'bubblemap'
 */
export const meta = {
  name: 'bubblemap',
  summary:
    'Circles on a projected map with area proportional to value, optionally dodged apart, ' +
    'with a nested three-size legend.',
  shape:
    '{ features, key, values: [{ key, value, of }], points: [{ lon, lat, label, value }], ' +
    'unit, max, projection, center: { lon, lat }, scale } -- ' +
    'features is GeoJSON regions, or is omitted for the twenty built-in coarse subregions, ' +
    'and supplies both the outline behind the bubbles and the centroids they sit on; points ' +
    'places bubbles at explicit coordinates instead and is what you want for cities; values ' +
    'joins to the regions by the property named by key (default "key"); max fixes the top of ' +
    'the scale so two cards can be compared, and values above it are clamped and counted',
  defaults: { ...defaults },
};

/* ── reading the data ─────────────────────────────────────────────────────────────────── */

/**
 * Every datum a bubble could come from, normalised into one list of places with values.
 *
 * Two sources, because two questions: `points` answers "where are these cities", and `values`
 * joined to regions answers "how much in each place". They are not merged -- when `points` is
 * given it is the whole answer, because a card showing both would be two encodings of two
 * different things in one visual channel and no legend could rescue it.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including every refusal count
 *
 * @example readData({}).dots.length;   // 20
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const builtin = d.features == null;
  const keyProp = typeof d.key === 'string' && d.key ? d.key : 'key';
  const read = readRegions(builtin ? builtinRegions() : d.features, keyProp);
  const view = readView({ ...d, graticule: false },
                        { projection: defaults.projection, graticule: false });

  const counts = { outOfRange: 0, noValue: 0, nonNumeric: 0, negative: 0, zero: 0,
                   capped: 0, noCentroid: 0 };
  const dots = [];
  let source;
  let join = { values: [], stats: null };

  if (Array.isArray(d.points)) {
    source = 'points';
    for (const raw of d.points) {
      const o = raw && typeof raw === 'object' ? raw : {};
      const q = position(Array.isArray(o) ? o : [o.lon, o.lat]);
      if (!q) { counts.outOfRange++; continue; }
      const label = clean(o.label == null ? (o.name == null ? '' : o.name) : o.label);
      dots.push({ lon: q[0], lat: q[1], label, raw: o.value });
    }
  } else {
    source = 'regions';
    const rows = builtin && d.values == null ? builtinValues() : d.values;
    join = joinValues(read.regions, rows);
    for (let i = 0; i < read.regions.length; i++) {
      const reg = read.regions[i];
      const c = polysCentroid(reg.polys);
      if (!c) { counts.noCentroid++; continue; }
      dots.push({ lon: c.lon, lat: c.lat, label: reg.name || reg.key, raw: join.values[i] });
    }
  }

  /* The value is settled here, once, so that the three refusals -- not a number, below zero,
     above the ceiling -- are counted in one place and cannot disagree with the caption. A
     negative area does not exist, so a negative value is refused rather than drawn as its
     absolute value, which would put a loss and a gain on the map as the same circle. */
  const ceiling = Number(d.max);
  const hasCeiling = Number.isFinite(ceiling) && ceiling > 0;
  for (const dot of dots) {
    /* Absent and unparseable are counted apart. "No value here" is a fact about the world and
       "this cell said n/a" is a fact about the file, and a caption that merged them would send
       the reader looking in the wrong place. */
    if (dot.raw == null) { counts.noValue++; dot.value = null; continue; }
    const v = Number(dot.raw);
    if (!Number.isFinite(v)) { counts.nonNumeric++; dot.value = null; continue; }
    if (v < 0) { counts.negative++; dot.value = null; continue; }
    if (v === 0) counts.zero++;
    if (hasCeiling && v > ceiling) counts.capped++;
    dot.value = v;
  }

  const live = dots.filter((p) => p.value != null).map((p) => p.value);
  const vmax = hasCeiling ? ceiling : (live.length ? Math.max(...live) : 0);
  const rMax = fitMaxRadius(live, vmax, R_MAX, BUB_FILL);

  return {
    regions: read.regions, geomCounts: read.counts,
    dots, counts, source, builtin, keyProp,
    stats: join.stats,
    vmax, rMax, hasCeiling,
    centre: view.centre, zoom: view.zoom, given: view.given,
    badCentre: view.badCentre, badScale: view.badScale,
    unit: clean(d.unit),
    labels: d.labels == null ? defaults.labels : !!d.labels,
    legend: d.legend == null ? defaults.legend : !!d.legend,
    dodge: d.dodge == null ? defaults.dodge : !!d.dodge,
  };
}

/* ── the dodge ────────────────────────────────────────────────────────────────────────── */

/**
 * Push overlapping circles apart until they touch, and say how much it cost.
 *
 * A dodge is a lie with a receipt. Two cities forty kilometres apart draw two discs on top of
 * each other, and the reader sees one value where there are two; separating them fixes the
 * reading and puts each disc somewhere it is not. Neither is free, so this card does neither by
 * default and reports the displacement when it does, which is the only way a viewer can judge
 * the trade for their own data.
 *
 * The relaxation is the same one `cartogram`'s Dorling uses -- pairwise separation plus a pull
 * home, then a bounded polishing phase with the pull switched off -- with a much stronger pull,
 * because here the position is the truth and the separation is the concession, and in a Dorling
 * it is the other way round. The polishing phase is not an optimisation: separation and the pull
 * reach an equilibrium in which a sliver of overlap is re-opened and closed forever, so without
 * it a dodge would leave bubbles overlapping, which is the one thing a dodge exists to prevent.
 *
 * Coincident centres are separated along a direction derived from the two indices rather than
 * from a random number, so a rebuild of the same data produces the same picture. A card that
 * moves when nothing changed is a card nobody trusts.
 *
 * @param dots projected `{ x, y, r }`, in a stable order
 * @returns `{ pos, iters, moved, residual }` -- `moved` is the worst displacement in view units
 *          and `residual` the worst remaining overlap, both after the last pass
 *
 * @example dodgeApart([{ x: 0, y: 0, r: 5 }, { x: 1, y: 0, r: 5 }]).residual;   // ~0
 */
function dodgeApart(dots) {
  const pos = dots.map((d) => ({ x: d.x, y: d.y, ox: d.x, oy: d.y, r: d.r }));
  const n = pos.length;

  /** One pass of pairwise separation; returns the largest push it had to make. */
  const separate = () => {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[i];
        const b = pos[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const want = a.r + b.r + DODGE_PAD;
        if (dist >= want) continue;
        if (!(dist > 1e-9)) {
          /* Exactly coincident, which real data does constantly -- two rows for one place, or
             two regions whose centroids round together. The direction is derived from the pair
             of indices so it is the same on every rebuild. */
          dx = ((i * 7 + j * 13) % 17) / 17 - 0.5;
          dy = ((i * 11 + j * 5) % 19) / 19 - 0.5;
          dist = Math.hypot(dx, dy) || 1;
        }
        const push = (want - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        if (push > worst) worst = push;
      }
    }
    return worst;
  };

  /* The stopping test is on the OVERLAP, not on the push, and the difference is the pad: a push
     is half of (pad + overlap), so testing the push alone could never be satisfied while the pad
     is positive. */
  const settled = (worst) => worst * 2 - DODGE_PAD < DODGE_TOL;

  let iters = 0;
  for (; iters < DODGE_ITERS; iters++) {
    const worst = separate();
    for (const p of pos) {
      p.x += (p.ox - p.x) * DODGE_HOME;
      p.y += (p.oy - p.y) * DODGE_HOME;
    }
    if (settled(worst)) { iters++; break; }
  }
  for (let k = 0; k < DODGE_POLISH; k++) {
    iters++;
    if (settled(separate())) break;
  }

  let moved = 0;
  let residual = 0;
  for (let i = 0; i < n; i++) {
    moved = Math.max(moved, Math.hypot(pos[i].x - pos[i].ox, pos[i].y - pos[i].oy));
    for (let j = i + 1; j < n; j++) {
      const gap = pos[i].r + pos[j].r - Math.hypot(pos[j].x - pos[i].x, pos[j].y - pos[i].y);
      if (gap > residual) residual = gap;
    }
  }
  return { pos, iters, moved, residual };
}

/* ── projecting ───────────────────────────────────────────────────────────────────────── */

/**
 * Everything one projection needs, computed once at build time.
 *
 * Both layouts are computed, dodged and not, because `dodge` is a viewer setting and a viewer
 * toggling it must not pay for a relaxation -- nor should the browser carry a second copy of one.
 *
 * @param name one of `PROJECTIONS`
 * @param R    the output of {@link readData}
 * @returns the plan the browser is handed, plus the numbers the caption quotes
 *
 * @example planFor('orthographic', R).hidden;   // bubbles over the horizon
 */
function planFor(name, R) {
  const P = projector(name);
  const land = [];
  for (const reg of R.regions) {
    const d = regionPath(reg.polys, P, R.centre, R.zoom, 'region');
    if (d) land.push(d);
  }

  const radius = R.vmax > 0 ? proportionalRadius(R.vmax, R.rMax) : () => 0;

  const placed = [];
  let hidden = 0;
  for (const dot of R.dots) {
    const q = projectPoint(dot.lon, dot.lat, P, R.centre, R.zoom);
    if (!q.seen) { hidden++; continue; }
    placed.push({
      x: q.x, y: q.y, r: radius(dot.value), seq: placed.length,
      label: dot.label,
      tip: (dot.label || 'unnamed place') +
        (dot.value == null ? ' · no value' : ' · ' + CK.fmt(dot.value) + (R.unit ? ' ' + R.unit : '')) +
        ' · ' + spoken(dot.lat, 'north', 'south') + ', ' + spoken(dot.lon, 'east', 'west'),
    });
  }

  /* Largest first, so the small ones land on top and none is buried. SVG has no z-index -- the
     last thing appended is the thing on top -- so this sort IS the stacking order, and it has to
     happen before the dodge or the two layouts would not be index-aligned. The tie-break on the
     original index keeps the order stable, since a sort that reshuffles equal values would make
     the picture move between builds of identical data. */
  placed.sort((a, b) => (b.r - a.r) || (a.seq - b.seq));

  const plain = placed.map((p) => [fin(p.x, 'bubble x'), fin(p.y, 'bubble y'),
                                   fin(p.r, 'bubble r'), p.label, p.tip]);
  const relaxed = dodgeApart(placed);
  const moved = relaxed.pos.map((p, i) => [fin(p.x, 'dodged x'), fin(p.y, 'dodged y'),
                                           fin(p.r, 'dodged r'), placed[i].label, placed[i].tip]);

  /* Overlap in the UNDODGED layout, so the caption can say what turning the dodge on is for. */
  let overlaps = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const gap = placed[i].r + placed[j].r -
        Math.hypot(placed[j].x - placed[i].x, placed[j].y - placed[i].y);
      if (gap > 0) overlaps++;
    }
  }

  const frame = frameFor(P, R.zoom);
  const said = describe(R, P, { drawn: placed.length, hidden, overlaps, relaxed });

  return {
    view: frame.view, rect: frame.rect, disc: frame.disc, fs: frame.fs,
    land, plain, moved,
    note: said.note, aria: said.aria,
    hidden, overlaps,
    iters: relaxed.iters,
    shift: Math.round(relaxed.moved * 100) / 100,
    residual: Math.round(relaxed.residual * 100) / 100,
  };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides an SVG's internals completely, so the label IS the map to anyone using one.
 * It has to carry the encoding -- area, not radius -- because a reader who cannot see the discs
 * has no other way to know what the numbers were turned into.
 *
 * @returns `{ aria, note }`, both plain text; the note is set with `textContent`
 *
 * @example describe(R, projector('mercator'), tally).note;
 */
function describe(R, P, tally) {
  const where = centredOn(R.centre, P.cylindrical);
  const how = projectionNote(P.name);

  const encoding =
    'area is proportional to value, not radius: a value ten times another gets ten times the ' +
    'ink and about 3.2 times the radius. Drawn radius-proportional instead, that same pair ' +
    'would differ by a hundred times the ink -- the square of the ratio, every time.';

  const drawn = tally.drawn
    ? plural(tally.drawn, 'bubble', 'bubbles') + ' drawn'
    : 'no bubbles to draw';

  const gone = tally.hidden
    ? ' ' + plural(tally.hidden, 'bubble is', 'bubbles are') + ' over the horizon and culled.'
    : '';

  const crowd = tally.overlaps
    ? ' ' + plural(tally.overlaps, 'pair overlaps', 'pairs overlap') + ' where they belong; the ' +
      'dodge setting separates them in ' + plural(tally.relaxed.iters, 'pass', 'passes') +
      ', moving the worst one ' + (Math.round(tally.relaxed.moved * 100) / 100) +
      ' view units off its coordinate and leaving ' +
      (Math.round(tally.relaxed.residual * 100) / 100) + ' units of residual overlap.'
    : ' No two bubbles overlap, so the dodge has nothing to do.';

  const note = how + '. ' + drawn + ', ' + where + '. ' + encoding + gone + crowd;

  const aria =
    (R.builtin ? 'World bubble map' : 'Bubble map') + ', ' + P.name + ', ' + where + '. ' +
    drawn.charAt(0).toUpperCase() + drawn.slice(1) + ', with ' + encoding + gone +
    ' ' + how.charAt(0).toUpperCase() + how.slice(1) + '.';

  return { note: note.replace(/\s+/g, ' ').trim(), aria: aria.replace(/\s+/g, ' ').trim() };
}

/**
 * Three nested reference circles, at the maximum, a quarter of it and a sixteenth.
 *
 * A quarter and a sixteenth rather than a half and a tenth, because area is the encoding: a
 * quarter of the value is exactly half the radius and a sixteenth is exactly a quarter, so the
 * three circles nest at 1, 1/2 and 1/4 of the largest and a reader can see the rule of the scale
 * in the legend itself rather than having to take it on trust.
 *
 * @param R the output of {@link readData}
 * @returns `{ box, rows }` where each row is `[cx, cy, r, ty, text]` in legend units
 *
 * @example legendFor(R).rows.length;   // 3
 */
function legendFor(R) {
  if (!(R.vmax > 0)) return { box: '0 0 1 1', rows: [], w: 0, h: 0 };
  const radius = proportionalRadius(R.vmax, R.rMax);
  const rows = [];
  const big = radius(R.vmax);
  for (const frac of LEGEND_STOPS) {
    const v = R.vmax * frac;
    const r = radius(v);
    rows.push([
      fin(big, 'legend cx'), fin(2 * big - r, 'legend cy'), fin(r, 'legend r'),
      fin(2 * big - 2 * r, 'legend ty'),
      CK.fmt(Math.round(v * 100) / 100) + (R.unit ? ' ' + R.unit : ''),
    ]);
  }
  const w = big * 2 + 96;
  const h = big * 2 + 2;
  return { box: '0 0 ' + fin(w, 'legend w') + ' ' + fin(h, 'legend h'), rows,
           w: fin(w, 'legend w'), h: fin(h, 'legend h'), lx: fin(big * 2 + 6, 'legend lx') };
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. The bubble fill is deliberately translucent rather than solid:
 * discs on a map overlap, and a solid fill turns two values into one shape, which is the failure
 * the dodge exists to fix and the failure the reader can at least SEE through a translucent one.
 */
function cardCss(id) {
  const own = '.ck-bubblemap[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-bub-wrap', 'margin-top: 2px;'],
    ['svg.ck-bub-art', 'display: block; width: 100%; height: auto; overflow: hidden;'],
    ['svg.ck-bub-art text', 'font-family: var(--mono); fill: var(--ink-dim);'],

    ['.ck-bub-art .ck-sphere', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-bub-art .ck-land', 'fill: var(--ink); fill-opacity: .12; stroke: var(--rule); stroke-width: 0.5;'],
    ['.ck-bub-art .ck-bub',
     'fill: var(--ck-s6); fill-opacity: .42; stroke: var(--ck-s6); stroke-width: 0.9;'],
    ['.ck-bub-art .ck-bub-none',
     'fill: none; stroke: var(--ink-faint); stroke-width: 0.6; stroke-dasharray: 2 2;'],

    ['svg.ck-bub-leg', 'display: block; height: 46px; width: auto; overflow: visible; margin-top: 9px;'],
    ['svg.ck-bub-leg text', 'font-family: var(--mono); font-size: 7px; fill: var(--ink-faint);'],
    ['svg.ck-bub-leg circle',
     'fill: none; stroke: var(--ck-s6); stroke-width: 0.9;'],
    ['svg.ck-bub-leg line', 'stroke: var(--hairline); stroke-width: 0.5;'],

    ['.ck-bub-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scoped(own, rules) + '\n' +
    ':root[data-theme="light"] ' + own + ' .ck-bub-art .ck-land { fill-opacity: .16; }\n';
}

/**
 * The card's markup: one section, a gear, the settings panel, the map, a legend and the caption.
 */
function cardHtml(id, title, R, plan, leg) {
  const e = CK.esc;
  const c = R.counts;
  const g = R.geomCounts;

  const junk = [];
  if (c.outOfRange) junk.push(plural(c.outOfRange, 'point', 'points') +
    ' sat off the Earth and ' + (c.outOfRange === 1 ? 'was' : 'were') + ' refused');
  if (c.noValue) junk.push(plural(c.noValue, 'place has', 'places have') +
    ' no value at all');
  if (c.nonNumeric) junk.push(plural(c.nonNumeric, 'value was', 'values were') +
    ' not a number');
  if (c.noValue + c.nonNumeric) junk.push('a place with no usable number draws as an empty ' +
    'dashed ring rather than as a small circle, which a reader would read as a small value');
  if (c.negative) junk.push(plural(c.negative, 'value was', 'values were') +
    ' negative and ' + (c.negative === 1 ? 'was' : 'were') +
    ' refused -- a circle has no negative area, and drawing the absolute value would put a ' +
    'loss and a gain on the map as the same disc');
  if (c.zero) junk.push(plural(c.zero, 'value is', 'values are') +
    ' zero, so ' + (c.zero === 1 ? 'it draws' : 'they draw') +
    ' at radius zero and cannot be seen -- that is what proportional to area means');
  if (c.capped) junk.push(plural(c.capped, 'value was', 'values were') +
    ' above the ceiling and ' + (c.capped === 1 ? 'was' : 'were') + ' clamped to it');
  if (c.noCentroid) junk.push(plural(c.noCentroid, 'region', 'regions') + ' had no usable centroid');
  if (g.outOfRange) junk.push(plural(g.outOfRange, 'shape', 'shapes') +
    ' held a coordinate off the Earth and ' + (g.outOfRange === 1 ? 'was' : 'were') + ' refused');
  if (g.tooFew) junk.push(plural(g.tooFew, 'ring', 'rings') + ' had fewer than three distinct points');
  if (g.badGeom) junk.push(plural(g.badGeom, 'geometry', 'geometries') + ' was of a kind this card does not draw');
  if (R.badCentre) junk.push('the centre was off the Earth and was refused');
  if (R.badScale) junk.push('the zoom was outside ' + SCALE_MIN + ' to ' + SCALE_MAX + ' and was refused');

  const s = R.stats;
  const joinLine = s
    ? '<b>' + e(String(s.matched)) + '</b> of <b>' + e(String(R.regions.length)) + '</b> ' +
      (R.regions.length === 1 ? 'region' : 'regions') + ' matched a value; <b>' +
      e(String(s.noValue)) + '</b> without one; <b>' + e(String(s.noFeature)) + '</b> ' +
      (s.noFeature === 1 ? 'value matched no region' : 'values matched no region') + '. '
    : '<b>' + e(String(R.dots.length)) + '</b> ' +
      (R.dots.length === 1 ? 'point' : 'points') + ' placed by coordinate. ';

  const empty = R.dots.length ? '' :
    '  <div class="ck-bub-void">nothing to draw &mdash; no usable places</div>\n';

  return '<section data-card="' + e(id) + '" class="ck-bubblemap">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-projection">projection</label>\n' +
    '    <select id="' + e(id) + '-projection" name="projection">\n' +
    PROJECTIONS.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-dodge">dodge</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-dodge" name="dodge">\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-labels" name="labels">\n' +
    '    <label for="' + e(id) + '-legend">legend</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-legend" name="legend">\n' +
    '    <div class="ck-set-foot">' +
    'dodging separates overlapping bubbles and moves each one off the place it is about. ' +
    e('the worst shift here is ' + plan.shift + ' view units, leaving ' + plan.residual +
      ' units of residual overlap.') +
    '</div>\n' +
    '  </div>\n' +
    empty +
    '  <div class="ck-bub-wrap ck-scroll">\n' +
    '    <svg class="ck-bub-art" role="img" viewBox="' + e(plan.view) +
    '" aria-label="' + e(plan.aria) + '"></svg>\n' +
    '  </div>\n' +
    '  <svg class="ck-bub-leg" role="img" viewBox="' + e(leg.box) +
    '" aria-label="Legend: three nested circles at the maximum value, a quarter of it and a ' +
    'sixteenth, whose radii are one, one half and one quarter of the largest &mdash; because ' +
    'area, not radius, carries the value."></svg>\n' +
    '  <div class="ck-cap">' + joinLine +
    '<i class="ck-bub-note">' + e(plan.note) + '</i>' +
    '<span class="ck-aside"> ' +
    (R.builtin ? REGION_NOTE.charAt(0).toUpperCase() + REGION_NOTE.slice(1) + '.' : '') +
    (junk.length ? ' ' + e(junk.join('; ')) + '.' : '') +
    '</span></div>\n' +
    '</section>\n';
}

/**
 * The browser half: pick a projection and a layout, and paint.
 *
 * Shipped by `Function.prototype.toString()`, so the text a test exercises is the text the page
 * runs, comments and all -- which is why not one of them contains a backtick.
 *
 * Nothing here decides a radius. Every circle in both layouts was sized and relaxed in Node.
 *
 * @param sec the card's section
 * @param M   the emitted model
 * @param DEF this instance's fallbacks, same key set as the exported defaults
 */
function bubbleDraw(sec, M, DEF) {
  var NS = "http://www.w3.org/2000/svg";
  var art = sec.querySelector("svg.ck-bub-art");
  var legArt = sec.querySelector("svg.ck-bub-leg");
  var note = sec.querySelector(".ck-bub-note");

  function el(t, a, txt) {
    var e = document.createElementNS(NS, t), k;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function pick(v, table, fallback) {
    return typeof v === "string" && Object.hasOwn(table, v) ? v : fallback;
  }

  function flag(v, fallback) {
    if (v === true || v === "true" || v === 1) { return true; }
    if (v === false || v === "false" || v === 0) { return false; }
    return fallback;
  }

  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

  function draw(cfg) {
    var pname = pick(cfg.projection, M.proj, DEF.projection);
    var P = M.proj[pname];
    var wantDodge = flag(cfg.dodge, DEF.dodge);
    var wantLab = flag(cfg.labels, DEF.labels);
    var wantLeg = flag(cfg.legend, DEF.legend);
    var dots = wantDodge ? P.moved : P.plain;
    var frag, i, b, g, dot, row;

    if (note) { note.textContent = P.note; }

    if (art) {
      frag = document.createDocumentFragment();
      if (P.disc > 0) {
        frag.appendChild(el("circle", { "class": "ck-sphere", cx: 0, cy: 0, r: P.disc }));
      } else if (P.rect) {
        frag.appendChild(el("rect", { "class": "ck-sphere", x: P.rect[0], y: P.rect[1],
                                      width: P.rect[2], height: P.rect[3] }));
      }
      for (i = 0; i < P.land.length; i++) {
        frag.appendChild(el("path", { "class": "ck-land", "fill-rule": "evenodd", d: P.land[i] }));
      }

      /* Largest first, so a small bubble is never buried under a big one. SVG has no z-index:
         the last thing appended is the thing on top, and the order here IS the stacking. */
      for (i = 0; i < dots.length; i++) {
        b = dots[i];
        g = el("g", null);
        dot = el("circle", {
          "class": b[2] > 0 ? "ck-bub" : "ck-bub-none",
          cx: b[0], cy: b[1], r: b[2] > 0 ? b[2] : 1.6,
        });
        dot.appendChild(el("title", null, b[4]));
        g.appendChild(dot);
        if (wantLab && b[3]) {
          g.appendChild(el("text", { x: b[0] + (b[2] > 0 ? b[2] : 1.6) + 2.5,
                                     y: b[1] + P.fs * 0.36, "font-size": P.fs }, b[3]));
        }
        frag.appendChild(g);
      }
      clear(art);
      art.appendChild(frag);
      art.setAttribute("viewBox", P.view);
      art.setAttribute("aria-label", P.aria);
    }

    if (!legArt) { return; }
    clear(legArt);
    legArt.style.display = wantLeg && M.leg.rows.length ? "block" : "none";
    if (!wantLeg) { return; }
    frag = document.createDocumentFragment();
    for (i = 0; i < M.leg.rows.length; i++) {
      row = M.leg.rows[i];
      frag.appendChild(el("circle", { cx: row[0], cy: row[1], r: row[2] }));
      frag.appendChild(el("line", { x1: row[0], y1: row[3], x2: M.leg.lx - 2, y2: row[3] }));
      frag.appendChild(el("text", { x: M.leg.lx, y: row[3] + 2.4 }, row[4]));
    }
    legArt.appendChild(frag);
  }

  CK.settings(sec, DEF, draw);
}

/**
 * The emitted script.
 */
function cardJs(id, model, inst) {
  return '/* bubblemap card: projections, radii and the dodge all computed in Node. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n' +
    bubbleDraw.toString() + '\n' +
    '  bubbleDraw(sec, ' + jsonLit(model) + ', ' + jsonLit(inst) + ');\n' +
    '});\n';
}

/**
 * Build one bubble map card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape; omit everything for the built-in demonstration
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the dodge's iteration count, worst shift
 *          and residual overlap, so the claim in the caption is checkable without re-relaxing
 *
 * @throws {Error} when the arithmetic produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk
 *
 * @example
 * build({
 *   id: 'cities',
 *   title: 'where the requests came from',
 *   data: {
 *     points: [{ lon: -122.3, lat: 47.6, label: 'Seattle', value: 1200 }],
 *     unit: 'requests',
 *   },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'bubblemap' : id);
  const R = readData(data);

  const plans = {};
  for (const p of PROJECTIONS) plans[p] = planFor(p, R);
  const leg = legendFor(R);

  const model = { proj: {}, leg };
  for (const p of PROJECTIONS) {
    const q = plans[p];
    model.proj[p] = {
      view: q.view, rect: q.rect, disc: q.disc, fs: q.fs,
      land: q.land, plain: q.plain, moved: q.moved,
      note: q.note, aria: q.aria,
    };
  }

  const inst = {
    projection: R.given, labels: R.labels, legend: R.legend, dodge: R.dodge,
  };
  const active = plans[R.given];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'bubblemap',
      projection: R.given,
      builtin: R.builtin,
      source: R.source,
      places: R.dots.length,
      regions: R.regions.length,
      max: R.vmax,
      maxRadius: Math.round(R.rMax * 100) / 100,
      radiusCeiling: R_MAX,
      ceiling: R.hasCeiling,
      encoding: 'area proportional to value; radius is the square root',
      join: R.stats ? { ...R.stats } : null,
      refused: { ...R.counts, geometry: { ...R.geomCounts },
                 centre: R.badCentre, zoom: R.badScale },
      dodge: Object.fromEntries(PROJECTIONS.map((p) => [p, {
        iterations: plans[p].iters, worstShift: plans[p].shift,
        residualOverlap: plans[p].residual, overlappingPairsUndodged: plans[p].overlaps,
      }])),
      hidden: Object.fromEntries(PROJECTIONS.map((p) => [p, plans[p].hidden])),
    },
    html: cardHtml(cardId, title == null ? cardId : clean(title), R, active, leg),
    css: cardCss(cardId),
    js: guardEmitted(cardJs(cardId, model, inst), cardId),
  };
}
