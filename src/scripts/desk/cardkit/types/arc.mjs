/**
 * `arc` -- nodes on a line, edges as arcs over it. The node ORDER is the whole chart.
 *
 * An arc diagram is a node-link drawing with one degree of freedom removed: every node sits on
 * one line, so the only thing left to choose is the order they sit in. That constraint is the
 * point. A force layout hides a bad structure behind a pleasing blob; an arc diagram cannot hide
 * anything, because a graph with no community structure is a hairball of long arcs and a graph
 * with community structure is a row of tight bundles with a few long bridges. The picture is a
 * measurement, and the measurement is the crossing count.
 *
 * So this card does three things a decorative version would not:
 *
 *   1. **It runs a real ordering pass** -- a barycentre sweep, then adjacent swaps on the true
 *      crossing count, then a relocation pass, then swaps again.
 *   2. **It reports the count before and after**, in the caption, per ordering. A layout that
 *      claims to reduce crossings and does not is indistinguishable from one that does unless
 *      somebody counts.
 *   3. **It refuses to ship an order that is worse than yours.** The sweep optimises a proxy;
 *      the objective is the count. When the improved order does not beat the given one the given
 *      one stands, which makes "your order was already better" a legitimate answer rather than a
 *      silent defeat.
 *
 * The `group` ordering is deliberately NOT crossing-optimised across groups: it exists to answer
 * "does the grouping I believe in survive contact with the edges", and reordering the groups to
 * make that look better would answer a question nobody asked. Within each group the local search
 * still runs, because moving a node inside its own block cannot break the grouping.
 *
 * Which side an edge takes in `both` mode is decided ONCE, from the data, and never from the
 * current order. Otherwise the side rule and the ordering pass chase each other: the pass moves a
 * node, the move flips an edge to the other side, the objective changes underneath the search,
 * and the guarantee that the pass never makes things worse evaporates.
 *
 * @see ./chord.mjs -- the same crossing objective, wrapped onto a circle
 * @see ./matrix.mjs -- sweep, score against the given order, keep the winner
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().scale([0, 10], [0, 100])(5);   // 50
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/arc: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/arc: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css, measured rather than guessed. */
const CHW = 5.42;

/** The desk column is comfortable at 640; past it the diagram scrolls inside `.ck-scroll`. */
const W0 = 620;

/** Node spacing, clamped. Below the floor the dots merge; above the ceiling a five-node graph
    would be stretched across the whole card for no reason. */
const GAP_MIN = 13;
const GAP_MAX = 46;

/** Arc height caps. A true semicircle across fifty nodes is twenty-five nodes tall, so arcs are
    squashed into ellipses instead -- the ordering stays legible and the card stays a card. */
const CAP_ABOVE = 132;
const CAP_BELOW = 92;

/** How long a node label may be before it is clipped, in px at the label size. */
const LAB_MAX = 76;

/** The three things `order` may say, and the two things `side` may say. */
const ORDER_MODES = ['given', 'group', 'barycentre'];
const SIDE_MODES = ['above', 'both'];

/** Past this many edges the crossing search is skipped and the caption says so. */
const CROSS_CAP = 2400;

/** Relocation recounts rather than deltas, so it is quadratic on top of quadratic. */
const RELOCATE_CAP = 60;

/** How many barycentre passes before we stop and report that it did not settle. */
const SWEEP_CAP = 48;

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it.
 *
 * @example defaults.order;   // 'barycentre'
 */
export const defaults = { order: 'barycentre', side: 'above', labels: true };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * @example meta.name;   // 'arc'
 */
export const meta = {
  name: 'arc',
  summary:
    'Nodes on a line with edges as arcs over it, ordered by a barycentre sweep and local ' +
    'search that report the crossing count before and after.',
  shape:
    '{ nodes: [{ id, label, group }], edges: [[from, to, weight]], unit: string } -- ' +
    'from and to name a node by id or by index; weight is optional and drives arc thickness; ' +
    'group is optional and drives colour, the group ordering, and which side an arc takes',
  category: 'flow-and-relationship',
  defaults: { ...defaults },
};

/* -- small shared arithmetic ----------------------------------------------------------- */

/**
 * Round a number to two decimals, refusing to emit one that is not finite.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card renders
 * wrong with nothing in the console.
 *
 * @param v    the number
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(3.14159, 'radius');   // 3.14
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/arc: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
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
 * `<` and `>` become escapes so a label containing `</script>` cannot close the block early, and
 * so no label can put `=>` into a file that is contractually free of arrow functions. The
 * question mark goes too, so a label reading "ready?.no" cannot look like optional chaining to a
 * guard that scans raw text.
 *
 * @example jsonLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(/[`]/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The card's id as it may appear inside a double-quoted CSS attribute selector. */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-arc[data-card="' + cssId(id) + '"]';
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
 * A raw scan for `const` / `let` / `class` false-positives on English prose. Offsets are
 * preserved so a reported position still means something, and regex literals are recognised,
 * because otherwise the scanner desyncs on the quote in `replace(/'/g, x)` and blanks real code.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment and string contents replaced by spaces
 *
 * @example blankLiterals('/* the class is what CSS reads *' + '/').indexOf('class');   // -1
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
 * one card is a parse error that blanks every card on the page. The hazard that actually bites is
 * subtler than writing an arrow function on purpose: the browser halves of these types ship
 * through `Function.prototype.toString()`, which carries their comments along, so a backtick
 * typed around a word in a doc comment becomes an unterminated template literal. The character is
 * never written here; it is reached for as `String.fromCharCode(96)`.
 *
 * Two scans, deliberately different: backtick, arrow and optional chain in the RAW text, where
 * none can appear innocently; `const`, `let` and `class` only OUTSIDE comments and strings,
 * because all three are ordinary English and a guard that fires on prose gets switched off.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming every token it found and where each one is
 *
 * @example guardEmitted('var a = 1;', 'demo');           // 'var a = 1;'
 * @example guardEmitted('var a = b?.c;', 'demo');        // throws: optional chaining at line 1
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

  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) throw new Error('cardkit/arc: refusing to emit ' + where + ' -- ' + bad.join('; '));
  return js;
}

/**
 * Walk a display list and refuse any coordinate that is not a finite number.
 *
 * The browser half computes geometry, so the usual build-time coordinate check cannot reach it.
 * Running the same function here over every configuration a viewer can select puts the check back.
 *
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
          throw new Error('cardkit/arc: non-finite ' + k + ' in ' + where);
        }
        if (typeof v === 'string' && /NaN|Infinity/.test(v)) {
          throw new Error('cardkit/arc: ' + k + ' reads "' + v + '" in ' + where);
        }
      }
    }
    if (m.kids) assertFinite(m.kids, where);
  }
}

/* -- reading the data ------------------------------------------------------------------ */

/**
 * Resolve one half of an edge reference to a node index, accepting an index or an id.
 *
 * The documented shape is ids, which is what a hand-written graph uses; indices are accepted too
 * because a generated one is far easier to emit that way. Anything that resolves to neither is
 * refused rather than coerced -- an edge to node "7" when there are five nodes is a bug in the
 * caller, and quietly dropping it into node 0 would hide it and invent a relationship.
 *
 * @returns the index, or -1 when the reference names nothing
 *
 * @example at('build', nodes, byId);   // 2
 */
function at(v, list, byId) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < list.length) return v;
  if (v != null && byId.has(String(v))) return byId.get(String(v));
  return -1;
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * Five kinds of bad edge are counted rather than thrown on, because all five are things real
 * data does and none should cost the reader the rest of the graph:
 *
 *   - a reference to a node that does not exist (`badRef`);
 *   - a weight that is not a number (`badWeight`). It becomes 1, and is named, because an edge
 *     with an unreadable weight is still an edge -- the pair really is connected -- and dropping
 *     it would remove a relationship the data asserts;
 *   - a negative weight (`badNeg`). Arc thickness is a quantity and cannot be less than nothing.
 *     It becomes 0, which draws at the minimum thickness, and is named;
 *   - a duplicate pair (`dupe`). The first wins, because a later duplicate is almost always a
 *     join artefact -- the same fact arriving twice through two paths -- and summing would
 *     silently thicken an arc for a reason nothing in the data explains;
 *   - an entry that is not a pair at all (`badRef` again).
 *
 * A self-loop is NOT an error. It is a real relationship -- a team that hands work back to
 * itself, a page that links to itself -- and it is drawn as a small ring over its node. It
 * crosses nothing, because it spans no interval, so it never enters the objective.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the counts above
 *
 * @example readData({ nodes: ['a', 'b'], edges: [['a', 'b']] }).edges.length;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawNodes = Array.isArray(d.nodes) ? d.nodes : [];
  const rawEdges = Array.isArray(d.edges) ? d.edges : [];
  const unit = d.unit == null ? '' : String(d.unit);

  const nodes = [];
  const byId = new Map();
  rawNodes.forEach((raw, i) => {
    const o = raw && typeof raw === 'object' ? raw : { id: raw };
    const id = o.id == null ? 'n' + (i + 1) : String(o.id);
    nodes.push({
      id,
      label: String(o.label == null ? id : o.label),
      group: o.group == null ? null : String(o.group),
    });
    if (!byId.has(id)) byId.set(id, i);
  });

  /* Groups keep first-appearance order, which is the order the author wrote them in and
     therefore the order they meant. */
  const groupIds = [];
  for (const nd of nodes) if (nd.group != null && !groupIds.includes(nd.group)) groupIds.push(nd.group);
  const groupOf = nodes.map((nd) => (nd.group == null ? -1 : groupIds.indexOf(nd.group)));

  const bad = { badRef: 0, badWeight: 0, badNeg: 0, dupe: 0 };
  const seen = new Set();
  const edges = [];
  const loops = [];

  for (const t of rawEdges) {
    if (!Array.isArray(t) || t.length < 2) { bad.badRef++; continue; }
    const a = at(t[0], nodes, byId);
    const b = at(t[1], nodes, byId);
    if (a < 0 || b < 0) { bad.badRef++; continue; }

    let w = 1;
    if (t.length > 2 && t[2] != null) {
      const num = Number(t[2]);
      if (!Number.isFinite(num) || typeof t[2] === 'boolean') { bad.badWeight++; w = 1; }
      else if (num < 0) { bad.badNeg++; w = 0; }
      else w = num;
    }

    const key = Math.min(a, b) + '|' + Math.max(a, b);
    if (seen.has(key)) { bad.dupe++; continue; }
    seen.add(key);

    if (a === b) { loops.push([a, w]); continue; }
    edges.push([Math.min(a, b), Math.max(a, b), w]);
  }

  /* Weighted degree, self-loops included: a node that only talks to itself is still busy, and a
     dot sized by degree that ignored the loop would say it was idle. */
  const deg = nodes.map(() => 0);
  const wdeg = nodes.map(() => 0);
  for (const [a, b, w] of edges) { deg[a]++; deg[b]++; wdeg[a] += w; wdeg[b] += w; }
  for (const [a, w] of loops) { deg[a]++; wdeg[a] += w; }

  /* Which side an edge takes, decided once and never revisited. With groups, an arc within a
     group goes above and a bridge between groups goes below, so the two questions a reader has --
     "is this a community" and "what holds the communities together" -- get one half of the
     picture each. Without groups there is nothing to split on, so it falls back to direction in
     the order the author gave: an edge that ran forward there stays above. */
  const hasGroups = groupIds.length > 0;
  const belowFlag = edges.map(([a, b]) =>
    hasGroups ? (groupOf[a] !== groupOf[b] || groupOf[a] < 0 ? 1 : 0) : (b < a ? 1 : 0));

  const adj = nodes.map(() => []);
  edges.forEach(([a, b, w], k) => { adj[a].push([k, b, w]); adj[b].push([k, a, w]); });

  return {
    nodes, edges, loops, unit, groupIds, groupOf, hasGroups,
    deg, wdeg, adj, belowFlag, bad,
    isolated: deg.filter((v) => v === 0).length,
  };
}

/* -- the crossing objective ------------------------------------------------------------ */

/**
 * Whether two arcs on the same side cross, from the positions of their four endpoints.
 *
 * Two arcs over a line cross exactly when their intervals properly overlap -- when exactly one
 * end of the second lies strictly inside the first. Nested intervals do not cross (one arc sits
 * under the other) and disjoint ones do not either. Arcs that share an endpoint meet there
 * rather than crossing, and an arc that spans nothing -- a self-loop -- crosses nothing at all.
 *
 * @example crosses(0, 2, 1, 3);   // true  (proper overlap)
 * @example crosses(0, 3, 1, 2);   // false (nested)
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
 * How many arc pairs cross, for one node order and one side rule.
 *
 * This is the objective, and it is a count rather than a proxy: it is exactly the number of
 * places a reader has to work out which of two arcs passes in front. In `both` mode the two
 * sides are counted separately and added, because an arc above and an arc below never meet
 * however their intervals overlap -- and a card that counted them together would report crossings
 * a reader cannot see, then "fix" them by moving nodes for no visible gain.
 *
 * @param order the node order to score
 * @param edges `[a, b, w]` per edge, node indices
 * @param below `1` when the edge hangs below the line, `0` when it arcs above
 * @param split whether the side rule is in force -- false puts every edge above
 * @returns the count, zero for fewer than two edges
 *
 * @example crossCount([0, 1, 2, 3], [[0, 2, 1], [1, 3, 1]], [0, 0], false);   // 1
 */
function crossCount(order, edges, below, split) {
  const pos = [];
  for (let k = 0; k < order.length; k++) pos[order[k]] = k;
  let c = 0;
  for (let i = 0; i < edges.length; i++) {
    const si = split ? below[i] : 0;
    for (let j = i + 1; j < edges.length; j++) {
      if ((split ? below[j] : 0) !== si) continue;
      if (crosses(pos[edges[i][0]], pos[edges[i][1]], pos[edges[j][0]], pos[edges[j][1]])) c++;
    }
  }
  return c;
}

/**
 * The change in crossings from swapping the nodes at two adjacent positions.
 *
 * Recomputing the whole count per candidate is what makes a naive crossing minimiser unusable at
 * fifty nodes. Swapping two adjacent positions only changes the relative order of those two, so a
 * pair of arcs can only change status when one touches the first node and the other touches the
 * second. That restricts the recount to `deg(u) * deg(v)` tests instead of `edges squared`.
 *
 * @param pos   position by node, mutated and restored inside
 * @returns the count after minus the count before; negative is an improvement
 *
 * @example swapDelta(pos, 0, 1, edges, adj, below, true);   // -2
 */
function swapDelta(pos, u, v, edges, adj, below, split) {
  const pairs = [];
  for (const [e] of adj[u]) {
    for (const [f] of adj[v]) {
      if (e === f) continue;
      if (split && below[e] !== below[f]) continue;
      pairs.push([e, f]);
    }
  }
  const score = () => {
    let c = 0;
    for (const [e, f] of pairs) {
      if (crosses(pos[edges[e][0]], pos[edges[e][1]], pos[edges[f][0]], pos[edges[f][1]])) c++;
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
 * One barycentre pass: each node moves to the weighted mean position of its neighbours.
 *
 * The oldest heuristic in layered graph drawing and still the best opening move, because it is
 * global: one pass moves every node at once, and a handful of passes finds the gross structure
 * that a local search would take thousands of swaps to reach. It optimises nothing in
 * particular, which is exactly why the local search follows it and why the result is scored
 * against the given order afterwards.
 *
 * Weighted, so a node that shares nine tenths of its weight with one neighbour lands beside that
 * neighbour rather than in the middle of everything it touches. Ties break on the previous
 * position, which makes the sweep deterministic; without it the result depends on the engine's
 * sort and two builds of the same data can differ.
 *
 * A node with no edges has no mean -- there is no mean of an empty set -- so it is held out and
 * appended in arrival order rather than parked at the midpoint. Parking it in the middle drives a
 * blank column through whatever structure the sweep just found, and a gap inside a bundle reads
 * as a boundary that is not there. It also cannot then oscillate, which is the other reason.
 *
 * @param order the current node order
 * @param adj   `[edgeIndex, otherNode, weight]` per node
 * @returns a new order; the input is not modified
 *
 * @example sweepOnce([0, 1, 2], adj).length;   // 3
 */
function sweepOnce(order, adj) {
  const pos = [];
  for (let k = 0; k < order.length; k++) pos[order[k]] = k;

  const live = [];
  const dead = [];
  for (const i of order) {
    let s = 0;
    let m = 0;
    for (const [, other, w] of adj[i]) {
      const weight = w > 0 ? w : 1;          // a zero-weight edge still connects two nodes
      s += pos[other] * weight;
      m += weight;
    }
    if (m > 0) live.push([i, s / m]);
    else dead.push(i);
  }
  live.sort((a, b) => (a[1] - b[1]) || (pos[a[0]] - pos[b[0]]));
  return live.map((e) => e[0]).concat(dead);
}

/**
 * Adjacent swaps accepted only when they strictly reduce crossings, run to a local optimum.
 *
 * `allow` is what lets the same pass serve both the free ordering and the grouped one: in group
 * mode it refuses any swap that would put two groups out of contiguity, so the local search can
 * tidy inside a block without dissolving the blocks. Only strict improvements are taken, so the
 * count can fall and can stay put and has no path by which it rises.
 *
 * @param order the order, permuted in place
 * @param allow called with two node indices; false vetoes that swap
 * @returns how many swaps were made
 *
 * @example swapPass(order, edges, adj, below, true, function () { return true; });   // 7
 */
function swapPass(order, edges, adj, below, split, allow) {
  const n = order.length;
  if (n < 2) return 0;
  const pos = [];
  for (let k = 0; k < n; k++) pos[order[k]] = k;

  let total = 0;
  for (let round = 0; round < 200; round++) {
    let did = 0;
    for (let p = 0; p + 1 < n; p++) {
      const u = order[p];
      const v = order[p + 1];
      if (allow && !allow(u, v)) continue;
      if (swapDelta(pos, u, v, edges, adj, below, split) < 0) {
        order[p] = v; order[p + 1] = u;
        pos[u] = p + 1; pos[v] = p;
        did++;
      }
    }
    total += did;
    if (!did) break;
  }
  return total;
}

/**
 * Lift each node out once and put it back wherever it crosses least.
 *
 * Adjacent swaps cannot move a node past a neighbour that the move makes worse, even when six
 * places along there is a slot that makes everything better -- the classic local optimum that
 * swap-only searches sit in. Relocation is the cheapest escape from it. Unlike an adjacent swap
 * it has no local delta, because moving a node changes the interleaving of every arc that touches
 * it against every arc that does not, so it recounts and is capped at {@link RELOCATE_CAP}.
 *
 * Only strict improvements are taken and the first best position wins, so the result does not
 * depend on iteration luck.
 *
 * @param order the order, permuted in place
 * @returns how many nodes were moved
 *
 * @example relocatePass(order, edges, below, true);   // 3
 */
function relocatePass(order, edges, below, split) {
  const n = order.length;
  if (n < 4 || n > RELOCATE_CAP) return 0;
  let moves = 0;
  let best = crossCount(order, edges, below, split);

  for (const k of order.slice()) {
    const at_ = order.indexOf(k);
    const rest = order.slice(0, at_).concat(order.slice(at_ + 1));
    let bestAt = -1;
    for (let j = 0; j <= rest.length; j++) {
      if (j === at_) continue;
      const got = crossCount(rest.slice(0, j).concat([k], rest.slice(j)), edges, below, split);
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
 * The node order for one `order` mode and one `side` mode, with what it cost and what it bought.
 *
 * Both modes are planned separately because the objective genuinely differs between them: in
 * `both` mode the arcs are split across two sides and an order that is excellent for one
 * combined side can be mediocre once half the arcs move below. Optimising one and reporting the
 * other would be a caption that quotes a number from a different picture.
 *
 * The final guard is the one that matters. A barycentre sweep optimises mean position, not
 * crossings, so it can hand back an order that crosses MORE than the one the author gave. The
 * result is therefore scored against the given order and the loser discarded -- so the `barycentre`
 * mode can never be worse than `given`, which is a property a test can assert and does.
 *
 * `group` deliberately does not get that guard against `given`: it is a stated arrangement, not
 * an optimisation, and it is allowed to cross more if the grouping the author believes in really
 * does cut across the edges. That is the finding, and hiding it would be the bug. Its local
 * search is still monotone, so it is never worse than the plain grouped order.
 *
 * @param mode one of `given`, `group`, `barycentre`
 * @param side one of `above`, `both`
 * @param R    the output of {@link readData}
 * @returns `{ order, before, after, sweeps, swaps, moves, kept, skipped }`
 *
 * @example planFor('barycentre', 'above', read).after;   // 4
 */
function planFor(mode, side, R) {
  const split = side === 'both';
  const given = R.nodes.map((_, i) => i);
  const before = crossCount(given, R.edges, R.belowFlag, split);
  const flat = { order: given, before, after: before, sweeps: 0, swaps: 0, moves: 0, kept: true, skipped: false };

  if (mode === 'given' || R.nodes.length < 3 || !R.edges.length) return flat;
  if (R.edges.length > CROSS_CAP) return { ...flat, skipped: true };

  if (mode === 'group') {
    if (!R.hasGroups) return flat;
    /* Stable sort by group, ungrouped nodes last: a node with no group belongs to no block, and
       putting it inside one would claim a membership the data does not assert. */
    const order = given.slice().sort((a, b) => {
      const ga = R.groupOf[a] < 0 ? R.groupIds.length : R.groupOf[a];
      const gb = R.groupOf[b] < 0 ? R.groupIds.length : R.groupOf[b];
      return (ga - gb) || (a - b);
    });
    const plain = crossCount(order, R.edges, R.belowFlag, split);
    const same = (u, v) => R.groupOf[u] === R.groupOf[v];
    const swaps = swapPass(order, R.edges, R.adj, R.belowFlag, split, same);
    return { order, before: plain, after: crossCount(order, R.edges, R.belowFlag, split),
             sweeps: 0, swaps, moves: 0, kept: false, skipped: false, grouped: true };
  }

  let order = given.slice();
  let sweeps = 0;
  for (let p = 0; p < SWEEP_CAP; p++) {
    const next = sweepOnce(order, R.adj);
    if (next.every((v, i) => v === order[i])) break;
    order = next;
    sweeps++;
  }

  const swaps = swapPass(order, R.edges, R.adj, R.belowFlag, split, null);
  const moves = relocatePass(order, R.edges, R.belowFlag, split);
  const swaps2 = swapPass(order, R.edges, R.adj, R.belowFlag, split, null);
  const after = crossCount(order, R.edges, R.belowFlag, split);

  if (after >= before) {
    /* Not better, so it is not shipped. Equal counts keep the given order too: an arrangement
       that is no better has no claim on the reader's familiarity with the order they wrote. */
    return { order: given, before, after: before, sweeps, swaps: swaps + swaps2, moves, kept: true, skipped: false };
  }
  return { order, before, after, sweeps, swaps: swaps + swaps2, moves, kept: false, skipped: false };
}

/* -- saying what the picture shows ------------------------------------------------------ */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets, per configuration.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire picture to anyone using it.
 * "Arc diagram" names the genre and withholds the content, so this gives the census, the side
 * rule in force, what the ordering bought in crossings, and the things a reader would otherwise
 * infer wrongly from a gap: isolated nodes, self-loops, and refused edges.
 *
 * @returns `{ aria, note }`, both plain text -- the note is set with `textContent`, so it carries
 *          no markup and nothing untrusted is ever parsed
 *
 * @example describe(read, plan, 'barycentre', 'above').note;   // 'crossings 41 to 12 ...'
 */
function describe(R, P, mode, side) {
  const census =
    plural(R.nodes.length, 'node', 'nodes') + ' and ' +
    plural(R.edges.length + R.loops.length, 'edge', 'edges');

  if (!R.nodes.length) {
    return { aria: 'An empty arc diagram: there are no nodes and nothing to order.',
             note: 'no nodes.' };
  }
  if (!R.edges.length && !R.loops.length) {
    return {
      aria: 'Arc diagram of ' + plural(R.nodes.length, 'node', 'nodes') + ' with no edges at ' +
            'all. The nodes are drawn on the line in the order given, because with no edges no ' +
            'ordering carries information.',
      note: 'no edges at all, so no ordering carries information and the given order stands.',
    };
  }

  const sideText = side === 'both'
    ? (R.hasGroups
        ? 'arcs within a group go above the line and bridges between groups below'
        : 'arcs that run forward in the given order go above the line and the rest below')
    : 'every arc above the line';

  const work = P.skipped
    ? ' too many edges to search for a better order, so the given one stands.'
    : mode === 'given' ? ' nodes in the order given; ' + plural(P.before, 'crossing', 'crossings') + '.'
    : mode === 'group'
      ? (!R.hasGroups
          ? ' no groups are defined, so the group ordering is the given one; ' +
            plural(P.before, 'crossing', 'crossings') + '.'
          : ' nodes blocked by group, then tidied inside each block: crossings ' +
            P.before + ' to ' + P.after + '. the blocks themselves are not reordered, so this ' +
            'number is what your grouping costs, not what a layout could do.')
    : P.kept
      ? ' the sweep and the local search found nothing better than the order you gave, so that ' +
        'order stands at ' + plural(P.before, 'crossing', 'crossings') + '.'
      : ' crossings ' + P.before + ' to ' + P.after + ' (' +
        Math.round((1 - P.after / Math.max(1, P.before)) * 100) + '% fewer) after ' +
        plural(P.sweeps, 'sweep', 'sweeps') + ', ' + plural(P.swaps, 'swap', 'swaps') +
        ' and ' + plural(P.moves, 'relocation', 'relocations') + '.';

  const loops = R.loops.length
    ? ' ' + plural(R.loops.length, 'self-loop', 'self-loops') + ' drawn as a ring over its node; ' +
      'a self-loop spans nothing, so it crosses nothing and never enters the count.'
    : '';

  const alone = R.isolated
    ? ' ' + plural(R.isolated, 'node', 'nodes') +
      (R.isolated === 1 ? ' touches' : ' touch') +
      ' no edge, so ' + (R.isolated === 1 ? 'it has' : 'they have') +
      ' no barycentre and ' + (R.isolated === 1 ? 'is' : 'are') + ' held at the end.'
    : '';

  const junk = [];
  if (R.bad.badRef) junk.push(plural(R.bad.badRef, 'edge', 'edges') + ' named a node that does not exist');
  if (R.bad.badWeight) junk.push(plural(R.bad.badWeight, 'weight was', 'weights were') + ' not a number, read as one');
  if (R.bad.badNeg) junk.push(plural(R.bad.badNeg, 'weight was', 'weights were') + ' negative, read as zero');
  if (R.bad.dupe) junk.push(plural(R.bad.dupe, 'duplicate edge', 'duplicate edges') + ' deduped');
  const junkText = junk.length ? ' ' + junk.join('; ') + '.' : '';

  const note = (sideText + ':' + work + loops + alone + junkText).replace(/\s+/g, ' ').trim();
  const aria = ('Arc diagram of ' + census + ', ' + sideText + '.' + work + loops + alone + junkText)
    .replace(/\s+/g, ' ').trim();
  return { aria, note };
}

/* -- the browser half ------------------------------------------------------------------- */

/**
 * Every node, arc, ring and label as a display list, from the model and one configuration.
 *
 * Written in classic-script vocabulary and emitted through `Function.prototype.toString()`, so
 * the function a test calls here is textually the function the page runs.
 *
 * Two pieces of arithmetic are worth reading. Arcs are ellipses, not semicircles: a true
 * semicircle over fifty nodes is twenty-five nodes tall, so the vertical radius is capped and
 * long arcs flatten instead of leaving the card. And in `both` mode the arcs below hang from a
 * second rail underneath the label band, joined to their nodes by hairlines -- otherwise every
 * arc below the line would be drawn straight through the labels, which is how an arc diagram with
 * two sides usually becomes unreadable.
 *
 * @param model the precomputed model: orders, edges, thicknesses, colours, labels
 * @param cfg   `{ order, side, labels }`
 * @returns `{ w, h, marks }` -- the viewBox and the display list to paint in it
 *
 * @example arcGeom(model, { order: 'given', side: 'above', labels: true }).marks.length;   // 1
 */
function arcGeom(model, cfg) {
  var i, k;
  var nN = model.n;
  var key = cfg.side + '/' + cfg.order;
  var order = model.plans[key] ? model.plans[key] : model.plans['above/given'];
  var split = cfg.side === 'both';
  var labOn = cfg.labels !== false;

  function r2(v) { return Math.round(v * 100) / 100; }

  if (!nN) { return { w: 100, h: 40, marks: [] }; }

  var pos = [];
  for (k = 0; k < order.length; k++) { pos[order[k]] = k; }

  var gap = nN > 1 ? (model.w0 - model.margin * 2) / (nN - 1) : 0;
  if (gap < model.gapMin) { gap = model.gapMin; }
  if (gap > model.gapMax) { gap = model.gapMax; }
  var w = model.margin * 2 + (nN - 1) * gap;
  if (w < 120) { w = 120; }

  function xOf(node) { return model.margin + pos[node] * gap; }

  /* Both rail heights come from the arcs that will actually be drawn, so a diagram whose longest
     arc spans four nodes is four nodes tall rather than reserving room for a span it never has. */
  var topR = 0, botR = 0;
  for (k = 0; k < model.edges.length; k++) {
    var lowSide = split && model.below[k];
    var rx = Math.abs(xOf(model.edges[k][1]) - xOf(model.edges[k][0])) / 2;
    var ry = Math.min(rx, lowSide ? model.capBelow : model.capAbove);
    if (lowSide) { if (ry > botR) { botR = ry; } }
    else if (ry > topR) { topR = ry; }
  }
  if (model.loops.length && topR < 12) { topR = 12; }

  var labH = labOn ? model.labW + 8 : 6;
  var top = topR + 9;
  var labTop = top + 8;
  var rail2 = labTop + labH + 4;
  var h = split && botR > 0 ? rail2 + botR + 8 : labTop + labH + 4;

  var kids = [];

  kids.push({ t: 'line', a: { x1: r2(model.margin - 4), y1: r2(top), x2: r2(w - model.margin + 4),
                              y2: r2(top), "class": 'rail' } });
  if (split && botR > 0) {
    kids.push({ t: 'line', a: { x1: r2(model.margin - 4), y1: r2(rail2), x2: r2(w - model.margin + 4),
                                y2: r2(rail2), "class": 'rail' } });
  }

  for (k = 0; k < model.edges.length; k++) {
    var e = model.edges[k];
    var x1 = xOf(e[0]), x2 = xOf(e[1]);
    var low = split && model.below[k];
    var arx = Math.abs(x2 - x1) / 2;
    var ary = Math.min(arx, low ? model.capBelow : model.capAbove);
    var y = low ? rail2 : top;
    var d = 'M' + r2(x1) + ',' + r2(y) + 'A' + r2(arx) + ',' + r2(ary) + ' 0 0 ' +
            (low ? 0 : 1) + ' ' + r2(x2) + ',' + r2(y);
    kids.push({ t: 'path', a: { d: d, "class": 'edge', stroke: model.edgeCol[k],
                                'stroke-width': model.edgeW[k] }, ti: model.edgeTip[k] });
    if (low) {
      kids.push({ t: 'line', a: { x1: r2(x1), y1: r2(top), x2: r2(x1), y2: r2(rail2), "class": 'stem' } });
      kids.push({ t: 'line', a: { x1: r2(x2), y1: r2(top), x2: r2(x2), y2: r2(rail2), "class": 'stem' } });
    }
  }

  for (k = 0; k < model.loops.length; k++) {
    var lp = model.loops[k];
    kids.push({ t: 'circle', a: { cx: r2(xOf(lp[0])), cy: r2(top - 6), r: 5, "class": 'loop',
                                  stroke: model.nodeCol[lp[0]] }, ti: model.loopTip[k] });
  }

  for (i = 0; i < nN; i++) {
    kids.push({ t: 'circle', a: { cx: r2(xOf(i)), cy: r2(top), r: model.dotR[i], "class": 'dot',
                                  fill: model.nodeCol[i] }, ti: model.nodeTip[i] });
    if (!labOn) { continue; }
    var lx = xOf(i);
    kids.push({ t: 'text',
                a: { x: r2(lx), y: r2(labTop), "class": 'lab', 'text-anchor': 'end',
                     transform: 'rotate(-90 ' + r2(lx) + ',' + r2(labTop) + ')' },
                s: model.clipLab[i], ti: model.nodeTip[i] });
  }

  return { w: r2(w), h: r2(h), marks: kids };
}

/**
 * Turn a display list into elements, replacing whatever was in the box.
 *
 * Replacing rather than appending is the whole point: the desk swaps `<main>` and replays every
 * builder, and a painter that appended would leave two copies of every arc on the second pass.
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
 * Nothing here names a colour. Every value is a desk token, so the light switch is the only thing
 * that has to know anything. `prefers-color-scheme` is deliberately absent: the desk is one
 * document open in two viewers that want different answers, and the OS gives both the same answer.
 *
 * Hover lifts one arc and dims the rest, in CSS alone -- an arc diagram's hardest question is
 * "where does this one go", and the answer costs a rule.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-arc-scroll', 'margin-top: 2px;'],
    ['svg.ck-ad', 'display: block; width: 100%; height: auto;'],
    ['svg.ck-ad text', 'font-family: var(--mono); font-size: 9px; fill: var(--ink-dim);'],

    ['.ck-ad .rail', 'stroke: var(--rule); stroke-width: 1;'],
    ['.ck-ad .stem', 'stroke: var(--ck-grid); stroke-width: 1;'],
    ['.ck-ad .edge', 'fill: none; stroke-linecap: round; opacity: .7; transition: opacity .12s linear;'],
    ['.ck-ad:hover .edge', 'opacity: .18;'],
    ['.ck-ad .edge:hover', 'opacity: 1;'],
    ['.ck-ad .loop', 'fill: none; stroke-width: 1.4; opacity: .8;'],
    ['.ck-ad .dot', 'stroke: none;'],
    ['.ck-ad .lab', 'fill: var(--ink-dim);'],

    ['.ck-ad-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n' +
    '@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-ad .edge', 'transition: none;']]) +
    '\n}\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the diagram and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The one part that changes with the settings is
 * an empty `<i>` the script fills with `textContent`.
 */
function cardHtml(id, title, R, plan) {
  const e = CK.esc;

  const void_ = R.nodes.length ? '' :
    '  <div class="ck-ad-void">nothing to draw &mdash; there are no nodes</div>\n';

  const svg = R.nodes.length
    ? '  <div class="ck-scroll ck-arc-scroll">\n' +
      '    <svg class="ck-ad" role="img" viewBox="0 0 100 40" aria-label="' + e(plan.aria) + '"></svg>\n' +
      '  </div>\n'
    : '';

  const legend = R.groupIds.map((g, i) =>
    '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + e(g) + '</span>').join('');

  return '<section data-card="' + e(id) + '" class="ck-arc">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-order">node order</label>\n' +
    '    <select id="' + e(id) + '-order" name="order">\n' +
    ORDER_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-side">arcs</label>\n' +
    '    <select id="' + e(id) + '-side" name="side">\n' +
    SIDE_MODES.map((m) => '      <option value="' + m + '">' + m + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-labels" name="labels">\n' +
    '    <div class="ck-set-foot">the order is the chart: a bad one is a hairball and a good ' +
    'one shows the communities. every ordering reports what it cost in crossings.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap"><b>' + e(String(R.nodes.length)) + '</b> ' +
    (R.nodes.length === 1 ? 'node' : 'nodes') + ', <b>' +
    e(String(R.edges.length + R.loops.length)) + '</b> ' +
    (R.edges.length + R.loops.length === 1 ? 'edge' : 'edges') + '. ' +
    '<i class="ck-ad-note">' + e(plan.note) + '</i></div>\n' +
    (legend ? '  <div class="ck-legend">' + legend + '</div>\n' : '') +
    '</section>\n';
}

/**
 * The browser half: pick the plan the settings name, lay out the line, paint it.
 *
 * Built by concatenation rather than as a template literal and passed through
 * {@link guardEmitted} on the way out. The settings are re-validated on the way in: they come out
 * of `localStorage`, which is a text file the viewer can edit, and a mode read straight out of it
 * and used as a property name would reach `Object.prototype` on the string `constructor`.
 */
function cardJs(id, model, inst) {
  const js =
    '/* arc card: node orders and crossing counts computed in Node; the line is laid out here\n' +
    '   because node spacing depends on the label setting and the card width. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n\n' +
    arcGeom.toString() + '\n\n' +
    paintList.toString() + '\n\n' +
    '  var MODEL = ' + jsonLit(model) + ';\n' +
    '  var DEF = ' + jsonLit(inst) + ';\n' +
    '  var box = sec.querySelector("svg.ck-ad");\n' +
    '  var note = sec.querySelector(".ck-ad-note");\n\n' +
    '  function pick(v, list, fallback) {\n' +
    '    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }\n' +
    '    return fallback;\n' +
    '  }\n\n' +
    '  function draw(cfg) {\n' +
    '    var ord = pick(cfg.order, MODEL.orders, DEF.order);\n' +
    '    var side = pick(cfg.side, MODEL.sides, DEF.side);\n' +
    '    var key = side + "/" + ord;\n' +
    '    if (note) { note.textContent = MODEL.notes[key]; }\n' +
    '    if (!box || !MODEL.n) { return; }\n' +
    '    var got = arcGeom(MODEL, { order: ord, side: side, labels: cfg.labels !== false });\n' +
    '    paintList(box, got.marks);\n' +
    '    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);\n' +
    '    box.style.minWidth = Math.ceil(got.w) + "px";\n' +
    '    box.setAttribute("aria-label", MODEL.arias[key]);\n' +
    '  }\n\n' +
    '  CK.settings(sec, DEF, draw);\n' +
    '});\n';
  return guardEmitted(js, id);
}

/**
 * Build one arc-diagram card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the crossing count for every ordering, so
 *          a reader can check what the caption claims without re-running the search
 *
 * @throws {Error} when the geometry produces a number that is not finite, or when the emitted
 *                 script contains a token that would break the desk. Malformed input never
 *                 throws: it is counted and named in the caption.
 *
 * @example
 * build({
 *   id: 'imports',
 *   title: 'which module imports which',
 *   data: {
 *     nodes: [{ id: 'kit', group: 'core' }, { id: 'chart', group: 'draw' }],
 *     edges: [['chart', 'kit', 3]],
 *     unit: 'imports',
 *   },
 *   ord: 35,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'arc' : id);
  const R = readData(data);

  const plans = {};
  for (const side of SIDE_MODES) {
    for (const mode of ORDER_MODES) {
      const p = planFor(mode, side, R);
      plans[side + '/' + mode] = { ...p, ...describe(R, p, mode, side) };
    }
  }

  const unit = R.unit ? ' ' + R.unit : '';

  /* Thickness and dot size run through the real `CK.scale`, whose zero-width-domain guard is what
     keeps an all-equal weight set from dividing by zero: it parks every value at the midpoint of
     the range, so a graph where every weight is the same -- including a graph where every weight
     is ZERO -- comes out with every arc the same middle thickness. That is the honest picture:
     nothing distinguishes these edges, so nothing in the drawing distinguishes them either. */
  let wLo = Infinity;
  let wHi = -Infinity;
  for (const [, , w] of R.edges) { if (w < wLo) wLo = w; if (w > wHi) wHi = w; }
  if (!Number.isFinite(wLo)) { wLo = 0; wHi = 1; }
  const toW = CK.scale([wLo, wHi], [0.9, 5.2]);

  let dLo = Infinity;
  let dHi = -Infinity;
  for (const v of R.wdeg) { if (v < dLo) dLo = v; if (v > dHi) dHi = v; }
  if (!Number.isFinite(dLo)) { dLo = 0; dHi = 1; }
  const toR = CK.scale([dLo, dHi], [2.2, 5]);

  const clipLab = R.nodes.map((nd) => clip(nd.label, LAB_MAX));
  const labW = clipLab.reduce((m, s) => Math.max(m, textW(s)), 0);

  const nodeCol = R.nodes.map((_, i) => (R.groupOf[i] >= 0 ? CK.hue(R.groupOf[i]) : 'var(--accent)'));
  const edgeCol = R.edges.map(([a, b]) =>
    (R.groupOf[a] >= 0 && R.groupOf[a] === R.groupOf[b] ? CK.hue(R.groupOf[a]) : 'var(--ink-faint)'));

  const model = {
    n: R.nodes.length,
    w0: W0,
    margin: 16,
    gapMin: GAP_MIN,
    gapMax: GAP_MAX,
    capAbove: CAP_ABOVE,
    capBelow: CAP_BELOW,
    labW: n(labW, 'labW'),
    clipLab,
    edges: R.edges.map(([a, b]) => [a, b]),
    below: R.belowFlag,
    edgeW: R.edges.map(([, , w]) => n(toW(w), 'edgeW')),
    edgeCol,
    edgeTip: R.edges.map(([a, b, w]) =>
      R.nodes[a].label + ' \u2014 ' + R.nodes[b].label + ' \u00b7 ' + CK.fmt(w) + unit),
    loops: R.loops.map(([a]) => [a]),
    loopTip: R.loops.map(([a, w]) => R.nodes[a].label + ' \u2192 itself \u00b7 ' + CK.fmt(w) + unit),
    dotR: R.wdeg.map((v) => n(toR(v), 'dotR')),
    nodeCol,
    nodeTip: R.nodes.map((nd, i) =>
      nd.label + (nd.group ? ' \u00b7 ' + nd.group : '') + ' \u00b7 ' +
      plural(R.deg[i], 'edge', 'edges')),
    orders: ORDER_MODES.slice(),
    sides: SIDE_MODES.slice(),
    plans: {},
    notes: {},
    arias: {},
  };
  for (const key of Object.keys(plans)) {
    model.plans[key] = plans[key].order;
    model.notes[key] = plans[key].note;
    model.arias[key] = plans[key].aria;
  }

  /* The browser half is exercised here, over every configuration a viewer can reach, so a
     degenerate input that would produce a NaN coordinate is caught at build time next to the data
     that caused it rather than at paint time, where the browser drops the attribute in silence. */
  if (R.nodes.length) {
    for (const side of SIDE_MODES) {
      for (const mode of ORDER_MODES) {
        for (const lab of [true, false]) {
          const got = arcGeom(model, { order: mode, side, labels: lab });
          assertFinite(got.marks, side + '/' + mode + '/labels ' + lab);
        }
      }
    }
  }

  const active = plans[defaults.side + '/' + defaults.order];

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'arc',
      nodes: R.nodes.length,
      edges: R.edges.length,
      selfLoops: R.loops.length,
      isolated: R.isolated,
      groups: R.groupIds.length,
      refused: { unknownRef: R.bad.badRef, nonNumeric: R.bad.badWeight,
                 negative: R.bad.badNeg, duplicate: R.bad.dupe },
      crossings: Object.fromEntries(Object.keys(plans).map((k) => [k, plans[k].after])),
      crossingsGiven: Object.fromEntries(SIDE_MODES.map((s) => [s, plans[s + '/given'].before])),
      keptGivenOrder: active.kept,
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), R, active),
    css: cardCss(cardId),
    js: cardJs(cardId, model, { ...defaults }),
  };
}

/* Exported for the verifier only: the geometry the browser runs and the objective it is judged
   against, so a test can assert that the ordering pass never raises the crossing count using the
   same text the page gets. */
export { arcGeom, crossCount, planFor, readData };
