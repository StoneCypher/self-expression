/**
 * `matrix` -- a binary or weighted incidence matrix with both axes seriated.
 *
 * This generalises the tracker card written by hand earlier: thirty-six issues down one axis,
 * thirty-three labels down the other, a square wherever the two meet. The picture is only
 * worth drawing because of the ordering. An incidence matrix in arrival order is static; the
 * same matrix with both axes permuted to bring like next to like grows a diagonal, and the
 * diagonal is the finding. On the tracker it recovered four ordinal scales -- size, effort,
 * difficulty, priority -- in their own order, from a sweep that was never told they were
 * scales. That is the whole argument for this type.
 *
 * Three stages produce the ordering, and they are three because barycentre alone is not
 * enough and neither is local search alone:
 *
 *   1. A two-sided barycentre sweep. Rows move to the mean position of the columns they
 *      touch, columns to the mean position of the rows that touch them, alternately, until
 *      neither moves. This is a global move -- it finds the gross structure in a handful of
 *      passes -- but it optimises nothing in particular, so it can and does stop next to a
 *      visibly better arrangement.
 *   2. An adjacent-swap pass on an explicit objective (see {@link costOf}), run to a local
 *      optimum. Only strict improvements are accepted, so this stage can never make the
 *      picture worse.
 *   3. A single-key relocation pass: lift one row out and put it back wherever it fits best.
 *      Relocation escapes the local optima that adjacent swaps cannot, because a row that
 *      belongs six places away has to cross five rows that each individually get worse.
 *
 * All of the arithmetic happens here, in Node, at build time. The browser is handed the four
 * orderings -- one per value of the `seriate` setting -- plus the cell list, and its whole job
 * is to lay squares on a grid at whatever cell size the viewer asked for. The seriation runs
 * once, where a test can watch it, rather than once per viewer.
 *
 * `CK` itself is loaded out of `kit.js` and evaluated in a `vm` context, so `CK.scale` maps
 * weight to opacity here with exactly the zero-width-domain guard the browser would have used,
 * `CK.hue` picks the same group colours, and `CK.esc` is the same escape. A private copy of
 * any of them would be a second source of truth, and two sources of truth drift.
 *
 * @see ./chart.mjs -- the same emit shape and the same vm-loaded kit
 * @see ./flow.mjs -- the sibling written alongside this one
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it -- nothing reaches for `document` until a function that
 * needs the DOM is called, and none of those are called here.
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
  catch (e) { throw new Error('cardkit/matrix: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/matrix: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── the build-time guard ────────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose, and a guard that
 * cries wolf is a guard that gets deleted -- one card was refused because a comment said "the
 * class is what CSS reads". Offsets survive so a reported position still points at something
 * real, and regex literals are recognised, because a scanner that desyncs on the quote inside
 * `replace(/'/g, x)` starts blanking actual code, which turns a false positive into the far
 * worse false negative.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment, string and regex contents replaced by spaces
 *
 * @example blankNonCode('var s = "const";').indexOf('const');   // -1
 * @example blankNonCode('var re = /["]/;').indexOf('"');   // -1
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

/** A short window of source around an offset, so the message points at the actual text. */
function nearby(src, at) {
  return src.slice(Math.max(0, at - 50), Math.min(src.length, at + 50));
}

/**
 * Refuse to emit a browser script that would break the desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block, so a single modern-syntax token or a
 * stray backtick is a parse error that blanks every card on the page rather than this one. The
 * backtick case keeps happening because it hides in a comment: comments ship, and a backtick
 * around a word closes the surrounding template literal early.
 *
 * Two scans, deliberately different. A backtick -- named by its code point rather than typed,
 * because writing the character in the file that describes it is how the file acquires the bug
 * -- and `=>` and `?.` are scanned RAW, since none of the three can appear innocently here.
 * `const`, `let` and `class` are scanned only after comment and string bodies are blanked,
 * because all three are ordinary English. Control characters are compared numerically rather
 * than matched against a character class, since writing the class is how the class gets
 * corrupted, and DEL is included because it is the one `JSON.stringify` does not escape.
 *
 * @param src   the emitted script
 * @param where a label for the message, naming which card produced it
 * @returns `src` unchanged, so the guard can wrap the value on its way out
 * @throws {Error} naming the violation, its offset, and the source around it
 *
 * @example guardEmitted('var a = 1;', 'matrix');   // 'var a = 1;'
 * @example guardEmitted('var f = function () { return 1; };', 'matrix');   // unchanged
 * @example guardEmitted('var a = ' + String.fromCharCode(96) + ';', 'matrix');   // throws
 */
export function guardEmitted(src, where) {
  const tag = 'cardkit/' + (where || 'matrix') + ': emitted js ';

  const tick = src.indexOf(String.fromCharCode(96));
  if (tick >= 0) {
    throw new Error(tag + 'contains a backtick at offset ' + tick + ' -- near: ' + nearby(src, tick));
  }

  const arrow = src.indexOf('=>');
  if (arrow >= 0) {
    throw new Error(tag + 'contains an arrow function at offset ' + arrow + ' -- near: ' + nearby(src, arrow));
  }

  const opt = src.indexOf('?.');
  if (opt >= 0) {
    throw new Error(tag + 'contains optional chaining at offset ' + opt + ' -- near: ' + nearby(src, opt));
  }

  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      throw new Error(tag + 'contains control character ' + c + ' at offset ' + i);
    }
  }

  const code = blankNonCode(src);
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('(^|[^\\w$.])' + kw + '[\\s({]').exec(code);
    if (m) {
      throw new Error(tag + 'declares ' + kw + ' at offset ' + m.index + ' -- near: ' + nearby(src, m.index));
    }
  }

  return src;
}

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed.
   They only decide how much gutter the labels get, so being a hair pessimistic costs a few
   pixels of margin, which is the safe way to be wrong. */
const CHW = 5.42;
const TXT = 9;

/* Cell size in px. The floor is legibility: below about nine pixels a square stops reading as
   a mark and starts reading as noise, and the whole point of a matrix is that a cell is a
   fact you can point at. Past the floor the matrix grows and scrolls inside `.ck-scroll`
   rather than shrinking, so the desk column never widens and a cell is never illegible. */
const CELL_MIN = 9;
const CELL_MAX = 28;
const CELL_DEF = 14;

/* Gutter caps. A hundred-character row label would otherwise eat the plot; clipped with the
   cut marked is more useful than a matrix two inches wide, and the full text stays in the
   tooltip. */
const ROW_LAB_MAX = 150;
const COL_LAB_MAX = 96;

/** How many productive barycentre passes before we stop and say we did not converge. */
const SWEEP_CAP = 64;

/* Above this many rows or columns the pairwise distance table stops being free -- it is
   O(n^2 * m) to build -- so the improvement passes are skipped and the caption says so. The
   barycentre sweep is O(n log n) per pass and always runs. */
const IMPROVE_CAP = 256;

/** The four things `seriate` may say, and what each one means for the two axes. */
const SERIATE_MODES = ['both', 'rows', 'cols', 'none'];

/** The three things `labels` may say. */
const LABEL_MODES = ['both', 'rows', 'none'];

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Exported so a panel's field names can be checked against it in both directions rather than
 * trusted: a `name` in the markup that is not a key here is a control that silently does
 * nothing, and `CK.settings` -- correctly -- ignores it without complaining.
 *
 * A card *instance* narrows these: `data.seriate` becomes the fallback actually handed to
 * `CK.settings`, so a matrix authored as "rows are pinned, sweep the columns" opens that way.
 * The key set is identical either way, which is the part a validator cares about.
 *
 * @example defaults.cell;   // 14
 */
export const defaults = { seriate: 'both', labels: 'both', cell: CELL_DEF };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * `shape` is a string on purpose: it is read by a person deciding what to feed the card, and
 * it has to read at a glance.
 *
 * @example meta.name;   // 'matrix'
 */
export const meta = {
  name: 'matrix',
  summary:
    'A binary or weighted incidence matrix with both axes seriated by barycentre sweep, so ' +
    'blocks fall on the diagonal and the ordering itself is the finding.',
  shape:
    '{ rows: [{ id, label }], cols: [{ id, label, accent }], ' +
    'cells: [[rowIdx, colIdx, weight]], seriate, pinRows, pinCols, ' +
    'rowGroups: [{ label, rows: [rowId] }] } -- ' +
    'cells may name an axis member by index or by id; weight is optional and, when any cell ' +
    'carries one, drives fill opacity; pinRows / pinCols freeze that axis in the given order',
  category: 'flow-and-relationship',
  defaults,
};

/* -- small shared arithmetic ---------------------------------------------------------- */

/**
 * Round a number to two decimals, refusing to emit one that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console. Failing loudly at build time turns that into a stack
 * trace next to the input that caused it, which is the difference between a bug and a mystery.
 *
 * @param v    the number
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(0.33333, 'opacity');   // 0.33
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/matrix: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the card's 9px mono face. */
function textW(s) { return String(s).length * CHW; }

/** Shorten a label to `max` px, keeping the head and marking the cut. */
function clip(s, max) {
  const str = String(s);
  const room = Math.floor(max / CHW);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` becomes an escape so a label containing `</script>` cannot close the block early; `>`
 * goes with it, which has the useful side effect that no label can ever put `=>` into a file
 * that is contractually free of arrow functions. Backticks go too, for the same contract, and
 * the two line separators because they are newlines to a JS parser and not to
 * `JSON.stringify`.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsonLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** `a` and `b` hold the same members in the same order. */
function sameOrder(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* -- reading the data ----------------------------------------------------------------- */

/**
 * Normalise one axis into `[{ id, label, accent }]`, giving anonymous members an id.
 *
 * A member may arrive as an object or as a bare string; both are common when the matrix is
 * generated from a query, and neither is worth making the caller box up.
 *
 * @param list      whatever arrived as `rows` or `cols`
 * @param kind      'row' or 'col', used to invent ids for members that lack one
 * @param useAccent whether an `accent` flag on a member means anything on this axis
 *
 * @example normAxis(['a', { id: 'b', label: 'Bee' }], 'row', false);
 * // [{ id: 'a', label: 'a', accent: false }, { id: 'b', label: 'Bee', accent: false }]
 */
function normAxis(list, kind, useAccent) {
  const out = [];
  const arr = Array.isArray(list) ? list : [];
  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i];
    const o = raw && typeof raw === 'object' ? raw : { id: raw };
    const id = o.id == null ? kind + (i + 1) : String(o.id);
    out.push({
      id,
      label: String(o.label == null ? id : o.label),
      accent: useAccent ? !!o.accent : false,
    });
  }
  return out;
}

/**
 * Resolve one half of a cell reference to an axis index, accepting an index or an id.
 *
 * The documented shape is indices, which is what a generator emits. Ids are accepted too
 * because a hand-written matrix is far easier to read that way and the cost of allowing both
 * is one map lookup. Anything that resolves to neither is refused rather than coerced -- a
 * reference to row `"7"` when there are five rows is a bug in the caller, and silently
 * dropping it into row 0 would hide it.
 *
 * @returns the index, or -1 when the reference names nothing
 *
 * @example at(2, rows, byId);      // 2
 * @example at('effort', rows, byId);   // 4
 */
function at(v, list, byId) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < list.length) return v;
  if (typeof v === 'string' && byId.has(v)) return byId.get(v);
  return -1;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * Four kinds of bad cell are counted rather than thrown on, because all four are things real
 * data does and none of them should cost the reader the other nine hundred cells:
 *
 *   - a reference to a row or column that does not exist (`badRef`);
 *   - a weight that is not a positive finite number (`badWeight`). Zero is *absence*, and a
 *     matrix that drew zero as a present-but-invisible square would be claiming a fact it
 *     does not have. Negative incidence has no reading at all;
 *   - a duplicate `(row, column)` pair (`dupe`). The first entry wins. A later duplicate is
 *     almost always a join artefact -- the same fact arriving twice through two paths -- and
 *     the first one is the one a human wrote. Summing them instead would silently double a
 *     weight and darken a square for a reason nothing in the data explains;
 *   - a cell that is not a pair at all (`badRef` again).
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the counts above
 *
 * @example
 * readData({ rows: [{ id: 'a' }], cols: [{ id: 'x' }], cells: [[0, 0]] }).filled;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};

  const rows = normAxis(d.rows, 'row', false);
  const cols = normAxis(d.cols, 'col', true);
  const rowById = new Map();
  const colById = new Map();
  rows.forEach((r, i) => { if (!rowById.has(r.id)) rowById.set(r.id, i); });
  cols.forEach((c, i) => { if (!colById.has(c.id)) colById.set(c.id, i); });

  const raw = Array.isArray(d.cells) ? d.cells : [];

  /* "Weights are present" is decided once, over the whole cell list, rather than per cell.
     A matrix where three cells carry a weight and nine hundred do not is a binary matrix with
     three annotations, and rendering it as weighted would make those three look like the only
     strong facts on the card. */
  let weighted = false;
  for (const t of raw) {
    if (Array.isArray(t) && t.length > 2 && Number.isFinite(Number(t[2]))) { weighted = true; break; }
  }

  const seen = new Map();
  const drop = { badRef: 0, badWeight: 0, dupe: 0 };

  for (const t of raw) {
    if (!Array.isArray(t) || t.length < 2) { drop.badRef++; continue; }
    const r = at(t[0], rows, rowById);
    const c = at(t[1], cols, colById);
    if (r < 0 || c < 0) { drop.badRef++; continue; }

    let w = 1;
    if (t.length > 2 && t[2] !== undefined && t[2] !== null) w = Number(t[2]);
    if (!Number.isFinite(w) || w <= 0) { drop.badWeight++; continue; }

    const key = r + '|' + c;
    if (seen.has(key)) { drop.dupe++; continue; }
    seen.set(key, weighted ? w : 1);
  }

  const nR = rows.length;
  const nC = cols.length;

  /* Dense row vectors. The improvement passes need a profile per row and per column, and a
     Map lookup per cell inside an O(n^2 * m) loop is the difference between a build that
     takes a moment and one that takes a minute. */
  const M = [];
  for (let r = 0; r < nR; r++) M.push(new Float64Array(nC));
  for (const [key, w] of seen) {
    const bar = key.indexOf('|');
    M[+key.slice(0, bar)][+key.slice(bar + 1)] = w;
  }

  /* Adjacency lists for the barycentre sweep, which only ever visits present cells. On a
     sparse matrix -- and an incidence matrix is almost always sparse -- this is the whole
     reason a sweep is cheap. */
  const rowTouch = [];
  const colTouch = [];
  for (let r = 0; r < nR; r++) rowTouch.push([]);
  for (let c = 0; c < nC; c++) colTouch.push([]);
  for (let r = 0; r < nR; r++) {
    for (let c = 0; c < nC; c++) {
      const w = M[r][c];
      if (w <= 0) continue;
      rowTouch[r].push([c, w]);
      colTouch[c].push([r, w]);
    }
  }

  const rowDeg = rowTouch.map((l) => l.length);
  const colDeg = colTouch.map((l) => l.length);
  const rowMass = M.map((v) => v.reduce((a, b) => a + b, 0));
  const colMass = [];
  for (let c = 0; c < nC; c++) {
    let s = 0;
    for (let r = 0; r < nR; r++) s += M[r][c];
    colMass.push(s);
  }

  let wLo = Infinity;
  let wHi = -Infinity;
  for (const w of seen.values()) { if (w < wLo) wLo = w; if (w > wHi) wHi = w; }
  if (!Number.isFinite(wLo)) { wLo = 1; wHi = 1; }

  const groups = readGroups(d.rowGroups, rowById);

  return {
    rows, cols, nR, nC, M, rowTouch, colTouch,
    rowDeg, colDeg, rowMass, colMass,
    weighted, wLo, wHi,
    filled: seen.size,
    possible: nR * nC,
    drop,
    groups,
    pinRows: !!d.pinRows,
    pinCols: !!d.pinCols,
    given: SERIATE_MODES.indexOf(d.seriate) >= 0 ? d.seriate : 'both',
  };
}

/**
 * Row groups, resolved from ids to indices, with unresolvable ids counted and discarded.
 *
 * Groups are an annotation and never a constraint. That is the interesting choice: a grouping
 * that the sweep was not told about, and that comes out contiguous anyway, is evidence the
 * grouping is real. Forcing the seriation to keep groups together would destroy exactly that
 * evidence -- the picture would agree with the author by construction. The caption reports how
 * many runs the groups landed in instead, which is the answer to the question worth asking.
 *
 * @param spec   `[{ label, rows: [rowId] }]`
 * @param rowById id-to-index map for the row axis
 *
 * @example readGroups([{ label: 'scales', rows: ['size', 'effort'] }], byId).list[0].rows;  // [3, 7]
 */
function readGroups(spec, rowById) {
  const list = [];
  let unknown = 0;
  const arr = Array.isArray(spec) ? spec : [];
  arr.forEach((g, i) => {
    const o = g && typeof g === 'object' ? g : {};
    const members = [];
    const ids = Array.isArray(o.rows) ? o.rows : [];
    for (const id of ids) {
      const key = String(id);
      if (rowById.has(key)) members.push(rowById.get(key));
      else unknown++;
    }
    if (!members.length) return;
    list.push({ label: String(o.label == null ? 'group ' + (i + 1) : o.label), rows: members });
  });
  return { list, unknown };
}

/* -- the objective -------------------------------------------------------------------- */

/**
 * The profile distance between two axis members: the L1 distance between their vectors.
 *
 * For a binary matrix this is the Hamming distance -- the number of columns where exactly one
 * of the two rows has a mark. For a weighted one it is the total disagreement in weight. Two
 * rows that touch the same columns are at distance zero and want to be neighbours; a row full
 * of marks and an empty row are maximally far apart and want to be at opposite ends.
 *
 * @example dist([new Float64Array([1, 0]), new Float64Array([1, 1])], 0, 1);   // 1
 */
function dist(prof, a, b) {
  const A = prof[a];
  const B = prof[b];
  let s = 0;
  for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]);
  return s;
}

/**
 * The objective the improvement passes minimise: total profile distance between neighbours.
 *
 * This is the "bond energy" reading of a matrix. Summed over adjacent pairs down one axis it
 * says: how much does each member differ from the one drawn beside it? A low total means like
 * sits beside like, which is what produces visible blocks and a diagonal. It is a proxy, not
 * a truth -- it cannot tell a good story from a boring one -- but it is a proxy that can be
 * *measured*, so the caption can report what the seriation actually bought and a test can
 * assert that the passes never spent it.
 *
 * The single most useful property is that the two axes are separable. Row cost is a sum over
 * adjacent row pairs of a distance that runs across every column, and permuting the columns
 * permutes the terms of that inner sum without changing it. So reordering rows cannot change
 * the column cost and vice versa, and each axis can be optimised, guarded and reported on by
 * itself.
 *
 * @param order the axis order to score
 * @param prof  one profile vector per member, indexed by member id
 * @returns the total, zero for an axis with fewer than two members
 *
 * @example costOf([0, 1, 2], prof);   // 14
 */
function costOf(order, prof) {
  let s = 0;
  for (let i = 0; i + 1 < order.length; i++) s += dist(prof, order[i], order[i + 1]);
  return s;
}

/**
 * A precomputed symmetric distance table, or null when the axis is too big to afford one.
 *
 * The improvement passes ask for the same distance thousands of times; computing it O(m) deep
 * each time is what makes a naive implementation of this quadratic-with-a-big-constant. Past
 * {@link IMPROVE_CAP} members the table itself is the expensive thing, so it is refused and
 * the caller skips the passes and says so.
 *
 * @example distTable(prof).get(0, 1);   // 3
 */
function distTable(prof) {
  const n = prof.length;
  if (n > IMPROVE_CAP) return null;
  const T = new Float64Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const d = dist(prof, a, b);
      T[a * n + b] = d;
      T[b * n + a] = d;
    }
  }
  return { get(a, b) { return T[a * n + b]; } };
}

/* -- stage one: the two-sided barycentre sweep ---------------------------------------- */

/**
 * One axis reordered to the mean position of what it touches on the other axis.
 *
 * Weighted, when weights are present: a row that touches column 2 with weight 9 and column 30
 * with weight 1 belongs next to column 2, and an unweighted mean would put it in the middle
 * where it belongs to neither. Ties break on the member's *previous* position, which is what
 * makes the sweep deterministic and stable -- without it the result depends on the engine's
 * sort and two builds of the same data can differ.
 *
 * **Where an empty member sorts, and why.** A member that touches nothing has no barycentre;
 * there is no mean of an empty set. It is held out of the sort entirely and appended after
 * every member that does touch something, in the order it arrived. The alternative -- parking
 * it at the midpoint, which is what the hand-written tracker did -- puts a blank line through
 * the middle of the block structure the sweep just found, and a blank line inside a diagonal
 * reads as a boundary between two groups that is not there. The objection to the end is that
 * an empty row masquerades as an extreme of whatever scale the axis turned out to encode; the
 * answer is that the caption says out loud how many rows touch nothing and that they are held
 * at the end, so the reader is told rather than left to infer. Being told beats being fooled
 * by a fake boundary in the middle.
 *
 * It is also the only choice that cannot stop the sweep converging: empties never move, so
 * they can never oscillate.
 *
 * @param order      the axis order to permute
 * @param otherOrder the other axis's order, which supplies the positions
 * @param touch      `touch[i]` is `[[otherIndex, weight]]` for member `i`
 * @returns a new order; the input is not modified
 *
 * @example barycentre([0, 1], [0, 1], [[[1, 1]], [[0, 1]]]);   // [1, 0]
 */
function barycentre(order, otherOrder, touch) {
  const pos = new Map();
  for (let k = 0; k < otherOrder.length; k++) pos.set(otherOrder[k], k);
  const prev = new Map();
  for (let k = 0; k < order.length; k++) prev.set(order[k], k);

  const live = [];
  const dead = [];
  for (const i of order) {
    let s = 0;
    let m = 0;
    for (const [j, w] of touch[i]) {
      const p = pos.get(j);
      if (p === undefined) continue;
      s += p * w;
      m += w;
    }
    /* The division that would be by zero for an empty member never happens: `m` is a sum of
       strictly positive weights over present cells, so it is zero exactly when the member
       touches nothing, and that member goes to `dead` without a barycentre being computed. */
    if (m > 0) live.push([i, s / m]);
    else dead.push(i);
  }

  live.sort((a, b) => (a[1] - b[1]) || (prev.get(a[0]) - prev.get(b[0])));
  return live.map((x) => x[0]).concat(dead);
}

/**
 * Alternate barycentre passes until neither axis moves, or until the cap says stop.
 *
 * Each pass reorders the rows against the current column order and then the columns against
 * the *new* row order. Feeding the fresh row order straight into the column pass rather than
 * the stale one roughly halves the number of passes, and costs nothing.
 *
 * `sweeps` counts the passes that actually changed something. `converged` is true when a pass
 * changed nothing, which is a genuine fixed point; it is false when the cap ran out, which
 * happens on matrices where two members chase each other forever, and the caption says so
 * rather than implying the answer is settled.
 *
 * @param doRows whether the row axis may move; false when pinned or when `seriate` excludes it
 * @param doCols the same for columns
 *
 * @example sweepBoth([0, 1], [0, 1], true, true, rowTouch, colTouch).converged;   // true
 */
function sweepBoth(rowOrder, colOrder, doRows, doCols, rowTouch, colTouch) {
  let ro = rowOrder.slice();
  let co = colOrder.slice();
  let sweeps = 0;

  if (!doRows && !doCols) return { ro, co, sweeps: 0, converged: true };

  let converged = false;
  for (let p = 0; p < SWEEP_CAP; p++) {
    let changed = false;
    if (doRows) {
      const nx = barycentre(ro, co, rowTouch);
      if (!sameOrder(nx, ro)) { ro = nx; changed = true; }
    }
    if (doCols) {
      const nx = barycentre(co, ro, colTouch);
      if (!sameOrder(nx, co)) { co = nx; changed = true; }
    }
    if (!changed) { converged = true; break; }
    sweeps++;
  }

  return { ro, co, sweeps, converged };
}

/* -- stages two and three: local search ----------------------------------------------- */

/**
 * Swap adjacent pairs wherever it lowers the cost, until a whole pass finds nothing.
 *
 * Swapping the members at `i` and `i+1` changes exactly two terms of the sum -- the pair to
 * the left and the pair to the right -- because the term between the two swapped members is
 * symmetric and therefore identical afterwards. So a pass is O(n) distance lookups rather than
 * O(n) full recomputations of the objective.
 *
 * Only strict improvements are accepted, which is what makes this stage safe: the objective
 * can go down and can stay put, and there is no path by which it rises.
 *
 * @param o the order, permuted in place
 * @param D a distance table from {@link distTable}
 * @returns how many swaps were made
 *
 * @example swapPass(order, D);   // 11
 */
function swapPass(o, D) {
  let total = 0;
  for (let pass = 0; pass < 400; pass++) {
    let did = 0;
    for (let i = 0; i + 1 < o.length; i++) {
      const a = o[i];
      const b = o[i + 1];
      const L = i > 0 ? o[i - 1] : -1;
      const R = i + 2 < o.length ? o[i + 2] : -1;
      const before = (L >= 0 ? D.get(L, a) : 0) + (R >= 0 ? D.get(b, R) : 0);
      const after = (L >= 0 ? D.get(L, b) : 0) + (R >= 0 ? D.get(a, R) : 0);
      if (after < before - 1e-9) { o[i] = b; o[i + 1] = a; did++; }
    }
    total += did;
    if (!did) break;
  }
  return total;
}

/**
 * Lift each member out once and put it back wherever it fits best.
 *
 * Adjacent swaps cannot move a member past a neighbour that the move makes worse, even when
 * six places along there is a slot that makes everything better. Relocation is the cheapest
 * repair for that: removing a member closes the gap it leaves -- its two neighbours become
 * neighbours -- and inserting it elsewhere opens one, so the change in cost is six distance
 * lookups.
 *
 * One pass over the members, in their current order, which is what "a single-key relocation
 * pass" means. Only strict improvements are taken and the first best position wins, so the
 * result does not depend on iteration luck.
 *
 * @param o the order, permuted in place
 * @param D a distance table from {@link distTable}
 * @returns how many members were moved
 *
 * @example relocatePass(order, D);   // 3
 */
function relocatePass(o, D) {
  const keys = o.slice();
  let moves = 0;

  for (const k of keys) {
    if (o.length < 3) break;
    const i = o.indexOf(k);
    const L = i > 0 ? o[i - 1] : -1;
    const R = i + 1 < o.length ? o[i + 1] : -1;
    const saved =
      (L >= 0 ? D.get(L, k) : 0) + (R >= 0 ? D.get(k, R) : 0) -
      (L >= 0 && R >= 0 ? D.get(L, R) : 0);

    const rest = o.slice(0, i).concat(o.slice(i + 1));
    let bestGain = 0;
    let bestAt = -1;
    for (let j = 0; j <= rest.length; j++) {
      if (j === i) continue;                       // exactly where it already is
      const A = j > 0 ? rest[j - 1] : -1;
      const B = j < rest.length ? rest[j] : -1;
      const paid =
        (A >= 0 ? D.get(A, k) : 0) + (B >= 0 ? D.get(k, B) : 0) -
        (A >= 0 && B >= 0 ? D.get(A, B) : 0);
      const gain = saved - paid;
      if (gain > bestGain + 1e-9) { bestGain = gain; bestAt = j; }
    }

    if (bestAt < 0) continue;
    rest.splice(bestAt, 0, k);
    o.length = 0;
    for (const v of rest) o.push(v);
    moves++;
  }

  return moves;
}

/**
 * The full local search: swaps to a local optimum, one relocation pass, swaps again.
 *
 * The second swap run is not decoration. A relocation drops a member into a slot chosen
 * against its two new neighbours only; the members around it may now want to shuffle, and
 * that shuffle is exactly what an adjacent-swap pass does. It is cheap -- it usually finds
 * nothing -- and it can only help, because every stage here accepts strict improvements only.
 *
 * @example improve([0, 1, 2], D).swaps;   // 1
 */
function improve(order, D) {
  const o = order.slice();
  let swaps = swapPass(o, D);
  const moves = relocatePass(o, D);
  swaps += swapPass(o, D);
  return { order: o, swaps, moves };
}

/* -- putting an ordering together ----------------------------------------------------- */

/**
 * One axis's final order, plus everything the caption has to be able to say about it.
 *
 * The last step is a monotonicity guard, and it earns its place. A barycentre sweep optimises
 * crossings, not profile distance, so it *can* hand back an order that scores worse on the
 * stated objective than the order the author gave -- rarely, but a matrix card that sometimes
 * makes the picture worse and calls it seriation would be lying. So the swept-and-improved
 * order is scored against the given one and the loser is discarded. The card then reports
 * which happened. "Your order was already better" is a legitimate and interesting answer.
 *
 * Empty members are held out of the improvement passes as well as the sweep, so the promise
 * made in {@link barycentre} -- empties at the end -- survives all three stages rather than
 * being quietly undone by a relocation.
 *
 * @param given  the author's order for this axis
 * @param swept  the order the barycentre sweep produced
 * @param prof   profile vectors, for scoring
 * @param mass   `mass[i] > 0` for a member that touches something
 * @param active whether this axis was allowed to move at all
 * @returns `{ order, before, after, swaps, moves, kept, skipped, empties }`
 *
 * @example settle([0, 1], [1, 0], prof, [1, 1], true).kept;   // false
 */
function settle(given, swept, prof, mass, active) {
  const before = costOf(given, prof);
  if (!active) {
    return { order: given.slice(), before, after: before, swaps: 0, moves: 0, kept: true, skipped: false, empties: 0 };
  }

  const live = swept.filter((i) => mass[i] > 0);
  const dead = swept.filter((i) => !(mass[i] > 0));

  const D = distTable(prof);
  let swaps = 0;
  let moves = 0;
  let order;
  if (D && live.length > 2) {
    const got = improve(live, D);
    swaps = got.swaps;
    moves = got.moves;
    order = got.order.concat(dead);
  } else {
    order = live.concat(dead);
  }

  const after = costOf(order, prof);
  if (after > before + 1e-9) {
    return { order: given.slice(), before, after: before, swaps, moves, kept: true, skipped: !D, empties: dead.length };
  }
  return { order, before, after, swaps, moves, kept: false, skipped: !D, empties: dead.length };
}

/**
 * How many contiguous runs the row groups came out in.
 *
 * A group of six rows that lands as one run of six is a group the ordering agrees with; the
 * same group as six runs of one is a grouping the data does not support. Since nothing in the
 * seriation is ever told about the groups, this number is a real result rather than a
 * restatement of the input.
 *
 * @example runsOf([{ rows: [0, 1] }], [0, 1, 2]);   // 1
 */
function runsOf(groups, order) {
  const pos = new Map();
  order.forEach((v, i) => pos.set(v, i));
  let runs = 0;
  for (const g of groups) {
    /* Deduped before counting: a row listed twice in one group is one seat, and counting it
       twice would report a break in a run that is not there. */
    const seats = [...new Set(g.rows.map((r) => pos.get(r)))]
      .filter((p) => p !== undefined).sort((a, b) => a - b);
    if (!seats.length) continue;
    runs++;
    for (let i = 1; i < seats.length; i++) if (seats[i] !== seats[i - 1] + 1) runs++;
  }
  return runs;
}

/**
 * Build the complete plan for one value of the `seriate` setting.
 *
 * All four are built, because `seriate` is a viewer setting and the seriation is a build-time
 * computation: precomputing every answer is what lets the browser switch between them without
 * the card either recomputing a sweep per click or shipping the algorithm twice.
 *
 * A pin beats the setting. `pinRows` says this axis has an order that must be kept -- a
 * release train, a fiscal calendar, a rank -- and a viewer flipping `seriate` to `both` must
 * not be able to destroy it. Pinning one axis and sweeping the other is the common case, not
 * a degenerate one.
 *
 * @param mode one of `both`, `rows`, `cols`, `none`
 * @param R    the output of {@link readData}
 * @returns `{ rows, cols, note, aria, stats }`
 *
 * @example planFor('rows', read).stats.sweeps;   // 4
 */
function planFor(mode, R) {
  const givenRows = R.rows.map((_, i) => i);
  const givenCols = R.cols.map((_, i) => i);

  const doRows = (mode === 'both' || mode === 'rows') && !R.pinRows;
  const doCols = (mode === 'both' || mode === 'cols') && !R.pinCols;

  const s = sweepBoth(givenRows, givenCols, doRows, doCols, R.rowTouch, R.colTouch);

  /* Column profiles are the transpose, materialised once per plan rather than indexed
     through `M[r][c]` inside the inner loop of a quadratic pass. */
  const colProf = [];
  for (let c = 0; c < R.nC; c++) {
    const v = new Float64Array(R.nR);
    for (let r = 0; r < R.nR; r++) v[r] = R.M[r][c];
    colProf.push(v);
  }

  const rowSettled = settle(givenRows, s.ro, R.M, R.rowMass, doRows);
  const colSettled = settle(givenCols, s.co, colProf, R.colMass, doCols);

  const stats = {
    mode,
    sweeps: s.sweeps,
    converged: s.converged,
    doRows, doCols,
    rowsPinned: R.pinRows,
    colsPinned: R.pinCols,
    costBefore: n(rowSettled.before + colSettled.before, 'cost'),
    costAfter: n(rowSettled.after + colSettled.after, 'cost'),
    swaps: rowSettled.swaps + colSettled.swaps,
    moves: rowSettled.moves + colSettled.moves,
    keptGivenRows: rowSettled.kept && doRows,
    keptGivenCols: colSettled.kept && doCols,
    skipped: rowSettled.skipped || colSettled.skipped,
    emptyRows: R.rowMass.filter((m) => !(m > 0)).length,
    emptyCols: R.colMass.filter((m) => !(m > 0)).length,
    groupRuns: runsOf(R.groups.list, rowSettled.order),
  };

  const said = describe(R, stats);
  return { rows: rowSettled.order, cols: colSettled.order, note: said.note, aria: said.aria, stats };
}

/* -- saying what the picture shows ---------------------------------------------------- */

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire picture to anyone using
 * it. "Incidence matrix" is therefore not an acceptable answer -- it names the genre and
 * withholds the content. This gives the census first (how big, how full), then what the
 * seriation did and whether it settled, then the two things a reader would otherwise have to
 * infer from a blank band: how many members touch nothing, and where they went.
 *
 * The note is plain text because the browser sets it with `textContent` when the viewer
 * changes `seriate`; the caption around it carries the markup and is built once, here, from
 * escaped data.
 *
 * @returns `{ aria, note }`, both plain text
 *
 * @example describe(read, stats).note;
 * // 'both axes seriated: 7 sweeps, converged; ...'
 */
function describe(R, S) {
  const pct = R.possible ? Math.round((R.filled / R.possible) * 100) : 0;
  const census =
    plural(R.nR, 'row', 'rows') + ' by ' + plural(R.nC, 'column', 'columns') + ', ' +
    R.filled + ' of ' + R.possible + ' cells filled (' + pct + '%)' +
    (R.weighted ? ', weighted' : ', binary');

  if (!R.nR || !R.nC) {
    return {
      aria: 'An empty incidence matrix: ' + census + '. There is nothing to seriate.',
      note: 'nothing to seriate.',
    };
  }
  if (!R.filled) {
    return {
      aria: 'Incidence matrix, ' + census + '. Every row and every column is empty, so no ' +
            'ordering carries information and the given order stands.',
      note: 'no cells at all, so every member is empty and the given order stands.',
    };
  }

  const which =
    !S.doRows && !S.doCols ? 'given order kept'
    : S.doRows && S.doCols ? 'both axes seriated'
    : S.doRows ? (S.colsPinned ? 'columns pinned, rows seriated' : 'rows seriated, columns left alone')
    : (S.rowsPinned ? 'rows pinned, columns seriated' : 'columns seriated, rows left alone');

  const drop = S.costBefore > 0 ? Math.round((1 - S.costAfter / S.costBefore) * 100) : 0;

  /* Zero productive sweeps is a real and reportable answer -- the order handed in was already
     a barycentre fixed point -- and "0 sweeps, converged" is a confusing way to say it. */
  const swept = S.sweeps === 0
    ? 'the order given was already a barycentre fixed point'
    : plural(S.sweeps, 'sweep', 'sweeps') + ', ' +
      (S.converged ? 'converged' : 'did not converge within ' + SWEEP_CAP + ' sweeps');

  const work =
    !S.doRows && !S.doCols ? ''
    : ' ' + swept +
      (S.skipped
        ? '; the improvement passes were skipped, this matrix is too large for them'
        : '; ' + plural(S.swaps, 'swap', 'swaps') + ' and ' + plural(S.moves, 'relocation', 'relocations')) +
      '. adjacency cost ' + S.costBefore + ' to ' + S.costAfter +
      (drop > 0 ? ', down ' + drop + '%' : drop < 0 ? ', up ' + (-drop) + '%' : ', unchanged') + '.';

  const kept =
    S.keptGivenRows && S.keptGivenCols ? ' neither axis beat the order you gave, so both stand.'
    : S.keptGivenRows ? ' the rows you gave already scored better, so that order stands.'
    : S.keptGivenCols ? ' the columns you gave already scored better, so that order stands.'
    : '';

  /* The verb agrees with the total number of empty members, not with the last noun in the
     list: "1 row and 1 column touch nothing" is two members and takes the plural, while
     "1 row touches nothing" is one and does not. */
  const emptyCount = S.emptyRows + S.emptyCols;
  const empties = emptyCount
    ? ' ' + [S.emptyRows ? plural(S.emptyRows, 'row', 'rows') : '',
             S.emptyCols ? plural(S.emptyCols, 'column', 'columns') : '']
        .filter(Boolean).join(' and ') +
      (emptyCount === 1 ? ' touches' : ' touch') +
      ' nothing; ' + (emptyCount === 1 ? 'it carries' : 'they carry') +
      ' no barycentre and ' + (emptyCount === 1 ? 'is' : 'are') + ' held at the end.'
    : '';

  const nGroups = R.groups.list.length;
  const runs = S.groupRuns === 1 ? 'a single run' : S.groupRuns + ' runs';
  const groups = !nGroups ? ''
    : nGroups === 1
      ? ' the row group came out in ' + runs +
        (S.groupRuns === 1 ? ', so the ordering agrees with it.' : '.')
      : ' the ' + nGroups + ' row groups came out in ' + runs +
        (S.groupRuns === nGroups ? ', one each, so the ordering agrees with them.' : '.');

  const note = which + ':' + work + kept + empties + groups;

  const aria =
    'Incidence matrix, ' + census + '. ' +
    which.charAt(0).toUpperCase() + which.slice(1) + '.' + work + kept + empties + groups;

  return { aria: aria.replace(/\s+/g, ' ').trim(), note: note.replace(/\s+/g, ' ').trim() };
}

/* -- emit ----------------------------------------------------------------------------- */

/**
 * The card's id as it may appear inside a double-quoted CSS attribute selector.
 *
 * The id becomes a directory name and is not viewer-supplied, but it is still a string this
 * file did not write, and a quote in it would end the selector early and leave the rest of the
 * stylesheet as garbage the browser skips silently.
 *
 * @example cssId('a"b');   // 'a\\"b'
 */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-matrix[data-card="' + cssId(id) + '"]';
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
 * thing that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 *
 * The two `:root[data-theme="light"]` rules lift the washes rather than recolour them, for the
 * reason the hand-written tracker discovered: ink at five per cent over white is fainter than
 * ink at five per cent over near-black, so holding opacity constant across the switch loses
 * the band and the accent wash entirely in light mode. The hues stay put; only the strength
 * moves.
 */
function cardCss(id) {
  const own = '.ck-matrix[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    /* The scroller owns both axes. A wide matrix scrolls itself and a tall one scrolls inside
       its own box, so neither ever moves the desk column sideways or grows the card without
       limit -- and the cells keep the size the viewer asked for either way. */
    ['.ck-mx-scroll', 'max-height: 72vh; overflow-y: auto; margin-top: 2px;'],

    ['svg.ck-mx', 'display: block; width: 100%; height: auto;'],
    ['svg.ck-mx text', 'font-family: var(--mono);'],

    ['.ck-mx .cell', 'fill: var(--ink-dim);'],
    ['.ck-mx .band', 'fill: var(--ink); opacity: .05;'],

    /* The flagged-column wash sits under the squares and must never be mistaken for one, so
       it is the accent at a fraction of the strength the accent is used at anywhere else. */
    ['.ck-mx .wash', 'fill: var(--accent); opacity: .13;'],

    ['.ck-mx .ax', 'fill: var(--ink-dim);'],
    ['.ck-mx .axf', 'fill: var(--ink-faint);'],
    ['.ck-mx .rule', 'stroke: var(--rule); stroke-width: 1; fill: none;'],

    ['.ck-mx-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],

    ['.ck-legend i.sw-cell', 'background: var(--ink-dim);'],
    ['.ck-legend i.sw-wash', 'background: var(--accent); opacity: .35;'],

    /* A checkbox or number inherits the panel's full-width input rule and comes out stretched;
       these want to be their own size, at the start of their column. */
    ['.ck-set input[type="number"]', 'width: 6.5em;'],
  ];

  for (let i = 1; i <= 8; i++) {
    rules.push(['.ck-mx .grp[data-s="' + i + '"]', 'fill: var(--ck-s' + i + ');']);
    rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
  }

  return scope(id, rules) + '\n' +
    ':root[data-theme="light"] ' + own + ' .ck-mx .band { opacity: .07; }\n' +
    ':root[data-theme="light"] ' + own + ' .ck-mx .wash { opacity: .17; }\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the matrix and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The caption's markup is written here from
 * literals with escaped data inside it; the one part that changes with the settings is an
 * empty `<span>` the script fills with `textContent`, so nothing untrusted is ever parsed as
 * markup in the browser.
 */
function cardHtml(id, title, R, plan) {
  const e = CK.esc;
  const pct = R.possible ? Math.round((R.filled / R.possible) * 100) : 0;

  const junk = [];
  if (R.drop.dupe) junk.push(plural(R.drop.dupe, 'duplicate entry', 'duplicate entries') + ' deduped');
  if (R.drop.badRef) junk.push(plural(R.drop.badRef, 'cell', 'cells') + ' named a row or column that does not exist');
  if (R.drop.badWeight) junk.push(plural(R.drop.badWeight, 'cell', 'cells') + ' had no usable weight');
  if (R.groups.unknown) junk.push(plural(R.groups.unknown, 'group member', 'group members') + ' named an unknown row');

  const legend = [];
  legend.push('<span><i class="sw-cell"></i>' +
              (R.weighted ? 'weight, darker is more' : 'cell present') + '</span>');
  if (R.cols.some((c) => c.accent)) {
    legend.push('<span><i class="sw-wash"></i>flagged column</span>');
  }
  R.groups.list.forEach((g, i) => {
    legend.push('<span><i data-s="' + ((i % 8) + 1) + '"></i>' + e(g.label) + '</span>');
  });

  const empty = !R.nR || !R.nC
    ? '  <div class="ck-mx-void">nothing to draw &mdash; this matrix has ' +
      (!R.nR && !R.nC ? 'no rows and no columns' : !R.nR ? 'no rows' : 'no columns') + '</div>\n'
    : '';

  const svg = !R.nR || !R.nC ? '' :
    '  <div class="ck-scroll ck-mx-scroll">\n' +
    '    <svg class="ck-mx" role="img" viewBox="0 0 100 100" aria-label="' + e(plan.aria) + '"></svg>\n' +
    '  </div>\n';

  return '<section data-card="' + e(id) + '" class="ck-matrix">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-seriate">seriate</label>\n' +
    '    <select id="' + e(id) + '-seriate" name="seriate">\n' +
    SERIATE_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <select id="' + e(id) + '-labels" name="labels">\n' +
    LABEL_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-cell">cell (px)</label>\n' +
    '    <input type="number" id="' + e(id) + '-cell" name="cell" min="' + CELL_MIN +
    '" max="' + CELL_MAX + '" step="1">\n' +
    '    <div class="ck-set-foot">' +
    (R.pinRows || R.pinCols
      ? e((R.pinRows && R.pinCols ? 'both axes are' : R.pinRows ? 'the row axis is' : 'the column axis is') +
          ' pinned by this card\u2019s data, so seriate cannot move it. ')
      : '') +
    'cells never shrink below ' + CELL_MIN + 'px; a matrix too wide for the column scrolls instead.' +
    '</div>\n' +
    '  </div>\n' +
    empty + svg +
    '  <div class="ck-cap"><b>' + e(String(R.filled)) + '</b> of ' + e(String(R.possible)) +
    ' cells filled (' + pct + '%) across ' + e(plural(R.nR, 'row', 'rows')) + ' and ' +
    e(plural(R.nC, 'column', 'columns')) + '. <i class="ck-mx-note">' + e(plan.note) + '</i>' +
    (junk.length ? ' <span class="ck-aside">' + e(junk.join('; ')) + '.</span>' : '') +
    '</div>\n' +
    (legend.length ? '  <div class="ck-legend">' + legend.join('') + '</div>\n' : '') +
    '</section>\n';
}

/**
 * The browser half: lay squares on a grid at the size the viewer asked for.
 *
 * Classic script, ES5 vocabulary, no template literals and no arrow functions -- this is
 * concatenated into a page that ships no transpiler, and one modern-syntax parse error takes
 * the whole desk down rather than one card.
 *
 * Nothing here decides anything about the matrix. The four orderings, the opacities, the
 * degrees, the label widths and both sentences were computed in Node; the script picks the
 * plan the settings name and turns it into elements. The only arithmetic left is the grid,
 * which genuinely cannot be precomputed because `cell` is a viewer setting.
 *
 * The three settings are re-validated on the way in. They come out of `localStorage`, which is
 * a text file the viewer can edit, and a mode read straight out of it and used as a property
 * name would reach `Object.prototype` on the string `constructor`.
 */
function cardJs(id, model, inst) {
  return `/* matrix card: four precomputed orderings, one grid, no seriation in the browser. */
CK.build(${jsonLit(id)}, function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var M = ${jsonLit(model)};
  var DEF = ${jsonLit(inst)};

  /* Both may be absent: a matrix with no rows or no columns draws nothing and says so in
     markup instead. The script still runs, because the gear and its panel are wired by
     CK.settings and a card whose settings silently stopped opening would be a worse bug than
     an empty matrix. */
  var box = sec.querySelector("svg.ck-mx");
  var note = sec.querySelector(".ck-mx-note");

  /* One element, attributes set from a plain object. Text goes in with textContent, never
     innerHTML: every label here is data the card did not write. */
  function el(t, a, txt) {
    var e = document.createElementNS(NS, t), k;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function r1(v) { return Math.round(v * 10) / 10; }

  /* A setting out of localStorage is a string the viewer could have typed. Checked against
     the allowed list by hasOwn rather than by lookup, so "constructor" cannot select a plan
     off Object.prototype. */
  function pick(v, table, fallback) {
    return typeof v === "string" && Object.hasOwn(table, v) ? v : fallback;
  }

  function draw(cfg) {
    var mode = pick(cfg.seriate, M.modes, DEF.seriate);
    var lab = pick(cfg.labels, M.labels, DEF.labels);
    if (note) { note.textContent = M.modes[mode].note; }
    if (!box || !M.nR || !M.nC) { return; }

    var cell = Math.round(Number(cfg.cell));
    if (!isFinite(cell)) { cell = DEF.cell; }
    if (cell < M.cellMin) { cell = M.cellMin; }
    if (cell > M.cellMax) { cell = M.cellMax; }

    var P = M.modes[mode];
    var showRows = lab !== "none";
    var showCols = lab === "both";

    var gutL = showRows ? M.rowLabW + 12 : 6;
    var gutR = showRows ? M.rowDegW + 10 : 6;
    var headT = showCols ? M.colLabW + 8 : 6;
    var footB = showCols ? M.colDegW + 8 : 6;

    var nR = M.nR, nC = M.nC;
    var W = gutL + nC * cell + gutR;
    var H = headT + nR * cell + footB;

    /* Row labels are stacked one per cell, so their size is bounded by the cell and not the
       other way round. Nine and a half is the face's comfortable size; below that the text
       shrinks with the grid rather than overlapping it, and it never goes under seven. */
    var fs = Math.max(7, Math.min(9.5, cell - 3.5));
    var side = Math.max(3, cell - 3.5);

    var rpos = [], cpos = [], i, k;
    for (i = 0; i < P.rows.length; i++) { rpos[P.rows[i]] = i; }
    for (i = 0; i < P.cols.length; i++) { cpos[P.cols[i]] = i; }

    function cx(j) { return gutL + j * cell + cell / 2; }
    function cy(j) { return headT + j * cell + cell / 2; }

    var frag = document.createDocumentFragment();

    /* Alternating band first, then the flagged-column wash, then the squares. Order is the
       whole z-stack: SVG has no z-index and the last thing appended is the thing on top. */
    for (i = 0; i < nR; i += 2) {
      frag.appendChild(el("rect", { "class": "band", x: gutL, y: r1(headT + i * cell),
                                    width: nC * cell, height: cell }));
    }

    for (i = 0; i < nC; i++) {
      if (!M.accent[P.cols[i]]) { continue; }
      frag.appendChild(el("rect", { "class": "wash", x: r1(cx(i) - cell / 2), y: 0,
                                    width: cell, height: r1(H) }));
    }

    for (i = 0; i < M.cells.length; i++) {
      var c = M.cells[i];
      var x = cx(cpos[c[1]]), y = cy(rpos[c[0]]);
      var sq = el("rect", { "class": "cell", x: r1(x - side / 2), y: r1(y - side / 2),
                            width: r1(side), height: r1(side),
                            "fill-opacity": c[2] });
      sq.appendChild(el("title", null,
        M.rowLab[c[0]] + " \\u00b7 " + M.colLab[c[1]] + (c[3] == null ? "" : " \\u00b7 " + CK.fmt(c[3]))));
      frag.appendChild(sq);
    }

    frag.appendChild(el("line", { "class": "rule", x1: gutL, y1: r1(headT - 0.5),
                                  x2: r1(gutL + nC * cell), y2: r1(headT - 0.5) }));
    frag.appendChild(el("line", { "class": "rule", x1: gutL, y1: r1(headT + nR * cell + 0.5),
                                  x2: r1(gutL + nC * cell), y2: r1(headT + nR * cell + 0.5) }));

    if (showRows) {
      for (i = 0; i < nR; i++) {
        var ri = P.rows[i], ry = r1(cy(i) + fs * 0.35);
        frag.appendChild(el("text", { "class": "ax", x: r1(gutL - 9), y: ry,
                                      "text-anchor": "end", "font-size": r1(fs) },
                            M.rowClip[ri]));
        frag.appendChild(el("text", { "class": "axf", x: r1(W - 3), y: ry,
                                      "text-anchor": "end", "font-size": r1(fs) },
                            M.rowDeg[ri]));
      }
      /* Group tabs ride in the gutter between the label and the grid. They are an annotation
         the seriation was never told about, so a group that comes out as one run is a real
         result rather than a restatement of the input. */
      for (i = 0; i < M.groups.length; i++) {
        var g = M.groups[i];
        for (k = 0; k < g.rows.length; k++) {
          frag.appendChild(el("rect", { "class": "grp", "data-s": g.s,
                                        x: r1(gutL - 5), y: r1(headT + rpos[g.rows[k]] * cell + 1),
                                        width: 3, height: r1(cell - 2) }));
        }
      }
    }

    if (showCols) {
      for (i = 0; i < nC; i++) {
        var ci = P.cols[i], tx = r1(cx(i) + fs * 0.35), ty = r1(headT - 6);
        var t = el("text", { "class": M.accent[ci] ? "ax" : "axf", x: tx, y: ty,
                             "text-anchor": "start", "font-size": r1(fs),
                             transform: "rotate(-90 " + tx + " " + ty + ")" }, M.colClip[ci]);
        t.appendChild(el("title", null, M.colLab[ci]));
        frag.appendChild(t);

        var by = r1(headT + nR * cell + 6);
        frag.appendChild(el("text", { "class": "axf", x: tx, y: by, "text-anchor": "end",
                                      "font-size": r1(fs),
                                      transform: "rotate(-90 " + tx + " " + by + ")" },
                            M.colDeg[ci]));
      }
    }

    while (box.firstChild) { box.removeChild(box.firstChild); }
    box.appendChild(frag);
    box.setAttribute("viewBox", "0 0 " + r1(W) + " " + r1(H));
    box.setAttribute("aria-label", P.aria);
    /* The cells keep the size that was asked for: below this width the scroll container
       scrolls rather than the squares shrinking. Above it the matrix scales up, which is
       harmless -- a bigger square is still a square. */
    box.style.minWidth = Math.ceil(W) + "px";
  }

  CK.settings(sec, DEF, draw);
});
`;
}

/**
 * Build one matrix card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` is the card's `card.json` as an object and
 *          carries the seriation's own numbers, so a test or a reader can check what the
 *          caption claims without re-running the sweep
 *
 * @throws {Error} when the arithmetic produces a non-finite number, which means a bug here
 *                 rather than bad input: malformed cells are counted and dropped while reading
 * @throws {Error} from {@link guardEmitted} when the emitted script would break the desk -- a
 *                 backtick, an arrow, an optional chain, a `const` / `let` / `class`, or a
 *                 control character. Refusing at build time is the point: the alternative is a
 *                 parse error in the one inline block every card's script shares
 *
 * @example
 * build({
 *   id: 'tracker',
 *   title: 'labels against issues, both axes seriated',
 *   data: {
 *     rows: [{ id: 'enhancement' }, { id: 'bug' }],
 *     cols: [{ id: '7', label: '#7' }, { id: '8', label: '#8', accent: true }],
 *     cells: [[0, 0], [0, 1], [1, 1]],
 *     seriate: 'both',
 *   },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'matrix' : id);
  const R = readData(data);

  const modes = {};
  for (const m of SERIATE_MODES) modes[m] = planFor(m, R);

  /* Weight to opacity through the real `CK.scale`, whose zero-width-domain guard is what
     keeps an all-equal weight set from dividing by zero -- it parks every cell at the
     midpoint of the range, which is exactly right for "every weight is the same". The floor
     is 0.3 rather than 0: a cell present with the lightest weight is still a fact, and a fact
     drawn at zero opacity is a fact the reader is not told. */
  const toOpacity = CK.scale([R.wLo, R.wHi], [0.3, 1]);

  const cells = [];
  for (let r = 0; r < R.nR; r++) {
    for (let c = 0; c < R.nC; c++) {
      const w = R.M[r][c];
      if (w <= 0) continue;
      cells.push([r, c, R.weighted ? n(toOpacity(w), 'opacity') : 1, R.weighted ? n(w, 'weight') : null]);
    }
  }

  const rowClip = R.rows.map((r) => clip(r.label, ROW_LAB_MAX));
  const colClip = R.cols.map((c) => clip(c.label, COL_LAB_MAX));
  const rowDeg = R.rows.map((_, i) => (R.weighted ? CK.fmt(R.rowMass[i]) : String(R.rowDeg[i])));
  const colDeg = R.cols.map((_, i) => (R.weighted ? CK.fmt(R.colMass[i]) : String(R.colDeg[i])));

  const widest = (list) => list.reduce((m, s) => Math.max(m, textW(s)), 0);

  const model = {
    nR: R.nR,
    nC: R.nC,
    cellMin: CELL_MIN,
    cellMax: CELL_MAX,
    rowLab: R.rows.map((r) => r.label),
    colLab: R.cols.map((c) => c.label),
    rowClip, colClip, rowDeg, colDeg,
    accent: R.cols.map((c) => (c.accent ? 1 : 0)),
    /* Label gutters are measured from the text that has to fit rather than fixed, and they do
       not depend on `cell`, so they can be settled here and used at any cell size. */
    rowLabW: n(Math.min(ROW_LAB_MAX, widest(rowClip)), 'rowLabW'),
    colLabW: n(Math.min(COL_LAB_MAX, widest(colClip)), 'colLabW'),
    rowDegW: n(widest(rowDeg), 'rowDegW'),
    colDegW: n(widest(colDeg), 'colDegW'),
    cells,
    groups: R.groups.list.map((g, i) => ({ s: (i % 8) + 1, rows: g.rows })),
    labels: { both: 1, rows: 1, none: 1 },
    modes: {},
  };
  for (const m of SERIATE_MODES) {
    model.modes[m] = { rows: modes[m].rows, cols: modes[m].cols, note: modes[m].note, aria: modes[m].aria };
  }

  /* The instance's own fallbacks. Same key set as the exported `defaults` -- which is what a
     validator checks -- but `seriate` starts where this card's data said it should, so a
     matrix authored around a pinned axis opens showing that and not something else. */
  const inst = { seriate: R.given, labels: defaults.labels, cell: defaults.cell };

  const active = modes[R.given];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'matrix',
      rows: R.nR,
      cols: R.nC,
      filled: R.filled,
      weighted: R.weighted,
      dropped: R.drop,
      seriation: {
        mode: R.given,
        sweeps: active.stats.sweeps,
        converged: active.stats.converged,
        costBefore: active.stats.costBefore,
        costAfter: active.stats.costAfter,
        swaps: active.stats.swaps,
        moves: active.stats.moves,
        keptGivenRows: active.stats.keptGivenRows,
        keptGivenCols: active.stats.keptGivenCols,
        emptyRows: active.stats.emptyRows,
        emptyCols: active.stats.emptyCols,
        groupRuns: active.stats.groupRuns,
        improvementSkipped: active.stats.skipped,
      },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active),
    css: cardCss(cardId),
    js: guardEmitted(cardJs(cardId, model, inst), cardId),
  };
}
