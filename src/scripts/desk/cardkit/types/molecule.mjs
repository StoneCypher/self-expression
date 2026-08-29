/**
 * The `molecule` card type: a ball-and-stick model that turns on its own.
 *
 * The desk's page is served under `script-src 'self'`, so there is no three.js and no CDN.
 * That sounds like a reason not to have a 3D card, and it is not: a molecule is a few dozen
 * points, and rotate → project → sort is about eighty lines of arithmetic. Everything here
 * is hand-rolled for that reason, and the whole of the 3D is documented below at
 * {@link projectionNotes} so the next person does not have to re-derive it.
 *
 * A card type is a function from data to four file bodies, one per asset the desk knows
 * how to concatenate — `card.json`, `card.html`, `card.css`, `card.js`. It writes nothing
 * and reads nothing; the caller decides where the four strings land.
 */

/** Display radii in Ångströms, keyed by lowercased element symbol. */
const RADII = { h: 0.24, c: 0.36, n: 0.35, o: 0.34, s: 0.42, p: 0.42 };

/** Element names, for the legend and the aria-label. Anything absent is named by symbol. */
const NAMES = { h: 'hydrogen', c: 'carbon', n: 'nitrogen', o: 'oxygen', s: 'sulfur', p: 'phosphorus' };

/** Seconds per revolution. Slow enough to read the structure, fast enough to read as motion. */
const PERIOD = 21;

/** Camera pitch in radians. Applied after the spin, so the model turns like a turntable. */
const TILT = -0.30;

/**
 * Built-in molecules, so a card can be asked for by name instead of by coordinate table.
 *
 * Coordinates are Ångströms and are real geometry, not schematic: water is the experimental
 * 0.9584 Å / 104.45° structure, ethanol is an optimised anti conformer, benzene is the
 * regular 1.39 Å ring with 1.09 Å C–H, and caffeine is laid out from purine ring geometry
 * (fused hexagon and pentagon on a shared 1.39 Å bond, 1.22 Å C=O, 1.47 Å N–CH3) with the
 * methyl hydrogens placed at the tetrahedral angle and staggered — which is the only thing
 * in caffeine that leaves the plane, and the thing that keeps it from collapsing to a line
 * when the spin brings it edge-on.
 *
 * `bonds` are `[atomIndex, atomIndex, order]`; order 2 and 3 draw as parallel lines. The
 * Kekulé structures are the conventional ones, and every atom's valence is satisfied.
 */
export const PRESETS = {

  water: {
    name: 'water', formula: 'H2O',
    atoms: [
      { el: 'O', x: 0.0000, y: 0.0000, z: 0.0000 },
      { el: 'H', x: 0.7575, y: 0.5871, z: 0.0000 },
      { el: 'H', x:-0.7575, y: 0.5871, z: 0.0000 }
    ],
    bonds: [[0, 1, 1], [0, 2, 1]]
  },

  benzene: {
    name: 'benzene', formula: 'C6H6',
    atoms: [
      { el: 'C', x: 1.3900, y: 0.0000, z: 0.0000 },
      { el: 'C', x: 0.6950, y: 1.2038, z: 0.0000 },
      { el: 'C', x:-0.6950, y: 1.2038, z: 0.0000 },
      { el: 'C', x:-1.3900, y: 0.0000, z: 0.0000 },
      { el: 'C', x:-0.6950, y:-1.2038, z: 0.0000 },
      { el: 'C', x: 0.6950, y:-1.2038, z: 0.0000 },
      { el: 'H', x: 2.4800, y: 0.0000, z: 0.0000 },
      { el: 'H', x: 1.2400, y: 2.1478, z: 0.0000 },
      { el: 'H', x:-1.2400, y: 2.1478, z: 0.0000 },
      { el: 'H', x:-2.4800, y: 0.0000, z: 0.0000 },
      { el: 'H', x:-1.2400, y:-2.1478, z: 0.0000 },
      { el: 'H', x: 1.2400, y:-2.1478, z: 0.0000 }
    ],
    bonds: [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1],
            [0, 6, 1], [1, 7, 1], [2, 8, 1], [3, 9, 1], [4, 10, 1], [5, 11, 1]]
  },

  ethanol: {
    name: 'ethanol', formula: 'C2H6O',
    atoms: [
      { el: 'C', x: 1.1879, y:-0.3829, z: 0.0000 },
      { el: 'C', x: 0.0000, y: 0.5526, z: 0.0000 },
      { el: 'O', x:-1.1867, y:-0.2472, z: 0.0000 },
      { el: 'H', x:-1.9237, y: 0.3850, z: 0.0000 },
      { el: 'H', x: 2.0985, y: 0.2306, z: 0.0000 },
      { el: 'H', x: 1.1184, y:-1.0093, z: 0.8869 },
      { el: 'H', x: 1.1184, y:-1.0093, z:-0.8869 },
      { el: 'H', x:-0.0227, y: 1.1812, z: 0.8852 },
      { el: 'H', x:-0.0227, y: 1.1812, z:-0.8852 }
    ],
    bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1],
            [0, 4, 1], [0, 5, 1], [0, 6, 1], [1, 7, 1], [1, 8, 1]]
  },

  caffeine: {
    name: 'caffeine', formula: 'C8H10N4O2',
    atoms: [
      { el: 'N', x:-2.4076, y: 0.6950, z: 0.0000 },   /*  0  N1              */
      { el: 'C', x:-2.4076, y:-0.6950, z: 0.0000 },   /*  1  C2             */
      { el: 'N', x:-1.2038, y:-1.3900, z: 0.0000 },   /*  2  N3             */
      { el: 'C', x: 0.0000, y:-0.6950, z: 0.0000 },   /*  3  C4  fusion     */
      { el: 'C', x: 0.0000, y: 0.6950, z: 0.0000 },   /*  4  C5  fusion     */
      { el: 'C', x:-1.2038, y: 1.3900, z: 0.0000 },   /*  5  C6             */
      { el: 'N', x: 1.3220, y: 1.1245, z: 0.0000 },   /*  6  N7             */
      { el: 'C', x: 2.1390, y: 0.0000, z: 0.0000 },   /*  7  C8             */
      { el: 'N', x: 1.3220, y:-1.1245, z: 0.0000 },   /*  8  N9             */
      { el: 'O', x:-3.4641, y:-1.3050, z: 0.0000 },   /*  9  O on C2        */
      { el: 'O', x:-1.2038, y: 2.6100, z: 0.0000 },   /* 10  O on C6        */
      { el: 'C', x:-3.6806, y: 1.4300, z: 0.0000 },   /* 11  N1 methyl      */
      { el: 'C', x:-1.2038, y:-2.8600, z: 0.0000 },   /* 12  N3 methyl      */
      { el: 'C', x: 1.7762, y: 2.5226, z: 0.0000 },   /* 13  N7 methyl      */
      { el: 'H', x: 3.2190, y: 0.0000, z: 0.0000 },   /* 14  H on C8        */
      { el: 'H', x:-3.9957, y: 1.6119, z: 1.0275 },
      { el: 'H', x:-3.5508, y: 2.3825, z:-0.5137 },
      { el: 'H', x:-4.4406, y: 0.8413, z:-0.5137 },
      { el: 'H', x:-1.2038, y:-3.2238, z: 1.0275 },
      { el: 'H', x:-2.0936, y:-3.2238, z:-0.5137 },
      { el: 'H', x:-0.3140, y:-3.2238, z:-0.5137 },
      { el: 'H', x: 1.8886, y: 2.8686, z: 1.0275 },
      { el: 'H', x: 2.7349, y: 2.5937, z:-0.5137 },
      { el: 'H', x: 1.0424, y: 3.1436, z:-0.5137 }
    ],
    bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 2], [4, 5, 1], [5, 0, 1],
            [4, 6, 1], [6, 7, 1], [7, 8, 2], [8, 3, 1],
            [1, 9, 2], [5, 10, 2],
            [0, 11, 1], [2, 12, 1], [6, 13, 1], [7, 14, 1],
            [11, 15, 1], [11, 16, 1], [11, 17, 1],
            [12, 18, 1], [12, 19, 1], [12, 20, 1],
            [13, 21, 1], [13, 22, 1], [13, 23, 1]]
  }
};

/**
 * What the card is and what it wants, for a type registry that lists the choices.
 *
 * @example meta.name;   // 'molecule'
 */
export const meta = {
  name: 'molecule',
  summary: 'A ball-and-stick molecule that turns slowly on its axis, drawn without a 3D library.',
  shape: '{ preset } naming a built-in, or { atoms: [{el,x,y,z}], bonds: [[i,j,order]], formula, name } in Ångströms.'
};

/**
 * The projection, written down once so the emitted script can stay terse.
 *
 * Four steps, in this order, per atom per frame:
 *
 * 1. **Spin about Y.** `x' = x·cos θ + z·sin θ`, `z' = −x·sin θ + z·cos θ`. θ advances at
 *    2π/PERIOD radians a second. Nothing else changes with time, which is why the fit and
 *    the colours can all be decided once at setup.
 *
 * 2. **Pitch about X, fixed.** `y″ = y·cos T − z'·sin T`, `z″ = y·sin T + z'·cos T`. This is
 *    a camera pitch rather than a model tilt — it is applied *after* the spin, so the axis
 *    the molecule turns on is itself tipped and a ring sweeps an ellipse instead of a line.
 *    Applied before the spin it would merely tip a still-vertical turntable, which reads as
 *    a wobble rather than as depth.
 *
 * 3. **Pinhole projection.** The eye sits at `z = D` looking down −z, so an atom's on-screen
 *    scale is `s = k·D/(D − z″)`, for a fit constant `k` in pixels per Ångström: nearer
 *    means larger, and every length that atom owns — its radius, its share of a bond's
 *    width, the offset of a double bond's second line — is that same `s` times a constant in
 *    Ångströms. Nothing is scaled twice and nothing has a separate "depth factor" to keep in
 *    sync. `D = 5.5·R` where R is the model's radius, which puts the near/far scale ratio at
 *    (D+R)/(D−R) ≈ 1.44 — enough to see, not enough to bulge. `k` comes from walking the
 *    turn once at setup and measuring the envelope the model actually sweeps, so the fit is
 *    exact and, being fixed, never makes the model breathe.
 *
 * 4. **Painter's algorithm.** Every drawable — each atom, and each half of each bond — is
 *    tagged with its z″ and the list is sorted ascending, so the farthest is emitted first
 *    and the nearest last. SVG has no z-index, so document order *is* the depth order, and
 *    that is the whole of the occlusion: a nearer atom covers a farther one because it was
 *    written later. Bonds are split at their midpoint both to take each end's element
 *    colour and so that a stick can pass correctly behind one atom and in front of another.
 *
 * The remaining depth cue is opacity, faded toward the ground between the back and front of
 * the model. It is opacity and not a colour mix on purpose: the colours are the elements,
 * and a carbon that has been blended halfway to the background is no longer telling you it
 * is a carbon. Fading leaves the hue alone and lets the page's own ground do the work in
 * whichever theme is on.
 *
 * @example projectionNotes;   // the string 'rotate → pitch → pinhole → depth sort'
 */
export const projectionNotes = 'rotate → pitch → pinhole → depth sort';

/** HTML-escape a value for interpolation into markup. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Element counts in Hill order — carbon, then hydrogen, then the rest alphabetically.
 *
 * Hill order is what a chemist expects to read, and it is also a stable order, which
 * matters because this drives both the legend and the aria-label and the two must agree.
 *
 * @param atoms the atom list
 * @returns rows of `[symbol, count]`
 *
 * @example census([{ el: 'O' }, { el: 'H' }, { el: 'H' }]);   // [['H', 2], ['O', 1]]
 */
function census(atoms) {
  const n = new Map();
  for (const a of atoms) n.set(a.el, (n.get(a.el) || 0) + 1);
  const rest = [...n.keys()].filter(e => e !== 'C' && e !== 'H').sort();
  const order = [...(n.has('C') ? ['C'] : []), ...(n.has('H') ? ['H'] : []), ...rest];
  return order.map(e => [e, n.get(e)]);
}

/**
 * A molecular formula from an element census, e.g. `C8H10N4O2`.
 *
 * Used only when the caller supplied no `formula`; a hand-written one is kept as given
 * because a formula sometimes carries information the atom list does not.
 *
 * @example formulaOf([['C', 6], ['H', 6]]);   // 'C6H6'
 */
function formulaOf(rows) {
  return rows.map(([e, k]) => e + (k > 1 ? k : '')).join('');
}

/**
 * A formula with its digits as subscripts, for the caption.
 *
 * @example subscripted('H2O');   // 'H<sub>2</sub>O'
 */
function subscripted(f) {
  return esc(f).replace(/\d+/g, d => '<sub>' + d + '</sub>');
}

/**
 * Resolve `data` to a molecule, validate it, and centre it on its bounding box.
 *
 * Centring happens here rather than in the browser so the emitted script has one less job
 * and so a hand-supplied coordinate table gets the same treatment as a preset — a molecule
 * drawn from a file rarely arrives centred, and an off-centre model rotating about the
 * frame's middle swings instead of turning.
 *
 * The bounding-box centre is used rather than the centroid: the centroid follows atom
 * density and drifts toward whichever end has more hydrogens, which frames badly.
 *
 * @param data `{ preset }` naming a built-in, or a full `{ atoms, bonds, formula, name }`
 * @returns `{ name, formula, atoms, bonds }` with coordinates centred, in Ångströms
 * @throws TypeError for an unknown preset, an empty atom list, a non-finite coordinate, or
 *         a bond referring to an atom that is not there — all of which draw as something
 *         plausible and wrong if they are allowed through
 *
 * @example resolve({ preset: 'water' }).formula;                    // 'H2O'
 * @example resolve({ atoms: [{ el: 'C', x: 0, y: 0, z: 0 }] });     // a lone carbon
 */
function resolve(data) {
  const d = data == null ? { preset: 'caffeine' } : data;

  let src;
  if (d.preset != null) {
    src = PRESETS[d.preset];
    if (!src) {
      throw new TypeError('molecule: unknown preset ' + JSON.stringify(d.preset) +
                          ' — have ' + Object.keys(PRESETS).join(', '));
    }
  } else {
    src = d;
  }

  if (!Array.isArray(src.atoms) || src.atoms.length === 0) {
    throw new TypeError('molecule: data needs a non-empty `atoms` array or a `preset`');
  }

  const atoms = src.atoms.map((a, i) => {
    const el = String(a.el || '').trim();
    if (!el) throw new TypeError('molecule: atom ' + i + ' has no element symbol');
    for (const ax of ['x', 'y', 'z']) {
      if (!Number.isFinite(Number(a[ax]))) {
        throw new TypeError('molecule: atom ' + i + ' has a non-finite ' + ax);
      }
    }
    return { el, x: Number(a.x), y: Number(a.y), z: Number(a.z) };
  });

  const raw = Array.isArray(src.bonds) ? src.bonds : [];
  const bonds = raw.map((b, k) => {
    const i = Number(b[0]), j = Number(b[1]), order = b[2] == null ? 1 : Number(b[2]);
    if (!(i >= 0 && i < atoms.length) || !(j >= 0 && j < atoms.length) || i === j) {
      throw new TypeError('molecule: bond ' + k + ' does not join two distinct atoms');
    }
    if (!(order >= 1 && order <= 3)) {
      throw new TypeError('molecule: bond ' + k + ' has order ' + b[2] + ', expected 1, 2 or 3');
    }
    return [i, j, Math.round(order)];
  });

  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const a of atoms) {
    for (const ax of ['x', 'y', 'z']) {
      if (a[ax] < lo[ax]) lo[ax] = a[ax];
      if (a[ax] > hi[ax]) hi[ax] = a[ax];
    }
  }
  const mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  const r4 = v => Math.round(v * 1e4) / 1e4;

  return {
    name: String(src.name || d.preset || 'molecule'),
    formula: src.formula ? String(src.formula) : formulaOf(census(atoms)),
    atoms: atoms.map(a => ({ el: a.el, x: r4(a.x - mid.x), y: r4(a.y - mid.y), z: r4(a.z - mid.z) })),
    bonds
  };
}

/**
 * The colour tokens, and every rule that uses them.
 *
 * The tokens live on bare `:root` and are overridden under `:root[data-theme="light"]`,
 * which is the only place in this file a colour is written down. Not on
 * `prefers-color-scheme`: the desk is one document open in two viewers that want different
 * answers, and the OS gives both the same one.
 *
 * The two palettes are reflections rather than different schemes. Carbon is a light grey on
 * the dark ground and a dark grey on the light one; hydrogen is the extreme in both
 * directions — near-white against near-black, near-black against near-white — so the
 * carbon/hydrogen relationship survives the flip even though both absolute values move.
 * Oxygen stays red and nitrogen stays blue, deepened and given more chroma in light mode
 * because the same hue carries less apparent saturation against white than against black.
 *
 * Element colour is carried by one custom property per class rather than by a fill rule per
 * class, so a circle and a line can both say `el-o` and get the same colour applied to
 * different properties. Circles take the ground colour as a rim: without one, two carbons
 * overlapping in projection merge into a single blob and the model loses its count.
 */
function styles() {
  return `
  /* molecule — element colours. The only literal colours in this file; everything below is
     scoped under .ck-molecule and names these. */
  :root {
    --ck-mol-c:    oklch(0.80 0.010 250);   /* light grey on the dark ground   */
    --ck-mol-n:    oklch(0.66 0.150 255);
    --ck-mol-o:    oklch(0.63 0.185 27);
    --ck-mol-h:    oklch(0.96 0.004 250);   /* near-white                      */
    --ck-mol-s:    oklch(0.84 0.150 95);
    --ck-mol-p:    oklch(0.72 0.160 55);
    --ck-mol-x:    oklch(0.62 0.060 320);   /* anything with no colour of its own */
    --ck-mol-edge: oklch(0.155 0.008 90);   /* the ground: atom rims cut against it */
    --ck-mol-spec: oklch(0.99 0.002 250);   /* the gloss, white in both themes  */
  }
  :root[data-theme="light"] {
    --ck-mol-c:    oklch(0.42 0.010 250);   /* dark grey on the light ground   */
    --ck-mol-n:    oklch(0.45 0.170 255);
    --ck-mol-o:    oklch(0.50 0.200 27);
    --ck-mol-h:    oklch(0.22 0.006 250);   /* near-black                      */
    --ck-mol-s:    oklch(0.58 0.150 95);
    --ck-mol-p:    oklch(0.55 0.170 50);
    --ck-mol-x:    oklch(0.46 0.070 320);
    --ck-mol-edge: oklch(0.985 0.003 90);
    --ck-mol-spec: oklch(1 0 0);
  }

  /* Width from the pane, height from the viewBox. A model has one honest aspect ratio and
     the pane sets the scale, never the shape. */
  .ck-molecule .ck-mol-stage {
    display: block; width: 100%; height: auto; cursor: pointer; touch-action: manipulation;
  }

  /* One property per element, then two shape rules that spend it. A bond half and the atom
     it grows out of carry the same class and come out the same colour. */
  .ck-molecule .el-h { --ck-mol-e: var(--ck-mol-h); }
  .ck-molecule .el-c { --ck-mol-e: var(--ck-mol-c); }
  .ck-molecule .el-n { --ck-mol-e: var(--ck-mol-n); }
  .ck-molecule .el-o { --ck-mol-e: var(--ck-mol-o); }
  .ck-molecule .el-s { --ck-mol-e: var(--ck-mol-s); }
  .ck-molecule .el-p { --ck-mol-e: var(--ck-mol-p); }
  .ck-molecule .el-x { --ck-mol-e: var(--ck-mol-x); }

  /* The fallback is not decoration: an unresolved var() computes to the property's initial
     value, which for fill is black — so an element with no class of ours would come out as
     a black disc on a black ground rather than as an obvious mistake. */
  .ck-molecule circle { fill: var(--ck-mol-e, var(--ck-mol-x)); stroke: var(--ck-mol-edge); }
  .ck-molecule line   { stroke: var(--ck-mol-e, var(--ck-mol-x)); fill: none; stroke-linecap: round; }

  /* The gloss sits inside its atom and is drawn with it, so it never separates from the
     ball it belongs to when the depth sort reorders everything. */
  .ck-molecule .ck-mol-gloss { fill: var(--ck-mol-spec); stroke: none; }

  .ck-molecule .ck-legend i { border-radius: 50%; background: var(--ck-mol-e, var(--ck-mol-x)); }
  .ck-molecule .ck-mol-state { font-family: var(--mono); font-size: 10px; }
`;
}

/**
 * The browser script: a classic script in ES5, because the desk concatenates card scripts
 * into one `<script>` and a module there would not run.
 *
 * `CK.build` is used rather than a bare call so the card is a no-op once it has been
 * dismissed, `CK.spin` rather than a private rAF loop so it stops off-screen and never
 * starts under reduced motion, and `CK.once` for the click listener so a `<main>` swap
 * replaces the handler instead of stacking a second one on the same element.
 *
 * @param id  the card's `data-card` id
 * @param mol a resolved, centred molecule
 * @returns the script body, ready to concatenate
 */
function script(id, mol) {
  const payload = JSON.stringify(mol).replace(/</g, '\\u003c');

  return `
/* ${mol.name} as ball-and-stick, hand-rolled: the desk is served under script-src 'self',
   so there is no three.js to reach for. Rotate about Y, pitch a fixed 17 degrees, project
   through a pinhole, then sort every atom and every bond half by depth and emit far to
   near — SVG has no z-index, so document order is the occlusion. */
CK.build(${JSON.stringify(id)}, function (sec) {
  var svg = sec.querySelector('.ck-mol-stage');
  if (!svg) return;

  var MOL   = ${payload},
      A     = MOL.atoms,
      B     = MOL.bonds,
      N     = A.length,
      state = sec.querySelector('.ck-mol-state');

  var W = 540, H = 360, CX = W / 2, CY = H / 2, PAD = 10,
      TAU    = Math.PI * 2,
      PERIOD = ${PERIOD},          /* seconds per revolution */
      TILT   = ${TILT},         /* camera pitch, radians; applied after the spin */
      RDEF   = 0.36,          /* display radius for an element we have no colour for */
      STICK  = 0.28,          /* single-bond stick width, Angstroms */
      THIN   = 0.155,         /* each line of a double or triple bond */
      GAP    = 0.30,          /* centre-to-centre spacing of those lines */
      FLOOR  = 0.34,          /* opacity at the back of the model */
      GLOSS  = 0.40;          /* strength of the specular dot */

  /* Hoisted: these are read once per bond per frame and allocating them there would put a
     few thousand throwaway arrays a second in front of the collector. */
  var OFF1 = [0], OFF2 = [-0.5, 0.5], OFF3 = [-1, 0, 1];

  var RADII = ${JSON.stringify(RADII)};

  /* Per atom, decided once: its class and its radius in Angstroms. */
  var cls = [], rad = [], i, e;
  for (i = 0; i < N; i++) {
    e = String(A[i].el).toLowerCase();
    cls[i] = RADII[e] ? 'el-' + e : 'el-x';
    rad[i] = RADII[e] || RDEF;
  }

  /* Fit, decided once. Recomputing it per frame would make the model breathe as it turned,
     which reads as a zoom rather than as a rotation.

     R is the model's radius and D = 5.5R fixes the perspective strength: the near/far scale
     ratio is (D+R)/(D-R), about 1.44 — enough to see, not enough to bulge.

     The frame is then found by walking the turn rather than by bounding it. A closed form
     exists — the width can never exceed max sqrt(x^2+z^2), since that is what a spin about
     Y preserves, and the height is bounded per atom by |y|cos T + sqrt(x^2+z^2)|sin T| — but
     it is loose, because those two worst cases happen at different angles and the biggest
     atom is rarely the one at the extreme. It leaves about a fifth of the frame empty.
     Sampling SAMPLES angles costs a few thousand multiplications once and gives the exact
     swept envelope, which is the thing that actually has to fit. The envelope's own centre
     is taken too, so the model is centred on what it sweeps rather than on its origin.

     EDGE is the allowance for what an atom draws beyond its radius — half its rim, and the
     outer line of a double bond, which is offset by less than the smallest radius. It is a
     multiplier and not a number of Angstroms on purpose: three atoms get an enormous
     pixels-per-Angstrom, and a fixed allowance there would eat a fifth of the frame. */
  var SAMPLES = 96,
      EDGE    = 1.12,
      ct = Math.cos(TILT), st = Math.sin(TILT), R = 0, q;

  for (i = 0; i < N; i++) {
    q = A[i];
    R = Math.max(R, Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z));
  }
  if (R < 1e-6) R = 1;                                   /* a single atom still needs a scale */
  var D = 5.5 * R;

  var xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity,
      si, ang, sca, ssa, sx, sz, sy, u, edge;
  for (si = 0; si < SAMPLES; si++) {
    ang = si * TAU / SAMPLES;
    sca = Math.cos(ang);
    ssa = Math.sin(ang);
    for (i = 0; i < N; i++) {
      q    = A[i];
      sx   =  q.x * sca + q.z * ssa;
      sz   = -q.x * ssa + q.z * sca;
      sy   =  q.y * ct - sz * st;
      u    = D / (D - (q.y * st + sz * ct));              /* on-screen scale at unit k */
      edge = rad[i] * EDGE * u;
      if (sx * u - edge < xlo) xlo = sx * u - edge;
      if (sx * u + edge > xhi) xhi = sx * u + edge;
      if (sy * u - edge < ylo) ylo = sy * u - edge;
      if (sy * u + edge > yhi) yhi = sy * u + edge;
    }
  }

  var midX = (xlo + xhi) / 2,
      midY = (ylo + yhi) / 2,
      k = Math.min((CX - PAD) / ((xhi - xlo) / 2), (CY - PAD) / ((yhi - ylo) / 2));

  function n1(v) { return Math.round(v * 10) / 10; }
  function n2(v) { return Math.round(v * 100) / 100; }

  function seg(c, x1, y1, x2, y2, w, o) {
    return '<line class="' + c + '" x1="' + n1(x1) + '" y1="' + n1(y1) +
           '" x2="' + n1(x2) + '" y2="' + n1(y2) +
           '" stroke-width="' + n1(w) + '" opacity="' + n2(o) + '"/>';
  }

  function byDepth(a, b) { return a.z - b.z; }

  var px = [], py = [], pz = [], ps = [], op = [];

  /**
   * One frame, at spin angle "a" in radians. Everything it needs about the model was worked
   * out above; this only turns, projects, sorts and prints.
   */
  function draw(a) {
    var ca = Math.cos(a), sa = Math.sin(a), g, x1, z1, y2, z2, s, j;

    for (j = 0; j < N; j++) {
      g  = A[j];
      x1 =  g.x * ca + g.z * sa;                         /* spin about Y */
      z1 = -g.x * sa + g.z * ca;
      y2 = g.y * ct - z1 * st;                           /* fixed camera pitch about X */
      z2 = g.y * st + z1 * ct;
      s  = D / (D - z2);                                 /* pinhole: nearer is larger */
      px[j] = CX + (x1 * s - midX) * k;
      py[j] = CY - (y2 * s - midY) * k;                  /* screen y grows downward */
      pz[j] = z2;
      ps[j] = s * k;
      op[j] = FLOOR + (1 - FLOOR) * (z2 + R) / (2 * R);  /* fade toward the ground, not toward a colour */
    }

    var it = [], r, gx, gy;

    for (j = 0; j < N; j++) {
      r  = rad[j] * ps[j];
      gx = px[j] - r * 0.33;
      gy = py[j] - r * 0.33;
      it.push({ z: pz[j], s:
        '<circle class="' + cls[j] + '" cx="' + n1(px[j]) + '" cy="' + n1(py[j]) +
        '" r="' + n1(r) + '" stroke-width="' + n1(r * 0.15) +
        '" opacity="' + n2(op[j]) + '"/>' +
        '<circle class="ck-mol-gloss" cx="' + n1(gx) + '" cy="' + n1(gy) +
        '" r="' + n1(r * 0.28) + '" opacity="' + n2(op[j] * GLOSS) + '"/>' });
    }

    var b, ia, ib, ord, mx, my, mz, ms, dx, dy, len, nx, ny, wid, offs, o, ox, oy;
    for (b = 0; b < B.length; b++) {
      ia  = B[b][0]; ib = B[b][1]; ord = B[b][2];
      mx  = (px[ia] + px[ib]) / 2;
      my  = (py[ia] + py[ib]) / 2;
      mz  = (pz[ia] + pz[ib]) / 2;
      ms  = (ps[ia] + ps[ib]) / 2;
      dx  = px[ib] - px[ia];
      dy  = py[ib] - py[ia];
      len = Math.sqrt(dx * dx + dy * dy) || 1;
      nx  = -dy / len;                                   /* screen-space perpendicular, so a */
      ny  =  dx / len;                                   /* double bond never turns edge-on   */
      wid = (ord === 1 ? STICK : THIN) * ms;
      offs = ord === 1 ? OFF1 : ord === 2 ? OFF2 : OFF3;

      /* Split at the midpoint: each half takes its own atom's colour and its own depth, so
         one stick can pass behind one atom and in front of another. */
      for (o = 0; o < offs.length; o++) {
        ox = nx * offs[o] * GAP * ms;
        oy = ny * offs[o] * GAP * ms;
        it.push({ z: (pz[ia] + mz) / 2,
                  s: seg(cls[ia], px[ia] + ox, py[ia] + oy, mx + ox, my + oy, wid, op[ia]) });
        it.push({ z: (pz[ib] + mz) / 2,
                  s: seg(cls[ib], px[ib] + ox, py[ib] + oy, mx + ox, my + oy, wid, op[ib]) });
      }
    }

    it.sort(byDepth);                                    /* far first: later markup covers earlier */
    var out = [];
    for (j = 0; j < it.length; j++) out.push(it[j].s);
    svg.innerHTML = out.join('');
  }

  /* Pause is a click, and resuming has to pick up the angle it stopped at rather than
     snapping back to zero — so the elapsed time is banked and CK.spin's clock restarts. */
  var bank = 0, live = 0, halt = null, held = false;

  function begin() {
    halt = CK.spin(svg, function (t) { live = t; draw((bank + t) * TAU / PERIOD); });
  }

  CK.once(svg, 'molpause', function () {
    svg.addEventListener('click', function () {
      held = !held;
      if (held) { bank += live; if (halt) halt(); } else { begin(); }
      svg.setAttribute('data-paused', held ? '1' : '0');
      if (state) state.textContent = held ? 'paused \\u2014 click to resume' : 'click to pause';
    });
  });

  begin();
});
`;
}

/**
 * Build one molecule card: a rotating ball-and-stick model, as four file bodies.
 *
 * The 3D is hand-rolled — see {@link projectionNotes} for the four steps and why each is
 * in the order it is — because the desk is served under `script-src 'self'` and there is
 * no library to load. The model turns once per PERIOD (21 seconds), slowly enough to
 * follow a ring around, and a click on it pauses and resumes.
 *
 * @param id    the card's identity; becomes its `data-card` attribute and its directory
 *              name, so it must be a plain `[A-Za-z0-9_-]` name
 * @param title the card's heading, shown verbatim
 * @param data  `{ preset }` naming a built-in, or a full atom and bond table in Ångströms
 * @param ord   the card's position on the desk, low first; defaults to 20
 * @returns `{ json, html, css, js }` — the bodies of `card.json`, `card.html`, `card.css`
 *          and `card.js`, all four as strings ready to write
 * @throws TypeError for an unusable id, an unknown preset, or a malformed atom or bond list
 *
 * @example
 * const { html, js } = build({ id: 'mol', title: 'Caffeine',
 *                             data: { preset: 'caffeine' }, ord: 20 });
 *
 * @example
 * // a molecule of one's own, coordinates in Angstroms
 * build({ id: 'w', title: 'Water', ord: 5, data: {
 *   name: 'water', formula: 'H2O',
 *   atoms: [{ el: 'O', x: 0, y: 0, z: 0 },
 *           { el: 'H', x: 0.7575, y: 0.5871, z: 0 },
 *           { el: 'H', x: -0.7575, y: 0.5871, z: 0 }],
 *   bonds: [[0, 1, 1], [0, 2, 1]] } });
 *
 * @see PRESETS  the built-in molecules and their geometry
 * @see meta     the type's name and the shape it wants
 */
export function build({ id, title, data, ord } = {}) {
  if (!/^[\w-]+$/.test(String(id || ''))) {
    throw new TypeError('molecule: id must be a plain [A-Za-z0-9_-] name, got ' + JSON.stringify(id));
  }

  const mol   = resolve(data);
  const rows  = census(mol.atoms);
  const heavy = mol.atoms.length;
  const nb    = mol.bonds.length;
  const deg   = Math.round(Math.abs(TILT) * 180 / Math.PI);
  const head  = title == null ? mol.name : title;

  /* The label is the picture in words, and it is the only version of the card a screen
     reader gets — so it carries the census, not just the name. */
  const parts = rows.map(([e, k]) => k + ' ' + (NAMES[e.toLowerCase()] || e));
  const label = 'Rotating ball-and-stick model of ' + mol.name + ', ' + mol.formula +
                ': ' + heavy + ' atoms — ' + parts.join(', ') +
                ' — joined by ' + nb + ' bonds.';

  const legend = rows.map(([e, k]) =>
    '<span><i class="el-' + esc(e.toLowerCase()) + '"></i>' +
    esc(NAMES[e.toLowerCase()] || e) + ' ' + k + '</span>').join('');

  const html = `<section data-card="${esc(id)}" class="ck-molecule">
  <h2>${esc(head)}</h2>
  <svg class="ck-mol-stage" viewBox="0 0 540 360" role="img"
       aria-label="${esc(label)}"></svg>
  <div class="ck-legend">${legend}</div>
  <div class="ck-cap"><b>${esc(mol.name)}</b> &middot; ${subscripted(mol.formula)} &mdash;
    <i>${heavy} atoms, ${nb} bonds</i>, ball and stick. the page is served under
    <i>script-src 'self'</i>, so there is no 3D library to load and none is used: each atom
    is turned about the vertical, the view is pitched ${deg}&deg;, a pinhole projection makes
    nearer atoms larger, and then every atom and every half-bond is sorted back to front so
    that what is in front covers what is behind. depth is carried by size and by fading
    toward the ground &mdash; never by shifting a colour, because
    <span class="ck-aside">the colours are the elements and nothing else.</span>
    one turn every ${PERIOD} seconds. <span class="ck-aside ck-mol-state">click to pause</span></div>
</section>
`;

  return {
    json: JSON.stringify({ ord: Number.isFinite(Number(ord)) ? Number(ord) : 20 }, null, 2) + '\n',
    html,
    css: styles(),
    js: script(id, mol)
  };
}
