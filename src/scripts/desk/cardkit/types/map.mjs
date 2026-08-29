/**
 * `map` -- geographic outlines, hand-projected in Node, with no tiles, no key and no library.
 *
 * The desk's CSP is `default-src 'self'`, so every tile server, every sprite sheet and every
 * mapping library is unreachable by construction. That is not an obstacle to route around; it
 * is the reason this type exists. A coastline is a list of points and a projection is four
 * lines of trigonometry, and once both of those are true in Node the browser's whole job is to
 * put a `d` attribute on a `<path>`.
 *
 * All three projections are computed at build time, because `projection` is a viewer setting
 * and a setting must not cost a re-projection per click. The emitted model carries one plan per
 * projection -- outlines, graticule, markers, and the two sentences that describe it -- and the
 * script picks the plan the setting names. This is the same move `matrix` makes with its four
 * seriations, and for the same reason: the arithmetic runs once, where a test can watch it.
 *
 * The projections themselves no longer live here. They and everything around them -- the
 * mercator clamp, the antimeridian split, the pole closure, the horizon clip and its limb
 * stitching, the GeoJSON reader and the emit guard -- moved to `_geo.mjs` when the choropleth,
 * bubble, spike and cartogram types arrived, because a second copy of that arithmetic would not
 * throw. It would draw a coastline correct on one card and wrong on the card beside it, with
 * nothing anywhere to report the disagreement. The move was proved byte-identical across twenty
 * fixtures before it was kept.
 *
 * `CK` comes out of `kit.js` through a `vm` context rather than being reimplemented, so
 * `CK.scale` maps marker value to radius with exactly the zero-width-domain guard the browser
 * would use and `CK.esc` is the same escape the rest of the desk trusts.
 *
 * @see ./_geo.mjs -- the shared geographic machinery this and four other types are built on
 * @see ./matrix.mjs -- the same emit shape, the same vm-loaded kit, the same precompute idiom
 */

import {
  CK, MERC_LIMIT, PROJECTIONS, SCALE_MIN, SCALE_MAX,
  fin, wrapLon, num, jsonLit, clean, plural, spoken, cssId, scoped,
  projector, projectionNote, centredOn, frameFor,
  runsFor, graticulePaths,
  position, readFeatures, readView, areaRadius,
  builtinWorld, guardEmitted,
} from './_geo.mjs';

export { guardEmitted };

/* ── constants ────────────────────────────────────────────────────────────────────────── */

/** Marker radii in view units, where the whole world is 360 wide. */
const R_MIN = 2.2;
const R_MAX = 9;
const R_DEF = 3.4;

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Exported so a panel's field names can be checked against it in both directions rather than
 * trusted: a `name` in the markup that is not a key here is a control that silently does
 * nothing, and `CK.settings` -- correctly -- ignores it without complaining.
 *
 * A card *instance* narrows these: `data.projection` and `data.graticule` become the fallbacks
 * actually handed to `CK.settings`, so a map authored as an orthographic globe opens as one.
 * The key set is identical either way, which is the part a validator cares about.
 *
 * @example defaults.projection;   // 'equirectangular'
 */
export const defaults = { projection: 'equirectangular', graticule: true, labels: true };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * `shape` is a string on purpose: it is read by a person deciding what to feed the card, and it
 * has to read at a glance.
 *
 * @example meta.name;   // 'map'
 */
export const meta = {
  name: 'map',
  summary:
    'Geographic outlines projected in Node and drawn as bare paths, with a graticule and ' +
    'labelled markers, in equirectangular, mercator or orthographic.',
  shape:
    '{ features, projection, center: { lon, lat }, scale, ' +
    'markers: [{ lon, lat, label, value }], graticule } -- ' +
    'features is GeoJSON (Feature, FeatureCollection, GeometryCollection, Polygon, ' +
    'MultiPolygon, LineString, MultiLineString, Point, MultiPoint) or a bare array of those, ' +
    'and is omitted to get the built-in coarse world outline; center rotates the projection ' +
    'and its lat is used by orthographic only; scale zooms about the centre; graticule is a ' +
    'boolean or a spacing in degrees; a marker value drives its radius by area',
  defaults: { ...defaults },
};

/* ── reading the data ─────────────────────────────────────────────────────────────────── */

/**
 * Normalise the whole `data` block into the one shape the rest of the file may assume.
 *
 * `features` absent means "draw the world" and gets the built-in outline. `features` *present*
 * and empty means "I have no shapes", which is a different statement and gets an empty map with
 * a caption that says so -- silently substituting the world for a caller's empty result set
 * would turn "nothing matched" into a picture of every continent.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including every refusal count
 *
 * @example readData({ markers: [{ lon: 0, lat: 0, label: 'null island' }] }).marks.length;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const builtin = d.features == null;
  const read = readFeatures(builtin ? builtinWorld() : d.features);
  const view = readView(d, defaults);

  const marks = [];
  const markCounts = { outOfRange: 0, unnamed: 0, badValue: 0 };
  const rawMarks = Array.isArray(d.markers) ? d.markers : [];
  for (const m of rawMarks) {
    const o = m && typeof m === 'object' ? m : {};
    const src = Array.isArray(o) ? o : [o.lon, o.lat];
    const q = position(src);
    if (!q) { markCounts.outOfRange++; continue; }
    const label = clean(o.label == null ? (o.name == null ? '' : o.name) : o.label);
    if (!label) markCounts.unnamed++;
    let value = null;
    if (o.value != null) {
      const v = Number(o.value);
      if (Number.isFinite(v) && v >= 0) value = v;
      else markCounts.badValue++;
    }
    marks.push({ lon: q[0], lat: q[1], label, value });
  }
  /* A GeoJSON Point is a marker. Two ways to say the same thing would be two code paths and
     two sets of behaviour, so the one that arrived as geometry joins the ones that arrived as
     markers and they are treated identically from here. */
  for (const p of read.points) {
    const v = p.value == null ? null : Number(p.value);
    marks.push({
      lon: p.lon, lat: p.lat, label: p.label,
      value: Number.isFinite(v) && v >= 0 ? v : null,
    });
  }
  markCounts.unnamed += read.counts.unnamed;

  return {
    rings: read.rings, lines: read.lines, marks,
    counts: read.counts, markCounts,
    centre: view.centre, zoom: view.zoom, gratStep: view.gratStep, gratOn: view.gratOn,
    given: view.given, builtin,
    badCentre: view.badCentre, badScale: view.badScale,
    vertices: read.rings.reduce((s, shape) => s + shape.reduce((t, r) => t + r.length, 0), 0) +
              read.lines.reduce((s, l) => s + l.length, 0),
  };
}

/**
 * Marker radius from marker value, by area rather than by radius.
 *
 * A circle drawn with its radius proportional to a value overstates the large ones by their
 * square: a value of nine against a value of one is nine times the radius and *eighty-one*
 * times the ink. Taking the square root first makes the area proportional, which is what a
 * reader actually compares when they look at two discs. `areaRadius` in `_geo` is the one
 * implementation of that, shared with `bubblemap`, so the two cards cannot disagree about how
 * big a value looks.
 *
 * @param marks every marker, some of which may carry no value at all
 * @returns a function from one marker to a radius in view units
 *
 * @example radiusFor([{ value: 1 }, { value: 100 }])({ value: 100 });   // 9
 */
function radiusFor(marks) {
  const to = areaRadius(marks.map((m) => m.value), [R_MIN, R_MAX], R_DEF);
  return (m) => to(m.value);
}

/* ── projecting a whole map ───────────────────────────────────────────────────────────── */

/**
 * Everything one projection needs, computed once at build time.
 *
 * All three plans are built for every card, because `projection` is a viewer setting: a reader
 * flipping from mercator to orthographic must not pay for a re-projection, and the projection
 * that runs in Node is the one a test can watch.
 *
 * @param name one of `PROJECTIONS`
 * @param R    the output of {@link readData}
 * @returns the plan the browser is handed, plus the numbers the caption quotes
 *
 * @example planFor('orthographic', R).hiddenMarks;   // 4
 */
function planFor(name, R) {
  const P = projector(name);
  const zoom = R.zoom;
  const shift = (p) => [p[0] - R.centre.lon, p[1]];

  const land = [];
  let hiddenRings = 0;
  for (const shape of R.rings) {
    /* A polygon's holes ride in the same path as its outer ring, with the even-odd rule doing
       the cutting. Two paths would need a second fill in the ground colour, which is only the
       ground colour until the card is opened in the other theme. */
    let d = '';
    for (const ring of shape) {
      d += runsFor(ring.map(shift), true, P, R.centre.lat, zoom, 'ring').d;
    }
    if (d) land.push(d); else hiddenRings++;
  }

  const lines = [];
  for (const line of R.lines) {
    const got = runsFor(line.map(shift), false, P, R.centre.lat, zoom, 'line');
    if (got.d) lines.push(got.d); else hiddenRings++;
  }

  const grat = graticulePaths(P, R.gratStep, R.centre, zoom);

  const radius = radiusFor(R.marks);
  const marks = [];
  let hiddenMarks = 0;
  for (const m of R.marks) {
    const q = P.at(wrapLon(m.lon - R.centre.lon), m.lat, R.centre.lat);
    if (!q.seen) { hiddenMarks++; continue; }
    const tip = (m.label || 'unnamed place') +
      (m.value == null ? '' : ' · ' + CK.fmt(m.value)) +
      ' · ' + spoken(m.lat, 'north', 'south') + ', ' + spoken(m.lon, 'east', 'west');
    marks.push([
      fin(q.x * zoom, 'marker x'), fin(q.y * zoom, 'marker y'), fin(radius(m), 'marker r'),
      m.label, tip,
    ]);
  }

  const frame = frameFor(P, zoom);
  const said = describe(R, P, { hiddenRings, hiddenMarks, land: land.length, lines: lines.length,
                                marks: marks.length });

  return {
    view: frame.view,
    rect: frame.rect,
    disc: frame.disc,
    fs: frame.fs,
    land, lines, grat, marks,
    note: said.note,
    aria: said.aria,
    hiddenRings, hiddenMarks,
  };
}

/* ── saying what the picture shows ────────────────────────────────────────────────────── */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides an SVG's internals completely, so this label *is* the map to anyone using
 * one. "A map" is therefore not an acceptable answer: it names the genre and withholds every
 * fact. This says where the view is centred, what projection distorts it and how, how much is
 * drawn, which places are marked by name, and -- the part a sighted reader can see and a screen
 * reader cannot infer -- what is missing, because it is behind the globe or past the clamp.
 *
 * @returns `{ aria, note }`, both plain text; the note is set with `textContent` when the
 *          viewer changes projection, so it must not be markup
 *
 * @example describe(R, projector('mercator'), tally).note;
 */
function describe(R, P, tally) {
  const where = centredOn(R.centre, P.cylindrical);
  const how = projectionNote(P.name);

  const zoomed = R.zoom === 1 ? '' : ' zoomed ' + (Math.round(R.zoom * 100) / 100) + ' times';

  const drawn = tally.land || tally.lines
    ? plural(tally.land, 'outline', 'outlines') +
      (tally.lines ? ' and ' + plural(tally.lines, 'route', 'routes') : '') + ' drawn'
    : 'nothing to draw';

  const named = R.marks.filter((m) => m.label).map((m) => m.label);
  const marked = !tally.marks ? ''
    : ' ' + plural(tally.marks, 'marked place', 'marked places') +
      (named.length ? ': ' + named.slice(0, 8).join(', ') +
        (named.length > 8 ? ' and ' + (named.length - 8) + ' more' : '') : '') + '.';

  const gone =
    (tally.hiddenRings
      ? ' ' + plural(tally.hiddenRings, 'shape is', 'shapes are') +
        ' entirely on the far side of the globe and ' +
        (tally.hiddenRings === 1 ? 'is' : 'are') + ' not drawn.'
      : '') +
    (tally.hiddenMarks
      ? ' ' + plural(tally.hiddenMarks, 'marker is', 'markers are') +
        ' over the horizon and culled.'
      : '');

  const note = how + '. ' + drawn + zoomed + ', ' + where + '.' + gone;

  const aria =
    (R.builtin ? 'World map' : 'Map') + ', ' + P.name + ', ' + where + '. ' +
    drawn.charAt(0).toUpperCase() + drawn.slice(1) + zoomed + '.' + marked + gone +
    ' ' + how.charAt(0).toUpperCase() + how.slice(1) + '.';

  return { note: note.replace(/\s+/g, ' ').trim(), aria: aria.replace(/\s+/g, ' ').trim() };
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. Every value is a desk token, so the light switch is the only
 * thing that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 *
 * The one light-mode override lifts the land wash rather than recolouring it. Ink at seventeen
 * per cent over white is fainter than ink at seventeen per cent over near-black, so holding the
 * opacity constant across the switch loses every coastline in light mode. The hue stays put;
 * only the strength moves.
 */
function cardCss(id) {
  const own = '.ck-map[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-map-wrap', 'margin-top: 2px;'],
    /* The outermost svg clips to its own viewport, which is what keeps a zoomed map inside the
       card without a clipPath and without an id that could collide with another card's. */
    ['svg.ck-map-art', 'display: block; width: 100%; height: auto; overflow: hidden;'],
    ['svg.ck-map-art text', 'font-family: var(--mono); fill: var(--ink-dim);'],

    ['.ck-map-art .ck-sphere', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-map-art .ck-grat', 'fill: none; stroke: var(--ck-grid); stroke-width: 0.6;'],
    ['.ck-map-art .ck-land', 'fill: var(--ink); fill-opacity: .17; stroke: var(--rule); stroke-width: 0.7;'],
    ['.ck-map-art .ck-route', 'fill: none; stroke: var(--accent); stroke-width: 1.2;'],
    ['.ck-map-art .ck-mark circle',
     'fill: var(--accent); fill-opacity: .5; stroke: var(--accent); stroke-width: 0.9;'],

    ['.ck-map-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],

    /* A checkbox inherits the panel's full-width input rule and comes out as a stretched
       lozenge; it wants to be its own size, at the start of its column. */
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scoped(own, rules) + '\n' +
    ':root[data-theme="light"] ' + own + ' .ck-map-art .ck-land { fill-opacity: .22; }\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the map and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The caption's markup is written here from
 * literals with escaped data inside it; the one part that changes with the settings is a span
 * the script fills with `textContent`, so nothing untrusted is ever parsed as markup.
 *
 * The `aria-label` is written into the markup for the projection the card opens with, and
 * rewritten by the script when the viewer changes it -- a label describing a mercator map on a
 * globe would be worse than no label, because it would be believed.
 */
function cardHtml(id, title, R, plan) {
  const e = CK.esc;

  const junk = [];
  const c = R.counts;
  const mc = R.markCounts;
  if (c.outOfRange) junk.push(plural(c.outOfRange, 'shape', 'shapes') +
    ' held a coordinate off the Earth and ' + (c.outOfRange === 1 ? 'was' : 'were') + ' refused');
  if (c.tooFew) junk.push(plural(c.tooFew, 'ring', 'rings') + ' had fewer than three distinct points');
  if (c.badGeom) junk.push(plural(c.badGeom, 'geometry', 'geometries') + ' was of a kind this card does not draw');
  if (mc.outOfRange) junk.push(plural(mc.outOfRange, 'marker', 'markers') + ' sat off the Earth and ' +
    (mc.outOfRange === 1 ? 'was' : 'were') + ' refused');
  if (mc.unnamed) junk.push(plural(mc.unnamed, 'marker has', 'markers have') + ' no label');
  if (mc.badValue) junk.push(plural(mc.badValue, 'marker value', 'marker values') +
    ' was not a number at or above zero, so ' + (mc.badValue === 1 ? 'it draws' : 'they draw') +
    ' at the default radius');
  if (R.badCentre) junk.push('the centre was off the Earth and was refused');
  if (R.badScale) junk.push('the scale was outside ' + SCALE_MIN + ' to ' + SCALE_MAX + ' and was refused');

  const shapes = R.rings.length + R.lines.length;
  const empty = shapes || R.marks.length ? '' :
    '  <div class="ck-map-void">nothing to draw &mdash; ' +
    (R.builtin ? 'the built-in outline came back empty' : 'no usable features and no markers') +
    '</div>\n';

  return '<section data-card="' + e(id) + '" class="ck-map">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-projection">projection</label>\n' +
    '    <select id="' + e(id) + '-projection" name="projection">\n' +
    PROJECTIONS.map((p) => '      <option value="' + p + '">' + p + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-graticule">graticule</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-graticule" name="graticule">\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-labels" name="labels">\n' +
    '    <div class="ck-set-foot">' +
    'the centre and the zoom belong to this card&rsquo;s data, not to you: ' +
    e('centred on ' + spoken(R.centre.lon, 'east', 'west') + ', ' +
      spoken(R.centre.lat, 'north', 'south') + ', at ' + (Math.round(R.zoom * 100) / 100) +
      ' times. latitude is used by orthographic only.') +
    '</div>\n' +
    '  </div>\n' +
    empty +
    '  <div class="ck-map-wrap ck-scroll">\n' +
    '    <svg class="ck-map-art" role="img" viewBox="' + e(plan.view) +
    '" aria-label="' + e(plan.aria) + '"></svg>\n' +
    '  </div>\n' +
    '  <div class="ck-cap"><b>' + e(String(shapes)) + '</b> ' +
    (shapes === 1 ? 'shape' : 'shapes') + ' and <b>' + e(String(R.marks.length)) + '</b> ' +
    (R.marks.length === 1 ? 'marker' : 'markers') +
    ' across ' + e(String(R.vertices)) + ' vertices' +
    (R.builtin ? ', from the built-in coarse world outline' : '') + '. ' +
    '<i class="ck-map-note">' + e(plan.note) + '</i>' +
    (junk.length ? ' <span class="ck-aside">' + e(junk.join('; ')) + '.</span>' : '') +
    '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: take the plan the setting names and turn it into elements.
 *
 * Shipped to the page by `Function.prototype.toString()`, so the code a test exercises in Node
 * is textually the code that runs in the browser rather than a Node-shaped twin of it that will
 * eventually disagree. That has one consequence worth stating out loud, because it has blanked
 * whole desks: **the comments inside this function are shipped too.** A backtick around a word
 * in a comment here becomes an unterminated template literal in a file that must parse as a
 * classic script, and the parse error takes down every card on the page, not this one.
 * {@link guardEmitted} refuses the build if it happens.
 *
 * Nothing here decides anything about the map. Three projections, every path, every marker
 * radius and both sentences were computed in Node. The only work left is putting a `d` on a
 * `<path>`.
 *
 * @param sec the card's section
 * @param M   the emitted model: one plan per projection
 * @param DEF this instance's fallbacks, same key set as the exported defaults
 */
function mapDraw(sec, M, DEF) {
  var NS = "http://www.w3.org/2000/svg";
  var art = sec.querySelector("svg.ck-map-art");
  var note = sec.querySelector(".ck-map-note");

  /* One element, attributes from a plain object, text set with textContent. Every label on this
     map is data the card did not write, so none of it goes in as markup. */
  function el(t, a, txt) {
    var e = document.createElementNS(NS, t), k;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  /* A stored setting is a string out of localStorage, which is a text file the viewer can edit.
     Checked with hasOwn against the table of plans rather than looked up, so the string
     "constructor" cannot select a projection off Object.prototype. */
  function pick(v, table, fallback) {
    return typeof v === "string" && Object.hasOwn(table, v) ? v : fallback;
  }

  /* Checkboxes come back as booleans, but a hand-edited store can hold anything at all, and a
     truthiness test would read the string "false" as on. */
  function flag(v, fallback) {
    if (v === true || v === "true" || v === 1) { return true; }
    if (v === false || v === "false" || v === 0) { return false; }
    return fallback;
  }

  function draw(cfg) {
    var name = pick(cfg.projection, M.proj, DEF.projection);
    var P = M.proj[name];
    var wantGrat = flag(cfg.graticule, DEF.graticule);
    var wantLab = flag(cfg.labels, DEF.labels);
    var frag, i, m, g, dot;

    if (note) { note.textContent = P.note; }
    if (!art) { return; }

    frag = document.createDocumentFragment();

    if (P.disc > 0) {
      frag.appendChild(el("circle", { "class": "ck-sphere", cx: 0, cy: 0, r: P.disc }));
    } else if (P.rect) {
      frag.appendChild(el("rect", { "class": "ck-sphere", x: P.rect[0], y: P.rect[1],
                                    width: P.rect[2], height: P.rect[3] }));
    }

    if (wantGrat) {
      for (i = 0; i < P.grat.length; i++) {
        frag.appendChild(el("path", { "class": "ck-grat", d: P.grat[i] }));
      }
    }

    /* Order is the whole z-stack: SVG has no z-index, and the last thing appended is the thing
       on top. Graticule under land, land under routes, routes under markers. */
    for (i = 0; i < P.land.length; i++) {
      frag.appendChild(el("path", { "class": "ck-land", "fill-rule": "evenodd", d: P.land[i] }));
    }
    for (i = 0; i < P.lines.length; i++) {
      frag.appendChild(el("path", { "class": "ck-route", d: P.lines[i] }));
    }

    for (i = 0; i < P.marks.length; i++) {
      m = P.marks[i];
      g = el("g", { "class": "ck-mark" });
      dot = el("circle", { cx: m[0], cy: m[1], r: m[2] });
      dot.appendChild(el("title", null, m[4]));
      g.appendChild(dot);
      if (wantLab && m[3]) {
        g.appendChild(el("text", { x: m[0] + m[2] + 3, y: m[1] + P.fs * 0.36,
                                   "font-size": P.fs }, m[3]));
      }
      frag.appendChild(g);
    }

    while (art.firstChild) { art.removeChild(art.firstChild); }
    art.appendChild(frag);
    art.setAttribute("viewBox", P.view);
    art.setAttribute("aria-label", P.aria);
  }

  CK.settings(sec, DEF, draw);
}

/**
 * The emitted script: the three plans, and the browser half that paints one of them.
 *
 * The function is inlined by `toString()` rather than rewritten as a string literal, so there is
 * one written source for it and a test can call the same text the page runs.
 */
function cardJs(id, model, inst) {
  return '/* map card: three projections computed in Node; the browser only paints one. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n' +
    mapDraw.toString() + '\n' +
    '  mapDraw(sec, ' + jsonLit(model) + ', ' + jsonLit(inst) + ');\n' +
    '});\n';
}

/**
 * Build one map card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape; omit `features` for the built-in world
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the counts the caption quotes, so a test
 *          or a reader can check the claim without re-projecting anything
 *
 * @throws {Error} when the arithmetic produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input is counted
 *                 and refused while reading, so neither of these means bad data -- both mean a
 *                 bug in this file.
 *
 * @example
 * build({
 *   id: 'globe',
 *   title: 'where the agents are',
 *   data: {
 *     projection: 'orthographic',
 *     center: { lon: -30, lat: 25 },
 *     markers: [{ lon: -122.3, lat: 47.6, label: 'Seattle', value: 12 }],
 *   },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'map' : id);
  const R = readData(data);

  const plans = {};
  for (const p of PROJECTIONS) plans[p] = planFor(p, R);

  const model = { proj: {} };
  for (const p of PROJECTIONS) {
    const q = plans[p];
    model.proj[p] = {
      view: q.view, rect: q.rect, disc: q.disc, fs: q.fs,
      land: q.land, lines: q.lines, grat: q.grat, marks: q.marks,
      note: q.note, aria: q.aria,
    };
  }

  /* The instance's own fallbacks. Same key set as the exported `defaults` -- which is what a
     validator checks -- but the projection and the graticule start where this card's data said
     they should, so a globe authored as a globe opens as one. */
  const inst = { projection: R.given, graticule: R.gratOn, labels: defaults.labels };
  const active = plans[R.given];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'map',
      projection: R.given,
      builtin: R.builtin,
      shapes: R.rings.length + R.lines.length,
      vertices: R.vertices,
      markers: R.marks.length,
      center: R.centre,
      scale: R.zoom,
      refused: { ...R.counts, markers: { ...R.markCounts },
                 centre: R.badCentre, scale: R.badScale },
      hidden: Object.fromEntries(PROJECTIONS.map((p) =>
        [p, { shapes: plans[p].hiddenRings, markers: plans[p].hiddenMarks }])),
    },
    html: cardHtml(cardId, title == null ? cardId : clean(title), R, active),
    css: cardCss(cardId),
    js: guardEmitted(cardJs(cardId, model, inst), cardId),
  };
}
