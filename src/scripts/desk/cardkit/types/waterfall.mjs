/**
 * @file cardkit card type: `waterfall` — the contribution bridge.
 *
 * A start value, a run of signed contributions, an end value, and the arithmetic that gets from
 * the first to the last drawn as geometry instead of asserted in a footnote. It is the chart
 * finance actually reaches for and the one no library ships, because it is not a plot of a
 * dataset — it is a proof, and every bar's position depends on the bar before it.
 *
 * The desk's CSP is `script-src 'self'`, so there is no charting library here and there is not
 * going to be one. That is the premise rather than the obstacle.
 *
 * Three of this card's settings — `sort`, `showTotals`, `unit` — change the drawing, and the
 * viewer changes them in the browser, so the geometry engine has to exist there. Writing it twice
 * would be two sources of truth and therefore eventually two different pictures, so it is written
 * once here in ES5 vocabulary and emitted into the page verbatim through
 * `Function.prototype.toString`. Node calls the same functions directly to produce the card's
 * initial markup, its aria label and its caption. One bridge renderer; both halves run it.
 *
 * That is why every function in the engine section uses `var` and `function` and nothing newer:
 * its own source is what ships.
 *
 * No timer. `CK.timer` is for a card that polls; this one draws what it was handed and redraws
 * only when a setting changes, so a repeating callback would burn cycles to redraw the same
 * picture.
 *
 * @see ../kit.js  — `CK.scale`, `CK.ticks`, `CK.fmt`, `CK.hue`, `CK.esc`, `CK.settings`, `CK.build`
 * @see ../kit.css — `.ck-plot`, `.ck-rule`, `.ck-axis`, `.ck-legend`, `.ck-gear`, `.ck-set`,
 *                   `.ck-cap`, `.ck-scroll`, `--ck-s1`..`--ck-s8`, `--ck-grid`
 * @see ./candles.mjs — the finance sibling; same emit contract, same engine-shipping trick
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level defines functions and one array and touches no DOM, so a bare context
 * carrying an empty `window` is enough to run it. Loading it beats reimplementing it: the ticks
 * this file draws at build time are the ticks `CK.ticks` would choose in the browser, down to the
 * float-drift rounding.
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
  catch (e) { throw new Error('cardkit/waterfall: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/waterfall: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every constant the engine reads, in one object so it can be serialised into the page.
 *
 * The emitted script gets this verbatim, so a change here changes both halves at once and the two
 * renderers cannot drift apart on a magic number.
 *
 * `CHW` is the advance of the 9px monospace `.ck-plot text` sets in kit.css; it decides which
 * labels get dropped for collision, so being half a pixel pessimistic drops one that would just
 * have fitted — the safe direction to be wrong in.
 */
const K = {
  CHW: 5.42,      // px per character at TXT
  TXT: 9,         // plot text size, matching kit.css
  W0: 640,        // the desk column's comfortable width
  H0: 300,        // card height
  WMAX: 2400,     // past this the plot stops widening and the column labels thin instead
  MINSLOT: 40,    // px per column below which a bridge stops being readable
  MAXBAR: 52,     // a two-column bridge should not become two billboards
  LABCAP: 96,     // longest column label, in px, before it is clipped
};

/**
 * Every setting the card understands, with the value it falls back to.
 *
 * `showTotals` governs the running subtotals written on the leader lines — the bars keep their own
 * value labels either way, because a bar without its number is a shape. `sort` is `given` (author
 * order, which is usually chronological or causal) or `magnitude` (largest absolute contribution
 * first). `unit` is a prefix or a suffix; see {@link cwUnit} for which.
 */
const DEFAULTS = { showTotals: true, sort: 'given', unit: '' };

/** The two orderings, as a lookup, so an unknown one falls back rather than emptying the card. */
const SORTS = { given: 1, magnitude: 1 };

/**
 * What this card type is, for a picker or a deck index.
 *
 * `shape` is the data literal a caller writes; `defaults` is the settings panel's contract.
 * `unit` sits in both because it is genuinely both: the data may state the unit it is quoted in,
 * and `build` seeds the setting from it, after which the gear owns it.
 *
 * `defaults` is exposed beyond the base contract so a validator can check the settings panel
 * against it without building a card first — the panel and this object have to name the same
 * three things or a control silently does nothing.
 *
 * @example meta.name;   // 'waterfall'
 */
export const meta = {
  name: 'waterfall',
  summary:
    'A contribution bridge — a start column, floating signed contributions joined by leader ' +
    'lines carrying the running subtotal, and an end column, with rises solid and falls hatched.',
  shape: '{ start: { label, value }, steps: [{ label, value }], end: { label }, unit } — steps are signed, and the end column\'s value is derived, never supplied',
  defaults: { ...DEFAULTS },
};

/* ── engine ───────────────────────────────────────────────────────────────────────────────
 *
 * Everything from here to the emit section is shipped to the browser as its own source. ES5
 * vocabulary only: `var`, function declarations, no arrows, no template literals, no `const`.
 * These functions may only reference each other, `K`, `SORTS` and the global `CK`.
 */

/**
 * Round a coordinate to two places, refusing to emit one that is not a number.
 *
 * A `NaN` in an attribute is silent: the browser drops the value and the card renders empty with
 * nothing in the console. Throwing turns that into a stack trace next to the input that caused
 * it — and at build time, into a failing test.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which piece of geometry broke
 * @throws {Error} when `v` is not a finite number
 *
 * @example cwN(12.3456, 'bar');   // 12.35
 */
function cwN(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/waterfall: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's mono face. */
function cwTw(s) { return String(s).length * K.CHW; }

/** Shorten a label to `max` px, keeping the head and marking the cut. */
function cwClip(s, max) {
  var str = String(s);
  var room = Math.floor(max / K.CHW);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/**
 * A DOM id fragment safe to put in a `url(#…)` reference, derived from the card's id.
 *
 * The hatch pattern has to be defined inside this card's own SVG and referenced by id, and two
 * waterfall cards on one desk would otherwise define the same id twice — at which point both
 * bridges use whichever pattern the parser saw last. Deriving the id here rather than at either
 * call site means the definition and the reference cannot disagree.
 *
 * @example cwPid('q3 bridge');   // 'q3-bridge-hatch'
 */
function cwPid(id) {
  return String(id == null ? 'waterfall' : id).replace(/[^A-Za-z0-9_-]/g, '-') + '-hatch';
}

/**
 * Fold a settings object into the three values the engine may assume.
 *
 * Coercive rather than strict: these arrive from `localStorage`, where a viewer may have
 * hand-edited them, and from a card descriptor somebody typed. A bad value should give a working
 * bridge with the default, never an empty card.
 *
 * The unit is capped at twelve characters. It is free text in a settings panel, and a paragraph
 * pasted into it would be repeated on every bar until the card was a wall of prose.
 *
 * @param cfg partial or complete settings; anything unrecognised is ignored
 *
 * @example cwSettle({ sort: 'nope', showTotals: 0 });
 * // { showTotals: false, sort: 'given', unit: '' }
 */
function cwSettle(cfg) {
  var c = cfg && typeof cfg === 'object' ? cfg : {};
  var unit = c.unit == null ? '' : String(c.unit);
  return {
    showTotals: c.showTotals == null ? true : !!c.showTotals,
    sort: SORTS[c.sort] ? c.sort : 'given',
    unit: unit.length > 12 ? unit.slice(0, 12) : unit,
  };
}

/**
 * Read the caller's `data` into the one shape the rest of the engine may assume.
 *
 * A step with a non-numeric value is dropped and counted rather than treated as zero. A zero
 * contribution is a real statement — "this line moved nothing" — and a missing one is not, so
 * silently conflating them would put a claim in the picture that the data never made.
 *
 * The end column's value is never read from the input even when it is offered. The whole promise
 * of a bridge is that the end is the start plus the contributions; taking a supplied end value
 * would let the drawing assert an arithmetic that the bars it is made of do not support.
 *
 * @param data the card's data block, possibly absent or malformed
 * @returns `{ start, steps, endLabel, unit, dropped }`
 *
 * @example
 * cwRead({ start: { label: 'Q1', value: 100 }, steps: [{ label: 'new', value: 20 }] }).steps.length;  // 1
 */
function cwRead(data) {
  var d = data && typeof data === 'object' ? data : {};
  var s = d.start && typeof d.start === 'object' ? d.start : {};
  var e = d.end && typeof d.end === 'object' ? d.end : {};
  var src = Object.prototype.toString.call(d.steps) === '[object Array]' ? d.steps : [];
  var v0 = Number(s.value);
  var steps = [], dropped = 0, i, row, v;

  for (i = 0; i < src.length; i++) {
    row = src[i];
    if (!row || typeof row !== 'object') { dropped++; continue; }
    v = Number(row.value);
    if (!isFinite(v)) { dropped++; continue; }
    steps.push({ label: row.label == null ? 'step ' + (i + 1) : String(row.label), value: v });
  }

  return {
    start: { label: s.label == null ? 'start' : String(s.label), value: isFinite(v0) ? v0 : 0 },
    steps: steps,
    endLabel: e.label == null ? 'end' : String(e.label),
    unit: d.unit == null ? '' : String(d.unit),
    dropped: dropped,
  };
}

/**
 * A number wearing its unit, and its sign when the sign is the point.
 *
 * Where the unit goes is a real question with no type to answer it, so there is a rule and it is
 * written down: an explicit `#` marks the slot (`$#`, `# kg`); otherwise a unit of one or two
 * characters none of which is a letter, a digit or a space reads as a symbol and goes in front
 * (`$`, `€`, `£m`), and anything else reads as a word and goes behind with a space (`kg`, `hrs`,
 * `users`). The sign always leads, even for a prefix unit, because `-$4` is money and `$-4` is a
 * typo.
 *
 * @param v      the value
 * @param unit   the unit string, possibly empty
 * @param signed whether a positive value should carry an explicit `+`
 *
 * A contribution of exactly zero gets no sign at all. `+0` claims a direction the number does not
 * have, and a bridge full of them reads as a column of tiny rises rather than as a line that did
 * not move.
 *
 * @example cwUnit(1200, '$', true);     // '+$1.2k'
 * @example cwUnit(-4.5, 'kg', false);   // '-4.5 kg'
 * @example cwUnit(30, 'USD #', true);   // '+USD 30'
 * @example cwUnit(0, '$', true);        // '$0'
 */
function cwUnit(v, unit, signed) {
  var neg = v < 0;
  var body = CK.fmt(Math.abs(v));
  var sign = neg ? '-' : (signed && v > 0 ? '+' : '');
  if (!unit) return sign + body;
  if (unit.indexOf('#') >= 0) return sign + unit.replace('#', body);
  if (/^[^A-Za-z0-9\s]{1,2}$/.test(unit)) return sign + unit + body;
  return sign + body + ' ' + unit;
}

/**
 * Widen a collapsed domain so a bridge that goes nowhere still has somewhere to be drawn.
 *
 * A start of zero with contributions summing to zero is a legitimate and quite common bridge —
 * it is what "we broke even" looks like — and it collapses the domain to a point, which maps
 * every bar onto one pixel row. Half the magnitude either side puts the flat bridge in the middle
 * of the plot with readable ticks around it; an all-zero bridge has no magnitude to take half of,
 * so it gets a unit.
 *
 * @example cwPad(5, 5);   // [2.5, 7.5]
 * @example cwPad(0, 0);   // [-1, 1]
 */
function cwPad(lo, hi) {
  var e;
  if (lo < hi) return [lo, hi];
  e = Math.abs(lo) * 0.5 || 1;
  return [lo - e, hi + e];
}

/**
 * Round a domain outward to whole ticks, so the top gridline is the top of the plot.
 *
 * `CK.ticks` only returns ticks inside the domain it was given, leaving a ragged strip above the
 * last gridline. Snapping the ends to the step the ticks already chose closes it, and the ticks
 * are then stepped out rather than re-derived: asking `CK.ticks` again with the wider range can
 * push it to the next nice step and halve the gridlines, losing the top tick all over again.
 *
 * @example cwSnap(3, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
 */
function cwSnap(lo, hi, want) {
  var t = CK.ticks(lo, hi, want), step, nlo, nhi, ticks, k, v;
  if (t.length < 2) return { lo: lo, hi: hi, ticks: t };
  step = t[1] - t[0];
  if (!(step > 0)) return { lo: lo, hi: hi, ticks: t };
  nlo = Math.floor(lo / step) * step;
  nhi = Math.ceil(hi / step) * step;
  if (!(nhi > nlo)) return { lo: lo, hi: hi, ticks: t };

  ticks = [];
  for (k = 0; k < 400; k++) {
    v = nlo + k * step;
    if (v > nhi + step / 1e6) break;
    ticks.push(Math.round(v / step) * step);      // kill float drift at the tick
  }
  return { lo: nlo, hi: nhi, ticks: ticks };
}

/** One `<line>`, with both ends checked. */
function cwLine(x1, y1, x2, y2, cls) {
  return '<line x1="' + cwN(x1, 'line') + '" y1="' + cwN(y1, 'line') +
         '" x2="' + cwN(x2, 'line') + '" y2="' + cwN(y2, 'line') + '" class="' + cls + '"/>';
}

/** One `<rect>`, clamped to a non-negative size, with room for a `fill` the CSS cannot express. */
function cwRect(x, y, w, h, cls, extra) {
  return '<rect x="' + cwN(x, 'rect') + '" y="' + cwN(y, 'rect') +
         '" width="' + cwN(Math.max(0, w), 'rect') + '" height="' + cwN(Math.max(0, h), 'rect') +
         '" class="' + cls + '"' + (extra ? ' ' + extra : '') + '/>';
}

/** One `<text>`; the content is escaped because every string here came from the card's data. */
function cwText(x, y, s, cls, anchor) {
  return '<text x="' + cwN(x, 'text') + '" y="' + cwN(y, 'text') + '" class="' + cls + '"' +
         (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + CK.esc(s) + '</text>';
}

/**
 * A placer that will only put a label where nothing else already is.
 *
 * On a bridge the labels are the content — a bar whose number was suppressed is a bar that has
 * stopped making its claim — but a number sitting on top of another number is worse than a number
 * that is missing, because it can be misread as a third value. Candidates are tried in order and
 * the first whose box clears the plot edges and every label already placed wins.
 *
 * The greedy pass runs left to right, so an earlier column gets first refusal on contested space.
 * That is a real bias and a deliberate one: a consistent winner reads better than a label set that
 * reshuffles when one value changes.
 *
 * @param x0 plot bounds; nothing is placed outside them
 * @returns `place(text, candidates)` returning the chosen candidate or null
 *
 * @example cwPlacer(0, 0, 100, 100)('42', [{ x: 50, y: 50, anchor: 'middle' }]);
 */
function cwPlacer(x0, y0, x1, y1) {
  var taken = [];
  return function (text, cands) {
    var w = cwTw(text), i, c, left, box, j, b, clash;
    for (i = 0; i < cands.length; i++) {
      c = cands[i];
      left = c.anchor === 'middle' ? c.x - w / 2 : c.anchor === 'end' ? c.x - w : c.x;
      box = { x0: left - 1.5, y0: c.y - K.TXT + 0.5, x1: left + w + 1.5, y1: c.y + 2.5 };
      if (box.x0 < x0 - 3 || box.x1 > x1 + 3) continue;
      if (box.y0 < y0 - 2 || box.y1 > y1 + 2) continue;
      clash = false;
      for (j = 0; j < taken.length; j++) {
        b = taken[j];
        if (box.x1 <= b.x0 || box.x0 >= b.x1 || box.y1 <= b.y0 || box.y0 >= b.y1) continue;
        clash = true;
        break;
      }
      if (clash) continue;
      taken.push(box);
      return c;
    }
    return null;
  };
}

/**
 * The columns of the bridge, in drawing order, each carrying where it starts and where it ends.
 *
 * This is the whole arithmetic of the card in one loop: a running total that begins at the start
 * value, and one floating segment per contribution spanning from the total before it to the total
 * after. The end column is that final total, drawn from the baseline like the start column,
 * which is what makes the picture a proof rather than an illustration.
 *
 * Sorting by magnitude reorders the contributions and therefore reorders the subtotals. The end
 * value is unchanged — addition commutes — but the intermediate figures are no longer the ones
 * that were ever true at a moment in time. That is the honest trade a sorted bridge makes: it
 * answers "what moved this the most" instead of "what happened, in order", and the caption says
 * which question is on screen.
 *
 * @param read a reading from {@link cwRead}
 * @param cfg  settled settings
 * @returns `{ cols, endValue, ups, downs }`
 *
 * @example cwColumns(cwRead(data), cwSettle({})).cols.length;   // steps + 2
 */
function cwColumns(read, cfg) {
  var steps = read.steps.slice();
  var cols = [], run = read.start.value, ups = 0, downs = 0, i, v;

  if (cfg.sort === 'magnitude') {
    /* Array#sort has been required to be stable since ES2019, so equal magnitudes keep the order
       the author wrote them in. That matters more than it sounds: a bridge whose tied lines swap
       places between two renders looks like the data changed. */
    steps.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
  }

  cols.push({ kind: 'total', label: read.start.label, from: 0, to: run, value: run });

  for (i = 0; i < steps.length; i++) {
    v = steps[i].value;
    if (v > 0) ups++; else if (v < 0) downs++;
    cols.push({ kind: 'step', label: steps[i].label, from: run, to: run + v, value: v });
    run = run + v;
  }

  cols.push({ kind: 'total', label: read.endLabel, from: 0, to: run, value: run });
  return { cols: cols, endValue: run, ups: ups, downs: downs };
}

/**
 * Everything geometric about the plot, computed once from the columns and the settings.
 *
 * The left margin is measured from the tick labels that actually have to fit rather than fixed —
 * a bridge in millions and a bridge in single digits want different amounts of room, and any
 * constant is wrong for one of them. The width is forced by the number of columns: past the desk
 * column's comfortable width the plot keeps its own size and scrolls, because squeezing twenty
 * contributions into 640px produces twenty bars nobody can label.
 *
 * The value domain always contains zero. The start and end columns stand on the baseline, so a
 * domain that excluded it would draw them running off the bottom of their own axis.
 *
 * @param cols columns from {@link cwColumns}
 * @returns the frame: domain, ticks, scale, plot bounds and column geometry
 *
 * @example cwFrame(cwColumns(read, cfg).cols).barW;   // 40.7
 */
function cwFrame(cols) {
  var F = { n: cols.length }, lo = 0, hi = 0, i, c, p, sn, w, want;

  for (i = 0; i < cols.length; i++) {
    c = cols[i];
    lo = Math.min(lo, c.from, c.to);
    hi = Math.max(hi, c.from, c.to);
  }
  p = cwPad(lo, hi);
  sn = cwSnap(p[0], p[1], 5);
  F.dlo = sn.lo; F.dhi = sn.hi; F.ticks = sn.ticks;

  F.padT = 16;
  F.padB = 24;
  F.padR = 14;
  w = 0;
  for (i = 0; i < F.ticks.length; i++) w = Math.max(w, cwTw(CK.fmt(F.ticks[i])));
  F.padL = Math.round(Math.min(80, w)) + 12;

  w = 0;
  for (i = 0; i < cols.length; i++) w = Math.max(w, cwTw(cwClip(cols[i].label, K.LABCAP)));
  F.slotWant = Math.max(K.MINSLOT, w + 10);

  want = F.padL + F.padR + F.n * F.slotWant;
  F.W = Math.min(K.WMAX, Math.max(K.W0, want));
  F.H = K.H0;

  F.x0 = F.padL;
  F.x1 = F.W - F.padR;
  F.y0 = F.padT;
  F.y1 = F.H - F.padB;

  F.slot = (F.x1 - F.x0) / Math.max(1, F.n);
  F.barW = Math.max(2, Math.min(K.MAXBAR, F.slot * 0.62));

  /* CK.scale parks everything at the range midpoint when the domain has zero width, which is what
     keeps an all-zero bridge from dividing by zero — though cwPad has already widened that case,
     so the guard is a second line of defence rather than the first. */
  F.y = CK.scale([F.dlo, F.dhi], [F.y1, F.y0]);
  F.zero = F.y(0);

  /** Screen x of the centre of column number i. */
  F.cx = function (i) { return F.x0 + (i + 0.5) * F.slot; };

  /* The column labels thin out rather than rotate when they collide. A rotated axis buys about
     forty percent more labels and costs every reader a head tilt. */
  F.thin = Math.max(1, Math.ceil((w + 8) / Math.max(0.01, F.slot)));
  F.labW = Math.max(18, F.slot * F.thin - 4);

  return F;
}

/**
 * Gridlines, value ticks, the baseline and the unit note.
 *
 * The zero rule is `.ck-axis` rather than `.ck-rule` always, not only when the domain straddles
 * zero, because on a bridge zero is not one gridline among eight — it is the floor the start and
 * end columns stand on and the line every contribution is measured against.
 *
 * The unit is written once at the top of the axis instead of on every tick. Repeating "USD" eight
 * times down the left edge is eight times the ink for the same fact.
 *
 * @param F    a frame from {@link cwFrame}
 * @param unit the settled unit string
 */
function cwDrawGrid(F, unit) {
  var out = [], i, t, y, note;

  for (i = 0; i < F.ticks.length; i++) {
    t = F.ticks[i];
    y = F.y(t);
    if (y < F.y0 - 0.5 || y > F.y1 + 0.5) continue;
    if (Math.abs(t) > 1e-9) out.push(cwLine(F.x0, y, F.x1, y, 'ck-rule'));
    out.push(cwText(F.x0 - 6, y + 3.2, CK.fmt(t), 'ck-tk', 'end'));
  }

  out.push(cwLine(F.x0, F.y0, F.x0, F.y1, 'ck-axis'));
  if (F.zero >= F.y0 - 0.5 && F.zero <= F.y1 + 0.5) {
    out.push(cwLine(F.x0, F.zero, F.x1, F.zero, 'ck-axis'));
  }

  note = unit.replace('#', '').replace(/^\s+|\s+$/g, '');
  if (note) out.push(cwText(F.x0 - 6, F.y0 - 4, note, 'ck-tk', 'end'));

  return out.join('');
}

/**
 * The bars, the leader lines, and every number on them.
 *
 * Positive and negative are separated on two channels at once. `--ck-s4` against `--ck-s1` is the
 * hue channel, which roughly one man in twelve does not receive; solid against hatched is a
 * texture channel, which everybody receives, and it survives a greyscale print and a photocopier.
 * The start and end columns take a third token and are the only bars touching the baseline, so
 * they are never in question either.
 *
 * Two cases that draw wrong by default and are handled here:
 *
 * - **A contribution of zero still draws.** Its bar would be zero pixels high and therefore
 *   invisible, which is indistinguishable from a line that was not in the data at all. It is
 *   drawn one pixel thick, growing the way a positive bar grows.
 * - **The final leader carries no subtotal.** It would print the end value an inch from the end
 *   column's own label, and two identical numbers that close together read as two different
 *   numbers somebody should reconcile.
 *
 * @param F    a frame from {@link cwFrame}
 * @param cols columns from {@link cwColumns}
 * @param cfg  settled settings
 * @param pid  the hatch pattern's id, from {@link cwPid}
 */
function cwDrawBars(F, cols, cfg, pid) {
  var out = [], subs = [], put = cwPlacer(0, F.y0 - 12, F.W, F.y1), i, c, yA, yB, top, bot;
  var cls, fill, txt, cands, spot, nx, lx0, lx1, sub, sy;

  /* Three passes, and the order of each matters for a different reason.
     Draw order: leaders first, so the bars paint over them — a leader is a thin connector and
     where it meets a bar the bar should win.
     Label order: bars first, so that when a subtotal and a bar value want the same square inch
     the bar keeps it. The bar's number is the claim the picture is making; the subtotal is
     bookkeeping, and bookkeeping yields. */
  for (i = 0; i < cols.length - 1; i++) {
    sy = F.y(cols[i].to);
    /* Between the bars, not across them: the leader's job is to carry the eye over the gap and
       show that the next contribution starts exactly where the last one finished. */
    lx0 = F.cx(i) + F.barW / 2;
    lx1 = F.cx(i + 1) - F.barW / 2;
    out.push(cwLine(lx0, sy, lx1, sy, 'ck-lead'));
  }

  for (i = 0; i < cols.length; i++) {
    c = cols[i];
    nx = F.cx(i);
    yA = F.y(c.from);
    yB = F.y(c.to);
    top = Math.min(yA, yB);
    bot = Math.max(yA, yB);

    /* A zero-height bar is invisible, and invisible is what "not in the data" looks like. Grow it
       one pixel in the direction the bar would have grown, so a zero never lands on the wrong
       side of its own baseline. */
    if (bot - top < 1) {
      if (c.value < 0) bot = top + 1; else top = bot - 1;
    }

    cls = c.kind === 'total' ? 'ck-tot' : c.value < 0 ? 'ck-neg' : 'ck-pos';
    fill = cls === 'ck-neg' ? 'fill="url(#' + pid + ')"' : '';
    out.push('<g class="ck-col"><title>' + CK.esc(c.label + '  ' +
             cwUnit(c.value, cfg.unit, c.kind === 'step')) + '</title>' +
             cwRect(nx - F.barW / 2, top, F.barW, bot - top, cls, fill) + '</g>');

    txt = cwUnit(c.value, cfg.unit, c.kind === 'step');
    /* Outside the far end first, then inside it when the plot edge is in the way. Screen y runs
       downward, so a bar that grew upward has its far end at the smaller y. */
    if (c.value < 0) {
      cands = [{ x: nx, y: bot + 11, anchor: 'middle' }, { x: nx, y: bot - 4, anchor: 'middle' }];
    } else {
      cands = [{ x: nx, y: top - 4, anchor: 'middle' }, { x: nx, y: top + 12, anchor: 'middle' }];
    }
    spot = put(txt, cands);
    if (spot) out.push(cwText(spot.x, spot.y, txt, c.kind === 'total' ? 'ck-valt' : 'ck-val', spot.anchor));

    /* Column labels thin from the left, but the last one is always kept: the end column is what
       the whole bridge is for, and an axis that stops naming things two bars early looks like
       data that stops two bars early. */
    if (i % F.thin === 0 || i === cols.length - 1) {
      out.push(cwText(nx, F.H - 8, cwClip(c.label, F.labW), 'ck-tk', 'middle'));
    }
  }

  /* The running subtotals, last, on whatever space the bars left. The final leader is skipped:
     it would print the end value an inch from the end column's own label, and two identical
     numbers that close together read as two different numbers somebody should reconcile. */
  for (i = 0; cfg.showTotals && i < cols.length - 2; i++) {
    sy = F.y(cols[i].to);
    sub = cwUnit(cols[i].to, cfg.unit, false);
    lx0 = F.cx(i) + F.barW / 2;
    lx1 = F.cx(i + 1) - F.barW / 2;
    /* Only when the gap between the two bars can actually hold it; a subtotal spilling over the
       bars it connects is worse than no subtotal. */
    if (cwTw(sub) + 6 > Math.max(0, lx1 - lx0)) continue;
    spot = put(sub, [{ x: (lx0 + lx1) / 2, y: sy - 4, anchor: 'middle' },
                     { x: (lx0 + lx1) / 2, y: sy + 11, anchor: 'middle' }]);
    if (spot) subs.push(cwText(spot.x, spot.y, sub, 'ck-sub', spot.anchor));
  }

  return out.join('') + subs.join('');
}

/**
 * The hatch pattern, defined once per card.
 *
 * A pattern rather than a stroke-dasharray or an opacity: those are both lightness tricks and
 * lightness is already carrying the value. A texture is a genuinely separate channel, and a
 * reader who cannot tell `--ck-s1` from `--ck-s4` can still tell striped from solid at a glance,
 * on a screen or on a photocopy.
 *
 * The pattern's colours come from CSS classes so this file still names no colour; only the
 * geometry is here.
 *
 * @param pid the pattern id from {@link cwPid}
 */
function cwDefs(pid) {
  return '<defs><pattern id="' + pid + '" width="6" height="6"' +
         ' patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
         '<rect class="ck-hatch-bg" x="0" y="0" width="6" height="6"/>' +
         '<line class="ck-hatch-ln" x1="0" y1="0" x2="0" y2="6"/>' +
         '</pattern></defs>';
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the aria label *is* the chart to anyone using one.
 * "Waterfall chart" names the genre and withholds everything, so this says what it bridges from,
 * what to, which way and by how much, and which contribution dominates in each direction — which
 * is what a sighted reader takes from the first second of looking at it.
 *
 * @returns `{ aria, caption }` — plain text, and markup whose data has been escaped
 *
 * @example cwDescribe(read, built, cfg).aria.slice(0, 9);   // 'Waterfall'
 */
function cwDescribe(read, built, cfg) {
  var cols = built.cols, k = read.steps.length;
  var s0 = read.start.value, s1 = built.endValue, net = s1 - s0;
  var pct = s0 !== 0 ? (net / Math.abs(s0)) * 100 : null;
  var dir = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
  var up = null, dn = null, i, c, aria, bits = [];

  for (i = 1; i < cols.length - 1; i++) {
    c = cols[i];
    if (c.value > 0 && (!up || c.value > up.value)) up = c;
    if (c.value < 0 && (!dn || c.value < dn.value)) dn = c;
  }

  aria = 'Waterfall bridge: ' + read.start.label + ' at ' + cwUnit(s0, cfg.unit, false) +
    (k ? ' through ' + k + ' contribution' + (k === 1 ? '' : 's') : ' with no contributions') +
    ' to ' + read.endLabel + ' at ' + cwUnit(s1, cfg.unit, false) + '. ' +
    (dir === 'flat'
      ? 'Net change is zero, so the bridge ends where it started'
      : 'Net change is ' + cwUnit(net, cfg.unit, true) + ', ' + dir +
        (pct == null ? '' : ' by ' + CK.fmt(Math.abs(pct)) + ' percent')) + '. ' +
    (built.ups ? built.ups + ' rise' + (built.ups === 1 ? '' : 's') + ' drawn solid' : '') +
    (built.ups && built.downs ? ' and ' : '') +
    (built.downs ? built.downs + ' fall' + (built.downs === 1 ? '' : 's') + ' drawn hatched' : '') +
    (built.ups || built.downs ? '. ' : '') +
    (up ? 'The largest rise is ' + up.label + ' at ' + cwUnit(up.value, cfg.unit, true) + '. ' : '') +
    (dn ? 'The largest fall is ' + dn.label + ' at ' + cwUnit(dn.value, cfg.unit, true) + '. ' : '') +
    (cfg.sort === 'magnitude' ? 'Contributions are ordered by size, not by sequence. ' : '');

  bits.push('<b>' + CK.esc(cwUnit(s0, cfg.unit, false)) + '</b> at ' + CK.esc(read.start.label) +
            ' &rarr; <b>' + CK.esc(cwUnit(s1, cfg.unit, false)) + '</b> at ' + CK.esc(read.endLabel));
  bits.push(dir === 'flat'
    ? '<i>the contributions cancel exactly</i>, so the bridge returns to where it started'
    : 'net ' + CK.esc(cwUnit(net, cfg.unit, true)) +
      (pct == null ? '' : ' (' + CK.esc(CK.fmt(Math.abs(pct))) + '%)') +
      ' across ' + CK.esc(String(k)) + ' contribution' + (k === 1 ? '' : 's'));

  if (built.ups || built.downs) {
    bits.push('<i>' + CK.esc(String(built.ups)) + ' up, solid &middot; ' +
              CK.esc(String(built.downs)) + ' down, hatched</i>');
  }
  if (!k) {
    bits.push('<span class="ck-aside">no contributions, so the bridge is its own two ends</span>');
  }
  if (cfg.sort === 'magnitude') {
    bits.push('<span class="ck-aside">sorted by size &mdash; the total is unchanged, but the ' +
              'subtotals on the leaders are no longer a sequence that ever happened</span>');
  }
  if (read.dropped) {
    bits.push('<b>' + CK.esc(String(read.dropped)) + '</b> step' + (read.dropped === 1 ? '' : 's') +
              ' dropped for a missing or non-numeric value');
  }

  return { aria: aria.trim(), caption: bits.join('. ') + '.' };
}

/**
 * Plan one drawing: the whole card's picture, its description and its size, from data plus
 * settings.
 *
 * This is the single entry point both halves of the card use. Node calls it at build time for the
 * static markup; the emitted browser script calls it again on every settings change. Because it
 * is one function rather than two implementations, the caption cannot come to describe a picture
 * the browser is no longer drawing.
 *
 * @param data the card's raw data block
 * @param cfg  settings; passed through {@link cwSettle} first
 * @param id   the card's id, used only to name the hatch pattern
 * @returns `{ w, h, svg, aria, caption }`
 * @throws {Error} when the geometry produces a non-finite coordinate, which is a bug here rather
 *                 than bad input — malformed steps are dropped while reading
 *
 * @example cwPlan({ start: { value: 10 }, steps: [{ value: -4 }] }, {}, 'q3').w;   // 640
 */
function cwPlan(data, cfg, id) {
  var c = cwSettle(cfg);
  var read = cwRead(data);
  var built = cwColumns(read, c);
  var F = cwFrame(built.cols);
  var pid = cwPid(id);
  var note = cwDescribe(read, built, c);

  return {
    w: cwN(F.W, 'view'),
    h: cwN(F.H, 'view'),
    svg: cwDefs(pid) + cwDrawGrid(F, c.unit) + cwDrawBars(F, built.cols, c, pid),
    aria: note.aria,
    caption: note.caption,
  };
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/** The engine functions, in dependency-free order, shipped to the page as their own source. */
const ENGINE = [
  cwN, cwTw, cwClip, cwPid, cwSettle, cwRead, cwUnit, cwPad, cwSnap, cwLine, cwRect, cwText,
  cwPlacer, cwColumns, cwFrame, cwDrawGrid, cwDrawBars, cwDefs, cwDescribe, cwPlan,
];

/**
 * The engine's own source, checked against the contract it is about to be pasted into.
 *
 * Shipping a function by its `toString` ships its inner comments too, and a comment is exactly
 * where a backtick or an arrow sneaks in — nothing executes differently, the module keeps working,
 * and the only symptom is a card that will not parse on a viewer with no transpiler. That is a
 * silent failure with a long fuse, so it is turned into a loud one at build time.
 *
 * @returns the concatenated ES5 source of every engine function
 * @throws {Error} when a function's source contains syntax the emitted script may not carry
 *
 * @example engineSource().indexOf('function cwPlan') > 0;   // true
 */
function engineSource() {
  const src = ENGINE.map((fn) => fn.toString()).join('\n\n');
  const banned = [['`', 'a template literal or a backtick in a comment'],
                  ['=>', 'an arrow function'],
                  ['?.', 'optional chaining']];
  for (const [needle, why] of banned) {
    const at = src.indexOf(needle);
    if (at >= 0) {
      throw new Error('cardkit/waterfall: the emitted engine carries ' + why + ' — near "' +
                      src.slice(Math.max(0, at - 60), at + 20).replace(/\n/g, ' ') + '"');
    }
  }
  if (/(^|[^.\w])(const|let)\s/.test(src)) {
    throw new Error('cardkit/waterfall: the emitted engine declares const or let');
  }
  return src;
}

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` becomes an escape so a label containing `</script>` cannot close the block early; `>` goes
 * with it, which has the side effect that no piece of data can ever put `=>` into a file that is
 * contractually free of arrow functions. Backticks go too, for the same contract, and the two
 * line separators because they are newlines to a JS parser and not to `JSON.stringify`.
 *
 * @example jsonLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v == null ? null : v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** HTML-escape, mirroring `CK.esc` so build-time and browser markup cannot disagree. */
function esc(s) { return CK.esc(s); }

/** The `<option>` list for a `<select>`, with the seeded value pre-selected. */
function options(values, chosen) {
  return values
    .map((v) => '<option value="' + esc(v) + '"' + (v === chosen ? ' selected' : '') +
                '>' + esc(v) + '</option>')
    .join('');
}

/**
 * The card's markup: heading, gear, settings panel, the plot with its initial drawing, a legend
 * and the caption.
 *
 * The plot ships already drawn rather than as an empty box for the script to fill. A card whose
 * picture only exists after JavaScript has run flashes empty on every load and shows nothing at
 * all in a static capture of the desk; the script's job here is to *re*draw when a setting
 * changes, not to draw for the first time.
 *
 * The gear is emitted empty on purpose — `CK.settings` fills it with the kit's drawn gear, and a
 * glyph typed here would be a second source of truth for a shape the kit already owns.
 */
function markup(id, title, plan, cfg) {
  const f = (name) => esc(id) + '-' + name;

  return '<section data-card="' + esc(id) + '" class="ck-waterfall">' +
    '<h2>' + esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="waterfall settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('showTotals') + '">subtotals</label>' +
      '<input id="' + f('showTotals') + '" name="showTotals" type="checkbox"' +
        (cfg.showTotals ? ' checked' : '') + '>' +

      '<label for="' + f('sort') + '">order</label>' +
      '<select id="' + f('sort') + '" name="sort">' + options(['given', 'magnitude'], cfg.sort) + '</select>' +

      '<label for="' + f('unit') + '">unit</label>' +
      '<input id="' + f('unit') + '" name="unit" type="text" spellcheck="false"' +
        ' autocomplete="off" placeholder="$ or kg" value="' + esc(cfg.unit) + '">' +

      '<p class="ck-set-foot">A symbol leads the number, a word follows it; put # where you ' +
      'want it instead.</p>' +
    '</div>' +

    '<div class="ck-scroll">' +
      '<svg class="ck-plot" role="img" viewBox="0 0 ' + plan.w + ' ' + plan.h + '"' +
      ' aria-label="' + esc(plan.aria) + '">' + plan.svg + '</svg>' +
    '</div>' +

    '<div class="ck-legend">' +
      '<span><i class="ck-k-pos"></i>increase</span>' +
      '<span><i class="ck-k-neg"></i>decrease</span>' +
      '<span><i class="ck-k-tot"></i>start and end</span>' +
    '</div>' +

    '<div class="ck-cap">' + plan.caption + '</div>' +
  '</section>';
}

/**
 * Every rule, scoped under the card's own class.
 *
 * Nothing here names a colour. The desk is one document open in a browser and in an editor that
 * want opposite themes, so a hex would be correct in exactly one of them; every value is a token,
 * and the light switch is the only thing that has to know anything. `prefers-color-scheme` is
 * deliberately absent for the same reason — the OS gives both viewers the same answer, and the
 * viewer's own choice has to beat it.
 *
 * Rise and fall are separated twice: by token, and by solid against hatched. The legend repeats
 * the second distinction rather than showing three colour chips, because a key that differs only
 * by hue teaches the wrong thing about the picture.
 *
 * @param id   the card's id, used only for the width rule so two bridges can differ
 * @param wide whether this card's plot is wider than the desk column
 * @param w    that width in px
 */
function styles(id, wide, w) {
  const own = '.ck-waterfall';
  const rules = [
    [own, 'position: relative;'],
    [own + ' h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    [own + ' .ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    [own + ' .ck-plot .ck-val', 'fill: var(--ink-dim);'],
    [own + ' .ck-plot .ck-valt', 'fill: var(--ink);'],
    /* The subtotals sit above a hairline in the gap between two bars; faint keeps them from
       competing with the bar labels, which are the numbers being justified. */
    [own + ' .ck-plot .ck-sub', 'fill: var(--ink-faint);'],

    [own + ' .ck-pos', 'fill: var(--ck-s4); stroke: none;'],
    [own + ' .ck-neg', 'stroke: var(--ck-s1); stroke-width: 1;'],
    [own + ' .ck-tot', 'fill: var(--ck-s6); stroke: none;'],

    /* The hatch's two halves: a tinted ground so the bar reads as filled at a distance, and the
       stripes that make it readable as "not the other one" up close. */
    [own + ' .ck-hatch-bg', 'fill: var(--ck-s1); fill-opacity: .16; stroke: none;'],
    [own + ' .ck-hatch-ln', 'stroke: var(--ck-s1); stroke-width: 2; fill: none;'],

    [own + ' .ck-lead', 'stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 2 2; fill: none;'],

    [own + ' .ck-legend i', 'width: 8px; height: 8px; border-radius: 1px;'],
    [own + ' .ck-legend .ck-k-pos', 'background: var(--ck-s4);'],
    [own + ' .ck-legend .ck-k-tot', 'background: var(--ck-s6);'],
    /* The decrease key is striped rather than a flat chip, so the legend shows the texture the
       bars actually use rather than only their hue. */
    [own + ' .ck-legend .ck-k-neg',
      'background: repeating-linear-gradient(45deg, var(--ck-s1) 0 1.5px, transparent 1.5px 4px),' +
      ' var(--well);'],

    [own + ' .ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    [own + ' .ck-cap', 'overflow-wrap: anywhere;'],
  ];

  /* A plot too wide for the column keeps its own width and scrolls inside `.ck-scroll`, so the
     desk column never widens and the page never grows a horizontal scrollbar of its own. The rule
     is keyed to this card's id because the width depends on how many columns it has; once the
     viewer changes a setting the script sets the width inline and this stops mattering. */
  if (wide) {
    rules.push([own + '[data-card="' + id + '"] .ck-plot', 'min-width: ' + Math.round(w) + 'px;']);
  }

  return rules.map(([sel, body]) => sel + ' { ' + body + ' }').join('\n') + '\n';
}

/**
 * The browser half: the same engine, plus the twenty lines that hang it off the settings panel.
 *
 * Classic script, ES5 vocabulary, wrapped in an IIFE — the engine declares twenty functions and a
 * desk holding two bridges would otherwise have them fight over the global namespace.
 *
 * @param id   the card's `data-card` value
 * @param data the card's data block, serialised
 */
function script(id, data) {
  return '(function () {\n' +
    "  'use strict';\n\n" +
    '  var ID = ' + jsonLit(id) + ';\n' +
    /* The card's OWN unit, not the type's. This emitted the module-level `DEFAULTS` verbatim, so a
       bridge authored with `unit: '$'` drew correctly at build time and then lost the symbol on the
       first `CK.settings` callback — the browser's fallback was the type's empty string, and any
       viewer with nothing stored saw bare numbers. `unit` is the one setting a card legitimately
       seeds, and seeding it is exactly what the emitted fallback has to carry. Found by the deck
       adoption, which built one bridge in dollars and watched the dollars leave. */
    '  var DEFAULTS = ' + jsonLit({
      ...DEFAULTS,
      unit: data && typeof data === 'object' && data.unit != null
        ? String(data.unit).slice(0, 12)
        : DEFAULTS.unit,
    }) + ';\n' +
    '  var DATA = ' + jsonLit(data && typeof data === 'object' ? data : {}) + ';\n' +
    '  var K = ' + jsonLit(K) + ';\n' +
    '  var SORTS = ' + jsonLit(SORTS) + ';\n\n' +
    engineSource() + '\n\n' +
    '  CK.build(ID, function (sec) {\n' +
    '\n' +
    '    var plot = sec.querySelector("svg.ck-plot");\n' +
    '    var cap = sec.querySelector(".ck-cap");\n' +
    '    if (!plot) { return; }\n' +
    '\n' +
    '    /* Redraw from data plus settings. Sorting moves every bar and every subtotal, and the\n' +
    '       unit changes how wide every label is, so there is nothing to patch in place: the\n' +
    '       honest move is to plan the picture again. */\n' +
    '    function apply(cfg) {\n' +
    '      var p;\n' +
    '      try {\n' +
    '        p = cwPlan(DATA, cfg, ID);\n' +
    '      } catch (e) {\n' +
    '        /* A throw here means the geometry went non-finite, which is a bug in this card and\n' +
    '           not in the data. Say so where somebody will see it rather than leaving the last\n' +
    '           good drawing up and pretending it is current. */\n' +
    '        if (cap) { cap.textContent = "this bridge could not be drawn: " + e.message; }\n' +
    '        return;\n' +
    '      }\n' +
    '      plot.setAttribute("viewBox", "0 0 " + p.w + " " + p.h);\n' +
    '      plot.setAttribute("aria-label", p.aria);\n' +
    '      plot.style.minWidth = p.w > K.W0 ? p.w + "px" : "";\n' +
    '      plot.innerHTML = p.svg;\n' +
    '      if (cap) { cap.innerHTML = p.caption; }\n' +
    '    }\n' +
    '\n' +
    '    /* CK.settings wires the gear and the panel idempotently and calls back with the settled\n' +
    '       config immediately, so this one line is also the first redraw after a DOM swap. */\n' +
    '    CK.settings(sec, DEFAULTS, apply);\n' +
    '  });\n' +
    '})();\n';
}

/**
 * Build one waterfall card.
 *
 * The `unit` setting is seeded from `data.unit` when the caller supplied one, because the unit is
 * a property of the numbers rather than a preference — but it stays editable, since a viewer who
 * wants "k" instead of "thousands" should not have to edit the data.
 *
 * @param id    unique on the desk; becomes `data-card`, the settings storage key and the hatch id
 * @param title the card's heading
 * @param data  `{ start, steps, end, unit }` — see {@link meta}; the end's value is always derived
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }` — the descriptor, the markup with its drawing already in it,
 *          scoped CSS, and a classic script
 *
 * @throws {Error} when the geometry produces a non-finite coordinate; that is a bug in this file
 *                 rather than bad input, because malformed steps are dropped while reading
 *
 * @example
 * const card = build({
 *   id: 'arr',
 *   title: 'ARR bridge, FY25',
 *   data: {
 *     unit: '$',
 *     start: { label: 'opening ARR', value: 4_200_000 },
 *     steps: [
 *       { label: 'new logos', value: 980_000 },
 *       { label: 'expansion', value: 610_000 },
 *       { label: 'churn', value: -540_000 },
 *       { label: 'downgrades', value: -180_000 },
 *     ],
 *     end: { label: 'closing ARR' },
 *   },
 *   ord: 25,
 * });
 * card.json.type;   // 'waterfall'
 *
 * @see meta
 * @see cwPlan
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'waterfall' : id);
  const heading = String(title == null ? 'Waterfall' : title);
  const seed = data && typeof data === 'object' ? data : {};
  const cfg = cwSettle({ ...DEFAULTS, unit: seed.unit == null ? DEFAULTS.unit : seed.unit });
  const plan = cwPlan(seed, cfg, cardId);

  return {
    json: {
      id: cardId, type: meta.name, title: heading,
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      settings: cfg,
      steps: cwRead(seed).steps.length,
    },
    html: markup(cardId, heading, plan, cfg),
    css: styles(cardId, plan.w > K.W0, plan.w),
    js: script(cardId, seed),
  };
}

export default { meta, build };
