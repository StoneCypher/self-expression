
/* caffeine as ball-and-stick, hand-rolled: the desk is served under script-src 'self',
   so there is no three.js to reach for. Rotate about Y, pitch a fixed 17 degrees, project
   through a pinhole, then sort every atom and every bond half by depth and emit far to
   near — SVG has no z-index, so document order is the occlusion. */
CK.build("molecule", function (sec) {
  var svg = sec.querySelector('.ck-mol-stage');
  if (!svg) return;

  var MOL   = {"name":"caffeine","formula":"C8H10N4O2","atoms":[{"el":"N","x":-1.7968,"y":0.7351,"z":-0.2569},{"el":"C","x":-1.7968,"y":-0.6549,"z":-0.2569},{"el":"N","x":-0.593,"y":-1.3499,"z":-0.2569},{"el":"C","x":0.6108,"y":-0.6549,"z":-0.2569},{"el":"C","x":0.6108,"y":0.7351,"z":-0.2569},{"el":"C","x":-0.593,"y":1.4301,"z":-0.2569},{"el":"N","x":1.9328,"y":1.1646,"z":-0.2569},{"el":"C","x":2.7498,"y":0.0401,"z":-0.2569},{"el":"N","x":1.9328,"y":-1.0844,"z":-0.2569},{"el":"O","x":-2.8533,"y":-1.2649,"z":-0.2569},{"el":"O","x":-0.593,"y":2.6501,"z":-0.2569},{"el":"C","x":-3.0698,"y":1.4701,"z":-0.2569},{"el":"C","x":-0.593,"y":-2.8199,"z":-0.2569},{"el":"C","x":2.387,"y":2.5627,"z":-0.2569},{"el":"H","x":3.8298,"y":0.0401,"z":-0.2569},{"el":"H","x":-3.3849,"y":1.652,"z":0.7706},{"el":"H","x":-2.94,"y":2.4226,"z":-0.7706},{"el":"H","x":-3.8298,"y":0.8814,"z":-0.7706},{"el":"H","x":-0.593,"y":-3.1837,"z":0.7706},{"el":"H","x":-1.4828,"y":-3.1837,"z":-0.7706},{"el":"H","x":0.2968,"y":-3.1837,"z":-0.7706},{"el":"H","x":2.4994,"y":2.9087,"z":0.7706},{"el":"H","x":3.3457,"y":2.6338,"z":-0.7706},{"el":"H","x":1.6532,"y":3.1837,"z":-0.7706}],"bonds":[[0,1,1],[1,2,1],[2,3,1],[3,4,2],[4,5,1],[5,0,1],[4,6,1],[6,7,1],[7,8,2],[8,3,1],[1,9,2],[5,10,2],[0,11,1],[2,12,1],[6,13,1],[7,14,1],[11,15,1],[11,16,1],[11,17,1],[12,18,1],[12,19,1],[12,20,1],[13,21,1],[13,22,1],[13,23,1]]},
      A     = MOL.atoms,
      B     = MOL.bonds,
      N     = A.length,
      state = sec.querySelector('.ck-mol-state');

  var W = 540, H = 360, CX = W / 2, CY = H / 2, PAD = 10,
      TAU    = Math.PI * 2,
      PERIOD = 21,          /* seconds per revolution */
      TILT   = -0.3,         /* camera pitch, radians; applied after the spin */
      RDEF   = 0.36,          /* display radius for an element we have no colour for */
      STICK  = 0.28,          /* single-bond stick width, Angstroms */
      THIN   = 0.155,         /* each line of a double or triple bond */
      GAP    = 0.30,          /* centre-to-centre spacing of those lines */
      FLOOR  = 0.34,          /* opacity at the back of the model */
      GLOSS  = 0.40;          /* strength of the specular dot */

  /* Hoisted: these are read once per bond per frame and allocating them there would put a
     few thousand throwaway arrays a second in front of the collector. */
  var OFF1 = [0], OFF2 = [-0.5, 0.5], OFF3 = [-1, 0, 1];

  var RADII = {"h":0.24,"c":0.36,"n":0.35,"o":0.34,"s":0.42,"p":0.42};

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
      if (state) state.textContent = held ? 'paused \u2014 click to resume' : 'click to pause';
    });
  });

  begin();
});
