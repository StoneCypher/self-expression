/**
 * `montecarlo` — the honest alternative to a deadline: a resampled forecast that refuses to be a date.
 *
 * Given how much a team has finished in each of the last several periods, and how much is left,
 * this draws the sample of the historical throughput forward — with replacement, some thousands of
 * times — and shows the DISTRIBUTION of the periods in which the work ran out.
 *
 * TWO THINGS IT SAYS PLAINLY, because the card is worthless without them.
 *
 * A single completion date is a probability-1 claim about an uncertain system. There is no
 * arrangement of pixels that makes "the fourteenth" true. So this card leads with a range and a
 * confidence, draws the median line weakest of the three because it is the one people misread as
 * "the date", and puts the cumulative "chance of being finished by" curve over the bars so that
 * the natural reading is a probability rather than a day.
 *
 * It assumes the future resembles the past. The sample IS the assumption: if the team changed, or
 * the scope definition changed, or the process changed inside the sampled window, the sample is
 * wrong and the forecast inherits that exactly. So the card names the window and its length, and
 * offers a setting to shorten it to the recent past when the older part is known to be stale.
 *
 * DETERMINISM. The sampler is seeded by hashing the inputs, never from `Math.random()`, so the
 * same data always draws the same picture — a forecast that shifts when a page is reloaded is a
 * forecast nobody can quote. And all ten thousand trials run in NODE, at build time; the browser
 * receives a histogram and some percentiles and does nothing but paint.
 *
 * THE ALL-ZEROS CASE IS A GENUINE INFINITE LOOP and it is guarded twice: once analytically, by
 * noticing that a sample whose largest value is zero can never reach a positive remainder, and
 * once by a hard cap on the periods any single trial may draw. Trials that hit the cap are counted
 * as not finishing, and a percentile that falls into that tail is reported as beyond the cap
 * rather than as a number — which is the difference between a P95 and a P76 wearing its badge.
 *
 * @see ./cycletime.mjs  the backward-looking sibling; that describes the past, this forecasts
 * @see ./cfd.mjs        where the same throughput is read as a band slope
 * @see ./histogram.mjs  the general binned-count chart; this one bins a simulation, not a sample
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
  catch (e) { throw new Error('cardkit/montecarlo: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/montecarlo: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets, thresholds and the simulation's own constants ──────────────────────────── */

const W0   = 660;
const H0   = 330;
const WMAX = 2200;

/* Trials. Ten thousand is where the percentile estimates stop moving in the third significant
   figure between runs, and it costs milliseconds in Node. The number is stated on the card,
   because a forecast that does not say how many trials it ran is asking to be trusted. */
const TRIALS = 10000;

/* The hard cap on periods a single trial may draw. Without it, a throughput history of all zeros
   is an infinite loop, and a history whose mean is a hair above zero is one for practical
   purposes. A trial that hits this is counted as NOT FINISHING, never as finishing here. */
const CAP = 2000;

/* At most this many bars. Above it the period counts are bucketed and the bar width is stated;
   the percentiles are always computed from the raw trial outcomes, before any bucketing. */
const BARS = 120;

/* The sample windows offered. `all` is the default because throwing away history needs a reason,
   and the reason belongs to the reader who knows what changed and when. */
const WINDOWS = ['all', '6', '12'];

/* Beyond this many sample windows into the future, the forecast is being asked to hold over a
   longer span than the one it was measured over. Two is not a law; it is the point at which the
   extrapolation is longer than the evidence, which is worth a sentence. */
const HORIZON_TOL = 2;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `confidence` deliberately does not offer 50. The setting picks which percentile the card
 * emphasises, and a card that emphasises the median is a card that hands somebody a coin flip with
 * a date on it. The median is still drawn — weakest of the three — because hiding it would be its
 * own dishonesty.
 */
export const defaults = {
  sample:     'all',
  confidence: '85',
};

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'montecarlo',
  summary: 'A resampled completion forecast that leads with a range and a confidence, never a date.',
  shape: '{ remaining, history: [{ t, done }], from, scope } — t a date string, Date or epoch ms',
  category: 'work-and-lists',
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
  const where = who || 'cardkit/montecarlo';
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
 * A string that does not parse is refused rather than coerced: a failed parse becomes the epoch,
 * and a history period dated 1970 would set the derived period length to twenty thousand days.
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
 * A `done` count is kept only when it is a finite number and not negative. Negative throughput is
 * refused rather than clamped: a period in which minus three items were completed is a defect in
 * the source, and a clamped zero would enter the resampling pool as a real observation of a period
 * in which nothing happened, which is a different and false claim.
 *
 * A MISSING OR UNUSABLE `remaining` is fatal to the forecast rather than assumed. There is no
 * defensible default for how much work is left; zero would say "you are done" and any other number
 * would be invented.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ history, remaining, hasRemaining, badDone, badT, refused, scope, from }`
 *
 * @example readData({ remaining: 10, history: [{ t: 0, done: 3 }] }).history.length;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.history) ? d.history : [];
  const history = [];
  let badDone = 0;
  let badT = 0;
  let refused = 0;

  for (const h of raw) {
    if (!h || typeof h !== 'object') { refused++; continue; }
    const t = readT(h.t);
    const done = h.done;
    if (t === null) { badT++; continue; }
    if (typeof done !== 'number' || !Number.isFinite(done) || done < 0) { badDone++; continue; }
    history.push({ t, done });
  }
  history.sort((a, b) => a.t - b.t);

  const rem = d.remaining;
  const hasRemaining = typeof rem === 'number' && Number.isFinite(rem) && rem >= 0;

  return {
    history,
    remaining: hasRemaining ? rem : 0,
    hasRemaining,
    badDone, badT, refused,
    scope: d.scope == null ? '' : String(d.scope),
    from: readT(d.from),
  };
}

/** The median of a list of numbers, by the midpoint of the two central values. */
function medianOf(list) {
  if (!list.length) return 0;
  const a = list.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ── the sampler, which runs only in Node ────────────────────────────────────────────── */

/**
 * A 32-bit hash of a string, for seeding.
 *
 * FNV-1a, chosen because it is six lines and its avalanche is good enough to turn two histories
 * that differ in one item into two unrelated seeds — which is the only property a seed needs here.
 *
 * @example hashSeed('12|3,4,5|10000');   // a stable 32-bit integer
 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Mulberry32: a small, fast, well-distributed PRNG with a 32-bit state.
 *
 * Seeded from the data rather than from the clock or `Math.random()`, which is the whole point: a
 * forecast that draws a different picture on every reload is a forecast nobody can quote in a
 * meeting, and the difference between two reloads would be mistaken for news.
 *
 * @param a a 32-bit seed
 * @returns a function returning a float in [0, 1)
 *
 * @example const r = mulberry32(1); r() === mulberry32(1)();   // true
 */
export function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The nearest-rank percentile of the trial outcomes, with the unfinished trials ranked at the top.
 *
 * This is the function the whole card's honesty runs through. When one trial in five never
 * finished within the cap, those five thousand outcomes are the LARGEST ones — they are not
 * missing data, they are the tail — so a percentile whose rank falls among them does not exist as
 * a number and must be reported as beyond the cap. Sorting the finished trials and taking a
 * percentile of THOSE would quietly turn a 95th percentile into a 76th and print it with the same
 * confident label.
 *
 * @param ordered   ascending `[periods, trials]` pairs of the trials that finished
 * @param finished  how many trials finished
 * @param total     how many trials ran
 * @param p         a probability in 0..1
 * @returns the period count, or `null` when the percentile lies in the unfinished tail
 *
 * @example percentileOf([[2, 5], [3, 5]], 10, 10, 0.85);   // 3
 * @example percentileOf([[2, 5]], 5, 10, 0.85);            // null
 */
export function percentileOf(ordered, finished, total, p) {
  if (!total) return null;
  let k = Math.ceil(p * total);
  if (k < 1) k = 1;
  if (k > finished) return null;
  let cum = 0;
  for (const [periods, n] of ordered) {
    cum += n;
    if (cum >= k) return periods;
  }
  return null;
}

/**
 * Run the forecast: resample the pool forward until the remaining scope is exhausted.
 *
 * Sampling is WITH REPLACEMENT from the observed per-period throughput, which is the bootstrap and
 * is the only part of this that is standard. It assumes each period is exchangeable with the
 * others — no trend, no seasonality, no autocorrelation — and that assumption is exactly what the
 * caption's "it assumes the future resembles the past" means in arithmetic.
 *
 * The infinite loop is closed twice. Analytically: a pool whose largest value is zero can never
 * reach a positive remainder, and a remainder needing more than `cap` draws of the pool's BEST
 * period cannot finish either, so both short-circuit without running a trial. Structurally: every
 * trial's draw loop is bounded by `cap` regardless, and a trial that hits it is counted as not
 * finishing.
 *
 * @param pool      the per-period throughput observations to resample from
 * @param remaining how much work is left
 * @param trials    how many futures to draw
 * @param cap       the most periods any one trial may draw
 * @param seed      a 32-bit seed, derived from the inputs by the caller
 * @returns `{ finished, unfinished, ordered, minP, maxP, capped }`
 *
 * @example simulate([5], 10, 100, 2000, 1).ordered;   // [[2, 100]]
 * @example simulate([0, 0], 5, 100, 2000, 1).finished;   // 0
 */
export function simulate(pool, remaining, trials, cap, seed) {
  const counts = new Map();
  let finished = 0;
  let unfinished = 0;

  const best = pool.reduce((m, v) => (v > m ? v : m), 0);
  const impossible = pool.length === 0 || (remaining > 0 && (best <= 0 || remaining / best > cap));

  if (remaining <= 0) {
    counts.set(0, trials);
    finished = trials;
  } else if (impossible) {
    unfinished = trials;
  } else {
    const rnd = mulberry32(seed);
    const n = pool.length;
    for (let t = 0; t < trials; t++) {
      let acc = 0;
      let p = 0;
      while (acc < remaining && p < cap) {
        let k = Math.floor(rnd() * n);
        if (k >= n) k = n - 1;
        acc += pool[k];
        p++;
      }
      if (acc >= remaining) { finished++; counts.set(p, (counts.get(p) || 0) + 1); }
      else unfinished++;
    }
  }

  const ordered = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  return {
    finished, unfinished, ordered,
    minP: ordered.length ? ordered[0][0] : 0,
    maxP: ordered.length ? ordered[ordered.length - 1][0] : 0,
    capped: impossible && remaining > 0,
  };
}

/**
 * Bucket the trial outcomes into at most `bars` bars for drawing.
 *
 * The percentiles are never taken from this: they come from the raw outcomes, before any bucketing,
 * so widening the bars cannot move a quoted number. This exists only so a forecast spanning three
 * hundred periods draws as a shape rather than as three hundred one-pixel columns.
 *
 * @returns `{ bars: [{ a, b, n }], binw }` — `a` and `b` are inclusive period bounds
 *
 * @example bucket([[1, 2], [2, 3]], 120).binw;   // 1
 */
function bucket(ordered, bars) {
  if (!ordered.length) return { bars: [], binw: 1 };
  const lo = ordered[0][0];
  const hi = ordered[ordered.length - 1][0];
  const span = hi - lo + 1;
  const binw = span <= bars ? 1 : Math.ceil(span / bars);
  const out = new Map();
  for (const [p, n] of ordered) {
    const b = lo + Math.floor((p - lo) / binw) * binw;
    out.set(b, (out.get(b) || 0) + n);
  }
  return {
    bars: [...out.entries()].sort((a, b) => a[0] - b[0]).map(([a, n]) => ({ a, b: a + binw - 1, n })),
    binw,
  };
}

/**
 * One window's whole forecast: the pool, the simulation, the percentiles and the bars.
 *
 * @param history the parsed history, ascending by time
 * @param k       how many of the most recent periods to sample from; 0 for all
 * @param P       the run parameters `{ remaining, trials, cap, bars, ps }`
 * @returns everything the shipped renderer needs for this window
 */
function runWindow(history, k, P) {
  const used = k > 0 && k < history.length ? history.slice(history.length - k) : history.slice();
  const pool = used.map((h) => h.done);
  const seed = hashSeed(P.remaining + '|' + pool.join(',') + '|' + P.trials + '|' + P.cap);
  const sim = simulate(pool, P.remaining, P.trials, P.cap, seed);
  const bk = bucket(sim.ordered, P.bars);

  const pct = {};
  for (const p of P.ps) pct[String(p)] = percentileOf(sim.ordered, sim.finished, P.trials, p / 100);

  const sum = pool.reduce((a, b) => a + b, 0);
  return {
    k: pool.length,
    poolSum: sum,
    poolMean: pool.length ? sum / pool.length : 0,
    poolMedian: medianOf(pool),
    poolMax: pool.reduce((m, v) => (v > m ? v : m), 0),
    poolZeros: pool.filter((v) => v === 0).length,
    t0: used.length ? used[0].t : 0,
    t1: used.length ? used[used.length - 1].t : 0,
    finished: sim.finished,
    unfinished: sim.unfinished,
    minP: sim.minP,
    maxP: sim.maxP,
    capped: sim.capped,
    bars: bk.bars,
    binw: bk.binw,
    pct,
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────
   Everything from here to the SHIPPED list runs in BOTH halves: Node calls it to draw the card
   that ships, and the browser calls the identical text after a settings change. It is therefore
   written in the browser's vocabulary — var and function, no arrows, no template literals, no
   backtick in any comment. Nothing here samples anything: the simulation ran in Node and only its
   histogram travels. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) { throw new Error('cardkit/montecarlo: non-finite coordinate (' + v + ')'); }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face; measured, not guessed. */
function tw(s) { return String(s).length * 5.42; }

/** Two digits, so a month or a day aligns with the rest of the label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/** A plain calendar day, in UTC so it agrees with the strings the card was handed. */
function fmtDay(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/**
 * The label for a forecast horizon of `p` periods.
 *
 * A date when the history carries one, and a period count when it does not: a single history entry
 * gives no gap to measure a period length from, and inventing a week would put a date on the card
 * that nothing in the data supports.
 *
 * @example mcWhen({ from: 0, periodMs: 604800000 }, 2);   // '1970-01-15'
 */
function mcWhen(P, p) {
  if (!(P.periodMs > 0)) { return p + ' period' + (p === 1 ? '' : 's'); }
  return fmtDay(P.from + p * P.periodMs);
}

/**
 * Ticks that reach the ends of the axis instead of stopping short of them.
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

/** A display-list rectangle; negative extents are clamped rather than emitted as invalid SVG. */
function mRect(x, y, w, h, attrs) {
  var a = { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)) }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'rect', a: a };
}

/** A display-list path; the caller owns the shape, because only the caller knows it. */
function mPath(d, attrs) {
  var a = { d: d }, k;
  if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
  return { t: 'path', a: a };
}

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function mcConfig(cfg, P) {
  var c = cfg || {};
  var s = String(c.sample == null ? 'all' : c.sample);
  var k = String(c.confidence == null ? '85' : c.confidence);
  var i, ok = false;
  for (i = 0; i < P.windows.length; i++) { if (P.windows[i] === s) { ok = true; } }
  if (!ok) { s = 'all'; }
  if (k !== '85' && k !== '90' && k !== '95') { k = '85'; }
  return { sample: s, confidence: k };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption opens by refusing the question it was asked. Somebody looking at a completion
 * forecast wants a day, and there is no day: there is a distribution, and the useful sentence
 * pairs a date with the fraction of futures that beat it. So the lead is a range and a confidence,
 * the median gets an explicit demotion in words as well as in line weight, and the sample window
 * is named with its length so that a reader who knows the team changed in March can see whether
 * March is in the sample.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function mcNote(P, conf, S) {
  var pc = S.pct[conf.confidence];
  var p50 = S.pct['50'];
  var p95 = S.pct['95'];
  var pctUnfinished = P.trials > 0 ? (S.unfinished / P.trials) * 100 : 0;
  var windowDays = S.t1 > S.t0 ? (S.t1 - S.t0) / 86400000 : 0;
  var bits = [];

  if (!P.hasRemaining) {
    return {
      aria: 'Completion forecast with no remaining scope given: nothing was simulated.',
      caption: 'a completion forecast with <b>no remaining scope</b>. There is no defensible ' +
        'default for how much work is left \u2014 zero would say you are finished and anything ' +
        'else would be invented \u2014 so nothing was simulated and nothing is claimed.',
    };
  }
  if (!S.k) {
    return {
      aria: 'Completion forecast with no throughput history: nothing was simulated.',
      caption: 'a completion forecast with <b>no throughput history</b> to resample. ' +
        (P.badDone || P.badT
          ? '<i>' + CK.esc(String(P.badDone + P.badT)) + ' period' +
            (P.badDone + P.badT === 1 ? ' was' : 's were') + ' refused</i> for a missing date or a ' +
            'throughput that was not a number at or above zero. '
          : '') +
        'A forecast needs something to resample; there is nothing here, and an invented rate ' +
        'would be a deadline with a histogram drawn round it.',
    };
  }

  var aria;
  if (P.remaining === 0) {
    aria = 'Completion forecast for zero remaining items: the work is already finished, and every ' +
      'trial completed in zero periods.';
  } else if (S.finished === 0) {
    aria = 'Completion forecast in which none of the ' + P.trials + ' trials finished within ' +
      P.cap + ' periods. ' +
      (S.poolMax === 0
        ? 'Every period in the sample completed zero items, so no amount of time finishes this scope.'
        : 'The remaining scope is too large for this throughput to clear within the cap.') +
      ' No completion date exists on this evidence.';
  } else {
    aria = 'Completion forecast for ' + P.remaining + ' remaining item' +
      (P.remaining === 1 ? '' : 's') + ', from ' + P.trials + ' trials resampling ' + S.k +
      ' period' + (S.k === 1 ? '' : 's') + ' of throughput with replacement. ' +
      'Trials finished between ' + mcWhen(P, S.minP) + ' and ' + mcWhen(P, S.maxP) + '. ' +
      (pc !== null
        ? conf.confidence + ' in every 100 finished by ' + mcWhen(P, pc) + '. '
        : 'The ' + conf.confidence + 'th percentile falls beyond the cap of ' + P.cap + ' periods. ') +
      (p50 !== null ? 'Half finished by ' + mcWhen(P, p50) + ', which is a coin flip. ' : '') +
      'This is a distribution, not a date.';
  }

  var lead;
  if (P.remaining === 0) {
    lead = '<b>nothing remains.</b> The forecast is the present: every trial finished in zero ' +
      'periods, because there was nothing left to draw against. ';
  } else if (S.finished === 0) {
    lead = '<b>no completion date exists on this evidence.</b> None of the <b>' +
      CK.esc(String(P.trials)) + '</b> trials finished within the cap of <b>' +
      CK.esc(String(P.cap)) + '</b> periods. ' +
      (S.poolMax === 0
        ? 'Every one of the <b>' + CK.esc(String(S.k)) + '</b> sampled periods completed zero ' +
          'items, so resampling them forward never reduces the remainder \u2014 no amount of time ' +
          'finishes this scope, and the honest output is that sentence rather than a very large date. '
        : 'The <b>' + CK.esc(CK.fmt(P.remaining)) + '</b> remaining would need more than ' +
          CK.esc(String(P.cap)) + ' periods even at this sample\u2019s best rate of ' +
          CK.esc(CK.fmt(S.poolMax)) + ' per period. ') +
      'The cap is reported rather than raised, because a forecast that has to run for two thousand ' +
      'periods is not a forecast. ';
  } else {
    lead = '<b>this is not a date.</b> <b>' + CK.esc(String(P.trials)) + '</b> trials, each ' +
      'resampling <b>' + CK.esc(String(S.k)) + '</b> period' + (S.k === 1 ? '' : 's') +
      ' of throughput <i>with replacement</i>, finished between <b>' +
      CK.esc(mcWhen(P, S.minP)) + '</b> and <b>' + CK.esc(mcWhen(P, S.maxP)) + '</b> for the <b>' +
      CK.esc(CK.fmt(P.remaining)) + '</b> item' + (P.remaining === 1 ? '' : 's') + ' remaining' +
      (P.scope ? ' (' + CK.esc(P.scope) + ')' : '') + '. ';
    lead += pc !== null
      ? '<b>' + CK.esc(conf.confidence) + ' in every 100 finished by ' + CK.esc(mcWhen(P, pc)) +
        '.</b> '
      : 'The <b>' + CK.esc(conf.confidence) + 'th percentile lies beyond the ' +
        CK.esc(String(P.cap)) + '-period cap</b>, so it is not a number here. ';
    lead += p50 !== null
      ? '<i>Half finished by ' + CK.esc(mcWhen(P, p50)) + ' \u2014 that is a coin flip, and it is ' +
        'drawn faintest on purpose. It is not a plan.</i> '
      : '';
  }

  /* The assumption, named with the window it rests on. This is the paragraph the card exists for
     as much as the picture is. */
  if (S.k) {
    bits.push('<b>this assumes the future resembles the past.</b> The sample is the ' + S.k +
      ' period' + (S.k === 1 ? '' : 's') +
      (S.t1 > S.t0 ? ' from ' + CK.esc(fmtDay(S.t0)) + ' to ' + CK.esc(fmtDay(S.t1)) +
        ', a span of ' + CK.esc(CK.fmt(windowDays)) + ' days' : '') +
      ', in which ' + S.poolSum + ' item' + (S.poolSum === 1 ? '' : 's') + ' were completed at a ' +
      'median of ' + CK.esc(CK.fmt(S.poolMedian)) + ' per period. If the team, the scope ' +
      'definition or the process changed inside that span, the sample is wrong and this forecast ' +
      'inherits the error exactly');
  }
  if (S.unfinished && S.finished) {
    bits.push('<b>' + CK.esc(CK.fmt(pctUnfinished)) + ' per cent</b> of trials did not finish ' +
      'within the ' + P.cap + '-period cap; those are the LARGEST outcomes, so they are counted ' +
      'in the ranking rather than dropped \u2014 dropping them would turn a 95th percentile into ' +
      'a 76th and print it with the same label');
  }
  if (S.k === 1) {
    bits.push('<i>there is one throughput observation</i>, so resampling it has nothing to vary: ' +
      'every trial is identical and the spread you are looking at is zero. This is a single number ' +
      'wearing a distribution\u2019s clothes, and one period of history cannot say otherwise');
  }
  if (S.k > 1 && S.poolMax > S.poolMedian * 3 && S.poolMedian > 0) {
    bits.push('one period completed <b>' + CK.esc(CK.fmt(S.poolMax)) + '</b> items against a ' +
      'median of ' + CK.esc(CK.fmt(S.poolMedian)) + '; resampling draws it about one period in ' +
      S.k + ', which pulls the optimistic tail. It is in the sample because it happened');
  }
  if (S.poolZeros && S.k > 1) {
    bits.push(S.poolZeros + ' of the ' + S.k + ' sampled periods completed nothing, and they are ' +
      'drawn as often as any other \u2014 which is what makes the slow tail as long as it is');
  }
  if (S.finished && pc !== null && S.k > 0 && pc > S.k * P.horizonTol) {
    bits.push('<i>the forecast reaches further than the evidence</i>: ' + pc + ' periods ahead ' +
      'against ' + S.k + ' periods of history. Past about ' + P.horizonTol +
      ' windows the assumption of an unchanged future is being asked to hold over a longer span ' +
      'than the one it was measured across');
  }
  if (!(P.periodMs > 0) && S.k > 1) {
    bits.push('the history has no usable spacing, so horizons are given in periods rather than ' +
      'dates; a date would be an invented period length');
  }
  if (P.irregular) {
    bits.push('the history periods are irregularly spaced \u2014 the shortest is ' +
      CK.esc(CK.fmt(P.gapMin / 86400000)) + ' days and the longest ' +
      CK.esc(CK.fmt(P.gapMax / 86400000)) + ' \u2014 so the calendar arithmetic uses the median ' +
      'gap of ' + CK.esc(CK.fmt(P.periodMs / 86400000)) + ' days and is approximate');
  }
  if (S.binw > 1) {
    bits.push('bars are ' + S.binw + ' periods wide; every percentile above was taken from the raw ' +
      'trial outcomes before any bucketing, so the bar width cannot move a quoted number');
  }
  if (P.badDone) {
    bits.push('<b>' + P.badDone + '</b> history period' + (P.badDone === 1 ? '' : 's') +
      ' had a throughput that was not a number at or above zero and were refused, not clamped: a ' +
      'clamped zero enters the pool as a real observation of a period in which nothing happened');
  }
  if (P.badT) {
    bits.push('<b>' + P.badT + '</b> history period' + (P.badT === 1 ? '' : 's') +
      ' had an unparseable date and were refused; a failed parse is the epoch, which would set the ' +
      'derived period length to twenty thousand days');
  }
  if (P.refused) {
    bits.push('<b>' + P.refused + '</b> history row' + (P.refused === 1 ? '' : 's') +
      ' were not objects at all');
  }
  bits.push('the sampler is seeded from the data, never from the clock, so the same input always ' +
    'draws the same picture');

  return {
    aria: aria,
    caption: lead + '<span class="ck-aside">' + bits.join('; ') + '.</span>',
  };
}

/**
 * Everything the browser needs to paint, from a payload and a settings object.
 *
 * The bars are the shape of the answer and the curve over them is the answer: a reader tracing the
 * cumulative line reads "chance of being finished by", which is the only reading of this chart
 * that is true. The three percentile lines are drawn in three weights, weakest at the median, so
 * that even a glance is pulled toward the number worth committing to.
 *
 * @param P   the shipped payload built by {@link build}
 * @param cfg the settled settings: `sample`, `confidence`
 * @returns `{ W, H, marks, note }`
 *
 * @example mcRender(P, { sample: 'all', confidence: '85' }).marks.length;
 */
function mcRender(P, cfg) {
  var conf = mcConfig(cfg, P);
  var S = P.sims[conf.sample] || P.sims.all;
  var marks = [], i;

  var bars = S.bars;
  var maxN = 0;
  for (i = 0; i < bars.length; i++) { if (bars[i].n > maxN) { maxN = bars[i].n; } }

  var ay = axisTicks(0, maxN > 0 ? maxN : 1, 4);
  var leftW = 0;
  for (i = 0; i < ay.ticks.length; i++) { leftW = Math.max(leftW, tw(CK.fmt(ay.ticks[i]))); }

  var padT = 26, padR = 46, padB = 36;
  var padL = Math.round(Math.min(80, leftW)) + 12 + 12;
  var W = P.W0, H = P.H0;
  var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  var lo = bars.length ? bars[0].a : 0;
  var hi = bars.length ? bars[bars.length - 1].b + 1 : 1;
  if (!(hi > lo)) { hi = lo + 1; }
  var xS = CK.scale([lo, hi], [plot.x0, plot.x1]);
  var yS = CK.scale([ay.lo, ay.hi], [plot.y1, plot.y0]);
  var cS = CK.scale([0, 100], [plot.y1, plot.y0]);

  for (i = 0; i < ay.ticks.length; i++) {
    var ty = yS(ay.ticks[i]);
    marks.push(mLine(plot.x0, ty, plot.x1, ty, 'ck-rule'));
    marks.push(mText(plot.x0 - 6, ty + 3.2, CK.fmt(ay.ticks[i]), 'ck-tk', 'end'));
  }
  var cticks = [0, 25, 50, 75, 100];
  for (i = 0; i < cticks.length; i++) {
    marks.push(mText(plot.x1 + 5, cS(cticks[i]) + 3.2, cticks[i] + '%', 'ck-ctk', 'start'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  var want = Math.max(2, Math.min(6, Math.floor((plot.x1 - plot.x0) / 92)));
  for (i = 0; i <= want; i++) {
    var pv = Math.round(lo + ((hi - lo) * i) / want);
    marks.push(mText(xS(pv), plot.y1 + 13, mcWhen(P, pv), 'ck-tk',
                     i === 0 ? 'start' : i === want ? 'end' : 'middle'));
  }
  marks.push(mText(10, (plot.y0 + plot.y1) / 2, 'trials', 'ck-cap-ax', 'middle',
                   { transform: 'rotate(-90 10 ' + fin((plot.y0 + plot.y1) / 2) + ')' }));
  marks.push(mText((plot.x0 + plot.x1) / 2, H - 4,
                   P.periodMs > 0 ? 'completion date' : 'periods from now', 'ck-cap-ax', 'middle'));

  var kids = [];
  for (i = 0; i < bars.length; i++) {
    var xa = xS(bars[i].a), xb = xS(bars[i].b + 1);
    var yb = yS(bars[i].n);
    var r = mRect(xa + 0.4, yb, Math.max(0.6, xb - xa - 0.8), plot.y1 - yb,
                  { fill: CK.hue(0), 'fill-opacity': '0.5', stroke: 'none', 'class': 'ck-bar' });
    r.ti = mcWhen(P, bars[i].a) + (S.binw > 1 ? ' to ' + mcWhen(P, bars[i].b) : '') +
           '  \u00b7  ' + bars[i].n + ' of ' + P.trials + ' trials';
    kids.push(r);
  }
  marks.push({ t: 'g', a: { 'class': 'ck-bars' }, kids: kids });

  /* The cumulative curve. It is the reason the card is hard to read as a single date: the eye
     following it is answering "what are the chances by then", which is the question with an answer. */
  if (bars.length) {
    var run = 0, d = '';
    for (i = 0; i < bars.length; i++) {
      run += bars[i].n;
      var cx = xS(bars[i].b + 1);
      var cy = cS(P.trials > 0 ? (run / P.trials) * 100 : 0);
      d += (i === 0 ? 'M' + fin(xS(bars[i].a)) + ' ' + fin(cS(0)) + 'L' : 'L') + fin(cx) + ' ' + fin(cy);
    }
    marks.push(mPath(d, { fill: 'none', stroke: 'var(--accent)', 'stroke-width': '1.6',
                          'stroke-linejoin': 'round', 'class': 'ck-cum' }));
  }

  var order = ['50', '85', '90', '95'];
  for (i = 0; i < order.length; i++) {
    var key = order[i];
    var pv2 = S.pct[key];
    if (pv2 === null || pv2 === undefined) { continue; }
    if (key !== '50' && key !== conf.confidence && key !== '85' && key !== '95') { continue; }
    var px = xS(pv2 + 0.5);
    if (px < plot.x0 - 0.5 || px > plot.x1 + 0.5) { continue; }
    var cls = key === '50' ? 'ck-pl ck-p50' : key === conf.confidence ? 'ck-pl ck-ppick' : 'ck-pl';
    var ln = mLine(px, plot.y0 - 8, px, plot.y1, cls);
    ln.ti = key + ' in every 100 trials finished by ' + mcWhen(P, pv2);
    marks.push(ln);
    marks.push(mText(px, plot.y0 - 11, 'p' + key, key === conf.confidence ? 'ck-plab ck-plab-pick' : 'ck-plab', 'middle'));
  }

  /* The trials that never finished. Drawn as a stub against the right edge rather than left off,
     because a distribution with a fifth of its mass missing and no mark for it looks complete. */
  if (S.unfinished) {
    var uh = (plot.y1 - plot.y0) * Math.min(1, S.unfinished / (maxN > 0 ? Math.max(maxN, S.unfinished) : 1));
    var ur = mRect(plot.x1 - 7, plot.y1 - uh, 6, uh,
                   { fill: 'var(--ink-dim)', 'fill-opacity': '0.5', stroke: 'none', 'class': 'ck-unfin' });
    ur.ti = S.unfinished + ' of ' + P.trials + ' trials did not finish within ' + P.cap + ' periods';
    marks.push(ur);
  }

  if (!bars.length) {
    marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2,
                     S.k ? 'no trial finished' : 'no forecast', 'ck-empty', 'middle'));
  }

  return { W: W, H: H, marks: marks, note: mcNote(P, conf, S) };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, pad2, fmtDay, mcWhen, axisTicks, mLine, mText, mRect, mPath,
                 mcConfig, mcNote, mcRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so a scope note containing `</script>` cannot close the block early,
 * with the useful side effect that no text can put an arrow into a file contractually free of them.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsLit({ scope: '</script>' });   // '{"scope":"\\u003c/script\\u003e"}'
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
  const own = '.ck-montecarlo[data-card="' + id + '"]';
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
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-ctk', 'fill: var(--ink-faint); font-size: 9px;'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-bar', 'shape-rendering: crispEdges;'],
    ['.ck-plot .ck-pl', 'stroke: var(--ink-dim); stroke-width: 1.2;'],
    /* The median is drawn faintest of the three. It is the line people read as "the date", and it
       is the one that promises the least: half of all futures are worse than it. */
    ['.ck-plot .ck-p50', 'stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 2 3;'],
    ['.ck-plot .ck-ppick', 'stroke: var(--accent); stroke-width: 1.8;'],
    ['.ck-plot .ck-plab', 'fill: var(--ink-faint); font-size: 9px;'],
    ['.ck-plot .ck-plab-pick', 'fill: var(--accent); font-size: 10px; font-weight: 600;'],
    ['.ck-plot .ck-unfin', 'stroke: none;'],
  ];
  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, sims) {
  const f = (name) => CK.esc(id) + '-' + name;
  const opt = (v, label, chosen) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>';

  const winLabel = (w) => w === 'all'
    ? 'all ' + sims.all.k + ' periods'
    : 'last ' + w + (sims[w].k < Number(w) ? ' (only ' + sims[w].k + ' available)' : '');

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-montecarlo">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="forecast settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('sample') + '">sample window</label>\n' +
    '    <select id="' + f('sample') + '" name="sample">' +
         WINDOWS.map((w) => opt(w, winLabel(w), defaults.sample)).join('') + '</select>\n' +
    '    <label for="' + f('confidence') + '">confidence</label>\n' +
    '    <select id="' + f('confidence') + '" name="confidence">' +
         opt('85', '85 in 100', defaults.confidence) +
         opt('90', '90 in 100', defaults.confidence) +
         opt('95', '95 in 100', defaults.confidence) + '</select>\n' +
    '    <p class="ck-set-foot">shorten the sample window when you know the older periods are ' +
         'stale \u2014 a reorganisation, a change of what counts as an item. Every window was ' +
         'simulated at build time, so switching one does not run ten thousand trials in your ' +
         'browser. There is no 50 in the confidence list: a median completion date is a coin flip ' +
         'with a day written on it.</p>\n' +
    '  </div>\n' +
    '  ' + plot + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned. No sampler travels: every window was simulated in Node and only the
 * histograms and percentiles are here.
 *
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* completion forecast card: the simulation ran in Node at build time and only its histogram\n' +
    '   travelled, so switching the sample window picks a precomputed result rather than running\n' +
    '   ten thousand trials on the reader machine. The caption is built by the same function that\n' +
    '   built the one in card.html. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
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
    '     stays a translator rather than a second place where forecast decisions live. */\n' +
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
    '     a render that added marks would stack a second forecast on the first every swap. */\n' +
    '  function render(conf) {\n' +
    '    var out = mcRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/montecarlo');
}

/**
 * Build one completion forecast from one data block.
 *
 * The period length is DERIVED from the median gap between history entries rather than taken from
 * a label, so it can be checked against the data that produced it, and the spread of gaps is
 * reported when the periods are irregular. A history with fewer than two entries has no gap to
 * measure, so horizons are reported in periods rather than dates: a date would require an invented
 * period length, and the card would then be asserting a calendar it was never given.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty frame; no remaining scope was given, so nothing is simulated and
 *                        the caption says why a default would be an invention
 *   zero remaining       every trial finishes in zero periods; the card says the work is done
 *   all-zero throughput  the analytic short-circuit catches it before a single trial runs, and the
 *                        per-trial cap would catch it anyway. No trial finishes, the caption says
 *                        that no amount of time finishes this scope, and no date is printed
 *   one observation      every trial is identical and the spread is zero; the caption calls it a
 *                        single number wearing a distribution's clothes
 *   scope beyond history the forecast runs, and the caption says how far past the evidence it
 *                        reaches; past two sample windows the extrapolation is named as one
 *   scope beyond the cap the short-circuit notices that even the best observed period cannot clear
 *                        it in 2,000 draws, and reports the cap rather than raising it
 *   one huge outlier     it is resampled like any other period, about once every k draws, and the
 *                        caption names it and says which tail it pulls
 *   a negative throughput refused and counted, never clamped to zero
 *   an unparseable date  refused and counted; a failed parse is the epoch, which would make the
 *                        derived period length twenty thousand days
 *   500 history periods  all sampled; the outcome histogram is bucketed to at most 120 bars, and
 *                        every percentile is still taken from the raw trial outcomes
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ remaining, history: [{ t, done }], from, scope }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'ship',
 *   title: 'when does the backlog clear',
 *   data: { remaining: 40, scope: 'open issues in milestone 3',
 *           history: [{ t: '2024-01-07', done: 5 }, { t: '2024-01-14', done: 3 },
 *                     { t: '2024-01-21', done: 7 }, { t: '2024-01-28', done: 4 }] },
 *   ord: 25,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'montecarlo' : id);
  const read = readData(data);
  const hist = read.history;

  /* The period length, derived rather than declared. The median gap is robust to one missing week
     in the export in a way the mean is not. */
  const gaps = [];
  for (let i = 1; i < hist.length; i++) gaps.push(hist[i].t - hist[i - 1].t);
  const periodMs = gaps.length ? medianOf(gaps) : 0;
  const gapMin = gaps.length ? Math.min(...gaps) : 0;
  const gapMax = gaps.length ? Math.max(...gaps) : 0;
  const irregular = gaps.length > 1 && periodMs > 0 && gapMax > gapMin * 1.5;

  const run = {
    remaining: read.remaining,
    trials: TRIALS,
    cap: CAP,
    bars: BARS,
    ps: [50, 85, 90, 95],
  };

  const sims = {};
  for (const w of WINDOWS) {
    sims[w] = read.hasRemaining
      ? runWindow(hist, w === 'all' ? 0 : Number(w), run)
      : { k: 0, poolSum: 0, poolMean: 0, poolMedian: 0, poolMax: 0, poolZeros: 0,
          t0: 0, t1: 0, finished: 0, unfinished: 0, minP: 0, maxP: 0, capped: false,
          bars: [], binw: 1, pct: { 50: null, 85: null, 90: null, 95: null } };
  }

  const P = {
    W0, H0, WMAX,
    windows: WINDOWS,
    trials: TRIALS,
    cap: CAP,
    horizonTol: HORIZON_TOL,
    remaining: read.remaining,
    hasRemaining: read.hasRemaining,
    scope: read.scope,
    from: read.from !== null ? read.from : (hist.length ? hist[hist.length - 1].t : 0),
    periodMs,
    gapMin, gapMax, irregular,
    badDone: read.badDone,
    badT: read.badT,
    refused: read.refused,
    sims,
  };

  const seed = mcRender(P, defaults);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      remaining: read.hasRemaining ? read.remaining : null,
      historyPeriods: hist.length,
      periodDays: periodMs > 0 ? periodMs / 86400000 : null,
      trials: TRIALS,
      cap: CAP,
      p50: sims.all.pct['50'],
      p85: sims.all.pct['85'],
      p95: sims.all.pct['95'],
      unfinishedTrials: sims.all.unfinished,
      refusedPeriods: read.badDone + read.badT + read.refused,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, sims),
    css: cardCss(cardId),
    js: cardJs(cardId, P, defaults),
  };
}

export default { meta, build };
