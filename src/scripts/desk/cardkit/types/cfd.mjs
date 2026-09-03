/**
 * `cfd` — a cumulative flow diagram that withdraws its cycle-time reading when the system is unstable.
 *
 * Three quantities are readable off one picture, which is why this is the best project chart nobody
 * uses:
 *
 *   band THICKNESS   items in that state right now, which is work in progress
 *   band SLOPE       items entering or leaving that state per unit time, which is throughput
 *   band WIDTH       the horizontal distance between a band's upper and lower edge, which is
 *                    approximately how long an item spends in that state
 *
 * The third one is the one that gets people into trouble, and it is the reason this file is longer
 * than it looks like it needs to be. The horizontal reading is Little's Law, `L = lambda W`, and
 * Little's Law is a statement about AVERAGES OVER A STABLE PERIOD. Stable means arrivals roughly
 * matching departures, so that the amount of work in the system at the start of the window is
 * roughly the amount in it at the end. When the backlog is growing, the items still inside are
 * exactly the slow ones, the ones that have departed are exactly the quick ones, and the horizontal
 * gap measures the quick ones. It understates cycle time, sometimes by a factor.
 *
 * So this card tests for that and refuses. Three gates, all reported on the card:
 *
 *   EVIDENCE   arrivals + departures in the window must reach 20. Under that, the ratio of the two
 *              is indistinguishable from noise, and "we cannot tell" is a different claim from
 *              "it is stable". Absence of evidence of instability is not evidence of stability.
 *   BALANCE    departures / arrivals must lie in 0.8 to 1.25. The number is defended in
 *              {@link cfdTrust}.
 *   DRIFT      work in progress at the end of the window must be within half the window's average
 *              work in progress of where it started. This is the textbook Little's Law condition
 *              stated directly, and it is the same numerator as BALANCE over a different
 *              denominator: an imbalance of ten items is nothing to a board holding two hundred and
 *              everything to a board holding twelve.
 *
 * When all three pass, the card draws the horizontal bar and quotes the number — AND quotes the
 * mean cycle time actually measured from the items that finished inside the window, so a reader can
 * see the estimate checked against the thing it estimates. When any gate fails, the bar is not
 * drawn, the number is not quoted, and the caption says which gate failed and in which direction
 * the reading would have been wrong.
 *
 * Everything geometric is computed by {@link cfdRender}, which is the same function in Node and in
 * the browser: Node runs it once for the picture that ships inside `card.html`, the browser re-runs
 * it on a settings change. `CK` is loaded out of `kit.js` in a `node:vm` context, so `CK.scale`,
 * `CK.ticks` and `CK.hue` here are the ones the page has.
 *
 * @see ./cycletime.mjs   the same quantity measured per item instead of inferred from the stack
 * @see ./montecarlo.mjs  the same throughput, resampled forward instead of read as a slope
 * @see ./stackedarea.mjs the general stack; a CFD is that stack with a specific, checkable claim
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().ticks(0, 100, 5);   // [0, 50, 100]
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/cfd: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/cfd: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets and thresholds ──────────────────────────────────────────────────────────── */

const W0   = 660;
const H0   = 320;
const WMAX = 2200;

/* Sampled columns. A cap on the PAYLOAD, not on the arithmetic: every flow statistic in the
   caption is integrated from the complete event list before any thinning happens. */
const XCAP = 240;

const DAY = 86400000;

/* The three gates. Named constants because they are the card's argument, not its implementation,
   and they are shipped in the payload so the browser tests exactly what Node tested. */
const MIN_EVENTS = 20;
const BAL_HI     = 1.25;
const DRIFT_TOL  = 0.5;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it; a binding declared after `meta` could not be referenced by it at all.
 *
 * There is deliberately no smoothing option. A monotone spline would not overshoot, but any spline
 * between count samples draws a band edge at a count that was never observed, and on a chart whose
 * whole claim is that thickness IS the work in progress, an interpolated thickness is a lie with
 * good manners. Step and straight are the two honest readings of a sampled counter.
 */
export const defaults = {
  curve:    'linear',
  littles:  true,
  annotate: true,
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'cfd',
  summary: 'Cumulative flow by state, withholding the cycle-time reading when the system is unstable.',
  shape: '{ states: [name], items: [{ id, events: [{ state, t }] }], from, to } — t a date string, Date or epoch ms',
  category: 'evolution',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one card
 * in this catalogue was refused because a comment said "the class is what CSS reads" — and a guard
 * that cries wolf is a guard somebody switches off. Offsets are preserved so a reported position
 * still points at the right place. Regex literals are recognised, because otherwise the scanner
 * desynchronises on the quote inside `replace(/'/g, x)` and starts blanking real code, which turns
 * a false positive into a far worse false negative.
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
 * Refuse to emit browser script that would break the whole desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in a
 * comment as readily as in code, because `Function.prototype.toString()` ships comments verbatim —
 * closes the surrounding template literal early and blanks every card on the desk. The backtick is
 * never written here; it is reached for as `String.fromCharCode(96)`, which cannot be mistyped and
 * cannot be mis-decoded during emission.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/cfd';
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

  /* Compared numerically rather than matched against a character class. Writing the class is how
     the class gets corrupted: an escape can be decoded one step early during emission, leaving a
     plausible-looking regex that holds the raw byte it meant to describe. */
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
 * One timestamp as epoch milliseconds, or `null`.
 *
 * A string that does not parse is refused rather than coerced: `Number('')` is 0 and
 * `new Date('soon')` is not a time, and either one invents an event at a moment nobody gave — on
 * this card, at the epoch, which would stretch the axis back to 1970 and flatten every band.
 *
 * @example readT('2024-03-01');   // 1709251200000
 * @example readT('soon');         // null
 */
function readT(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting every
 * refusal so the caption can name it.
 *
 * The state list is authority when it is given: an event naming a state not on it is REFUSED and
 * counted, not silently added, because a state list is how the author says what the workflow is
 * and a typo that quietly becomes a new band is a workflow the author never had. When no list is
 * given the states are discovered in first-seen order, which is a guess at the workflow order and
 * is reported as one.
 *
 * DUPLICATE ids are counted and kept as separate items. Merging two rows that share an id would
 * fabricate a history neither row has; dropping one would lose real events. Counting and naming is
 * the only move that neither invents nor discards.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ states, items, declared, refusedEvents, refusedItems, unknown, unknownNames, dupeIds }`
 *
 * @example readData({ states: ['a'], items: [{ id: 'x', events: [{ state: 'a', t: 0 }] }] }).items.length;  // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const declared = Array.isArray(d.states) ? d.states.map((s) => String(s)) : [];
  const rawItems = Array.isArray(d.items) ? d.items : [];

  const order = [];
  const idx = new Map();
  for (const s of declared) if (!idx.has(s)) { idx.set(s, order.length); order.push(s); }

  let refusedEvents = 0;
  let refusedItems = 0;
  let unknown = 0;
  let dupeIds = 0;
  const unknownNames = new Set();
  const seenIds = new Set();
  const items = [];

  /* Two passes. The first parses and sorts each item's events BY TIME; only then does the second
     discover state names, in the order they are first entered rather than the order they happen to
     be written. An exporter that lists an item's history newest-first would otherwise hand back a
     reversed workflow, and the workflow order is what decides the stacking, the nesting and every
     horizontal reading on this card. */
  const parsed = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') { refusedItems++; continue; }
    const src = Array.isArray(it.events) ? it.events : [];
    const ev = [];
    for (const e of src) {
      if (!e || typeof e !== 'object') { refusedEvents++; continue; }
      const t = readT(e.t);
      const name = e.state == null ? '' : String(e.state);
      if (t === null || name === '') { refusedEvents++; continue; }
      ev.push({ n: name, t });
    }
    if (!ev.length) { refusedItems++; continue; }
    ev.sort((a, b) => a.t - b.t);
    parsed.push({ raw: it, ev });
  }

  for (const p of parsed) {
    for (const e of p.ev) {
      if (idx.has(e.n)) continue;
      if (declared.length) continue;
      idx.set(e.n, order.length); order.push(e.n);
    }
  }

  for (const p of parsed) {
    const ev = [];
    for (const e of p.ev) {
      if (!idx.has(e.n)) { unknown++; unknownNames.add(e.n); continue; }
      ev.push({ s: idx.get(e.n), t: e.t });
    }
    if (!ev.length) { refusedItems++; continue; }
    /* Ties broken by state index so a same-instant pair reads forward through the workflow; the
       alternative is that an item recorded as arriving and finishing at one timestamp lands in an
       order that depends on how the exporter happened to write the rows. */
    ev.sort((a, b) => a.t - b.t || a.s - b.s);

    const id = p.raw.id == null ? '' : String(p.raw.id);
    if (id) { if (seenIds.has(id)) dupeIds++; else seenIds.add(id); }
    items.push({ id, ev });
  }

  return {
    states: order, items, declared,
    refusedEvents, refusedItems, unknown,
    unknownNames: [...unknownNames], dupeIds,
  };
}

/** The state index an item is in at time `t`, or -1 before its first event. */
function stateAt(item, t) {
  const ev = item.ev;
  let s = -1;
  for (let k = 0; k < ev.length; k++) {
    if (ev[k].t > t) break;
    s = ev[k].s;
  }
  return s;
}

/**
 * Every flow statistic Little's Law needs, integrated from the COMPLETE event list.
 *
 * Computed from events rather than from the sampled columns on purpose: the columns are a drawing
 * budget and the statistics are the card's claim, so thinning the picture must not move the number.
 *
 * `A` counts an item's first event inside the window. `D` counts every event that puts an item in
 * the terminal state when it was not already there — including an item whose very first event is
 * the terminal one, because that item did complete. `R` counts the reverse, an item leaving the
 * terminal state, which happens and which makes the bottom band shrink.
 *
 * Those three satisfy `A - D + R = WIP(to) - WIP(from)` exactly, and the identity is asserted
 * rather than assumed: it is the one place a sign error in this function would otherwise be
 * invisible, because every number it produces looks plausible on its own.
 *
 * @param items    the read items
 * @param terminal the index of the last state, which is what "departed" means
 * @param from     window start, epoch ms
 * @param to       window end, epoch ms
 * @returns `{ A, D, R, wip0, wip1, Lbar, spanMs, cycles }` — `cycles` is one duration per
 *          completion inside the window, in ms
 *
 * @throws {Error} when the flow identity fails, which is a bug in this function rather than in the
 *                 data: every input that could break it was refused while reading
 *
 * @example flowStats([{ ev: [{ s: 0, t: 0 }, { s: 1, t: 10 }] }], 1, 0, 10).D;   // 1
 */
function flowStats(items, terminal, from, to) {
  const marks = [];
  let wip0 = 0;
  let A = 0;
  let D = 0;
  let R = 0;
  const cycles = [];

  for (const it of items) {
    const s0 = stateAt(it, from);
    if (s0 >= 0 && s0 !== terminal) wip0++;

    let was = s0;                                   // status entering the window
    for (const e of it.ev) {
      if (e.t <= from || e.t > to) { if (e.t <= from) was = e.s; continue; }
      if (e === it.ev[0] || was === -1) { A++; }
      const inBefore = was >= 0 && was !== terminal;
      const inAfter  = e.s !== terminal;
      if (e.s === terminal && was !== terminal) { D++; cycles.push(e.t - it.ev[0].t); }
      if (e.s !== terminal && was === terminal)   R++;
      marks.push({ t: e.t, d: (inAfter ? 1 : 0) - (inBefore ? 1 : 0) });
      was = e.s;
    }
  }

  marks.sort((a, b) => a.t - b.t);

  const span = to - from;
  let w = wip0;
  let acc = 0;
  let prev = from;
  for (const m of marks) {
    acc += w * (m.t - prev);
    prev = m.t;
    w += m.d;
  }
  acc += w * (to - prev);

  const wip1 = w;
  if (A - D + R !== wip1 - wip0) {
    throw new Error('cardkit/cfd: flow identity broken - A ' + A + ' D ' + D + ' R ' + R +
                    ' wip ' + wip0 + ' to ' + wip1);
  }

  return { A, D, R, wip0, wip1, Lbar: span > 0 ? acc / span : wip0, spanMs: span, cycles };
}

/** The mean of a list, or 0 when it is empty. */
function meanOf(list) {
  if (!list.length) return 0;
  let s = 0;
  for (const v of list) s += v;
  return s / list.length;
}

/** The median of a list, by the midpoint of the two central values. */
function medianOf(list) {
  if (!list.length) return 0;
  const a = list.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything from here to the SHIPPED list runs in BOTH halves: Node calls it to draw the card
   that ships, and the browser calls the identical text after a settings change. It is therefore
   written in the browser's vocabulary — var and function, no arrows, no template literals, no
   backtick in any comment — and it may only reach for CK, which is a module constant here and a
   global there. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole `d` attribute and the card
 * renders empty with nothing in the console.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) { throw new Error('cardkit/cfd: non-finite coordinate (' + v + ')'); }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face; measured, not guessed. */
function tw(s) { return String(s).length * 5.42; }

/** Two digits, so a month or a day aligns with the rest of the label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A compact label for one instant, at a resolution the window can support.
 *
 * UTC getters throughout: a date written as a plain day parses to UTC midnight, so reading it back
 * in the viewer's zone can print the day before, and an axis that disagrees with the strings it was
 * handed is worse than a coarse one.
 *
 * @example fmtT(1709251200000, 86400000 * 400);   // '2024-03'
 */
function fmtT(x, span) {
  var d = new Date(x);
  if (span > DAY_MS * 1100) { return String(d.getUTCFullYear()); }
  if (span > DAY_MS * 70) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  if (span > DAY_MS * 2) { return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

/**
 * A duration in the largest unit that leaves a readable number.
 *
 * Cycle times on a board run from minutes to months, and a card that reports everything in days
 * prints "0.02 d" for half an hour, which a reader has to do arithmetic on before they can believe
 * or disbelieve it.
 *
 * @example dur(200000000);   // '2.3 d'
 * @example dur(5400000);     // '1.5 h'
 */
function dur(ms) {
  var a = Math.abs(ms);
  if (!isFinite(a)) { return 'unbounded'; }
  if (a >= DAY_MS * 1.5) { return CK.fmt(ms / DAY_MS) + ' d'; }
  if (a >= 3600000 * 1.5) { return CK.fmt(ms / 3600000) + ' h'; }
  if (a >= 60000) { return CK.fmt(ms / 60000) + ' min'; }
  return CK.fmt(ms / 1000) + ' s';
}

/**
 * Ticks that reach the ends of the axis instead of stopping short of them.
 *
 * `CK.ticks` only returns ticks strictly inside the domain it is handed, leaving a ragged strip
 * above the last gridline. Snapping the domain out to the step the ticks already chose closes it;
 * the ticks are stepped out rather than re-derived, because asking again with the wider range can
 * push it to the next nice step and halve the gridline count.
 *
 * @example axisTicks(3, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
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

/** A display-list line. */
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

/** A display-list path; the caller owns the shape, because only the caller knows it. */
function mPath(d, attrs) {
  var a = { d: d }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'path', a: a };
}

/**
 * Expand a point list so a step curve is just a polyline through more points.
 *
 * Step-after: the count holds from one sample until the next. On a CFD that is the more truthful
 * of the two claims, because the underlying quantity IS a step function of time — it changes when
 * an event happens and not in between — but it is not the default, because a board sampled daily
 * draws a staircase that reads as a process running in daily batches when it is not.
 *
 * @example stepExpand([{ x: 0, y: 1 }, { x: 1, y: 5 }]).length;   // 3
 */
function stepExpand(p) {
  var out = [], i;
  if (!p.length) { return out; }
  out.push(p[0]);
  for (i = 1; i < p.length; i++) {
    out.push({ x: p[i].x, y: p[i - 1].y });
    out.push(p[i]);
  }
  return out;
}

/**
 * One edge of a band as path commands, walked forward or backward.
 *
 * @param forward true to open a subpath with M, false to continue an open one with L
 * @example edgeCmds([{ x: 0, y: 0 }, { x: 1, y: 1 }], 'linear', true);   // 'M0 0 L1 1'
 */
function edgeCmds(pts, curve, forward) {
  var p = curve === 'step' ? stepExpand(pts) : pts, i, out = [];
  if (!p.length) { return ''; }
  if (forward) {
    for (i = 0; i < p.length; i++) { out.push((i ? 'L' : 'M') + fin(p[i].x) + ' ' + fin(p[i].y)); }
  } else {
    for (i = p.length - 1; i >= 0; i--) { out.push('L' + fin(p[i].x) + ' ' + fin(p[i].y)); }
  }
  return out.join(' ');
}

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function cfdConfig(cfg) {
  var c = cfg || {};
  return {
    curve:    c.curve === 'step' ? 'step' : 'linear',
    littles:  c.littles !== false,
    annotate: c.annotate !== false,
  };
}

/**
 * Cumulative counts: how many items are at or past each state, at every sampled column.
 *
 * The cumulative form is what makes the bands nest, and the nesting is what makes the horizontal
 * reading mean anything: the upper edge of the whole stack is the arrival curve, the lower edge is
 * the departure curve, and every boundary between them is the arrival curve of one state.
 *
 * Built by running the sum from the LAST state backward, so the terminal state sits on the
 * baseline and the oldest state is the top band — the conventional order, and the one in which a
 * band's own upper edge is the curve of items entering it.
 *
 * @param counts `counts[stateIndex][column]`, items in exactly that state
 * @returns `up[stateIndex][column]`, items in that state or any later one
 *
 * @example cfdUppers([[1, 1], [2, 2]]);   // [[3, 3], [2, 2]]
 */
function cfdUppers(counts) {
  var ns = counts.length, nx = ns ? counts[0].length : 0, up = [], i, j, run;
  for (i = 0; i < ns; i++) { up.push([]); }
  for (j = 0; j < nx; j++) {
    run = 0;
    for (i = ns - 1; i >= 0; i--) { run += counts[i][j]; up[i][j] = run; }
  }
  return up;
}

/**
 * Whether the horizontal reading may be offered, and if not, why not and in which direction.
 *
 * Little's Law, `L = lambda W`, holds as an equality for the time-average work in progress, the
 * average arrival rate and the average time in system, over a window in which the system is
 * stable. Stability here is the finite-window condition: the amount of work in the system at the
 * start of the window is the amount in it at the end. When it is not, `L / lambda` is an average
 * over a system that was materially two different systems at its two ends, and the reader is
 * quoted a number for a machine that no longer exists.
 *
 * THE THREE GATES, and why each threshold is where it is.
 *
 * EVIDENCE, `A + D` at least 20. The balance test is a comparison of two counts, so its noise is
 * binomial: with `n` flow events the standard error on the arrival share is about `0.5/sqrt(n)`,
 * and telling a 20 per cent imbalance from an even one at one standard error needs `n` near 80.
 * Twenty is not that; twenty is the floor below which the test has no power AT ALL and the honest
 * report is that stability is unverifiable rather than absent. Under it the reading is withheld
 * for want of evidence, which is a different sentence from "the system is unstable" and the card
 * says the different sentence.
 *
 * BALANCE, `D / A` between 0.8 and 1.25 — the same tolerance either way round, since the test is
 * symmetric in the log. Twenty-five per cent is chosen on two grounds. First, precision: the
 * horizontal reading is quoted to somebody who will act on it, typically to about a day in five,
 * which is twenty per cent — so an imbalance that moves the estimate by less than that has moved
 * it by less than the reader would round away, and above that the number stops being imprecise
 * and starts being wrong. Second, visibility: at `D / A` of 0.8 the queue grows by a fifth of
 * arrivals per window, so a board holding a few windows' worth of work changes shape inside the
 * horizon the reader is looking at. Below the threshold the instability is invisible in the
 * picture; above it, it is the picture.
 *
 * DRIFT, `|WIP(to) - WIP(from)|` at most half the window's average work in progress. This is the
 * textbook condition said directly, and it is deliberately the SAME NUMERATOR as balance over a
 * different denominator — `A - D + R` is exactly the change in work in progress. Balance asks
 * whether the imbalance is large next to the flow; drift asks whether it is large next to the
 * stock. A board holding two hundred items shrugs off an imbalance of ten; a board holding twelve
 * does not, and only the second question notices.
 *
 * @param P the shipped payload; `P.flow` and the three thresholds are read
 * @returns `{ ok, lam, Lbar, Wms, ratio, drift, driftRel, reasons, dirn }` — `reasons` is a list of
 *          sentences, empty when the reading is offered; `dirn` is 'under', 'over' or ''
 *
 * @example cfdTrust({ flow: { A: 50, D: 50, R: 0, wip0: 10, wip1: 10, Lbar: 10, spanMs: 8640000000 },
 *                     minEvents: 20, balHi: 1.25, driftTol: 0.5 }).ok;   // true
 */
function cfdTrust(P) {
  var f = P.flow;
  var days = f.spanMs / DAY_MS;
  var lam = days > 0 ? f.D / days : 0;
  var drift = f.wip1 - f.wip0;
  var driftRel = f.Lbar > 0 ? drift / f.Lbar : (drift === 0 ? 0 : 1);
  var ratio = f.A > 0 ? f.D / f.A : -1;
  var reasons = [], dirn = '';

  if (f.A + f.D < P.minEvents) {
    reasons.push('only ' + (f.A + f.D) + ' arrivals and departures fell inside this window, under ' +
      'the ' + P.minEvents + ' this card needs before a ratio of two counts can be told from noise. ' +
      'That is not a finding of instability, it is the absence of evidence either way');
  }
  if (f.D === 0) {
    reasons.push('nothing departed inside this window, so there is no throughput to divide by and ' +
      'Little\u2019s Law has no answer at all here');
  } else if (f.A === 0) {
    reasons.push('nothing arrived inside this window, so the board is draining a queue that was ' +
      'built under conditions this chart cannot see');
    dirn = 'over';
  } else if (ratio < 1 / P.balHi || ratio > P.balHi) {
    dirn = ratio < 1 ? 'under' : 'over';
    reasons.push('departures were ' + CK.fmt(ratio * 100) + ' per cent of arrivals, outside the ' +
      CK.fmt(100 / P.balHi) + ' to ' + CK.fmt(P.balHi * 100) + ' per cent this card will read ' +
      'across; the backlog is ' + (ratio < 1 ? 'growing' : 'draining') + ' rather than holding');
  }
  if (Math.abs(driftRel) > P.driftTol && f.Lbar > 0) {
    if (!dirn) { dirn = drift > 0 ? 'under' : 'over'; }
    reasons.push('work in progress went from ' + f.wip0 + ' to ' + f.wip1 + ' items, a change of ' +
      CK.fmt(Math.abs(driftRel) * 100) + ' per cent of the window\u2019s average of ' +
      CK.fmt(f.Lbar) + ' \u2014 the two ends of this window are not the same system');
  }

  var ok = reasons.length === 0;
  return {
    ok: ok, lam: lam, Lbar: f.Lbar,
    Wms: ok && lam > 0 ? (f.Lbar / lam) * DAY_MS : null,
    ratio: ratio, drift: drift, driftRel: driftRel, reasons: reasons, dirn: dirn,
  };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption's first job is the three readings — thickness, slope, width — because a reader who
 * does not know them sees a pretty stack and nothing else. Its second job is the honest one: to
 * say whether the third reading is available, and when it is not, to say which way it would have
 * been wrong. A chart that silently permits an invalid reading is worse than one that does not
 * offer the reading.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function cfdNote(P, conf, trust, emptyStates, maxTotal) {
  var ns = P.states.length, nx = P.xs.length;
  var span = nx ? fmtT(P.xs[0], P.t1 - P.t0) + ' to ' + fmtT(P.xs[nx - 1], P.t1 - P.t0) : '';
  var f = P.flow, i;

  if (!ns || !nx) {
    return {
      aria: 'Cumulative flow diagram with no data: nothing is stacked and no reading is offered.',
      caption: 'a cumulative flow diagram with <b>no data</b> &mdash; the frame is drawn so the ' +
        'card keeps its place. ' +
        (P.refusedItems ? '<i>' + CK.esc(String(P.refusedItems)) + ' item' +
          (P.refusedItems === 1 ? ' was' : 's were') + ' refused</i> for carrying no usable event. ' : '') +
        'nothing is stacked and nothing is claimed.',
    };
  }

  var readW = trust.ok && trust.Wms !== null;

  var aria = 'Cumulative flow diagram of ' + P.itemCount + ' item' + (P.itemCount === 1 ? '' : 's') +
    ' across ' + ns + ' state' + (ns === 1 ? '' : 's') + ', ' + P.states.join(' then ') +
    ', from ' + span + '. The stack reaches ' + maxTotal + ' at its tallest. ' +
    f.A + ' arrived and ' + f.D + ' departed inside the window; work in progress went from ' +
    f.wip0 + ' to ' + f.wip1 + ', averaging ' + CK.fmt(f.Lbar) + '. ' +
    'Band thickness is work in progress, band slope is throughput, and the horizontal distance ' +
    'across a band is approximately time in that state. ' +
    (readW
      ? 'The system is stable enough for that third reading: average time in system is about ' +
        dur(trust.Wms) + '.'
      : 'The horizontal reading is WITHHELD here. ' + (trust.reasons.length ? trust.reasons[0] + '.' : ''));

  var lead =
    '<b>' + CK.esc(String(P.itemCount)) + '</b> item' + (P.itemCount === 1 ? '' : 's') +
    ' through <b>' + CK.esc(String(ns)) + '</b> state' + (ns === 1 ? '' : 's') +
    ', ' + CK.esc(span) + '. ' +
    '<i>thickness is work in progress; slope is throughput; the horizontal gap is time in state.</i> ' +
    'Work in progress ran ' + CK.esc(String(f.wip0)) + ' to <b>' + CK.esc(String(f.wip1)) +
    '</b> (average ' + CK.esc(CK.fmt(f.Lbar)) + '); throughput <b>' +
    CK.esc(CK.fmt(trust.lam)) + '</b> items per day from ' + CK.esc(String(f.D)) +
    ' departure' + (f.D === 1 ? '' : 's') + ' against ' + CK.esc(String(f.A)) + ' arrival' +
    (f.A === 1 ? '' : 's') + '. ';

  var verdict;
  if (readW) {
    verdict = '<b>the horizontal reading holds.</b> Arrivals and departures are balanced within ' +
      CK.esc(CK.fmt((P.balHi - 1) * 100)) + ' per cent and work in progress moved by ' +
      CK.esc(CK.fmt(Math.abs(trust.driftRel) * 100)) + ' per cent of its own average, so ' +
      'Little\u2019s Law applies: average time in system is <b>' + CK.esc(dur(trust.Wms)) +
      '</b>, which is the average work in progress divided by the average throughput. ';
    if (P.measured.n > 0) {
      var gap = trust.Wms > 0 ? (P.measured.mean - trust.Wms) / trust.Wms : 0;
      verdict += 'The <b>' + CK.esc(String(P.measured.n)) + '</b> item' +
        (P.measured.n === 1 ? '' : 's') + ' that actually finished inside the window took ' +
        CK.esc(dur(P.measured.mean)) + ' on average (median ' + CK.esc(dur(P.measured.median)) +
        '), which is ' + CK.esc(CK.fmt(Math.abs(gap) * 100)) + ' per cent ' +
        (gap >= 0 ? 'more' : 'less') + ' than the estimate \u2014 the estimate is checked against ' +
        'the thing it estimates rather than left to be believed. ';
    }
  } else {
    verdict = '<b>the horizontal reading is withheld.</b> ' +
      (trust.dirn === 'under'
        ? 'It would UNDERSTATE cycle time here: the items still in the system are exactly the slow ' +
          'ones, and only the quick ones have crossed to the bottom edge where the gap is measured. '
        : trust.dirn === 'over'
          ? 'It would OVERSTATE cycle time here: the board is clearing a queue that accumulated ' +
            'under conditions this window does not contain. '
          : '') +
      'Reasons: ' + CK.esc(trust.reasons.join('; ')) + '. ';
  }

  var bits = [];
  if (P.discovered) {
    bits.push('no state list was supplied, so the states were taken in the order they were first ' +
      'seen in the data \u2014 which may not be the workflow order, and the stacking, the ' +
      'nesting and every horizontal reading depend on it');
  }
  if (emptyStates.length) {
    bits.push('<b>' + emptyStates.length + '</b> state' + (emptyStates.length === 1 ? '' : 's') +
      ' held no item at any sampled column (' + CK.esc(emptyStates.join(', ')) +
      ') and draw as a band of zero thickness, kept so the colours do not shift');
  }
  if (f.R) {
    bits.push('<b>' + f.R + '</b> item' + (f.R === 1 ? '' : 's') + ' moved BACKWARD out of ' +
      CK.esc(P.states[P.states.length - 1]) + ' inside the window, which makes the bottom band ' +
      'shrink; it is drawn rather than clamped, because it happened');
  }
  if (P.unknown) {
    bits.push('<b>' + P.unknown + '</b> event' + (P.unknown === 1 ? '' : 's') +
      ' named a state that is not on the supplied list (' + CK.esc(P.unknownNames.join(', ')) +
      ') and were refused \u2014 the list is what the workflow IS, so a typo does not get to ' +
      'become a band');
  }
  if (P.refusedEvents) {
    bits.push('<b>' + P.refusedEvents + '</b> event' + (P.refusedEvents === 1 ? '' : 's') +
      ' had no usable state or timestamp and were dropped; never coerced, because a date that ' +
      'does not parse becomes the epoch and stretches this axis back to 1970');
  }
  if (P.refusedItems) {
    bits.push('<b>' + P.refusedItems + '</b> item' + (P.refusedItems === 1 ? '' : 's') +
      ' carried no usable event at all and were dropped');
  }
  if (P.dupeIds) {
    bits.push('<b>' + P.dupeIds + '</b> id' + (P.dupeIds === 1 ? '' : 's') +
      ' appear more than once; each row is counted as its own item, which inflates every total ' +
      'if they are one item exported twice');
  }
  if (P.thinnedFrom > nx) {
    bits.push('drawn at <b>' + nx + '</b> of <b>' + P.thinnedFrom + '</b> event times; the drawn ' +
      'columns are exact counts and the changes between them are not shown, but every flow ' +
      'statistic above was integrated from the complete event list');
  }
  if (!conf.littles) {
    bits.push('the cycle-time reading is switched off in the settings');
  }

  var caption = lead + verdict +
    (bits.length ? '<span class="ck-aside">' + bits.join('; ') + '.</span>' : '');

  return { aria: aria, caption: caption };
}

/**
 * The whole picture, as a display list, from the shipped columns and the settled settings.
 *
 * Called in Node to draw the copy that ships inside `card.html`, and in the browser on every
 * settings change, so the caption cannot come to disagree with the picture.
 *
 * @param P   the shipped payload: columns, per-state counts, flow statistics, refusal counts
 * @param cfg the settings, unsettled; {@link cfdConfig} settles them
 * @returns `{ W, H, marks, note }`
 *
 * @example cfdRender(payload, { curve: 'step' }).note.aria;
 */
function cfdRender(P, cfg) {
  var conf = cfdConfig(cfg);
  var trust = cfdTrust(P);
  var xs = P.xs, nx = xs.length, ns = P.states.length, i, j;
  var marks = [];

  var up = cfdUppers(P.counts);
  var maxTotal = 0;
  for (j = 0; j < nx; j++) { if (ns && up[0][j] > maxTotal) { maxTotal = up[0][j]; } }

  var emptyStates = [];
  for (i = 0; i < ns; i++) {
    var any = false;
    for (j = 0; j < nx; j++) { if (P.counts[i][j] > 0) { any = true; break; } }
    if (!any) { emptyStates.push(P.states[i]); }
  }

  var ax = axisTicks(0, maxTotal > 0 ? maxTotal : 1, 5);
  var leftW = 0;
  for (i = 0; i < ax.ticks.length; i++) { leftW = Math.max(leftW, tw(CK.fmt(ax.ticks[i]))); }

  var padT = 16, padR = 16, padB = 34;
  var padL = Math.round(Math.min(90, leftW)) + 12 + 12;
  var W = Math.round(Math.min(P.WMAX, Math.max(P.W0, padL + padR + nx * 2.4)));
  var H = P.H0;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  var xlo = nx ? xs[0] : 0, xhi = nx ? xs[nx - 1] : 1;
  var xspan = xhi - xlo;
  var xS = CK.scale([xlo, xhi], [plot.x0, plot.x1]);
  var yS = CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);

  for (i = 0; i < ax.ticks.length; i++) {
    var ty = yS(ax.ticks[i]);
    marks.push(mLine(plot.x0, ty, plot.x1, ty, 'ck-rule'));
    marks.push(mText(plot.x0 - 6, ty + 3.2, CK.fmt(ax.ticks[i]), 'ck-tk', 'end'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  if (nx) {
    var want = Math.max(2, Math.min(7, Math.floor((plot.x1 - plot.x0) / 78)));
    for (i = 0; i <= want; i++) {
      var at = nx === 1 ? 0 : Math.round(i * (nx - 1) / want);
      var px = xS(xs[at]);
      marks.push(mLine(px, plot.y0, px, plot.y1, 'ck-rule'));
      marks.push(mText(px, plot.y1 + 13, fmtT(xs[at], xspan),
                       'ck-tk', i === 0 ? 'start' : i === want ? 'end' : 'middle'));
      if (nx === 1) { break; }
    }
  }

  marks.push(mText(10, (plot.y0 + plot.y1) / 2, 'items, cumulative', 'ck-cap-ax', 'middle',
                   { transform: 'rotate(-90 10 ' + fin((plot.y0 + plot.y1) / 2) + ')' }));

  /* The bands. State 0 is the oldest and takes the top: its upper edge is the arrival curve for
     the whole system, and the bottom of the stack is the departure curve. */
  for (i = 0; i < ns; i++) {
    var topPts = [], botPts = [];
    for (j = 0; j < nx; j++) {
      topPts.push({ x: xS(xs[j]), y: yS(up[i][j]) });
      botPts.push({ x: xS(xs[j]), y: yS(i + 1 < ns ? up[i + 1][j] : 0) });
    }
    var kids = [];
    if (nx < 2) {
      if (nx === 1) { kids.push(mLine(topPts[0].x, topPts[0].y, botPts[0].x, botPts[0].y, 'ck-stub')); }
    } else {
      var d = edgeCmds(topPts, conf.curve, true) + ' ' + edgeCmds(botPts, conf.curve, false) + ' Z';
      var band = mPath(d, { fill: CK.hue(i), 'fill-opacity': '0.82', stroke: 'none' });
      band.ti = P.states[i] + ' \u00b7 ' + P.counts[i][nx - 1] + ' at the right edge' +
                (emptyStates.length && P.counts[i][nx - 1] === 0 ? ' \u00b7 never occupied' : '');
      kids.push(band);
    }
    marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
  }

  /* The annotations are the card's teaching: each of the three readings drawn once, in place, so a
     reader can see which measurement each claim comes from. */
  if (conf.annotate && nx > 1 && ns > 0) {
    var aj = Math.round((nx - 1) * 0.72);
    var ax0 = xS(xs[aj]);
    var yTop = yS(up[0][aj]);
    var yBot = yS(ns > 1 ? up[ns - 1][aj] : 0);
    marks.push(mLine(ax0, yTop, ax0, yBot, 'ck-ann'));
    marks.push(mLine(ax0 - 4, yTop, ax0 + 4, yTop, 'ck-ann'));
    marks.push(mLine(ax0 - 4, yBot, ax0 + 4, yBot, 'ck-ann'));
    marks.push(mText(ax0 + 7, (yTop + yBot) / 2 + 3.2,
                     'WIP ' + (up[0][aj] - (ns > 1 ? up[ns - 1][aj] : 0)), 'ck-ann-t', 'start'));

    if (ns > 1) {
      var dy0 = yS(up[ns - 1][0]), dy1 = yS(up[ns - 1][nx - 1]);
      marks.push(mLine(plot.x0, dy0, plot.x1, dy1, 'ck-chord'));
      marks.push(mText(plot.x1 - 4, dy1 - 6,
                       CK.fmt(trust.lam) + ' items/day', 'ck-ann-t', 'end'));
    }
  }

  if (conf.annotate && conf.littles && nx > 1 && ns > 1) {
    if (trust.ok && trust.Wms !== null && xspan > 0) {
      var wpx = (trust.Wms / xspan) * (plot.x1 - plot.x0);
      var mid = Math.round((nx - 1) * 0.38);
      var hy = (yS(up[0][mid]) + yS(up[ns - 1][mid])) / 2;
      var hx0 = Math.max(plot.x0, xS(xs[mid]) - wpx / 2);
      var hx1 = Math.min(plot.x1, hx0 + wpx);
      marks.push(mLine(hx0, hy, hx1, hy, 'ck-w'));
      marks.push(mLine(hx0, hy - 4, hx0, hy + 4, 'ck-w'));
      marks.push(mLine(hx1, hy - 4, hx1, hy + 4, 'ck-w'));
      marks.push(mText((hx0 + hx1) / 2, hy - 7, 'W ' + dur(trust.Wms), 'ck-ann-t', 'middle'));
    } else {
      marks.push(mText(plot.x0 + 6, plot.y0 + 12,
                       'cycle-time reading withheld \u2014 see below', 'ck-warn', 'start'));
    }
  }

  if (!nx || !ns) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, note: cfdNote(P, conf, trust, emptyStates, maxTotal) };
}

/* The browser gets exactly these, as text, plus one constant. They are hoisted declarations, so
   order within the list is cosmetic. */
const SHIPPED = [fin, tw, pad2, fmtT, dur, axisTicks, mLine, mText, mPath, stepExpand, edgeCmds,
                 cfdConfig, cfdUppers, cfdTrust, cfdNote, cfdRender];

/* `fmtT` and `dur` need a day in milliseconds, and it has to exist under the same name in both
   runtimes. Declared once here and emitted once into the browser half, rather than closed over,
   because a closed-over value does not survive Function.prototype.toString. */
const DAY_MS = DAY;

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so a state name containing `</script>` cannot close the block early,
 * with the useful side effect that no name can put an arrow into a file contractually free of them.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
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
  const own = '.ck-cfd[data-card="' + id + '"]';
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
 * that has to know anything. `prefers-color-scheme` is deliberately absent — the desk is one
 * document open in two viewers that want different answers.
 */
function cardCss(id, wide, W, multi) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-stub', 'stroke: var(--accent); stroke-width: 3;'],
    ['.ck-plot .ck-ann', 'stroke: var(--ink); stroke-width: 1.2;'],
    ['.ck-plot .ck-ann-t', 'fill: var(--ink); font-size: 9.5px;'],
    ['.ck-plot .ck-chord', 'stroke: var(--ink-dim); stroke-width: 1.2; stroke-dasharray: 4 3;'],
    ['.ck-plot .ck-w', 'stroke: var(--accent); stroke-width: 1.6;'],
    ['.ck-plot .ck-warn', 'fill: var(--ink-dim); font-size: 10px; font-style: italic;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  if (!multi) return scope(id, rules) + '\n';

  rules.push(['.ck-plot .ck-ser', 'transition: opacity .12s linear;']);
  rules.push(['.ck-plot:hover .ck-ser', 'opacity: .4;']);
  rules.push(['.ck-plot .ck-ser:hover', 'opacity: 1;']);
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, wide, legend) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-cfd">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="cumulative flow settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('curve') + '">curve</label>\n' +
    '    <select id="' + f('curve') + '" name="curve">' +
         opt('linear', 'straight between samples', defaults.curve) +
         opt('step', 'step (count holds)', defaults.curve) + '</select>\n' +
    '    <label for="' + f('littles') + '">cycle-time reading</label>\n' +
    '    <input id="' + f('littles') + '" name="littles" type="checkbox"' +
           (defaults.littles ? ' checked' : '') + '>\n' +
    '    <label for="' + f('annotate') + '">annotations</label>\n' +
    '    <input id="' + f('annotate') + '" name="annotate" type="checkbox"' +
           (defaults.annotate ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">the cycle-time reading is offered only when arrivals and ' +
         'departures balance and work in progress ends where it started; switching it on cannot ' +
         'override that, it only asks for it when it is available. There is no smoothing option: ' +
         'a curve between two counts draws a thickness nobody measured.</p>\n' +
    '  </div>\n' +
    '  ' + (wide ? '<div class="ck-scroll">' + plot + '</div>' : plot) + legend + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned.
 *
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* cumulative flow card: the same renderer that drew the copy in card.html, re-run when a\n' +
    '   setting changes. The stability test travels with it, so the browser cannot offer a\n' +
    '   horizontal reading that Node refused. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var DAY_MS = ' + String(DAY) + ';\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where flow decisions live. */\n' +
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
    '     a render that added marks would stack a second set of bands on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = cfdRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/cfd');
}

/**
 * Build one cumulative flow diagram from one data block.
 *
 * The window is `from` to `to` when given and the full data span otherwise, and it is named on the
 * card either way, because every statistic here is a statement about a window and a window that
 * nobody states is a window nobody can argue with. The state list defines the SYSTEM whose
 * Little's Law is being invoked: a reader who wants cycle time measured from "in progress" rather
 * than from "backlog" gives a narrower list, and gets a narrower answer.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame, captioned "no data"; nothing is claimed
 *   one item             one band of thickness one, the reading withheld for want of evidence
 *   all events identical a single column, drawn as thickness ticks; no slope, no gap, no reading
 *   duplicate ids        counted and kept as separate items, and the inflation is named
 *   an unparseable date  refused, counted, named; never coerced, because the epoch would stretch
 *                        the axis back to 1970 and flatten every band into the last pixel
 *   an always-empty state a band of zero thickness, kept so the colours do not shift, and named
 *   a backward move      the band SHRINKS, which is what happened; nothing is clamped
 *   an unknown state     refused against a supplied state list and counted, because the list is
 *                        what the workflow is; discovered in first-seen order when none is given,
 *                        and the caption says the order is a guess
 *   zero departures      no throughput to divide by; the reading is withheld and says so
 *   arrivals = departures the stable case: the reading is offered, and checked against the mean
 *                        cycle time actually measured from the items that finished
 *   a growing backlog    the reading is withheld and the caption says it would have understated
 *   500 items            columns thinned by stride to at most 240; every flow statistic is still
 *                        integrated from the complete event list
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ states, items, from, to }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the flow identity fails or the geometry produces a non-finite coordinate,
 *                 or when the emitted script would break the desk; all three mean a bug here,
 *                 since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'board',
 *   title: 'delivery board',
 *   data: { states: ['backlog', 'doing', 'done'],
 *           items: [{ id: 'a', events: [{ state: 'backlog', t: '2024-01-01' },
 *                                       { state: 'doing',   t: '2024-01-03' },
 *                                       { state: 'done',    t: '2024-01-06' }] }] },
 *   ord: 20,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'cfd' : id);
  const read = readData(data);
  const d = data && typeof data === 'object' ? data : {};

  const states = read.states;
  const items = read.items;
  const terminal = states.length - 1;

  /* Every event time, for the window and for the sampling grid. */
  const allT = [];
  for (const it of items) for (const e of it.ev) allT.push(e.t);
  allT.sort((a, b) => a - b);

  let t0 = readT(d.from);
  let t1 = readT(d.to);
  if (t0 === null) t0 = allT.length ? allT[0] : 0;
  if (t1 === null) t1 = allT.length ? allT[allT.length - 1] : t0 + DAY;
  if (!(t1 > t0)) t1 = t0 + DAY;

  const flow = states.length ? flowStats(items, terminal, t0, t1)
                             : { A: 0, D: 0, R: 0, wip0: 0, wip1: 0, Lbar: 0, spanMs: t1 - t0, cycles: [] };

  /* The sampling grid: the distinct event times inside the window, plus both ends, thinned by
     stride. Stride rather than bucket-averaging, so every drawn column is a real count at a real
     instant — which is what lets the claim "thickness is the work in progress" survive thinning. */
  const inside = [];
  const seen = new Set([t0, t1]);
  for (const t of allT) if (t >= t0 && t <= t1 && !seen.has(t)) { seen.add(t); inside.push(t); }
  const union = [t0, ...inside, t1].sort((a, b) => a - b);
  let xs = union;
  if (union.length > XCAP) {
    const step = Math.ceil(union.length / XCAP);
    xs = [];
    for (let i = 0; i < union.length; i += step) xs.push(union[i]);
    if (xs[xs.length - 1] !== union[union.length - 1]) xs.push(union[union.length - 1]);
  }

  const counts = states.map(() => new Array(xs.length).fill(0));
  for (const it of items) {
    let k = 0;
    let s = -1;
    for (let j = 0; j < xs.length; j++) {
      while (k < it.ev.length && it.ev[k].t <= xs[j]) { s = it.ev[k].s; k++; }
      if (s >= 0) counts[s][j]++;
    }
  }

  const P = {
    W0, H0, WMAX,
    states,
    xs,
    counts,
    t0, t1,
    itemCount: items.length,
    discovered: read.declared.length === 0 && states.length > 0,
    flow: { A: flow.A, D: flow.D, R: flow.R, wip0: flow.wip0, wip1: flow.wip1,
            Lbar: flow.Lbar, spanMs: flow.spanMs },
    measured: { n: flow.cycles.length, mean: meanOf(flow.cycles), median: medianOf(flow.cycles) },
    refusedEvents: read.refusedEvents,
    refusedItems: read.refusedItems,
    unknown: read.unknown,
    unknownNames: read.unknownNames,
    dupeIds: read.dupeIds,
    thinnedFrom: union.length,
    minEvents: MIN_EVENTS,
    balHi: BAL_HI,
    driftTol: DRIFT_TOL,
  };

  const seed = cfdRender(P, defaults);
  const wide = seed.W > W0;
  const legend = states.length > 1
    ? '\n  <div class="ck-legend">' +
      states.map((s, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(s) + '</span>').join('') +
      '</div>'
    : '';

  const trust = cfdTrust(P);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      items: items.length,
      states: states.length,
      columns: xs.length,
      arrivals: flow.A,
      departures: flow.D,
      reopened: flow.R,
      wip: [flow.wip0, flow.wip1],
      stable: trust.ok,
      refusedEvents: read.refusedEvents,
      refusedItems: read.refusedItems,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, wide, legend),
    css: cardCss(cardId, wide, seed.W, states.length > 1),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
