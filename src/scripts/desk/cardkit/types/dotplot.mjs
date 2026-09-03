/**
 * `dotplot` - one row per item, one dot per series, on a single shared axis.
 *
 * This is the most accurate chart in the ranking family, and the reason is not taste. Cleveland and
 * McGill ranked the elementary perceptual tasks a chart can ask of a reader, and position along a
 * common scale came first - ahead of length, ahead of angle, and a long way ahead of area. A dot
 * plot asks for that task and nothing else: every dot on the card is measured against the same axis,
 * so comparing any two of them is the one judgement people make well.
 *
 * The alternatives convert that judgement into a worse one. A grouped bar chart turns each value
 * into a length from a shared baseline, and then makes you compare two lengths that start in
 * different places. A slope chart turns the change into an angle, which reads as steeper or shallower
 * depending on how tall the card happens to be. A circular bar turns it into an arc whose length
 * depends on its radius. The dot plot leaves it as a position, which is the whole argument.
 *
 * With two series the connector makes it a dumbbell, and the gap between the dots becomes a length
 * you can scan down the column without re-finding the axis each time. With more than two the
 * connector stops meaning a transition and becomes a range - the caption says which, because a line
 * between dots implies an ordering, and implying one that is not in the data is the single way this
 * chart can mislead.
 *
 * All geometry is computed in Node and the functions that computed it are shipped to the browser as
 * their own source, so a settings change re-runs the code that drew the card.
 *
 * @see ./lollipop.mjs  the single-series sibling, where the stem is a length from a baseline
 * @see ./slope.mjs     the same two-state comparison as an angle, and what that costs
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().fmt(1200);   // '1.2k'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/dotplot: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/dotplot: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;
const H0 = 300;
const HMAX = 2600;      // past this the rows thin instead of the card growing further
const ROW = 20;         // px per row at a comfortable density
const LABEL_PX = 150;   // the most horizontal room an item label may take before it is clipped

/* Below this row height a line of text cannot sit between two rows, so the value labels are dropped
   wholesale rather than printed on top of one another. Named so the caption can say so. */
const TEXT_ROW = 12;

/* The palette wraps after eight, so past this many series two of them share a colour and the legend
   is the only thing telling them apart. Named so the caption can warn rather than let it happen. */
const HUES = 8;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it. `sort` defaults to the first series rather than to the given order, because a dot plot read as
 * a ranking when it is not sorted is read wrongly, and the first series is the one a reader treats
 * as the reference by default anyway.
 */
export const defaults = {
  connect: true,
  sort: 'first',
  dotSize: 7,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'dotplot',
  summary: 'One row per item and one dot per series on a shared axis, joined into dumbbells.',
  shape: '{ items: [{ label, values: { seriesName: n } }], series, unit }',
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
  const where = who || 'cardkit/dotplot';
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
 * Decide which series exist, and in what order.
 *
 * When `data.series` is supplied it is definitive: it names the series to draw, in the order to draw
 * them, and any other key in an item's `values` is ignored and counted. That matters because the
 * FIRST series is the reference the default sort uses and the left end of every dumbbell, so leaving
 * the order to whichever item happened to be first in the file would let a reordering of the input
 * silently reverse the meaning of the chart.
 *
 * With no `series` given, the order is first appearance across the items, which is the order the
 * author wrote them in and therefore the order they meant.
 *
 * @param d   the data block
 * @param raw the item array
 * @returns `{ names, fixed }` - the series in draw order, and whether the caller supplied them
 *
 * @example seriesOf({ series: ['before', 'after'] }, []).names;   // ['before', 'after']
 */
function seriesOf(d, raw) {
  const names = [];
  const at = new Set();

  if (Array.isArray(d.series) && d.series.length) {
    for (const s of d.series) {
      const name = String(s);
      if (!at.has(name)) { at.add(name); names.push(name); }
    }
    return { names, fixed: true };
  }

  for (const it of raw) {
    const vals = it && typeof it === 'object' && it.values && typeof it.values === 'object'
      ? it.values : {};
    for (const k of Object.keys(vals)) if (!at.has(k)) { at.add(k); names.push(k); }
  }
  return { names, fixed: false };
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting what it
 * had to refuse and what was simply not there.
 *
 * Refused and missing are counted apart because they mean different things. A key that is present
 * but is not a finite number is bad data. A key that is absent is a measurement nobody took, and a
 * dot plot can show that honestly by drawing one fewer dot in that row - which is why nothing here
 * substitutes a zero. `Number('')` is 0 and `Number([])` is 0, so a coercing reader would place a
 * dot at the origin for every blank cell, and a row of invented origins looks like a finding.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ items, series, fixedSeries, refused, missing, ignored, dupLabels, empties, unit }`
 *
 * @example readData({ items: [{ label: 'a', values: { x: 1 } }] }).series;   // ['x']
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.items) ? d.items : [];
  const { names, fixed } = seriesOf(d, raw);

  const items = [];
  const seen = new Map();
  let refused = 0;
  let missing = 0;
  let ignored = 0;
  let dupLabels = 0;
  let empties = 0;

  raw.forEach((it, i) => {
    const row = it && typeof it === 'object' ? it : {};
    const vals = row.values && typeof row.values === 'object' ? row.values : {};
    const label = String(row.label != null ? row.label : 'item ' + (i + 1));

    if (fixed) {
      for (const k of Object.keys(vals)) if (!names.includes(k)) ignored++;
    }

    const values = [];
    let present = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const name of names) {
      if (!Object.hasOwn(vals, name)) { values.push(null); missing++; continue; }
      const v = vals[name];
      if (typeof v !== 'number' || !Number.isFinite(v)) { values.push(null); refused++; continue; }
      values.push(v);
      present++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }

    if (!present) empties++;

    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    if (count === 2) dupLabels++;

    items.push({
      label,
      values,
      present,
      /* Both sort keys are settled here, once, from data that no setting can change. Recomputing
         them in the comparator would be recomputing them n log n times for the same answer. */
      first: values.length && values[0] != null ? values[0] : null,
      gap: present > 1 ? hi - lo : 0,
      lo: present ? lo : 0,
      hi: present ? hi : 0,
      i: items.length,
    });
  });

  return {
    items, series: names, fixedSeries: fixed,
    refused, missing, ignored, dupLabels, empties,
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
 * A non-finite number in a coordinate is silent: the browser drops the attribute and the dot renders
 * nowhere, with nothing in the console. Throwing turns that into a build failure beside the input
 * that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/dotplot: non-finite coordinate (' + v + ')');
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
 * Every value is re-vetted against the fallbacks shipped in the payload rather than against a second
 * copy of them written here. A hand-edited `dotSize` of "large" would otherwise arrive at `fin` as a
 * non-finite radius and take the card down with an exception.
 *
 * @param cfg  whatever `CK.settings` handed back
 * @param dflt the payload's copy of {@link defaults}
 * @returns a settings object every field of which is safe to compute with
 *
 * @example dpCfg({ dotSize: 'large' }, { connect: true, sort: 'first', dotSize: 7 }).dotSize;   // 7
 */
function dpCfg(cfg, dflt) {
  var c = cfg || {}, d = dflt || {};
  var sort = c.sort === 'given' || c.sort === 'first' || c.sort === 'gap' ? c.sort : d.sort;
  var size = Number(c.dotSize);
  if (!isFinite(size)) { size = Number(d.dotSize); }
  if (!isFinite(size)) { size = 7; }
  if (size < 3) { size = 3; }
  if (size > 18) { size = 18; }
  return { connect: c.connect == null ? !!d.connect : !!c.connect, sort: sort, dotSize: size };
}

/**
 * The item list in the order the card will draw it, top row first.
 *
 * `first` sorts descending by the first series, which is the reference a reader treats as the
 * before; items that have no value for it sort to the bottom rather than to an invented zero, since
 * a missing measurement is not a small one. `gap` sorts descending by the spread within the row,
 * which is the arrangement that makes a dumbbell chart answer "where did the most change happen"
 * at a glance instead of by hunting.
 *
 * Every comparator falls back to the original index, so the sort is stable and equal keys keep the
 * order they were given rather than swapping between renders.
 *
 * @param items the payload's items, never mutated
 * @param sort  `given`, `first` or `gap`
 *
 * @example dpOrder([{ first: 1, i: 0 }, { first: 9, i: 1 }], 'first')[0].first;   // 9
 */
function dpOrder(items, sort) {
  var out = items.slice();
  if (sort === 'first') {
    out.sort(function (a, b) {
      var ah = a.first !== null && a.first !== undefined;
      var bh = b.first !== null && b.first !== undefined;
      if (ah !== bh) { return ah ? -1 : 1; }
      if (!ah) { return a.i - b.i; }
      return b.first - a.first || a.i - b.i;
    });
  } else if (sort === 'gap') {
    out.sort(function (a, b) { return b.gap - a.gap || a.i - b.i; });
  }
  return out;
}

/**
 * Place a value label where nothing else already is, or nowhere.
 *
 * Candidates are tried in order and the first whose box clears the bounds and every label already
 * down wins. A label that fits nowhere is not drawn: the number is still in the tooltip, and numbers
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
 * `role="img"` hides the SVG's internals, so the aria label IS the chart to anyone using one. The
 * caption's duties here are the order, what the connector means for THIS number of series, and the
 * encoding argument - because a reader who was expecting bars is owed the reason they did not get
 * any, and "dots are cleaner" is not a reason.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param ord  the ordered item list actually drawn
 * @param dom  the value domain drawn, as `{ lo, hi }`
 * @param drew what the geometry settled: `{ clipped, stride, values, coincide, band }`
 * @returns `{ aria, caption }` - plain text and escaped markup respectively
 */
function dpNote(P, cfg, ord, dom, drew) {
  var n = ord.length, ns = P.series.length, unit = P.unit ? ' ' + P.unit : '', i;

  if (!n || !ns) {
    return {
      aria: 'Dot plot with nothing to draw: ' +
        (!ns ? 'no series were named and none could be found in the items.'
             : 'no items were supplied.'),
      caption: 'a dot plot with <b>nothing to draw</b> - the frame is drawn so the card keeps its ' +
        'place. ' + (!ns ? 'no series could be found: an item carries its numbers in a ' +
        '<i>values</i> object keyed by series name. ' : '') +
        (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' value' + (P.refused === 1 ? '' : 's') +
                     ' refused</i> for not being a finite number. ' : '') +
        'nothing here is a comparison of anything.',
    };
  }

  var orderWord = cfg.sort === 'first'
      ? 'by ' + P.series[0] + ', largest first'
    : cfg.sort === 'gap' ? 'by the spread within each row, widest first'
    : 'in the order given';

  var widest = null, tightest = null, live = 0;
  for (i = 0; i < n; i++) {
    if (ord[i].present < 2) { continue; }
    live++;
    if (!widest || ord[i].gap > widest.gap) { widest = ord[i]; }
    if (!tightest || ord[i].gap < tightest.gap) { tightest = ord[i]; }
  }

  var aria = 'Dot plot of ' + n + ' item' + (n === 1 ? '' : 's') + ' and ' + ns + ' series (' +
    P.series.join(', ') + '), one row per item, ordered ' + orderWord + '. ' +
    'Every dot is measured against one axis running from ' + CK.fmt(dom.lo) + ' to ' +
    CK.fmt(dom.hi) + unit + '. ';
  for (i = 0; i < n && i < 8; i++) {
    aria += ord[i].label + ': ';
    var parts = [];
    for (var j = 0; j < ns; j++) {
      parts.push(P.series[j] + ' ' + (ord[i].values[j] == null ? 'not given' : CK.fmt(ord[i].values[j])));
    }
    aria += parts.join(', ') + '. ';
  }
  if (n > 8) { aria += 'The remaining ' + (n - 8) + ' rows are in the tooltips. '; }

  /* What the connector claims. With two series it is a change; with more it is only a range, and a
     line implies an ordering, so saying which one is on the card is not optional. */
  var joinWord = !cfg.connect ? 'the dots are not joined, so each row is read as a set of positions'
    : ns === 2 ? 'the connector is the <i>change</i> between ' + CK.esc(P.series[0]) + ' and ' +
                 CK.esc(P.series[1]) + ', and its length is the size of that change'
    : ns === 1 ? 'with one series there is nothing to join, so the connector draws nothing'
    : 'with <b>' + CK.esc(String(ns)) + '</b> series the connector is a <i>range</i> from the ' +
      'smallest to the largest in the row and implies no ordering between them - a line between ' +
      'dots reads as a transition, and there is none here to read';

  var doubts = [];
  if (P.refused) {
    doubts.push('<i>' + CK.esc(String(P.refused)) + ' value' + (P.refused === 1 ? '' : 's') +
                ' refused</i> for not being a finite number - counted, never coerced to zero');
  }
  if (P.missing) {
    doubts.push(CK.esc(String(P.missing)) + ' cell' + (P.missing === 1 ? ' was' : 's were') +
                ' simply absent, so those rows have fewer dots; a missing measurement is not a ' +
                'small one and nothing was substituted for it');
  }
  if (P.empties) {
    doubts.push(CK.esc(String(P.empties)) + ' row' + (P.empties === 1 ? ' has' : 's have') +
                ' no usable value at all and keep' + (P.empties === 1 ? 's' : '') +
                ' its place with no dots - dropping it would renumber every row below');
  }
  if (P.ignored) {
    doubts.push(CK.esc(String(P.ignored)) + ' value' + (P.ignored === 1 ? '' : 's') +
                ' named a series that the data block did not list, and ' +
                (P.ignored === 1 ? 'was' : 'were') + ' ignored rather than added to the legend');
  }
  if (drew.coincide) {
    doubts.push(CK.esc(String(drew.coincide)) + ' row' + (drew.coincide === 1 ? '' : 's') +
                ' have two or more dots at the same position, ringed so a stack is not mistaken for ' +
                'a single dot; the gap there is genuinely zero');
  }
  if (ns > P.hues) {
    doubts.push('there are more series than the ' + CK.esc(String(P.hues)) + ' palette colours, so ' +
                'two of them share a hue and only the legend order tells them apart');
  }
  if (P.dupLabels) {
    doubts.push(CK.esc(String(P.dupLabels)) + ' label' + (P.dupLabels === 1 ? '' : 's') +
                ' appear' + (P.dupLabels === 1 ? 's' : '') + ' more than once; equal labels are ' +
                'separate rows and were not merged');
  }
  if (drew.clipped) {
    doubts.push(CK.esc(String(drew.clipped)) + ' label' + (drew.clipped === 1 ? '' : 's') +
                ' had to be cut to fit, marked with an ellipsis; the whole text is in the tooltip');
  }
  if (drew.stride > 1) {
    doubts.push('there is not room for every name, so only every ' + CK.esc(String(drew.stride)) +
                'th is printed - every dot is still drawn');
  }
  if (drew.band < P.textRow) {
    doubts.push('the rows are under ' + CK.esc(String(P.textRow)) + 'px apart, so no value labels ' +
                'are printed at all; every number is in its tooltip');
  }

  var caption = '<b>' + CK.esc(String(n)) + '</b> row' + (n === 1 ? '' : 's') + ' and <b>' +
    CK.esc(String(ns)) + '</b> series, ordered <i>' + CK.esc(orderWord) + '</i>. ' +
    'every dot is a <i>position on one shared axis</i>, which is the comparison people judge most ' +
    'accurately - more accurately than a length from a baseline, and far more than an angle or an ' +
    'area. ' + joinWord + '. ' +
    (live > 1 && widest
      ? 'widest row <b>' + CK.esc(widest.label) + '</b> at ' + CK.esc(CK.fmt(widest.gap)) +
        CK.esc(unit) + ', tightest <b>' + CK.esc(tightest.label) + '</b> at ' +
        CK.esc(CK.fmt(tightest.gap)) + CK.esc(unit) + '. '
      : '') +
    (cfg.sort === 'given'
      ? '<i>the order is the one the data arrived in, which is not a ranking.</i> '
      : '') +
    (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * One function rather than a geometry function and a caption function, because the caption quotes
 * numbers the geometry settled - how many rows have coincident dots, whether there was room for any
 * value labels - and computing those twice is how a caption starts describing a picture that is no
 * longer on the card.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settings, which may have come from `localStorage` and are re-vetted by {@link dpCfg}
 * @returns `{ W, H, marks, note, cfg, rows }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable values were refused and counted while reading
 *
 * @example dpRender(P, { connect: true, sort: 'first', dotSize: 7 }).marks.length;
 */
function dpRender(P, cfg) {
  var c = dpCfg(cfg, P.dflt);
  var ord = dpOrder(P.items, c.sort);
  var n = ord.length, ns = P.series.length;
  var marks = [], i, j;

  var lo = Infinity, hi = -Infinity;
  for (i = 0; i < n; i++) {
    for (j = 0; j < ns; j++) {
      var v = ord[i].values[j];
      if (v == null) { continue; }
      if (v < lo) { lo = v; }
      if (v > hi) { hi = v; }
    }
  }
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) {
    /* Every dot on the card is at the same value: half the magnitude either side, so the single
       column of dots has somewhere to sit and the axis has ticks to label. */
    var e = Math.abs(hi) * 0.5 || 0.5;
    lo = lo - e; hi = hi + e;
  }

  var ax = axisTicks(lo, hi, 5);
  var vLabels = [], cLabels = [];
  for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }
  for (i = 0; i < n; i++) { cLabels.push(ord[i].label); }

  var leftW = 0;
  for (i = 0; i < n; i++) { leftW = Math.max(leftW, Math.min(P.labelPx, tw(cLabels[i]))); }

  var footCap = P.unit;
  var padT = 14, padR = 44;
  var padB = 22 + (footCap ? 12 : 0);
  var padL = Math.round(leftW) + 12;

  var W = P.W0;
  var H = Math.max(180, Math.min(P.hmax, padT + padB + n * P.row));

  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  var vS = CK.scale([ax.lo, ax.hi], [plot.x0, plot.x1]);
  var band = n ? (plot.y1 - plot.y0) / n : plot.y1 - plot.y0;
  var stride = band > 0 ? Math.max(1, Math.ceil(11 / band)) : 1;

  for (i = 0; i < ax.ticks.length; i++) {
    var vp = vS(ax.ticks[i]);
    marks.push(mLine(vp, plot.y0, vp, plot.y1, 'ck-rule'));
    marks.push(mText(vp, plot.y1 + 13, vLabels[i], 'ck-tk', 'middle'));
  }
  /* Zero gets the accented rule whenever the axis straddles it: on a chart with negative values the
     first question a reader asks is which side of nothing a dot is on, and it should not be answered
     by a line identical to the other five. */
  if (ax.lo < 0 && ax.hi > 0) {
    marks.push(mLine(vS(0), plot.y0, vS(0), plot.y1, 'ck-axis'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  var taken = [];
  var bounds = { x0: plot.x0 + 1, y0: 2, x1: W - 3, y1: plot.y1 - 1 };
  var drew = { clipped: 0, stride: stride, values: 0, coincide: 0, band: band };
  var radius = Math.max(1.5, Math.min(c.dotSize / 2, band * 0.42));
  var rows = [];

  for (i = 0; i < n; i++) {
    var it = ord[i];
    var y = plot.y0 + (i + 0.5) * band;
    var kids = [];
    var xs = [];
    var pxLo = Infinity, pxHi = -Infinity;

    var shown = clipTo(it.label, P.labelPx);
    if (i % stride === 0) {
      if (shown !== it.label) { drew.clipped++; }
      marks.push(mText(plot.x0 - 6, y + 3.2, shown, 'ck-tk', 'end'));
    }

    for (j = 0; j < ns; j++) {
      var val = it.values[j];
      if (val == null) { xs.push(null); continue; }
      var px = vS(val);
      xs.push(px);
      if (px < pxLo) { pxLo = px; }
      if (px > pxHi) { pxHi = px; }
    }
    rows.push({ label: it.label, xs: xs, values: it.values.slice(), y: y });

    /* The connector goes down before the dots so the dots sit on top of it rather than being
       sliced by it. It is drawn only when there are two ends to join. */
    if (c.connect && it.present > 1 && pxHi - pxLo > 0.01) {
      kids.push(mLine(pxLo, y, pxHi, y, 'ck-join'));
    }

    /* Two series at the same value put two dots at one pixel, and the top one hides the other
       entirely. That is not a fault to fix by nudging them apart - moving a dot off its value is
       exactly the lie this chart exists to avoid - so the position stays and a ring says that more
       than one series is under it. */
    var stacked = false;
    for (j = 0; j < ns && !stacked; j++) {
      if (xs[j] == null) { continue; }
      for (var k = j + 1; k < ns; k++) {
        if (xs[k] == null) { continue; }
        if (Math.abs(xs[k] - xs[j]) < 0.75) { stacked = true; break; }
      }
    }
    if (stacked) {
      drew.coincide++;
      for (j = 0; j < ns; j++) {
        if (xs[j] == null) { continue; }
        kids.push(mDot(xs[j], y, radius + 2.6, { fill: 'none', 'class': 'ck-stack' }));
      }
    }

    for (j = 0; j < ns; j++) {
      if (xs[j] == null) { continue; }
      kids.push(mDot(xs[j], y, radius, { fill: CK.hue(j), stroke: 'none', 'class': 'ck-dot' }));
    }

    /* Only the two ends of a row get a printed value, which is the standard dumbbell treatment: the
       numbers in between are unreadable at this density and the middle dots are read off the axis
       like every other dot. Below TEXT_ROW there is not room for one line of text per row at all. */
    if (band >= P.textRow && it.present) {
      var loIdx = -1, hiIdx = -1;
      for (j = 0; j < ns; j++) {
        if (xs[j] == null) { continue; }
        if (loIdx < 0 || xs[j] < xs[loIdx]) { loIdx = j; }
        if (hiIdx < 0 || xs[j] > xs[hiIdx]) { hiIdx = j; }
      }
      var ends = hiIdx === loIdx ? [hiIdx] : [hiIdx, loIdx];
      for (var q = 0; q < ends.length; q++) {
        var idx = ends[q];
        var out = idx === hiIdx;
        var txt = CK.fmt(it.values[idx]);
        var spot = fitLabel(taken, bounds, txt, out
          ? [{ x: xs[idx] + radius + 4, y: y + 3.2, anchor: 'start' }]
          : [{ x: xs[idx] - radius - 4, y: y + 3.2, anchor: 'end' }]);
        if (spot) {
          marks.push(mText(spot.x, spot.y, txt, 'ck-val', spot.anchor));
          drew.values++;
        }
      }
    }

    /* One invisible fat target per row, carrying every series value and the gap: a 3px dot is not a
       hit area, and the tooltip is where the exact numbers live when the picture abbreviated them. */
    var hit = mRect(plot.x0, y - band / 2, Math.max(1, plot.x1 - plot.x0), band,
                    { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    var tip = it.label;
    for (j = 0; j < ns; j++) {
      tip += '  \u00b7  ' + P.series[j] + ' ' +
             (it.values[j] == null ? 'not given' : CK.fmt(it.values[j]) + (P.unit ? ' ' + P.unit : ''));
    }
    if (it.present > 1) {
      tip += '  \u00b7  gap ' + CK.fmt(it.gap) + (P.unit ? ' ' + P.unit : '');
    }
    hit.ti = tip;
    kids.push(hit);

    marks.push({ t: 'g', a: { 'data-item': String(i), 'class': 'ck-ser' }, kids: kids });
  }

  if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, footCap, 'ck-cap-ax', 'middle')); }
  if (!n || !ns) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2,
                     ns ? 'no items' : 'no series', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, cfg: c, rows: rows,
           note: dpNote(P, c, ord, { lo: ax.lo, hi: ax.hi }, drew) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions the browser needs, in dependency order. Shipped as their own source rather than
   restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, axisTicks, mLine, mText, mRect, mDot,
                 dpCfg, dpOrder, fitLabel, dpNote, dpRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block early,
 * and so that no series name can put an arrow function's two characters into a file that is
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
  const own = '.ck-dotplot[data-card="' + id + '"]';
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
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-val', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    /* The connector is a measuring line between two findings, not a finding of its own, so it is
       lighter than either dot it joins. */
    ['.ck-plot .ck-join', 'stroke: var(--ink-faint); stroke-width: 2.2; fill: none; stroke-linecap: round;'],
    ['.ck-plot .ck-dot', 'stroke: none;'],
    ['.ck-plot .ck-stack', 'stroke: var(--ink-dim); stroke-width: 1; fill: none;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    ['.ck-set input[type="number"]', 'width: 5.5em;'],
    ['.ck-legend i', 'width: 8px; height: 8px; display: block; border-radius: 50%;'],
  ];

  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, a legend, a caption. */
function cardHtml(id, title, seed, series) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const legend = series.length
    ? '\n  <div class="ck-legend">' +
      series.map((s, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(s) + '</span>').join('') +
      '</div>'
    : '';

  /* The first series is named in the sort option rather than left as the word "first", because a
     reader choosing an order should be told which one they are choosing. */
  const firstName = series.length ? series[0] : 'the first series';

  return '<section data-card="' + CK.esc(id) + '" class="ck-dotplot">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="dot plot settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('connect') + '">connect</label>\n' +
    '    <input id="' + f('connect') + '" name="connect" type="checkbox"' +
           (defaults.connect ? ' checked' : '') + '>\n' +
    '    <label for="' + f('sort') + '">order</label>\n' +
    '    <select id="' + f('sort') + '" name="sort">' +
         opt('first', 'by ' + firstName, defaults.sort) +
         opt('gap', 'by the gap, widest first', defaults.sort) +
         opt('given', 'as given', defaults.sort) + '</select>\n' +
    '    <label for="' + f('dotSize') + '">dot size</label>\n' +
    '    <input id="' + f('dotSize') + '" name="dotSize" type="number" min="3" max="18" step="1" ' +
           'value="' + CK.esc(String(defaults.dotSize)) + '">\n' +
    '    <p class="ck-set-foot">with two series the connector is the change and its length is the ' +
         'size of it; with more than two it is only the range within the row, and implies no order ' +
         'between them. The dot is capped by the row height, so asking for a bigger one on a ' +
         'crowded chart changes nothing.</p>\n' +
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
 * @param payload the shipped rows and the constants the geometry needs
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload) {
  const src =
    '/* dot plot card: the order, the shared domain and every dot position were computed in Node\n' +
    '   from the whole item list. The functions below are the ones that drew the card that shipped,\n' +
    '   emitted as their own source, so a settings change re-runs them rather than a second\n' +
    '   implementation of them. */\n' +
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
    '     stays a translator rather than a second place where dot plot decisions live. */\n' +
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
    '     render that added marks would stack a second set of rows on the first every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = dpRender(P, cfg), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built, so it\n' +
    '       may be assigned rather than parsed back out of the data. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, P.dflt, render);\n' +
    '});\n';

  return guardJs(src, 'cardkit/dotplot');
}

/**
 * Build one dot plot card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no items           an empty frame captioned "no items"; nothing is invented
 *   no series          the same, captioned "no series", with a line saying where the numbers go
 *   one item           one row; the axis still spans the values in it
 *   one series         dots and no connectors, which is a Cleveland dot plot and a fine chart
 *   two equal values   the dots coincide exactly. They are NOT nudged apart - moving a dot off its
 *                      value is the lie this chart exists to avoid - so a ring is drawn around the
 *                      position to say more than one series is under it, and the count is captioned
 *   all values equal   one column of dots; the domain is padded by half the magnitude either side
 *   every value zero   the same, at zero, with every gap zero
 *   a negative value   drawn; zero gets the accented rule as soon as the axis straddles it
 *   a non-numeric      refused and counted; an absent key is counted separately as missing, because
 *                      bad data and no data are different facts and neither becomes a zero
 *   200 items          rows thin to the height cap, names print every k-th, value labels stop when a
 *                      row is under 12px, every dot still drawn
 *   a very long label  clipped with an ellipsis, counted, and the whole text kept in the tooltip
 *   1000x a neighbour  drawn on a linear axis; the small rows collapse toward one end and the
 *                      tooltips carry the numbers the picture can no longer separate
 *   duplicate labels   kept as separate rows, counted, and named
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ items: [{ label, values }], series, unit }` - see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused and counted
 *
 * @example
 * build({
 *   id: 'wages',
 *   title: 'median wage, 2019 against 2024',
 *   data: { series: ['2019', '2024'], unit: 'USD',
 *           items: [{ label: 'nurses', values: { '2019': 61000, '2024': 78000 } },
 *                   { label: 'teachers', values: { '2019': 58000, '2024': 63000 } }] },
 *   ord: 25,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'dotplot' : id);
  const read = readData(data);

  const P = {
    W0, H0, hmax: HMAX, row: ROW, labelPx: LABEL_PX, textRow: TEXT_ROW, hues: HUES,
    unit: read.unit,
    series: read.series,
    refused: read.refused,
    missing: read.missing,
    ignored: read.ignored,
    empties: read.empties,
    dupLabels: read.dupLabels,
    items: read.items,
    dflt: { ...defaults },
  };

  const seed = dpRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      items: read.items.length,
      series: read.series.length,
      refused: read.refused,
      missing: read.missing,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, read.series),
    css: cardCss(cardId),
    js: cardJs(cardId, P),
  };
}

export default { meta, build };
