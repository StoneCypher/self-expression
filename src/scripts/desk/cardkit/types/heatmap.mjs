/**
 * @file cardkit card type: `heatmap` — a year of days as a week grid. The ribbon's long view.
 *
 * Columns are weeks, rows are weekdays, and every cell is one local calendar day. The ribbon
 * answers "when, today?"; this answers "how has it been going?", and the two share their
 * discipline about time even though they work at opposite resolutions.
 *
 * **A day is a label, not an instant.** That sentence is the whole of the date handling here and
 * it is worth stating rather than implying. `2026-02-29` is a name for a square on a grid; it
 * has no hour, no zone, and no duration, and converting it to an instant in order to do
 * arithmetic on it is how heatmaps end up with a duplicated or missing column twice a year, when
 * a local midnight is 23 or 25 hours after the last one. So every day here is an integer — days
 * since 1970-01-01, computed with `Date.UTC` on the calendar fields — and every piece of date
 * arithmetic is integer arithmetic on that number. `Date.UTC` is used purely as an exact
 * proleptic-Gregorian calculator; nothing about UTC as a *zone* is being claimed. Leap days,
 * month lengths and century rules come out right because that calculator already knows them.
 *
 * **Sequential data gets one hue at ordered opacities, not five hues.** A five-colour categorical
 * ramp would be prettier and would be lying: hue is not ordered, so a reader cannot tell which
 * end is "more" without consulting the legend on every single cell. Lightness and opacity are
 * ordered, everybody reads them the same way round, and the ramp still works for the two most
 * common colour-vision deficiencies. One series token at N opacities is the whole palette.
 *
 * **Quantile is the default and that is a claim about the data, not a preference.** See
 * {@link binLevels} for the argument and the caption for the version a reader gets.
 *
 * Geometry and binning are computed in Node and the browser is handed arrays to paint, per the
 * contract. Both `weekStart` values, all three level counts and both scales are built up front
 * so that no browser ever has to divide by a spread that might be zero.
 *
 * @see ../CONTRACT.md — the rules every type keeps
 * @see ./ribbon.mjs   — the same data over one day instead of a year
 * @see ./chart.mjs    — the vm-loaded `CK` and the display-list idiom, adopted from there
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it.
 *
 * Loading the real kit rather than reimplementing `fmt`, `esc` and `hue` is the contract's rule:
 * a private copy is a second source of truth and it drifts silently.
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
  catch (e) { throw new Error('cardkit/heatmap: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/heatmap: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants ───────────────────────────────────────────────────────────────────────── */

/** Milliseconds in a calendar day; the divisor that turns a `Date.UTC` result into a day label. */
const DAY_MS = 86400000;

/**
 * Every setting the heatmap understands, with the value it falls back to.
 *
 * `quantile` is the default deliberately — see {@link binLevels}. `sun` matches the convention
 * most readers have already learned from contribution graphs. Five levels is the count that ramp
 * was designed around; three and seven exist because a short range has too few distinct values
 * to support five, and a very long one can carry more.
 */
const DEFAULTS = { weekStart: 'sun', levels: 5, scale: 'quantile', months: true };

/** The two week starts. Anything else falls back to `sun`. */
const WEEK_STARTS = ['sun', 'mon'];

/** The three level counts the panel offers. */
const LEVEL_CHOICES = [3, 5, 7];

/** The two binning strategies. Anything else falls back to `quantile`. */
const SCALES = ['linear', 'quantile'];

/* Layout. A cell is a square with a hairline of air around it; 11 + 2 is the pitch a year of
   columns has to fit into, and 53 of them do not fit in a 640px desk column, so a full year
   deliberately scrolls inside `.ck-scroll` rather than shrinking into a texture. */
const CELL = 11;
const GAP = 2;
const PITCH = CELL + GAP;
const PAD_L = 26;
const PAD_T = 14;
const PAD_R = 4;
const PAD_B = 2;
const W0 = 640;

/** More days than this and the grid stops being a picture; the range is trimmed and said so. */
const MAX_DAYS = 2000;

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css. It decides how far apart two
   month labels have to be before both can be drawn. */
const CHW = 5.42;

/** The faintest and fullest a level may be. Level 0 is not on this ramp; it is a token. */
const OP_LOW = 0.22;
const OP_HIGH = 1;

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `shape` is a string per the contract: it is read by a person deciding what to feed the card.
 */
export const meta = {
  name: 'heatmap',
  summary: 'A year of local days as a week grid, one hue binned into ordered opacity levels.',
  shape:
    '{ days: [{ date, value }], weeks, start, end, unit, scale, levels, weekStart, hue }',
  category: 'evolution',
  defaults: { ...DEFAULTS },
};

/* ── text hygiene ────────────────────────────────────────────────────────────────────── */

/**
 * Strip control characters out of an untrusted string, comparing code points numerically.
 *
 * Data reaches this card from files and logs, and a raw control character in a unit name would
 * land in the emitted JavaScript, where it is invisible in an editor, invisible on readback,
 * legal to the parser, and survives `node --check`. The contract has seven incidents to show for
 * it. The comparison is arithmetic — `charCodeAt(i) < 32` — precisely so that no character class
 * has to be written, because a character class is a thing that can hold the character it means
 * to describe.
 *
 * @param s any value; null and undefined become the empty string
 *
 * @example clean('ok');   // 'ok'
 */
function clean(s) {
  const str = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
    if (c === 127) continue;
    out += str.charAt(i);
  }
  return out;
}

/**
 * Serialise a value as a JavaScript literal that is safe inside a classic `<script>` element.
 *
 * `<` and `>` become escapes so a string containing `</script>` cannot close the block early,
 * with the useful side effect that no unit name can put `=>` into a file that is contractually
 * free of arrow functions. Backticks go for the same contract, and `?` so that no name can put
 * `?.` into it either — the escape decodes back to a plain question mark, so nothing a reader
 * sees changes. The two line separators go because they are newlines to a JS parser and are not
 * to `JSON.stringify`.
 *
 * @example jsLit({ unit: '</script>' });   // '{"unit":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060').replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops it and the card renders empty with
 * nothing in the console.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(12.3456, 'cell');   // 12.35
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/heatmap: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face. */
function textW(s) { return String(s).length * CHW; }

/* ── days as labels ──────────────────────────────────────────────────────────────────── */

/**
 * A `YYYY-MM-DD` label as an integer day number, or null when it is not a real date.
 *
 * `Date.UTC` here is a proleptic-Gregorian calculator, not a claim about time zones: the card
 * never converts a day to an instant, so there is no zone for it to be wrong about. That is the
 * whole reason leap days, month lengths and the century rules come out right without a line of
 * code about any of them.
 *
 * The round-trip check is not decoration. `Date.UTC(2026, 1, 30)` is 2026-03-02 rather than an
 * error, so a typo silently becomes a different day and the grid quietly shifts.
 *
 * @param iso a local calendar day, as a label
 * @returns days since 1970-01-01, or null
 *
 * @example dayNumOf('2026-02-29');   // null — 2026 is not a leap year
 * @example dayNumOf('2028-02-29');   // 21243
 */
function dayNumOf(iso) {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(clean(iso));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(ms)) return null;
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return Math.round(ms / DAY_MS);
}

/** The inverse: a day number back to its `YYYY-MM-DD` label. */
function dayLabel(dayNum) {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Weekday of a day number, 0 = Sunday.
 *
 * 1970-01-01 is day 0 and was a Thursday, so the offset is 4. Doing it arithmetically rather
 * than by constructing a `Date` and asking is deliberate: `getDay` is the *local* weekday and
 * would make the grid depend on the machine that built the card.
 *
 * @example weekdayOf(0);   // 4 — Thursday
 */
function weekdayOf(dayNum) {
  return (((dayNum + 4) % 7) + 7) % 7;
}

/** Row index for a day, given which weekday a column starts on. */
function rowOf(dayNum, weekStart) {
  const wd = weekdayOf(dayNum);
  return weekStart === 'mon' ? (wd + 6) % 7 : wd;
}

/** The first day of the grid column containing `dayNum`. */
function weekStartOf(dayNum, weekStart) {
  return dayNum - rowOf(dayNum, weekStart);
}

/** Month index 0..11 of a day number, read off the same exact calculator. */
function monthOf(dayNum) { return new Date(dayNum * DAY_MS).getUTCMonth(); }

/** Day-of-month of a day number. */
function domOf(dayNum) { return new Date(dayNum * DAY_MS).getUTCDate(); }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Row labels, indexed by weekday with 0 = Sunday. Only three are drawn — the alternating
   Mon/Wed/Fri that contribution grids settled on — because seven three-letter labels in 91
   pixels of height is a wall of text beside a picture. */
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── colours ─────────────────────────────────────────────────────────────────────────── */

/**
 * A series token in any of the spellings a data file is likely to use, as a `var()` reference.
 *
 * Accepts `--ck-s4`, `ck-s4`, `s4`, `4` and `var(--ck-s4)`, and refuses everything else — in
 * particular a literal colour, which is a bug in one of the two themes and must not be able to
 * enter through data.
 *
 * @example hueVar('s4');       // 'var(--ck-s4)'
 * @example hueVar('#0f0');     // 'var(--ck-s4)' — a literal colour is not a token
 */
function hueVar(token) {
  const t = clean(token).trim().toLowerCase();
  const m = /^(?:var\(\s*)?(?:--)?(?:ck-)?s?([1-8])\s*\)?$/.exec(t);
  return m ? 'var(--ck-s' + m[1] + ')' : 'var(--ck-s4)';
}

/**
 * The opacity ramp for `L` levels: ordered, evenly spaced, single hue.
 *
 * Ordered is the requirement. Five hues would be prettier and unreadable, because hue has no
 * intrinsic order and a reader would have to check the legend for every cell to know which way
 * "more" runs. Opacity has one obvious direction and keeps working for the two most common
 * colour-vision deficiencies, where a hue ramp collapses.
 *
 * The floor is 0.22 rather than 0: level 1 has to be visibly *something* against the card, and
 * distinguishable from level 0, which is not on this ramp at all — it is a token-filled well.
 *
 * @example ramp(3);   // [0.22, 0.61, 1]
 */
function ramp(L) {
  const out = [];
  for (let i = 1; i <= L; i++) {
    out.push(L === 1 ? OP_HIGH : Math.round((OP_LOW + (i - 1) * (OP_HIGH - OP_LOW) / (L - 1)) * 1000) / 1000);
  }
  return out;
}

/* ── reading the data ────────────────────────────────────────────────────────────────── */

/**
 * The value at fractional position `p` through a sorted array, interpolating between neighbours.
 *
 * @param sorted ascending values, at least one
 * @param p      0..1
 *
 * @example quantileAt([1, 2, 3, 4], 0.5);   // 2.5
 */
function quantileAt(sorted, p) {
  if (!sorted.length) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * Duplicate dates are summed rather than overwriting one another: a day is a bucket, and two
 * rows for 2026-01-14 are two contributions to the same square. A row whose date is not a real
 * calendar day, or whose value is not a finite number, is skipped and *counted*, because a
 * heatmap that quietly loses rows is a heatmap that lies about a total.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns the range, the ordered day list, and every count the caption will quote
 *
 * @example readData({ days: [{ date: '2026-01-14', value: 42 }] }).total;   // 42
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rows = Array.isArray(d.days) ? d.days : [];

  const byDay = new Map();
  let dropped = 0;
  let dataMin = null;
  let dataMax = null;

  for (const r of rows) {
    if (!r || typeof r !== 'object') { dropped++; continue; }
    const num = dayNumOf(r.date);
    const v = Number(r.value);
    if (num == null || !Number.isFinite(v)) { dropped++; continue; }
    byDay.set(num, (byDay.get(num) || 0) + v);
    if (dataMin == null || num < dataMin) dataMin = num;
    if (dataMax == null || num > dataMax) dataMax = num;
  }

  /* The range. An explicit start and end win outright; otherwise `weeks` anchors a window on
     whichever end is known, and the data's own extent is the last resort. A card built from a
     `weeks` count and nothing else anchors on the newest day in the data rather than on today,
     so a card rebuilt tomorrow from the same file still shows the same picture. */
  let start = dayNumOf(d.start);
  let end = dayNumOf(d.end);
  const weeks = Number.isFinite(Number(d.weeks)) && Number(d.weeks) > 0
    ? Math.min(400, Math.round(Number(d.weeks)))
    : null;

  if (start != null && end != null && start > end) { const t = start; start = end; end = t; }

  if (start == null && end == null) {
    if (weeks != null) {
      end = dataMax != null ? dataMax : Math.floor(Date.now() / DAY_MS);
      start = end - weeks * 7 + 1;
    } else {
      start = dataMin;
      end = dataMax;
    }
  } else if (start == null) {
    start = weeks != null ? end - weeks * 7 + 1 : (dataMin != null ? Math.min(dataMin, end) : end);
  } else if (end == null) {
    end = weeks != null ? start + weeks * 7 - 1 : (dataMax != null ? Math.max(dataMax, start) : start);
  }

  let trimmed = 0;
  let empty = start == null || end == null;
  if (!empty && end - start + 1 > MAX_DAYS) {
    trimmed = end - start + 1 - MAX_DAYS;
    start = end - MAX_DAYS + 1;
  }

  /* The ordered day list: every day in the range, present in the data or not. This is the list
     the whole card is indexed by, and building it from the range rather than from the data is
     what makes "missing inside the range" a thing that can be drawn at all. */
  const days = [];
  if (!empty) {
    for (let k = start; k <= end; k++) {
      days.push({ num: k, iso: dayLabel(k), v: byDay.has(k) ? byDay.get(k) : null });
    }
  }

  let total = 0;
  let active = 0;
  let missing = 0;
  let peak = null;
  for (const day of days) {
    if (day.v == null) { missing++; continue; }
    total += day.v;
    if (day.v > 0) active++;
    if (!peak || day.v > peak.v) peak = day;
  }

  /* Rows outside the shown range are not an error and not a loss — they are simply not in this
     picture — but a reader comparing a total against another card needs to know they exist. */
  let outside = 0;
  for (const k of byDay.keys()) if (empty || k < start || k > end) outside++;

  return {
    days, start, end, empty, dropped, trimmed, outside,
    total, active, missing, peak,
    unit: clean(d.unit) || 'contributions',
    hue: hueVar(d.hue),
    seedWeekStart: WEEK_STARTS.includes(clean(d.weekStart)) ? clean(d.weekStart) : DEFAULTS.weekStart,
    seedLevels: LEVEL_CHOICES.includes(Math.round(Number(d.levels))) ? Math.round(Number(d.levels)) : DEFAULTS.levels,
    seedScale: SCALES.includes(clean(d.scale)) ? clean(d.scale) : DEFAULTS.scale,
    seedMonths: d.months == null ? DEFAULTS.months : !!d.months,
  };
}

/* ── binning ─────────────────────────────────────────────────────────────────────────── */

/**
 * Every day's level, 0..L, under one binning strategy.
 *
 * **Why `quantile` is the default.** Contribution-shaped data is heavily right-skewed: most
 * active days are small and a handful are enormous. Linear binning cuts the range into L equal
 * *value* slices, so a series whose peak is 42 and whose median active day is 2 puts almost every
 * day in level 1 and leaves levels 2 through 5 for a fortnight of the year. The picture goes
 * flat and stops distinguishing a quiet week from a busy one — which is the only question a
 * heatmap is asked. Quantile binning cuts into L equal *population* slices instead, so the
 * levels are always in use and the picture always has contrast.
 *
 * Linear is still here and is still right sometimes: when the value is a rate, a percentage or a
 * temperature — anything with a meaningful absolute scale — equal value slices are what a reader
 * expects, and quantile's contrast would be manufactured. Linear also lets two cards with the
 * same ceiling be compared cell for cell, which quantile explicitly cannot do, because a
 * quantile level means "busy for this series" and not "busy".
 *
 * **A flat series.** All-equal positive values give a zero spread, which is the division by zero
 * this function must not perform. Every present day is drawn at the **top** level, uniformly, and
 * the caption says so in words. Top rather than bottom or middle for one concrete reason: linear
 * binning also puts a flat series at the top, since every value equals the maximum, so the two
 * scales agree on the flat case and flipping the setting does not repaint the card. A uniformly
 * saturated grid also reads correctly at a glance — "the same every day" — where a uniformly
 * faint one reads as "barely anything happened", which would be false.
 *
 * **Ties.** Equal values must get equal levels — anything else would draw two identical days
 * differently — so a value held by more than a 1/L share of the active days occupies more than
 * one level's worth of population and the neighbouring level comes out empty. A series of
 * mostly-ones cannot fill five levels and no binning rule can make it, which is why the promise
 * here is "comparable share per level", not "equal". It is still strictly better than linear on
 * the same data, and the verification asserts exactly that rather than asserting a full ramp.
 *
 * **Zero and missing are both level 0** and are deliberately not distinguished by level: they are
 * distinguished in the tooltip instead. A day someone recorded as zero and a day nobody recorded
 * are the same amount of activity, and giving them different shades would put a difference in the
 * picture that is about bookkeeping rather than about the subject.
 *
 * @param days  the ordered day list from {@link readData}
 * @param L     3, 5 or 7
 * @param scale `'linear'` or `'quantile'`
 * @returns `{ levels, flat, thresholds, max }` — `levels` is parallel to `days`
 *
 * @example binLevels([{ v: 1 }, { v: 40 }], 5, 'quantile').levels;   // [1, 5]
 */
function binLevels(days, L, scale) {
  const pos = [];
  for (const day of days) if (day.v != null && day.v > 0) pos.push(day.v);
  pos.sort((a, b) => a - b);

  const max = pos.length ? pos[pos.length - 1] : 0;
  const flat = pos.length > 0 && pos[0] === max;

  if (!pos.length) {
    return { levels: days.map(() => 0), flat: false, thresholds: [], max: 0 };
  }
  if (flat) {
    return {
      levels: days.map((day) => (day.v != null && day.v > 0 ? L : 0)),
      flat: true, thresholds: [], max,
    };
  }

  let level;
  let thresholds = [];
  if (scale === 'linear') {
    level = (v) => Math.max(1, Math.min(L, Math.ceil(v / max * L)));
    for (let k = 1; k < L; k++) thresholds.push(max * k / L);
  } else {
    for (let k = 1; k < L; k++) thresholds.push(quantileAt(pos, k / L));
    level = (v) => {
      let lv = 1;
      for (const t of thresholds) if (v > t) lv++;
      return Math.max(1, Math.min(L, lv));
    };
  }

  return {
    levels: days.map((day) => (day.v != null && day.v > 0 ? level(day.v) : 0)),
    flat: false,
    thresholds: thresholds.map((t) => Math.round(t * 100) / 100),
    max,
  };
}

/**
 * How badly linear binning would flatten this series, as a share of active days in level 1.
 *
 * This is the evidence behind the default rather than an assertion of it: when the number comes
 * back at 0.8 the caption can say "linear would put 80% of active days in the faintest level",
 * which is a claim a reader can check against the picture by flipping the setting.
 *
 * @returns 0..1, or 0 when there is nothing to flatten
 *
 * @example linearFlatness([{ v: 1 }, { v: 1 }, { v: 40 }], 5);   // 0.667
 */
function linearFlatness(days, L) {
  const b = binLevels(days, L, 'linear');
  let ones = 0;
  let act = 0;
  b.levels.forEach((lv, i) => {
    if (days[i].v != null && days[i].v > 0) { act++; if (lv === 1) ones++; }
  });
  return act ? Math.round(ones / act * 1000) / 1000 : 0;
}

/* ── geometry ────────────────────────────────────────────────────────────────────────── */

/**
 * The grid for one week start: a cell position per day, plus month and weekday labels.
 *
 * Days before the range's start and after its end fall inside the first and last columns and are
 * given **no cell at all** — not a level-0 cell. That distinction is the point of the design and
 * it has to be visible: a missing day inside the range is a faint outlined well, meaning "we
 * looked and there was nothing"; a day outside the range is bare card, meaning "we did not
 * look". Drawing them the same way would claim a quiet fortnight before the window opened.
 *
 * @param read      the output of {@link readData}
 * @param weekStart `'sun'` or `'mon'`
 * @returns `{ W, H, xy, months, wdays, cols }` — `xy` is parallel to `read.days`
 */
function gridFor(read, weekStart) {
  const days = read.days;
  const cols = days.length
    ? Math.floor((read.end - weekStartOf(read.start, weekStart)) / 7) + 1
    : 0;

  const origin = days.length ? weekStartOf(read.start, weekStart) : 0;

  const xy = days.map((day) => {
    const col = Math.floor((day.num - origin) / 7);
    const row = rowOf(day.num, weekStart);
    return [n(PAD_L + col * PITCH, 'cell x'), n(PAD_T + row * PITCH, 'cell y')];
  });

  /* Month labels sit over the column in which the month's first shown day falls. A label is
     dropped when it would collide with the last one drawn — a range of three weeks can cross two
     month boundaries and two overlapping labels are worse than one. */
  const months = [];
  let lastMonth = -1;
  let lastX = -Infinity;
  for (let c = 0; c < cols; c++) {
    const first = origin + c * 7;
    /* The month a column belongs to is the month of its first *in-range* day, so a partial
       leading column is not labelled with a month the picture does not actually show. */
    let m = -1;
    for (let k = 0; k < 7; k++) {
      const dn = first + k;
      if (dn < read.start || dn > read.end) continue;
      m = monthOf(dn);
      break;
    }
    if (m < 0 || m === lastMonth) continue;
    const x = PAD_L + c * PITCH;
    lastMonth = m;
    if (x - lastX < textW('Sep') + 6) continue;
    lastX = x;
    months.push([n(x, 'month'), MONTH_ABBR[m]]);
  }

  /* Mon, Wed, Fri — the alternating labels contribution grids settled on. Which rows those are
     depends on where the week starts, so the rows are found by name rather than by index. */
  const wdays = [];
  for (const name of ['Mon', 'Wed', 'Fri']) {
    const wd = DAY_ABBR.indexOf(name);
    const row = weekStart === 'mon' ? (wd + 6) % 7 : wd;
    wdays.push([n(PAD_T + row * PITCH + CELL - 2.5, 'wday'), name]);
  }

  const W = Math.max(160, PAD_L + Math.max(1, cols) * PITCH - GAP + PAD_R);
  const H = PAD_T + 7 * PITCH - GAP + PAD_B;

  /* `padL` and `cell` travel with the grid rather than being read from module constants, so the
     mark builder that gets shipped to the browser needs nothing but its arguments. */
  return { W: n(W, 'W'), H: n(H, 'H'), padL: PAD_L, cell: CELL, xy, months, wdays, cols };
}

/* ── saying what the picture shows ───────────────────────────────────────────────────── */

/** `1234` becomes `'1,234'`. Exact, unlike `CK.fmt`, for the one place the total is stated. */
function group(v) {
  const neg = v < 0;
  const s = String(Math.abs(Math.round(v * 100) / 100));
  const parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + parts.join('.');
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire picture to anyone using it.
 * "Heatmap" is therefore not an acceptable answer: it names the genre and withholds the content.
 * This says how many days, between which two, how much in total, how many days had anything,
 * where the peak is, how many days inside the range have no data at all — and what the levels
 * mean, because a level is only interpretable once you know whether it was cut by value or by
 * population.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function describe(read, bin, L, scale, flatness) {
  const unit = read.unit;

  if (read.empty || !read.days.length) {
    const why = read.dropped
      ? ' All ' + read.dropped + ' supplied ' + (read.dropped === 1 ? 'row was' : 'rows were') +
        ' unusable, so there is no range to draw.'
      : ' No days and no range were supplied, so there is nothing to draw.';
    return {
      aria: 'Empty heatmap counting ' + unit + '.' + why,
      caption: '<i>no days</i> &mdash; the grid keeps its place on the desk, but there is ' +
               'nothing in it.' + CK.esc(why),
    };
  }

  const span = read.days.length;
  const from = dayLabel(read.start);
  const to = dayLabel(read.end);
  const cols = Math.floor((read.end - weekStartOf(read.start, 'sun')) / 7) + 1;

  const scaleWord = scale === 'quantile'
    ? L + ' quantile levels (cut so each level holds a comparable share of the active days; ' +
      'repeated values share a level, so a level can come out empty)'
    : L + ' linear levels (equal value slices, ceiling ' + CK.fmt(bin.max) + ')';

  const flatNote = bin.flat
    ? ' Every day with any activity holds exactly ' + CK.fmt(bin.max) +
      ', so the series is flat and the whole grid is drawn at the top level; the scale carries ' +
      'no information here and neither setting would change the picture.'
    : '';

  const missNote = read.missing
    ? ' ' + read.missing + ' ' + (read.missing === 1 ? 'day' : 'days') + ' inside the range ' +
      (read.missing === 1 ? 'has' : 'have') + ' no reading and ' +
      (read.missing === 1 ? 'is' : 'are') + ' drawn as an empty well, distinct from the days ' +
      'outside the range, which are not drawn at all.'
    : '';

  const dropNote = read.dropped
    ? ' ' + read.dropped + ' ' + (read.dropped === 1 ? 'row was' : 'rows were') +
      ' skipped for an unreadable date or value.'
    : '';
  const outNote = read.outside
    ? ' ' + read.outside + ' ' + (read.outside === 1 ? 'day falls' : 'days fall') +
      ' outside the shown range.'
    : '';
  const trimNote = read.trimmed
    ? ' The range was trimmed by ' + read.trimmed + ' days at the start; ' + MAX_DAYS +
      ' is as much as this grid draws.'
    : '';

  const peakNote = read.peak
    ? ' The busiest day is ' + read.peak.iso + ' with ' + group(read.peak.v) + '.'
    : ' No day carries a positive value.';

  const aria =
    'Heatmap of ' + span + ' local ' + (span === 1 ? 'day' : 'days') + ' from ' + from + ' to ' +
    to + ', drawn as ' + cols + ' week ' + (cols === 1 ? 'column' : 'columns') + ' by 7 weekday ' +
    'rows, counting ' + unit + '. ' + group(read.total) + ' in total across ' + read.active + ' ' +
    (read.active === 1 ? 'day' : 'days') + ' with activity.' + peakNote + ' Values are binned ' +
    'into ' + scaleWord + '.' + flatNote + missNote + dropNote + outNote + trimNote;

  /* The caption argues for the default rather than announcing it. The flatness figure is real
     and recomputed for this series, so a reader can flip the setting and check it. */
  const why = bin.flat
    ? '<i>every active day is identical</i>, so linear and quantile agree and the grid is uniform.'
    : scale === 'quantile'
      ? 'binned by <b>quantile</b> &mdash; a comparable share of days per level. this data is ' +
        'right-skewed, and linear binning would put <b>' + Math.round(flatness * 100) + '%</b> ' +
        'of active days in the faintest level, flattening the picture into the one thing a ' +
        'heatmap must not be: featureless.'
      : 'binned <b>linearly</b> &mdash; equal value slices up to ' + CK.esc(CK.fmt(bin.max)) +
        ', so two cards with the same ceiling compare cell for cell. on skewed data this puts ' +
        '<b>' + Math.round(flatness * 100) + '%</b> of active days in the faintest level.';

  const caption =
    '<b>' + CK.esc(group(read.total)) + '</b> ' + CK.esc(unit) + ' over ' + span + ' days, ' +
    CK.esc(from) + ' to ' + CK.esc(to) + '. ' +
    (read.peak ? 'busiest is <b>' + CK.esc(read.peak.iso) + '</b> at ' +
                 CK.esc(group(read.peak.v)) + '. ' : '') +
    why + ' ' +
    '<span class="ck-aside">one hue at ' + L + ' opacities, never ' + L + ' hues: a sequential ' +
    'scale has to be ordered and hue is not.' + CK.esc(missNote + dropNote + outNote + trimNote) +
    '</span>';

  return { aria: aria.trim(), caption: caption.trim() };
}

/* ── the one renderer ────────────────────────────────────────────────────────────────── */

/**
 * The display list for one grid: month labels, weekday labels and one square per in-range day.
 *
 * **This function is shipped, not described.** Its source is emitted into the browser script by
 * `Function.prototype.toString()` and it is also called here in Node to produce the markup the
 * card carries before any script has run. That is the contract's rule for a helper a type both
 * ships and tests, and the reason for it is the failure it prevents: a Node-shaped twin of a
 * browser drawing routine eventually disagrees with it, and the disagreement is a card that
 * looks right until a setting is touched.
 *
 * It is therefore written in the emitted script's vocabulary — `var`, `function`, no arrow
 * functions, no template literals — because its own source has to satisfy the classic-script
 * rule once it lands in the page.
 *
 * Only in-range days appear, because only in-range days are in `G.xy`. A day outside the range
 * produces no element at all, which is what distinguishes it from a day inside the range with no
 * reading — that one gets a level-0 square, drawn as an empty well.
 *
 * @param G      a grid from {@link gridFor}
 * @param B      one day's level per entry, parallel to `G.xy`
 * @param ops    the opacity ramp for this level count
 * @param hue    the card's single series token
 * @param dates  the day labels, parallel to `G.xy`
 * @param vals   the day values, parallel to `G.xy`; null means no reading
 * @param unit   what is being counted, for the tooltip
 * @param months whether to draw the month labels
 * @returns marks of the form `{ t, a, s, ti }` — tag name, attributes, text, tooltip
 */
function heatmapMarks(G, B, ops, hue, dates, vals, unit, months) {
  var out = [], i, lv, val, tip;

  if (months) {
    for (i = 0; i < G.months.length; i++) {
      out.push({ t: 'text', a: { x: G.months[i][0], y: 9, 'class': 'ck-tk' }, s: G.months[i][1] });
    }
  }

  for (i = 0; i < G.wdays.length; i++) {
    out.push({ t: 'text', a: { x: G.padL - 5, y: G.wdays[i][0], 'text-anchor': 'end', 'class': 'ck-tk' }, s: G.wdays[i][1] });
  }

  for (i = 0; i < G.xy.length; i++) {
    lv = B[i];
    val = vals[i];
    /* "no reading" and "recorded as zero" are the same level and different words. The level is
       about activity; the tooltip is about bookkeeping, and only one of those belongs in the
       picture. */
    tip = dates[i] + ' · ' + (val == null ? 'no reading' : val + ' ' + unit);
    out.push({
      t: 'rect',
      a: {
        x: G.xy[i][0], y: G.xy[i][1], width: G.cell, height: G.cell, rx: 2,
        fill: lv ? hue : '', 'fill-opacity': lv ? ops[lv - 1] : '',
        'class': lv ? 'ck-d' : 'ck-l0'
      },
      ti: tip
    });
  }

  return out;
}

/**
 * A display list as SVG markup, for the copy of the picture the card carries in its own HTML.
 *
 * Serialisation only — every decision about what to draw was made in {@link heatmapMarks}, which
 * is the same function the browser runs. An attribute whose value is empty is dropped rather
 * than written out empty, matching the browser renderer, so the two outputs agree element for
 * element and the verification can assert that they do.
 *
 * @example svgInner([{ t: 'rect', a: { x: 0 } }]);   // '<rect x="0"></rect>'
 */
function svgInner(marks) {
  return marks.map((m) => {
    const a = m.a || {};
    const attrs = Object.keys(a)
      .filter((k) => a[k] != null && a[k] !== '')
      .map((k) => ' ' + k + '="' + CK.esc(a[k]) + '"')
      .join('');
    const inner = (m.ti != null ? '<title>' + CK.esc(m.ti) + '</title>' : '') +
                  (m.s != null ? CK.esc(m.s) : '');
    return '<' + m.t + attrs + '>' + inner + '</' + m.t + '>';
  }).join('');
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/**
 * Prefix every selector with the card's own scope. One card, one blast radius.
 *
 * A selector starting with `&` is attached without a space, for the case that bit once: the
 * level count lives on the `<section>` itself, so `[data-levels="5"] .ck-lg` scopes to a
 * *descendant* carrying the attribute — a selector that is perfectly valid, matches nothing, and
 * fails silently by showing no legend at all.
 *
 * @example scope('x', [['&[data-levels="5"] .ck-lg', 'display: inline-flex;']]);
 * // '.ck-heatmap[data-card="x"][data-levels="5"] .ck-lg { display: inline-flex; }'
 */
function scope(id, rules) {
  const own = '.ck-heatmap[data-card="' + id + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((x) => {
        const s = x.trim();
        if (!s) return own;
        return s.charAt(0) === '&' ? own + s.slice(1) : own + ' ' + s;
      });
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. The ramp is one token at N opacities, and level 0 is `--well`
 * with a `--hairline` edge — a visible empty square rather than a very faint full one, so that
 * "recorded as nothing" and "not in the range" are told apart by whether a square exists at all.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 */
function cardCss(id, read, seedW) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 8px;'],

    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-d', 'stroke: none;'],
    /* Recorded as nothing: a well with an edge. Present, empty, and obviously looked at. */
    ['.ck-plot .ck-l0', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],

    ['.ck-lg', 'display: none; align-items: center; gap: 4px;'],
    ['.ck-lg i', 'width: 9px; height: 9px; display: block; border-radius: 2px;'],
    ['.ck-lg .ck-l0s', 'background: var(--well); box-shadow: inset 0 0 0 1px var(--hairline);'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  for (const L of LEVEL_CHOICES) {
    rules.push(['&[data-levels="' + L + '"] .ck-lg[data-n="' + L + '"]', 'display: inline-flex;']);
    ramp(L).forEach((op, i) => {
      rules.push([
        '.ck-lg[data-n="' + L + '"] i[data-l="' + (i + 1) + '"]',
        'background: ' + read.hue + '; opacity: ' + op + ';',
      ]);
    });
  }

  /* A year is 53 columns and does not fit the desk column. The grid keeps its own width and
     scrolls inside `.ck-scroll` rather than shrinking, because a year squeezed into 640px puts
     cells below 10px and the picture stops being readable. The desk column never widens, so the
     page never grows a horizontal scrollbar of its own. The browser overrides this inline when
     the week start changes the column count; the rule is what makes the static render correct. */
  if (seedW > W0) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(seedW) + 'px;']);

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the plot, a legend, the caption. */
function cardHtml(id, title, read, note, seedG, seedMarks) {
  const f = (name) => CK.esc(id) + '-' + name;

  const sel = (name, values, chosen, render) =>
    '<select id="' + f(name) + '" name="' + name + '">' +
    values.map((v) => '<option value="' + CK.esc(v) + '"' +
      (String(v) === String(chosen) ? ' selected' : '') + '>' +
      CK.esc(render ? render(v) : v) + '</option>').join('') +
    '</select>';

  const legends = LEVEL_CHOICES.map((L) =>
    '<span class="ck-lg" data-n="' + L + '">less <i class="ck-l0s"></i>' +
    ramp(L).map((op, i) => '<i data-l="' + (i + 1) + '"></i>').join('') +
    ' more</span>').join('');

  return '<section data-card="' + CK.esc(id) + '" class="ck-heatmap"' +
    ' data-levels="' + read.seedLevels + '">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="heatmap settings"></button>\n' +

    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('weekStart') + '">week starts</label>\n' +
    '    ' + sel('weekStart', WEEK_STARTS, read.seedWeekStart,
                 (v) => (v === 'mon' ? 'Monday' : 'Sunday')) + '\n' +
    '    <label for="' + f('levels') + '">levels</label>\n' +
    '    ' + sel('levels', LEVEL_CHOICES, read.seedLevels) + '\n' +
    '    <label for="' + f('scale') + '">scale</label>\n' +
    '    ' + sel('scale', SCALES, read.seedScale) + '\n' +
    '    <label for="' + f('months') + '">month labels</label>\n' +
    '    <input id="' + f('months') + '" name="months" type="checkbox"' +
           (read.seedMonths ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">Quantile cuts by population and keeps skewed data legible; ' +
         'linear cuts by value and lets two cards compare.</p>\n' +
    '  </div>\n' +

    /* The picture ships drawn. A card whose grid only exists once a script has run is a card
       that is blank in a static render and blank if one other card on the desk fails to parse;
       the marks here come from the same heatmapMarks the browser re-runs on a settings change,
       so the two cannot disagree. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' +
       seedG.W + ' ' + seedG.H + '" aria-label="' + CK.esc(note.aria) + '">' +
       svgInner(seedMarks) + '</svg></div>\n' +
    '  <div class="ck-legend">' + legends + '</div>\n' +
    '  <div class="ck-cap">' + note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: a renderer that paints a precomputed grid, and nothing that decides anything.
 *
 * Classic script, ES5 vocabulary — `var`, `function`, no arrow functions, no template literals,
 * no optional chaining. This is concatenated into one inline block with every other card's
 * script, so a single modern-syntax parse error takes the whole desk down.
 *
 * Every combination of `weekStart`, `levels` and `scale` was binned in Node, so changing a
 * setting is a repaint and never a recomputation. That is what keeps the flat-series guard and
 * the quantile arithmetic in one place a test can reach, rather than in every viewer's browser.
 */
function cardJs(id, payload, defaults) {
  const src = '/* heatmap card: repaints a grid that was laid out and binned when the card was\n' +
    '   built. Levels, thresholds and the flat-series case were all decided in Node; this turns\n' +
    '   numbers into squares and does not know what a quantile is. The mark builder below is the\n' +
    '   very source that ran at build time, shipped rather than restated. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(defaults) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + heatmapMarks.toString().split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. Attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where heatmap decisions live. */\n' +
    '  function node(m) {\n' +
    '    var e = document.createElementNS(NS, m.t), a = m.a, k, t;\n' +
    '    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }\n' +
    '    if (m.s != null) { e.textContent = m.s; }\n' +
    '    if (m.ti != null) {\n' +
    '      t = document.createElementNS(NS, "title");\n' +
    '      t.textContent = m.ti;\n' +
    '      e.appendChild(t);\n' +
    '    }\n' +
    '    return e;\n' +
    '  }\n' +
    '\n' +
    '  /* A select hands back a string, so a stored level count of 5 and a default of 5 are a\n' +
    '     string and a number. Every lookup is built from String() so the two cannot disagree. */\n' +
    '  function key(cfg) {\n' +
    '    var k = String(cfg.scale) + "|" + String(cfg.levels);\n' +
    '    return P.bins[k] ? k : DEFAULTS.scale + "|" + DEFAULTS.levels;\n' +
    '  }\n' +
    '\n' +
    '  function render(cfg) {\n' +
    '    var G = P.geo[cfg.weekStart] ? P.geo[cfg.weekStart] : P.geo[DEFAULTS.weekStart];\n' +
    '    var k = key(cfg), B = P.bins[k], NOTE = P.notes[k];\n' +
    '    var L = Number(k.split("|")[1]), ops = P.ramp[String(L)];\n' +
    '    var marks = heatmapMarks(G, B, ops, P.hue, P.dates, P.vals, P.unit, !!cfg.months), i;\n' +
    '\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + G.W + " " + G.H);\n' +
    '    plot.setAttribute("aria-label", NOTE.aria);\n' +
    '    plot.style.minWidth = G.W > 640 ? G.W + "px" : "";\n' +
    '    for (i = 0; i < marks.length; i++) { plot.appendChild(node(marks[i])); }\n' +
    '\n' +
    '    /* The caption is markup that was escaped value by value in Node; nothing from the data\n' +
    '       reaches it unescaped, which is why it may be assigned rather than built. */\n' +
    '    if (cap) { cap.innerHTML = NOTE.caption; }\n' +
    '    sec.setAttribute("data-levels", String(L));\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  /* The contract bans backticks in emitted `js` because every card's script is concatenated
     into one inline block, so one stray template literal takes the whole desk down. A comment
     counts: `Function.prototype.toString` ships comments verbatim, and the sibling `ribbon`
     card shipped exactly that bug tonight from a backtick inside a comment. Throwing here
     rather than trusting the review is the difference between a build failure and a blank desk. */
  const bad = src.indexOf(String.fromCharCode(96));
  if (bad >= 0) {
    throw new Error('cardkit/heatmap: emitted js contains a backtick at offset ' + bad +
                    ' — near: ' + src.slice(Math.max(0, bad - 60), bad + 60));
  }
  return src;
}

/**
 * Build one heatmap card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ days, weeks, start, end, unit, scale, levels, weekStart, hue }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, which means a bug here
 *                 rather than bad input: unusable rows are counted and skipped while reading
 *
 * @example
 * build({
 *   id: 'year',
 *   title: 'a year of commits',
 *   data: {
 *     unit: 'commits',
 *     start: '2025-08-29', end: '2026-08-28',
 *     days: [{ date: '2026-01-14', value: 42 }],
 *   },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'heatmap' : id);
  const heading = clean(title == null ? 'Heatmap' : title);
  const read = readData(data);

  const geo = {};
  for (const ws of WEEK_STARTS) geo[ws] = gridFor(read, ws);

  const bins = {};
  const notes = {};
  const rampBy = {};
  for (const L of LEVEL_CHOICES) {
    rampBy[String(L)] = ramp(L);
    const flatness = read.days.length ? linearFlatness(read.days, L) : 0;
    for (const scale of SCALES) {
      const bin = binLevels(read.days, L, scale);
      bins[scale + '|' + L] = bin.levels;
      notes[scale + '|' + L] = describe(read, bin, L, scale, flatness);
    }
  }

  const defaults = {
    weekStart: read.seedWeekStart,
    levels: read.seedLevels,
    scale: read.seedScale,
    months: read.seedMonths,
  };

  const payload = {
    geo,
    bins,
    notes,
    ramp: rampBy,
    hue: read.hue,
    unit: read.unit,
    dates: read.days.map((d) => d.iso),
    vals: read.days.map((d) => d.v),
  };

  const note = notes[read.seedScale + '|' + read.seedLevels];
  const seedG = geo[read.seedWeekStart];
  const seedMarks = heatmapMarks(
    seedG, bins[read.seedScale + '|' + read.seedLevels], rampBy[String(read.seedLevels)],
    read.hue, payload.dates, payload.vals, read.unit, read.seedMonths);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      start: read.empty ? null : dayLabel(read.start),
      end: read.empty ? null : dayLabel(read.end),
      days: read.days.length,
      total: read.total,
      skipped: read.dropped,
      settings: defaults,
    },
    html: cardHtml(cardId, heading, read, note, seedG, seedMarks),
    css: cardCss(cardId, read, seedG.W),
    js: cardJs(cardId, payload, defaults),
  };
}

export default { meta, build };
