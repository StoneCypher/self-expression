/* violin card: the bandwidth came from the complete sample in Node and is a number here.
   The estimator below is the source that drew the card that shipped, so moving the
   multiplier re-runs it rather than a second implementation of it. */
CK.build("violin", function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var P = {"W0":640,"H0":320,"wmax":2200,"minN":8,"grid":96,"tailZ":6,"unit":"lines","xLabel":"what the type has to do","refused":0,"groups":[{"name":"draws geometry","refused":0,"n":14,"min":602,"max":1422,"q1":1050,"med":1134,"q3":1216.75,"wlo":825,"whi":1422,"constant":false,"h0":65.625223458588,"sample":[602,686,825,1043,1071,1105,1120,1148,1158,1180,1229,1243,1380,1422],"thinned":false,"sticks":[602,686,825,1043,1071,1105,1120,1148,1158,1180,1229,1243,1380,1422]},{"name":"markup and CSS","refused":0,"n":27,"min":293,"max":1372,"q1":675.5,"med":884,"q3":1094.5,"wlo":293,"whi":1372,"constant":false,"h0":133.51384383327857,"sample":[293,410,455,512,559,634,672,679,729,730,791,839,871,884,926,934,972,991,1073,1090,1099,1102,1110,1239,1275,1295,1372],"thinned":false,"sticks":[293,410,455,512,559,634,672,679,729,730,791,839,871,884,926,934,972,991,1073,1090,1099,1102,1110,1239,1275,1295,1372]}]};
  var DEFAULTS = {"bandwidth":1,"inner":"box","trim":true};

  var plot = sec.querySelector("svg.ck-plot");
  var cap  = sec.querySelector(".ck-cap");
  if (!plot) { return; }

  function fin(v) {
    if (typeof v !== 'number' || !isFinite(v)) {
      throw new Error('cardkit/violin: non-finite coordinate (' + v + ')');
    }
    return Math.round(v * 100) / 100;
  }
  
  function tw(s) { return String(s).length * 5.42; }
  
  function clipTo(s, max) {
    var str = String(s);
    var room = Math.floor(max / 5.42);
    return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
  }
  
  function longestOf(list) {
    var best = '', i;
    for (i = 0; i < list.length; i++) { if (list[i].length > best.length) { best = list[i]; } }
    return best;
  }
  
  function axisTicks(lo, hi, want) {
    var t = CK.ticks(lo, hi, want);
    if (t.length < 2) { return { lo: lo, hi: hi, ticks: t }; }
    var step = t[1] - t[0];
    if (!(step > 0)) { return { lo: lo, hi: hi, ticks: t }; }
    var nlo = Math.floor(lo / step) * step;
    var nhi = Math.ceil(hi / step) * step;
    if (!(nhi > nlo)) { return { lo: lo, hi: hi, ticks: t }; }
    var out = [], k, v;
    for (k = 0; k < 500; k++) {
      v = nlo + k * step;
      if (v > nhi + step / 1e6) { break; }
      out.push(Math.round(v / step) * step);
    }
    return { lo: nlo, hi: nhi, ticks: out };
  }
  
  function mLine(x1, y1, x2, y2, cls) {
    return { t: 'line', a: { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' } };
  }
  
  function mText(x, y, s, cls, anchor, extra) {
    var a = { x: fin(x), y: fin(y), 'class': cls || '' }, k;
    if (anchor) { a['text-anchor'] = anchor; }
    if (extra) { for (k in extra) { if (Object.hasOwn(extra, k)) { a[k] = extra[k]; } } }
    return { t: 'text', a: a, s: String(s) };
  }
  
  function mRect(x, y, w, h, attrs) {
    var a = { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)) }, k;
    if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
    return { t: 'rect', a: a };
  }
  
  function mPath(d, attrs) {
    var a = { d: d }, k;
    if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
    return { t: 'path', a: a };
  }
  
  function mDot(cx, cy, r, attrs) {
    var a = { cx: fin(cx), cy: fin(cy), r: fin(r) }, k;
    if (attrs) { for (k in attrs) { if (Object.hasOwn(attrs, k)) { a[k] = attrs[k]; } } }
    return { t: 'circle', a: a };
  }
  
  function vdc(i) {
    var n = i + 1, d = 0.5, r = 0;
    while (n > 0) {
      r += (n % 2) * d;
      n = Math.floor(n / 2);
      d = d / 2;
    }
    return r * 2 - 1;
  }
  
  function kdeCurve(sample, h, grid, tailZ) {
    var out = [], i, j, s, z;
    var m = sample.length;
    var inv = 1 / (h * Math.sqrt(2 * Math.PI) * (m || 1));
    for (i = 0; i < grid.length; i++) {
      s = 0;
      for (j = 0; j < m; j++) {
        z = (grid[i] - sample[j]) / h;
        if (z > tailZ || z < -tailZ) { continue; }
        s += Math.exp(-0.5 * z * z);
      }
      out.push(s * inv);
    }
    return out;
  }
  
  function linGrid(lo, hi, n) {
    var out = [], i;
    if (n < 2) { return [lo]; }
    for (i = 0; i < n; i++) { out.push(lo + (hi - lo) * i / (n - 1)); }
    return out;
  }
  
  function vlNote(P, cfg, dom, drawn, mult) {
    var gs = P.groups, ng = gs.length, unit = P.unit ? ' ' + P.unit : '';
    var i, g;
    var live = 0, curves = 0, refusedSmall = 0, refusedFlat = 0, thinned = 0, totalN = 0;
    for (i = 0; i < ng; i++) {
      g = gs[i];
      totalN += g.n;
      if (g.n > 0) { live++; }
      if (drawn[i].density) { curves++; }
      else if (g.n > 0 && g.constant) { refusedFlat++; }
      else if (g.n > 0) { refusedSmall++; }
      if (drawn[i].thinned) { thinned++; }
    }
  
    if (!live) {
      return {
        aria: 'Violin plot with no data: ' + (P.refused
          ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left.'
          : 'nothing was supplied.'),
        caption: 'a violin plot with <b>no data</b> - the frame is drawn so the card keeps its place. ' +
          (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                       ' refused</i> for not being finite numbers. ' : '') +
          'no density is estimated from nothing.',
      };
    }
  
    var aria = 'Violin plot of ' + totalN + ' value' + (totalN === 1 ? '' : 's') + ' in ' + ng +
      ' group' + (ng === 1 ? '' : 's') + (P.xLabel ? ', measuring ' + P.xLabel : '') + '. ' +
      'Values run from ' + CK.fmt(dom.lo) + ' to ' + CK.fmt(dom.hi) + unit + '. ' +
      curves + ' group' + (curves === 1 ? '' : 's') + ' are drawn as a mirrored density; ' +
      (refusedSmall + refusedFlat) + ' as their individual observations. ';
    for (i = 0; i < ng && i < 8; i++) {
      g = gs[i];
      if (!g.n) { continue; }
      aria += g.name + ': n ' + g.n + ', median ' + CK.fmt(g.med) +
              ', from ' + CK.fmt(g.min) + ' to ' + CK.fmt(g.max) +
              (drawn[i].density ? ', bandwidth ' + CK.fmt(drawn[i].h) : ', drawn as points') + '. ';
    }
    aria += 'Width is an estimated density, not a count. Wider means more of the sample lands near ' +
            'that value.';
  
    var doubts = [];
    doubts.push('bandwidth is Silverman (0.9 min(sd, IQR/1.349) n^(-1/5))' +
                (mult !== 1 ? ' scaled by ' + CK.esc(CK.fmt(mult)) : '') +
                ' - widen it and every feature flattens, narrow it and noise becomes structure');
    if (refusedSmall) {
      doubts.push('<i>' + CK.esc(String(refusedSmall)) + ' group' + (refusedSmall === 1 ? '' : 's') +
                  ' had fewer than ' + CK.esc(String(P.minN)) + ' points</i>, so no density was drawn ' +
                  'for them - at that size a kernel estimate shows one bump per observation and calls ' +
                  'it a mode; the observations are drawn instead');
    }
    if (refusedFlat) {
      doubts.push('<i>' + CK.esc(String(refusedFlat)) + ' group' + (refusedFlat === 1 ? ' is' : 's are') +
                  ' constant</i>, which has no density at all - the limit is a spike of infinite ' +
                  'height and zero width - so the observations are drawn as a single stack');
    }
    if (P.refused) {
      doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                  ' refused</i> for not being a finite number - counted, never silently dropped');
    }
    if (thinned) {
      doubts.push('the curve in ' + CK.esc(String(thinned)) + ' group' + (thinned === 1 ? '' : 's') +
                  ' is evaluated from every k-th value of the sorted sample; the bandwidth and every ' +
                  'quoted number come from the whole of it');
    }
    if (!cfg.trim) {
      doubts.push('<i>untrimmed</i> - the curve runs three bandwidths past the smallest and largest ' +
                  'observation, so it shows density where nothing was observed and, for a bounded ' +
                  'quantity, where nothing could be');
    }
    if (curves > 1) {
      doubts.push('all violins share one density-to-width scale, so a fat one really is denser than ' +
                  'a thin one; scaling each to its own peak - the common default - would make every ' +
                  'group look equally well determined');
    }
  
    var caption = '<b>' + CK.esc(String(totalN)) + '</b> value' + (totalN === 1 ? '' : 's') +
      ' in <b>' + CK.esc(String(ng)) + '</b> group' + (ng === 1 ? '' : 's') + ', ' +
      '<b>' + CK.esc(String(curves)) + '</b> drawn as a Gaussian density and <b>' +
      CK.esc(String(refusedSmall + refusedFlat)) + '</b> as raw points. ' +
      'the inner mark is <i>' + CK.esc(String(cfg.inner)) + '</i>. ' +
      '<span class="ck-aside">' + doubts.join('; ') + '.</span>';
  
    return { aria: aria, caption: caption };
  }
  
  function vlRender(P, cfg) {
    var gs = P.groups, ng = gs.length;
    var marks = [], i, j, g;
  
    /* Clamped rather than trusted: the control is a number field and a viewer can type anything
       into it, including 0, which would divide by zero inside the kernel. */
    var mult = Number(cfg.bandwidth);
    if (!(mult > 0) || !isFinite(mult)) { mult = 1; }
    if (mult < 0.1) { mult = 0.1; }
    if (mult > 5) { mult = 5; }
  
    var trim = !!cfg.trim;
    var drawn = [];
  
    var lo = Infinity, hi = -Infinity, maxD = 0;
    for (i = 0; i < ng; i++) {
      g = gs[i];
      var d = { density: false, h: 0, grid: null, dens: null, thinned: !!g.thinned };
      if (g.n > 0) {
        if (g.n >= P.minN && !g.constant && g.h0 > 0) {
          d.h = g.h0 * mult;
          var glo = trim ? g.min : g.min - 3 * d.h;
          var ghi = trim ? g.max : g.max + 3 * d.h;
          if (!(ghi > glo)) { ghi = glo + 1; }
          d.grid = linGrid(glo, ghi, P.grid);
          d.dens = kdeCurve(g.sample, d.h, d.grid, P.tailZ);
          d.density = true;
          for (j = 0; j < d.dens.length; j++) { if (d.dens[j] > maxD) { maxD = d.dens[j]; } }
          if (glo < lo) { lo = glo; }
          if (ghi > hi) { hi = ghi; }
        } else {
          if (g.min < lo) { lo = g.min; }
          if (g.max > hi) { hi = g.max; }
        }
      }
      drawn.push(d);
    }
  
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (!(hi > lo)) {
      /* Zero spread across everything drawn: half the magnitude either side, so the flat stack has
         somewhere to sit and the axis has ticks. All-zero data has no magnitude to halve. */
      var e = Math.abs(lo) * 0.5 || 0.5;
      lo -= e; hi += e;
    }
  
    var ax = axisTicks(lo, hi, 5);
    var vLabels = [], cLabels = [];
    for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }
    for (i = 0; i < ng; i++) { cLabels.push(gs[i].name); }
  
    var leftW = 0;
    for (i = 0; i < vLabels.length; i++) { leftW = Math.max(leftW, tw(vLabels[i])); }
  
    var sideCap = P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit;
    var padT = 14, padR = 16;
    var padB = 22;
    var padL = Math.round(leftW) + 12 + (sideCap ? 12 : 0);
  
    var perSlot = Math.max(46, tw(clipTo(longestOf(cLabels), 90)) + 8);
    var W = ng ? Math.min(P.wmax, Math.max(P.W0, padL + padR + ng * perSlot)) : P.W0;
    var H = P.H0;
    var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
  
    var vS = CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
    var band = ng ? (plot.x1 - plot.x0) / ng : plot.x1 - plot.x0;
    var half = Math.max(3, Math.min(60, band * 0.42));
    /* One density-to-width scale for every group, so width means the same thing across the card. */
    var wS = CK.scale([0, maxD > 0 ? maxD : 1], [0, half]);
  
    for (i = 0; i < ax.ticks.length; i++) {
      var vp = vS(ax.ticks[i]);
      marks.push(mLine(plot.x0, vp, plot.x1, vp, 'ck-rule'));
      marks.push(mText(plot.x0 - 6, vp + 3.2, vLabels[i], 'ck-tk', 'end'));
    }
    marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
    marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));
  
    for (i = 0; i < ng; i++) {
      g = gs[i];
      var colour = CK.hue(i);
      var c = plot.x0 + (i + 0.5) * band;
      var kids = [];
  
      marks.push(mText(c, plot.y1 + 13, clipTo(g.name, Math.max(16, band - 2)), 'ck-tk', 'middle'));
  
      if (!g.n) {
        /* An empty group keeps its lane. Collapsing it would renumber every group after it, and a
           reader comparing two renders of the same card would be comparing different positions. */
        marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
        continue;
      }
  
      var dr = drawn[i];
      if (dr.density) {
        /* Up the right side, back down the left. One closed path rather than two mirrored curves,
           so the fill and the stroke follow the same outline and a half-transparent fill does not
           double up along the seam. */
        var dd = '';
        for (j = 0; j < dr.grid.length; j++) {
          dd += (j === 0 ? 'M' : 'L') + fin(c + wS(dr.dens[j])) + ' ' + fin(vS(dr.grid[j]));
        }
        for (j = dr.grid.length - 1; j >= 0; j--) {
          dd += 'L' + fin(c - wS(dr.dens[j])) + ' ' + fin(vS(dr.grid[j]));
        }
        kids.push(mPath(dd + 'Z', { fill: colour, 'fill-opacity': '0.26', stroke: colour,
                                    'stroke-width': '1.4', 'stroke-linejoin': 'round',
                                    'class': 'ck-violin' }));
  
        if (cfg.inner === 'box') {
          /* A miniature box plot: the same type-7 quartiles and 1.5 IQR whiskers the box plot card
             draws, so the two cards on one desk cannot disagree about the same group. */
          var bw = Math.max(2.5, half * 0.16);
          kids.push(mLine(c, vS(g.wlo), c, vS(g.whi), 'ck-whisk'));
          kids.push(mRect(c - bw / 2, Math.min(vS(g.q1), vS(g.q3)), bw,
                          Math.max(1.5, Math.abs(vS(g.q3) - vS(g.q1))),
                          { fill: 'var(--ground)', stroke: 'var(--ink-dim)', 'stroke-width': '1',
                            'class': 'ck-innerbox' }));
          kids.push(mDot(c, vS(g.med), Math.max(1.4, bw * 0.42),
                         { fill: 'var(--ink)', stroke: 'none', 'class': 'ck-med' }));
        } else if (cfg.inner === 'stick') {
          for (j = 0; j < g.sticks.length; j++) {
            kids.push(mLine(c - half * 0.3, vS(g.sticks[j]), c + half * 0.3, vS(g.sticks[j]), 'ck-stick'));
          }
        }
      } else {
        /* Refused a density. The observations are the picture instead, spread across the lane by a
           deterministic low-discrepancy offset so that ties are visible as a column of dots rather
           than as one dot with nine hiding behind it. */
        for (j = 0; j < g.sticks.length; j++) {
          kids.push(mDot(c + vdc(j) * half * 0.55, vS(g.sticks[j]), 2.2,
                         { fill: colour, 'fill-opacity': '0.7', stroke: 'none', 'class': 'ck-obs' }));
        }
        kids.push(mText(c, plot.y0 + 9,
                        g.constant ? 'flat' : 'n ' + g.n, 'ck-warn', 'middle'));
      }
  
      var hit = mRect(c - band / 2, plot.y0, band, plot.y1 - plot.y0,
                      { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
      hit.ti = g.name + '  \u00b7  n ' + g.n +
               '  \u00b7  median ' + CK.fmt(g.med) +
               '  \u00b7  IQR ' + CK.fmt(g.q3 - g.q1) +
               '  \u00b7  ' + CK.fmt(g.min) + ' to ' + CK.fmt(g.max) +
               (dr.density ? '  \u00b7  bandwidth ' + CK.fmt(dr.h) : '  \u00b7  no density: ' +
                 (g.constant ? 'constant' : 'n below ' + P.minN)) +
               (g.refused ? '  \u00b7  ' + g.refused + ' refused' : '');
      kids.push(hit);
  
      marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
    }
  
    if (sideCap) {
      var cy = (plot.y0 + plot.y1) / 2;
      marks.push(mText(10, cy, sideCap, 'ck-cap-ax', 'middle',
                       { transform: 'rotate(-90 10 ' + fin(cy) + ')' }));
    }
  
    var any = false;
    for (i = 0; i < ng; i++) { if (gs[i].n > 0) { any = true; } }
    if (!any) {
      marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
    }
  
    return { W: W, H: H, marks: marks, note: vlNote(P, cfg, { lo: ax.lo, hi: ax.hi }, drawn, mult) };
  }

  /* One display-list entry as a real element. The attribute names are the SVG ones, so this
     stays a translator rather than a second place where violin decisions live. */
  function node(m) {
    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;
    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }
    if (m.s != null) { e.textContent = m.s; }
    if (m.ti != null) {
      tip = document.createElementNS(NS, "title");
      tip.textContent = m.ti;
      e.appendChild(tip);
    }
    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }
    return e;
  }

  /* A repaint, not an append: the desk swaps its main element and replays every builder, so
     a render that added marks would stack a second set of violins on the first. */
  function render(cfg) {
    var out = vlRender(P, cfg), i;
    while (plot.firstChild) { plot.removeChild(plot.firstChild); }
    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);
    plot.setAttribute("aria-label", out.note.aria);
    plot.style.minWidth = out.W > 640 ? out.W + "px" : "";
    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }
    /* The caption is markup whose every data-derived value was escaped as it was built, so
       it may be assigned rather than parsed out of the data. */
    if (cap) { cap.innerHTML = out.note.caption; }
  }

  CK.settings(sec, DEFAULTS, render);
});
