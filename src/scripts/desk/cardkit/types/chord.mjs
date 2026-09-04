/**
 * `chord` -- flows between one set of entities, drawn as arcs on a circle joined by ribbons.
 *
 * A chord diagram is the picture for a square matrix whose two axes are the same list: who sent
 * how much to whom. The circle is not decoration -- it is the only layout in which every pair of
 * entities is equally close, so no pair is privileged by being adjacent on a line.
 *
 * Three decisions in here are the whole card, and each one has a wrong answer that looks fine:
 *
 *   1. **An asymmetric pair gets ONE ribbon with two different widths.** The pair {i, j} is drawn
 *      once, taking `matrix[i][j]` of arc i and `matrix[j][i]` of arc j. Averaging the two -- the
 *      obvious way to make a ribbon that is easy to draw -- destroys the only asymmetry the data
 *      has, and a one-way flow would come out looking mutual. Drawn honestly, a flow that goes
 *      entirely one way tapers to a point at the receiving end, which reads as an arrowhead and
 *      is exactly right.
 *   2. **The diagonal is kept, counted once, and drawn as a petal on the entity's own arc.**
 *      A self-loop is a real thing -- a team that reassigns to itself, a country that trades
 *      internally, a state machine that transitions to itself. Dropping it silently shortens that
 *      entity's arc and every other arc's share of the circle changes with it, so the picture
 *      moves for a reason nothing in it explains. Counting it twice (once out, once in) is the
 *      other tempting answer and it breaks the exact-fill property: the slices on an arc would no
 *      longer add up to the arc.
 *   3. **The arc order is chosen to reduce ribbon crossings, and then scored against the order
 *      you gave.** A sweep that optimises a proxy can and does hand back something worse than the
 *      author's order; a card that sometimes made the picture worse and called it optimisation
 *      would be lying. The loser is discarded and the caption says which won.
 *
 * All of the counting, the ordering and the ribbon widths are settled here, in Node, at build
 * time. `padAngle` is a viewer setting and genuinely cannot be precomputed, so the geometry
 * itself ships to the browser as {@link chordGeom} -- emitted through `Function.prototype
 * .toString()` so the function a test calls in Node is textually the function the page runs. A
 * Node-shaped twin of a browser function eventually disagrees with it.
 *
 * @see ./matrix.mjs -- the same discipline: sweep, score against the given order, keep the winner
 * @see ./arc.mjs -- the same crossing objective on a line instead of a circle
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
  catch (e) { throw new Error('cardkit/chord: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/chord: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed.
   They only decide how much room the ring of labels gets, so a hair pessimistic costs a few
   pixels of margin -- the safe way to be wrong. */
const CHW = 5.42;

/** Outer radius of the arc band, in user units. The viewBox scales, so this is a ratio, not a size. */
const R_OUT = 120;

/** Thickness of the arc band. Thin enough to read as a rule, thick enough to carry a colour. */
const BAND = 11;

/** The longest an entity name may be before it is clipped, in px at the label size. */
const LAB_MAX = 92;

/** The three things `sort` may say. */
const SORT_MODES = ['given', 'total', 'crossings'];

/** Past this many ribbons the crossing search is skipped and the caption says so. */
const CROSS_CAP = 3200;

/** Relocation is quadratic in entities on top of a quadratic count; past this it is skipped. */
const RELOCATE_CAP = 22;

/** How many barycentre passes before we stop and report that it did not settle. */
const SWEEP_CAP = 48;

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it. Six types in this catalogue independently exported `defaults` as a separate binding
 * and never put it on `meta`, and every validator failed them.
 *
 * @example defaults.sort;   // 'crossings'
 */
export const defaults = { sort: 'crossings', padAngle: 2, labels: true };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * `shape` is a string on purpose: it is read by a person deciding what to feed the card, and it
 * has to read at a glance.
 *
 * @example meta.name;   // 'chord'
 */
export const meta = {
  name: 'chord',
  summary:
    'Flows between one set of entities as arcs on a circle joined by ribbons, with the arc ' +
    'order chosen to reduce crossings and scored against the order you gave.',
  shape:
    "{ names: [string], matrix: [[number]], directed: boolean, unit: string } -- " +
    'matrix must be square and the same size as names; matrix[i][j] is the flow from i to j; ' +
    'the diagonal is a self-loop and is kept; when directed, one ribbon per pair carries a ' +
    'different width at each end',
  category: 'flow-and-relationship',
  defaults: { ...defaults },
};

/* -- small shared arithmetic ----------------------------------------------------------- */

/**
 * Round a number to two decimals, refusing to emit one that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console. Failing loudly at build time turns that into a stack trace
 * next to the input that caused it, which is the difference between a bug and a mystery.
 *
 * @param v    the number
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(0.33333, 'radius');   // 0.33
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/chord: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
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

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` and `>` become escapes so a name containing `</script>` cannot close the block early, and
 * so no name can ever put `=>` into a file that is contractually free of arrow functions. The
 * question mark goes too, so a name reading "really?.ok" cannot look like optional chaining to
 * the guard -- the guard scans raw text on purpose and would otherwise refuse honest data. The
 * backtick goes for the same contract, and the two line separators because they are newlines to
 * a JS parser and not to `JSON.stringify`.
 *
 * @example jsonLit({ name: '</script>' });   // '{"name":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(/[`]/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The card's id as it may appear inside a double-quoted CSS attribute selector.
 *
 * The id becomes a directory name and is not viewer-supplied, but it is still a string this file
 * did not write, and a quote in it would end the selector early and leave the rest of the
 * stylesheet as garbage the browser skips silently.
 *
 * @example cssId('a"b');   // 'a\\"b'
 */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-chord[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/* -- the build-time guard -------------------------------------------------------------- */

/**
 * Blank comment and string bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose -- one card in this
 * catalogue was refused because a comment said "the class is what CSS reads". Offsets are
 * preserved so a reported position still means something. Regex literals are recognised too,
 * because otherwise the scanner desyncs on the quote in `replace(/'/g, x)` and blanks real code,
 * turning a false positive into the far worse false negative.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment and string contents replaced by spaces
 *
 * @example blankLiterals('var s = "const";').indexOf('const');   // -1
 */
function blankLiterals(src) {
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

/** Where an offset falls, said the way a stack trace would say it. */
function atOffset(src, off) {
  return 'line ' + (src.slice(0, off).split('\n').length) + ', offset ' + off;
}

/**
 * Refuse to emit a script that would take the whole desk down.
 *
 * Every card's script is concatenated into ONE inline block, so a single modern-syntax token in
 * one card is a parse error that blanks every card on the page. The hazard that has actually
 * bitten is subtler than writing an arrow function on purpose: the browser halves of these types
 * are shipped through `Function.prototype.toString()`, which carries their comments along, so a
 * backtick typed around a word in a doc comment becomes an unterminated template literal in a
 * file that must be a classic script. The character is never written here; it is reached for as
 * `String.fromCharCode(96)`, which cannot be mistyped and cannot be mis-decoded.
 *
 * Two scans, deliberately different:
 *
 *   - backtick, arrow and optional chain in the RAW text. None can appear innocently in emitted
 *     classic-script code, and a backtick inside a string is exactly the case worth catching.
 *   - `const`, `let` and `class` only OUTSIDE comments and strings, because all three are
 *     ordinary English and a guard that fires on prose gets switched off rather than fixed.
 *
 * Exported so the guard itself can be tested. A check that has never been shown to fire is a
 * check nobody knows the shape of.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming every token it found and where each one is
 *
 * @example guardEmitted('var a = 1;', 'demo');            // 'var a = 1;'
 * @example guardEmitted('var a = () => 1;', 'demo');      // throws: an arrow function at line 1
 */
export function guardEmitted(js, where) {
  const bad = [];
  const tick = String.fromCharCode(96);

  for (const [needle, what] of [[tick, 'a backtick'], ['=>', 'an arrow function'],
                                ['?.', 'optional chaining']]) {
    const at = js.indexOf(needle);
    if (at >= 0) bad.push(what + ' at ' + atOffset(js, at));
  }

  const code = blankLiterals(js);
  for (const word of ['const', 'let', 'class']) {
    const hit = new RegExp('(^|[^\\w$.])' + word + '[\\s({]').exec(code);
    if (hit) bad.push('the keyword ' + word + ' at ' + atOffset(js, hit.index));
  }

  /* Compared numerically rather than matched against a character class, because writing the
     class is how the class gets corrupted. Tab, newline and carriage return are text. */
  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) {
    throw new Error('cardkit/chord: refusing to emit ' + where + ' -- ' + bad.join('; '));
  }
  return js;
}

/**
 * Walk a display list and refuse any coordinate that is not a finite number.
 *
 * The browser half computes geometry, so the usual build-time coordinate check cannot reach it.
 * Running the same function here over every configuration the viewer can select puts the check
 * back: a `NaN` produced by a degenerate input is found at build time, where a stack trace names
 * the data, rather than at paint time, where it is an attribute the browser silently dropped.
 *
 * @param marks a display list from {@link chordGeom}
 * @param where a short name for the configuration, so the message says which one
 * @throws {Error} on the first non-finite number, naming the attribute it was on
 *
 * @example assertFinite([{ t: 'circle', a: { r: 4 } }], 'default');   // undefined
 */
function assertFinite(marks, where) {
  for (const m of marks) {
    if (m.a) {
      for (const k of Object.keys(m.a)) {
        const v = m.a[k];
        if (typeof v === 'number' && !Number.isFinite(v)) {
          throw new Error('cardkit/chord: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/chord: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/* -- reading the data ------------------------------------------------------------------ */

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * Four kinds of bad input are counted rather than thrown on, because all four are things real
 * data does and none should cost the reader the rest of the matrix:
 *
 *   - a cell that is not a number (`badCell`). `null` and `undefined` are absence and become
 *     zero without being counted, because a sparse matrix written by hand leaves holes; a string
 *     or an object in a numeric cell is a mistake and is named.
 *   - a negative cell (`badNeg`). A negative flow has no reading on a chord diagram: arc length
 *     is a quantity and a ribbon cannot be less than nothing wide. It becomes zero and is named.
 *   - a matrix that is not square (`square: false`). This one is refused outright rather than
 *     patched, because every repair -- padding with zeros, truncating to the shorter side --
 *     invents or destroys flows, and the reader would have no way to tell which happened.
 *   - names that do not match the matrix side. Same refusal, same reason.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the counts above
 *
 * @example
 * readData({ names: ['a', 'b'], matrix: [[0, 2], [1, 0]], directed: true }).ribs.length;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawNames = Array.isArray(d.names) ? d.names : [];
  const rawM = Array.isArray(d.matrix) ? d.matrix : [];
  const directed = !!d.directed;
  const unit = d.unit == null ? '' : String(d.unit);

  /* The side is taken from `names` when there are any and from the matrix otherwise, so a matrix
     handed in without names still draws with 1..n for labels rather than refusing. */
  const side = rawNames.length ? rawNames.length : rawM.length;

  const bad = { badCell: 0, badNeg: 0 };
  let square = true;
  let why = '';

  if (rawNames.length && rawM.length !== rawNames.length) {
    square = false;
    why = plural(rawNames.length, 'name', 'names') + ' but ' +
          plural(rawM.length, 'matrix row', 'matrix rows');
  }
  for (let i = 0; square && i < rawM.length; i++) {
    const row = rawM[i];
    if (!Array.isArray(row) || row.length !== side) {
      square = false;
      why = 'row ' + (i + 1) + ' has ' +
            (Array.isArray(row) ? plural(row.length, 'cell', 'cells') : 'no cells at all') +
            ', not ' + side;
    }
  }

  const names = [];
  for (let i = 0; i < side; i++) {
    const raw = rawNames[i];
    names.push(String(raw == null ? i + 1 : (raw && typeof raw === 'object' && raw.label != null ? raw.label : raw)));
  }

  const M = [];
  for (let i = 0; i < side; i++) {
    const row = new Float64Array(side);
    const src = Array.isArray(rawM[i]) ? rawM[i] : [];
    for (let j = 0; j < side; j++) {
      const v = src[j];
      if (v == null) continue;                                  // absence, not an error
      if (typeof v === 'boolean') { bad.badCell++; continue; }   // true is not a quantity
      if (typeof v === 'string' && !v.trim()) { bad.badCell++; continue; }
      const num = Number(v);
      if (!Number.isFinite(num)) { bad.badCell++; continue; }
      if (num < 0) { bad.badNeg++; continue; }
      row[j] = num;
    }
    M.push(row);
  }

  /* Ribbons: one per unordered pair, including the pair {i, i}. In the directed reading the two
     ends carry the two directed flows and differ; in the undirected reading both ends carry the
     pair's total and the diagonal is counted once rather than twice. */
  const ribs = [];
  if (square) {
    for (let i = 0; i < side; i++) {
      for (let j = i; j < side; j++) {
        if (directed) {
          const wa = M[i][j];
          const wb = i === j ? M[i][i] : M[j][i];
          if (wa <= 0 && wb <= 0) continue;
          ribs.push([i, j, wa, wb]);
        } else {
          const w = i === j ? M[i][i] : M[i][j] + M[j][i];
          if (w <= 0) continue;
          ribs.push([i, j, w, w]);
        }
      }
    }
  }

  /* Arc mass, and the slices that fill it. The invariant that makes the picture honest is that
     these agree exactly: the widths in `inc[i]` sum to `mass[i]`, so every unit of arc is one
     unit of flow and no arc has a gap that means nothing. */
  const mass = new Array(side).fill(0);
  const inc = [];
  for (let i = 0; i < side; i++) inc.push([]);
  ribs.forEach((r, k) => {
    const [a, b, wa, wb] = r;
    if (a === b) { inc[a].push([k, a, wa]); mass[a] += wa; return; }
    inc[a].push([k, b, wa]); mass[a] += wa;
    inc[b].push([k, a, wb]); mass[b] += wb;
  });

  const total = mass.reduce((s, v) => s + v, 0);
  const loops = ribs.filter((r) => r[0] === r[1]).length;
  const loopMass = ribs.reduce((s, r) => s + (r[0] === r[1] ? r[2] : 0), 0);
  const empties = mass.filter((v) => !(v > 0)).length;

  return {
    names, side, directed, unit, M, ribs, inc, mass, total,
    square, why, bad, loops, loopMass, empties,
    cells: side * side,
  };
}

/* -- the crossing objective ------------------------------------------------------------ */

/**
 * Whether two ribbons cross, from the circular positions of their four endpoints.
 *
 * Two chords of a circle cross exactly when their endpoints interleave -- when one end of the
 * second lies inside the arc spanned by the first and the other lies outside. Written as a
 * linear "between lo and hi" test, which is correct on a circle because interleaving is
 * invariant under rotation and the test only ever asks about one of the two arcs.
 *
 * @param a the first ribbon's two positions
 * @param b the second ribbon's two positions
 * @returns false whenever any two of the four positions coincide, because chords that share an
 *          endpoint meet there rather than crossing, and a self-loop crosses nothing at all
 *
 * @example crosses(0, 2, 1, 3);   // true
 * @example crosses(0, 3, 1, 2);   // false
 */
function crosses(a0, a1, b0, b1) {
  if (a0 === a1 || b0 === b1) return false;
  if (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) return false;
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const inB0 = b0 > lo && b0 < hi;
  const inB1 = b1 > lo && b1 < hi;
  return inB0 !== inB1;
}

/**
 * How many ribbon pairs cross, for one arc order.
 *
 * This is the objective the `crossings` mode minimises, and it is a real count rather than a
 * proxy: it is exactly the number of places a reader has to decide which of two ribbons is in
 * front. Quadratic in ribbons, which is why {@link CROSS_CAP} exists.
 *
 * @param order the arc order to score
 * @param ribs  `[a, b, wa, wb]` per ribbon
 * @returns the count, zero for fewer than two ribbons
 *
 * @example crossCount([0, 1, 2, 3], [[0, 2, 1, 1], [1, 3, 1, 1]]);   // 1
 */
function crossCount(order, ribs) {
  const pos = [];
  for (let k = 0; k < order.length; k++) pos[order[k]] = k;
  let c = 0;
  for (let i = 0; i < ribs.length; i++) {
    const a0 = pos[ribs[i][0]];
    const a1 = pos[ribs[i][1]];
    if (a0 === a1) continue;
    for (let j = i + 1; j < ribs.length; j++) {
      if (crosses(a0, a1, pos[ribs[j][0]], pos[ribs[j][1]])) c++;
    }
  }
  return c;
}

/**
 * The change in crossings from swapping the entities at two adjacent positions.
 *
 * Recomputing the whole count per candidate swap is what makes a naive crossing minimiser
 * unusable at fifty entities. Swapping two adjacent positions only changes the cyclic order of
 * those two, so a pair of ribbons can only change its crossing status when one of them touches
 * the first entity and the other touches the second. That restricts the recount to
 * `deg(u) * deg(v)` tests instead of `ribbons squared`.
 *
 * Ribbons that share an endpoint are excluded by {@link crosses} itself, and the ribbon joining
 * the two swapped entities is excluded because it stays adjacent either way and therefore
 * crosses nothing before and nothing after.
 *
 * @param pos  position by entity, mutated and restored inside
 * @param u    the entity at the lower position
 * @param v    the entity at the higher position
 * @param ribs the ribbon list
 * @param inc  ribbon indices touching each entity
 * @returns the count after minus the count before; negative is an improvement
 *
 * @example swapDelta(pos, 0, 1, ribs, inc);   // -3
 */
function swapDelta(pos, u, v, ribs, inc) {
  const pairs = [];
  for (const [e] of inc[u]) {
    for (const [f] of inc[v]) {
      if (e === f) continue;
      pairs.push([e, f]);
    }
  }
  const score = () => {
    let c = 0;
    for (const [e, f] of pairs) {
      if (crosses(pos[ribs[e][0]], pos[ribs[e][1]], pos[ribs[f][0]], pos[ribs[f][1]])) c++;
    }
    return c;
  };
  const before = score();
  const pu = pos[u];
  const pv = pos[v];
  pos[u] = pv; pos[v] = pu;
  const after = score();
  pos[u] = pu; pos[v] = pv;
  return after - before;
}

/**
 * A circular barycentre sweep: each entity moves to the mean direction of what it touches.
 *
 * The linear barycentre used on a matrix cannot be used here, because position 0 and position
 * n-1 are neighbours on a circle and an arithmetic mean does not know that -- an entity joined
 * to the two entities either side of twelve o'clock would be sent to six o'clock, the furthest
 * point from both. So positions become unit vectors and the mean is taken as a vector; the angle
 * of that mean is the entity's wanted direction.
 *
 * Weighted by ribbon width, because an entity that sends nine tenths of its flow to one
 * neighbour belongs beside that neighbour, and an unweighted mean would put it in the middle
 * where it belongs to nobody. Ties break on the previous position, which is what makes the sweep
 * deterministic: without it the result depends on the engine's sort and two builds of the same
 * data can differ.
 *
 * An entity that touches nothing has no mean direction -- there is no mean of an empty set -- so
 * it is held out and appended in arrival order. It also cannot then oscillate, which is the
 * other reason: an empty member parked at an arbitrary angle is the classic way a sweep fails to
 * converge.
 *
 * @param order the current arc order
 * @param inc   ribbon indices and partners touching each entity
 * @returns a new order; the input is not modified
 *
 * @example sweepOnce([0, 1, 2], inc).length;   // 3
 */
function sweepOnce(order, inc) {
  const n = order.length;
  const pos = [];
  for (let k = 0; k < n; k++) pos[order[k]] = k;

  const live = [];
  const dead = [];
  for (const i of order) {
    let x = 0;
    let y = 0;
    let m = 0;
    for (const [, other, w] of inc[i]) {
      if (other === i || !(w > 0)) continue;             // a self-loop points nowhere
      const a = (2 * Math.PI * pos[other]) / n;
      x += Math.cos(a) * w;
      y += Math.sin(a) * w;
      m += w;
    }
    if (m > 0 && (x !== 0 || y !== 0)) live.push([i, Math.atan2(y, x)]);
    else dead.push(i);
  }

  live.sort((a, b) => (a[1] - b[1]) || (pos[a[0]] - pos[b[0]]));
  return live.map((e) => e[0]).concat(dead);
}

/**
 * Adjacent swaps accepted only when they strictly reduce crossings, run to a local optimum.
 *
 * Circular, so the last position and the first are also a candidate pair -- on a ring there is
 * no such thing as an end, and treating position n-1 as one would leave a seam the search could
 * never cross.
 *
 * Only strict improvements are taken, which is what makes this stage safe: the count can fall
 * and can stay put, and there is no path by which it rises.
 *
 * @param order the order, permuted in place
 * @returns how many swaps were made
 *
 * @example swapPass([0, 1, 2, 3], ribs, inc);   // 2
 */
function swapPass(order, ribs, inc) {
  const n = order.length;
  if (n < 3) return 0;
  const pos = [];
  for (let k = 0; k < n; k++) pos[order[k]] = k;

  let total = 0;
  for (let round = 0; round < 200; round++) {
    let did = 0;
    for (let p = 0; p < n; p++) {
      const q = (p + 1) % n;
      const u = order[p];
      const v = order[q];
      if (swapDelta(pos, u, v, ribs, inc) < 0) {
        order[p] = v; order[q] = u;
        pos[u] = q; pos[v] = p;
        did++;
      }
    }
    total += did;
    if (!did) break;
  }
  return total;
}

/**
 * Lift each entity out once and put it back wherever it crosses least.
 *
 * Adjacent swaps cannot move an entity past a neighbour that the move makes worse, even when six
 * places along there is a slot that makes everything better. Relocation is the standard repair
 * for that. Unlike the matrix card's version this one cannot compute a local delta -- moving an
 * entity changes the interleaving of every ribbon that touches it against every ribbon that does
 * not -- so it recounts, and is therefore capped at {@link RELOCATE_CAP} entities.
 *
 * @param order the order, permuted in place
 * @returns how many entities were moved
 *
 * @example relocatePass([0, 1, 2, 3], ribs);   // 1
 */
function relocatePass(order, ribs) {
  const n = order.length;
  if (n < 4 || n > RELOCATE_CAP) return 0;
  let moves = 0;
  let best = crossCount(order, ribs);

  for (const k of order.slice()) {
    const at = order.indexOf(k);
    const rest = order.slice(0, at).concat(order.slice(at + 1));
    let bestAt = -1;
    for (let j = 0; j <= rest.length; j++) {
      if (j === at) continue;
      const cand = rest.slice(0, j).concat([k], rest.slice(j));
      const got = crossCount(cand, ribs);
      if (got < best) { best = got; bestAt = j; }
    }
    if (bestAt < 0) continue;
    const moved = rest.slice(0, bestAt).concat([k], rest.slice(bestAt));
    order.length = 0;
    for (const v of moved) order.push(v);
    moves++;
  }
  return moves;
}

/**
 * The arc order for one value of `sort`, plus everything the caption has to say about it.
 *
 * The last step is the one that matters. A barycentre sweep optimises a proxy -- mean direction
 * -- and not the crossing count, so it can hand back an order that crosses MORE than the one the
 * author gave. The swept-and-improved order is therefore scored against the given order and the
 * loser is discarded. "Your order was already better" is a legitimate and interesting answer,
 * and a card that quietly shipped the worse one while calling it optimisation would be lying.
 *
 * @param mode one of `given`, `total`, `crossings`
 * @param R    the output of {@link readData}
 * @returns `{ order, before, after, sweeps, swaps, moves, kept, skipped }`
 *
 * @example planFor('crossings', read).after;   // 3
 */
function planFor(mode, R) {
  const given = R.names.map((_, i) => i);
  const before = R.square ? crossCount(given, R.ribs) : 0;
  const flat = { order: given, before, after: before, sweeps: 0, swaps: 0, moves: 0, kept: true, skipped: false };

  if (!R.square || R.side < 3 || !R.ribs.length) return flat;

  if (mode === 'given') return flat;

  if (mode === 'total') {
    /* Descending mass, ties on the given order. Not an optimisation of anything -- it is the
       reading where the biggest players are adjacent, which is what a reader asking "who is
       large" wants, and it is offered as an alternative rather than as an improvement. */
    const order = given.slice().sort((a, b) => (R.mass[b] - R.mass[a]) || (a - b));
    return { order, before, after: crossCount(order, R.ribs), sweeps: 0, swaps: 0, moves: 0, kept: false, skipped: false };
  }

  if (R.ribs.length > CROSS_CAP) return { ...flat, skipped: true };

  let order = given.slice();
  let sweeps = 0;
  for (let p = 0; p < SWEEP_CAP; p++) {
    const next = sweepOnce(order, R.inc);
    if (next.every((v, i) => v === order[i])) break;
    order = next;
    sweeps++;
  }

  const swaps = swapPass(order, R.ribs, R.inc);
  const moves = relocatePass(order, R.ribs);
  const swaps2 = swapPass(order, R.ribs, R.inc);
  const after = crossCount(order, R.ribs);

  if (after >= before) {
    /* Not better, so it is not shipped. Equal counts keep the given order too: an arrangement
       that is no better has no claim on the reader's familiarity with the order they wrote. */
    return { order: given, before, after: before, sweeps, swaps: swaps + swaps2, moves, kept: true, skipped: false };
  }
  return { order, before, after, sweeps, swaps: swaps + swaps2, moves, kept: false, skipped: false };
}

/* -- saying what the picture shows ------------------------------------------------------ */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets, per sort mode.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire picture to anyone using it.
 * "Chord diagram" is therefore not an acceptable answer -- it names the genre and withholds the
 * content. This gives the census, the direction convention, what the ordering bought, and the
 * two things a reader would otherwise infer wrongly from a gap in the ring: how many entities
 * carry no flow, and what happened to the diagonal.
 *
 * @returns `{ aria, note }`, both plain text -- the note is set with `textContent` when the
 *          viewer changes `sort`, so it carries no markup
 *
 * @example describe(read, plan, 'crossings').note;   // 'crossings reduced from 14 to 6; ...'
 */
function describe(R, P, mode) {
  const unit = R.unit ? ' ' + R.unit : '';
  const census =
    plural(R.side, 'entity', 'entities') + ', ' +
    plural(R.ribs.length, 'ribbon', 'ribbons') + ', ' +
    CK.fmt(R.total) + unit + ' of flow in all';

  if (!R.square) {
    return {
      aria: 'A chord diagram that could not be drawn: the matrix is not square -- ' + R.why +
            '. Padding or truncating it would invent or destroy flows, so nothing is drawn.',
      note: 'not square: ' + R.why + '. nothing is drawn.',
    };
  }
  if (!R.side) {
    return { aria: 'An empty chord diagram: there are no entities and nothing to draw.',
             note: 'no entities.' };
  }
  if (!R.ribs.length) {
    return {
      aria: 'Chord diagram, ' + plural(R.side, 'entity', 'entities') + ', but every flow is ' +
            'zero. The ring is drawn in equal parts so the entities keep their places, and no ' +
            'ribbon is drawn, because there is nothing to draw one from.',
      note: 'every flow is zero, so the ring is split equally and no ribbon is drawn.',
    };
  }

  const dir = R.directed
    ? 'directed: each pair is one ribbon, as wide at each end as the flow leaving that end, so a ' +
      'one-way flow tapers to a point where it arrives'
    : 'undirected: each pair is one ribbon of a single width, the two directions added together';

  const loops = R.loops
    ? ' ' + plural(R.loops, 'self-loop', 'self-loops') + ' on the diagonal, ' +
      CK.fmt(R.loopMass) + unit + ' in all, kept and drawn as a petal sitting on its own arc; ' +
      'counted once, so the slices on an arc still add up to the arc.'
    : '';

  const empties = R.empties
    ? ' ' + plural(R.empties, 'entity', 'entities') +
      (R.empties === 1 ? ' carries no flow at all, so it has' : ' carry no flow at all, so they have') +
      ' no arc, only a label.'
    : '';

  const work = P.skipped
    ? ' too many ribbons to search for a better order, so the given one stands.'
    : R.side < 3 ? ' with fewer than three arcs no ordering can change anything.'
    : mode === 'given' ? ' arcs in the order given; ' + P.before + ' ribbon crossings.'
    : mode === 'total' ? ' arcs by total flow, largest first; crossings ' + P.before +
                         ' to ' + P.after + '.'
    : P.kept
      ? ' the sweep found nothing better than the order you gave, so that order stands at ' +
        P.before + ' crossings.'
      : ' crossings ' + P.before + ' to ' + P.after +
        ' after ' + plural(P.sweeps, 'sweep', 'sweeps') + ', ' +
        plural(P.swaps, 'swap', 'swaps') + ' and ' +
        plural(P.moves, 'relocation', 'relocations') + '.';

  const junk = [];
  if (R.bad.badCell) junk.push(plural(R.bad.badCell, 'cell was', 'cells were') + ' not a number');
  if (R.bad.badNeg) junk.push(plural(R.bad.badNeg, 'cell was', 'cells were') + ' negative');
  const junkText = junk.length ? ' ' + junk.join('; ') + ', and read as zero.' : '';

  const note = (work + loops + empties + junkText).replace(/\s+/g, ' ').trim();
  const aria = ('Chord diagram: ' + census + '. ' + dir + '.' + work + loops + empties + junkText)
    .replace(/\s+/g, ' ').trim();
  return { aria, note };
}

/* -- the browser half ------------------------------------------------------------------- */

/**
 * Every arc, ribbon and label as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so
 * the function a test calls here is textually the function the page runs. That is the whole
 * reason it exists as a function rather than as a string: a Node-shaped twin of a browser
 * routine drifts from it, and the drift is invisible until a viewer sees a picture no test ever
 * saw.
 *
 * The angular arithmetic is the part worth reading. Total padding is capped at two fifths of the
 * turn, because a viewer who types 90 into a degrees box should get a ring that is mostly gaps
 * rather than a ring whose arcs have negative length. What is left over is shared out in
 * proportion to arc mass, so the spans plus the pads come to exactly one turn -- an invariant the
 * verification asserts rather than assumes.
 *
 * The angles are returned alongside the display list rather than kept private, so the two
 * invariants that make the picture honest can be asserted against THIS function rather than
 * against a reimplementation of it: the arc spans plus the pads come to exactly one turn, and
 * each ribbon end is as wide as its matrix entry says.
 *
 * @param model the precomputed model: names, masses, ribbons, orders, colours
 * @param cfg   `{ sort, padAngle, labels }` -- `padAngle` is in degrees
 * @returns `{ w, h, marks, arcs, slices, pad, avail }` -- a square viewBox, the display list,
 *          `arcs[i]` as `[start, end]` in radians and `slices[k]` as the four slice angles of
 *          ribbon `k`
 *
 * @example chordGeom(model, { sort: 'given', padAngle: 2, labels: true }).marks.length;   // 21
 */
function chordGeom(model, cfg) {
  var TAU = Math.PI * 2;
  var nEnt = model.n;
  var order = model.orders[cfg.sort] ? model.orders[cfg.sort] : model.orders.given;
  var i, j, k;

  var labOn = cfg.labels !== false;
  var room = labOn ? model.labW + 10 : 8;
  var size = 2 * (model.rOut + room);
  var out = { w: r2(size), h: r2(size), marks: [], arcs: [], slices: [], pad: 0, avail: TAU };

  function r2(v) { return Math.round(v * 100) / 100; }
  function pt(ang, rad) { return [r2(rad * Math.sin(ang)), r2(-rad * Math.cos(ang))]; }
  function arcTo(ang, rad, sweep, wide) {
    var p = pt(ang, rad);
    return 'A' + r2(rad) + ',' + r2(rad) + ' 0 ' + (wide ? 1 : 0) + ' ' + sweep + ' ' + p[0] + ',' + p[1];
  }
  function moveTo(ang, rad) { var p = pt(ang, rad); return 'M' + p[0] + ',' + p[1]; }
  function quadTo(cx, cy, ang, rad) {
    var p = pt(ang, rad);
    return 'Q' + r2(cx) + ',' + r2(cy) + ' ' + p[0] + ',' + p[1];
  }

  if (!nEnt) { return out; }

  var pos = [];
  for (k = 0; k < order.length; k++) { pos[order[k]] = k; }

  /* The pad cap is not politeness, it is arithmetic: n pads wider than the turn leaves a
     negative amount of circle to share out, and every arc would come back inside out. */
  var padMax = (TAU * 0.4) / nEnt;
  var pad = Number(cfg.padAngle) * Math.PI / 180;
  if (!(pad >= 0)) { pad = 0; }
  if (pad > padMax) { pad = padMax; }
  var avail = TAU - pad * nEnt;

  var span = [];
  for (i = 0; i < nEnt; i++) {
    span[i] = model.total > 0 ? (model.mass[i] / model.total) * avail : avail / nEnt;
  }

  var a0 = [], a1 = [], cursor = 0;
  for (k = 0; k < nEnt; k++) {
    i = order[k];
    a0[i] = cursor;
    cursor += span[i];
    a1[i] = cursor;
    cursor += pad;
  }
  out.pad = pad;
  out.avail = avail;
  for (i = 0; i < nEnt; i++) { out.arcs[i] = [a0[i], a1[i]]; }

  /* Slices are laid along each arc in the order of their partner around the ring. A ribbon whose
     two ends sit at the near edges of their arcs has less to twist through, and the whole bundle
     reads as a band rather than as a knot. */
  var sa0 = [], sa1 = [], sb0 = [], sb1 = [];
  for (i = 0; i < nEnt; i++) {
    var list = model.inc[i].slice();
    list.sort(function (x, y) { return (pos[x[1]] - pos[y[1]]) || (x[0] - y[0]); });
    var c = a0[i];
    for (k = 0; k < list.length; k++) {
      var rib = list[k][0];
      var w = list[k][2];
      var wsp = model.total > 0 ? (w / model.total) * avail : 0;
      var e0 = c;
      var e1 = c + wsp;
      c = e1;
      if (model.ribs[rib][0] === model.ribs[rib][1]) {
        sa0[rib] = e0; sa1[rib] = e1; sb0[rib] = e0; sb1[rib] = e1;
      } else if (model.ribs[rib][0] === i) {
        sa0[rib] = e0; sa1[rib] = e1;
      } else {
        sb0[rib] = e0; sb1[rib] = e1;
      }
    }
  }

  for (k = 0; k < model.ribs.length; k++) {
    out.slices[k] = [sa0[k], sa1[k], sb0[k], sb1[k]];
  }

  var rIn = model.rOut - model.band;
  var kids = [];

  /* Ribbons first, arcs over them: the band is the frame and should never be crossed by a
     ribbon that happens to be drawn later. SVG has no z-index -- append order is the stack. */
  for (k = 0; k < model.ribs.length; k++) {
    var R = model.ribs[k];
    var wa = sa1[k] - sa0[k];
    var wb = sb1[k] - sb0[k];
    if (!(wa > 0) && !(wb > 0)) { continue; }
    var d;
    if (R[0] === R[1]) {
      /* A self-loop is a petal on its own arc. The control point sits inside the ring at the
         slice midpoint, so the shape hugs the arc instead of stabbing at the centre -- which is
         what a ribbon drawn to itself through the middle looks like, and it reads as a spike
         belonging to nothing. */
      var mid = (sa0[k] + sa1[k]) / 2;
      var cp = pt(mid, rIn * 0.55);
      d = moveTo(sa0[k], rIn) + arcTo(sa1[k], rIn, 1, wa > Math.PI) +
          quadTo(cp[0], cp[1], sa0[k], rIn) + 'Z';
    } else {
      d = moveTo(sa0[k], rIn) + arcTo(sa1[k], rIn, 1, wa > Math.PI) +
          quadTo(0, 0, sb0[k], rIn) + arcTo(sb1[k], rIn, 1, wb > Math.PI) +
          quadTo(0, 0, sa0[k], rIn) + 'Z';
    }
    kids.push({ t: 'path',
                a: { d: d, "class": 'rib', fill: model.hue[model.ribHue[k]], 'fill-opacity': model.ribOp[k] },
                ti: model.tips[k] });
  }

  for (k = 0; k < nEnt; k++) {
    i = order[k];
    if (span[i] > 0) {
      var wide = span[i] > Math.PI;
      kids.push({ t: 'path',
                  a: { d: moveTo(a0[i], model.rOut) + arcTo(a1[i], model.rOut, 1, wide) +
                          'L' + pt(a1[i], rIn)[0] + ',' + pt(a1[i], rIn)[1] +
                          arcTo(a0[i], rIn, 0, wide) + 'Z',
                       "class": 'arc', fill: model.hue[i] },
                  ti: model.arcTips[i] });
    }
    if (!labOn) { continue; }
    var m2 = span[i] > 0 ? (a0[i] + a1[i]) / 2 : a0[i];
    var lp = pt(m2, model.rOut + 5);
    var right = Math.sin(m2) >= 0;
    var deg = m2 * 180 / Math.PI;
    kids.push({ t: 'text',
                a: { x: lp[0], y: lp[1], "class": 'lab',
                     'text-anchor': right ? 'start' : 'end',
                     'dominant-baseline': 'middle',
                     transform: 'rotate(' + r2(right ? deg - 90 : deg + 90) + ' ' + lp[0] + ',' + lp[1] + ')' },
                s: model.clipLab[i], ti: model.arcTips[i] });
  }

  out.marks.push({ t: 'g', a: { transform: 'translate(' + r2(size / 2) + ',' + r2(size / 2) + ')' }, kids: kids });
  return out;
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every ribbon on the second
 * pass -- a bug that looks like nothing until the card is opened twice.
 *
 * Attribute names are the real SVG ones, so this stays a translator rather than a second place
 * where chord decisions live. Text goes in with `textContent`, never `innerHTML`: every label
 * here is data the card did not write.
 *
 * @example paintList(svg, [{ t: 'circle', a: { r: 4 } }]);
 */
function paintList(box, marks) {
  var NS = 'http://www.w3.org/2000/svg';
  function node(m) {
    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (m.s != null) { e.textContent = m.s; }
    if (m.ti != null) {
      tip = document.createElementNS(NS, 'title');
      tip.textContent = m.ti;
      e.appendChild(tip);
    }
    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }
    return e;
  }
  while (box.firstChild) { box.removeChild(box.firstChild); }
  var frag = document.createDocumentFragment();
  for (var j = 0; j < marks.length; j++) { frag.appendChild(node(marks[j])); }
  box.appendChild(frag);
}

/* -- emit -------------------------------------------------------------------------------- */

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. Every value is a desk token, so the light switch is the only
 * thing that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 *
 * Hover lifts one ribbon and dims the rest, in CSS alone. A chord diagram's hardest question is
 * "where does this band go", and the answer costs nothing but a rule.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['svg.ck-ch', 'display: block; width: 100%; height: auto; max-height: 74vh; margin: 0 auto;'],
    ['svg.ck-ch text', 'font-family: var(--mono); font-size: 9px; fill: var(--ink-dim);'],

    ['.ck-ch .arc', 'stroke: none;'],
    ['.ck-ch .rib', 'stroke: none; transition: fill-opacity .12s linear;'],
    ['.ck-ch:hover .rib', 'fill-opacity: .12;'],
    ['.ck-ch .rib:hover', 'fill-opacity: .95;'],
    ['.ck-ch .lab', 'fill: var(--ink-dim);'],

    ['.ck-ch-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="number"]', 'width: 6.5em;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n' +
    '@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-ch .rib', 'transition: none;']]) +
    '\n}\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the ring and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The one part that changes with the settings is
 * an empty `<i>` the script fills with `textContent`, so nothing untrusted is ever parsed as
 * markup in the browser.
 */
function cardHtml(id, title, R, plan) {
  const e = CK.esc;
  const unit = R.unit ? ' ' + e(R.unit) : '';

  const void_ = !R.square
    ? '  <div class="ck-ch-void">nothing is drawn &mdash; ' + e(R.why) +
      ', and a chord diagram needs a square matrix</div>\n'
    : !R.side
      ? '  <div class="ck-ch-void">nothing to draw &mdash; there are no entities</div>\n'
      : '';

  const svg = !R.square || !R.side ? '' :
    '  <svg class="ck-ch" role="img" viewBox="0 0 100 100" aria-label="' + e(plan.aria) + '"></svg>\n';

  const head = !R.square
    ? '<b>' + e(String(R.side)) + '</b> names against a matrix that is not square'
    : '<b>' + e(CK.fmt(R.total)) + '</b>' + unit + ' of flow between <b>' +
      e(String(R.side)) + '</b> ' + (R.side === 1 ? 'entity' : 'entities') + ', ' +
      e(R.directed ? 'directed' : 'undirected') + '. ';

  return '<section data-card="' + e(id) + '" class="ck-chord">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-sort">arc order</label>\n' +
    '    <select id="' + e(id) + '-sort" name="sort">\n' +
    SORT_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-pad">pad (deg)</label>\n' +
    '    <input type="number" id="' + e(id) + '-pad" name="padAngle" min="0" max="20" step="0.5">\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-labels" name="labels">\n' +
    '    <div class="ck-set-foot">padding is capped at two fifths of the circle however much ' +
    'you ask for, because wider than that leaves the arcs no room at all.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap">' + head + '<i class="ck-ch-note">' + e(plan.note) + '</i></div>\n' +
    '</section>\n';
}

/**
 * The browser half: pick the plan the settings name, compute the ring, paint it.
 *
 * Built by concatenation rather than as a template literal, and passed through
 * {@link guardEmitted} on the way out. The geometry function and the painter are inlined by
 * `toString()` so there is one written source for each and a test can call the same text the
 * page runs.
 *
 * The settings are re-validated on the way in. They come out of `localStorage`, which is a text
 * file the viewer can edit, and a mode read straight out of it and used as a property name would
 * reach `Object.prototype` on the string `constructor`.
 */
function cardJs(id, model, inst) {
  const js =
    '/* chord card: orders and ribbon widths computed in Node; the ring is drawn here because\n' +
    '   the pad angle is a viewer setting and cannot be precomputed. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    chordGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-ch");\n' +
    '  var note = sec.querySelector(".ck-ch-note");\n\n' +
    '  function pick(v, list, fallback) {\n' +
    '    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }\n' +
    '    return fallback;\n' +
    '  }\n\n' +
    '  function draw(cfg) {\n' +
    '    var sort = pick(cfg.sort, MODEL.sorts, DEF.sort);\n' +
    '    if (note) { note.textContent = MODEL.notes[sort]; }\n' +
    '    if (!box || !MODEL.n) { return; }\n' +
    '    var pad = Number(cfg.padAngle);\n' +
    '    if (!isFinite(pad) || pad < 0) { pad = DEF.padAngle; }\n' +
    '    var got = chordGeom(MODEL, { sort: sort, padAngle: pad, labels: cfg.labels !== false });\n' +
    '    paintList(box, got.marks);\n' +
    '    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);\n' +
    '    box.setAttribute("aria-label", MODEL.arias[sort]);\n' +
    '  }\n\n' +
    '  CK.settings(sec, DEF, draw);\n' +
    '});\n';
  return guardEmitted(js, id);
}

/**
 * Build one chord card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the crossing counts the caption quotes,
 *          so a reader can check the claim without re-running the search
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'handoffs',
 *   title: 'work handed between teams this quarter',
 *   data: {
 *     names: ['design', 'build', 'review'],
 *     matrix: [[0, 9, 1], [2, 3, 8], [4, 0, 0]],
 *     directed: true,
 *     unit: 'tickets',
 *   },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'chord' : id);
  const R = readData(data);

  const plans = {};
  for (const m of SORT_MODES) {
    const p = planFor(m, R);
    plans[m] = { ...p, ...describe(R, p, m) };
  }

  const clipLab = R.names.map((s) => clip(s, LAB_MAX));
  const labW = clipLab.reduce((m, s) => Math.max(m, textW(s)), 0);
  const unit = R.unit ? ' ' + R.unit : '';

  /* A ribbon takes the colour of its wider end -- the dominant sender in a directed matrix.
     Colouring by the lower index instead would be arbitrary and would make a mostly-one-way
     flow look like it belonged to whichever name happened to sort first. Ties go to the lower
     index so the choice is at least deterministic. */
  const ribHue = R.ribs.map(([a, b, wa, wb]) => (wb > wa ? b : a));
  const ribOp = R.ribs.map(() => 0.62);
  const tips = R.ribs.map(([a, b, wa, wb]) =>
    a === b
      ? R.names[a] + ' \u2192 itself \u00b7 ' + CK.fmt(wa) + unit
      : R.directed
        ? R.names[a] + ' \u2192 ' + R.names[b] + ' \u00b7 ' + CK.fmt(wa) + unit + '   |   ' +
          R.names[b] + ' \u2192 ' + R.names[a] + ' \u00b7 ' + CK.fmt(wb) + unit
        : R.names[a] + ' \u2194 ' + R.names[b] + ' \u00b7 ' + CK.fmt(wa) + unit);
  const arcTips = R.names.map((s, i) =>
    s + ' \u00b7 ' + CK.fmt(R.mass[i]) + unit +
    (R.total > 0 ? ' \u00b7 ' + Math.round((R.mass[i] / R.total) * 100) + '%' : ''));

  /* Masses, ribbon widths and the total go into the model UNROUNDED, checked for finiteness but
     not shortened. Rounding each of them to two decimals independently is the obvious tidy-up and
     it quietly breaks the invariant the whole card rests on: the slices on an arc have to add up
     to the arc, and the sum of rounded parts is not the rounded sum. The rounding belongs at the
     coordinate, where a hundredth of a pixel is beneath notice, not at the quantity. */
  const fin = (v, what) => {
    if (!Number.isFinite(v)) throw new Error('cardkit/chord: non-finite ' + what + ' (' + v + ')');
    return v;
  };

  const model = {
    n: R.side,
    rOut: R_OUT,
    band: BAND,
    labW: n(labW, 'labW'),
    total: fin(R.total, 'total'),
    mass: R.mass.map((v) => fin(v, 'mass')),
    ribs: R.ribs.map(([a, b, wa, wb]) => [a, b, fin(wa, 'wa'), fin(wb, 'wb')]),
    inc: R.inc.map((l) => l.map(([k, other, w]) => [k, other, fin(w, 'inc')])),
    hue: R.names.map((_, i) => CK.hue(i)),
    ribHue, ribOp, tips, arcTips,
    clipLab,
    sorts: SORT_MODES.slice(),
    orders: {},
    notes: {},
    arias: {},
  };
  for (const m of SORT_MODES) {
    model.orders[m] = plans[m].order;
    model.notes[m] = plans[m].note;
    model.arias[m] = plans[m].aria;
  }

  /* The browser half is exercised here, over every configuration a viewer can reach, so a
     degenerate input that would produce a NaN coordinate is caught at build time next to the
     data that caused it rather than at paint time, where the browser drops the attribute in
     silence. Three pad angles: none, the default, and past the cap. */
  if (R.side) {
    for (const m of SORT_MODES) {
      for (const p of [0, defaults.padAngle, 90]) {
        for (const l of [true, false]) {
          const got = chordGeom(model, { sort: m, padAngle: p, labels: l });
          assertFinite(got.marks, m + '/pad ' + p + '/labels ' + l);
        }
      }
    }
  }

  const active = plans[defaults.sort];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'chord',
      entities: R.side,
      ribbons: R.ribs.length,
      total: n(R.total, 'total'),
      directed: R.directed,
      square: R.square,
      selfLoops: R.loops,
      emptyEntities: R.empties,
      refused: { nonNumeric: R.bad.badCell, negative: R.bad.badNeg },
      crossings: Object.fromEntries(SORT_MODES.map((m) => [m, plans[m].after])),
      keptGivenOrder: active.kept,
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active),
    css: cardCss(cardId),
    js: R.square && R.side ? cardJs(cardId, model, { ...defaults }) : cardJs(cardId, { ...model, n: 0 }, { ...defaults }),
  };
}

/* Exported for the verifier only: the geometry the browser runs, so a test can assert that arc
   angles sum to one turn and that each ribbon end matches its matrix entry, against the same
   text the page gets. */
export { chordGeom, crossCount, planFor, readData };
