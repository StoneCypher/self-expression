/**
 * `pert` — activity on node, where the quantity that matters is FLOAT.
 *
 * WHY THIS EXISTS BESIDE `gantt`, WHICH ALREADY DRAWS A CRITICAL PATH. Because a critical path is
 * the least interesting thing a dependency network knows. It answers "what must not slip", which is
 * one bit per task. Float answers "how far can this slip, and what happens when it does", which is
 * the number an actual decision is made from — the difference between "this is late" and "this is
 * late and it matters". A bar chart of dates has nowhere to put that number, so `gantt` does not
 * carry it and cannot be made to carry it honestly: `gantt` positions bars from CALENDAR DATES and
 * computes its critical path from DURATIONS, two independent claims it already knows can disagree
 * (it has a whole function, `gxViolations`, for reporting when they do). Hanging a float tail off a
 * date-positioned bar would draw a network-derived quantity on a date-derived picture.
 *
 * This card has no dates at all. It takes durations and a dependency network, runs the forward and
 * backward passes, and draws the schedule the NETWORK implies. That is also why it can draw a plan
 * that `gantt` must refuse outright: a plan whose tasks have durations but no assigned dates yet,
 * which is every plan before somebody has committed to a start.
 *
 * THREE THINGS THIS CARD IS OPINIONATED ABOUT.
 *
 * 1. TOTAL FLOAT AND FREE FLOAT ARE DIFFERENT NUMBERS AND CONFLATING THEM IS THE COMMON ERROR.
 *    Total float is `LS - ES`: how long a task can slip before the project's finish moves. Free
 *    float is `min(ES of successors) - EF`: how long it can slip before ANY successor has to move.
 *    Free float is never larger than total float and is frequently zero when total float is not — a
 *    task with five days of total float and zero free float cannot slip a single day without pushing
 *    something, even though it is not on the critical path. That is the case a schedule review gets
 *    wrong, so both numbers are drawn, side by side, as two segments of one tail: the free part
 *    first, then the part that is only free because somebody else's slack is being spent.
 *
 * 2. CRITICAL-PATH MEMBERSHIP IS DERIVED FROM THE FLOAT, NEVER TRACKED BESIDE IT. A task is on the
 *    critical path exactly when its total float is zero — {@link pxRender} computes the floats and
 *    then asks which are zero, so there is no second list that can drift out of agreement with the
 *    arithmetic. A consequence worth stating, because readers ask: there is no such thing as a
 *    network with nothing on its critical path. The finish is some task's earliest finish, and
 *    walking forward from the largest earliest finish reaches a task with no successors whose latest
 *    finish is therefore the project finish, so its float is zero by construction.
 *
 *    And there is very often more than ONE critical path. A card that draws a single highlighted
 *    chain implies it is the only one, which is how a team ends up protecting one branch and
 *    ignoring an equally critical parallel branch. {@link pxPaths} counts them.
 *
 * 3. A CYCLE MEANS NO SCHEDULE EXISTS, SO THE PASSES ARE REFUSED. Earliest start is defined by
 *    recursion over predecessors; with a cycle the recursion has no base case and the quantity does
 *    not exist. This card finds the cycle ({@link pxCycle}), names the tasks in it, draws the
 *    structure with the offending edges marked, and computes no floats at all. Dropping an edge to
 *    make the arithmetic run would answer a question the data does not pose, in a way the reader
 *    could not detect.
 *
 * Everything geometric is computed by {@link pxRender}, the same function in Node and in the
 * browser: Node runs it once for the picture inside `card.html`, and the browser re-runs it when a
 * setting changes, so the caption can never describe a drawing that is not on the screen. `CK` comes
 * out of `kit.js` in a `node:vm` context, so `CK.scale`, `CK.ticks` and `CK.esc` here are the ones
 * the page has.
 *
 * @see ./gantt.mjs — the same network against a calendar; that card answers WHEN, this one answers
 *                    HOW MUCH CAN SLIP. Their critical paths agree on the same network by
 *                    construction, and this card's verification asserts it against `gantt`'s own
 *                    `gxCritical`
 * @see ./burndown.mjs — what is left, once the plan is being executed
 * @see ../CONTRACT.md — `shape` is a string, `defaults` is an object, `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be imported.
 * Its top level only defines functions and one array, so a bare context carrying a `window` object
 * is enough to run it. Loading it rather than re-implementing `scale` and `ticks` is the contract's
 * rule: a private copy is a second source of truth and it drifts silently.
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
  catch (e) { throw new Error('cardkit/pert: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/pert: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const WMAX = 2200;

/* Caps on the PAYLOAD, not on the arithmetic: every count in the caption comes from the complete
   input before anything is dropped, and every drop is itself reported. */
const TASKCAP = 400;
const DEPCAP  = 1600;

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it; a binding declared after `meta` could not be referenced by it at all.
 *
 * `form` defaults to `auto` because the network form is unreadable past a few dozen boxes and the
 * float form is unreadable for nobody — so the card picks, and says in the caption when it fell
 * back. `free` is a setting rather than always-on only because the free-float segment is a second
 * quantity in the same tail and a reader comparing total floats across a large plan may want the
 * tail to be one length; the caption states both numbers either way, so turning it off costs a
 * drawing and never a fact.
 *
 * @example defaults.form;   // 'auto'
 */
export const defaults = { form: 'auto', free: true, nums: true };

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `work-and-lists` — "what is outstanding, and what can I do about it?" The second half of that
 * question is float, literally: which tasks can absorb a delay and which cannot. It is not
 * `flow-and-relationship` even though the network form is a node-link diagram, because a reader
 * arrives at a PERT chart holding a scheduling question rather than a topology question, and the
 * category indexes the question rather than the silhouette.
 */
export const meta = {
  name: 'pert',
  summary:
    'An activity-on-node network with the forward and backward passes run, drawing total float ' +
    'and free float as separate quantities and deriving the critical path from them.',
  shape:
    '{ tasks: [{ id, label, dur, deps: [id] }], unit, title } — dur is a duration in units of ' +
    "'unit'; a task with no dur may give start and end instead when unit names a time (ms, s, " +
    'min, h, d, w), and the elapsed difference becomes the duration',
  category: 'work-and-lists',
  /* Two drawings of one analysis, declared rather than split into two types. They answer ONE
     question — how much can slip — and share every line of arithmetic; what differs is whether the
     reader is looking at the shape of the network or at the size of the floats. Splitting would
     duplicate the passes, the cycle search and the path count, which is exactly the drift a
     catalogue exists to prevent. */
  forms: [
    { name: 'network', via: "form: 'network'",
      summary: 'Activity-on-node boxes in dependency layers, each carrying its own four times.' },
    { name: 'floats', via: "form: 'floats'",
      summary: 'One row per task on a shared elapsed-time axis, with the float drawn as a tail.' },
  ],
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
 * never written in this file; it is reached for as `String.fromCharCode(96)`, which cannot be
 * mistyped and cannot be mis-decoded during emission.
 *
 * Backtick, arrow and optional chaining are scanned raw, because none of them can appear innocently.
 * The declaration keywords are scanned only after {@link blankNonCode}, because they can and do
 * appear innocently in English.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/pert';
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
 * script and the build-time guard would refuse the whole card. Removing them once, here, means both
 * paths see the same text.
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
 * Milliseconds in one of the caller's units, or 0 when the unit does not name a time.
 *
 * This is the only thing that lets `start` and `end` stand in for `dur`. A unit of `points` or
 * `story points` is not a time, so an elapsed millisecond difference cannot be converted into it and
 * the conversion is refused rather than performed at a factor of one — which would silently turn a
 * three-day task into a duration of 259200000.
 *
 * @example unitMs('d');       // 86400000
 * @example unitMs('points');  // 0
 */
function unitMs(unit) {
  const u = String(unit == null ? '' : unit).trim().toLowerCase();
  if (u === 'ms' || u === 'millisecond' || u === 'milliseconds') return 1;
  if (u === 's' || u === 'sec' || u === 'secs' || u === 'second' || u === 'seconds') return 1000;
  if (u === 'm' || u === 'min' || u === 'mins' || u === 'minute' || u === 'minutes') return 60000;
  if (u === 'h' || u === 'hr' || u === 'hrs' || u === 'hour' || u === 'hours') return 3600000;
  if (u === '' || u === 'd' || u === 'day' || u === 'days') return 86400000;
  if (u === 'w' || u === 'wk' || u === 'week' || u === 'weeks') return 604800000;
  return 0;
}

/**
 * One instant as epoch milliseconds, or null when the value is not a time.
 *
 * Refused rather than coerced: `Number('')` is 0 and `Date.parse` of anything it does not recognise
 * is `NaN`, and either one would invent a duration out of a typo.
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
 * A finite non-negative number, or null. Strings are parsed; everything else is refused.
 *
 * The boolean guard and the trip through `String()` are independent defences and either one alone
 * refuses a boolean — mutation testing found that removing either is an equivalent edit. The guard
 * stays because it states the intent where a reader will look for it, but the load is carried by
 * never handing a non-number straight to `Number`.
 *
 * @example readDur('3.5');   // 3.5
 * @example readDur(-1);      // null
 * @example readDur('soon');  // null
 */
function readDur(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Normalise whatever arrived into the task list and the dependency network the renderer may assume.
 *
 * Nothing throws and nothing is coerced. A card is handed data by a desk and must still draw, so
 * every malformed input becomes a refusal that is counted and named in the caption:
 *
 *   - a task with no id is refused; an id is the only thing a dependency can name;
 *   - a duplicate id keeps its first task and the repeats are dropped and counted;
 *   - a task with no readable duration is refused, never defaulted to zero — a zero-duration task is
 *     a milestone, which is a real and different claim, and inventing one would put a task on the
 *     critical path or off it by accident;
 *   - a negative duration is refused rather than made positive;
 *   - start and end stand in for a missing duration only when `unit` names a time, and the
 *     conversion is refused and counted when it does not;
 *   - a dependency naming a task that does not exist is refused as an edge, counted and named;
 *   - a self-dependency is refused as an edge and counted separately, because a task preceding
 *     itself states no ordering at all — unlike a two-cycle, which states one that cannot be met.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns the payload {@link pxRender} takes, plus the counts the caption reports
 *
 * @example readData({ tasks: [{ id: 'a', dur: 3 }] }).tasks[0].dur;   // 3
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawTasks = Array.isArray(d.tasks) ? d.tasks : [];

  const unit = clean(d.unit == null ? '' : d.unit).trim();
  const perUnit = unitMs(unit);

  const refused = [];
  const dupIds = [];
  const badEdges = [];
  let selfDeps = 0;
  let droppedTasks = 0;
  let droppedDeps = 0;
  let fromDates = 0;
  let noTimeUnit = 0;

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

    let dur = readDur(t.dur);
    let derived = false;
    if (dur === null) {
      const s = readTime(t.start);
      const e = readTime(t.end);
      if (s !== null && e !== null) {
        if (!perUnit) {
          noTimeUnit++;
          refused.push(who + ' gives start and end, but ' + JSON.stringify(unit) +
                       ' does not name a time, so no duration can be derived');
          continue;
        }
        if (e < s) { refused.push(who + ' ends before it starts'); continue; }
        dur = (e - s) / perUnit;
        derived = true;
        fromDates++;
      }
    }
    if (dur === null) { refused.push(who + ' has no readable duration'); continue; }
    if (tasks.length >= TASKCAP) { droppedTasks++; continue; }

    index.set(id, tasks.length);
    tasks.push({ id, label: label || id, dur, derived });
    rawDeps.push(Array.isArray(t.deps) ? t.deps : []);
  }

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
    tasks, pred, succ, unit,
    title: clean(d.title == null ? '' : d.title),
    refused, dupIds, badEdges, selfDeps, droppedTasks, droppedDeps, edges,
    fromDates, noTimeUnit,
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
    throw new Error('cardkit/pert: non-finite coordinate (' + v + ')');
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
 * A number for display: exact when it is a whole number, two decimals otherwise.
 *
 * Durations are allowed to be fractional, and a plan in half-days should not print 3.5000000001
 * because a backward pass subtracted its way there.
 *
 * @example fmtNum(3);      // '3'
 * @example fmtNum(3.5);    // '3.5'
 */
function fmtNum(v) {
  if (typeof v !== 'number' || !isFinite(v)) { return '–'; }
  var r = Math.round(v * 100) / 100;
  if (r === Math.round(r)) { return String(Math.round(r)); }
  return String(r);
}

/** A duration with the caller's unit word appended, when there is one. */
function fmtDur(v, unit) { return fmtNum(v) + (unit ? ' ' + unit : ''); }

/**
 * Settle a settings object into the three values the renderer may assume.
 *
 * Called with nothing it must return exactly the declared defaults; the verification asserts that,
 * so the shipped copy and the declared metadata cannot drift apart without something failing.
 *
 * @example pxConfig({ form: 'floats' }).nums;   // true
 */
function pxConfig(conf) {
  var c = conf && typeof conf === 'object' ? conf : {};
  return {
    form: c.form === 'network' || c.form === 'floats' ? c.form : 'auto',
    free: c.free === undefined || c.free === null ? true : !!c.free,
    nums: c.nums === undefined || c.nums === null ? true : !!c.nums
  };
}

/**
 * The tasks on the first dependency cycle, or an empty list when the network is acyclic.
 *
 * A depth-first walk colouring nodes white, grey and black; an edge into a grey node is a back edge
 * and the grey stack from that node onward is the cycle. Naming the tasks is the whole point — a
 * card that said only "cyclic" would leave the reader to find the loop by hand in a network the card
 * has already traversed.
 *
 * @param succ successor lists by task index
 * @returns task indices in cycle order, the repeated first node omitted from the end
 *
 * @example pxCycle(2, [[1], [0]]).length;   // 2
 */
function pxCycle(n, succ) {
  var colour = [], stack = [], found = [], i;
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
 * The forward and backward passes: earliest and latest times, and both floats.
 *
 * Kahn's algorithm gives the topological order. A forward sweep over it gives earliest start (the
 * largest earliest finish among predecessors) and earliest finish; the project duration is the
 * largest earliest finish anywhere. A backward sweep gives latest finish (the smallest latest start
 * among successors, or the project finish for a task with none) and latest start.
 *
 * TOTAL FLOAT is latest start minus earliest start: how far the task can slip before the project
 * finish moves. FREE FLOAT is the earliest of its successors' earliest starts minus its own earliest
 * finish: how far it can slip before any SUCCESSOR has to move. Free float is never larger and is
 * frequently zero where total float is not, which is the distinction this whole card exists to draw.
 *
 * When the topological order comes up short the network has a cycle, so earliest start has no base
 * case and none of these quantities exist. This returns `ok: false` rather than breaking an edge:
 * dropping one to get numbers would answer a question the data does not pose.
 *
 * @param tasks tasks carrying `dur`
 * @param pred predecessor lists by task index
 * @param succ successor lists by task index
 * @returns `{ ok, order, es, ef, ls, lf, tf, ff, T, eps }`
 *
 * @example
 * pxPasses([{ dur: 2 }, { dur: 3 }], [[], [0]], [[1], []]).T;   // 5
 */
function pxPasses(tasks, pred, succ) {
  var n = tasks.length, i, j, u, v, head = 0, s, f, m;
  var indeg = [], queue = [], order = [];

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
  if (order.length < n) { return { ok: false, order: [], T: 0, eps: 0 }; }

  var es = [], ef = [], ls = [], lf = [], tf = [], ff = [], crit = [];
  for (i = 0; i < n; i++) { es.push(0); ef.push(0); ls.push(0); lf.push(0); tf.push(0); ff.push(0); crit.push(false); }

  for (i = 0; i < order.length; i++) {
    u = order[i];
    s = 0;
    for (j = 0; j < pred[u].length; j++) { if (ef[pred[u][j]] > s) { s = ef[pred[u][j]]; } }
    es[u] = s;
    ef[u] = s + tasks[u].dur;
  }

  var T = 0;
  for (i = 0; i < n; i++) { if (ef[i] > T) { T = ef[i]; } }

  for (i = order.length - 1; i >= 0; i--) {
    u = order[i];
    f = T;
    for (j = 0; j < succ[u].length; j++) { if (ls[succ[u][j]] < f) { f = ls[succ[u][j]]; } }
    lf[u] = f;
    ls[u] = f - tasks[u].dur;
  }

  /* Durations may be fractional, so a float that is mathematically zero can arrive as a value a few
     ulps either side of it. The tolerance is relative to the project duration, which is the largest
     quantity any of these sums can reach, and it is applied ONCE here so that every later question
     about criticality asks the same question. */
  var eps = T > 0 ? T * 1e-9 : 1e-9;

  for (i = 0; i < n; i++) {
    tf[i] = ls[i] - es[i];
    if (tf[i] < 0 && tf[i] > -eps) { tf[i] = 0; }
    m = -1;
    for (j = 0; j < succ[i].length; j++) {
      if (m < 0 || es[succ[i][j]] < m) { m = es[succ[i][j]]; }
    }
    ff[i] = (succ[i].length ? m : T) - ef[i];
    if (ff[i] < 0 && ff[i] > -eps) { ff[i] = 0; }
    crit[i] = tf[i] <= eps;
  }

  return { ok: true, order: order, es: es, ef: ef, ls: ls, lf: lf, tf: tf, ff: ff,
           crit: crit, T: T, eps: eps };
}

/**
 * How many distinct critical paths the network has.
 *
 * The critical subgraph is the zero-float tasks joined by TIGHT edges — an edge from u to v where v
 * starts exactly when u finishes. Every zero-float task with any predecessor has at least one tight
 * critical predecessor (the one whose earliest finish set its earliest start must itself have zero
 * float), so the subgraph decomposes cleanly into paths from a critical task with no predecessors to
 * a critical task with no successors, and counting is one pass of addition over the topological
 * order.
 *
 * The count is capped, because a network of k parallel equal branches has an exponential number of
 * critical paths and the interesting fact past a few dozen is only that there are very many.
 *
 * @returns `{ paths, saturated, ways }`
 *
 * @example
 * pxPaths(2, [0, 1], [[], [0]], [[1], []], [true, true], [0, 2], [2, 5], 0, 999).paths;   // 1
 */
function pxPaths(n, order, pred, succ, crit, es, ef, eps, cap) {
  var ways = [], i, j, u, p, acc, total = 0, sat = false, sink;
  for (i = 0; i < n; i++) { ways.push(0); }

  for (i = 0; i < order.length; i++) {
    u = order[i];
    if (!crit[u]) { continue; }
    acc = 0;
    for (j = 0; j < pred[u].length; j++) {
      p = pred[u][j];
      if (crit[p] && Math.abs(ef[p] - es[u]) <= eps) { acc += ways[p]; }
    }
    if (acc === 0) { acc = 1; }
    if (acc > cap) { acc = cap; sat = true; }
    ways[u] = acc;
  }

  for (i = 0; i < n; i++) {
    if (!crit[i]) { continue; }
    sink = true;
    for (j = 0; j < succ[i].length; j++) {
      if (crit[succ[i][j]] && Math.abs(ef[i] - es[succ[i][j]]) <= eps) { sink = false; break; }
    }
    if (sink) { total += ways[i]; }
  }
  if (total > cap) { total = cap; sat = true; }
  return { paths: total, saturated: sat, ways: ways };
}

/**
 * Weakly connected components of the dependency network.
 *
 * Direction is ignored on purpose: two tasks joined by a dependency are part of one plan whichever
 * way the arrow points. The count matters because the project finish is the latest finish across
 * ALL components, so a task in a short component acquires float purely from a longer component it
 * never touches — a fact the caption states, because it is an artifact of drawing two plans on one
 * card rather than a property of either plan.
 *
 * @returns `{ comp, count }` — a component index per task
 *
 * @example pxComponents(3, [[], [], []], [[], [], []]).count;   // 3
 */
function pxComponents(n, pred, succ) {
  var comp = [], i, j, k, at, u, stack, count = 0;
  for (i = 0; i < n; i++) { comp.push(-1); }
  for (i = 0; i < n; i++) {
    if (comp[i] >= 0) { continue; }
    comp[i] = count;
    stack = [i];
    while (stack.length) {
      u = stack.pop();
      for (j = 0; j < pred[u].length; j++) {
        at = pred[u][j];
        if (comp[at] < 0) { comp[at] = count; stack.push(at); }
      }
      for (k = 0; k < succ[u].length; k++) {
        at = succ[u][k];
        if (comp[at] < 0) { comp[at] = count; stack.push(at); }
      }
    }
    count++;
  }
  return { comp: comp, count: count };
}

/**
 * Back edges of a depth-first walk: the smallest set this layering has to ignore to have layers.
 *
 * Longest-path layering needs an acyclic graph. When the network has a cycle the passes are refused
 * outright and no float is computed, but the STRUCTURE is still worth drawing — it is the only thing
 * left to show, and the reader needs to see where the loop is. So the layering ignores back edges
 * and the drawing marks them, rather than the card silently pretending the loop is not there.
 *
 * @returns an object used as a set, keyed `predIndex>succIndex`
 *
 * @example pxBack(2, [[1], [0]])['1>0'];   // 1
 */
function pxBack(n, succ) {
  var colour = [], back = {}, root, stack, top, v, i;
  for (i = 0; i < n; i++) { colour.push(0); }

  for (root = 0; root < n; root++) {
    if (colour[root]) { continue; }
    stack = [{ v: root, k: 0 }];
    colour[root] = 1;
    while (stack.length) {
      top = stack[stack.length - 1];
      if (top.k < succ[top.v].length) {
        v = succ[top.v][top.k++];
        if (colour[v] === 1) { back[top.v + '>' + v] = 1; }
        else if (colour[v] === 0) { colour[v] = 1; stack.push({ v: v, k: 0 }); }
      } else {
        colour[top.v] = 2;
        stack.pop();
      }
    }
  }
  return back;
}

/**
 * Longest-path layering over the network with back edges removed.
 *
 * Layers are DEPENDENCY DEPTH, not time. That is deliberate and worth stating, because the obvious
 * alternative — a column per earliest-start value — would turn this form into a schedule, which is
 * the picture `gantt` already draws. What an activity-on-node diagram is for is the shape of the
 * network, so the x position is how many dependencies deep a task is and the times live inside the
 * boxes where they can be read exactly rather than estimated off an axis.
 *
 * @returns `{ layer, layers }`
 *
 * @example pxLayer(2, [[], [0]], [[1], []], {}).layers;   // 2
 */
function pxLayer(n, pred, succ, back) {
  var indeg = [], layer = [], queue = [], i, j, u, v, head = 0, most = 0;
  for (i = 0; i < n; i++) { layer.push(0); indeg.push(0); }
  for (u = 0; u < n; u++) {
    for (j = 0; j < succ[u].length; j++) {
      if (!back[u + '>' + succ[u][j]]) { indeg[succ[u][j]]++; }
    }
  }
  for (i = 0; i < n; i++) { if (indeg[i] === 0) { queue.push(i); } }
  while (head < queue.length) {
    u = queue[head++];
    for (j = 0; j < succ[u].length; j++) {
      v = succ[u][j];
      if (back[u + '>' + v]) { continue; }
      if (layer[v] < layer[u] + 1) { layer[v] = layer[u] + 1; }
      if (--indeg[v] === 0) { queue.push(v); }
    }
  }
  for (i = 0; i < n; i++) { if (layer[i] > most) { most = layer[i]; } }
  return { layer: layer, layers: n ? most + 1 : 0 };
}

/** Crossings between adjacent layers for one row ordering, counted exactly by inversion. */
function pxCross(n, layer, pos, succ) {
  var pairs = [], u, k, v, i, j, c = 0;
  for (u = 0; u < n; u++) {
    for (k = 0; k < succ[u].length; k++) {
      v = succ[u][k];
      if (layer[v] === layer[u] + 1) { pairs.push([layer[u], pos[u], pos[v]]); }
    }
  }
  for (i = 0; i < pairs.length; i++) {
    for (j = i + 1; j < pairs.length; j++) {
      if (pairs[i][0] !== pairs[j][0]) { continue; }
      if ((pairs[i][1] - pairs[j][1]) * (pairs[i][2] - pairs[j][2]) < 0) { c++; }
    }
  }
  return c;
}

/**
 * Row order within each layer, by repeated barycentre sweeps, keeping the best rather than the last.
 *
 * A barycentre sweep is not monotone — a pass can make the drawing worse — so the crossing count is
 * measured after every pass and the best ordering seen is what comes back. Keeping the last would
 * make the picture depend on the parity of a loop bound, which is not a property of the plan.
 *
 * @returns rows of task indices, one row list per layer
 *
 * @example pxOrder(2, [0, 1], 2, [[], [0]], [[1], []])[0][0];   // 0
 */
function pxOrder(n, layer, layers, pred, succ) {
  var rows = [], pos = [], i, l, pass, k, at, row, bar, j, u, nb, sum, cnt, q, want;
  for (l = 0; l < layers; l++) { rows.push([]); }
  for (i = 0; i < n; i++) { rows[layer[i]].push(i); }
  for (i = 0; i < n; i++) { pos.push(0); }

  function reindex(rr) {
    var a, b;
    for (a = 0; a < rr.length; a++) { for (b = 0; b < rr[a].length; b++) { pos[rr[a][b]] = b; } }
  }
  function copy(rr) {
    var out = [], a;
    for (a = 0; a < rr.length; a++) { out.push(rr[a].slice()); }
    return out;
  }

  reindex(rows);
  var best = copy(rows), bestCross = pxCross(n, layer, pos, succ);

  for (pass = 0; pass < 8; pass++) {
    var down = pass % 2 === 0;
    for (k = 1; k < layers; k++) {
      at = down ? k : layers - 1 - k;
      want = at + (down ? -1 : 1);
      row = rows[at];
      bar = [];
      for (j = 0; j < row.length; j++) {
        u = row[j];
        nb = down ? pred[u] : succ[u];
        sum = 0; cnt = 0;
        for (q = 0; q < nb.length; q++) {
          if (layer[nb[q]] === want) { sum += pos[nb[q]]; cnt++; }
        }
        bar.push({ u: u, v: cnt ? sum / cnt : pos[u], at: j });
      }
      bar.sort(function (a, b) { return a.v - b.v || a.at - b.at; });
      for (j = 0; j < bar.length; j++) { row[j] = bar[j].u; }
      reindex(rows);
    }
    var got = pxCross(n, layer, pos, succ);
    if (got < bestCross) { bestCross = got; best = copy(rows); }
  }

  reindex(best);
  return best;
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
 * A milestone, as a diamond rather than as a bar of zero width.
 *
 * A zero-duration task drawn as a rect is a rect of width zero, which paints nothing at all and
 * leaves a row that looks empty next to a caption that counts a task in it. A milestone can be
 * critical and carries float like anything else, so it has to be visible.
 *
 * @example mDiamond(10, 10, 4, 'ck-px-ms').a.d.charAt(0);   // 'M'
 */
function mDiamond(cx, cy, r, cls) {
  return mPath('M' + fin(cx) + ' ' + fin(cy - r) + ' L' + fin(cx + r) + ' ' + fin(cy) +
               ' L' + fin(cx) + ' ' + fin(cy + r) + ' L' + fin(cx - r) + ' ' + fin(cy) + ' Z', cls);
}

/**
 * Metrics for one form. Shipped rather than held in a module constant on purpose.
 *
 * A shipped function that closed over a build-time constant runs in Node and throws a reference
 * error in the browser the moment a setting changes, which is the failure that only shows up on the
 * desk. Everything the renderer needs to size itself is therefore returned from here.
 *
 * @example pxMetrics('floats', 10, true).rowH;   // 18
 */
function pxMetrics(form, n, nums) {
  var rowH = n > 80 ? 12 : n > 40 ? 15 : 18;
  return {
    pad:     12,
    top:     26,
    foot:    16,
    rowH:    rowH,
    barH:    Math.max(6, rowH - 6),
    labMax:  150,
    boxW:    nums ? 118 : 104,
    boxH:    nums ? 46 : 30,
    gapX:    38,
    gapY:    14,
    chan:    22,
    netCap:  48,
    pathCap: 9999
  };
}

/** Task labels around a cycle, closed back onto the first so the loop is visible. */
function pxCycNames(T, cyc) {
  var out = [], i;
  for (i = 0; i < cyc.length && i < 8; i++) { out.push(T[cyc[i]].label); }
  if (cyc.length > 8) { out.push('and ' + (cyc.length - 8) + ' more'); }
  return out.join(' then ') + ' then ' + T[cyc[0]].label + ' again';
}

/** A few task labels, named. */
function pxSome(T, list, cap) {
  var out = [], i, lim = cap || 4;
  for (i = 0; i < list.length && i < lim; i++) { out.push(T[list[i]].label); }
  if (list.length > lim) { out.push('and ' + (list.length - lim) + ' more'); }
  return out.join(', ');
}

/**
 * The legend, which has to be rebuilt with the drawing because it describes the drawing.
 *
 * Emitted as markup rather than as marks inside the SVG so it can wrap on a narrow desk, and rebuilt
 * by the browser half alongside the caption — a legend left behind by a form change is a legend that
 * lies, and this card has two forms that share almost no vocabulary.
 *
 * @returns markup for the legend row, or '' when there is nothing to explain
 */
function pxKey(form, c, ok, unit) {
  var bits = [], i;
  if (!ok) { return ''; }
  if (form === 'floats') {
    bits.push('<i data-k="bar"></i>earliest start to earliest finish');
    if (c.free) { bits.push('<i data-k="ff"></i>free float: slips nothing'); }
    bits.push('<i data-k="tf"></i>' + (c.free ? 'the rest of the total float' : 'total float') +
              ': slips a successor');
    bits.push('<i data-k="crit"></i>zero total float, so critical');
  } else {
    if (c.nums) {
      bits.push('<i data-k="box"></i>ES &middot; duration &middot; EF above, ' +
                'LS &middot; total/free float &middot; LF below');
    } else {
      bits.push('<i data-k="box"></i>total float / free float under each name');
    }
    bits.push('<i data-k="crit"></i>zero total float, so critical');
    bits.push('<i data-k="edge"></i>a dependency; solid where both ends are critical');
  }
  if (unit) { bits.push('times in ' + CK.esc(unit)); }
  /* Every entry closes with a full stop INSIDE its span. On screen the stop is a nine-pixel
     nothing; flattened, it is the only thing stopping one entry running into the next and into the
     caption after them, which is how a legend turns into an unparseable clause. */
  for (i = 0; i < bits.length; i++) { bits[i] = '<span>' + bits[i] + '.</span>'; }
  /* Joined with a space rather than with nothing. The legend is a flex row, so a whitespace-only
     text node between two entries is dropped on screen and costs exactly nothing — and without it
     the flattened form a screen reader or a copy-paste receives reads
     "free float: slips nothingthe rest of the total float". Nothing looks wrong; everything sounds
     wrong. */
  return bits.join(' ');
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The caption's order is the card's argument in order. First what the plan costs end to end, then
 * the critical set derived from the float and how many distinct critical paths there are, then the
 * total-versus-free distinction stated in the data's own terms wherever the data contains an example
 * of it. Refusals come last, because they are about the input rather than about the plan.
 *
 * Every bit ends in a full stop. That is not a style preference: these are joined with a single
 * space and read back as one flattened string by screen readers and by anyone who copies the card,
 * and a bit without a terminal stop runs its last word into the next bit's first.
 *
 * @returns `{ aria, caption, key }` — plain text, escaped markup, and the legend
 */
function pxNote(P, c, R) {
  var T = P.tasks, n = T.length, i, bits = [], names = [];

  if (!n) {
    return {
      aria: 'PERT network with no tasks: there is nothing to schedule.',
      caption: 'a network with <b>no tasks</b> &mdash; the card keeps its place, but there is ' +
               'nothing in it to schedule.' +
               (P.refused.length ? ' <i>' + P.refused.length + ' input' +
                 (P.refused.length === 1 ? '' : 's') + ' refused</i>: ' +
                 CK.esc(P.refused.slice(0, 4).join('; ')) + '.' : ''),
      key: ''
    };
  }

  var critList = [], slack = [], zeroFree = [], zeroDur = 0, pinch = -1;
  if (R.ok) {
    for (i = 0; i < n; i++) {
      if (R.crit[i]) { critList.push(i); } else { slack.push(i); }
      if (!R.crit[i] && R.ff[i] <= R.eps) { zeroFree.push(i); if (pinch < 0) { pinch = i; } }
      if (T[i].dur === 0) { zeroDur++; }
    }
  }

  for (i = 0; i < n && i < 8; i++) {
    names.push(T[i].label + ', ' + fmtDur(T[i].dur, P.unit) +
               (R.ok ? ', total float ' + fmtNum(R.tf[i]) + ', free float ' + fmtNum(R.ff[i]) : ''));
  }
  if (n > 8) { names.push('and ' + (n - 8) + ' more'); }

  var aria = R.ok
    ? 'PERT network of ' + n + ' ' + (n === 1 ? 'task' : 'tasks') + ', ' +
      fmtDur(R.T, P.unit) + ' from first start to last finish. ' +
      critList.length + ' of them have zero total float and are therefore critical, on ' +
      R.paths + (R.saturated ? ' or more' : '') + ' distinct critical ' +
      (R.paths === 1 ? 'path' : 'paths') + '. Tasks: ' + names.join('. ') + '.'
    : 'PERT network of ' + n + ' ' + (n === 1 ? 'task' : 'tasks') +
      ' whose dependencies are cyclic, so no schedule exists and no float is computed. ' +
      'The loop runs ' + pxCycNames(T, R.cyc) + '.';

  if (!R.ok) {
    bits.push('<b>the dependencies are cyclic</b> &mdash; ' + CK.esc(pxCycNames(T, R.cyc)) +
              ' &mdash; so <b>no schedule exists</b> and the forward and backward passes are ' +
              'refused. Earliest start is defined by recursion over predecessors, and a loop ' +
              'leaves that recursion with no base case, so the quantity does not exist rather than ' +
              'being hard to compute. Dropping an edge to make the arithmetic run would produce ' +
              'earliest and latest times for a plan that cannot be executed, and nothing in the ' +
              'picture would tell the reader which edge was thrown away.');
    bits.push('the structure is still drawn, because it is the only thing left to show, and the ' +
              'edges that close the loop are marked.');
  } else {
    bits.push('<b>' + critList.length + '</b> of them ' +
              (critList.length === 1 ? 'has' : 'have') + ' <b>zero total float</b>, which is what ' +
              'puts ' + (critList.length === 1 ? 'it' : 'them') + ' on the critical path: ' +
              'membership is <i>derived from the float</i> rather than tracked beside it, so the ' +
              'two cannot come to disagree.');

    if (R.paths === 1) {
      bits.push('there is exactly <b>one</b> critical path here, ' +
                CK.esc(pxSome(T, R.critOrder, 8)) + '.');
    } else {
      bits.push('there ' + (R.saturated ? 'are more than ' : 'are ') + '<b>' + R.paths +
                '</b> distinct critical paths through this network, not one. A card that ' +
                'highlighted a single chain would imply it was the only one, which is how a team ' +
                'protects one branch and lets an equally critical parallel branch slip.');
    }

    /* The card's whole thesis, stated in the data's own numbers when the data contains an example
       and stated abstractly when it does not. Naming a real task is what makes the distinction land;
       saying it in the general case is what stops the sentence from being absent on the plans that
       happen not to contain one. */
    if (pinch >= 0) {
      bits.push('<b>total float and free float are different numbers.</b> Total float is how long a ' +
                'task can slip before the finish date moves; free float is how long it can slip ' +
                'before <i>any successor</i> has to move. ' + CK.esc(T[pinch].label) + ' has <b>' +
                CK.esc(fmtDur(R.tf[pinch], P.unit)) + '</b> of total float and <b>none at all</b> ' +
                'of free float, so it cannot slip by any amount without pushing something, even ' +
                'though it is not on the critical path. Conflating the two is the common error and ' +
                'this is the shape it takes.');
    } else {
      bits.push('<b>total float and free float are different numbers</b> &mdash; how long a task ' +
                'can slip before the finish moves, against how long it can slip before any ' +
                'successor moves &mdash; and conflating them is the common error. In this network ' +
                'they happen to agree for every task, so the tail has only one segment; that is a ' +
                'property of this plan and not of the measure.');
    }

    if (critList.length === n) {
      bits.push('<i>every</i> task here has zero total float, so nothing in this plan can slip at ' +
                'all without moving the finish.');
    }
    /* Said once, plainly, because readers ask it and the answer is a proof rather than an opinion. */
    bits.push('<span class="ck-aside">There is no such thing as a network with nothing on its ' +
              'critical path: the finish is some task’s earliest finish, and walking forward ' +
              'from it reaches a task with no successors whose latest finish is therefore the ' +
              'project finish, so its float is zero by construction.</span>');

    if (R.comps > 1) {
      bits.push('the network is in <b>' + R.comps + '</b> disjoint pieces. The finish is the ' +
                'latest finish across all of them, so a task in a shorter piece shows float it ' +
                'only has because a piece it never touches runs longer. If they do not share a ' +
                'deadline, that float is an artifact of drawing two plans on one card.');
    }
    if (zeroDur) {
      bits.push('<b>' + zeroDur + '</b> task' + (zeroDur === 1 ? '' : 's') + ' ' +
                (zeroDur === 1 ? 'has' : 'have') + ' zero duration and ' +
                (zeroDur === 1 ? 'is drawn as a diamond' : 'are drawn as diamonds') +
                '; a milestone can be critical and carries float like anything else.');
    }
    if (!P.edges) {
      bits.push('no dependencies were given, so every task starts at zero and the critical path ' +
                'is whichever ' + (n === 1 ? 'task there is' : 'tasks are longest') + '.');
    }
  }

  if (R.form === 'network' && R.fell) {
    bits.push('the network form was asked for and refused: at <b>' + n + '</b> tasks the boxes ' +
              'would be too small to read, so the float rows are drawn instead.');
  } else if (R.fellAuto) {
    bits.push('drawn as float rows rather than as a node network, because <b>' + n + '</b> tasks ' +
              'is past the point where boxes fit; the network form is in the gear.');
  }
  if (R.form === 'network' && R.crossings) {
    bits.push('the layers are dependency depth rather than time, ordered to reduce crossings to <b>' +
              R.crossings + '</b>; the exact times are inside the boxes, where they can be read ' +
              'rather than estimated off an axis.');
  }
  if (P.fromDates) {
    bits.push('<b>' + P.fromDates + '</b> duration' + (P.fromDates === 1 ? '' : 's') +
              ' came from a start and an end rather than from a stated length, converted at ' +
              CK.esc(P.unit || 'd') + ' per unit.');
  }

  if (P.refused.length) {
    bits.push('<i>' + P.refused.length + ' task' + (P.refused.length === 1 ? '' : 's') +
              ' refused</i>: ' + CK.esc(P.refused.slice(0, 4).join('; ')) +
              (P.refused.length > 4 ? ', and ' + (P.refused.length - 4) + ' more' : '') +
              '. A missing duration is never defaulted to zero, because a zero-duration task is a ' +
              'milestone and that is a different claim.');
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
              '</i> dropped &mdash; a task preceding itself states no ordering at all, so it is a ' +
              'typo rather than a cycle and the passes still run.');
  }
  if (P.droppedTasks) {
    bits.push('<i>' + P.droppedTasks + ' tasks past the drawing budget</i> were left out.');
  }
  if (P.droppedDeps) {
    bits.push('<i>' + P.droppedDeps + ' dependencies past the budget</i> were left out.');
  }

  var caption =
    'float &mdash; <b>' + n + '</b> ' + (n === 1 ? 'task' : 'tasks') +
    (R.ok ? ', <b>' + CK.esc(fmtDur(R.T, P.unit)) + '</b> from first start to last finish' : '') +
    '. ' + bits.join(' ');

  return { aria: aria, caption: caption, key: pxKey(R.form, c, R.ok, P.unit) };
}

/**
 * Everything the card draws, from the payload and one settings object.
 *
 * The same function in Node and in the browser, so the caption can never describe a drawing that is
 * not the drawing on the screen. It runs the passes, derives criticality from the float, counts the
 * critical paths, chooses a form, and returns a display list.
 *
 * @param P    the payload from {@link readData}
 * @param conf a settings object, settled by {@link pxConfig}
 * @returns `{ W, H, marks, note, ok, T, tf, ff, crit, paths, form }`
 *
 * @example pxRender(P, { form: 'floats' }).ok;
 */
function pxRender(P, conf) {
  var c = pxConfig(conf);
  var T = P.tasks, n = T.length, i, j, k;
  var M = pxMetrics('floats', n, c.nums);

  var cyc = pxCycle(n, P.succ);
  var pass = pxPasses(T, P.pred, P.succ);
  var ok = pass.ok && !cyc.length;
  var comp = pxComponents(n, P.pred, P.succ);

  var R = {
    ok: ok, cyc: cyc, comps: comp.count, T: ok ? pass.T : 0, eps: ok ? pass.eps : 0,
    es: pass.es, ef: pass.ef, ls: pass.ls, lf: pass.lf, tf: pass.tf, ff: pass.ff,
    crit: pass.crit, paths: 0, saturated: false, critOrder: [],
    form: 'floats', fell: false, fellAuto: false, crossings: 0
  };

  if (ok) {
    var count = pxPaths(n, pass.order, P.pred, P.succ, pass.crit, pass.es, pass.ef, pass.eps, M.pathCap);
    R.paths = count.paths;
    R.saturated = count.saturated;
    for (i = 0; i < n; i++) { if (pass.crit[i]) { R.critOrder.push(i); } }
    R.critOrder.sort(function (a, b) { return pass.es[a] - pass.es[b] || a - b; });
  }

  /* Form choice. A cycle leaves nothing to say about float, so the structure is the only thing
     worth drawing and the network form wins whenever it fits at all. */
  var fits = n > 0 && n <= M.netCap;
  if (c.form === 'network') { R.form = fits ? 'network' : 'floats'; R.fell = !fits; }
  else if (c.form === 'floats') { R.form = 'floats'; }
  else { R.form = fits && (!ok || n <= 24) ? 'network' : 'floats'; R.fellAuto = !fits || (ok && n > 24); }
  if (!n) { R.form = 'floats'; R.fellAuto = false; }

  if (!n) {
    R.W = P.W0; R.H = 130;
    R.marks = [mText(P.W0 / 2, 68, 'no tasks', 'ck-px-empty', 'middle')];
    R.note = pxNote(P, c, R);
    return R;
  }

  if (R.form === 'network') { pxDrawNet(P, c, R, M); }
  else { pxDrawFloats(P, c, R, M); }

  R.note = pxNote(P, c, R);
  return R;
}

/**
 * The float form: one row per task on a shared elapsed-time axis.
 *
 * The row is a bar from earliest start to earliest finish and then a TAIL, and the tail is the whole
 * point. It has two segments: the free float, which the task can absorb without anything else
 * moving, and the rest of the total float, which it can only absorb by spending a successor's slack.
 * A critical task has no tail at all, which is what makes zero total float visible as an absence
 * rather than as a colour — and since criticality is read off the float, the picture and the
 * arithmetic cannot disagree.
 *
 * Rows are ordered by earliest start and then by total float, so the reader scans the plan in the
 * order it happens and, within one moment, meets the tightest task first.
 */
function pxDrawFloats(P, c, R, M) {
  var T = P.tasks, n = T.length, i, marks = [], gutter = 0, order = [];

  for (i = 0; i < n; i++) { order.push(i); }
  if (R.ok) {
    order.sort(function (a, b) { return R.es[a] - R.es[b] || R.tf[a] - R.tf[b] || a - b; });
  }

  for (i = 0; i < n; i++) { gutter = Math.max(gutter, tw(T[i].label, 9)); }
  gutter = Math.min(M.labMax, gutter) + 8;

  var W = Math.min(P.WMAX, Math.max(P.W0, M.pad * 2 + gutter + 330));
  var H = M.top + n * M.rowH + M.foot;
  var plot = { x0: M.pad + gutter, y0: M.top, x1: W - M.pad, y1: H - M.foot };

  /* With a cycle there is no schedule, so there is no project duration to scale against; the axis
     falls back to the longest single task and the bars read as durations rather than as positions.
     The tooltips and the caption both say which of the two the reader is looking at. */
  var hi = 0;
  if (R.ok) { hi = R.T; }
  else { for (i = 0; i < n; i++) { if (T[i].dur > hi) { hi = T[i].dur; } } }
  if (!(hi > 0)) { hi = 1; }
  var xs = CK.scale([0, hi], [plot.x0, plot.x1]);

  /* The axis. Ticks are CK's, so the gridlines here and the gridlines on every other card in the
     catalogue are chosen by one piece of code. */
  var want = Math.max(2, Math.min(8, Math.floor((plot.x1 - plot.x0) / 74)));
  var tk = CK.ticks(0, hi, want);
  for (i = 0; i < tk.length; i++) {
    if (tk[i] < 0 || tk[i] > hi) { continue; }
    marks.push(mLine(xs(tk[i]), plot.y0, xs(tk[i]), plot.y1, 'ck-rule'));
    marks.push(mText(xs(tk[i]), plot.y0 - 7, fmtNum(tk[i]), 'ck-px-tk', 'middle'));
  }
  if (P.unit) { marks.push(mText(plot.x1, plot.y0 - 7, P.unit, 'ck-px-unit', 'end')); }
  marks.push(mLine(plot.x0, plot.y0, plot.x1, plot.y0, 'ck-axis'));
  marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  var hair = 1.5, thin = 0;
  for (var r = 0; r < n; r++) {
    i = order[r];
    var yTop = plot.y0 + r * M.rowH + (M.rowH - M.barH) / 2;
    var cy = yTop + M.barH / 2;
    var kids = [];
    var es = R.ok ? R.es[i] : 0, ef = R.ok ? R.ef[i] : T[i].dur;
    var tf = R.ok ? R.tf[i] : 0, ff = R.ok ? R.ff[i] : 0;
    var crit = R.ok ? R.crit[i] : false;

    var bx = xs(es), ex = xs(ef);
    var tip = T[i].label + ' · ' + fmtDur(T[i].dur, P.unit) +
              (R.ok
                ? ' · earliest ' + fmtNum(es) + ' to ' + fmtNum(ef) +
                  ' · latest ' + fmtNum(R.ls[i]) + ' to ' + fmtNum(R.lf[i]) +
                  ' · total float ' + fmtNum(tf) + ' · free float ' + fmtNum(ff) +
                  (crit ? ' · critical' : '')
                : ' · no schedule: the dependencies are cyclic');

    if (T[i].dur === 0) {
      kids.push(mDiamond(bx, cy, M.barH / 2 + 1, 'ck-px-ms' + (crit ? ' ck-px-crit' : '')));
    } else {
      var w = ex - bx;
      if (w < hair) { w = hair; thin++; }
      kids.push(mRect(bx, yTop, w, M.barH, 'ck-px-bar' + (crit ? ' ck-px-crit' : ''), 2));
    }

    if (R.ok && tf > R.eps) {
      /* The tail, in two segments. Free float first because it is the part that costs nobody
         anything; the remainder is drawn hollow because spending it spends somebody else's slack. */
      var fx = xs(es + T[i].dur + (c.free ? Math.min(ff, tf) : 0));
      if (c.free && ff > R.eps) {
        kids.push(mRect(ex, yTop + M.barH / 4, fx - ex, M.barH / 2, 'ck-px-ff', 1));
      }
      kids.push(mRect(fx, yTop + M.barH / 4, xs(R.lf[i]) - fx, M.barH / 2, 'ck-px-tf', 1));
      kids.push(mLine(xs(R.lf[i]), yTop - 1, xs(R.lf[i]), yTop + M.barH + 1, 'ck-px-lfmark'));
    }
    if (crit) {
      kids.push(mLine(bx, yTop - 2, bx, yTop + M.barH + 2, 'ck-px-critmark'));
    }

    var g = { t: 'g', a: { 'class': 'ck-px-row', 'data-task': String(i) }, kids: kids };
    g.ti = tip;
    marks.push(g);
    marks.push(mText(plot.x0 - 6, cy + 3.2, clipTo(T[i].label, gutter - 10, 9), 'ck-px-lab', 'end'));
  }

  R.W = W; R.H = H; R.marks = marks; R.thin = thin;
}

/**
 * The network form: activity-on-node boxes in dependency layers.
 *
 * Each box carries its own four times in the classic arrangement — earliest start, duration and
 * earliest finish along the top; latest start, the two floats, and latest finish along the bottom —
 * so a reader can check the arithmetic on any box without leaving the picture. Criticality is
 * carried by stroke weight and by a notch at the box's left edge, never by colour alone, so it
 * survives a monochrome print and a colour-blind reader.
 *
 * Edges spanning more than one layer are routed through a channel below the boxes rather than drawn
 * across the intervening columns, because a line that passes through three boxes on its way looks
 * exactly like three lines that end at them.
 */
function pxDrawNet(P, c, R, M) {
  var T = P.tasks, n = T.length, i, j, u, v, marks = [];
  var nums = c.nums && R.ok;
  var BW = nums ? 118 : 104, BH = nums ? 46 : 30;

  var back = pxBack(n, P.succ);
  var lay = pxLayer(n, P.pred, P.succ, back);
  var rows = pxOrder(n, lay.layer, lay.layers, P.pred, P.succ);

  var pos = [];
  for (i = 0; i < n; i++) { pos.push(0); }
  var tallest = 1;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].length > tallest) { tallest = rows[i].length; }
    for (j = 0; j < rows[i].length; j++) { pos[rows[i][j]] = j; }
  }
  R.crossings = pxCross(n, lay.layer, pos, P.succ);

  var longEdge = false;
  for (u = 0; u < n; u++) {
    for (j = 0; j < P.succ[u].length; j++) {
      v = P.succ[u][j];
      if (back[u + '>' + v] || lay.layer[v] - lay.layer[u] !== 1) { longEdge = true; }
    }
  }

  var W = Math.min(P.WMAX, Math.max(P.W0, M.pad * 2 + lay.layers * BW + Math.max(0, lay.layers - 1) * M.gapX));
  var chan = longEdge ? M.chan : 0;
  var H = M.pad + tallest * BH + Math.max(0, tallest - 1) * M.gapY + chan + M.pad;

  var box = [];
  for (i = 0; i < n; i++) { box.push(null); }
  for (var l = 0; l < rows.length; l++) {
    var rowN = rows[l].length;
    var span = rowN * BH + Math.max(0, rowN - 1) * M.gapY;
    var y0 = M.pad + ((tallest * BH + Math.max(0, tallest - 1) * M.gapY) - span) / 2;
    for (j = 0; j < rowN; j++) {
      i = rows[l][j];
      box[i] = { x: M.pad + l * (BW + M.gapX), y: y0 + j * (BH + M.gapY), w: BW, h: BH };
    }
  }

  /* Edges first, so a box always paints over the line that reaches it. */
  var chanAt = M.pad + tallest * BH + Math.max(0, tallest - 1) * M.gapY + 8, lane = 0;
  for (u = 0; u < n; u++) {
    for (j = 0; j < P.succ[u].length; j++) {
      v = P.succ[u][j];
      var a = box[u], b = box[v];
      var loop = !!back[u + '>' + v];
      var tight = R.ok && R.crit[u] && R.crit[v] && Math.abs(R.ef[u] - R.es[v]) <= R.eps;
      var cls = 'ck-px-edge' + (loop ? ' ck-px-edgecyc' : tight ? ' ck-px-edgecrit' : '');
      var ex = a.x + a.w, ey = a.y + a.h / 2, sx = b.x, sy = b.y + b.h / 2, d;
      if (!loop && lay.layer[v] - lay.layer[u] === 1) {
        d = 'M' + fin(ex) + ' ' + fin(ey) + ' H' + fin(ex + M.gapX / 2) +
            ' V' + fin(sy) + ' H' + fin(sx - 5);
      } else {
        var yc = chanAt + (lane % 3) * 4;
        lane++;
        d = 'M' + fin(ex) + ' ' + fin(ey) + ' H' + fin(ex + 8) + ' V' + fin(yc) +
            ' H' + fin(sx - 12) + ' V' + fin(sy) + ' H' + fin(sx - 5);
      }
      var head = 'M' + fin(sx - 5) + ' ' + fin(sy - 3.2) + ' L' + fin(sx) + ' ' + fin(sy) +
                 ' L' + fin(sx - 5) + ' ' + fin(sy + 3.2) + ' Z';
      marks.push({ t: 'g', a: { 'class': cls },
                   kids: [mPath(d, 'ck-px-edgeline'), mPath(head, 'ck-px-edgehead')] });
    }
  }

  for (i = 0; i < n; i++) {
    var q = box[i], kids = [], crit = R.ok && R.crit[i];
    var tip = T[i].label + ' · ' + fmtDur(T[i].dur, P.unit) +
              (R.ok
                ? ' · earliest ' + fmtNum(R.es[i]) + ' to ' + fmtNum(R.ef[i]) +
                  ' · latest ' + fmtNum(R.ls[i]) + ' to ' + fmtNum(R.lf[i]) +
                  ' · total float ' + fmtNum(R.tf[i]) + ' · free float ' + fmtNum(R.ff[i]) +
                  (crit ? ' · critical' : '')
                : ' · no schedule: the dependencies are cyclic');

    kids.push(mRect(q.x, q.y, q.w, q.h, 'ck-px-box' + (crit ? ' ck-px-crit' : ''), 3));
    if (nums) {
      kids.push(mLine(q.x, q.y + 13, q.x + q.w, q.y + 13, 'ck-px-boxline'));
      kids.push(mLine(q.x, q.y + q.h - 13, q.x + q.w, q.y + q.h - 13, 'ck-px-boxline'));
      kids.push(mLine(q.x + q.w / 3, q.y, q.x + q.w / 3, q.y + 13, 'ck-px-boxline'));
      kids.push(mLine(q.x + 2 * q.w / 3, q.y, q.x + 2 * q.w / 3, q.y + 13, 'ck-px-boxline'));
      kids.push(mLine(q.x + q.w / 3, q.y + q.h - 13, q.x + q.w / 3, q.y + q.h, 'ck-px-boxline'));
      kids.push(mLine(q.x + 2 * q.w / 3, q.y + q.h - 13, q.x + 2 * q.w / 3, q.y + q.h, 'ck-px-boxline'));
      kids.push(mText(q.x + q.w / 6, q.y + 9.5, fmtNum(R.es[i]), 'ck-px-cell', 'middle'));
      kids.push(mText(q.x + q.w / 2, q.y + 9.5, fmtNum(T[i].dur), 'ck-px-cell ck-px-dur', 'middle'));
      kids.push(mText(q.x + 5 * q.w / 6, q.y + 9.5, fmtNum(R.ef[i]), 'ck-px-cell', 'middle'));
      kids.push(mText(q.x + q.w / 6, q.y + q.h - 4, fmtNum(R.ls[i]), 'ck-px-cell', 'middle'));
      kids.push(mText(q.x + q.w / 2, q.y + q.h - 4,
                      fmtNum(R.tf[i]) + ' / ' + fmtNum(R.ff[i]), 'ck-px-cell ck-px-flo', 'middle'));
      kids.push(mText(q.x + 5 * q.w / 6, q.y + q.h - 4, fmtNum(R.lf[i]), 'ck-px-cell', 'middle'));
      kids.push(mText(q.x + q.w / 2, q.y + q.h / 2 + 3.4,
                      clipTo(T[i].label, q.w - 10, 9), 'ck-px-name', 'middle'));
    } else {
      kids.push(mText(q.x + q.w / 2, q.y + 13, clipTo(T[i].label, q.w - 10, 9), 'ck-px-name', 'middle'));
      kids.push(mText(q.x + q.w / 2, q.y + 24,
                      R.ok ? fmtNum(R.tf[i]) + ' / ' + fmtNum(R.ff[i]) : fmtDur(T[i].dur, P.unit),
                      'ck-px-cell ck-px-flo', 'middle'));
    }
    if (crit) { kids.push(mLine(q.x, q.y + 3, q.x, q.y + q.h - 3, 'ck-px-critmark')); }

    var g = { t: 'g', a: { 'class': 'ck-px-node', 'data-task': String(i) }, kids: kids };
    g.ti = tip;
    marks.push(g);
  }

  R.W = W; R.H = H; R.marks = marks;
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, clipTo, fmtNum, fmtDur, pxConfig, pxCycle, pxPasses, pxPaths,
                 pxComponents, pxBack, pxLayer, pxCross, pxOrder, mLine, mText, mRect, mPath,
                 mDiamond, pxMetrics, pxCycNames, pxSome, pxKey, pxNote, pxRender, pxDrawFloats,
                 pxDrawNet];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>` AND that cannot
 * trip the emitted-code guard.
 *
 * `<` and `>` become escapes so a task name containing a closing script tag cannot end the block
 * early — which has the second, less obvious effect of making an arrow sequence impossible, since
 * its second character is one of the two. `?` is escaped for the same reason one step further on: a
 * label reading "ready?.check" would otherwise put an optional-chaining sequence into a file the
 * guard refuses to emit, and the card would fail to build because of somebody's punctuation. Two
 * agents in this catalogue hit exactly that. The backtick and the two line separators round it out.
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
  const own = '.ck-pert[data-card="' + id + '"]';
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
 * The two float segments are distinguished by FILL PATTERN as well as by tone: free float is filled
 * and the shared remainder is an outline, so the distinction the card exists to make survives a
 * monochrome print. Criticality is carried by stroke weight and by a notch, for the same reason.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-px-plot .ck-px-tk', 'fill: var(--ink-faint);'],
    ['.ck-px-plot .ck-px-unit', 'fill: var(--ink-faint); letter-spacing: .04em;'],
    ['.ck-px-plot .ck-px-lab', 'fill: var(--ink-dim); font-size: 9px;'],
    ['.ck-px-plot .ck-px-empty', 'fill: var(--ink-faint); font-size: 11px;'],

    ['.ck-px-plot .ck-px-bar', 'fill: var(--pill); stroke: var(--pill-edge); stroke-width: 1;'],
    ['.ck-px-plot .ck-px-ms', 'fill: var(--pill); stroke: var(--pill-edge); stroke-width: 1;'],
    ['.ck-px-plot .ck-px-ff', 'fill: var(--ink-dim); fill-opacity: .34; stroke: none;'],
    ['.ck-px-plot .ck-px-tf',
      'fill: none; stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 2 2;'],
    ['.ck-px-plot .ck-px-lfmark', 'stroke: var(--ink-faint); stroke-width: 1;'],

    ['.ck-px-plot .ck-px-box', 'fill: var(--well); stroke: var(--rule); stroke-width: 1;'],
    ['.ck-px-plot .ck-px-boxline', 'stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-px-plot .ck-px-cell', 'fill: var(--ink-dim); font-size: 7.5px;'],
    ['.ck-px-plot .ck-px-dur', 'fill: var(--ink);'],
    ['.ck-px-plot .ck-px-flo', 'fill: var(--ink-faint);'],
    ['.ck-px-plot .ck-px-name', 'fill: var(--ink); font-size: 9px;'],

    ['.ck-px-plot .ck-px-edgeline',
      'fill: none; stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 3 2;'],
    ['.ck-px-plot .ck-px-edgehead', 'fill: var(--ink-faint); stroke: none;'],
    ['.ck-px-plot .ck-px-edgecrit .ck-px-edgeline',
      'stroke: var(--accent); stroke-dasharray: none; stroke-width: 1.3;'],
    ['.ck-px-plot .ck-px-edgecrit .ck-px-edgehead', 'fill: var(--accent);'],
    ['.ck-px-plot .ck-px-edgecyc .ck-px-edgeline',
      'stroke: var(--ck-s1); stroke-dasharray: 1 3; stroke-width: 1.4;'],
    ['.ck-px-plot .ck-px-edgecyc .ck-px-edgehead', 'fill: var(--ck-s1);'],

    ['.ck-px-plot .ck-px-row, .ck-px-plot .ck-px-node', 'transition: opacity .12s linear;'],
    ['.ck-px-plot:hover .ck-px-row, .ck-px-plot:hover .ck-px-node', 'opacity: .55;'],
    ['.ck-px-plot .ck-px-row:hover, .ck-px-plot .ck-px-node:hover', 'opacity: 1;'],

    ['.ck-legend i[data-k="bar"]', 'background: var(--pill); box-shadow: inset 0 0 0 1px var(--pill-edge);'],
    ['.ck-legend i[data-k="ff"]', 'background: var(--ink-dim); opacity: .5;'],
    ['.ck-legend i[data-k="tf"]', 'background: transparent; box-shadow: inset 0 0 0 1px var(--ink-faint);'],
    ['.ck-legend i[data-k="crit"]', 'background: var(--accent);'],
    ['.ck-legend i[data-k="box"]', 'background: var(--well); box-shadow: inset 0 0 0 1px var(--rule);'],
    ['.ck-legend i[data-k="edge"]', 'background: var(--ink-faint); height: 2px;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  /* The critical rules come AFTER the fills on purpose: both are one class deep, so specificity is
     a tie and source order decides. Written the other way round, the one thing the card most wants
     to point at would silently lose its heavier stroke. */
  rules.push(['.ck-px-plot .ck-px-crit', 'stroke: var(--accent); stroke-width: 2;']);
  rules.push(['.ck-px-plot .ck-px-critmark',
              'stroke: var(--accent); stroke-width: 2; stroke-linecap: butt;']);

  /* The only animation is that fade and it carries no meaning, so it is safe to simply stop. */
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-px-plot .ck-px-row, .ck-px-plot .ck-px-node', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the network drawn, and the caption. */
function cardHtml(id, title, seed, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;
  const box = (name, label, on) =>
    '    <label for="' + f(name) + '">' + CK.esc(label) + '</label>\n' +
    '    <input id="' + f(name) + '" name="' + name + '" type="checkbox"' + (on ? ' checked' : '') + '>\n';

  /* One option per line. The newline between two options is whitespace inside a select, so it is
     invisible on screen and does not affect the control at all — and without it the flattened text
     a screen reader or a copy-paste receives reads "form autonode networkfloat rows", three option
     labels welded into one word. Nothing looks wrong. */
  const opt = (v, label) =>
    '\n      <option value="' + CK.esc(v) + '"' + (cfg.form === v ? ' selected' : '') + '>' +
    CK.esc(label) + '</option>';

  const plot =
    '<svg class="ck-plot ck-px-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '"' +
    (seed.W > W0 ? ' style="min-width:' + Math.round(seed.W) + 'px"' : '') +
    ' aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-pert">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="pert settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('form') + '">form</label>\n' +
    '    <select id="' + f('form') + '" name="form">' +
         opt('auto', 'auto') + opt('network', 'node network') + opt('floats', 'float rows') +
         '\n    </select>\n' +
    box('free', 'split free float out', cfg.free) +
    box('nums', 'times inside the boxes', cfg.nums) +
    '    <p class="ck-set-foot">Total float is how long a task can slip before the finish moves; ' +
         'free float is how long it can slip before any successor moves. They are different ' +
         'numbers and a task can have plenty of the first and none of the second. There is no ' +
         'switch for the critical path, because it is not a separate quantity: a task is critical ' +
         'exactly when its total float is zero.</p>\n' +
    '  </div>\n' +
    '  <div class="ck-scroll">' + plot + '</div>\n' +
    '  <div class="ck-legend ck-px-key">' + seed.note.key + '</div>\n' +
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
    '/* pert card: the same passes that drew the copy in card.html, re-run when a setting changes.\n' +
    '   The forward and backward passes, the cycle search, the path count and the layout are all\n' +
    '   redone here, so the caption and the drawing cannot come to disagree about which tasks are\n' +
    '   critical or how much float anything has. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-px-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  var key  = sec.querySelector(".ck-px-key");\n' +
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
    '  /* A repaint, not an append: the desk swaps its main element and replays every builder, so a\n' +
    '     render that added marks would draw a second network on top of the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = pxRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    plot.style.minWidth = out.W > P.W0 ? Math.round(out.W) + "px" : "";\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* Caption and legend are markup whose every data-derived value was escaped as it was\n' +
    '       built. The legend is rebuilt with the drawing because it describes the drawing, and a\n' +
    '       legend left behind by a form change is a legend that lies. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '    if (key) { key.innerHTML = out.note.key; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/pert');
}

/**
 * Build one PERT card from one network of durations and dependencies.
 *
 * WHY THIS EXISTS BESIDE `gantt`. `gantt` draws a schedule against a calendar and highlights a
 * critical path; this draws the schedule the DEPENDENCY NETWORK implies and quantifies how far every
 * task is from being on it. The two agree about criticality on the same network by construction —
 * both take the longest chain of durations through the DAG — and this card's verification asserts
 * that against `gantt`'s own `gxCritical`. What they do not share is float, which is the number a
 * decision is made from and which a bar chart of dates has nowhere to put.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data                 a card-sized empty frame saying so; nothing is invented
 *   one task                one row, zero total float, one critical path of length one
 *   every task identical    every task is critical and there are as many critical paths as tasks;
 *                           the caption says nothing in the plan can slip at all
 *   zero duration           a diamond, never a bar of zero width; a milestone can be critical
 *   no duration at all      refused, counted and named; NEVER defaulted to zero, because zero is a
 *                           milestone and that is a different claim about the plan
 *   negative duration       refused, never made positive
 *   unparseable duration    refused, counted and named; never coerced, because Number('') is 0
 *   duplicate ids           the first task wins, the repeats are dropped and counted
 *   dependency on nothing   that edge is refused, counted and named; the task still draws
 *   a missing predecessor   the same: the edge is refused by name, since inventing the task would
 *                           put something on the network nobody meant to plan
 *   self-dependency         the edge is refused and counted separately; a task preceding itself
 *                           states no ordering, so the passes still run
 *   a two-cycle             a real ordering claim that cannot be met: NO float is computed at all,
 *                           the loop is named, and the closing edges are marked in the drawing
 *   a longer cycle          the same, with every task in the loop named in order
 *   two disjoint components both are drawn; the finish is the latest across both, and the caption
 *                           says the shorter one's float is inherited from a plan it never touches
 *   every task critical     drawn with no tails at all; the caption says so in those words
 *   no task critical        impossible, and the caption says why rather than leaving it implied
 *   300 tasks               drawn as float rows; the network form refuses past 48 and says so
 *   a 300-character label   clipped to the room it has, with the whole of it in the tooltip
 *   injected markup         escaped on the way into the caption, the legend and the tooltips, and
 *                           escaped again on the way into the emitted script literal
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ tasks, unit, title }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'plan',
 *   title: 'what can slip',
 *   data: { unit: 'd', tasks: [
 *     { id: 'a', label: 'spec',  dur: 3 },
 *     { id: 'b', label: 'draft', dur: 2, deps: ['a'] },
 *     { id: 'c', label: 'build', dur: 5, deps: ['a'] },
 *     { id: 'd', label: 'ship',  dur: 4, deps: ['b', 'c'] },
 *   ] },
 *   ord: 32,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'pert' : id);
  const P = readData(data);

  const cfg = { ...defaults };
  const seed = pxRender(P, cfg);

  /* The payload the browser re-renders from carries the data and the budgets and no geometry, so
     the two runtimes cannot disagree about anything except the config. */
  const payload = {
    tasks: P.tasks, pred: P.pred, succ: P.succ, unit: P.unit, title: P.title,
    refused: P.refused, dupIds: P.dupIds, badEdges: P.badEdges, selfDeps: P.selfDeps,
    droppedTasks: P.droppedTasks, droppedDeps: P.droppedDeps, edges: P.edges,
    fromDates: P.fromDates, noTimeUnit: P.noTimeUnit,
    W0, WMAX,
  };

  const critical = seed.ok ? P.tasks.filter((t, i) => seed.crit[i]).map((t) => t.id) : [];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      tasks: P.tasks.length,
      dependencies: P.edges,
      unit: P.unit,
      cyclic: !seed.ok,
      duration: seed.ok ? seed.T : null,
      components: seed.comps,
      critical,
      criticalPaths: seed.ok ? seed.paths : 0,
      totalFloat: seed.ok ? P.tasks.map((t, i) => [t.id, seed.tf[i]]) : [],
      freeFloat: seed.ok ? P.tasks.map((t, i) => [t.id, seed.ff[i]]) : [],
      refusedTasks: P.refused.length,
      refusedDependencies: P.badEdges.length,
      selfDependencies: P.selfDeps,
      settings: { ...cfg },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, cfg),
    css:  cardCss(cardId),
    js:   cardJs(cardId, payload, cfg),
  };
}

/* Exported for the type's own verification, which executes the arithmetic rather than only reading
   it: a static check can prove the script parses and cannot prove that free float is not total
   float wearing another name. */
export const _internals = { readData, readDur, readTime, unitMs, clean, jsLit, SHIPPED,
                            pxRender, pxConfig, pxPasses, pxPaths, pxCycle, pxComponents,
                            pxLayer, pxBack, pxOrder, pxMetrics, fmtNum };

export default { meta, build };

