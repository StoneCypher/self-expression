/**
 * @file cardkit card type: `sunburst` — a hierarchy as concentric rings: angle is value, radius is
 * depth. The same partition `icicle` draws as stacked bands, bent around a circle.
 *
 * The reason this exists beside `treemap` rather than instead of it: a treemap answers "how big",
 * a sunburst answers "how big, and where in the tree". Depth is a screen dimension here, so a
 * five-level hierarchy reads as five rings and a reader can follow a wedge outward. The cost is
 * that the outer rings have more circumference than the inner ones, so equal values look bigger
 * further out — which is why every wedge carries its exact share in its tooltip.
 *
 * Two pieces of arithmetic are worth reading before changing anything here.
 *
 * **The 360-degree arc.** An SVG elliptical arc is defined by its two endpoints, and the
 * specification says an arc whose endpoints are identical is omitted from the path entirely. A
 * hierarchy with one child at the top — the commonest possible one — therefore renders as an empty
 * ring in every naive implementation, silently. A full turn is emitted here as a stroked `<circle>`,
 * which has no endpoints to collapse. Learned from `portfolio.mjs`, which hit it first.
 *
 * **Angles that close.** Each child's end angle is its own start plus its share, except the last,
 * which is given its parent's end angle exactly. Float drift then lands on nothing: children tile
 * their parent to the bit, the outermost ring closes on itself, and no wedge can disagree with the
 * percentage printed in its tooltip.
 *
 * @see ./portfolio.mjs — where the 360-degree case was solved first; do not re-derive it
 * @see ./icicle.mjs    — the same partition, rectangular
 * @see ./treemap.mjs   — the same data, area rather than angle
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
  catch (e) { throw new Error('cardkit/sunburst: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/sunburst: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── the build-time guard ────────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose, and a guard that cries
 * wolf is a guard that gets switched off. Offsets survive so a reported position still points at
 * something, and regex literals are recognised, because a scanner that desyncs on the quote inside
 * a character class starts blanking real code — a far worse failure than the one it prevents.
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
 * Backtick, `=>` and `?.` are scanned raw — none of them can appear innocently in this card's
 * output. `const`, `let` and `class` are scanned only after comment and string bodies are blanked,
 * because they appear in English constantly. Control characters are compared numerically rather
 * than matched against a character class, since writing the class is how the class gets corrupted.
 *
 * @param src   the emitted script
 * @param where a label for the message, naming which card produced it
 * @returns `src` unchanged, so the guard can wrap the value on its way out
 * @throws {Error} naming the violation, its offset, and the source around it
 *
 * @example guardEmitted('var a = 1;', 'sunburst');   // 'var a = 1;'
 */
export function guardEmitted(src, where) {
  const tag = 'cardkit/' + (where || 'sunburst') + ': emitted js ';

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
   cards on one desk agree about what fits. Half a pixel pessimistic drops a label that would just
   have fitted, which is the safe way to be wrong. */
const CHW = 5.42;
const TXT = 9;

/** The horizontal ellipsis, written as an escape so no literal can be mistyped into the source. */
const ELL = '\u2026';

/** A printable path separator; a visible separator is checkable in a way an invisible one is not. */
const SEP = ' \u203a ';

/** Width in px of a string set in the plot's mono face at `size`. */
function textW(s, size) { return String(s).length * CHW * ((size || TXT) / TXT); }

/**
 * What a wedge's label may say, given the room it has.
 *
 * "Wide enough for text to fit" is decided in two directions and both must hold, which is the whole
 * answer to the label question:
 *
 * - **Along the radius**, the label runs from the wedge's inner edge outward, so the room is the
 *   ring's thickness less a 3px margin at each end. A label wider than that is truncated with an
 *   ellipsis; one with room for fewer than three characters is dropped, because two characters and
 *   an ellipsis identify nothing.
 * - **Across the wedge**, the text is one line tall, so the wedge must be at least the font size
 *   plus two px across. That is measured at the wedge's INNER radius, where it is narrowest, so a
 *   label can never bleed into the neighbour it is thinnest against.
 *
 * Nothing is ever drawn outside its wedge. Every dropped or shortened name is still in the wedge's
 * tooltip, and every top-level name is in the legend.
 *
 * @param text  the label
 * @param along usable radial length in px
 * @param across usable tangential room in px, measured at the inner radius
 * @param size  font size, defaulting to the plot's 9px
 * @returns `{ text, lm }` with `lm` 0 for a whole label and 1 for a truncated one, or null
 *
 * @example labelFor('storage', 60, 12);   // { text: 'storage', lm: 0 }
 * @example labelFor('storage', 25, 12);   // { text: 'stor\u2026', lm: 1 }
 * @example labelFor('storage', 60, 6);    // null
 */
function labelFor(text, along, across, size) {
  const fs = size || TXT;
  const full = String(text);
  if (!full.length || !(along > 0) || !(across >= fs + 2)) return null;
  if (textW(full, fs) <= along) return { text: full, lm: 0 };
  const room = Math.floor(along / (CHW * (fs / TXT)));
  if (room < 3) return null;
  return { text: full.slice(0, room - 1) + ELL, lm: 1 };
}

/* ── emission helpers ────────────────────────────────────────────────────────────────────── */

/**
 * Serialise a value as a JavaScript literal safe inside a classic `<script>` element.
 *
 * `<` and `>` become escapes so a name cannot close the script element early — and, usefully, so no
 * name can ever put an arrow function into a file that is contractually free of them. Backticks go
 * too, and the two line separators, which are newlines to a JS parser and not to `JSON.stringify`.
 *
 * @example jsonLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
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
 * A NaN in a path is silent: the browser drops the whole `d` and the card renders empty with
 * nothing in the console. Failing at build time turns that into a stack trace beside the input.
 *
 * @throws {Error} when `v` is NaN or infinite
 * @example n2(12.3456, 'arc');   // 12.35
 */
function n2(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/sunburst: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/* ── reading the hierarchy ───────────────────────────────────────────────────────────────── */

/* A parent with more children than this folds its smallest into one bucket carrying their sum, so
   the parent's angle is unchanged and no share is lost. A thousand wedges on one ring are each
   under a third of a degree, which is thinner than the stroke that would draw them. */
const MAX_CHILDREN = 1000;

/* A hard ceiling on nodes read, so a pathological descriptor cannot make the build hang. */
const MAX_NODES = 6000;

/* A defensive recursion limit. `depth: 10` is a supported case; thirty-two is not a hierarchy. */
const HARD_DEPTH = 32;

/** How a node's colour is chosen. `branch` groups by the top-level ancestor, which is the useful one. */
const COLOR_BY = ['branch', 'depth', 'index', 'name'];

/**
 * A finite number from an untrusted field, accepting a numeric string.
 *
 * Numeric strings are accepted because hierarchies routinely arrive from CSV and JSON exports where
 * every value is quoted. Everything else — null, an empty string, an object, a boolean — is refused
 * rather than coerced, because `Number([])` is 0 and a silent zero is a lie about a share.
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

/** Two values agree within a relative epsilon; a declared branch total is float data. */
function agrees(a, b) {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 1e-9;
}

/**
 * Read one untrusted hierarchy into the one shape the rest of the file may assume.
 *
 * The decisions, all of which the caption reports:
 *
 * - **A branch's value is the sum of its children.** When a branch also declares a value and the
 *   two disagree, the children win and the disagreement is named, because a wedge is subdivided
 *   into its children and if the parent's angle came from the declared number the parts would not
 *   fill it — the picture would be lying about the one thing it is for.
 * - **A negative value is refused**, counted, and drawn as nothing. There is no such thing as a
 *   negative angle in a partition; a wedge that swept backwards would overlap its neighbour.
 * - **A non-numeric value is refused** the same way and counted separately, because "this field was
 *   text" and "this field was minus five" are different problems for whoever wrote the data.
 * - **Zero is kept and drawn as nothing**, which is what a zero-width wedge is, and counted.
 *
 * @param data the card's `data` block, possibly absent or malformed
 * @returns `{ root, unit, colorBy, stats }` with `root` null when there is no hierarchy
 *
 * @example readTree({ root: { name: 'all', children: [{ name: 'a', value: 3 }] } }).root.value;   // 3
 * @example readTree(undefined).root;   // null
 */
function readTree(data) {
  const d = data && typeof data === 'object' ? data : {};
  const stats = {
    leaves: 0, branches: 0, negatives: 0, unreadable: 0, zeros: 0,
    mismatches: [], folded: 0, dropped: 0, cyclic: 0, maxDepth: 0, count: 0, dupNames: 0,
  };
  const kinds = new Map();

  const walk = (raw, depth, path, seen) => {
    if (stats.count >= MAX_NODES) { stats.dropped++; return null; }
    if (!raw || typeof raw !== 'object') { stats.dropped++; return null; }
    if (seen.has(raw)) { stats.cyclic++; return null; }
    seen.add(raw);
    stats.count++;

    const name = raw.name == null ? '' : String(raw.name);
    const here = path ? path + SEP + name : name;
    const kidsRaw = depth < HARD_DEPTH && Array.isArray(raw.children) ? raw.children : [];

    let children = [];
    for (const k of kidsRaw) {
      const child = walk(k, depth + 1, here, seen);
      if (child) children.push(child);
    }

    if (children.length > MAX_CHILDREN) {
      children.sort((a, b) => b.value - a.value);
      const kept = children.slice(0, MAX_CHILDREN - 1);
      const rest = children.slice(MAX_CHILDREN - 1);
      const sum = rest.reduce((a, b) => a + b.value, 0);
      stats.folded += rest.length;
      kept.push({
        name: rest.length + ' smaller', value: sum, children: [], depth: depth + 1,
        path: here + SEP + rest.length + ' smaller',
      });
      children = kept;
    }

    seen.delete(raw);

    let value;
    if (children.length) {
      const sum = children.reduce((a, b) => a + b.value, 0);
      const declared = numOrNull(raw.value);
      if (declared !== null && !agrees(declared, sum)) {
        stats.mismatches.push({ path: here || '(root)', declared, sum });
      }
      value = sum;
      stats.branches++;
    } else {
      const v = numOrNull(raw.value);
      if (v === null) { stats.unreadable++; value = 0; }
      else if (v < 0) { stats.negatives++; value = 0; }
      else { value = v; if (v === 0) stats.zeros++; }
      stats.leaves++;
    }

    if (depth > stats.maxDepth) stats.maxDepth = depth;
    const kind = kinds.get(name) || { leaf: false, branch: false };
    if (children.length) kind.branch = true; else kind.leaf = true;
    kinds.set(name, kind);

    return { name, value, children, depth, path: here };
  };

  const raw = d.root && typeof d.root === 'object' ? d.root : null;
  const root = raw ? walk(raw, 0, '', new Set()) : null;
  for (const k of kinds.values()) if (k.leaf && k.branch) stats.dupNames++;

  return {
    root,
    unit: d.unit == null ? '' : String(d.unit).trim(),
    colorBy: COLOR_BY.includes(d.colorBy) ? d.colorBy : 'branch',
    stats,
  };
}

/** A small stable hash, so `colorBy: 'name'` gives the same colour to the same name every build. */
function hashName(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000007;
  return h;
}

/** The palette index for one node under one colouring rule. */
function hueIndex(node, topIx, sibIx, how) {
  if (how === 'depth') return node.depth;
  if (how === 'index') return sibIx;
  if (how === 'name') return hashName(node.name);
  return topIx < 0 ? 0 : topIx;
}

/* ── the radial partition ────────────────────────────────────────────────────────────────── */

/** One full turn in radians. Named because it is the number the closure check compares against. */
const TURN = Math.PI * 2;

/* The card is square: the ring stack has no long axis to exploit. */
const SIZE = 460;
const CX = SIZE / 2;
const CY = SIZE / 2;

/* The hole. Large enough to hold the total in a readable face, and it is also what stops the
   innermost ring from being a wedge with no tangential room at all near the centre. */
const R_HOLE = 58;
const R_MAX = 216;

/**
 * Give a parent's children start and end angles that exactly tile the parent.
 *
 * The last child is handed the parent's own end angle rather than its computed one. Every float
 * error in the division therefore lands on nothing: the ring closes on itself to the bit, and the
 * check that the outermost ring sums to one turn is a fact rather than an approximation. Divide
 * each child independently and the ring closes to within a few ulps, which is invisible until it
 * is not — a one-child hierarchy would draw a wedge of 359.9999 degrees, which is an arc with two
 * distinct endpoints, which is a hairline gap at twelve o'clock forever.
 *
 * @param kids  children with non-negative values
 * @param total their parent's value, which is their sum
 * @param a0    the parent's start angle
 * @param a1    the parent's end angle
 * @returns one `{ node, a0, a1 }` per child, in the given order
 *
 * @example span([{ value: 1 }, { value: 1 }], 2, 0, Math.PI)[1].a1 === Math.PI;   // true
 */
function span(kids, total, a0, a1) {
  const out = [];
  if (!(total > 0)) return out;
  const width = a1 - a0;
  let at = a0;
  for (let i = 0; i < kids.length; i++) {
    const w = (kids[i].value / total) * width;
    const end = i === kids.length - 1 ? a1 : at + w;
    out.push({ node: kids[i], a0: at, a1: end });
    at = end;
  }
  return out;
}

/**
 * A point on a circle, with angles measured clockwise from twelve o'clock.
 *
 * Twelve o'clock is zero because a reader looking for the largest share looks there first, and
 * clockwise because that is the direction the eye walks a ring. Screen y grows downward, so this
 * convention also makes the SVG sweep flag 1 for every forward arc, with no case analysis.
 *
 * @example pt(10, 0);   // { x: 230, y: 220 }  — straight up from the centre
 */
function pt(r, a) {
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
}

/**
 * One ring segment as a display-list mark.
 *
 * The segment is a STROKED arc along the ring's mid-radius, not a filled annulus sector. That is
 * what makes the full-turn case expressible at all: a stroked circle is a complete ring, where a
 * filled path covering the whole turn has identical endpoints and — per the SVG specification — is
 * omitted from the path entirely, so the commonest hierarchy there is draws nothing, silently. A
 * filled sector would need four boundary segments and a fill rule to say the same thing.
 *
 * The drawn arc is pulled in by a hair at each end so two neighbours of the same colour do not read
 * as one shape. The LAYOUT angles are untouched: they are what the tooltips and the caption divide,
 * and they are the ones the closure check tests.
 *
 * @param a0, a1 the segment's angles
 * @param rIn, rOut the ring's radii
 * @param attrs colour and class for the mark
 * @returns a mark, either a path or — for a full turn — a circle
 *
 * @example arcMark(0, Math.PI * 2, 60, 90, {}).t;   // 'circle'
 */
function arcMark(a0, a1, rIn, rOut, attrs) {
  const mid = (rIn + rOut) / 2;
  const wide = rOut - rIn;
  const base = Object.assign({
    fill: 'none', 'stroke-width': n2(wide, 'ring'), 'stroke-linecap': 'butt',
  }, attrs);

  if (a1 - a0 >= TURN - 1e-12) {
    /* The 360-degree case. See the note above and in portfolio.mjs: an arc path whose endpoints
       coincide is dropped by the renderer without complaint, so a single-child hierarchy would
       render as an empty ring in a card that looks like it is working. */
    return { t: 'circle', a: Object.assign({ cx: n2(CX, 'ring'), cy: n2(CY, 'ring'), r: n2(mid, 'ring') }, base) };
  }

  const gap = Math.min(0.4 / Math.max(mid, 1), (a1 - a0) / 6);
  const s = a0 + gap;
  const e = a1 - gap;
  const p0 = pt(mid, s);
  const p1 = pt(mid, e);
  const large = e - s > Math.PI ? 1 : 0;
  const d = 'M' + n2(p0.x, 'arc') + ' ' + n2(p0.y, 'arc') +
            'A' + n2(mid, 'arc') + ' ' + n2(mid, 'arc') + ' 0 ' + large + ' 1 ' +
            n2(p1.x, 'arc') + ' ' + n2(p1.y, 'arc');
  return { t: 'path', a: Object.assign({ d }, base) };
}

/**
 * Lay one sunburst out: the display list, the label tally and the ring geometry.
 *
 * `depth` rings are drawn; anything deeper is left inside its ancestor at that level, which keeps
 * every ring a complete partition of the one inside it. The ring thickness is constant, so radius
 * carries depth and nothing else — a thickness that grew with the number of children would make
 * radius carry two meanings at once and neither would be readable.
 *
 * @param read from {@link readTree}
 * @param opt  `{ depth }`
 * @returns `{ marks, rings, drawn, fitLabels, allLabels, dropped, closure }`
 *
 * @example layout(readTree(data), { depth: 3 }).rings;   // 3
 */
function layout(read, opt) {
  const marks = [];
  const out = {
    marks, rings: 0, drawn: 0, fitLabels: 0, allLabels: 0, droppedLabels: 0,
    closure: 0, W: SIZE, H: SIZE, top: [],
  };
  const root = read.root;
  if (!root || !(root.value > 0)) return out;

  const rings = Math.max(1, opt.depth);
  out.rings = rings;
  const thick = (R_MAX - R_HOLE) / rings;
  const total = root.value;
  const unit = read.unit ? ' ' + read.unit : '';

  const walk = (node, a0, a1, topIx, sibIx) => {
    if (node.depth > 0) {
      const ring = node.depth - 1;
      const rIn = R_HOLE + ring * thick;
      const rOut = rIn + thick;
      const share = (node.value / total) * 100;
      const tip = (node.path || node.name || '(root)') + ' \u00b7 ' + CK.fmt(node.value) + unit +
                  ' \u00b7 ' + share.toFixed(share < 1 ? 2 : 1) + '%';

      marks.push(Object.assign(arcMark(a0, a1, rIn + 0.75, rOut - 0.75, {
        stroke: CK.hue(hueIndex(node, topIx, sibIx, read.colorBy)),
        'stroke-opacity': String(Math.max(0.55, 0.95 - ring * 0.09)),
        class: 'ck-sb-seg',
      }), { ti: tip }));
      out.drawn++;

      /* Room along the radius, and room across the wedge measured at its INNER edge where it is
         narrowest. Both have to hold; see labelFor for why that is the honest test. */
      const along = thick - 8;
      const across = a1 - a0 >= TURN - 1e-12 ? Infinity : rIn * (a1 - a0);
      const withVal = node.name + '  ' + CK.fmt(node.value);
      let lab = textW(withVal) <= along && across >= TXT + 2 ? { text: withVal, lm: 0 } : null;
      if (!lab) lab = labelFor(node.name, along, across);

      if (lab) {
        if (lab.lm === 0) out.fitLabels++;
        out.allLabels++;
        const am = (a0 + a1) / 2;
        let deg = (am * 180) / Math.PI - 90;
        if (deg > 180) deg -= 360;
        /* On the left half of the circle a label reading outward would be upside down, so it is
           hung from the outer edge and turned round instead. */
        const flip = deg > 90 || deg < -90;
        const anchor = flip ? 'end' : 'start';
        const p = pt(flip ? rOut - 4 : rIn + 4, am);
        marks.push({
          t: 'text', lm: 0,
          a: {
            x: n2(p.x, 'lab'), y: n2(p.y, 'lab'),
            class: 'ck-sb-lab', 'text-anchor': anchor, 'dominant-baseline': 'central',
            transform: 'rotate(' + n2(flip ? deg + 180 : deg, 'lab') + ' ' +
                        n2(p.x, 'lab') + ' ' + n2(p.y, 'lab') + ')',
          },
          s: lab.text,
        });
      } else {
        out.droppedLabels++;
      }
    }

    if (node.depth >= rings) return;
    const kids = node.children.filter((c) => c.value > 0);
    if (!kids.length) return;
    const laid = span(kids, node.value, a0, a1);
    laid.forEach((L, i) => {
      const ix = node.depth === 0 ? i : topIx;
      if (node.depth === 0) out.top.push({ node: L.node, a0: L.a0, a1: L.a1 });
      walk(L.node, L.a0, L.a1, ix, i);
    });
  };

  walk(root, 0, TURN, -1, 0);

  /* What the first ring actually closed to. Reported rather than assumed: the whole point of the
     last-child-takes-the-remainder rule is that this is zero, and a number that is claimed and
     never measured is a number that quietly stops being true. */
  let sum = 0;
  for (const t of out.top) sum += t.a1 - t.a0;
  out.closure = out.top.length ? Math.abs(sum - TURN) : 0;
  out.ends = out.top.length ? out.top[out.top.length - 1].a1 : TURN;

  return out;
}

/* ── the centre ──────────────────────────────────────────────────────────────────────────── */

/**
 * The three things the hole can say, as marks tagged with the centre mode that shows them.
 *
 * The mode changes no geometry, so all three ship and the renderer picks — the same trick the
 * label modes use. That keeps a settings change a repaint and keeps the arithmetic in Node.
 *
 * @param read from {@link readTree}
 * @returns display-list marks carrying a `cm` tag
 */
function centreMarks(read) {
  const root = read.root;
  if (!root) return [];
  const unit = read.unit ? ' ' + read.unit : '';
  const value = CK.fmt(root.value) + unit;
  const name = root.name || 'root';

  const big = (s, cm, cls, dy) => ({
    t: 'text', cm,
    a: {
      x: n2(CX, 'hole'), y: n2(CY + dy, 'hole'), class: cls,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
    },
    s,
  });

  const out = [];
  /* The total is clipped to the hole rather than allowed to run over the innermost ring: the hole
     is 2 * R_HOLE across and the face is 15px, so the room is measured, not guessed. */
  const room = R_HOLE * 1.7;
  const fitV = textW(value, 15) <= room ? value : value.slice(0, Math.max(1, Math.floor(room / (CHW * 15 / TXT))) - 1) + ELL;
  const fitN = textW(name, 12) <= room ? name : name.slice(0, Math.max(1, Math.floor(room / (CHW * 12 / TXT))) - 1) + ELL;

  out.push(big(fitV, 'total', 'ck-sb-hole', -3));
  out.push(big('total', 'total', 'ck-sb-holelab', 12));
  out.push(big(fitN, 'name', 'ck-sb-holename', 0));
  return out;
}

/* ── saying what the picture shows ───────────────────────────────────────────────────────── */

/** A count with its noun pluralised the boring, correct way. */
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/**
 * Everything the card refused, folded, or found inconsistent, as one escaped clause.
 *
 * Kept separate from {@link describe} because it is the same list whatever the picture looks like,
 * and because it is the part that must never quietly go missing: a partition that dropped a
 * negative value without saying so has told the reader the whole is smaller than it is.
 */
function refusals(read) {
  const st = read.stats;
  const e = CK.esc;
  const bits = [];

  if (st.negatives) {
    bits.push('<b>' + e(plural(st.negatives, 'negative value')) + '</b> refused &mdash; a partition ' +
              'has no backwards wedge, so those nodes count as zero');
  }
  if (st.unreadable) {
    bits.push('<b>' + e(plural(st.unreadable, 'value')) + '</b> were not a number and count as zero');
  }
  if (st.zeros) bits.push(e(plural(st.zeros, 'leaf', 'leaves')) + ' are zero and sweep no angle');
  if (st.mismatches.length) {
    const m = st.mismatches[0];
    bits.push('<b>' + e(plural(st.mismatches.length, 'branch', 'branches')) +
              '</b> declare a total that disagrees with their children &mdash; ' + e(m.path) +
              ' says ' + e(CK.fmt(m.declared)) + ' but its children sum to ' + e(CK.fmt(m.sum)) +
              '; the children win, because they have to fill the wedge exactly');
  }
  if (st.folded) {
    bits.push(e(String(st.folded)) + ' of the smallest siblings past ' + MAX_CHILDREN +
              ' were folded into one wedge carrying their sum, so no angle was lost');
  }
  if (st.dropped) {
    bits.push(e(String(st.dropped)) + ' nodes past the ' + MAX_NODES + '-node ceiling were not read');
  }
  if (st.cyclic) bits.push(e(plural(st.cyclic, 'cycle')) + ' in the hierarchy cut');
  if (st.dupNames) {
    bits.push(e(plural(st.dupNames, 'name')) + ' appear on both a leaf and a branch; the tooltip ' +
              'carries the full path, which is the only thing that tells them apart');
  }

  return bits.length ? '<span class="ck-aside">' + bits.join('. ') + '.</span>' : '';
}

/**
 * The sentence a screen reader gets and the caption a sighted reader gets, per variant.
 *
 * `role="img"` hides the SVG's internals, so the aria label is the entire drawing to anyone using
 * it; "sunburst" alone names the genre and withholds the content.
 *
 * @param read from {@link readTree}
 * @param L    from {@link layout}
 * @param opt  `{ depth }`
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function describe(read, L, opt) {
  const st = read.stats;
  const root = read.root;
  const unit = read.unit ? ' ' + read.unit : '';
  const e = CK.esc;

  if (!root) {
    return {
      aria: 'Sunburst with no hierarchy: nothing is drawn.',
      caption: 'a sunburst with <b>no hierarchy</b> &mdash; the card keeps its place on the desk, ' +
               'but there is no whole to divide.',
    };
  }
  if (!(root.value > 0)) {
    return {
      aria: 'Sunburst whose values total zero, so no wedge sweeps any angle.',
      caption: 'the hierarchy totals <b>zero</b>, so no wedge has an angle to sweep. ' + refusals(read),
    };
  }

  let big = null;
  for (const t of L.top) if (!big || t.node.value > big.node.value) big = t;
  const bigShare = big ? (big.node.value / root.value) * 100 : 0;
  const single = L.top.length === 1;

  const aria =
    'Sunburst of ' + plural(st.leaves, 'leaf', 'leaves') + ' under ' +
    plural(st.branches, 'branch', 'branches') + ', totalling ' + CK.fmt(root.value) + unit +
    '. ' + plural(L.rings, 'ring') + ' are drawn, angle proportional to value and radius to depth. ' +
    (big ? 'The largest top-level share is ' + (big.node.name || 'unnamed') + ' at ' +
           bigShare.toFixed(1) + ' percent.' : '');

  const caption =
    '<b>' + e(String(L.drawn)) + '</b> wedge' + (L.drawn === 1 ? '' : 's') + ' over <b>' +
    e(plural(L.rings, 'ring')) + '</b> &mdash; angle is value, radius is depth. ' +
    e(plural(st.leaves, 'leaf', 'leaves')) + ' under ' + e(plural(st.branches, 'branch', 'branches')) +
    ', totalling <b>' + e(CK.fmt(root.value) + unit) + '</b>. ' +
    (big ? 'the largest top-level share is <b>' + e(big.node.name || 'unnamed') + '</b> at ' +
           e(bigShare.toFixed(1)) + '%. ' : '') +

    (single
      ? '<i>one child takes the whole turn</i>, so its ring is drawn as a circle rather than an arc ' +
        '&mdash; an arc whose two endpoints coincide is dropped by the renderer without complaint, ' +
        'which is how a chart like this ends up silently blank. '
      : '') +

    '<span class="ck-aside">a label is drawn only where the wedge holds it in both directions: at ' +
    'least ' + e(String(TXT + 2)) + 'px across the wedge measured at its inner edge, where it is ' +
    'narrowest, and enough radial room for three characters. ' + e(L.fitLabels + ' of ' +
    (L.fitLabels + (L.allLabels - L.fitLabels) + L.droppedLabels)) + ' wedges show their name whole, ' +
    e(String(L.allLabels - L.fitLabels)) + ' show it truncated, and ' + e(String(L.droppedLabels)) +
    ' show none &mdash; nothing is ever drawn outside its wedge, and every name is in the tooltip. ' +
    'the first ring closes on itself to within ' + e(L.closure.toExponential(0)) +
    ' radians of a full turn.</span> ' +

    refusals(read);

  return { aria: aria.trim(), caption: caption.trim() };
}

/* ── variants ────────────────────────────────────────────────────────────────────────────── */

/** Every setting this card understands, with the value that stands when nothing is stored. */
const DEFAULTS = { depth: 3, labels: true, center: 'total' };

/** What the hole may say. */
const CENTRES = ['total', 'name', 'none'];

/* Total marks across every precomputed variant. Depth is the only geometry setting, so eight rings
   over a wide hierarchy is the worst case; every card's script is concatenated into one inline
   block, so past this the card stops enumerating and the panel offers only the ring counts that
   were actually laid out. */
const MARK_BUDGET = 2600;

/**
 * Lay the sunburst out once per depth, within a size budget.
 *
 * Only `depth` changes geometry. `labels` and `center` are mark filters — the label marks and the
 * three centre marks all ship, tagged with the mode that shows them — so a settings change is a
 * repaint and never a second implementation of the partition.
 *
 * @returns `{ variants, order, def, depths, skipped }`
 */
function buildVariants(read, depths, defDepth) {
  const centre = centreMarks(read);
  const sorted = depths.slice().sort((a, b) => Math.abs(a - defDepth) - Math.abs(b - defDepth) || a - b);

  const variants = {};
  const order = [];
  let used = 0;
  let skipped = 0;

  for (const d of sorted) {
    if (used > MARK_BUDGET && order.length) { skipped++; continue; }
    const L = layout(read, { depth: d });
    const note = describe(read, L, { depth: d });
    variants[String(d)] = {
      W: L.W, H: L.H, marks: L.marks.concat(centre), cap: note.caption, aria: note.aria,
    };
    order.push(String(d));
    used += L.marks.length;
  }

  return {
    variants, order, skipped,
    def: String(defDepth),
    depths: depths.filter((d) => variants[String(d)]),
  };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────────── */

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-sunburst[data-card="' + id + '"]';
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
 * Wedge labels sit on a coloured stroke, so they take `--ground`: the series palette is light in
 * the dark theme and dark in the light one, which is exactly the inversion the page background
 * already is. `--ink` would be invisible in precisely one of the two themes.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot', 'max-width: 460px; margin: 0 auto;'],
    ['.ck-plot text', 'pointer-events: none;'],
    ['.ck-sb-seg', 'fill: none;'],
    ['.ck-plot .ck-sb-lab', 'fill: var(--ground); font-weight: 700;'],
    ['.ck-plot .ck-sb-hole',
     'font-family: var(--disp), var(--ui); font-size: 15px; fill: var(--ink); ' +
     'font-variant-numeric: tabular-nums;'],
    ['.ck-plot .ck-sb-holename',
     'font-family: var(--disp), var(--ui); font-size: 12px; fill: var(--ink);'],
    ['.ck-plot .ck-sb-holelab',
     'font-family: var(--ui); font-size: 8px; fill: var(--ink-faint); ' +
     'letter-spacing: .12em; text-transform: uppercase;'],

    ['.ck-legend i', 'border-radius: 1px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
    ['.ck-cap', 'overflow-wrap: anywhere;'],
  ];

  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }

  return scope(id, rules) + '\n';
}

/** One display-list mark as SVG source, so the card is already drawn before any script runs. */
function svgInner(marks, labels, centre) {
  const parts = [];
  for (const m of marks) {
    if (m.lm != null && !labels) continue;
    if (m.cm != null && m.cm !== centre) continue;
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

/** The legend: the top-level children, their colour and their share of the whole. */
function legendHtml(read) {
  const root = read.root;
  if (!root || !root.children.length || !(root.value > 0)) return '';
  const kids = root.children.slice(0, 8);
  const items = kids.map((c, i) => {
    const pct = ((c.value / root.value) * 100).toFixed(1);
    return '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(c.name || 'unnamed') +
           ' ' + CK.esc(pct) + '%</span>';
  }).join('');
  const more = root.children.length > 8
    ? '<span>' + CK.esc('+' + (root.children.length - 8) + ' more') + '</span>' : '';
  return '  <div class="ck-legend">' + items + more + '</div>\n';
}

/** The card's markup: heading, gear, panel, the drawing already drawn, a legend, the caption. */
function cardHtml(id, title, read, seed, note, built, cfg) {
  const f = (name) => CK.esc(id) + '-' + name;
  const sel = (name, values, chosen, render) =>
    '<select id="' + f(name) + '" name="' + name + '">' +
    values.map((v) => '<option value="' + CK.esc(v) + '"' +
      (String(v) === String(chosen) ? ' selected' : '') + '>' +
      CK.esc(render ? render(v) : v) + '</option>').join('') +
    '</select>';

  const foot = 'Angle is proportional to value at every level; radius carries depth and nothing ' +
    'else. A label appears only where its wedge is wide enough to hold it whole rings out, so ' +
    'turning labels on does not guarantee one on every wedge.' +
    (built.skipped
      ? ' This hierarchy is large, so only the ring counts listed here were laid out.'
      : '');

  return '<section data-card="' + CK.esc(id) + '" class="ck-sunburst">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="sunburst settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('depth') + '">rings</label>\n' +
    '    ' + sel('depth', built.depths, cfg.depth) + '\n' +
    '    <label for="' + f('labels') + '">labels</label>\n' +
    '    <input id="' + f('labels') + '" name="labels" type="checkbox"' +
           (cfg.labels ? ' checked' : '') + '>\n' +
    '    <label for="' + f('center') + '">centre</label>\n' +
    '    ' + sel('center', CENTRES, cfg.center,
                 (v) => (v === 'total' ? 'the total' : v === 'name' ? 'the root name' : 'empty')) + '\n' +
    '    <p class="ck-set-foot">' + CK.esc(foot) + '</p>\n' +
    '  </div>\n' +
    '  <svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '"' +
       ' aria-label="' + CK.esc(note.aria) + '">' + svgInner(seed.marks, cfg.labels, cfg.center) + '</svg>\n' +
    legendHtml(read) +
    '  <div class="ck-cap">' + note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: a display-list renderer and nothing that decides anything.
 *
 * Classic script, ES5 vocabulary — `var`, `function`, no arrow functions, no template literals, no
 * optional chaining — built by concatenation and put through {@link guardEmitted} before it leaves.
 * `render` clears the plot before drawing, so a `<main>` swap replaces the picture rather than
 * stacking a second copy on top of it.
 */
function cardJs(id, payload, defaults) {
  const L = [];
  L.push('/* sunburst card: paints a display list that was laid out when the card was built.');
  L.push('   The partition, every angle, the full-turn case and the caption were settled in Node,');
  L.push('   so this turns descriptions into elements and does not know what a wedge is. */');
  L.push('CK.build(' + jsonLit(id) + ', function (sec) {');
  L.push('');
  L.push('  var NS = "http://www.w3.org/2000/svg";');
  L.push('  var P = ' + jsonLit(payload) + ';');
  L.push('  var DEFAULTS = ' + jsonLit(defaults) + ';');
  L.push('');
  L.push('  var plot = sec.querySelector("svg.ck-plot");');
  L.push('  var cap = sec.querySelector(".ck-cap");');
  L.push('  if (!plot) { return; }');
  L.push('');
  L.push('  /* One display-list entry as a real element. Attribute names are the SVG ones, so this');
  L.push('     stays a translator rather than a second place where sunburst decisions live. */');
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
  L.push('  /* A select hands back a string, so a stored ring count of 3 and a default of 3 are a');
  L.push('     string and a number. Every lookup is built from String() so the two cannot disagree. */');
  L.push('  function keyOf(cfg) {');
  L.push('    var k = String(cfg.depth);');
  L.push('    return P.v[k] ? k : P.def;');
  L.push('  }');
  L.push('');
  L.push('  function render(cfg) {');
  L.push('    var V = P.v[keyOf(cfg)], labels = !!cfg.labels, i, m;');
  L.push('    var centre = cfg.center === "name" || cfg.center === "none" ? cfg.center : "total";');
  L.push('    if (!V) { return; }');
  L.push('');
  L.push('    while (plot.firstChild) { plot.removeChild(plot.firstChild); }');
  L.push('    plot.setAttribute("viewBox", "0 0 " + V.W + " " + V.H);');
  L.push('    plot.setAttribute("aria-label", V.aria);');
  L.push('');
  L.push('    for (i = 0; i < V.marks.length; i++) {');
  L.push('      m = V.marks[i];');
  L.push('      if (m.lm != null && !labels) { continue; }');
  L.push('      if (m.cm != null && m.cm !== centre) { continue; }');
  L.push('      plot.appendChild(node(m));');
  L.push('    }');
  L.push('');
  L.push('    /* The caption is markup escaped value by value in Node; nothing from the data');
  L.push('       reaches it unescaped, which is why it may be assigned rather than built. */');
  L.push('    if (cap) { cap.innerHTML = V.cap; }');
  L.push('  }');
  L.push('');
  L.push('  CK.settings(sec, DEFAULTS, render);');
  L.push('});');
  return guardEmitted(L.join('\n') + '\n', 'sunburst');
}

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * @example meta.name;   // 'sunburst'
 */
export const meta = {
  name: 'sunburst',
  summary: 'A hierarchy as concentric rings: angle is proportional to value, radius to depth.',
  shape: "{ root: { name, value, children: [...] }, unit, colorBy: 'branch' | 'depth' | 'index' | 'name' } — " +
         'a leaf carries a value; a branch takes the sum of its children, and a branch that declares ' +
         'a different total is named in the caption rather than silently believed',
  defaults: { ...DEFAULTS },
};

/**
 * Every setting this card understands, exported beside `meta.defaults` so a validator can check the
 * emitted panel's field names without building a card first.
 *
 * @example defaults.center;   // 'total'
 */
export const defaults = { ...DEFAULTS };

/**
 * Fold a caller's seed onto the defaults, coercing rather than refusing.
 *
 * @example settle({ center: 'nope' }, [1, 2, 3]).center;   // 'total'
 */
function settle(seed, depths) {
  const out = { ...DEFAULTS };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  out.labels = !!out.labels;
  if (!CENTRES.includes(out.center)) out.center = DEFAULTS.center;
  const d = Number(out.depth);
  out.depth = depths.includes(d) ? d : (depths.includes(DEFAULTS.depth) ? DEFAULTS.depth : depths[depths.length - 1]);
  return out;
}

/**
 * Build one sunburst card from one hierarchy.
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ root, unit, colorBy }`, plus an optional `settings` seed — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; malformed input never throws, it is counted and reported
 *
 * @example
 * build({
 *   id: 'spend',
 *   title: 'where the budget went',
 *   data: { unit: 'k', root: { name: 'budget', children: [
 *     { name: 'people', children: [{ name: 'eng', value: 420 }, { name: 'ops', value: 90 }] },
 *     { name: 'cloud', value: 180 },
 *   ] } },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'sunburst' : id);
  const heading = String(title == null ? 'Sunburst' : title);
  const read = readTree(data);

  /* The ring choices are the levels that actually exist, capped at eight: offering a tenth ring on
     a two-level hierarchy is a control that does nothing, which is worse than no control. */
  const deepest = Math.max(1, Math.min(8, read.stats.maxDepth));
  const depths = [];
  for (let i = 1; i <= deepest; i++) depths.push(i);

  const cfg = settle(data && typeof data === 'object' ? data.settings : null, depths);
  const built = buildVariants(read, depths, cfg.depth);
  const seedKey = built.variants[built.def] ? built.def : built.order[0];
  const seed = built.variants[seedKey];
  const note = { aria: seed.aria, caption: seed.cap };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      title: heading,
      settings: cfg,
      leaves: read.stats.leaves,
      branches: read.stats.branches,
      total: read.root ? read.root.value : 0,
    },
    html: cardHtml(cardId, heading, read, seed, note, built, cfg),
    css: cardCss(cardId),
    js: cardJs(cardId, { v: built.variants, def: seedKey }, cfg),
  };
}

export default { meta, defaults, build, guardEmitted, span, arcMark, layout, readTree };
