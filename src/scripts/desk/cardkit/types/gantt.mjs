/**
 * `gantt` — a schedule of intervals: tasks as bars against a shared time axis, packed into lanes,
 * with the dependency network's critical path called out.
 *
 * THREE THINGS THIS CARD IS OPINIONATED ABOUT, because each of them is a way a Gantt is quietly
 * wrong rather than loudly broken.
 *
 * 1. WIDTH IS ELAPSED TIME, NEVER A DAY COUNT. Every horizontal position is `CK.scale` applied to
 *    an epoch millisecond, so a bar's width is exactly `x(end) - x(start)` and therefore exactly
 *    the elapsed milliseconds between them. A task running from local midnight to local midnight
 *    across a spring-forward boundary has 23 hours in it, not 24, and this card draws 23 hours.
 *    The alternative — counting calendar days and multiplying by pixels-per-day — disagrees with
 *    the axis by an hour twice a year, which shows up as a bar whose right edge does not land on
 *    the tick its end date belongs to. Consistency between "where the bar ends" and "where the
 *    axis says that instant is" is the invariant worth keeping, and only elapsed time keeps it.
 *    The cost, stated rather than hidden: two tasks both described as three days draw at slightly
 *    different widths when one of them spans a clock change. That is true, and the caption says so
 *    when it detects a duration an hour off a whole day.
 *
 * 2. LANE PACKING IS OPTIMAL, NOT MERELY ADEQUATE. Tasks are sorted by start and each takes the
 *    first lane free at its start ({@link gxPack}). Every lane it skips was blocked by a task that
 *    started no later and is still running, so those blockers all contain the incoming task's start
 *    instant — they are a clique. The k-th lane is therefore only ever opened by k mutually
 *    overlapping tasks, so the lane count equals the clique number, which is the true lower bound;
 *    and because interval graphs are perfect the chromatic number equals the clique number, so no
 *    algorithm can do better. {@link gxDepth} computes the maximum overlap independently and the
 *    card's own verification asserts the two agree.
 *
 *    Milestones are the one asterisk. A zero-duration task is a point, and under half-open interval
 *    semantics two points at one instant do not overlap — so they would share a lane and be drawn
 *    as one diamond on top of another. They are therefore packed as CLOSED points, which can open
 *    one lane more than the bars alone require. That extra lane is a fact about the drawing, not
 *    about the schedule, and the caption says when it happened.
 *
 * 3. CRITICALITY IS READ OFF THE DATES, NEVER OFF THE DURATIONS. This card is HANDED a schedule;
 *    it does not compute one. So the question "which tasks move the finish date if they slip" is
 *    answered by a backward pass over the dependency DAG against the dates as drawn
 *    ({@link gxSchedule}): latest finish is the smallest latest start among a task's successors, or
 *    the project finish for a task with none, and SLACK is that latest finish minus the end the
 *    dates give. A task is critical exactly when its slack is zero — membership is DERIVED from the
 *    slack rather than tracked beside it, so the highlight and the number cannot come to disagree.
 *
 *    This replaced a longest-chain-of-durations computation, which was the card's worst bug: on
 *    `A` 1–4 Jan followed by `B` 11–14 Jan it called both tasks critical and reported six days
 *    for a schedule it had just drawn thirteen days wide, while `A` sat on a week of float that
 *    nothing in the picture revealed. Durations know how long the work takes; only the dates know
 *    where the work was put.
 *
 *    A CYCLE STILL MEANS THERE IS NO CRITICAL PATH. The backward pass needs a topological order
 *    ({@link gxSchedule}, by Kahn) and a dependency cycle has none, so slack does not exist. This
 *    card does not break the cycle by dropping an edge and then report a number: it finds the cycle
 *    ({@link gxCycle}, a depth-first back edge), names the tasks in it, draws no critical path, and
 *    says in the caption that the dependencies are cyclic. A self-dependency is treated separately
 *    and refused as an edge, because a task preceding itself carries no ordering information at all
 *    and is always a typo, where a two-cycle is a real claim about ordering that cannot be met.
 *
 *    THE OTHER DIRECTION IS REPORTED TOO. {@link gxViolations} has always named a successor that
 *    starts before its predecessor ends. {@link gxGaps} now names the opposite — a successor that
 *    starts well after — because air between linked tasks is not an error the way a violation is,
 *    but it is where every day of slack in the plan comes from, and a card that reported only one
 *    direction left a week of empty calendar unremarked.
 *
 * Everything geometric is computed by {@link gxRender}, the same function in Node and in the
 * browser: Node runs it once for the picture inside `card.html`, and the browser re-runs it when
 * the reader changes a setting. `CK` comes out of `kit.js` in a `node:vm` context, so the helpers
 * here are the ones the page has.
 *
 * @see ./timeline.mjs — the same time axis carrying instants rather than intervals
 * @see ./protocol.mjs — the closest neighbour in shape: intervals against a shared axis, turned
 *                       ninety degrees and ordered by sequence rather than by clock
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
 * @example loadKit().esc('a<b');   // 'a&lt;b'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/gantt: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/gantt: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const WMAX = 2200;

/* Caps on the PAYLOAD, not on the arithmetic: the caption's counts come from the complete input
   before anything is dropped, and every drop is itself reported. */
const TASKCAP = 400;
const DEPCAP  = 1200;

/* The arrow budget is deliberately NOT here. It is read by `gxRender`, which is shipped to the
   browser through Function.prototype.toString(), and a shipped function closing over a
   module-level constant runs in Node and throws in the browser. It lives in `gxMetrics` instead. */

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `pack` defaults on because the packed form is the one that fits a desk column and because the
 * lane count is itself information — it is the maximum concurrency the plan ever asks for. Turning
 * it off gives one row per task with the labels in a left gutter, which is the form to reach for
 * when the names matter more than the shape.
 */
export const defaults = {
  pack:     true,
  critical: true,
  deps:     true,
  today:    true,
};

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `work-and-lists` — "what is outstanding, and what can I do about it?" — rather than `evolution`.
 * A Gantt is a plan of work not yet done, and its two most useful readings are both answers to the
 * second half of that question: which tasks can start now, and which ones move the end date if
 * they slip. `evolution` asks what changed over time, and a schedule records nothing that changed;
 * it records what is meant to.
 */
export const meta = {
  name: 'gantt',
  summary:
    'A schedule of tasks as bars on a time axis, packed into the fewest lanes possible, with the ' +
    'dependency network critical path called out.',
  shape:
    '{ tasks: [{ id, label, start, end, group, pct, deps: [id] }], today, title } — ' +
    'start and end are ISO strings, epoch milliseconds or Dates; end equal to start is a milestone',
  category: 'work-and-lists',
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
  const where = who || 'cardkit/gantt';
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
 * @example clean('a' + String.fromCharCode(0) + 'b');   // 'ab'
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
 * anything it does not recognise is `NaN`, and either one would put a task at the start of 1970 or
 * make its bar vanish. A schedule with an invented date in it is worse than a schedule with a
 * stated hole.
 *
 * @example readTime('2024-03-01T00:00:00Z');   // 1709251200000
 * @example readTime('next tuesday');           // null
 */
function readTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

/**
 * Normalise whatever arrived into the task list and the dependency network the renderer may assume.
 *
 * Nothing throws and nothing is coerced. A card is handed data by a desk and must still draw, so
 * every malformed input becomes a refusal that is counted and named in the caption:
 *
 *   - a task with no usable start or end is refused entirely;
 *   - a task whose end PRECEDES its start is refused, never repaired by swapping the ends, because
 *     the swap would turn a data bug into a plausible-looking bar and nobody would ever find it;
 *   - a duplicate id keeps its first task and the repeats are dropped and counted;
 *   - a dependency naming a task that does not exist is refused as an edge, counted and named;
 *   - a self-dependency is refused as an edge and counted separately, because a task preceding
 *     itself states no ordering at all — unlike a two-cycle, which states one that cannot be met;
 *   - a `pct` outside 0 to 100, or not a finite number, is refused and the bar carries no progress
 *     fill rather than a clamped one.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns the payload {@link gxRender} takes, plus the counts the caption reports
 *
 * @example
 * readData({ tasks: [{ id: 'a', start: 0, end: 10 }] }).tasks[0].e;   // 10
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawTasks = Array.isArray(d.tasks) ? d.tasks : [];

  const refused = [];
  const dupIds = [];
  const badEdges = [];
  let selfDeps = 0;
  let badPct = 0;
  let droppedTasks = 0;
  let droppedDeps = 0;

  const index = new Map();
  const tasks = [];
  const rawDeps = [];

  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i];
    if (!t || typeof t !== 'object') { refused.push('task ' + (i + 1) + ' is not an object'); continue; }

    const id = clean(t.id == null ? '' : t.id).trim();
    const label = clean(t.label == null || t.label === '' ? id : t.label);
    const who = label || id || ('task ' + (i + 1));

    if (!id) { refused.push('a task (' + who + ') was given no id'); continue; }
    if (index.has(id)) { dupIds.push(id); continue; }

    const s = readTime(t.start);
    const e = t.end === undefined || t.end === null || t.end === '' ? s : readTime(t.end);
    if (s === null) { refused.push(who + ' has no readable start'); continue; }
    if (e === null) { refused.push(who + ' has a start but no readable end'); continue; }
    if (e < s) {
      /* Never swapped. A reversed interval is a bug in whatever produced the data, and a card that
         silently corrects it hides the bug behind a bar that looks fine. */
      refused.push(who + ' ends before it starts');
      continue;
    }
    if (tasks.length >= TASKCAP) { droppedTasks++; continue; }

    let pct = null;
    if (t.pct !== undefined && t.pct !== null && t.pct !== '') {
      if (typeof t.pct === 'number' && Number.isFinite(t.pct) && t.pct >= 0 && t.pct <= 100) pct = t.pct;
      else badPct++;
    }

    index.set(id, tasks.length);
    tasks.push({
      id, label: label || id,
      s, e,
      group: t.group == null || t.group === '' ? '' : clean(t.group),
      pct,
      milestone: e === s,
    });
    rawDeps.push(Array.isArray(t.deps) ? t.deps : []);
  }

  /* ── the network ── */
  const pred = tasks.map(() => []);
  const succ = tasks.map(() => []);
  const seen = new Set();
  let edges = 0;

  for (let i = 0; i < rawDeps.length; i++) {
    for (const raw of rawDeps[i]) {
      const from = clean(raw == null ? '' : raw).trim();
      if (!from) { badEdges.push(tasks[i].label + ' depends on nothing in particular'); continue; }
      if (from === tasks[i].id) { selfDeps++; continue; }
      if (!index.has(from)) {
        badEdges.push(tasks[i].label + ' depends on ' + JSON.stringify(from) + ', which is not a task');
        continue;
      }
      const j = index.get(from);
      const key = j + '>' + i;
      if (seen.has(key)) continue;
      if (edges >= DEPCAP) { droppedDeps++; continue; }
      seen.add(key);
      pred[i].push(j);
      succ[j].push(i);
      edges++;
    }
  }

  return {
    tasks, pred, succ,
    today: readTime(d.today),
    title: clean(d.title == null ? '' : d.title),
    refused, dupIds, badEdges, selfDeps, badPct, droppedTasks, droppedDeps, edges,
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
 * simply is not there, with nothing in the console.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/gantt: non-finite coordinate (' + v + ')');
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
 * lands in 1944 and an axis of antiquity silently becomes an axis of the twentieth century. Setting
 * the year afterwards on a real Date has no such rule. The seed year is 2000 rather than 1970 so
 * the seed is never itself in the trapped range.
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
 * years, so ten seconds of deploy log and ten thousand years of geology both get sane gridlines
 * from the same code.
 *
 * @example gxLadder()[0].ms;   // 1000
 */
function gxLadder() {
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
function gxRungMs(r) {
  if (r.ms) { return r.ms; }
  if (r.mo) { return r.mo * 2629746000; }
  return r.y * 31556952000;
}

/**
 * Gridline positions for a time axis, on a step a calendar actually has.
 *
 * A zero-width span is a legitimate axis — one task, or every task at one instant — and returns a
 * single tick rather than dividing by zero. Week steps are anchored on the Monday nearest the
 * epoch rather than on the epoch itself, which was a Thursday.
 *
 * @param lo   the domain start, epoch milliseconds
 * @param hi   the domain end
 * @param want roughly how many ticks are wanted
 * @returns `{ ticks, step }` where `step` is an approximate millisecond size, used only to pick
 *          the label format
 *
 * @example gxTicks(0, 5000, 5).ticks.length;   // 6
 */
function gxTicks(lo, hi, want) {
  if (!(hi > lo)) { return { ticks: [lo], step: 86400000 }; }
  var span = hi - lo, n = Math.max(1, want || 5), rungs = gxLadder(), i, pick = null;

  for (i = 0; i < rungs.length; i++) {
    if (span / gxRungMs(rungs[i]) <= n) { pick = rungs[i]; break; }
  }
  if (!pick) { pick = rungs[rungs.length - 1]; }

  var out = [], v, guard = 0;

  if (pick.ms) {
    /* Day-and-larger millisecond steps land on UTC midnights because the epoch is one; the two
       week steps are shifted by four days so they land on Mondays instead of Thursdays. */
    var anchor = pick.ms % 604800000 === 0 ? 345600000 : 0;
    v = Math.ceil((lo - anchor) / pick.ms) * pick.ms + anchor;
    while (v <= hi && guard++ < 4000) { out.push(v); v += pick.ms; }
    return { ticks: out, step: pick.ms };
  }

  var d0 = new Date(lo), y0 = d0.getUTCFullYear();

  if (pick.mo) {
    var mi = y0 * 12 + d0.getUTCMonth();
    mi = Math.floor(mi / pick.mo) * pick.mo;
    while (guard++ < 4000) {
      var yy = Math.floor(mi / 12), mm = mi - yy * 12;
      v = utcAt(yy, mm, 1);
      if (v > hi) { break; }
      if (v >= lo) { out.push(v); }
      mi += pick.mo;
    }
    return { ticks: out, step: pick.mo * 2629746000 };
  }

  var y = Math.floor(y0 / pick.y) * pick.y;
  while (guard++ < 4000) {
    v = utcAt(y, 0, 1);
    if (v > hi) { break; }
    if (v >= lo) { out.push(v); }
    y += pick.y;
  }
  return { ticks: out, step: pick.y * 31556952000 };
}

/**
 * A tick label in the units the step is actually in.
 *
 * UTC getters throughout: a date written as a plain day parses to UTC midnight, so reading it back
 * in the viewer's zone can print the day before, and an axis that disagrees with the strings it was
 * handed is worse than a coarse one. Years before the common era come back negative, which is
 * ugly and unambiguous, and those are the right two properties for an axis label.
 *
 * @example gxFmtTime(0, 86400000);   // '01-01'
 */
function gxFmtTime(ms, step) {
  var d = new Date(ms);
  if (step < 60000) {
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }
  if (step < 86400000) { return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()); }
  if (step < 2419200000) { return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  if (step < 25920000000) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  return String(d.getUTCFullYear());
}

/**
 * A full instant, for a tooltip, where there is room to be unambiguous.
 *
 * @example gxFmtFull(0);   // '1970-01-01 00:00 UTC'
 */
function gxFmtFull(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' +
         pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
}

/**
 * A duration in words, from ELAPSED milliseconds rather than from a calendar difference.
 *
 * A day here is twenty-four hours of elapsed time, not a calendar day, and the two differ by an
 * hour across a clock change. That is the same choice the bar widths make, and making it twice the
 * same way is the point: a tooltip that said three days beside a bar drawn seventy-one hours wide
 * would be the card disagreeing with itself.
 *
 * @example gxDur(0);          // 'milestone'
 * @example gxDur(82800000);   // '23 h'
 */
function gxDur(ms) {
  if (ms === 0) { return 'milestone'; }
  var h = ms / 3600000;
  if (h < 1) { return Math.round(ms / 60000) + ' min'; }
  if (h < 48) { return (Math.round(h * 10) / 10) + ' h'; }
  return (Math.round(h / 2.4) / 10) + ' d';
}

/**
 * An AMOUNT of time in words: a slack, a gap, or the span a chain occupies.
 *
 * Separate from {@link gxDur} because that one answers "how long is this task" and therefore reads
 * zero as the word `milestone`, which is exactly right there and nonsense everywhere else — a task
 * with no slack is not a milestone. Zero is `an instant` here, which is what a chain of one
 * milestone genuinely occupies on the axis. Negative amounts are possible: a schedule that violates
 * its own dependencies pushes slack below zero, and saying so is better than clamping it away.
 *
 * @param ms an elapsed quantity in milliseconds, of either sign
 *
 * @example gxAmt(0);           // 'an instant'
 * @example gxAmt(604800000);   // '7 d'
 * @example gxAmt(-3600000);    // 'minus 1 h'
 */
function gxAmt(ms) {
  if (ms === 0) { return 'an instant'; }
  var neg = ms < 0, v = neg ? -ms : ms, h = v / 3600000, out;
  if (h < 1) { out = Math.round(v / 60000) + ' min'; }
  else if (h < 48) { out = (Math.round(h * 10) / 10) + ' h'; }
  else { out = (Math.round(h / 2.4) / 10) + ' d'; }
  return neg ? 'minus ' + out : out;
}

/* Display-list primitives. Every mark is { t: tagName, a: attributes, s: text, ti: tooltip,
   kids: [] }, with real SVG attribute names, so the browser-side translator knows nothing about
   schedules and a mark in a debugger reads as the element it becomes. */

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
 * A milestone, as a diamond rather than as a rectangle of zero width.
 *
 * A zero-duration task drawn as a rect is a rect of width zero, which paints nothing at all and
 * leaves a row that looks empty next to a caption that counts a task in it. The diamond is the
 * conventional mark and, more usefully here, it is a mark whose size does not come from the data,
 * so it cannot vanish however short the schedule is.
 *
 * @example mDiamond(10, 10, 4, 'ck-ms').a.d.charAt(0);   // 'M'
 */
function mDiamond(cx, cy, r, cls) {
  return mPath('M' + fin(cx) + ' ' + fin(cy - r) + ' L' + fin(cx + r) + ' ' + fin(cy) +
               ' L' + fin(cx) + ' ' + fin(cy + r) + ' L' + fin(cx - r) + ' ' + fin(cy) + ' Z', cls);
}

/**
 * Settle a settings object into the four values the renderer may assume.
 *
 * Called with nothing it must return exactly the declared defaults; the verification asserts that,
 * so the shipped copy and the declared metadata cannot drift apart without something failing.
 *
 * @example gxConfig({ pack: false }).critical;   // true
 */
function gxConfig(conf) {
  var c = conf && typeof conf === 'object' ? conf : {};
  return {
    pack:     c.pack === undefined || c.pack === null ? true : !!c.pack,
    critical: c.critical === undefined || c.critical === null ? true : !!c.critical,
    deps:     c.deps === undefined || c.deps === null ? true : !!c.deps,
    today:    c.today === undefined || c.today === null ? true : !!c.today
  };
}

/**
 * Greedy interval-graph colouring: the fewest lanes a schedule can be drawn in.
 *
 * Tasks are sorted by start and each takes the first lane that is free at its start. This is not a
 * heuristic that usually does well. Every lane the incoming task skips was blocked by a task that
 * started no later and has not finished, so all of those blockers contain the incoming task's start
 * instant and are therefore mutually overlapping — a clique. Opening lane k requires k such tasks,
 * so the lane count equals the clique number, which is the lower bound any drawing must respect;
 * and interval graphs are perfect, so the chromatic number equals the clique number and nothing can
 * do better. {@link gxDepth} computes the same number by sweeping, and the two must agree.
 *
 * Intervals are HALF-OPEN, so a task starting exactly where another ends shares its lane rather
 * than opening a new one — back-to-back work is one lane, which is what a reader expects. The
 * exception is a zero-duration task: as a half-open interval it is empty, so two milestones at one
 * instant would not conflict and would be drawn as one diamond on top of another. A milestone is
 * therefore packed as a CLOSED point, which can open one lane beyond what the bars alone need.
 *
 * @param tasks tasks carrying `s` and `e` in epoch milliseconds
 * @returns `{ lane, lanes, order }` — a lane per task by original index, the lane count, and the
 *          indices in placement order
 *
 * @example
 * gxPack([{ s: 0, e: 5 }, { s: 2, e: 7 }, { s: 5, e: 9 }]).lanes;   // 2
 */
function gxPack(tasks) {
  var n = tasks.length, order = [], i, j;
  for (i = 0; i < n; i++) { order.push(i); }
  order.sort(function (a, b) {
    return tasks[a].s - tasks[b].s || tasks[a].e - tasks[b].e || a - b;
  });

  var laneEnd = [], lanePoint = [], lane = [], put, t, isPoint;
  for (i = 0; i < n; i++) { lane.push(0); }

  for (j = 0; j < order.length; j++) {
    t = tasks[order[j]];
    isPoint = t.e === t.s;
    put = -1;
    for (i = 0; i < laneEnd.length; i++) {
      if (laneEnd[i] < t.s || (laneEnd[i] === t.s && !lanePoint[i] && !isPoint)) { put = i; break; }
    }
    if (put < 0) { put = laneEnd.length; laneEnd.push(t.s); lanePoint.push(false); }
    laneEnd[put] = t.e;
    lanePoint[put] = isPoint;
    lane[order[j]] = put;
  }

  return { lane: lane, lanes: laneEnd.length, order: order };
}

/**
 * The maximum number of tasks running at once, by sweeping the endpoints.
 *
 * Only tasks with real duration are counted, and the intervals are half-open, so an end and a start
 * at the same instant do not stack: the sort puts every close before every open at a shared time.
 * This is the clique number of the interval graph and therefore the lower bound on lanes, computed
 * a completely different way from {@link gxPack} so that the two agreeing means something.
 *
 * @example gxDepth([{ s: 0, e: 5 }, { s: 5, e: 9 }]);   // 1
 */
function gxDepth(tasks) {
  var ev = [], i, at = 0, best = 0;
  for (i = 0; i < tasks.length; i++) {
    if (tasks[i].e > tasks[i].s) {
      ev.push({ t: tasks[i].s, k: 1 });
      ev.push({ t: tasks[i].e, k: -1 });
    }
  }
  ev.sort(function (a, b) { return a.t - b.t || a.k - b.k; });
  for (i = 0; i < ev.length; i++) {
    at += ev[i].k;
    if (at > best) { best = at; }
  }
  return best;
}

/**
 * The tasks on the first dependency cycle, or an empty list when the network is acyclic.
 *
 * A depth-first walk colouring nodes white, grey and black; an edge into a grey node is a back edge
 * and the grey stack from that node onward is the cycle. Naming the tasks is the whole point — a
 * card that said only "cyclic" would leave the reader to find the loop by hand in a network the
 * card has already traversed.
 *
 * @param succ successor lists by task index
 * @returns task indices in cycle order, first repeated node omitted from the end
 *
 * @example gxCycle([{}, {}], [[1], [0]]).length;   // 2
 */
function gxCycle(tasks, succ) {
  var n = tasks.length, colour = [], stack = [], found = [], i;
  for (i = 0; i < n; i++) { colour.push(0); }

  function visit(u) {
    var j, v, at;
    colour[u] = 1;
    stack.push(u);
    for (j = 0; j < succ[u].length; j++) {
      v = succ[u][j];
      if (colour[v] === 1) {
        at = stack.indexOf(v);
        found = at >= 0 ? stack.slice(at) : [v];
        return true;
      }
      if (colour[v] === 0 && visit(v)) { return true; }
    }
    colour[u] = 2;
    stack.pop();
    return false;
  }

  for (i = 0; i < n; i++) {
    if (colour[i] === 0 && visit(i)) { return found; }
  }
  return [];
}

/**
 * Slack against the DRAWN DATES, and the criticality that is read off it.
 *
 * THIS IS A BACKWARD PASS ONLY, and that is the whole point. A `pert` card is handed durations and
 * must compute a schedule, so it needs a forward pass to find where each task goes. This card is
 * handed the dates; where each task goes is already decided, and inventing a second opinion about
 * it would be the card arguing with its own drawing. So only the backward pass runs:
 *
 *     LF(t) = the project finish, when t has no successors
 *           = min over successors s of LS(s), otherwise
 *     LS(t) = LF(t) - (end(t) - start(t))
 *     slack(t) = LF(t) - end(t)          which is the same number as LS(t) - start(t)
 *     critical  iff  slack(t) is zero
 *
 * LS RATHER THAN start, IN THE RECURRENCE, and this is the one line worth arguing about. Taking
 * `min over successors of start(s)` gives FREE float — how long a task can slip before anything
 * else has to move — and free float is the wrong quantity to hang criticality on, because a task
 * butted up against a successor that itself has a week of float has zero free float and is not
 * remotely critical. On `A` 1–2, `B` 2–3, `C` 12–13 in a chain, free float calls `A` and `B`
 * critical when both can slip eleven days without touching the finish date. `LS` gives TOTAL float,
 * which is the quantity whose zero means "this moves the finish date", which is the sentence the
 * caption has always made. It is also what `pert` derives criticality from, and the two cards
 * agreeing on one network is a property this catalogue checks.
 *
 * THE CHAIN. The critical set is a set, not a path — parallel branches can all have zero slack —
 * so `path` is the LONGEST chain of zero-slack tasks joined by TIGHT edges, an edge where the
 * successor starts exactly where the predecessor ends. Every task in the set is highlighted; the
 * chain is what gets named. Because a tight chain has no air in it, the elapsed time it occupies
 * (`end(last) - start(first)`) is identical to the sum of its durations — which is why `length` can
 * be quoted as elapsed time on the axis without ceasing to be a total of work.
 *
 * When the topological order comes up short the network has a cycle, so LF has no base case and
 * none of this exists. Returns `cyclic` rather than breaking an edge: dropping one to get a number
 * would produce a confident answer to a question the data does not pose.
 *
 * A tolerance is applied once, here, relative to the schedule's span, because dates may be
 * fractional milliseconds and a slack that is mathematically zero can arrive a few ulps off it.
 * Every later question about criticality then asks the same question.
 *
 * @param tasks tasks carrying `s` and `e` in epoch milliseconds
 * @param pred  predecessor lists by task index
 * @param succ  successor lists by task index
 * @returns `{ ok, cyclic, slack, free, crit, path, length, criticals, maxSlack, behind, finish,
 *          begin, eps }` — `path` is task indices from first to last
 *
 * @example
 * // B follows A after a week of air: only B is critical, A has seven days of slack.
 * var r = gxSchedule([{ s: 0, e: 3 }, { s: 10, e: 13 }], [[], [0]], [[1], []]);
 * r.crit[0];   // false
 * r.length;    // 3
 */
function gxSchedule(tasks, pred, succ) {
  var n = tasks.length, indeg = [], queue = [], order = [], i, j, u, v, head = 0;
  var out = { ok: false, cyclic: false, slack: [], free: [], crit: [], path: [], length: 0,
              criticals: 0, maxSlack: 0, behind: 0, finish: 0, begin: 0, eps: 0 };

  for (i = 0; i < n; i++) { indeg.push(pred[i].length); }
  for (i = 0; i < n; i++) { if (indeg[i] === 0) { queue.push(i); } }
  while (head < queue.length) {
    u = queue[head++];
    order.push(u);
    for (j = 0; j < succ[u].length; j++) {
      v = succ[u][j];
      indeg[v]--;
      if (indeg[v] === 0) { queue.push(v); }
    }
  }
  if (order.length < n) { out.cyclic = true; return out; }
  out.ok = true;
  if (!n) { return out; }

  var finish = tasks[0].e, begin = tasks[0].s;
  for (i = 1; i < n; i++) {
    if (tasks[i].e > finish) { finish = tasks[i].e; }
    if (tasks[i].s < begin) { begin = tasks[i].s; }
  }
  var eps = finish > begin ? (finish - begin) * 1e-9 : 0;
  out.finish = finish; out.begin = begin; out.eps = eps;

  var ls = [], slack = [], free = [], crit = [], f, m, have;
  for (i = 0; i < n; i++) { ls.push(0); slack.push(0); free.push(0); crit.push(false); }

  for (i = order.length - 1; i >= 0; i--) {
    u = order[i];
    f = finish;
    for (j = 0; j < succ[u].length; j++) { if (ls[succ[u][j]] < f) { f = ls[succ[u][j]]; } }
    ls[u] = f - (tasks[u].e - tasks[u].s);
    slack[u] = f - tasks[u].e;
    if (slack[u] < 0 && slack[u] > -eps) { slack[u] = 0; }
    crit[u] = slack[u] <= eps;

    /* Free float alongside, for the tooltips. A sentinel of -1 would be a bug here rather than in
       a card that schedules from zero: a start is an epoch millisecond and dates before 1970 are
       negative, so the presence of a successor is tracked with a flag instead of with a value. */
    m = 0; have = false;
    for (j = 0; j < succ[u].length; j++) {
      v = succ[u][j];
      if (!have || tasks[v].s < m) { m = tasks[v].s; have = true; }
    }
    free[u] = (have ? m : finish) - tasks[u].e;
    if (free[u] < 0 && free[u] > -eps) { free[u] = 0; }
  }

  var criticals = 0, maxSlack = 0, behind = 0;
  for (i = 0; i < n; i++) {
    if (crit[i]) { criticals++; }
    if (slack[i] > maxSlack) { maxSlack = slack[i]; }
    if (slack[i] < -eps) { behind++; }
  }
  out.slack = slack; out.free = free; out.crit = crit;
  out.criticals = criticals; out.maxSlack = maxSlack; out.behind = behind;

  /* The longest tight zero-slack chain. The cnt array is the number of tasks on the best chain
     ending at each node and exists only to break ties: two chains occupying equal time are equally
     critical, but the one with more tasks on it is the one a reader wants named — a plan ending in a
     zero-duration ship milestone occupies the same time with or without the milestone, and a chain
     that stopped one node short of the finish would read as though the finish were not on it.
     No backtick anywhere in here, and this comment is why the rule exists: this function is
     shipped through Function.prototype.toString(), so its comments travel with it into the desk's
     one inline script block, where a stray backtick closes the block and blanks every card. */
  var best = [], cnt = [], from = [], bf, p, top = -1;
  for (i = 0; i < n; i++) { best.push(0); cnt.push(0); from.push(-1); }

  for (i = 0; i < order.length; i++) {
    u = order[i];
    if (!crit[u]) { continue; }
    bf = -1;
    for (j = 0; j < pred[u].length; j++) {
      p = pred[u][j];
      if (!crit[p]) { continue; }
      if (!gxTight(tasks, p, u, eps)) { continue; }
      if (bf < 0 || best[p] > best[bf] || (best[p] === best[bf] && cnt[p] > cnt[bf])) { bf = p; }
    }
    best[u] = (bf >= 0 ? best[bf] : 0) + (tasks[u].e - tasks[u].s);
    cnt[u] = (bf >= 0 ? cnt[bf] : 0) + 1;
    from[u] = bf;
    if (top < 0 || best[u] > best[top] || (best[u] === best[top] && cnt[u] > cnt[top])) { top = u; }
  }
  if (top < 0) { return out; }

  var path = [], at = top, guard = 0;
  while (at >= 0 && guard++ <= n) { path.push(at); at = from[at]; }
  path.reverse();
  out.path = path;
  out.length = tasks[path[path.length - 1]].e - tasks[path[0]].s;
  return out;
}

/**
 * Whether a dependency edge is TIGHT: the successor starts exactly where the predecessor ends.
 *
 * The one predicate three things ask, so they cannot come to different answers: which edges the
 * critical chain may walk, which arrows are drawn solid, and which edges are neither a gap nor a
 * violation.
 *
 * @example gxTight([{ s: 0, e: 5 }, { s: 5, e: 9 }], 0, 1, 0);   // true
 */
function gxTight(tasks, p, u, eps) {
  var d = tasks[u].s - tasks[p].e;
  return d <= eps && d >= -eps;
}

/**
 * Dependencies the schedule does not honour: a task starting before the thing it depends on ends.
 *
 * Counted rather than corrected. The dates and the network are two independent statements about the
 * same plan and they are allowed to contradict each other; noticing the contradiction is more useful
 * than picking a winner.
 *
 * @example gxViolations([{ s: 0, e: 5 }, { s: 2, e: 6 }], [[], [0]]).length;   // 1
 */
function gxViolations(tasks, pred) {
  var out = [], i, j;
  for (i = 0; i < tasks.length; i++) {
    for (j = 0; j < pred[i].length; j++) {
      if (tasks[i].s < tasks[pred[i][j]].e) { out.push([pred[i][j], i]); }
    }
  }
  return out;
}

/**
 * Dependencies with AIR in them: a task starting well after the thing it depends on ended.
 *
 * The mirror of {@link gxViolations}, and reported for a different reason. A violation is a
 * contradiction — the dates say one thing and the network says another. A gap is not: a plan may
 * deliberately leave room, and calling it an error would be the card second-guessing the planner.
 * It is worth naming anyway, because it is WHERE THE SLACK IS. Every day of float a task carries
 * came from air somewhere downstream of it, and a card that reported only the violated direction
 * left a week of empty calendar entirely unremarked beside a critical path it got wrong because
 * of that same week.
 *
 * @param tasks tasks carrying `s` and `e`
 * @param pred  predecessor lists by task index
 * @returns `[predecessor, successor, airMs]` triples, air always strictly positive
 *
 * @example gxGaps([{ s: 0, e: 5 }, { s: 9, e: 12 }], [[], [0]])[0][2];   // 4
 */
function gxGaps(tasks, pred) {
  var out = [], i, j, p, air;
  for (i = 0; i < tasks.length; i++) {
    for (j = 0; j < pred[i].length; j++) {
      p = pred[i][j];
      air = tasks[i].s - tasks[p].e;
      if (air > 0) { out.push([p, i, air]); }
    }
  }
  return out;
}

/**
 * Metrics for one layout mode. Two numbers change the whole drawing's breathing room.
 *
 * The arrow budget lives here rather than beside the other caps at the top of the file for a
 * reason worth stating: this function is SHIPPED, and a module-level constant is not. A shipped
 * function that closed over a build-time constant would run in Node and throw a reference error in
 * the browser the moment a setting changed, which is the failure that only shows up on the desk.
 *
 * @example gxMetrics(true).rowH;   // 20
 */
function gxMetrics(pack) {
  return {
    pad:      12,
    top:      28,
    rowH:     pack ? 20 : 22,
    barH:     pack ? 12 : 13,
    foot:     16,
    labMax:   200,
    hair:     1.5,
    arrowCap: 240
  };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption's first job is the lane count and what it means, because that number is the plan's
 * maximum concurrency and a reader who does not know the packing is optimal has no reason to read
 * it as anything but a drawing choice. Its second job is the critical path, or the cycle that means
 * there is not one. Everything refused is counted and named after those two.
 *
 * EVERY SENTENCE ENDS IN A FULL STOP, including the last one in every branch, because the pieces
 * are joined with a single space and a missing stop welds two sentences into one when the caption
 * is flattened to text by a screen reader or a copy-paste. Four separate cards in this catalogue
 * shipped that defect and no assertion caught any of them.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function gxNote(P, c, pack, depth, sch, cyc, viol, gaps, stats) {
  var T = P.tasks, n = T.length, i, bits = [], names = [];

  if (!n) {
    return {
      aria: 'Gantt chart with no tasks: nothing is scheduled.',
      caption: 'a schedule with <b>no tasks</b> &mdash; the card keeps its place, but there is ' +
               'nothing in it to plan.' +
               (P.refused.length ? ' <i>' + P.refused.length + ' input' +
                 (P.refused.length === 1 ? '' : 's') + ' refused</i>: ' +
                 CK.esc(P.refused.slice(0, 4).join('; ')) + '.' : '')
    };
  }

  for (i = 0; i < n && i < 10; i++) {
    names.push(T[i].label + ', ' + gxFmtFull(T[i].s) + ' for ' + gxDur(T[i].e - T[i].s));
  }
  if (n > 10) { names.push('and ' + (n - 10) + ' more'); }

  /* A schedule can legitimately span zero time — every task at one instant — and the phrase has to
     stay grammatical there rather than reading "an instant of the an instant". */
  var spanMs = stats.hi - stats.lo;
  var spanPhrase = spanMs > 0 ? gxAmt(spanMs) + ' this schedule spans'
                              : 'single instant this schedule occupies';
  var spanPhraseB = spanMs > 0 ? '<b>' + CK.esc(gxAmt(spanMs)) + '</b> this schedule spans'
                               : 'single instant this schedule occupies';

  var critWords = cyc.length
    ? 'The dependencies are cyclic, so there is no critical path: ' +
      cycNames(T, cyc) + ' depend on each other in a loop.'
    : sch.path.length
      ? 'The critical chain runs ' + pathNames(T, sch.path) + ', occupying ' + gxAmt(sch.length) +
        ' of the ' + spanPhrase + '; ' +
        (sch.criticals > sch.path.length
          ? sch.criticals + ' tasks in all have no slack.'
          : 'it is the only work here with no slack in it.')
      : 'Nothing is scheduled, so there is no critical path to compute.';

  var aria =
    'Gantt chart of ' + n + ' ' + (n === 1 ? 'task' : 'tasks') +
    (c.pack ? ' packed into ' + pack.lanes + ' ' + (pack.lanes === 1 ? 'lane' : 'lanes') +
              ', the fewest possible' : ', one per row') +
    ', from ' + gxFmtFull(stats.lo) + ' to ' + gxFmtFull(stats.hi) + '. ' + critWords +
    ' Tasks: ' + names.join('. ') + '.';

  if (c.pack) {
    bits.push('packed into <b>' + pack.lanes + '</b> ' + (pack.lanes === 1 ? 'lane' : 'lanes') +
              ' by greedy interval colouring, which is <i>optimal rather than merely adequate</i>: ' +
              'interval graphs are perfect, so the lane count equals the largest number of tasks ' +
              'ever running at once' +
              (pack.lanes > depth && stats.milestones
                ? ' &mdash; here <b>' + depth + '</b> for the bars, with ' + (pack.lanes - depth) +
                  ' more opened so coincident milestones are not drawn on top of one another, ' +
                  'which is a fact about the drawing rather than about the schedule'
                : ' (<b>' + depth + '</b>)') + '.');
  } else {
    bits.push('one row per task, in start order; the packed mode draws the same schedule in <b>' +
              pack.lanes + '</b> ' + (pack.lanes === 1 ? 'lane' : 'lanes') + '.');
  }

  if (cyc.length) {
    bits.push('<b>the dependencies are cyclic</b> &mdash; ' + CK.esc(cycNames(T, cyc)) +
              ' form a loop &mdash; so <b>no critical path is shown</b>. Breaking the cycle by ' +
              'dropping an edge would produce a confident number for a question the data does not ' +
              'actually pose.');
  } else if (sch.path.length) {
    bits.push('<b>critical path</b>: ' + CK.esc(pathNames(T, sch.path)) + ', occupying <b>' +
              CK.esc(gxAmt(sch.length)) + '</b> of the ' + spanPhraseB +
              '. That number is <i>elapsed time on the axis</i>, not a sum ' +
              'of durations: the two agree along this chain only because a chain with no slack has ' +
              'no air in it, and the moment a plan has gaps they part company. Criticality is ' +
              '<i>derived</i> from each task&#39;s slack against the dates as drawn &mdash; latest ' +
              'finish minus the end it was given &mdash; so a task is on the path exactly when it ' +
              'has no slack, and the highlight and the number cannot disagree' +
              (sch.criticals > sch.path.length
                ? '. <b>' + sch.criticals + '</b> tasks in all have zero slack, on more than one ' +
                  'branch; every one of them is marked, and the chain named here is the longest.'
                : '.'));
  } else if (P.edges) {
    bits.push('no task here has zero slack, which can only happen when the schedule is empty.');
  }

  if (!cyc.length && n && sch.criticals < n) {
    var loose = n - sch.criticals;
    bits.push((loose === 1
      ? 'one task carries slack, <b>' + CK.esc(gxAmt(sch.maxSlack)) + '</b> of it'
      : '<b>' + loose + '</b> tasks carry slack, the largest <b>' + CK.esc(gxAmt(sch.maxSlack)) +
        '</b>') +
      ' &mdash; that much can be lost before the finish date moves. Hover any bar for its own ' +
      'figure.');
  }

  if (gaps.length) {
    var air = 0;
    for (i = 0; i < gaps.length; i++) { air += gaps[i][2]; }
    bits.push('<b>' + gaps.length + '</b> dependenc' + (gaps.length === 1 ? 'y has' : 'ies have') +
              ' air in ' + (gaps.length === 1 ? 'it' : 'them') + ', <b>' + CK.esc(gxAmt(air)) +
              '</b> altogether: ' + CK.esc(gapNames(T, gaps)) + '. This is <i>not</i> an error the ' +
              'way a violation is &mdash; a plan may leave room on purpose &mdash; and it is named ' +
              'because it is where every day of slack above came from. A gantt that reported only ' +
              'the violated direction left a week of empty calendar unremarked.');
  }

  if (viol.length) {
    bits.push('<b>' + viol.length + '</b> dependenc' + (viol.length === 1 ? 'y is' : 'ies are') +
              ' not honoured by the dates &mdash; ' + CK.esc(edgeNames(T, viol)) +
              ' start' + (viol.length === 1 ? 's' : '') + ' before what ' +
              (viol.length === 1 ? 'it depends' : 'they depend') + ' on ends. The dates and the ' +
              'network are two claims about one plan and this card reports the disagreement rather ' +
              'than picking a winner' +
              (sch.behind
                ? ', which is why <b>' + sch.behind + '</b> task' + (sch.behind === 1 ? '' : 's') +
                  ' here ' + (sch.behind === 1 ? 'has' : 'have') + ' negative slack and ' +
                  (sch.behind === 1 ? 'is' : 'are') + ' drawn as critical: the network needs ' +
                  (sch.behind === 1 ? 'it' : 'them') + ' to have finished already.'
                : '.'));
  }

  if (stats.dstish) {
    bits.push('<b>' + stats.dstish + '</b> task' + (stats.dstish === 1 ? '' : 's') +
              ' last an hour more or less than a whole number of days, which is what a clock change ' +
              'looks like. Bars are drawn from <i>elapsed time</i>, never from a day count, so such ' +
              'a task is 23 or 25 hours wide and its end lands on the tick its end date belongs to.');
  }
  if (stats.hairline) {
    bits.push('<b>' + stats.hairline + '</b> bar' + (stats.hairline === 1 ? '' : 's') +
              ' would be thinner than a hairline at this width and ' +
              (stats.hairline === 1 ? 'is' : 'are') + ' drawn at ' + gxMetrics(true).hair +
              'px instead; that is the one place the drawing is not to scale.');
  }
  if (stats.unlabelled && c.pack) {
    bits.push('<b>' + stats.unlabelled + '</b> bar' + (stats.unlabelled === 1 ? '' : 's') +
              ' had no room for a label inside ' + (stats.unlabelled === 1 ? 'it' : 'them') +
              '; the names are in the tooltips. Putting them outside would reintroduce exactly the ' +
              'collision the lanes just solved.');
  }
  if (stats.todayClamped) {
    bits.push('the <i>today</i> marker falls outside the scheduled range and is drawn clamped to ' +
              'the ' + (stats.todayLeft ? 'left' : 'right') + ' edge, so its position is a ' +
              'direction rather than a date.');
  }
  if (stats.arrowsDropped) {
    bits.push('<b>' + stats.arrowsDropped + '</b> dependency arrows past the drawing budget are ' +
              'not shown; every one of them still counted toward the critical path.');
  }

  if (P.refused.length) {
    bits.push('<i>' + P.refused.length + ' task' + (P.refused.length === 1 ? '' : 's') +
              ' refused</i>: ' + CK.esc(P.refused.slice(0, 4).join('; ')) +
              (P.refused.length > 4 ? ', and ' + (P.refused.length - 4) + ' more' : '') +
              '. A task whose end precedes its start is never repaired by swapping the ends.');
  }
  if (P.dupIds.length) {
    bits.push('<i>' + P.dupIds.length + ' duplicate task id' + (P.dupIds.length === 1 ? '' : 's') +
              '</i> (' + CK.esc(P.dupIds.slice(0, 4).join(', ')) + ') kept the first task and the ' +
              'repeats were dropped.');
  }
  if (P.badEdges.length) {
    bits.push('<i>' + P.badEdges.length + ' dependenc' + (P.badEdges.length === 1 ? 'y' : 'ies') +
              ' refused</i>: ' + CK.esc(P.badEdges.slice(0, 3).join('; ')) +
              (P.badEdges.length > 3 ? ', and ' + (P.badEdges.length - 3) + ' more' : '') + '.');
  }
  if (P.selfDeps) {
    bits.push('<i>' + P.selfDeps + ' self-dependenc' + (P.selfDeps === 1 ? 'y' : 'ies') +
              '</i> dropped &mdash; a task preceding itself states no ordering, so it is a typo ' +
              'rather than a cycle and the critical path is still computed.');
  }
  if (P.badPct) {
    bits.push('<i>' + P.badPct + ' progress value' + (P.badPct === 1 ? '' : 's') +
              '</i> outside 0 to 100 refused; those bars carry no fill rather than a clamped one.');
  }
  if (P.droppedTasks) { bits.push('<i>' + P.droppedTasks + ' tasks past the drawing budget</i> were left out.'); }
  if (P.droppedDeps)  { bits.push('<i>' + P.droppedDeps + ' dependencies past the budget</i> were left out.'); }

  var caption =
    'schedule &mdash; <b>' + n + '</b> ' + (n === 1 ? 'task' : 'tasks') +
    (stats.milestones ? ' including <b>' + stats.milestones + '</b> milestone' +
                        (stats.milestones === 1 ? '' : 's') : '') +
    ', ' + CK.esc(gxFmtTime(stats.lo, 86400000 * 30)) + ' to ' +
    CK.esc(gxFmtTime(stats.hi, 86400000 * 30)) + '. ' + bits.join(' ');

  return { aria: aria, caption: caption };
}

/** Task labels along a path, joined with arrows a plain-text reader can follow. */
function pathNames(T, path) {
  var out = [], i;
  for (i = 0; i < path.length && i < 8; i++) { out.push(T[path[i]].label); }
  if (path.length > 8) { out.push('and ' + (path.length - 8) + ' more'); }
  return out.join(' then ');
}

/** Task labels around a cycle, closed back onto the first so the loop is visible. */
function cycNames(T, cyc) {
  var out = [], i;
  for (i = 0; i < cyc.length && i < 8; i++) { out.push(T[cyc[i]].label); }
  if (cyc.length > 8) { out.push('and ' + (cyc.length - 8) + ' more'); }
  return out.join(' then ') + ' then ' + T[cyc[0]].label + ' again';
}

/** A few offending edges, named. */
function edgeNames(T, pairs) {
  var out = [], i;
  for (i = 0; i < pairs.length && i < 3; i++) { out.push(T[pairs[i][1]].label); }
  if (pairs.length > 3) { out.push('and ' + (pairs.length - 3) + ' more'); }
  return out.join(', ');
}

/**
 * A few gaps, named with the air in each, widest first.
 *
 * Sorted rather than taken in index order: three gaps of ten minutes and one of a fortnight is a
 * plan with a fortnight of air in it, and naming the ten-minute ones because they came first would
 * bury the only one worth looking at.
 */
function gapNames(T, trips) {
  var by = trips.slice(0), out = [], i;
  by.sort(function (a, b) { return b[2] - a[2]; });
  for (i = 0; i < by.length && i < 3; i++) {
    out.push(T[by[i][1]].label + ' (' + gxAmt(by[i][2]) + ' after ' + T[by[i][0]].label + ')');
  }
  if (by.length > 3) { out.push('and ' + (by.length - 3) + ' more'); }
  return out.join(', ');
}

/**
 * Everything the card draws, from the payload and one settings object.
 *
 * The same function in Node and in the browser, so the caption can never describe a drawing that is
 * not the drawing on the screen. Only the height grows with the data: a schedule is read left to
 * right along one clock, and widening it past the desk column would trade the one axis every reader
 * shares for one they have to scroll.
 *
 * EVERY HORIZONTAL POSITION IS `CK.scale` OF AN EPOCH MILLISECOND. That single sentence is the
 * daylight-saving answer: a bar's width is the difference of two scaled instants, which is elapsed
 * time by construction, and no calendar arithmetic gets a chance to disagree with the axis.
 *
 * @param P    the payload from {@link readData}
 * @param conf a settings object, settled by {@link gxConfig}
 * @returns `{ W, H, marks, note, pack, sch, cyc, viol, gaps, depth, lo, hi }`
 *
 * @example gxRender(P, { pack: false }).H;
 */
function gxRender(P, conf) {
  var c = gxConfig(conf);
  var M = gxMetrics(c.pack);
  var T = P.tasks, n = T.length, i, j, k;

  var pack = gxPack(T);
  var depth = gxDepth(T);
  var cyc = gxCycle(T, P.succ);
  var sch = gxSchedule(T, P.pred, P.succ);
  var viol = gxViolations(T, P.pred);
  var gaps = gxGaps(T, P.pred);

  var milestones = 0, dstish = 0, dur;
  for (i = 0; i < n; i++) {
    if (T[i].milestone) { milestones++; }
    dur = T[i].e - T[i].s;
    /* An hour off a whole number of days is what a clock change looks like from the outside. It is
       a heuristic and it is named as one in the caption, but it is the only signal available
       without being told which zone the dates were written in. */
    if (dur > 0 && (dur % 86400000 === 3600000 || dur % 86400000 === 82800000)) { dstish++; }
  }

  var stats = { lo: 0, hi: 0, milestones: milestones, dstish: dstish, hairline: 0,
                unlabelled: 0, todayClamped: false, todayLeft: false, arrowsDropped: 0 };

  if (!n) {
    return {
      W: P.W0, H: 130, marks: [mText(P.W0 / 2, 68, 'no tasks', 'ck-empty', 'middle')],
      pack: pack, depth: depth, sch: sch, cyc: cyc, viol: viol, gaps: gaps,
      rows: [], lo: 0, hi: 0,
      note: gxNote(P, c, pack, depth, sch, cyc, viol, gaps, stats)
    };
  }

  /* ── the domain ── */
  var lo = T[0].s, hi = T[0].e;
  for (i = 0; i < n; i++) {
    if (T[i].s < lo) { lo = T[i].s; }
    if (T[i].e > hi) { hi = T[i].e; }
  }
  stats.lo = lo; stats.hi = hi;

  /* Every task at one instant is a legitimate schedule and must draw rather than divide by zero.
     Half a day either side gives the milestones somewhere to sit; CK.scale would centre them, but
     then the axis would carry no ticks at all. */
  if (!(hi > lo)) { lo = lo - 43200000; hi = hi + 43200000; }
  var padMs = Math.max(1, Math.round((hi - lo) * 0.02));
  var dlo = lo - padMs, dhi = hi + padMs;

  /* ── the frame ── */
  var gutter = 0;
  if (!c.pack) {
    for (i = 0; i < n; i++) { gutter = Math.max(gutter, tw(T[i].label, 9.5)); }
    gutter = Math.min(M.labMax, gutter) + 10;
  }

  var W = Math.min(P.WMAX, Math.max(P.W0, M.pad * 2 + gutter + 340));
  var rows = c.pack ? pack.lanes : n;
  var H = M.top + Math.max(1, rows) * M.rowH + M.foot;
  var plot = { x0: M.pad + gutter, y0: M.top, x1: W - M.pad, y1: H - M.foot };

  var xs = CK.scale([dlo, dhi], [plot.x0, plot.x1]);

  /* Row assignment. In packed mode it is the lane; in row mode it is the position in start order,
     which is the order a reader scans a task list in. */
  var row = [], seq = pack.order;
  for (i = 0; i < n; i++) { row.push(0); }
  if (c.pack) { for (i = 0; i < n; i++) { row[i] = pack.lane[i]; } }
  else { for (j = 0; j < seq.length; j++) { row[seq[j]] = j; } }

  /* EVERY zero-slack task is marked, not only the chain the caption names. There is very often
     more than one critical branch, and a card that highlighted a single path would tell a reader
     to protect one branch while an equally critical parallel branch slipped. */
  var onPath = [];
  for (i = 0; i < n; i++) { onPath.push(false); }
  if (c.critical && !cyc.length) {
    for (i = 0; i < n; i++) { onPath[i] = !!sch.crit[i]; }
  }

  var marks = [];

  /* ── the axis ── */
  var want = Math.max(2, Math.min(9, Math.floor((plot.x1 - plot.x0) / 76)));
  var tk = gxTicks(dlo, dhi, want);
  for (i = 0; i < tk.ticks.length; i++) {
    var tx = xs(tk.ticks[i]);
    marks.push(mLine(tx, plot.y0, tx, plot.y1, 'ck-rule'));
    marks.push(mText(tx, plot.y0 - 7, gxFmtTime(tk.ticks[i], tk.step), 'ck-tk', 'middle'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x1, plot.y0, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  /* ── the today marker ── */
  if (c.today && P.today !== null && P.today !== undefined) {
    var tv = P.today;
    if (tv < dlo) { tv = dlo; stats.todayClamped = true; stats.todayLeft = true; }
    else if (tv > dhi) { tv = dhi; stats.todayClamped = true; }
    var nx = xs(tv);
    marks.push(mLine(nx, plot.y0, nx, plot.y1, 'ck-today'));
    var tmark = mText(Math.min(nx + 4, plot.x1 - 4), plot.y0 - 7,
                      stats.todayClamped ? 'now \u2192' : 'now', 'ck-nowtk',
                      nx > plot.x1 - 40 ? 'end' : 'start');
    marks.push(tmark);
  }

  /* ── the bars ── */
  var geom = [];
  for (i = 0; i < n; i++) {
    var t = T[i];
    var yTop = plot.y0 + row[i] * M.rowH + (M.rowH - M.barH) / 2;
    var cy = yTop + M.barH / 2;
    var bx = xs(t.s), ex = xs(t.e);
    var kids = [];
    /* The slack figure belongs in the tooltip and not only in the caption: the caption can name a
       handful of tasks, and the reader's question is nearly always about one particular bar. */
    /* Free float is NOT always a smaller positive number than total float. A successor that starts
       before this task ends drives it negative, and the tooltip once read "4 d of slack, minus 4 d
       of it free", which is not a sentence anybody can act on. The three cases are named instead. */
    var freeWords = sch.ok && !sch.crit[i]
      ? (sch.free[i] < 0 ? ', though a successor already starts before it ends'
         : sch.free[i] === 0 ? ', none of it free \u2014 it cannot slip at all without pushing something'
         : sch.free[i] < sch.slack[i] ? ', ' + gxAmt(sch.free[i]) + ' of it free'
         : '')
      : '';
    var slackWords = !sch.ok
      ? ' \u00b7 slack unknown, the dependencies are cyclic'
      : sch.crit[i]
        ? ' \u00b7 no slack, so critical'
        : ' \u00b7 ' + gxAmt(sch.slack[i]) + ' of slack' + freeWords;
    var tip = t.label + ' \u00b7 ' + gxFmtFull(t.s) +
              (t.milestone ? '' : ' to ' + gxFmtFull(t.e)) +
              ' \u00b7 ' + gxDur(t.e - t.s) +
              (t.group ? ' \u00b7 ' + t.group : '') +
              (t.pct !== null ? ' \u00b7 ' + t.pct + '% done' : '') +
              slackWords;

    if (t.milestone) {
      geom.push({ x0: bx, x1: bx, cy: cy });
      kids.push(mDiamond(bx, cy, M.barH / 2 + 1,
                         'ck-ms' + (onPath[i] ? ' ck-crit' : '') + hueCls(P, t)));
    } else {
      var w = ex - bx;
      if (w < M.hair) { w = M.hair; stats.hairline++; }
      geom.push({ x0: bx, x1: bx + w, cy: cy });
      kids.push(mRect(bx, yTop, w, M.barH, 'ck-bar' + (onPath[i] ? ' ck-crit' : '') + hueCls(P, t), 2));
      if (t.pct !== null && t.pct > 0) {
        kids.push(mRect(bx, yTop, w * t.pct / 100, M.barH, 'ck-pct', 2));
      }
      if (c.pack) {
        var room = w - 8;
        var shown = room > 12 ? clipTo(t.label, room) : '';
        if (shown) { kids.push(mText(bx + 4, cy + 3.2, shown, 'ck-blab', 'start')); }
        else { stats.unlabelled++; }
      }
    }

    if (onPath[i]) {
      /* A notch as well as a heavier outline. The path has to survive a monochrome print and a
         reader who cannot tell the accent from the ink, so it is carried by shape first. */
      kids.push(mLine(geom[i].x0, yTop - 3, geom[i].x0, yTop + M.barH + 3, 'ck-critmark'));
    }

    var g = { t: 'g', a: { 'class': 'ck-task', 'data-task': String(i) }, kids: kids };
    g.ti = tip;
    marks.push(g);

    if (!c.pack) {
      marks.push(mText(plot.x0 - 6, cy + 3.4, clipTo(t.label, gutter - 12, 9.5), 'ck-rlab', 'end'));
    }
  }

  /* ── the dependency arrows ── */
  if (c.deps) {
    var drawn = 0;
    for (i = 0; i < n; i++) {
      for (j = 0; j < P.pred[i].length; j++) {
        if (drawn >= M.arrowCap) { stats.arrowsDropped++; continue; }
        k = P.pred[i][j];
        /* Solid only where the edge is genuinely ON a critical chain: both ends critical AND the
           edge tight. Two critical tasks with a week of air between them are not joined by a
           critical edge, and drawing that arrow solid would put the picture back into the business
           of asserting something the arithmetic does not support. */
        marks.push(depArrow(geom[k], geom[i],
                            onPath[k] && onPath[i] && sch.ok && gxTight(T, k, i, sch.eps), M));
        drawn++;
      }
    }
  }

  return {
    W: W, H: H, marks: marks, pack: pack, depth: depth, sch: sch, cyc: cyc, viol: viol, gaps: gaps,
    rows: row, geom: geom, lo: stats.lo, hi: stats.hi, ticks: tk,
    note: gxNote(P, c, pack, depth, sch, cyc, viol, gaps, stats)
  };
}

/** A series class when the tasks carry groups, and nothing when they do not. */
function hueCls(P, t) {
  if (!t.group || !P.groups) { return ''; }
  var at = P.groups.indexOf(t.group);
  return at < 0 ? '' : ' ck-g' + ((at % 8) + 1);
}

/**
 * One dependency, as an elbow from the end of the predecessor to the start of the successor.
 *
 * When the successor starts to the right there is room for a plain three-segment elbow. When it
 * starts at or before the predecessor's end — which is exactly the case a violated dependency
 * produces — the arrow has to double back, so it jogs out, across on a middle line, and in. Both
 * shapes end in the same arrowhead, so the direction of the dependency is never ambiguous.
 *
 * A critical-path edge is solid and the rest are dashed: the distinction is carried by the line
 * style rather than by the colour, so it survives a monochrome print.
 */
function depArrow(a, b, critical, M) {
  var ex = a.x1, ey = a.cy, sx = b.x0, sy = b.cy, out = M.rowH / 2 - 2;
  var d;
  if (sx >= ex + 14) {
    d = 'M' + fin(ex) + ' ' + fin(ey) + ' H' + fin(ex + 7) + ' V' + fin(sy) + ' H' + fin(sx - 4);
  } else {
    var mid = ey + (sy > ey ? out : -out);
    d = 'M' + fin(ex) + ' ' + fin(ey) + ' H' + fin(ex + 7) + ' V' + fin(mid) +
        ' H' + fin(sx - 11) + ' V' + fin(sy) + ' H' + fin(sx - 4);
  }
  var head = 'M' + fin(sx - 4) + ' ' + fin(sy - 3) + ' L' + fin(sx) + ' ' + fin(sy) +
             ' L' + fin(sx - 4) + ' ' + fin(sy + 3) + ' Z';
  return { t: 'g', a: { 'class': 'ck-dep' + (critical ? ' ck-depcrit' : '') },
           kids: [mPath(d, 'ck-depline'), mPath(head, 'ck-dephead')] };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, pad2, utcAt, gxLadder, gxRungMs, gxTicks, gxFmtTime, gxFmtFull,
                 gxDur, gxAmt, mLine, mText, mRect, mPath, mDiamond, gxConfig, gxPack, gxDepth,
                 gxCycle, gxSchedule, gxTight, gxViolations, gxGaps, gxMetrics, gxNote, pathNames,
                 cycNames, edgeNames, gapNames, gxRender, hueCls, depArrow];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>` AND that
 * cannot trip the emitted-code guard.
 *
 * `<` and `>` become escapes so a task name containing a closing script tag cannot end the block
 * early — which has the second, less obvious effect of making an arrow sequence impossible, since
 * its second character is one of the two. `?` is escaped for the same reason one step further on:
 * a label reading "ready?.check" would otherwise put an optional-chaining sequence into a file the
 * guard refuses to emit, and the card would fail to build because of somebody's punctuation. The
 * backtick and the two line separators round it out.
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
  const own = '.ck-gantt[data-card="' + id + '"]';
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
 * The critical path is carried by stroke WEIGHT and by a notch at the bar's head, and dependency
 * kinds by dash pattern, so both survive a monochrome print and a colour-blind reader. The accent
 * is reinforcement on top of a distinction that is already there.
 */
function cardCss(id, wide, W) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-nowtk', 'fill: var(--accent); font-size: 8.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-today', 'stroke: var(--accent); stroke-width: 1; stroke-dasharray: 2 3;'],

    ['.ck-plot .ck-bar', 'fill: var(--pill); stroke: var(--pill-edge); stroke-width: 1;'],
    ['.ck-plot .ck-ms', 'fill: var(--pill); stroke: var(--pill-edge); stroke-width: 1;'],
    ['.ck-plot .ck-pct', 'fill: var(--ink-dim); opacity: .38; stroke: none;'],
    ['.ck-plot .ck-blab', 'fill: var(--ink); font-size: 8.5px;'],
    ['.ck-plot .ck-rlab', 'fill: var(--ink-dim); font-size: 9.5px;'],

    ['.ck-plot .ck-depline', 'fill: none; stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 3 2;'],
    ['.ck-plot .ck-dephead', 'fill: var(--ink-faint); stroke: none;'],
    ['.ck-plot .ck-depcrit .ck-depline', 'stroke: var(--accent); stroke-dasharray: none; stroke-width: 1.2;'],
    ['.ck-plot .ck-depcrit .ck-dephead', 'fill: var(--accent);'],

    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-task', 'transition: opacity .12s linear;'],
    ['.ck-plot:hover .ck-task', 'opacity: .55;'],
    ['.ck-plot .ck-task:hover', 'opacity: 1;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-plot .ck-g' + i, 'fill: var(--ck-s' + i + '); fill-opacity: .34; stroke: var(--ck-s' + i + ');']);
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }

  /* The critical-path rules come AFTER the group colours on purpose. Both are one class deep, so
     specificity is a tie and source order decides; written the other way round, a critical task
     that happened to belong to a group would silently lose its heavier stroke and the one thing
     the card most wants to point at would be invisible in exactly the schedules that have groups. */
  rules.push(['.ck-plot .ck-crit', 'stroke: var(--accent); stroke-width: 2;']);
  rules.push(['.ck-plot .ck-critmark', 'stroke: var(--accent); stroke-width: 2; stroke-linecap: butt;']);

  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  /* The only animation is that fade and it carries no meaning, so it is safe to simply stop. */
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-task', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the schedule drawn, and the caption. */
function cardHtml(id, title, seed, cfg, wide, legend) {
  const f = (name) => CK.esc(id) + '-' + name;
  const box = (name, label, on) =>
    '    <label for="' + f(name) + '">' + CK.esc(label) + '</label>\n' +
    '    <input id="' + f(name) + '" name="' + name + '" type="checkbox"' + (on ? ' checked' : '') + '>\n';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-gantt">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="gantt settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    box('pack', 'pack into lanes', cfg.pack) +
    box('critical', 'critical path', cfg.critical) +
    box('deps', 'dependency arrows', cfg.deps) +
    box('today', 'today marker', cfg.today) +
    '    <p class="ck-set-foot">packing is greedy interval colouring, which is optimal rather than ' +
         'merely adequate: the lane count equals the largest number of tasks ever running at once. ' +
         'Turning it off gives one row per task with the names in a gutter. Bar widths are elapsed ' +
         'time, never a day count, so a task spanning a clock change is 23 or 25 hours wide. ' +
         'The critical path is not a separate switch for what is critical: a task is critical ' +
         'exactly when it has no slack against the dates as drawn, and the switch only decides ' +
         'whether that is drawn. Hover a bar for its own slack.</p>\n' +
    '  </div>\n' +
    '  ' + (wide ? '<div class="ck-scroll">' + plot + '</div>' : plot) + legend + '\n' +
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
    '/* gantt card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The packing, the cycle search and the slack pass are all redone here, so the\n' +
    '   caption and the drawing cannot come to disagree about how many lanes there are or which\n' +
    '   tasks move the finish date. Criticality is derived from slack rather than tracked beside\n' +
    '   it, which is what stops the two from drifting apart in the first place. */\n' +
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
    '     stays a translator rather than a second place where schedule decisions live. */\n' +
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
    '     a render that added marks would draw a second schedule on top of the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = gxRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/gantt');
}

/**
 * Build one Gantt card from one data block.
 *
 * WHY `work-and-lists` AND NOT `evolution`. A Gantt runs along a time axis, which makes `evolution`
 * the tempting answer, but `evolution` asks what CHANGED over time and a schedule records nothing
 * that changed — it records what is meant to happen. The two readings a Gantt is actually reached
 * for are both answers to "what is outstanding, and what can I do about it?": which tasks are free
 * to start, and which ones move the finish date if they slip. The critical path is literally the
 * answer to the second half of that question, so the category and the card's most useful output
 * name the same thing.
 *
 * DAYLIGHT SAVING, WHICH IS THE EASIEST WAY FOR THIS CARD TO BE QUIETLY WRONG. Every horizontal
 * position is `CK.scale` of an epoch millisecond, so a bar's width is `x(end) - x(start)` and
 * therefore the ELAPSED time between them. A task from local midnight to local midnight across a
 * spring-forward boundary contains 23 hours and draws 23 hours wide; the same task in autumn
 * contains 25 and draws 25. The alternative — a day count times pixels-per-day — draws both at 24
 * and puts the bar's right edge an hour away from the tick its end date belongs to, which is a
 * disagreement between the drawing and its own axis that nothing in the picture would reveal. The
 * cost is real and is stated: two tasks both called three days do not draw at the same width when
 * one of them spans a clock change. The caption says so whenever a duration is an hour off a whole
 * number of days.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data                 a card-sized empty frame saying so; nothing is invented
 *   one task                one bar on an axis padded around it
 *   every task at one       the span is zero, so the axis is widened half a day either side and
 *   instant                 the milestones stack into one lane each, since coincident points
 *                           cannot share a lane
 *   zero duration           a diamond, never a rect of zero width, which would paint nothing at all
 *   end before start        refused, counted and named; never repaired by swapping the ends
 *   unparseable date        refused, counted and named; never coerced, because Number('') is 0 and
 *                           an invented 1970 looks exactly like a real one
 *   duplicate ids           the first task wins, the repeats are dropped and counted
 *   dependency on nothing   that edge is refused, counted and named; the task still draws
 *   self-dependency         the edge is refused and counted separately, because a task preceding
 *                           itself states no ordering; the critical path is still computed
 *   a two-cycle             a real ordering claim that cannot be met, so NO critical path is shown,
 *                           no slack is computed, and the tasks in the loop are named
 *   air between two         not an error; the successor is not critical for it, the predecessor
 *   linked tasks            gains that much slack, and the gap is counted and named
 *   a successor starting    a violation: it is counted and named, and it drives the slack around it
 *   before its predecessor  negative, which reads as critical because the network wants that work
 *   has finished            finished already
 *   a far-outside task      drawn, and it stretches the axis; there is no window to fall outside of
 *   200 tasks               packed into as many lanes as the schedule genuinely needs
 *   a 300-character label   clipped to the room it has, with the whole of it in the tooltip
 *   injected markup         escaped on the way into the caption and the tooltips, and escaped again
 *                           on the way into the emitted script literal
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ tasks, today, title }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'launch',
 *   title: 'launch plan',
 *   data: { today: '2024-03-05',
 *           tasks: [{ id: 'spec',  label: 'spec',  start: '2024-03-01', end: '2024-03-04' },
 *                   { id: 'build', label: 'build', start: '2024-03-04', end: '2024-03-12',
 *                     deps: ['spec'], pct: 40 },
 *                   { id: 'ship',  label: 'ship',  start: '2024-03-12', end: '2024-03-12',
 *                     deps: ['build'] }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'gantt' : id);
  const P = readData(data);

  /* Group colours are assigned in first-appearance order, which is the order the author wrote and
     therefore the only order that is not this card having an opinion about the plan. */
  const groups = [];
  for (const t of P.tasks) if (t.group && !groups.includes(t.group)) groups.push(t.group);
  P.groups = groups;

  const cfg = { ...defaults };
  const seed = gxRender(P, cfg);
  const wide = seed.W > W0;

  /* Joined with a SPACE, not with nothing. `.ck-legend` is a flex container, so a whitespace-only
     text node between two items is not rendered and the drawing is unchanged — but flattening the
     card to text (a screen reader, a copy-paste) concatenates the spans, and without the space two
     group names weld into one word. Found by reading the rendered output as text rather than by
     any assertion, which is how the same defect was found in four other cards. */
  const legend = groups.length > 1
    ? '\n  <div class="ck-legend">' +
      groups.map((g, i) => '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g) + '</span>').join(' ') +
      '</div>'
    : '';

  /* The payload the browser re-renders from carries the data and the budgets and no geometry, so
     the two runtimes cannot disagree about anything except the config. */
  const payload = {
    tasks: P.tasks, pred: P.pred, succ: P.succ, groups,
    today: P.today, title: P.title,
    refused: P.refused, dupIds: P.dupIds, badEdges: P.badEdges,
    selfDeps: P.selfDeps, badPct: P.badPct,
    droppedTasks: P.droppedTasks, droppedDeps: P.droppedDeps, edges: P.edges,
    W0, WMAX,
  };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      tasks: P.tasks.length,
      milestones: P.tasks.filter((t) => t.milestone).length,
      lanes: seed.pack.lanes,
      maxOverlap: seed.depth,
      dependencies: P.edges,
      cyclic: seed.cyc.length > 0,
      /* `criticalMs` is ELAPSED TIME ALONG THE CHAIN — the end of its last task minus the start of
         its first — and not, as it once was, the sum of durations down the longest chain in the
         network. The old number ignored where the dates put the work, so on a schedule with a week
         of air in it the card reported six days for a plan it had drawn thirteen days wide. Because
         a zero-slack chain is by construction gapless, this number is still the total of the work
         on the chain; it is simply now also true of the picture. */
      criticalPath: seed.cyc.length ? [] : seed.sch.path.map((i) => P.tasks[i].id),
      criticalMs: seed.cyc.length ? 0 : seed.sch.length,
      criticalTasks: seed.cyc.length ? 0 : seed.sch.criticals,
      spanMs: seed.hi - seed.lo,
      maxSlackMs: seed.cyc.length ? 0 : seed.sch.maxSlack,
      negativeSlackTasks: seed.cyc.length ? 0 : seed.sch.behind,
      gappedDependencies: seed.gaps.length,
      gapMs: seed.gaps.reduce((a, g) => a + g[2], 0),
      violatedDependencies: seed.viol.length,
      refusedTasks: P.refused.length,
      refusedDependencies: P.badEdges.length,
      selfDependencies: P.selfDeps,
      settings: { ...cfg },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, cfg, wide, legend),
    css:  cardCss(cardId, wide, seed.W),
    js:   cardJs(cardId, payload, cfg),
  };
}

/* Exported for the type's own verification, which executes the geometry rather than only reading
   it: a static check can prove the script parses and cannot prove a bar's width is elapsed time. */
export const _internals = { readData, readTime, clean, gxRender, gxPack, gxDepth, gxCycle,
                            gxSchedule, gxTight, gxViolations, gxGaps, gxConfig, gxTicks,
                            gxFmtTime, gxDur, gxAmt, utcAt, jsLit, SHIPPED };

export default { meta, build };
