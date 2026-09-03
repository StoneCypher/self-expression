/**
 * `circularbar` - a bar chart bent into concentric rings, and an honest account of what that costs.
 *
 * Each item gets a ring at its own radius, and its value becomes a sweep angle from a common start
 * at twelve o'clock. It is a handsome chart and it is a biased one, in a way that no amount of
 * styling removes, so this card states the bias on its own face rather than leaving a reader to
 * discover it.
 *
 * **The bias.** The mark a reader actually compares is the coloured band, and the length of that
 * band is the arc length, which is radius times angle. In the default `radial` mode every ring
 * shares one angular scale, so two items with the same value sweep the same angle - and the outer
 * one draws a band physically longer, in proportion to its radius. On a card whose outermost ring
 * is three times the radius of its innermost, the same number is drawn three times as long on the
 * outside. Nothing about the picture warns you; the angles are honest and the lengths are not, and
 * length is what the eye reads.
 *
 * **The correction, and its price.** `scale: 'area'` sets each ring's angle to k * value / radius,
 * with k chosen so the widest sweep still fits the arc. Arc length - and, for rings of equal
 * thickness, the swept ink area - then comes out exactly proportional to the value. The price is
 * that the angles no longer share a scale: two rings at the same angle are no longer at the same
 * value, so the one reading a circular chart makes easy has been traded away for the one it makes
 * hard. There is no third option where both are true. That is the honest summary of this chart, and
 * it is why the caption points at `lollipop` and `dotplot`, which have neither problem.
 *
 * **The one real lever.** Raising the inner radius compresses the range of radii, so the ratio
 * between the outermost and innermost arc length falls toward one. That is what a donut hole is
 * actually for on a chart like this, and it is why `innerRadius` is a setting rather than a style.
 *
 * All geometry is computed in Node and the functions that computed it are shipped to the browser as
 * their own source, so a settings change re-runs the code that drew the card.
 *
 * @see ./lollipop.mjs  the same data on a straight axis, with no radius bias at all
 * @see ./pie.mjs       the other circular chart, whose problem is angle rather than radius
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
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
  catch (e) { throw new Error('cardkit/circularbar: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/circularbar: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

/* The start angle: twelve o'clock, sweeping clockwise. In SVG coordinates y grows downward, so the
   top of the circle is -pi/2 and a positive angular step is clockwise. Fixed rather than settable -
   a reader comparing two of these cards needs them to start in the same place. */
const START = -Math.PI / 2;

/* How far a full-value ring sweeps. Short of a whole turn on purpose: an arc that closes on its own
   start is indistinguishable from an arc of zero, and the gap is what tells a reader which end is
   which. 300 degrees leaves an unmistakable notch at the top. */
const SWEEP = Math.PI * 2 * (300 / 360);

const RMIN = 120;       // the smallest circle worth drawing
const RMAX = 360;       // past this the card is taller than the desk column is useful
const PITCH = 14;       // the radial room one ring would like, in px
const GAP = 3;          // radial gap between neighbouring rings, in px
const LABEL_PX = 150;   // the most horizontal room a ring label may take before it is clipped

/* Below this ring thickness two neighbouring rings cannot be told apart, which is where a circular
   bar chart stops working. Named so the caption can quote it rather than imply it. */
const THIN_PX = 3;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it. `scale` defaults to `radial` because that is the chart people mean when they ask for this
 * chart, and a card that silently drew the corrected version would be answering a question nobody
 * asked - the caption names the bias either way.
 */
export const defaults = {
  scale: 'radial',
  innerRadius: 0.35,
  sort: 'value',
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'circularbar',
  summary: 'Concentric rings whose sweep is the value, with the radius bias stated and correctable.',
  shape: '{ items: [{ label, value, group }], unit }',
  category: 'ranking-and-comparison',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const` and `let` false-positives on English prose, and a guard that
 * cries wolf is a guard somebody switches off. Regex literals are recognised, because otherwise the
 * scanner desynchronises on a quote inside a character class and starts blanking real code, which
 * turns a false positive into a far worse false negative.
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
 * Every card's `js` is concatenated into ONE inline block, so a single modern-syntax token - or a
 * backtick inside a comment, which `Function.prototype.toString()` ships verbatim - is a parse error
 * that blanks every card on the page rather than just this one.
 *
 * `const`, `let` and `class` are scanned only after comment and string bodies are blanked, because
 * English prose contains all three words; backtick, arrow and optional chaining are scanned raw,
 * since none of the three can appear innocently in this file's output.
 *
 * @param src the emitted script
 * @param who a label for the error message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it checks
 * @throws {Error} naming the offending construct and its offset, with the surrounding text
 *
 * @example guardJs('var a = 1;');   // returns it unchanged
 */
export function guardJs(src, who) {
  const where = who || 'cardkit/circularbar';
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
 * Normalise whatever arrived, counting separately the two different reasons a value is refused.
 *
 * A value is kept only when it is a finite `number` that is not negative, and the two refusals are
 * counted apart because they mean different things. A non-numeric entry is bad data. A NEGATIVE
 * entry is good data this geometry cannot express: a sweep angle has no sign, so a negative would
 * either run backwards - reading as a large positive to anyone who did not check which way the arc
 * went - or be silently clamped to nothing. Both are worse than refusing it and saying so, which is
 * itself an argument for using `lollipop` when the data has a below-baseline side.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ items, groups, refused, negatives, dupLabels, unit }`
 *
 * @example readData({ items: [{ label: 'a', value: -1 }] }).negatives;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.items) ? d.items : [];

  const items = [];
  const groups = [];
  const groupAt = new Map();
  const seen = new Map();
  let refused = 0;
  let negatives = 0;
  let dupLabels = 0;

  raw.forEach((it, i) => {
    const row = it && typeof it === 'object' ? it : {};
    const value = row.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) { refused++; return; }
    if (value < 0) { negatives++; return; }

    const label = String(row.label != null ? row.label : 'item ' + (i + 1));
    let g = -1;
    if (row.group != null && String(row.group) !== '') {
      const name = String(row.group);
      if (!groupAt.has(name)) { groupAt.set(name, groups.length); groups.push(name); }
      g = groupAt.get(name);
    }

    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    if (count === 2) dupLabels++;

    items.push({ label, value, g, i: items.length, group: g >= 0 ? groups[g] : '' });
  });

  return {
    items, groups, refused, negatives, dupLabels,
    unit: d.unit == null ? '' : String(d.unit),
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything below runs in BOTH halves: Node calls it to draw the card that ships, and the browser
   calls the identical text after a settings change. ES5 only - `var` and `function`, no arrow
   functions, no template literals, no destructuring - and nothing from outside but `CK`. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole `d` attribute and the ring
 * renders as nothing at all, with nothing in the console. Throwing turns that into a build failure
 * beside the input that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/circularbar: non-finite coordinate (' + v + ')');
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

/** The longest string in a list, or the empty string. */
function longestOf(list) {
  var best = '', i;
  for (i = 0; i < list.length; i++) { if (list[i].length > best.length) { best = list[i]; } }
  return best;
}

/** A display-list text run; the sixth argument carries anything unusual, such as a rotation. */
function mText(x, y, s, cls, anchor, extra) {
  var a = { x: fin(x), y: fin(y), 'class': cls || '' }, k;
  if (anchor) { a['text-anchor'] = anchor; }
  if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { a[k] = extra[k]; } } }
  return { t: 'text', a: a, s: String(s) };
}

/** A display-list path; the caller owns the shape because only the caller knows it. */
function mPath(d, attrs) {
  var a = { d: d }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'path', a: a };
}

/**
 * One circular arc as an SVG path, drawn as a stroke rather than filled.
 *
 * A stroked arc is the right primitive here and a filled annulus sector is not: the ring's
 * thickness is then one attribute rather than four more coordinates, the same path serves as the
 * track, the value and the invisible hit area at three different stroke widths, and there is no
 * seam where an inner and an outer arc were meant to meet.
 *
 * The large-arc flag is set from the swept angle rather than guessed, because an arc past half a
 * turn drawn with the flag clear silently renders as its own complement - the short way round -
 * which looks like a small value and is the single most common way a radial chart lies by accident.
 *
 * @param cx centre x
 * @param cy centre y
 * @param r  the radius the arc is drawn at, in px, strictly positive
 * @param a0 the start angle in radians, 0 at three o'clock, growing clockwise in screen space
 * @param a1 the end angle in radians, greater than or equal to `a0`
 * @returns an SVG path `d`
 *
 * @example arcPath(100, 100, 50, -Math.PI / 2, 0).charAt(0);   // 'M'
 */
function arcPath(cx, cy, r, a0, a1) {
  var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  var large = (a1 - a0) > Math.PI ? 1 : 0;
  return 'M' + fin(x0) + ' ' + fin(y0) +
         'A' + fin(r) + ' ' + fin(r) + ' 0 ' + large + ' 1 ' + fin(x1) + ' ' + fin(y1);
}

/**
 * Settle a settings object that may have come out of `localStorage`, which the viewer can edit.
 *
 * Every value is re-vetted against the fallbacks shipped in the payload rather than against a second
 * copy of them written here. A hand-edited `innerRadius` of 1 would put every ring at the same
 * radius as the outermost and divide by zero on the way; one of "0.9" would leave no room for the
 * rings at all. The clamp is 0.05 to 0.85, which is the range in which this chart is a chart.
 *
 * @param cfg  whatever `CK.settings` handed back
 * @param dflt the payload's copy of {@link defaults}
 * @returns a settings object every field of which is safe to compute with
 *
 * @example cbCfg({ innerRadius: 3 }, { scale: 'radial', innerRadius: 0.35, sort: 'value' }).innerRadius;  // 0.85
 */
function cbCfg(cfg, dflt) {
  var c = cfg || {}, d = dflt || {};
  var mode = c.scale === 'radial' || c.scale === 'area' ? c.scale : d.scale;
  var sort = c.sort === 'given' || c.sort === 'value' || c.sort === 'label' ? c.sort : d.sort;
  var inner = Number(c.innerRadius);
  if (!isFinite(inner)) { inner = Number(d.innerRadius); }
  if (!isFinite(inner)) { inner = 0.35; }
  if (inner < 0.05) { inner = 0.05; }
  if (inner > 0.85) { inner = 0.85; }
  return { scale: mode, innerRadius: inner, sort: sort };
}

/**
 * The item list in the order the card will draw it, outermost ring first.
 *
 * Comparisons on labels use `<` rather than `localeCompare`, deliberately: `localeCompare` consults
 * the host's collation, so Node and the browser can disagree about the order of two strings and the
 * card would reorder itself the first time a setting was touched. Every comparator falls back to the
 * original index, so the sort is stable.
 *
 * @param items the payload's items, never mutated
 * @param sort  `given`, `value` (descending) or `label` (ascending)
 *
 * @example cbOrder([{ value: 1, i: 0 }, { value: 9, i: 1 }], 'value')[0].value;   // 9
 */
function cbOrder(items, sort) {
  var out = items.slice();
  if (sort === 'value') {
    out.sort(function (a, b) { return b.value - a.value || a.i - b.i; });
  } else if (sort === 'label') {
    out.sort(function (a, b) {
      var c = a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
      return c || a.i - b.i;
    });
  }
  return out;
}

/**
 * The ring geometry: a radius and a sweep angle per item, under whichever scale is in force.
 *
 * This is where the whole argument of the card lives, so the two modes are written side by side.
 *
 * `radial` gives every ring the same angular scale, so `theta` is proportional to `value` and arc
 * length - radius times theta - is proportional to `value * radius`. Two equal values on different
 * rings therefore draw bands of different length, in exactly the ratio of their radii.
 *
 * `area` solves `radius * theta` proportional to `value` instead, by setting theta to k * value /
 * radius. `k` is chosen from the ring with the largest `value / radius` so that the widest sweep
 * lands exactly on the full arc and nothing overruns. Arc length, and the swept ink of a ring of
 * fixed thickness, are then proportional to the value - and the angles are not comparable any more,
 * which is the trade rather than a bug.
 *
 * @param ord    the ordered items, outermost first
 * @param rOuter the radius of the outermost ring's centre line, in px
 * @param band   the radial pitch between neighbouring ring centre lines, in px
 * @param mode   `radial` or `area`
 * @param sweep  the angle a full-value ring sweeps, in radians
 * @returns `[{ r, theta, value, label, g, group }]`, one per item in draw order
 *
 * @example cbRings([{ value: 10, label: 'a', i: 0 }], 100, 14, 'radial', 5).length;   // 1
 */
function cbRings(ord, rOuter, band, mode, sweep) {
  var n = ord.length, i, r, rings = [];
  var vmax = 0, ratioMax = 0;

  for (i = 0; i < n; i++) {
    r = Math.max(1, rOuter - i * band);
    if (ord[i].value > vmax) { vmax = ord[i].value; }
    if (ord[i].value / r > ratioMax) { ratioMax = ord[i].value / r; }
    rings.push({ r: r, theta: 0, value: ord[i].value, label: ord[i].label,
                 g: ord[i].g, group: ord[i].group });
  }

  /* Every value is zero, or there are none: no arc has any length, and the tracks alone say that
     the slots exist and are empty. Dividing by the maximum here would be dividing by zero. */
  var k = mode === 'area'
    ? (ratioMax > 0 ? sweep / ratioMax : 0)
    : (vmax > 0 ? sweep / vmax : 0);

  for (i = 0; i < n; i++) {
    rings[i].theta = mode === 'area' ? k * rings[i].value / rings[i].r : k * rings[i].value;
  }
  return rings;
}

/**
 * Place a value label where nothing else already is, or nowhere.
 *
 * Candidates are tried in order and the first whose box clears the bounds and every label already
 * down wins. Ring labels are registered before value labels, so a name never loses its place to a
 * number. A label that fits nowhere is not drawn: the value is still in the tooltip, and numbers
 * printed over each other are worse than no numbers.
 *
 * @param taken  boxes already claimed, appended to in place
 * @param bounds the rectangle labels may occupy
 * @param text   the label
 * @param cands  `[{ x, y, anchor }]` in order of preference
 * @returns the chosen candidate, or null
 *
 * @example fitLabel([], { x0: 0, y0: 0, x1: 99, y1: 50 }, '42', [{ x: 9, y: 9, anchor: 'start' }]);
 */
function fitLabel(taken, bounds, text, cands) {
  var w = tw(text), i, j, c, left, box, clash, b;
  for (i = 0; i < cands.length; i++) {
    c = cands[i];
    left = c.anchor === 'middle' ? c.x - w / 2 : c.anchor === 'end' ? c.x - w : c.x;
    box = { x0: left - 1.5, y0: c.y - 8.5, x1: left + w + 1.5, y1: c.y + 2.5 };
    if (box.x0 < bounds.x0 || box.x1 > bounds.x1) { continue; }
    if (box.y0 < bounds.y0 || box.y1 > bounds.y1) { continue; }
    clash = false;
    for (j = 0; j < taken.length; j++) {
      b = taken[j];
      if (box.x1 <= b.x0 || box.x0 >= b.x1 || box.y1 <= b.y0 || box.y0 >= b.y1) { continue; }
      clash = true;
      break;
    }
    if (clash) { continue; }
    taken.push(box);
    return c;
  }
  return null;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the chart to anyone using one. For
 * this chart the label has an extra duty: someone who cannot see the rings cannot see that the outer
 * ones are longer, so the bias has to be in the words rather than only in the picture.
 *
 * The caption states the bias unconditionally. It is not a footnote about an edge case - it applies
 * to every circular bar chart that has ever been drawn, including this one, and a card that only
 * mentioned it when it was severe would be a card that taught readers to trust the mild ones.
 *
 * @param P     the shipped payload
 * @param cfg   the settled settings
 * @param rings the ring geometry actually drawn
 * @param drew  what the geometry settled: `{ band, thickness, clipped, stride, values, zeros }`
 * @returns `{ aria, caption }` - plain text and escaped markup respectively
 */
function cbNote(P, cfg, rings, drew) {
  var n = rings.length, unit = P.unit ? ' ' + P.unit : '', i;
  var refusals = [];
  if (P.refused) {
    refusals.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                  ' refused</i> for not carrying a finite number');
  }
  if (P.negatives) {
    refusals.push('<i>' + CK.esc(String(P.negatives)) + ' negative value' +
                  (P.negatives === 1 ? '' : 's') + ' refused</i> - a sweep angle has no sign, so a ' +
                  'negative would either run backwards and read as a large positive or be clamped ' +
                  'to nothing; a lollipop can draw one and this cannot');
  }

  if (!n) {
    return {
      aria: 'Circular bar chart with no rings: ' +
        (P.refused + P.negatives
          ? P.refused + ' entries were not finite numbers and ' + P.negatives +
            ' were negative, which this geometry cannot express, so nothing was left to draw.'
          : 'nothing was supplied.'),
      caption: 'a circular bar chart with <b>no rings</b> - the frame is drawn so the card keeps ' +
        'its place. ' + (refusals.length ? refusals.join('; ') + '. ' : '') +
        'nothing here is a comparison of anything.',
    };
  }

  var top = rings[0], bottom = rings[0], vmax = 0;
  for (i = 0; i < n; i++) {
    if (rings[i].value > top.value) { top = rings[i]; }
    if (rings[i].value < bottom.value) { bottom = rings[i]; }
    if (rings[i].value > vmax) { vmax = rings[i].value; }
  }

  /* The bias, as a number this card can actually quote: the ratio of the outermost ring's radius to
     the innermost's IS the ratio of arc lengths for two equal values in radial mode. */
  var rOut = rings[0].r, rIn = rings[n - 1].r;
  for (i = 0; i < n; i++) {
    if (rings[i].r > rOut) { rOut = rings[i].r; }
    if (rings[i].r < rIn) { rIn = rings[i].r; }
  }
  var bias = rIn > 0 ? rOut / rIn : 1;

  var orderWord = cfg.sort === 'value' ? 'by value, largest on the outside'
                : cfg.sort === 'label' ? 'by label, in code-point order, from the outside in'
                : 'in the order given, from the outside in';

  var aria = 'Circular bar chart of ' + n + ' ring' + (n === 1 ? '' : 's') + ', ordered ' +
    orderWord + '. Each ring sweeps clockwise from twelve o clock; a full sweep is ' +
    CK.fmt(vmax) + unit + '. ' +
    (cfg.scale === 'area'
      ? 'Angles are corrected so that arc length is proportional to value, which means two rings at ' +
        'the same angle are not at the same value. '
      : 'All rings share one angular scale, so an outer ring draws a band about ' + CK.fmt(bias) +
        ' times longer than an inner one for the same value. ') +
    'Values run from ' + CK.fmt(bottom.value) + ' to ' + CK.fmt(top.value) + unit + '. ';
  for (i = 0; i < n && i < 10; i++) {
    aria += rings[i].label + ' ' + CK.fmt(rings[i].value) + unit + '. ';
  }
  if (n > 10) { aria += 'The remaining ' + (n - 10) + ' are in the tooltips. '; }

  /* The bias sentence, which is the reason this card exists in the form it does. */
  var lie = cfg.scale === 'area'
    ? 'angles here are <i>corrected</i>: each ring sweeps k times value over radius, so the arc ' +
      'length - and the ink of the band - is proportional to the value. the price is that the ' +
      'angles no longer share a scale, so <b>you cannot read a value off the angle</b>; only the ' +
      'length of the band means anything'
    : 'every ring shares one angular scale, which sounds fair and is not: the mark a reader ' +
      'compares is the <i>length</i> of the band, and length is radius times angle. the outermost ' +
      'ring draws <b>' + CK.esc(CK.fmt(bias)) + 'x</b> the band of the innermost for the same ' +
      'number' + (n === 1 ? ', which is invisible here because there is only one ring - it appears ' +
      'the moment there are two' : '') + '. switch <i>scale</i> to area to trade that away for ' +
      'angles that no longer compare';

  var doubts = [];
  for (i = 0; i < refusals.length; i++) { doubts.push(refusals[i]); }
  if (cfg.scale === 'radial' && cfg.sort === 'value') {
    doubts.push('sorting by value puts the largest number on the ring where an angle buys the most ' +
                'ink, so the sort and the bias push the same way');
  }
  doubts.push('raising the inner radius is the only lever that shrinks the bias - it compresses the ' +
              'range of radii, and at ' + CK.esc(CK.fmt(cfg.innerRadius)) + ' the outer-to-inner ' +
              'ratio is ' + CK.esc(CK.fmt(bias)) + 'x; a lollipop or a dot plot has no such ratio at all');
  if (drew.zeros) {
    doubts.push(CK.esc(String(drew.zeros)) + ' value' + (drew.zeros === 1 ? ' is' : 's are') +
                ' zero and so draw no arc at all - the faint full-length track behind each ring is ' +
                'what distinguishes a zero from an item that is not here');
  }
  if (drew.thickness < P.thinPx) {
    doubts.push('the rings are ' + CK.esc(CK.fmt(drew.thickness)) + 'px thick, below the ' +
                CK.esc(String(P.thinPx)) + 'px at which one ring stops being distinguishable from ' +
                'its neighbour; this is where the circular form gives out and a straight one does not');
  }
  if (P.dupLabels) {
    doubts.push(CK.esc(String(P.dupLabels)) + ' label' + (P.dupLabels === 1 ? '' : 's') +
                ' appear' + (P.dupLabels === 1 ? 's' : '') + ' more than once; equal labels are ' +
                'separate rings and were not merged');
  }
  if (drew.clipped) {
    doubts.push(CK.esc(String(drew.clipped)) + ' name' + (drew.clipped === 1 ? '' : 's') +
                ' had to be cut to fit, marked with an ellipsis; the whole text is in the tooltip');
  }
  if (drew.stride > 1) {
    doubts.push('there is not room for every name, so only every ' + CK.esc(String(drew.stride)) +
                'th is printed - every ring is still drawn');
  }
  if (!drew.values && n) {
    doubts.push('the rings are too close together to print numbers between them, so the values are ' +
                'in the tooltips only');
  }

  var caption = '<b>' + CK.esc(String(n)) + '</b> ring' + (n === 1 ? '' : 's') + ', ordered <i>' +
    CK.esc(orderWord) + '</i>, each sweeping clockwise from twelve o&#39;clock; a full arc is <b>' +
    CK.esc(CK.fmt(vmax)) + '</b>' + CK.esc(unit) + '. ' +
    'largest <b>' + CK.esc(top.label) + '</b> at ' + CK.esc(CK.fmt(top.value)) + CK.esc(unit) +
    (n > 1 ? ', smallest <b>' + CK.esc(bottom.label) + '</b> at ' + CK.esc(CK.fmt(bottom.value)) +
             CK.esc(unit) : '') + '. ' +
    lie + '. ' +
    (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * The ring geometry is returned alongside the display list rather than only baked into it, because
 * the one thing worth testing about this card is arithmetic - that `radial` really does share an
 * angular scale and `area` really does deliver proportional arc lengths - and a test that had to
 * parse path data back into angles would be testing its own parser.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settings, which may have come from `localStorage` and are re-vetted by {@link cbCfg}
 * @returns `{ W, H, marks, note, cfg, rings }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable values were refused and counted while reading
 *
 * @example cbRender(P, { scale: 'radial', innerRadius: 0.35, sort: 'value' }).rings.length;
 */
function cbRender(P, cfg) {
  var c = cbCfg(cfg, P.dflt);
  var ord = cbOrder(P.items, c.sort);
  var n = ord.length;
  var marks = [], i;

  /* The radius the rings would like, and the radius they may have. A ring wants PITCH px of radial
     room; n of them want n * PITCH inside the band between the inner radius and the outer one. Past
     RMAX the circle stops growing and the rings thin instead, which the caption reports. */
  var want = (1 - c.innerRadius) > 0 ? n * P.pitch / (1 - c.innerRadius) : P.rmax;
  var R = Math.max(P.rmin, Math.min(P.rmax, want));
  var band = n ? R * (1 - c.innerRadius) / n : 0;
  /* The centre line of the outermost ring sits half a band inside the outer edge, so the band's
     outer half has somewhere to be drawn. */
  var rOuter = R - band / 2;
  var thickness = n ? Math.max(0.8, band - Math.min(P.gap, band * 0.4)) : 0;

  var cLabels = [];
  for (i = 0; i < n; i++) { cLabels.push(ord[i].label); }
  var labelW = Math.min(P.labelPx, tw(clipTo(longestOf(cLabels), P.labelPx)));

  /* The centre sits far enough right that the longest ring name, written leftward from just inside
     twelve o'clock, still starts on the card. */
  var cx = Math.max(R + 6, labelW + 12);
  var cy = 20 + R;
  var W = Math.round(cx + R + 34);
  var H = Math.round(2 * R + 40);

  var rings = cbRings(ord, rOuter, band, c.scale, P.sweep);

  var taken = [];
  var bounds = { x0: 2, y0: 2, x1: W - 2, y1: H - 2 };
  var stride = band > 0 ? Math.max(1, Math.ceil(11 / band)) : 1;
  var drew = { band: band, thickness: thickness, clipped: 0, stride: stride, values: 0, zeros: 0 };

  for (i = 0; i < n; i++) {
    var ring = rings[i];
    var colour = CK.hue(ring.g >= 0 ? ring.g : i);
    var kids = [];

    /* The track: the whole sweep a full value would take, drawn faint. It is what makes a zero
       readable as a zero rather than as an absence, and it is the only thing on the card that shows
       what "full" means before you have read the caption. */
    var full = arcPath(cx, cy, ring.r, P.start, P.start + P.sweep);
    kids.push(mPath(full, { fill: 'none', 'stroke-width': fin(thickness), 'class': 'ck-track' }));

    if (ring.value === 0) { drew.zeros++; }
    if (ring.theta > 0) {
      kids.push(mPath(arcPath(cx, cy, ring.r, P.start, P.start + ring.theta),
                      { fill: 'none', stroke: colour, 'stroke-width': fin(thickness),
                        'stroke-linecap': 'butt', 'class': 'ck-arc' }));
    }

    /* The ring's name, written leftward from just inside its start. A halo in the ground colour is
       painted under it so that a nearly-full arc, whose tail comes round into the upper left, does
       not print through the text. */
    var shown = clipTo(ring.label, P.labelPx);
    if (i % stride === 0) {
      if (shown !== ring.label) { drew.clipped++; }
      var ly = cy - ring.r + 3.2;
      var lx = cx - 6;
      taken.push({ x0: lx - tw(shown) - 1.5, y0: ly - 8.5, x1: lx + 1.5, y1: ly + 2.5 });
      marks.push(mText(lx, ly, shown, 'ck-ring-lab', 'end'));
    }

    /* The value, just beyond the tip of its arc - only when the rings are far enough apart for a
       line of text to sit between two of them. Below that the numbers would land on each other's
       rings and mean nothing; the tooltip still has all of them. */
    if (band >= 9) {
      var a1 = P.start + ring.theta;
      var tipR = ring.r + thickness / 2 + 7;
      var tx = cx + tipR * Math.cos(a1);
      var ty = cy + tipR * Math.sin(a1) + 3.2;
      var anchor = Math.cos(a1) < -0.2 ? 'end' : Math.cos(a1) > 0.2 ? 'start' : 'middle';
      var spot = fitLabel(taken, bounds, CK.fmt(ring.value),
                          [{ x: tx, y: ty, anchor: anchor }]);
      if (spot) {
        marks.push(mText(spot.x, spot.y, CK.fmt(ring.value), 'ck-val', spot.anchor));
        drew.values++;
      }
    }

    /* One invisible fat target per ring: a sub-pixel stroke is not a hit area, and the tooltip is
       where the exact value and the full name live when the picture had to abbreviate either. */
    var hit = mPath(full, { fill: 'none', stroke: 'none', 'stroke-width': fin(Math.max(thickness, 10)),
                            'pointer-events': 'stroke', 'class': 'ck-hit' });
    hit.ti = ring.label + '  \u00b7  ' + CK.fmt(ring.value) + (P.unit ? ' ' + P.unit : '') +
             (ring.group ? '  \u00b7  ' + ring.group : '') +
             '  \u00b7  radius ' + CK.fmt(ring.r) + 'px, sweep ' +
             CK.fmt(ring.theta * 180 / Math.PI) + ' degrees';
    kids.push(hit);

    marks.push({ t: 'g', a: { 'data-item': String(i), 'class': 'ck-ser' }, kids: kids });
  }

  /* The start line, running from just outside the outermost ring to just inside the innermost:
     every arc begins on it, and without it a reader has to infer where the angles are measured
     from - which is the difference between reading a sweep and guessing at one. */
  if (n) {
    var rInner = Math.max(1, rOuter - (n - 1) * band);
    marks.push({ t: 'line', a: { x1: fin(cx), y1: fin(cy - R - 6), x2: fin(cx),
                                 y2: fin(cy - rInner + band / 2 + 2),
                                 'class': 'ck-start' } });
  } else {
    marks.push(mText(cx, cy, 'no rings', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, cfg: c, rings: rings,
           note: cbNote(P, c, rings, drew) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions the browser needs, in dependency order. Shipped as their own source rather than
   restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, longestOf, mText, mPath, arcPath, cbCfg, cbOrder, cbRings,
                 fitLabel, cbNote, cbRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block early,
 * and so that no label can put an arrow function's two characters into a file that is contractually
 * free of them. Backticks go for the same reason; the two Unicode line separators go because they
 * are newlines to a JS parser and not to `JSON.stringify`.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
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
  const own = '.ck-circularbar[data-card="' + id + '"]';
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
 * Nothing here names a colour: every value is a desk token, so the light switch is the only thing
 * that has to know anything. `prefers-color-scheme` is deliberately absent - the desk is one
 * document open in two viewers that want different answers, and the OS gives both the same answer.
 */
function cardCss(id, wide, W) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-val', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    /* The track is the slot a value could have filled, so it has to be visible enough to read as a
       slot and faint enough never to be mistaken for a value. */
    ['.ck-plot .ck-track', 'stroke: var(--ck-grid); fill: none;'],
    ['.ck-plot .ck-arc', 'fill: none;'],
    ['.ck-plot .ck-start', 'stroke: var(--rule); stroke-width: 1; fill: none;'],
    ['.ck-plot .ck-hit', 'fill: none;'],
    /* A halo in the ground colour under each ring name, so the tail of a nearly-full arc - which
       comes round into the upper left, where the names are - cannot print through the text. */
    ['.ck-plot .ck-ring-lab',
     'fill: var(--ink-faint); paint-order: stroke; stroke: var(--ground); stroke-width: 3px; ' +
     'stroke-linejoin: round;'],
    ['.ck-set input[type="number"]', 'width: 5.5em;'],
  ];

  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-circularbar">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="circular bar settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('scale') + '">scale</label>\n' +
    '    <select id="' + f('scale') + '" name="scale">' +
         opt('radial', 'radial: angle is the value', defaults.scale) +
         opt('area', 'area: arc length is the value', defaults.scale) + '</select>\n' +
    '    <label for="' + f('innerRadius') + '">inner radius</label>\n' +
    '    <input id="' + f('innerRadius') + '" name="innerRadius" type="number" min="0.05" max="0.85" ' +
           'step="0.05" value="' + CK.esc(String(defaults.innerRadius)) + '">\n' +
    '    <label for="' + f('sort') + '">order</label>\n' +
    '    <select id="' + f('sort') + '" name="sort">' +
         opt('value', 'by value, largest outside', defaults.sort) +
         opt('label', 'by label', defaults.sort) +
         opt('given', 'as given', defaults.sort) + '</select>\n' +
    '    <p class="ck-set-foot">radial mode gives every ring one angular scale, which makes outer ' +
         'rings draw longer bands for the same value; area mode makes the band length proportional ' +
         'instead, and gives up comparable angles to do it. A larger inner radius is the only ' +
         'setting that reduces the bias rather than moving it.</p>\n' +
    '  </div>\n' +
    /* The picture ships drawn: a card whose plot only exists once a script has run is blank in a
       static render, and blank if one other card on the desk fails to parse. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg></div>\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped geometry, a display-list renderer, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardJs} before it
 * is returned.
 *
 * @param id      the card's id, used as its `CK.build` key
 * @param payload the shipped items and the constants the geometry needs
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload) {
  const src =
    '/* circular bar card: the ring radii, the sweep angles and every label position were computed\n' +
    '   in Node. The functions below are the ones that drew the card that shipped, emitted as their\n' +
    '   own source, so switching between the two scales re-runs the code the caption describes\n' +
    '   rather than a second implementation of it. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where ring decisions live. */\n' +
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
    '  /* A repaint, not an append: the desk swaps its main element and replays every builder, so a\n' +
    '     render that added marks would stack a second set of rings on the first every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = cbRender(P, cfg), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    plot.style.minWidth = out.W > 640 ? out.W + "px" : "";\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so it\n' +
    '       may be assigned rather than parsed back out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, P.dflt, render);\n' +
    '});\n';

  return guardJs(src, 'cardkit/circularbar');
}

/**
 * Build one circular bar card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no items           an empty frame captioned "no rings"; nothing is invented
 *   one item           one ring. The bias is real but unobservable with a single radius, and the
 *                      caption says exactly that rather than quoting a ratio of one as reassurance
 *   two equal values   two rings at the same angle and visibly different band lengths, which is the
 *                      clearest demonstration of the bias this card can offer
 *   all values equal   every ring at the full sweep in radial mode; in area mode the inner rings
 *                      sweep further, which is what the correction looks like
 *   every value zero   no arcs at all, only tracks; the caption says the tracks are what tell a
 *                      zero from an absence
 *   a negative value   refused and counted, because a sweep has no sign - a backwards arc reads as
 *                      a large positive. Named in the caption, with lollipop as the alternative
 *   a non-numeric      refused and counted, never coerced
 *   200 items          rings thin below the readable threshold; every ring is still drawn, the names
 *                      print every k-th, and the caption names the thickness and the threshold
 *   a very long label  clipped with an ellipsis, counted, and the whole text kept in the tooltip
 *   1000x a neighbour  the small values become slivers of arc; the tracks still show their slots
 *   duplicate labels   kept as separate rings, counted, and named
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ items: [{ label, value, group }], unit }` - see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused and counted
 *
 * @example
 * build({
 *   id: 'langs',
 *   title: 'lines by language',
 *   data: { unit: 'kloc',
 *           items: [{ label: 'typescript', value: 41 }, { label: 'css', value: 12 }] },
 *   ord: 35,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'circularbar' : id);
  const read = readData(data);

  const P = {
    start: START, sweep: SWEEP, rmin: RMIN, rmax: RMAX, pitch: PITCH, gap: GAP,
    labelPx: LABEL_PX, thinPx: THIN_PX,
    unit: read.unit,
    refused: read.refused,
    negatives: read.negatives,
    dupLabels: read.dupLabels,
    items: read.items,
    dflt: { ...defaults },
  };

  const seed = cbRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      items: read.items.length,
      refused: read.refused,
      negatives: read.negatives,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed),
    css: cardCss(cardId, seed.W > 640, seed.W),
    js: cardJs(cardId, P),
  };
}

export default { meta, build };
