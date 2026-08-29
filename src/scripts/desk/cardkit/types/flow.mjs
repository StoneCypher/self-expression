/**
 * `flow` -- a sankey: quantities moving between stages, drawn by hand.
 *
 * This generalises the funds card written by hand earlier, whose doc comment already stated
 * the two things that make a sankey either honest or decorative:
 *
 *   > Node heights and ribbon thicknesses share one scale factor, so the picture stays honest
 *   > about its own numbers. Columns must each sum to the same total, or the ribbons will not
 *   > meet their nodes.
 *
 * The second of those is the whole design of this file. A sankey is a conservation diagram:
 * the claim it makes, before any number is read off it, is that what goes in comes out. When
 * the data does not conserve, a chart library has two choices and both are lies -- rescale
 * each column to fill the height, which makes a leak invisible and silently changes what a
 * pixel is worth between one stage and the next, or let the ribbons miss their nodes, which
 * looks like a rendering bug rather than a finding.
 *
 * This one takes a third. Every column is drawn to exactly the same total height, at one
 * shared scale, and the amount a column is short by is drawn as an explicit marked stub in
 * that column. The invariant holds on the page by construction; the stub is the part of it the
 * data did not pay for, it is labelled, and the caption says how much and where. See
 * {@link balance}.
 *
 * Everything except the pixel arithmetic happens here in Node -- the validation, the cycle
 * check, the node ordering, the value-space stacking offsets -- because those are decisions
 * and a decision made once is a decision a test can watch. The browser gets a model and turns
 * it into a grid, because `nodeWidth`, `gap` and `curve` are viewer settings and their
 * geometry genuinely cannot be precomputed.
 *
 * `CK` is loaded out of `kit.js` into a `vm` context rather than reimplemented, so `CK.hue`
 * picks the same eight series colours the rest of the desk uses and `CK.fmt` abbreviates
 * numbers the same way. A private copy would be a second source of truth, and two sources of
 * truth drift.
 *
 * @see ./matrix.mjs -- the sibling written alongside this one
 * @see ./chart.mjs -- the same emit shape and the same vm-loaded kit
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
 * @example loadKit().fmt(1200);   // '1.2k'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/flow: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/flow: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* Metrics for the 9px monospace `.ck-plot text` sets in kit.css. They decide how much room the
   labels get on either side, so a hair pessimistic costs a few pixels of margin. */
const CHW = 5.42;

/** The widest a node label may be before it is clipped and the tail marked. */
const LABEL_MAX = 120;

/** Characters of a node label kept before clipping. */
const LABEL_CHARS = 22;

/* The desk column is comfortable at 640, and a sankey has no reason to be wider: it grows
   downward with the number of nodes, not sideways with the number of stages. */
const W0 = 640;
const H0 = 320;

/* A drawing shorter than this stops being a sankey and becomes a set of lines, so the height
   grows instead of the scale shrinking. */
const H_FLOOR = 130;

/** How many ordering passes before we stop and say the layout did not settle. */
const ORDER_CAP = 24;

/** Bounds on the three numeric settings, so a hand-edited stored value cannot break geometry. */
const NW_MIN = 4;
const NW_MAX = 40;
const GAP_MAX = 40;

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Exported so a panel's field names can be checked against it in both directions rather than
 * trusted: a `name` in the markup that is not a key here is a control that silently does
 * nothing, and `CK.settings` -- correctly -- ignores it without complaining.
 *
 * `curve` is a bezier tension in 0..1, not a pixel count: 0 puts the control points on the
 * ribbon's own ends and gives a straight taper, 1 puts them on the midline and gives the
 * classic sankey S. It is a fraction because the horizontal distance between two stages
 * depends on how many stages there are, and a pixel value would mean something different in a
 * two-column diagram and a six-column one.
 *
 * @example defaults.curve;   // 0.5
 */
export const defaults = { nodeWidth: 14, gap: 8, curve: 0.5, labels: true };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * `shape` is a string on purpose: it is read by a person deciding what to feed the card, and
 * it has to read at a glance.
 *
 * @example meta.name;   // 'flow'
 */
export const meta = {
  name: 'flow',
  summary:
    'A sankey of quantities moving between stages, with every column drawn to the same total ' +
    'and any imbalance shown as a marked stub rather than scaled away.',
  shape:
    '{ nodes: [{ id, label, column }], links: [{ from, to, value }], unit, columns } -- ' +
    'column is a 0-based stage index and may be omitted, in which case every stage is ' +
    'inferred from the longest path to the node; columns is an optional list of stage names; ' +
    'unit is appended to every quantity',
  defaults,
};

/* -- small shared arithmetic ---------------------------------------------------------- */

/**
 * Round a number to two decimals, refusing to emit one that is not finite.
 *
 * A `NaN` in a path's `d` is silent: the browser drops the whole attribute and the ribbon
 * vanishes with nothing in the console. Failing loudly at build time turns that into a stack
 * trace next to the input that caused it.
 *
 * @param v    the number
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(1 / 3, 'offset');   // 0.33
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/flow: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the card's 9px mono face. */
function textW(s) { return String(s).length * CHW; }

/** Shorten a label to `max` characters, keeping the head and marking the cut. */
function clip(s, max) {
  const str = String(s);
  return str.length <= max ? str : str.slice(0, Math.max(1, max - 1)) + '\u2026';
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
 * @example jsonLit({ label: '</script>' });   // '{"label":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The card's id as it may appear inside a double-quoted CSS attribute selector.
 *
 * A quote in the id would end the selector early and leave the rest of the stylesheet as
 * garbage the browser skips silently.
 *
 * @example cssId('a"b');   // 'a\\"b'
 */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/* -- reading the data ----------------------------------------------------------------- */

/**
 * Normalise the node list, giving anonymous nodes an id and rejecting duplicate ids.
 *
 * A second node claiming an id that is already taken is discarded rather than merged: the
 * links naming that id would otherwise be split between two bars, and a sankey with a quantity
 * arbitrarily divided between two nodes of the same name is worse than one missing a node.
 *
 * @returns `{ list, byId, dupeIds }`
 *
 * @example readNodes([{ id: 'a' }, 'b']).list[1].label;   // 'b'
 */
function readNodes(list) {
  const out = [];
  const byId = new Map();
  let dupeIds = 0;
  const arr = Array.isArray(list) ? list : [];

  arr.forEach((raw, i) => {
    const o = raw && typeof raw === 'object' ? raw : { id: raw };
    const id = o.id == null ? 'node' + (i + 1) : String(o.id);
    if (byId.has(id)) { dupeIds++; return; }
    const col = Number(o.column);
    out.push({
      id,
      label: String(o.label == null ? id : o.label),
      column: Number.isInteger(col) && col >= 0 ? col : null,
    });
    byId.set(id, out.length - 1);
  });

  return { list: out, byId, dupeIds };
}

/**
 * Normalise the link list against the nodes, refusing everything that cannot be drawn.
 *
 * Five refusals, each counted so the caption can report them, because each one is a different
 * fact about the data and lumping them together would waste the report:
 *
 *   - `unknown`: an endpoint that names no node. Refused rather than invented. The offending
 *     names are kept, up to a handful, because "one link refers to a node called `stagng`" is
 *     a bug report and "one link was dropped" is not.
 *   - `zero`: a link of exactly zero. Dropped. A zero flow is the absence of a flow, and a
 *     ribbon of zero thickness is a hairline that reads as a small flow.
 *   - `bad`: a value that is negative or not a number. Negative flow has no reading in a
 *     conservation diagram -- it is not a flow the other way, because the other way is a
 *     different link.
 *   - `self`: a link from a node to itself. It is a cycle of length one and there is no
 *     geometry for it, so it is refused here where the message can be specific rather than
 *     surfacing as "this graph has a cycle".
 *   - `merged`: a second link between the same ordered pair. Summed into the first, which is
 *     the only reading a sankey has for it -- one ribbon, carrying both.
 *
 * @returns `{ list, drop }`
 *
 * @example readLinks([{ from: 'a', to: 'b', value: 3 }], nodes.byId).list[0].v;   // 3
 */
function readLinks(list, byId) {
  const arr = Array.isArray(list) ? list : [];
  const drop = { unknown: 0, zero: 0, bad: 0, self: 0, merged: 0, backward: 0, names: [] };
  const pairs = new Map();
  const out = [];

  const noteName = (v) => {
    const s = v == null ? '(missing)' : String(v);
    if (drop.names.length < 4 && drop.names.indexOf(s) < 0) drop.names.push(s);
  };

  for (const raw of arr) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const fk = o.from == null ? null : String(o.from);
    const tk = o.to == null ? null : String(o.to);
    const s = fk != null && byId.has(fk) ? byId.get(fk) : -1;
    const t = tk != null && byId.has(tk) ? byId.get(tk) : -1;

    if (s < 0 || t < 0) {
      drop.unknown++;
      if (s < 0) noteName(o.from);
      if (t < 0) noteName(o.to);
      continue;
    }
    if (s === t) { drop.self++; continue; }

    const v = Number(o.value);
    if (v === 0) { drop.zero++; continue; }
    if (!Number.isFinite(v) || v < 0) { drop.bad++; continue; }

    const key = s + '|' + t;
    if (pairs.has(key)) { out[pairs.get(key)].v += v; drop.merged++; continue; }
    pairs.set(key, out.length);
    out.push({ s, t, v });
  }

  return { list: out, drop };
}

/* -- refusing a cycle ----------------------------------------------------------------- */

/**
 * One directed cycle, as a list of node indices, or null when the graph is acyclic.
 *
 * A sankey is a column layout and a column layout is a DAG layout: a cycle has no left-to-right
 * arrangement at all, so there is nothing to draw and nothing to approximate. Refusing is the
 * only honest answer, and refusing *with the cycle in hand* is the useful one -- "a to b to c
 * to a" is a bug report, "this graph has a cycle" is a shrug.
 *
 * Iterative depth-first search with an explicit stack, three colours, and a recorded parent
 * chain. Iterative rather than recursive because the input is untrusted and a ten-thousand-node
 * chain would blow the call stack; the whole point of this function is that it terminates on
 * input designed to make a layout hang.
 *
 * @param count how many nodes there are
 * @param links `[{ s, t }]`
 * @returns the cycle as node indices, first repeated at neither end, or null
 *
 * @example findCycle(2, [{ s: 0, t: 1 }, { s: 1, t: 0 }]);   // [0, 1]
 */
function findCycle(count, links) {
  const adj = [];
  for (let i = 0; i < count; i++) adj.push([]);
  for (const l of links) adj[l.s].push(l.t);

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Uint8Array(count);
  const parent = new Int32Array(count).fill(-1);

  for (let root = 0; root < count; root++) {
    if (colour[root] !== WHITE) continue;
    /* Each frame is `[node, nextEdgeIndex]`; advancing the index in place is what makes this
       a faithful iterative DFS rather than a breadth-first walk wearing a stack. */
    const stack = [[root, 0]];
    colour[root] = GREY;

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = frame[0];
      if (frame[1] >= adj[node].length) {
        colour[node] = BLACK;
        stack.pop();
        continue;
      }
      const next = adj[node][frame[1]++];
      if (colour[next] === BLACK) continue;
      if (colour[next] === GREY) {
        /* Walk the parent chain back from the node that closed the loop to the node it
           closed onto, then reverse it, so the cycle is reported in the direction the links
           actually run: `a to b to c to a`, not some rotation of it read backwards. */
        const chain = [];
        for (let at = node; at !== next && at >= 0; at = parent[at]) chain.push(at);
        chain.push(next);
        return chain.reverse();
      }
      colour[next] = GREY;
      parent[next] = node;
      stack.push([next, 0]);
    }
  }

  return null;
}

/* -- stages --------------------------------------------------------------------------- */

/**
 * Give every node a stage, either the one it was handed or the one its longest path implies.
 *
 * Longest path rather than shortest, and that choice is visible in every sankey ever drawn: a
 * node fed by both a one-hop and a three-hop route belongs after both of them, or the three-hop
 * route has to run backwards to reach it. Shortest path would place it at stage one and leave a
 * ribbon travelling right to left.
 *
 * Columns are taken as given only when *every* node carries one. A half-specified layout is
 * refused as a whole rather than mixed, because an inferred stage and an authored stage are
 * answers to different questions and interleaving them produces a diagram whose column
 * positions mean two different things.
 *
 * Given columns are compacted: stages `0, 2, 7` become `0, 1, 2`. An empty stage is a column of
 * blank space that carries no quantity, and since every column is drawn to the same total, an
 * empty one would be drawn as a full-height stub of nothing.
 *
 * @param nodes the node list, whose `column` is read and then overwritten
 * @param links `[{ s, t }]`, already known to be acyclic
 * @returns `{ inferred, nCols }`
 *
 * @example assignColumns(nodes, links).nCols;   // 3
 */
function assignColumns(nodes, links) {
  const given = nodes.length > 0 && nodes.every((x) => x.column != null);

  if (!given) {
    /* Longest path by relaxation over a topological order. The graph is acyclic by the time
       this runs, so `count` passes is always enough and the loop cannot spin. */
    for (const x of nodes) x.column = 0;
    for (let pass = 0; pass < nodes.length; pass++) {
      let moved = false;
      for (const l of links) {
        if (nodes[l.t].column < nodes[l.s].column + 1) {
          nodes[l.t].column = nodes[l.s].column + 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  const used = [...new Set(nodes.map((x) => x.column))].sort((a, b) => a - b);
  const seat = new Map();
  used.forEach((v, i) => seat.set(v, i));
  for (const x of nodes) x.column = seat.get(x.column);

  return { inferred: !given, nCols: used.length };
}

/* -- ordering nodes within a column --------------------------------------------------- */

/**
 * How many pairs of ribbons cross, given the current ordering.
 *
 * The measure the ordering sweep is trying to reduce, computed rather than assumed so the
 * caption can say what the sweep actually bought and a test can check it did not spend it. Two
 * links cross when their endpoints are in opposite vertical order at the two ends: source `a`
 * above source `c` but target `b` below target `d`.
 *
 * Position is normalised within a column -- `(index + 0.5) / count` -- because two columns
 * rarely hold the same number of nodes and comparing a raw index 3 of 4 against a raw index 3
 * of 12 would call them level when one is near the bottom and the other near the top.
 *
 * O(links squared), which is fine for a card and would not be for a graph.
 *
 * @example crossings(links, pos);   // 14
 */
function crossings(links, pos) {
  let count = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const a = links[i];
      const b = links[j];
      const ds = pos[a.s] - pos[b.s];
      const dt = pos[a.t] - pos[b.t];
      if (ds * dt < 0) count++;
    }
  }
  return count;
}

/**
 * Order the nodes inside each column to bring connected nodes level with each other.
 *
 * The same barycentre idea the matrix card seriates with, run one column at a time: a node
 * moves to the mean height of what it is joined to. A forward pass fixes column 0 and orders
 * each later column against the one before it; a backward pass does the reverse. Alternating
 * them is what lets information travel both ways along the diagram.
 *
 * A node with no neighbours on the side being swept keeps its current position rather than
 * being given a barycentre it has no basis for -- which is also what stops the mean of an empty
 * set from ever being computed. Ties break on the node's previous position, so the result is
 * deterministic and two builds of the same data agree.
 *
 * The last step is a guard, and it earns its place for the same reason the matrix card's does.
 * Barycentre is a heuristic for crossings, not a minimiser of them: on a small enough diagram
 * it can and does hand back an arrangement with *more* crossings than the order it was given.
 * So the swept order is counted against the original and the loser is discarded. A card that
 * sometimes made the picture worse and called it ordering would be lying, and the caption
 * would be lying with it.
 *
 * @param nodes  the node list, read for columns
 * @param links  `[{ s, t }]`
 * @param cols   `[[nodeIdx]]` per column, permuted in place
 * @returns `{ passes, settled, before, after, reverted }` -- crossing counts either side
 *
 * @example orderColumns(nodes, links, cols).after;   // 3
 */
function orderColumns(nodes, links, cols) {
  const inAdj = [];
  const outAdj = [];
  for (let i = 0; i < nodes.length; i++) { inAdj.push([]); outAdj.push([]); }
  for (const l of links) { outAdj[l.s].push(l.t); inAdj[l.t].push(l.s); }

  const pos = new Float64Array(nodes.length);
  const refresh = () => {
    for (const col of cols) {
      for (let i = 0; i < col.length; i++) pos[col[i]] = (i + 0.5) / col.length;
    }
  };
  refresh();

  const before = crossings(links, pos);

  const sortOne = (col, adj) => {
    const prev = new Map();
    col.forEach((v, i) => prev.set(v, i));
    const keyed = col.map((v) => {
      const near = adj[v];
      if (!near.length) return [v, pos[v]];
      let s = 0;
      for (const u of near) s += pos[u];
      return [v, s / near.length];
    });
    keyed.sort((a, b) => (a[1] - b[1]) || (prev.get(a[0]) - prev.get(b[0])));
    for (let i = 0; i < col.length; i++) col[i] = keyed[i][0];
  };

  const snapshot = () => cols.map((c) => c.join(',')).join(';');
  const given = cols.map((c) => c.slice());

  let passes = 0;
  let settled = false;
  for (let p = 0; p < ORDER_CAP; p++) {
    const was = snapshot();
    for (let k = 1; k < cols.length; k++) { sortOne(cols[k], inAdj); refresh(); }
    for (let k = cols.length - 2; k >= 0; k--) { sortOne(cols[k], outAdj); refresh(); }
    if (snapshot() === was) { settled = true; break; }
    passes++;
  }

  const after = crossings(links, pos);
  if (after > before) {
    for (let k = 0; k < cols.length; k++) {
      cols[k].length = 0;
      for (const v of given[k]) cols[k].push(v);
    }
    refresh();
    return { passes, settled, before, after: before, reverted: true };
  }

  return { passes, settled, before, after, reverted: false };
}

/* -- the column-sum invariant --------------------------------------------------------- */

/**
 * Flow through every node, and how far each column is from carrying the whole quantity.
 *
 * **The invariant.** A sankey claims conservation. Read across, every stage should be handling
 * the same total, because the same stuff is passing through all of them; the columns are
 * snapshots of one quantity at different moments, not independent measurements. When that
 * holds, the ribbons leaving a column exactly fill the nodes of the next one and the picture
 * needs no fudging.
 *
 * **How it fails.** Two ways, and they are different failures worth reporting separately:
 *
 *   - a *node* leaks. It takes in five and passes on three. Its bar is drawn at five -- the
 *     larger of the two, so no ribbon is ever drawn wider than the bar it lands on -- and the
 *     two the node did not pass on is drawn as a marked stub at the bottom of the bar, exactly
 *     where the outgoing ribbons stop short. That is the true location of the discrepancy and
 *     it is where a reader will look for it.
 *   - a *column* is short. Its nodes, added up, carry less than the busiest column does. This
 *     is what a terminal node in an early stage looks like: money that arrives and stays put
 *     is counted once, in the stage it landed in, and every later stage is short by it. The
 *     shortfall is drawn as one marked stub at the foot of the column.
 *
 * **What is refused.** Rescaling. If each column were scaled to fill the height, a pixel would
 * be worth a different quantity in each column and every comparison a reader makes across the
 * diagram would be wrong -- which is precisely the comparison a sankey exists to support. So
 * the scale is global, the stubs make every column the same height, and the caption names the
 * gap. A sankey that quietly rescales is lying.
 *
 * @param nodes the node list
 * @param links `[{ s, t, v }]`
 * @param nCols how many stages
 * @returns `{ inflow, outflow, thr, leak, colTotal, shortfall, total, balanced, leaky }`
 *
 * @example balance(nodes, links, 2).balanced;   // true
 */
function balance(nodes, links, nCols) {
  const inflow = new Float64Array(nodes.length);
  const outflow = new Float64Array(nodes.length);
  for (const l of links) { outflow[l.s] += l.v; inflow[l.t] += l.v; }

  const thr = new Float64Array(nodes.length);
  const leak = new Float64Array(nodes.length);
  let leaky = 0;
  for (let i = 0; i < nodes.length; i++) {
    thr[i] = Math.max(inflow[i], outflow[i]);
    /* A source has no inflow and a sink no outflow; neither is a leak, they are the ends of
       the diagram. Only a node with both sides live can fail to pass its quantity on. */
    if (inflow[i] > 0 && outflow[i] > 0 && Math.abs(inflow[i] - outflow[i]) > 1e-9) {
      leak[i] = Math.abs(inflow[i] - outflow[i]);
      leaky++;
    }
  }

  const colTotal = new Float64Array(Math.max(1, nCols));
  for (let i = 0; i < nodes.length; i++) colTotal[nodes[i].column] += thr[i];

  let total = 0;
  for (const v of colTotal) if (v > total) total = v;

  const shortfall = [];
  let balanced = true;
  for (const v of colTotal) {
    const gap = total - v;
    shortfall.push(gap);
    if (gap > 1e-9) balanced = false;
  }

  return { inflow, outflow, thr, leak, colTotal: [...colTotal], shortfall, total, balanced, leaky };
}

/**
 * Where each ribbon attaches to its two nodes, measured in quantity rather than pixels.
 *
 * Offsets are in value space so they survive every setting the viewer can change: the browser
 * multiplies by one scale factor and the ribbon lands in the right place at any node width,
 * gap or height. Working in pixels here would mean recomputing the stacking on every drag of
 * the gap field.
 *
 * Ribbons leaving a node are stacked in the vertical order of where they are going, and
 * ribbons arriving are stacked in the order of where they came from. That is the entire reason
 * a well-drawn sankey has so few crossings near its nodes: without it, two ribbons that do not
 * cross between the columns will still cross in the last few pixels before they land.
 *
 * Both stacks start at the top of the node's bar. A leaking node's bar is taller than its
 * outgoing stack, so the unspent part falls at the bottom, which is where {@link balance} draws
 * the stub -- the gap and its explanation end up in the same place.
 *
 * @param links `[{ s, t, v }]`, given `so` and `to` in place
 * @param pos   vertical position per node, for the sort
 *
 * @example stack(links, pos); links[0].so;   // 0
 */
function stack(links, pos) {
  const out = new Map();
  const inn = new Map();
  for (const l of links) {
    if (!out.has(l.s)) out.set(l.s, []);
    if (!inn.has(l.t)) inn.set(l.t, []);
    out.get(l.s).push(l);
    inn.get(l.t).push(l);
  }

  for (const [, group] of out) {
    group.sort((a, b) => (pos[a.t] - pos[b.t]) || (a.t - b.t));
    let at = 0;
    for (const l of group) { l.so = at; at += l.v; }
  }
  for (const [, group] of inn) {
    group.sort((a, b) => (pos[a.s] - pos[b.s]) || (a.s - b.s));
    let at = 0;
    for (const l of group) { l.to = at; at += l.v; }
  }
}

/* -- saying what the picture shows ---------------------------------------------------- */

/**
 * A quantity as the card writes it: abbreviated, with the unit if there is one.
 *
 * @example money(1200, 'USD');   // '1.2k USD'
 */
function money(v, unit) { return CK.fmt(v) + (unit ? ' ' + unit : ''); }

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the label is the entire diagram to anyone using
 * it. "Sankey diagram" names the genre and withholds the content, so this leads with the two
 * numbers a sighted reader takes from the picture in the first second -- the total moving
 * through, and how many stages it moves through -- and then says whether the columns balance,
 * because that is the claim the whole drawing rests on.
 *
 * @returns `{ aria, caption }` -- plain text and escaped markup respectively
 *
 * @example describe(state).aria;
 * // 'Sankey diagram: 1.2m USD moving through 3 stages, across 7 nodes and 9 flows...'
 */
function describe(S) {
  const e = CK.esc;

  if (S.refused) {
    return {
      aria: 'Sankey refused: ' + S.refused,
      caption: '<b>refused</b> &mdash; ' + e(S.refused),
    };
  }
  if (!S.links.length) {
    const why = !S.nodes.length ? 'this card has no nodes' : 'no link survived reading';
    return {
      aria: 'An empty sankey: ' + why + ', so there is no flow to draw.',
      caption: '<b>nothing to draw</b> &mdash; ' + e(why) + '.',
    };
  }

  const totalTxt = money(S.bal.total, S.unit);
  const balanceLine = S.bal.balanced
    ? 'Every stage carries the whole ' + totalTxt + ', so the ribbons meet their nodes exactly.'
    : 'The stages do not all carry the same total: ' +
      S.bal.shortfall
        .map((v, i) => (v > 1e-9 ? 'stage ' + (i + 1) + ' is short by ' + money(v, S.unit) : ''))
        .filter(Boolean).join(', ') +
      '. Each shortfall is drawn as a marked stub rather than scaled away.';

  const leakLine = S.bal.leaky
    ? ' ' + plural(S.bal.leaky, 'node takes in more than it passes on', 'nodes take in more than they pass on') +
      '; the difference is the marked stub at the foot of each of those bars.'
    : '';

  const orderLine = S.order.before > S.order.after
    ? ' Ordering the nodes within their columns cut ribbon crossings from ' +
      S.order.before + ' to ' + S.order.after + '.'
    : S.order.before === 0
      ? ' No two ribbons cross.'
      : S.order.reverted
        ? ' The node order given already crossed least, at ' +
          plural(S.order.after, 'crossing', 'crossings') + ', so it stands.'
        : ' Ordering the nodes left ' + plural(S.order.after, 'crossing', 'crossings') + '.';

  const aria =
    'Sankey diagram: ' + totalTxt + ' moving through ' + plural(S.nCols, 'stage', 'stages') +
    ', across ' + plural(S.nodes.length, 'node', 'nodes') + ' and ' +
    plural(S.links.length, 'flow', 'flows') + '. ' + balanceLine + leakLine + orderLine;

  /* The verb agrees with the count. A card that reports "1 link ... were refused" reads as
     machine output, and a reader who notices the grammar starts wondering what else is
     generated rather than checked. */
  const was = (c) => (c === 1 ? ' was' : ' were');
  const junk = [];
  if (S.drop.unknown) {
    junk.push(plural(S.drop.unknown, 'link', 'links') + ' named a node that does not exist (' +
              S.drop.names.join(', ') + ') and' + was(S.drop.unknown) + ' refused');
  }
  if (S.drop.zero) junk.push(plural(S.drop.zero, 'zero-value link', 'zero-value links') + ' dropped');
  if (S.drop.bad) junk.push(plural(S.drop.bad, 'link', 'links') + ' had no usable value');
  if (S.drop.self) {
    junk.push(plural(S.drop.self, 'link', 'links') + ' pointed at ' +
              (S.drop.self === 1 ? 'its own node' : 'their own nodes'));
  }
  if (S.drop.merged) junk.push(plural(S.drop.merged, 'repeated link', 'repeated links') + ' merged into one ribbon');
  if (S.drop.backward) {
    junk.push(plural(S.drop.backward, 'link', 'links') + ' ran backwards or within one stage and' +
              was(S.drop.backward) + ' refused');
  }
  if (S.dupeIds) junk.push(plural(S.dupeIds, 'node', 'nodes') + ' repeated an id already taken');

  const caption =
    '<b>' + e(totalTxt) + '</b> through ' + e(plural(S.nCols, 'stage', 'stages')) + ' &mdash; ' +
    e(plural(S.nodes.length, 'node', 'nodes')) + ', ' + e(plural(S.links.length, 'flow', 'flows')) +
    (S.inferred ? ', <i>stages inferred from the longest path</i>' : '') + '. ' +
    (S.bal.balanced
      ? '<i>every stage carries the whole total</i>, so the ribbons meet their nodes. '
      : '<b>the stages do not balance</b> &mdash; ' +
        e(S.bal.shortfall.map((v, i) => (v > 1e-9 ? 'stage ' + (i + 1) + ' short by ' + money(v, S.unit) : ''))
          .filter(Boolean).join(', ')) +
        ', drawn as a marked stub rather than scaled away. ') +
    (S.bal.leaky ? e(plural(S.bal.leaky, 'node passes on less than it takes in', 'nodes pass on less than they take in')) + '. ' : '') +
    (S.order.before > S.order.after
      ? '<span class="ck-aside">node ordering cut crossings ' + S.order.before + ' to ' + S.order.after + '.</span>'
      : '') +
    (junk.length ? ' <span class="ck-aside">' + e(junk.join('; ')) + '.</span>' : '');

  return { aria: aria.replace(/\s+/g, ' ').trim(), caption: caption.trim() };
}

/* -- emit ----------------------------------------------------------------------------- */

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-flow[data-card="' + cssId(id) + '"]';
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
 * The stub is deliberately not a series colour and deliberately not solid. It is the one mark
 * on the card that stands for an absence, and it has to be impossible to mistake for a
 * quantity: hollow, dashed, and drawn in plain ink rather than in any hue that a ribbon might
 * also use.
 */
function cardCss(id) {
  const own = '.ck-flow[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-fl-scroll', 'margin-top: 2px;'],
    ['svg.ck-fl', 'display: block; width: 100%; height: auto;'],
    ['svg.ck-fl text', 'font-family: var(--mono);'],

    ['.ck-fl .node', 'fill: var(--ink-dim);'],
    ['.ck-fl .ribbon', 'stroke: none;'],
    ['.ck-fl .stub', 'fill: var(--ink); fill-opacity: .07; stroke: var(--rule); stroke-width: 1; stroke-dasharray: 2 2;'],
    ['.ck-fl .lab', 'fill: var(--ink-dim);'],
    ['.ck-fl .labf', 'fill: var(--ink-faint);'],
    ['.ck-fl .head', 'fill: var(--ink-faint); letter-spacing: .04em;'],
    ['.ck-fl .short', 'fill: var(--accent);'],

    ['.ck-fl-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],
    ['.ck-fl-void b', 'color: var(--accent); font-weight: 400;'],
    ['.ck-fl-void code', 'font-family: var(--mono); font-size: 11px; color: var(--ink-dim);'],

    ['.ck-set input[type="number"]', 'width: 6.5em;'],
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start; margin: 0;'],

    /* Hover lifts one ribbon out of the pile. Translucent ribbons are readable in aggregate
       and hard to follow one at a time, which is the trade a sankey makes; this buys back the
       single-ribbon reading without giving up the overlap. */
    ['.ck-fl .ribbon', 'transition: fill-opacity .12s linear;'],
    ['.ck-fl:hover .ribbon', 'fill-opacity: .16;'],
    ['.ck-fl .ribbon:hover', 'fill-opacity: .72;'],
  ];

  for (let i = 1; i <= 8; i++) rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);

  return scope(id, rules) + '\n' +
    '@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-fl .ribbon', 'transition: none;']]) +
    '\n}\n' +
    ':root[data-theme="light"] ' + own + ' .ck-fl .stub { fill-opacity: .10; }\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the diagram and the caption.
 *
 * Every interpolated value goes through `CK.esc`, including the cycle report -- a node label is
 * data, and the one place a card is most tempted to trust its input is the error message about
 * it.
 */
function cardHtml(id, title, S, note) {
  const e = CK.esc;
  const drawable = !S.refused && S.links.length > 0;

  const void_ = drawable ? '' :
    '  <div class="ck-fl-void">' +
    (S.refused
      ? 'this sankey was refused &mdash; ' + e(S.refused)
      : 'nothing to draw &mdash; ' + e(!S.nodes.length ? 'this card has no nodes' : 'no link survived reading')) +
    '</div>\n';

  const svg = !drawable ? '' :
    '  <div class="ck-scroll ck-fl-scroll">\n' +
    '    <svg class="ck-fl" role="img" viewBox="0 0 100 100" aria-label="' + e(note.aria) + '"></svg>\n' +
    '  </div>\n';

  return '<section data-card="' + e(id) + '" class="ck-flow">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-nodeWidth">node width</label>\n' +
    '    <input type="number" id="' + e(id) + '-nodeWidth" name="nodeWidth" min="' + NW_MIN +
    '" max="' + NW_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-gap">gap</label>\n' +
    '    <input type="number" id="' + e(id) + '-gap" name="gap" min="0" max="' + GAP_MAX + '" step="1">\n' +
    '    <label for="' + e(id) + '-curve">curve</label>\n' +
    '    <input type="number" id="' + e(id) + '-curve" name="curve" min="0" max="1" step="0.05">\n' +
    '    <label for="' + e(id) + '-labels">labels</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-labels" name="labels">\n' +
    '    <div class="ck-set-foot">curve is a bezier tension: 0 is a straight taper, 1 is the ' +
    'classic sankey S. every stage is drawn to the same total height, so a stage that carries ' +
    'less shows the difference as a dashed stub.</div>\n' +
    '  </div>\n' +
    void_ + svg +
    '  <div class="ck-cap">' + note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: turn a model into a grid of bars and ribbons.
 *
 * Classic script, ES5 vocabulary, no template literals and no arrow functions -- this is
 * concatenated into a page that ships no transpiler, and one modern-syntax parse error takes
 * the whole desk down rather than one card.
 *
 * Nothing here decides anything about the flow. The validation, the stage assignment, the node
 * ordering, the stacking offsets and both sentences were settled in Node. What is left is the
 * arithmetic that genuinely depends on the three numeric settings, and one scale factor shared
 * by node heights and ribbon thicknesses -- shared, because the moment they stop sharing it
 * the picture stops being about its own numbers.
 *
 * The settings are re-validated on the way in. They come out of `localStorage`, which is a text
 * file the viewer can edit, and a node width of `"tiny"` would put `NaN` into every coordinate
 * on the card.
 */
function cardJs(id, model, inst) {
  return `/* flow card: a precomputed sankey model, one shared scale, no layout in the browser. */
CK.build(${jsonLit(id)}, function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var M = ${jsonLit(model)};
  var DEF = ${jsonLit(inst)};

  var box = sec.querySelector("svg.ck-fl");

  /* One element, attributes set from a plain object. Text goes in with textContent, never
     innerHTML: every label here is data the card did not write. */
  function el(t, a, txt) {
    var e = document.createElementNS(NS, t), k;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function r1(v) { return Math.round(v * 10) / 10; }

  /* A stored setting is a string the viewer could have typed. Clamped rather than trusted, so
     a hand-edited value can make the diagram ugly but never non-finite. */
  function num(v, lo, hi, fallback) {
    var x = Number(v);
    if (!isFinite(x)) { return fallback; }
    if (x < lo) { return lo; }
    if (x > hi) { return hi; }
    return x;
  }

  /* Same idea for the checkbox: JSON round-trips a boolean, but a hand-edited "false" is a
     truthy string and would switch the labels back on. */
  function flag(v, fallback) {
    if (v === true || v === 1) { return true; }
    if (v === false || v === 0) { return false; }
    if (v === "true") { return true; }
    if (v === "false" || v === "") { return false; }
    return fallback;
  }

  function draw(cfg) {
    if (!box) { return; }

    var nw = Math.round(num(cfg.nodeWidth, M.nwMin, M.nwMax, DEF.nodeWidth));
    var gap = Math.round(num(cfg.gap, 0, M.gapMax, DEF.gap));
    var curve = num(cfg.curve, 0, 1, DEF.curve);
    var labels = flag(cfg.labels, DEF.labels);

    var padL = labels ? M.labW + 12 : 8;
    var padR = labels ? M.labW + 12 : 8;
    var padT = 8, padB = 8;
    var headT = labels && M.heads ? 15 : 0;

    var W = M.W;
    var span = W - padL - padR - nw;
    var step = M.nCols > 1 ? span / (M.nCols - 1) : 0;

    /* One scale factor for the whole card. Node heights and ribbon thicknesses both come
       from it, which is the only reason a ribbon can be compared to the bar it lands on. */
    var slack = M.H - padT - padB - headT - (M.maxSlots - 1) * gap;
    var k = M.total > 0 ? slack / M.total : 0;
    var floor = M.total > 0 ? M.hFloor / M.total : 0;
    if (k < floor) { k = floor; }
    var H = padT + padB + headT + M.total * k + (M.maxSlots - 1) * gap;

    function x0(col) { return padL + col * step; }

    /* Every column is drawn to exactly the same quantity -- its nodes plus its stub -- so the
       only thing that differs between columns is how many gaps they need, and that is what is
       centred out. */
    var tops = [], i, j;
    for (i = 0; i < M.cols.length; i++) {
      var slots = M.cols[i].slots;
      tops.push(padT + headT + ((M.maxSlots - slots) * gap) / 2);
    }

    /* Node tops in pixels, walked once so ribbons and bars cannot disagree about them. */
    var top = [];
    for (i = 0; i < M.cols.length; i++) {
      var at = tops[i], col = M.cols[i];
      for (j = 0; j < col.nodes.length; j++) {
        var ni = col.nodes[j];
        top[ni] = at;
        at += M.thr[ni] * k + gap;
      }
      col.stubTop = at;
    }

    var frag = document.createDocumentFragment();

    /* Ribbons first, then bars over them: a ribbon that overshoots its node by half a pixel
       should be hidden by the node, not drawn on top of it. */
    for (i = 0; i < M.links.length; i++) {
      var L = M.links[i];
      var ax = x0(M.col[L.s]) + nw, bx = x0(M.col[L.t]);
      var dx = bx - ax, t = curve * 0.5;
      var c0 = ax + dx * t, c1 = bx - dx * t;
      var ay = top[L.s] + L.so * k, by = top[L.t] + L.to * k;
      var th = L.v * k;
      var d = "M " + r1(ax) + " " + r1(ay) +
              " C " + r1(c0) + " " + r1(ay) + " " + r1(c1) + " " + r1(by) + " " + r1(bx) + " " + r1(by) +
              " L " + r1(bx) + " " + r1(by + th) +
              " C " + r1(c1) + " " + r1(by + th) + " " + r1(c0) + " " + r1(ay + th) + " " + r1(ax) + " " + r1(ay + th) +
              " Z";
      var rib = el("path", { "class": "ribbon", d: d, fill: L.hue, "fill-opacity": 0.34 });
      rib.appendChild(el("title", null,
        M.label[L.s] + " \\u2192 " + M.label[L.t] + " \\u00b7 " + CK.fmt(L.v) + M.unitSuffix));
      frag.appendChild(rib);
    }

    for (i = 0; i < M.thr.length; i++) {
      var h = M.thr[i] * k;
      if (h <= 0) { continue; }
      var bar = el("rect", { "class": "node", x: r1(x0(M.col[i])), y: r1(top[i]),
                             width: nw, height: r1(h) });
      bar.appendChild(el("title", null, M.nodeTip[i]));
      frag.appendChild(bar);

      /* The leak: the part of the bar no outgoing ribbon reaches, drawn where the ribbons
         actually stop rather than summarised somewhere else on the card. */
      if (M.leak[i] > 0) {
        frag.appendChild(el("rect", { "class": "stub", x: r1(x0(M.col[i])),
                                      y: r1(top[i] + h - M.leak[i] * k),
                                      width: nw, height: r1(M.leak[i] * k) }));
      }
    }

    /* The column stub: what this stage does not carry, so that every column really is drawn
       to the same total and the equality is a fact about the picture rather than a hope. */
    for (i = 0; i < M.cols.length; i++) {
      var sh = M.cols[i].shortfall;
      if (!(sh > 0)) { continue; }
      frag.appendChild(el("rect", { "class": "stub", x: r1(x0(i)), y: r1(M.cols[i].stubTop),
                                    width: nw, height: r1(sh * k) }));
      if (labels) {
        frag.appendChild(el("text", { "class": "short", x: r1(x0(i) + nw / 2),
                                      y: r1(M.cols[i].stubTop + sh * k / 2 + 3),
                                      "text-anchor": "middle", "font-size": 8.5 },
                            M.cols[i].shortText));
      }
    }

    if (labels) {
      for (i = 0; i < M.cols.length; i++) {
        if (M.heads) {
          frag.appendChild(el("text", { "class": "head", x: r1(x0(i) + nw / 2), y: r1(padT + 7),
                                        "text-anchor": "middle", "font-size": 8.5 },
                              M.cols[i].head));
        }
        var nodesIn = M.cols[i].nodes;
        for (j = 0; j < nodesIn.length; j++) {
          var q = nodesIn[j];
          if (!(M.thr[q] > 0)) { continue; }
          /* The first column's labels go outside on the left, into the margin reserved for
             them; every other column's go to the right of its bar. A middle column's label
             lies over the ribbons leaving it, which is what every sankey does and is why the
             labels are ink rather than a hue -- they have to read over colour. */
          var first = i === 0;
          var tx = first ? x0(i) - 6 : x0(i) + nw + 6;
          var anchor = first ? "end" : "start";
          var lab = el("text", { "class": "lab", x: r1(tx),
                                 y: r1(top[q] + M.thr[q] * k / 2 + 3),
                                 "text-anchor": anchor, "font-size": 9 }, M.short[q]);
          lab.appendChild(el("title", null, M.nodeTip[q]));
          frag.appendChild(lab);
        }
      }
    }

    while (box.firstChild) { box.removeChild(box.firstChild); }
    box.appendChild(frag);
    box.setAttribute("viewBox", "0 0 " + r1(W) + " " + r1(H));
    box.setAttribute("aria-label", M.aria);
    /* Below this the picture stops being readable, so the scroll box scrolls instead of the
       ribbons collapsing into lines. The desk column never widens either way. */
    box.style.minWidth = M.minW + "px";
  }

  CK.settings(sec, DEF, draw);
});
`;
}

/**
 * Build one flow card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` is the card's `card.json` as an object and
 *          carries the balance result and every refusal, so a test or a reader can check what
 *          the caption claims without re-running the layout
 *
 * @throws {Error} when the arithmetic produces a non-finite number, which means a bug here
 *                 rather than bad input: every malformed link is counted and refused on the
 *                 way in
 *
 * @example
 * build({
 *   id: 'funds',
 *   title: 'where the round went',
 *   data: {
 *     unit: 'USD',
 *     columns: ['raised', 'allocated', 'spent'],
 *     nodes: [{ id: 'round' }, { id: 'eng' }, { id: 'ops' }, { id: 'salaries' }, { id: 'cloud' }],
 *     links: [{ from: 'round', to: 'eng', value: 700000 },
 *             { from: 'round', to: 'ops', value: 300000 },
 *             { from: 'eng', to: 'salaries', value: 500000 },
 *             { from: 'eng', to: 'cloud', value: 200000 },
 *             { from: 'ops', to: 'salaries', value: 300000 }],
 *   },
 *   ord: 30,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'flow' : id);
  const d = data && typeof data === 'object' ? data : {};

  const unit = d.unit == null ? '' : String(d.unit);
  const heads = Array.isArray(d.columns) ? d.columns.map((c) => String(c == null ? '' : c)) : [];

  /* The instance's fallbacks, settled before anything can return early: a refused card still
     has a gear, and a gear whose panel silently stopped opening would be a worse bug than the
     refusal it sits above. `cardJs` bails at the missing `<svg>` and wires the panel anyway. */
  const inst = {
    nodeWidth: defaults.nodeWidth,
    gap: defaults.gap,
    curve: defaults.curve,
    labels: defaults.labels,
  };

  const nodesRead = readNodes(d.nodes);
  const nodes = nodesRead.list;
  const linksRead = readLinks(d.links, nodesRead.byId);
  let links = linksRead.list;
  const drop = linksRead.drop;

  /* The cycle check runs before anything that walks the graph, because the stage inference is
     a relaxation and a relaxation over a cyclic graph is the thing that would hang. */
  const cycle = links.length ? findCycle(nodes.length, links) : null;

  const state = {
    nodes, links, unit, drop,
    dupeIds: nodesRead.dupeIds,
    inferred: false,
    nCols: 0,
    refused: '',
    order: { passes: 0, settled: true, before: 0, after: 0, reverted: false },
    bal: { total: 0, balanced: true, leaky: 0, shortfall: [], thr: [], leak: [], colTotal: [] },
  };

  if (cycle) {
    /* Refused, not approximated. A cycle has no left-to-right arrangement at all, and every
       "solution" -- cutting an edge, folding the cycle into one node, drawing a ribbon that
       loops back -- silently changes the quantities the diagram claims to be reporting. */
    const names = cycle.map((i) => nodes[i].label);
    state.refused =
      'this is a directed cycle, and a sankey is a stage layout, which needs a direction. ' +
      names.join(' \u2192 ') + ' \u2192 ' + names[0] +
      '. Break the cycle, or model the repeat as its own later stage.';
    const note = describe(state);
    return {
      json: {
        ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
        type: 'flow', refused: 'cycle',
        cycle: cycle.map((i) => nodes[i].id),
        nodes: nodes.length, links: links.length,
      },
      html: cardHtml(cardId, title == null ? cardId : String(title), state, note),
      css: cardCss(cardId),
      js: cardJs(cardId, {}, inst),
    };
  }

  const cols = assignColumns(nodes, links);
  state.inferred = cols.inferred;
  state.nCols = cols.nCols;

  /* A link that runs backwards, or sideways within one stage, cannot be drawn on a column
     layout. Only reachable when the stages were authored: inference places every target after
     every source by construction. */
  if (!cols.inferred) {
    const kept = [];
    for (const l of links) {
      if (nodes[l.t].column <= nodes[l.s].column) { drop.backward++; continue; }
      kept.push(l);
    }
    links = kept;
    state.links = links;
  }

  if (!links.length) {
    const note = describe(state);
    return {
      json: {
        ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
        type: 'flow', nodes: nodes.length, links: 0, stages: state.nCols,
        total: 0, balanced: true, dropped: drop,
      },
      html: cardHtml(cardId, title == null ? cardId : String(title), state, note),
      css: cardCss(cardId),
      js: cardJs(cardId, {}, inst),
    };
  }

  const byCol = [];
  for (let k = 0; k < cols.nCols; k++) byCol.push([]);
  nodes.forEach((x, i) => byCol[x.column].push(i));

  const order = orderColumns(nodes, links, byCol);
  state.order = order;

  const pos = new Float64Array(nodes.length);
  for (const col of byCol) for (let i = 0; i < col.length; i++) pos[col[i]] = (i + 0.5) / col.length;
  stack(links, pos);

  const bal = balance(nodes, links, cols.nCols);
  state.bal = bal;

  const note = describe(state);

  const short = nodes.map((x) => clip(x.label, LABEL_CHARS));
  const labW = Math.min(LABEL_MAX, short.reduce((m, s) => Math.max(m, textW(s)), 0));

  const maxSlots = byCol.reduce(
    (m, col, k) => Math.max(m, col.length + (bal.shortfall[k] > 1e-9 ? 1 : 0)), 1);

  const model = {
    W: W0,
    H: H0,
    hFloor: H_FLOOR,
    minW: Math.round(Math.min(W0, 300 + 2 * labW)),
    nCols: cols.nCols,
    nwMin: NW_MIN,
    nwMax: NW_MAX,
    gapMax: GAP_MAX,
    total: n(bal.total, 'total'),
    maxSlots,
    heads: heads.length > 0 ? 1 : 0,
    unitSuffix: unit ? ' ' + unit : '',
    label: nodes.map((x) => x.label),
    short,
    labW: n(labW, 'labW'),
    col: nodes.map((x) => x.column),
    thr: [...bal.thr].map((v) => n(v, 'throughput')),
    leak: [...bal.leak].map((v) => n(v, 'leak')),
    nodeTip: nodes.map((x, i) =>
      x.label + ' \u00b7 in ' + money(bal.inflow[i], unit) + ' \u00b7 out ' + money(bal.outflow[i], unit)),
    cols: byCol.map((col, k) => ({
      nodes: col,
      slots: col.length + (bal.shortfall[k] > 1e-9 ? 1 : 0),
      shortfall: n(bal.shortfall[k], 'shortfall'),
      shortText: bal.shortfall[k] > 1e-9 ? 'short ' + money(bal.shortfall[k], unit) : '',
      head: heads[k] == null ? 'stage ' + (k + 1) : clip(heads[k], LABEL_CHARS),
    })),
    links: links.map((l) => ({
      s: l.s, t: l.t,
      v: n(l.v, 'link value'),
      so: n(l.so, 'source offset'),
      to: n(l.to, 'target offset'),
      /* Coloured by source, so a ribbon's colour answers "where did this come from" -- the
         question a reader asks of a fan-out, which is the shape a sankey most often is. */
      hue: CK.hue(l.s),
    })),
    aria: note.aria,
  };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'flow',
      nodes: nodes.length,
      links: links.length,
      stages: cols.nCols,
      inferredStages: cols.inferred,
      total: n(bal.total, 'total'),
      balanced: bal.balanced,
      shortfall: bal.shortfall.map((v) => n(v, 'shortfall')),
      leakyNodes: bal.leaky,
      crossingsBefore: order.before,
      crossingsAfter: order.after,
      orderPasses: order.passes,
      orderSettled: order.settled,
      orderReverted: order.reverted,
      dropped: { unknown: drop.unknown, zero: drop.zero, bad: drop.bad, self: drop.self,
                 merged: drop.merged, backward: drop.backward, dupeIds: nodesRead.dupeIds },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), state, note),
    css: cardCss(cardId),
    js: cardJs(cardId, model, inst),
  };
}
