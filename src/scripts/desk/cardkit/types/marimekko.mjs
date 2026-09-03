/**
 * `marimekko` - a stacked bar chart whose bars also have widths, and a warning about the product.
 *
 * Two variables, two dimensions. A column's WIDTH is one number - a market size, a headcount, a
 * budget - and the heights inside it are another, split into parts. Both are proportional, which is
 * what makes the chart unusually dense, and both are readable, which is what makes it worth drawing.
 *
 * **The danger is the multiplication.** People do not read a rectangle's two edges; they read its
 * area, involuntarily and quickly. Here the area is width times height, which is the PRODUCT of the
 * two variables, and a product is not a variable anybody measured. Two cells of the same area can be
 * a wide short one and a narrow tall one with nothing whatever in common, and no legend can undo
 * that, because the reader has already done the sum before reaching the legend.
 *
 * There is one case where the product means something exact, and this card checks whether it holds
 * rather than assuming it. When the column widths are proportional to the column totals - the true
 * mosaic plot, where width IS the total of the parts inside it - a cell's area is exactly its share
 * of the grand total, and reading the area is correct. When they are not, area is a quantity with no
 * name. The caption says which of the two this data is, with the number that decides it.
 *
 * Both axes carry a caption, always, even when the data did not name them. A Marimekko with one
 * labelled axis is a chart where half the encoding is a guess.
 *
 * All geometry is computed in Node and the functions that computed it are shipped to the browser as
 * their own source, so a settings change re-runs the code that drew the card.
 *
 * @see ./treemap.mjs     the other area chart, where area is the ONLY encoding and says so
 * @see ./stackedbar.mjs  the same stack without the width, when the second variable is not real
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
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
  catch (e) { throw new Error('cardkit/marimekko: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/marimekko: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;
const H0 = 320;
const WMAX = 2200;
const LABEL_PX = 120;   // the most room a column header may take before it is clipped

/* Below this drawn width a column is a hairline that a reader cannot tell from a border. Named so
   the caption can quote the threshold rather than imply it. */
const THIN_PX = 1;

/* How closely the widths must track the column totals before this is a true mosaic, in which a
   cell's area really is its share of the grand total. A couple of percent of slack, because data
   that was built to be proportional usually is proportional to within rounding. */
const MOSAIC_TOL = 1.02;

/* The palette wraps after eight, so past this many distinct parts two of them share a colour. */
const HUES = 8;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it. `percent` defaults on because the normalised form is the one where the area question has a
 * clean answer - a cell's area is its share of the grand total exactly when the widths track the
 * totals - and the caption can then say whether that holds.
 */
export const defaults = {
  labels: 'auto',
  percent: true,
  gap: 2,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'marimekko',
  summary: 'Column width is one variable and segment height another, with the area product named.',
  shape: '{ columns: [{ label, width, parts: [{ label, value }] }], unit, widthLabel, valueLabel }',
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
  const where = who || 'cardkit/marimekko';
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
 * Normalise whatever arrived, refusing what this geometry cannot express and counting each reason.
 *
 * Three refusals, kept apart because they are three different facts:
 *
 * A column whose width is not a finite positive number is DROPPED. A zero-width column is not a
 * column at all - it owns segments that have nowhere to be drawn, so it would be an invisible entry
 * that still contributed to the totals the caption quotes. Refusing it and naming the count is the
 * only version of that a reader can check.
 *
 * A part whose value is negative is refused. A stack has one direction; a negative segment would
 * have to be drawn back over the one below it, and the result reads as a smaller positive. There is
 * no honest picture of it here, which is a reason to reach for a different card rather than a reason
 * to fudge this one.
 *
 * A part whose value is not a finite number is refused as bad data, and never coerced: `Number('')`
 * is 0, so a coercing reader silently invents empty segments.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ columns, parts, dropped, negatives, refused, dupLabels, unit, widthLabel, valueLabel }`
 *
 * @example readData({ columns: [{ label: 'a', width: 0, parts: [] }] }).dropped;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.columns) ? d.columns : [];

  const columns = [];
  const parts = [];
  const partAt = new Map();
  const seen = new Map();
  let dropped = 0;
  let negatives = 0;
  let refused = 0;
  let dupLabels = 0;

  raw.forEach((col, i) => {
    const c = col && typeof col === 'object' ? col : {};
    const width = c.width;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) { dropped++; return; }

    const label = String(c.label != null ? c.label : 'column ' + (i + 1));
    const src = Array.isArray(c.parts) ? c.parts : [];
    const kept = [];
    let total = 0;

    for (const p of src) {
      const row = p && typeof p === 'object' ? p : {};
      const v = row.value;
      if (typeof v !== 'number' || !Number.isFinite(v)) { refused++; continue; }
      if (v < 0) { negatives++; continue; }
      const name = String(row.label != null ? row.label : 'part ' + (kept.length + 1));
      if (!partAt.has(name)) { partAt.set(name, parts.length); parts.push(name); }
      kept.push({ label: name, value: v, p: partAt.get(name) });
      total += v;
    }

    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    if (count === 2) dupLabels++;

    columns.push({ label, width, parts: kept, total, i: columns.length });
  });

  return {
    columns, parts, dropped, negatives, refused, dupLabels,
    unit: d.unit == null ? '' : String(d.unit),
    /* Both axes are captioned whether or not the data named them: a Marimekko with one labelled
       axis is a chart where half the encoding is a guess, and a generic word is a better guess than
       none. */
    widthLabel: d.widthLabel == null || String(d.widthLabel) === '' ? 'width' : String(d.widthLabel),
    valueLabel: d.valueLabel == null || String(d.valueLabel) === '' ? 'value' : String(d.valueLabel),
  };
}

/**
 * How far the column widths are from being proportional to the column totals.
 *
 * This is the whole question of whether reading the areas is legitimate. When width is proportional
 * to the total of the parts inside it - the true mosaic - a cell's area is exactly its share of the
 * grand total, and the involuntary area reading is correct. When it is not, area is width times
 * share, which is a product with no name.
 *
 * The measure is the ratio between the largest and the smallest width-per-unit-total across the
 * columns that have any total at all. One means perfectly proportional; two means one column's
 * width buys twice as much room per unit as another's.
 *
 * @param columns the kept columns
 * @returns `{ ratio, live }` - the spread, and how many columns it was computed from
 *
 * @example mosaicSpread([{ width: 2, total: 20 }, { width: 1, total: 10 }]).ratio;   // 1
 */
function mosaicSpread(columns) {
  let lo = Infinity;
  let hi = -Infinity;
  let live = 0;
  for (const c of columns) {
    if (!(c.total > 0)) continue;
    live++;
    const r = c.width / c.total;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  if (live < 2 || !Number.isFinite(lo) || lo <= 0) return { ratio: 1, live };
  return { ratio: hi / lo, live };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything below runs in BOTH halves: Node calls it to draw the card that ships, and the browser
   calls the identical text after a settings change. ES5 only - `var` and `function`, no arrow
   functions, no template literals, no destructuring - and nothing from outside but `CK`. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite width in a rect is silent: the browser drops the attribute and the cell renders as
 * nothing, with nothing in the console. Throwing turns that into a build failure beside the input
 * that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/marimekko: non-finite coordinate (' + v + ')');
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

/**
 * Settle a settings object that may have come out of `localStorage`, which the viewer can edit.
 *
 * Every value is re-vetted against the fallbacks shipped in the payload rather than against a second
 * copy of them written here. A hand-edited `gap` of 400 would otherwise eat the entire plot and
 * leave the columns at negative widths, which `fin` would then refuse with an exception; the clamp
 * makes that a bounded setting instead of a crash.
 *
 * @param cfg  whatever `CK.settings` handed back
 * @param dflt the payload's copy of {@link defaults}
 * @returns a settings object every field of which is safe to compute with
 *
 * @example mkCfg({ gap: 400 }, { labels: 'auto', percent: true, gap: 2 }).gap;   // 12
 */
function mkCfg(cfg, dflt) {
  var c = cfg || {}, d = dflt || {};
  var labels = c.labels === 'auto' || c.labels === 'all' || c.labels === 'none' ? c.labels : d.labels;
  var gap = Number(c.gap);
  if (!isFinite(gap)) { gap = Number(d.gap); }
  if (!isFinite(gap)) { gap = 2; }
  if (gap < 0) { gap = 0; }
  if (gap > 12) { gap = 12; }
  return { labels: labels, percent: c.percent == null ? !!d.percent : !!c.percent, gap: gap };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the chart to anyone using one - and
 * for this chart it also has to carry the thing a sighted reader gets wrong: that the block sizes
 * are a product.
 *
 * The caption states the area problem unconditionally, and then says which of the two cases this
 * data is in, with the number that decides it. A card that only warned when the widths were badly
 * out of proportion would be teaching readers to trust the ones that were only slightly out.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param drew what the geometry settled: `{ narrow, minW, clipped, stride, labelled, cells, gap }`
 * @returns `{ aria, caption }` - plain text and escaped markup respectively
 */
function mkNote(P, cfg, drew) {
  var cols = P.columns, n = cols.length, i;
  var unit = P.unit ? ' ' + P.unit : '';

  var refusals = [];
  if (P.dropped) {
    refusals.push('<i>' + CK.esc(String(P.dropped)) + ' column' + (P.dropped === 1 ? '' : 's') +
                  ' dropped</i> for having no usable width - a column of zero width owns segments ' +
                  'with nowhere to be drawn, so it would have been an invisible entry still counted ' +
                  'in the totals');
  }
  if (P.negatives) {
    refusals.push('<i>' + CK.esc(String(P.negatives)) + ' negative value' +
                  (P.negatives === 1 ? '' : 's') + ' refused</i> - a stack runs one way, and a ' +
                  'negative segment drawn back over the one below it reads as a smaller positive');
  }
  if (P.refused) {
    refusals.push('<i>' + CK.esc(String(P.refused)) + ' value' + (P.refused === 1 ? '' : 's') +
                  ' refused</i> for not being a finite number - counted, never coerced to zero');
  }

  if (!n) {
    return {
      aria: 'Marimekko chart with nothing to draw: ' + (P.dropped
        ? P.dropped + ' columns had no usable width, so the widths do not sum to anything and the ' +
          'horizontal axis has no scale.'
        : 'no columns were supplied.'),
      caption: 'a Marimekko with <b>nothing to draw</b>. this chart refuses rather than guesses: ' +
        'the column widths are the entire horizontal scale, so if they do not sum to a positive ' +
        'number there is no axis to draw against and every block on the card would be an invention. ' +
        (refusals.length ? refusals.join('; ') + '. ' : '') +
        'the frame is drawn so the card keeps its place.',
    };
  }

  var totalW = 0, grand = 0, empties = 0, biggest = cols[0];
  for (i = 0; i < n; i++) {
    totalW += cols[i].width;
    grand += cols[i].total;
    if (!(cols[i].total > 0)) { empties++; }
    if (cols[i].width > biggest.width) { biggest = cols[i]; }
  }

  var mosaic = P.spread.ratio <= P.mosaicTol && P.spread.live > 1;

  var aria = 'Marimekko chart of ' + n + ' column' + (n === 1 ? '' : 's') + ' and ' +
    P.parts.length + ' part' + (P.parts.length === 1 ? '' : 's') + '. ' +
    'Column width is ' + P.widthLabel + ', summing to ' + CK.fmt(totalW) + '. ' +
    'Segment height is ' + P.valueLabel + (cfg.percent ? ', normalised so each column fills the ' +
      'full height' : ', on one shared scale across the columns') + ', totalling ' +
    CK.fmt(grand) + unit + '. ' +
    'A cell area is width times height, which is the product of the two and ' +
    (mosaic ? 'here equals the cell share of the grand total, because the widths track the column ' +
              'totals.' : 'is not a quantity that was measured, because the widths do not track the ' +
              'column totals.') + ' ';
  for (i = 0; i < n && i < 6; i++) {
    aria += cols[i].label + ': width ' + CK.fmt(cols[i].width) + ', total ' + CK.fmt(cols[i].total) +
            unit + '. ';
  }
  if (n > 6) { aria += 'The remaining ' + (n - 6) + ' columns are in the tooltips. '; }

  /* The area sentence, which is the reason this card exists in the form it does. */
  var product = 'width is <b>' + CK.esc(P.widthLabel) + '</b> and height is <b>' +
    CK.esc(P.valueLabel) + '</b>, so a block area is the <i>product</i> of the two - and people read ' +
    'area whether or not they meant to. ' +
    (mosaic
      ? 'here the widths track the column totals to within ' +
        CK.esc(CK.fmt((P.spread.ratio - 1) * 100)) + '%, which makes this a true mosaic: a block ' +
        'area really is its share of the grand total, and reading the areas is correct'
      : P.spread.live > 1
        ? 'the widths do <i>not</i> track the column totals - one column buys <b>' +
          CK.esc(CK.fmt(P.spread.ratio)) + 'x</b> the room per unit that another does - so an area ' +
          'here is a product with no name. read the two edges, not the block'
        : 'with one column carrying any value there is nothing to compare areas against yet; the ' +
          'product becomes readable, or misleading, as soon as there are two');

  var doubts = [];
  for (i = 0; i < refusals.length; i++) { doubts.push(refusals[i]); }
  if (empties) {
    doubts.push(CK.esc(String(empties)) + ' column' + (empties === 1 ? '' : 's') +
                ' have nothing in them and are drawn as an empty outline of their full width - a ' +
                (cfg.percent ? 'share of nothing cannot be normalised' : 'total of zero has no height') +
                ', and an empty column is not the same as an absent one');
  }
  if (drew.narrow) {
    doubts.push(CK.esc(String(drew.narrow)) + ' column' + (drew.narrow === 1 ? ' is' : 's are') +
                ' under ' + CK.esc(String(P.thinPx)) + 'px wide - the narrowest is ' +
                CK.esc(CK.fmt(drew.minW)) + 'px - which is where a column stops being visible at ' +
                'all; their numbers are still in the tooltips');
  }
  if (drew.gap < cfg.gap) {
    doubts.push('the gap was reduced from ' + CK.esc(CK.fmt(cfg.gap)) + 'px to ' +
                CK.esc(CK.fmt(drew.gap)) + 'px, because at this many columns the gaps alone would ' +
                'have taken more room than the columns');
  }
  if (P.parts.length > P.hues) {
    doubts.push('there are more parts than the ' + CK.esc(String(P.hues)) + ' palette colours, so ' +
                'two of them share a hue and only their position in the stack tells them apart');
  }
  if (P.dupLabels) {
    doubts.push(CK.esc(String(P.dupLabels)) + ' column label' + (P.dupLabels === 1 ? '' : 's') +
                ' appear' + (P.dupLabels === 1 ? 's' : '') + ' more than once; equal labels are ' +
                'separate columns and were not merged');
  }
  if (drew.clipped) {
    doubts.push(CK.esc(String(drew.clipped)) + ' column name' + (drew.clipped === 1 ? '' : 's') +
                ' had to be cut to fit, marked with an ellipsis; the whole text is in the tooltip');
  }
  if (drew.stride > 1) {
    doubts.push('there is not room for every column name, so only every ' +
                CK.esc(String(drew.stride)) + 'th is printed - every column is still drawn');
  }
  if (cfg.labels !== 'none' && drew.cells > drew.labelled) {
    doubts.push(CK.esc(String(drew.cells - drew.labelled)) + ' of ' + CK.esc(String(drew.cells)) +
                ' block' + (drew.cells === 1 ? '' : 's') + ' had no room for a name; the legend and ' +
                'the tooltips carry them');
  }

  var caption = '<b>' + CK.esc(String(n)) + '</b> column' + (n === 1 ? '' : 's') + ' by <b>' +
    CK.esc(String(P.parts.length)) + '</b> part' + (P.parts.length === 1 ? '' : 's') + '. ' +
    product + '. ' +
    (cfg.percent
      ? 'each column is <i>normalised to its own total</i>, so the heights are shares within a ' +
        'column and cannot be compared across columns as amounts. '
      : 'heights are <i>absolute</i> on one shared scale, so a short column is genuinely a small ' +
        'total and the column tops are readable against the axis. ') +
    'widest column <b>' + CK.esc(biggest.label) + '</b> at ' + CK.esc(CK.fmt(biggest.width)) +
    ' of ' + CK.esc(CK.fmt(totalW)) + ' ' + CK.esc(P.widthLabel) + '. ' +
    (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * The cell rectangles are returned alongside the display list rather than only baked into it,
 * because the arithmetic is the thing worth testing here - that heights within a column really are
 * proportional to the values, that a normalised column really does fill the plot exactly, and that
 * the column widths really are proportional to the width variable - and a test that had to read
 * rectangles back out of markup would be testing its own parser.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settings, which may have come from `localStorage` and are re-vetted by {@link mkCfg}
 * @returns `{ W, H, marks, note, cfg, cells, cols }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable columns and values were refused while reading
 *
 * @example mkRender(P, { labels: 'auto', percent: true, gap: 2 }).cells.length;
 */
function mkRender(P, cfg) {
  var c = mkCfg(cfg, P.dflt);
  var cols = P.columns, n = cols.length;
  var marks = [], i, j;

  var totalW = 0, maxTotal = 0;
  for (i = 0; i < n; i++) {
    totalW += cols[i].width;
    if (cols[i].total > maxTotal) { maxTotal = cols[i].total; }
  }

  /* The value axis. In percent mode it is a fixed 0..100 with quarter ticks, which is the only
     honest labelling of a normalised stack; in absolute mode it spans the largest column total. */
  var ticks = [], tickText = [];
  if (c.percent) {
    ticks = [0, 25, 50, 75, 100];
    for (i = 0; i < ticks.length; i++) { tickText.push(ticks[i] + '%'); }
  } else {
    var top = maxTotal > 0 ? maxTotal : 1;
    var t = CK.ticks(0, top, 5);
    for (i = 0; i < t.length; i++) { ticks.push(t[i]); tickText.push(CK.fmt(t[i])); }
    if (!ticks.length) { ticks = [0, top]; tickText = [CK.fmt(0), CK.fmt(top)]; }
  }

  var leftW = 0;
  for (i = 0; i < tickText.length; i++) { leftW = Math.max(leftW, tw(tickText[i])); }

  var padT = 26;                              // the column headers live here
  var padR = 12;
  var padB = 34;                              // tick labels plus the width-axis caption
  var padL = Math.round(leftW) + 12 + 12;     // ticks, plus the rotated value-axis caption

  /* A wide deck of columns keeps its width and scrolls inside its own box rather than squeezing
     every column into the desk column, where two hundred of them would be sub-pixel. */
  var W = n ? Math.min(P.wmax, Math.max(P.W0, padL + padR + n * 6)) : P.W0;
  var H = P.H0;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  var plotW = plot.x1 - plot.x0;
  var plotH = plot.y1 - plot.y0;

  /* The gaps come out of the drawable width before anything is scaled, so the columns stay
     proportional to each other no matter how large the gap is. When the gaps alone would take more
     than two fifths of the room, the gap shrinks - a chart that is mostly background is not a
     chart, and the reduction is reported rather than done quietly. */
  var gaps = n > 1 ? n - 1 : 0;
  var gap = gaps ? Math.min(c.gap, plotW * 0.4 / gaps) : 0;
  var usable = plotW - gap * gaps;
  var scaleW = totalW > 0 ? usable / totalW : 0;

  var vTop = c.percent ? 100 : (maxTotal > 0 ? maxTotal : 1);
  var vS = CK.scale([0, vTop], [plot.y1, plot.y0]);

  for (i = 0; i < ticks.length; i++) {
    var vp = vS(ticks[i]);
    marks.push(mLine(plot.x0, vp, plot.x1, vp, 'ck-rule'));
    marks.push(mText(plot.x0 - 6, vp + 3.2, tickText[i], 'ck-tk', 'end'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  var cells = [], out = [];
  var drew = { narrow: 0, minW: 0, clipped: 0, stride: 1, labelled: 0, cells: 0, gap: gap };
  var avgW = n ? usable / n : 0;
  drew.stride = avgW > 0 ? Math.max(1, Math.ceil(30 / avgW)) : 1;

  var x = plot.x0;
  for (i = 0; i < n; i++) {
    var col = cols[i];
    var w = col.width * scaleW;
    var kids = [];
    /* Block labels are collected apart and appended after every rectangle in the column, because a
       label pushed as the segments are walked would be painted over by the next segment's fill -
       SVG has no z-index, only document order. */
    var labs = [];
    if (i === 0 || w < drew.minW) { drew.minW = w; }
    if (w < P.thinPx) { drew.narrow++; }

    /* An empty column keeps its full width and is drawn as an outline. A share of nothing cannot be
       normalised and a total of zero has no height, but the column is still a real column - and an
       empty one must not look like one that is not here. */
    if (!(col.total > 0)) {
      kids.push(mRect(x, plot.y0, w, plotH, { fill: 'none', 'class': 'ck-void' }));
    } else {
      /* Boundaries are computed from the running total rather than by accumulating rounded heights,
         so the top of the last segment lands exactly on the top of the column: a stack summed from
         per-segment heights leaves a sliver of background at the top that looks like missing data. */
      var run = 0;
      var yPrev = plot.y1;
      for (j = 0; j < col.parts.length; j++) {
        var part = col.parts[j];
        run += part.value;
        var frac = run / col.total;
        var yNext = c.percent
          ? plot.y1 - frac * plotH
          : vS(run);
        var h = yPrev - yNext;
        var cell = { col: i, part: part.p, label: part.label, value: part.value,
                     x: x, y: yNext, w: w, h: h,
                     share: part.value / col.total };
        cells.push(cell);
        drew.cells++;

        var rect = mRect(x, yNext, w, h,
                         { fill: CK.hue(part.p), 'class': 'ck-cell' });
        rect.ti = col.label + '  \u00b7  ' + part.label + '  \u00b7  ' + CK.fmt(part.value) +
                  (P.unit ? ' ' + P.unit : '') + '  \u00b7  ' +
                  CK.fmt(cell.share * 100) + '% of the column  \u00b7  ' +
                  P.widthLabel + ' ' + CK.fmt(col.width);
        kids.push(rect);

        /* The block's name, and its number under it when there is room for both. In auto mode only
           what fits is printed; in all mode a clipped name goes in anything tall enough to hold one
           line, which is a legibility trade the reader asked for. */
        if (c.labels !== 'none' && h >= 9) {
          var room = c.labels === 'all' ? w - 4 : w - 6;
          var name = c.labels === 'all' ? clipTo(part.label, Math.max(6, room)) : part.label;
          var fits = c.labels === 'all' || (tw(name) <= room && h >= 11);
          if (fits) {
            var cxm = x + w / 2;
            var two = h >= 22 && (c.labels === 'all' || tw(CK.fmt(part.value)) <= room);
            labs.push(mText(cxm, yNext + h / 2 + (two ? -1 : 3.2), name, 'ck-lab', 'middle'));
            if (two) {
              labs.push(mText(cxm, yNext + h / 2 + 10,
                              c.labels === 'all'
                                ? clipTo(CK.fmt(part.value), Math.max(6, room))
                                : CK.fmt(part.value),
                              'ck-lab-v', 'middle'));
            }
            drew.labelled++;
          }
        }

        yPrev = yNext;
      }
    }

    /* The column header: its name and the width value that put it at this size. Thinned when the
       columns are narrower than a name, never overprinted. */
    if (i % drew.stride === 0) {
      /* A thinned header may use the room of the neighbours that were not printed, since nothing
         else is going there - otherwise every name on a dense chart is cut to two characters. */
      var head = clipTo(col.label,
                        Math.min(P.labelPx, Math.max(12, (w + gap) * drew.stride - 2)));
      if (head !== col.label) { drew.clipped++; }
      marks.push(mText(x + w / 2, plot.y0 - 14, head, 'ck-head', 'middle'));
      if (w >= tw(CK.fmt(col.width)) + 4) {
        marks.push(mText(x + w / 2, plot.y0 - 4, CK.fmt(col.width), 'ck-head-w', 'middle'));
      }
    }

    out.push({ label: col.label, x: x, w: w, width: col.width, total: col.total });
    marks.push({ t: 'g', a: { 'data-col': String(i), 'class': 'ck-ser' },
                 kids: kids.concat(labs) });
    x += w + gap;
  }

  /* Both axes carry a caption, always. Half a Marimekko's encoding is the width, and an unlabelled
     width axis makes the whole card a guess about which variable is which. */
  marks.push(mText((plot.x0 + plot.x1) / 2, H - 5,
                   P.widthLabel + ' \u2192 column width', 'ck-cap-ax', 'middle'));
  var cy = (plot.y0 + plot.y1) / 2;
  var side = c.percent
    ? 'share of ' + P.valueLabel + ' \u2192 height'
    : P.valueLabel + (P.unit ? ' (' + P.unit + ')' : '') + ' \u2192 height';
  marks.push(mText(10, cy, side, 'ck-cap-ax', 'middle',
                   { transform: 'rotate(-90 10 ' + fin(cy) + ')' }));

  if (!n) {
    marks.push(mText((plot.x0 + plot.x1) / 2, cy, 'no columns with a usable width', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, cfg: c, cells: cells, cols: out,
           note: mkNote(P, c, drew) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions the browser needs, in dependency order. Shipped as their own source rather than
   restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, mLine, mText, mRect, mkCfg, mkNote, mkRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block early,
 * and so that no part name can put an arrow function's two characters into a file that is
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
  const own = '.ck-marimekko[data-card="' + id + '"]';
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
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-head', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-head-w', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    /* A hairline in the ground colour between the blocks, so two neighbouring segments of similar
       hue are still two segments. It is a separator rather than a border: a stroke of its own would
       thicken every cell by a pixel and quietly break the proportionality the card claims. */
    ['.ck-plot .ck-cell', 'stroke: var(--ground); stroke-width: 0.6;'],
    ['.ck-plot .ck-void', 'stroke: var(--rule); stroke-width: 1; stroke-dasharray: 3 3; fill: none;'],
    /* The block labels are set over a filled block, so they carry a halo in the ground colour
       rather than assuming the fill is light or dark - it is one or the other in each theme. */
    ['.ck-plot .ck-lab',
     'fill: var(--ink); paint-order: stroke; stroke: var(--ground); stroke-width: 2.6px; ' +
     'stroke-linejoin: round;'],
    ['.ck-plot .ck-lab-v',
     'fill: var(--ink-dim); paint-order: stroke; stroke: var(--ground); stroke-width: 2.6px; ' +
     'stroke-linejoin: round;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    ['.ck-set input[type="number"]', 'width: 5.5em;'],
    ['.ck-legend i', 'width: 7px; height: 7px; display: block; border-radius: 1px;'],
  ];

  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }

  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, a legend, a caption. */
function cardHtml(id, title, seed, parts) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const legend = parts.length
    ? '\n  <div class="ck-legend">' +
      parts.map((p, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(p) + '</span>').join('') +
      '</div>'
    : '';

  return '<section data-card="' + CK.esc(id) + '" class="ck-marimekko">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="marimekko settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('percent') + '">normalise</label>\n' +
    '    <input id="' + f('percent') + '" name="percent" type="checkbox"' +
           (defaults.percent ? ' checked' : '') + '>\n' +
    '    <label for="' + f('labels') + '">block labels</label>\n' +
    '    <select id="' + f('labels') + '" name="labels">' +
         opt('auto', 'only where they fit', defaults.labels) +
         opt('all', 'always, clipped', defaults.labels) +
         opt('none', 'none', defaults.labels) + '</select>\n' +
    '    <label for="' + f('gap') + '">column gap</label>\n' +
    '    <input id="' + f('gap') + '" name="gap" type="number" min="0" max="12" step="1" ' +
           'value="' + CK.esc(String(defaults.gap)) + '">\n' +
    '    <p class="ck-set-foot">normalised, every column fills the height and the heights are ' +
         'shares within a column; unnormalised, they are amounts on one shared scale and short ' +
         'columns are genuinely small. Either way a block area is the product of the two variables ' +
         'and is only a share of the whole when the widths track the column totals.</p>\n' +
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
 * @param payload the shipped columns and the constants the geometry needs
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload) {
  const src =
    '/* marimekko card: the column widths, the stack boundaries and the proportionality test were\n' +
    '   all computed in Node. The functions below are the ones that drew the card that shipped,\n' +
    '   emitted as their own source, so switching between normalised and absolute re-runs the code\n' +
    '   the caption describes rather than a second implementation of it. */\n' +
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
    '     stays a translator rather than a second place where mosaic decisions live. */\n' +
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
    '     render that added marks would stack a second set of blocks on the first every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = mkRender(P, cfg), i;\n' +
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

  return guardJs(src, 'cardkit/marimekko');
}

/**
 * Build one Marimekko card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no columns          a frame captioned with why it refused: the widths are the whole horizontal
 *                       scale, so if they do not sum to a positive number there is no axis at all
 *                       and every block on the card would be an invention
 *   zero-width column   dropped and counted - it owns segments with nowhere to be drawn, and an
 *                       invisible column still counted in the totals is worse than an absent one
 *   one column          fills the width; the area test says there is nothing to compare against yet
 *   two equal values    two blocks of identical height in the same column, and of different area in
 *                       different columns, which is the whole warning in one picture
 *   all values equal    even blocks; normalised, every column is an identical stripe
 *   a column of zeros   drawn as a dashed empty outline of its full width. A share of nothing cannot
 *                       be normalised and a total of zero has no height, but the column is real
 *   a negative value    refused and counted; a stack runs one way and a negative segment drawn back
 *                       over its neighbour reads as a smaller positive
 *   a non-numeric       refused and counted, never coerced to zero
 *   200 columns         the plot widens and scrolls; column names print every k-th; the caption
 *                       names how many columns fell under a pixel and how wide the narrowest is
 *   a very long label   clipped with an ellipsis, counted, whole text in the tooltip
 *   1000x a neighbour   one column takes nearly the whole width and the rest become hairlines,
 *                       which the caption counts rather than hides
 *   duplicate labels    kept as separate columns, counted, and named
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ columns: [{ label, width, parts }], unit, widthLabel, valueLabel }` - see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused and counted
 *
 * @example
 * build({
 *   id: 'revenue',
 *   title: 'revenue by region and product',
 *   data: { widthLabel: 'accounts', valueLabel: 'revenue', unit: 'USD',
 *           columns: [{ label: 'emea', width: 120,
 *                       parts: [{ label: 'seats', value: 40 }, { label: 'support', value: 12 }] },
 *                     { label: 'apac', width: 60,
 *                       parts: [{ label: 'seats', value: 18 }, { label: 'support', value: 9 }] }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'marimekko' : id);
  const read = readData(data);

  const P = {
    W0, H0, wmax: WMAX, labelPx: LABEL_PX, thinPx: THIN_PX, mosaicTol: MOSAIC_TOL, hues: HUES,
    unit: read.unit,
    widthLabel: read.widthLabel,
    valueLabel: read.valueLabel,
    columns: read.columns,
    parts: read.parts,
    dropped: read.dropped,
    negatives: read.negatives,
    refused: read.refused,
    dupLabels: read.dupLabels,
    spread: mosaicSpread(read.columns),
    dflt: { ...defaults },
  };

  const seed = mkRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      columns: read.columns.length,
      parts: read.parts.length,
      dropped: read.dropped,
      refused: read.refused + read.negatives,
      mosaic: P.spread.ratio <= MOSAIC_TOL && P.spread.live > 1,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, read.parts),
    css: cardCss(cardId, seed.W > W0, seed.W),
    js: cardJs(cardId, P),
  };
}

export default { meta, build };
