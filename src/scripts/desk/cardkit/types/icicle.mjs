/**
 * @file cardkit card type: `icicle` — the same partition `sunburst` draws radially, drawn straight:
 * one band per level, each level cut into its children in proportion to their value.
 *
 * Why both exist. A sunburst spends its outer rings' extra circumference on the deepest, smallest
 * nodes, which is generous to exactly the parts a reader can least use, and it makes two wedges at
 * different radii hard to compare because equal values look bigger further out. An icicle gives
 * every level the same run of pixels, so a node at depth 5 and a node at depth 1 with the same value
 * are the same length, and a name has a horizontal box to sit in rather than a curved sliver. What
 * it gives up is compactness: a wide hierarchy is a wide picture, where a sunburst is always square.
 *
 * The arithmetic worth reading before changing anything: each child's end is its own start plus its
 * share, EXCEPT the last, which is handed its parent's end exactly. Float drift then lands on
 * nothing — children tile their parent to the bit, the first level closes exactly on the full width,
 * and no band can disagree with the percentage in its tooltip. Divide each child independently and
 * the level ends a few ulps short of the edge, which is a hairline of background showing through
 * forever at the right-hand end of every row.
 *
 * @see ./sunburst.mjs — the same partition, bent around a circle
 * @see ./treemap.mjs  — the same data, area rather than length
 * @see ../CONTRACT.md — `shape` is a string, `defaults` is an object, both honoured below
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
 * @example loadKit().hue(2);   // 'var(--ck-s3)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/icicle: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/icicle: kit.js no longer defines window.CK');
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
 * inside a character class starts blanking actual code — a far worse failure than the one it is
 * there to prevent.
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
 * @example guardEmitted('var a = 1;', 'icicle');   // 'var a = 1;'
 */
export function guardEmitted(src, where) {
  const tag = 'cardkit/' + (where || 'icicle') + ': emitted js ';

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

/** A printable path separator; a visible separator is checkable in a way an invisible one is not. */
const SEP = ' \u203a ';

/** Width in px of a string set in the plot's mono face at `size`. */
function textW(s, size) { return String(s).length * CHW * ((size || TXT) / TXT); }

/**
 * What a band's label may say, given the room it has.
 *
 * Nothing ever overflows its band. A label that fits whole is drawn in both label modes; one that
 * only fits truncated is drawn with its tail marked and only in `all`; one with room for fewer than
 * three characters is dropped, because two characters and an ellipsis identify nothing. Every
 * dropped or shortened name is still in the band's tooltip, and every top-level name is in the
 * legend.
 *
 * @param text the label
 * @param boxW usable width in px, already net of any inset
 * @param boxH usable height in px; one line needs its font size plus two
 * @returns `{ text, lm }` with `lm` 0 for a whole label and 1 for a truncated one, or null
 *
 * @example labelFor('storage', 60, 12);   // { text: 'storage', lm: 0 }
 * @example labelFor('storage', 25, 12);   // { text: 'stor\u2026', lm: 1 }
 * @example labelFor('storage', 60, 6);    // null
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
 * `<` and `>` become escapes so a name cannot close the script element early — and, usefully, so no
 * name can put an arrow function into a file that is contractually free of them.
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
 * @throws {Error} when `v` is NaN or infinite
 * @example n2(12.3456, 'band');   // 12.35
 */
function n2(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/icicle: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/* ── reading the hierarchy ───────────────────────────────────────────────────────────────── */

/* A parent with more children than this folds its smallest into one bucket carrying their sum, so
   the parent's run of pixels is unchanged and no share is lost. */
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
 * Numeric strings are accepted because hierarchies routinely arrive from exports where every value
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
 * - **A branch's length is the sum of its children.** When a branch also declares a value and the
 *   two disagree, the children win and the disagreement is named. A band is cut into its children,
 *   so if the parent's length came from the declared number the parts would not fill it.
 * - **A negative value is refused**, counted, and drawn as nothing: a band cannot have negative
 *   length, and one that ran backwards would sit on top of its neighbour.
 * - **A non-numeric value is refused** the same way and counted separately.
 * - **Zero is kept and drawn as nothing**, which is what a zero-length band is, and counted.
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

/* ── the partition ───────────────────────────────────────────────────────────────────────── */

/* One fixed column width, so the picture never widens past the desk column and never needs to
   scroll sideways. Depth divides the width in `right` and the height in `down`. */
const W0 = 640;
const H_RIGHT = 320;
const ROW = 34;

/**
 * Give a parent's children start and end positions that exactly tile the parent.
 *
 * The last child is handed the parent's own end rather than its computed one, so every float error
 * in the division lands on nothing. Divide each child independently and the level ends a few ulps
 * short of the edge — a hairline of background at the end of every row, forever, in a picture whose
 * whole claim is that the parts fill the whole.
 *
 * @param kids  children with non-negative values
 * @param total their parent's value, which is their sum
 * @param p0    the parent's start position along the value axis
 * @param p1    the parent's end position
 * @returns one `{ node, p0, p1 }` per child, in the given order
 *
 * @example span([{ value: 1 }, { value: 3 }], 4, 0, 100)[1].p1;   // 100
 */
function span(kids, total, p0, p1) {
  const out = [];
  if (!(total > 0)) return out;
  const width = p1 - p0;
  let at = p0;
  for (let i = 0; i < kids.length; i++) {
    const w = (kids[i].value / total) * width;
    const end = i === kids.length - 1 ? p1 : at + w;
    out.push({ node: kids[i], p0: at, p1: end });
    at = end;
  }
  return out;
}

/**
 * Lay one icicle out: the display list, the label tally and the closure measurement.
 *
 * `depth` levels of children are drawn beneath the root's own band, so the picture always shows the
 * whole and then its parts. Every level gets the same band thickness, which is the point of the
 * form: a node's length means the same thing wherever it sits, and two nodes at different depths
 * can be compared directly.
 *
 * @param read from {@link readTree}
 * @param opt  `{ depth, orient }` — `orient` is `down` or `right`
 * @returns `{ marks, W, H, drawn, fitLabels, allLabels, droppedLabels, closure }`
 *
 * @example layout(readTree(data), { depth: 2, orient: 'down' }).H;   // 102
 */
function layout(read, opt) {
  const down = opt.orient !== 'right';
  const levels = Math.max(1, opt.depth) + 1;
  const marks = [];
  const out = {
    marks, drawn: 0, fitLabels: 0, allLabels: 0, droppedLabels: 0, closure: 0, top: [],
    W: W0, H: down ? levels * ROW : H_RIGHT,
  };

  const band = down ? ROW : W0 / levels;
  const root = read.root;
  if (!root || !(root.value > 0)) return out;

  const total = root.value;
  const unit = read.unit ? ' ' + read.unit : '';
  const axis = down ? W0 : H_RIGHT;

  const walk = (node, p0, p1, topIx, sibIx) => {
    const lvl = node.depth;
    const near = lvl * band;
    const far = near + band - 1;

    const rect = down
      ? { x: p0, y: near, w: Math.max(0, p1 - p0 - 0.6), h: Math.max(0, band - 1) }
      : { x: near, y: p0, w: Math.max(0, band - 1), h: Math.max(0, p1 - p0 - 0.6) };

    const share = (node.value / total) * 100;
    const tip = (node.path || node.name || '(root)') + ' \u00b7 ' + CK.fmt(node.value) + unit +
                ' \u00b7 ' + share.toFixed(share < 1 ? 2 : 1) + '%';

    if (rect.w > 0 && rect.h > 0) {
      out.drawn++;
      marks.push({
        t: 'rect',
        a: {
          x: n2(rect.x, 'band'), y: n2(rect.y, 'band'),
          width: n2(rect.w, 'band'), height: n2(rect.h, 'band'),
          fill: lvl === 0 ? 'var(--well)' : CK.hue(hueIndex(node, topIx, sibIx, read.colorBy)),
          'fill-opacity': lvl === 0 ? '1' : String(Math.max(0.55, 0.92 - (lvl - 1) * 0.07)),
          class: 'ck-ic-band', 'data-d': String(lvl),
        },
        ti: tip,
      });

      const inW = rect.w - 6;
      const inH = rect.h - 4;
      const withVal = node.name + '  ' + CK.fmt(node.value) + unit;
      let lab = textW(withVal) <= inW && inH >= TXT + 2 ? { text: withVal, lm: 0 } : null;
      if (!lab) lab = labelFor(node.name || '(root)', inW, inH);

      if (lab) {
        if (lab.lm === 0) out.fitLabels++;
        out.allLabels++;
        marks.push({
          t: 'text', lm: lab.lm,
          a: {
            x: n2(rect.x + 3, 'lab'), y: n2(rect.y + rect.h / 2, 'lab'),
            class: lvl === 0 ? 'ck-ic-root' : 'ck-ic-lab',
            'dominant-baseline': 'central',
          },
          s: lab.text,
        });
      } else {
        out.droppedLabels++;
      }
    }

    if (lvl >= levels - 1) return;
    const kids = node.children.filter((c) => c.value > 0);
    if (!kids.length) return;
    span(kids, node.value, p0, p1).forEach((L, i) => {
      const ix = lvl === 0 ? i : topIx;
      if (lvl === 0) out.top.push(L);
      walk(L.node, L.p0, L.p1, ix, i);
    });
  };

  walk(root, 0, axis, -1, 0);

  /* What the first level actually closed to. Measured rather than assumed: the whole point of the
     last-child-takes-the-remainder rule is that this is zero to the bit. */
  let sum = 0;
  for (const t of out.top) sum += t.p1 - t.p0;
  out.closure = out.top.length ? Math.abs(sum - axis) : 0;
  out.axis = axis;

  return out;
}

/* ── saying what the picture shows ───────────────────────────────────────────────────────── */

/** A count with its noun pluralised the boring, correct way. */
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/**
 * Everything the card refused, folded, or found inconsistent, as one escaped clause.
 *
 * Kept separate from {@link describe} because it is the same list whatever the picture looks like,
 * and because it must never quietly go missing: a partition that dropped a negative value without
 * saying so has told the reader the whole is smaller than it is.
 */
function refusals(read) {
  const st = read.stats;
  const e = CK.esc;
  const bits = [];

  if (st.negatives) {
    bits.push('<b>' + e(plural(st.negatives, 'negative value')) + '</b> refused &mdash; a band ' +
              'cannot have negative length, so those nodes count as zero');
  }
  if (st.unreadable) {
    bits.push('<b>' + e(plural(st.unreadable, 'value')) + '</b> were not a number and count as zero');
  }
  if (st.zeros) bits.push(e(plural(st.zeros, 'leaf', 'leaves')) + ' are zero and take no length');
  if (st.mismatches.length) {
    const m = st.mismatches[0];
    bits.push('<b>' + e(plural(st.mismatches.length, 'branch', 'branches')) +
              '</b> declare a total that disagrees with their children &mdash; ' + e(m.path) +
              ' says ' + e(CK.fmt(m.declared)) + ' but its children sum to ' + e(CK.fmt(m.sum)) +
              '; the children win, because they have to fill the band exactly');
  }
  if (st.folded) {
    bits.push(e(String(st.folded)) + ' of the smallest siblings past ' + MAX_CHILDREN +
              ' were folded into one band carrying their sum, so no length was lost');
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
 * it; "icicle chart" alone names the genre and withholds the content.
 */
function describe(read, L, opt) {
  const st = read.stats;
  const root = read.root;
  const unit = read.unit ? ' ' + read.unit : '';
  const e = CK.esc;
  const dir = opt.orient === 'right' ? 'rightward' : 'downward';

  if (!root) {
    return {
      aria: 'Icicle chart with no hierarchy: nothing is drawn.',
      caption: 'an icicle with <b>no hierarchy</b> &mdash; the card keeps its place on the desk, ' +
               'but there is no whole to divide.',
    };
  }
  if (!(root.value > 0)) {
    return {
      aria: 'Icicle chart whose values total zero, so no band has any length.',
      caption: 'the hierarchy totals <b>zero</b>, so no band has a length to take. ' + refusals(read),
    };
  }

  let big = null;
  for (const t of L.top) if (!big || t.node.value > big.node.value) big = t;
  const bigShare = big ? (big.node.value / root.value) * 100 : 0;

  const aria =
    'Icicle chart of ' + plural(st.leaves, 'leaf', 'leaves') + ' under ' +
    plural(st.branches, 'branch', 'branches') + ', totalling ' + CK.fmt(root.value) + unit +
    '. Depth runs ' + dir + '; length is value. ' + L.drawn + ' bands are drawn. ' +
    (big ? 'The largest top-level share is ' + (big.node.name || 'unnamed') + ' at ' +
           bigShare.toFixed(1) + ' percent.' : '');

  const caption =
    '<b>' + e(String(L.drawn)) + '</b> band' + (L.drawn === 1 ? '' : 's') + ' &mdash; depth runs <i>' +
    e(dir) + '</i>, length is value, and every level gets the same thickness so a node at depth 5 ' +
    'and one at depth 1 with the same value are the same length. ' +
    e(plural(st.leaves, 'leaf', 'leaves')) + ' under ' + e(plural(st.branches, 'branch', 'branches')) +
    ', totalling <b>' + e(CK.fmt(root.value) + unit) + '</b>. ' +
    (big ? 'the largest top-level share is <b>' + e(big.node.name || 'unnamed') + '</b> at ' +
           e(bigShare.toFixed(1)) + '%. ' : '') +

    '<span class="ck-aside">' + e(L.fitLabels + ' of ' + (L.allLabels + L.droppedLabels)) +
    ' bands hold their name whole, ' + e(String(L.allLabels - L.fitLabels)) + ' hold it truncated ' +
    'with an ellipsis, and ' + e(String(L.droppedLabels)) + ' hold none. nothing is drawn outside ' +
    'its band &mdash; a band with room for fewer than three characters gets no text, and every name ' +
    'is in the tooltip either way. the first level fills the axis to within ' +
    e(L.closure.toExponential(0)) + ' px.</span> ' +

    refusals(read);

  return { aria: aria.trim(), caption: caption.trim() };
}

/* ── variants ────────────────────────────────────────────────────────────────────────────── */

/** Every setting this card understands, with the value that stands when nothing is stored. */
const DEFAULTS = { orient: 'down', depth: 4, labels: 'fit' };

/** The two directions depth can run. */
const ORIENTS = ['down', 'right'];

/** The label modes. `fit` draws only whole labels; `all` adds truncated ones; `none` draws none. */
const LABEL_MODES = ['all', 'fit', 'none'];

/* Total marks across every precomputed variant. Every card's script is concatenated into one inline
   block, so a wide hierarchy times sixteen combinations is most of a megabyte. Past this the card
   stops enumerating, and the panel then offers only the combinations that exist rather than
   controls that silently do nothing. */
const MARK_BUDGET = 2600;

/**
 * Lay the icicle out once per orientation and depth, within a size budget.
 *
 * Both change geometry, so each pair is its own layout. `labels` does not: every label was already
 * resolved into a mark carrying whether it fits whole, so the mode is a filter and a settings
 * change is a repaint.
 *
 * The build order is an axis order rather than a distance order: both orientations at the card's
 * own depth first, then every depth in the card's own orientation, then the rest. What survives a
 * budget cut is a cross through the defaults, which is exactly what the two selects can navigate.
 *
 * @returns `{ variants, order, def, orients, depths, skipped }`
 */
function buildVariants(read, depths, cfg) {
  const depthOrder = depths.slice().sort((a, b) =>
    (Math.abs(a - cfg.depth) - Math.abs(b - cfg.depth)) || (a - b));

  const wanted = [];
  const seen = new Set();
  const want = (o, d) => {
    const k = o + '|' + d;
    if (seen.has(k)) return;
    seen.add(k);
    wanted.push({ o, d, k });
  };
  want(cfg.orient, cfg.depth);
  for (const o of ORIENTS) want(o, cfg.depth);
  for (const d of depthOrder) want(cfg.orient, d);
  for (const o of ORIENTS) for (const d of depthOrder) want(o, d);

  const variants = {};
  const order = [];
  let used = 0;
  let skipped = 0;

  for (const w of wanted) {
    if (used > MARK_BUDGET && order.length) { skipped++; continue; }
    const L = layout(read, { depth: w.d, orient: w.o });
    const note = describe(read, L, { depth: w.d, orient: w.o });
    variants[w.k] = { W: L.W, H: L.H, marks: L.marks, cap: note.caption, aria: note.aria };
    order.push(w.k);
    used += L.marks.length;
  }

  return {
    variants, order, skipped,
    def: cfg.orient + '|' + cfg.depth,
    orients: ORIENTS.filter((o) => variants[o + '|' + cfg.depth]),
    depths: depths.filter((d) => variants[cfg.orient + '|' + d]),
  };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────────── */

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-icicle[data-card="' + id + '"]';
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
 * Band labels sit on a coloured fill, so they take `--ground`: the series palette is light in the
 * dark theme and dark in the light one, which is exactly the inversion the page background already
 * is. `--ink` would be invisible in precisely one of the two themes. The root band is `--well`
 * instead of a series colour, so it reads as the container rather than as another part.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-ic-band', 'stroke: none;'],
    ['.ck-plot text', 'pointer-events: none;'],
    ['.ck-plot .ck-ic-lab', 'fill: var(--ground); font-weight: 700;'],
    ['.ck-plot .ck-ic-root', 'fill: var(--ink-dim); letter-spacing: .04em;'],

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

  const foot = 'Every level is the same thickness, so a length means the same thing at any depth. ' +
    'Running depth to the right gives names a wide box to sit in; running it down gives the values ' +
    'the full width of the card.' +
    (built.skipped
      ? ' This hierarchy is large, so only the combinations listed here were laid out.'
      : '');

  return '<section data-card="' + CK.esc(id) + '" class="ck-icicle">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="icicle settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('orient') + '">depth runs</label>\n' +
    '    ' + sel('orient', built.orients, cfg.orient, (v) => (v === 'down' ? 'downward' : 'rightward')) + '\n' +
    '    <label for="' + f('depth') + '">levels</label>\n' +
    '    ' + sel('depth', built.depths, cfg.depth) + '\n' +
    '    <label for="' + f('labels') + '">labels</label>\n' +
    '    ' + sel('labels', LABEL_MODES, cfg.labels,
                 (v) => (v === 'fit' ? 'only where they fit' : v === 'all' ? 'all, truncated' : 'none')) + '\n' +
    '    <p class="ck-set-foot">' + CK.esc(foot) + '</p>\n' +
    '  </div>\n' +
    '  <svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '"' +
       ' aria-label="' + CK.esc(note.aria) + '">' + svgInner(seed.marks, cfg.labels) + '</svg>\n' +
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
  L.push('/* icicle card: paints a display list that was laid out when the card was built.');
  L.push('   The partition, every band, every label decision and the caption were settled in Node,');
  L.push('   so this turns descriptions into elements and does not know what a hierarchy is. */');
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
  L.push('     stays a translator rather than a second place where icicle decisions live. */');
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
  L.push('  /* A select hands back a string, so a stored level count of 4 and a default of 4 are a');
  L.push('     string and a number. Every lookup is built from String() so the two cannot disagree. */');
  L.push('  function keyOf(cfg) {');
  L.push('    var o = cfg.orient === "right" ? "right" : "down";');
  L.push('    var k = o + "|" + String(cfg.depth);');
  L.push('    return P.v[k] ? k : P.def;');
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
  L.push('    /* The caption is markup escaped value by value in Node; nothing from the data');
  L.push('       reaches it unescaped, which is why it may be assigned rather than built. */');
  L.push('    if (cap) { cap.innerHTML = V.cap; }');
  L.push('  }');
  L.push('');
  L.push('  CK.settings(sec, DEFAULTS, render);');
  L.push('});');
  return guardEmitted(L.join('\n') + '\n', 'icicle');
}

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * @example meta.name;   // 'icicle'
 */
export const meta = {
  name: 'icicle',
  summary: 'A hierarchy as stacked bands: one level per band, each cut into its children by value.',
  shape: "{ root: { name, value, children: [...] }, unit, colorBy: 'branch' | 'depth' | 'index' | 'name' } — " +
         'a leaf carries a value; a branch takes the sum of its children, and a branch that declares ' +
         'a different total is named in the caption rather than silently believed',
  defaults: { ...DEFAULTS },
};

/**
 * Every setting this card understands, exported beside `meta.defaults` so a validator can check the
 * emitted panel's field names without building a card first.
 *
 * @example defaults.orient;   // 'down'
 */
export const defaults = { ...DEFAULTS };

/**
 * Fold a caller's seed onto the defaults, coercing rather than refusing.
 *
 * @example settle({ orient: 'sideways' }, [1, 2]).orient;   // 'down'
 */
function settle(seed, depths) {
  const out = { ...DEFAULTS };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  if (!ORIENTS.includes(out.orient)) out.orient = DEFAULTS.orient;
  if (!LABEL_MODES.includes(out.labels)) out.labels = DEFAULTS.labels;
  const d = Number(out.depth);
  out.depth = depths.includes(d) ? d : (depths.includes(DEFAULTS.depth) ? DEFAULTS.depth : depths[depths.length - 1]);
  return out;
}

/**
 * Build one icicle card from one hierarchy.
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
 *   id: 'calls',
 *   title: 'where the time went',
 *   data: { unit: 'ms', root: { name: 'request', children: [
 *     { name: 'db', children: [{ name: 'query', value: 41 }, { name: 'pool', value: 4 }] },
 *     { name: 'render', value: 18 },
 *   ] } },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'icicle' : id);
  const heading = String(title == null ? 'Icicle' : title);
  const read = readTree(data);

  /* The level choices are the levels that actually exist, capped at eight: offering a tenth level
     on a two-level hierarchy is a control that does nothing, which is worse than no control. */
  const deepest = Math.max(1, Math.min(8, read.stats.maxDepth));
  const depths = [];
  for (let i = 1; i <= deepest; i++) depths.push(i);

  const cfg = settle(data && typeof data === 'object' ? data.settings : null, depths);
  const built = buildVariants(read, depths, cfg);
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

export default { meta, defaults, build, guardEmitted, span, layout, readTree };
