/**
 * `chart` — a card type that draws line, area, bar, column and scatter plots by hand.
 *
 * The desk's CSP is `script-src 'self'`: no CDN, no bundler, no charting library. That is
 * the premise of this file rather than an obstacle to it. Everything a chart library would
 * do — pick a domain, choose the ticks, place the legend, decide which value labels are
 * legible — is a decision, and a decision made here is one a reader can go and look at.
 *
 * All geometry is computed in Node, at build time, and the browser is handed a display list
 * of primitives rather than data. Two reasons. The arithmetic that goes wrong on degenerate
 * input — one point, a flat series, a domain that straddles zero — goes wrong once, where a
 * test can catch it, instead of once per viewer. And the emitted script stays short enough
 * to read: it turns descriptions into elements and wires the legend, and that is all.
 *
 * `CK` itself is loaded out of `kit.js` and evaluated in a `vm` context, so the ticks drawn
 * here are exactly the ticks `CK.ticks` would have chosen in the browser, and the scales are
 * `CK.scale` with its zero-width-domain guard already in it. A private copy of the same
 * arithmetic would be a second source of truth, and two sources of truth drift.
 *
 * @see ./graph.mjs — the node-link sibling, same contract, same emit shape
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context with a
 * `window` object on it is enough to run it — nothing reaches for `document` until a
 * function that needs the DOM is called, and we call none of those.
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
  catch (e) { throw new Error('cardkit/chart: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/chart: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/** Every plot shape this card knows how to draw. Anything else falls back to `line`. */
const KINDS = new Set(['line', 'area', 'bar', 'column', 'scatter']);

/** Kinds whose category axis is a band of equal slots rather than a continuous number line. */
const BANDED = new Set(['bar', 'column']);

/** Kinds where `stacked` means anything. A stacked scatter is not a thing. */
const STACKABLE = new Set(['bar', 'column', 'area']);

/** Kinds drawn against a baseline, whose value domain must therefore contain zero. */
const ZEROED = new Set(['bar', 'column', 'area']);

/* Metrics for the 9px monospace that `.ck-plot text` sets in kit.css. Measured rather than
   guessed: at 9px the advance is a hair under 5.42px in the mono stacks the desk ships. It
   only has to be close — it decides which value labels are dropped for collision, and being
   half a pixel pessimistic drops a label that would have just fit, which is the safe way to
   be wrong. */
const CHW = 5.42;
const TXT = 9;

/* The desk column is comfortable at 640; a plot wider than that scrolls inside `.ck-scroll`
   rather than widening the page. WMAX stops a 400-category chart from becoming a mile of
   canvas — past it, category labels thin out instead. */
const W0 = 640;
const H0 = 300;
const WMAX = 2200;

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `shape` is one line of prose-shaped source on purpose: it is read by people deciding what to
 * feed the card, and a JSON Schema would say less about what `x` may be while being harder to
 * skim. `bar` is the horizontal one and `column` the vertical one; `stacked` is honoured by bar,
 * column and area, and ignored by line and scatter; `xLabel` and `yLabel` are both optional.
 *
 * There is no `defaults` because there is no gear: everything this card does is decided by the
 * data it was given, so there is nothing for a viewer to change afterwards.
 */
export const meta = {
  name: 'chart',
  summary:
    'Line, area, bar, column and scatter plots drawn as hand-written SVG — tick-derived ' +
    'gridlines, one colour per series, and value labels only where they actually fit.',
  shape: "{ kind: 'line' | 'area' | 'bar' | 'column' | 'scatter', series: [{ name, points: [{ x, y }] }], xLabel, yLabel, stacked } — x numeric or a category string, y numeric",
};

/* ── small shared arithmetic ─────────────────────────────────────────────────────────── */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A `NaN` in a path is silent: the browser drops the whole `d` and the card renders empty
 * with nothing in the console. Failing loudly at build time turns that into a stack trace
 * next to the input that caused it, which is the difference between a bug and a mystery.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(12.3456, 'bar top');   // 12.35
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/chart: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's mono face at `size`. */
function textW(s, size) { return String(s).length * CHW * ((size || TXT) / TXT); }

/** Shorten a label to `max` px, keeping the head and marking the cut. */
function clip(s, max, size) {
  const str = String(s);
  const per = CHW * ((size || TXT) / TXT);
  const room = Math.floor(max / per);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` becomes an escape so a string containing `</script>` cannot close the block early;
 * `>` goes with it, which has the side effect that no series name can ever put `=>` into a
 * file that is contractually free of arrow functions. Backticks go too, for the same
 * contract, and the two line separators because they are newlines to a JS parser and not to
 * `JSON.stringify`.
 *
 * @example jsonLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/* ── reading the data ────────────────────────────────────────────────────────────────── */

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * Points with a non-finite `y` or an absent `x` are dropped here rather than defended
 * against everywhere downstream — a missing reading is missing, and a chart that silently
 * plots it as zero is lying. Empty series are *kept*, because dropping one would shift every
 * later series onto a different colour and the legend would stop matching the picture.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ kind, stacked, rows, numericX, xLabel, yLabel, count }`
 *
 * @example
 * readData({ kind: 'column', series: [{ name: 'opens', points: [{ x: 'Jan', y: 4 }] }] });
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const kind = KINDS.has(d.kind) ? d.kind : 'line';

  const rows = (Array.isArray(d.series) ? d.series : []).map((s, i) => {
    const src = s && Array.isArray(s.points) ? s.points : [];
    const pts = [];
    for (const p of src) {
      if (!p || p.x == null) continue;
      const y = Number(p.y);
      if (!Number.isFinite(y)) continue;
      pts.push({ x: p.x, y });
    }
    return {
      name: String(s && s.name != null ? s.name : 'series ' + (i + 1)),
      pts,
      byCat: new Map(pts.map((p) => [String(p.x), p.y])),
    };
  });

  /* One non-numeric x anywhere makes the whole axis categorical. Mixing a number line and a
     set of names on one axis has no honest reading, so the weaker interpretation wins. */
  const numericX = rows.every((s) => s.pts.every((p) => typeof p.x === 'number' && Number.isFinite(p.x)));

  return {
    kind,
    stacked: !!d.stacked && STACKABLE.has(kind),
    rows,
    numericX,
    xLabel: d.xLabel == null ? '' : String(d.xLabel),
    yLabel: d.yLabel == null ? '' : String(d.yLabel),
    count: rows.reduce((a, s) => a + s.pts.length, 0),
  };
}

/**
 * The category axis as an ordered list of slots.
 *
 * Numeric categories sort numerically, because 2 before 10 is the only ordering a reader
 * will accept; string categories keep first-appearance order across the series, which is the
 * order the author wrote them in and therefore the order they meant.
 *
 * @example categories(rows, false);   // [{ key: 'Jan', label: 'Jan' }, …]
 */
function categories(rows, numericX) {
  const seen = new Map();
  for (const s of rows) {
    for (const p of s.pts) {
      const key = String(p.x);
      if (!seen.has(key)) seen.set(key, { key, label: numericX ? CK.fmt(p.x) : key, x: numericX ? p.x : 0 });
    }
  }
  const out = [...seen.values()];
  if (numericX) out.sort((a, b) => a.x - b.x);
  return out;
}

/**
 * Widen a collapsed domain so that a flat series still has somewhere to be drawn.
 *
 * All-equal values give `lo === hi`, and a zero-height plot area maps every point onto one
 * pixel row. Half the magnitude either side puts the flat line in the middle of the plot
 * with readable ticks around it; all-zero data has no magnitude to take half of, so it gets
 * a unit.
 *
 * @example pad(5, 5);   // [2.5, 7.5]
 * @example pad(0, 0);   // [-1, 1]
 */
function pad(lo, hi) {
  if (lo < hi) return [lo, hi];
  const e = Math.abs(lo) * 0.5 || 1;
  return [lo - e, hi + e];
}

/**
 * The value domain, honouring stacking and the baseline.
 *
 * A stacked chart's extent is the extent of the *totals*, not of the values, and positive
 * and negative parts of a stack accumulate away from zero in opposite directions — so a
 * category holding +3 and -4 reaches from -4 to +3 rather than to -1.
 *
 * @example valueDomain(rows, 'column', false, cats);   // [0, 42]
 */
function valueDomain(rows, kind, stacked, cats) {
  let lo = Infinity;
  let hi = -Infinity;
  const touch = (v) => { if (v < lo) lo = v; if (v > hi) hi = v; };

  if (stacked) {
    for (const c of cats) {
      let up = 0;
      let dn = 0;
      for (const s of rows) {
        const v = s.byCat.has(c.key) ? s.byCat.get(c.key) : 0;
        if (v >= 0) up += v; else dn += v;
      }
      touch(up);
      touch(dn);
    }
  } else {
    for (const s of rows) for (const p of s.pts) touch(p.y);
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }   // nothing to plot
  if (ZEROED.has(kind)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  return pad(lo, hi);
}

/**
 * Round a domain outward to whole ticks, so the top gridline is the top of the plot.
 *
 * `CK.ticks` only returns ticks that fall inside the domain it is given, so a raw data
 * domain leaves a ragged strip above the last gridline. Snapping the ends to the step the
 * ticks already chose closes it. When there are fewer than two ticks there is no step to
 * snap to and the domain is left alone.
 *
 * The ticks are then *stepped out* rather than re-derived. Asking `CK.ticks` again would
 * hand it a slightly wider range, which can push it up to the next nice step and halve the
 * number of gridlines — a domain of -14..21 snaps to -20..30 and then comes back with three
 * gridlines instead of six, and the top of the plot loses its tick again.
 *
 * @example snap(3, 97, 5);   // { lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] }
 */
function snap(lo, hi, want) {
  const t = CK.ticks(lo, hi, want);
  if (t.length < 2) return { lo, hi, ticks: t };
  const step = t[1] - t[0];
  if (!(step > 0)) return { lo, hi, ticks: t };
  const nlo = Math.floor(lo / step) * step;
  const nhi = Math.ceil(hi / step) * step;
  if (!(nhi > nlo)) return { lo, hi, ticks: t };

  const ticks = [];
  for (let k = 0; k < 400; k++) {
    const v = nlo + k * step;
    if (v > nhi + step / 1e6) break;
    ticks.push(Math.round(v / step) * step);          // kill float drift at the tick
  }
  return { lo: nlo, hi: nhi, ticks };
}

/* ── the frame: where every value lands ──────────────────────────────────────────────── */

/**
 * Everything geometric about the plot, computed once.
 *
 * The one idea that keeps this file from having two of every drawing routine: a chart has a
 * *value* axis and a *category* axis, and `bar` is the only kind that hangs them on the
 * other screen directions. `place(c, v)` takes a position on each and returns screen x and
 * y, so a bar and a column are the same eight lines with a different `place`.
 *
 * Margins are measured from the labels that actually have to fit rather than fixed, because
 * a five-digit axis and a two-digit axis want different amounts of room and a constant is
 * wrong for one of them.
 *
 * @param read the output of {@link readData}
 * @returns the frame, including `cats`, `ticks`, `plot` bounds and the mapping functions
 *
 * @example makeFrame(readData(data)).place(0, 42);   // { x: 76.5, y: 130.2 }
 */
function makeFrame(read) {
  const { kind, rows, numericX, stacked } = read;
  const horiz = kind === 'bar';
  const banded = BANDED.has(kind) || !numericX;
  const cats = categories(rows, numericX);

  const dom = valueDomain(rows, kind, stacked, cats);
  const snapped = snap(dom[0], dom[1], 5);
  const vticks = snapped.ticks;

  /* The axis captions describe the *data* axes. On a horizontal bar chart the value axis is
     drawn across the bottom, so `yLabel` — which names the values — is the bottom caption
     and `xLabel` runs up the side. Putting them on fixed screen edges would mislabel every
     bar chart the card ever draws. */
  const sideCap = horiz ? read.xLabel : read.yLabel;
  const footCap = horiz ? read.yLabel : read.xLabel;

  /* Left margin holds whatever runs down the left edge: value ticks normally, category names
     on a bar chart. Category names are capped — past 130px they are eating the plot, and a
     clipped name with the tail marked is more useful than a plot two inches wide. */
  const leftTexts = horiz ? cats.map((c) => c.label) : vticks.map((t) => CK.fmt(t));
  const leftW = Math.min(130, leftTexts.reduce((m, s) => Math.max(m, textW(s)), 0));

  const padT = 14;
  const padR = 16;
  const padB = 22 + (footCap ? 12 : 0);
  const padL = Math.round(leftW) + 12 + (sideCap ? 12 : 0);

  /* Width and height: one of them is free and the other is forced by the number of slots.
     A vertical banded chart needs horizontal room per category — enough for the label, and
     enough for one sub-bar per series when they are grouped — and takes it by growing wider
     and scrolling. A horizontal bar chart takes it by growing taller, which costs nothing
     because the desk scrolls vertically anyway. */
  const grouped = BANDED.has(kind) && !stacked && rows.length > 1;
  const perSlot = horiz
    ? Math.max(16, grouped ? rows.length * 8 + 8 : 18)
    : Math.max(banded ? textW(clip(longest(cats), 90)) + 10 : 0, grouped ? rows.length * 7 + 10 : 14);

  let W = W0;
  let H = H0;
  let thin = 1;

  if (horiz) {
    H = Math.max(180, padT + padB + cats.length * perSlot);
  } else if (banded && cats.length) {
    const want = padL + padR + cats.length * perSlot;
    W = Math.min(WMAX, Math.max(W0, want));
    /* Past WMAX the chart stops growing and the labels thin instead: every k-th category is
       named. The bars all stay — it is the text that could not fit, not the data. */
    const band = (W - padL - padR) / cats.length;
    thin = Math.max(1, Math.ceil((textW(clip(longest(cats), 90)) + 8) / Math.max(1, band)));
  }

  const plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };

  /* The value axis runs bottom-to-top on a column chart and left-to-right on a bar chart;
     `CK.scale` handles a collapsed domain by parking everything at the midpoint, which is
     what saves the single-point and all-equal cases from dividing by zero. */
  const vScale = horiz
    ? CK.scale([snapped.lo, snapped.hi], [plot.x0, plot.x1])
    : CK.scale([snapped.lo, snapped.hi], [plot.y1, plot.y0]);

  const cA = horiz ? plot.y0 : plot.x0;
  const cB = horiz ? plot.y1 : plot.x1;
  const band = cats.length ? (cB - cA) / cats.length : cB - cA;

  const xdom = numericX && !banded ? numberDomain(rows) : [0, 1];
  const xScale = CK.scale(xdom, [cA, cB]);

  return {
    kind, horiz, banded, stacked, grouped, rows, cats, numericX, thin,
    W, H, plot, band, sideCap, footCap,
    vlo: snapped.lo, vhi: snapped.hi, vticks, xdom,
    vScale,
    /** Pixel position of category slot `i` (banded) or numeric x value `i` (continuous). */
    cPos(i) { return banded ? cA + (i + 0.5) * band : xScale(i); },
    /** Screen point from a category-axis pixel and a value-axis pixel. */
    place(c, v) { return horiz ? { x: v, y: c } : { x: c, y: v }; },
  };
}

/** The longest category label in the set, or '' — used to decide how much room labels want. */
function longest(cats) {
  let best = '';
  for (const c of cats) if (c.label.length > best.length) best = c.label;
  return best;
}

/** The numeric x extent across every series, padded when every point shares one x. */
function numberDomain(rows) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of rows) for (const p of s.pts) { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; }
  if (!Number.isFinite(lo)) return [0, 1];
  return pad(lo, hi);
}

/* ── display-list primitives ─────────────────────────────────────────────────────────── */

/* Every mark is `{ t: tagName, a: attributes, s: text, ti: tooltip, kids: [] }`. Real SVG
   attribute names, no abbreviation table: the browser-side renderer is then ten lines that
   know nothing about charts, and a mark in a debugger reads as the element it becomes. */

const mLine = (x1, y1, x2, y2, cls) => ({
  t: 'line', a: { x1: n(x1, 'line'), y1: n(y1, 'line'), x2: n(x2, 'line'), y2: n(y2, 'line'), class: cls },
});

const mText = (x, y, s, cls, anchor, extra) => ({
  t: 'text',
  a: Object.assign({ x: n(x, 'text'), y: n(y, 'text'), class: cls || '' },
                   anchor ? { 'text-anchor': anchor } : {}, extra || {}),
  s: String(s),
});

const mRect = (x, y, w, h, attrs) => ({
  t: 'rect',
  a: Object.assign({ x: n(x, 'rect'), y: n(y, 'rect'), width: n(Math.max(0, w), 'rect'), height: n(Math.max(0, h), 'rect') }, attrs),
});

const mDot = (cx, cy, r, attrs) => ({
  t: 'circle', a: Object.assign({ cx: n(cx, 'dot'), cy: n(cy, 'dot'), r: n(r, 'dot') }, attrs),
});

const mPath = (d, attrs) => ({ t: 'path', a: Object.assign({ d }, attrs) });

/* ── furniture: gridlines, ticks, axis captions ──────────────────────────────────────── */

/**
 * The gridlines, tick labels, baselines and axis captions — everything that is not data.
 *
 * The zero rule is drawn as `.ck-axis` rather than `.ck-rule` whenever the domain straddles
 * zero, because on a chart with negative values the question "which side of nothing is this"
 * is the first one a reader asks and it should not be answered by a faint line identical to
 * the other seven.
 *
 * @param F a frame from {@link makeFrame}
 * @returns display-list marks, drawn before the data so the data sits on top
 */
function furniture(F) {
  const out = [];
  const { plot } = F;

  for (const t of F.vticks) {
    const v = F.vScale(t);
    const a = F.place(F.horiz ? plot.y0 : plot.x0, v);
    const b = F.place(F.horiz ? plot.y1 : plot.x1, v);
    const zero = t === 0 && F.vlo < 0 && F.vhi > 0;
    out.push(mLine(a.x, a.y, b.x, b.y, zero ? 'ck-axis' : 'ck-rule'));
    if (F.horiz) out.push(mText(v, plot.y1 + 13, CK.fmt(t), 'ck-tk', 'middle'));
    else out.push(mText(plot.x0 - 6, v + 3.2, CK.fmt(t), 'ck-tk', 'end'));
  }

  /* Two baselines and no box. A full frame reads as a container; two rules read as axes. */
  out.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
  out.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));

  if (F.banded) {
    F.cats.forEach((c, i) => {
      if (i % F.thin) return;
      const p = F.cPos(i);
      if (F.horiz) out.push(mText(plot.x0 - 6, p + 3.2, clip(c.label, 128), 'ck-tk', 'end'));
      else out.push(mText(p, plot.y1 + 13, clip(c.label, Math.max(18, F.band * F.thin - 2)), 'ck-tk', 'middle'));
    });
  } else {
    for (const t of CK.ticks(F.xdom[0], F.xdom[1], 6)) {
      const p = F.cPos(t);
      if (p < plot.x0 - 0.5 || p > plot.x1 + 0.5) continue;
      out.push(mLine(p, plot.y0, p, plot.y1, 'ck-rule'));
      out.push(mText(p, plot.y1 + 13, CK.fmt(t), 'ck-tk', 'middle'));
    }
  }

  if (F.footCap) out.push(mText((plot.x0 + plot.x1) / 2, F.H - 4, F.footCap, 'ck-cap-ax', 'middle'));
  if (F.sideCap) {
    const cx = 10;
    const cy = (plot.y0 + plot.y1) / 2;
    out.push(mText(cx, cy, F.sideCap, 'ck-cap-ax', 'middle', { transform: 'rotate(-90 ' + n(cx, 'cap') + ' ' + n(cy, 'cap') + ')' }));
  }

  return out;
}

/* ── value labels ────────────────────────────────────────────────────────────────────── */

/**
 * A placer that will only put down a label where nothing else already is.
 *
 * "Where they fit" is the whole feature: an unfiltered chart labels every point and the
 * labels turn into a grey smear that hides the line they annotate. Candidates are tried in
 * order — above a point, then below it — and the first position whose box clears the plot
 * edges and every label already down wins. Anything that fits nowhere is simply not drawn,
 * which is right: the value is still in the tooltip and on the axis.
 *
 * The greedy pass runs in series order, so an early series gets first refusal on contested
 * space. That is a real bias and a deliberate one — a consistent winner reads better than a
 * label set that reshuffles when a value changes by one.
 *
 * @param plot the frame's plot bounds; nothing is placed outside them
 * @returns `place(text, candidates, size)` returning the chosen `{x, y, anchor}` or null
 *
 * @example
 * var put = labeller(F.plot);
 * put('42', [{ x: 100, y: 50, anchor: 'middle' }]);   // { x: 100, y: 50, anchor: 'middle' }
 */
function labeller(plot) {
  const taken = [];
  return function place(text, cands, size) {
    const fs = size || TXT;
    const w = textW(text, fs);
    for (const c of cands) {
      const left = c.anchor === 'middle' ? c.x - w / 2 : c.anchor === 'end' ? c.x - w : c.x;
      const box = { x0: left - 1.5, y0: c.y - fs + 0.5, x1: left + w + 1.5, y1: c.y + 2.5 };
      if (box.x0 < plot.x0 - 3 || box.x1 > plot.x1 + 3) continue;
      if (box.y0 < plot.y0 - 2 || box.y1 > plot.y1 + 2) continue;
      let clash = false;
      for (const b of taken) {
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

/* ── the data itself ─────────────────────────────────────────────────────────────────── */

/**
 * Every series as its own `<g data-series="i">`, so the legend can hide one with a class.
 *
 * The five kinds share the frame and diverge only in what they put in the group, so this is
 * a dispatch and five short routines rather than one routine with five branches inside every
 * loop.
 *
 * @param F a frame from {@link makeFrame}
 * @returns display-list marks in series order, drawn over the furniture
 */
function drawSeries(F) {
  const put = labeller(F.plot);
  const groups = [];
  const stacks = new Map();       // category key → { up, dn } running offsets, stacked only

  F.rows.forEach((row, si) => {
    const colour = CK.hue(si);
    const kids =
      F.kind === 'bar' || F.kind === 'column' ? drawBars(F, row, si, colour, stacks, put)
      : F.kind === 'scatter' ? drawScatter(F, row, si, colour, put)
      : drawCurve(F, row, si, colour, stacks, put);

    groups.push({
      t: 'g',
      a: { 'data-series': String(si), class: 'ck-ser' },
      kids,
    });
  });

  return groups;
}

/**
 * The ordered `{ pos, v, label, key }` steps a curve or scatter walks, in axis order.
 *
 * `key` identifies the slot for stacking and must be unique per slot — the printed label is
 * not, because `CK.fmt` maps 1000 and 1049 both to '1k' and a stack keyed on the label would
 * quietly pile them into one column.
 */
function walk(F, row) {
  if (F.banded) {
    const out = [];
    F.cats.forEach((c, i) => {
      if (!row.byCat.has(c.key)) return;
      out.push({ pos: F.cPos(i), v: row.byCat.get(c.key), label: c.label, key: c.key });
    });
    return out;
  }
  return row.pts
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((p) => ({ pos: F.cPos(p.x), v: p.y, label: CK.fmt(p.x), key: String(p.x) }));
}

/**
 * Line and area.
 *
 * A single point is drawn as a dot and nothing else: a one-point path has an `M` and no `L`
 * and renders as literally nothing, which is the most common way a "the chart is blank" bug
 * happens. An area with one point gets the dot and no fill, because a polygon needs two.
 *
 * Stacked areas ride on the running offset the bars use, so a stack of consistently-signed
 * series is correct. A series that changes sign inside a stack produces a self-crossing
 * polygon — mixed-sign stacking has no honest picture and this one at least looks wrong
 * rather than looking plausible.
 */
function drawCurve(F, row, si, colour, stacks, put) {
  const pts = walk(F, row);
  const out = [];
  if (!pts.length) return out;

  const base = [];
  const top = [];
  for (const p of pts) {
    let lo = 0;
    let hi = p.v;
    if (F.stacked) {
      const acc = stacks.get(p.key) || { up: 0, dn: 0 };
      if (p.v >= 0) { lo = acc.up; hi = acc.up + p.v; acc.up = hi; }
      else { lo = acc.dn; hi = acc.dn + p.v; acc.dn = hi; }
      stacks.set(p.key, acc);
    }
    base.push(F.place(p.pos, F.vScale(lo)));
    top.push(F.place(p.pos, F.vScale(hi)));
  }

  if (F.kind === 'area' && top.length > 1) {
    const fwd = top.map((q, i) => (i ? 'L' : 'M') + n(q.x, 'area') + ' ' + n(q.y, 'area')).join(' ');
    const back = base.slice().reverse().map((q) => 'L' + n(q.x, 'area') + ' ' + n(q.y, 'area')).join(' ');
    out.push(mPath(fwd + ' ' + back + ' Z', { fill: colour, 'fill-opacity': '0.18', stroke: 'none' }));
  }

  if (top.length > 1) {
    out.push(mPath(top.map((q, i) => (i ? 'L' : 'M') + n(q.x, 'line') + ' ' + n(q.y, 'line')).join(' '),
                   { fill: 'none', stroke: colour, 'stroke-width': '1.7',
                     'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }

  /* Dots up to a density where they still read as points rather than as a thicker line —
     and always for a lone point, which is the whole drawing when there is only one. */
  const dots = top.length <= 30;
  top.forEach((q, i) => {
    if (dots) out.push(mDot(q.x, q.y, 2.6, { fill: colour, stroke: 'none' }));
    const txt = CK.fmt(pts[i].v);
    const spot = put(txt, [
      { x: q.x, y: q.y - 6, anchor: 'middle' },
      { x: q.x, y: q.y + 12, anchor: 'middle' },
    ]);
    if (spot) out.push(mText(spot.x, spot.y, txt, 'ck-val', spot.anchor));
  });

  /* One tooltip per point, on an invisible fat target: a 2.6px dot is not a hit area. */
  top.forEach((q, i) => {
    out.push({
      t: 'circle',
      a: { cx: n(q.x, 'hit'), cy: n(q.y, 'hit'), r: 7, fill: 'none', 'pointer-events': 'all', class: 'ck-hit' },
      ti: row.name + ' \u00b7 ' + pts[i].label + ' \u00b7 ' + CK.fmt(pts[i].v),
    });
  });

  return out;
}

/**
 * Bars and columns, grouped or stacked.
 *
 * Grouped bars split the band into one lane per series; stacked bars keep two running
 * offsets per category, one climbing away from zero and one falling, so a category holding
 * both signs grows in both directions from the baseline instead of cancelling.
 *
 * A bar of exactly zero is drawn 1px thick rather than skipped. Zero is a measurement and it
 * should be visible as one; an absent category simply has no bar, and the two must not look
 * the same.
 */
function drawBars(F, row, si, colour, stacks, put) {
  const out = [];
  const lanes = F.grouped ? F.rows.length : 1;
  const inset = Math.min(3, F.band * 0.12);
  const lane = (F.band - inset * 2) / lanes;
  const thickness = Math.max(1.5, lane * (F.grouped ? 0.84 : 0.7));

  F.cats.forEach((c, i) => {
    if (!row.byCat.has(c.key)) return;
    const v = row.byCat.get(c.key);

    let lo = 0;
    let hi = v;
    if (F.stacked) {
      const acc = stacks.get(c.key) || { up: 0, dn: 0 };
      if (v >= 0) { lo = acc.up; hi = acc.up + v; acc.up = hi; }
      else { lo = acc.dn; hi = acc.dn + v; acc.dn = hi; }
      stacks.set(c.key, acc);
    }

    const pLo = F.vScale(lo);
    const pHi = F.vScale(hi);
    const near = F.cPos(i) - F.band / 2 + inset + (F.grouped ? si : 0) * lane + (lane - thickness) / 2;

    /* A bar of exactly zero is drawn one pixel thick rather than skipped. Zero is a
       measurement and should be visible as one; an absent category has no bar at all, and a
       reader has to be able to tell those two apart. The stub grows in the direction the bar
       would have grown, so it never lands on the wrong side of the baseline. */
    const stub = Math.abs(pHi - pLo) < 1;
    const span = Math.max(1, Math.abs(pHi - pLo));
    let start = Math.min(pLo, pHi);
    if (stub && (F.horiz ? v < 0 : v >= 0)) start -= 1;

    const rect = F.horiz
      ? mRect(start, near, span, thickness, { fill: colour, class: 'ck-bar' })
      : mRect(near, start, thickness, span, { fill: colour, class: 'ck-bar' });
    rect.ti = row.name + ' \u00b7 ' + c.label + ' \u00b7 ' + CK.fmt(v);
    out.push(rect);

    const txt = CK.fmt(v);
    const mid = near + thickness / 2;
    const away = v >= 0 ? 1 : -1;          // the direction the bar grows, in value space

    let cands;
    if (F.stacked) {
      /* Inside the segment. Just outside it is the next segment along, and a number sitting
         on the seam between two segments belongs to neither of them. */
      cands = F.horiz
        ? [{ x: (pLo + pHi) / 2, y: mid + 3.2, anchor: 'middle' }]
        : [{ x: mid, y: (pLo + pHi) / 2 + 3.2, anchor: 'middle' }];
    } else if (F.horiz) {
      cands = [{ x: pHi + away * 4, y: mid + 3.2, anchor: away > 0 ? 'start' : 'end' },
               { x: pHi - away * 4, y: mid + 3.2, anchor: away > 0 ? 'end' : 'start' }];
    } else {
      /* Screen y runs downward, so a positive bar's end is *above* its baseline. Try just
         beyond the end first, then just inside it when the plot edge is in the way. */
      cands = [{ x: mid, y: pHi - away * 4, anchor: 'middle' },
               { x: mid, y: pHi + away * 11, anchor: 'middle' }];
    }

    /* A stacked segment only earns a label when the segment can actually hold it. */
    const room = !F.stacked || (F.horiz
      ? span > textW(txt) + 6 && thickness > 11
      : thickness > textW(txt) + 4 && span > 12);
    if (room) {
      const spot = put(txt, cands);
      if (spot) out.push(mText(spot.x, spot.y, txt, 'ck-val', spot.anchor));
    }
  });

  return out;
}

/** Scatter: one dot per point, labelled where there is room, tooltipped everywhere. */
function drawScatter(F, row, si, colour, put) {
  const out = [];
  for (const p of walk(F, row)) {
    const q = F.place(p.pos, F.vScale(p.v));
    out.push({
      t: 'circle',
      a: { cx: n(q.x, 'pt'), cy: n(q.y, 'pt'), r: 3.4, fill: colour, 'fill-opacity': '0.85', stroke: 'none' },
      ti: row.name + ' \u00b7 ' + p.label + ' \u00b7 ' + CK.fmt(p.v),
    });
    const txt = CK.fmt(p.v);
    const spot = put(txt, [
      { x: q.x + 6, y: q.y + 3.2, anchor: 'start' },
      { x: q.x - 6, y: q.y + 3.2, anchor: 'end' },
      { x: q.x, y: q.y - 6, anchor: 'middle' },
    ]);
    if (spot) out.push(mText(spot.x, spot.y, txt, 'ck-val', spot.anchor));
  }
  return out;
}

/* ── saying what the picture shows ───────────────────────────────────────────────────── */

/** English for each kind, for the alt text and the caption. */
const KIND_WORD = {
  line: 'line chart', area: 'area chart', bar: 'horizontal bar chart',
  column: 'column chart', scatter: 'scatter plot',
};

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire chart to anyone using
 * it. "Bar chart" is therefore not an acceptable answer — it names the genre and withholds
 * the content. This says what is plotted, over what, between what and what, and where the
 * extreme is, which is what someone looking at it would take away in the first second.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 *
 * @example describe(F).aria;
 * // 'Column chart of 2 series (opens, closes) across 6 categories. Values run from 0 to 42…'
 */
function describe(F, read) {
  const word = KIND_WORD[F.kind] || 'chart';
  if (!read.count) {
    return {
      aria: word.charAt(0).toUpperCase() + word.slice(1) + ' with no data: nothing is plotted.',
      caption: 'a ' + CK.esc(word) + ' with <b>no data</b> &mdash; the frame is drawn so the ' +
               'card keeps its place, but there is nothing in it.',
    };
  }

  let peak = null;
  let trough = null;
  F.rows.forEach((row) => {
    for (const p of row.pts) {
      const at = { row: row.name, v: p.y, x: String(p.x) };
      if (!peak || p.y > peak.v) peak = at;
      if (!trough || p.y < trough.v) trough = at;
    }
  });

  const many = F.rows.length > 1;
  const names = F.rows.map((r) => r.name).join(', ');
  /* The x extent quoted here is the *data's*, not the frame's. `F.xdom` has been padded so a
     lone point has somewhere to sit, and repeating that padding back to the reader — "across
     2.5 to 7.5" for a chart of one point at 5 — would be describing the arithmetic instead
     of the picture. */
  let xlo = Infinity;
  let xhi = -Infinity;
  if (!F.banded) {
    for (const s of F.rows) for (const p of s.pts) { if (p.x < xlo) xlo = p.x; if (p.x > xhi) xhi = p.x; }
  }
  const span = F.banded
    ? F.cats.length + ' ' + (F.cats.length === 1 ? 'category' : 'categories')
    : xlo === xhi ? 'one x position, ' + CK.fmt(xlo)
    : CK.fmt(xlo) + ' to ' + CK.fmt(xhi);

  /* The axis caption is appended as its own clause rather than folded into the count.
     "4 categories on the month axis" needs no pluralisation rule; "4 months" needs one, and
     an English pluraliser in a chart card is a bug waiting for its first "sheep". */
  const on = read.xLabel ? ' on the ' + read.xLabel + ' axis' : '';
  const vname = read.yLabel || 'values';
  const verb = read.yLabel ? ' runs' : ' run';

  const flat = peak.v === trough.v;
  const range = flat
    ? vname + (read.yLabel ? ' is' : ' are') + ' flat at ' + CK.fmt(peak.v)
    : vname + verb + ' from ' + CK.fmt(trough.v) + ' to ' + CK.fmt(peak.v);
  const crosses = F.vlo < 0 && F.vhi > 0 ? ', crossing zero' : '';

  const aria =
    word.charAt(0).toUpperCase() + word.slice(1) + ' of ' +
    (many ? F.rows.length + ' series (' + names + ')' : names) +
    ' across ' + span + on + '. ' + range + crosses + '. ' +
    (flat ? '' : 'The highest is ' + CK.fmt(peak.v) + (many ? ', in ' + peak.row + ',' : '') +
                 ' at ' + peak.x + '.');

  const caption =
    CK.esc(word) + (F.stacked ? ', stacked' : many && F.banded ? ', grouped' : '') + ' &mdash; ' +
    '<b>' + CK.esc(String(read.count)) + '</b> point' + (read.count === 1 ? '' : 's') +
    ' across ' + CK.esc(span) + (many ? ' in <b>' + F.rows.length + '</b> series' : '') + '. ' +
    (flat
      ? '<i>every value is ' + CK.esc(CK.fmt(peak.v)) + '</i>, so the domain is padded to give the line somewhere to sit. '
      : 'the peak is <b>' + CK.esc(CK.fmt(peak.v)) + '</b>' + (many ? ' (' + CK.esc(peak.row) + ')' : '') +
        ' at ' + CK.esc(peak.x) + '. ') +
    (F.vlo < 0 && F.vhi > 0 ? '<i>the accented rule is zero</i> &mdash; bars run from it in both directions. ' : '') +
    (many ? '<span class="ck-aside">click a key to drop a series.</span>' : '');

  return { aria: aria.trim(), caption: caption.trim() };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-chart[data-card="' + id + '"]';
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
 * Nothing here names a colour. Every value is a desk token, so the light switch is the only
 * thing that has to know anything, and the card is correct in a theme it was never opened
 * in. `prefers-color-scheme` is deliberately absent: the desk is one document open in two
 * viewers that want different answers, and the OS gives both the same answer.
 */
function cardCss(id, wide, W, multi) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    /* The tick and value inks. `.ck-plot text` in kit.css already sets the face and 9px; only
       the emphasis differs between an axis number and a plotted one. */
    ['.ck-plot .ck-tk', 'fill: var(--ink-faint);'],
    ['.ck-plot .ck-val', 'fill: var(--ink-dim);'],
    ['.ck-plot .ck-cap-ax', 'fill: var(--ink-faint); font-size: 9.5px; letter-spacing: .04em;'],
    ['.ck-plot .ck-hit', 'stroke: none;'],
    ['.ck-plot .ck-bar', 'stroke: none;'],

    ['.ck-key',
     'display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; ' +
     'background: none; cursor: pointer; font: inherit; font-family: var(--mono); ' +
     'font-size: 9.5px; color: var(--ink-faint);'],
    ['.ck-key:hover', 'color: var(--ink-dim);'],
    ['.ck-key:focus-visible', 'outline: 1px solid var(--accent); outline-offset: 2px; border-radius: 2px;'],
    ['.ck-key[aria-pressed="false"]', 'opacity: .4; text-decoration: line-through;'],
    ['.ck-key i', 'width: 7px; height: 7px; display: block; border-radius: 1px;'],
  ];

  for (let i = 1; i <= 8; i++) rules.push(['.ck-key i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);

  /* A plot too wide for the column keeps its own width and scrolls inside `.ck-scroll`; the
     desk column never widens, so the page never grows a horizontal scrollbar of its own. */
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  /* Hover lifts a whole series rather than the one mark under the pointer: on a grouped
     chart the useful question is which series, and a single highlighted bar answers a
     question nobody asked. Only worth doing when there is something to pick *from* — on a
     one-series chart it would dim the only thing on the card. */
  if (!multi) return scope(id, rules) + '\n';

  rules.push(['.ck-plot .ck-ser', 'transition: opacity .12s linear;']);
  rules.push(['.ck-plot:hover .ck-ser', 'opacity: .45;']);
  rules.push(['.ck-plot .ck-ser:hover', 'opacity: 1;']);

  /* Reduced motion: the only animation here is that fade, and it carries no meaning, so it
     is safe to simply stop rather than to substitute something. */
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-ser', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, one plot, an optional legend, and the caption. */
function cardHtml(id, title, F, note, wide) {
  const svg =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + n(F.W, 'view') + ' ' + n(F.H, 'view') + '"' +
    ' aria-label="' + CK.esc(note.aria) + '"></svg>';

  const legend = F.rows.length > 1
    ? '\n  <div class="ck-legend">' +
      F.rows.map((r, i) =>
        '<button type="button" class="ck-key" data-series="' + i + '" aria-pressed="true">' +
        '<i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(r.name) + '</button>').join('') +
      '</div>'
    : '';

  return '<section data-card="' + CK.esc(id) + '" class="ck-chart">\n' +
         '  <h2>' + CK.esc(title) + '</h2>\n' +
         '  ' + (wide ? '<div class="ck-scroll">' + svg + '</div>' : svg) + legend + '\n' +
         '  <div class="ck-cap">' + note.caption + '</div>\n' +
         '</section>\n';
}

/**
 * The browser half: a generic display-list renderer and the legend wiring.
 *
 * Classic script, ES5 vocabulary, no template literals and no arrow functions — this is
 * concatenated into a page that ships no transpiler and the card must not be the reason a
 * whole desk fails to parse. The renderer knows nothing about charts; every decision that
 * needed to know something was made in Node.
 */
function cardJs(id, marks) {
  return `/* chart card: draws a display list that was built when the card was built.
   The geometry is not recomputed here, so it cannot drift from what the caption claims, and
   a degenerate domain has been dealt with once rather than once per viewer. */
CK.build(${jsonLit(id)}, function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var MARKS = ${jsonLit(marks)};

  var plot = sec.querySelector("svg.ck-plot");
  if (!plot) { return; }

  /* One display-list entry as a real element. Attribute names are the SVG ones, so this
     stays a translator rather than a second place where chart decisions live. */
  function node(m) {
    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (m.s != null) { e.textContent = m.s; }
    if (m.ti != null) {
      tip = document.createElementNS(NS, "title");
      tip.textContent = m.ti;
      e.appendChild(tip);
    }
    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }
    return e;
  }

  /* The legend buttons are the source of truth for what is hidden. They live in the markup,
     so a series the reader switched off stays off when the desk swaps <main> and replays
     every builder — the drawing is rebuilt, the intent is not. */
  function sync() {
    var keys = sec.querySelectorAll(".ck-key"), i, g;
    for (i = 0; i < keys.length; i++) {
      g = plot.querySelector('g[data-series="' + keys[i].getAttribute("data-series") + '"]');
      if (g) { g.style.display = keys[i].getAttribute("aria-pressed") === "false" ? "none" : ""; }
    }
  }

  function render() {
    var i;
    while (plot.firstChild) { plot.removeChild(plot.firstChild); }
    for (i = 0; i < MARKS.length; i++) { plot.appendChild(node(MARKS[i])); }
    sync();
  }

  render();

  /* One delegated listener, guarded by CK.once: a <main> swap gives us a fresh section and
     wires it once, a replay on the same section wires nothing twice. */
  CK.once(sec, "chartkeys", function () {
    sec.addEventListener("click", function (ev) {
      var key = ev.target && ev.target.closest ? ev.target.closest(".ck-key") : null;
      if (!key || !sec.contains(key)) { return; }
      key.setAttribute("aria-pressed", key.getAttribute("aria-pressed") === "false" ? "true" : "false");
      sync();
    });
  });
});
`;
}

/**
 * Build one chart card from one data block.
 *
 * @param id    the card's identity; becomes its directory name, its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  `{ kind, series, xLabel, yLabel, stacked }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the
 *          other three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, which means a bug here
 *                 rather than bad input: malformed points are dropped while reading
 *
 * @example
 * build({
 *   id: 'downloads',
 *   title: 'downloads by month, both channels',
 *   data: { kind: 'column', stacked: true, yLabel: 'downloads',
 *           series: [{ name: 'stable', points: [{ x: 'Jan', y: 120 }, { x: 'Feb', y: 190 }] },
 *                    { name: 'beta',   points: [{ x: 'Jan', y: 30 },  { x: 'Feb', y: 44 }] }] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'chart' : id);
  const read = readData(data);
  const F = makeFrame(read);
  const note = describe(F, read);

  const marks = furniture(F).concat(read.count ? drawSeries(F) : []);
  const wide = F.W > W0;

  return {
    json: { ord: Number.isFinite(Number(ord)) ? Number(ord) : 50, type: 'chart', kind: F.kind },
    html: cardHtml(cardId, title == null ? cardId : String(title), F, note, wide),
    css: cardCss(cardId, wide, F.W, F.rows.length > 1),
    js: cardJs(cardId, marks),
  };
}
