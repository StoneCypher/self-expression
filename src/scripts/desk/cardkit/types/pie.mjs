/**
 * @file cardkit card type: `pie` — a pie or donut of parts of a whole, which says out loud when it
 * is the wrong chart for the question being asked of it.
 *
 * A pie chart is a bad chart, and this card is built on that premise rather than in spite of it.
 * Angle is the least accurately judged visual channel there is: people read position best, then
 * length, then area, and angle near the bottom. What a pie does reliably is show that the parts sum
 * to a whole, and let a reader spot the single largest share and the quarter, half and
 * three-quarter landmarks. What it cannot do is let anyone rank six similar slices, or tell 24%
 * from 22%. So this card:
 *
 * - prints the value AND the share beside every slice, in the legend, always — that is the only
 *   thing that makes a pie readable, and it is not optional here;
 * - counts its slices and says, above {@link HONEST_SLICES}, that the reader cannot rank that many
 *   angles and names the chart that would work instead;
 * - finds every pair of slices within {@link CLOSE_POINTS} percentage points of each other and
 *   names them, because those are precisely the comparisons the picture cannot support.
 *
 * The other thing this file exists to get right is the 360-degree arc. An SVG elliptical arc is
 * defined by its two endpoints, and the specification says an arc whose endpoints coincide is
 * omitted from the path entirely. A single 100% slice therefore draws NOTHING in every naive
 * implementation, silently, and that is the commonest possible pie. A full turn is emitted here as
 * a `<circle>` — filled for a pie, stroked for a donut — which has no endpoints to collapse.
 * Learned from `portfolio.mjs`, which hit it first; do not re-derive it.
 *
 * @see ./portfolio.mjs — where the 360-degree case was solved first
 * @see ./chart.mjs     — the sorted bar chart this card recommends when it is the wrong shape
 * @see ../CONTRACT.md  — `shape` is a string, `defaults` is an object, both honoured below
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so build-time drawing and browser-time drawing
 * come from one implementation rather than two that drift.
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
  catch (e) { throw new Error('cardkit/pie: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/pie: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── the build-time guard ────────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose, and a guard that cries
 * wolf is a guard that gets switched off. Offsets survive so a reported position still points at
 * something real, and regex literals are recognised, because a scanner that desyncs on a quote
 * inside a character class starts blanking actual code.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment, string and regex contents replaced by spaces
 *
 * @example blankNonCode('var s = "const";').indexOf('const');   // -1
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

/** A short window of source around an offset, for a message that points at the actual text. */
function nearby(src, at) {
  return src.slice(Math.max(0, at - 50), Math.min(src.length, at + 50));
}

/**
 * Refuse to emit a browser script that would break the desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block, so a single modern-syntax token or a
 * stray backtick is a parse error that blanks every card on the page. The backtick case keeps
 * happening because it hides in a comment: comments ship, and a backtick around a word closes the
 * surrounding template literal early.
 *
 * Backtick, `=>` and `?.` are scanned raw — none can appear innocently in this card's output.
 * `const`, `let` and `class` are scanned only after comment and string bodies are blanked, because
 * they appear in English constantly. Control characters are compared numerically rather than
 * matched against a character class, since writing the class is how the class gets corrupted.
 *
 * @param src   the emitted script
 * @param where a label for the message, naming which card produced it
 * @returns `src` unchanged, so the guard can wrap the value on its way out
 * @throws {Error} naming the violation, its offset, and the source around it
 *
 * @example guardEmitted('var a = 1;', 'pie');   // 'var a = 1;'
 */
export function guardEmitted(src, where) {
  const tag = 'cardkit/' + (where || 'pie') + ': emitted js ';

  const tick = src.indexOf(String.fromCharCode(96));
  if (tick >= 0) throw new Error(tag + 'contains a backtick at offset ' + tick + ' - near: ' + nearby(src, tick));

  const arrow = src.indexOf('=>');
  if (arrow >= 0) throw new Error(tag + 'contains an arrow function at offset ' + arrow + ' - near: ' + nearby(src, arrow));

  const opt = src.indexOf('?.');
  if (opt >= 0) throw new Error(tag + 'contains optional chaining at offset ' + opt + ' - near: ' + nearby(src, opt));

  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      throw new Error(tag + 'contains control character ' + c + ' at offset ' + i);
    }
  }

  const code = blankNonCode(src);
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('(^|[^\\w$.])' + kw + '[\\s({]').exec(code);
    if (m) throw new Error(tag + 'declares ' + kw + ' at offset ' + m.index + ' - near: ' + nearby(src, m.index));
  }

  return src;
}

/* ── text metrics ────────────────────────────────────────────────────────────────────────── */

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, taken from `chart.mjs` so two
   cards on one desk agree about what fits. */
const CHW = 5.42;
const TXT = 9;

/** The horizontal ellipsis, written as an escape so no literal can be mistyped into the source. */
const ELL = '\u2026';

/** Width in px of a string set in the plot's mono face at `size`. */
function textW(s, size) { return String(s).length * CHW * ((size || TXT) / TXT); }

/**
 * What a slice's label may say, given the room it has.
 *
 * Nothing ever overflows its slice. A label that fits whole is drawn in both label modes; one that
 * only fits truncated is drawn with its tail marked and only in `all`; one with room for fewer than
 * three characters is dropped. Nothing is lost by dropping it: the legend carries every slice's
 * name, value and share unconditionally, which is the point of this card having a legend at all.
 *
 * @param text the label
 * @param boxW usable width in px
 * @param boxH usable height in px; one line needs its font size plus two
 * @returns `{ text, lm }` with `lm` 0 for a whole label and 1 for a truncated one, or null
 *
 * @example labelFor('cloud 180', 60, 12);   // { text: 'cloud 180', lm: 0 }
 * @example labelFor('cloud 180', 25, 12);   // { text: 'clou\u2026', lm: 1 }
 */
function labelFor(text, boxW, boxH, size) {
  const fs = size || TXT;
  const full = String(text);
  if (!full.length || !(boxW > 0) || !(boxH >= fs + 2)) return null;
  if (textW(full, fs) <= boxW) return { text: full, lm: 0 };
  const room = Math.floor(boxW / (CHW * (fs / TXT)));
  if (room < 3) return null;
  return { text: full.slice(0, room - 1) + ELL, lm: 1 };
}

/* ── emission helpers ────────────────────────────────────────────────────────────────────── */

/**
 * Serialise a value as a JavaScript literal safe inside a classic `<script>` element.
 *
 * @example jsonLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * @throws {Error} when `v` is NaN or infinite
 * @example n2(12.3456, 'arc');   // 12.35
 */
function n2(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/pie: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/* ── reading the slices ──────────────────────────────────────────────────────────────────── */

/* At most eight arcs, because CK.hue cycles at eight and a ninth slice would repeat the first
   one's colour in the same picture. The eighth slot is an honest overflow bucket rather than a
   real slice, so seven are named and the rest are summed into one that says how many it is. The
   same cap portfolio's donut uses, for the same reason. */
const MAX_SLICES = 8;

/* A hard ceiling on slices read, so a pathological descriptor cannot make the build hang. */
const MAX_INPUT = 5000;

/**
 * Above this many slices, a pie is the wrong chart and the caption says so.
 *
 * Six is where the research and the experience agree: a reader can pick the largest of six and can
 * see a quarter, a half and three quarters. Ranking seven similar angles is not something people do
 * accurately, and no amount of colour fixes it.
 */
const HONEST_SLICES = 6;

/** Two shares within this many percentage points cannot be told apart by angle. Stated, not hidden. */
const CLOSE_POINTS = 4;

/** A full turn expressed in the tenths of a percent the shares are apportioned in. */
const TENTHS = 1000;

/** One full turn in radians. */
const TURN = Math.PI * 2;

/**
 * A finite number from an untrusted field, accepting a numeric string.
 *
 * Numeric strings are accepted because slice data routinely arrives from exports where every value
 * is quoted. Everything else is refused rather than coerced, because `Number([])` is 0 and a silent
 * zero is a lie about a share.
 *
 * @example numOrNull('12.5');   // 12.5
 * @example numOrNull([]);       // null
 */
function numOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Split a total into integer parts that sum to it exactly, by largest remainder.
 *
 * A legend that reads 41.7 / 33.3 / 25.1 and totals 100.1 is a legend somebody will add up and find
 * wrong. Rounding each share independently loses or gains those tenths; apportioning them hands
 * every lost tenth back to the shares that were rounded down hardest, which is the standard
 * largest-remainder method and the only one that both sums exactly and never moves a share by more
 * than one unit from its true value.
 *
 * This is also what makes the angles close: the arcs are laid out from these same integers, so the
 * turn is divided into exactly {@link TENTHS} parts and the last slice ends precisely where the
 * first began. Taken from `portfolio.mjs`, where the same problem was solved for a donut.
 *
 * @param values the shares, all non-negative
 * @param total  their sum, which must not be zero
 * @param units  the whole to divide, e.g. 1000 for tenths of a percent
 * @returns one integer per input, summing to exactly `units`
 *
 * @example apportion([1, 1, 1], 3, 1000);   // [334, 333, 333]
 * @example apportion([7], 7, 1000);         // [1000]
 */
function apportion(values, total, units) {
  if (values.length === 0 || total === 0) return values.map(() => 0);

  const exact = values.map((v) => (v * units) / total);
  const out = exact.map((v) => Math.floor(v));

  let deficit = units - out.reduce((a, b) => a + b, 0);
  if (deficit < 0) deficit = 0;
  if (deficit > values.length) deficit = values.length;

  /* Ties go to the earlier index, which is the incoming order — so the same input always produces
     the same legend and a rebuild never silently moves a tenth from one slice to another. */
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));

  for (let k = 0; k < deficit; k++) out[order[k].i] += 1;
  return out;
}

/**
 * Read one untrusted slice list into the shape the rest of the file may assume.
 *
 * The decisions, all of which the caption reports:
 *
 * - **A negative value is refused**, counted, and drawn as nothing. There is no such thing as a
 *   negative angle in a partition of a whole; a slice sweeping backwards would sit on top of its
 *   neighbour and the total would stop meaning anything.
 * - **A non-numeric value is refused** the same way and counted separately, because "this field was
 *   text" and "this field was minus five" are different problems for whoever wrote the data.
 * - **Zero is kept and drawn as nothing**, which is what a zero-width slice is, and counted. It
 *   still appears in the legend at 0.0%, because a category that measured zero is a result.
 * - **Past {@link MAX_SLICES} the smallest are folded** into one bucket carrying their sum, so the
 *   whole is unchanged and the picture never repeats a colour inside itself.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ slices, unit, stats }`, slices in canonical largest-first order with their shares
 *
 * @example readSlices({ slices: [{ label: 'a', value: 3 }] }).slices[0].tenths;   // 1000
 * @example readSlices(undefined).slices.length;   // 0
 */
function readSlices(data) {
  const d = data && typeof data === 'object' ? data : {};
  const stats = { given: 0, negatives: 0, unreadable: 0, zeros: 0, folded: 0, dropped: 0 };

  const raw = Array.isArray(d.slices) ? d.slices : [];
  const kept = [];
  for (let i = 0; i < raw.length; i++) {
    if (kept.length >= MAX_INPUT) { stats.dropped++; continue; }
    const s = raw[i] && typeof raw[i] === 'object' ? raw[i] : {};
    stats.given++;
    const label = s.label == null ? 'slice ' + (i + 1) : String(s.label);
    const v = numOrNull(s.value);
    let value;
    if (v === null) { stats.unreadable++; value = 0; }
    else if (v < 0) { stats.negatives++; value = 0; }
    else { value = v; if (v === 0) stats.zeros++; }
    kept.push({ label, value, ix: i });
  }

  /* Canonical order is largest first, and it is what the colours and the apportionment are keyed
     on. The `sort` setting reorders what is DISPLAYED; it must not be able to change a slice's
     colour or its printed share, or two viewers of the same card would see different numbers. */
  const canon = kept.slice().sort((a, b) => (b.value - a.value) || (a.ix - b.ix));

  let slices = canon;
  if (canon.length > MAX_SLICES) {
    const head = canon.slice(0, MAX_SLICES - 1);
    const tail = canon.slice(MAX_SLICES - 1);
    const sum = tail.reduce((a, b) => a + b.value, 0);
    stats.folded = tail.length;
    head.push({ label: tail.length + ' smaller', value: sum, ix: canon.length, bucket: true });
    slices = head;
  }

  const total = slices.reduce((a, b) => a + b.value, 0);
  const tenths = total > 0 ? apportion(slices.map((s) => s.value), total, TENTHS) : slices.map(() => 0);
  slices.forEach((s, i) => { s.tenths = tenths[i]; s.hue = i; });

  return {
    slices,
    total,
    unit: d.unit == null ? '' : String(d.unit).trim(),
    stats,
  };
}

/* ── geometry ────────────────────────────────────────────────────────────────────────────── */

const SIZE = 360;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 164;

/**
 * A point on a circle, with angles measured clockwise from twelve o'clock.
 *
 * Twelve o'clock is zero because a reader looking for the largest share looks there first, and
 * clockwise because that is the direction the eye walks a ring. Screen y grows downward, so this
 * convention also makes the SVG sweep flag 1 for every forward arc, with no case analysis.
 *
 * @example pt(10, 0);   // { x: 180, y: 170 }  — straight up from the centre
 */
function pt(r, a) {
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
}

/**
 * One slice as a display-list mark, handling the full turn as a circle rather than an arc.
 *
 * This is the case the file exists to get right. An SVG elliptical arc is defined by its two
 * endpoints; a slice covering the whole turn has the same point at both ends, and the specification
 * says such an arc is dropped from the path. So a chart of one category — a hundred percent of one
 * thing, the commonest pie there is — renders as an empty box, and because nothing errors it
 * usually ships. A full turn is therefore a `<circle>`: filled at the outer radius for a pie,
 * stroked along the ring's mid-radius for a donut, neither of which has endpoints to collapse.
 *
 * A zero-width slice is skipped rather than drawn, because a zero-length arc is a stroked point
 * that a round cap would render as a dot floating on the ring.
 *
 * @param a0, a1 the slice's angles
 * @param inner  the donut's inner radius, or 0 for a pie
 * @param attrs  colour and class for the mark
 * @returns a mark, or null for a zero-width slice
 *
 * @example sliceMark(0, Math.PI * 2, 0, {}).t;    // 'circle'
 * @example sliceMark(0, Math.PI, 0, {}).t;        // 'path'
 */
function sliceMark(a0, a1, inner, attrs) {
  const width = a1 - a0;
  if (!(width > 0)) return null;

  if (width >= TURN - 1e-12) {
    if (inner > 0) {
      const mid = (inner + R) / 2;
      return {
        t: 'circle',
        a: Object.assign({
          cx: n2(CX, 'full'), cy: n2(CY, 'full'), r: n2(mid, 'full'),
          fill: 'none', 'stroke-width': n2(R - inner, 'full'),
        }, attrs, { stroke: attrs.fill, fill: 'none' }),
      };
    }
    return {
      t: 'circle',
      a: Object.assign({ cx: n2(CX, 'full'), cy: n2(CY, 'full'), r: n2(R, 'full') }, attrs),
    };
  }

  const large = width > Math.PI ? 1 : 0;
  const o0 = pt(R, a0);
  const o1 = pt(R, a1);

  let d;
  if (inner > 0) {
    const i1 = pt(inner, a1);
    const i0 = pt(inner, a0);
    d = 'M' + n2(o0.x, 'arc') + ' ' + n2(o0.y, 'arc') +
        'A' + n2(R, 'arc') + ' ' + n2(R, 'arc') + ' 0 ' + large + ' 1 ' + n2(o1.x, 'arc') + ' ' + n2(o1.y, 'arc') +
        'L' + n2(i1.x, 'arc') + ' ' + n2(i1.y, 'arc') +
        'A' + n2(inner, 'arc') + ' ' + n2(inner, 'arc') + ' 0 ' + large + ' 0 ' + n2(i0.x, 'arc') + ' ' + n2(i0.y, 'arc') +
        'Z';
  } else {
    d = 'M' + n2(CX, 'arc') + ' ' + n2(CY, 'arc') +
        'L' + n2(o0.x, 'arc') + ' ' + n2(o0.y, 'arc') +
        'A' + n2(R, 'arc') + ' ' + n2(R, 'arc') + ' 0 ' + large + ' 1 ' + n2(o1.x, 'arc') + ' ' + n2(o1.y, 'arc') +
        'Z';
  }
  return { t: 'path', a: Object.assign({ d }, attrs) };
}

/**
 * Lay one pie or donut out and turn it into a display list.
 *
 * The angles come straight from the apportioned tenths, so the slices sum to exactly one turn and
 * no arc can disagree with the percentage printed beside it in the legend. The display ORDER comes
 * from the `sort` setting; the shares and the colours do not, so re-sorting rearranges the picture
 * without changing a single number in it.
 *
 * @param read from {@link readSlices}
 * @param opt  `{ donut, sort }` — `donut` is 0 for a pie or an inner-radius fraction
 * @returns `{ marks, W, H, drawn, fitLabels, allLabels, droppedLabels, arcs, circles }`
 *
 * @example layout(readSlices({ slices: [{ label: 'all', value: 5 }] }), { donut: 0 }).circles;   // 1
 */
function layout(read, opt) {
  const marks = [];
  const out = {
    marks, W: SIZE, H: SIZE, drawn: 0, fitLabels: 0, allLabels: 0, droppedLabels: 0,
    arcs: 0, circles: 0, order: [],
  };
  if (!read.slices.length || !(read.total > 0)) return out;

  const inner = opt.donut > 0 ? R * opt.donut : 0;
  const unit = read.unit ? ' ' + read.unit : '';

  /* The display order. Canonical (largest first) is also the default, because a pie in which the
     slices are not sorted asks the reader to compare angles that are not adjacent, which is the
     one thing this form is worst at. */
  const shown = opt.sort === 'given'
    ? read.slices.slice().sort((a, b) => a.ix - b.ix)
    : read.slices.slice();
  out.order = shown.map((s) => s.hue);

  let at = 0;
  for (const s of shown) {
    const a0 = at;
    const a1 = at + (s.tenths / TENTHS) * TURN;
    at = a1;
    if (!(s.tenths > 0)) continue;

    const pct = (s.tenths / 10).toFixed(1);
    const mark = sliceMark(a0, a1, inner, {
      fill: CK.hue(s.hue), 'fill-opacity': '0.9', class: 'ck-pi-slice',
    });
    if (!mark) continue;
    mark.ti = s.label + ' \u00b7 ' + CK.fmt(s.value) + unit + ' \u00b7 ' + pct + '%';
    marks.push(mark);
    out.drawn++;
    if (mark.t === 'circle') out.circles++; else out.arcs++;

    /* Room for a horizontal label at the slice's centroid. The chord across the slice and the
       radial band are both bounds on how wide the text may be, and which of them binds depends on
       where the slice points — so the smaller is used, which is conservative in every direction.
       Using the diameter instead lets a name hang out of both sides of a thin slice. */
    const bandIn = inner > 0 ? inner : R * 0.28;
    const rc = (bandIn + R) / 2;
    const chord = 2 * rc * Math.sin(Math.min(a1 - a0, Math.PI) / 2);
    const radial = R - bandIn;
    const room = Math.min(a1 - a0 >= TURN - 1e-12 ? radial : chord, radial) - 4;

    const cands = [s.label + '  ' + CK.fmt(s.value) + unit, pct + '%', s.label];
    let lab = null;
    for (const c of cands) {
      if (textW(c) <= room) { lab = { text: c, lm: 0 }; break; }
    }
    if (!lab) lab = labelFor(pct + '%', room, Math.min(chord, radial));

    if (lab) {
      if (lab.lm === 0) out.fitLabels++;
      out.allLabels++;
      const p = pt(rc, (a0 + a1) / 2);
      marks.push({
        t: 'text', lm: lab.lm,
        a: {
          x: n2(p.x, 'lab'), y: n2(p.y, 'lab'), class: 'ck-pi-lab',
          'text-anchor': 'middle', 'dominant-baseline': 'central',
        },
        s: lab.text,
      });
    } else {
      out.droppedLabels++;
    }
  }

  return out;
}

/* ── saying what the picture shows, including that it is the wrong picture ───────────────── */

/** A count with its noun pluralised the boring, correct way. */
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/**
 * Every pair of slices a reader cannot tell apart by angle.
 *
 * Within {@link CLOSE_POINTS} percentage points, the difference in angle is a few degrees on a
 * 360-degree circle, at two different orientations, usually not adjacent. Nobody reads that. The
 * pair is named in the caption because a chart that cannot support a comparison should say which
 * comparison, not merely disclaim in general.
 *
 * @param slices from {@link readSlices}
 * @returns the pairs, closest first, each `{ a, b, gap }` in percentage points
 *
 * @example closePairs([{ tenths: 300 }, { tenths: 290 }]).length;   // 1
 */
function closePairs(slices) {
  const out = [];
  for (let i = 0; i < slices.length; i++) {
    for (let j = i + 1; j < slices.length; j++) {
      const a = slices[i];
      const b = slices[j];
      if (!(a.tenths > 0) || !(b.tenths > 0)) continue;
      const gap = Math.abs(a.tenths - b.tenths) / 10;
      if (gap <= CLOSE_POINTS) out.push({ a, b, gap });
    }
  }
  return out.sort((x, y) => x.gap - y.gap);
}

/**
 * Everything the card refused or folded, as one escaped clause.
 *
 * Kept separate from {@link describe} because it must never quietly go missing: a chart of parts of
 * a whole that dropped a negative value without saying so has told the reader the whole is smaller
 * than it is, and every printed percentage is then wrong.
 */
function refusals(read) {
  const st = read.stats;
  const e = CK.esc;
  const bits = [];

  if (st.negatives) {
    bits.push('<b>' + e(plural(st.negatives, 'negative value')) + '</b> refused &mdash; a share of a ' +
              'whole cannot be negative, so those slices count as zero');
  }
  if (st.unreadable) {
    bits.push('<b>' + e(plural(st.unreadable, 'value')) + '</b> were not a number and count as zero');
  }
  if (st.zeros) {
    bits.push(e(plural(st.zeros, 'slice')) + ' are zero: no wedge, but still in the legend at 0.0%, ' +
              'because a category that measured nothing is a result');
  }
  if (st.folded) {
    bits.push('the ' + e(String(st.folded)) + ' smallest slices are folded into one bucket carrying ' +
              'their sum, so the whole is unchanged and no colour repeats inside the picture');
  }
  if (st.dropped) {
    bits.push(e(String(st.dropped)) + ' slices past the ' + MAX_INPUT + '-slice ceiling were not read');
  }

  return bits.length ? '<span class="ck-aside">' + bits.join('. ') + '.</span>' : '';
}

/**
 * The sentence a screen reader gets and the caption a sighted reader gets, per variant.
 *
 * The caption is where this card earns its keep. It states the total, the largest share, and then —
 * unconditionally — what a pie cannot do, plus, when they exist, the specific comparisons in THIS
 * chart that it cannot support. A disclaimer that is always the same paragraph gets skipped; one
 * that names two slices by name does not.
 */
function describe(read, L, opt) {
  const e = CK.esc;
  const unit = read.unit ? ' ' + read.unit : '';
  const live = read.slices.filter((s) => s.tenths > 0);
  const shape = opt.donut > 0 ? 'donut' : 'pie';

  if (!read.slices.length) {
    return {
      aria: 'Pie chart with no slices: nothing is drawn.',
      caption: 'a ' + shape + ' with <b>no slices</b> &mdash; the card keeps its place on the desk, ' +
               'but there is no whole to divide.',
    };
  }
  if (!(read.total > 0)) {
    return {
      aria: 'Pie chart whose values total zero, so no slice sweeps any angle.',
      caption: 'the slices total <b>zero</b>, so nothing has an angle to sweep. ' + refusals(read),
    };
  }

  const big = live.reduce((a, b) => (b.tenths > a.tenths ? b : a), live[0]);
  const bigPct = (big.tenths / 10).toFixed(1);
  const single = live.length === 1;
  const pairs = closePairs(read.slices);
  const many = live.length > HONEST_SLICES;

  const aria =
    (opt.donut > 0 ? 'Donut' : 'Pie') + ' chart of ' + plural(live.length, 'slice') +
    ' totalling ' + CK.fmt(read.total) + unit + '. The largest is ' + big.label + ' at ' + bigPct +
    ' percent. ' + (many ? 'With more than ' + HONEST_SLICES + ' slices, the angles cannot be ranked ' +
    'reliably; the values are listed beside the chart. ' : '') +
    read.slices.map((s) => s.label + ' ' + CK.fmt(s.value) + unit + ', ' + (s.tenths / 10).toFixed(1) +
                    ' percent').join('. ') + '.';

  const honest =
    (single
      ? '<i>one slice at 100%</i>, drawn as a circle rather than an arc &mdash; an arc whose two ' +
        'endpoints coincide is dropped by the renderer without complaint, which is how this exact ' +
        'chart ends up silently blank. '
      : '') +
    (many
      ? '<b>a pie is the wrong chart here.</b> ' + e(String(live.length)) + ' slices is more than ' +
        'the ' + HONEST_SLICES + ' a reader can rank by angle, and angle is the least accurately ' +
        'judged channel there is. use the <i>chart</i> card with kind <i>bar</i>, sorted: the same ' +
        'comparison becomes a comparison of lengths against a shared baseline, which people do ' +
        'accurately. '
      : '') +
    (pairs.length
      ? '<b>you cannot judge this by angle:</b> ' + e(pairs[0].a.label) + ' at ' +
        e((pairs[0].a.tenths / 10).toFixed(1)) + '% and ' + e(pairs[0].b.label) + ' at ' +
        e((pairs[0].b.tenths / 10).toFixed(1)) + '% differ by ' + e(pairs[0].gap.toFixed(1)) +
        ' points' + (pairs.length > 1 ? ', and ' + e(plural(pairs.length - 1, 'other pair', 'other pairs')) +
        ' are as close' : '') + '. the numbers beside them are the only reliable reading. '
      : '') +
    (!many && !pairs.length
      ? 'what a ' + shape + ' does reliably is show that the parts sum to a whole and which one is ' +
        'largest; it cannot rank similar shares, so every value is printed beside it. '
      : '');

  const caption =
    '<b>' + e(plural(live.length, 'slice')) + '</b> totalling <b>' + e(CK.fmt(read.total) + unit) +
    '</b> &mdash; the largest is <b>' + e(big.label) + '</b> at ' + e(bigPct) + '%. ' +
    honest +
    '<span class="ck-aside">every slice carries its value and its share in the legend, which is the ' +
    'only thing that makes this readable. ' + e(String(L.fitLabels)) + ' of ' +
    e(String(L.fitLabels + (L.allLabels - L.fitLabels) + L.droppedLabels)) + ' slices also hold a ' +
    'label inside the wedge; the rest are too thin, and nothing is ever drawn outside its slice. ' +
    'the shares are apportioned by largest remainder, so they sum to exactly 100.0% and the ' +
    'wedges to exactly one turn.</span> ' +
    refusals(read);

  return { aria: aria.trim(), caption: caption.trim() };
}

/* ── variants ────────────────────────────────────────────────────────────────────────────── */

/** The hole sizes the gear offers, as a fraction of the outer radius. 0 is a pie. */
const DONUTS = [0, 0.35, 0.5, 0.65];

/** The two display orders. Largest-first is the default; a pie unsorted is a pie made worse. */
const SORTS = ['value', 'given'];

/** The label modes. `fit` draws only whole labels; `all` adds truncated ones; `none` draws none. */
const LABEL_MODES = ['all', 'fit', 'none'];

/** Every setting this card understands, with the value that stands when nothing is stored. */
const DEFAULTS = { donut: 0.5, sort: 'value', labels: 'fit' };

/**
 * Lay the chart out once per hole size and display order.
 *
 * Both change geometry; `labels` does not, because every label was already resolved into a mark
 * carrying whether it fits whole. Eight layouts of at most eight slices each is nothing, so there
 * is no budget to run out of here.
 *
 * @returns `{ variants, def }`
 */
function buildVariants(read, cfg) {
  const variants = {};
  for (const d of DONUTS) {
    for (const s of SORTS) {
      const L = layout(read, { donut: d, sort: s });
      const note = describe(read, L, { donut: d, sort: s });
      variants[d + '|' + s] = {
        W: L.W, H: L.H, marks: L.marks, cap: note.caption, aria: note.aria, order: L.order,
      };
    }
  }
  return { variants, def: cfg.donut + '|' + cfg.sort };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────────── */

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-pie[data-card="' + id + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The card's stylesheet. Not one literal colour.
 *
 * In-slice labels take `--ground`: the series palette is light in the dark theme and dark in the
 * light one, which is exactly the inversion the page background already is, so `--ink` would be
 * invisible in precisely one of the two themes. The slices carry a hairline stroke in `--ground`
 * too, so two adjacent slices are separated in both themes without a second colour token.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot', 'max-width: 340px; margin: 0 auto;'],
    ['.ck-plot text', 'pointer-events: none;'],
    ['.ck-pi-slice', 'stroke: var(--ground); stroke-width: 1;'],
    ['.ck-plot .ck-pi-lab', 'fill: var(--ground); font-weight: 700;'],

    ['.ck-legend', 'font-variant-numeric: tabular-nums;'],
    ['.ck-legend i', 'border-radius: 1px;'],
    ['.ck-legend b', 'color: var(--ink-dim); font-weight: 400;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    ['.ck-cap', 'overflow-wrap: anywhere;'],
  ];

  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }

  return scope(id, rules) + '\n';
}

/** One display-list mark as SVG source, so the card is already drawn before any script runs. */
function svgInner(marks, mode) {
  const parts = [];
  for (const m of marks) {
    if (m.lm != null) {
      if (mode === 'none') continue;
      if (mode === 'fit' && m.lm === 1) continue;
    }
    let s = '<' + m.t;
    for (const k of Object.keys(m.a)) {
      if (m.a[k] == null || m.a[k] === '') continue;
      s += ' ' + k + '="' + CK.esc(m.a[k]) + '"';
    }
    if (m.s == null && m.ti == null) { parts.push(s + '/>'); continue; }
    s += '>';
    if (m.ti != null) s += '<title>' + CK.esc(m.ti) + '</title>';
    if (m.s != null) s += CK.esc(m.s);
    parts.push(s + '</' + m.t + '>');
  }
  return parts.join('');
}

/**
 * The legend, which is not optional on this card.
 *
 * Every slice's name, value and share, always, in every mode. It is the reason a pie on this desk
 * is readable at all: the wedges say "these are the parts of one whole" and the legend says what
 * the parts actually are. Items carry their canonical index so the browser can reorder them to
 * match the chart without ever recomputing a number.
 */
function legendHtml(read, order) {
  if (!read.slices.length) return '';
  const unit = read.unit ? ' ' + CK.esc(read.unit) : '';
  const byHue = new Map(read.slices.map((s) => [s.hue, s]));
  const seq = order && order.length ? order : read.slices.map((s) => s.hue);

  const items = seq.map((h) => {
    const s = byHue.get(h);
    if (!s) return '';
    return '<span data-h="' + h + '"><i data-s="' + ((h % 8) + 1) + '"></i>' + CK.esc(s.label) +
           ' <b>' + CK.esc(CK.fmt(s.value)) + unit + '</b> ' +
           CK.esc((s.tenths / 10).toFixed(1)) + '%</span>';
  }).join('');

  return '  <div class="ck-legend ck-pi-key">' + items + '</div>\n';
}

/** The card's markup: heading, gear, panel, the drawing already drawn, the legend, the caption. */
function cardHtml(id, title, read, seed, note, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;
  const sel = (name, values, chosen, render) =>
    '<select id="' + f(name) + '" name="' + name + '">' +
    values.map((v) => '<option value="' + CK.esc(v) + '"' +
      (String(v) === String(chosen) ? ' selected' : '') + '>' +
      CK.esc(render ? render(v) : v) + '</option>').join('') +
    '</select>';

  const foot = 'A pie shows that parts sum to a whole and which is largest. It cannot rank similar ' +
    'shares, so the values are in the legend and the caption names any pair too close to tell ' +
    'apart. A hole makes the outer arcs easier to compare by length rather than by angle.';

  return '<section data-card="' + CK.esc(id) + '" class="ck-pie">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="pie settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('donut') + '">hole</label>\n' +
    '    ' + sel('donut', DONUTS, cfg.donut,
                 (v) => (Number(v) === 0 ? 'none, a full pie' : Math.round(Number(v) * 100) + '% of the radius')) + '\n' +
    '    <label for="' + f('sort') + '">order</label>\n' +
    '    ' + sel('sort', SORTS, cfg.sort,
                 (v) => (v === 'value' ? 'largest first' : 'as given')) + '\n' +
    '    <label for="' + f('labels') + '">labels</label>\n' +
    '    ' + sel('labels', LABEL_MODES, cfg.labels,
                 (v) => (v === 'fit' ? 'only where they fit' : v === 'all' ? 'all, truncated' : 'none')) + '\n' +
    '    <p class="ck-set-foot">' + CK.esc(foot) + '</p>\n' +
    '  </div>\n' +
    '  <svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '"' +
       ' aria-label="' + CK.esc(note.aria) + '">' + svgInner(seed.marks, cfg.labels) + '</svg>\n' +
    legendHtml(read, seed.order) +
    '  <div class="ck-cap">' + note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: a display-list renderer, plus a legend permutation.
 *
 * Classic script, ES5 vocabulary — `var`, `function`, no arrow functions, no template literals, no
 * optional chaining — built by concatenation and put through {@link guardEmitted} before it leaves.
 * No angle, share or total is computed here: they were apportioned once in Node, which is what
 * stops the legend and the wedges disagreeing by a tenth. The legend is reordered with
 * `appendChild`, which MOVES a node it already owns, so a re-render is a permutation and never a
 * second copy of every row.
 */
function cardJs(id, payload, defaults) {
  const L = [];
  L.push('/* pie card: paints a display list that was laid out when the card was built.');
  L.push('   Every angle came from one integer apportionment in Node, so the wedges sum to exactly');
  L.push('   one turn and the legend to exactly 100.0 percent. Nothing is recomputed here. */');
  L.push('CK.build(' + jsonLit(id) + ', function (sec) {');
  L.push('');
  L.push('  var NS = "http://www.w3.org/2000/svg";');
  L.push('  var P = ' + jsonLit(payload) + ';');
  L.push('  var DEFAULTS = ' + jsonLit(defaults) + ';');
  L.push('');
  L.push('  var plot = sec.querySelector("svg.ck-plot");');
  L.push('  var cap = sec.querySelector(".ck-cap");');
  L.push('  var key = sec.querySelector(".ck-pi-key");');
  L.push('  if (!plot) { return; }');
  L.push('');
  L.push('  /* One display-list entry as a real element. Attribute names are the SVG ones, so this');
  L.push('     stays a translator rather than a second place where pie decisions live. */');
  L.push('  function node(m) {');
  L.push('    var e = document.createElementNS(NS, m.t), a = m.a, k, tip;');
  L.push('    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }');
  L.push('    if (m.s != null) { e.textContent = m.s; }');
  L.push('    if (m.ti != null) {');
  L.push('      tip = document.createElementNS(NS, "title");');
  L.push('      tip.textContent = m.ti;');
  L.push('      e.appendChild(tip);');
  L.push('    }');
  L.push('    return e;');
  L.push('  }');
  L.push('');
  L.push('  /* A select hands back a string, so a stored hole of 0.5 and a default of 0.5 are a');
  L.push('     string and a number. Every lookup is built from String() so the two cannot disagree. */');
  L.push('  function keyOf(cfg) {');
  L.push('    var k = String(cfg.donut) + "|" + String(cfg.sort);');
  L.push('    return P.v[k] ? k : P.def;');
  L.push('  }');
  L.push('');
  L.push('  /* Reorder in place. appendChild moves a node the parent already owns, so this is a');
  L.push('     permutation of the rows that are there and never a second set of them. */');
  L.push('  function relabel(order) {');
  L.push('    var i, el;');
  L.push('    if (!key || !order) { return; }');
  L.push('    for (i = 0; i < order.length; i++) {');
  L.push('      el = key.querySelector("span[data-h=\\"" + order[i] + "\\"]");');
  L.push('      if (el) { key.appendChild(el); }');
  L.push('    }');
  L.push('  }');
  L.push('');
  L.push('  function render(cfg) {');
  L.push('    var V = P.v[keyOf(cfg)], i, m;');
  L.push('    var mode = cfg.labels === "all" || cfg.labels === "none" ? cfg.labels : "fit";');
  L.push('    if (!V) { return; }');
  L.push('');
  L.push('    while (plot.firstChild) { plot.removeChild(plot.firstChild); }');
  L.push('    plot.setAttribute("viewBox", "0 0 " + V.W + " " + V.H);');
  L.push('    plot.setAttribute("aria-label", V.aria);');
  L.push('');
  L.push('    for (i = 0; i < V.marks.length; i++) {');
  L.push('      m = V.marks[i];');
  L.push('      if (m.lm != null) {');
  L.push('        if (mode === "none") { continue; }');
  L.push('        if (mode === "fit" && m.lm === 1) { continue; }');
  L.push('      }');
  L.push('      plot.appendChild(node(m));');
  L.push('    }');
  L.push('');
  L.push('    relabel(V.order);');
  L.push('');
  L.push('    /* The caption is markup escaped value by value in Node; nothing from the data');
  L.push('       reaches it unescaped, which is why it may be assigned rather than built. */');
  L.push('    if (cap) { cap.innerHTML = V.cap; }');
  L.push('  }');
  L.push('');
  L.push('  CK.settings(sec, DEFAULTS, render);');
  L.push('});');
  return guardEmitted(L.join('\n') + '\n', 'pie');
}

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * @example meta.name;   // 'pie'
 */
export const meta = {
  name: 'pie',
  summary: 'A pie or donut of parts of a whole, which says in its caption when it is the wrong chart.',
  shape: '{ slices: [{ label, value }], unit } — values must be non-negative; a negative one is ' +
         'refused and counted, and past eight slices the smallest are folded into one bucket',
  defaults: { ...DEFAULTS },
};

/**
 * Every setting this card understands, exported beside `meta.defaults` so a validator can check the
 * emitted panel's field names without building a card first.
 *
 * @example defaults.donut;   // 0.5
 */
export const defaults = { ...DEFAULTS };

/**
 * Fold a caller's seed onto the defaults, coercing rather than refusing.
 *
 * @example settle({ sort: 'nope' }).sort;   // 'value'
 */
function settle(seed) {
  const out = { ...DEFAULTS };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  if (!SORTS.includes(out.sort)) out.sort = DEFAULTS.sort;
  if (!LABEL_MODES.includes(out.labels)) out.labels = DEFAULTS.labels;
  out.donut = DONUTS.includes(Number(out.donut)) ? Number(out.donut) : DEFAULTS.donut;
  return out;
}

/**
 * Build one pie or donut card.
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ slices, unit }`, plus an optional `settings` seed — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; malformed input never throws, it is counted and reported
 *
 * @example
 * build({
 *   id: 'traffic',
 *   title: 'where the traffic came from',
 *   data: { unit: 'visits', slices: [
 *     { label: 'search', value: 4200 },
 *     { label: 'direct', value: 1800 },
 *     { label: 'referral', value: 950 },
 *   ] },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'pie' : id);
  const heading = String(title == null ? 'Pie' : title);
  const read = readSlices(data);
  const cfg = settle(data && typeof data === 'object' ? data.settings : null);

  const built = buildVariants(read, cfg);
  const wantKey = cfg.donut + '|' + cfg.sort;
  const seedKey = built.variants[wantKey] ? wantKey : Object.keys(built.variants)[0];
  const seed = built.variants[seedKey];
  const note = { aria: seed.aria, caption: seed.cap };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      title: heading,
      settings: cfg,
      slices: read.slices.length,
      total: read.total,
    },
    html: cardHtml(cardId, heading, read, seed, note, cfg),
    css: cardCss(cardId),
    js: cardJs(cardId, { v: built.variants, def: seedKey }, cfg),
  };
}

export default {
  meta, defaults, build, guardEmitted,
  readSlices, layout, apportion, closePairs, sliceMark,
};
