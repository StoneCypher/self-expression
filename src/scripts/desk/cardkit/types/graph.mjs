/**
 * `graph` — a card type that draws node-link diagrams by hand, laid out before they ship.
 *
 * The desk's CSP is `script-src 'self'`: no d3, no cytoscape, no elk. So the layouts are
 * here, in about three hundred lines, and each of the three is a named published heuristic
 * rather than something improvised — which matters mostly because it means each one has a
 * known set of things it is bad at, and those are written down beside it.
 *
 * Everything runs in Node at build time and the browser receives coordinates. For the force
 * layout that is not an optimisation, it is the entire point: a simulation that runs on load
 * settles somewhere slightly different every time, and a diagram that is not the same
 * diagram twice is not a picture of anything. You cannot point at it. You cannot say "the
 * node on the left" in a comment and have it still be true tomorrow. So the randomness is
 * seeded from the graph's own contents with a PRNG written out below, the simulation is run
 * here, and what the page gets is a drawing.
 *
 * @see ./chart.mjs — the XY sibling, same contract, same display-list emit
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context with a
 * `window` object on it is enough — nothing reaches for the DOM until a function that needs
 * it is called, and we call none of those.
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
  catch (e) { throw new Error('cardkit/graph: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/graph: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/** The three layouts. Anything else falls back to `force`, which needs no structure to work. */
const LAYOUTS = new Set(['force', 'layered', 'circle']);

/* Metrics for the 9px mono that `.ck-plot text` sets in kit.css — see chart.mjs, same face. */
const CHW = 5.42;
const TXT = 9;

const W0 = 640;          // the desk column's comfortable width; wider than this scrolls
const H0 = 420;
const LABEL_MAX = 90;    // px; past this a label is clipped rather than allowed to set the scale

/** How many passes the force simulation takes. Fixed, because "until it settles" is not a picture. */
const FORCE_ITERS = 420;

/**
 * Strength of the spring holding every node toward the origin.
 *
 * Not from the paper. Plain Fruchterman–Reingold has no term binding one connected component
 * to another, so a graph with two islands pushes them apart for as long as it is allowed to
 * run; the fit step then shrinks everything to get both in frame and the result is two specks
 * in opposite corners. Tuned by eye against a two-island graph: low enough that a connected
 * graph still spreads to fill its box, high enough that islands stay in the same picture.
 */
const CENTER_PULL = 0.45;

/**
 * What this card type is and what it will accept.
 *
 * `shape` is one line of prose-shaped source because it is read by whoever is deciding what to
 * feed the card, and the thing they need told — that `edges` is triples and `weight` is optional
 * — is a sentence. In `nodes`, `id` is the identity, `label` the caption, and `group` the colour
 * class; `directed` gives edges arrowheads and makes layering follow their direction.
 *
 * There is no `defaults` because there is no gear: the layout is chosen by the data and computed
 * once at build time, so there is nothing for a viewer to change afterwards.
 */
export const meta = {
  name: 'graph',
  summary:
    'A node-link diagram laid out at build time by a seeded force simulation, longest-path ' +
    'layering, or a crossing-reducing circular order — so it draws the same picture every load.',
  shape: "{ nodes: [{ id, label, group }], edges: [[from, to, weight]], directed, layout: 'force' | 'layered' | 'circle' } — weight is optional and maps to stroke width",
};

/* ── small shared arithmetic ─────────────────────────────────────────────────────────── */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A `NaN` in a path is silent — the browser drops the whole `d` and the card renders empty
 * with nothing in the console. In a file whose job is iterative numerical layout that is not
 * a hypothetical: a single coincident pair of nodes divides by zero once and the graph
 * disappears. Failing here turns that into a stack trace pointing at the layout that did it.
 *
 * @param v    the coordinate
 * @param what a short name for the caller, so the message says which step went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n(12.3456, 'force fit');   // 12.35
 */
function n(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/graph: non-finite coordinate from ' + (what || 'layout') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the plot's mono face. */
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
 * `<` and `>` become escapes, so a node label containing `</script>` cannot close the block
 * early and no label can smuggle a `=>` into a file that is contractually free of arrow
 * functions. Backticks go for the same contract, and the two Unicode line separators because
 * a JS parser treats them as newlines and `JSON.stringify` does not.
 *
 * @example jsonLit(['a</b>']);   // '["a\\u003c/b\\u003e"]'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** An id reduced to what may appear in a CSS selector and a URL fragment. */
function slug(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '-') || 'g'; }

/* ── the seeded PRNG ─────────────────────────────────────────────────────────────────── */

/**
 * FNV-1a over a string, as the force layout's seed.
 *
 * Seeding from the graph's *contents* rather than from a constant means two different graphs
 * on one desk do not both start from the same cloud of points and inherit the same
 * accidental symmetry — and it means the same graph draws the same picture wherever it
 * appears, under whatever card id, which is what makes "the node bottom-left" a thing a
 * person can write in a comment.
 *
 * @param s any string; here, a canonical rendering of the node ids and edges
 * @returns an unsigned 32-bit hash
 *
 * @example fnv1a('a|b');   // 1868898762
 */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 — a 32-bit PRNG in five lines, so the layout owns its own randomness.
 *
 * `Math.random` cannot be seeded, and an unseeded force layout is the bug this whole file is
 * arranged to avoid. mulberry32 is chosen for being short enough to read and verify by eye
 * while still passing gjrand's basic suite; nothing here needs cryptographic quality, it
 * needs *the same numbers next time*.
 *
 * @param seed any 32-bit integer
 * @returns a function yielding floats in [0, 1)
 *
 * @example
 * var r = mulberry32(7);
 * r(); r();          // the same two numbers on every run, on every machine
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── reading the data ────────────────────────────────────────────────────────────────── */

/**
 * Normalise whatever arrived into the one shape the layouts may assume.
 *
 * Edges naming a node that does not exist are dropped rather than autovivified: a dangling
 * reference is a mistake in the data, and inventing a node for it puts a thing on the
 * diagram that nobody meant to draw. Duplicate node ids collapse to the first, for the same
 * reason — the second one is a typo, not a second node.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ nodes, edges, directed, layout, groups, dropped }`
 *
 * @example
 * readGraph({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [['a', 'b', 3]], directed: true });
 */
function readGraph(data) {
  const d = data && typeof data === 'object' ? data : {};
  const layout = LAYOUTS.has(d.layout) ? d.layout : 'force';

  const nodes = [];
  const index = new Map();
  const groups = [];
  for (const raw of Array.isArray(d.nodes) ? d.nodes : []) {
    if (!raw || raw.id == null) continue;
    const id = String(raw.id);
    if (index.has(id)) continue;
    const group = raw.group == null ? '' : String(raw.group);
    if (group && !groups.includes(group)) groups.push(group);
    index.set(id, nodes.length);
    nodes.push({
      id,
      label: String(raw.label == null ? id : raw.label),
      group,
      gi: 0,
      deg: 0,
    });
  }
  for (const node of nodes) node.gi = node.group ? groups.indexOf(node.group) : 0;

  const edges = [];
  let dropped = 0;
  for (const raw of Array.isArray(d.edges) ? d.edges : []) {
    /* Triples are the documented form; the object form costs three lines to accept and
       spares a caller who has edges from somewhere else a pointless remapping pass. */
    const from = Array.isArray(raw) ? raw[0] : raw && raw.from;
    const to = Array.isArray(raw) ? raw[1] : raw && raw.to;
    const wRaw = Array.isArray(raw) ? raw[2] : raw && raw.weight;
    if (from == null || to == null) { dropped++; continue; }
    const a = index.get(String(from));
    const b = index.get(String(to));
    if (a === undefined || b === undefined) { dropped++; continue; }
    const w = Number.isFinite(Number(wRaw)) && Number(wRaw) > 0 ? Number(wRaw) : 1;
    edges.push({ a, b, w, loop: a === b });
    nodes[a].deg++;
    if (a !== b) nodes[b].deg++;
  }

  return { nodes, edges, directed: !!d.directed, layout, groups, dropped, index };
}

/**
 * The seed string: a canonical rendering of the graph, and nothing else.
 *
 * Deliberately excludes the card id, the title and the layout name, so the same graph is the
 * same picture no matter which card is showing it. Includes the weights, because they change
 * the simulation and a different simulation should not pretend to be the same run.
 */
function seedOf(G) {
  return G.nodes.map((v) => v.id).join('\u0000') + '|' +
         G.edges.map((e) => G.nodes[e.a].id + '>' + G.nodes[e.b].id + ':' + e.w).join(',');
}

/* ── layout: force ───────────────────────────────────────────────────────────────────── */

/**
 * Fruchterman–Reingold, seeded, with a fixed iteration count and a pull toward the centre.
 *
 * The model: every pair of nodes pushes apart with k²/d, every edge pulls together with
 * d²/k, and a global temperature caps how far anything may move in one step and cools to
 * nothing — so early passes rearrange freely and late ones only settle. `k` is the natural
 * edge length for the available area, so the drawing fills its box rather than needing to be
 * tuned per graph.
 *
 * Two departures from the paper, both to fix things that look wrong on a card:
 *
 * - A weak spring to the centre. Plain FR has no term binding one component to another, so a
 *   graph with two islands pushes them apart forever and the fit step then shrinks the whole
 *   drawing to fit both, leaving two specks. Gravity holds them in one frame.
 * - Edge attraction scales with weight, so a heavy edge is a short edge. Weight already maps
 *   to stroke width; having it also mean proximity makes the two readings agree.
 *
 * What it is bad at, and no parameter fixes: trees come out with visible arbitrary asymmetry
 * (FR has no notion of hierarchy — use `layered`); dense graphs above roughly forty nodes
 * converge to a hairball where edge crossings carry no information; and the layout is O(n²)
 * per pass, which is fine at card scale and would not be at ten thousand nodes.
 *
 * @param G    a graph from {@link readGraph}
 * @param rand a seeded PRNG; the same one twice gives the same drawing
 * @returns one `{ x, y }` per node, in an arbitrary coordinate frame for {@link fit}
 *
 * @example forceLayout(G, mulberry32(7));   // [{ x: 118.2, y: -40.6 }, …]
 */
function forceLayout(G, rand) {
  const N = G.nodes.length;
  const pos = [];
  if (!N) return pos;

  const area = W0 * H0;
  const k = Math.sqrt(area / N);
  const spread = Math.min(W0, H0) / 3;

  for (let i = 0; i < N; i++) {
    pos.push({ x: (rand() * 2 - 1) * spread, y: (rand() * 2 - 1) * spread });
  }
  if (N === 1) return [{ x: 0, y: 0 }];

  /* A heavy edge is a short edge. `CK.scale` parks a zero-width weight domain at the middle
     of the range rather than dividing by zero, so an unweighted graph gets one pull for
     every edge without a special case here. */
  let wlo = Infinity;
  let whi = -Infinity;
  for (const e of G.edges) { if (e.w < wlo) wlo = e.w; if (e.w > whi) whi = e.w; }
  const pull = Number.isFinite(wlo) ? CK.scale([wlo, whi], [0.7, 1.7]) : () => 1;

  const dx = new Float64Array(N);
  const dy = new Float64Array(N);
  let temp = Math.min(W0, H0) / 6;

  for (let step = 0; step < FORCE_ITERS; step++) {
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let ax = pos[i].x - pos[j].x;
        let ay = pos[i].y - pos[j].y;
        let d2 = ax * ax + ay * ay;
        /* Two nodes exactly on top of each other have no direction to separate along. The
           nudge comes from the seeded stream, so even this tie-break is reproducible. */
        if (d2 < 1e-9) {
          ax = (rand() - 0.5) * 0.01;
          ay = (rand() - 0.5) * 0.01;
          d2 = ax * ax + ay * ay || 1e-9;
        }
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        dx[i] += (ax / d) * f; dy[i] += (ay / d) * f;
        dx[j] -= (ax / d) * f; dy[j] -= (ay / d) * f;
      }
    }

    for (const e of G.edges) {
      if (e.loop) continue;                        // a self-loop pulls a node toward itself
      let ax = pos[e.a].x - pos[e.b].x;
      let ay = pos[e.a].y - pos[e.b].y;
      const d = Math.sqrt(ax * ax + ay * ay);
      if (d < 1e-9) continue;
      const f = ((d * d) / k) * pull(e.w);
      dx[e.a] -= (ax / d) * f; dy[e.a] -= (ay / d) * f;
      dx[e.b] += (ax / d) * f; dy[e.b] += (ay / d) * f;
    }

    for (let i = 0; i < N; i++) {
      dx[i] -= pos[i].x * CENTER_PULL;
      dy[i] -= pos[i].y * CENTER_PULL;
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (len < 1e-9) continue;
      const move = Math.min(len, temp);
      pos[i].x += (dx[i] / len) * move;
      pos[i].y += (dy[i] / len) * move;
    }

    temp *= 0.985;
  }

  return pos;
}

/* ── layout: layered ─────────────────────────────────────────────────────────────────── */

/**
 * Longest-path layering, dummy nodes for long edges, then a barycentre sweep.
 *
 * This is the useful two-thirds of Sugiyama's method:
 *
 * 1. **Break cycles.** Layering needs a DAG. A depth-first search marks every edge that
 *    returns to a node still on the stack as a back edge and sets it aside. Which edges get
 *    picked depends on the order nodes arrive in, so the choice is arbitrary but stable.
 * 2. **Layer.** Each node sits one below the lowest it can: `layer(v) = 1 + max(layer(u))`
 *    over its acyclic predecessors. Sources land on layer 0.
 * 3. **Dummies.** An edge spanning more than one layer gets an invisible node on each layer
 *    it crosses, and the edge is drawn through them. Without this the sweep cannot see long
 *    edges at all and routes them straight through whatever node happens to be in the way —
 *    which is the single most common reason a hand-rolled layered graph looks broken.
 * 4. **Sweep.** Repeatedly reorder each layer by the mean position of its neighbours in the
 *    layer above, then in the layer below. Crossings are counted after every pass and the
 *    best ordering seen is the one returned, because barycentre is not monotone and a later
 *    pass can be worse than an earlier one.
 *
 * Failure modes worth knowing. Longest-path layering makes the drawing as tall as the graph's
 * longest path and tends to pile nodes into the last layer, which is why real Sugiyama uses
 * Coffman–Graham or a network simplex instead — for card-sized graphs the extra height is
 * cheaper than the extra code. Barycentre is a heuristic with no bound, so a graph can retain
 * crossings that an exact method would remove. And an undirected graph is layered by the
 * direction the edges were *written* in, which is the only signal available; if that order is
 * meaningless, so is the hierarchy, and `force` is the honest layout to ask for.
 *
 * @param G a graph from {@link readGraph}
 * @returns `{ pos, cells, chains, layers, crossings }` — `chains` are the routed polylines
 *
 * @example layeredLayout(G).layers;   // 4
 */
function layeredLayout(G) {
  const N = G.nodes.length;
  if (!N) return { pos: [], chains: [], layers: 0, crossings: 0, width: 1 };

  /* ── 1. cycle breaking, by iterative DFS ── */
  const out = G.nodes.map(() => []);
  G.edges.forEach((e, i) => { if (!e.loop) out[e.a].push({ to: e.b, i }); });

  const colour = new Uint8Array(N);          // 0 unseen · 1 on the stack · 2 finished
  const back = new Set();
  for (let root = 0; root < N; root++) {
    if (colour[root]) continue;
    const stack = [{ v: root, k: 0 }];
    colour[root] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.k < out[top.v].length) {
        const edge = out[top.v][top.k++];
        if (colour[edge.to] === 1) back.add(edge.i);
        else if (colour[edge.to] === 0) { colour[edge.to] = 1; stack.push({ v: edge.to, k: 0 }); }
      } else {
        colour[top.v] = 2;
        stack.pop();
      }
    }
  }

  /* ── 2. longest-path layering over the acyclic remainder, by Kahn's order ── */
  const forward = G.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => !e.loop && !back.has(i));

  const indeg = new Int32Array(N);
  for (const { e } of forward) indeg[e.b]++;
  const layer = new Int32Array(N);
  const queue = [];
  for (let i = 0; i < N; i++) if (!indeg[i]) queue.push(i);
  const succ = G.nodes.map(() => []);
  for (const { e } of forward) succ[e.a].push(e.b);

  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const w of succ[v]) {
      if (layer[w] < layer[v] + 1) layer[w] = layer[v] + 1;
      if (--indeg[w] === 0) queue.push(w);
    }
  }
  const layers = Math.max(...layer) + 1;

  /* ── 3. cells, one per node plus one per layer a long edge crosses ── */
  const order = Array.from({ length: layers }, () => []);
  const cells = [];                          // { layer, node: index | -1 }
  const cellOfNode = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    cellOfNode[i] = cells.length;
    cells.push({ layer: layer[i], node: i });
    order[layer[i]].push(cells.length - 1);
  }

  const segs = Array.from({ length: Math.max(0, layers - 1) }, () => []);
  const chains = [];                         // one polyline of cell indices per drawn edge
  G.edges.forEach((e, i) => {
    if (e.loop) { chains.push({ edge: i, cells: [cellOfNode[e.a]] }); return; }
    const la = layer[e.a];
    const lb = layer[e.b];
    if (la === lb) { chains.push({ edge: i, cells: [cellOfNode[e.a], cellOfNode[e.b]] }); return; }

    const down = la < lb;
    const lo = down ? la : lb;
    const hi = down ? lb : la;
    const path = [down ? cellOfNode[e.a] : cellOfNode[e.b]];
    for (let l = lo + 1; l < hi; l++) {
      const c = cells.length;
      cells.push({ layer: l, node: -1 });
      order[l].push(c);
      path.push(c);
    }
    path.push(down ? cellOfNode[e.b] : cellOfNode[e.a]);
    for (let s = 0; s < path.length - 1; s++) segs[lo + s].push([path[s], path[s + 1]]);
    chains.push({ edge: i, cells: down ? path : path.slice().reverse() });
  });

  /* ── 4. barycentre sweep, keeping the best ordering rather than the last ── */
  let best = order.map((row) => row.slice());
  let bestCross = countCrossings(best, segs);
  let work = order.map((row) => row.slice());

  for (let pass = 0; pass < 10; pass++) {
    sweep(work, segs, pass % 2 === 0);
    const c = countCrossings(work, segs);
    if (c < bestCross) { bestCross = c; best = work.map((row) => row.slice()); }
  }

  /* ── 5. coordinates: one common slot width so layers line up as columns ── */
  const widest = best.reduce((m, row) => Math.max(m, row.length), 1);
  const pos = new Array(cells.length);
  best.forEach((row, l) => {
    row.forEach((c, i) => {
      pos[c] = { x: (i - (row.length - 1) / 2), y: l };
    });
  });

  return { pos, cells, chains, cellOfNode, layers, crossings: bestCross, width: widest, order: best };
}

/** Reorder each layer by the barycentre of its neighbours in the adjacent layer. */
function sweep(order, segs, down) {
  const range = down
    ? Array.from({ length: order.length - 1 }, (_, i) => i + 1)
    : Array.from({ length: order.length - 1 }, (_, i) => order.length - 2 - i);

  for (const l of range) {
    const from = down ? l - 1 : l + 1;
    const links = down ? segs[l - 1] : segs[l];
    const place = new Map();
    order[from].forEach((c, i) => place.set(c, i));

    const bar = new Map();
    for (const [a, b] of links) {
      const me = down ? b : a;
      const them = down ? a : b;
      const acc = bar.get(me) || { s: 0, k: 0 };
      acc.s += place.get(them);
      acc.k++;
      bar.set(me, acc);
    }

    /* A cell with no neighbour in the reference layer keeps where it is rather than being
       parked at an end, where it would masquerade as an extreme of an ordering it took no
       part in. `sort` is stable, so equal barycentres preserve the previous pass's order. */
    const now = new Map();
    order[l].forEach((c, i) => now.set(c, i));
    const key = (c) => {
      const acc = bar.get(c);
      return acc ? acc.s / acc.k : now.get(c);
    };
    order[l].sort((p, q) => key(p) - key(q));
  }
}

/** Edge crossings between every adjacent pair of layers, counted exactly. */
function countCrossings(order, segs) {
  let total = 0;
  for (let l = 0; l < segs.length; l++) {
    const up = new Map();
    const dn = new Map();
    order[l].forEach((c, i) => up.set(c, i));
    order[l + 1].forEach((c, i) => dn.set(c, i));
    const links = segs[l];
    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) {
        const a = up.get(links[i][0]) - up.get(links[j][0]);
        const b = dn.get(links[i][1]) - dn.get(links[j][1]);
        if (a * b < 0) total++;
      }
    }
  }
  return total;
}

/* ── layout: circle ──────────────────────────────────────────────────────────────────── */

/**
 * Nodes evenly on a circle, in an order chosen to cut chord crossings.
 *
 * Evenly spaced is the easy half; the order is the whole problem, and finding the optimum is
 * NP-hard, so this runs two cheap heuristics and keeps whichever actually scores better:
 *
 * - **Greedy adjacency.** Start at the highest-degree node and repeatedly append whichever
 *   unplaced node has the most already-placed neighbours. Clusters end up contiguous, and
 *   contiguous clusters mean short chords, and short chords cross less.
 * - **Circular barycentre.** Move each node to the mean *angle* of its neighbours — summed as
 *   unit vectors, because the mean of 350° and 10° is 0° and not 180° — then re-space
 *   everyone evenly in that angular order. Repeated a few times.
 *
 * Crossings are counted exactly (two chords cross iff their endpoints interleave), so the
 * caption can state the improvement instead of claiming one.
 *
 * Bad at: complete or near-complete graphs, where every order gives the same hairball and
 * the count barely moves; and graphs with one very high-degree hub, whose chords fan across
 * the whole disc no matter where the hub sits. A star is a `force` or `layered` picture.
 *
 * @param G a graph from {@link readGraph}
 * @returns `{ pos, before, after }` — positions in unit coordinates, and the two counts
 *
 * @example circleLayout(G).after;   // 11
 */
function circleLayout(G) {
  const N = G.nodes.length;
  if (!N) return { pos: [], before: 0, after: 0 };
  if (N === 1) return { pos: [{ x: 0, y: 0 }], before: 0, after: 0 };

  const nbr = G.nodes.map(() => new Set());
  for (const e of G.edges) if (!e.loop) { nbr[e.a].add(e.b); nbr[e.b].add(e.a); }

  /* ── greedy adjacency order ── */
  const placed = new Set();
  const greedy = [];
  const byDeg = G.nodes.map((v, i) => i).sort((a, b) => G.nodes[b].deg - G.nodes[a].deg || a - b);
  while (greedy.length < N) {
    let pick = -1;
    let score = -1;
    for (const i of byDeg) {
      if (placed.has(i)) continue;
      let seen = 0;
      for (const j of nbr[i]) if (placed.has(j)) seen++;
      if (seen > score) { score = seen; pick = i; }
    }
    greedy.push(pick);
    placed.add(pick);
  }

  const before = chordCrossings(greedy, G.edges);

  /* ── circular barycentre refinement ── */
  let cur = greedy.slice();
  for (let pass = 0; pass < 24; pass++) {
    const slot = new Map();
    cur.forEach((v, i) => slot.set(v, (i / cur.length) * Math.PI * 2));
    const want = cur.map((v) => {
      let sx = 0;
      let sy = 0;
      for (const j of nbr[v]) { sx += Math.cos(slot.get(j)); sy += Math.sin(slot.get(j)); }
      /* No neighbours, or neighbours that cancel exactly: keep the current angle rather than
         inventing one — atan2(0, 0) is 0, which would stack every isolate at three o'clock. */
      return { v, a: sx === 0 && sy === 0 ? slot.get(v) : (Math.atan2(sy, sx) + Math.PI * 4) % (Math.PI * 2) };
    });
    want.sort((p, q) => p.a - q.a || cur.indexOf(p.v) - cur.indexOf(q.v));
    const next = want.map((p) => p.v);
    if (next.join(',') === cur.join(',')) break;
    cur = next;
  }

  const refined = chordCrossings(cur, G.edges);
  const order = refined <= before ? cur : greedy;

  const pos = new Array(N);
  order.forEach((v, i) => {
    /* Start at twelve o'clock and run clockwise: a reader looking for "the first one" looks
       at the top, and a circular layout with no landmark is hard to talk about. */
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    pos[v] = { x: Math.cos(a), y: Math.sin(a), angle: a };
  });

  return { pos, before, after: Math.min(before, refined) };
}

/** Chord crossings for one circular order: two chords cross iff their endpoints interleave. */
function chordCrossings(order, edges) {
  const at = new Map();
  order.forEach((v, i) => at.set(v, i));
  const spans = [];
  for (const e of edges) {
    if (e.loop) continue;
    const p = at.get(e.a);
    const q = at.get(e.b);
    spans.push(p < q ? [p, q] : [q, p]);
  }
  let total = 0;
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const [a, b] = spans[i];
      const [c, d] = spans[j];
      const cIn = c > a && c < b;
      const dIn = d > a && d < b;
      if (cIn !== dIn) total++;
    }
  }
  return total;
}

/* ── fitting a layout into the frame ─────────────────────────────────────────────────── */

/**
 * Scale and centre an arbitrary coordinate cloud into the drawing box, aspect preserved.
 *
 * A layout is allowed to work in whatever units suit it — the force step in pixels-ish, the
 * circle step in a unit circle — and this is the single place that turns any of them into
 * the frame. Preserving aspect matters: stretching a circle layout to fill a wide box makes
 * an ellipse, and an ellipse says the nodes at the sides are further apart than the ones at
 * the top, which is not something the layout meant.
 *
 * A cloud with no extent in one or both directions — one node, or several stacked exactly —
 * is centred rather than scaled by infinity.
 *
 * @example fit([{ x: 0, y: 0 }], { x0: 0, y0: 0, x1: 100, y1: 60 });   // [{ x: 50, y: 30 }]
 */
function fit(pos, box) {
  if (!pos.length) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pos) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const mx = (box.x0 + box.x1) / 2;
  const my = (box.y0 + box.y1) / 2;
  if (!Number.isFinite(x0)) return pos.map(() => ({ x: mx, y: my }));

  const bw = x1 - x0;
  const bh = y1 - y0;
  const sx = bw > 1e-9 ? (box.x1 - box.x0) / bw : Infinity;
  const sy = bh > 1e-9 ? (box.y1 - box.y0) / bh : Infinity;
  const s = Math.min(sx, sy);
  const k = Number.isFinite(s) ? s : 1;

  return pos.map((p) => ({ x: (p.x - (x0 + x1) / 2) * k + mx, y: (p.y - (y0 + y1) / 2) * k + my }));
}

/* ── display-list primitives ─────────────────────────────────────────────────────────── */

/* Same convention as chart.mjs: `{ t: tagName, a: real SVG attributes, s: text, ti: tooltip,
   kids: [] }`. The browser-side renderer is then ten lines that know nothing about graphs. */

const mPath = (d, attrs) => ({ t: 'path', a: Object.assign({ d }, attrs) });
const mText = (x, y, s, attrs) => ({ t: 'text', a: Object.assign({ x: n(x, 'text'), y: n(y, 'text') }, attrs), s: String(s) });

/* ── routing ─────────────────────────────────────────────────────────────────────────── */

/** Move a point `d` px from `a` toward `b`; returns `a` itself when they coincide. */
function along(a, b, d) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len < 1e-9) return { x: a.x, y: a.y };
  return { x: a.x + (vx / len) * d, y: a.y + (vy / len) * d };
}

/**
 * The path for one edge, trimmed to the node circles and bowed when it has company.
 *
 * Three shapes. A self-loop becomes a small arc riding above its node, because a straight
 * line from a point to itself has no length and draws nothing. A pair sharing two endpoints —
 * A→B and B→A, or two parallel edges — bows apart, otherwise the second is drawn exactly on
 * top of the first and the diagram claims one relationship where there are two. Everything
 * else is a straight segment, or a smoothed polyline when the layered pass gave it waypoints.
 *
 * Trimming happens at both ends so the stroke starts at the node's edge rather than under it,
 * which is what lets an arrowhead be visible at all: an arrow buried in a 9px disc is a disc.
 */
function edgePath(pts, ra, rb, bow, headroom) {
  if (pts.length === 1) {
    /* Self-loop: a lobe standing on top of the node, wide enough to read at 9px. */
    const p = pts[0];
    const r = ra;
    return 'M ' + n(p.x - r * 0.7, 'loop') + ' ' + n(p.y - r * 0.7, 'loop') +
           ' C ' + n(p.x - r * 3.4, 'loop') + ' ' + n(p.y - r * 4.2, 'loop') +
           ' ' + n(p.x + r * 3.4, 'loop') + ' ' + n(p.y - r * 4.2, 'loop') +
           ' ' + n(p.x + r * 0.7, 'loop') + ' ' + n(p.y - r * 0.9, 'loop');
  }

  if (pts.length === 2) {
    const [a, b] = pts;
    if (!bow) {
      const s = along(a, b, ra);
      const e = along(b, a, rb + headroom);
      return 'M ' + n(s.x, 'edge') + ' ' + n(s.y, 'edge') + ' L ' + n(e.x, 'edge') + ' ' + n(e.y, 'edge');
    }
    /* Quadratic through a control point pushed off the midpoint's perpendicular. Trimming is
       done toward the control point rather than toward the far node, which is what keeps the
       stroke leaving the circle along the direction it is actually about to travel. */
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len = Math.sqrt(vx * vx + vy * vy) || 1;
    const c = { x: mx - (vy / len) * bow, y: my + (vx / len) * bow };
    const s = along(a, c, ra);
    const e = along(b, c, rb + headroom);
    return 'M ' + n(s.x, 'bow') + ' ' + n(s.y, 'bow') +
           ' Q ' + n(c.x, 'bow') + ' ' + n(c.y, 'bow') + ' ' + n(e.x, 'bow') + ' ' + n(e.y, 'bow');
  }

  /* A routed polyline. Each interior waypoint becomes a quadratic's control point and the
     curve lands on the midpoint of the next span — so the corners round off. A long edge
     drawn with hard corners reads as several edges meeting, which is precisely the reading
     the dummy chain exists to avoid. The last quadratic lands on the trimmed end, so there
     is nothing left to draw after the loop. */
  const start = along(pts[0], pts[1], ra);
  const end = along(pts[pts.length - 1], pts[pts.length - 2], rb + headroom);
  let d = 'M ' + n(start.x, 'poly') + ' ' + n(start.y, 'poly');
  for (let i = 1; i < pts.length - 1; i++) {
    const to = i === pts.length - 2
      ? end
      : { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += ' Q ' + n(pts[i].x, 'poly') + ' ' + n(pts[i].y, 'poly') + ' ' + n(to.x, 'poly') + ' ' + n(to.y, 'poly');
  }
  return d;
}

/* ── labels ──────────────────────────────────────────────────────────────────────────── */

/**
 * Place a node's caption at the first offered offset that is clear.
 *
 * "Must not overlap their node" is the stated floor, and every candidate a layout offers
 * clears its own node by construction — the offsets all start outside the disc. This pass
 * then also keeps captions off each other, in node order, so a dense corner loses its later
 * labels rather than turning into an unreadable pile. A caption that fits nowhere is still
 * in the node's tooltip and in the card's alt text; it is not lost, only not shouted.
 *
 * Which offsets to try is the layout's business, not this function's: a circular layout has
 * exactly one good answer (straight out along the radius, where no chord ever goes), a
 * layered one has exactly one (below, in the gutter between ranks), and force has four and
 * no opinion about which.
 *
 * @param taken boxes already claimed by other captions; extended in place when a spot is found
 * @param discs every node's circle, so a caption never lands on somebody else's node
 * @param self  the index of the node this caption belongs to, which it is allowed to touch
 * @returns `{ x, y, anchor, box }` or null when nothing fits
 *
 * @example placeLabel('kernel', spots[3].p, cands, [], box, discs, 3);
 */
function placeLabel(text, node, cands, taken, box, discs, self) {
  const w = textW(text);
  for (const c of cands) {
    const x = node.x + c.dx;
    const y = node.y + c.dy;
    const left = c.anchor === 'middle' ? x - w / 2 : c.anchor === 'end' ? x - w : x;
    const bx = { x0: left - 2, y0: y - TXT, x1: left + w + 2, y1: y + 3 };
    if (bx.x0 < box.x0 - 2 || bx.x1 > box.x1 + 2 || bx.y0 < box.y0 - 8 || bx.y1 > box.y1 + 8) continue;

    let clash = false;
    for (const b of taken) {
      if (bx.x1 <= b.x0 || bx.x0 >= b.x1 || bx.y1 <= b.y0 || bx.y0 >= b.y1) continue;
      clash = true;
      break;
    }
    if (clash) continue;

    /* Circle against box, not box against box. A node's bounding square overhangs its disc
       by 41% at the diagonals, and a caption pushed radially outward on a circular layout
       lands exactly there — testing the square would reject captions that clear the actual
       node by several pixels, and on a layout offering one candidate that means no caption
       at all. The node's own disc is skipped: every candidate clears it by construction. */
    for (let i = 0; i < discs.length; i++) {
      if (i === self) continue;
      const d = discs[i];
      const nx = Math.max(bx.x0, Math.min(d.x, bx.x1));
      const ny = Math.max(bx.y0, Math.min(d.y, bx.y1));
      if (Math.hypot(d.x - nx, d.y - ny) >= d.r) continue;
      clash = true;
      break;
    }
    if (clash) continue;

    taken.push(bx);
    return { x, y, anchor: c.anchor, box: bx };
  }
  return null;
}

/* ── drawing ─────────────────────────────────────────────────────────────────────────── */

/**
 * Turn a finished layout into the display list the browser will render.
 *
 * Draw order is the whole readability argument: edges, then nodes, then captions. Edges
 * under nodes so a line never crosses a disc; captions over everything, on a panel of the
 * page's own ground colour, so a name is legible where it lands rather than only where the
 * background happened to be empty.
 */
function draw(G, place, geom, arrowId) {
  const { W, H, box, radius, headroom } = geom;

  const marks = [];

  if (G.directed && G.edges.length) {
    marks.push({
      t: 'defs',
      kids: [{
        t: 'marker',
        a: {
          id: arrowId, viewBox: '0 0 10 10', refX: '9.5', refY: '5',
          markerWidth: '7', markerHeight: '7',
          /* userSpaceOnUse, so a weight-3 edge does not also get a triple-sized arrowhead —
             the width already carries the weight and the arrow only carries direction. */
          markerUnits: 'userSpaceOnUse', orient: 'auto',
        },
        kids: [mPath('M 0 0 L 10 5 L 0 10 z', { class: 'ck-arw' })],
      }],
    });
  }

  /* Weight → stroke width, and degree → radius. Both through CK.scale, which parks a
     zero-width domain at the middle of its range: an unweighted graph and a one-node graph
     therefore need no special case, they just get the middle value. */
  let wlo = Infinity;
  let whi = -Infinity;
  for (const e of G.edges) { if (e.w < wlo) wlo = e.w; if (e.w > whi) whi = e.w; }
  const width = Number.isFinite(wlo) ? CK.scale([wlo, whi], [0.9, 3.4]) : () => 1.4;

  /* Which edges share a pair of endpoints, so they can bow apart instead of stacking. */
  const pairs = new Map();
  G.edges.forEach((e, i) => {
    if (e.loop) return;
    const key = e.a < e.b ? e.a + '|' + e.b : e.b + '|' + e.a;
    const list = pairs.get(key) || [];
    list.push(i);
    pairs.set(key, list);
  });
  const bowOf = new Map();
  for (const list of pairs.values()) {
    if (list.length < 2) continue;
    list.forEach((i, k) => {
      /* The offset is measured against a canonical direction — low endpoint to high — and
         flipped for an edge written the other way round. Without that flip a mutual pair
         cancels exactly: A→B bows left of its own direction and B→A bows left of *its*, which
         is the same side of the page, and the two curves land precisely on top of each other.
         Which is the bug this whole bowing step exists to prevent. */
      const spread = (k - (list.length - 1) / 2) * 16;
      bowOf.set(i, G.edges[i].a <= G.edges[i].b ? spread : -spread);
    });
  }

  const edgeMarks = [];
  /* Keyed by node *index*, not by id. An id of `__proto__` in an object literal sets the
     prototype instead of a property, and the emitted script is an object literal — so the
     one node in ten million named that would silently poison the lookup. Indices cannot. */
  const adj = G.nodes.map(() => []);

  G.edges.forEach((e, i) => {
    const pts = place.route(i);
    if (!pts || !pts.length) return;
    const ra = radius(G.nodes[e.a].deg);
    const rb = radius(G.nodes[e.b].deg);
    const d = edgePath(pts, ra, rb, bowOf.get(i) || 0, G.directed ? headroom : 0);
    const attrs = {
      d, class: 'ck-edge', 'data-e': String(i), fill: 'none',
      'stroke-width': n(width(e.w), 'weight'), 'stroke-linecap': 'round',
    };
    if (G.directed) attrs['marker-end'] = 'url(#' + arrowId + ')';
    edgeMarks.push({
      t: 'path', a: attrs,
      ti: G.nodes[e.a].label + (G.directed ? ' \u2192 ' : ' \u2014 ') + G.nodes[e.b].label +
          (whi !== wlo ? ' \u00b7 ' + CK.fmt(e.w) : ''),
    });
    adj[e.a].push(i);
    if (e.a !== e.b) adj[e.b].push(i);
  });
  marks.push({ t: 'g', a: { class: 'ck-edges' }, kids: edgeMarks });

  const nodeMarks = [];
  const labelMarks = [];

  /* Every node's disc is known before the first caption is placed, so a caption can never be
     dropped on top of somebody else's node. The stated floor is only that a label clears its
     *own* node — which every candidate offset does by construction — but a name sitting
     across a stranger's disc is worse than a name that is not drawn at all, because it reads
     as belonging to the node it is covering. */
  const spots = G.nodes.map((v, i) => ({ p: place.node(i), r: radius(v.deg) }));
  const discs = spots.map(({ p, r }) => ({ x: p.x, y: p.y, r }));
  const taken = [];

  G.nodes.forEach((v, i) => {
    const { p, r } = spots[i];
    nodeMarks.push({
      t: 'g', a: { class: 'ck-node', 'data-n': String(i) },
      kids: [{
        t: 'circle',
        a: { cx: n(p.x, 'node'), cy: n(p.y, 'node'), r: n(r, 'node'), fill: CK.hue(v.gi), class: 'ck-disc' },
      }],
      ti: v.label + (v.group ? ' \u00b7 ' + v.group : '') + ' \u00b7 ' +
          v.deg + (v.deg === 1 ? ' connection' : ' connections'),
    });

    const text = clip(v.label, LABEL_MAX);
    const spot = placeLabel(text, p, place.labelCands(i, r), taken, box, discs, i);
    if (!spot) return;
    /* A panel behind the caption, in the page's own ground. Without it a name that lands on
       an edge is read through the edge, and at 9px that is the difference between a legible
       label and a smudge. */
    labelMarks.push({
      t: 'rect',
      a: {
        x: n(spot.box.x0, 'plate'), y: n(spot.box.y0 + 1.5, 'plate'),
        width: n(spot.box.x1 - spot.box.x0, 'plate'), height: n(spot.box.y1 - spot.box.y0 - 1.5, 'plate'),
        rx: '2', class: 'ck-plate',
      },
    });
    labelMarks.push(mText(spot.x, spot.y, text, { class: 'ck-lab', 'text-anchor': spot.anchor, 'data-n': String(i) }));
  });

  marks.push({ t: 'g', a: { class: 'ck-nodes' }, kids: nodeMarks });
  marks.push({ t: 'g', a: { class: 'ck-labels' }, kids: labelMarks });

  return { marks, adj, W, H };
}

/* ── assembling one layout into a frame ──────────────────────────────────────────────── */

/**
 * Run the requested layout and produce everything drawing needs: a frame, node positions,
 * an edge router, and the facts the caption gets to state.
 *
 * The three layouts want different frames — layered's height is its depth and its width is
 * its widest rank, while force and circle take whatever box they are given — so the frame is
 * decided here rather than being a constant.
 */
function arrange(G) {
  const radius = G.nodes.length
    ? (() => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of G.nodes) { if (v.deg < lo) lo = v.deg; if (v.deg > hi) hi = v.deg; }
        const s = CK.scale([lo, hi], [5.5, 11]);
        return (deg) => s(deg);
      })()
    : () => 6;

  const labelW = G.nodes.reduce((m, v) => Math.max(m, textW(clip(v.label, LABEL_MAX))), 20);
  const headroom = 2;

  if (G.layout === 'layered') {
    const L = layeredLayout(G);

    /* Slot width is the interesting number. The floor is whatever a caption needs; beyond
       that the ranks spread to use the column, because a six-rank graph two nodes wide drawn
       on a minimum slot is a thin ribbon down the middle of an empty card. The ceiling stops
       the opposite failure: a rank of two spread to the full width turns every edge into a
       shallow diagonal reaching across the whole drawing, which reads as distance between
       things that are adjacent. */
    const floorW = Math.max(labelW + 14, 34);
    const share = (W0 - 56) / Math.max(1, L.width);
    const slot = Math.max(floorW, Math.min(Math.max(floorW * 2.6, 120), share));

    const gap = 66;
    const tall = Math.max(0, L.layers - 1) * gap;

    /* A graph two ranks wide cannot be spread to fill a 640-wide frame without turning every
       edge into a shallow diagonal, so instead the *frame* shrinks to the drawing and the
       responsive SVG scales the whole thing up to the column. The floor stops that scaling
       from getting silly: below about 480 the 9px captions start rendering large enough to
       look like a different card's typography. */
    const content = Math.round(56 + L.width * slot);
    const W = content > W0 ? content : Math.max(480, content);
    const H = Math.max(200, Math.round(tall + 108));
    const box = { x0: labelW / 2 + 10, y0: 14, x1: W - labelW / 2 - 10, y1: H - 14 };

    /* Layered coordinates arrive as (slot index, rank). Scaling x by one common slot width
       keeps the ranks aligned as columns, and y is the rank times a fixed gap — deliberately
       not run through `fit`, which would stretch a two-rank graph to fill the height and put
       its two rows a screen apart. The whole block is then centred in the frame instead. */
    const cx = (box.x0 + box.x1) / 2;
    const top = (H - tall) / 2;
    const pos = L.pos.map((p) => ({ x: cx + p.x * slot, y: top + p.y * gap }));

    return {
      geom: { W, H, box, radius, headroom },
      place: {
        node: (i) => pos[L.cellOfNode[i]],
        route: (ei) => {
          const chain = L.chains[ei];
          if (!chain) return null;
          const pts = chain.cells.map((c) => pos[c]);
          /* Two nodes in the same rank are at the same height, so a straight edge between
             them runs along the row and through whatever sits between. Bowing it out into
             the gutter is the only way it can be followed. */
          if (pts.length === 2 && Math.abs(pts[0].y - pts[1].y) < 0.5) {
            const dx = Math.abs(pts[0].x - pts[1].x);
            return [pts[0], { x: (pts[0].x + pts[1].x) / 2, y: pts[0].y - Math.min(38, 14 + dx / 5) }, pts[1]];
          }
          return pts;
        },
        /* Below the node, in the gutter between ranks, which is the one place on a layered
           drawing that is reliably empty. */
        labelCands: (i, r) => [{ dx: 0, dy: r + 11, anchor: 'middle' }],
      },
      facts: { layers: L.layers, crossings: L.crossings },
    };
  }

  if (G.layout === 'circle') {
    const C = circleLayout(G);
    const W = W0;
    const H = H0;
    /* The ring is inset by a caption's width on each side, so a label pushed straight out
       from a node at three o'clock still lands inside the frame. */
    const ring = { x0: labelW + 26, y0: 34, x1: W - labelW - 26, y1: H - 34 };
    const pos = fit(C.pos, ring);

    return {
      geom: { W, H, box: { x0: 6, y0: 12, x1: W - 6, y1: H - 12 }, radius, headroom },
      place: {
        node: (i) => pos[i],
        route: (ei) => {
          const e = G.edges[ei];
          return e.loop ? [pos[e.a]] : [pos[e.a], pos[e.b]];
        },
        /* Straight out along the radius: every chord is inside the ring, so outside it is
           the one direction where a caption can never land on an edge. One candidate, and
           it is always the right one — there is nothing for the fallback search to do. */
        labelCands: (i, r) => {
          const a = C.pos[i] && C.pos[i].angle != null ? C.pos[i].angle : -Math.PI / 2;
          const cos = Math.cos(a);
          const reach = r + 9;
          return [{
            dx: cos * reach,
            dy: Math.sin(a) * reach + 3.2,
            anchor: cos > 0.2 ? 'start' : cos < -0.2 ? 'end' : 'middle',
          }];
        },
      },
      facts: { before: C.before, after: C.after },
    };
  }

  const seed = fnv1a(seedOf(G));
  const raw = forceLayout(G, mulberry32(seed));
  const W = W0;
  const H = H0;
  const box = { x0: labelW / 2 + 16, y0: 26, x1: W - labelW / 2 - 16, y1: H - 26 };
  const pos = fit(raw, box);

  return {
    geom: { W, H, box: { x0: 6, y0: 10, x1: W - 6, y1: H - 10 }, radius, headroom },
    place: {
      node: (i) => pos[i],
      route: (ei) => {
        const e = G.edges[ei];
        return e.loop ? [pos[e.a]] : [pos[e.a], pos[e.b]];
      },
      /* Force has no preferred side, so all four are offered and the first clear one wins. */
      labelCands: (i, r) => [
        { dx: 0, dy: r + 11, anchor: 'middle' },
        { dx: 0, dy: -r - 5, anchor: 'middle' },
        { dx: r + 5, dy: 3.2, anchor: 'start' },
        { dx: -r - 5, dy: 3.2, anchor: 'end' },
      ],
    },
    facts: { seed, iters: FORCE_ITERS },
  };
}

/* ── saying what the picture shows ───────────────────────────────────────────────────── */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so this label *is* the diagram to anyone using it.
 * "Node-link diagram" would name the genre and withhold the content, which is why it also
 * says how big the graph is, how it is grouped, and which node carries the most — the three
 * things a sighted reader takes from it in the first second.
 *
 * The caption states the layout's own numbers, and they are real: the crossing counts come
 * from an exact count and the seed is the one the simulation actually ran on. A caption that
 * claims determinism without naming the seed is asking to be believed.
 */
function describe(G, facts) {
  const nn = G.nodes.length;
  const ne = G.edges.length;
  const word = G.directed ? 'Directed' : 'Undirected';

  if (!nn) {
    return {
      aria: 'An empty node-link diagram: no nodes to draw.',
      caption: 'a node-link diagram with <b>no nodes</b> &mdash; the card keeps its place, ' +
               'but there is nothing in it yet.',
    };
  }

  let busiest = G.nodes[0];
  for (const v of G.nodes) if (v.deg > busiest.deg) busiest = v;

  const groupBit = G.groups.length > 1 ? ' in ' + G.groups.length + ' groups' : '';
  const aria =
    word + ' node-link diagram, ' + G.layout + ' layout: ' +
    nn + (nn === 1 ? ' node' : ' nodes') + groupBit + ' and ' +
    ne + (ne === 1 ? ' edge' : ' edges') + '. ' +
    (ne ? 'The most connected is ' + busiest.label + ', with ' + busiest.deg +
          (busiest.deg === 1 ? ' connection.' : ' connections.')
        : 'Nothing is connected to anything.');

  let how;
  if (G.layout === 'force') {
    how = 'laid out by a seeded force simulation &mdash; <b>' + facts.iters + '</b> passes from ' +
          'seed <b>0x' + facts.seed.toString(16) + '</b>, taken from the graph itself, so this ' +
          'is the same picture on every reload and on every machine. ';
  } else if (G.layout === 'layered') {
    how = 'longest-path layering into <b>' + facts.layers + '</b> ' +
          (facts.layers === 1 ? 'rank' : 'ranks') + ', then a barycentre sweep that leaves <b>' +
          facts.crossings + '</b> ' + (facts.crossings === 1 ? 'crossing' : 'crossings') + '. ';
  } else {
    const cut = facts.before - facts.after;
    how = 'nodes evenly on a circle, ordered by adjacency and then by circular barycentre: ' +
          (cut > 0
            ? '<b>' + facts.after + '</b> chord crossings, down from ' + facts.before + '. '
            : '<b>' + facts.after + '</b> chord crossings, which is the best either ordering found. ');
  }

  const caption =
    '<b>' + nn + '</b> ' + (nn === 1 ? 'node' : 'nodes') +
    (G.groups.length > 1 ? ' across <b>' + G.groups.length + '</b> groups' : '') +
    ' and <b>' + ne + '</b> ' + (ne === 1 ? 'edge' : 'edges') + '. ' + how +
    (ne ? '<i>' + CK.esc(busiest.label) + '</i> is the most connected, at ' + busiest.deg + '. ' : '') +
    (G.dropped ? '<span class="ck-aside">' + G.dropped + ' edge' + (G.dropped === 1 ? '' : 's') +
                 ' named a node that is not here and were dropped.</span> ' : '') +
    (ne ? '<span class="ck-aside">hover a node to pick out its edges.</span>' : '');

  return { aria, caption: caption.trim() };
}

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-graph[data-card="' + id + '"]';
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
 * Nothing here names a colour: every value is a desk token, so the card is correct in a theme
 * it was never opened in and the light switch is the only thing that has to know anything.
 * `prefers-color-scheme` is deliberately absent — the desk is one document open in two
 * viewers that want different answers, and the OS gives both the same answer.
 */
function cardCss(id, wide, W, groups) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot .ck-edge', 'stroke: var(--ink-dim); opacity: .42; fill: none;'],
    ['.ck-plot .ck-arw', 'fill: var(--ink-dim); opacity: .6; stroke: none;'],
    ['.ck-plot .ck-disc', 'stroke: var(--ground); stroke-width: 1.5;'],
    ['.ck-plot .ck-lab', 'fill: var(--ink-dim);'],
    /* The caption panel is the page's own ground, at most of full strength: enough to lift a
       name off an edge, not so much that it reads as a chip the node is sitting in. */
    ['.ck-plot .ck-plate', 'fill: var(--ground); fill-opacity: .8; stroke: none;'],

    /* Hovering a node pulls its edges out of the mesh. Done by class rather than by filter so
       it costs nothing to paint, and gated on `.hi` so an untouched diagram is undimmed. */
    ['.ck-plot .ck-node', 'cursor: default;'],
    ['.ck-plot.hi .ck-edge', 'opacity: .1;'],
    ['.ck-plot.hi .ck-edge.on', 'opacity: .95; stroke: var(--accent);'],
    ['.ck-plot.hi .ck-node', 'opacity: .45;'],
    ['.ck-plot.hi .ck-node.on', 'opacity: 1;'],
    ['.ck-plot .ck-edge, .ck-plot .ck-node', 'transition: opacity .12s linear;'],
  ];

  if (groups) {
    /* Round keys, where the chart card's are square: the legend swatch should look like the
       mark it stands for, and on this card the mark is a disc. */
    rules.push(['.ck-legend i', 'border-radius: 50%;']);
    for (let i = 1; i <= 8; i++) {
      rules.push(['.ck-legend i[data-s="' + i + '"]', 'background: var(--ck-s' + i + ');']);
    }
  }

  /* A diagram wider than the column keeps its width and scrolls inside `.ck-scroll`, so the
     desk column never widens and the page never grows a scrollbar of its own. */
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-edge, .ck-plot .ck-node', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, one diagram, an optional group legend, and the caption. */
function cardHtml(id, title, G, geom, note, wide) {
  const svg =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + n(geom.W, 'view') + ' ' + n(geom.H, 'view') + '"' +
    ' aria-label="' + CK.esc(note.aria) + '"></svg>';

  const legend = G.groups.length > 1
    ? '\n  <div class="ck-legend">' +
      G.groups.map((g, i) =>
        '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g) + '</span>').join('') +
      '</div>'
    : '';

  return '<section data-card="' + CK.esc(id) + '" class="ck-graph">\n' +
         '  <h2>' + CK.esc(title) + '</h2>\n' +
         '  ' + (wide ? '<div class="ck-scroll">' + svg + '</div>' : svg) + legend + '\n' +
         '  <div class="ck-cap">' + note.caption + '</div>\n' +
         '</section>\n';
}

/**
 * The browser half: a generic display-list renderer and the hover highlight.
 *
 * Classic script, ES5 vocabulary, no template literals and no arrow functions — this is
 * concatenated into a page that ships no transpiler, and one card must not be the reason a
 * whole desk fails to parse. No layout runs here; the coordinates are already coordinates.
 */
function cardJs(id, marks, adj) {
  return `/* graph card: draws coordinates that were computed when the card was built.
   Nothing is simulated here. That is the point — a force layout that ran on load would
   settle somewhere slightly different every time, and a diagram that is not the same
   diagram twice is not a picture anyone can point at. */
CK.build(${jsonLit(id)}, function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var MARKS = ${jsonLit(marks)};
  var ADJ = ${jsonLit(adj)};

  var plot = sec.querySelector("svg.ck-plot");
  if (!plot) { return; }

  /* One display-list entry as a real element. Attribute names are the SVG ones, so this
     stays a translator rather than a second place where layout decisions live. */
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

  function render() {
    var i;
    while (plot.firstChild) { plot.removeChild(plot.firstChild); }
    for (i = 0; i < MARKS.length; i++) { plot.appendChild(node(MARKS[i])); }
    lit = -1;                      // the elements the last highlight referred to are gone
  }

  /* Pull one node's edges out of the mesh. A node in a dense diagram is a dot among dots;
     the question a reader actually has is what it touches, and dimming everything else is
     the cheapest honest answer to it. Nodes are addressed by index rather than by id, so no
     label text can end up inside a selector. */
  var lit = -1;

  function light(k) {
    var was, i, list, el;
    if (k === lit) { return; }
    lit = k;

    was = plot.querySelectorAll(".on");
    for (i = 0; i < was.length; i++) { was[i].classList.remove("on"); }
    if (k < 0 || !ADJ[k]) { plot.classList.remove("hi"); return; }

    plot.classList.add("hi");
    el = plot.querySelector('.ck-node[data-n="' + k + '"]');
    if (el) { el.classList.add("on"); }
    list = ADJ[k];
    for (i = 0; i < list.length; i++) {
      el = plot.querySelector('.ck-edge[data-e="' + list[i] + '"]');
      if (el) { el.classList.add("on"); }
    }
  }

  render();

  /* Two delegated listeners, guarded by CK.once: a <main> swap gives us a fresh section and
     wires it once; a replay on the same section wires nothing twice. */
  CK.once(sec, "graphhover", function () {
    plot.addEventListener("mousemove", function (ev) {
      var g = ev.target && ev.target.closest ? ev.target.closest("[data-n]") : null;
      light(g ? Number(g.getAttribute("data-n")) : -1);
    });
    plot.addEventListener("mouseleave", function () { light(-1); });
  });
});
`;
}

/**
 * Build one graph card from one node-link description.
 *
 * @param id    the card's identity; becomes its directory name, its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  `{ nodes, edges, directed, layout }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the
 *          other three are file bodies ready to write beside it
 *
 * @throws {Error} when a layout produces a non-finite coordinate, which means a bug here
 *                 rather than bad input: unusable nodes and edges are dropped while reading
 *
 * @example
 * build({
 *   id: 'deps',
 *   title: 'what imports what',
 *   data: {
 *     layout: 'layered', directed: true,
 *     nodes: [{ id: 'kit', group: 'core' }, { id: 'chart' }, { id: 'graph' }],
 *     edges: [['kit', 'chart', 2], ['kit', 'graph', 2]],
 *   },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'graph' : id);
  const G = readGraph(data);
  const { geom, place, facts } = arrange(G);
  const note = describe(G, facts);

  const drawn = draw(G, place, geom, slug(cardId) + '-arrow');
  const wide = geom.W > W0;

  return {
    json: { ord: Number.isFinite(Number(ord)) ? Number(ord) : 50, type: 'graph', layout: G.layout },
    html: cardHtml(cardId, title == null ? cardId : String(title), G, geom, note, wide),
    css: cardCss(cardId, wide, geom.W, G.groups.length > 1),
    js: cardJs(cardId, drawn.marks, drawn.adj),
  };
}
