/**
 * @file cardkit card type: `ribbon` — one local day as a strip of time buckets.
 *
 * A ribbon answers "when, today?" at a glance: each column is a slice of the day, its height is
 * how much happened in that slice, and its colour is what kind of thing that mostly was.
 *
 * This replaces a hand-written predecessor that shipped four bugs, and the whole shape of this
 * file is an argument against repeating them. They are named here because a fix with no record
 * of what it fixes is a fix that gets refactored back out:
 *
 *   1. It selected events by their **UTC** date and bucketed them by their **local** hour, so an
 *      evening and the next morning were drawn side by side as though they were one day. The
 *      structural fix is that there is exactly one local-time computation in this file —
 *      {@link localise} — and both the day test and the bucket index come out of it. They cannot
 *      disagree because there is nothing for them to disagree with.
 *   2. It read the hour off a **12-hour display string** with the meridiem already stripped, so
 *      4pm and 4am both landed on bar 4 and the whole afternoon folded onto the morning. Here no
 *      hour is ever read from a display string: the bucket index is epoch arithmetic. A
 *      wall-clock string is used for exactly one thing — learning the zone offset — and
 *      {@link parseWall} refuses a bare 1..12 hour that carries no meridiem to interpret it.
 *   3. It coloured each bucket by its **last** event's class rather than its **dominant** one, so
 *      one stray event repainted an hour. {@link dominant} counts.
 *   4. It had no axis, no legend and no day label, so it was a pretty stripe nobody could read.
 *      The axis, the value ticks, the legend and the label are all mandatory here and the
 *      verification asserts each of them.
 *
 * Geometry is computed in Node and the browser is handed a display list, per the contract. The
 * `bucket` and `scale` settings change the geometry, so a variant is built for each combination
 * at build time rather than recomputed in the browser — the arithmetic that goes wrong on
 * degenerate input goes wrong once, where a test can catch it.
 *
 * @see ../CONTRACT.md — the rules every type keeps
 * @see ./chart.mjs    — the vm-loaded `CK` and the display-list idiom, adopted from there
 * @see ./heatmap.mjs  — the same data over a year instead of a day
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it — nothing reaches for `document` until a function that
 * needs the DOM is called, and none of those are called here.
 *
 * Loading the real kit rather than reimplementing `scale`, `ticks` and `hue` is the contract's
 * rule and it is load-bearing: a private copy of the tick arithmetic drifts from the browser's,
 * the gridlines stop matching the axis, and nothing errors.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().ticks(0, 97, 5);   // [0, 20, 40, 60, 80, 100]
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/ribbon: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/ribbon: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants ───────────────────────────────────────────────────────────────────────── */

/** Minutes in a calendar day, as the ribbon counts them. */
const DAY_MIN = 1440;

/** Milliseconds in a calendar day. */
const DAY_MS = 86400000;

/**
 * Every setting the ribbon understands, with the value it falls back to.
 *
 * `bucket` is minutes per column; 60 gives the twenty-four-column day everybody pictures when
 * they hear "ribbon", so it is the default. `scale` is `peak` (each day uses its own full
 * height) or `absolute` (a fixed ceiling, so two days are comparable side by side); `peak` is
 * the default because a single card on a desk is being read on its own.
 */
const DEFAULTS = { bucket: 60, legend: true, scale: 'peak' };

/** The bucket sizes the settings panel offers. A card seeded with another size adds it. */
const BUCKET_CHOICES = [15, 30, 60];

/** The two height scales. Anything else falls back to `peak`. */
const SCALES = ['peak', 'absolute'];

/* Layout. The desk column is comfortable at 640; anything wider scrolls inside `.ck-scroll`
   rather than widening the page. `MIN_PITCH` is what a column needs to still read as a column —
   below about 8px a 96-column ribbon turns into a texture — so a 15-minute ribbon deliberately
   grows past the column and scrolls. */
const W0 = 640;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 16;
const PLOT_H = 120;
const PAD_B = 24;
const MIN_PITCH = 8;

/** An empty bucket still draws this many pixels, so the axis reads as a continuous day. */
const STUB = 2;

/** A bucket that holds anything at all is at least this tall, so one event is visible. */
const MIN_BAR = 3;

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed.
   It only decides how many hour labels fit, and being half a pixel pessimistic drops a label
   that would have just fit, which is the safe way to be wrong. */
const CHW = 5.42;

/** Hour steps an axis may use, coarsening until the labels stop colliding. */
const HOUR_STEPS = [1, 2, 3, 4, 6, 12];

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `shape` is a string per the contract: it is read by a person deciding what to feed the card,
 * and it has to survive being shown in a list.
 */
export const meta = {
  name: 'ribbon',
  summary: 'One local day as a strip of time buckets, each coloured by its dominant class.',
  shape:
    '{ events: [{ at, klass, local }], bucket, day, classes: { name: hueToken }, unit, ' +
    'tzOffset, max }',
  defaults: { ...DEFAULTS },
};

/* ── text hygiene ────────────────────────────────────────────────────────────────────── */

/**
 * Strip control characters out of an untrusted string, comparing code points numerically.
 *
 * Data reaches this card from files and logs, and a raw control character in a class name would
 * land in the emitted JavaScript, where it is invisible in an editor, invisible on readback,
 * legal to the parser and survives `node --check`. The contract has seven incidents to show for
 * it. The comparison is arithmetic — `charCodeAt(i) < 32` — precisely so that no character class
 * has to be written, because a character class is a thing that can hold the character it means
 * to describe.
 *
 * Tab, newline and carriage return are kept: they are legitimate inside a tooltip and the
 * emitters escape them.
 *
 * @param s any value; null and undefined become the empty string
 * @returns the same text with unprintable code points removed
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
 * with the useful side effect that no class name can put `=>` into a file that is contractually
 * free of arrow functions. Backticks go for the same contract. `?` goes so that no name can put
 * `?.` into it either — the escape decodes back to a plain question mark, so nothing a reader
 * sees changes. The two line separators go because they are newlines to a JS parser and are not
 * to `JSON.stringify`.
 *
 * @param v anything `JSON.stringify` accepts
 *
 * @example jsLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
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
 * nothing in the console. Failing at build time turns that into a stack trace next to the input
 * that caused it.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(12.3456, 'column');   // 12.35
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/ribbon: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face. */
function textW(s) { return String(s).length * CHW; }

/** Two digits, so 7 becomes '07' and the axis stays column-aligned. */
function pad2(v) { return (v < 10 ? '0' : '') + v; }

/** `945` becomes `'15:45'`. Minutes-of-day, never a display string being read back. */
function hhmm(min) {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

/**
 * The same, but the end of the day reads `24:00` rather than wrapping to `00:00`.
 *
 * A column labelled `23:20–00:00` looks like it runs backwards, and on an axis that already
 * shows `00:00` at the far left it reads as though the day wrapped. The end of a span and the
 * start of one are different things and only one of them can be midnight.
 *
 * @example hhmmTo(1440);   // '24:00'
 * @example hhmmTo(1400);   // '23:20'
 */
function hhmmTo(min) { return Math.round(min) === DAY_MIN ? '24:00' : hhmm(min); }

/* ── zone arithmetic ─────────────────────────────────────────────────────────────────── */

/**
 * A wall-clock string, or null when it cannot be read without guessing.
 *
 * Accepts `YYYY-MM-DD` followed by `T` or a space and `HH:MM` with optional seconds, optionally
 * followed by a meridiem. The meridiem rule is the whole point of this function and it is
 * historical bug 2 written as a guard: a bare hour of 1..12 with no meridiem is **rejected**
 * rather than assumed, because assuming is exactly what folded 4pm onto 4am. An hour of 13..23
 * is unambiguously 24-hour and is accepted; an hour of 0 likewise. With a meridiem the hour must
 * be 1..12, and 12am is 0 while 12pm is 12.
 *
 * @param s a local wall-clock reading that names the same moment as some instant
 * @returns `{ y, mo, d, h, mi, s }` in 24-hour form, or null
 *
 * @example parseWall('2026-08-27 16:15');      // { y: 2026, mo: 8, d: 27, h: 16, mi: 15, s: 0 }
 * @example parseWall('2026-08-27 4:15 pm');    // { y: 2026, mo: 8, d: 27, h: 16, mi: 15, s: 0 }
 * @example parseWall('2026-08-27 04:15');      // null — 4am or 4pm? refuse rather than guess
 */
function parseWall(s) {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i
    .exec(clean(s));
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = m[6] == null ? 0 : Number(m[6]);
  const mer = m[7] ? m[7].charAt(0).toLowerCase() : '';

  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'p' && h < 12) h += 12;
    if (mer === 'a' && h === 12) h = 0;
  } else if (h >= 1 && h <= 12) {
    /* Ambiguous. A 24-hour source would have written 04:15 for the morning and 16:15 for the
       afternoon, and a 12-hour source that lost its meridiem is indistinguishable from the
       former. Refusing costs one offset sample; guessing cost an entire afternoon last time. */
    return null;
  } else if (h > 23) {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || mi > 59 || sec > 59) return null;

  /* Reject a date that does not exist — 2026-02-30 parses field by field and would otherwise
     roll silently into March, shifting a derived offset by a whole day. */
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;

  return { y, mo, d, h, mi, s: sec };
}

/** The widest offset any real zone has ever had, plus slack. A sample outside it is noise. */
const OFFSET_LIMIT = 16 * 60;

/**
 * Minutes east of UTC, derived from an (instant, wall-clock) pair rather than from a zone name.
 *
 * **The arithmetic.** A wall clock reads `instant + offset`. If the wall-clock *fields* are fed
 * to `Date.UTC` — that is, pretended to be UTC fields — the result is the epoch value of that
 * same reading measured on a UTC clock, which is `instant + offset` in milliseconds. Subtracting
 * the instant leaves the offset alone:
 *
 *     offsetMinutes = (Date.UTC(wall fields) - instantMs) / 60000
 *
 * Nothing here consults a zone database, a zone name, or the host's own clock, which is the
 * reason to do it this way. A zone name in a data file is a claim about a machine that may not
 * be the one that produced the timestamps; `America/Los_Angeles` is also wrong for half the year
 * if somebody hard-coded -480. A pair is a measurement, and it is a measurement *at that
 * instant*, so it carries the DST state of the moment it describes for free.
 *
 * The result is rounded to whole minutes because every real offset is a whole number of them,
 * and a pair whose parts disagree by a second or two (a log that formats the two fields from two
 * `now()` calls) would otherwise produce a fractional offset that never matches another sample.
 *
 * @param instantMs epoch milliseconds of the instant
 * @param wall      the same moment as a local wall-clock reading
 * @returns minutes east of UTC, or null when the pair is unusable
 *
 * @example offsetFromPair(Date.parse('2026-08-27T23:15:00Z'), '2026-08-27 16:15');   // -420
 */
function offsetFromPair(instantMs, wall) {
  if (!Number.isFinite(instantMs)) return null;
  const w = parseWall(wall);
  if (!w) return null;
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  if (!Number.isFinite(asUtc)) return null;
  const off = Math.round((asUtc - instantMs) / 60000);
  if (!Number.isFinite(off) || Math.abs(off) > OFFSET_LIMIT) return null;
  return off;
}

/**
 * The middle value of a sample set.
 *
 * Median rather than mean because one malformed pair should cost nothing. A mean would let a
 * single sample that is an hour out drag the whole card's offset by minutes, which is enough to
 * move an event across a bucket boundary and not enough for anyone to notice why.
 *
 * @example median([-420, -420, -60]);   // -420
 */
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Local time for one instant: the day it falls on and how far into that day it is.
 *
 * **The one local-time computation in this file**, and the structural fix for historical bug 1.
 * The day number and the minute-of-day are two readings of a single shifted epoch value, so a
 * card cannot select an event by one clock and place it by another. That is not a discipline
 * anybody has to remember; there is simply no second computation to disagree with.
 *
 * @param instantMs epoch milliseconds
 * @param offMin    minutes east of UTC in force at that instant
 * @returns `{ dayNum, minute }` — days since 1970-01-01 locally, and 0..1439 within that day
 *
 * @example localise(Date.parse('2026-08-27T23:15:00Z'), -420).minute;   // 975 → 16:15
 */
function localise(instantMs, offMin) {
  const shifted = instantMs + offMin * 60000;
  const dayNum = Math.floor(shifted / DAY_MS);
  const minute = Math.floor((shifted - dayNum * DAY_MS) / 60000);
  return { dayNum, minute };
}

/** Days since 1970-01-01 for a `YYYY-MM-DD` label, or null. A day is a label, not an instant. */
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
  return Math.floor(ms / DAY_MS);
}

/** The inverse: a day number back to its `YYYY-MM-DD` label. */
function dayLabel(dayNum) {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/** `2026-08-27` as `Thursday 27 August 2026`, for the day label a reader actually reads. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A day number as prose.
 *
 * Written out rather than handed to `Intl`, because this string is produced in Node at build
 * time and `Intl`'s answer would then be the *builder's* locale baked into a card that other
 * people read. One unambiguous English form beats a locale the reader never chose.
 *
 * @example longDay(20693);   // 'Thursday 27 August 2026'
 */
function longDay(dayNum) {
  const d = new Date(dayNum * DAY_MS);
  return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' +
         MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/** `-420` becomes `'UTC-07:00'`. */
function offsetText(min) {
  const a = Math.abs(min);
  return 'UTC' + (min < 0 ? '-' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}

/* ── colours ─────────────────────────────────────────────────────────────────────────── */

/**
 * A series token in any of the spellings a data file is likely to use, as a `var()` reference.
 *
 * Accepts `--ck-s3`, `ck-s3`, `s3`, `3` and `var(--ck-s3)`, and refuses everything else — in
 * particular a literal colour, which is a bug in one of the two themes and must not be able to
 * enter through data. An unrecognised token falls back to the card's own cycling assignment
 * rather than to black.
 *
 * @param token what the data called the colour
 * @param i     the class's position, used when the token is unusable
 *
 * @example hueVar('s4', 0);       // 'var(--ck-s4)'
 * @example hueVar('#ff0000', 2);  // 'var(--ck-s3)' — a literal colour is not a token
 */
function hueVar(token, i) {
  const t = clean(token).trim().toLowerCase();
  const m = /^(?:var\(\s*)?(?:--)?(?:ck-)?s?([1-8])\s*\)?$/.exec(t);
  if (m) return 'var(--ck-s' + m[1] + ')';
  return CK.hue(i);
}

/* ── reading the data ────────────────────────────────────────────────────────────────── */

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * Everything that can go wrong with the input is decided here, once, and reported as counts the
 * caption can quote. An event that cannot be placed in time is *skipped and counted* rather than
 * dropped silently: a ribbon that quietly loses a tenth of its events is a ribbon that lies, and
 * the count is the only thing that makes the loss visible.
 *
 * Two rejection reasons are kept apart because they mean different things to a reader. A
 * timestamp that cannot be read is a data problem. An event that reads fine but falls on another
 * local day is not a problem at all — it is the fix for historical bug 1 doing its job — and
 * saying "12 fall on other days" is how a reader can tell the two apart.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs: placed events, class order and colours, counts, offset
 *
 * @example
 * readData({ events: [{ at: '2026-08-27T23:15:00Z', klass: 'flow' }], tzOffset: -420 }).events.length;  // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.events) ? d.events : [];

  /* Pass one: learn the zone. Every event carrying both an instant and a wall-clock reading is
     a measurement of the offset at its own instant; the card-level offset is the median of them
     and is only used for events that did not bring their own. */
  const samples = [];
  const own = new Map();
  raw.forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    const ms = Date.parse(clean(e.at));
    if (!Number.isFinite(ms)) return;
    const off = offsetFromPair(ms, e.local);
    if (off == null) return;
    samples.push(off);
    own.set(i, off);
  });
  if (d.zone && typeof d.zone === 'object') {
    const off = offsetFromPair(Date.parse(clean(d.zone.at)), d.zone.local);
    if (off != null) samples.push(off);
  }

  let offset;
  let offsetFrom;
  if (samples.length) {
    offset = median(samples);
    offsetFrom = 'pair';
  } else if (Number.isFinite(Number(d.tzOffset)) && Math.abs(Number(d.tzOffset)) <= OFFSET_LIMIT) {
    offset = Math.round(Number(d.tzOffset));
    offsetFrom = 'given';
  } else {
    /* Last resort, and it is genuinely last: the host that *built* the card is not necessarily
       the host that will read it. Documented in the caption so a reader can see the ribbon is
       resting on an assumption rather than a measurement. */
    offset = -new Date().getTimezoneOffset();
    offsetFrom = 'host';
  }

  /* Pass two: place every event, with its own offset where it brought one. Using the per-event
     offset rather than the card's is what keeps a day containing a DST transition honest —
     the two halves of that day genuinely have different offsets and each event knows its own. */
  const placed = [];
  let unreadable = 0;
  raw.forEach((e, i) => {
    if (!e || typeof e !== 'object') { unreadable++; return; }
    const ms = Date.parse(clean(e.at));
    if (!Number.isFinite(ms)) { unreadable++; return; }
    const off = own.has(i) ? own.get(i) : offset;
    const loc = localise(ms, off);
    placed.push({
      ms,
      off,
      dayNum: loc.dayNum,
      minute: loc.minute,
      klass: clean(e.klass) || 'other',
    });
  });

  /* Which day. An explicit `day` wins because the caller said so; otherwise the day the latest
     readable event landed on, which is what "today" means for a log that has just been written;
     otherwise the host's own today, which is all that is left. */
  let dayNum = dayNumOf(d.day);
  if (dayNum == null && placed.length) {
    dayNum = placed.reduce((a, e) => (e.ms > a.ms ? e : a), placed[0]).dayNum;
  }
  if (dayNum == null) dayNum = localise(Date.now(), offset).dayNum;

  const events = placed.filter((e) => e.dayNum === dayNum);
  const elsewhere = placed.length - events.length;

  /* Class order: the author's `classes` order first, because that is a deliberate ordering, then
     anything the data mentioned that the author did not, in first-appearance order. A legend
     that reorders itself between builds is a legend nobody trusts. */
  const declared = d.classes && typeof d.classes === 'object' ? d.classes : {};
  const order = [];
  const seen = new Set();
  for (const k of Object.keys(declared)) {
    const name = clean(k);
    if (name && !seen.has(name)) { seen.add(name); order.push(name); }
  }
  for (const e of events) {
    if (!seen.has(e.klass)) { seen.add(e.klass); order.push(e.klass); }
  }

  const colour = new Map();
  order.forEach((name, i) => {
    colour.set(name, hueVar(Object.hasOwn(declared, name) ? declared[name] : null, i));
  });

  /* `unit` names what is being counted and is used as the value axis's caption rather than
     folded into the sentences. That is the chart card's rule and it exists to avoid an English
     pluraliser: "1 events" is wrong, "1" beside an axis labelled "events" is not. */
  const unit = clean(d.unit) || 'events';

  /* Bucket sizes. The panel offers 15/30/60; a card seeded with anything else keeps it, as its
     own extra option, so the settings panel still round-trips the value the card was built with
     instead of silently rewriting it. */
  const seeded = Number(d.bucket);
  const buckets = BUCKET_CHOICES.slice();
  if (Number.isFinite(seeded)) {
    const b = Math.max(1, Math.min(DAY_MIN, Math.round(seeded)));
    if (!buckets.includes(b)) buckets.push(b);
  }
  buckets.sort((a, b) => a - b);

  const seedBucket = Number.isFinite(seeded)
    ? Math.max(1, Math.min(DAY_MIN, Math.round(seeded)))
    : DEFAULTS.bucket;

  const seedScale = SCALES.includes(clean(d.scale)) ? clean(d.scale) : DEFAULTS.scale;
  const cap = Number(d.max);

  return {
    events, unreadable, elsewhere, dayNum, offset, offsetFrom,
    order, colour, unit, buckets, seedBucket, seedScale,
    ceiling: Number.isFinite(cap) && cap > 0 ? cap : null,
    total: events.length,
  };
}

/* ── bucketing ───────────────────────────────────────────────────────────────────────── */

/**
 * The class that owns a bucket, with ties broken by recency.
 *
 * Historical bug 3 was colouring a bucket by its *last* event, which let one straggler repaint a
 * whole hour of something else. Counting is the fix. The tie-break then has to go somewhere, and
 * it goes to the class whose most recent event in the bucket is latest — "ties to the later one"
 * — because when two things happened equally often the one still going is the better answer to
 * "what was this hour". A tie broken by name would be stable too, but it would be arbitrary in a
 * way a reader cannot predict, and it would make the colour depend on spelling.
 *
 * @param rows the events in one bucket, in any order
 * @returns `{ name, count, tally }` — the winner, its count, and every class's count
 *
 * @example dominant([{ klass: 'flow', ms: 1 }, { klass: 'flow', ms: 2 }, { klass: 'strain', ms: 9 }]).name;
 * // 'flow' — five of one and one of the other is not a tie, whatever arrived last
 */
function dominant(rows) {
  const tally = new Map();
  for (const e of rows) {
    const cur = tally.get(e.klass);
    if (!cur) tally.set(e.klass, { n: 1, last: e.ms });
    else { cur.n++; if (e.ms > cur.last) cur.last = e.ms; }
  }
  let best = null;
  for (const [name, v] of tally) {
    if (!best || v.n > best.n || (v.n === best.n && v.last > best.last)) best = { name, n: v.n, last: v.last };
  }
  return { name: best ? best.name : null, count: best ? best.n : 0, tally };
}

/**
 * The day divided into columns, each knowing its span, its events and its dominant class.
 *
 * **The remainder.** A bucket size that does not divide 1440 leaves a short final column — 50
 * minutes gives twenty-eight full columns and a 40-minute tail. The tail is kept rather than
 * dropped or padded, and it is drawn at its true width, because the horizontal axis is a time
 * axis: a 40-minute column drawn 50 minutes wide would put every tick after it in the wrong
 * place, and a dropped tail would silently lose the last forty minutes of the day. The caption
 * says the tail is short and how short.
 *
 * @param read   the output of {@link readData}
 * @param bucket minutes per column, at least 1 and at most a whole day
 * @returns `{ cols, peak, remainder }` — remainder is the tail's length, or 0 when it divides
 *
 * @example bucketise(read, 60).cols.length;   // 24
 */
function bucketise(read, bucket) {
  const b = Math.max(1, Math.min(DAY_MIN, Math.round(bucket)));
  const count = Math.ceil(DAY_MIN / b);
  const cols = [];
  for (let i = 0; i < count; i++) {
    const from = i * b;
    const to = Math.min(DAY_MIN, from + b);
    cols.push({ i, from, to, rows: [] });
  }
  for (const e of read.events) {
    const idx = Math.min(count - 1, Math.floor(e.minute / b));
    cols[idx].rows.push(e);
  }
  let peak = 0;
  for (const c of cols) {
    const dom = dominant(c.rows);
    c.count = c.rows.length;
    c.klass = dom.name;
    c.tally = dom.tally;
    if (c.count > peak) peak = c.count;
  }
  const remainder = count * b - DAY_MIN ? DAY_MIN - (count - 1) * b : 0;
  return { bucket: b, cols, peak, remainder: remainder === b ? 0 : remainder };
}

/* ── geometry ────────────────────────────────────────────────────────────────────────── */

/**
 * A ceiling at or above `peak`, rounded to the step the value ticks already chose.
 *
 * `CK.ticks` only returns ticks inside the domain it is given, so a raw peak leaves a ragged
 * strip above the last gridline and the tallest column pokes past its own axis. Rounding the
 * ceiling out to a whole step closes it and, for the `absolute` scale, has the further virtue
 * that two days with peaks of 41 and 44 land on the same ceiling and are actually comparable.
 *
 * @example niceCeil(41);   // 50
 */
function niceCeil(peak) {
  if (!(peak > 0)) return 1;
  const t = CK.ticks(0, peak, 4);
  if (t.length < 2) return peak;
  const step = t[1] - t[0];
  if (!(step > 0)) return peak;
  return Math.ceil(peak / step) * step;
}

/**
 * Everything geometric about one bucket size, computed once and shared by both scales.
 *
 * Column x and width come from a time scale over the whole day rather than from an index, which
 * is what lets the short remainder column be narrower without moving anything else.
 *
 * @param read   the output of {@link readData}
 * @param bucket minutes per column
 * @returns the frame, its columns, and the hour-axis ticks
 */
function frameFor(read, bucket) {
  const B = bucketise(read, bucket);
  const cols = B.cols;

  const plotW = Math.max(W0 - PAD_L - PAD_R, cols.length * MIN_PITCH);
  const W = PAD_L + plotW + PAD_R;
  const H = PAD_T + PLOT_H + PAD_B;
  const x0 = PAD_L;
  const x1 = PAD_L + plotW;
  const y0 = PAD_T;
  const y1 = PAD_T + PLOT_H;

  const tScale = CK.scale([0, DAY_MIN], [x0, x1]);

  /* A one-pixel gap between columns, and none at all once the columns are narrow enough that a
     gap would be most of the column. A ribbon is a continuous day; the gap is a hairline that
     says "these are buckets", not a bar chart's separation. */
  const pitch = plotW / cols.length;
  const gap = pitch > 5 ? 1 : 0;

  const base = cols.map((c) => {
    const left = tScale(c.from);
    const right = tScale(c.to);
    return { x: left, w: Math.max(1, right - left - gap), col: c };
  });

  /* Hour labels coarsen until they stop colliding. '00:00' is five characters; eight pixels of
     air on either side is enough that two labels never touch. */
  const perHour = plotW / 24;
  let step = HOUR_STEPS[HOUR_STEPS.length - 1];
  for (const s of HOUR_STEPS) {
    if (s * perHour >= textW('00:00') + 8) { step = s; break; }
  }
  /* The last tick is the end of the day, not its start; labelling it 00:00 would put two
     midnights on one axis and make a 24-hour ribbon look like it wrapped. */
  const axis = [];
  for (let h = 0; h <= 24; h += step) axis.push({ x: tScale(h * 60), label: hhmmTo(h * 60), hour: h });

  return { B, cols, base, axis, W, H, x0, x1, y0, y1, tScale };
}

/**
 * Column heights and value ticks for one scale.
 *
 * `peak` gives the day its own full height, which is what a card read on its own wants. Its
 * ceiling is a whole tick step above the day's own busiest bucket, so the tallest column stops
 * at a gridline instead of at an arbitrary height.
 *
 * `absolute` uses a fixed ceiling — `data.max` when the caller supplied one, otherwise the same
 * rounded step — so two ribbons on one desk can be compared. A column above the ceiling is
 * clamped to the plot rather than drawn outside it, and counted, so the caption can say the
 * ceiling is too low instead of the card quietly cropping.
 *
 * @returns `{ ceiling, ticks, ys, clipped }` — `ys` is `[y, height]` per column
 */
function heightsFor(read, frame, scale) {
  const peak = frame.B.peak;
  const ceiling = scale === 'absolute'
    ? (read.ceiling != null ? read.ceiling : niceCeil(peak))
    : niceCeil(peak);

  const vScale = CK.scale([0, ceiling], [frame.y1, frame.y0]);
  let clipped = 0;

  const ys = frame.cols.map((c) => {
    if (!c.count) return [n(frame.y1 - STUB, 'stub'), STUB];
    const raw = frame.y1 - vScale(Math.min(c.count, ceiling));
    if (c.count > ceiling) clipped++;
    const h = Math.max(MIN_BAR, Math.min(PLOT_H, raw));
    return [n(frame.y1 - h, 'bar'), n(h, 'bar')];
  });

  /* Three value ticks is enough to read a height off and few enough that they do not become the
     picture. Zero is dropped: the baseline already is zero and a label on it duplicates it. */
  const ticks = CK.ticks(0, ceiling, 3)
    .filter((t) => t > 0 && t <= ceiling)
    .map((t) => [n(vScale(t), 'vtick'), CK.fmt(t)]);

  return { ceiling, ticks, ys, clipped };
}

/* ── saying what the picture shows ───────────────────────────────────────────────────── */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire picture to anyone using it.
 * "Activity ribbon" is therefore not an acceptable answer: it names the genre and withholds the
 * content. This says which day, in what zone, at what resolution, how many events in total,
 * where the busiest slice is and what dominated it — and, when anything was dropped, how much
 * and why, because a silently shortened total is the failure this card exists to avoid.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function describe(read, frame, heights, scale) {
  const B = frame.B;
  const day = longDay(read.dayNum);
  const cols = frame.cols;
  const mins = B.bucket;
  const res = mins % 60 === 0 ? (mins / 60) + '-hour' : mins + '-minute';
  const zoneNote = read.offsetFrom === 'pair'
    ? 'local time (' + offsetText(read.offset) + ', derived from the timestamps themselves)'
    : read.offsetFrom === 'given'
      ? 'local time (' + offsetText(read.offset) + ', as declared)'
      : 'local time (' + offsetText(read.offset) + ', assumed from the machine that built this card)';

  let busiest = null;
  for (const c of cols) if (c.count && (!busiest || c.count > busiest.count)) busiest = c;

  const skips = [];
  if (read.unreadable) {
    skips.push(read.unreadable + ' ' + (read.unreadable === 1 ? 'timestamp was' : 'timestamps were') +
               ' unreadable and skipped');
  }
  if (read.elsewhere) {
    skips.push(read.elsewhere + ' fall on other local days and are not shown');
  }

  const remainderNote = B.remainder
    ? ' The last column is short: ' + B.remainder + ' minutes rather than ' + mins +
      ', because ' + mins + ' does not divide the day evenly.'
    : '';

  const scaleNote = scale === 'absolute'
    ? ' Heights are on a fixed ceiling of ' + CK.fmt(heights.ceiling) + ', so this day can be ' +
      'compared with another.'
    : ' Heights are scaled to this day\u2019s own busiest slice.';

  const clipNote = heights.clipped
    ? ' ' + heights.clipped + ' ' + (heights.clipped === 1 ? 'column exceeds' : 'columns exceed') +
      ' that ceiling and are drawn clamped to the top.'
    : '';

  const classNote = read.order.length
    ? ' Classes: ' + read.order.join(', ') + '.'
    : '';

  const aria = read.total === 0
    ? 'Activity ribbon for ' + day + ' in ' + zoneNote + ', divided into ' + cols.length + ' ' +
      res + ' columns. No ' + read.unit + ' fall on this day, so every column is an empty stub.' +
      (skips.length ? ' ' + skips.join('; ') + '.' : '')
    : 'Activity ribbon for ' + day + ' in ' + zoneNote + ', divided into ' + cols.length + ' ' +
      res + ' columns counting ' + read.unit + '. ' + read.total + ' in total. The busiest slice ' +
      'is ' + hhmm(busiest.from) + ' to ' + hhmmTo(busiest.to) + ' with ' + busiest.count +
      (busiest.klass ? ', mostly ' + busiest.klass : '') + '.' +
      classNote + scaleNote + clipNote + remainderNote +
      (skips.length ? ' ' + skips.join('; ') + '.' : '');

  const capSkips = skips.length
    ? ' <span class="ck-aside">' + CK.esc(skips.join('; ')) + '.</span>'
    : '';

  const caption = read.total === 0
    ? '<b>' + CK.esc(day) + '</b> &mdash; <i>no ' + CK.esc(read.unit) + ' on this day</i>. the ' +
      cols.length + ' &times; ' + CK.esc(res) + ' columns are drawn as stubs so the axis still ' +
      'reads as a whole day.' + CK.esc(remainderNote) + capSkips
    : '<b>' + CK.esc(day) + '</b> &mdash; <b>' + CK.esc(String(read.total)) + '</b> ' +
      CK.esc(read.unit) + ' across ' + cols.length + ' &times; ' + CK.esc(res) + ' columns, ' +
      CK.esc(zoneNote) + '. busiest is <b>' + CK.esc(hhmm(busiest.from)) + '</b> with ' +
      CK.esc(String(busiest.count)) +
      (busiest.klass ? ' (<i>' + CK.esc(busiest.klass) + '</i>)' : '') + '. ' +
      '<span class="ck-aside">each column takes the colour of the class that occurs most in it, ' +
      'not of whatever happened last.</span>' + CK.esc(scaleNote + clipNote + remainderNote) + capSkips;

  return { aria: aria.trim(), caption: caption.trim() };
}

/* ── the one renderer ────────────────────────────────────────────────────────────────── */

/**
 * The display list for one variant: gridlines, hour axis, baseline, unit caption and columns.
 *
 * **This function is shipped, not described.** Its source is emitted into the browser script by
 * `Function.prototype.toString()` and it is also called here in Node to produce the markup the
 * card carries before any script has run. That is the contract's rule for a helper a type both
 * ships and tests, and the reason for it is exactly the failure it prevents: a Node-shaped twin
 * of a browser drawing routine eventually disagrees with it, and the disagreement is a card that
 * looks right until a setting is touched.
 *
 * It is therefore written in the emitted script's vocabulary — `var`, `function`, no arrow
 * functions, no template literals — because its own source has to satisfy the classic-script
 * rule once it lands in the page.
 *
 * @param V a variant from {@link variantFor}: static geometry for one bucket size
 * @param S that variant's block for one scale: value ticks, column tops and heights
 * @returns marks of the form `{ t, a, s, ti }` — tag name, attributes, text, tooltip
 *
 * @example ribbonMarks(V, V.s.peak).length;   // 2 per tick + 2 per hour + 2 + 2 per column
 */
function ribbonMarks(V, S) {
  var out = [], i;

  /* Value gridlines first, so the columns sit on top of them rather than under them. */
  for (i = 0; i < S.ticks.length; i++) {
    out.push({ t: 'line', a: { x1: V.x0, y1: S.ticks[i][0], x2: V.x1, y2: S.ticks[i][0], 'class': 'ck-rule' } });
    out.push({ t: 'text', a: { x: V.x0 - 5, y: S.ticks[i][0] + 3.2, 'text-anchor': 'end', 'class': 'ck-tk' }, s: S.ticks[i][1] });
  }

  for (i = 0; i < V.axis.length; i++) {
    out.push({ t: 'line', a: { x1: V.axis[i][0], y1: V.y1, x2: V.axis[i][0], y2: V.y1 + 4, 'class': 'ck-axis' } });
    out.push({ t: 'text', a: { x: V.axis[i][0], y: V.y1 + 14, 'text-anchor': 'middle', 'class': 'ck-tk' }, s: V.axis[i][1] });
  }

  out.push({ t: 'line', a: { x1: V.x0, y1: V.y1, x2: V.x1, y2: V.y1, 'class': 'ck-axis' } });

  /* The unit names the value axis instead of being folded into the prose, which is what lets
     every count in this card be written bare and never say "1 events". */
  out.push({ t: 'text', a: { x: 10, y: V.cy, 'text-anchor': 'middle', 'class': 'ck-cap-ax', transform: 'rotate(-90 10 ' + V.cy + ')' }, s: V.unit });

  for (i = 0; i < V.base.length; i++) {
    out.push({ t: 'rect', a: { x: V.base[i][0], y: S.y[i][0], width: V.base[i][1], height: S.y[i][1], fill: V.base[i][2], 'class': V.base[i][2] ? 'ck-b' : 'ck-b0' }, ti: V.base[i][3] });
    /* A two-pixel stub is not a hit area. A full-height invisible rect over each column gives
       every slice a tooltip, including the empty ones, which is where "nothing happened here"
       actually gets said. */
    out.push({ t: 'rect', a: { x: V.base[i][0], y: V.y0, width: V.base[i][1], height: V.y1 - V.y0, 'class': 'ck-hit' }, ti: V.base[i][3] });
  }

  return out;
}

/**
 * A display list as SVG markup, for the copy of the picture the card carries in its own HTML.
 *
 * Serialisation only — every decision about what to draw was made in {@link ribbonMarks}, which
 * is the same function the browser runs. An attribute whose value is empty is dropped rather
 * than written as `fill=""`, matching the browser renderer, so the two outputs agree element for
 * element and the verification can assert that they do.
 *
 * @example svgInner([{ t: 'line', a: { x1: 0 } }]);   // '<line x1="0"></line>'
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
 * Everything the browser needs for one bucket size: static column geometry plus a block per
 * scale.
 *
 * Split this way rather than as six complete display lists because the columns' x, width,
 * colour and tooltip do not depend on the scale, and emitting them twice would double the
 * payload for a card whose whole point is that it is cheap.
 */
function variantFor(read, bucket) {
  const frame = frameFor(read, bucket);

  const base = frame.base.map((b) => {
    const c = b.col;
    const parts = [];
    for (const [name, v] of c.tally) parts.push(name + ' ' + v.n);
    /* The count is bare and the unit lives on the axis, so this string never has to know
       whether `unit` pluralises. An empty bucket says so in words rather than showing a zero
       that could be mistaken for a missing reading. */
    const tip = hhmm(c.from) + '\u2013' + hhmmTo(c.to) + ' \u00b7 ' +
                (c.count ? String(c.count) : 'nothing') +
                (parts.length ? ' \u00b7 ' + parts.join(', ') : '');
    return [
      n(b.x, 'col x'),
      n(b.w, 'col w'),
      c.klass ? read.colour.get(c.klass) : '',
      tip,
    ];
  });

  const s = {};
  for (const scale of SCALES) {
    const h = heightsFor(read, frame, scale);
    s[scale] = {
      ticks: h.ticks,
      y: h.ys,
      note: describe(read, frame, h, scale),
    };
  }

  return {
    W: n(frame.W, 'W'),
    H: n(frame.H, 'H'),
    x0: n(frame.x0, 'x0'),
    x1: n(frame.x1, 'x1'),
    y0: n(frame.y0, 'y0'),
    y1: n(frame.y1, 'y1'),
    /* The value axis is captioned with the unit rather than the sentences saying "3 events" and
       "1 events". That is the chart card's rule and it is here for the same reason: an English
       pluraliser inside a card is a bug waiting for its first "sheep". */
    unit: read.unit,
    cy: n((frame.y0 + frame.y1) / 2, 'cap'),
    base,
    axis: frame.axis.map((a) => [n(a.x, 'tick'), a.label]),
    s,
  };
}

/**
 * Prefix every selector with the card's own scope. One card, one blast radius.
 *
 * A selector starting with `&` is attached without a space, for the case that bit once: the
 * state attributes live on the `<section>` itself, so `[data-legend="off"] .ck-legend` scopes to
 * a *descendant* carrying the attribute — a selector that is perfectly valid, matches nothing,
 * and fails silently by leaving the legend visible.
 *
 * @example scope('x', [['&[data-legend="off"] .ck-legend', 'display: none;']]);
 * // '.ck-ribbon[data-card="x"][data-legend="off"] .ck-legend { display: none; }'
 */
function scope(id, rules) {
  const own = '.ck-ribbon[data-card="' + id + '"]';
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
 * Nothing here names a colour. Every value is a desk token, so the light switch is the only
 * thing that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 */
function cardCss(id, read, seedW) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 2px;'],

    ['.ck-day', 'font: 400 11px/1.4 var(--ui); color: var(--ink-dim); margin: 0 0 8px;'],
    ['.ck-day b', 'font-weight: 600; color: var(--ink);'],

    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-b', 'stroke: none;'],
    /* An empty bucket is drawn, not omitted: a gap in the strip would read as "no axis here"
       rather than as "nothing happened here", and those are different claims. */
    ['.ck-plot .ck-b0', 'fill: var(--rule); stroke: none;'],
    /* `none` rather than a transparent colour: `pointer-events: all` makes an unpainted rect
       hit-testable on its own, and naming any colour here — even a transparent one — would be a
       colour literal in a file that is contractually free of them. */
    ['.ck-plot .ck-hit', 'fill: none; stroke: none; pointer-events: all;'],

    ['.ck-legend i', 'width: 7px; height: 7px; display: block; border-radius: 1px;'],
    ['&[data-legend="off"] .ck-legend', 'display: none;'],

    /* Settings checkboxes: kit.css stretches a field to its cell, and a stretched checkbox is a
       wide hit area with a glyph adrift in it. */
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  /* One rule per class, so the legend swatch is literally the same token the column is filled
     with. Deriving the swatch from the class's *index* instead would silently disagree with any
     class whose colour the author pinned with a token. */
  read.order.forEach((name, i) => {
    rules.push(['.ck-legend i[data-k="' + i + '"]', 'background: ' + read.colour.get(name) + ';']);
  });

  /* A 15-minute ribbon is 96 columns and does not fit the desk column. It keeps its own width
     and scrolls inside `.ck-scroll` rather than shrinking, because a 96-column ribbon squeezed
     into 640px stops being columns and becomes a texture. The desk column never widens, so the
     page never grows a horizontal scrollbar of its own. The browser overrides this inline when a
     setting changes the bucket size; the rule is what makes the static render correct. */
  if (seedW > W0) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(seedW) + 'px;']);

  return scope(id, rules) + '\n';
}

/** The card's markup: one section, a gear, a settings panel, the day label, the plot, a legend. */
function cardHtml(id, title, read, note, seedV, seedS) {
  const f = (name) => CK.esc(id) + '-' + name;

  const bucketOpts = read.buckets
    .map((b) => '<option value="' + b + '"' + (b === read.seedBucket ? ' selected' : '') + '>' +
                b + ' min</option>')
    .join('');

  const scaleOpts = SCALES
    .map((s) => '<option value="' + s + '"' + (s === read.seedScale ? ' selected' : '') + '>' +
                s + '</option>')
    .join('');

  const legend = read.order.length
    ? read.order.map((name, i) =>
        '<span><i data-k="' + i + '"></i>' + CK.esc(name) + '</span>').join('')
    : '<span class="ck-aside">no classes</span>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-ribbon" data-legend="on">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="ribbon settings"></button>\n' +

    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('bucket') + '">bucket</label>\n' +
    '    <select id="' + f('bucket') + '" name="bucket">' + bucketOpts + '</select>\n' +
    '    <label for="' + f('scale') + '">scale</label>\n' +
    '    <select id="' + f('scale') + '" name="scale">' + scaleOpts + '</select>\n' +
    '    <label for="' + f('legend') + '">legend</label>\n' +
    '    <input id="' + f('legend') + '" name="legend" type="checkbox" checked>\n' +
    '    <p class="ck-set-foot">Peak scales to this day; absolute holds a fixed ceiling so two ' +
         'days compare.</p>\n' +
    '  </div>\n' +

    '  <p class="ck-day"><b>' + CK.esc(longDay(read.dayNum)) + '</b> \u00b7 ' +
       CK.esc(offsetText(read.offset)) + '</p>\n' +
    /* The picture ships drawn. A card whose axis only exists once a script has run is a card
       that is blank in a static render and blank if one other card on the desk fails to parse;
       the marks here come from the same `ribbonMarks` the browser re-runs on a settings change,
       so the two cannot disagree. */
    '  <div class="ck-scroll"><svg class="ck-plot" role="img" viewBox="0 0 ' +
       seedV.W + ' ' + seedV.H + '" aria-label="' + CK.esc(note.aria) + '">' +
       svgInner(ribbonMarks(seedV, seedS)) + '</svg></div>\n' +
    '  <div class="ck-legend">' + legend + '</div>\n' +
    '  <div class="ck-cap">' + note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: a renderer that paints a variant, and nothing that decides anything.
 *
 * Classic script, ES5 vocabulary — `var`, `function`, no arrow functions, no template literals,
 * no optional chaining. This is concatenated into one inline block with every other card's
 * script, so a single modern-syntax parse error takes the whole desk down.
 *
 * Redrawing on a settings change is a repaint of a variant that was computed in Node, not a
 * recomputation: the bucket sizes and both scales were all built up front precisely so that the
 * browser never has to divide by a peak that might be zero.
 */
function cardJs(id, variants, defaults) {
  const src = '/* ribbon card: repaints one of the variants built when the card was built.\n' +
    '   Nothing here decides where a column goes or what colour it is; those are decisions and\n' +
    '   they were made in Node, where a test can reach them. The mark builder below is the very\n' +
    '   source that ran at build time, shipped rather than restated. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var VAR = ' + jsLit(variants) + ';\n' +
    '  var DEFAULTS = ' + jsLit(defaults) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + ribbonMarks.toString().split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. Attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where ribbon decisions live. */\n' +
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
    '  /* A select hands back a string, so a stored bucket of 30 and a default of 30 are a\n' +
    '     string and a number. Every lookup goes through String() so the two cannot disagree. */\n' +
    '  function pick(cfg) {\n' +
    '    var v = VAR[String(cfg.bucket)];\n' +
    '    return v ? v : VAR[String(DEFAULTS.bucket)];\n' +
    '  }\n' +
    '\n' +
    '  function render(cfg) {\n' +
    '    var V = pick(cfg), S = V.s[cfg.scale] ? V.s[cfg.scale] : V.s[DEFAULTS.scale];\n' +
    '    var marks = ribbonMarks(V, S), i;\n' +
    '\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + V.W + " " + V.H);\n' +
    '    plot.setAttribute("aria-label", S.note.aria);\n' +
    '    plot.style.minWidth = V.W > 640 ? V.W + "px" : "";\n' +
    '    for (i = 0; i < marks.length; i++) { plot.appendChild(node(marks[i])); }\n' +
    '\n' +
    '    /* The caption is markup that was escaped value by value in Node; nothing from the data\n' +
    '       reaches it unescaped, which is why it may be assigned rather than built. */\n' +
    '    if (cap) { cap.innerHTML = S.note.caption; }\n' +
    '    sec.setAttribute("data-legend", cfg.legend ? "on" : "off");\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  /* The contract bans backticks in emitted `js` because every card's script is concatenated
     into one inline block, so one stray template literal takes the whole desk down. A comment
     counts: `Function.prototype.toString` ships comments verbatim. Throwing here rather than
     trusting the review is the difference between a build failure and a blank desk — this file
     shipped exactly that bug once tonight, from a backtick inside a comment. */
  const bad = src.indexOf(String.fromCharCode(96));
  if (bad >= 0) {
    throw new Error('cardkit/ribbon: emitted js contains a backtick at offset ' + bad +
                    ' — near: ' + src.slice(Math.max(0, bad - 60), bad + 60));
  }
  return src;
}

/**
 * Build one ribbon card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ events, bucket, day, classes, unit, tzOffset, max }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, which means a bug here
 *                 rather than bad input: unplaceable events are counted and skipped while reading
 *
 * @example
 * build({
 *   id: 'today',
 *   title: 'today, by the hour',
 *   data: {
 *     day: '2026-08-27',
 *     unit: 'events',
 *     classes: { flow: 's4', strain: 's1', idle: 's6' },
 *     events: [{ at: '2026-08-27T23:15:00Z', local: '2026-08-27 16:15', klass: 'flow' }],
 *   },
 *   ord: 20,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'ribbon' : id);
  const heading = clean(title == null ? 'Ribbon' : title);
  const read = readData(data);

  const variants = {};
  for (const b of read.buckets) variants[String(b)] = variantFor(read, b);

  const seedKey = String(read.seedBucket);
  const seed = variants[seedKey] || variants[String(DEFAULTS.bucket)];
  const seedS = seed.s[read.seedScale] || seed.s[DEFAULTS.scale];
  const note = seedS.note;

  const defaults = { bucket: read.seedBucket, legend: DEFAULTS.legend, scale: read.seedScale };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      day: dayLabel(read.dayNum),
      total: read.total,
      skipped: read.unreadable,
      offset: read.offset,
      settings: defaults,
    },
    html: cardHtml(cardId, heading, read, note, seed, seedS),
    css: cardCss(cardId, read, seed.W),
    js: cardJs(cardId, variants, defaults),
  };
}

export default { meta, build };
