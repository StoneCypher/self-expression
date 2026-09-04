/**
 * `velocity` — throughput per iteration, with the warning label attached to it.
 *
 * THIS CARD IS A LOADED GUN AND ITS CAPTION SAYS SO BEFORE IT SAYS ANYTHING ELSE. That is not a
 * tone; it is the first sentence of the rendered output, above the numbers, because velocity is
 * routinely used for three things it is invalid for and the picture on its own encourages all three.
 *
 *   - **It is not a productivity measure.** It counts units of the team's own estimation currency,
 *     not units of value or of work. A team that delivers the same software with different estimates
 *     has a different velocity and identical output.
 *   - **It does not compare between teams.** A story point is calibrated inside one team against
 *     that team's own reference stories. Comparing two teams' velocities compares their estimation
 *     habits — how coarsely they round, what they call a one — and nothing else. There is no
 *     conversion factor, and the fact that both numbers are printed in the same font is the whole
 *     illusion.
 *   - **The moment it becomes a target it stops measuring anything.** Points are produced by the
 *     same people being measured by them, so a velocity target is satisfied by inflating estimates,
 *     which is cheaper than any other way of satisfying it. This is Goodhart's law with an unusually
 *     short feedback loop.
 *
 * So there is deliberately no target line, no setting that adds one, and a `target` in the data is
 * refused by name rather than drawn. A card that draws the line is a card that gets screenshotted
 * into a review deck with the line on it.
 *
 * WHAT IT DRAWS INSTEAD OF AN AVERAGE. A rolling BAND — the minimum and maximum over a trailing
 * window — rather than a rolling mean. A mean of five skewed observations is a number pretending to
 * be a forecast; the range is the honest summary of the same five numbers and it is the summary that
 * makes its own uncertainty visible. When there are too few iterations to fill the window the band is
 * refused outright and the minimum is named, because a band computed from two points is a line
 * segment wearing a band's clothes.
 *
 * AND IT DRAWS THE ITEM COUNT BESIDE THE POINTS, in its own lane with its own scale, whenever the
 * data carries both. Count is immune to point inflation: it is the one series on this card that a
 * team cannot move by changing how it estimates. When the two series disagree in trend — points
 * rising while count falls, or the reverse — that disagreement is the most interesting thing on the
 * card, and it gets a banner rather than a footnote. Rising points with flat count is what estimate
 * inflation looks like from the outside.
 *
 * THIS IS THE WORST OF THE THREE TOOLS IN THIS CATALOGUE FOR PREDICTING A DATE AND THE MOST
 * COMMONLY USED FOR IT. `montecarlo` resamples historical throughput and answers with a range and a
 * confidence; `cycletime` shows how long single items actually take, including the tail that a mean
 * velocity silently deletes. Velocity multiplied by an average is a point estimate with no interval
 * around it, which is the specific form of wrong that gets committed to in a planning meeting. The
 * caption says this, in those words, the way `gauge` names `bullet`.
 *
 * Everything geometric is computed by {@link vRender}, the same function in Node and in the browser:
 * Node runs it once for the picture inside `card.html`, and the browser re-runs it when the reader
 * changes the window, so the caption's stated method can never come apart from the drawn band. `CK`
 * comes out of `kit.js` in a `node:vm` context.
 *
 * @see ./montecarlo.mjs — the forecast this card must not be used as; a range and a confidence
 * @see ./cycletime.mjs  — per-item latency, with the tail that an average velocity deletes
 * @see ./burndown.mjs   — the same iteration from inside, with scope change made visible
 * @see ../CONTRACT.md   — `shape` is a string, `defaults` is an object, `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be imported.
 * Loading it rather than re-implementing `scale` and `ticks` is the contract's rule: a private copy
 * is a second source of truth and it drifts silently — the gridlines stop matching the axis and
 * nothing errors.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().ticks(0, 97, 5);    // [0, 20, 40, 60, 80] — 100 is past max
 * @example loadKit().ticks(0, 100, 5);   // [0, 50, 100]
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/velocity: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/velocity: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const WMAX = 2200;

/** A cap on the PAYLOAD, not on the arithmetic: the caption counts the whole input first. */
const ITERCAP = 400;

/**
 * The smallest window a band is allowed to be computed over.
 *
 * Three, and it is a judgement rather than a theorem. Two observations have a range but no shape —
 * every pair of numbers is a perfectly straight trend and a perfectly wide band, so the picture would
 * carry no information the two columns did not already carry. Three is the point at which a range
 * starts to be a claim about variation rather than a restatement of two values.
 */
const MINWIN = 3;

/**
 * Every setting this card understands, with its fallback.
 *
 * There is NO target setting and there never will be one. The moment a target is drawn, the card
 * stops being a description of what happened and becomes an instrument for making points inflate;
 * a switch for it would eventually be found switched on in the review where it mattered.
 *
 * `window` is settable because the band's method is a genuine choice with a genuine trade-off — a
 * short window tracks recent change and a long one is less jumpy — and the caption states whichever
 * one is in force, so the reader is never looking at a band whose method they cannot see.
 *
 * @example defaults.window;   // 3
 */
export const defaults = { window: 3, counts: true, median: true };

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `work-and-lists` — "what is outstanding, and what can I do about it?" — and the choice is worth
 * arguing rather than asserting, because `evolution` ("what changed over time?") has a real claim on
 * it: this is literally a time series of a measured quantity. What settles it is who arrives at the
 * card and why. Nobody opens a velocity chart to find out what changed; they open it to decide how
 * much to take into the next iteration, which is a capacity question about outstanding work. The
 * category indexes the question rather than the silhouette, and the answer to "how much can we take
 * on" is the one this card is for — including, loudly, that it is a poor way to answer it.
 *
 * `target` appears in `shape` even though it is never drawn, because a caller who has one needs to
 * know that this card will refuse it rather than silently ignoring it.
 */
export const meta = {
  name: 'velocity',
  summary:
    'Throughput per iteration as columns under a rolling min-max band, with item count beside ' +
    'points, and a caption that leads with what velocity cannot be used for.',
  shape:
    '{ iterations: [{ id, label, points, count }], unit, target } — count is items completed and ' +
    'is immune to point inflation; target is REFUSED rather than drawn, and the caption says why',
  category: 'work-and-lists',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one card in
 * this catalogue was refused because a comment said "the class is what CSS reads" — and a guard that
 * cries wolf is a guard somebody switches off. Offsets are preserved so a reported position still
 * points at the right place. Regex literals are recognised, because otherwise the scanner
 * desynchronises on the quote inside `replace(/'/g, x)` and starts blanking real code, which turns a
 * false positive into a far worse false negative.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, comment and string contents replaced by spaces
 *
 * @example blankNonCode('var a = "const";').indexOf('const');   // -1
 */
export function blankNonCode(src) {
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
 * Refuse to emit browser script that would break the whole desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in a
 * comment as readily as in code, because `Function.prototype.toString()` ships comments verbatim —
 * closes the surrounding template literal early and blanks every card on the desk. The backtick is
 * never written in this file; it is reached for as `String.fromCharCode(96)`.
 *
 * Backtick, arrow and optional chaining are scanned raw, because none of them can appear innocently.
 * The declaration keywords are scanned only after {@link blankNonCode}.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/velocity';
  const near = (at) => src.slice(Math.max(0, at - 45), at + 45);
  const die = (what, at) => {
    throw new Error(where + ': emitted js ' + what + ' at offset ' + at + ' - near: ' + near(at));
  };

  const tick = src.indexOf(String.fromCharCode(96));
  if (tick >= 0) die('contains a backtick', tick);

  const arrow = src.indexOf(String.fromCharCode(61) + String.fromCharCode(62));
  if (arrow >= 0) die('contains an arrow function', arrow);

  const opt = src.indexOf(String.fromCharCode(63) + String.fromCharCode(46));
  if (opt >= 0) die('contains optional chaining', opt);

  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) die('contains control character ' + c, i);
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
 * Strip the bytes that are legal in a string and illegal on a page.
 *
 * `CK.esc` drops these on the way into markup, which covers the caption and the tooltips but not the
 * payload the browser is handed as a JavaScript literal. `JSON.stringify` escapes everything below
 * 0x20 and leaves DEL alone, so a label carrying one would put a raw control byte into the emitted
 * script and the build-time guard would refuse the whole card.
 *
 * Compared numerically rather than matched against a character class, because writing the class is
 * how the class gets corrupted. Tab, newline and carriage return survive: those are text.
 *
 * @example clean('a' + String.fromCharCode(127) + 'b');   // 'ab'
 */
function clean(v) {
  const raw = String(v == null ? '' : v);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) continue;
    out += raw.charAt(i);
  }
  return out;
}

/**
 * A finite number, or null. Strings are parsed; booleans and everything else are refused.
 *
 * `true` is deliberately not 1. A boolean in a numeric field is a bug in whatever produced the data,
 * and coercing it produces an iteration that delivered exactly one point out of nowhere.
 *
 * The boolean guard and the trip through `String()` are independent defences and either one alone
 * refuses a boolean — mutation testing found that removing either is an equivalent edit. The guard
 * stays because it states the intent where a reader will look for it, but the load is carried by
 * never handing a non-number straight to `Number`.
 *
 * @example readNum('12');    // 12
 * @example readNum(true);    // null
 * @example readNum('lots');  // null
 */
function readNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise whatever arrived into the iteration series the renderer may assume.
 *
 * Nothing throws and nothing is coerced. Every malformed input becomes a refusal that is counted and
 * named in the caption:
 *
 *   - a negative points figure is refused, not made positive: negative throughput is not a thing
 *     that happened, it is a sign error or a subtraction somebody meant to do elsewhere;
 *   - an unparseable points figure is refused rather than read as zero, because a zero iteration is
 *     a real and rather serious claim about a team and inventing one is a slander;
 *   - a refused iteration KEEPS ITS SLOT as a gap rather than being deleted from the series. The
 *     window is over trailing slots, so closing the gap would quietly compute a band across a
 *     discontinuity and draw it as though the iterations were consecutive;
 *   - a non-integer item count is refused: a count is a number of things;
 *   - duplicate ids collapse to the first, and ONLY when ids were actually given. Without an `id` an
 *     iteration's identity is its position, so two iterations sharing a label is legal — that is
 *     what the all-identical case looks like — and the caption notes the repeated axis labels
 *     instead;
 *   - a `target` anywhere in the data is refused by name and never drawn.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns the payload {@link vRender} takes, plus the counts the caption reports
 *
 * @example readData({ iterations: [{ label: 's1', points: 20 }] }).rows[0].points;   // 20
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.iterations) ? d.iterations : [];

  const refused = [];
  const dupIds = [];
  let badCount = 0;
  let negatives = 0;
  let dropped = 0;

  const ids = new Set();
  const rows = [];
  let anyCount = false;
  let dupLabels = 0;
  const labelSeen = new Set();

  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    if (rows.length >= ITERCAP) { dropped++; continue; }
    if (!it || typeof it !== 'object') {
      refused.push('iteration ' + (i + 1) + ' is not an object');
      rows.push({ id: '', label: 'iteration ' + (i + 1), points: null, count: null });
      continue;
    }

    const id = clean(it.id == null ? '' : it.id).trim();
    const label = clean(it.label == null || it.label === '' ? (id || String(rows.length + 1)) : it.label);
    if (id) {
      if (ids.has(id)) { dupIds.push(id); continue; }
      ids.add(id);
    }
    if (labelSeen.has(label)) dupLabels++;
    labelSeen.add(label);

    let points = readNum(it.points);
    if (points === null && it.points !== undefined && it.points !== null && it.points !== '') {
      refused.push(label + ' has an unreadable points figure');
    } else if (points !== null && points < 0) {
      negatives++;
      refused.push(label + ' reports negative throughput (' + points + '), which is a sign error ' +
                   'rather than an iteration');
      points = null;
    }

    let count = readNum(it.count);
    if (count !== null && (count < 0 || count !== Math.round(count))) {
      badCount++;
      count = null;
    }
    if (count !== null) anyCount = true;

    rows.push({ id, label, points, count });
  }

  const target = d.target === undefined || d.target === null || d.target === '' ? null : readNum(d.target);

  return {
    rows,
    unit: clean(d.unit == null ? '' : d.unit).trim(),
    title: clean(d.title == null ? '' : d.title),
    anyCount, refused, dupIds, dupLabels, badCount, negatives, dropped,
    hadTarget: target !== null || (d.target !== undefined && d.target !== null && d.target !== ''),
    W0, WMAX, MINWIN, ITERCAP,
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────── */
/* Written in the browser's vocabulary from here down to the SHIPPED list — var and function, no
   arrows, no template literals, no backtick and no arrow or optional-chaining sequence in any
   comment — because every one of these is emitted verbatim through Function.prototype.toString()
   and is ALSO run here, in Node, to draw the copy that ships inside card.html. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole attribute and the drawing
 * simply is not there, with nothing in the console.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/velocity: non-finite coordinate (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the card's mono face at `size`, defaulting to 9px. */
function tw(s, size) { return String(s).length * 5.42 * ((size || 9) / 9); }

/** Shorten a label to `max` px, keeping the head and marking the cut with an ellipsis. */
function clipTo(s, max, size) {
  var str = String(s);
  var per = 5.42 * ((size || 9) / 9);
  var room = Math.floor(max / per);
  if (room < 1) { return ''; }
  if (str.length <= room) { return str; }
  return str.slice(0, Math.max(1, room - 1)) + '…';
}

/**
 * A number for display: exact when whole, two decimals otherwise.
 *
 * Fractional points are allowed rather than rounded away. Half-point estimates are a real practice
 * and a card that quietly rounded them would be reporting a different series from the one it was
 * handed — while also, incidentally, hiding the false precision that fractional points usually are.
 *
 * @example fmtN(20);     // '20'
 * @example fmtN(20.5);   // '20.5'
 */
function fmtN(v) {
  if (typeof v !== 'number' || !isFinite(v)) { return '–'; }
  var r = Math.round(v * 100) / 100;
  if (r === Math.round(r)) { return String(Math.round(r)); }
  return String(r);
}

/**
 * Settle a settings object into the three values the renderer may assume.
 *
 * The window is clamped rather than refused, and its floor is the same MINWIN the band refusal uses,
 * so there is exactly one place in this file that decides how small a band is allowed to be. Called
 * with nothing it must return the declared defaults; the verification asserts that, so the shipped
 * copy and the declared metadata cannot drift apart without something failing.
 *
 * @example vConfig({ window: 99 }).window;   // 12
 */
function vConfig(conf, minWin) {
  var c = conf && typeof conf === 'object' ? conf : {};
  var lo = minWin || 3;
  var w = typeof c.window === 'number' && isFinite(c.window) ? Math.round(c.window) : lo;
  if (w < lo) { w = lo; }
  if (w > 12) { w = 12; }
  return {
    window: w,
    counts: c.counts === undefined || c.counts === null ? true : !!c.counts,
    median: c.median === undefined || c.median === null ? true : !!c.median
  };
}

/** The median of a list of numbers, by sorting. Empty gives null rather than NaN. */
function vMedian(list) {
  var s = list.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
  if (!s.length) { return null; }
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The rolling band: minimum, maximum and median over each trailing window.
 *
 * A window is only reported when EVERY slot in it carries a reading. A refused iteration keeps its
 * slot as a gap, so this breaks the band there rather than computing a range across a discontinuity
 * and drawing it as though the iterations either side of the hole were consecutive. The visible
 * break is the honest rendering of "we do not know what happened in between".
 *
 * Min and max rather than a mean and a standard deviation, because with three to twelve observations
 * the range is what the data actually says and everything else is a distributional assumption the
 * data cannot support.
 *
 * @param ys   one value or null per slot
 * @param w    the window length, in slots
 * @returns one entry per slot: `{ lo, hi, med }` or null
 *
 * @example vBand([1, 2, 3], 3)[2].hi;   // 3
 */
function vBand(ys, w) {
  var out = [], i, j, win, ok, v;
  for (i = 0; i < ys.length; i++) {
    if (i < w - 1) { out.push(null); continue; }
    win = []; ok = true;
    for (j = i - w + 1; j <= i; j++) {
      v = ys[j];
      if (v === null || v === undefined) { ok = false; break; }
      win.push(v);
    }
    if (!ok) { out.push(null); continue; }
    var lo = win[0], hi = win[0];
    for (j = 1; j < win.length; j++) {
      if (win[j] < lo) { lo = win[j]; }
      if (win[j] > hi) { hi = win[j]; }
    }
    out.push({ lo: lo, hi: hi, med: vMedian(win) });
  }
  return out;
}

/**
 * The Theil-Sen slope: the median of the slopes between every pair of readings.
 *
 * Chosen over least squares because this card has to survive one enormous iteration without changing
 * its mind about the direction of travel. A single outlier moves a least-squares slope arbitrarily
 * far; it moves a median of pairwise slopes by at most one rank. Since the most interesting output
 * of this card is a DISAGREEMENT between two series' directions, a trend estimator that an outlier
 * can flip would manufacture that finding out of one bad sprint.
 *
 * @param ys one value or null per slot; nulls take no part
 * @returns the slope per slot, or null when there are fewer than two readings
 *
 * @example vSlope([1, 2, 3]);   // 1
 */
function vSlope(ys) {
  var pts = [], i, j, sl = [];
  for (i = 0; i < ys.length; i++) {
    if (ys[i] !== null && ys[i] !== undefined) { pts.push([i, ys[i]]); }
  }
  if (pts.length < 2) { return null; }
  for (i = 0; i < pts.length; i++) {
    for (j = i + 1; j < pts.length; j++) {
      sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    }
  }
  return vMedian(sl);
}

/**
 * Which way a series is going, as minus one, zero or plus one.
 *
 * The slope is normalised by the series' own median and multiplied by its span, so the answer is
 * "the series moved by more than five percent of its typical size across the observed period" rather
 * than "the slope was not exactly zero". Without the deadband every series has a direction and the
 * disagreement banner would fire on noise, which would train the reader to ignore it.
 *
 * @returns `{ dir, rel }` — the direction and the relative movement it was judged on
 *
 * @example vTrend([10, 10, 10]).dir;   // 0
 */
function vTrend(ys) {
  var slope = vSlope(ys), vals = [], i, span = 0, first = -1, last = -1;
  for (i = 0; i < ys.length; i++) {
    if (ys[i] !== null && ys[i] !== undefined) {
      vals.push(ys[i]);
      if (first < 0) { first = i; }
      last = i;
    }
  }
  if (slope === null || vals.length < 3) { return { dir: 0, rel: 0, slope: slope }; }
  span = last - first;
  var mid = vMedian(vals);
  if (!mid) { return { dir: 0, rel: 0, slope: slope }; }
  var rel = slope * span / mid;
  return { dir: rel > 0.05 ? 1 : rel < -0.05 ? -1 : 0, rel: rel, slope: slope };
}

/** The word for a direction, so the caption and the banner cannot describe it differently. */
function vWord(dir) { return dir > 0 ? 'rising' : dir < 0 ? 'falling' : 'flat'; }

/* Display-list primitives. Every mark is { t: tagName, a: attributes, s: text, ti: tooltip,
   kids: [] }, with real SVG attribute names, so the browser-side translator knows nothing about
   iterations and a mark in a debugger reads as the element it becomes. */

function mLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' } };
}

function mText(x, y, s, cls, anchor) {
  return { t: 'text', a: { x: fin(x), y: fin(y), 'class': cls || '', 'text-anchor': anchor || 'start' },
           s: String(s) };
}

function mRect(x, y, w, h, cls, rx) {
  var a = { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)),
            'class': cls || '' };
  if (rx) { a.rx = fin(rx); }
  return { t: 'rect', a: a };
}

function mPath(d, cls) { return { t: 'path', a: { d: d, 'class': cls || '' } }; }

/**
 * Metrics for the drawing. Shipped rather than held in a module constant on purpose.
 *
 * A shipped function that closed over a build-time constant runs in Node and throws a reference
 * error in the browser the moment a setting changes, which is the failure that only shows up on
 * the desk.
 *
 * @example vMetrics().plotH;   // 168
 */
function vMetrics() {
  return { pad: 12, gut: 34, top: 14, plotH: 168, gap: 12, laneH: 46, axisH: 24,
           minPitch: 7, maxCol: 46 };
}

/**
 * The legend, rebuilt with the drawing because it names the window that is currently in force.
 *
 * A legend that still says "3-iteration band" after the reader has set the window to eight is a
 * legend that lies, and this card's one settable value is exactly the one the legend has to state.
 */
function vKey(P, c, R) {
  var bits = [], i;
  bits.push('<i data-k="col"></i>points delivered' + (P.unit ? ' (' + CK.esc(P.unit) + ')' : ''));
  if (R.bandOk) {
    bits.push('<i data-k="band"></i>rolling range, lowest to highest over ' + c.window +
              ' iterations');
    if (c.median) { bits.push('<i data-k="med"></i>rolling median of the same window'); }
  }
  if (R.hasCounts) {
    bits.push('<i data-k="cnt"></i>items completed, on its own scale &mdash; immune to point ' +
              'inflation');
  }
  /* Every entry closes with a full stop INSIDE its span. On screen the stop is a nine-pixel
     nothing; flattened, it is the only thing stopping the last legend entry running straight into
     the caption's first word. */
  for (i = 0; i < bits.length; i++) { bits[i] = '<span>' + bits[i] + '.</span>'; }
  /* Joined with a space rather than with nothing. The legend is a flex row, so a whitespace-only
     text node between two entries is dropped on screen and costs exactly nothing — and without it
     the flattened form a screen reader or a copy-paste receives reads
     "points deliveredrolling range". Nothing looks wrong; everything sounds wrong. */
  return bits.join(' ');
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * THE WARNING IS THE FIRST THING IN THE CAPTION AND IT IS NOT CONDITIONAL. Everything else about
 * this card is a description of some data; that paragraph is a description of the measure, and the
 * measure is what gets misused. Putting it after the numbers would put it after the point at which
 * a reader has already decided what the picture means.
 *
 * Every bit ends in a full stop, including the ones inside a span. These are joined with a single
 * space and read back as one flattened string by screen readers and by anyone who copies the card,
 * and a bit without a terminal stop runs its last word into the next bit's first.
 *
 * @returns `{ aria, caption, key }`
 */
function vNote(P, c, R) {
  var rows = P.rows, n = rows.length, bits = [], i;

  var LEAD =
    '<b>Read this first.</b> Velocity is a capacity estimate calibrated to one team&rsquo;s own ' +
    'point scale, and it is invalid for the three things it is most often used for. It is ' +
    '<i>not a productivity measure</i>: it counts units of the team&rsquo;s own estimation ' +
    'currency, not units of work or of value. It <i>does not compare between teams</i>, because a ' +
    'point is calibrated inside one team against that team&rsquo;s own reference stories, so ' +
    'comparing two velocities compares their estimation habits and nothing else. And <i>the moment ' +
    'it becomes a target it stops measuring anything</i>, because points are produced by the same ' +
    'people the target is aimed at, and inflating an estimate is cheaper than any other way of ' +
    'meeting one.';

  var ASIDE =
    '<span class="ck-aside">For predicting a date this is the worst of the three tools in this ' +
    'catalogue and by far the most commonly used for it. <b>montecarlo</b> resamples this same ' +
    'history and answers with a range and a confidence; <b>cycletime</b> shows how long single ' +
    'items actually took, including the tail that an average velocity deletes. Velocity times an ' +
    'average is a point estimate with no interval around it, which is the shape of wrong that gets ' +
    'committed to in a planning meeting.</span>';

  if (!n) {
    return {
      aria: 'Velocity chart with no iterations. Velocity is a capacity estimate calibrated to one ' +
            'team scale; it is not a productivity measure and does not compare between teams.',
      caption: LEAD + ' There are <b>no iterations</b> in this data, so there is nothing to draw. ' +
               (P.refused.length ? '<i>' + P.refused.length + ' input' +
                 (P.refused.length === 1 ? '' : 's') + ' refused</i>: ' +
                 CK.esc(P.refused.slice(0, 3).join('; ')) + '. ' : '') + ASIDE,
      key: ''
    };
  }

  bits.push('<b>' + n + '</b> iteration' + (n === 1 ? '' : 's') + ', <b>' + R.readings +
            '</b> of them with a readable figure' +
            (R.readings ? ', from <b>' + CK.esc(fmtN(R.minPts)) + '</b> to <b>' +
                          CK.esc(fmtN(R.maxPts)) + '</b>' + (P.unit ? ' ' + CK.esc(P.unit) : '') : '') +
            '.');

  if (R.bandOk) {
    bits.push('the band is the <b>lowest and highest</b> value over each trailing window of <b>' +
              c.window + '</b> iterations &mdash; a <i>range</i>, not a mean. A mean of ' + c.window +
              ' skewed observations is a number pretending to be a forecast; the range is what the ' +
              'same observations actually say, and it shows its own uncertainty instead of hiding ' +
              'it.' + (R.bandBreaks ? ' It breaks in <b>' + R.bandBreaks + '</b> place' +
                       (R.bandBreaks === 1 ? '' : 's') + ' where a window contains an iteration ' +
                       'with no reading, rather than spanning the hole.' : ''));
  } else {
    bits.push('<b>no band is drawn.</b> A rolling range needs at least <b>' + c.window +
              '</b> consecutive iterations with a reading and there ' +
              (R.readings === 1 ? 'is <b>1</b>' : 'are <b>' + R.readings + '</b>') +
              '. Two points have a range but no shape &mdash; every pair is a perfectly straight ' +
              'trend and a perfectly wide band &mdash; so the band is refused rather than computed ' +
              'from too little.');
  }

  if (R.hasCounts) {
    if (R.tPts.dir && R.tCnt.dir && R.tPts.dir !== R.tCnt.dir) {
      bits.push('<b>the two series disagree.</b> Points are ' + vWord(R.tPts.dir) + ' while the ' +
                'item count is ' + vWord(R.tCnt.dir) + ', measured as the median pairwise slope of ' +
                'each series so that one enormous iteration cannot flip either answer. This is the ' +
                'most interesting thing on the card: count is immune to point inflation, so points ' +
                'moving one way while count moves the other is what a change in <i>estimating</i> ' +
                'looks like from the outside, rather than a change in delivering.');
    } else if (R.tPts.dir === 0 && R.tCnt.dir === 0) {
      bits.push('points and item count are both flat over this period, which is the boring and ' +
                'reassuring case: neither the estimating nor the delivering moved.');
    } else {
      bits.push('points and item count are ' +
                (R.tPts.dir === R.tCnt.dir ? 'both ' + vWord(R.tPts.dir) : 'not in disagreement') +
                ', so nothing here suggests the point scale drifted. Count is drawn because it is ' +
                'the one series a team cannot move by changing how it estimates.');
    }
  } else if (P.anyCount) {
    bits.push('the item count is in the data but its lane is switched off; it is the one series ' +
              'here that point inflation cannot move, so it is worth turning back on.');
  } else {
    bits.push('<b>this data carries no item count</b>, so there is nothing on the card that point ' +
              'inflation cannot move. A count of items completed frequently tells a different story ' +
              'from the points, and where the two disagree the disagreement is the finding.');
  }

  if (R.outlier) {
    bits.push('one iteration, ' + CK.esc(R.outlier.label) + ', is <b>' + CK.esc(fmtN(R.outlier.times)) +
              '&times;</b> the median and sets the vertical scale on its own, which flattens ' +
              'everything else. It widens the band wherever it falls inside the window, and that is ' +
              'the band telling the truth rather than the band malfunctioning.');
  }
  if (R.zeros) {
    bits.push('<b>' + R.zeros + '</b> iteration' + (R.zeros === 1 ? '' : 's') + ' delivered zero, ' +
              'drawn as a marked stub at the baseline so it reads as present-and-zero rather than ' +
              'as missing.');
  }
  if (R.gaps) {
    bits.push('<b>' + R.gaps + '</b> iteration' + (R.gaps === 1 ? '' : 's') +
              ' had no usable figure and ' + (R.gaps === 1 ? 'keeps its slot' : 'keep their slots') +
              ' as a gap; deleting ' + (R.gaps === 1 ? 'it' : 'them') + ' would close the hole and ' +
              'let the window compute across a discontinuity.');
  }

  if (P.hadTarget) {
    bits.push('<b>a target was supplied in the data and is deliberately not drawn.</b> A velocity ' +
              'target is met most cheaply by inflating estimates, so the line would not measure ' +
              'delivery, it would change it. There is no setting that adds one.');
  }
  if (P.refused.length) {
    bits.push('<i>' + P.refused.length + ' figure' + (P.refused.length === 1 ? '' : 's') +
              ' refused</i>: ' + CK.esc(P.refused.slice(0, 3).join('; ')) +
              (P.refused.length > 3 ? ', and ' + (P.refused.length - 3) + ' more' : '') +
              '. An unreadable throughput is never read as zero, because a zero iteration is a ' +
              'serious claim about a team and inventing one is a slander.');
  }
  if (P.badCount) {
    bits.push('<i>' + P.badCount + ' item count' + (P.badCount === 1 ? '' : 's') +
              '</i> refused for being negative or fractional; a count is a number of things.');
  }
  if (P.dupIds.length) {
    bits.push('<i>' + P.dupIds.length + ' duplicate iteration id' +
              (P.dupIds.length === 1 ? '' : 's') + '</i> (' +
              CK.esc(P.dupIds.slice(0, 3).join(', ')) + ') kept the first and dropped the repeats.');
  }
  if (P.dupLabels) {
    bits.push('<b>' + P.dupLabels + '</b> iteration label' + (P.dupLabels === 1 ? ' is' : 's are') +
              ' repeated. Without an id an iteration is identified by its position, so these are ' +
              'kept as separate iterations and only the axis reads ambiguously.');
  }
  if (P.dropped) {
    bits.push('<i>' + P.dropped + ' iterations past the drawing budget</i> were left out.');
  }

  var names = [];
  for (i = 0; i < n && i < 8; i++) {
    names.push(rows[i].label + ': ' + (rows[i].points === null ? 'no reading' : fmtN(rows[i].points)) +
               (R.hasCounts && rows[i].count !== null ? ', ' + rows[i].count + ' items' : ''));
  }
  if (n > 8) { names.push('and ' + (n - 8) + ' more'); }

  var aria =
    'Velocity chart of ' + n + ' iteration' + (n === 1 ? '' : 's') + '. ' +
    'Velocity is a capacity estimate calibrated to one team scale: it is not a productivity ' +
    'measure, it does not compare between teams, and it stops measuring anything once it becomes a ' +
    'target. ' +
    (R.bandOk
      ? 'The band is the lowest and highest value over each trailing window of ' + c.window +
        ' iterations, not a mean. '
      : 'No band is drawn: a rolling range needs at least ' + c.window +
        ' consecutive iterations with a reading and there are ' + R.readings + '. ') +
    (R.hasCounts && R.tPts.dir && R.tCnt.dir && R.tPts.dir !== R.tCnt.dir
      ? 'Points are ' + vWord(R.tPts.dir) + ' while item count is ' + vWord(R.tCnt.dir) +
        ', which is what estimate inflation looks like. '
      : '') +
    'Iterations: ' + names.join('. ') + '.';

  return { aria: aria, caption: LEAD + ' ' + bits.join(' ') + ' ' + ASIDE, key: vKey(P, c, R) };
}

/**
 * Everything the card draws, from the payload and one settings object.
 *
 * The same function in Node and in the browser, so the caption's stated method can never come apart
 * from the drawn band. It computes the rolling range, the two robust trends, and the display list.
 *
 * There is no target line anywhere in here and there is no branch that could draw one.
 *
 * @param P    the payload from {@link readData}
 * @param conf a settings object, settled by {@link vConfig}
 * @returns `{ W, H, marks, note, bandOk, readings, tPts, tCnt }`
 *
 * @example vRender(P, { window: 4 }).bandOk;
 */
function vRender(P, conf) {
  var c = vConfig(conf, P.MINWIN);
  var M = vMetrics();
  var rows = P.rows, n = rows.length, i, j;

  var pts = [], cnts = [];
  for (i = 0; i < n; i++) { pts.push(rows[i].points); cnts.push(rows[i].count); }

  var readings = 0, gaps = 0, zeros = 0, minPts = null, maxPts = 0, vals = [], maxCnt = 0, anyCnt = 0;
  for (i = 0; i < n; i++) {
    if (cnts[i] !== null && cnts[i] !== undefined) {
      anyCnt++;
      if (cnts[i] > maxCnt) { maxCnt = cnts[i]; }
    }
    if (pts[i] === null || pts[i] === undefined) { gaps++; continue; }
    readings++;
    vals.push(pts[i]);
    if (pts[i] === 0) { zeros++; }
    if (minPts === null || pts[i] < minPts) { minPts = pts[i]; }
    if (pts[i] > maxPts) { maxPts = pts[i]; }
  }

  var band = vBand(pts, c.window), bandOk = false, bandBreaks = 0, bandHi = 0;
  for (i = 0; i < n; i++) {
    if (band[i]) { bandOk = true; if (band[i].hi > bandHi) { bandHi = band[i].hi; } }
    else if (i >= c.window - 1) { bandBreaks++; }
  }

  var med = vMedian(vals), outlier = null, at = -1;
  if (med && med > 0 && maxPts / med >= 3) {
    for (i = 0; i < n; i++) { if (pts[i] === maxPts) { at = i; break; } }
    if (at >= 0) { outlier = { label: rows[at].label, times: Math.round(maxPts / med * 10) / 10 }; }
  }

  var R = {
    readings: readings, gaps: gaps, zeros: zeros, minPts: minPts === null ? 0 : minPts,
    maxPts: maxPts, band: band, bandOk: bandOk, bandBreaks: bandBreaks,
    hasCounts: !!(c.counts && anyCnt), outlier: outlier,
    tPts: vTrend(pts), tCnt: vTrend(cnts), median: med
  };

  if (!n) {
    R.W = P.W0; R.H = 130;
    R.marks = [mText(P.W0 / 2, 68, 'no iterations', 'ck-v-empty', 'middle')];
    R.note = vNote(P, c, R);
    return R;
  }

  var avail = P.W0 - M.pad * 2 - M.gut;
  var pitch = avail / n;
  if (pitch < M.minPitch) { pitch = M.minPitch; }
  var W = Math.min(P.WMAX, Math.max(P.W0, M.pad * 2 + M.gut + n * pitch));
  var colW = Math.min(M.maxCol, Math.max(2, pitch * 0.62));

  var laneOn = R.hasCounts;
  var H = M.top + M.plotH + (laneOn ? M.gap + M.laneH : 0) + M.axisH;
  var x0 = M.pad + M.gut, x1 = W - M.pad;
  var py0 = M.top, py1 = M.top + M.plotH;
  var ly0 = py1 + M.gap, ly1 = ly0 + M.laneH;

  var top = Math.max(maxPts, bandHi);
  if (!(top > 0)) { top = 1; }
  var ys = CK.scale([0, top * 1.08], [py1, py0]);
  var xs = function (k) { return x0 + (k + 0.5) * ((x1 - x0) / n); };
  var pitchPx = (x1 - x0) / n;
  if (colW > pitchPx * 0.9) { colW = pitchPx * 0.9; }

  var marks = [];

  /* The value axis. CK.ticks chooses the step, so this card's gridlines and every other card's are
     chosen by one piece of code rather than by a private opinion about round numbers. */
  var tk = CK.ticks(0, top * 1.08, 4);
  for (i = 0; i < tk.length; i++) {
    if (tk[i] < 0 || tk[i] > top * 1.08) { continue; }
    marks.push(mLine(x0, ys(tk[i]), x1, ys(tk[i]), 'ck-rule'));
    marks.push(mText(x0 - 6, ys(tk[i]) + 3, fmtN(tk[i]), 'ck-v-tk', 'end'));
  }
  marks.push(mLine(x0, py1, x1, py1, 'ck-axis'));

  /* The band, as one filled shape per unbroken run. A run that ended at a hole is closed there
     rather than bridged, so the break is visible as a break. */
  if (bandOk) {
    var run = [];
    for (i = 0; i <= n; i++) {
      if (i < n && band[i]) { run.push(i); continue; }
      if (run.length) {
        var d = '';
        for (j = 0; j < run.length; j++) {
          d += (j ? ' L' : 'M') + fin(xs(run[j])) + ' ' + fin(ys(band[run[j]].hi));
        }
        for (j = run.length - 1; j >= 0; j--) {
          d += ' L' + fin(xs(run[j])) + ' ' + fin(ys(band[run[j]].lo));
        }
        marks.push(mPath(d + ' Z', 'ck-v-band'));
        if (c.median) {
          var m = '';
          for (j = 0; j < run.length; j++) {
            m += (j ? ' L' : 'M') + fin(xs(run[j])) + ' ' + fin(ys(band[run[j]].med));
          }
          marks.push(mPath(m, 'ck-v-med'));
        }
        run = [];
      }
    }
  }

  /* The columns. */
  for (i = 0; i < n; i++) {
    var cx = xs(i), kids = [];
    var tip = rows[i].label + ' · ' +
              (pts[i] === null || pts[i] === undefined
                ? 'no readable figure'
                : fmtN(pts[i]) + (P.unit ? ' ' + P.unit : ' points')) +
              (cnts[i] !== null && cnts[i] !== undefined ? ' · ' + cnts[i] + ' items' : '') +
              (band[i] ? ' · window ' + fmtN(band[i].lo) + ' to ' + fmtN(band[i].hi) : '');

    if (pts[i] === null || pts[i] === undefined) {
      kids.push(mLine(cx - colW / 2, py1 - 3, cx + colW / 2, py1 - 3, 'ck-v-gap'));
    } else if (pts[i] === 0) {
      kids.push(mLine(cx - colW / 2, py1, cx + colW / 2, py1, 'ck-v-zero'));
    } else {
      kids.push(mRect(cx - colW / 2, ys(pts[i]), colW, py1 - ys(pts[i]), 'ck-v-col', 1));
    }
    var g = { t: 'g', a: { 'class': 'ck-v-it', 'data-it': String(i) }, kids: kids };
    g.ti = tip;
    marks.push(g);
  }

  /* The count lane: its own baseline and its own scale, below rather than superimposed. Two units
     sharing one set of gridlines is how a reader ends up comparing a point to an item. */
  if (laneOn) {
    var cs = CK.scale([0, Math.max(1, maxCnt) * 1.12], [ly1, ly0]);
    marks.push(mLine(x0, ly1, x1, ly1, 'ck-axis'));
    marks.push(mText(x0 - 6, ly0 + 8, fmtN(Math.max(1, maxCnt)), 'ck-v-tk', 'end'));
    marks.push(mText(x0, ly0 - 3, 'items completed', 'ck-v-lanelab', 'start'));
    var seg = [];
    for (i = 0; i <= n; i++) {
      if (i < n && cnts[i] !== null && cnts[i] !== undefined) { seg.push(i); continue; }
      if (seg.length) {
        var p = '';
        for (j = 0; j < seg.length; j++) {
          p += (j ? ' L' : 'M') + fin(xs(seg[j])) + ' ' + fin(cs(cnts[seg[j]]));
        }
        marks.push(mPath(p, 'ck-v-cline'));
        seg = [];
      }
    }
    for (i = 0; i < n; i++) {
      if (cnts[i] === null || cnts[i] === undefined) { continue; }
      marks.push(mRect(xs(i) - 1.6, cs(cnts[i]) - 1.6, 3.2, 3.2, 'ck-v-cdot'));
    }
  }

  /* Iteration labels, thinned rather than overlapped: a label every k-th column, where k is the
     smallest number that gives each one room. An axis of overlapping text is an axis nobody reads. */
  var per = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((x1 - x0) / 40))));
  var labY = H - M.axisH + 12;
  for (i = 0; i < n; i++) {
    if (i % per) { continue; }
    marks.push(mText(xs(i), labY, clipTo(rows[i].label, pitchPx * per - 4, 9), 'ck-v-xlab', 'middle'));
  }
  if (per > 1) {
    marks.push(mText(x1, H - 2, 'every ' + per + 'th label shown', 'ck-v-note', 'end'));
  }

  R.W = W; R.H = H; R.marks = marks;
  R.note = vNote(P, c, R);
  return R;
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, fmtN, vConfig, vMedian, vBand, vSlope, vTrend, vWord,
                 mLine, mText, mRect, mPath, vMetrics, vKey, vNote, vRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>` AND that cannot
 * trip the emitted-code guard.
 *
 * `<` and `>` become escapes so an iteration name containing a closing script tag cannot end the
 * block early — which has the second, less obvious effect of making an arrow sequence impossible.
 * `?` is escaped one step further on: a label reading "done?.maybe" would otherwise put an
 * optional-chaining sequence into a file the guard refuses to emit, and the card would fail to build
 * because of somebody's punctuation. Two agents in this catalogue hit exactly that.
 *
 * @example jsLit({ id: '</script>' });   // '{"id":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\?/g, '\\u003f')
    .replace(TICK_RE, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** One display-list mark as SVG markup, for the copy that ships drawn inside `card.html`. */
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
  const own = '.ck-velocity[data-card="' + id + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The banners above the plot: the facts no setting can hide.
 *
 * The first states what the measure is not, and it is unconditional, because it is a property of
 * velocity rather than of this data. The second fires only when the points and the item count
 * disagree about direction, which is the single most informative thing this card can find.
 *
 * Emitted in Node and never touched by the browser half, because both state properties of the DATA
 * rather than of the current view — which is exactly why they belong outside the redrawn SVG.
 *
 * @param P the payload
 * @returns markup for one or two banners
 */
function bannerHtml(P) {
  /* The space between the two spans is load-bearing exactly once: a flex container drops a
     whitespace-only text node, so it costs nothing on screen, and without it the banner reads
     "not a productivity measurea point is" everywhere the markup is flattened back to text. */
  let out =
    '<div class="ck-v-warn" role="note">' +
    '<span class="ck-v-warn-lead">not a productivity measure.</span> ' +
    '<span>Points are one team&rsquo;s own currency, so velocity does not compare between teams, ' +
    'and it stops measuring anything the moment it is made a target.</span></div>';

  const pts = P.rows.map((r) => r.points);
  const cnt = P.rows.map((r) => r.count);
  const a = vTrend(pts);
  const b = vTrend(cnt);
  if (P.anyCount && a.dir && b.dir && a.dir !== b.dir) {
    out +=
      '\n  <div class="ck-v-flag" role="note">' +
      '<span class="ck-v-flag-lead">the two series disagree.</span> ' +
      '<span>Points are ' + vWord(a.dir) + ' while item count is ' + vWord(b.dir) +
      ' &mdash; count is immune to point inflation, so this is what a change in estimating looks ' +
      'like rather than a change in delivering.</span></div>';
  }
  return out;
}

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour: every value is a desk token, so the light switch is the only thing
 * that has to know anything. `prefers-color-scheme` is deliberately absent — the desk is one
 * document open in two viewers that want different answers.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-v-warn, .ck-v-flag',
      'display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px; ' +
      'margin: 10px 0 6px; padding: 6px 9px; border: 1px solid var(--ck-s1); ' +
      'border-left-width: 4px; border-radius: 5px; font-size: 11.5px; color: var(--ink-dim); ' +
      'background: var(--well);'],
    ['.ck-v-flag', 'border-color: var(--accent);'],
    ['.ck-v-warn-lead, .ck-v-flag-lead',
      'font-family: var(--ui); font-weight: 700; letter-spacing: .04em; ' +
      'text-transform: uppercase; font-size: 10px; color: var(--ink);'],

    ['.ck-v-plot .ck-v-col', 'fill: var(--pill); stroke: var(--pill-edge); stroke-width: 1;'],
    ['.ck-v-plot .ck-v-zero', 'stroke: var(--ink); stroke-width: 2.5; stroke-linecap: butt;'],
    ['.ck-v-plot .ck-v-gap',
      'stroke: var(--ink-faint); stroke-width: 1.5; stroke-dasharray: 2 2;'],
    ['.ck-v-plot .ck-v-band', 'fill: var(--accent); fill-opacity: .16; stroke: none;'],
    ['.ck-v-plot .ck-v-med',
      'fill: none; stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 4 3;'],
    ['.ck-v-plot .ck-v-cline', 'fill: none; stroke: var(--ink-dim); stroke-width: 1.2;'],
    ['.ck-v-plot .ck-v-cdot', 'fill: var(--ink-dim); stroke: none;'],
    ['.ck-v-plot .ck-v-tk', 'fill: var(--ink-faint);'],
    ['.ck-v-plot .ck-v-xlab', 'fill: var(--ink-faint);'],
    ['.ck-v-plot .ck-v-lanelab',
      'fill: var(--ink-faint); font-size: 8px; letter-spacing: .05em;'],
    ['.ck-v-plot .ck-v-note', 'fill: var(--ink-faint); font-size: 8px;'],
    ['.ck-v-plot .ck-v-empty', 'fill: var(--ink-faint); font-size: 11px;'],

    ['.ck-v-plot .ck-v-it', 'transition: opacity .12s linear;'],
    ['.ck-v-plot:hover .ck-v-it', 'opacity: .55;'],
    ['.ck-v-plot .ck-v-it:hover', 'opacity: 1;'],

    ['.ck-legend i[data-k="col"]',
      'background: var(--pill); box-shadow: inset 0 0 0 1px var(--pill-edge);'],
    ['.ck-legend i[data-k="band"]', 'background: var(--accent); opacity: .3;'],
    ['.ck-legend i[data-k="med"]', 'background: var(--accent); height: 2px;'],
    ['.ck-legend i[data-k="cnt"]', 'background: var(--ink-dim); height: 2px;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-v-plot .ck-v-it', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, the banners, the plot drawn, and the caption. */
function cardHtml(id, title, seed, cfg, banners) {
  const f = (name) => CK.esc(id) + '-' + name;
  const box = (name, label, on) =>
    '    <label for="' + f(name) + '">' + CK.esc(label) + '</label>\n' +
    '    <input id="' + f(name) + '" name="' + name + '" type="checkbox"' + (on ? ' checked' : '') + '>\n';

  const plot =
    '<svg class="ck-plot ck-v-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '"' +
    (seed.W > W0 ? ' style="min-width:' + Math.round(seed.W) + 'px"' : '') +
    ' aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-velocity">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="velocity settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('window') + '">band window</label>\n' +
    '    <input id="' + f('window') + '" name="window" type="number" min="' + MINWIN +
         '" max="12" step="1" value="' + cfg.window + '">\n' +
    box('median', 'rolling median line', cfg.median) +
    box('counts', 'item count lane', cfg.counts) +
    '    <p class="ck-set-foot">There is no target setting and there will not be one. A velocity ' +
         'target is met most cheaply by inflating estimates, so drawing the line would not measure ' +
         'delivery, it would change it. The band is a range rather than a mean because a mean of a ' +
         'handful of skewed observations is a number pretending to be a forecast; below ' + MINWIN +
         ' iterations the band is refused outright.</p>\n' +
    '  </div>\n' +
    '  ' + banners + '\n' +
    '  <div class="ck-scroll">' + plot + '</div>\n' +
    '  <div class="ck-legend ck-v-key">' + seed.note.key + '</div>\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped analysis and renderer, a display-list translator, and the settings
 * wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned — so a backtick that got into a doc comment cannot reach the page, where it
 * would close the desk's one inline script block early and blank every card on it.
 *
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* velocity card: the same band and the same robust trends that drew the copy in card.html,\n' +
    '   re-run when the window changes. The caption states the window in force, so it is rebuilt\n' +
    '   from the same call that draws the band and the two cannot come to disagree. Nothing here\n' +
    '   draws a target line, and there is no branch that could. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-v-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  var key  = sec.querySelector(".ck-v-key");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where chart decisions live. */\n' +
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
    '     render that added marks would draw a second chart on top of the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = vRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    plot.style.minWidth = out.W > P.W0 ? Math.round(out.W) + "px" : "";\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* Caption and legend are markup whose every data-derived value was escaped as it was\n' +
    '       built. Both are rebuilt because both name the window that is currently in force. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '    if (key) { key.innerHTML = out.note.key; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/velocity');
}

/**
 * Build one velocity card from one series of iterations.
 *
 * WHETHER THIS TYPE SHOULD EXIST AT ALL, stated here because the honest answer is not an unqualified
 * yes. As a forecasting tool it should not: `montecarlo` resamples the same history into a range
 * with a confidence attached, and `cycletime` shows the per-item distribution including the tail
 * that an average deletes. Velocity is strictly worse than both at the job it is most often used
 * for. What it is for, and the reason this file exists, is that teams already have this number and
 * already misuse it, and a catalogue that refuses to draw it does not stop anybody — it only means
 * the version they use has no warning on it. This card is harm reduction with a chart attached, and
 * its two genuine contributions are the warning and the points-against-count comparison, which is
 * the specific evidence that reveals estimate inflation and which neither of the other two surfaces.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data                 a card-sized empty frame, with the warning still stated in full
 *   one iteration           one column, no band, and the minimum named
 *   two iterations          two columns, band REFUSED, and the caption says why two is not enough
 *   all identical           a band of zero width, drawn flat; the caption reports the range as zero
 *   an iteration of zero    a marked stub at the baseline, so it reads as present-and-zero rather
 *                           than as missing, and is counted in the caption
 *   a negative value        refused and named as a sign error; never made positive
 *   unreadable value        refused; the slot is KEPT as a gap so the window cannot compute across
 *                           the hole, and the band visibly breaks there
 *   points, no count        drawn, and the caption says the card then contains nothing that point
 *                           inflation cannot move
 *   both, trends disagree   a banner above the plot, because it is the most informative thing here
 *   an enormous outlier     drawn at full height; it sets the scale and widens the band, and both
 *                           facts are named. The trends are median pairwise slopes, so it cannot
 *                           flip the direction of either series
 *   non-integer points      accepted and drawn; a fractional count is refused, since a count is a
 *                           number of things
 *   duplicate ids           the first wins and the repeats are dropped, but only where ids were
 *                           given: without one an iteration is identified by its position
 *   a target in the data    refused by name and never drawn, and the caption says why
 *   300 iterations          drawn at a seven-pixel pitch inside a scrolling box, with the axis
 *                           labels thinned to every k-th
 *   a 300-character label   clipped to the room it has, with the whole of it in the tooltip
 *   injected markup         escaped on the way into the caption, the banners, the legend and the
 *                           tooltips, and escaped again into the emitted script literal
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ iterations, unit, target }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'vel',
 *   title: 'throughput per sprint',
 *   data: { unit: 'points', iterations: [
 *     { label: 's1', points: 21, count: 9 },
 *     { label: 's2', points: 26, count: 8 },
 *     { label: 's3', points: 30, count: 7 },
 *   ] },
 *   ord: 34,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'velocity' : id);
  const P = readData(data);

  const cfg = { ...defaults };
  const seed = vRender(P, cfg);

  /* The payload the browser re-renders from carries the data and the budgets and no geometry, so
     the two runtimes cannot disagree about anything except the config. */
  const payload = {
    rows: P.rows, unit: P.unit, title: P.title, anyCount: P.anyCount,
    refused: P.refused, dupIds: P.dupIds, dupLabels: P.dupLabels, badCount: P.badCount,
    negatives: P.negatives, dropped: P.dropped, hadTarget: P.hadTarget,
    W0, WMAX, MINWIN, ITERCAP,
  };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      iterations: P.rows.length,
      readings: seed.readings,
      unit: P.unit,
      band: seed.bandOk ? { method: 'rolling min-max', window: cfg.window } : null,
      bandRefused: !seed.bandOk,
      minimumForBand: MINWIN,
      pointsTrend: seed.tPts.dir,
      countTrend: seed.tCnt.dir,
      trendsDisagree: !!(P.anyCount && seed.tPts.dir && seed.tCnt.dir && seed.tPts.dir !== seed.tCnt.dir),
      /* Recorded so a reader of card.json can see that the card was given one and did not draw it. */
      targetRefused: P.hadTarget,
      refusedFigures: P.refused.length,
      settings: { ...cfg },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, cfg, bannerHtml(P)),
    css:  cardCss(cardId),
    js:   cardJs(cardId, payload, cfg),
  };
}

/* Exported for the type's own verification, which executes the arithmetic rather than only reading
   it: a static check can prove the script parses and cannot prove the band is a range. */
export const _internals = { readData, readNum, clean, jsLit, SHIPPED,
                            vRender, vConfig, vBand, vMedian, vSlope, vTrend, vMetrics, fmtN,
                            bannerHtml };

export default { meta, build };

