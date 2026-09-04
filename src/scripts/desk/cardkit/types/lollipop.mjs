/**
 * `lollipop` - one stem and one dot per item, which is a bar chart with the fill taken away.
 *
 * A bar encodes its value twice: once as the position of its end, and once as the length of the
 * filled block behind it. The second copy is free at ten bars and expensive at a hundred, because
 * the blocks abut and the page becomes a solid field of ink in which the only information is the
 * ragged edge along the top. Everything else - every pixel between the baseline and the value - is
 * repetition. A lollipop keeps the edge and throws the field away: a hairline stem and a dot, so
 * neighbours stay separable at a density where bars have merged into one shape.
 *
 * That is the whole argument, and it comes with a debt. A bar chart is legible in any order because
 * the fill gives each bar a body; a lollipop unsorted is a scatter of dots that the eye has to hunt
 * through. So this card sorts by value unless told otherwise, and it says in the caption which order
 * it used - an unlabelled order is the one way a lollipop can silently mislead.
 *
 * The baseline is a datum, not a decoration. A stem runs from the baseline to the value, so a
 * baseline of zero and a baseline of the mean draw two different pictures of the same numbers, and
 * the accented rule on the card is which one was drawn.
 *
 * All geometry is computed in Node from the whole item list, and the functions that computed it are
 * shipped to the browser as their own source, so a settings change re-runs the very code that drew
 * the card rather than a second implementation of it.
 *
 * @see ./dotplot.mjs      the multi-series sibling, where the dots are the whole point
 * @see ./circularbar.mjs  the same data bent into a ring, and what that costs
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be imported.
 * A bare context carrying a `window` object is enough to run it, and nothing in it reaches for the
 * DOM until a function that needs one is called.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().scale([0, 10], [0, 100])(5);   // 50
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/lollipop: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/lollipop: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;
const H0 = 300;
const WMAX = 2200;

/* A horizontal lollipop grows downward, and the desk scrolls downward anyway, so height is nearly
   free - but not infinitely: past this the rows thin instead, because a card three screens tall is
   a card nobody reaches the bottom of. */
const HMAX = 2600;

const ROW = 18;        // px per row at a comfortable density, horizontal orientation
const LABEL_PX = 130;  // the most horizontal room a category label may take before it is clipped

/* Above this many items a bar chart's fills have abutted into one block. It is a judgement, not a
   measurement, and it is used only to decide whether the caption argues the case or states it. */
const DENSE = 40;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it. A binding declared after `meta` could not be referenced by it at all.
 *
 * `sort` defaults to `value` because an unsorted lollipop is the one arrangement in which this
 * chart is worse than the bar chart it replaces.
 */
export const defaults = {
  sort: 'value',
  orient: 'horizontal',
  dotSize: 7,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'lollipop',
  summary: 'A stem and a dot per item, sorted by value, where a bar chart would be a block of ink.',
  shape: '{ items: [{ label, value, group }], baseline, unit }',
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
 * Backtick, arrow and optional chaining are scanned raw: none of the three can appear innocently in
 * this file's output. `const`, `let` and `class` are scanned only after comment and string bodies
 * are blanked, because English prose contains all three words and a card was once refused for a
 * comment that said "the class is what CSS reads".
 *
 * @param src the emitted script
 * @param who a label for the error message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it checks
 * @throws {Error} naming the offending construct and its offset, with the surrounding text
 *
 * @example guardJs('var a = 1;');   // returns it unchanged
 */
export function guardJs(src, who) {
  const where = who || 'cardkit/lollipop';
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
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting what it
 * had to refuse.
 *
 * A value is kept only when it is a `number` and finite. That is stricter than `Number(v)` on
 * purpose: `Number('')` is 0, `Number(true)` is 1 and `Number([])` is 0, so a coercing reader
 * invents items sitting exactly on the baseline out of blanks and booleans - and an invented item
 * at the baseline looks like a real measurement of nothing rather than like an absence. Everything
 * refused is counted and the count is named in the caption.
 *
 * Negative values are NOT refused. A stem runs from the baseline, and a value below the baseline
 * has an honest picture: the stem runs the other way. This is the one chart in the ranking family
 * where that is true, which is worth knowing when choosing between them.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ items, groups, refused, dupLabels, baseline, unit }`
 *
 * @example readData({ items: [{ label: 'a', value: 3 }, { label: 'b', value: 'x' }] }).refused;  // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.items) ? d.items : [];

  const items = [];
  const groups = [];
  const groupAt = new Map();
  const seen = new Map();
  let refused = 0;
  let dupLabels = 0;

  raw.forEach((it, i) => {
    const row = it && typeof it === 'object' ? it : {};
    const value = row.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) { refused++; return; }

    const label = String(row.label != null ? row.label : 'item ' + (i + 1));
    let g = -1;
    if (row.group != null && String(row.group) !== '') {
      const name = String(row.group);
      if (!groupAt.has(name)) { groupAt.set(name, groups.length); groups.push(name); }
      g = groupAt.get(name);
    }

    /* Duplicate labels are kept as separate items rather than merged. Merging would be arithmetic
       the card was not asked to do, and two rows with one name is at least visibly odd. */
    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    if (count === 2) dupLabels++;

    items.push({ label, value, g, i: items.length, group: g >= 0 ? groups[g] : '' });
  });

  const baseline = typeof d.baseline === 'number' && Number.isFinite(d.baseline) ? d.baseline : 0;

  return {
    items, groups, refused, dupLabels, baseline,
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
 * A non-finite number in a path is silent: the browser drops the whole attribute and the card
 * renders empty with nothing in the console. Throwing makes it a build failure beside the input
 * that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/lollipop: non-finite coordinate (' + v + ')');
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

/** The longest string in a list, or the empty string - used to decide how much room labels want. */
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
 * the ticks are then stepped out rather than re-derived, because asking again with the wider range
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
 * Settle a settings object that may have come out of `localStorage`, which the viewer can edit.
 *
 * Every value is re-vetted against the same fallbacks the card was built with, which are shipped in
 * the payload rather than restated here - a second copy of the defaults is a copy that drifts. A
 * hand-edited `dotSize` of "big" would otherwise reach `fin` as a non-finite radius and take the
 * whole card down with an exception.
 *
 * @param cfg  whatever `CK.settings` handed back
 * @param dflt the payload's copy of {@link defaults}
 * @returns a settings object every field of which is safe to compute with
 *
 * @example llCfg({ dotSize: 'big' }, { sort: 'value', orient: 'horizontal', dotSize: 7 }).dotSize;  // 7
 */
function llCfg(cfg, dflt) {
  var c = cfg || {}, d = dflt || {};
  var sort = c.sort === 'given' || c.sort === 'value' || c.sort === 'label' ? c.sort : d.sort;
  var orient = c.orient === 'vertical' || c.orient === 'horizontal' ? c.orient : d.orient;
  var size = Number(c.dotSize);
  if (!isFinite(size)) { size = Number(d.dotSize); }
  if (!isFinite(size)) { size = 7; }
  if (size < 3) { size = 3; }
  if (size > 18) { size = 18; }
  return { sort: sort, orient: orient, dotSize: size };
}

/**
 * The item list in the order the card will draw it.
 *
 * Comparisons on labels use `<` rather than `localeCompare`, deliberately: `localeCompare` consults
 * the host's collation, so Node and the browser can disagree about the order of the same two strings
 * and the card would silently reorder itself the first time a setting was touched. A code-point sort
 * is the same everywhere, which is the property that matters more than being linguistically right.
 *
 * Every comparator falls back to the original index, so the sort is stable and two items with the
 * same value keep the order they were given rather than swapping between renders.
 *
 * @param items the payload's items, never mutated
 * @param sort  `given`, `value` (descending) or `label` (ascending)
 *
 * @example llOrder([{ value: 1, i: 0 }, { value: 9, i: 1 }], 'value')[0].value;   // 9
 */
function llOrder(items, sort) {
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
 * Place a value label where nothing else already is, or nowhere.
 *
 * Candidates are tried in order and the first whose box clears the bounds and every label already
 * down wins. A label that fits nowhere is simply not drawn: the number is still in the tooltip, and
 * a chart whose value labels overlap is less readable than one with none.
 *
 * @param taken  boxes already claimed, appended to in place
 * @param bounds the rectangle labels may occupy, which is wider than the plot on the value side
 * @param text   the label
 * @param cands  `[{ x, y, anchor }]` in order of preference
 * @returns the chosen candidate, or null
 *
 * @example fitLabel([], { x0: 0, y0: 0, x1: 100, y1: 50 }, '42', [{ x: 10, y: 10, anchor: 'start' }]);
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
 * `role="img"` hides the SVG's internals, so the aria label IS the chart to anyone using one:
 * "lollipop chart" names the genre and withholds the content, and is not an acceptable answer.
 *
 * The caption has the harder job. It has to name the ORDER, because a lollipop read in the wrong
 * assumed order is read wrongly and nothing on the picture gives the order away; it has to name the
 * BASELINE, because the stems are lengths from it; and it has to say what the chart bought by
 * throwing the fill away, since a reader who wanted a bar chart is owed the argument.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param ord  the ordered item list actually drawn
 * @param dom  the value domain drawn, as `{ lo, hi }`
 * @param drew counts the geometry settled: `{ clipped, thinned, onBase, below, values }`
 * @returns `{ aria, caption }` - plain text and escaped markup respectively
 */
function llNote(P, cfg, ord, dom, drew) {
  var n = ord.length, unit = P.unit ? ' ' + P.unit : '', i;

  if (!n) {
    return {
      aria: 'Lollipop chart with no items: ' + (P.refused
        ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as not being a finite number, and nothing was left to draw.'
        : 'nothing was supplied.'),
      caption: 'a lollipop chart with <b>no items</b> - the frame and the baseline are drawn so the ' +
        'card keeps its place. ' +
        (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                     ' refused</i> for not carrying a finite number. ' : '') +
        'nothing here is a ranking of anything.',
    };
  }

  var top = ord[0], bottom = ord[0];
  var sum = 0, absMax = 0, absList = [];
  for (i = 0; i < n; i++) {
    if (ord[i].value > top.value) { top = ord[i]; }
    if (ord[i].value < bottom.value) { bottom = ord[i]; }
    sum += ord[i].value;
    absList.push(Math.abs(ord[i].value - P.baseline));
    if (absList[i] > absMax) { absMax = absList[i]; }
  }
  var sorted = absList.slice();
  sorted.sort(function (a, b) { return a - b; });
  var median = sorted[Math.floor((sorted.length - 1) / 2)];

  var orderWord = cfg.sort === 'value' ? 'by value, largest first'
                : cfg.sort === 'label' ? 'by label, in code-point order'
                : 'in the order given';

  var aria = 'Lollipop chart of ' + n + ' item' + (n === 1 ? '' : 's') + ', drawn ' +
    (cfg.orient === 'horizontal' ? 'as rows' : 'as columns') + ' and sorted ' + orderWord + '. ' +
    'Each stem runs from a baseline of ' + CK.fmt(P.baseline) + unit + ' to the item value. ' +
    'Values run from ' + CK.fmt(bottom.value) + ' to ' + CK.fmt(top.value) + unit +
    ', on an axis from ' + CK.fmt(dom.lo) + ' to ' + CK.fmt(dom.hi) + '. ';
  for (i = 0; i < n && i < 10; i++) {
    aria += ord[i].label + ' ' + CK.fmt(ord[i].value) + unit + '. ';
  }
  if (n > 10) { aria += 'The remaining ' + (n - 10) + ' are in the tooltips. '; }

  var doubts = [];
  if (P.refused) {
    doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                ' refused</i> for not carrying a finite number - counted, never silently dropped');
  }
  if (drew.onBase) {
    doubts.push(CK.esc(String(drew.onBase)) + ' item' + (drew.onBase === 1 ? '' : 's') +
                ' sit' + (drew.onBase === 1 ? 's' : '') + ' exactly on the baseline, so the stem has ' +
                'no length at all and only the dot is drawn - which is why the dot is the mark and ' +
                'not the decoration');
  }
  if (drew.below) {
    doubts.push(CK.esc(String(drew.below)) + ' value' + (drew.below === 1 ? ' is' : 's are') +
                ' below the baseline; those stems run the other way from the accented rule, which a ' +
                'ring or a funnel of the same numbers could not have shown at all');
  }
  if (median > 0 && absMax > median * 20) {
    doubts.push('the largest stem is about ' + CK.esc(CK.fmt(absMax / median)) + ' times the median ' +
                'stem, so on a linear axis most of the chart is pressed against the baseline and the ' +
                'picture is really about one item');
  }
  if (P.dupLabels) {
    doubts.push(CK.esc(String(P.dupLabels)) + ' label' + (P.dupLabels === 1 ? '' : 's') +
                ' appear' + (P.dupLabels === 1 ? 's' : '') + ' more than once; equal labels are ' +
                'separate items in separate slots and were not merged, because merging is arithmetic ' +
                'nobody asked for');
  }
  if (drew.clipped) {
    doubts.push(CK.esc(String(drew.clipped)) + ' label' + (drew.clipped === 1 ? '' : 's') +
                ' had to be cut to fit, marked with an ellipsis; the whole text is in the tooltip');
  }
  if (drew.thinned) {
    doubts.push('there is not room for every name, so only every ' + CK.esc(String(drew.thinned)) +
                'th is printed - the stems are all still there, it is the text that would not fit');
  }
  if (drew.values < n) {
    doubts.push(CK.esc(String(n - drew.values)) + ' value label' + (n - drew.values === 1 ? '' : 's') +
                ' would have landed on another and ' + (n - drew.values === 1 ? 'was' : 'were') +
                ' dropped; every number is still in its tooltip');
  }

  var why = n >= P.dense
    ? 'at <b>' + CK.esc(String(n)) + '</b> items the bars of the same data would abut into one block ' +
      'and the fill would stop carrying information; the stems stay separable'
    : 'the stem carries the same length as a bar would in a fraction of the ink, so the dot - the ' +
      'end position, which is the part anyone actually reads - is what the eye lands on';

  var caption = '<b>' + CK.esc(String(n)) + '</b> item' + (n === 1 ? '' : 's') + ', sorted <i>' +
    CK.esc(orderWord) + '</i>, stems measured from a baseline of <b>' + CK.esc(CK.fmt(P.baseline)) +
    '</b>' + CK.esc(unit) + '. ' +
    'largest <b>' + CK.esc(top.label) + '</b> at ' + CK.esc(CK.fmt(top.value)) + CK.esc(unit) +
    (n > 1 ? ', smallest <b>' + CK.esc(bottom.label) + '</b> at ' + CK.esc(CK.fmt(bottom.value)) +
             CK.esc(unit) : '') + '. ' +
    why + '. ' +
    (cfg.sort === 'given'
      ? '<i>the order is the one the data arrived in, which is not a ranking</i> - a lollipop read as ' +
        'if it were sorted, when it is not, is read wrongly. '
      : '') +
    (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * One function rather than a geometry function and a caption function, because the caption quotes
 * numbers the geometry settled - how many labels were dropped, how many stems have no length - and
 * computing those twice is how a caption starts describing a picture that is no longer on the card.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settings, which may have come from `localStorage` and are re-vetted by {@link llCfg}
 * @returns `{ W, H, marks, note, cfg }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable values were refused and counted while reading
 *
 * @example llRender(P, { sort: 'value', orient: 'horizontal', dotSize: 7 }).marks.length;
 */
function llRender(P, cfg) {
  var c = llCfg(cfg, P.dflt);
  var horiz = c.orient === 'horizontal';
  var ord = llOrder(P.items, c.sort);
  var n = ord.length;
  var marks = [], i, it;

  /* The domain always contains the baseline: a stem is a length FROM it, so a baseline off the
     picture would draw stems whose start nobody can see. */
  var lo = P.baseline, hi = P.baseline;
  for (i = 0; i < n; i++) {
    if (ord[i].value < lo) { lo = ord[i].value; }
    if (ord[i].value > hi) { hi = ord[i].value; }
  }
  if (!(hi > lo)) {
    /* Every value equals the baseline, or there are no values: half the magnitude either side so
       the flat row of dots has somewhere to sit and the axis has ticks to label. */
    var e = Math.abs(hi) * 0.5 || 0.5;
    lo = lo - e; hi = hi + e;
  }

  var ax = axisTicks(lo, hi, 5);
  var vLabels = [], cLabels = [];
  for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }
  for (i = 0; i < n; i++) { cLabels.push(ord[i].label); }

  var leftTexts = horiz ? cLabels : vLabels;
  var leftW = 0;
  for (i = 0; i < leftTexts.length; i++) {
    leftW = Math.max(leftW, Math.min(P.labelPx, tw(leftTexts[i])));
  }

  var footCap = horiz ? P.unit : '';
  var sideCap = horiz ? '' : P.unit;

  var padT = 14;
  /* A horizontal chart writes its value labels past the last dot, so the right margin has to hold
     one; a vertical chart writes them above the dot, inside the plot. */
  var padR = horiz ? 42 : 16;
  var padB = 22 + (footCap ? 12 : 0);
  var padL = Math.round(leftW) + 12 + (sideCap ? 12 : 0);

  var W = P.W0, H = P.H0;
  if (horiz) {
    H = Math.max(180, Math.min(P.hmax, padT + padB + n * P.row));
  } else if (n) {
    var per = Math.max(14, tw(clipTo(longestOf(cLabels), 90)) + 6);
    W = Math.min(P.wmax, Math.max(P.W0, padL + padR + n * per));
  }

  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  var vS = horiz ? CK.scale([ax.lo, ax.hi], [plot.x0, plot.x1])
                 : CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
  var cA = horiz ? plot.y0 : plot.x0;
  var cB = horiz ? plot.y1 : plot.x1;
  var band = n ? (cB - cA) / n : cB - cA;

  /* When the slots are narrower than a line of text, print every k-th name instead of overprinting
     all of them. The stems all stay; it is only the text that could not fit. */
  var want = horiz ? 11 : tw(clipTo(longestOf(cLabels), 90)) + 4;
  var stride = band > 0 ? Math.max(1, Math.ceil(want / band)) : 1;

  /* Gridlines run across the value axis only. The category axis is a list of names, and a rule
     between two names implies an ordering of the gaps that does not exist. */
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
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  /* The baseline, at full strength. Every stem is a length from this line, so it is the one piece
     of furniture on the card that is part of the reading rather than part of the frame. */
  var bp = vS(P.baseline);
  if (horiz) { marks.push(mLine(bp, plot.y0, bp, plot.y1, 'ck-base')); }
  else { marks.push(mLine(plot.x0, bp, plot.x1, bp, 'ck-base')); }

  var taken = [];
  var bounds = { x0: plot.x0 - padL + 2, y0: 2, x1: W - 2, y1: H - 2 };
  var drew = { clipped: 0, thinned: stride > 1 ? stride : 0, onBase: 0, below: 0, values: 0 };
  var radius = Math.max(1.5, Math.min(c.dotSize / 2, band * 0.45));

  for (i = 0; i < n; i++) {
    it = ord[i];
    var colour = CK.hue(it.g >= 0 ? it.g : 0);
    var pos = cA + (i + 0.5) * band;
    var vv = vS(it.value);
    var kids = [];

    var full = it.label;
    var shown = horiz ? clipTo(full, P.labelPx) : clipTo(full, Math.max(16, band * stride - 2));
    if (shown !== full) { drew.clipped++; }
    if (i % stride === 0) {
      if (horiz) { marks.push(mText(plot.x0 - 6, pos + 3.2, shown, 'ck-tk', 'end')); }
      else { marks.push(mText(pos, plot.y1 + 13, shown, 'ck-tk', 'middle')); }
    }

    if (it.value === P.baseline) { drew.onBase++; }
    if (it.value < P.baseline) { drew.below++; }

    /* The stem. A zero-length stem is not drawn as a line at all - two coincident endpoints make an
       invisible element with a stroke cap sitting under the dot, which is a lie about there being
       something there. The dot alone says "this item is exactly at the baseline". */
    if (Math.abs(vv - bp) >= 0.5) {
      if (horiz) { kids.push(mLine(bp, pos, vv, pos, 'ck-stem')); }
      else { kids.push(mLine(pos, bp, pos, vv, 'ck-stem')); }
    }

    kids.push(mDot(horiz ? vv : pos, horiz ? pos : vv, radius,
                   { fill: colour, stroke: 'none', 'class': 'ck-pop' }));

    /* The value label goes on the far side of the dot from the baseline first - outward, where the
       stem is not - and falls back to the near side when the plot edge is in the way. Screen y runs
       downward, so "above the dot" is a subtraction and the two vertical candidates swap depending
       on which side of the baseline the item landed. */
    var txt = CK.fmt(it.value);
    var away = it.value >= P.baseline ? 1 : -1;
    var upY = vv - radius - 4;
    var dnY = vv + radius + 12;
    var cands = horiz
      ? [{ x: vv + away * (radius + 4), y: pos + 3.2, anchor: away > 0 ? 'start' : 'end' },
         { x: vv - away * (radius + 4), y: pos + 3.2, anchor: away > 0 ? 'end' : 'start' }]
      : away > 0
        ? [{ x: pos, y: upY, anchor: 'middle' }, { x: pos, y: dnY, anchor: 'middle' }]
        : [{ x: pos, y: dnY, anchor: 'middle' }, { x: pos, y: upY, anchor: 'middle' }];
    var spot = fitLabel(taken, bounds, txt, cands);
    if (spot) {
      marks.push(mText(spot.x, spot.y, txt, 'ck-val', spot.anchor));
      drew.values++;
    }

    /* One invisible fat target per item: a 3px dot is not a hit area, and the tooltip is where the
       exact value and the full label live when the picture had to abbreviate either. */
    var hit = horiz
      ? mRect(plot.x0, pos - band / 2, Math.max(1, plot.x1 - plot.x0), band,
              { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' })
      : mRect(pos - band / 2, plot.y0, band, Math.max(1, plot.y1 - plot.y0),
              { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    hit.ti = full + '  \u00b7  ' + CK.fmt(it.value) + (P.unit ? ' ' + P.unit : '') +
             (it.group ? '  \u00b7  ' + it.group : '') +
             '  \u00b7  ' + CK.fmt(it.value - P.baseline) + ' from the baseline';
    kids.push(hit);

    marks.push({ t: 'g', a: { 'data-item': String(i), 'class': 'ck-ser' }, kids: kids });
  }

  if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, footCap, 'ck-cap-ax', 'middle')); }
  if (sideCap) {
    var cy = (plot.y0 + plot.y1) / 2;
    marks.push(mText(10, cy, sideCap, 'ck-cap-ax', 'middle',
                     { transform: 'rotate(-90 10 ' + fin(cy) + ')' }));
  }
  if (!n) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no items', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, cfg: c,
           note: llNote(P, c, ord, { lo: ax.lo, hi: ax.hi }, drew) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions the browser needs, in dependency order. Shipped as their own source rather than
   restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, longestOf, axisTicks, mLine, mText, mRect, mDot,
                 llCfg, llOrder, fitLabel, llNote, llRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block early,
 * and so that no item label can put an arrow function's two characters into a file that is
 * contractually free of them. Backticks go for the same reason; the two Unicode line separators go
 * because they are newlines to a JS parser and not to `JSON.stringify`.
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
  const own = '.ck-lollipop[data-card="' + id + '"]';
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
 * that has to know anything, and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent - the desk is one document open in two viewers that
 * want different answers, and the OS gives both the same answer.
 */
function cardCss(id, wide, W, groups) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-val', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    /* The stem is furniture and the dot is the finding, so they are not the same weight. A stem
       heavy enough to read as a bar would give back exactly the ink this chart exists to save. */
    ['.ck-plot .ck-stem', 'stroke: var(--ink-faint); stroke-width: 1.2; fill: none;'],
    ['.ck-plot .ck-base', 'stroke: var(--ink-dim); stroke-width: 1.2; fill: none;'],
    ['.ck-plot .ck-pop', 'stroke: none;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    ['.ck-set input[type="number"]', 'width: 5.5em;'],
  ];

  if (groups) {
    rules.push(['.ck-legend i', 'width: 7px; height: 7px; display: block; border-radius: 50%;']);
    for (let i = 1; i <= 8; i++) {
      rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
    }
  }

  /* A plot too wide for the column keeps its width and scrolls inside `.ck-scroll`, so the desk
     column never widens and the page never grows a horizontal scrollbar of its own. */
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, groups) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const legend = groups.length > 1
    ? '\n  <div class="ck-legend">' +
      groups.map((g, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g) + '</span>').join('') +
      '</div>'
    : '';

  return '<section data-card="' + CK.esc(id) + '" class="ck-lollipop">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="lollipop settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('sort') + '">order</label>\n' +
    '    <select id="' + f('sort') + '" name="sort">' +
         opt('value', 'by value, largest first', defaults.sort) +
         opt('label', 'by label', defaults.sort) +
         opt('given', 'as given', defaults.sort) + '</select>\n' +
    '    <label for="' + f('orient') + '">orientation</label>\n' +
    '    <select id="' + f('orient') + '" name="orient">' +
         opt('horizontal', 'rows', defaults.orient) +
         opt('vertical', 'columns', defaults.orient) + '</select>\n' +
    '    <label for="' + f('dotSize') + '">dot size</label>\n' +
    '    <input id="' + f('dotSize') + '" name="dotSize" type="number" min="3" max="18" step="1" ' +
           'value="' + CK.esc(String(defaults.dotSize)) + '">\n' +
    '    <p class="ck-set-foot">the order is the whole readability of a lollipop: unsorted, the ' +
         'longest stem has to be hunted for rather than read off the end. The dot is capped by the ' +
         'row height, so asking for a bigger one on a crowded chart changes nothing.</p>\n' +
    '  </div>\n' +
    /* The picture ships drawn: a card whose plot only exists once a script has run is blank in a
       static render, and blank if one other card on the desk fails to parse. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
       '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg></div>' + legend + '\n' +
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
    '/* lollipop card: the order, the domain, the stems and every label position were computed in\n' +
    '   Node from the whole item list. The functions below are the ones that drew the card that\n' +
    '   shipped, emitted as their own source, so a settings change re-runs them rather than a\n' +
    '   second implementation of them. */\n' +
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
    '     stays a translator rather than a second place where lollipop decisions live. */\n' +
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
    '     render that added marks would stack a second set of stems on the first every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = llRender(P, cfg), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    plot.style.minWidth = out.W > P.W0 ? out.W + "px" : "";\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so it\n' +
    '       may be assigned rather than parsed back out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, P.dflt, render);\n' +
    '});\n';

  return guardJs(src, 'cardkit/lollipop');
}

/**
 * Build one lollipop card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no items           an empty frame with its baseline, captioned "no items"; nothing is invented
 *   one item           one stem and one dot; the domain collapses onto the baseline and is padded
 *   two equal values   two stems of the same length, in the order given, since the sort is stable
 *   all values equal   the axis has no spread, so it is padded by half the magnitude either side
 *   every value zero   with a baseline of zero every stem has no length; the dots are drawn on the
 *                      baseline and the caption says so, because a row of dots on a rule is a
 *                      legitimate reading and should not look like a rendering fault
 *   a negative value   drawn, running the other way from the baseline; a lollipop is the one chart
 *                      in this family whose geometry can express one, and the caption says how many
 *   a non-numeric      refused and counted, never coerced: `Number('')` is 0, and an invented item
 *                      at the baseline would look like a measurement of nothing
 *   200 items          rows thin to the height cap, names print every k-th, every stem still drawn
 *   a very long label  clipped with an ellipsis, counted, and the whole text kept in the tooltip
 *   1000x a neighbour  drawn on a linear axis, with the ratio to the median named in the caption
 *   duplicate labels   kept as separate items in separate slots, counted, and named
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ items: [{ label, value, group }], baseline, unit }` - see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` - `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused and counted
 *
 * @example
 * build({
 *   id: 'stars',
 *   title: 'stars by repository',
 *   data: { unit: 'stars', baseline: 0,
 *           items: [{ label: 'jssm', value: 412 }, { label: 'fsl', value: 96 }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'lollipop' : id);
  const read = readData(data);

  const P = {
    W0, H0, wmax: WMAX, hmax: HMAX, row: ROW, labelPx: LABEL_PX, dense: DENSE,
    unit: read.unit,
    baseline: read.baseline,
    refused: read.refused,
    dupLabels: read.dupLabels,
    items: read.items,
    dflt: { ...defaults },
  };

  const seed = llRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      items: read.items.length,
      refused: read.refused,
      baseline: read.baseline,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, read.groups),
    css: cardCss(cardId, seed.W > W0, seed.W, read.groups.length > 1),
    js: cardJs(cardId, P),
  };
}

export default { meta, build };
