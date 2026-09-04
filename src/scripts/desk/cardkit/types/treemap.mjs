/**
 * @file cardkit card type: `treemap` — a hierarchy as nested rectangles whose AREA is their value,
 * laid out by the squarified algorithm of Bruls, Huizing and van Wijk (2000).
 *
 * Why squarified and not slice-and-dice, which is four lines shorter and always correct in the
 * arithmetic sense: a treemap makes exactly one claim, that area is proportional to value, and a
 * reader can only cash that claim in if the shapes are comparable. Slice-and-dice cuts every level
 * along a single axis, so a level with thirty children produces thirty slivers one pixel wide and
 * three hundred tall. Those slivers have the right area and are unreadable — nobody can compare a
 * 1x300 to a 3x100 by eye, and the aspect ratio is what destroys it. Squarified greedily fills
 * strips, keeping each row's worst aspect ratio as close to 1 as the values allow. Both ratios are
 * measured here and both are printed in the caption, so the claim is checkable rather than asserted.
 *
 * Everything geometric is computed in Node and the browser is handed a display list. The settings
 * that change geometry — `depth` and `padding` — are enumerated at build time, one layout each, so
 * a settings change is a repaint and never a second implementation of the algorithm.
 *
 * @see ./chart.mjs     — the display-list model and the `kit.js`-in-a-vm trick, adopted here
 * @see ./icicle.mjs    — the same partition drawn as stacked bands rather than nested boxes
 * @see ./sunburst.mjs  — the same partition drawn radially
 * @see ../CONTRACT.md  — `shape` is a string, `defaults` is an object, both honoured below
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so build-time drawing and browser-time drawing
 * come from one implementation rather than two that drift.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be imported.
 * Its top level defines only functions and one array, and nothing reaches for `document` until a
 * DOM-bound function is called — none of which this file calls.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().hue(0);   // 'var(--ck-s1)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/treemap: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/treemap: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── the build-time guard ────────────────────────────────────────────────────────────────── */

/**
 * Blank comment and string bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose — a sibling card was
 * once refused because a comment said "the class is what CSS reads". Offsets survive so a reported
 * position still means something, and regex literals are recognised, because a scanner that
 * desyncs on the quote inside `replace(/'/g, x)` starts blanking real code, turning a false
 * positive into a far worse false negative.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment, string and regex bodies replaced by spaces
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
 * stray backtick is a parse error that blanks every card on the page. The backtick case is the one
 * that keeps happening because it hides inside a comment: comments ship, and a backtick around a
 * word in a doc comment closes the surrounding template literal early.
 *
 * Backtick, `=>` and `?.` are scanned raw, because none of them can appear innocently in this
 * card's output. `const`, `let` and `class` are scanned only after comment and string bodies are
 * blanked, because they appear in English constantly and a guard that cries wolf gets deleted.
 * Control characters are compared numerically rather than matched against a character class, since
 * writing the class is how the class gets corrupted.
 *
 * @param src   the emitted script
 * @param where a label for the message, naming which card produced it
 * @returns `src` unchanged, so the guard can wrap the value on its way out
 * @throws {Error} naming the violation, its offset, and the source around it
 *
 * @example guardEmitted('var a = 1;', 'treemap');            // 'var a = 1;'
 * @example guardEmitted('var f = function(){};//' , 'x');    // returns; a comment is not code
 */
export function guardEmitted(src, where) {
  const tag = 'cardkit/' + (where || 'treemap') + ': emitted js ';

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

/* Metrics for the 9px monospace that `.ck-plot text` sets in kit.css, measured rather than
   guessed and taken from `chart.mjs` so two cards on one desk agree about what fits. Being half a
   pixel pessimistic drops a label that would just have fitted, which is the safe way to be wrong. */
const CHW = 5.42;
const TXT = 9;

/** The horizontal ellipsis, written as an escape so no literal can be mistyped into the source. */
const ELL = '\u2026';

/** A printable path separator. A visible separator is checkable in a way an invisible one is not. */
const SEP = ' \u203a ';

/** Width in px of a string set in the plot's mono face at `size`. */
function textW(s, size) { return String(s).length * CHW * ((size || TXT) / TXT); }

/**
 * What a shape's label may say, given the room it has.
 *
 * This is the whole answer to "labels that do not fit": nothing ever overflows its shape. A label
 * that fits whole is drawn in both label modes; one that only fits truncated is drawn with its tail
 * marked and only in `all`; one that cannot show three characters is not drawn at all, because two
 * characters and an ellipsis identify nothing. Every dropped label is still in the shape's tooltip
 * and, for a top-level branch, in the legend.
 *
 * @param text the label
 * @param boxW usable width in px, already net of any inset
 * @param boxH usable height in px; a line needs its font size plus two
 * @param size font size, defaulting to the plot's 9px
 * @returns `{ text, lm }` where `lm` is 0 for a whole label and 1 for a truncated one, or null
 *
 * @example labelFor('storage', 60, 12);   // { text: 'storage', lm: 0 }
 * @example labelFor('storage', 25, 12);   // { text: 'stor\u2026', lm: 1 }
 * @example labelFor('storage', 8, 12);    // null
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
 * Serialise a value as a JavaScript literal that is safe inside a classic `<script>` element.
 *
 * `<` becomes an escape so a string containing a closing script tag cannot end the block early;
 * `>` goes with it, which has the useful side effect that no node name can ever put an arrow
 * function into a file that is contractually free of them. Backticks go too, and the two line
 * separators, which are newlines to a JS parser and not to `JSON.stringify`.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsonLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A NaN in an attribute is silent: the browser drops the whole shape and the card renders empty
 * with nothing in the console. Failing at build time turns that into a stack trace beside the input
 * that caused it.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n2(12.3456, 'rect');   // 12.35
 */
function n2(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/treemap: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/* ── reading the hierarchy ───────────────────────────────────────────────────────────────── */

/* A parent with more children than this folds its smallest into one bucket, because a thousand
   sibling rectangles in a 640px box are sub-pixel and the fold at least keeps the total area
   honest — the bucket carries the sum of what it replaced. */
const MAX_CHILDREN = 1000;

/* A hard ceiling on nodes read, so a pathological descriptor cannot make the build hang. Nodes past
   it are dropped depth-first and counted, and the count is printed. */
const MAX_NODES = 6000;

/* A defensive recursion limit. `depth: 10` is a supported case; thirty-two is not a hierarchy. */
const HARD_DEPTH = 32;

/**
 * A finite number from an untrusted field, accepting a numeric string.
 *
 * Numeric strings are accepted because hierarchies routinely arrive from CSV and JSON exports where
 * every value is quoted. Everything else — null, an empty string, an object, a boolean, `NaN` —
 * is refused rather than coerced, because `Number([])` is 0 and a silent zero is a lie about area.
 *
 * @example numOrNull('12.5');   // 12.5
 * @example numOrNull('');       // null
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

/** Two values agree if they are within a relative epsilon; a declared branch total is float data. */
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
 *   two disagree, the children win and the disagreement is named. A rectangle is subdivided into
 *   its children, so if the parent's area came from the declared number the parts would not fill
 *   the whole and the picture would be lying about the very thing it is for.
 * - **A negative value is refused, not drawn.** An area cannot be negative; there is no honest
 *   rectangle for -5. The node is kept with a value of zero and the refusals are counted.
 * - **A non-numeric value is refused the same way**, and counted separately, because "this field
 *   was text" and "this field was minus five" are different problems for whoever wrote the data.
 * - **Zero is kept and drawn as nothing**, which is what zero area is, and counted.
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
    mismatches: [], folded: 0, dropped: 0, cyclic: 0, maxDepth: 0, count: 0,
    dupNames: 0,
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

    /* The fold keeps the largest children and sums the rest into one node, so the parent's value
       and therefore its area are unchanged. Dropping the tail instead would shrink the parent and
       silently rescale every one of its siblings. */
    if (children.length > MAX_CHILDREN) {
      children.sort((a, b) => b.value - a.value);
      const kept = children.slice(0, MAX_CHILDREN - 1);
      const rest = children.slice(MAX_CHILDREN - 1);
      const sum = rest.reduce((a, b) => a + b.value, 0);
      stats.folded += rest.length;
      kept.push({
        name: rest.length + ' smaller', value: sum, children: [], depth: depth + 1,
        path: here + SEP + rest.length + ' smaller', synthetic: true, kidsDeclared: 0,
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

    return { name, value, children, depth, path: here, synthetic: false, kidsDeclared: kidsRaw.length };
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

/** How a node's colour is chosen. `branch` groups by the top-level ancestor, which is the useful one. */
const COLOR_BY = ['branch', 'depth', 'index', 'name'];

/** A small stable hash, so `colorBy: 'name'` gives the same colour to the same name every build. */
function hashName(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000007;
  return h;
}

/**
 * The palette index for one node under one colouring rule.
 *
 * @param node  the node
 * @param topIx the index of its depth-1 ancestor, or -1 when it is the root
 * @param sibIx its index among its siblings
 *
 * @example hueIndex({ depth: 2, name: 'x' }, 3, 0, 'branch');   // 3
 */
function hueIndex(node, topIx, sibIx, how) {
  if (how === 'depth') return node.depth;
  if (how === 'index') return sibIx;
  if (how === 'name') return hashName(node.name);
  return topIx < 0 ? 0 : topIx;
}

/* ── squarified layout ───────────────────────────────────────────────────────────────────── */

/**
 * The worst aspect ratio in a candidate row, as the squarified paper defines it.
 *
 * With `side` the length of the strip the row is being laid along and `sum` the row's total area,
 * the row is `sum / side` thick, so an item of area `a` is `a / (sum / side)` long and its ratio is
 * either `side * side * max / (sum * sum)` or its reciprocal form. Taking the max of the two
 * closed forms is the paper's `worst`, and it is what the greedy accept/reject test compares.
 *
 * @param areas the row's item areas, all strictly positive
 * @param sum   their total
 * @param side  the strip length, which is the shorter side of the remaining box
 * @returns the worst ratio, at least 1, or Infinity when the row cannot be laid out
 *
 * @example worstRatio([4, 4], 8, 4);   // 2
 */
function worstRatio(areas, sum, side) {
  if (!(sum > 0) || !(side > 0)) return Infinity;
  let mx = -Infinity;
  let mn = Infinity;
  for (const a of areas) { if (a > mx) mx = a; if (a < mn) mn = a; }
  if (!(mn > 0)) return Infinity;
  const s2 = sum * sum;
  const w2 = side * side;
  return Math.max((w2 * mx) / s2, s2 / (w2 * mn));
}

/**
 * Lay a set of valued items out inside a box so that every item's area is proportional to its
 * value and the shapes are as close to square as the values allow.
 *
 * This is Bruls, Huizing and van Wijk's squarified treemap. Items are taken largest first; a row is
 * grown along the shorter side of the remaining box for as long as adding the next item does not
 * make the row's worst aspect ratio worse; then the row is fixed, the box shrinks by the row's
 * thickness, and the next row starts. Greedy, one pass, and the only arithmetic that matters is
 * {@link worstRatio}.
 *
 * The alternative — slice-and-dice, which simply cuts the box into one strip per item, alternating
 * direction by level — is shorter and produces exactly the same areas. It is still the wrong
 * answer: a level with thirty children becomes thirty one-pixel slivers, and a sliver's area cannot
 * be read or compared, which is the treemap's entire and only claim. {@link sliceDiceWorst}
 * computes what slice-and-dice would have reached on the same data, and the caption prints both.
 *
 * @param items a list of `{ node, value }` with strictly positive values
 * @param box   `{ x, y, w, h }` to fill; a box with no area lays nothing out
 * @returns one `{ node, x, y, w, h }` per item, exactly tiling the box
 *
 * @example squarify([{ node: 'a', value: 1 }, { node: 'b', value: 1 }], { x: 0, y: 0, w: 4, h: 2 })
 * // [{ node: 'a', x: 0, y: 0, w: 2, h: 2 }, { node: 'b', x: 2, y: 0, w: 2, h: 2 }]
 */
function squarify(items, box) {
  const out = [];
  let x = box.x;
  let y = box.y;
  let w = box.w;
  let h = box.h;

  let total = 0;
  for (const it of items) total += it.value;
  if (!(total > 0) || !(w > 0) || !(h > 0)) return out;

  const k = (w * h) / total;
  const queue = items
    .map((it, i) => ({ node: it.node, area: it.value * k, i }))
    .sort((a, b) => (b.area - a.area) || (a.i - b.i));

  let at = 0;
  while (at < queue.length) {
    const side = Math.min(w, h);
    if (!(side > 0)) break;

    const areas = [queue[at].area];
    let sum = queue[at].area;
    let j = at + 1;
    while (j < queue.length) {
      const grown = areas.concat([queue[j].area]);
      if (worstRatio(grown, sum + queue[j].area, side) <= worstRatio(areas, sum, side)) {
        areas.push(queue[j].area);
        sum += queue[j].area;
        j++;
      } else break;
    }

    if (w >= h) {
      /* The shorter side is vertical, so the row is a column of width `thick` down the left edge
         of what remains. The clamp only ever fires on float overrun at the last strip. */
      const thick = Math.min(sum / side, w);
      let cy = y;
      for (let q = 0; q < areas.length; q++) {
        const ih = thick > 0 ? areas[q] / thick : 0;
        out.push({ node: queue[at + q].node, x, y: cy, w: thick, h: ih });
        cy += ih;
      }
      x += thick;
      w -= thick;
    } else {
      const thick = Math.min(sum / side, h);
      let cx = x;
      for (let q = 0; q < areas.length; q++) {
        const iw = thick > 0 ? areas[q] / thick : 0;
        out.push({ node: queue[at + q].node, x: cx, y, w: iw, h: thick });
        cx += iw;
      }
      y += thick;
      h -= thick;
    }
    at += areas.length;
  }

  return out;
}

/**
 * The worst aspect ratio slice-and-dice would have produced on the same hierarchy.
 *
 * Not drawn — computed only so the caption's claim about slivers is a measurement rather than a
 * slogan. Slice-and-dice cuts each box into one strip per child, in the given order, alternating
 * between horizontal and vertical cuts by level.
 *
 * @param node    the subtree root
 * @param box     the box it fills
 * @param maxDepth how many levels are drawn, matching the real layout
 * @param vertical whether this level cuts vertically
 * @returns the worst ratio over the leaves that would have been drawn, or 0 when there are none
 *
 * @example sliceDiceWorst({ value: 2, children: [{ value: 1, children: [] }, { value: 1, children: [] }] }, { x: 0, y: 0, w: 100, h: 4 }, 4, true);   // 25
 */
function sliceDiceWorst(node, box, maxDepth, vertical) {
  if (!node || !(box.w > 0) || !(box.h > 0) || !(node.value > 0)) return 0;
  const kids = node.depth < maxDepth ? node.children.filter((c) => c.value > 0) : [];
  if (!kids.length) return Math.max(box.w / box.h, box.h / box.w);

  let worst = 0;
  let at = vertical ? box.x : box.y;
  for (const c of kids) {
    const share = c.value / node.value;
    const sub = vertical
      ? { x: at, y: box.y, w: box.w * share, h: box.h }
      : { x: box.x, y: at, w: box.w, h: box.h * share };
    at += vertical ? sub.w : sub.h;
    worst = Math.max(worst, sliceDiceWorst(c, sub, maxDepth, !vertical));
  }
  return worst;
}

/* ── the drawing ─────────────────────────────────────────────────────────────────────────── */

/* The desk column is comfortable at 640. The height is chosen so the default box is close to the
   golden-ish 1.7 that keeps a squarified layout's first row from being a single stripe. */
const W0 = 640;
const H0 = 380;

/* A branch that is tall and wide enough gets a header strip carrying its name. Below this it gets
   an outline and no text, because a clipped four-pixel-tall word is noise. */
const HEADER = 12;

/* The ceiling at which an aspect ratio stops being reported precisely. Past about a thousand to one
   the rectangle is a hairline either way, and the alternative is printing the word Infinity into a
   caption — which the desk's own conformance check rejects, correctly. */
const RATIO_CEIL = 9999;

/**
 * One laid-out treemap: the display list, the label tally and the aspect-ratio measurements.
 *
 * Padding is applied as an inset on every box before its children are laid out, so it separates
 * levels visually at a known cost: each rectangle pays a fixed border rather than a share of its
 * area, which is why the area-proportionality check runs at padding zero and says so.
 *
 * @param read from {@link readTree}
 * @param opt  `{ depth, pad }` — levels to draw, and the inset in px
 * @returns `{ marks, worst, sliced, drawn, fitLabels, allLabels, tiny }`
 *
 * @example layout(readTree(data), { depth: 2, pad: 0 }).marks.length;
 */
function layout(read, opt) {
  const marks = [];
  const root = read.root;
  const out = {
    marks, worst: 0, sliced: 0, drawn: 0, fitLabels: 0, allLabels: 0, tiny: 0,
    W: W0, H: H0,
  };
  if (!root || !(root.value > 0)) return out;

  const box = { x: 0.5, y: 0.5, w: W0 - 1, h: H0 - 1 };
  const total = root.value;
  const unit = read.unit ? ' ' + read.unit : '';

  const place = (node, rect, topIx, sibIx) => {
    const isBranch = node.children.length > 0 && node.depth < opt.depth;
    const share = total > 0 ? (node.value / total) * 100 : 0;
    const tip = (node.path || node.name || '(root)') + ' \u00b7 ' +
                CK.fmt(node.value) + unit + ' \u00b7 ' + share.toFixed(share < 1 ? 2 : 1) + '%';

    if (!isBranch) {
      /* A drawn leaf. Its aspect ratio is the number the caption reports, because it is the shape
         a reader is actually asked to compare. */
      if (!(rect.w > 0) || !(rect.h > 0)) { out.tiny++; return; }
      /* A rectangle whose short side has underflowed gives a ratio of Infinity, which would end up
         in the caption as the literal word. It is still a sliver and still the worst one, so it is
         counted at the reporting ceiling rather than dropped or printed. */
      const raw = Math.max(rect.w / rect.h, rect.h / rect.w);
      const ratio = Number.isFinite(raw) ? raw : RATIO_CEIL;
      if (ratio > out.worst) out.worst = Math.min(ratio, RATIO_CEIL);
      out.drawn++;

      marks.push({
        t: 'rect',
        a: {
          x: n2(rect.x, 'leaf'), y: n2(rect.y, 'leaf'),
          width: n2(Math.max(0, rect.w), 'leaf'), height: n2(Math.max(0, rect.h), 'leaf'),
          fill: CK.hue(hueIndex(node, topIx, sibIx, read.colorBy)),
          'fill-opacity': '0.88',
          class: 'ck-tm-leaf',
        },
        ti: tip,
      });

      const inW = rect.w - 6;
      const inH = rect.h - 4;
      const lab = labelFor(node.name, inW, inH);
      if (lab) {
        if (lab.lm === 0) out.fitLabels++;
        out.allLabels++;
        const two = inH >= TXT * 2 + 5 && textW(CK.fmt(node.value) + unit) <= inW;
        marks.push({
          t: 'text', lm: lab.lm,
          a: {
            x: n2(rect.x + rect.w / 2, 'lab'),
            y: n2(rect.y + rect.h / 2 + (two ? -1 : 3.2), 'lab'),
            class: 'ck-tm-lab', 'text-anchor': 'middle',
          },
          s: lab.text,
        });
        if (two) {
          marks.push({
            t: 'text', lm: lab.lm,
            a: {
              x: n2(rect.x + rect.w / 2, 'val'),
              y: n2(rect.y + rect.h / 2 + 9.5, 'val'),
              class: 'ck-tm-val', 'text-anchor': 'middle',
            },
            s: CK.fmt(node.value) + unit,
          });
        }
      }
      return;
    }

    /* A branch: an outline, an optional header, and its children inside what is left. */
    if (rect.w > 1 && rect.h > 1) {
      marks.push({
        t: 'rect',
        a: {
          x: n2(rect.x, 'br'), y: n2(rect.y, 'br'),
          width: n2(rect.w, 'br'), height: n2(rect.h, 'br'),
          class: 'ck-tm-br', 'data-d': String(node.depth),
        },
        ti: tip,
      });
    }

    let inner = {
      x: rect.x + opt.pad, y: rect.y + opt.pad,
      w: rect.w - opt.pad * 2, h: rect.h - opt.pad * 2,
    };

    const head = labelFor(node.name, inner.w - 6, HEADER);
    if (head && inner.h > HEADER + 8) {
      marks.push({
        t: 'text', lm: head.lm,
        a: {
          x: n2(inner.x + 3, 'hdr'), y: n2(inner.y + 9, 'hdr'),
          class: 'ck-tm-hdr', 'data-d': String(node.depth),
        },
        s: head.text,
      });
      if (head.lm === 0) out.fitLabels++;
      out.allLabels++;
      inner = { x: inner.x, y: inner.y + HEADER, w: inner.w, h: inner.h - HEADER };
    }

    const kids = node.children.filter((c) => c.value > 0);
    const laid = squarify(kids.map((c) => ({ node: c, value: c.value })), inner);
    laid.forEach((L, i) => {
      const ix = node.depth === 0 ? i : topIx;
      place(L.node, { x: L.x, y: L.y, w: L.w, h: L.h }, ix, i);
    });
  };

  place(root, box, -1, 0);
  out.sliced = sliceDiceWorst(root, box, opt.depth, true);
  return out;
}

/**
 * The same layout measured without padding or headers, purely to check the card's own claim.
 *
 * The claim a treemap makes is that area is proportional to value. Padding and a header strip both
 * take a fixed bite out of every rectangle, so with either of them switched on the claim holds only
 * up to that fixed cost. This runs the layout with both off, where the claim is exact, and returns
 * the observed spread of `area / value` so a test can assert on it.
 *
 * @param read from {@link readTree}
 * @param depth levels to draw
 * @returns `{ ratios, spread }` — one `area / value` per drawn leaf, and their relative spread
 *
 * @example areaCheck(readTree(data), 3).spread < 1e-9;   // true
 */
export function areaCheck(read, depth) {
  const ratios = [];
  const root = read.root;
  if (!root || !(root.value > 0)) return { ratios, spread: 0 };

  const walk = (node, rect) => {
    const isBranch = node.children.length > 0 && node.depth < depth;
    if (!isBranch) {
      if (node.value > 0) ratios.push((rect.w * rect.h) / node.value);
      return;
    }
    const kids = node.children.filter((c) => c.value > 0);
    for (const L of squarify(kids.map((c) => ({ node: c, value: c.value })), rect)) {
      walk(L.node, { x: L.x, y: L.y, w: L.w, h: L.h });
    }
  };

  walk(root, { x: 0, y: 0, w: W0, h: H0 });
  if (!ratios.length) return { ratios, spread: 0 };
  const lo = Math.min(...ratios);
  const hi = Math.max(...ratios);
  return { ratios, spread: lo > 0 ? (hi - lo) / lo : 0 };
}

/* ── saying what the picture shows ───────────────────────────────────────────────────────── */

/** A count with its noun pluralised the boring, correct way. */
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/**
 * The sentence a screen reader gets and the caption a sighted reader gets, per variant.
 *
 * `role="img"` hides the SVG's internals, so the aria label is the entire chart to anyone using it;
 * "treemap" alone names the genre and withholds the content, so this says what is in it, how much
 * of it there is, and where the largest piece is.
 *
 * The caption carries the two aspect ratios, because the choice of layout is the interesting claim
 * this card makes and a reader should be able to check it. It also carries every refusal: an area
 * chart that silently dropped a negative value would be a chart that is quietly wrong.
 *
 * @param read from {@link readTree}
 * @param L    from {@link layout}
 * @param opt  `{ depth, pad }`
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function describe(read, L, opt) {
  const st = read.stats;
  const root = read.root;
  const unit = read.unit ? ' ' + read.unit : '';
  const e = CK.esc;

  if (!root) {
    return {
      aria: 'Treemap with no hierarchy: nothing is drawn.',
      caption: 'a treemap with <b>no hierarchy</b> &mdash; the card keeps its place on the desk, ' +
               'but there is nothing to divide up.',
    };
  }
  if (!(root.value > 0)) {
    return {
      aria: 'Treemap whose values total zero, so no rectangle has any area.',
      caption: 'the hierarchy totals <b>zero</b>, so there is no area to divide. ' +
               refusals(read, true),
    };
  }

  let big = null;
  const seek = (node) => {
    const drawn = !(node.children.length && node.depth < opt.depth);
    if (drawn && (!big || node.value > big.value)) big = node;
    if (!drawn) for (const c of node.children) seek(c);
  };
  seek(root);

  const bigShare = big ? (big.value / root.value) * 100 : 0;
  const ratio = Number.isFinite(L.worst) && L.worst > 0 ? Math.min(L.worst, RATIO_CEIL).toFixed(1) : '1.0';
  const sliced = Number.isFinite(L.sliced) && L.sliced > 0 ? Math.min(L.sliced, RATIO_CEIL).toFixed(1) : '1.0';

  const aria =
    'Treemap of ' + plural(st.leaves, 'leaf', 'leaves') + ' under ' +
    plural(st.branches, 'branch', 'branches') + ', totalling ' + CK.fmt(root.value) + unit +
    '. ' + L.drawn + ' rectangles are drawn at ' + plural(opt.depth, 'level') + ' deep. ' +
    (big ? 'The largest is ' + (big.name || 'unnamed') + ' at ' + CK.fmt(big.value) + unit +
           ', ' + bigShare.toFixed(1) + ' percent of the whole.' : '');

  const caption =
    '<b>' + e(String(L.drawn)) + '</b> rectangle' + (L.drawn === 1 ? '' : 's') +
    ' &mdash; ' + e(plural(st.leaves, 'leaf', 'leaves')) + ' under ' +
    e(plural(st.branches, 'branch', 'branches')) + ', totalling <b>' + e(CK.fmt(root.value) + unit) +
    '</b>. ' +
    (big ? 'the largest is <b>' + e(big.name || 'unnamed') + '</b> at ' +
           e(bigShare.toFixed(1)) + '%. ' : '') +

    '<i>squarified</i> (Bruls, Huizing, van Wijk): the worst aspect ratio here is <b>' +
    e(ratio) + ':1</b>, against <b>' + e(sliced) + ':1</b> for slice-and-dice on the same data. ' +
    'that matters because area is the only claim a treemap makes, and a one-pixel sliver has an ' +
    'area nobody can read. ' +

    '<span class="ck-aside">' +
    e(L.fitLabels + ' of ' + L.allLabels) + ' labels fit whole; the rest are truncated with an ' +
    'ellipsis in <i>all</i> and hidden in <i>fit</i>. nothing is ever drawn outside its rectangle ' +
    '&mdash; a label with room for fewer than three characters is dropped, and every name is in ' +
    'the shape tooltip either way.</span> ' +

    refusals(read, false);

  return { aria: aria.trim(), caption: caption.trim() };
}

/**
 * Everything the card refused, folded, or found inconsistent, as one escaped clause.
 *
 * Kept separate from {@link describe} because it is the same list whatever the picture looks like,
 * and because it is the part that must never quietly go missing: a chart that drops a negative
 * value without saying so has told the reader the data is smaller than it is.
 *
 * @param read from {@link readTree}
 * @param bare true to omit the leading aside wrapper, for the empty case
 *
 * @example refusals({ stats: { negatives: 1, ... } }, false);
 */
function refusals(read, bare) {
  const st = read.stats;
  const e = CK.esc;
  const bits = [];

  if (st.negatives) {
    bits.push('<b>' + e(plural(st.negatives, 'negative value')) + '</b> refused &mdash; an area ' +
              'cannot be negative, so those nodes count as zero');
  }
  if (st.unreadable) {
    bits.push('<b>' + e(plural(st.unreadable, 'value')) + '</b> were not a number and count as zero');
  }
  if (st.zeros) bits.push(e(plural(st.zeros, 'leaf', 'leaves')) + ' are zero and take no area');
  if (st.mismatches.length) {
    const m = st.mismatches[0];
    bits.push('<b>' + e(plural(st.mismatches.length, 'branch', 'branches')) +
              '</b> declare a total that disagrees with their children &mdash; ' +
              e(m.path) + ' says ' + e(CK.fmt(m.declared)) + ' but its children sum to ' +
              e(CK.fmt(m.sum)) + '; the children win, because the parts have to fill the whole');
  }
  if (st.folded) {
    bits.push(e(String(st.folded)) + ' of the smallest siblings past ' + MAX_CHILDREN +
              ' were folded into one bucket carrying their sum, so no area was lost');
  }
  if (st.dropped) {
    bits.push(e(String(st.dropped)) + ' nodes past the ' + MAX_NODES + '-node ceiling were not read');
  }
  if (st.cyclic) bits.push(e(plural(st.cyclic, 'cycle')) + ' in the hierarchy cut');
  if (st.dupNames) {
    bits.push(e(plural(st.dupNames, 'name')) + ' appear on both a leaf and a branch; ' +
              'the tooltip carries the full path, which is the only thing that tells them apart');
  }

  if (!bits.length) return '';
  const body = bits.join('. ') + '.';
  return bare ? '<span class="ck-aside">' + body + '</span>' : '<span class="ck-aside">' + body + '</span>';
}

/* ── variants ────────────────────────────────────────────────────────────────────────────── */

/** The inset choices the gear offers. A select, not a free number, so the layouts stay enumerable. */
const PADS = [0, 1, 2, 4, 8];

/** Every setting this card understands, with the value that stands when nothing is stored. */
const DEFAULTS = { depth: 3, labels: 'fit', padding: 2 };

/** The label modes. `fit` draws only whole labels; `all` adds truncated ones; `none` draws none. */
const LABEL_MODES = ['all', 'fit', 'none'];

/* Total marks across every precomputed variant. A 500-leaf treemap is about 900 marks per layout,
   so the whole enumeration would be most of a megabyte of inline JSON — in a page where every
   card's script is concatenated into one block. Past this the gear offers fewer choices instead,
   and it offers only the ones that were actually built, so no control is ever a control that
   silently does nothing. */
const MARK_BUDGET = 1400;

/**
 * Lay the treemap out once per enumerable setting combination, within a size budget.
 *
 * `depth` and `padding` both change geometry, so each pair is a separate layout; `labels` does not,
 * because every label was already resolved into a mark carrying whether it fits whole.
 *
 * The build order is an axis order rather than a distance order, and that matters. Every padding is
 * tried at the card's own depth first, then every depth at the card's own padding, and only then
 * the rest of the grid. So when the budget runs out, what survives is a cross through the defaults
 * — which is exactly the set the two selects can navigate, one axis at a time. The panel is then
 * built from what exists rather than from what was hoped for.
 *
 * @param read   from {@link readTree}
 * @param depths the depth choices the hierarchy could support
 * @param cfg    the settled settings the card is built at
 * @returns `{ variants, order, def, pads, depths, skipped }`
 */
function buildVariants(read, depths, cfg) {
  const defPadIx = PADS.indexOf(cfg.padding);
  const padOrder = PADS.slice().sort((a, b) =>
    (Math.abs(PADS.indexOf(a) - defPadIx) - Math.abs(PADS.indexOf(b) - defPadIx)) || (a - b));
  const depthOrder = depths.slice().sort((a, b) =>
    (Math.abs(a - cfg.depth) - Math.abs(b - cfg.depth)) || (a - b));

  const wanted = [];
  const seen = new Set();
  const want = (d, p) => {
    const k = d + '|' + p;
    if (seen.has(k)) return;
    seen.add(k);
    wanted.push({ d, p, k });
  };
  for (const p of padOrder) want(cfg.depth, p);
  for (const d of depthOrder) want(d, cfg.padding);
  for (const d of depthOrder) for (const p of padOrder) want(d, p);

  const variants = {};
  const order = [];
  let used = 0;
  let skipped = 0;

  for (const w of wanted) {
    if (used > MARK_BUDGET && order.length) { skipped++; continue; }
    const L = layout(read, { depth: w.d, pad: w.p });
    const note = describe(read, L, { depth: w.d, pad: w.p });
    variants[w.k] = { W: L.W, H: L.H, marks: L.marks, cap: note.caption, aria: note.aria };
    order.push(w.k);
    used += L.marks.length;
  }

  return {
    variants, order, skipped,
    def: cfg.depth + '|' + cfg.padding,
    pads: PADS.filter((p) => variants[cfg.depth + '|' + p]),
    depths: depths.filter((d) => variants[d + '|' + cfg.padding]),
  };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────────── */

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-treemap[data-card="' + id + '"]';
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
 * Not one literal colour. The in-rectangle label is `--ground`, which is the inversion the series
 * palette needs: `--ck-s*` is light in the dark theme and dark in the light one, so text over a
 * swatch has to be the page's background colour in both. `--ink` would be invisible in exactly one
 * theme, which is the bug this rule exists to avoid.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-tm-leaf', 'stroke: none;'],
    ['.ck-tm-br', 'fill: none; stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-tm-br[data-d="0"], .ck-tm-br[data-d="1"]', 'stroke: var(--rule);'],

    ['.ck-plot text', 'pointer-events: none;'],
    ['.ck-plot .ck-tm-lab', 'fill: var(--ground); font-weight: 700;'],
    ['.ck-plot .ck-tm-val', 'fill: var(--ground); fill-opacity: .8;'],
    ['.ck-plot .ck-tm-hdr', 'fill: var(--ink-dim); letter-spacing: .04em;'],

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

/** The legend: the top-level branches, their colour and their share. Names that no label could fit. */
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
  return '<div class="ck-legend">' + items + more + '</div>';
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

  const foot = 'Squarified keeps rectangles compact so their areas can be compared; padding is a ' +
    'fixed inset per level, so a padded rectangle is smaller than its value by that border.' +
    (built.skipped
      ? ' This hierarchy is large, so only the choices listed here were laid out; the rest were ' +
        'left out rather than shipped as a megabyte of inline geometry.'
      : '');

  return '<section data-card="' + CK.esc(id) + '" class="ck-treemap">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="treemap settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('depth') + '">levels</label>\n' +
    '    ' + sel('depth', built.depths, cfg.depth) + '\n' +
    '    <label for="' + f('labels') + '">labels</label>\n' +
    '    ' + sel('labels', LABEL_MODES, cfg.labels,
                 (v) => (v === 'fit' ? 'only where they fit' : v === 'all' ? 'all, truncated' : 'none')) + '\n' +
    '    <label for="' + f('padding') + '">padding</label>\n' +
    '    ' + sel('padding', built.pads, cfg.padding, (v) => v + ' px') + '\n' +
    '    <p class="ck-set-foot">' + CK.esc(foot) + '</p>\n' +
    '  </div>\n' +
    '  <svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '"' +
       ' aria-label="' + CK.esc(note.aria) + '">' + svgInner(seed.marks, cfg.labels) + '</svg>\n' +
    legendHtml(read) + '\n' +
    '  <div class="ck-cap">' + note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: a display-list renderer and nothing that decides anything.
 *
 * Classic script, ES5 vocabulary — `var`, `function`, no arrow functions, no template literals, no
 * optional chaining — built by concatenation and put through {@link guardEmitted} before it leaves.
 * Every layout was computed in Node, so a settings change is a repaint. `render` clears the plot
 * before it draws, which is what makes a `<main>` swap replace the picture rather than stack a
 * second copy of it on top.
 *
 * @param id       the card's `data-card`
 * @param payload  `{ v, def }` — every variant, keyed by depth and padding
 * @param defaults the settings object `CK.settings` is seeded with
 */
function cardJs(id, payload, defaults) {
  const L = [];
  L.push('/* treemap card: paints a display list that was laid out when the card was built.');
  L.push('   The squarified split, every label decision and the caption were all settled in Node,');
  L.push('   so this turns descriptions into elements and does not know what an aspect ratio is. */');
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
  L.push('     stays a translator rather than a second place where treemap decisions live. */');
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
  L.push('  /* A select hands back a string, so a stored depth of 3 and a default of 3 are a string');
  L.push('     and a number. Every lookup is built from String() so the two cannot disagree, and an');
  L.push('     unbuilt combination falls back to the one the card shipped drawn. */');
  L.push('  function keyOf(cfg) {');
  L.push('    var k = String(cfg.depth) + "|" + String(cfg.padding);');
  L.push('    return P.v[k] ? k : P.def;');
  L.push('  }');
  L.push('');
  L.push('  function modeOf(cfg) {');
  L.push('    return cfg.labels === "all" || cfg.labels === "none" ? cfg.labels : "fit";');
  L.push('  }');
  L.push('');
  L.push('  function render(cfg) {');
  L.push('    var V = P.v[keyOf(cfg)], mode = modeOf(cfg), i, m;');
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
  L.push('    /* The caption is markup that was escaped value by value in Node; nothing from the');
  L.push('       data reaches it unescaped, which is why it may be assigned rather than built. */');
  L.push('    if (cap) { cap.innerHTML = V.cap; }');
  L.push('  }');
  L.push('');
  L.push('  CK.settings(sec, DEFAULTS, render);');
  L.push('});');
  return guardEmitted(L.join('\n') + '\n', 'treemap');
}

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * @example meta.name;   // 'treemap'
 */
export const meta = {
  name: 'treemap',
  summary: 'A hierarchy as nested rectangles whose area is their value, laid out squarified so the shapes stay comparable.',
  shape: "{ root: { name, value, children: [...] }, unit, colorBy: 'branch' | 'depth' | 'index' | 'name' } — " +
         'a leaf carries a value; a branch takes the sum of its children, and a branch that declares ' +
         'a different total is named in the caption rather than silently believed',
  category: 'part-of-a-whole',
  defaults: { ...DEFAULTS },
};

/**
 * Every setting this card understands, exported beside `meta.defaults` so a validator can check the
 * emitted panel's field names without building a card first.
 *
 * @example defaults.labels;   // 'fit'
 */
export const defaults = { ...DEFAULTS };

/**
 * Fold a caller's seed onto the defaults, coercing rather than refusing.
 *
 * A descriptor may be hand-edited, and a typo in `labels` should give a working treemap with the
 * default labelling rather than an empty box.
 *
 * @example settle({ labels: 'nope' }).labels;   // 'fit'
 */
function settle(seed, depths) {
  const out = { ...DEFAULTS };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  if (!LABEL_MODES.includes(out.labels)) out.labels = DEFAULTS.labels;
  out.padding = PADS.includes(Number(out.padding)) ? Number(out.padding) : DEFAULTS.padding;
  const d = Number(out.depth);
  out.depth = depths.includes(d) ? d
            : depths.includes(DEFAULTS.depth) ? DEFAULTS.depth
            : depths[depths.length - 1];
  return out;
}

/**
 * Build one treemap card from one hierarchy.
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ root, unit, colorBy }`, plus an optional `settings` seed — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the layout produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; malformed input never throws, it is counted and reported
 *
 * @example
 * build({
 *   id: 'disk',
 *   title: 'where the disk went',
 *   data: { unit: 'MB', root: { name: 'disk', children: [
 *     { name: 'node_modules', value: 812 },
 *     { name: 'src', children: [{ name: 'types', value: 41 }, { name: 'kit', value: 9 }] },
 *   ] } },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'treemap' : id);
  const heading = String(title == null ? 'Treemap' : title);
  const read = readTree(data);

  /* The depth choices are the levels that actually exist, capped at eight: offering a tenth level
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

export default {
  meta, defaults, build, guardEmitted, areaCheck,
  readTree, layout, squarify, sliceDiceWorst,
};
