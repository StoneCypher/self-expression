/**
 * @file cardkit card type: `pack` — a hierarchy as nested circles: a leaf's AREA is its value, and
 * a branch is the smallest circle enclosing its packed children.
 *
 * What this form is for, and what it costs. A circle pack shows containment better than anything
 * else on the desk — a nested circle is unambiguously inside its parent, where a nested rectangle
 * in a treemap needs a border and a header to say so — and it survives ten levels of depth without
 * the picture turning into a plaid. What it gives up is exactness: circles do not tile. The gaps
 * between them are real, so a branch's area is always LARGER than the sum of its children's, and
 * only the leaves make the strict area-equals-value claim. That is stated in the caption rather
 * than glossed over, because a reader comparing two branch circles is comparing packing luck as
 * much as value.
 *
 * The layout is the real thing, not an approximation:
 *
 * - **Front-chain placement** (Wang, Wang, Dai and Wang, 2006, as implemented in d3-hierarchy):
 *   siblings are placed largest first, each tangent to two circles on the current hull, and when a
 *   new circle collides with something on that hull the chain is spliced and the placement retried.
 *   Cost: each placement may walk part of the chain, so it is near-linear in practice and quadratic
 *   in the worst case. It is deterministic, which matters because a card is rebuilt often and a
 *   layout that moved every time would make every diff meaningless.
 * - **Welzl's smallest enclosing circle** (move-to-front, with a deterministic shuffle) gives the
 *   parent's radius. Expected linear; the shuffle is seeded from the sibling count so the same
 *   input always produces the same circle.
 *
 * The documented simpler alternative is a spiral-and-push placement: walk each new circle outward
 * along a spiral until it stops colliding. It is twenty lines, it always terminates, and it costs a
 * visibly looser pack — ten to twenty percent more radius for the same children — and a layout that
 * depends on the order the data happened to arrive in. This file does not use it.
 *
 * @see ./treemap.mjs — the same data where area is exact and space is fully used
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
 * @example loadKit().hue(1);   // 'var(--ck-s2)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/pack: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/pack: kit.js no longer defines window.CK');
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
 * @example guardEmitted('var a = 1;', 'pack');   // 'var a = 1;'
 */
export function guardEmitted(src, where) {
  const tag = 'cardkit/' + (where || 'pack') + ': emitted js ';

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
 * What a circle's label may say, given the room it has.
 *
 * Nothing ever overflows its circle, and the room is measured as a CHORD rather than a diameter:
 * a line of text sitting across a circle is only as wide as the circle is at the text's own height,
 * which is narrower than the full width by an amount that matters for small circles. Using the
 * diameter would let a name stick out of both sides of a small circle, which is the exact failure
 * this measurement exists to prevent.
 *
 * A label that fits whole is drawn in both label modes; one that only fits truncated is drawn with
 * its tail marked and only in `all`; one with room for fewer than three characters is dropped.
 * Every dropped name is still in the circle's tooltip.
 *
 * @param text the label
 * @param boxW usable width in px, already measured as a chord
 * @param boxH usable height in px; one line needs its font size plus two
 * @returns `{ text, lm }` with `lm` 0 for a whole label and 1 for a truncated one, or null
 *
 * @example labelFor('storage', 60, 12);   // { text: 'storage', lm: 0 }
 * @example labelFor('storage', 25, 12);   // { text: 'stor\u2026', lm: 1 }
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

/**
 * The width of a horizontal line of text `half` px from a circle's centre, inside radius `r`.
 *
 * The chord at the text's own half-height, less a 2px margin. This is the number {@link labelFor}
 * is given, and it is why a small circle refuses a name rather than letting it hang out of both
 * sides.
 *
 * @example chordAt(20, 4.5);   // about 38.9
 */
function chordAt(r, half) {
  const inside = r * r - half * half;
  return inside > 0 ? 2 * Math.sqrt(inside) - 4 : 0;
}

/* ── emission helpers ────────────────────────────────────────────────────────────────────── */

/**
 * Serialise a value as a JavaScript literal safe inside a classic `<script>` element.
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
 * @throws {Error} when `v` is NaN or infinite
 * @example n2(12.3456, 'circle');   // 12.35
 */
function n2(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/pack: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/* ── reading the hierarchy ───────────────────────────────────────────────────────────────── */

/* A parent with more children than this folds its smallest into one bucket carrying their sum. A
   thousand siblings pack fine; ten thousand is a build that visibly stalls, and the fold keeps the
   parent's total honest rather than dropping the tail. */
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
 *   two disagree, the children win and the disagreement is named. A branch circle here is derived
 *   from its children's packing, so a declared total that disagrees is not merely inconsistent, it
 *   is unusable.
 * - **A negative value is refused**, counted, and drawn as nothing. A circle of negative area does
 *   not exist; taking the square root of a negative would produce NaN and a silently missing shape.
 * - **A non-numeric value is refused** the same way and counted separately.
 * - **Zero is kept and drawn as nothing**, which is what a zero-radius circle is, and counted.
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

/* ── Welzl's smallest enclosing circle ───────────────────────────────────────────────────── */

/* The tolerance the enclosure tests use. Relative to the radii involved, because a pack of
   thousand-unit circles and a pack of unit circles need different absolute slack and a fixed
   epsilon is wrong for one of them. */
const EPS = 1e-9;

/** Does `a` contain `b`, allowing a hair of slack? */
function enclosesWeak(a, b) {
  const dr = a.r - b.r + Math.max(a.r, b.r, 1) * EPS;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

/** Does `a` fail to contain `b`? Named for readability at the call sites, which are dense. */
function enclosesNot(a, b) { return !enclosesWeak(a, b); }

/** Does `a` contain every circle in `B`? */
function enclosesWeakAll(a, B) {
  for (const b of B) if (!enclosesWeak(a, b)) return false;
  return true;
}

/** The circle through one circle: itself. */
function basis1(a) { return { x: a.x, y: a.y, r: a.r }; }

/**
 * The smallest circle enclosing two circles.
 *
 * Its centre lies on the line between the two, offset toward the larger by half their radius
 * difference; its radius is half the distance plus both radii. Coincident centres are handled by
 * the length falling out of the offset term, which is why the division is written this way.
 *
 * @example basis2({ x: 0, y: 0, r: 1 }, { x: 4, y: 0, r: 1 });   // { x: 2, y: 0, r: 3 }
 */
function basis2(a, b) {
  const x1 = a.x;
  const y1 = a.y;
  const r1 = a.r;
  const x2 = b.x;
  const y2 = b.y;
  const r2 = b.r;
  const x21 = x2 - x1;
  const y21 = y2 - y1;
  const r21 = r2 - r1;
  const l = Math.sqrt(x21 * x21 + y21 * y21);
  if (!(l > 0)) return { x: x1, y: y1, r: Math.max(r1, r2) };
  return {
    x: (x1 + x2 + (x21 / l) * r21) / 2,
    y: (y1 + y2 + (y21 / l) * r21) / 2,
    r: (l + r1 + r2) / 2,
  };
}

/**
 * The smallest circle enclosing three circles, by the Apollonius-style closed form d3 uses.
 *
 * There is no shorter honest way to write this: the centre is the intersection of two radical-style
 * lines and the radius is a root of the resulting quadratic. The `A` near zero branch is the
 * degenerate case where the quadratic is really linear, which happens whenever the three radii are
 * equal — the commonest input there is.
 *
 * @returns the enclosing circle, or null when the three are collinear enough to have no solution
 */
function basis3(a, b, c) {
  const x1 = a.x, y1 = a.y, r1 = a.r;
  const x2 = b.x, y2 = b.y, r2 = b.r;
  const x3 = c.x, y3 = c.y, r3 = c.r;
  const a2 = x1 - x2;
  const a3 = x1 - x3;
  const b2 = y1 - y2;
  const b3 = y1 - y3;
  const c2 = r2 - r1;
  const c3 = r3 - r1;
  const d1 = x1 * x1 + y1 * y1 - r1 * r1;
  const d2 = d1 - x2 * x2 - y2 * y2 + r2 * r2;
  const d3 = d1 - x3 * x3 - y3 * y3 + r3 * r3;
  const ab = a3 * b2 - a2 * b3;
  if (!Number.isFinite(ab) || ab === 0) return null;

  const xa = (b2 * d3 - b3 * d2) / (ab * 2) - x1;
  const xb = (b3 * c2 - b2 * c3) / ab;
  const ya = (a3 * d2 - a2 * d3) / (ab * 2) - y1;
  const yb = (a2 * c3 - a3 * c2) / ab;
  const A = xb * xb + yb * yb - 1;
  const B = 2 * (r1 + xa * xb + ya * yb);
  const C = xa * xa + ya * ya - r1 * r1;

  let r;
  if (Math.abs(A) > 1e-6) {
    const disc = B * B - 4 * A * C;
    if (!(disc >= 0)) return null;
    r = -((B + Math.sqrt(disc)) / (2 * A));
  } else {
    if (B === 0) return null;
    r = -(C / B);
  }
  if (!Number.isFinite(r)) return null;
  return { x: x1 + xa + xb * r, y: y1 + ya + yb * r, r };
}

/** The enclosing circle of a basis of one, two or three circles. */
function basisOf(B) {
  if (B.length === 1) return basis1(B[0]);
  if (B.length === 2) return basis2(B[0], B[1]);
  if (B.length === 3) return basis3(B[0], B[1], B[2]);
  return null;
}

/**
 * Grow the basis so that it also encloses `p`, per Welzl.
 *
 * The basis is the set of at most three circles that touch the enclosing circle. Adding a point
 * outside the current enclosure means the answer is determined by `p` and at most two of the
 * circles already in the basis, so the candidates are enumerated in increasing size — `p` alone,
 * then `p` with each existing member, then `p` with each pair.
 *
 * @returns the new basis, or null when no candidate works, which means the caller should fall back
 */
function extendBasis(B, p) {
  if (enclosesWeakAll(p, B)) return [p];

  for (let i = 0; i < B.length; i++) {
    if (enclosesNot(p, B[i]) && enclosesWeakAll(basis2(B[i], p), B)) return [B[i], p];
  }

  for (let i = 0; i < B.length - 1; i++) {
    for (let j = i + 1; j < B.length; j++) {
      const three = basis3(B[i], B[j], p);
      if (three &&
          enclosesNot(basis2(B[i], B[j]), p) &&
          enclosesNot(basis2(B[i], p), B[j]) &&
          enclosesNot(basis2(B[j], p), B[i]) &&
          enclosesWeakAll(three, B)) {
        return [B[i], B[j], p];
      }
    }
  }
  return null;
}

/**
 * A deterministic shuffle, so the pack is reproducible.
 *
 * Welzl's expected-linear bound needs a random order; a card that is rebuilt whenever its data
 * changes needs the SAME order every time, or every rebuild moves every circle and every diff of
 * the generated files is noise. A seeded linear congruential generator gives both.
 *
 * @example shuffled([1, 2, 3]).length;   // 3
 */
function shuffled(arr) {
  const out = arr.slice();
  let s = (0x2f6e2b1 ^ out.length) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

/**
 * The smallest circle enclosing a set of circles, by Welzl's move-to-front algorithm.
 *
 * Expected linear over a shuffled input. The fallback is not decoration: `basis3` can fail on a
 * genuinely degenerate configuration — three identical circles, or three collinear ones — and a
 * layout routine that throws on real data is worse than one that is a few percent loose. When the
 * basis cannot be extended, a centroid-and-farthest-point bound is returned instead, which always
 * encloses and is never more than a factor of two off.
 *
 * @param circles circles with `x`, `y` and `r`
 * @returns `{ x, y, r }` enclosing all of them, or null for an empty input
 *
 * @example enclose([{ x: 0, y: 0, r: 1 }]).r;   // 1
 */
function enclose(circles) {
  if (!circles.length) return null;
  const list = shuffled(circles);
  let B = [];
  let e = null;
  let i = 0;
  let guard = 0;
  const cap = 64 * list.length + 4096;

  while (i < list.length) {
    if (guard++ > cap) return crudeBound(circles);
    const p = list[i];
    if (e && enclosesWeak(e, p)) { i++; continue; }
    const next = extendBasis(B, p);
    if (!next) return crudeBound(circles);
    B = next;
    e = basisOf(B);
    if (!e || !Number.isFinite(e.r)) return crudeBound(circles);
    i = 0;
  }
  return e || crudeBound(circles);
}

/** A guaranteed-correct but loose enclosing circle: centroid, then the farthest edge. */
function crudeBound(circles) {
  let sx = 0;
  let sy = 0;
  for (const c of circles) { sx += c.x; sy += c.y; }
  const x = sx / circles.length;
  const y = sy / circles.length;
  let r = 0;
  for (const c of circles) {
    const d = Math.sqrt((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y)) + c.r;
    if (d > r) r = d;
  }
  return { x, y, r };
}

/* ── front-chain sibling packing ─────────────────────────────────────────────────────────── */

/**
 * Place `c` tangent to both `a` and `b`.
 *
 * The two tangency conditions are two circles in the plane of possible centres; their intersection
 * is the pair of valid positions and the branch picks the one on the outward side. When `a` and `b`
 * share a centre there is no line to work from, so `c` is simply set beside `a`.
 */
function placeTangent(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2) {
    let a2 = a.r + c.r;
    let b2 = b.r + c.r;
    a2 *= a2;
    b2 *= b2;
    if (a2 > b2) {
      const x = (d2 + b2 - a2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
      c.x = b.x - x * dx - y * dy;
      c.y = b.y - x * dy + y * dx;
    } else {
      const x = (d2 + a2 - b2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
      c.x = a.x + x * dx - y * dy;
      c.y = a.y + x * dy + y * dx;
    }
  } else {
    c.x = a.x + c.r;
    c.y = a.y;
  }
}

/** Do two circles overlap by more than float noise? */
function overlaps(a, b) {
  const dr = a.r + b.r - 1e-6;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

/** How close a chain link sits to the origin; the pair with the smallest score leads the front. */
function chainScore(link) {
  const a = link._;
  const b = link.next._;
  const ab = a.r + b.r;
  if (!(ab > 0)) return Infinity;
  const dx = (a.x * b.r + b.x * a.r) / ab;
  const dy = (a.y * b.r + b.y * a.r) / ab;
  return dx * dx + dy * dy;
}

/**
 * Pack circles as tangent siblings around a common centre, by front-chain placement.
 *
 * The algorithm (Wang, Wang, Dai and Wang, 2006; this is the d3-hierarchy formulation): the first
 * three circles are placed mutually tangent and become a circular "front chain" — the hull of what
 * has been placed. Each new circle is placed tangent to the chain's current leading pair. If it
 * overlaps some other circle ON the chain, the chain is spliced so that circle becomes one of the
 * pair and the placement is retried; the walk searches outward in both directions and always takes
 * the cheaper side first, which is what keeps the retries bounded. Once placed, the new circle
 * joins the chain and the leading pair is re-chosen as the one nearest the centre, which is what
 * makes the result round rather than a growing snake.
 *
 * The circles are then translated so the enclosing circle is at the origin, and its radius is
 * returned — that is the parent's radius.
 *
 * Cost: each placement may walk part of the chain, so near-linear in practice, quadratic in the
 * worst case. It is fully deterministic given the input order, which is what a regenerated card
 * needs. The simpler alternative — spiral outward until nothing collides — is looser by ten to
 * twenty percent and reorders with the input.
 *
 * @param circles objects carrying `r`, mutated in place to receive `x` and `y`
 * @returns the enclosing radius, with every circle positioned relative to its centre
 *
 * @example
 * var cs = [{ r: 1 }, { r: 1 }];
 * packSiblings(cs);   // 2, with cs[0].x === -1 and cs[1].x === 1
 */
function packSiblings(circles) {
  const n = circles.length;
  if (!n) return 0;

  const a0 = circles[0];
  a0.x = 0;
  a0.y = 0;
  if (n === 1) return a0.r;

  const b0 = circles[1];
  a0.x = -b0.r;
  b0.x = a0.r;
  b0.y = 0;
  if (n === 2) return a0.r + b0.r;

  placeTangent(b0, a0, circles[2]);

  let A = { _: a0, next: null, prev: null };
  let B = { _: b0, next: null, prev: null };
  let C = { _: circles[2], next: null, prev: null };
  A.next = C.prev = B;
  B.next = A.prev = C;
  C.next = B.prev = A;

  let i = 3;
  outer:
  while (i < n) {
    placeTangent(A._, B._, circles[i]);
    C = { _: circles[i], next: null, prev: null };

    let j = B.next;
    let k = A.prev;
    let sj = B._.r;
    let sk = A._.r;
    do {
      if (sj <= sk) {
        if (overlaps(j._, C._)) { B = j; A.next = B; B.prev = A; continue outer; }
        sj += j._.r;
        j = j.next;
      } else {
        if (overlaps(k._, C._)) { A = k; A.next = B; B.prev = A; continue outer; }
        sk += k._.r;
        k = k.prev;
      }
    } while (j !== k.next);

    C.prev = A;
    C.next = B;
    A.next = C;
    B.prev = C;
    B = C;

    /* Re-lead the chain with the pair closest to the centre. Without this the chain grows off in
       whatever direction the last placement happened to go and the pack becomes a crescent. */
    let best = chainScore(A);
    let walk = C.next;
    while (walk !== B) {
      const s = chainScore(walk);
      if (s < best) { A = walk; best = s; }
      walk = walk.next;
    }
    B = A.next;
    i++;
  }

  /* The enclosing circle is determined by the hull, and the front chain IS the hull, so nothing
     inside it needs to be considered. */
  const hull = [B._];
  let walk = B.next;
  while (walk !== B) { hull.push(walk._); walk = walk.next; }

  const e = enclose(hull) || crudeBound(circles);
  for (const c of circles) { c.x -= e.x; c.y -= e.y; }
  return e.r;
}

/* ── the pack ────────────────────────────────────────────────────────────────────────────── */

/* A square card: a pack has no long axis to exploit. */
const SIZE = 460;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_TARGET = 222;

/**
 * Give every node a radius and a position, bottom-up then top-down.
 *
 * Bottom-up: a drawn leaf's radius is the square root of its value, so its AREA is its value; a
 * branch's radius is whatever circle encloses its packed children. Padding is applied by inflating
 * each child before the pack and deflating afterwards, which puts exactly `pad` of clearance
 * between siblings and between a child and its parent's boundary — the standard trick, and cheaper
 * than teaching the packer about margins.
 *
 * Top-down: positions accumulate from the root, then everything is scaled by one factor so the root
 * fills the card. One uniform factor is what keeps leaf area proportional to value ACROSS the whole
 * tree and not merely within each family.
 *
 * @param root  the hierarchy root
 * @param depth how many levels below the root are packed; deeper nodes are treated as leaves
 * @param pad   clearance in unscaled units, applied per level
 * @returns `{ nodes, scale }` — every drawn node with `cx`, `cy` and `r` in card coordinates
 *
 * @example packTree(root, 2, 1).nodes[0].r;   // 222
 */
function packTree(root, depth, pad) {
  const laid = [];

  /* Bottom-up. `raw` is the unscaled radius; `px`/`py` are relative to the parent's centre. */
  const size = (node, level) => {
    const kids = level < depth ? node.children.filter((c) => c.value > 0) : [];
    if (!kids.length) {
      node.raw = node.value > 0 ? Math.sqrt(node.value) : 0;
      node.kids = [];
      return;
    }
    for (const c of kids) size(c, level + 1);
    const live = kids.filter((c) => c.raw > 0);
    node.kids = live;
    if (!live.length) { node.raw = node.value > 0 ? Math.sqrt(node.value) : 0; return; }

    const circles = live.map((c) => ({ node: c, r: c.raw + pad, x: 0, y: 0 }));
    const r = packSiblings(circles);
    for (const c of circles) { c.node.px = c.x; c.node.py = c.y; }
    node.raw = r;
  };

  size(root, 0);
  if (!(root.raw > 0)) return { nodes: laid, scale: 0 };

  const k = R_TARGET / root.raw;

  const place = (node, ax, ay, level, topIx, sibIx, parent) => {
    const here = {
      node, level, topIx, sibIx, parent,
      cx: CX + ax * k, cy: CY + ay * k, r: node.raw * k,
      leaf: !node.kids || !node.kids.length,
    };
    laid.push(here);
    if (!node.kids) return;
    node.kids.forEach((c, i) => {
      place(c, ax + (c.px || 0), ay + (c.py || 0), level + 1, level === 0 ? i : topIx, i, here);
    });
  };

  place(root, 0, 0, 0, -1, 0, null);
  return { nodes: laid, scale: k };
}

/**
 * Lay one pack out and turn it into a display list.
 *
 * @param read from {@link readTree}
 * @param opt  `{ depth, pad }`
 * @returns `{ marks, W, H, drawn, fitLabels, allLabels, droppedLabels, fill }`
 *
 * @example layout(readTree(data), { depth: 2, pad: 2 }).drawn;
 */
function layout(read, opt) {
  const marks = [];
  const out = {
    marks, W: SIZE, H: SIZE, drawn: 0, fitLabels: 0, allLabels: 0, droppedLabels: 0,
    fill: 0, laid: [],
  };
  const root = read.root;
  if (!root || !(root.value > 0)) return out;

  const packed = packTree(root, opt.depth, opt.pad);
  out.laid = packed.nodes;
  const total = root.value;
  const unit = read.unit ? ' ' + read.unit : '';

  let leafArea = 0;
  for (const P of packed.nodes) {
    const node = P.node;
    if (!(P.r > 0.2)) { continue; }
    const share = (node.value / total) * 100;
    const tip = (node.path || node.name || '(root)') + ' \u00b7 ' + CK.fmt(node.value) + unit +
                ' \u00b7 ' + share.toFixed(share < 1 ? 2 : 1) + '%';

    out.drawn++;
    if (P.leaf) leafArea += Math.PI * P.r * P.r;

    marks.push({
      t: 'circle',
      a: P.leaf
        ? {
            cx: n2(P.cx, 'leaf'), cy: n2(P.cy, 'leaf'), r: n2(P.r, 'leaf'),
            fill: CK.hue(hueIndex(node, P.topIx, P.sibIx, read.colorBy)),
            'fill-opacity': '0.85', class: 'ck-pk-leaf',
          }
        : {
            cx: n2(P.cx, 'br'), cy: n2(P.cy, 'br'), r: n2(P.r, 'br'),
            class: 'ck-pk-br', 'data-d': String(P.level),
          },
      ti: tip,
    });

    if (P.leaf) {
      const two = P.r > 22;
      const w = chordAt(P.r, two ? TXT : TXT / 2);
      const lab = labelFor(node.name, w, P.r * 2);
      if (lab) {
        if (lab.lm === 0) out.fitLabels++;
        out.allLabels++;
        marks.push({
          t: 'text', lm: lab.lm,
          a: {
            x: n2(P.cx, 'lab'), y: n2(P.cy + (two ? -3 : 0), 'lab'),
            class: 'ck-pk-lab', 'text-anchor': 'middle', 'dominant-baseline': 'central',
          },
          s: lab.text,
        });
        if (two && lab.lm === 0) {
          const vt = CK.fmt(node.value) + unit;
          if (textW(vt) <= chordAt(P.r, TXT * 1.4)) {
            marks.push({
              t: 'text', lm: 0,
              a: {
                x: n2(P.cx, 'val'), y: n2(P.cy + 8, 'val'),
                class: 'ck-pk-val', 'text-anchor': 'middle', 'dominant-baseline': 'central',
              },
              s: vt,
            });
          }
        }
      } else {
        out.droppedLabels++;
      }
    } else if (P.level > 0) {
      /* A branch is named just inside its top edge, where the chord is narrow, so the room is
         measured there rather than at the widest point. */
      const w = chordAt(P.r, Math.max(0, P.r - 9));
      const lab = labelFor(node.name, w, 12);
      if (lab) {
        if (lab.lm === 0) out.fitLabels++;
        out.allLabels++;
        marks.push({
          t: 'text', lm: lab.lm,
          a: {
            x: n2(P.cx, 'hdr'), y: n2(P.cy - P.r + 10, 'hdr'),
            class: 'ck-pk-hdr', 'text-anchor': 'middle',
          },
          s: lab.text,
        });
      } else {
        out.droppedLabels++;
      }
    }
  }

  /* How much of the card the leaves actually cover. This is the number that says what packing
     costs — a treemap would read 100%, and the gap is the price of showing containment. */
  out.fill = (leafArea / (Math.PI * R_TARGET * R_TARGET)) * 100;
  return out;
}

/**
 * Every sibling pair and every parent-child pair, for a test to assert on.
 *
 * The claim a pack makes is that nothing overlaps and everything is inside its parent. Both are
 * checkable, so both are exported rather than asserted in a comment.
 *
 * @param laid the `nodes` list from {@link layout}
 * @returns `{ worstOverlap, worstEscape }` — both should be at or below zero within tolerance
 *
 * @example overlapCheck(layout(read, { depth: 3, pad: 2 }).laid).worstOverlap <= 0.01;   // true
 */
export function overlapCheck(laid) {
  const groups = new Map();
  for (const P of laid) {
    const g = groups.get(P.parent) || [];
    g.push(P);
    groups.set(P.parent, g);
  }

  /* Siblings, every pair. Not a sample and not the neighbours the packer happened to consider:
     the claim is that NO two circles overlap, and the only honest test of that is all of them. */
  let worstOverlap = 0;
  let pairs = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i];
        const b = g[j];
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        const over = a.r + b.r - d;
        pairs++;
        if (over > worstOverlap) worstOverlap = over;
      }
    }
  }

  /* And every child against its own parent: containment is the other half of the claim, and a
     circle that has escaped its parent is a hierarchy the picture is no longer telling the truth
     about. */
  let worstEscape = 0;
  for (const P of laid) {
    if (!P.parent) continue;
    const d = Math.hypot(P.cx - P.parent.cx, P.cy - P.parent.cy);
    const out = d + P.r - P.parent.r;
    if (out > worstEscape) worstEscape = out;
  }

  return { worstOverlap, worstEscape, pairs, circles: laid.length };
}

/* ── saying what the picture shows ───────────────────────────────────────────────────────── */

/** A count with its noun pluralised the boring, correct way. */
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/**
 * Everything the card refused, folded, or found inconsistent, as one escaped clause.
 *
 * Kept separate from {@link describe} because it is the same list whatever the picture looks like,
 * and because it must never quietly go missing.
 */
function refusals(read) {
  const st = read.stats;
  const e = CK.esc;
  const bits = [];

  if (st.negatives) {
    bits.push('<b>' + e(plural(st.negatives, 'negative value')) + '</b> refused &mdash; a circle of ' +
              'negative area does not exist, and its radius would be the square root of a negative');
  }
  if (st.unreadable) {
    bits.push('<b>' + e(plural(st.unreadable, 'value')) + '</b> were not a number and count as zero');
  }
  if (st.zeros) bits.push(e(plural(st.zeros, 'leaf', 'leaves')) + ' are zero and have no radius');
  if (st.mismatches.length) {
    const m = st.mismatches[0];
    bits.push('<b>' + e(plural(st.mismatches.length, 'branch', 'branches')) +
              '</b> declare a total that disagrees with their children &mdash; ' + e(m.path) +
              ' says ' + e(CK.fmt(m.declared)) + ' but its children sum to ' + e(CK.fmt(m.sum)) +
              '; the children win, because a branch circle here is derived from their packing');
  }
  if (st.folded) {
    bits.push(e(String(st.folded)) + ' of the smallest siblings past ' + MAX_CHILDREN +
              ' were folded into one circle carrying their sum');
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
 * The caption names the algorithm and its price, because a pack looks like it wastes space and a
 * reader deserves to know that the waste is the form's cost rather than a bug.
 */
function describe(read, L, opt) {
  const st = read.stats;
  const root = read.root;
  const unit = read.unit ? ' ' + read.unit : '';
  const e = CK.esc;

  if (!root) {
    return {
      aria: 'Circle pack with no hierarchy: nothing is drawn.',
      caption: 'a circle pack with <b>no hierarchy</b> &mdash; the card keeps its place on the ' +
               'desk, but there is nothing to pack.',
    };
  }
  if (!(root.value > 0)) {
    return {
      aria: 'Circle pack whose values total zero, so no circle has a radius.',
      caption: 'the hierarchy totals <b>zero</b>, so no circle has a radius. ' + refusals(read),
    };
  }

  const single = !root.children.length;
  let big = null;
  for (const P of L.laid) if (P.leaf && (!big || P.node.value > big.node.value)) big = P;
  const bigShare = big ? (big.node.value / root.value) * 100 : 0;

  const aria =
    'Circle pack of ' + plural(st.leaves, 'leaf', 'leaves') + ' under ' +
    plural(st.branches, 'branch', 'branches') + ', totalling ' + CK.fmt(root.value) + unit +
    '. ' + L.drawn + ' circles are drawn at ' + plural(opt.depth, 'level') + ' deep; a leaf area is ' +
    'its value. ' +
    (big ? 'The largest leaf is ' + (big.node.name || 'unnamed') + ' at ' + bigShare.toFixed(1) +
           ' percent of the whole.' : '');

  const caption =
    '<b>' + e(String(L.drawn)) + '</b> circle' + (L.drawn === 1 ? '' : 's') + ' &mdash; ' +
    e(plural(st.leaves, 'leaf', 'leaves')) + ' under ' + e(plural(st.branches, 'branch', 'branches')) +
    ', totalling <b>' + e(CK.fmt(root.value) + unit) + '</b>. ' +
    (big ? 'the largest leaf is <b>' + e(big.node.name || 'unnamed') + '</b> at ' +
           e(bigShare.toFixed(1)) + '%. ' : '') +

    (single
      ? '<i>one leaf, so one circle</i> filling the card &mdash; drawn as a whole circle rather than ' +
        'as an arc of zero length, which is the shape a naive implementation produces and nobody sees. '
      : '') +

    '<i>front-chain placement</i> (Wang et al., 2006) with <i>Welzl</i> for each parent radius. ' +
    'the leaves cover <b>' + e(L.fill.toFixed(1)) + '%</b> of the card: circles do not tile, so a ' +
    'branch is always bigger than the sum of its children and only a LEAF area is exactly its ' +
    'value. that gap is what containment costs, and a treemap is the card to reach for when it ' +
    'matters more than nesting does. ' +

    '<span class="ck-aside">' + e(L.fitLabels + ' of ' + (L.allLabels + L.droppedLabels)) +
    ' circles hold their name whole, ' + e(String(L.allLabels - L.fitLabels)) + ' hold it truncated, ' +
    'and ' + e(String(L.droppedLabels)) + ' hold none. room is measured as the chord at the text\u2019s ' +
    'own height, not the diameter, so a name can never hang out of both sides of a small circle; ' +
    'every name is in the tooltip either way.</span> ' +

    refusals(read);

  return { aria: aria.trim(), caption: caption.trim() };
}

/* ── variants ────────────────────────────────────────────────────────────────────────────── */

/** The clearance choices the gear offers. A select, not a free number, so layouts stay enumerable. */
const PADS = [0, 1, 2, 4];

/** Every setting this card understands, with the value that stands when nothing is stored. */
const DEFAULTS = { depth: 3, labels: 'fit', padding: 2 };

/** The label modes. `fit` draws only whole labels; `all` adds truncated ones; `none` draws none. */
const LABEL_MODES = ['all', 'fit', 'none'];

/* Total marks across every precomputed variant. A 500-leaf pack is several hundred marks per
   layout, and every card's script is concatenated into one inline block, so the whole enumeration
   would be most of a megabyte. Past this the gear offers fewer choices instead — and only the ones
   that were actually built, so no control is ever a control that silently does nothing. */
const MARK_BUDGET = 1400;

/**
 * Pack the hierarchy once per enumerable setting combination, within a size budget.
 *
 * `depth` and `padding` both change the packing — a child that is not drawn is also not packed, and
 * clearance changes every radius up the tree — so each pair is its own layout. `labels` does not,
 * because every label was resolved into a mark carrying whether it fits whole.
 *
 * The build order is an axis order rather than a distance order: every clearance at the card's own
 * depth first, then every depth at the card's own clearance, then the rest of the grid. What
 * survives a budget cut is therefore a cross through the defaults, which is exactly the set the two
 * selects can navigate one axis at a time, and the panel is built from what exists.
 *
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
  const own = '.ck-pack[data-card="' + id + '"]';
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
 * Leaf labels sit on a coloured fill, so they take `--ground`: the series palette is light in the
 * dark theme and dark in the light one, which is exactly the inversion the page background already
 * is. Branch labels sit on the card, so they take `--ink-dim`.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot', 'max-width: 460px; margin: 0 auto;'],
    ['.ck-plot text', 'pointer-events: none;'],
    ['.ck-pk-leaf', 'stroke: none;'],
    ['.ck-pk-br', 'fill: var(--well); fill-opacity: .5; stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-pk-br[data-d="0"]', 'fill: none; stroke: var(--rule);'],
    ['.ck-plot .ck-pk-lab', 'fill: var(--ground); font-weight: 700;'],
    ['.ck-plot .ck-pk-val', 'fill: var(--ground); fill-opacity: .8;'],
    ['.ck-plot .ck-pk-hdr', 'fill: var(--ink-dim); letter-spacing: .04em;'],

    ['.ck-legend i', 'border-radius: 50%;'],
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

  const foot = 'A leaf circle area is its value; a branch is only as big as its children happened ' +
    'to pack, so the space between circles is real and not a rounding error.' +
    (built.skipped
      ? ' This hierarchy is large, so only the choices listed here were packed; the rest were left ' +
        'out rather than shipped as a megabyte of inline geometry.'
      : '');

  return '<section data-card="' + CK.esc(id) + '" class="ck-pack">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="pack settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('depth') + '">levels</label>\n' +
    '    ' + sel('depth', built.depths, cfg.depth) + '\n' +
    '    <label for="' + f('labels') + '">labels</label>\n' +
    '    ' + sel('labels', LABEL_MODES, cfg.labels,
                 (v) => (v === 'fit' ? 'only where they fit' : v === 'all' ? 'all, truncated' : 'none')) + '\n' +
    '    <label for="' + f('padding') + '">clearance</label>\n' +
    '    ' + sel('padding', built.pads, cfg.padding, (v) => v + ' units') + '\n' +
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
 * The packer never runs here: front-chain placement and Welzl both ran in Node, where a test can
 * check that no pair of circles overlaps.
 */
function cardJs(id, payload, defaults) {
  const L = [];
  L.push('/* pack card: paints a display list that was packed when the card was built.');
  L.push('   Front-chain placement and the smallest-enclosing-circle both ran in Node, where a test');
  L.push('   can check every pair for overlap; this turns descriptions into elements. */');
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
  L.push('     stays a translator rather than a second place where packing decisions live. */');
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
  L.push('  /* A select hands back a string, so a stored level count of 3 and a default of 3 are a');
  L.push('     string and a number. Every lookup is built from String() so the two cannot disagree. */');
  L.push('  function keyOf(cfg) {');
  L.push('    var k = String(cfg.depth) + "|" + String(cfg.padding);');
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
  return guardEmitted(L.join('\n') + '\n', 'pack');
}

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * @example meta.name;   // 'pack'
 */
export const meta = {
  name: 'pack',
  summary: 'A hierarchy as nested circles: a leaf area is its value, packed by front-chain placement.',
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
 * @example defaults.padding;   // 2
 */
export const defaults = { ...DEFAULTS };

/**
 * Fold a caller's seed onto the defaults, coercing rather than refusing.
 *
 * @example settle({ labels: 'nope' }, [1, 2]).labels;   // 'fit'
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
  out.depth = depths.includes(d) ? d : (depths.includes(DEFAULTS.depth) ? DEFAULTS.depth : depths[depths.length - 1]);
  return out;
}

/**
 * Build one circle-pack card from one hierarchy.
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ root, unit, colorBy }`, plus an optional `settings` seed — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the layout produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; malformed input never throws, it is counted and reported
 *
 * @example
 * build({
 *   id: 'repos',
 *   title: 'lines by package',
 *   data: { unit: 'loc', root: { name: 'repo', children: [
 *     { name: 'core', children: [{ name: 'kit', value: 900 }, { name: 'types', value: 4200 }] },
 *     { name: 'docs', value: 320 },
 *   ] } },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'pack' : id);
  const heading = String(title == null ? 'Pack' : title);
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

export default {
  meta, defaults, build, guardEmitted, overlapCheck,
  packSiblings, enclose, layout, readTree,
};
