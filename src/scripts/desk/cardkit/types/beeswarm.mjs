/**
 * `beeswarm` — one dot per observation, dodged so that none of them overlap.
 *
 * A beeswarm is the plot that refuses to summarise. A histogram bins, a box plot quotes five
 * numbers, a violin smooths; this one puts every observation on the page and lets the shape fall
 * out of how they have to arrange themselves. That makes it the only distribution plot on this
 * desk where a reader can point at a mark and ask what it is, which is why every dot carries its
 * label — and it makes the layout, not the statistics, the thing that has to be got right.
 *
 * The dodge is deterministic, and deliberately so. The common alternative is jitter: give every
 * point a random offset and accept that some still overlap. Random offsets mean the card draws a
 * different picture every time it is replayed, and the desk swaps its main element and replays
 * every builder, so a reader would watch the swarm reshuffle for no reason. The algorithm here
 * is the exact "first free offset" sweep:
 *
 *   1. take the observations in order along the value axis;
 *   2. for each one, the already-placed neighbours within two radii along that axis forbid a
 *      band of offsets each — a circle of radius r at horizontal distance dx blocks everything
 *      within sqrt(4r^2 - dx^2) of its own offset;
 *   3. the candidate offsets are zero and the edges of those forbidden bands;
 *   4. take the candidate with the smallest magnitude that is actually free.
 *
 * That is a pure function of the sorted input, so the same data draws the same swarm forever.
 *
 * WHAT HAPPENS WHEN A COLUMN CANNOT FIT, since that is the interesting case and the one most
 * implementations quietly get wrong: a column of coincident values needs a lane 2r tall per pair
 * of dots, and a lane has a finite height. Three things happen in order, and all three are said
 * out loud in the caption.
 *
 *   1. The radius shrinks. The densest column is measured first, and r is scaled down until that
 *      column fits, to a floor of 0.6px — below which a dot stops being visible at all.
 *   2. If it still does not fit, the observations are THINNED, systematically: every k-th of the
 *      sorted sample, with k the smallest integer that makes the densest column fit. Thinning is
 *      the honest response, because the alternative is to draw dots on top of each other and call
 *      it a swarm.
 *   3. Anything that still finds no free offset — which the first two steps make rare rather than
 *      impossible — is clamped to the lane edge, drawn at half opacity, and counted. Nothing is
 *      ever silently dropped: the caption names every number.
 *
 * @see ./boxplot.mjs  the five-number sibling; its `points: all` mode is the cheap version of this
 * @see ./violin.mjs   the smoothed sibling, which refuses small samples rather than dodging them
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
 * @example loadKit().esc('a<b');   // 'a&lt;b'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/beeswarm: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/beeswarm: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;
const H0 = 360;
const WMAX = 2200;

/* The most observations this card will ship and draw. Every dot is an SVG element AND a line of
   the card's static markup, so this is a real budget rather than a payload one. It is also close
   to the physical limit: at a 3px radius a 640px lane 210px tall holds roughly 3,700 dots before
   they are touching everywhere, and past about half of that a swarm is a solid shape rather than
   a set of observations. Above the cap the sample is thinned systematically and the caption says
   by how much. */
const DRAW_CAP = 1800;

/* Below this radius a dot is not a dot. The auto-shrink stops here and the thinning takes over. */
const R_FLOOR = 0.6;

/* Per-dot tooltips stop being worth their weight somewhere around here: a thousand title
   elements is a thousand nodes for a hover nobody will land on. Past it the group tooltip
   carries the summary instead, and the caption says the labels are gone. */
const TIP_CAP = 600;

/* A label longer than this is cut. Labels ride in the payload once per observation, so a chatty
   labelling scheme is the difference between a 40KB card and a 400KB one. */
const LABEL_MAX = 60;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` cannot be referenced by it at all.
 */
export const defaults = {
  radius: 3,
  orient: 'horizontal',
  groupBy: true,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'beeswarm',
  summary: 'Every observation as one dodged dot, deterministically, with nothing hidden underneath.',
  shape: '{ points: [{ value, label, group }], unit, xLabel }',
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
  const where = who || 'cardkit/beeswarm';
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
 * A point is kept only when its `value` is a `number` and finite. That is stricter than
 * `Number(v)` on purpose: `Number('')` is 0, `Number(true)` is 1 and `Number([])` is 0, so a
 * coercing reader grows a spike of dots at zero out of blanks and booleans — and on this card
 * every dot is a claim that a specific labelled observation had that value. Everything refused
 * is counted and the count is named in the caption.
 *
 * Group order is first appearance, which is the order the author wrote them in and therefore the
 * order they meant. A point with no group joins a lane named for the whole sample.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ pts, groups, refused, xLabel, unit, allName }`
 *
 * @example readData({ points: [{ value: 1, group: 'a' }, { value: 'x' }] }).refused;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.points) ? d.points : [];
  const groups = [];
  const index = new Map();
  const pts = [];
  let refused = 0;

  for (const p of raw) {
    if (!p || typeof p !== 'object') { refused++; continue; }
    const v = p.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) { refused++; continue; }
    const gname = p.group == null || String(p.group) === '' ? '(ungrouped)' : String(p.group);
    if (!index.has(gname)) { index.set(gname, groups.length); groups.push(gname); }
    const label = p.label == null ? '' : String(p.label).slice(0, LABEL_MAX);
    pts.push({ v, l: label, g: index.get(gname) });
  }

  return {
    pts,
    groups,
    refused,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    unit: d.unit == null ? '' : String(d.unit),
    allName: d.xLabel == null || String(d.xLabel) === '' ? 'all' : String(d.xLabel),
  };
}

/**
 * Thin a list to at most `cap` entries by taking every k-th, keeping the last.
 *
 * Systematic rather than random, so the same data draws the same swarm twice, and applied to a
 * list already sorted by value so the kept subset has the same distribution as the whole. The
 * last entry is appended when the stride would miss it, because on a plot whose subject is the
 * individual observations the largest one is the one nobody will forgive you for dropping.
 *
 * @param list a list already ordered by value
 * @param cap  the most entries to keep; 0 or less keeps everything
 *
 * @example thin([1, 2, 3, 4, 5, 6, 7], 3);   // [1, 4, 7]
 */
function thin(list, cap) {
  if (!(cap > 0) || list.length <= cap) return list.slice();
  const k = Math.ceil(list.length / cap);
  const out = [];
  for (let i = 0; i < list.length; i += k) out.push(list[i]);
  if (out.length && out[out.length - 1] !== list[list.length - 1]) out.push(list[list.length - 1]);
  return out;
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything below runs in BOTH halves: Node calls it to draw the card that ships, and the
   browser calls the identical text after a settings change. ES5 only — `var` and `function`, no
   arrow functions, no template literals, no destructuring — and nothing but `CK` from outside. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite centre makes a circle vanish with nothing in the console, and on this card a
 * vanished circle is a lost observation rather than a cosmetic fault. Throwing makes it a build
 * failure beside the input that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/beeswarm: non-finite coordinate (' + v + ')');
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

/** The longest string in a list, or the empty string — used to decide how much room labels want. */
function longestOf(list) {
  var best = '', i;
  for (i = 0; i < list.length; i++) { if (list[i].length > best.length) { best = list[i]; } }
  return best;
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

/** A display-list circle. */
function mDot(cx, cy, r, attrs) {
  var a = { cx: fin(cx), cy: fin(cy), r: fin(r) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'circle', a: a };
}

/**
 * How tall the densest column of a lane would have to be, in pixels.
 *
 * Points sharing a value stack two radii apart, half above the lane centre and half below, so a
 * column of `c` dots needs `c * r` of half-height. This measures the worst column by sweeping
 * the ascending pixel positions with a window of one dot diameter — which is exactly the set of
 * points that can collide with each other along the value axis.
 *
 * @param pxs ascending pixel positions along the value axis
 * @param r   the dot radius in px
 * @returns the half-height the worst column needs
 *
 * @example needHalf([0, 0, 0], 3);   // 9
 */
function needHalf(pxs, r) {
  var worst = 0, start = 0, i;
  for (i = 0; i < pxs.length; i++) {
    while (start < i && pxs[i] - pxs[start] >= 2 * r) { start++; }
    if (i - start + 1 > worst) { worst = i - start + 1; }
  }
  return worst * r;
}

/**
 * The dodge: place every point at the first free offset from the lane centre.
 *
 * The exact sweep, not an approximation. Points are taken in ascending order along the value
 * axis; each already-placed neighbour within one diameter forbids a band of offsets, the
 * candidate offsets are zero and the edges of those bands, and the winner is the candidate of
 * smallest magnitude that collides with nothing. Ties in magnitude are broken toward the
 * positive side, which is arbitrary but fixed, so the swarm is a pure function of its input.
 *
 * A point with no free candidate inside the lane is clamped to the lane edge — alternating sides
 * so the pile-up is symmetric — and flagged. That is the only case in which two dots overlap,
 * and the caller counts and reports every one of them.
 *
 * @param pxs     ascending pixel positions along the value axis
 * @param r       the dot radius in px
 * @param maxHalf the furthest a dot centre may sit from the lane centre
 * @returns `{ off: [], over: [], overflow }` — one offset per point, a flag per point, and a count
 *
 * @example swarm([0, 0], 3, 20).off;   // [0, 6]
 */
function swarm(pxs, r, maxHalf) {
  var off = [], over = [], overflow = 0;
  var d2 = 4 * r * r, eps = 1e-7;
  var start = 0, i, j, k, dx, dy, cands, best, ok, side = 1;

  for (i = 0; i < pxs.length; i++) {
    while (start < i && pxs[i] - pxs[start] >= 2 * r) { start++; }

    cands = [0];
    for (j = start; j < i; j++) {
      dx = pxs[i] - pxs[j];
      if (dx >= 2 * r) { continue; }
      dy = Math.sqrt(Math.max(0, d2 - dx * dx));
      cands.push(off[j] + dy);
      cands.push(off[j] - dy);
    }
    /* Smallest magnitude first, positive before negative at equal magnitude. Sorting rather than
       scanning keeps the choice independent of the order the neighbours happen to be stored in. */
    cands.sort(function (a, b) {
      var m = Math.abs(a) - Math.abs(b);
      return m !== 0 ? m : b - a;
    });

    best = null;
    for (k = 0; k < cands.length; k++) {
      if (Math.abs(cands[k]) > maxHalf) { continue; }
      ok = true;
      for (j = start; j < i; j++) {
        dx = pxs[i] - pxs[j];
        dy = cands[k] - off[j];
        if (dx * dx + dy * dy < d2 - eps) { ok = false; break; }
      }
      if (ok) { best = cands[k]; break; }
    }

    if (best === null) {
      /* The lane is full at this value. The dot goes on the edge rather than off the card, and
         the caller says how many ended up there - a swarm that silently drops observations is
         not a swarm, it is a lie with good spacing. */
      best = side * maxHalf;
      side = -side;
      over.push(true);
      overflow++;
    } else {
      over.push(false);
    }
    off.push(best);
  }

  return { off: off, over: over, overflow: overflow };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the plot to anyone using one —
 * and on a card whose whole claim is "every observation is here", the label has to say how many
 * observations are actually here. The caption then names every departure from that claim: the
 * refusals, the thinning, the shrunk radius and the dots that had to sit on the lane edge.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param dom  the value domain actually drawn, as `{ lo, hi }`
 * @param fact what the layout had to do: `{ r, rAsked, drawn, overflow, stride, lanes, tips }`
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function bsNote(P, cfg, dom, fact) {
  var unit = P.unit ? ' ' + P.unit : '';

  if (!P.pts.length) {
    return {
      aria: 'Beeswarm with no data: ' + (P.refused
        ? P.refused + ' point' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left to place.'
        : 'nothing was supplied.'),
      caption: 'a beeswarm with <b>no data</b> - the axis is drawn so the card keeps its place. ' +
        (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' point' + (P.refused === 1 ? ' was' : 's were') +
                     ' refused</i> for not carrying a finite numeric value. ' : '') +
        'nothing is placed and nothing is implied.',
    };
  }

  var aria = 'Beeswarm of ' + fact.drawn + ' observation' + (fact.drawn === 1 ? '' : 's') +
    (fact.lanes > 1 ? ' in ' + fact.lanes + ' lanes' : ' in one lane') +
    (P.xLabel ? ', measuring ' + P.xLabel : '') + ', running ' +
    (cfg.orient === 'vertical' ? 'vertically' : 'horizontally') + ' from ' +
    CK.fmt(dom.lo) + ' to ' + CK.fmt(dom.hi) + unit + '. ' +
    'Each dot is one observation, dodged sideways only far enough to clear its neighbours, so a ' +
    'wide part of a lane is a value many observations share. ' +
    (fact.overflow ? fact.overflow + ' dot' + (fact.overflow === 1 ? '' : 's') +
                     ' could not be fitted and sit on the lane edge. ' : '') +
    (fact.stride > 1 ? 'Every ' + fact.stride + 'th observation is drawn; there are ' +
                       P.total + ' in all. ' : '');

  var doubts = [];
  doubts.push('the dodge is deterministic - first free offset from the centre, sweeping along the ' +
              'value axis - not jitter, so the same data draws the same swarm every time');
  if (fact.r < fact.rAsked) {
    doubts.push('the radius was shrunk from ' + CK.esc(CK.fmt(fact.rAsked)) + ' to <b>' +
                CK.esc(CK.fmt(fact.r)) + '</b>px so the densest column would fit its lane');
  }
  if (fact.stride > 1) {
    doubts.push('<i>' + CK.esc(String(P.total - fact.drawn)) + ' of ' + CK.esc(String(P.total)) +
                ' observations are not drawn</i> - every ' + CK.esc(String(fact.stride)) +
                'th of the value-sorted sample is, because the rest could not be dodged into the ' +
                'lane even at the smallest useful radius');
  }
  if (fact.overflow) {
    doubts.push('<i>' + CK.esc(String(fact.overflow)) + ' dot' + (fact.overflow === 1 ? '' : 's') +
                ' had no free offset</i> and sit on the lane edge at half opacity, overlapping - ' +
                'the only place on this card where two marks share a spot');
  }
  if (P.refused) {
    doubts.push('<i>' + CK.esc(String(P.refused)) + ' point' + (P.refused === 1 ? '' : 's') +
                ' refused</i> for not carrying a finite numeric value - counted, never silently dropped');
  }
  if (P.shipThinned) {
    doubts.push('the card ships at most ' + CK.esc(String(P.drawCap)) + ' observations; the rest ' +
                'were left behind at build time, again as every k-th of the sorted sample');
  }
  if (!fact.tips) {
    doubts.push('per-dot labels are off above ' + CK.esc(String(P.tipCap)) + ' dots - a thousand ' +
                'tooltips is a thousand nodes for a hover nobody lands on; the lane tooltip still works');
  }
  if (fact.lanes === 1 && P.groups.length > 1) {
    doubts.push('grouping is off, so ' + CK.esc(String(P.groups.length)) +
                ' groups share one lane and the colours are the only thing separating them');
  }

  var caption = '<b>' + CK.esc(String(fact.drawn)) + '</b> observation' + (fact.drawn === 1 ? '' : 's') +
    (fact.drawn !== P.total ? ' of <b>' + CK.esc(String(P.total)) + '</b>' : '') +
    (fact.lanes > 1 ? ' in <b>' + CK.esc(String(fact.lanes)) + '</b> lanes' : '') +
    ', dot radius <b>' + CK.esc(CK.fmt(fact.r)) + '</b>px. ' +
    '<span class="ck-aside">' + doubts.join('; ') + '.</span>';

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * All three settings change the layout and none of them change a statistic, which is unusual on
 * this desk and worth saying: a beeswarm has no estimator to disagree about. `radius` sets the
 * dot size and therefore how much room a column needs; `orient` swaps which screen axis carries
 * the values; `groupBy` decides whether the groups get a lane each or share one.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settled settings: `radius`, `orient`, `groupBy`
 * @returns `{ W, H, marks, note }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable points were refused and counted while reading
 *
 * @example bsRender(P, { radius: 3, orient: 'horizontal', groupBy: true }).marks.length;
 */
function bsRender(P, cfg) {
  var horiz = cfg.orient !== 'vertical';
  var byGroup = !!cfg.groupBy && P.groups.length > 0;
  var marks = [], i, j;

  var rAsked = Number(cfg.radius);
  if (!isFinite(rAsked) || !(rAsked > 0)) { rAsked = 3; }
  if (rAsked < P.rFloor) { rAsked = P.rFloor; }
  if (rAsked > 12) { rAsked = 12; }

  var laneNames = byGroup ? P.groups.slice() : [P.allName];

  /* The value domain is the drawn data, padded when every observation shares one value so the
     single column has an axis to stand on. */
  var lo = Infinity, hi = -Infinity;
  for (i = 0; i < P.pts.length; i++) {
    if (P.pts[i].v < lo) { lo = P.pts[i].v; }
    if (P.pts[i].v > hi) { hi = P.pts[i].v; }
  }
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) {
    var e = Math.abs(lo) * 0.5 || 0.5;
    lo -= e; hi += e;
  }

  var ax = axisTicks(lo, hi, horiz ? 6 : 5);
  var vLabels = [];
  for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }

  var footCap = P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit;
  var ng = laneNames.length;
  var nameW = 0;
  for (i = 0; i < laneNames.length; i++) { nameW = Math.min(140, Math.max(nameW, tw(laneNames[i]))); }

  var padT = 14, padR = 16, padB, padL, W, H, laneSize;
  if (horiz) {
    padB = 22 + (footCap ? 12 : 0);
    padL = Math.max(20, Math.round(nameW) + 12);
    laneSize = ng <= 1 ? 210 : Math.max(26, Math.min(120, 340 / ng));
    H = Math.round(padT + ng * laneSize + padB);
    W = P.W0;
  } else {
    padB = 22 + (nameW ? 12 : 0);
    padL = 0;
    for (i = 0; i < vLabels.length; i++) { padL = Math.max(padL, tw(vLabels[i])); }
    padL = Math.round(padL) + 12;
    laneSize = ng <= 1 ? 240 : Math.max(30, tw(clipTo(longestOf(laneNames), 90)) + 10);
    H = P.H0;
    W = Math.round(Math.min(P.wmax, Math.max(P.W0, padL + padR + ng * laneSize)));
  }

  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  var vS = horiz ? CK.scale([ax.lo, ax.hi], [plot.x0, plot.x1])
                 : CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);

  for (i = 0; i < ax.ticks.length; i++) {
    var vp = vS(ax.ticks[i]);
    if (horiz) {
      marks.push(mLine(vp, plot.y0, vp, plot.y1, 'ck-rule'));
      marks.push(mText(vp, plot.y1 + 13, vLabels[i], 'ck-tk', 'middle'));
    } else {
      marks.push(mLine(plot.x0, vp, plot.x1, vp, 'ck-rule'));
      marks.push(mText(plot.x0 - 6, vp + 3.2, vLabels[i], 'ck-tk', 'end'));
    }
  }
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));
  if (!horiz) { marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis')); }

  /* Split into lanes, keeping the value order the payload already has. The scale runs backwards
     for a vertical plot - a larger value is a smaller y - so the list is walked in reverse there
     to hand the dodge the ascending pixel positions it requires. */
  var lanes = [], back = !horiz;
  for (i = 0; i < ng; i++) { lanes.push([]); }
  for (i = 0; i < P.pts.length; i++) {
    j = back ? P.pts.length - 1 - i : i;
    lanes[byGroup ? P.pts[j].g : 0].push(P.pts[j]);
  }

  /* The radius is shrunk once, globally, so every lane keeps the same dot size - a card whose
     dots are bigger in the sparse lanes would be encoding density twice, once honestly and once
     by accident. */
  var laneHalf = laneSize / 2 - 2;
  var r = rAsked;
  var worst = 0;
  for (i = 0; i < ng; i++) {
    var pxsA = [];
    for (j = 0; j < lanes[i].length; j++) { pxsA.push(vS(lanes[i][j].v)); }
    var nd = needHalf(pxsA, rAsked);
    if (nd > worst) { worst = nd; }
  }
  if (worst > laneHalf - rAsked && worst > 0) {
    r = Math.max(P.rFloor, rAsked * (laneHalf - rAsked) / worst);
  }
  var maxHalf = Math.max(r, laneHalf - r);

  /* If the densest column still does not fit at the smallest useful radius, thin. Every k-th of
     the value-sorted lane is drawn and the caption says so; the alternative is to stack dots on
     top of each other and pretend the swarm is complete. */
  var stride = 1;
  worst = 0;
  for (i = 0; i < ng; i++) {
    var pxsB = [];
    for (j = 0; j < lanes[i].length; j++) { pxsB.push(vS(lanes[i][j].v)); }
    var nd2 = needHalf(pxsB, r);
    if (nd2 > worst) { worst = nd2; }
  }
  if (worst > maxHalf && maxHalf > 0) { stride = Math.ceil(worst / maxHalf); }
  if (stride > 1) {
    for (i = 0; i < ng; i++) {
      var kept = [];
      for (j = 0; j < lanes[i].length; j += stride) { kept.push(lanes[i][j]); }
      lanes[i] = kept;
    }
  }

  var drawn = 0, overflow = 0;
  for (i = 0; i < ng; i++) { drawn += lanes[i].length; }
  var tips = drawn <= P.tipCap;

  for (i = 0; i < ng; i++) {
    var lane = lanes[i];
    var c = horiz ? plot.y0 + (i + 0.5) * laneSize : plot.x0 + (i + 0.5) * laneSize;
    var kids = [];

    if (horiz) { marks.push(mText(plot.x0 - 6, c + 3.2, clipTo(laneNames[i], Math.max(20, padL - 10)), 'ck-tk', 'end')); }
    else if (nameW) { marks.push(mText(c, plot.y1 + 13, clipTo(laneNames[i], Math.max(16, laneSize - 2)), 'ck-tk', 'middle')); }

    var pxs = [];
    for (j = 0; j < lane.length; j++) { pxs.push(vS(lane[j].v)); }
    var laid = swarm(pxs, r, maxHalf);
    overflow += laid.overflow;

    for (j = 0; j < lane.length; j++) {
      var colour = CK.hue(byGroup ? i : lane[j].g);
      var dot = mDot(horiz ? pxs[j] : c + laid.off[j],
                     horiz ? c + laid.off[j] : pxs[j],
                     r,
                     { fill: colour, 'fill-opacity': laid.over[j] ? '0.5' : '0.85',
                       stroke: 'none', 'class': laid.over[j] ? 'ck-bee ck-over' : 'ck-bee' });
      if (tips) {
        dot.ti = (lane[j].l ? lane[j].l + '  \u00b7  ' : '') + CK.fmt(lane[j].v) +
                 (P.unit ? ' ' + P.unit : '') +
                 (byGroup || P.groups.length < 2 ? '' : '  \u00b7  ' + P.groups[lane[j].g]);
      }
      kids.push(dot);
    }

    var hit = horiz
      ? mRect(plot.x0, c - laneSize / 2, plot.x1 - plot.x0, laneSize,
              { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' })
      : mRect(c - laneSize / 2, plot.y0, laneSize, plot.y1 - plot.y0,
              { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    hit.ti = laneNames[i] + '  \u00b7  ' + lane.length + ' drawn' +
             (stride > 1 ? ' of ' + (lane.length * stride) : '') +
             (laid.overflow ? '  \u00b7  ' + laid.overflow + ' on the edge' : '');
    kids.push(hit);

    marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
  }

  if (footCap && horiz) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, footCap, 'ck-cap-ax', 'middle')); }
  if (footCap && !horiz) {
    var cy = (plot.y0 + plot.y1) / 2;
    marks.push(mText(10, cy, footCap, 'ck-cap-ax', 'middle',
                     { transform: 'rotate(-90 10 ' + fin(cy) + ')' }));
  }

  if (!P.pts.length) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  var fact = { r: r, rAsked: rAsked, drawn: drawn, overflow: overflow,
               stride: stride * P.shipStride, lanes: ng, tips: tips };
  return { W: W, H: H, marks: marks, note: bsNote(P, cfg, { lo: ax.lo, hi: ax.hi }, fact) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions above the browser needs, in dependency order. Shipped as their own source rather
   than restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, longestOf, axisTicks, mLine, mText, mRect, mDot,
                 needHalf, swarm, bsNote, bsRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block
 * early, and so that no point label can put an arrow function's two characters into a file that
 * is contractually free of them. Backticks go for the same reason; the two Unicode line
 * separators go because they are newlines to a JS parser and not to `JSON.stringify`.
 *
 * @example jsLit({ l: '</script>' });   // '{"l":"\\u003c/script\\u003e"}'
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
  const own = '.ck-beeswarm[data-card="' + id + '"]';
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
function cardCss(id, wide, W) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-bee', 'stroke: none;'],
    /* The dots that could not be dodged are marked in the drawing as well as in the caption: a
       reader looking at a pile-up on the lane edge should be able to see that it is one. */
    ['.ck-plot .ck-over', 'stroke: var(--ink-faint); stroke-width: .5;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);

  /* A plot too wide for the column keeps its width and scrolls inside `.ck-scroll`, so the desk
     column never widens and the page never grows a horizontal scrollbar of its own. */
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, P, seed) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const legend = P.groups.length > 1
    ? '\n  <div class="ck-legend">' +
      P.groups.map((g, i) =>
        '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g) + '</span>').join('') +
      '</div>'
    : '';

  return '<section data-card="' + CK.esc(id) + '" class="ck-beeswarm">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="beeswarm settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('radius') + '">dot radius</label>\n' +
    '    <input id="' + f('radius') + '" name="radius" type="number" min="0.6" max="12" step="0.5" ' +
           'value="' + CK.esc(defaults.radius) + '">\n' +
    '    <label for="' + f('orient') + '">orientation</label>\n' +
    '    <select id="' + f('orient') + '" name="orient">' +
         opt('horizontal', 'horizontal', defaults.orient) +
         opt('vertical', 'vertical', defaults.orient) + '</select>\n' +
    '    <label for="' + f('groupBy') + '">a lane per group</label>\n' +
    '    <input id="' + f('groupBy') + '" name="groupBy" type="checkbox"' +
           (defaults.groupBy ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">a bigger radius needs a taller lane for the same column of tied ' +
         'values; when one will not fit, the radius shrinks first, then the sample is thinned, and ' +
         'the caption says which happened.</p>\n' +
    '  </div>\n' +
    /* The picture ships drawn: a card whose plot only exists once a script has run is blank in a
       static render, and blank if one other card on the desk fails to parse. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg></div>' + legend + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped dodge, a display-list renderer, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardJs} before
 * it is returned.
 *
 * @param id       the card's id, used as its `CK.build` key
 * @param payload  the shipped observations and their group index
 * @param settings the defaults object `CK.settings` reconciles against
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, settings) {
  const src =
    '/* beeswarm card: the dodge below is the source that laid out the card that shipped, so a\n' +
    '   change of radius or orientation re-runs it rather than a second implementation of it.\n' +
    '   Nothing here is random; the same payload always produces the same swarm. */\n' +
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
    '     stays a translator rather than a second place where beeswarm decisions live. */\n' +
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
    '     a render that added marks would stack a second swarm on the first every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = bsRender(P, cfg), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    plot.style.minWidth = out.W > 640 ? out.W + "px" : "";\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so\n' +
    '       it may be assigned rather than parsed out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardJs(src, 'cardkit/beeswarm');
}

/**
 * Build one beeswarm card from one data block.
 *
 * The observations are sorted by value once, here, and shipped in that order — the dodge needs
 * them ordered along the value axis and sorting three thousand items on every settings change
 * would be work done repeatedly for an answer that cannot change.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data            an axis, no dots, captioned "no data"
 *   one observation    one dot at the lane centre; nothing to dodge against
 *   two identical      two dots, one radius above the centre and one below — the dodge's whole
 *                      job, at its smallest
 *   all values equal   ZERO SPREAD. There is no bin width, IQR or density here to divide by, so
 *                      nothing degenerates arithmetically: every dot lands in one column, the
 *                      radius shrinks until that column fits the lane, and if it still will not
 *                      fit the sample is thinned. The axis is padded by half the magnitude
 *                      either side so the single column has ticks to stand between
 *   a value that is
 *   NaN, null, a string refused, counted, and named in the caption; never coerced
 *   extreme outlier    the axis reaches it and the rest of the swarm crowds to one side, which
 *                      is what an outlier does to a plot with no summarisation in it
 *   negative values    nothing special; the axis simply spans them
 *   20 groups          twenty lanes; horizontal grows taller, vertical grows wider and scrolls
 *   n = 10,000         thinned to 1,800 at build time — every k-th of the value-sorted sample —
 *                      because every dot is an SVG element, and thinned again at render time if
 *                      the densest column still will not fit. Both strides are multiplied
 *                      together and reported as one number in the caption
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ points: [{ value, label, group }], unit, xLabel }` — see {@link meta}
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
 *   id: 'ttfb',
 *   title: 'time to first byte, by region',
 *   data: { xLabel: 'ttfb', unit: 'ms',
 *           points: [{ value: 88, label: 'lhr-1', group: 'eu' },
 *                    { value: 91, label: 'lhr-2', group: 'eu' },
 *                    { value: 140, label: 'iad-1', group: 'us' }] },
 *   ord: 60,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'beeswarm' : id);
  const read = readData(data);

  /* Sorted by value once, at build time. The dodge requires the order and it cannot change. */
  const sorted = read.pts.slice().sort((a, b) => a.v - b.v);
  const pts = thin(sorted, DRAW_CAP);
  const shipStride = pts.length && sorted.length > pts.length
    ? Math.ceil(sorted.length / DRAW_CAP)
    : 1;

  const P = {
    W0, H0, wmax: WMAX,
    rFloor: R_FLOOR,
    tipCap: TIP_CAP,
    drawCap: DRAW_CAP,
    unit: read.unit,
    xLabel: read.xLabel,
    allName: read.allName,
    refused: read.refused,
    total: sorted.length,
    shipThinned: sorted.length > pts.length,
    shipStride,
    groups: read.groups,
    pts,
  };

  const seed = bsRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      points: sorted.length,
      drawn: pts.length,
      groups: read.groups.length,
      refused: read.refused,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), P, seed),
    css: cardCss(cardId, seed.W > W0, seed.W),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
