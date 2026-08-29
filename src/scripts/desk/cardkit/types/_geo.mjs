/* cardkit / _geo -- the geographic machinery every map-shaped card shares.
 *
 * This file exists because of one specific failure mode, and it is worth naming before anything
 * else. The mercator clamp at atan(sinh(pi)), the antimeridian split, the closure of a
 * pole-encircling ring by mean latitude, and the per-segment horizon clip with its limb stitching
 * are four pieces of arithmetic that are each subtle, each got right exactly once, and each
 * *silent* when wrong. A second copy would not throw. It would draw a coastline that is correct on
 * one card and wrong on the card beside it, with nothing anywhere to report the disagreement.
 *
 * So there is one copy, here, and `map`, `choropleth`, `bubblemap`, `spikemap` and `cartogram`
 * all import it. A file beginning with `_` is a shared internal rather than a card type --
 * `newcard.mjs` skips it when building the catalogue, exactly as it skips `_feed.mjs`.
 *
 * Nothing in here emits a card. It answers three questions and no others: where does a lon/lat
 * pair land, what does a shape look like once the projection has cut it, and what did the data
 * turn out to be. Captions, colour, legends and markup belong to the types.
 *
 * @see ./map.mjs -- the type this was extracted from, byte-for-byte unchanged by the move
 * @see ./_feed.mjs -- the precedent for a shared internal in this directory
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/* ── the kit ──────────────────────────────────────────────────────────────────────────── */

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` assigns `window.CK` as a classic script; it is not a module and cannot be imported.
 * Its top level defines only functions and one array, so a bare context carrying a `window`
 * object is enough -- nothing reaches for `document` until a DOM function is called, and none
 * of those are called here.
 *
 * Loaded rather than reimplemented, because a private copy of `CK.scale` is a second source of
 * truth for the one thing a chart cannot afford one in: the gridlines stop matching the axis and
 * nothing errors.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().hue(0);   // 'var(--ck-s1)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/_geo: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/_geo: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

/** The desk runtime, loaded once for every type that imports this file. */
export const CK = loadKit();

/* ── constants ────────────────────────────────────────────────────────────────────────── */

/**
 * Where mercator is cut off, in degrees.
 *
 * The mercator y term is `ln(tan(pi/4 + phi/2))`, which runs to infinity as latitude
 * approaches ninety. There is no large number to substitute: the pole is genuinely not on the
 * map, and a card that projected latitude 89.9999 would emit a y of about 1400 world-widths
 * and draw a hairline stripe from the top of the viewport to somewhere past the moon. Web
 * mercator's answer is the one taken here -- clip at the latitude whose projected y equals
 * exactly one half-world -- because it makes the map a perfect square and because every other
 * mercator map on Earth cuts at the same place, so a reader comparing this one to any other
 * sees the same Greenland.
 *
 * `atan(sinh(pi)) * 180 / pi` = 85.05112877980659.
 */
export const MERC_LIMIT = 85.05112877980659;

/** Half the world's width in view units. Every projection normalises into this box. */
export const HALF_W = 180;

/** Graticule spacing in degrees, and how finely a curved graticule line is sampled. */
export const GRAT_STEP = 30;
const GRAT_SAMPLE = 6;

/** How many bisections to find where an edge crosses the orthographic horizon. */
const HORIZON_STEPS = 30;

/** Degrees of limb walked per inserted point when an orthographic polygon is closed. */
const LIMB_STEP = 4;

/** The three things `projection` may say. */
export const PROJECTIONS = ['equirectangular', 'mercator', 'orthographic'];

/** Zoom is a multiplier on the fitted world, held inside a range a card can still read. */
export const SCALE_MIN = 0.2;
export const SCALE_MAX = 20;

/* ── small shared arithmetic ──────────────────────────────────────────────────────────── */

/**
 * Round to two decimals, refusing to emit a number that is not finite.
 *
 * A `NaN` in an SVG path is silent: the browser drops the whole `d` attribute and the outline
 * simply is not there, with nothing in the console. Every projection here has at least one
 * input that can produce one -- mercator at the pole, the seam interpolation when two vertices
 * sit on the same meridian, orthographic when a bisection is handed a zero-length edge -- so
 * failing loudly at build time is the difference between a bug and a mystery.
 *
 * @param v    the number
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is not a finite number
 *
 * @example fin(0.33333, 'x');   // 0.33
 */
export function fin(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/_geo: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Degrees to radians. */
export function rad(d) { return d * Math.PI / 180; }

/**
 * Longitude folded into the half-open range that the seam splitter assumes.
 *
 * Everything downstream compares consecutive longitudes and calls a jump of more than half a
 * turn a seam crossing, which is only meaningful if every longitude is already inside one
 * turn. The one asymmetry is deliberate: an input of exactly plus one eighty stays at plus one
 * eighty rather than folding to minus one eighty, because the graticule's parallels are written
 * with both ends on the seam and folding one of them would invent a crossing that is not there.
 *
 * @example wrapLon(190);   // -170
 * @example wrapLon(180);   // 180
 */
export function wrapLon(v) {
  const x = ((v + 180) % 360 + 360) % 360 - 180;
  return x === -180 && v > 0 ? 180 : x;
}

/**
 * A finite number inside `[lo, hi]`, or `null` when it is neither.
 *
 * @example num('3', 0, 10);   // 3
 * @example num(11, 0, 10);    // null
 */
export function num(v, lo, hi) {
  const x = Number(v);
  if (!Number.isFinite(x) || x < lo || x > hi) return null;
  return x;
}

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` becomes an escape so a place name containing `</script>` cannot close the block early;
 * `>` goes with it, which has the useful side effect that no label can put an arrow function's
 * two characters into a file that is contractually free of them. Backticks go too, for the same
 * contract, and the two line separators because they are newlines to a JavaScript parser and
 * not to `JSON.stringify`.
 *
 * The question mark is here for one reason and it was found by testing rather than by thinking:
 * {@link guardEmitted} scans the RAW emitted text for `?.`, on the correct grounds that optional
 * chaining cannot appear innocently in classic-script code -- but a *place name* containing the
 * two characters lands inside a string literal and trips it, and a build that refuses a card
 * because a caption said "really?." would be a guard nobody keeps. Escaping the character makes
 * the scan true again instead of loosening it, which is the same trade `>` already makes.
 * Every one of these decodes back to itself, so no rendered text changes.
 *
 * @example jsonLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
export function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(new RegExp(String.fromCharCode(96), 'g'), '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A string taken from data, with every control character turned into a space.
 *
 * `CK.esc` handles the characters that mean something to an HTML parser. It does not touch the
 * ones that mean nothing to anybody: a NUL, a bell or an escape inside a place name passes
 * straight through it, lands in `card.html`, and is then invisible in the file, rendered as a
 * space by every tool that reads it back, and legal to every parser that sees it. That is the
 * exact failure the contract spends a page on, arriving through the one door escaping does not
 * cover -- and it was found here by a test feeding a marker a name with a NUL in it.
 *
 * Tab, newline and carriage return are replaced too rather than kept. They are legal, but a
 * label is a phrase on one line, HTML collapses them to a space anyway, and keeping them would
 * mean a caption whose text differs from its markup for no reader-visible gain.
 *
 * The comparison is numeric on purpose. Writing a character class for this is how the character
 * class ends up holding the character it was meant to describe; `charCodeAt` cannot be mistyped
 * and cannot be decoded early, because it does not contain the character at all.
 *
 * @param s anything; `null` and `undefined` become the empty string
 * @returns the same text, with control characters replaced and the ends trimmed
 *
 * @example clean('a' + String.fromCharCode(0) + 'b');   // 'a b'
 */
export function clean(s) {
  const str = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out += (c < 32 || c === 127) ? ' ' : str[i];
  }
  return out.trim();
}

/**
 * `count` of a thing, pluralised the only way English lets you do it safely.
 *
 * @example plural(1, 'region', 'regions');   // '1 region'
 */
export function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * A latitude or longitude spoken the way a caption would say it.
 *
 * @example spoken(-12.34, 'north', 'south');   // '12.3 degrees south'
 */
export function spoken(v, pos, neg) {
  const r = Math.round(Math.abs(v) * 10) / 10;
  if (r === 0) return '0 degrees';
  return r + ' degrees ' + (v > 0 ? pos : neg);
}

/**
 * The card's id as it may appear inside a double-quoted CSS attribute selector.
 *
 * The id becomes a directory name and is not viewer-supplied, but it is still a string a type
 * did not write, and a quote in it would end the selector early and leave the rest of the
 * stylesheet as garbage the browser skips in silence.
 *
 * @example cssId('a"b');   // 'a\\"b'
 */
export function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/**
 * Prefix every selector in a rule list with the card's own scope. One card, one blast radius.
 *
 * @param own   the scope selector, typically `.ck-<type>[data-card="<id>"]`
 * @param rules pairs of selector suffix and declaration body; an empty suffix means the scope
 *              element itself
 *
 * @example scoped('.ck-x', [['h2', 'margin: 0;']]);   // '.ck-x h2 { margin: 0; }'
 */
export function scoped(own, rules) {
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/* ── the projections ──────────────────────────────────────────────────────────────────── */

/**
 * Plate carree: longitude straight to x, latitude straight to y, and nothing else.
 *
 * The simplest projection there is and the only one whose inverse a reader can do in their
 * head. It is wrong about area everywhere except the equator -- Greenland is not the size of
 * Africa -- but it is wrong in a way that is legible, which is more than can be said for
 * mercator, and it has no singularity at all, so latitude ninety draws.
 *
 * The vertical scale is one view unit per degree, which makes the world 360 by 180.
 *
 * @param lon longitude already rotated by the centre and folded into one turn
 * @returns `{ x, y, seen }`; `seen` is always true, there is no far side
 *
 * @example projEquirect(0, 45);   // { x: 0, y: -45, seen: true }
 */
export function projEquirect(lon, lat) {
  return { x: lon, y: -lat, seen: true };
}

/**
 * Mercator, clamped: conformal, and cut off at the latitude where y is exactly one half-world.
 *
 * The y term is a logarithm of a tangent that grows without bound as latitude approaches
 * ninety, so an unclamped mercator does not merely stretch the poles -- it sends them to
 * infinity, and a single vertex at latitude ninety poisons the whole path with a non-finite
 * number. Two things are done about it, and the difference between them matters.
 *
 * A vertex *beyond* {@link MERC_LIMIT} is clamped to it. That is a lie about position, but a
 * bounded one, and it is the lie every mercator map tells: the top of the map is 85 degrees
 * and the ice above it is not shown. The alternative -- dropping the vertex -- would silently
 * open a hole in Greenland's ring and fill the hole with whatever the next vertex happened to
 * be, which is a worse lie because nothing announces it.
 *
 * The clamp is applied to latitude before the logarithm rather than to y after it, so the
 * result is a real point on the mercator plane rather than a clipped coordinate that no
 * latitude corresponds to.
 *
 * @example projMercator(0, 85.05112877980659);   // { x: 0, y: -180, seen: true }
 * @example projMercator(0, 89.99);               // clamped to the same y, not to -3800
 */
export function projMercator(lon, lat) {
  const phi = rad(lat < -MERC_LIMIT ? -MERC_LIMIT : lat > MERC_LIMIT ? MERC_LIMIT : lat);
  return { x: lon, y: -(HALF_W / Math.PI) * Math.log(Math.tan(Math.PI / 4 + phi / 2)), seen: true };
}

/**
 * Orthographic: the globe as seen from infinitely far away, with the far hemisphere culled.
 *
 * This is the only projection here with a back. Without culling, every point on the far side
 * projects onto the near side's disc -- South America lands on top of Africa, mirrored -- and
 * the result is not a wrong map, it is two maps printed on the same paper. The visibility test
 * is the cosine of the angular distance from the centre:
 *
 *     cos(c) = sin(lat0) sin(lat) + cos(lat0) cos(lat) cos(lon)
 *
 * which is positive on the near hemisphere, zero exactly on the limb, and negative behind. It
 * is returned rather than acted on here, because a *segment* with one end on each side has to
 * be cut at the limb rather than kept or dropped whole; see {@link clipHorizon}.
 *
 * @param lon longitude relative to the centre, in degrees
 * @param lat latitude in degrees
 * @param lat0 the centre's latitude in degrees
 * @returns `{ x, y, seen, cos }` on a disc of radius {@link HALF_W}
 *
 * @example projOrtho(0, 0, 0);     // { x: 0, y: 0, seen: true, cos: 1 }
 * @example projOrtho(180, 0, 0).seen;   // false -- the far pole of the view
 */
export function projOrtho(lon, lat, lat0) {
  const l = rad(lon);
  const p = rad(lat);
  const p0 = rad(lat0);
  const cos = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
  return {
    x: HALF_W * Math.cos(p) * Math.sin(l),
    y: -HALF_W * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)),
    seen: cos >= 0,
    cos,
  };
}

/**
 * One projection's whole personality, so the rest of the file can stay generic.
 *
 * `cylindrical` is the question that actually branches the pipeline: a cylindrical projection
 * has an antimeridian and no horizon, and an azimuthal one has a horizon and no antimeridian.
 * Every other difference between the three is a formula.
 *
 * @param name one of {@link PROJECTIONS}; anything else settles on equirectangular
 *
 * @example projector('mercator').cylindrical;   // true
 */
export function projector(name) {
  if (name === 'mercator') {
    return { name, cylindrical: true, halfH: HALF_W, at: (lon, lat) => projMercator(lon, lat) };
  }
  if (name === 'orthographic') {
    return { name, cylindrical: false, halfH: HALF_W, at: (lon, lat, lat0) => projOrtho(lon, lat, lat0) };
  }
  return { name: 'equirectangular', cylindrical: true, halfH: 90, at: (lon, lat) => projEquirect(lon, lat) };
}

/**
 * What a projection does to the truth, in one clause a caption can drop into a sentence.
 *
 * Shared rather than rewritten per card because it is a claim about the projection, not about
 * the card: five cards saying five different things about what mercator does to area would be
 * five chances to say one of them wrong.
 *
 * @param name one of {@link PROJECTIONS}
 * @returns a lowercase clause with no trailing period
 *
 * @example projectionNote('equirectangular').slice(0, 18);   // 'equirectangular: l'
 */
export function projectionNote(name) {
  return name === 'mercator'
    ? 'mercator, conformal and clamped at ' + Math.round(MERC_LIMIT * 100) / 100 +
      ' degrees: the projection sends the poles to infinity, so they are cut off rather ' +
      'than drawn, and area grows without bound toward the top and bottom'
    : name === 'orthographic'
      ? 'orthographic: the globe seen from far away, with the far hemisphere culled so it ' +
        'cannot draw through the near one'
      : 'equirectangular: longitude and latitude straight to x and y, which is honest about ' +
        'position and badly wrong about area away from the equator';
}

/**
 * Where the view is centred, said the way a caption would say it.
 *
 * The latitude is omitted for a cylindrical projection because it does nothing there -- naming
 * a number that had no effect is worse than saying nothing, since a reader will believe it.
 *
 * @example centredOn({ lon: -30, lat: 20 }, false);
 * // 'centred on 30 degrees west, 20 degrees north'
 */
export function centredOn(centre, cylindrical) {
  return 'centred on ' + spoken(centre.lon, 'east', 'west') +
    (cylindrical ? '' : ', ' + spoken(centre.lat, 'north', 'south'));
}

/**
 * The SVG frame one projection wants at one zoom: viewBox, ground shape and label size.
 *
 * The viewBox never zooms; the *contents* do. That keeps the card the same size on the desk
 * whatever the zoom, and lets the outer `<svg>` clip without a `clipPath` and without an id
 * that could collide with another card's.
 *
 * @param P    a {@link projector}
 * @param zoom the multiplier applied to projected coordinates
 * @returns `{ view, rect, disc, fs }` -- `rect` for a cylindrical ground, `disc` for a globe
 *
 * @example frameFor(projector('orthographic'), 1).disc;   // 180
 */
export function frameFor(P, zoom) {
  const halfH = P.halfH;
  return {
    view: -HALF_W + ' ' + -halfH + ' ' + (HALF_W * 2) + ' ' + (halfH * 2),
    rect: P.cylindrical ? [fin(-HALF_W * zoom, 'rect'), fin(-halfH * zoom, 'rect'),
                           fin(HALF_W * 2 * zoom, 'rect'), fin(halfH * 2 * zoom, 'rect')] : null,
    disc: P.cylindrical ? 0 : fin(HALF_W * zoom, 'disc'),
    fs: fin(Math.max(6, 7.5 / Math.min(2, Math.max(1, zoom))), 'font'),
  };
}

/* ── the antimeridian ─────────────────────────────────────────────────────────────────── */

/**
 * Cut a lon/lat run wherever it jumps the seam, and hand back the pieces.
 *
 * **The decision this machinery makes: it splits. It does not accept the seam.**
 *
 * Here is what the alternative looks like, because it is the failure everybody ships once. In
 * a cylindrical projection x is longitude, so a segment from 179 east to 179 west is drawn as
 * a line from one edge of the map to the other -- a horizontal streak the full width of the
 * world, through everything in between. Alaska sprouts a hairline to Siberia; a shipping route
 * across the Pacific becomes a bar across Africa. Nothing errors. It merely looks like the data
 * is wrong, and the reader blames the data.
 *
 * So each edge whose endpoints differ by more than half a turn is cut at the seam. The latitude
 * of the cut is interpolated linearly against the *unwrapped* longitude, which is exactly the
 * approximation every other edge already makes -- a straight line between two vertices in
 * lon/lat space -- so the cut point sits on the same polyline the rest of the run describes.
 * The run ends at plus or minus 180 and the next one begins at the opposite edge with the same
 * latitude, so an outline meets both edges of the map cleanly and a filled polygon closes along
 * the seam instead of across the world.
 *
 * **Rings that encircle a pole.** A ring that crosses the seam an *odd* number of times does
 * not enclose an area in the plane at all -- it wraps the sphere, like Antarctica. Merging the
 * first and last pieces gives one run whose two ends sit on opposite edges of the map, and
 * closing that with a straight line is the streak again. Such a run is closed through the pole
 * instead: two extra vertices at the polar edge, on the nearer pole, chosen by the mean
 * latitude of the run. The mean is a heuristic and it is named as one, but it is right for
 * every ring that actually does this -- a ring wrapping the sphere at an average latitude of
 * minus 73 is not going around the north pole.
 *
 * @param pts    positions as `[lon, lat]`, longitudes already folded into one turn
 * @param closed whether this is a ring (the last vertex joins the first) or an open line
 * @returns one or more runs; a run that was never cut is returned unchanged
 *
 * @example splitSeam([[170, 0], [-170, 0]], false);
 * // [[[170, 0], [180, 0]], [[-180, 0], [-170, 0]]]
 */
export function splitSeam(pts, closed) {
  const len = pts.length;
  if (len < 2) return [pts.slice()];

  const edges = closed ? len : len - 1;
  const runs = [];
  let cur = [pts[0]];
  let cuts = 0;

  for (let i = 0; i < edges; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % len];
    const d = b[0] - a[0];

    if (Math.abs(d) > 180) {
      cuts++;
      const leaveAt = d > 0 ? -180 : 180;              // the edge `a` runs off
      const arriveAt = -leaveAt;                        // the edge `b` runs on from
      const bx = b[0] + (d > 0 ? -360 : 360);           // `b` unwrapped next to `a`
      const span = bx - a[0];
      /* Two vertices on the same meridian, one written as +180 and one as -180, give a span of
         zero. There is no crossing point to interpolate -- both ends are already at the seam --
         so the cut takes the first vertex's latitude. Without this the division is 0/0 and the
         whole path attribute becomes a `NaN` the browser drops in silence. */
      const t = Math.abs(span) < 1e-12 ? 0 : (leaveAt - a[0]) / span;
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      const lat = a[1] + tc * (b[1] - a[1]);
      cur.push([leaveAt, lat]);
      runs.push(cur);
      cur = [[arriveAt, lat], b];
    } else {
      cur.push(b);
    }
  }

  if (!cuts) return [pts.slice()];

  /* The walk started at vertex zero, which is almost never a cut, so the first piece and the
     last piece are two halves of one run. Rejoining them is what keeps a coastline continuous
     across the vertex the author happened to write first. */
  if (closed) {
    const first = runs.shift();
    cur = cur.concat(first.slice(1));
  }
  runs.push(cur);

  if (closed) for (const run of runs) closeThroughPole(run);
  return runs;
}

/**
 * Close a pole-encircling run through the polar edge, in place.
 *
 * A run whose two ends sit on *opposite* seam edges came from a ring that wraps the sphere. Two
 * vertices at the polar edge turn it back into something a fill can close: down the seam, along
 * the pole, and back up the other seam. Which pole is decided by where the run's vertices
 * actually are, since a ring at an average latitude of minus 73 is going around the south one.
 *
 * A run with both ends on the *same* edge needs nothing: it is an ordinary piece of a polygon
 * that was cut in two, and closing it directly is correct.
 *
 * @param run positions as `[lon, lat]`, modified in place
 * @returns whether a polar closure was added
 *
 * @example closeThroughPole([[-180, -70], [0, -70], [180, -70]]);   // true
 */
export function closeThroughPole(run) {
  if (run.length < 2) return false;
  const head = run[0];
  const tail = run[run.length - 1];
  if (Math.abs(head[0]) !== 180 || Math.abs(tail[0]) !== 180) return false;
  if (head[0] === tail[0]) return false;

  let sum = 0;
  for (const p of run) sum += p[1];
  const pole = sum / run.length < 0 ? -90 : 90;
  run.push([tail[0], pole], [head[0], pole]);
  return true;
}

/* ── the horizon ──────────────────────────────────────────────────────────────────────── */

/**
 * Split a lon/lat run at the orthographic horizon, keeping only what faces the viewer.
 *
 * Backface culling per *vertex* is not enough and the difference is visible: a segment from a
 * point just inside the limb to a point just outside it has to end ON the limb, not at the last
 * visible vertex, or every coastline that runs off the edge of the globe stops short of the
 * edge by up to one vertex spacing and the disc grows a ragged fringe.
 *
 * The crossing is found by bisection on the same straight-line-in-lon/lat interpolation the
 * rest of the pipeline uses, then the projected point is pushed out to exactly the limb radius.
 * Bisection rather than algebra because the visibility function along a lon/lat chord is a
 * trigonometric polynomial with no pleasant closed form, and thirty halvings of a segment that
 * is at most a few degrees long lands well inside the two decimals the path is rounded to.
 *
 * @param pts  positions as `[lon, lat]`, longitudes relative to the centre
 * @param lat0 the centre's latitude
 * @returns `{ runs, dropped }` -- runs of projected `[x, y]`, and whether anything was culled
 *
 * @example clipHorizon([[0, 0], [180, 0]], 0).dropped;   // true
 */
export function clipHorizon(pts, lat0) {
  const runs = [];
  let cur = [];
  let dropped = false;

  const seenAt = (p) => projOrtho(p[0], p[1], lat0).seen;
  const put = (p) => {
    const q = projOrtho(p[0], p[1], lat0);
    cur.push([q.x, q.y]);
  };

  /**
   * The point on edge `a`->`b` that sits on the limb, projected and snapped to the radius.
   *
   * Snapping matters: the bisection stops a hair inside or outside, and a limb walk that
   * starts a hair off the circle leaves a visible notch where the arc meets the coastline.
   */
  const cross = (a, b) => {
    let lo = 0;
    let hi = 1;
    const seenLo = seenAt(a);
    for (let i = 0; i < HORIZON_STEPS; i++) {
      const mid = (lo + hi) / 2;
      const m = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
      if (projOrtho(m[0], m[1], lat0).seen === seenLo) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    const q = projOrtho(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, lat0);
    const r = Math.hypot(q.x, q.y);
    /* A crossing exactly at the projected centre is impossible -- the centre is the most
       visible point there is -- but a zero radius would divide by zero, so it is refused
       rather than assumed away. */
    if (!(r > 0)) return [q.x, q.y];
    return [q.x * HALF_W / r, q.y * HALF_W / r];
  };

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const vis = seenAt(p);
    if (vis) {
      if (!cur.length && i > 0) cur.push(cross(pts[i - 1], p));
      put(p);
    } else {
      dropped = true;
      if (cur.length) {
        cur.push(cross(pts[i - 1], p));
        runs.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) runs.push(cur);
  return { runs, dropped };
}

/**
 * Join clipped runs of a polygon back into one ring by walking the limb between them.
 *
 * A ring cut by the horizon comes back as loose arcs. Closing each one on its own draws a
 * *chord* across the disc -- Antarctica seen from the equator gets a flat lid where it should
 * bulge to the rim -- so the pieces are stitched with points along the limb instead.
 *
 * Which way round the limb is not a guess. At the point where the outline leaves the disc, the
 * direction it was travelling has a tangential component, and its sign is the cross product of
 * the exit position with the exit direction. Walking that way is walking the way the outline
 * was already going, which is the direction that keeps the ring simple.
 *
 * @param runs projected runs from {@link clipHorizon}, in traversal order
 * @returns one run, closed by the caller, or null when there is nothing to close
 *
 * @example stitchLimb([[[180, 0], [0, 0], [0, 180]]]);   // the run, walked back around
 */
export function stitchLimb(runs) {
  const live = runs.filter((r) => r.length >= 2);
  if (!live.length) return null;

  const out = [];
  for (let i = 0; i < live.length; i++) {
    const run = live[i];
    for (const p of run) out.push(p);

    const exit = run[run.length - 1];
    const prev = run[run.length - 2];
    const next = live[(i + 1) % live.length][0];

    const dx = exit[0] - prev[0];
    const dy = exit[1] - prev[1];
    const spin = exit[0] * dy - exit[1] * dx >= 0 ? 1 : -1;

    const a = Math.atan2(exit[1], exit[0]);
    const b = Math.atan2(next[1], next[0]);
    let sweep = b - a;
    const turn = Math.PI * 2;
    if (spin > 0) { while (sweep <= 0) sweep += turn; } else { while (sweep >= 0) sweep -= turn; }

    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / rad(LIMB_STEP)));
    for (let s = 1; s < steps; s++) {
      const th = a + sweep * (s / steps);
      out.push([HALF_W * Math.cos(th), HALF_W * Math.sin(th)]);
    }
  }
  return out;
}

/* ── projecting a run ─────────────────────────────────────────────────────────────────── */

/**
 * A run of projected points as an SVG path body, with consecutive duplicates dropped.
 *
 * Rounding to two decimals turns clusters of vertices into repeats, and a repeat costs bytes in
 * every card on the desk while drawing nothing. The check is against the *rounded* pair rather
 * than the original, because that is what actually ends up in the file.
 *
 * @param run   projected `[x, y]` positions
 * @param close whether to finish with `Z`, which a fill needs and a line must not have
 * @param what  a name for the error message if a coordinate is not finite
 * @returns a path body, or an empty string when fewer than two distinct points survive
 *
 * @example runPath([[0, 0], [1, 1]], false, 'line');   // 'M0 0L1 1'
 */
export function runPath(run, close, what) {
  const out = [];
  for (const p of run) {
    const x = fin(p[0], what + ' x');
    const y = fin(p[1], what + ' y');
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    out.push([x, y]);
  }
  if (out.length < 2) return '';
  let d = 'M' + out[0][0] + ' ' + out[0][1];
  for (let i = 1; i < out.length; i++) d += 'L' + out[i][0] + ' ' + out[i][1];
  return close ? d + 'Z' : d;
}

/**
 * Turn one lon/lat run into path bodies under one projection, doing whichever clip applies.
 *
 * This is the single place the two clipping strategies meet, and keeping them in one function
 * is what stops a projection acquiring a private notion of what a coastline is. A cylindrical
 * projection gets the seam split and no horizon; an azimuthal one gets the horizon and no seam,
 * because longitude does not wrap onto an edge when there is no edge.
 *
 * @param pts    lon/lat positions, longitudes already relative to the centre
 * @param closed a ring, or an open line
 * @param P      a {@link projector}
 * @param lat0   the centre's latitude, used only by orthographic
 * @param zoom   the multiplier applied to projected coordinates
 * @param what   a name for the error message if a coordinate is not finite
 * @returns `{ d, culled }` -- the path body, and whether the horizon removed anything
 *
 * @example runsFor([[0, 0], [10, 0], [10, 10]], true, projector('equirectangular'), 0, 1).d;
 */
export function runsFor(pts, closed, P, lat0, zoom, what) {
  if (P.cylindrical) {
    const rot = pts.map((p) => [wrapLon(p[0]), p[1]]);
    const runs = splitSeam(rot, closed);
    let d = '';
    for (const run of runs) {
      const proj = run.map((p) => {
        const q = P.at(p[0], p[1]);
        return [q.x * zoom, q.y * zoom];
      });
      d += runPath(proj, closed, what);
    }
    return { d, culled: false };
  }

  const clipped = clipHorizon(pts, lat0);
  if (!clipped.runs.length) return { d: '', culled: true };

  if (closed) {
    const one = stitchLimb(clipped.runs);
    if (!one) return { d: '', culled: true };
    return { d: runPath(one.map((p) => [p[0] * zoom, p[1] * zoom]), true, what), culled: clipped.dropped };
  }

  let d = '';
  for (const run of clipped.runs) d += runPath(run.map((p) => [p[0] * zoom, p[1] * zoom]), false, what);
  return { d, culled: clipped.dropped };
}

/**
 * One lon/lat point through a projection, rotated by the centre and zoomed.
 *
 * The longitude is folded before projecting, not after: a point at 179 east on a map centred at
 * 179 west is two degrees away, and subtracting without folding would put it 358 degrees away
 * and off the edge of the world.
 *
 * @param lon    longitude in degrees
 * @param lat    latitude in degrees
 * @param P      a {@link projector}
 * @param centre `{ lon, lat }` the view is rotated to
 * @param zoom   the multiplier applied to projected coordinates
 * @returns `{ x, y, seen }`; `seen` is false only on an orthographic far side
 *
 * @example projectPoint(0, 0, projector('equirectangular'), { lon: 0, lat: 0 }, 1);
 * // { x: 0, y: -0, seen: true }
 */
export function projectPoint(lon, lat, P, centre, zoom) {
  const q = P.at(wrapLon(lon - centre.lon), lat, centre.lat);
  return { x: q.x * zoom, y: q.y * zoom, seen: q.seen };
}

/**
 * A list of shapes -- each a list of rings -- as one path body per shape.
 *
 * A polygon's holes ride in the same path as its outer ring, with the even-odd fill rule doing
 * the cutting. Two paths would need a second fill in the ground colour, which is only the ground
 * colour until the card is opened in the other theme.
 *
 * @param shapes each shape a list of rings, outer ring first
 * @param P      a {@link projector}
 * @param centre `{ lon, lat }` the view is rotated to
 * @param zoom   the multiplier applied to projected coordinates
 * @param what   a name for the error message if a coordinate is not finite
 * @returns `{ paths, hidden }` -- `hidden` counts shapes the horizon removed entirely
 *
 * @example shapePaths([[[[0, 0], [10, 0], [10, 10]]]], projector('mercator'), { lon: 0, lat: 0 }, 1).paths.length;   // 1
 */
export function shapePaths(shapes, P, centre, zoom, what) {
  const shift = (p) => [p[0] - centre.lon, p[1]];
  const paths = [];
  let hidden = 0;
  for (const shape of shapes) {
    let d = '';
    for (const ring of shape) d += runsFor(ring.map(shift), true, P, centre.lat, zoom, what).d;
    if (d) paths.push(d); else hidden++;
  }
  return { paths, hidden };
}

/**
 * One region -- a list of polygons, each a list of rings -- as a single path body.
 *
 * One path per region rather than one per ring, because a region is one thing to a reader and
 * one thing to a click: a country with islands must take one fill, carry one tooltip and light
 * up all at once on hover.
 *
 * @param polys a region's polygons, each a list of rings with the outer ring first
 * @param P      a {@link projector}
 * @param centre `{ lon, lat }` the view is rotated to
 * @param zoom   the multiplier applied to projected coordinates
 * @param what   a name for the error message if a coordinate is not finite
 * @returns a path body, empty when the region is entirely behind the globe
 *
 * @example regionPath([[[[0, 0], [10, 0], [10, 10]]]], projector('equirectangular'), { lon: 0, lat: 0 }, 1);
 */
export function regionPath(polys, P, centre, zoom, what) {
  const shift = (p) => [p[0] - centre.lon, p[1]];
  let d = '';
  for (const rings of polys) {
    for (const ring of rings) d += runsFor(ring.map(shift), true, P, centre.lat, zoom, what).d;
  }
  return d;
}

/**
 * The graticule as lon/lat polylines, before any projection.
 *
 * Meridians and parallels are written as *polylines* rather than as two endpoints even where a
 * projection would draw them straight, because orthographic bends both of them and the seam
 * splitter has to be able to cut a parallel in the middle. Parallels carry four vertices rather
 * than two for one specific reason: a single edge from minus 180 to plus 180 is a jump of a
 * whole turn, which the splitter correctly reads as a seam crossing and cuts into nothing
 * useful. Three edges of 120 degrees each cross nothing until the centre rotates them.
 *
 * @param step spacing in degrees
 * @param latLimit how far toward the pole a meridian is drawn
 * @param curved whether to sample finely, which only orthographic needs
 *
 * @example graticule(30, 90, false).length;   // 12 meridians plus 5 parallels
 */
export function graticule(step, latLimit, curved) {
  const out = [];
  const sample = curved ? GRAT_SAMPLE : 0;

  for (let lon = -180; lon < 180; lon += step) {
    const line = [];
    if (sample) for (let lat = -latLimit; lat < latLimit; lat += sample) line.push([lon, lat]);
    else line.push([lon, -latLimit]);
    line.push([lon, latLimit]);
    out.push(line);
  }

  for (let lat = -90 + step; lat < 90; lat += step) {
    const line = [];
    if (sample) for (let lon = -180; lon < 180; lon += sample) line.push([lon, lat]);
    else for (const lon of [-180, -60, 60]) line.push([lon, lat]);
    line.push([180, lat]);
    out.push(line);
  }
  return out;
}

/**
 * Every graticule line for one projection, already projected into path bodies.
 *
 * The meridian limit is the projection's business, not the caller's: mercator has to stop at
 * {@link MERC_LIMIT} because it has no pole to draw to.
 *
 * @param P      a {@link projector}
 * @param step   spacing in degrees
 * @param centre `{ lon, lat }` the view is rotated to
 * @param zoom   the multiplier applied to projected coordinates
 * @returns path bodies, ready for a `d` attribute
 *
 * @example graticulePaths(projector('mercator'), 30, { lon: 0, lat: 0 }, 1).length;   // 16
 */
export function graticulePaths(P, step, centre, zoom) {
  const out = [];
  const shift = (p) => [p[0] - centre.lon, p[1]];
  for (const g of graticule(step, P.name === 'mercator' ? MERC_LIMIT : 90, !P.cylindrical)) {
    const got = runsFor(g.map(shift), false, P, centre.lat, zoom, 'graticule');
    if (got.d) out.push(got.d);
  }
  return out;
}

/* ── reading the data ─────────────────────────────────────────────────────────────────── */

/**
 * One position, validated, or `null` when it is not a place on Earth.
 *
 * **Out of range is refused, never wrapped.** Longitude 200 could be folded to minus 160 and
 * latitude 100 could be clamped to 90, and both of those would draw *something*, which is the
 * problem: a coordinate outside the range is almost always a swapped pair, a radian value that
 * escaped a conversion, or a projected metre from a dataset in the wrong CRS. Folding it puts
 * a coastline in the Pacific and says nothing. Refusing it and counting the refusal is how the
 * caller finds out their data is in metres.
 *
 * @param p a GeoJSON position; extra members past the first two are ignored, as the spec allows
 * @returns `[lon, lat]` with both inside range, or null
 *
 * @example position([181, 0]);   // null
 * @example position([12, 45, 300]);   // [12, 45]
 */
export function position(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const lon = num(p[0], -180, 180);
  const lat = num(p[1], -90, 90);
  return lon === null || lat === null ? null : [lon, lat];
}

/** Distinct-vertex count, so a ring written with its first vertex repeated still counts. */
function distinctCount(ring) {
  const seen = new Set();
  for (const p of ring) seen.add(p[0] + '|' + p[1]);
  return seen.size;
}

/**
 * One GeoJSON ring, validated, with its closing repeat dropped.
 *
 * The whole ring goes when one vertex is off the Earth, not the vertex: dropping a single
 * vertex of a coastline splices the two around it together and invents a shoreline that was
 * never in the data, which is a lie the reader has no way to detect.
 *
 * @param raw    the ring as it arrived
 * @param counts a tally to increment; `outOfRange`, `tooFew` and `badGeom` are the reasons
 * @returns positions, or null when the ring is refused
 *
 * @example takeRing([[0, 0], [1, 0], [1, 1], [0, 0]], { outOfRange: 0, tooFew: 0, badGeom: 0 });
 */
export function takeRing(raw, counts) {
  if (!Array.isArray(raw)) { counts.badGeom++; return null; }
  const out = [];
  for (const p of raw) {
    const q = position(p);
    if (!q) { counts.outOfRange++; return null; }
    out.push(q);
  }
  /* GeoJSON rings repeat their first vertex as their last; the path is closed with `Z`
     instead, so the repeat is dropped rather than drawn as a zero-length edge. */
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  if (out.length < 3 || distinctCount(out) < 3) { counts.tooFew++; return null; }
  return out;
}

/**
 * One GeoJSON line, validated. Two positions is the minimum that draws anything.
 *
 * @param raw    the line as it arrived
 * @param counts a tally to increment
 * @returns positions, or null when the line is refused
 *
 * @example takeLine([[0, 0], [1, 1]], { outOfRange: 0, badGeom: 0 });   // [[0, 0], [1, 1]]
 */
export function takeLine(raw, counts) {
  if (!Array.isArray(raw)) { counts.badGeom++; return null; }
  const out = [];
  for (const p of raw) {
    const q = position(p);
    if (!q) { counts.outOfRange++; return null; }
    out.push(q);
  }
  if (out.length < 2) { counts.badGeom++; return null; }
  return out;
}

/**
 * Walk any GeoJSON this machinery accepts and hand back flat rings, lines and points.
 *
 * Four counts come back with them, and each one is a thing real data does often enough that
 * throwing would be the wrong answer:
 *
 *   - `outOfRange`: a ring, line or point holding a coordinate that is not on Earth. The whole
 *     shape goes, not the vertex -- dropping one vertex of a coastline splices the two around
 *     it together and invents a shoreline that was never in the data.
 *   - `tooFew`: a ring with fewer than three distinct vertices. It has no area, so a fill draws
 *     nothing at all and the reader sees a shape silently missing rather than a shape refused.
 *   - `badGeom`: a geometry whose `type` this machinery does not draw, or one with no coordinates.
 *   - `unnamed`: a Point with no label, which is drawn but cannot be spoken.
 *
 * Feature identity is *discarded* here, deliberately: this is the reader for cards that draw a
 * backdrop. A card that has to join values to regions wants {@link readRegions} instead.
 *
 * @param src whatever arrived as `features`
 * @returns `{ rings, lines, points, counts }`
 *
 * @example readFeatures({ type: 'Point', coordinates: [0, 0] }).points.length;   // 1
 */
export function readFeatures(src) {
  const rings = [];
  const lines = [];
  const points = [];
  const counts = { outOfRange: 0, tooFew: 0, badGeom: 0, unnamed: 0 };

  const takePoint = (raw, props) => {
    const q = position(raw);
    if (!q) { counts.outOfRange++; return; }
    const o = props && typeof props === 'object' ? props : {};
    const label = clean(o.label == null ? (o.name == null ? '' : o.name) : o.label);
    if (!label) counts.unnamed++;
    points.push({ lon: q[0], lat: q[1], label, value: o.value });
  };

  const geom = (g, props) => {
    if (!g || typeof g !== 'object') { counts.badGeom++; return; }
    const t = g.type;
    const c = g.coordinates;

    if (t === 'Feature') { geom(g.geometry, g.properties); return; }
    if (t === 'FeatureCollection') {
      const list = Array.isArray(g.features) ? g.features : [];
      for (const f of list) geom(f, null);
      return;
    }
    if (t === 'GeometryCollection') {
      const list = Array.isArray(g.geometries) ? g.geometries : [];
      for (const f of list) geom(f, props);
      return;
    }

    if (t === 'Polygon') {
      const shape = [];
      for (const raw of Array.isArray(c) ? c : []) {
        const r = takeRing(raw, counts);
        if (r) shape.push(r);
      }
      if (shape.length) rings.push(shape);
      return;
    }
    if (t === 'MultiPolygon') {
      for (const poly of Array.isArray(c) ? c : []) geom({ type: 'Polygon', coordinates: poly }, props);
      return;
    }
    if (t === 'LineString') { const l = takeLine(c, counts); if (l) lines.push(l); return; }
    if (t === 'MultiLineString') {
      for (const raw of Array.isArray(c) ? c : []) { const l = takeLine(raw, counts); if (l) lines.push(l); }
      return;
    }
    if (t === 'Point') { takePoint(c, props); return; }
    if (t === 'MultiPoint') {
      for (const raw of Array.isArray(c) ? c : []) takePoint(raw, props);
      return;
    }
    counts.badGeom++;
  };

  if (Array.isArray(src)) for (const g of src) geom(g, null);
  else geom(src, null);

  return { rings, lines, points, counts };
}

/**
 * Walk GeoJSON keeping each feature's identity, for cards that join values to regions.
 *
 * {@link readFeatures} throws feature identity away, which is right for a backdrop and useless
 * for a choropleth: without a key there is nothing to join a value to. The key is read from a
 * property whose *name* the caller supplies, because no two shapefiles agree on it -- `iso_a3`,
 * `GEOID`, `adm0_a3`, `id`, `name`. Falling back to the Feature's own `id` costs nothing and
 * covers the common case where the identity is on the feature rather than in its properties.
 *
 * Three counts are the ones that matter, and they exist because a choropleth's classic failure
 * is silent:
 *
 *   - `noKey`: a feature with nothing to join on. It will draw in the no-data colour forever
 *     and no amount of fixing the values will help, so the caption has to say it.
 *   - `duplicate`: two features carrying the same key. Both take the same value. That is
 *     usually right -- a country with islands -- and occasionally a merge that went wrong.
 *   - `outOfRange` / `tooFew` / `badGeom`: as {@link readFeatures}.
 *
 * @param src     whatever arrived as `features`
 * @param keyProp the property name holding the join key; defaults to `key`
 * @returns `{ regions, counts }`; each region is `{ key, name, polys, props }` where `polys` is
 *          a list of polygons and each polygon is a list of rings, outer ring first
 *
 * @example readRegions(builtinRegions(), 'key').regions.length;   // 20
 */
export function readRegions(src, keyProp) {
  const prop = typeof keyProp === 'string' && keyProp ? keyProp : 'key';
  const regions = [];
  const counts = { outOfRange: 0, tooFew: 0, badGeom: 0, noKey: 0, duplicate: 0 };
  const seen = new Set();

  const takePolys = (c, multi) => {
    const polys = [];
    const list = Array.isArray(c) ? c : [];
    for (const poly of multi ? list : [list]) {
      const rings = [];
      for (const raw of Array.isArray(poly) ? poly : []) {
        const r = takeRing(raw, counts);
        if (r) rings.push(r);
      }
      if (rings.length) polys.push(rings);
    }
    return polys;
  };

  const add = (polys, props, fid) => {
    if (!polys.length) return;
    const o = props && typeof props === 'object' ? props : {};
    const rawKey = o[prop] == null ? fid : o[prop];
    if (rawKey == null || String(rawKey) === '') { counts.noKey++; }
    const key = rawKey == null ? '' : clean(rawKey);
    if (key) {
      if (seen.has(key)) counts.duplicate++;
      seen.add(key);
    }
    const name = clean(o.name == null ? (o.label == null ? key : o.label) : o.name);
    regions.push({ key, name: name || key, polys, props: o });
  };

  const geom = (g, props, fid) => {
    if (!g || typeof g !== 'object') { counts.badGeom++; return; }
    const t = g.type;

    if (t === 'Feature') { geom(g.geometry, g.properties, g.id); return; }
    if (t === 'FeatureCollection') {
      for (const f of Array.isArray(g.features) ? g.features : []) geom(f, null, undefined);
      return;
    }
    if (t === 'GeometryCollection') {
      /* A GeometryCollection is ONE feature with several geometries, so its parts are merged
         into one region rather than becoming several keyless ones -- splitting them would
         invent regions the data never claimed and each would fail to join. */
      const polys = [];
      for (const f of Array.isArray(g.geometries) ? g.geometries : []) {
        if (!f || typeof f !== 'object') { counts.badGeom++; continue; }
        if (f.type === 'Polygon') polys.push(...takePolys(f.coordinates, false));
        else if (f.type === 'MultiPolygon') polys.push(...takePolys(f.coordinates, true));
        else counts.badGeom++;
      }
      add(polys, props, fid);
      return;
    }
    if (t === 'Polygon') { add(takePolys(g.coordinates, false), props, fid); return; }
    if (t === 'MultiPolygon') { add(takePolys(g.coordinates, true), props, fid); return; }
    counts.badGeom++;
  };

  if (Array.isArray(src)) for (const g of src) geom(g, null, undefined);
  else geom(src, null, undefined);

  return { regions, counts };
}

/**
 * The view half of a card's data block: where it looks, how far in, and how.
 *
 * Shared because all five map-shaped cards read the same four fields, and a card that folded a
 * bad centre instead of refusing it would disagree with its neighbours about what the data
 * said. The refusals are returned rather than thrown for the usual reason -- a typo in a centre
 * is a fact about the data, and the caption is where a fact about the data belongs.
 *
 * The zoom is read from `scale` and from nowhere else. A card whose own `scale` *setting* names
 * something other than a zoom -- `choropleth`, where it names the binning rule -- resolves that
 * ambiguity itself and hands this function a block whose `scale` is the number or nothing, so
 * that one field never means two things inside one function.
 *
 * @param d     the card's data block, possibly malformed or absent
 * @param dflt  `{ projection, graticule }`, the type's own fallbacks
 * @returns `{ centre, zoom, gratStep, gratOn, given, badCentre, badScale }`
 *
 * @example readView({ center: { lon: 10, lat: 50 }, scale: 2 }, { projection: 'mercator', graticule: true }).zoom;   // 2
 */
export function readView(d, dflt) {
  /* A centre out of range is refused like any other coordinate, not folded. A map centred on
     longitude 400 is a typo, and quietly centring it on 40 hides the typo behind a map that
     looks fine. */
  const rawCentre = Array.isArray(d.center)
    ? { lon: d.center[0], lat: d.center[1] }
    : (d.center && typeof d.center === 'object' ? d.center : {});
  const clon = num(rawCentre.lon == null ? 0 : rawCentre.lon, -180, 180);
  const clat = num(rawCentre.lat == null ? 20 : rawCentre.lat, -90, 90);
  const badCentre = clon === null || clat === null;
  const centre = { lon: badCentre ? 0 : clon, lat: badCentre ? 20 : clat };

  const rawScale = Number(d.scale == null ? 1 : d.scale);
  const badScale = !Number.isFinite(rawScale) || rawScale < SCALE_MIN || rawScale > SCALE_MAX;
  const zoom = badScale ? 1 : rawScale;

  /* `graticule` is a boolean or a spacing. A number carries both facts at once -- it is on, and
     this is how far apart -- which is why it is allowed to stand in for the flag. */
  const gratNum = num(d.graticule, 5, 90);
  const gratStep = typeof d.graticule === 'number' && gratNum !== null ? gratNum : GRAT_STEP;
  const gratOn = d.graticule == null ? dflt.graticule
    : (typeof d.graticule === 'number' ? gratNum !== null : !!d.graticule);

  const given = PROJECTIONS.indexOf(d.projection) >= 0 ? d.projection : dflt.projection;

  return { centre, zoom, gratStep, gratOn, given, badCentre, badScale };
}

/**
 * Join a value table onto a list of regions, and count every way the join went wrong.
 *
 * **This is the part that goes wrong, so it is the part that gets counted.** A choropleth whose
 * join half failed does not error and does not look broken: it draws half the map in the no-data
 * colour, which reads as "there is no data for these places" rather than "your key column is
 * `ISO_A3` and mine is `iso_a3`". The reader believes it. So every one of the four failures gets
 * a number, and the caption prints all four whether they are zero or not -- a statistic that
 * only appears when it is bad is a statistic nobody learns to look for.
 *
 * **Normalisation is all or nothing.** A denominator is used only when *every* matched row
 * carries a usable one. Half a map showing a rate and half showing a count is not a partly
 * normalised map, it is a map where the two halves cannot be compared at all, and there is no
 * caption that rescues it. When the denominators are incomplete the raw values are used and the
 * count of rows that did carry one is returned, so the caption can say what was ignored.
 *
 * @param regions from {@link readRegions}
 * @param rows    `[{ key, value, of }]`, or a plain object of key to value; `of` is the optional
 *                denominator, in whatever unit makes `value / of` the rate you meant
 * @returns `{ values, stats }` -- `values[i]` is the number for `regions[i]` or null, and
 *          `stats` carries `matched`, `noValue`, `noFeature`, `nonNumeric`, `keyless`,
 *          `duplicateRows`, `withDenominator`, `normalised` and `negative`
 *
 * @example joinValues([{ key: 'a' }], [{ key: 'a', value: 3 }]).stats.matched;   // 1
 * @example joinValues([{ key: 'a' }], [{ key: 'b', value: 3 }]).stats.noFeature; // 1
 */
export function joinValues(regions, rows) {
  const stats = {
    matched: 0, noValue: 0, noFeature: 0, nonNumeric: 0, keyless: 0,
    duplicateRows: 0, withDenominator: 0, normalised: false, negative: 0,
  };

  /* Two shapes accepted because both are what people actually have: a list of rows out of a CSV
     reader, and an object out of a lookup they built by hand. */
  const list = Array.isArray(rows) ? rows
    : (rows && typeof rows === 'object'
      ? Object.keys(rows).map((k) => ({ key: k, value: rows[k] }))
      : []);

  const table = new Map();
  for (const raw of list) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const key = clean(r.key == null ? '' : r.key);
    /* A row with no key can never join anything, so it is its own failure rather than a
       missing feature -- calling it "a value with no feature" would send the reader looking
       at their shapefile for a problem that is in their value table. */
    if (!key) { stats.keyless++; continue; }
    const v = Number(r.value);
    if (!Number.isFinite(v)) { stats.nonNumeric++; continue; }
    const den = Number(r.of);
    if (table.has(key)) stats.duplicateRows++;
    table.set(key, { value: v, of: Number.isFinite(den) && den > 0 ? den : null });
  }

  const wanted = new Set();
  for (const reg of regions) if (reg.key) wanted.add(reg.key);
  for (const key of table.keys()) if (!wanted.has(key)) stats.noFeature++;

  const hits = [];
  for (const reg of regions) {
    const got = reg.key ? table.get(reg.key) : undefined;
    if (!got) { stats.noValue++; hits.push(null); continue; }
    stats.matched++;
    if (got.of !== null) stats.withDenominator++;
    hits.push(got);
  }

  /* All or nothing, decided after the whole join rather than per row. */
  stats.normalised = stats.matched > 0 && stats.withDenominator === stats.matched;

  const values = hits.map((h) => {
    if (!h) return null;
    const v = stats.normalised ? h.value / h.of : h.value;
    if (v < 0) stats.negative++;
    return v;
  });

  return { values, stats };
}

/* ── geometry on rings ────────────────────────────────────────────────────────────────── */

/**
 * Twice the signed area of a ring in lon/lat, by the shoelace sum.
 *
 * Signed on purpose: the sign is the winding direction, which is how a hole is told from an
 * outer ring without trusting the author to have wound them correctly. Computed in degrees
 * rather than on the sphere because every use here is a *ratio* between two rings of a card --
 * a centroid, a relative size -- and the projection's own area distortion swamps the difference
 * anyway. A card that needed true square kilometres would need a spherical excess formula and a
 * datum, and would not be getting either from a coarse hand-written outline.
 *
 * @param ring positions as `[lon, lat]`, unclosed
 * @returns twice the signed area, in square degrees; positive for a counter-clockwise ring
 *
 * @example ringArea2([[0, 0], [1, 0], [1, 1], [0, 1]]);   // 2 -- a unit square, twice over
 */
export function ringArea2(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/**
 * A ring's centroid in lon/lat, falling back to the vertex mean when it has no area.
 *
 * The area-weighted centroid is the right answer and it divides by the area, so a degenerate
 * ring -- three collinear points, or a sliver that rounds to nothing -- would produce a
 * non-finite pair that poisons every path it touches. The vertex mean is not the centroid, but
 * it is inside the convex hull of the ring, which is all a label anchor or a Dorling seed needs.
 *
 * @param ring positions as `[lon, lat]`, unclosed
 * @returns `{ lon, lat, area }` where `area` is the unsigned area in square degrees
 *
 * @example ringCentroid([[0, 0], [2, 0], [2, 2], [0, 2]]);   // { lon: 1, lat: 1, area: 4 }
 */
export function ringCentroid(ring) {
  const a2 = ringArea2(ring);
  if (Math.abs(a2) < 1e-12) {
    let lon = 0, lat = 0;
    for (const p of ring) { lon += p[0]; lat += p[1]; }
    const k = ring.length || 1;
    return { lon: lon / k, lat: lat / k, area: 0 };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return { lon: cx / (3 * a2), lat: cy / (3 * a2), area: Math.abs(a2) / 2 };
}

/**
 * A whole region's centroid: the area-weighted mean of its outer rings.
 *
 * Outer rings only. A hole has negative winding and including it would drag the centroid toward
 * the hole -- which is exactly backwards, since the hole is the part of the region that is not
 * there. Holes are small relative to the shapes here and no card places a label by more than a
 * few degrees, so ignoring them is the cheap answer that is also the right one.
 *
 * @param polys a region's polygons, each a list of rings with the outer ring first
 * @returns `{ lon, lat, area }`, or null when the region has no usable ring
 *
 * @example polysCentroid([[[[0, 0], [2, 0], [2, 2], [0, 2]]]]).lon;   // 1
 */
export function polysCentroid(polys) {
  let wx = 0, wy = 0, wa = 0;
  let fx = 0, fy = 0, fn = 0;
  for (const poly of polys) {
    if (!poly.length) continue;
    const c = ringCentroid(poly[0]);
    fx += c.lon; fy += c.lat; fn++;
    wx += c.lon * c.area; wy += c.lat * c.area; wa += c.area;
  }
  if (!fn) return null;
  /* Every ring degenerate means every weight is zero, so the weighted mean is 0/0. The plain
     mean of the ring centroids is the honest fallback and it is still inside the region. */
  if (!(wa > 0)) return { lon: fx / fn, lat: fy / fn, area: 0 };
  return { lon: wx / wa, lat: wy / wa, area: wa };
}

/* ── value to size ────────────────────────────────────────────────────────────────────── */

/**
 * A radius scale in which **area**, not radius, is proportional to value.
 *
 * This is the single most common error in a symbol map and it is worth being explicit about the
 * size of it. A circle drawn with its radius proportional to value overstates the large ones by
 * the SQUARE of the ratio: a value of one hundred against a value of one gets a hundred times
 * the radius and **ten thousand** times the ink. The reader compares ink, because that is what
 * the eye measures, so a radius-proportional map is not a rough map -- it is a map that is wrong
 * by two orders of magnitude wherever the data has a wide range.
 *
 * Taking the square root first makes the ratio of areas equal the ratio of values, which is what
 * the reader is already assuming.
 *
 * `CK.scale` does the mapping rather than a private formula, so the zero-width-domain case --
 * every value identical -- lands on the midpoint of the radius range instead of dividing by
 * zero, which is exactly right for "these are all the same size".
 *
 * @param values  every value that will be drawn; non-finite and negative entries must already
 *                have been refused by the caller, since neither has a square root a radius can use
 * @param range   `[rMin, rMax]` in view units
 * @param fallback the radius for a datum carrying no value at all
 * @returns a function from value (or null) to radius
 *
 * @example areaRadius([1, 100], [2, 20], 3)(100);   // 20
 * @example areaRadius([1, 100], [2, 20], 3)(null);  // 3
 */
export function areaRadius(values, range, fallback) {
  const roots = values.filter((v) => Number.isFinite(v) && v >= 0).map(Math.sqrt);
  if (!roots.length) return () => fallback;
  const to = CK.scale([Math.min(...roots), Math.max(...roots)], range);
  return (v) => (v == null || !Number.isFinite(v) || v < 0 ? fallback : to(Math.sqrt(v)));
}

/**
 * A radius scale in which area is **strictly** proportional to value: zero value, zero circle.
 *
 * The difference from {@link areaRadius} is the anchor, and it decides what the picture means.
 * `areaRadius` fits the observed range into a radius range, so the smallest datum is still
 * visible and the ratio of two areas is *not* the ratio of two values -- which is right for an
 * annotation whose value is a secondary fact, as a marker on `map` is. This anchors at zero
 * instead, so area over area equals value over value everywhere, which is the only version of a
 * bubble map that a reader can measure. The cost is real and is not hidden: a datum at one per
 * cent of the maximum draws at one tenth of the radius, which at card size is a dot, and a datum
 * of zero draws nothing at all.
 *
 * A ceiling may be set below the observed maximum so two cards share one scale. Values above it
 * are clamped, and the caller is expected to count and name them -- an unannounced clamp turns
 * the largest three regions into one size and says nothing.
 *
 * @param vmax the value that draws at `rMax`; must be greater than zero
 * @param rMax the radius the ceiling value draws at, in view units
 * @returns a function from value to radius; a value at or below zero gives zero
 *
 * @throws {Error} when `vmax` is not a positive finite number, because every radius would then
 *                 be non-finite and the whole card would draw nothing, silently
 *
 * @example proportionalRadius(100, 20)(25);   // 10 -- a quarter the value, a quarter the ink
 * @example proportionalRadius(100, 20)(100);  // 20
 */
export function proportionalRadius(vmax, rMax) {
  if (!Number.isFinite(vmax) || vmax <= 0) {
    throw new Error('cardkit/_geo: proportionalRadius needs a positive maximum, got ' + vmax);
  }
  return (v) => {
    if (v == null || !Number.isFinite(v) || v <= 0) return 0;
    return rMax * Math.sqrt(Math.min(v, vmax) / vmax);
  };
}

/**
 * The largest radius a set of values can be drawn at and still fit on the map.
 *
 * A fixed maximum radius is fine for twenty circles and absurd for two hundred: the total ink
 * grows with the count, and past a certain point there is NO arrangement in which the circles do
 * not overlap, so a Dorling relaxation runs its whole pass budget and reports a residual overlap
 * that no amount of iterating could have removed. That is a scale problem being reported as a
 * convergence problem, which sends the reader looking in the wrong place.
 *
 * So the scale is fitted: the sum of the circle areas is held to a fraction of the map, and the
 * radius that achieves it is used unless the hard maximum is smaller. Shrinking every radius by
 * one factor is exactly the operation that preserves proportionality -- area over area is
 * untouched -- so nothing about the encoding changes, only how much of the page it uses.
 *
 * With `pi r^2` summed over the values, `sum(pi (rMax sqrt(v / vmax))^2)` is
 * `pi rMax^2 sum(v) / vmax`, which is solved for `rMax` directly.
 *
 * @param values  every value that will be drawn; nulls and negatives are ignored
 * @param vmax    the value that draws at the returned radius
 * @param hardMax the radius never to exceed however few the circles are
 * @param fill    the fraction of the world box the circles may cover together
 * @returns a radius in view units, at least a hair above zero so a scale can be built from it
 *
 * @example fitMaxRadius([1, 1, 1, 1], 1, 30, 0.5);   // 30 -- four circles fit easily
 */
export function fitMaxRadius(values, vmax, hardMax, fill) {
  if (!(vmax > 0)) return hardMax;
  let share = 0;
  for (const v of values) if (Number.isFinite(v) && v > 0) share += Math.min(v, vmax) / vmax;
  if (!(share > 0)) return hardMax;
  const room = fill * (HALF_W * 2) * (HALF_W);
  const fitted = Math.sqrt(room / (Math.PI * share));
  return Math.max(0.4, Math.min(hardMax, fitted));
}

/* ── the built-in world ───────────────────────────────────────────────────────────────── */

/**
 * Pair a flat run of numbers into `[lon, lat]` positions.
 *
 * The built-in outlines are written flat because a coastline written as pairs of brackets is
 * three times the bytes and half the readability, and this file has to hold a whole world twice.
 *
 * @param flat alternating longitude and latitude, in degrees
 * @returns positions in GeoJSON order
 *
 * @example pairs([0, 1, 2, 3]);   // [[0, 1], [2, 3]]
 */
export function pairs(flat) {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/**
 * A coarse world land outline, hand-written, so a card is usable with no data at all.
 *
 * Roughly three hundred vertices for the whole planet. That is deliberately too few to be a
 * map you would navigate by and exactly enough to be a map you can read at card size: at the
 * width of a desk column a coastline drawn from ten thousand points and one drawn from three
 * hundred are the same picture, and one of them is a hundred kilobytes.
 *
 * Antarctica carries two extra vertices at latitude minus ninety so that its ring closes
 * across the pole rather than across the map. Nothing here crosses the antimeridian in its own
 * coordinates -- Chukotka is truncated at 179 degrees east -- but rotating the centre makes
 * almost every one of these rings cross it, which is what {@link splitSeam} is for.
 */
export const WORLD = [
  ['africa', [
    -5.6, 35.8, 10, 37, 20, 32.5, 32, 31.5, 34, 28, 37, 19, 39, 15, 43.3, 11.5, 51, 12,
    41, -2, 40, -10, 35, -20, 32.5, -26, 25, -34, 18.4, -34.3, 12, -18, 11.7, -5,
    8.5, 4.5, -2, 5, -7.5, 4.4, -16.5, 13.5, -17.5, 21, -9.8, 30,
  ]],
  ['eurasia', [
    -9.5, 38.7, -9, 43.4, -1.5, 46.2, -4.8, 48.4, 2, 51, 4.3, 52.4, 8.5, 54, 10.5, 57.7,
    5.5, 58.9, 5, 62, 11, 64, 17, 69, 28, 71, 40, 66, 55, 68.5, 73, 71, 105, 77, 130, 72,
    160, 70, 179, 66, 170, 60.5, 163, 58, 156, 51, 142, 54, 135, 43.2, 122, 39.5, 121, 31,
    110, 21, 105, 10, 100, 13.5, 103, 1.3, 98, 8, 94, 16, 90, 22, 80, 15, 77.5, 8.1,
    72.8, 19, 68, 24, 61, 25, 56.5, 26.6, 54, 24, 58, 20, 52, 13, 43.5, 12.8, 39, 21,
    34.5, 28, 34, 31.3, 36, 36, 31, 36.8, 26, 36.7, 23, 37.5, 20, 39.5, 18.5, 42.5,
    13.6, 45.7, 14.2, 42.1, 18.4, 40.1, 15.6, 38, 12.5, 41.5, 7.5, 43.7, 3, 43.1,
    0.2, 39.5, -0.6, 37.6, -5.6, 36, -7, 37.2, -9, 37,
  ]],
  ['north america', [
    -168, 65.5, -162, 58.5, -152, 59.5, -135, 57, -128, 51, -124, 46.2, -122, 37,
    -117, 32.5, -115, 28, -110, 23, -113.5, 29, -114.5, 31.5, -110.5, 27.5, -105.9, 23.2,
    -99.9, 16.8, -94, 16, -92, 14, -87, 13, -84, 10, -79, 9, -77, 8, -82, 9.5, -83.5, 15,
    -88, 15.8, -87, 21.5, -90.5, 21, -97, 21, -97.5, 26, -93, 29.5, -88, 30, -82.5, 27.5,
    -81, 25, -80, 27, -81.5, 31, -75.5, 35.2, -76, 38, -74, 40.5, -70, 41.6, -67, 44.8,
    -64, 45, -60, 47, -55.5, 51.5, -58, 54, -64, 60, -78, 62, -82, 55, -88, 56, -94, 59,
    -85, 66, -95, 68, -115, 69, -125, 70, -141, 70, -156, 71, -162, 67,
  ]],
  ['south america', [
    -77, 8, -75, 11, -71, 12, -64, 10.5, -60, 8.5, -52, 5, -50, 0, -44, -2.5, -35.2, -5.8,
    -35, -8, -39, -13, -40, -20, -44, -23, -48, -26, -56, -35, -57, -38, -62, -40,
    -65, -45, -68, -50, -67, -55.9, -74, -52, -75, -47, -73, -40, -72, -35, -71, -30,
    -70.5, -23, -71, -18, -77, -12, -81, -6, -80.5, -2, -79, 2,
  ]],
  ['australia', [
    114, -22, 113.5, -26, 115, -33, 118, -35, 125, -32.5, 131, -31.5, 135, -35, 138, -35,
    141, -38, 146.4, -39, 150, -37, 151, -33.8, 153.5, -28, 149, -21, 146, -19, 145.5, -15,
    142.5, -10.7, 140, -17, 136, -12, 130.8, -12.4, 129, -15, 124, -16, 121, -19, 117, -20.5,
  ]],
  ['antarctica', [
    -180, -78, -170, -78, -160, -79, -150, -75, -135, -74, -120, -74, -100, -73, -80, -73,
    -70, -70, -62, -65, -58, -63, -57, -66, -50, -67, -40, -75, -25, -76, -10, -71, 0, -70,
    15, -70, 30, -68.5, 45, -67, 60, -67, 75, -68, 90, -66.5, 105, -66, 120, -66.5,
    135, -66, 150, -70, 160, -77, 170, -78, 180, -78, 180, -90, -180, -90,
  ]],
  ['greenland', [
    -45, 60, -50, 63, -52, 67, -55, 70, -58, 75, -65, 76, -70, 77, -60, 82, -40, 83,
    -25, 82, -20, 76, -22, 70, -38, 65,
  ]],
  ['madagascar', [49.5, -12.5, 50.5, -15.5, 48.5, -22, 45, -25.5, 43.5, -21, 44, -16, 46.5, -15.5]],
  ['great britain', [-5.7, 50.1, 1.7, 52.5, -1.5, 55.5, -3, 58.6, -5.8, 57, -4.8, 54.6, -5.2, 51.6]],
  ['ireland', [-6, 52.2, -10, 51.5, -10, 54.3, -6, 55.2, -6.2, 53.3]],
  ['iceland', [-24, 65.5, -22, 66.5, -14, 65.5, -13.5, 64.4, -20, 63.4, -22.7, 64]],
  ['japan', [
    130.9, 33.9, 131.7, 31, 135, 33.5, 137, 34.6, 140.9, 35.7, 141.5, 39, 141, 41.5,
    139.5, 40, 136, 37, 132.5, 35,
  ]],
  ['sumatra', [95.3, 5.5, 98, 3.5, 104, -2, 106, -5.9, 102, -5.5, 100, -2]],
  ['borneo', [109, 1.8, 110, -1.5, 116, -3.9, 118, -3.5, 117.5, 4.2, 113, 3]],
  ['new guinea', [131, -1, 138, -1.5, 141, -2.6, 147, -8, 150.8, -10.3, 143, -9, 137, -8.4, 132.5, -5.2]],
  ['java', [105.2, -5.9, 114.4, -7.7, 114, -8.6, 105.5, -6.9]],
  ['sri lanka', [79.7, 9.8, 81.9, 7.3, 80.2, 5.9, 79.7, 8]],
  ['cuba', [-84.9, 21.9, -80, 23, -74.2, 20.2, -77.7, 19.9, -82.5, 21.5]],
  ['tasmania', [144.7, -40.7, 148.3, -40.8, 147.9, -43.5, 145.5, -43.5]],
  ['new zealand north', [172.7, -34.4, 176, -37, 178.5, -37.6, 177, -39.5, 174.9, -41.3, 173, -40.9, 174.6, -36.5]],
  ['new zealand south', [172.7, -40.5, 174.3, -41.7, 172.8, -43.9, 170.7, -45.9, 168.5, -46.6, 166.5, -45.9, 170, -43, 171.5, -41.8]],
];

/**
 * The built-in outline as a GeoJSON FeatureCollection.
 *
 * Handed through the same reader as caller data on purpose. A second code path for the default
 * dataset is a second set of bugs, and the one thing you can be sure of about a built-in is
 * that nobody tests it as hard as the input they brought themselves.
 *
 * @example builtinWorld().features.length;   // 21
 */
export function builtinWorld() {
  return {
    type: 'FeatureCollection',
    features: WORLD.map(([name, flat]) => ({
      type: 'Feature',
      properties: { name },
      geometry: { type: 'Polygon', coordinates: [pairs(flat)] },
    })),
  };
}

/* ── the built-in regions ─────────────────────────────────────────────────────────────── */

/**
 * Twenty coarse world subregions with stable keys, so a joined card works with no data.
 *
 * {@link WORLD} cannot serve a choropleth. It is a land outline: it has no per-region identity,
 * so there is nothing to join a value to, and a choropleth with no join is a picture of the
 * no-data colour. This is the smallest thing that fixes that -- twenty blocks, six to sixteen
 * vertices each, each carrying a slug that will not change.
 *
 * **These are not boundaries.** They are hand-drawn blocks that look approximately like where
 * the continents are, at a resolution where the Mediterranean is a corner. No border here is
 * where a real border is, several of them overlap, and the `area` and `pop` figures are
 * order-of-magnitude sketches carried so a demonstration can show a rate rather than a count.
 * Every card that draws them says so in its caption, in those words, because a map that looks
 * authoritative and is not is worse than no map.
 *
 * Two entries earn their place beyond covering land. `antarctica` closes across the pole, so it
 * exercises {@link closeThroughPole} every single build; `oceania` is a MultiPolygon, so the
 * multi-part path is never the untested one.
 *
 * Each entry: key, name, land area in millions of square kilometres, population in millions,
 * then one or more flat rings.
 */
export const REGIONS = [
  ['north-america-west', 'North America West', 9.0, 80, [
    -168, 66, -160, 58, -150, 59, -135, 57, -124, 48, -124, 40, -117, 32, -108, 31,
    -105, 40, -105, 49, -110, 60, -125, 70, -141, 70, -156, 71,
  ]],
  ['north-america-east', 'North America East', 12.5, 200, [
    -105, 31, -97, 26, -90, 29, -81, 25, -80, 32, -70, 42, -60, 47, -55, 52,
    -64, 60, -78, 62, -90, 68, -105, 71, -118, 70, -112, 60, -105, 49,
  ]],
  ['central-america', 'Central America and the Caribbean', 2.7, 100, [
    -97, 26, -90, 29, -81, 25, -74, 20, -77, 8, -83, 9, -92, 14, -97, 16, -105, 20,
  ]],
  ['south-america-north', 'South America North', 8.5, 250, [
    -81, -5, -77, 8, -60, 10, -50, 0, -35, -6, -40, -18, -58, -20, -70, -18,
  ]],
  ['south-america-south', 'South America South', 9.2, 180, [
    -70, -18, -58, -20, -40, -18, -48, -28, -57, -38, -65, -45, -68, -55, -75, -48,
    -73, -35, -71, -25,
  ]],
  ['northern-africa', 'Northern Africa', 8.5, 250, [
    -17, 21, -10, 28, -5, 36, 11, 37, 25, 32, 34, 31, 43, 12, 32, 10, 15, 13, 0, 15,
  ]],
  ['western-africa', 'Western Africa', 5.1, 400, [
    -17, 21, 0, 15, 15, 13, 12, -5, 9, 4, -2, 5, -8, 4, -13, 9, -17, 15,
  ]],
  ['eastern-africa', 'Eastern Africa', 6.4, 450, [
    32, 10, 43, 12, 51, 12, 43, -2, 40, -11, 30, -13, 25, -5, 28, 3,
  ]],
  ['southern-africa', 'Southern Africa', 6.6, 200, [
    12, -5, 25, -5, 30, -13, 40, -11, 35, -24, 28, -33, 18, -34, 12, -17,
  ]],
  ['western-europe', 'Western Europe', 3.7, 200, [
    -10, 37, -9, 44, -2, 49, 4, 52, 9, 55, 11, 58, 5, 59, 7, 63, 12, 66, 25, 71,
    30, 62, 24, 55, 19, 49, 17, 42, 12, 38, -6, 36,
  ]],
  ['eastern-europe', 'Eastern Europe', 6.9, 200, [
    17, 42, 19, 49, 24, 55, 30, 62, 40, 66, 60, 66, 60, 52, 50, 45, 37, 45, 28, 44,
  ]],
  ['middle-east', 'Middle East', 6.3, 300, [
    34, 31, 34, 36, 45, 40, 55, 38, 62, 25, 57, 22, 48, 29, 43, 12,
  ]],
  ['central-asia', 'Central Asia', 4.0, 80, [
    50, 45, 60, 52, 60, 66, 80, 55, 88, 48, 78, 38, 62, 35, 55, 40,
  ]],
  ['northern-asia', 'Northern Asia', 13.1, 40, [
    60, 66, 75, 72, 105, 77, 130, 72, 160, 70, 179, 66, 168, 60, 150, 58, 135, 50,
    120, 50, 100, 50, 80, 55,
  ]],
  ['southern-asia', 'Southern Asia', 5.1, 1900, [
    62, 25, 70, 32, 78, 35, 88, 28, 94, 22, 88, 21, 80, 8, 72, 20, 66, 24,
  ]],
  ['eastern-asia', 'Eastern Asia', 11.8, 1600, [
    88, 28, 88, 48, 120, 50, 135, 50, 142, 45, 140, 35, 122, 30, 108, 20, 98, 25,
  ]],
  ['southeast-asia', 'Southeast Asia', 4.5, 680, [
    94, 22, 98, 25, 108, 20, 122, 18, 127, 6, 118, -2, 108, -8, 100, 2, 96, 5, 88, 21,
  ]],
  ['oceania', 'Australia, New Guinea and New Zealand', 8.6, 46, [
    113, -22, 114, -33, 125, -33, 138, -35, 147, -39, 153, -28, 146, -19, 143, -11,
    150, -10, 140, -3, 131, -1, 131, -9, 129, -15, 122, -17,
  ], [
    166, -46, 174, -41, 178, -37, 173, -34, 170, -40, 168, -44,
  ]],
  ['greenland', 'Greenland', 2.2, 0.06, [
    -45, 60, -52, 66, -62, 75, -68, 77, -55, 82, -30, 83, -20, 76, -24, 70, -38, 64,
  ]],
  ['antarctica', 'Antarctica', 14.0, 0.004, [
    -180, -72, -140, -74, -100, -73, -70, -70, -60, -64, -40, -75, -10, -71, 20, -70,
    60, -67, 100, -66, 140, -67, 170, -77, 180, -72, 180, -90, -180, -90,
  ]],
];

/**
 * The one sentence every card drawing {@link REGIONS} must put in its caption.
 *
 * Shared as a constant rather than retyped, because the whole point of it is that it is always
 * there and always says the same thing. Five cards each phrasing the disclaimer their own way
 * is five chances for one of them to soften it.
 */
export const REGION_NOTE =
  'the twenty regions are a coarse built-in drawn by hand for demonstration -- not survey ' +
  'boundaries, and the area and population figures are order-of-magnitude sketches';

/**
 * The built-in subregions as a GeoJSON FeatureCollection with joinable keys.
 *
 * Read through {@link readRegions} like any caller's data, for the same reason
 * {@link builtinWorld} is: a second code path for the default dataset is a second set of bugs,
 * and a built-in is the input nobody tests as hard as their own.
 *
 * @returns a FeatureCollection whose properties carry `key`, `name`, `area` and `pop`
 *
 * @example builtinRegions().features.length;   // 20
 */
export function builtinRegions() {
  return {
    type: 'FeatureCollection',
    features: REGIONS.map(([key, name, area, pop, ...rings]) => ({
      type: 'Feature',
      properties: { key, name, area, pop },
      geometry: rings.length === 1
        ? { type: 'Polygon', coordinates: [pairs(rings[0])] }
        : { type: 'MultiPolygon', coordinates: rings.map((r) => [pairs(r)]) },
    })),
  };
}

/**
 * The built-in demonstration values: population, with land area as the denominator.
 *
 * A choropleth of raw population is a population map, which is a map of where people are and
 * not of anything else -- so the built-in ships the denominator alongside the numerator and the
 * card divides. That is the behaviour worth demonstrating, since it is the one real data
 * usually needs and rarely arrives with.
 *
 * @returns rows of `{ key, value, of }` -- population in millions over area in Mkm2
 *
 * @example builtinValues()[0].key;   // 'north-america-west'
 */
export function builtinValues() {
  return REGIONS.map(([key, , area, pop]) => ({ key, value: pop, of: area }));
}

/* ── the guard ────────────────────────────────────────────────────────────────────────── */

/**
 * Blank out comment bodies and string bodies, keeping every offset where it was.
 *
 * This exists because the keyword scan below cried wolf. A card was refused for saying
 * "the class is what CSS reads" in a comment, and a guard that has to be argued with is a guard
 * somebody deletes. Comments and strings are the two places English lives inside code, so they
 * are replaced with spaces before any keyword is looked for.
 *
 * Offsets are preserved rather than the text being cut out, so a reported position still points
 * at the character it names, and newlines survive so a reported line number is the real one.
 *
 * It does not track regular-expression literals, which the emitted scripts do not contain; a
 * slash that is not the start of a comment is simply passed over, so division is safe.
 *
 * @param src source to sanitise
 * @returns the same length of text with every comment and string body turned to spaces
 *
 * @example blankLiterals('var a = "let";');   // 'var a = "   ";'
 */
export function blankLiterals(src) {
  const out = src.split('');
  const len = src.length;
  let i = 0;

  const wipe = (j) => { if (src[j] !== '\n') out[j] = ' '; };

  while (i < len) {
    const ch = src[i];
    const nx = src[i + 1];

    if (ch === '/' && nx === '/') {
      let j = i;
      while (j < len && src[j] !== '\n') { wipe(j); j++; }
      i = j;
      continue;
    }
    if (ch === '/' && nx === '*') {
      let j = i;
      while (j < len && !(src[j] === '*' && src[j + 1] === '/')) { wipe(j); j++; }
      if (j < len) { wipe(j); wipe(j + 1); j += 2; }
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < len && src[j] !== ch) {
        if (src[j] === '\\') { wipe(j); wipe(j + 1); j += 2; continue; }
        wipe(j);
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Where an offset falls, said the way a stack trace would say it. */
function atOffset(src, off) {
  const before = src.slice(0, off);
  const line = before.split('\n').length;
  return 'line ' + line + ', offset ' + off;
}

/**
 * Refuse to emit a script that would take the whole desk down.
 *
 * Every card's script is concatenated into ONE inline block, so a single modern-syntax token in
 * one card is a parse error that blanks every card on the page. The hazard that has actually
 * bitten is subtler than writing an arrow function on purpose: the browser halves of these types
 * are shipped by `Function.prototype.toString()`, which carries their comments along, so a
 * backtick typed around a word in a doc comment becomes an unterminated template literal in a
 * file that must be a classic script.
 *
 * Two scans, deliberately different:
 *
 *   - A backtick, an arrow and an optional chain are looked for in the RAW text. None of them
 *     can appear innocently in emitted classic-script code, and a backtick inside a string is
 *     exactly the case worth catching.
 *   - `const`, `let` and `class` are looked for only OUTSIDE comments and strings, because all
 *     three are ordinary English and a guard that fires on prose gets deleted rather than fixed.
 *
 * The backtick is named by its code point rather than typed, per the contract: writing the
 * character in the file that describes the character is how the file acquires the bug.
 *
 * Exported and shared by every geographic type, so there is one guard rather than five that
 * drift. A check that has never been shown to fire is a check nobody knows the shape of, and
 * this one has two failure modes worth pinning down: it must catch a backtick that a doc comment
 * carried into the emitted script, and it must NOT catch the word "class" in a sentence.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming the token and where it is
 *
 * @example guardEmitted('var a = 1;', 'demo');   // 'var a = 1;'
 * @example guardEmitted('var a = ' + String.fromCharCode(96, 120, 96) + ';', 'demo'); // throws
 */
export function guardEmitted(js, where) {
  const bad = [];

  for (const [needle, what] of [[String.fromCharCode(96), 'a backtick'], ['=>', 'an arrow function'],
                                ['?.', 'optional chaining']]) {
    const at = js.indexOf(needle);
    if (at >= 0) bad.push(what + ' at ' + atOffset(js, at));
  }

  const code = blankLiterals(js);
  for (const word of ['const', 'let', 'class']) {
    const hit = new RegExp('\\b' + word + '\\b').exec(code);
    if (hit) bad.push('the keyword ' + word + ' at ' + atOffset(js, hit.index));
  }

  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) {
    throw new Error('cardkit/_geo: refusing to emit ' + where + ' -- ' + bad.join('; '));
  }
  return js;
}
