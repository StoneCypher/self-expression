/**
 * `cartogram` -- regions resized by value, in the two ways that can be done honestly in a card.
 *
 * A choropleth's flaw is fixed and unfixable: it gives every region the ink its AREA earns rather
 * than the ink its value earns, so on any world map Greenland outshouts India and Russia
 * outshouts everywhere. A cartogram is the family of answers that make area carry the value
 * instead. Two of them are here.
 *
 * **Dorling.** Every region becomes a circle whose AREA is its value, seeded at the region's own
 * centroid, then repelled until no two overlap. Shape is thrown away entirely -- that is the
 * point, since shape was the thing lying -- and what survives is roughly where each region is
 * relative to its neighbours. It is the most legible of the family and the least like a map.
 *
 * **Non-contiguous.** Every region keeps its own outline and is scaled about its own centroid
 * until its drawn area is proportional to its value. Nothing is distorted: every shape is
 * exactly itself, smaller. What is lost is contiguity -- the regions come apart, and the gaps
 * between them are not sea. The original outlines are drawn as ghosts underneath, because the
 * gap between a shape and its ghost is the whole message and a reader who cannot see the ghost
 * cannot read the map at all.
 *
 * **Contiguous density-equalising -- Gastner-Newman -- is deliberately NOT here, and this
 * paragraph exists so that nobody has to wonder whether it was forgotten.** The Gastner-Newman
 * cartogram is the famous one, the rubber-sheet map where every region stays joined to its
 * neighbours and the whole plane deforms. It is not a layout algorithm; it is a physics
 * simulation. The method treats the value as a density and runs the linear diffusion equation
 * over a grid covering the map until the density is uniform, then advects every boundary vertex
 * along the resulting velocity field. In practice that means a Fourier-transform-based diffusion
 * solve on a grid of a thousand by a thousand or more, per frame of diffusion time, plus a
 * numerical integration of every vertex through the field. It is a few hundred lines of FFT and
 * a real convergence question, it needs the whole plane rather than a list of rings, and none of
 * it belongs inside a card type that also has to draw a legend. So: named, described, and out of
 * scope. If it is ever wanted here it is a module of its own, not a `kind`.
 *
 * @see ./_geo.mjs -- the projections, the seam, the horizon, the join and the guard
 * @see ./choropleth.mjs -- the same data, encoded the way a cartogram exists to replace
 */

import {
  CK, PROJECTIONS, SCALE_MIN, SCALE_MAX,
  fin, jsonLit, clean, plural, cssId, scoped,
  projector, projectionNote, centredOn, frameFor,
  regionPath, projectPoint, readRegions, readView, joinValues, polysCentroid,
  proportionalRadius, fitMaxRadius, builtinRegions, builtinValues, REGION_NOTE, guardEmitted,
} from './_geo.mjs';

/* ── constants ────────────────────────────────────────────────────────────────────────── */

/** The two kinds this card actually implements. Gastner-Newman is not one of them; see above. */
const KINDS = ['dorling', 'noncontiguous'];

/**
 * The radius the largest value draws at in a Dorling, before the fit.
 *
 * A ceiling rather than the answer: {@link fitMaxRadius} lowers it whenever the circles would not
 * collectively fit, because a set of circles that cannot fit cannot be separated and the
 * relaxation would spend its whole budget reporting a residual overlap that no arrangement could
 * have removed.
 */
const R_MAX = 30;

/** How much of the world box the Dorling circles may cover together before the scale shrinks. */
const DORL_FILL = 0.42;

/** Gap held between two Dorling circles once they have stopped overlapping. */
const DORL_PAD = 0.35;

/**
 * How hard a Dorling circle is pulled back toward its region's centroid, per pass.
 *
 * Much weaker than `bubblemap`'s dodge, and the difference is the whole distinction between the
 * two layouts. On a bubble map the coordinate is the truth and the separation is a concession,
 * so home wins. In a Dorling the SIZE is the truth and the position is only a hint about
 * neighbourhood, so separation wins and home is a whisper -- strong enough to keep Africa south
 * of Europe, too weak to stop a large circle claiming the room its value earns.
 */
const DORL_HOME = 0.025;

/** When a pass moves nothing further than this, the relaxation has converged. */
const DORL_TOL = 0.01;

/** The ceiling on settling passes, so a pathological input cannot hang a build. */
const DORL_ITERS = 400;

/**
 * The ceiling on polishing passes, which run with the pull home switched off.
 *
 * Separation and the pull home are a tug of war, and they reach an EQUILIBRIUM rather than a
 * solution: every pass the pull re-opens a sliver of overlap that the separation then closes, so
 * the circles sit a fraction of a unit inside each other forever. That is a stable state, not a
 * converging one, and no pass budget fixes it. Turning the pull off for a bounded second phase
 * lets the separation finish, and costs only the small extra drift from home that the final
 * separation needs. Both phase counts are reported, so the reader can see which one did the work.
 */
const DORL_POLISH = 160;

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * @example defaults.kind;   // 'dorling'
 */
export const defaults = {
  kind: 'dorling',
  projection: 'equirectangular',
  labels: false,
};

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'cartogram'
 */
export const meta = {
  name: 'cartogram',
  summary:
    'Regions resized so area carries value, as a Dorling of repelled circles or as ' +
    'non-contiguous outlines scaled about their own centroids.',
  shape:
    '{ features, key, values: [{ key, value, of }], kind, unit, projection, ' +
    'center: { lon, lat }, scale } -- ' +
    'features is GeoJSON regions carrying a join key in the property named by key (default ' +
    '"key"), or is omitted for the twenty built-in coarse subregions; values joins to it by ' +
    'that key; kind is "dorling" or "noncontiguous"; contiguous density-equalising ' +
    '(Gastner-Newman) is a diffusion solve and is deliberately not implemented here',
  defaults: { ...defaults },
};

/* ── reading the data ─────────────────────────────────────────────────────────────────── */

/**
 * Normalise the whole `data` block into the one shape the rest of the file may assume.
 *
 * Both kinds need the same three things per region -- an outline, a centroid and an area -- so
 * they are computed once here rather than twice in two layout functions that would then be free
 * to disagree about where a region is.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including every refusal count
 *
 * @example readData({}).regions.length;   // 20
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const builtin = d.features == null;
  const keyProp = typeof d.key === 'string' && d.key ? d.key : 'key';
  const read = readRegions(builtin ? builtinRegions() : d.features, keyProp);
  const view = readView({ ...d, graticule: false },
                        { projection: defaults.projection, graticule: false });

  const rows = builtin && d.values == null ? builtinValues() : d.values;
  const join = joinValues(read.regions, rows);

  const counts = { negative: 0, zero: 0, noCentroid: 0, noArea: 0 };
  const items = [];
  for (let i = 0; i < read.regions.length; i++) {
    const reg = read.regions[i];
    const c = polysCentroid(reg.polys);
    if (!c) { counts.noCentroid++; continue; }
    let v = join.values[i];
    if (v != null && Number.isFinite(v)) {
      /* A negative value has no cartogram. There is no circle of negative area and no shape
         scaled by an imaginary factor, and taking the absolute value would put a loss and a
         gain on the map as the same size. Refused, counted, named in the caption. */
      if (v < 0) { counts.negative++; v = null; }
      else if (v === 0) counts.zero++;
    } else v = null;
    if (!(c.area > 0)) counts.noArea++;
    items.push({ key: reg.key, name: reg.name || reg.key, polys: reg.polys,
                 lon: c.lon, lat: c.lat, area: c.area, value: v });
  }

  const live = items.filter((it) => it.value != null).map((it) => it.value);
  const vmax = live.length ? Math.max(...live) : 0;
  const rMax = fitMaxRadius(live, vmax, R_MAX, DORL_FILL);

  /* The non-contiguous factor is a ratio of DENSITIES, not of values, which is what makes the
     drawn area proportional to value: a region scaled by sqrt(density / maxDensity) ends up with
     drawn area = own area * density / maxDensity = value / maxDensity. Scaling by value alone
     would make a big empty region enormous, which is the choropleth flaw again wearing a hat. */
  let maxDens = 0;
  for (const it of items) {
    if (it.value == null || !(it.area > 0)) continue;
    const dens = it.value / it.area;
    if (dens > maxDens) maxDens = dens;
  }

  const kind = KINDS.indexOf(d.kind) >= 0 ? d.kind : defaults.kind;

  return {
    regions: read.regions, geomCounts: read.counts,
    items, counts, stats: join.stats,
    builtin, keyProp, vmax, rMax, maxDens, kind,
    centre: view.centre, zoom: view.zoom, given: view.given,
    badCentre: view.badCentre, badScale: view.badScale,
    unit: clean(d.unit),
    labels: d.labels == null ? defaults.labels : !!d.labels,
  };
}

/* ── the Dorling relaxation ───────────────────────────────────────────────────────────── */

/**
 * One pass of pairwise separation. Returns the largest push it had to make.
 *
 * Any pair closer than the sum of its radii plus the pad is pushed apart along the line between
 * the centres, by half the shortfall each. That is the whole rule.
 *
 * Coincident centres are separated along a direction derived from the two INDICES rather than
 * from a random number, so a rebuild of identical data produces an identical picture. For a card
 * that is regenerated on every desk swap, a layout that moves when nothing changed is not a
 * subtlety; it is the whole trust story.
 *
 * @param pos circles as `{ x, y, r }`, moved in place
 * @returns the largest push made, which is half of (pad plus overlap) for the worst pair
 *
 * @example separate([{ x: 0, y: 0, r: 5 }, { x: 1, y: 0, r: 5 }]);   // about 4.7
 */
function separate(pos) {
  const n = pos.length;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = pos[i];
      const b = pos[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const want = a.r + b.r + DORL_PAD;
      if (dist >= want) continue;
      if (!(dist > 1e-9)) {
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
}

/**
 * Repel circles until none overlaps, keeping each as near as possible to where its region was.
 *
 * Two phases, and the second one exists because the first one provably cannot finish alone.
 *
 * **Settle.** Separation plus a weak pull back toward the seed. This is what keeps the picture
 * geographic -- Africa stays south of Europe -- and it reaches an EQUILIBRIUM rather than a
 * solution: every pass the pull re-opens a sliver of overlap that the separation closes again,
 * so the circles sit a fraction of a unit inside one another forever. That is a stable state,
 * not a converging one, and no pass budget fixes it. It was measured at about one per cent of
 * the largest radius, which is invisible, and reporting it as "did not converge in four hundred
 * passes" would have been a true sentence that pointed at the wrong thing.
 *
 * **Polish.** Separation alone, pull switched off, bounded. Now the only force left is the one
 * that removes overlap, so it removes it. The cost is the small extra drift from home that the
 * final separation needs, and both phase counts come back so a reader can see which did the work.
 *
 * This is not a cooling schedule and not a global optimiser. There is no temperature, no random
 * restart and no energy function; each phase is a fixed rule run to a fixed stopping condition,
 * so the same regions and the same values give the same circles, byte for byte, forever.
 *
 * Convergence is still not guaranteed and is not claimed. When the circles genuinely do not fit
 * -- two hundred regions on an orthographic hemisphere -- the ceilings stop it and the residual
 * overlap is measured and reported rather than hidden. A cartogram with a stated residual is
 * honest; one that claims to be exact is not. {@link fitMaxRadius} exists to make that case rare,
 * by shrinking the whole scale until the circles could in principle fit.
 *
 * @param seeds projected `{ x, y, r }` in a stable order
 * @returns `{ pos, iters, settle, polish, residual, moved }` -- `residual` is the worst remaining
 *          overlap in view units, and `moved` the worst displacement from the seed
 *
 * @example dorling([{ x: 0, y: 0, r: 5 }, { x: 2, y: 0, r: 5 }]).residual;   // 0
 */
function dorling(seeds) {
  const pos = seeds.map((s) => ({ x: s.x, y: s.y, ox: s.x, oy: s.y, r: s.r }));
  const n = pos.length;

  /* The stopping test is on the OVERLAP, not on the push, and the difference is the pad. A push
     is half of (pad + overlap), so a test against the push alone could never be satisfied while
     the pad is positive. */
  const settled = (worst) => worst * 2 - DORL_PAD < DORL_TOL;

  let settle = 0;
  for (; settle < DORL_ITERS; settle++) {
    const worst = separate(pos);
    for (const p of pos) {
      p.x += (p.ox - p.x) * DORL_HOME;
      p.y += (p.oy - p.y) * DORL_HOME;
    }
    if (settled(worst)) { settle++; break; }
  }

  let polish = 0;
  for (; polish < DORL_POLISH; polish++) {
    if (settled(separate(pos))) { polish++; break; }
  }

  let residual = 0;
  let moved = 0;
  for (let i = 0; i < n; i++) {
    moved = Math.max(moved, Math.hypot(pos[i].x - pos[i].ox, pos[i].y - pos[i].oy));
    for (let j = i + 1; j < n; j++) {
      const gap = pos[i].r + pos[j].r - Math.hypot(pos[j].x - pos[i].x, pos[j].y - pos[i].y);
      if (gap > residual) residual = gap;
    }
  }
  return { pos, iters: settle + polish, settle, polish, residual, moved };
}

/**
 * One region's rings, scaled about its own centroid by a factor at or below one.
 *
 * The scaling happens in lon/lat, BEFORE the projection, and that choice has a consequence worth
 * naming: the shrunk shape is then projected like any other, so it is distorted exactly as its
 * neighbours are and the picture stays internally consistent. The alternative -- scaling in
 * projected space -- would make a region's drawn area depend on where the projection had put it,
 * which is the choropleth flaw creeping back in through the layout.
 *
 * The one place it is wrong is a region written across the antimeridian, whose centroid in raw
 * lon/lat is the mean of coordinates on both sides of the seam and therefore near zero rather
 * than near the region. Such a region shrinks toward the middle of the map instead of toward
 * itself. It is a known and bounded flaw of this simple form; a card that needed it right would
 * have to cut every ring at the seam first and scale each piece about a shared true centre.
 *
 * @param polys the region's polygons, each a list of rings
 * @param cx    the centroid longitude
 * @param cy    the centroid latitude
 * @param f     the scale factor, between 0 and 1
 * @returns polygons of the same shape, scaled
 *
 * @example scaleAbout([[[[0, 0], [2, 0], [2, 2]]]], 1, 1, 0.5)[0][0][0];   // [0.5, 0.5]
 */
function scaleAbout(polys, cx, cy, f) {
  return polys.map((rings) => rings.map((ring) =>
    ring.map((p) => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f])));
}

/* ── projecting ───────────────────────────────────────────────────────────────────────── */

/**
 * Everything one projection needs, both kinds, computed once at build time.
 *
 * Both layouts are built for every projection because `kind` is a viewer setting, and a viewer
 * flipping between them must not pay for a relaxation -- nor should the browser carry a copy of
 * one. The Dorling relaxation runs in PROJECTED space, so it genuinely has to run three times:
 * circles that fit on an equirectangular do not fit on an orthographic hemisphere.
 *
 * @param name one of `PROJECTIONS`
 * @param R    the output of {@link readData}
 * @returns the plan the browser is handed, plus the numbers the caption quotes
 *
 * @example planFor('mercator', R).iters;
 */
function planFor(name, R) {
  const P = projector(name);

  /* The ghost outlines: every region at its true size, faint, under everything. In the
     non-contiguous kind the gap between a shape and its ghost IS the value, so the ghost is not
     decoration -- without it the reader sees small shapes and no reason for them. */
  const ghosts = [];
  for (const it of R.items) {
    const d = regionPath(it.polys, P, R.centre, R.zoom, 'ghost');
    if (d) ghosts.push(d);
  }

  /* ── Dorling ── */
  const radius = R.vmax > 0 ? proportionalRadius(R.vmax, R.rMax) : () => 0;
  const seeds = [];
  let hidden = 0;
  for (const it of R.items) {
    const q = projectPoint(it.lon, it.lat, P, R.centre, R.zoom);
    if (!q.seen) { hidden++; continue; }
    seeds.push({ x: q.x, y: q.y, r: radius(it.value), it });
  }
  /* Largest first, so a big circle claims its room before the small ones settle around it.
     Passing the same order to the relaxation every time is also what keeps it deterministic. */
  seeds.sort((a, b) => (b.r - a.r) || a.it.key.localeCompare(b.it.key));

  const relaxed = dorling(seeds);
  const circles = relaxed.pos.map((p, i) => {
    const it = seeds[i].it;
    return [
      fin(p.x, 'dorling x'), fin(p.y, 'dorling y'), fin(p.r, 'dorling r'),
      it.name,
      tipFor(it, R),
    ];
  });

  /* ── non-contiguous ── */
  const scaled = [];
  let smallest = 1;
  for (const it of R.items) {
    if (it.value == null || !(it.area > 0) || !(R.maxDens > 0)) continue;
    const f = Math.sqrt((it.value / it.area) / R.maxDens);
    if (!(f > 0)) continue;
    if (f < smallest) smallest = f;
    const d = regionPath(scaleAbout(it.polys, it.lon, it.lat, Math.min(1, f)),
                         P, R.centre, R.zoom, 'scaled');
    if (d) scaled.push([d, it.name, tipFor(it, R), Math.round(f * 1000) / 1000]);
  }

  const frame = frameFor(P, R.zoom);
  /* The tally comes back rather than a sentence. Both kinds share every scrap of this geometry
     and differ only in prose, so the relaxation runs ONCE per projection and {@link describe} is
     called twice over the same numbers. Running it twice would be wasteful and, worse, would be
     two answers to one question the moment anything in it stopped being deterministic. */
  const tally = { circles: circles.length, scaled: scaled.length, hidden, relaxed, smallest };

  return {
    view: frame.view, rect: frame.rect, disc: frame.disc, fs: frame.fs,
    ghosts, circles, scaled, tally, P,
    hidden,
    iters: relaxed.iters,
    settle: relaxed.settle,
    polish: relaxed.polish,
    residual: Math.round(relaxed.residual * 1000) / 1000,
    shift: Math.round(relaxed.moved * 100) / 100,
    smallest: Math.round(smallest * 1000) / 1000,
  };
}

/** One region's tooltip: what it is, what it is worth, and what that is per unit of its area. */
function tipFor(it, R) {
  const unit = R.unit ? ' ' + R.unit : '';
  if (it.value == null) return (it.name || 'unnamed region') + ' · no value';
  return (it.name || 'unnamed region') + ' · ' + CK.fmt(it.value) + unit +
    (it.area > 0 ? ' · density ' + CK.fmt(Math.round(it.value / it.area * 1000) / 1000) : '');
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides an SVG's internals, so the label IS the map. It has to say which of the two
 * cartograms this is and what each one throws away, because a reader who cannot see the picture
 * cannot tell a Dorling from a non-contiguous map and the two answer different questions.
 *
 * @returns `{ aria, note }`, both plain text; the note is set with `textContent`
 *
 * @example describe(R, projector('mercator'), tally).note;
 */
function describe(R, P, tally) {
  const where = centredOn(R.centre, P.cylindrical);
  const how = projectionNote(P.name);

  const dorlingNote =
    'Dorling: every region is a circle whose AREA is its value, seeded at the region centroid ' +
    'and repelled until the circles separate. Shape is discarded on purpose -- shape was what ' +
    'gave Greenland more ink than India. ' +
    plural(tally.circles, 'circle', 'circles') + ' settled in ' +
    plural(tally.relaxed.iters, 'pass', 'passes') + ' (' + tally.relaxed.settle +
    ' settling against a pull back toward the centroid, then ' + tally.relaxed.polish +
    ' polishing with that pull off, because the two forces reach an equilibrium rather than a ' +
    'solution), worst residual overlap ' +
    (Math.round(tally.relaxed.residual * 1000) / 1000) + ' view units, worst move from the ' +
    'centroid ' + (Math.round(tally.relaxed.moved * 100) / 100) + ' units.';

  const nonNote =
    'Non-contiguous: every region keeps its own outline and is scaled about its own centroid ' +
    'until its drawn area is proportional to its value, so nothing is distorted and the ' +
    'regions come apart instead. The faint ghosts are the true outlines; the gap between a ' +
    'shape and its ghost is the value. ' + plural(tally.scaled, 'region', 'regions') +
    ' drawn, the smallest at ' + (Math.round(tally.smallest * 1000) / 1000) +
    ' of its true width. The gaps are not sea.';

  const missing =
    'Contiguous density-equalising -- Gastner-Newman -- is not offered: it is a diffusion solve ' +
    'over a grid rather than a layout, and it is named here so nobody wonders whether it was ' +
    'forgotten.';

  const gone = tally.hidden
    ? ' ' + plural(tally.hidden, 'region is', 'regions are') + ' over the horizon and culled.'
    : '';

  const note = (R.kind === 'dorling' ? dorlingNote : nonNote) + ' ' + how + '. ' +
    where.charAt(0).toUpperCase() + where.slice(1) + '.' + gone + ' ' + missing;

  const aria =
    (R.builtin ? 'World cartogram' : 'Cartogram') + ', ' + R.kind + ', ' + P.name + ', ' +
    where + '. ' + (R.kind === 'dorling' ? dorlingNote : nonNote) + gone +
    ' ' + how.charAt(0).toUpperCase() + how.slice(1) + '.';

  return { note: note.replace(/\s+/g, ' ').trim(), aria: aria.replace(/\s+/g, ' ').trim() };
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. The ghost outline is a stroke with no fill and the shrunk shape is
 * a fill with a stroke, so the two never read as the same kind of thing even at the sizes where
 * an opacity difference would be invisible.
 */
function cardCss(id) {
  const own = '.ck-cartogram[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-car-wrap', 'margin-top: 2px;'],
    ['svg.ck-car-art', 'display: block; width: 100%; height: auto; overflow: hidden;'],
    ['svg.ck-car-art text', 'font-family: var(--mono); fill: var(--ink-dim);'],

    ['.ck-car-art .ck-sphere', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-car-art .ck-ghost',
     'fill: none; stroke: var(--ck-grid); stroke-width: 0.6; stroke-dasharray: 2 2;'],
    ['.ck-car-art .ck-blob',
     'fill: var(--ck-s5); fill-opacity: .45; stroke: var(--ck-s5); stroke-width: 0.8;'],
    ['.ck-car-art .ck-scaled',
     'fill: var(--ck-s5); fill-opacity: .5; stroke: var(--ck-s5); stroke-width: 0.6;'],

    ['.ck-car-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scoped(own, rules) + '\n';
}

/**
 * The card's markup: one section, a gear, the settings panel, the map and the caption.
 */
function cardHtml(id, title, R, plan) {
  const e = CK.esc;
  const c = R.counts;
  const g = R.geomCounts;
  const s = R.stats;

  const junk = [];
  if (c.negative) junk.push(plural(c.negative, 'value was', 'values were') + ' negative and ' +
    (c.negative === 1 ? 'was' : 'were') + ' refused -- there is no circle of negative area and ' +
    'no shape scaled by an imaginary factor');
  if (c.zero) junk.push(plural(c.zero, 'value is', 'values are') + ' zero, so ' +
    (c.zero === 1 ? 'that region vanishes' : 'those regions vanish') + ' in both kinds');
  if (c.noArea) junk.push(plural(c.noArea, 'region has', 'regions have') +
    ' no measurable area, so ' + (c.noArea === 1 ? 'it cannot' : 'they cannot') +
    ' be scaled by density and ' + (c.noArea === 1 ? 'is' : 'are') +
    ' left out of the non-contiguous kind');
  if (c.noCentroid) junk.push(plural(c.noCentroid, 'region', 'regions') + ' had no usable centroid');
  if (g.noKey) junk.push(plural(g.noKey, 'feature has', 'features have') +
    ' no "' + R.keyProp + '" property, so nothing can ever join to ' +
    (g.noKey === 1 ? 'it' : 'them'));
  if (g.duplicate) junk.push(plural(g.duplicate, 'feature shares', 'features share') +
    ' a key with another and ' + (g.duplicate === 1 ? 'takes' : 'take') + ' the same value');
  if (g.outOfRange) junk.push(plural(g.outOfRange, 'shape', 'shapes') +
    ' held a coordinate off the Earth and ' + (g.outOfRange === 1 ? 'was' : 'were') + ' refused');
  if (g.tooFew) junk.push(plural(g.tooFew, 'ring', 'rings') + ' had fewer than three distinct points');
  if (g.badGeom) junk.push(plural(g.badGeom, 'geometry', 'geometries') + ' was of a kind this card does not draw');
  if (s.nonNumeric) junk.push(plural(s.nonNumeric, 'value was', 'values were') + ' not a number');
  if (s.keyless) junk.push(plural(s.keyless, 'value row has', 'value rows have') + ' no key');
  if (s.duplicateRows) junk.push(plural(s.duplicateRows, 'value row was', 'value rows were') +
    ' a repeat of a key already seen, and the last one won');
  if (R.badCentre) junk.push('the centre was off the Earth and was refused');
  if (R.badScale) junk.push('the zoom was outside ' + SCALE_MIN + ' to ' + SCALE_MAX + ' and was refused');

  const empty = R.items.length ? '' :
    '  <div class="ck-car-void">nothing to draw &mdash; no usable regions</div>\n';

  const joinLine =
    '<b>' + e(String(s.matched)) + '</b> of <b>' + e(String(R.regions.length)) + '</b> ' +
    (R.regions.length === 1 ? 'region' : 'regions') + ' matched a value; <b>' +
    e(String(s.noValue)) + '</b> ' + (s.noValue === 1 ? 'region has' : 'regions have') +
    ' no value; <b>' + e(String(s.noFeature)) + '</b> ' +
    (s.noFeature === 1 ? 'value matched no region' : 'values matched no region') + '. ' +
    (s.normalised ? 'Values are normalised by the denominator every matched row carried. '
      : 'Values are as given. ');

  return '<section data-card="' + e(id) + '" class="ck-cartogram">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-kind">kind</label>\n' +
    '    <select id="' + e(id) + '-kind" name="kind">\n' +
    KINDS.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-projection">projection</label>\n' +
    '    <select id="' + e(id) + '-projection" name="projection">\n' +
    PROJECTIONS.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-labels" name="labels">\n' +
    '    <div class="ck-set-foot">' +
    'contiguous density-equalising (Gastner&ndash;Newman) is not offered: it is a diffusion ' +
    'solve over a grid rather than a layout, and it is named here so nobody wonders whether ' +
    'it was forgotten. ' +
    e('the Dorling settled in ' + plan.iters + ' passes with ' + plan.residual +
      ' view units of residual overlap.') +
    '</div>\n' +
    '  </div>\n' +
    empty +
    '  <div class="ck-car-wrap ck-scroll">\n' +
    '    <svg class="ck-car-art" role="img" viewBox="' + e(plan.view) +
    '" aria-label="' + e(plan.aria[R.kind]) + '"></svg>\n' +
    '  </div>\n' +
    '  <div class="ck-cap">' + joinLine +
    '<i class="ck-car-note">' + e(plan.note[R.kind]) + '</i>' +
    '<span class="ck-aside"> ' +
    (R.builtin ? REGION_NOTE.charAt(0).toUpperCase() + REGION_NOTE.slice(1) + '.' : '') +
    (junk.length ? ' ' + e(junk.join('; ')) + '.' : '') +
    '</span></div>\n' +
    '</section>\n';
}

/**
 * The browser half: pick a projection and a kind, and paint.
 *
 * Shipped by `Function.prototype.toString()`, so the text a test exercises is the text the page
 * runs, comments and all -- which is why not one of them contains a backtick.
 *
 * Nothing here relaxes anything. Both layouts, in all three projections, were computed in Node.
 *
 * @param sec the card's section
 * @param M   the emitted model
 * @param DEF this instance's fallbacks, same key set as the exported defaults
 */
function cartoDraw(sec, M, DEF) {
  var NS = "http://www.w3.org/2000/svg";
  var art = sec.querySelector("svg.ck-car-art");
  var note = sec.querySelector(".ck-car-note");

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

  function draw(cfg) {
    var pname = pick(cfg.projection, M.proj, DEF.projection);
    var P = M.proj[pname];
    var kind = pick(cfg.kind, M.kinds, DEF.kind);
    var wantLab = flag(cfg.labels, DEF.labels);
    var frag, i, row, g, shape;

    if (note) { note.textContent = P.note[kind]; }
    if (!art) { return; }

    frag = document.createDocumentFragment();
    if (P.disc > 0) {
      frag.appendChild(el("circle", { "class": "ck-sphere", cx: 0, cy: 0, r: P.disc }));
    } else if (P.rect) {
      frag.appendChild(el("rect", { "class": "ck-sphere", x: P.rect[0], y: P.rect[1],
                                    width: P.rect[2], height: P.rect[3] }));
    }

    /* The ghosts go down first in both kinds. In the non-contiguous one the gap between a shape
       and its ghost is the value; in the Dorling they are the only thing left that says where
       the world is, once every shape has become a circle. */
    for (i = 0; i < P.ghosts.length; i++) {
      frag.appendChild(el("path", { "class": "ck-ghost", "fill-rule": "evenodd", d: P.ghosts[i] }));
    }

    if (kind === "noncontiguous") {
      for (i = 0; i < P.scaled.length; i++) {
        row = P.scaled[i];
        g = el("g", null);
        shape = el("path", { "class": "ck-scaled", "fill-rule": "evenodd", d: row[0] });
        shape.appendChild(el("title", null, row[2]));
        g.appendChild(shape);
        frag.appendChild(g);
      }
    } else {
      for (i = 0; i < P.circles.length; i++) {
        row = P.circles[i];
        g = el("g", null);
        shape = el("circle", { "class": "ck-blob", cx: row[0], cy: row[1], r: row[2] });
        shape.appendChild(el("title", null, row[4]));
        g.appendChild(shape);
        if (wantLab && row[3] && row[2] > 4) {
          g.appendChild(el("text", { x: row[0], y: row[1] + P.fs * 0.36,
                                     "font-size": P.fs, "text-anchor": "middle" }, row[3]));
        }
        frag.appendChild(g);
      }
    }

    while (art.firstChild) { art.removeChild(art.firstChild); }
    art.appendChild(frag);
    art.setAttribute("viewBox", P.view);
    art.setAttribute("aria-label", P.aria[kind]);
  }

  CK.settings(sec, DEF, draw);
}

/**
 * The emitted script.
 */
function cardJs(id, model, inst) {
  return '/* cartogram card: both layouts, all three projections, computed in Node. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n' +
    cartoDraw.toString() + '\n' +
    '  cartoDraw(sec, ' + jsonLit(model) + ', ' + jsonLit(inst) + ');\n' +
    '});\n';
}

/**
 * Build one cartogram card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape; omit `features` for the built-in subregions
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the Dorling's pass count, worst move and
 *          residual overlap per projection, so the claim in the caption is checkable
 *
 * @throws {Error} when the arithmetic produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk
 *
 * @example
 * build({
 *   id: 'weight',
 *   title: 'where the work actually is',
 *   data: { kind: 'dorling', values: [{ key: 'eastern-asia', value: 1600 }] },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'cartogram' : id);
  const R = readData(data);

  /* Both kinds get their own describing sentences, because `kind` is a viewer setting and the
     caption has to change with it -- a Dorling described as a non-contiguous map would be worse
     than no caption, since it would be believed. The geometry is computed once and described
     twice. */
  const plans = {};
  for (const p of PROJECTIONS) {
    const q = planFor(p, R);
    const note = {};
    const aria = {};
    for (const k of KINDS) {
      const said = describe({ ...R, kind: k }, q.P, q.tally);
      note[k] = said.note;
      aria[k] = said.aria;
    }
    plans[p] = { ...q, note, aria };
  }

  const model = {
    proj: {},
    kinds: Object.fromEntries(KINDS.map((k) => [k, 1])),
  };
  for (const p of PROJECTIONS) {
    const q = plans[p];
    model.proj[p] = {
      view: q.view, rect: q.rect, disc: q.disc, fs: q.fs,
      ghosts: q.ghosts, circles: q.circles, scaled: q.scaled,
      note: q.note, aria: q.aria,
    };
  }

  const inst = { kind: R.kind, projection: R.given, labels: R.labels };
  const active = plans[R.given];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'cartogram',
      kind: R.kind,
      projection: R.given,
      builtin: R.builtin,
      regions: R.regions.length,
      placed: R.items.length,
      max: R.vmax,
      maxRadius: Math.round(R.rMax * 100) / 100,
      radiusCeiling: R_MAX,
      maxDensity: R.maxDens,
      join: { ...R.stats },
      notImplemented: 'contiguous density-equalising (Gastner-Newman) -- a diffusion solve ' +
        'over a grid, out of scope for a card type',
      refused: { ...R.counts, geometry: { ...R.geomCounts },
                 centre: R.badCentre, zoom: R.badScale },
      dorling: Object.fromEntries(PROJECTIONS.map((p) => [p, {
        iterations: plans[p].iters,
        settlePasses: plans[p].settle, polishPasses: plans[p].polish,
        residualOverlap: plans[p].residual,
        worstMoveFromCentroid: plans[p].shift, circles: plans[p].circles.length,
      }])),
      noncontiguous: Object.fromEntries(PROJECTIONS.map((p) => [p, {
        drawn: plans[p].scaled.length, smallestFactor: plans[p].smallest,
      }])),
      hidden: Object.fromEntries(PROJECTIONS.map((p) => [p, plans[p].hidden])),
    },
    html: cardHtml(cardId, title == null ? cardId : clean(title), R, active),
    css: cardCss(cardId),
    js: guardEmitted(cardJs(cardId, model, inst), cardId),
  };
}
