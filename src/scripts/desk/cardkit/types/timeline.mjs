/**
 * `timeline` — events as dots on a time axis, with the labels placed by a policy that says what it
 * costs.
 *
 * THE AXIS IS THE EASY HALF. Placing a dot at `CK.scale(t)` is four characters of arithmetic. The
 * interesting problem is that events cluster and their labels do not fit, and every honest answer
 * to that trades something away. This card's answer is three moves, in this order, and it states
 * the price of each:
 *
 * 1. ALTERNATE ABOVE AND BELOW THE AXIS. This halves the density for free and is the best first
 *    move available, because it costs nothing but a zig-zag in the reading order. It is the default.
 *    The two rows are then placed independently, so a dense run only competes with every OTHER
 *    event in it.
 *
 * 2. GREEDY LEFT-TO-RIGHT PUSH, WITH A RIGHT-TO-LEFT RELAXATION. Within one row, each label wants
 *    to sit centred on its dot; where that would overlap its left neighbour it is pushed right. The
 *    push CASCADES — a dense cluster on the left shoves everything after it — so when the last
 *    label runs past the right edge a second pass sweeps back from that edge pushing labels LEFT
 *    instead. That turns a pile-up at the clamp into a spread, but it does not make the cascade go
 *    away: a label can end up a long way from its event either side. Every label whose box no longer
 *    covers its own dot is marked DISPLACED, its leader is drawn dashed, and the caption counts
 *    them. The fidelity cost is exact and worth naming: a displaced label's horizontal position is
 *    not its event's time, and only the leader line says where it belongs.
 *
 * 3. DROP, RATHER THAN OVERLAP. Labels are only pushed at all if they can all fit; the test is
 *    exact, since any arrangement that preserves time order needs at least the sum of the widths
 *    plus the gaps. When they cannot fit, labels are dropped from the DENSEST part of the row first
 *    — the place a label was least legible anyway — until the rest fit, keeping the first and the
 *    last as anchors for as long as possible. A dropped label never drops its event: the dot is
 *    still drawn, still in the tooltip, still counted. The caption names how many labels went and
 *    why.
 *
 * Collapsing a dense run into one "N events" marker is offered and is OFF by default, because it is
 * the one move here that actually hides data rather than hiding a label.
 *
 * THE DIVISION BY ZERO. `(t - min) / (max - min)` is `NaN` when every event is at the same instant,
 * and a single event is the commonest case of that. `CK.scale` maps a zero-width domain onto the
 * range's midpoint, so a lone event draws CENTRED rather than blank — but the tick generator would
 * still have nothing to step through, so the zero-span case is caught before it gets there and the
 * axis carries a single mark naming the instant. Nothing is invented to give the axis a width.
 *
 * Everything geometric is computed by {@link txRender}, the same function in Node and in the
 * browser, so the caption can never describe a drawing that is not on the screen.
 *
 * @see ./gantt.mjs — the same time axis carrying intervals rather than instants
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
 * @example loadKit().scale([0, 10], [0, 100])(5);   // 50
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/timeline: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/timeline: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const WMAX = 2200;

/* A cap on the PAYLOAD, not on the arithmetic: the caption's counts come from the complete input
   before anything is dropped, and the drop is itself reported. */
const EVCAP = 400;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `alternate` is the default side policy because it halves label density at no cost to the data.
 * `collapse` is off because it is the only setting here that hides events rather than labels, and a
 * card that silently ate data by default would be lying in the direction that is hardest to notice.
 */
export const defaults = {
  side:     'alternate',
  labels:   true,
  collapse: false,
  ticks:    true,
};

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `evolution` — "what changed over time?" — is the least wrong of the ten, and it is worth being
 * honest that it is a fit rather than a match: a timeline shows WHEN things happened, and the
 * category vocabulary has no key for that. It is not `live-and-ambient`, which is about now; not
 * `work-and-lists`, which is about what is outstanding; and not `flow-and-relationship`, since
 * events on a timeline are not connected to each other. What changed over time is the question a
 * reader arrives with when they want a chronology, even though the thing that changed is the world
 * rather than a value. See {@link build} for the argument at length.
 */
export const meta = {
  name: 'timeline',
  summary:
    'Events as dots on a time axis, with labels alternated above and below and placed by a stated ' +
    'collision policy rather than allowed to overlap.',
  shape:
    '{ events: [{ id, at, label, group, note }], title } — ' +
    'at is an ISO string, epoch milliseconds or a Date',
  category: 'evolution',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one card
 * in this catalogue was refused because a comment said "the class is what CSS reads" — and a
 * guard that cries wolf is a guard somebody switches off. Offsets are preserved so a reported
 * position still points at the right place. Regex literals are recognised, because otherwise the
 * scanner desynchronises on the quote inside a `replace` call and starts blanking real code,
 * which turns a false positive into a far worse false negative.
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
    /* A slash is a regex only where a value cannot precede it. Tracking the previous significant
       character is the cheap approximation that gets this right for real code. */
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
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in
 * a comment as readily as in code, because `Function.prototype.toString()` ships comments
 * verbatim — closes the surrounding template literal early and blanks every card on the desk.
 * The backtick is never written in this file; it is reached for as `String.fromCharCode(96)`,
 * which cannot be mistyped and cannot be mis-decoded during emission.
 *
 * Backtick, arrow and optional chaining are scanned raw, because none of them can appear
 * innocently. The declaration keywords are scanned only after {@link blankNonCode}, because they
 * can and do appear innocently in English.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/timeline';
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
 * `CK.esc` drops these on the way into markup, which covers the caption and the tooltips but not
 * the payload the browser is handed as a JavaScript literal. `JSON.stringify` escapes everything
 * below 0x20 and leaves DEL alone, so a label carrying one would put a raw control byte into the
 * emitted script and the build-time guard would refuse the whole card. Removing them once, here,
 * means both paths see the same text.
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
 * One instant as epoch milliseconds, or null when the value is not a time.
 *
 * Refused rather than coerced, and the refusal is counted: `Number('')` is 0 and `Date.parse` of
 * anything it does not recognise is `NaN`, and either one would put an event at the start of 1970
 * or make it vanish. A chronology with an invented date in it is worse than one with a stated hole.
 *
 * @example readTime('1969-07-20T20:17:00Z');   // -14182980000
 * @example readTime('some time in July');      // null
 */
function readTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

/**
 * Normalise whatever arrived into the event list the renderer may assume.
 *
 * Nothing throws and nothing is coerced. Events are sorted into time order here rather than in the
 * renderer, because every part of the collision policy assumes it and a policy that quietly
 * depended on the input order would be a different policy on Tuesday.
 *
 * A duplicate id keeps its first event and the repeats are counted, which is the same rule the rest
 * of the catalogue uses. Two events at the SAME INSTANT are not duplicates and both are kept: that
 * is a real thing that happens, and the drawing staggers their dots so two events never look like
 * one.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns the payload {@link txRender} takes, plus the counts the caption reports
 *
 * @example readData({ events: [{ id: 'a', at: 0, label: 'zero' }] }).events.length;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.events) ? d.events : [];

  const refused = [];
  const dupIds = [];
  const seen = new Set();
  const events = [];
  let dropped = 0;
  let coincident = 0;

  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (!e || typeof e !== 'object') { refused.push('event ' + (i + 1) + ' is not an object'); continue; }

    const id = clean(e.id == null ? '' : e.id).trim();
    const label = clean(e.label == null ? '' : e.label);
    const who = label || id || ('event ' + (i + 1));

    if (id && seen.has(id)) { dupIds.push(id); continue; }

    const at = readTime(e.at);
    if (at === null) { refused.push(who + ' has no readable date'); continue; }
    if (events.length >= EVCAP) { dropped++; continue; }

    if (id) seen.add(id);
    events.push({
      id: id || ('e' + (i + 1)),
      at,
      label: label || id || ('event ' + (i + 1)),
      group: e.group == null || e.group === '' ? '' : clean(e.group),
      note: e.note == null ? '' : clean(e.note),
    });
  }

  /* Stable by construction: the comparator falls through to the original position, so two events at
     one instant keep the order they were written in rather than the order a sort happened to leave
     them in. A chronology whose ties reshuffle between runs is a chronology nobody can cite. */
  const order = events.map((e, i) => i);
  order.sort((a, b) => events[a].at - events[b].at || a - b);
  const sorted = order.map((i) => events[i]);

  for (let i = 1; i < sorted.length; i++) if (sorted[i].at === sorted[i - 1].at) coincident++;

  return {
    events: sorted,
    title: clean(d.title == null ? '' : d.title),
    refused, dupIds, dropped, coincident,
    W0, WMAX,
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────── */
/* Written in the browser's vocabulary from here down to the SHIPPED list — var and function, no
   arrows, no template literals, no backtick and no arrow or optional-chaining sequence in any
   comment — because every one of these is emitted verbatim through Function.prototype.toString()
   and is ALSO run here, in Node, to draw the copy that ships inside card.html. One source, two
   runtimes, nothing to drift. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole attribute and the drawing
 * simply is not there, with nothing in the console. This is the guard that catches a division by a
 * zero span if one ever gets past the check that is supposed to stop it.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/timeline: non-finite coordinate (' + v + ')');
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
  return str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/** Two digits, so a month or an hour aligns with the rest of a label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A UTC instant for a year that may be outside the two-digit trap.
 *
 * Date.UTC maps years 0 to 99 onto 1900 to 1999, so building a tick for the year 44 through it
 * lands in 1944 and an axis of antiquity silently becomes an axis of the twentieth century — which
 * is exactly the failure a timeline spanning ten thousand years walks into first. Setting the year
 * afterwards on a real Date has no such rule, and the seed year is 2000 so the seed is never itself
 * in the trapped range.
 *
 * @example new Date(utcAt(44, 0, 1)).getUTCFullYear();   // 44
 */
function utcAt(y, mo, day) {
  var dt = new Date(Date.UTC(2000, mo, day, 0, 0, 0, 0));
  dt.setUTCFullYear(y);
  return dt.getTime();
}

/**
 * The step ladder a time axis is allowed to choose from.
 *
 * Sub-year steps are exact millisecond counts; month and year steps are CALENDAR steps, because a
 * month is not a fixed number of milliseconds and a ladder that pretended otherwise would drift by
 * a day per decade and by a month per millennium. The ladder runs from one second to fifty thousand
 * years, which is what lets ten seconds of deploy log and ten thousand years of prehistory both get
 * sane gridlines out of the same function instead of one of them getting a hundred and one of them
 * getting none.
 *
 * @example txLadder()[0].ms;   // 1000
 */
function txLadder() {
  var S = 1000, M = 60000, H = 3600000, D = 86400000;
  return [
    { ms: S }, { ms: 2 * S }, { ms: 5 * S }, { ms: 10 * S }, { ms: 15 * S }, { ms: 30 * S },
    { ms: M }, { ms: 2 * M }, { ms: 5 * M }, { ms: 15 * M }, { ms: 30 * M },
    { ms: H }, { ms: 3 * H }, { ms: 6 * H }, { ms: 12 * H },
    { ms: D }, { ms: 2 * D }, { ms: 7 * D }, { ms: 14 * D },
    { mo: 1 }, { mo: 3 }, { mo: 6 },
    { y: 1 }, { y: 2 }, { y: 5 }, { y: 10 }, { y: 25 }, { y: 50 }, { y: 100 },
    { y: 250 }, { y: 500 }, { y: 1000 }, { y: 2500 }, { y: 5000 }, { y: 10000 },
    { y: 25000 }, { y: 50000 }
  ];
}

/** Roughly how many milliseconds one ladder rung covers, for choosing between rungs. */
function txRungMs(r) {
  if (r.ms) { return r.ms; }
  if (r.mo) { return r.mo * 2629746000; }
  return r.y * 31556952000;
}

/**
 * Gridline positions for a time axis, on a step a calendar actually has.
 *
 * A zero-width span is a legitimate axis — one event, or every event at one instant — and returns a
 * single tick rather than dividing by zero. If a chosen rung happens to place no tick inside a very
 * narrow domain, the domain midpoint is used, so the axis never comes back empty and silently
 * unlabelled. Week steps are anchored on the Monday nearest the epoch rather than on the epoch
 * itself, which was a Thursday.
 *
 * @param lo   the domain start, epoch milliseconds
 * @param hi   the domain end
 * @param want roughly how many ticks are wanted
 * @returns `{ ticks, step }` where `step` is an approximate millisecond size, used only to pick
 *          the label format
 *
 * @example txTicks(0, 5000, 5).ticks.length;   // 6
 */
function txTicks(lo, hi, want) {
  if (!(hi > lo)) { return { ticks: [lo], step: 0 }; }
  var span = hi - lo, n = Math.max(1, want || 5), rungs = txLadder(), i, pick = null;

  for (i = 0; i < rungs.length; i++) {
    if (span / txRungMs(rungs[i]) <= n) { pick = rungs[i]; break; }
  }
  if (!pick) { pick = rungs[rungs.length - 1]; }

  var out = [], v, guard = 0, step;

  if (pick.ms) {
    /* Day-and-larger millisecond steps land on UTC midnights because the epoch is one; the two
       week steps are shifted by four days so they land on Mondays instead of Thursdays. */
    var anchor = pick.ms % 604800000 === 0 ? 345600000 : 0;
    v = Math.ceil((lo - anchor) / pick.ms) * pick.ms + anchor;
    while (v <= hi && guard++ < 4000) { out.push(v); v += pick.ms; }
    step = pick.ms;
  } else if (pick.mo) {
    var d0 = new Date(lo);
    var mi = d0.getUTCFullYear() * 12 + d0.getUTCMonth();
    mi = Math.floor(mi / pick.mo) * pick.mo;
    while (guard++ < 4000) {
      var yy = Math.floor(mi / 12), mm = mi - yy * 12;
      v = utcAt(yy, mm, 1);
      if (v > hi) { break; }
      if (v >= lo) { out.push(v); }
      mi += pick.mo;
    }
    step = pick.mo * 2629746000;
  } else {
    var y = Math.floor(new Date(lo).getUTCFullYear() / pick.y) * pick.y;
    while (guard++ < 4000) {
      v = utcAt(y, 0, 1);
      if (v > hi) { break; }
      if (v >= lo) { out.push(v); }
      y += pick.y;
    }
    step = pick.y * 31556952000;
  }

  if (!out.length) { out.push((lo + hi) / 2); step = 0; }
  return { ticks: out, step: step };
}

/**
 * A tick label in the units the step is actually in.
 *
 * UTC getters throughout: a date written as a plain day parses to UTC midnight, so reading it back
 * in the viewer's zone can print the day before, and an axis that disagrees with the strings it was
 * handed is worse than a coarse one. A step of zero means the axis has no span, so the label is the
 * whole instant. Years before the common era come back negative, which is ugly and unambiguous, and
 * those are the right two properties for an axis label.
 *
 * @example txFmtTime(0, 86400000);   // '01-01'
 */
function txFmtTime(ms, step) {
  var d = new Date(ms);
  if (!step) { return txFmtFull(ms); }
  if (step < 60000) {
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }
  if (step < 86400000) { return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()); }
  if (step < 2419200000) { return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  if (step < 25920000000) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  return String(d.getUTCFullYear());
}

/**
 * A full instant, for a tooltip and for the single-event axis, where there is room to be exact.
 *
 * @example txFmtFull(0);   // '1970-01-01 00:00 UTC'
 */
function txFmtFull(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' +
         pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
}

/* Display-list primitives. Every mark is { t: tagName, a: attributes, s: text, ti: tooltip,
   kids: [] }, with real SVG attribute names, so the browser-side translator knows nothing about
   chronologies and a mark in a debugger reads as the element it becomes. */

function mLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' } };
}

function mText(x, y, s, cls, anchor) {
  return { t: 'text', a: { x: fin(x), y: fin(y), 'class': cls || '', 'text-anchor': anchor || 'start' },
           s: String(s) };
}

function mDot(cx, cy, r, cls) {
  return { t: 'circle', a: { cx: fin(cx), cy: fin(cy), r: fin(r), 'class': cls || '' } };
}

function mRect(x, y, w, h, cls, rx) {
  var a = { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)),
            'class': cls || '' };
  if (rx) { a.rx = fin(rx); }
  return { t: 'rect', a: a };
}

/** Metrics for the drawing. One place to change how much air the card gets. */
function txMetrics() {
  return {
    pad:    12,
    lead:   14,
    labH:   13,
    tickH:  16,
    dotR:   3.2,
    gap:    6,
    labMax: 170,
    stag:   5,
    stack:  4,
    foot:   6,
    collapsePx: 9
  };
}

/**
 * Settle a settings object into the four values the renderer may assume.
 *
 * An unknown `side` from a hand-edited store falls back to the default rather than reaching the
 * geometry, where it would silently mean "below" through a comparison nobody wrote deliberately.
 *
 * @example txConfig({ side: 'sideways' }).side;   // 'alternate'
 */
function txConfig(conf) {
  var c = conf && typeof conf === 'object' ? conf : {};
  return {
    side:     c.side === 'above' || c.side === 'below' ? c.side : 'alternate',
    labels:   c.labels === undefined || c.labels === null ? true : !!c.labels,
    collapse: c.collapse === undefined || c.collapse === null ? false : !!c.collapse,
    ticks:    c.ticks === undefined || c.ticks === null ? true : !!c.ticks
  };
}

/**
 * Fold runs of events that land within a few pixels of each other into single markers.
 *
 * Only ever reached when the reader asks for it. A run of three or more becomes one marker at the
 * mean position of its members, labelled with the count; runs of one or two stay as they are,
 * because collapsing a pair replaces two labels with a marker that says "2 events" and is neither
 * shorter nor more informative.
 *
 * This is the one operation in this card that hides DATA rather than hiding a label, which is why
 * it is a setting and not a policy. The members survive in the marker's tooltip and in the count
 * the caption reports, so nothing becomes unreachable — but nothing on the axis names them either.
 *
 * @param events events in time order
 * @param at     their x positions, in the same order
 * @param px     how close two positions have to be to join one run
 * @returns marks, each `{ at, x, members }` with members as indices into `events`
 *
 * @example txCollapse([{ at: 0 }, { at: 1 }, { at: 2 }], [0, 1, 2], 9)[0].members.length;   // 3
 */
function txCollapse(events, at, px) {
  var out = [], i = 0, j, run, sum;
  while (i < events.length) {
    j = i;
    while (j + 1 < events.length && at[j + 1] - at[i] <= px) { j++; }
    if (j - i + 1 >= 3) {
      run = []; sum = 0;
      for (var k = i; k <= j; k++) { run.push(k); sum += at[k]; }
      out.push({ at: events[run[0]].at, x: sum / run.length, members: run });
      i = j + 1;
    } else {
      out.push({ at: events[i].at, x: at[i], members: [i] });
      i++;
    }
  }
  return out;
}

/**
 * Which labels can be drawn at all, and which have to go.
 *
 * The test is exact rather than heuristic. Any arrangement that keeps the labels in time order
 * needs at least the sum of their widths plus one gap between each neighbouring pair; if the row is
 * narrower than that, no placement exists and something must be dropped. What goes first is the
 * label in the DENSEST part of the row — the one whose nearest neighbour in time is closest, which
 * is the label that was least legible in the first place. The first and the last are kept while
 * anything else remains, because they are what tells a reader what the axis spans.
 *
 * @param items `{ ideal, w }` in time order
 * @param room  the pixels available
 * @param gap   the minimum space between two labels
 * @returns `{ live, dropped }` — indices into `items`
 *
 * @example txFit([{ ideal: 0, w: 50 }, { ideal: 1, w: 50 }], 40, 6).dropped.length;   // 1
 */
function txFit(items, room, gap) {
  var live = [], i, total = 0;
  for (i = 0; i < items.length; i++) { live.push(i); total += items[i].w; }
  total += Math.max(0, items.length - 1) * gap;

  var dropped = [], guard = 0;
  while (live.length > 0 && total > room && guard++ <= items.length + 2) {
    var pick = -1, bestGap = 0, k, g, g2;
    for (k = 0; k < live.length; k++) {
      if ((k === 0 || k === live.length - 1) && live.length > 2) { continue; }
      g = -1;
      if (k > 0) { g = items[live[k]].ideal - items[live[k - 1]].ideal; }
      if (k < live.length - 1) {
        g2 = items[live[k + 1]].ideal - items[live[k]].ideal;
        if (g < 0 || g2 < g) { g = g2; }
      }
      if (g < 0) { g = 0; }
      if (pick < 0 || g < bestGap) { pick = k; bestGap = g; }
    }
    if (pick < 0) { pick = live.length - 1; }
    dropped.push(live[pick]);
    total -= items[live[pick]].w + gap;
    live.splice(pick, 1);
  }
  return { live: live, dropped: dropped };
}

/**
 * Where each surviving label actually sits.
 *
 * Two passes. The first is the greedy left-to-right push: every label wants to be centred on its
 * event, and takes that position unless its left neighbour is in the way, in which case it is
 * pushed just clear. This is O(n) and it CASCADES, which is the whole problem with it — one dense
 * cluster early on displaces every label after it.
 *
 * The second pass only runs when the first has pushed the last label past the right edge. It sweeps
 * back from that edge, pushing labels LEFT instead, which turns what would have been a pile at the
 * clamp into a spread across the row. It cannot fail, because {@link txFit} has already guaranteed
 * the labels fit; and it does not undo the cascade, it only shares it out. A label can end up well
 * to the left of its event as readily as well to the right, and the caller marks any label whose
 * box no longer covers its own dot as displaced.
 *
 * @param items `{ ideal, w }` in time order
 * @param live  indices of the labels that are being drawn, ascending
 * @returns left edges, indexed like `items`, meaningless for anything not in `live`
 *
 * @example txPlace([{ ideal: 20, w: 40 }], [0], 0, 100, 6)[0];   // 0
 */
function txPlace(items, live, x0, x1, gap) {
  var pos = [], i, k;
  for (i = 0; i < items.length; i++) { pos.push(0); }
  if (!live.length) { return pos; }

  for (k = 0; k < live.length; k++) {
    i = live[k];
    var want = items[i].ideal - items[i].w / 2;
    var floorAt = k === 0 ? x0 : pos[live[k - 1]] + items[live[k - 1]].w + gap;
    pos[i] = want > floorAt ? want : floorAt;
  }

  var last = live[live.length - 1];
  if (pos[last] + items[last].w > x1) {
    pos[last] = x1 - items[last].w;
    for (k = live.length - 2; k >= 0; k--) {
      i = live[k];
      var ceilAt = pos[live[k + 1]] - items[i].w - gap;
      if (pos[i] > ceilAt) { pos[i] = ceilAt; }
    }
  }
  return pos;
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption leads with the collision policy, because a reader looking at a label that is not
 * above its dot has no way to know whether that is a bug or a decision, and the answer changes what
 * they should believe about the picture.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function txNote(P, c, stats) {
  var E = P.events, n = E.length, i, bits = [], said = [];

  if (!n) {
    return {
      aria: 'Timeline with no events: nothing is on the axis.',
      caption: 'a timeline with <b>no events</b> &mdash; the axis is drawn so the card keeps its ' +
               'place, but nothing has happened on it.' +
               (P.refused.length ? ' <i>' + P.refused.length + ' input' +
                 (P.refused.length === 1 ? '' : 's') + ' refused</i>: ' +
                 CK.esc(P.refused.slice(0, 4).join('; ')) + '.' : '')
    };
  }

  for (i = 0; i < n && i < 12; i++) { said.push(txFmtFull(E[i].at) + ', ' + E[i].label); }
  if (n > 12) { said.push('and ' + (n - 12) + ' more'); }

  var aria =
    'Timeline of ' + n + ' ' + (n === 1 ? 'event' : 'events') +
    (stats.single ? ' at a single instant, drawn centred'
                  : ', from ' + txFmtFull(stats.lo) + ' to ' + txFmtFull(stats.hi)) +
    '. ' + said.join('. ') + '.';

  if (stats.single) {
    bits.push(n === 1
      ? 'a single event has no span, so the axis carries one mark rather than a scale; the event is ' +
        'drawn centred rather than left blank, which is what a division by a zero span would ' +
        'otherwise produce.'
      : 'every event is at the <b>same instant</b>, so the span is zero and the axis carries one ' +
        'mark rather than a scale. The dots are staggered off the line so ' + n + ' events do not ' +
        'read as one.');
  }

  if (c.labels) {
    bits.push('labels are placed ' +
      (c.side === 'alternate' ? '<i>alternately above and below</i> the axis, which halves the ' +
                                'density for nothing but a zig-zag in the reading order'
                              : '<i>all ' + c.side + '</i> the axis, which doubles the density ' +
                                'compared with alternating them')
      + ', then pushed left to right out of each other. The push cascades, so a crowded stretch ' +
      'moves everything after it.');
  } else {
    bits.push('<i>labels are switched off</i>, so the axis carries the dots and the tooltips only.');
  }

  if (stats.displaced) {
    bits.push('<b>' + stats.displaced + '</b> label' + (stats.displaced === 1 ? '' : 's') +
              ' ended up clear of ' + (stats.displaced === 1 ? 'its' : 'their') +
              ' own dot and ' + (stats.displaced === 1 ? 'is' : 'are') +
              ' drawn with a dashed leader: <i>a displaced label horizontal position is not its ' +
              'event time</i>, and only the leader says where it belongs.');
  }
  if (stats.droppedLabels) {
    bits.push('<b>' + stats.droppedLabels + '</b> label' + (stats.droppedLabels === 1 ? '' : 's') +
              ' would not fit at any position and ' + (stats.droppedLabels === 1 ? 'was' : 'were') +
              ' dropped from the densest stretch first, keeping the ends as anchors. <b>No event ' +
              'was dropped</b> &mdash; every dot is still on the axis and still in a tooltip.');
  }
  if (stats.collapsed) {
    bits.push('<b>' + stats.collapsed + '</b> event' + (stats.collapsed === 1 ? '' : 's') +
              ' folded into <b>' + stats.collapsedInto + '</b> marker' +
              (stats.collapsedInto === 1 ? '' : 's') + '. This is the one setting that hides data ' +
              'rather than hiding a label, which is why it is off unless asked for; the members are ' +
              'in each marker tooltip.');
  }
  if (P.coincident) {
    bits.push('<b>' + P.coincident + '</b> event' + (P.coincident === 1 ? '' : 's') +
              ' share an instant with the one before; their dots are staggered off the axis so two ' +
              'events never read as one.');
  }
  if (P.refused.length) {
    bits.push('<i>' + P.refused.length + ' event' + (P.refused.length === 1 ? '' : 's') +
              ' refused</i>: ' + CK.esc(P.refused.slice(0, 4).join('; ')) +
              (P.refused.length > 4 ? ', and ' + (P.refused.length - 4) + ' more' : '') +
              '. An unreadable date is never coerced, because an invented 1970 looks exactly like a ' +
              'real one.');
  }
  if (P.dupIds.length) {
    bits.push('<i>' + P.dupIds.length + ' duplicate event id' + (P.dupIds.length === 1 ? '' : 's') +
              '</i> (' + CK.esc(P.dupIds.slice(0, 4).join(', ')) + ') kept the first event.');
  }
  if (P.dropped) { bits.push('<i>' + P.dropped + ' events past the drawing budget</i> were left out.'); }

  var caption =
    'timeline &mdash; <b>' + n + '</b> ' + (n === 1 ? 'event' : 'events') +
    (stats.single ? '' : ', ' + CK.esc(txFmtTime(stats.lo, stats.step)) + ' to ' +
                          CK.esc(txFmtTime(stats.hi, stats.step))) + '. ' + bits.join(' ');

  return { aria: aria, caption: caption };
}

/** A series class when the events carry groups, and nothing when they do not. */
function txHue(P, group) {
  if (!group || !P.groups) { return ''; }
  var at = P.groups.indexOf(group);
  return at < 0 ? '' : ' ck-g' + ((at % 8) + 1);
}

/**
 * Everything the card draws, from the payload and one settings object.
 *
 * The same function in Node and in the browser, so the caption can never describe a drawing that is
 * not the drawing on the screen. The order of operations is the policy: collapse if asked, assign
 * sides, place each side's labels independently, then mark whatever ended up away from its dot.
 *
 * @param P    the payload from {@link readData}
 * @param conf a settings object, settled by {@link txConfig}
 * @returns `{ W, H, marks, note, place, stats }`
 *
 * @example txRender(P, { side: 'above' }).H;
 */
function txRender(P, conf) {
  var c = txConfig(conf);
  var M = txMetrics();
  var E = P.events, n = E.length, i, k;

  var stats = { lo: 0, hi: 0, step: 0, single: false, displaced: 0, droppedLabels: 0,
                collapsed: 0, collapsedInto: 0 };

  if (!n) {
    return {
      W: P.W0, H: 120, marks: [mText(P.W0 / 2, 62, 'no events', 'ck-empty', 'middle')],
      place: [], stats: stats, note: txNote(P, c, stats)
    };
  }

  var lo = E[0].at, hi = E[n - 1].at;
  stats.lo = lo; stats.hi = hi;

  /* The zero-span case, caught here rather than inside the scale. CK.scale already maps a
     zero-width domain onto the midpoint, so the dots would draw centred without this; what would
     not survive is the axis, whose tick generator has nothing to step through. Nothing is invented
     to give the span a width. */
  stats.single = !(hi > lo);
  var padMs = stats.single ? 0 : Math.max(1, Math.round((hi - lo) * 0.02));
  var dlo = lo - padMs, dhi = hi + padMs;

  var W = P.W0;
  var xs = CK.scale([dlo, dhi], [M.pad, W - M.pad]);

  var at = [];
  for (i = 0; i < n; i++) { at.push(xs(E[i].at)); }

  /* ── the marks on the axis ── */
  var items = c.collapse ? txCollapse(E, at, M.collapsePx)
                         : (function () {
                             var out = [], j;
                             for (j = 0; j < n; j++) { out.push({ at: E[j].at, x: at[j], members: [j] }); }
                             return out;
                           })();

  for (i = 0; i < items.length; i++) {
    if (items[i].members.length > 1) { stats.collapsed += items[i].members.length; stats.collapsedInto++; }
  }

  /* ── sides, and the stagger that keeps coincident events apart ── */
  var side = [], stack = [], lastAt = [null, null], run = [0, 0], sidx;
  for (i = 0; i < items.length; i++) {
    sidx = c.side === 'above' ? 0 : c.side === 'below' ? 1 : (i % 2);
    side.push(sidx === 0 ? -1 : 1);
    if (lastAt[sidx] === items[i].at) { run[sidx]++; } else { run[sidx] = 0; }
    lastAt[sidx] = items[i].at;
    stack.push(Math.min(run[sidx], M.stack));
  }

  var maxStack = [0, 0];
  for (i = 0; i < items.length; i++) {
    var si = side[i] < 0 ? 0 : 1;
    if (stack[i] > maxStack[si]) { maxStack[si] = stack[i]; }
  }

  /* ── the label rows, placed independently ── */
  var rows = [[], []];
  for (i = 0; i < items.length; i++) {
    var label = items[i].members.length > 1 ? items[i].members.length + ' events'
                                            : E[items[i].members[0]].label;
    var w = Math.min(M.labMax, tw(label, 9) + 8);
    items[i].label = label;
    items[i].w = w;
    rows[side[i] < 0 ? 0 : 1].push(i);
  }

  var place = [], drawLab = [];
  for (i = 0; i < items.length; i++) { place.push(0); drawLab.push(false); }

  if (c.labels) {
    for (k = 0; k < 2; k++) {
      var idxs = rows[k];
      if (!idxs.length) { continue; }
      var row = [];
      for (i = 0; i < idxs.length; i++) { row.push({ ideal: items[idxs[i]].x, w: items[idxs[i]].w }); }
      var fitted = txFit(row, W - M.pad * 2, M.gap);
      stats.droppedLabels += fitted.dropped.length;
      var pos = txPlace(row, fitted.live, M.pad, W - M.pad, M.gap);
      for (i = 0; i < fitted.live.length; i++) {
        var at2 = fitted.live[i];
        place[idxs[at2]] = pos[at2];
        drawLab[idxs[at2]] = true;
      }
    }
  }

  var displaced = [];
  for (i = 0; i < items.length; i++) {
    var off = drawLab[i] && Math.abs(place[i] + items[i].w / 2 - items[i].x) > items[i].w / 2;
    displaced.push(!!off);
    if (off) { stats.displaced++; }
  }

  /* ── the frame ── */
  var aboveH = maxStack[0] * M.stag + (c.labels && rows[0].length ? M.lead + M.labH : 0);
  var belowH = maxStack[1] * M.stag + (c.labels && rows[1].length ? M.lead + M.labH : 0);
  var axisY = M.pad + aboveH;
  var H = axisY + belowH + M.tickH + M.foot;
  var offAbove = M.lead + maxStack[0] * M.stag;
  var offBelow = M.lead + maxStack[1] * M.stag;

  var marks = [];

  /* ── the axis ── */
  var tk = { ticks: [lo], step: 0 };
  if (c.ticks) {
    var want = Math.max(2, Math.min(9, Math.floor((W - M.pad * 2) / 78)));
    tk = txTicks(dlo, dhi, want);
    for (i = 0; i < tk.ticks.length; i++) {
      var gx = xs(tk.ticks[i]);
      marks.push(mLine(gx, M.pad, gx, axisY + belowH, 'ck-rule'));
      marks.push(mText(gx, H - M.foot - 3, txFmtTime(tk.ticks[i], tk.step), 'ck-tk', 'middle'));
    }
  }
  stats.step = tk.step;
  marks.push(mLine(M.pad, axisY, W - M.pad, axisY, 'ck-axis'));

  /* ── the events ── */
  for (i = 0; i < items.length; i++) {
    var it = items[i], sd = side[i];
    var dy = axisY + sd * stack[i] * M.stag;
    var labY = axisY + sd * (sd < 0 ? offAbove : offBelow);
    var kids = [];
    var many = it.members.length > 1;
    var first = E[it.members[0]];

    var tip;
    if (many) {
      var names = [];
      for (k = 0; k < it.members.length && k < 8; k++) { names.push(E[it.members[k]].label); }
      if (it.members.length > 8) { names.push('and ' + (it.members.length - 8) + ' more'); }
      tip = it.members.length + ' events \u00b7 ' + txFmtFull(it.at) + ' \u00b7 ' + names.join('; ');
    } else {
      tip = first.label + ' \u00b7 ' + txFmtFull(first.at) +
            (first.group ? ' \u00b7 ' + first.group : '') +
            (first.note ? ' \u00b7 ' + first.note : '');
    }

    if (drawLab[i]) {
      var anchorX = place[i] + it.w / 2;
      kids.push(mLine(it.x, dy + sd * (M.dotR + 1), anchorX, labY,
                      'ck-lead' + (displaced[i] ? ' ck-lead-off' : '')));
      var baseY = sd < 0 ? labY - 4 : labY + M.labH - 4;
      kids.push(mText(anchorX, baseY, clipTo(it.label, it.w - 8), 'ck-elab', 'middle'));
    }

    if (many) {
      /* A collapsed run is a square, not a dot, so a reader can tell at a glance that the mark
         stands for several events rather than one. Shape rather than size: a bigger dot would read
         as a more important event. */
      kids.push(mRect(it.x - M.dotR, dy - M.dotR, M.dotR * 2, M.dotR * 2, 'ck-many'));
    } else {
      kids.push(mDot(it.x, dy, M.dotR, 'ck-dot' + txHue(P, first.group)));
    }

    var g = { t: 'g', a: { 'class': 'ck-ev', 'data-ev': String(i) }, kids: kids };
    g.ti = tip;
    marks.push(g);
  }

  return { W: W, H: H, marks: marks, place: place, items: items, side: side, drawLab: drawLab,
           displaced: displaced, ticks: tk, stats: stats, note: txNote(P, c, stats) };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, pad2, utcAt, txLadder, txRungMs, txTicks, txFmtTime, txFmtFull,
                 mLine, mText, mDot, mRect, txMetrics, txConfig, txCollapse, txFit, txPlace,
                 txNote, txHue, txRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>` AND that
 * cannot trip the emitted-code guard.
 *
 * `<` and `>` become escapes so an event name containing a closing script tag cannot end the block
 * early — which has the second, less obvious effect of making an arrow sequence impossible, since
 * its second character is one of the two. `?` is escaped for the same reason one step further on:
 * an event labelled "who knows?.check the log" would otherwise put an optional-chaining sequence
 * into a file the guard refuses to emit, and the card would fail to build because of somebody's
 * punctuation. The backtick and the two line separators round it out.
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
  const own = '.ck-timeline[data-card="' + id + '"]';
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
 *
 * A displaced label is marked by a DASHED leader and a collapsed run by a SQUARE rather than a dot,
 * so both distinctions survive a monochrome print and a colour-blind reader. Colour here carries
 * the grouping and nothing else.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-dot', 'fill: var(--accent); stroke: none;'],
    ['.ck-plot .ck-many', 'fill: var(--well); stroke: var(--accent); stroke-width: 1.2;'],
    ['.ck-plot .ck-lead', 'stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-plot .ck-lead-off', 'stroke: var(--accent); stroke-dasharray: 2 2;'],
    ['.ck-plot .ck-elab', 'fill: var(--ink); font-size: 9px;'],
    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],

    ['.ck-plot .ck-ev', 'transition: opacity .12s linear;'],
    ['.ck-plot:hover .ck-ev', 'opacity: .5;'],
    ['.ck-plot .ck-ev:hover', 'opacity: 1;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-plot .ck-g' + i, 'fill: var(--ck-s' + i + ');']);
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }

  /* The only animation is that fade and it carries no meaning, so it is safe to simply stop. */
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ev', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the timeline drawn, and the caption. */
function cardHtml(id, title, seed, cfg, legend) {
  const f = (name) => CK.esc(id) + '-' + name;
  const box = (name, label, on) =>
    '    <label for="' + f(name) + '">' + CK.esc(label) + '</label>\n' +
    '    <input id="' + f(name) + '" name="' + name + '" type="checkbox"' + (on ? ' checked' : '') + '>\n';
  const opt = (v, label) =>
    '<option value="' + CK.esc(v) + '"' + (v === cfg.side ? ' selected' : '') + '>' +
    CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-timeline">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="timeline settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('side') + '">labels</label>\n' +
    '    <select id="' + f('side') + '" name="side">' +
         opt('alternate', 'alternate above and below') +
         opt('above', 'all above the axis') +
         opt('below', 'all below the axis') + '</select>\n' +
    box('labels', 'show labels', cfg.labels) +
    box('collapse', 'collapse dense runs', cfg.collapse) +
    box('ticks', 'date gridlines', cfg.ticks) +
    '    <p class="ck-set-foot">alternating halves the label density for nothing but a zig-zag in ' +
         'the reading order. Labels are then pushed apart left to right, which cascades; a label ' +
         'that ends up clear of its own dot gets a dashed leader, and one that cannot fit anywhere ' +
         'is dropped from the densest stretch first. Collapsing dense runs is the only setting here ' +
         'that hides events rather than labels.</p>\n' +
    '  </div>\n' +
    '  ' + plot + legend + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
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
    '/* timeline card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The whole collision policy is redone here, so the count of displaced and dropped\n' +
    '   labels in the caption is always the count of what is actually on the axis. */\n' +
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
    '     stays a translator rather than a second place where placement decisions live. */\n' +
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
    '     a render that added marks would draw a second timeline on top of the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = txRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/timeline');
}

/**
 * Build one timeline card from one data block.
 *
 * ON THE CATEGORY, AT LENGTH, BECAUSE IT IS THE WEAKEST CLAIM IN THIS FILE. `evolution` asks "what
 * changed over time?", and a timeline shows WHEN THINGS HAPPENED, which is not quite the same
 * question: nothing here has a value, so nothing here changes. The vocabulary in `categories.mjs`
 * has no key for chronology, and the queue's own section heading for this pair of types is "Time —
 * *when?*", which is a question the ten categories do not offer. So this is a fit rather than a
 * match, and the honest report is that the category system has a gap rather than that the card has
 * a home.
 *
 * Every alternative is worse and it is worth saying why. `live-and-ambient` is about now, and a
 * timeline is about then. `work-and-lists` is about what is outstanding, and a timeline's events
 * have already happened. `flow-and-relationship` needs the events to connect to each other, and on
 * a timeline they are related only by sharing an axis. `ranking-and-comparison` would make the
 * card about which event is biggest, which it never is. That leaves `evolution`, which at least
 * gets the axis right and is where the D3 galleries put this shape.
 *
 * IF ONE CATEGORY WERE ADDED, this card should move. `chronology` — "when did things happen, and in
 * what order?" — would take `timeline`, and would leave `bump`, `slope` and `stackedarea` where
 * they are, because those really are about a value changing. That is a change to `categories.mjs`,
 * which this file does not own, so it is a recommendation rather than a commit.
 *
 * THE LABEL POLICY IS THE CARD. See the module DocBlock for the three moves and what each costs;
 * the short version is that alternation is free, the greedy push cascades and is marked when it
 * does, dropping happens from the densest stretch and never drops an event, and collapsing is the
 * only setting that hides data and is therefore off.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              an empty axis, captioned as such; nothing is invented
 *   one event            the span is zero, so `CK.scale` centres it and the axis carries a single
 *                        mark naming the instant rather than a scale of nothing
 *   all at one instant   the same, with the dots staggered off the line so N events do not read
 *                        as one
 *   two at one instant   both drawn, on opposite sides under the alternating default; neither is
 *                        treated as a duplicate, because sharing an instant is a real thing
 *   duplicate ids        the first event wins, the repeats are dropped and counted
 *   unparseable date     refused, counted and named; never coerced
 *   ten seconds          ticks every second or two, from the same ladder
 *   ten thousand years   ticks every thousand or twenty-five hundred years, from the same ladder;
 *                        the year is set on a real Date rather than passed to Date.UTC, which maps
 *                        years 0 to 99 into the twentieth century
 *   before 1970          negative epoch milliseconds throughout; the year floor uses Math.floor so
 *                        it rounds the right way for negative years
 *   200 events           the dots all draw; most labels are dropped from the densest stretches and
 *                        the caption says how many
 *   a 300-character      clipped to the room it has, with the whole of it in the tooltip; labels
 *   label                are single-line on purpose, because wrapping would make the collision
 *                        problem two-dimensional and this card solves the one-dimensional one
 *                        exactly
 *   injected markup      escaped on the way into the caption and the tooltips, and escaped again on
 *                        the way into the emitted script literal
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ events, title }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'incident',
 *   title: 'the outage',
 *   data: { events: [{ id: 'a', at: '2024-03-01T09:00:00Z', label: 'alert' },
 *                    { id: 'b', at: '2024-03-01T09:04:00Z', label: 'paged' },
 *                    { id: 'c', at: '2024-03-01T10:12:00Z', label: 'resolved' }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'timeline' : id);
  const P = readData(data);

  /* Group colours are assigned in first-appearance order, which is the order the author wrote and
     therefore the only order that is not this card having an opinion about the chronology. */
  const groups = [];
  for (const e of P.events) if (e.group && !groups.includes(e.group)) groups.push(e.group);
  P.groups = groups;

  const cfg = { ...defaults };
  const seed = txRender(P, cfg);

  const legend = groups.length > 1
    ? '\n  <div class="ck-legend">' +
      groups.map((g, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g) + '</span>').join('') +
      '</div>'
    : '';

  /* The payload the browser re-renders from carries the data and the budgets and no geometry, so
     the two runtimes cannot disagree about anything except the config. */
  const payload = {
    events: P.events, groups,
    title: P.title,
    refused: P.refused, dupIds: P.dupIds, dropped: P.dropped, coincident: P.coincident,
    W0, WMAX,
  };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      events: P.events.length,
      from: P.events.length ? P.events[0].at : null,
      to: P.events.length ? P.events[P.events.length - 1].at : null,
      zeroSpan: seed.stats.single,
      labelsDropped: seed.stats.droppedLabels,
      labelsDisplaced: seed.stats.displaced,
      coincident: P.coincident,
      refusedEvents: P.refused.length,
      duplicateIds: P.dupIds.length,
      settings: { ...cfg },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, cfg, legend),
    css:  cardCss(cardId),
    js:   cardJs(cardId, payload, cfg),
  };
}

/* Exported for the type's own verification, which executes the geometry rather than only reading
   it: a static check can prove the script parses and cannot prove that a dropped label left its
   event on the axis. */
export const _internals = { readData, readTime, clean, txRender, txConfig, txTicks, txFmtTime,
                            txFmtFull, txFit, txPlace, txCollapse, txMetrics, utcAt, jsLit,
                            SHIPPED };

export default { meta, build };
