/**
 * `spikemap` -- vertical spikes on a map, with height linear in value.
 *
 * Two things make a spike map better than a bubble map, and both are worth stating because both
 * are the reason to reach for it rather than a matter of taste.
 *
 * **Spikes overlap legibly and discs do not.** A disc that lands on another disc hides it: the
 * reader sees one shape and one value where there were two, and no amount of transparency
 * recovers the count. A spike is a thin triangle a couple of view units wide, so two spikes at
 * nearly the same place still show two outlines and, crucially, two TIPS -- and the tip is where
 * the value is read. This is why a spike map survives a dense city dataset that turns a bubble
 * map into a single blob, and why this card has no dodge setting: it does not need one, so it
 * does not have to move anything off its coordinate to stay readable.
 *
 * **Height is linear, so there is no area problem.** A bubble has to take the square root of the
 * value, because a disc's ink grows as the square of its radius and a reader who forgets that
 * reads every ratio squared. A spike encodes into a single length. Twice the value is exactly
 * twice the height, there is no square anywhere in the pipeline, and the comparison a reader
 * makes -- one length against another -- is the one comparison the eye does accurately without
 * being taught. The cost is that a spike takes vertical room and can run off the top of the map,
 * which is why the tallest one is fitted to a fixed fraction of the view.
 *
 * @see ./_geo.mjs -- the projections, the seam, the horizon and the guard
 * @see ./bubblemap.mjs -- the same data when the points are sparse and the ink should be area
 */

import {
  CK, PROJECTIONS, SCALE_MIN, SCALE_MAX,
  fin, jsonLit, clean, plural, spoken, cssId, scoped,
  projector, projectionNote, centredOn, frameFor,
  regionPath, projectPoint, readRegions, readView, joinValues, polysCentroid,
  position, builtinRegions, builtinValues, REGION_NOTE, guardEmitted,
} from './_geo.mjs';

/* ── constants ────────────────────────────────────────────────────────────────────────── */

/**
 * The height the largest value draws at, in view units, where the world is 360 wide and 180 tall.
 *
 * A quarter of the equirectangular world's height. Tall enough that the spread of the data is the
 * thing you see, short enough that a spike in Norway does not leave the viewport -- which matters
 * more than it sounds, because a clipped spike reads as a shorter spike and there is nothing on
 * the page to say it was cut.
 */
const H_MAX = 46;

/** Half the base width of a spike, in view units. Thin enough that two can overlap and both read. */
const SPIKE_W2 = 1.35;

/** The three reference heights in the legend, as fractions of the maximum value. */
const LEGEND_STOPS = [1, 0.5, 0.25];

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * `labels` is off by default here where it is also off on `bubblemap`, but for a different
 * reason: a spike map is for dense data, and dense data with a label on every spike is a page
 * of text with a map behind it.
 *
 * @example defaults.legend;   // true
 */
export const defaults = {
  projection: 'equirectangular',
  labels: false,
  legend: true,
};

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'spikemap'
 */
export const meta = {
  name: 'spikemap',
  summary:
    'Vertical spikes on a projected map with height linear in value, legible where overlapping ' +
    'bubbles would bury each other.',
  shape:
    '{ features, key, values: [{ key, value, of }], points: [{ lon, lat, label, value }], ' +
    'unit, max, projection, center: { lon, lat }, scale } -- ' +
    'features is GeoJSON regions, or is omitted for the twenty built-in coarse subregions, ' +
    'and supplies both the outline behind the spikes and the centroids they stand on; points ' +
    'places spikes at explicit coordinates instead; values joins to the regions by the ' +
    'property named by key (default "key"); max fixes the top of the scale so two cards can ' +
    'be compared, and values above it are clamped and counted',
  defaults: { ...defaults },
};

/* ── reading the data ─────────────────────────────────────────────────────────────────── */

/**
 * Every datum a spike could come from, normalised into one list of places with values.
 *
 * The same two sources as `bubblemap`, and not merged for the same reason: `points` answers
 * "where are these places" and a region join answers "how much in each place", and one visual
 * channel cannot carry both without a legend that admits it is carrying two things.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including every refusal count
 *
 * @example readData({}).spikes.length;   // 20
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
  const spikes = [];
  let source;
  let join = { values: [], stats: null };

  if (Array.isArray(d.points)) {
    source = 'points';
    for (const raw of d.points) {
      const o = raw && typeof raw === 'object' ? raw : {};
      const q = position(Array.isArray(o) ? o : [o.lon, o.lat]);
      if (!q) { counts.outOfRange++; continue; }
      const label = clean(o.label == null ? (o.name == null ? '' : o.name) : o.label);
      spikes.push({ lon: q[0], lat: q[1], label, raw: o.value });
    }
  } else {
    source = 'regions';
    const rows = builtin && d.values == null ? builtinValues() : d.values;
    join = joinValues(read.regions, rows);
    for (let i = 0; i < read.regions.length; i++) {
      const reg = read.regions[i];
      const c = polysCentroid(reg.polys);
      if (!c) { counts.noCentroid++; continue; }
      spikes.push({ lon: c.lon, lat: c.lat, label: reg.name || reg.key, raw: join.values[i] });
    }
  }

  /* A negative value is refused rather than drawn downward. A downward spike is a perfectly
     good encoding and it is a DIFFERENT one -- it uses direction as a second channel -- so
     mixing the two on one card would mean two spikes of the same length meaning opposite
     things, with only a sign in a tooltip to tell them apart. One channel, one meaning, and
     the refusals are counted where the reader can see them. */
  const ceiling = Number(d.max);
  const hasCeiling = Number.isFinite(ceiling) && ceiling > 0;
  for (const sp of spikes) {
    if (sp.raw == null) { counts.noValue++; sp.value = null; continue; }
    const v = Number(sp.raw);
    if (!Number.isFinite(v)) { counts.nonNumeric++; sp.value = null; continue; }
    if (v < 0) { counts.negative++; sp.value = null; continue; }
    if (v === 0) counts.zero++;
    if (hasCeiling && v > ceiling) counts.capped++;
    sp.value = v;
  }

  const live = spikes.filter((p) => p.value != null).map((p) => p.value);
  const vmax = hasCeiling ? ceiling : (live.length ? Math.max(...live) : 0);

  return {
    regions: read.regions, geomCounts: read.counts,
    spikes, counts, source, builtin, keyProp,
    stats: join.stats,
    vmax, hasCeiling,
    centre: view.centre, zoom: view.zoom, given: view.given,
    badCentre: view.badCentre, badScale: view.badScale,
    unit: clean(d.unit),
    labels: d.labels == null ? defaults.labels : !!d.labels,
    legend: d.legend == null ? defaults.legend : !!d.legend,
  };
}

/**
 * Spike height from value, linearly, anchored at zero.
 *
 * Anchored at zero rather than fitted to the observed range, so the ratio of two heights is the
 * ratio of two values. A range-fitted height would make the smallest spike visible and make
 * every comparison on the map wrong by an offset the reader cannot see or subtract.
 *
 * @param vmax the value that draws at {@link H_MAX}
 * @returns a function from value to height in view units; a null or non-positive value gives 0
 *
 * @example heightFor(200)(50);   // 11.5 -- a quarter of the value, a quarter of the height
 */
function heightFor(vmax) {
  if (!(vmax > 0)) return () => 0;
  return (v) => {
    if (v == null || !Number.isFinite(v) || v <= 0) return 0;
    return H_MAX * Math.min(v, vmax) / vmax;
  };
}

/* ── projecting ───────────────────────────────────────────────────────────────────────── */

/**
 * Everything one projection needs, computed once at build time.
 *
 * @param name one of `PROJECTIONS`
 * @param R    the output of {@link readData}
 * @returns the plan the browser is handed, plus the numbers the caption quotes
 *
 * @example planFor('mercator', R).spikes.length;
 */
function planFor(name, R) {
  const P = projector(name);
  const land = [];
  for (const reg of R.regions) {
    const d = regionPath(reg.polys, P, R.centre, R.zoom, 'region');
    if (d) land.push(d);
  }

  const height = heightFor(R.vmax);
  const placed = [];
  let hidden = 0;
  for (const sp of R.spikes) {
    const q = projectPoint(sp.lon, sp.lat, P, R.centre, R.zoom);
    if (!q.seen) { hidden++; continue; }
    placed.push({
      x: q.x, y: q.y, h: height(sp.value), seq: placed.length,
      label: sp.label,
      tip: (sp.label || 'unnamed place') +
        (sp.value == null ? ' · no value' : ' · ' + CK.fmt(sp.value) + (R.unit ? ' ' + R.unit : '')) +
        ' · ' + spoken(sp.lat, 'north', 'south') + ', ' + spoken(sp.lon, 'east', 'west'),
    });
  }

  /* Tallest first. Nothing is hidden by a spike -- that is the point of the form -- but drawing
     the short ones last puts their outlines on top, which is what makes a cluster countable.
     The tie-break on the original index keeps identical data drawing identically. */
  placed.sort((a, b) => (b.h - a.h) || (a.seq - b.seq));

  const spikes = placed.map((p) => {
    const x = fin(p.x, 'spike x');
    const y = fin(p.y, 'spike y');
    const h = fin(p.h, 'spike h');
    const w = fin(SPIKE_W2, 'spike w');
    const d = h > 0
      ? 'M' + (x - w) + ' ' + y + 'L' + x + ' ' + fin(p.y - p.h, 'spike tip') +
        'L' + (x + w) + ' ' + y + 'Z'
      : '';
    return [d, x, y, h, p.label, p.tip];
  });

  const frame = frameFor(P, R.zoom);
  const said = describe(R, P, { drawn: placed.length, hidden });

  return {
    view: frame.view, rect: frame.rect, disc: frame.disc, fs: frame.fs,
    land, spikes,
    note: said.note, aria: said.aria,
    hidden,
  };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides an SVG's internals, so the label IS the map to anyone using one, and it has
 * to carry the encoding: a reader who cannot see the spikes needs to be told that height is
 * linear, because that is the whole reason the numbers can be compared by eye.
 *
 * @returns `{ aria, note }`, both plain text; the note is set with `textContent`
 *
 * @example describe(R, projector('mercator'), tally).note;
 */
function describe(R, P, tally) {
  const where = centredOn(R.centre, P.cylindrical);
  const how = projectionNote(P.name);

  const encoding =
    'height is linear in value, so twice the value is exactly twice the height and there is no ' +
    'square anywhere -- a spike map has none of the bubble map area problem, where the ink ' +
    'grows as the square of the radius and every ratio reads doubled unless the square root is ' +
    'taken first. Spikes also overlap legibly: two spikes at nearly the same place still show ' +
    'two tips, where two discs show one shape.';

  const drawn = tally.drawn
    ? plural(tally.drawn, 'spike', 'spikes') + ' drawn'
    : 'no spikes to draw';

  const gone = tally.hidden
    ? ' ' + plural(tally.hidden, 'spike is', 'spikes are') + ' over the horizon and culled.'
    : '';

  const note = how + '. ' + drawn + ', ' + where + '. ' + encoding + gone;

  const aria =
    (R.builtin ? 'World spike map' : 'Spike map') + ', ' + P.name + ', ' + where + '. ' +
    drawn.charAt(0).toUpperCase() + drawn.slice(1) + ', where ' + encoding + gone +
    ' ' + how.charAt(0).toUpperCase() + how.slice(1) + '.';

  return { note: note.replace(/\s+/g, ' ').trim(), aria: aria.replace(/\s+/g, ' ').trim() };
}

/**
 * Three reference spikes, at the maximum value, half of it and a quarter.
 *
 * Half and a quarter rather than the bubble legend's quarter and sixteenth, and the difference IS
 * the lesson: because height is linear, half the value is half the height, so the legend reads as
 * a ruler. A reader who has both cards on one desk can see the two encodings differ by looking at
 * the two legends, which is worth more than a sentence saying so.
 *
 * @param R the output of {@link readData}
 * @returns `{ box, rows, w, h, lx }` with each row `[d, ty, text]` in legend units
 *
 * @example legendFor(R).rows.length;   // 3
 */
function legendFor(R) {
  if (!(R.vmax > 0)) return { box: '0 0 1 1', rows: [], w: 0, h: 0, lx: 0 };
  const height = heightFor(R.vmax);
  const rows = [];
  const gap = 13;
  let x = SPIKE_W2 + 2;
  for (const frac of LEGEND_STOPS) {
    const v = R.vmax * frac;
    const hgt = height(v);
    const base = H_MAX + 2;
    rows.push([
      'M' + fin(x - SPIKE_W2, 'legend') + ' ' + fin(base, 'legend') +
      'L' + fin(x, 'legend') + ' ' + fin(base - hgt, 'legend') +
      'L' + fin(x + SPIKE_W2, 'legend') + ' ' + fin(base, 'legend') + 'Z',
      fin(x, 'legend'), fin(base - hgt - 2, 'legend'),
      CK.fmt(Math.round(v * 100) / 100) + (R.unit ? ' ' + R.unit : ''),
    ]);
    x += gap;
  }
  const w = x + 6;
  const h = H_MAX + 4;
  return { box: '0 0 ' + fin(w, 'legend w') + ' ' + fin(h, 'legend h'), rows,
           w: fin(w, 'legend w'), h: fin(h, 'legend h'), lx: 0 };
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. The spike is drawn with a fill AND a stroke on purpose: the fill
 * gives it weight at a glance and the stroke is what keeps two overlapping spikes readable as
 * two, which is the whole argument for this form over a bubble map.
 */
function cardCss(id) {
  const own = '.ck-spikemap[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-spk-wrap', 'margin-top: 2px;'],
    ['svg.ck-spk-art', 'display: block; width: 100%; height: auto; overflow: hidden;'],
    ['svg.ck-spk-art text', 'font-family: var(--mono); fill: var(--ink-dim);'],

    ['.ck-spk-art .ck-sphere', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-spk-art .ck-land', 'fill: var(--ink); fill-opacity: .12; stroke: var(--rule); stroke-width: 0.5;'],
    ['.ck-spk-art .ck-spike',
     'fill: var(--ck-s1); fill-opacity: .5; stroke: var(--ck-s1); stroke-width: 0.5; ' +
     'stroke-linejoin: round;'],
    ['.ck-spk-art .ck-spike-none',
     'fill: none; stroke: var(--ink-faint); stroke-width: 0.6; stroke-dasharray: 1.5 1.5;'],

    ['svg.ck-spk-leg', 'display: block; height: 52px; width: auto; overflow: visible; margin-top: 9px;'],
    ['svg.ck-spk-leg text',
     'font-family: var(--mono); font-size: 6.5px; fill: var(--ink-faint); text-anchor: middle;'],
    ['svg.ck-spk-leg path',
     'fill: var(--ck-s1); fill-opacity: .5; stroke: var(--ck-s1); stroke-width: 0.5;'],

    ['.ck-spk-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  return scoped(own, rules) + '\n' +
    ':root[data-theme="light"] ' + own + ' .ck-spk-art .ck-land { fill-opacity: .16; }\n';
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
  if (c.noValue) junk.push(plural(c.noValue, 'place has', 'places have') + ' no value at all');
  if (c.nonNumeric) junk.push(plural(c.nonNumeric, 'value was', 'values were') + ' not a number');
  if (c.noValue + c.nonNumeric) junk.push('a place with no usable number draws as a dashed ' +
    'stub rather than as a short spike, which a reader would read as a small value');
  if (c.negative) junk.push(plural(c.negative, 'value was', 'values were') + ' negative and ' +
    (c.negative === 1 ? 'was' : 'were') + ' refused -- a downward spike is a different encoding, ' +
    'and mixing the two would put two equal lengths on the map meaning opposite things');
  if (c.zero) junk.push(plural(c.zero, 'value is', 'values are') + ' zero, so ' +
    (c.zero === 1 ? 'it has' : 'they have') + ' no height and cannot be seen');
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
    : '<b>' + e(String(R.spikes.length)) + '</b> ' +
      (R.spikes.length === 1 ? 'point' : 'points') + ' placed by coordinate. ';

  const empty = R.spikes.length ? '' :
    '  <div class="ck-spk-void">nothing to draw &mdash; no usable places</div>\n';

  return '<section data-card="' + e(id) + '" class="ck-spikemap">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-projection">projection</label>\n' +
    '    <select id="' + e(id) + '-projection" name="projection">\n' +
    PROJECTIONS.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-labels" name="labels">\n' +
    '    <label for="' + e(id) + '-legend">legend</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-legend" name="legend">\n' +
    '    <div class="ck-set-foot">' +
    'the centre and the zoom belong to this card&rsquo;s data, not to you. ' +
    e('the tallest spike is ' + H_MAX + ' view units on a world 180 units tall, so a spike ' +
      'never leaves the viewport and no height is silently clipped.') +
    '</div>\n' +
    '  </div>\n' +
    empty +
    '  <div class="ck-spk-wrap ck-scroll">\n' +
    '    <svg class="ck-spk-art" role="img" viewBox="' + e(plan.view) +
    '" aria-label="' + e(plan.aria) + '"></svg>\n' +
    '  </div>\n' +
    '  <svg class="ck-spk-leg" role="img" viewBox="' + e(leg.box) +
    '" aria-label="Legend: three reference spikes at the maximum value, half of it and a ' +
    'quarter, at exactly one, one half and one quarter of the tallest height &mdash; because ' +
    'height is linear in value."></svg>\n' +
    '  <div class="ck-cap">' + joinLine +
    '<i class="ck-spk-note">' + e(plan.note) + '</i>' +
    '<span class="ck-aside"> ' +
    (R.builtin ? REGION_NOTE.charAt(0).toUpperCase() + REGION_NOTE.slice(1) + '.' : '') +
    (junk.length ? ' ' + e(junk.join('; ')) + '.' : '') +
    '</span></div>\n' +
    '</section>\n';
}

/**
 * The browser half: pick a projection and paint the spikes.
 *
 * Shipped by `Function.prototype.toString()`, so the text a test exercises is the text the page
 * runs, comments and all -- which is why not one of them contains a backtick.
 *
 * Nothing here decides a height. Every triangle in every projection was built in Node.
 *
 * @param sec the card's section
 * @param M   the emitted model
 * @param DEF this instance's fallbacks, same key set as the exported defaults
 */
function spikeDraw(sec, M, DEF) {
  var NS = "http://www.w3.org/2000/svg";
  var art = sec.querySelector("svg.ck-spk-art");
  var legArt = sec.querySelector("svg.ck-spk-leg");
  var note = sec.querySelector(".ck-spk-note");

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
    var wantLab = flag(cfg.labels, DEF.labels);
    var wantLeg = flag(cfg.legend, DEF.legend);
    var frag, i, s, g, shape, row;

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

      for (i = 0; i < P.spikes.length; i++) {
        s = P.spikes[i];
        g = el("g", null);
        if (s[0]) {
          shape = el("path", { "class": "ck-spike", d: s[0] });
        } else {
          /* No usable value, and a zero-height triangle would be indistinguishable from a very
             small one. A stub of a different KIND says "nothing here" rather than "not much". */
          shape = el("path", { "class": "ck-spike-none",
                               d: "M" + (s[1] - 1.6) + " " + s[2] + "L" + (s[1] + 1.6) + " " + s[2] });
        }
        shape.appendChild(el("title", null, s[5]));
        g.appendChild(shape);
        if (wantLab && s[4]) {
          g.appendChild(el("text", { x: s[1] + 2.2, y: s[2] - s[3] - 1.5,
                                     "font-size": P.fs }, s[4]));
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
      frag.appendChild(el("path", { d: row[0] }));
      frag.appendChild(el("text", { x: row[1], y: row[2] }, row[3]));
    }
    legArt.appendChild(frag);
  }

  CK.settings(sec, DEF, draw);
}

/**
 * The emitted script.
 */
function cardJs(id, model, inst) {
  return '/* spikemap card: projections and every triangle computed in Node. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n' +
    spikeDraw.toString() + '\n' +
    '  spikeDraw(sec, ' + jsonLit(model) + ', ' + jsonLit(inst) + ');\n' +
    '});\n';
}

/**
 * Build one spike map card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape; omit everything for the built-in demonstration
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the scale maximum and every refusal, so
 *          a reader can check what the tallest spike means without measuring it
 *
 * @throws {Error} when the arithmetic produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk
 *
 * @example
 * build({
 *   id: 'quakes',
 *   title: 'events by epicentre',
 *   data: {
 *     points: [{ lon: 139.7, lat: 35.7, label: 'Tokyo', value: 44 }],
 *     unit: 'events',
 *   },
 *   ord: 35,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'spikemap' : id);
  const R = readData(data);

  const plans = {};
  for (const p of PROJECTIONS) plans[p] = planFor(p, R);
  const leg = legendFor(R);

  const model = { proj: {}, leg };
  for (const p of PROJECTIONS) {
    const q = plans[p];
    model.proj[p] = {
      view: q.view, rect: q.rect, disc: q.disc, fs: q.fs,
      land: q.land, spikes: q.spikes,
      note: q.note, aria: q.aria,
    };
  }

  const inst = { projection: R.given, labels: R.labels, legend: R.legend };
  const active = plans[R.given];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'spikemap',
      projection: R.given,
      builtin: R.builtin,
      source: R.source,
      places: R.spikes.length,
      regions: R.regions.length,
      max: R.vmax,
      ceiling: R.hasCeiling,
      encoding: 'height linear in value; no square root, no area',
      tallest: H_MAX,
      join: R.stats ? { ...R.stats } : null,
      refused: { ...R.counts, geometry: { ...R.geomCounts },
                 centre: R.badCentre, zoom: R.badScale },
      hidden: Object.fromEntries(PROJECTIONS.map((p) => [p, plans[p].hidden])),
    },
    html: cardHtml(cardId, title == null ? cardId : clean(title), R, active, leg),
    css: cardCss(cardId),
    js: guardEmitted(cardJs(cardId, model, inst), cardId),
  };
}
