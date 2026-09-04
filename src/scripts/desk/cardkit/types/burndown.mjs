/**
 * The `burndown` card type — remaining work against time, with the ideal line and the scope moves
 * that a remaining line on its own would hide.
 *
 * A burndown that draws only the remaining line is not a simplification, it is a specific and very
 * common lie. When work is added mid-iteration the remaining line FLATTENS, and a flat line reads
 * as "the team stopped delivering" when the truth is "the work grew". Same picture, opposite
 * conclusion, and the wrong one blames people. So scope change is a first-class quantity here:
 *
 *   - **Added and removed scope are drawn as their own bands, below the zero axis**, hanging
 *     directly off the bottom of the plot. The lane is stacked — added, then removed — so each
 *     band's depth is its own cumulative quantity and the lane's total depth is the gross churn.
 *     Net would be worse than useless: add twenty and remove twenty and a net band draws nothing,
 *     which is exactly the case where the reader most needs to be told something happened.
 *   - **The caption states the totals in units**, both of them, always — not "scope changed".
 *   - **A second dashed line shows remaining against the ORIGINAL scope alone**, that is,
 *     remaining with every later addition subtracted and every later removal added back. Where
 *     the raw line flattens, this one keeps descending, and the two together say "work was
 *     delivered, and the work grew" in one picture. It is the direct answer to the misreading.
 *   - **When the data carries no scope figure at all, the card says so loudly**, in a banner and
 *     in the caption, rather than drawing a confident single line. A card that cannot distinguish
 *     "not delivering" from "scope grew" should say which of the two it cannot tell you.
 *
 * The ideal line is a straight run from the starting scope to zero at the end date. It assumes
 * constant throughput and a fixed scope, neither of which is ever true, so it is a REFERENCE and
 * not a prediction — the caption says exactly that, because treating deviation from it as failure
 * is the error the chart invites and the reason burndowns end up as instruments of blame.
 *
 * The line stops at the last reading, never at the end date. A line drawn to the end date with no
 * data past today implies a collapse to zero that has not happened; the x axis still runs to the
 * end date, so the gap between the last reading and the end is visible as a gap, which is what it
 * is.
 *
 * Everything geometric is computed by {@link bdRender}, which is the same function in Node and in
 * the browser: Node runs it once for the picture that ships inside `card.html`, the browser
 * re-runs it on a settings change. Because the caption comes out of the same call as the marks,
 * it cannot come to describe a drawing that is not on the screen. `CK` is loaded out of `kit.js`
 * in a `node:vm` context, so `CK.scale`, `CK.ticks` and `CK.fmt` here are the ones the page has.
 *
 * @see ./kanban.mjs — the same work as a board rather than as a curve
 * @see ./gantt.mjs  — when the question is what is scheduled rather than what is left
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it. Loading it rather than re-implementing `scale` and `ticks`
 * is the contract's rule: a private copy is a second source of truth and it drifts silently — the
 * gridlines stop matching the axis and nothing errors.
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
  catch (e) { throw new Error('cardkit/burndown: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/burndown: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────────── */

const W0    = 640;
const PLOTH = 196;
const LANEH = 46;
const KEYH  = 18;
const AXISH = 20;
const PADT  = 14;
const PADR  = 14;

/** One day, in milliseconds. Iterations are counted in days everywhere in this file. */
const DAY = 86400000;

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * Every setting this card understands, with its fallback.
 *
 * There is deliberately no setting for the scope lane. It is drawn whenever scope moved and absent
 * whenever it did not, so its absence is information rather than a preference — and a switch that
 * hides the one quantity this card exists to add would eventually be found switched on, by someone
 * who does not remember switching it, in the sprint review where it mattered.
 *
 * `adjusted` is a setting because it is a second reading of the same data rather than the data:
 * turning it off costs an interpretation, not a fact, and the lane and the caption still carry the
 * scope change either way.
 *
 * @example defaults.ideal;   // true
 */
export const defaults = { ideal: true, adjusted: true, dots: false };

/** What this card type is and what it will accept, for a deck index or a picker. */
export const meta = {
  name: 'burndown',
  summary: 'Remaining work against time with the ideal line, and the scope added and removed ' +
           'drawn as its own quantity below the axis.',
  shape: '{ start, end, unit, now, points: [{ t, remaining, scope }] } — t is ISO or epoch ms, ' +
         'remaining is the work left at that moment, scope is the total committed at that moment ' +
         'and is what makes scope change visible; without it the card says it cannot show scope ' +
         'change rather than drawing a line that cannot be read',
  category: 'work-and-lists',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────────── */

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
 * Backtick, arrow and optional chaining are scanned raw, because none of them can appear
 * innocently. The declaration keywords are scanned only after {@link blankNonCode}, because they
 * can and do appear innocently in English.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/burndown';
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

/* ── reading the data ────────────────────────────────────────────────────────────────────── */

/**
 * One timestamp as epoch milliseconds, or null when it is not a time.
 *
 * A string that does not parse is refused rather than coerced. `Number('')` is 0 and
 * `new Date('soon')` is not a time; either one puts a reading at a moment nobody gave, and on a
 * chart whose entire x axis is time an invented moment is an invented history.
 *
 * @example readTime('2026-08-01');   // 1785283200000
 * @example readTime('soon');         // null
 */
function readTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume, counting every
 * refusal so the caption can name it.
 *
 * A `remaining` value is kept only when it is a `number` and finite, which is stricter than
 * `Number(v)` on purpose: every coercion lands on 0, and on a burndown a fabricated zero is a
 * finished iteration. Non-integers are kept exactly as given — half-point estimates are ordinary
 * and rounding them would move the line.
 *
 * DUPLICATE t: the last occurrence wins and the overwrite is counted. A burndown is appended to
 * over time, so a second reading at one moment is a correction; summing would double it and
 * keeping the first would discard the correction.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns the raw material the build needs, with `refused`, `dupes` and `badScope` counted
 *
 * @example readData({ points: [{ t: 0, remaining: 5 }] }).xs;   // [0]
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const src = Array.isArray(d.points) ? d.points : [];

  const at = new Map();
  let refused = 0, dupes = 0, badScope = 0;

  for (const p of src) {
    if (!p || typeof p !== 'object') { refused += 1; continue; }
    const t = readTime(p.t);
    const r = p.remaining;
    if (t === null || typeof r !== 'number' || !Number.isFinite(r)) { refused += 1; continue; }

    let scope = null;
    if (p.scope !== undefined && p.scope !== null) {
      if (typeof p.scope === 'number' && Number.isFinite(p.scope)) scope = p.scope;
      else badScope += 1;
    }

    if (at.has(t)) dupes += 1;
    at.set(t, { t, remaining: r, scope });
  }

  const rows = [...at.values()].sort((a, b) => a.t - b.t);

  /* Counted over the SURVIVING rows, not over the raw list. Counting as they arrived made a run
     with a duplicate moment look partially scoped — the overwritten copy still counted toward the
     total while its row did not — so a perfectly scoped series with one corrected reading in it
     reported that it could not show scope change at all. */
  const scoped = rows.filter((r) => r.scope !== null).length;

  /* Scope is all-or-nothing on purpose. A run where only some points carry a scope figure would
     need the gaps filled, and every way of filling them invents a moment at which work arrived —
     which is precisely the quantity this card exists to report honestly. */
  const hasScope = rows.length > 0 && scoped === rows.length;

  const givenNow = d.now === undefined || d.now === null || d.now === '' ? null : readTime(d.now);
  const badNow = (d.now !== undefined && d.now !== null && d.now !== '') && givenNow === null;

  const givenStart = d.start === undefined || d.start === null || d.start === '' ? null : readTime(d.start);
  const givenEnd = d.end === undefined || d.end === null || d.end === '' ? null : readTime(d.end);
  const badStart = (d.start !== undefined && d.start !== null && d.start !== '') && givenStart === null;
  const badEnd = (d.end !== undefined && d.end !== null && d.end !== '') && givenEnd === null;

  return {
    rows, hasScope, partialScope: scoped > 0 && !hasScope,
    refused, dupes, badScope,
    givenStart, givenEnd, givenNow, badStart, badEnd, badNow,
    unit: d.unit == null || String(d.unit).trim() === '' ? 'points' : String(d.unit),
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────────── */
/* Written in the browser's vocabulary from here to the SHIPPED list — var and function, no arrows,
   no template literals, no optional chaining, no backtick in any comment — because it is emitted
   verbatim through Function.prototype.toString() and also run here to draw the copy that ships
   inside card.html. One source, two runtimes, nothing to drift. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole d attribute and the card
 * renders empty with nothing in the console.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (!isFinite(v)) { throw new Error('burndown: non-finite coordinate (' + v + ')'); }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's 9px mono face; measured, not guessed. */
function tw(s) { return String(s).length * 5.42; }

/** Two digits, so a month or a day aligns with the rest of the label. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A compact label for one moment, in the units the axis is actually in.
 *
 * UTC getters throughout: a date written as a plain day parses to UTC midnight, so reading it back
 * in the viewer's zone can print the day before, and an axis that disagrees with the strings it was
 * handed is worse than a coarse one.
 *
 * @example fmtT(0, 86400000 * 30);   // '01-01'
 */
function fmtT(t, span) {
  var d = new Date(t);
  if (span > 86400000 * 1100) { return String(d.getUTCFullYear()); }
  if (span > 86400000 * 70) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  if (span > 86400000 * 2) { return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

/** A full UTC stamp, for prose that has to name a moment exactly. */
function fmtStamp(t) {
  var d = new Date(t);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/**
 * Ticks that reach the ends of the axis instead of stopping short of them.
 *
 * CK.ticks only returns ticks strictly inside the domain it is handed, leaving a ragged strip above
 * the last gridline. Snapping the domain out to the step the ticks already chose closes it; the
 * ticks are stepped out rather than re-derived, because asking again with the wider range can push
 * it to the next nice step and halve the gridline count.
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

/** A display-list text run; the fifth argument is the anchor, the sixth anything unusual. */
function mText(x, y, s, cls, anchor, extra) {
  var a = { x: fin(x), y: fin(y), 'class': cls || '' }, k;
  if (anchor) { a['text-anchor'] = anchor; }
  if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { a[k] = extra[k]; } } }
  return { t: 'text', a: a, s: String(s) };
}

/** A display-list path; the caller owns the shape, because only the caller knows it. */
function mPath(d, cls) { return { t: 'path', a: { d: d, 'class': cls || '' } }; }

/** A display-list dot, for a reading a reader might want to point at. */
function mDot(x, y, r, cls) {
  return { t: 'circle', a: { cx: fin(x), cy: fin(y), r: fin(r), 'class': cls || '' } };
}

/** A polyline through points already in pixel space. */
function linePath(pts) {
  var out = [], i;
  for (i = 0; i < pts.length; i++) {
    out.push((i ? 'L' : 'M') + fin(pts[i].x) + ' ' + fin(pts[i].y));
  }
  return out.join(' ');
}

/** A filled band between an upper and a lower edge, both already in pixel space. */
function areaPath(top, bot) {
  var out = [], i;
  if (top.length < 2) { return ''; }
  for (i = 0; i < top.length; i++) {
    out.push((i ? 'L' : 'M') + fin(top[i].x) + ' ' + fin(top[i].y));
  }
  for (i = bot.length - 1; i >= 0; i--) {
    out.push('L' + fin(bot[i].x) + ' ' + fin(bot[i].y));
  }
  out.push('Z');
  return out.join(' ');
}

/** Settle the settings, so an unknown value from a hand-edited store cannot reach the geometry. */
function bdConfig(cfg) {
  var c = cfg || {};
  return {
    ideal:    c.ideal !== false,
    adjusted: c.adjusted !== false,
    dots:     c.dots === true,
  };
}

/**
 * Scope movement, cumulatively, and the remaining line with that movement taken back out.
 *
 * Added and removed are derived from consecutive totals rather than read from the caller, so there
 * is one source for the quantity: a caller supplying both a scope total and a per-day delta would
 * be supplying the same fact twice, and the two would eventually disagree.
 *
 * The adjusted series is the counterfactual the chart owes its reader:
 *
 *     adjusted[i] = remaining[i] - cumulativeAdded[i] + cumulativeRemoved[i]
 *
 * Adding ten units raises remaining by ten with nothing delivered, so subtracting the addition
 * back out leaves the line the team would have drawn against the work it originally took on.
 * Removing units drops remaining with nothing delivered, so the removal is added back. Where the
 * raw line goes flat because work arrived, this one keeps falling — which is the whole answer to
 * the misreading that a flat burndown means a team that stopped.
 *
 * It can legitimately go BELOW zero: that is the team having delivered more than the original
 * commitment, which is a real thing that happens and is not an error to clamp away.
 *
 * @param P the shipped payload
 * @returns cumulative added and removed per point, the adjusted series, and the two totals
 *
 * @example bdScope({ xs: [0, 1], rem: [10, 15], scope: [10, 15] }).added;   // 5
 */
function bdScope(P) {
  var n = P.xs.length, i, cumAdd = [], cumRem = [], adj = [], a = 0, r = 0, dlt;

  for (i = 0; i < n; i++) {
    if (P.scope && i > 0) {
      dlt = P.scope[i] - P.scope[i - 1];
      if (dlt > 0) { a += dlt; } else if (dlt < 0) { r += -dlt; }
    }
    cumAdd.push(a);
    cumRem.push(r);
    adj.push(P.rem[i] - a + r);
  }

  return {
    cumAdd: cumAdd, cumRem: cumRem, adj: adj,
    added: a, removed: r,
    changed: P.scope ? (a > 0 || r > 0) : false,
    known: !!P.scope,
  };
}

/**
 * The ideal line's two endpoints, in value space, or null when there is nothing to run between.
 *
 * From the starting scope at the start date to zero at the end date, and nothing cleverer. It is
 * not re-baselined when scope moves, because re-baselining would quietly redefine the reference
 * every time the work grew and there would then be no fixed thing to deviate FROM.
 *
 * @example bdIdeal({ start: 0, end: 10, startScope: 20 }).y0;   // 20
 */
function bdIdeal(P) {
  if (P.xs.length === 0) { return null; }
  if (!isFinite(P.startScope)) { return null; }
  return { x0: P.start, y0: P.startScope, x1: P.end, y1: 0 };
}

/**
 * The whole picture, as a display list, from the shipped payload and the settled settings.
 *
 * Called in Node to draw the copy that ships inside card.html, and in the browser on every settings
 * change, so the caption cannot come to disagree with the picture.
 *
 * @param P   the shipped payload
 * @param cfg the settings, unsettled; bdConfig settles them
 * @returns `{ W, H, marks, note }`
 *
 * @example bdRender(payload, { ideal: false }).note.aria;
 */
function bdRender(P, cfg) {
  var conf = bdConfig(cfg);
  var n = P.xs.length, i;
  var S = bdScope(P);
  var marks = [];

  /* An end date before the start date is refused rather than drawn. Swapping them would invent an
     iteration nobody planned, and drawing the axis backwards would put later readings to the left
     of earlier ones, which no reader would think to check for. */
  if (P.badRange || n === 0) {
    var Wx = P.W0, Hx = PADT + PLOTH + AXISH;
    marks.push(mText(Wx / 2, (PADT + PLOTH) / 2,
                     P.badRange ? 'end date is before the start date' : 'no data',
                     'ck-empty', 'middle'));
    return { W: Wx, H: Hx, marks: marks, note: bdNote(P, conf, S) };
  }

  var laneH = S.changed ? LANEH : 0;

  /* The y domain always contains zero, because zero is what a burndown is heading for, and extends
     below it only when the adjusted line went there. */
  var vlo = 0, vhi = 0;
  for (i = 0; i < n; i++) {
    if (P.rem[i] > vhi) { vhi = P.rem[i]; }
    if (P.rem[i] < vlo) { vlo = P.rem[i]; }
    if (conf.adjusted && S.known) {
      if (S.adj[i] > vhi) { vhi = S.adj[i]; }
      if (S.adj[i] < vlo) { vlo = S.adj[i]; }
    }
  }
  var ideal = conf.ideal ? bdIdeal(P) : null;
  if (ideal && ideal.y0 > vhi) { vhi = ideal.y0; }
  if (!(vhi > vlo)) { vhi = vlo + 1; }

  var snapped = axisTicks(vlo, vhi, 5);

  var leftW = 0;
  for (i = 0; i < snapped.ticks.length; i++) { leftW = Math.max(leftW, tw(CK.fmt(snapped.ticks[i]))); }
  var padL = Math.round(Math.min(90, leftW)) + 12;

  var W = P.W0;
  var plot = { x0: padL, y0: PADT, x1: W - PADR, y1: PADT + PLOTH };
  var lane = { y0: plot.y1, y1: plot.y1 + laneH };
  var xLabelY = lane.y1 + 13;
  var keyY = lane.y1 + AXISH + 11;
  var H = lane.y1 + AXISH + KEYH;

  var xlo = Math.min(P.start, P.xs[0]);
  var xhi = Math.max(P.end, P.xs[n - 1]);
  var xScale = CK.scale([xlo, xhi], [plot.x0, plot.x1]);
  var vScale = CK.scale([snapped.lo, snapped.hi], [plot.y1, plot.y0]);
  var span = xhi - xlo;

  var t, ty, px;

  for (i = 0; i < snapped.ticks.length; i++) {
    t = snapped.ticks[i];
    ty = vScale(t);
    marks.push(mLine(plot.x0, ty, plot.x1, ty, t === 0 ? 'ck-axis' : 'ck-rule'));
    marks.push(mText(plot.x0 - 6, ty + 3.2, CK.fmt(t), 'ck-tk', 'end'));
  }
  marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));

  /* The x gridlines are at the readings themselves when there are few of them, and at evenly
     spaced positions otherwise, so a two-week sprint gets one rule per reading. */
  var want = Math.max(2, Math.min(8, Math.floor((plot.x1 - plot.x0) / 74)));
  for (i = 0; i <= want; i++) {
    var xv = xlo + (xhi - xlo) * (want === 0 ? 0 : i / want);
    px = xScale(xv);
    marks.push(mLine(px, plot.y0, px, lane.y1, 'ck-rule'));
    marks.push(mText(px, xLabelY, fmtT(xv, span), 'ck-tk',
                     i === 0 ? 'start' : i === want ? 'end' : 'middle'));
  }

  /* The scope lane, hanging off the zero axis. Stacked rather than netted: adding twenty and
     removing twenty is not the same event as nothing happening, and a net band would draw them
     identically. */
  if (S.changed) {
    var laneMax = 0;
    for (i = 0; i < n; i++) {
      if (S.cumAdd[i] + S.cumRem[i] > laneMax) { laneMax = S.cumAdd[i] + S.cumRem[i]; }
    }
    var lScale = CK.scale([0, laneMax > 0 ? laneMax : 1], [lane.y0, lane.y1 - 8]);
    var zero = [], midd = [], bot = [];
    for (i = 0; i < n; i++) {
      px = xScale(P.xs[i]);
      zero.push({ x: px, y: lScale(0) });
      midd.push({ x: px, y: lScale(S.cumAdd[i]) });
      bot.push({ x: px, y: lScale(S.cumAdd[i] + S.cumRem[i]) });
    }
    if (n > 1) {
      if (S.added > 0) { marks.push(mPath(areaPath(zero, midd), 'ck-bd-add')); }
      if (S.removed > 0) { marks.push(mPath(areaPath(midd, bot), 'ck-bd-drop')); }
    }
    marks.push(mLine(plot.x0, lane.y1 - 8, plot.x1, lane.y1 - 8, 'ck-rule'));
    marks.push(mText(plot.x0 + 3, lane.y1 - 1,
                     'scope moved: ' + CK.fmt(S.added) + ' added, ' + CK.fmt(S.removed) +
                     ' removed' + (P.unit ? ' (' + P.unit + ')' : ''), 'ck-tk', 'start'));
  }

  /* The ideal line, drawn under everything else: it is a reference and should never be the first
     thing the eye lands on. */
  if (ideal) {
    marks.push(mPath(linePath([{ x: xScale(ideal.x0), y: vScale(ideal.y0) },
                               { x: xScale(ideal.x1), y: vScale(ideal.y1) }]), 'ck-bd-ideal'));
  }

  var remPts = [], adjPts = [];
  for (i = 0; i < n; i++) {
    px = xScale(P.xs[i]);
    remPts.push({ x: px, y: vScale(P.rem[i]) });
    adjPts.push({ x: px, y: vScale(S.adj[i]) });
  }

  if (conf.adjusted && S.known && S.changed && n > 1) {
    marks.push(mPath(linePath(adjPts), 'ck-bd-adj'));
  }

  if (n > 1) { marks.push(mPath(linePath(remPts), 'ck-bd-remain')); }
  else { marks.push(mDot(remPts[0].x, remPts[0].y, 3, 'ck-bd-solo')); }

  if (conf.dots && n > 1) {
    for (i = 0; i < n; i++) { marks.push(mDot(remPts[i].x, remPts[i].y, 2.1, 'ck-bd-dot')); }
  }

  /* The moment the readings stop, and the moment the iteration ends, are two different facts and
     are marked separately. Drawing the line on to the end date would imply a collapse to zero that
     has not happened. */
  if (P.now >= xlo && P.now <= xhi && P.now > P.xs[n - 1]) {
    px = xScale(P.now);
    marks.push(mLine(px, plot.y0, px, plot.y1, 'ck-bd-now'));
    marks.push(mText(px - 3, plot.y0 + 9, 'now', 'ck-tk', 'end'));
  }
  if (P.end > P.xs[n - 1]) {
    px = xScale(P.end);
    marks.push(mLine(px, plot.y0, px, lane.y1, 'ck-bd-end'));
  }

  /* The key is drawn rather than written in markup, so that turning a line off removes its entry
     in the same call that removes the line. A legend that survives its own series is a legend that
     lies. */
  var keys = [{ c: 'ck-bd-k-remain', s: 'remaining' }];
  if (ideal) { keys.push({ c: 'ck-bd-k-ideal', s: 'ideal' }); }
  if (conf.adjusted && S.known && S.changed) { keys.push({ c: 'ck-bd-k-adj', s: 'against original scope' }); }
  if (S.changed && S.added > 0) { keys.push({ c: 'ck-bd-k-add', s: 'scope added' }); }
  if (S.changed && S.removed > 0) { keys.push({ c: 'ck-bd-k-drop', s: 'scope removed' }); }

  var kx = plot.x0;
  for (i = 0; i < keys.length; i++) {
    marks.push(mLine(kx, keyY - 3, kx + 13, keyY - 3, keys[i].c));
    marks.push(mText(kx + 17, keyY, keys[i].s, 'ck-tk', 'start'));
    kx += 13 + 4 + tw(keys[i].s) + 14;
  }

  return { W: W, H: H, marks: marks, note: bdNote(P, conf, S) };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The order is deliberate. Scope comes before progress, because progress cannot be read correctly
 * without it — a reader who learns the remaining figure first has already formed an opinion by the
 * time they are told the work grew. The ideal line's assumptions come next, stated as assumptions,
 * because the line looks like a target and is not one.
 *
 * @param P    the shipped payload
 * @param conf the settled settings
 * @param S    the scope movement, from bdScope
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function bdNote(P, conf, S) {
  var n = P.xs.length, unit = P.unit ? ' ' + P.unit : '', bits = [], said = [], i;

  if (P.badRange) {
    var why = 'The end date given is before the start date, so there is no iteration to draw. ' +
              'The dates are refused rather than swapped: swapping them would invent an ' +
              'iteration nobody planned.';
    return { aria: 'Burndown refused: ' + why, caption: '<b>refused</b> \u2014 ' + CK.esc(why) };
  }
  if (n === 0) {
    return {
      aria: 'Burndown with no readings: nothing is drawn.',
      caption: 'a burndown with <b>no readings</b> &mdash; the frame is drawn so the card keeps ' +
               'its place, but there is nothing in it.' +
               (P.refused ? ' <span class="ck-aside">' + CK.esc(P.refused +
                 ' point' + (P.refused === 1 ? ' was' : 's were') +
                 ' refused for having no usable time or remaining figure.') + '</span>' : ''),
    };
  }

  var remNow = P.rem[n - 1];
  var remStart = P.rem[0];
  var delivered = remStart - S.adj[n - 1];
  var days = P.end > P.start ? Math.round((P.end - P.start) / DAY) : 0;
  var elapsed = Math.round((Math.min(P.now, P.end) - P.start) / DAY);
  if (elapsed < 0) { elapsed = 0; }
  if (elapsed > days) { elapsed = days; }

  var zeroAt = -1;
  for (i = 0; i < n; i++) { if (zeroAt < 0 && P.rem[i] <= 0) { zeroAt = i; } }

  bits.push('<b>' + CK.esc(CK.fmt(remNow) + unit) + '</b> remaining of <b>' +
            CK.esc(CK.fmt(P.startScope) + unit) + '</b> committed at the start' +
            (days > 0 ? ', at day <b>' + CK.esc(String(elapsed)) + '</b> of <b>' +
                        CK.esc(String(days)) + '</b>' : '') + '.');
  said.push(CK.fmt(remNow) + unit + ' remaining of ' + CK.fmt(P.startScope) + unit +
            ' committed at the start' + (days > 0 ? ', day ' + elapsed + ' of ' + days : '') + '.');

  /* Scope, before progress. A reader who learns the remaining figure first has already decided
     what it means by the time they are told the work grew. */
  if (!S.known) {
    bits.push('<b>This burndown cannot show scope change.</b> The data carries a remaining figure ' +
              'and no scope figure, so there is nothing to compare consecutive totals against. ' +
              'That matters more than it sounds: a remaining line that goes flat looks the same ' +
              'whether the team stopped delivering or the work grew, and only one of those two ' +
              'readings blames anybody. Supply a <i>scope</i> total on every point to make the ' +
              'difference visible.' +
              (P.partialScope ? ' Some points carry one and some do not; scope is all-or-nothing ' +
                                'here, because filling the gaps would invent a moment at which ' +
                                'work arrived.' : ''));
    said.push('This burndown cannot show scope change: the data carries no scope figure, so a ' +
              'flat line cannot be distinguished from work being added.');
  } else if (!S.changed) {
    bits.push('<b>Scope did not change</b>: <b>0</b> added and <b>0</b> removed' +
              CK.esc(unit) + '. The remaining line is therefore the whole story, and the ' +
              'against-original-scope line would sit exactly on top of it, so it is not drawn.');
    said.push('Scope did not change: zero added and zero removed' + unit + '.');
  } else {
    bits.push('<b>Scope changed</b>: <b>' + CK.esc(CK.fmt(S.added)) + '</b> added and <b>' +
              CK.esc(CK.fmt(S.removed)) + '</b> removed' + CK.esc(unit) +
              ', drawn as the band below the zero axis. ' +
              (S.added > 0
                ? 'Added work FLATTENS the remaining line without anything going wrong, so a flat ' +
                  'stretch here is not a team that stopped. '
                : 'Removed work drops the remaining line without anything being delivered. ') +
              (conf.adjusted
                ? 'The dashed line is remaining against the original scope alone, with every later ' +
                  'move taken back out; actual delivery over the run was <b>' +
                  CK.esc(CK.fmt(delivered) + unit) + '</b>.'
                : 'Actual delivery over the run was <b>' + CK.esc(CK.fmt(delivered) + unit) +
                  '</b>; switch the against-original-scope line on to see it as a line.'));
    said.push('Scope changed: ' + CK.fmt(S.added) + ' added and ' + CK.fmt(S.removed) +
              ' removed' + unit + ', drawn below the zero axis. Actual delivery over the run was ' +
              CK.fmt(delivered) + unit + '.');
  }

  if (conf.ideal) {
    bits.push('<i>The ideal line runs straight from <b>' + CK.esc(CK.fmt(P.startScope) + unit) +
              '</b> at the start to zero at the end date. It assumes constant throughput and a ' +
              'fixed scope, neither of which is ever quite true, so it is a reference and not a ' +
              'prediction \u2014 every real burndown deviates from it, and reading deviation as ' +
              'failure is the error this chart invites.</i>');
    said.push('The ideal line assumes constant throughput and fixed scope; it is a reference, ' +
              'not a prediction.');
  }

  /* Where the iteration actually stands. Four states, and they are told apart by the readings
     rather than by the ideal line, which knows nothing. */
  if (delivered <= 0) {
    bits.push('<b>Nothing has been delivered yet</b>' +
              (S.changed ? ' once scope movement is taken out' : '') +
              ': remaining started at <b>' + CK.esc(CK.fmt(remStart) + unit) + '</b> and is at <b>' +
              CK.esc(CK.fmt(remNow) + unit) + '</b>.');
  } else if (zeroAt >= 0) {
    var early = Math.round((P.end - P.xs[zeroAt]) / DAY);
    bits.push('Remaining reached zero on <b>' + CK.esc(fmtStamp(P.xs[zeroAt])) + '</b>, ' +
              (early > 0 ? '<b>' + CK.esc(String(early)) + '</b> day' + (early === 1 ? '' : 's') +
                           ' before the end date.'
                         : early < 0 ? '<b>' + CK.esc(String(-early)) + '</b> day' +
                           (early === -1 ? '' : 's') + ' after it.'
                         : 'on the end date itself.'));
  } else if (P.now >= P.end) {
    bits.push('The iteration ended with <b>' + CK.esc(CK.fmt(remNow) + unit) + '</b> still open.');
  } else {
    var left = Math.round((P.end - P.now) / DAY);
    bits.push('The iteration is still running: <b>' + CK.esc(String(left)) + '</b> day' +
              (left === 1 ? '' : 's') + ' left.');
  }

  if (P.rem[n - 1] > P.rem[0]) {
    bits.push('Remaining ended <b>higher</b> than it started' +
              (S.changed ? ', which the scope band accounts for' :
                           ', and no scope figure explains it') + '.');
  }

  /* The line stops at the last reading, always. Saying so is not pedantry: the gap between that
     reading and the end date is the part a reader is most likely to fill in optimistically. */
  var gap = Math.round((P.end - P.xs[n - 1]) / DAY);
  if (gap > 0) {
    bits.push('<span class="ck-aside">The line stops at the last reading, ' +
              CK.esc(fmtStamp(P.xs[n - 1])) + ', <b>' + CK.esc(String(gap)) + '</b> day' +
              (gap === 1 ? '' : 's') + ' short of the end date. Nothing is drawn across that gap, ' +
              'because nothing is known about it.</span>');
  }

  var notes = [];
  if (P.refused) { notes.push(P.refused + ' point' + (P.refused === 1 ? '' : 's') + ' had no usable time or remaining figure and ' + (P.refused === 1 ? 'was' : 'were') + ' refused, not coerced'); }
  if (P.dupes) { notes.push(P.dupes + ' duplicate reading' + (P.dupes === 1 ? '' : 's') + '; the last value at each moment wins'); }
  if (P.badScope) { notes.push(P.badScope + ' scope figure' + (P.badScope === 1 ? '' : 's') + ' refused for not being a finite number'); }
  if (P.badStart) { notes.push('the given start date is not a date; the first reading is used instead'); }
  if (P.badEnd) { notes.push('the given end date is not a date; the last reading is used instead'); }
  if (P.badNow) { notes.push('the given reference time is not a time; the build time is used instead'); }
  if (notes.length) { bits.push('<span class="ck-aside">' + CK.esc(notes.join(' \u00b7 ')) + '</span>'); }

  return {
    aria: 'Burndown of ' + n + ' readings. ' + said.join(' '),
    caption: bits.join(' '),
  };
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic. */
const SHIPPED = [fin, tw, pad2, fmtT, fmtStamp, axisTicks, mLine, mText, mPath, mDot, linePath,
                 areaPath, bdConfig, bdScope, bdIdeal, bdNote, bdRender];

/* ── emit ────────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into the
   thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so a unit string containing `</script>` cannot close the block early,
 * with the useful side effect that no caller string can put an arrow into a file contractually free
 * of them. The question mark goes the same way, so no caller string can spell optional chaining
 * either and trip the guard with a message about a rule it did not break.
 *
 * @example jsLit({ unit: '</script>' });   // '{"unit":"\\u003c/script\\u003e"}'
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
  return s + '>' + (m.s != null ? CK.esc(m.s) : '') + '</' + m.t + '>';
}

/** The whole display list as markup. */
function svgInner(marks) { return marks.map(oneMark).join(''); }

/**
 * The banner above the plot: the one scope fact that no setting can hide.
 *
 * Emitted in Node and never touched by the browser half, because it states a property of the DATA
 * rather than of the current view — which is exactly why it belongs outside the redrawn SVG.
 *
 * @param S the scope movement
 * @param unit the caller's unit word
 * @returns markup, or '' when scope is known and did not move
 */
function bannerHtml(S, unit) {
  /* The space between the two spans is load-bearing exactly once: a flex container drops a
     whitespace-only text node, so it costs nothing on screen, and without it the banner reads
     "scope moved6 added" everywhere the markup is flattened back to text. */
  if (!S.known) {
    return '<div class="ck-bd-warn" role="status">' +
           '<span class="ck-bd-warn-lead">scope change not shown</span> ' +
           '<span>no scope figure in the data \u2014 a flat line here cannot be told apart from ' +
           'work being added</span></div>';
  }
  if (!S.changed) return '';
  return '<div class="ck-bd-warn" data-kind="moved" role="status">' +
         '<span class="ck-bd-warn-lead">scope moved</span> ' +
         '<span>' + CK.esc(CK.fmt(S.added)) + ' added, ' + CK.esc(CK.fmt(S.removed)) +
         ' removed' + (unit ? ' ' + CK.esc(unit) : '') + '</span></div>';
}

/** The card's markup: one section, a gear, a settings panel, the plot drawn, and the caption. */
function cardHtml(id, title, seed, banner) {
  const f = (name) => CK.esc(id) + '-' + name;

  const plot =
    '<svg class="ck-plot ck-bd-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H +
    '" aria-label="' + CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-burndown">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="burndown settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('ideal') + '">ideal line</label>\n' +
    '    <input type="checkbox" id="' + f('ideal') + '" name="ideal"' +
           (defaults.ideal ? ' checked' : '') + '>\n' +
    '    <label for="' + f('adjusted') + '">against original scope</label>\n' +
    '    <input type="checkbox" id="' + f('adjusted') + '" name="adjusted"' +
           (defaults.adjusted ? ' checked' : '') + '>\n' +
    '    <label for="' + f('dots') + '">mark readings</label>\n' +
    '    <input type="checkbox" id="' + f('dots') + '" name="dots"' +
           (defaults.dots ? ' checked' : '') + '>\n' +
    '    <p class="ck-set-foot">There is no switch for the scope band. It is drawn when scope ' +
         'moved and absent when it did not, so its absence means something \u2014 and a control ' +
         'that hides the one quantity this card exists to add would eventually be found switched ' +
         'on in the review where it mattered. The ideal line assumes constant throughput and a ' +
         'fixed scope; it is a reference, not a target.</p>\n' +
    '  </div>\n' +
    (banner ? '  ' + banner + '\n' : '') +
    '  ' + plot + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned.
 *
 * @param id      the card's `data-card` value
 * @param payload the shipped payload
 * @param cfg     the defaults the settings panel is checked against
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* burndown card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The caption comes out of the same call as the marks, so it cannot come to\n' +
    '   describe a picture that is not on the screen. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '  var PADT = ' + jsLit(PADT) + ', PLOTH = ' + jsLit(PLOTH) + ', LANEH = ' + jsLit(LANEH) +
        ', KEYH = ' + jsLit(KEYH) + ', AXISH = ' + jsLit(AXISH) + ', PADR = ' + jsLit(PADR) +
        ', DAY = ' + jsLit(DAY) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-bd-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where geometry decisions live. */\n' +
    '  function node(m) {\n' +
    '    var e = document.createElementNS(NS, m.t), a = m.a, k;\n' +
    '    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }\n' +
    '    if (m.s != null) { e.textContent = m.s; }\n' +
    '    return e;\n' +
    '  }\n' +
    '\n' +
    '  /* A repaint, not an append: the desk swaps its main element and replays every builder, so\n' +
    '     a render that added marks would stack a second line on the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = bdRender(P, conf), i;\n' +
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

  return guardEmitted(src, 'cardkit/burndown');
}

/**
 * Build one burndown card.
 *
 * ON THE SCOPE CONVENTION, AND WHAT IT COSTS. Added and removed scope are stacked in a lane below
 * the zero axis rather than netted into one signed band, and rather than drawn as a second line on
 * the main axis. Netting was rejected because add-twenty-remove-twenty is an iteration in trouble
 * and a net band draws it as an iteration in which nothing happened. A scope LINE on the main axis
 * was rejected because it competes with the remaining line for the same reading — two descending
 * curves in one frame, one of which is a ceiling and one of which is a level, and readers conflate
 * them; the lane cannot be confused with remaining work because it is not in the same space. The
 * cost of the lane is that net scope is not directly readable, which is why the caption always
 * states both totals in units.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data                an empty frame, captioned "no readings"
 *   a single reading       a dot rather than a line, plus the ideal line, which needs only the
 *                          starting scope and the two dates
 *   end before start       refused: no plot, and a caption saying the dates are not swapped
 *                          because swapping them would invent an iteration nobody planned
 *   scope added            the lane, the against-original-scope line, and a caption that says a
 *                          flat stretch is work arriving rather than work stopping
 *   scope removed          the same lane in the other colour; the caption says the drop was not
 *                          delivery
 *   scope removed to zero  remaining and scope both reach zero; the caption reports it as scope
 *                          removal rather than as completion, because the delivered figure is
 *                          computed against the original scope
 *   no scope figure        a banner and a caption saying the card cannot show scope change, and
 *                          why that specifically matters
 *   partial scope figures  the same, with a note: scope is all-or-nothing, because filling the
 *                          gaps would invent a moment at which work arrived
 *   finished early         the line stops at zero; the caption names the date and the days spare
 *   finished late          the caption says how much was still open at the end date
 *   not started            the caption says nothing has been delivered yet and gives both figures
 *   still running          the line stops at the last reading and the caption says how far short
 *                          of the end date that is; nothing is drawn across the gap
 *   remaining goes up      drawn as it is; the caption says remaining ended higher than it
 *                          started, and whether the scope band accounts for it
 *   non-integer points     kept exactly; 2.5 is a perfectly ordinary estimate and rounding it
 *                          would move the line
 *   a bad date or value    refused, counted and named; never coerced
 *   duplicate moments      the last reading at each moment wins, and the overwrite is counted
 *
 * @param id    the card's identity; becomes its `data-card` and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ start, end, unit, now, points }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'sprint-14',
 *   title: 'sprint 14 burndown',
 *   data: { start: '2026-08-17', end: '2026-08-28', unit: 'points',
 *           points: [{ t: '2026-08-17', remaining: 40, scope: 40 },
 *                    { t: '2026-08-20', remaining: 33, scope: 40 },
 *                    { t: '2026-08-24', remaining: 34, scope: 48 }] },
 *   ord: 32,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'burndown' : id);
  const read = readData(data);

  const xs = read.rows.map((r) => r.t);
  const rem = read.rows.map((r) => r.remaining);
  const scope = read.hasScope ? read.rows.map((r) => r.scope) : null;

  const start = read.givenStart !== null ? read.givenStart : (xs.length ? xs[0] : 0);
  const end = read.givenEnd !== null ? read.givenEnd : (xs.length ? xs[xs.length - 1] : 0);
  const badRange = xs.length > 0 && end < start;

  /* The starting scope is the committed total the ideal line runs down from. With a scope series
     it is the first total; without one the first remaining figure is the only candidate, and the
     caption is careful to call it what it is. */
  const startScope = xs.length === 0 ? 0 : (scope ? scope[0] : rem[0]);

  const P = {
    xs, rem, scope,
    start, end, badRange, startScope,
    now: read.givenNow !== null ? read.givenNow : Date.now(),
    nowGiven: read.givenNow !== null,
    unit: read.unit,
    hasScope: read.hasScope,
    partialScope: read.partialScope,
    refused: read.refused,
    dupes: read.dupes,
    badScope: read.badScope,
    badStart: read.badStart,
    badEnd: read.badEnd,
    badNow: read.badNow,
    W0,
  };

  const seed = bdRender(P, defaults);
  const S = bdScope(P);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      readings: xs.length,
      unit: read.unit,
      startScope,
      remaining: xs.length ? rem[xs.length - 1] : null,
      scopeKnown: read.hasScope,
      added: S.added,
      removed: S.removed,
      delivered: xs.length ? rem[0] - S.adj[xs.length - 1] : 0,
      refused: { points: read.refused, duplicates: read.dupes, scopeFigures: read.badScope },
      badRange,
      settings: { ...defaults },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed,
                   bannerHtml(S, read.unit)),
    css: CSS,
    js: cardJs(cardId, P, defaults),
  };
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch is
   the only thing that has to know anything and nothing keys off `prefers-color-scheme`. */
const CSS = `
  .ck-burndown { position: relative; }

  /* ── the scope banner ───────────────────────────────────────────────────────────────────
     The one fact no setting can hide, stated above the picture rather than inside it. */

  .ck-burndown .ck-bd-warn {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px;
    margin: 10px 0 6px; padding: 6px 9px;
    border: 1px solid var(--ck-s1); border-left-width: 4px; border-radius: 5px;
    background: var(--well);
    font-family: var(--mono); font-size: 10.5px; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .ck-burndown .ck-bd-warn[data-kind="moved"] { border-color: var(--ck-s2); }
  .ck-burndown .ck-bd-warn-lead {
    font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--ck-s1);
  }
  .ck-burndown .ck-bd-warn[data-kind="moved"] .ck-bd-warn-lead { color: var(--ck-s2); }

  /* ── the plot ───────────────────────────────────────────────────────────────────────────
     Remaining is the loudest line because it is the one the card is about. The ideal line is
     faint and dashed because it is a reference, and a reference drawn as boldly as a measurement
     is how a reference becomes a target. */

  .ck-burndown .ck-bd-plot .ck-tk { fill: var(--ink-faint); }
  .ck-burndown .ck-bd-plot .ck-empty { fill: var(--ink-faint); font-size: 11px; }

  .ck-burndown .ck-bd-remain { fill: none; stroke: var(--accent); stroke-width: 1.9;
                               stroke-linejoin: round; stroke-linecap: round; }
  .ck-burndown .ck-bd-ideal  { fill: none; stroke: var(--ink-faint); stroke-width: 1.1;
                               stroke-dasharray: 5 4; }
  .ck-burndown .ck-bd-adj    { fill: none; stroke: var(--ck-s6); stroke-width: 1.4;
                               stroke-dasharray: 3 3; stroke-linejoin: round; }
  .ck-burndown .ck-bd-solo   { fill: var(--accent); stroke: none; }
  .ck-burndown .ck-bd-dot    { fill: var(--accent); stroke: none; }

  /* The scope lane. Two bands, stacked, both hanging off the zero axis: netting them would draw
     twenty added and twenty removed as nothing at all. */
  .ck-burndown .ck-bd-add  { fill: var(--ck-s2); fill-opacity: .75; stroke: none; }
  .ck-burndown .ck-bd-drop { fill: var(--ck-s5); fill-opacity: .75; stroke: none; }

  .ck-burndown .ck-bd-now { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 2 3; }
  .ck-burndown .ck-bd-end { stroke: var(--rule); stroke-width: 1; }

  /* The key is drawn inside the SVG, so switching a line off removes its entry in the same call
     that removes the line. A legend that outlives its own series is a legend that lies. */
  .ck-burndown .ck-bd-k-remain { stroke: var(--accent); stroke-width: 2.4; }
  .ck-burndown .ck-bd-k-ideal  { stroke: var(--ink-faint); stroke-width: 1.4; stroke-dasharray: 5 4; }
  .ck-burndown .ck-bd-k-adj    { stroke: var(--ck-s6); stroke-width: 1.6; stroke-dasharray: 3 3; }
  .ck-burndown .ck-bd-k-add    { stroke: var(--ck-s2); stroke-width: 6; }
  .ck-burndown .ck-bd-k-drop   { stroke: var(--ck-s5); stroke-width: 6; }
`;

export default { meta, build };
