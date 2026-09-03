/**
 * `funnel` - stage-to-stage retention, drawn as widths, with the two things funnels get wrong.
 *
 * **The width is the value; the area is not.** Each stage's width is proportional to its value, and
 * that part is honest. But the mark a reader sees is the BAND between two stages - a trapezoid - and
 * a trapezoid's area is its height times the mean of its two widths. So the ink of a band is
 * proportional to the AVERAGE of the stage before and the stage after, which is a number nobody
 * measured and which is always kinder to a collapse than the collapse is. A drop from 100 to 10
 * draws a band whose area stands for 55; a drop from 100 to 90 draws one standing for 95. The values
 * differ ninefold and the areas differ by less than half. The eye reads the area.
 *
 * `shape: 'bars'` is the way out: each stage becomes a centred rectangle of constant height, so its
 * area is its width is its value, and there is no averaging anywhere. It is a less pretty picture of
 * exactly the same numbers, and it is the one to check a surprising funnel against.
 *
 * The last stage is the single exception on the drawn funnel: it has no successor to average with,
 * so its band is a rectangle and its area really is proportional to its value. That is worth knowing
 * before comparing the bottom of the funnel to anything above it.
 *
 * **A funnel cannot grow.** A stage larger than the one before it means the data is wrong, or the
 * stages are not nested, or this is a sequence of independent measurements and not a funnel at all.
 * This card draws the widening band rather than hiding it, marks it, counts it, and says so in the
 * caption - because a chart that quietly clamps such a stage to its predecessor has destroyed the
 * only evidence that anything was wrong.
 *
 * The order is the data's and there is no setting to change it. A funnel is a sequence; sorting it
 * would leave a picture that still looked like a funnel and no longer meant one.
 *
 * All geometry is computed in Node and the functions that computed it are shipped to the browser as
 * their own source, so a settings change re-runs the code that drew the card.
 *
 * @see ./waterfall.mjs  the other stepwise chart, where the mark is the change rather than the level
 * @see ./lollipop.mjs   the same numbers with no area at all, when the shape is not the point
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().fmt(0.5);   // '0.5'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/funnel: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/funnel: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants both halves need ──────────────────────────────────────────────────────── */

const W0 = 640;
const BAND = 34;        // px per stage at a comfortable density
const BAND_MIN = 5;     // below this a stage is a stripe; the card stops growing and thins instead
const HMAX = 2400;
const LABEL_PX = 150;   // the most horizontal room a stage name may take before it is clipped
const RATE_PX = 54;     // the right gutter, which holds the stage-to-stage percentages

/* Below this drawn width a stage is a hairline nobody can see. Named so the caption can quote the
   threshold rather than imply it. */
const THIN_PX = 1;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it. `shape` defaults to the funnel because that is the chart being asked for; the caption names
 * the area problem and points at `bars`, which is the honest cross-check rather than the default.
 */
export const defaults = {
  shape: 'funnel',
  rates: true,
  labels: 'auto',
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'funnel',
  summary: 'Stage-to-stage retention as widths, with the trapezoid area problem stated on the card.',
  shape: '{ stages: [{ label, value }], unit }',
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
  const where = who || 'cardkit/funnel';
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
 * Normalise whatever arrived, refusing what a width cannot express and counting each reason.
 *
 * A stage value is kept only when it is a finite `number` that is not negative. Negatives are
 * refused and counted apart from bad data, because they are a different fact: a width has no sign,
 * so a negative stage would either have to be drawn as a positive one - which is a lie no reader can
 * detect - or as nothing, which is a different lie. There is no honest funnel of a negative stage.
 *
 * Nothing is coerced: `Number('')` is 0 and `Number(true)` is 1, so a coercing reader invents empty
 * stages out of blanks and a retention rate out of nothing.
 *
 * Order is preserved exactly. A funnel is a sequence and there is deliberately no sort setting -
 * sorting one would leave a picture that still looked like a funnel and no longer meant one.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ stages, refused, negatives, dupLabels, unit }`
 *
 * @example readData({ stages: [{ label: 'visit', value: 100 }] }).stages.length;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.stages) ? d.stages : [];

  const stages = [];
  const seen = new Map();
  let refused = 0;
  let negatives = 0;
  let dupLabels = 0;

  raw.forEach((st, i) => {
    const row = st && typeof st === 'object' ? st : {};
    const value = row.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) { refused++; return; }
    if (value < 0) { negatives++; return; }

    const label = String(row.label != null ? row.label : 'stage ' + (i + 1));
    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    if (count === 2) dupLabels++;

    stages.push({ label, value, i: stages.length });
  });

  /* The rates are settled here, once, from data that no setting can change. A rate whose
     denominator is zero is `null` rather than a number: there is no percentage of nothing, and a
     card that printed one would be inventing the one figure a funnel exists to report. */
  for (const s of stages) {
    const prev = s.i > 0 ? stages[s.i - 1].value : null;
    s.rate = s.i === 0 ? null : (prev > 0 ? s.value / prev : null);
    s.overall = stages[0].value > 0 ? s.value / stages[0].value : null;
    s.grew = s.i > 0 && s.value > stages[s.i - 1].value;
  }

  return {
    stages, refused, negatives, dupLabels,
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
 * A non-finite number in a polygon's points list is silent: the browser drops the whole attribute
 * and the band renders as nothing, with nothing in the console. Throwing turns that into a build
 * failure beside the input that caused it.
 *
 * @param v the coordinate
 * @throws {Error} when v is not a finite number
 *
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/funnel: non-finite coordinate (' + v + ')');
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

/** A display-list polygon; the caller owns the point list because only the caller knows the shape. */
function mPoly(pts, attrs) {
  var d = '', i, k;
  for (i = 0; i < pts.length; i++) { d += (i ? ' ' : '') + fin(pts[i][0]) + ',' + fin(pts[i][1]); }
  var a = { points: d };
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'polygon', a: a };
}

/**
 * A rate as a percentage, or an em dash when there is no rate to state.
 *
 * A retention rate whose denominator is zero does not exist. Printing a zero for it, or a hundred
 * per cent, or the word for a number that is not one, are three different ways of inventing the
 * single figure a funnel is drawn to report - so the answer is a dash, and the caption counts how
 * many dashes there are and why.
 *
 * @param r a ratio in 0..1, or null when the previous stage was zero
 *
 * @example pct(0.625);   // '62.5%'
 * @example pct(null);    // an em dash
 */
function pct(r) {
  if (r === null || r === undefined || !isFinite(r)) { return '\u2014'; }
  return CK.fmt(r * 100) + '%';
}

/**
 * Settle a settings object that may have come out of `localStorage`, which the viewer can edit.
 *
 * Every value is re-vetted against the fallbacks shipped in the payload rather than against a second
 * copy of them written here, so a hand-edited value cannot reach the geometry as something the
 * geometry does not understand.
 *
 * @param cfg  whatever `CK.settings` handed back
 * @param dflt the payload's copy of {@link defaults}
 * @returns a settings object every field of which is safe to compute with
 *
 * @example fnCfg({ shape: 'cone' }, { shape: 'funnel', rates: true, labels: 'auto' }).shape;  // 'funnel'
 */
function fnCfg(cfg, dflt) {
  var c = cfg || {}, d = dflt || {};
  var shape = c.shape === 'funnel' || c.shape === 'bars' ? c.shape : d.shape;
  var labels = c.labels === 'auto' || c.labels === 'all' || c.labels === 'none' ? c.labels : d.labels;
  return { shape: shape, rates: c.rates == null ? !!d.rates : !!c.rates, labels: labels };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label IS the chart to anyone using one - and
 * a funnel's content is its rates, which are the thing a shape cannot convey anyway, so the label
 * states them in full for the first several stages.
 *
 * The caption states the area problem unconditionally, names which dimension is encoded, and names
 * any stage that grew. A growing stage is not a rendering edge case: it means the data is wrong or
 * the stages are not nested, and a card that mentioned it only in passing would be helping to hide
 * the most useful thing on it.
 *
 * @param P    the shipped payload
 * @param cfg  the settled settings
 * @param drew what the geometry settled: `{ clipped, stride, narrow, band, values }`
 * @returns `{ aria, caption }` - plain text and escaped markup respectively
 */
function fnNote(P, cfg, drew) {
  var st = P.stages, n = st.length, unit = P.unit ? ' ' + P.unit : '', i;

  var refusals = [];
  if (P.negatives) {
    refusals.push('<i>' + CK.esc(String(P.negatives)) + ' negative stage' +
                  (P.negatives === 1 ? '' : 's') + ' refused</i> - a width has no sign, so a ' +
                  'negative would be drawn as a positive one and no reader could tell');
  }
  if (P.refused) {
    refusals.push('<i>' + CK.esc(String(P.refused)) + ' stage' + (P.refused === 1 ? '' : 's') +
                  ' refused</i> for not carrying a finite number - counted, never coerced to zero');
  }

  if (!n) {
    return {
      aria: 'Funnel with no stages: ' + (P.refused + P.negatives
        ? 'every entry was refused, ' + P.refused + ' for not being a finite number and ' +
          P.negatives + ' for being negative.'
        : 'nothing was supplied.'),
      caption: 'a funnel with <b>no stages</b> - the frame is drawn so the card keeps its place. ' +
        (refusals.length ? refusals.join('; ') + '. ' : '') +
        'there is no retention here to report.',
    };
  }

  var grew = 0, zeros = 0, undef = 0, vmax = 0;
  for (i = 0; i < n; i++) {
    if (st[i].grew) { grew++; }
    if (st[i].value === 0) { zeros++; }
    if (i > 0 && st[i].rate === null) { undef++; }
    if (st[i].value > vmax) { vmax = st[i].value; }
  }
  var last = st[n - 1];
  var flat = n > 1 && !grew && st[0].value === last.value;

  var aria = 'Funnel of ' + n + ' stage' + (n === 1 ? '' : 's') + ', in the order given, drawn as ' +
    (cfg.shape === 'bars' ? 'centred bars whose width and area are both the value'
                          : 'bands whose width is the value') + '. ';
  for (i = 0; i < n && i < 10; i++) {
    aria += st[i].label + ' ' + CK.fmt(st[i].value) + unit +
            (i > 0 ? ', ' + (st[i].rate === null ? 'no rate, the stage before it was zero'
                                                 : pct(st[i].rate) + ' of the stage before') : '') +
            '. ';
  }
  if (n > 10) { aria += 'The remaining ' + (n - 10) + ' stages are in the tooltips. '; }
  if (n > 1) {
    aria += 'Overall ' + (last.overall === null ? 'there is no overall rate, because the first ' +
      'stage was zero' : pct(last.overall) + ' of the first stage reaches the last') + '. ';
  }
  if (grew) {
    aria += grew + ' stage' + (grew === 1 ? ' is' : 's are') + ' larger than the stage before, ' +
            'which a funnel cannot be. ';
  }

  /* The area sentence, which is the reason this card exists in the form it does. */
  var area = cfg.shape === 'bars'
    ? 'drawn as <i>bars</i>: each stage is a centred rectangle of constant height, so its <b>area ' +
      'is its width is its value</b> and there is no averaging anywhere. this is the shape to check ' +
      'a surprising funnel against'
    : '<b>width</b> is the value. the band between two stages is a trapezoid, and a trapezoid area ' +
      'is its height times the <i>mean of its two widths</i> - so the ink of a band stands for the ' +
      'average of the stage before and the stage after, which is a number nobody measured and one ' +
      'that always flatters a collapse. the last band is the exception: with no successor to average ' +
      'with it is a rectangle, and its area really is its value. switch <i>shape</i> to bars to make ' +
      'that true of every stage';

  var doubts = [];
  for (i = 0; i < refusals.length; i++) { doubts.push(refusals[i]); }
  if (grew) {
    var names = [];
    for (i = 0; i < n; i++) { if (st[i].grew) { names.push(st[i].label); } }
    doubts.push('<b>' + CK.esc(String(grew)) + ' stage' + (grew === 1 ? '' : 's') + ' grew</b> (' +
                CK.esc(names.slice(0, 4).join(', ')) + (names.length > 4 ? ', and more' : '') +
                ') - a funnel cannot grow, so either the numbers are wrong, the stages are not ' +
                'nested inside one another, or this is a sequence of independent measurements and ' +
                'not a funnel; the widening band is drawn and outlined rather than clamped, because ' +
                'clamping it would destroy the evidence');
  }
  if (undef) {
    doubts.push(CK.esc(String(undef)) + ' rate' + (undef === 1 ? '' : 's') + ' cannot be computed ' +
                'because the stage before ' + (undef === 1 ? 'it was' : 'them was') + ' zero, and ' +
                'show a dash - there is no percentage of nothing, and printing a zero for one would ' +
                'invent the only figure a funnel exists to report');
  }
  if (zeros) {
    doubts.push(CK.esc(String(zeros)) + ' stage' + (zeros === 1 ? ' is' : 's are') +
                ' exactly zero and draw' + (zeros === 1 ? 's' : '') + ' no width at all; a short ' +
                'centre tick marks ' + (zeros === 1 ? 'it' : 'them') + ', because a stage that ' +
                'measured nothing and a stage that is not here must not look the same');
  }
  if (flat) {
    doubts.push('every stage retains all of the one before it, so this is a pipe rather than a ' +
                'funnel - which is a real finding and not a drawing fault');
  }
  if (drew.narrow) {
    doubts.push(CK.esc(String(drew.narrow)) + ' stage' + (drew.narrow === 1 ? ' is' : 's are') +
                ' drawn under ' + CK.esc(String(P.thinPx)) + 'px wide, which is where a stage stops ' +
                'being visible; the numbers are still in the tooltips');
  }
  if (P.dupLabels) {
    doubts.push(CK.esc(String(P.dupLabels)) + ' stage name' + (P.dupLabels === 1 ? '' : 's') +
                ' appear' + (P.dupLabels === 1 ? 's' : '') + ' more than once; equal names are ' +
                'separate stages and were not merged');
  }
  if (drew.clipped) {
    doubts.push(CK.esc(String(drew.clipped)) + ' stage name' + (drew.clipped === 1 ? '' : 's') +
                ' had to be cut to fit, marked with an ellipsis; the whole text is in the tooltip');
  }
  if (drew.stride > 1) {
    doubts.push('there is not room for every name, so only every ' + CK.esc(String(drew.stride)) +
                'th is printed - every stage is still drawn');
  }
  if (n === 1) {
    doubts.push('one stage has nothing to retain from, so there is no rate at all - a funnel of one ' +
                'is a single number wearing a shape');
  }

  var caption = '<b>' + CK.esc(String(n)) + '</b> stage' + (n === 1 ? '' : 's') +
    ', in the order given, from <b>' + CK.esc(CK.fmt(st[0].value)) + '</b>' + CK.esc(unit) +
    (n > 1 ? ' down to <b>' + CK.esc(CK.fmt(last.value)) + '</b>' + CK.esc(unit) + ' - <b>' +
             CK.esc(pct(last.overall)) + '</b> of the first' : '') + '. ' +
    area + '. ' +
    'the dashed envelope is the largest stage at ' + CK.esc(CK.fmt(vmax)) + CK.esc(unit) +
    '; every width is a fraction of it. ' +
    (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * The stage geometry is returned alongside the display list rather than only baked into it, because
 * the arithmetic is the thing worth testing here - that a drawn width really is proportional to its
 * value and that each printed rate really is the quotient of two stage values - and a test that had
 * to read polygons back out of markup would be testing its own parser.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settings, which may have come from `localStorage` and are re-vetted by {@link fnCfg}
 * @returns `{ W, H, marks, note, cfg, rows }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input: unusable stages were refused and counted while reading
 *
 * @example fnRender(P, { shape: 'funnel', rates: true, labels: 'auto' }).rows.length;
 */
function fnRender(P, cfg) {
  var c = fnCfg(cfg, P.dflt);
  var st = P.stages, n = st.length;
  var marks = [], i;

  var vmax = 0;
  for (i = 0; i < n; i++) { if (st[i].value > vmax) { vmax = st[i].value; } }

  var labelW = 0;
  if (c.labels !== 'none') {
    for (i = 0; i < n; i++) { labelW = Math.max(labelW, Math.min(P.labelPx, tw(st[i].label))); }
  }

  var padT = 14;
  var padB = 20;
  var padL = Math.round(labelW) + (c.labels === 'none' ? 8 : 12);
  var padR = c.rates ? P.ratePx : 14;

  /* Height is the free dimension - the desk scrolls downward - up to a cap, past which the bands
     thin rather than the card growing to three screens nobody reaches the bottom of. */
  var room = P.hmax - padT - padB;
  var band = n ? Math.max(P.bandMin, Math.min(P.band, room / n)) : P.band;
  var W = P.W0;
  var H = Math.max(140, Math.round(padT + padB + n * band));

  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  var plotW = plot.x1 - plot.x0;
  var cx = (plot.x0 + plot.x1) / 2;

  /* The envelope: the full width, which is the largest stage. Without it a reader has no idea what
     a width is a fraction OF, and the first stage is not always the largest - a funnel that grew
     puts its maximum somewhere in the middle. */
  marks.push(mRect(plot.x0, plot.y0, plotW, Math.max(0, plot.y1 - plot.y0),
                   { fill: 'none', 'class': 'ck-envelope' }));

  var wOf = function (v) { return vmax > 0 ? v / vmax * plotW : 0; };
  var stride = band > 0 ? Math.max(1, Math.ceil(11 / band)) : 1;
  var drew = { clipped: 0, stride: stride, narrow: 0, band: band, values: 0 };
  var rows = [];

  for (i = 0; i < n; i++) {
    var s = st[i];
    var wTop = wOf(s.value);
    var wBot = wOf(i + 1 < n ? st[i + 1].value : s.value);
    var yTop = plot.y0 + i * band;
    var yBot = yTop + band;
    var yMid = yTop + band / 2;
    var kids = [];
    var colour = CK.hue(i);

    if (s.value > 0 && wTop < P.thinPx) { drew.narrow++; }

    if (c.shape === 'bars') {
      /* Constant height, width proportional to the value: area is width is value, with no averaging
         between neighbours anywhere on the card. */
      kids.push(mRect(cx - wTop / 2, yTop + 2, wTop, Math.max(1, band - 4),
                      { fill: colour, 'class': 'ck-band' }));
    } else {
      kids.push(mPoly([[cx - wTop / 2, yTop], [cx + wTop / 2, yTop],
                       [cx + wBot / 2, yBot], [cx - wBot / 2, yBot]],
                      { fill: colour, 'class': 'ck-band' }));
    }

    /* A stage that grew is outlined rather than clamped. Clamping it to its predecessor would draw
       a plausible funnel out of impossible data, and the impossibility is the finding. */
    if (s.grew) {
      if (c.shape === 'bars') {
        kids.push(mRect(cx - wTop / 2, yTop + 2, wTop, Math.max(1, band - 4),
                        { fill: 'none', 'class': 'ck-grow' }));
      } else {
        kids.push(mPoly([[cx - wTop / 2, yTop], [cx + wTop / 2, yTop],
                         [cx + wBot / 2, yBot], [cx - wBot / 2, yBot]],
                        { fill: 'none', 'class': 'ck-grow' }));
      }
    }

    /* A stage of exactly zero has no width to draw, so it gets a short centre tick. An absent stage
       has no row at all, and the two must not look the same. */
    if (s.value === 0) {
      kids.push(mLine(cx - 2.5, yMid, cx + 2.5, yMid, 'ck-zero'));
    }

    /* The stage name, in the left gutter. Thinned when the bands are shorter than a line of text,
       never overprinted. */
    if (c.labels !== 'none' && i % stride === 0) {
      var shown = clipTo(s.label, P.labelPx);
      if (shown !== s.label) { drew.clipped++; }
      marks.push(mText(plot.x0 - 6, yMid + 3.2, shown, 'ck-tk', 'end'));
    }

    /* The value: inside the band when the band can hold it, just outside on the right when it
       cannot. In all mode it is drawn outside rather than dropped. */
    var txt = CK.fmt(s.value) + (P.unit ? ' ' + P.unit : '');
    if (c.labels !== 'none' && band >= 11) {
      var inner = Math.min(wTop, wBot);
      if (inner >= tw(txt) + 8) {
        marks.push(mText(cx, yMid + 3.2, txt, 'ck-val-in', 'middle'));
        drew.values++;
      } else if (c.labels === 'all' || Math.max(wTop, wBot) / 2 + tw(txt) + 8 < plotW / 2) {
        marks.push(mText(cx + Math.max(wTop, wBot) / 2 + 5, yMid + 3.2, txt, 'ck-val', 'start'));
        drew.values++;
      }
    }

    /* The stage-to-stage rate, in the right gutter, level with the boundary it describes. */
    if (c.rates && i > 0 && band >= 9) {
      marks.push(mText(plot.x1 + 6, yTop + 3.2, pct(s.rate), s.grew ? 'ck-rate-up' : 'ck-rate', 'start'));
    }

    var hit = mRect(plot.x0, yTop, Math.max(1, plotW), band,
                    { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
    hit.ti = s.label + '  \u00b7  ' + CK.fmt(s.value) + (P.unit ? ' ' + P.unit : '') +
             (i > 0 ? '  \u00b7  ' + pct(s.rate) + ' of ' + st[i - 1].label : '') +
             '  \u00b7  ' + pct(s.overall) + ' of ' + st[0].label +
             (s.grew ? '  \u00b7  larger than the stage before it' : '');
    kids.push(hit);

    rows.push({ label: s.label, value: s.value, wTop: wTop, wBot: wBot,
                rate: s.rate, overall: s.overall, grew: s.grew, y: yTop, band: band });
    marks.push({ t: 'g', a: { 'data-stage': String(i), 'class': 'ck-ser' }, kids: kids });
  }

  if (!n) {
    marks.push(mText(cx, (plot.y0 + plot.y1) / 2, 'no stages', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, cfg: c, rows: rows, note: fnNote(P, c, drew) };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The functions the browser needs, in dependency order. Shipped as their own source rather than
   restated, so the thing this module tested is textually the thing that runs. */
const SHIPPED = [fin, tw, clipTo, mLine, mText, mRect, mPoly, pct, fnCfg, fnNote, fnRender];

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a string holding a closing script tag cannot end the block early,
 * and so that no stage name can put an arrow function's two characters into a file that is
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
  const own = '.ck-funnel[data-card="' + id + '"]';
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
    ['.ck-plot .ck-rate', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    /* A hairline in the ground colour between the bands, so two neighbouring stages of similar hue
       are still two stages. A separator rather than a border: a stroke of its own colour would
       thicken every band and quietly break the proportionality the card claims. */
    ['.ck-plot .ck-band', 'stroke: var(--ground); stroke-width: 0.6;'],
    ['.ck-plot .ck-envelope', 'stroke: var(--rule); stroke-width: 1; stroke-dasharray: 2 4; fill: none;'],
    /* A stage that grew: outlined in the accent, and its rate printed in the accent too, so the one
       thing on the card that means the data is wrong is the one thing that catches the eye. */
    ['.ck-plot .ck-grow', 'stroke: var(--accent); stroke-width: 1.4; stroke-dasharray: 3 2; fill: none;'],
    ['.ck-plot .ck-rate-up', 'fill: var(--accent);'],
    ['.ck-plot .ck-zero', 'stroke: var(--ink-dim); stroke-width: 1.4; fill: none;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    /* The value set over a filled band carries a halo in the ground colour rather than assuming the
       fill is light or dark - it is one or the other in each theme. */
    ['.ck-plot .ck-val-in',
     'fill: var(--ink); paint-order: stroke; stroke: var(--ground); stroke-width: 2.6px; ' +
     'stroke-linejoin: round;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-funnel">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="funnel settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('shape') + '">shape</label>\n' +
    '    <select id="' + f('shape') + '" name="shape">' +
         opt('funnel', 'funnel: width is the value', defaults.shape) +
         opt('bars', 'bars: width and area are the value', defaults.shape) + '</select>\n' +
    '    <label for="' + f('rates') + '">rates</label>\n' +
    '    <input id="' + f('rates') + '" name="rates" type="checkbox"' +
           (defaults.rates ? ' checked' : '') + '>\n' +
    '    <label for="' + f('labels') + '">labels</label>\n' +
    '    <select id="' + f('labels') + '" name="labels">' +
         opt('auto', 'names and values that fit', defaults.labels) +
         opt('all', 'always, outside if needed', defaults.labels) +
         opt('none', 'none', defaults.labels) + '</select>\n' +
    '    <p class="ck-set-foot">in funnel shape the band between two stages is a trapezoid, and its ' +
         'area stands for the average of the two - which flatters a collapse. Bars give every stage ' +
         'a constant height, so area and width are both the value. The stages are never reordered: ' +
         'a funnel is a sequence.</p>\n' +
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
 * @param payload the shipped stages and the constants the geometry needs
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload) {
  const src =
    '/* funnel card: the widths, the stage-to-stage rates and the growth flags were all computed in\n' +
    '   Node from the whole stage list. The functions below are the ones that drew the card that\n' +
    '   shipped, emitted as their own source, so switching between the funnel and the bars re-runs\n' +
    '   the code the caption describes rather than a second implementation of it. */\n' +
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
    '     stays a translator rather than a second place where funnel decisions live. */\n' +
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
    '     render that added marks would stack a second funnel on the first every swap. */\n' +
    '  function render(cfg) {\n' +
    '    var out = fnRender(P, cfg), i;\n' +
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

  return guardJs(src, 'cardkit/funnel');
}

/**
 * Build one funnel card from one data block.
 *
 * Degenerate inputs and what they draw:
 *
 *   no stages          an empty frame captioned "no stages"; nothing is invented
 *   one stage          one full-width band and no rate at all, because there is nothing to retain
 *                      from - the caption says a funnel of one is a number wearing a shape
 *   two equal values   a straight-sided band at 100% retention
 *   all values equal   a rectangle, captioned as a pipe rather than a funnel, which is a finding
 *   every stage zero   no width anywhere; every stage gets its centre tick and every rate is a dash,
 *                      since there is no percentage of nothing
 *   a stage of zero    no width, a centre tick so it is not mistaken for an absent stage, and a dash
 *                      for the rate of whatever follows it
 *   a stage that grows drawn widening, outlined in the accent, its rate printed in the accent, and
 *                      counted and named in the caption. It is never clamped: clamping would draw a
 *                      plausible funnel out of impossible data and destroy the finding
 *   a negative value   refused and counted - a width has no sign, so a negative would be drawn as a
 *                      positive and no reader could tell
 *   a non-numeric      refused and counted, never coerced to zero
 *   200 stages         bands thin to the height cap, names print every k-th, every stage still drawn
 *   a very long label  clipped with an ellipsis, counted, whole text in the tooltip
 *   1000x a neighbour  the later stages become hairlines, which the caption counts rather than hides
 *   duplicate labels   kept as separate stages, counted, and named
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ stages: [{ label, value }], unit }` - see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused and counted
 *
 * @example
 * build({
 *   id: 'signup',
 *   title: 'signup funnel, last 30 days',
 *   data: { unit: 'people',
 *           stages: [{ label: 'visited', value: 12400 },
 *                    { label: 'started', value: 3100 },
 *                    { label: 'finished', value: 940 }] },
 *   ord: 20,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'funnel' : id);
  const read = readData(data);

  const P = {
    W0, band: BAND, bandMin: BAND_MIN, hmax: HMAX, labelPx: LABEL_PX, ratePx: RATE_PX,
    thinPx: THIN_PX,
    unit: read.unit,
    stages: read.stages,
    refused: read.refused,
    negatives: read.negatives,
    dupLabels: read.dupLabels,
    dflt: { ...defaults },
  };

  const seed = fnRender(P, defaults);
  const grew = read.stages.filter((s) => s.grew).length;

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      stages: read.stages.length,
      refused: read.refused + read.negatives,
      grew,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed),
    css: cardCss(cardId),
    js: cardJs(cardId, P),
  };
}

export default { meta, build };
