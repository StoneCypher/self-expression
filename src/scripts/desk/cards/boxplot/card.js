/* box plot card: the quartiles, fences, whiskers and notch were all computed in Node from
   the complete sample. The functions below are the ones that drew the card that shipped,
   emitted as their own source, so a settings change re-runs them rather than a second
   implementation of them. */
CK.build("boxplot", function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var P = {"W0":640,"H0":300,"wmax":2200,"unit":"lines","xLabel":"desk group","refused":0,"groups":[{"name":"structure","refused":0,"n":5,"min":1229,"max":1422,"q1":1275,"med":1295,"q3":1380,"iqr":105,"wlo":1229,"whi":1422,"mean":1320.2,"notchLo":1275,"notchHi":1369.192735493443,"notchClamped":true,"constant":false,"outCount":0,"outShown":[],"outThinned":false,"sample":[1229,1275,1295,1380,1422],"sampleThinned":false},{"name":"work","refused":0,"n":4,"min":634,"max":1090,"q1":662.5,"med":755.5,"q3":901.75,"iqr":239.25,"wlo":634,"whi":1090,"mean":808.75,"notchLo":662.5,"notchHi":901.75,"notchClamped":true,"constant":false,"outCount":0,"outShown":[],"outThinned":false,"sample":[634,672,839,1090],"sampleThinned":false},{"name":"text","refused":0,"n":6,"min":455,"max":1372,"q1":601.5,"med":760,"q3":941,"iqr":339.5,"wlo":455,"whi":1372,"mean":816.1666666666666,"notchLo":601.5,"notchHi":941,"notchClamped":true,"constant":false,"outCount":0,"outShown":[],"outThinned":false,"sample":[455,559,729,791,991,1372],"sampleThinned":false},{"name":"time","refused":0,"n":5,"min":512,"max":1243,"q1":730,"med":926,"q3":1099,"iqr":369,"wlo":512,"whi":1243,"mean":902,"notchLo":730,"notchHi":1099,"notchClamped":true,"constant":false,"outCount":0,"outShown":[],"outThinned":false,"sample":[512,730,926,1099,1243],"sampleThinned":false},{"name":"quantities","refused":0,"n":12,"min":825,"max":1239,"q1":1064,"med":1107.5,"q3":1150.5,"iqr":86.5,"wlo":972,"whi":1239,"mean":1087,"notchLo":1068.046769354927,"notchHi":1146.953230645073,"notchClamped":false,"constant":false,"outCount":1,"outShown":[825],"outThinned":false,"sample":[825,972,1043,1071,1073,1105,1110,1120,1148,1158,1180,1239],"sampleThinned":false},{"name":"pictures","refused":0,"n":3,"min":602,"max":934,"q1":640.5,"med":679,"q3":806.5,"iqr":166,"wlo":602,"whi":934,"mean":738.3333333333334,"notchLo":640.5,"notchHi":806.5,"notchClamped":true,"constant":false,"outCount":0,"outShown":[],"outThinned":false,"sample":[602,679,934],"sampleThinned":false},{"name":"live","refused":0,"n":6,"min":293,"max":1102,"q1":479,"med":778.5,"q3":880.75,"iqr":401.75,"wlo":293,"whi":1102,"mean":707.6666666666666,"notchLo":519.358273903706,"notchHi":880.75,"notchClamped":true,"constant":false,"outCount":0,"outShown":[],"outThinned":false,"sample":[293,410,686,871,884,1102],"sampleThinned":false}]};
  var DEFAULTS = {"notch":false,"points":"outliers","orient":"vertical"};

  var plot = sec.querySelector("svg.ck-plot");
  var cap  = sec.querySelector(".ck-cap");
  if (!plot) { return; }

  function fin(v) {
    if (typeof v !== 'number' || !isFinite(v)) {
      throw new Error('cardkit/boxplot: non-finite coordinate (' + v + ')');
    }
    return Math.round(v * 100) / 100;
  }
  
  function tw(s) { return String(s).length * 5.42; }
  
  function clipTo(s, max) {
    var str = String(s);
    var room = Math.floor(max / 5.42);
    return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
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
  
  function longestOf(list) {
    var best = '', i;
    for (i = 0; i < list.length; i++) { if (list[i].length > best.length) { best = list[i]; } }
    return best;
  }
  
  function notchPath(horiz, c, half, pq1, pq3, pmed, pnLo, pnHi) {
    var pinch = half * 0.45;
    var pts = [], i, d = '';
    if (horiz) {
      pts = [[pq1, c - half], [pnLo, c - half], [pmed, c - pinch], [pnHi, c - half], [pq3, c - half],
             [pq3, c + half], [pnHi, c + half], [pmed, c + pinch], [pnLo, c + half], [pq1, c + half]];
    } else {
      pts = [[c - half, pq1], [c - half, pnLo], [c - pinch, pmed], [c - half, pnHi], [c - half, pq3],
             [c + half, pq3], [c + half, pnHi], [c + pinch, pmed], [c + half, pnLo], [c + half, pq1]];
    }
    for (i = 0; i < pts.length; i++) {
      d += (i === 0 ? 'M' : 'L') + fin(pts[i][0]) + ' ' + fin(pts[i][1]);
    }
    return d + 'Z';
  }
  
  function bxNote(P, cfg, dom, drew) {
    var gs = P.groups, ng = gs.length, unit = P.unit ? ' ' + P.unit : '';
    var live = [], i, g;
    for (i = 0; i < ng; i++) { if (gs[i].n > 0) { live.push(gs[i]); } }
  
    if (!live.length) {
      return {
        aria: 'Box plot with no data: ' + (P.refused
          ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left to summarise.'
          : 'nothing was supplied.'),
        caption: 'a box plot with <b>no data</b> - the frame is drawn so the card keeps its place. ' +
          (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                       ' refused</i> for not being finite numbers. ' : '') +
          'no quartile here is an estimate of anything.',
      };
    }
  
    var totalN = 0, totalOut = 0, constants = 0, zeroIqr = 0, clamped = 0, thinned = 0;
    for (i = 0; i < ng; i++) {
      g = gs[i];
      totalN += g.n;
      totalOut += g.outCount;
      if (g.n > 0 && g.constant) { constants++; }
      if (g.n > 1 && !g.constant && g.iqr === 0) { zeroIqr++; }
      if (g.notchClamped && g.n > 0) { clamped++; }
      if (drew[i].thinned) { thinned++; }
    }
  
    /* The widest and narrowest boxes, because "which group is most spread out" is the first
       question a reader asks of a row of boxes and the picture answers it only approximately. */
    var wide = live[0], narrow = live[0];
    for (i = 1; i < live.length; i++) {
      if (live[i].iqr > wide.iqr) { wide = live[i]; }
      if (live[i].iqr < narrow.iqr) { narrow = live[i]; }
    }
  
    var aria = 'Box plot of ' + totalN + ' value' + (totalN === 1 ? '' : 's') + ' in ' + ng +
      ' group' + (ng === 1 ? '' : 's') + ', drawn ' + (cfg.orient === 'horizontal' ? 'horizontally' : 'vertically') +
      (P.xLabel ? ', measuring ' + P.xLabel : '') + '. ' +
      'Values run from ' + CK.fmt(dom.lo) + ' to ' + CK.fmt(dom.hi) + unit + '. ';
    for (i = 0; i < live.length && i < 8; i++) {
      g = live[i];
      aria += g.name + ': median ' + CK.fmt(g.med) + ', quartiles ' + CK.fmt(g.q1) + ' and ' +
              CK.fmt(g.q3) + ', whiskers ' + CK.fmt(g.wlo) + ' to ' + CK.fmt(g.whi) +
              (g.outCount ? ', ' + g.outCount + ' outlier' + (g.outCount === 1 ? '' : 's') : '') +
              ', n ' + g.n + '. ';
    }
    if (live.length > 8) { aria += 'The remaining ' + (live.length - 8) + ' groups are in the tooltips. '; }
    aria += 'Quartiles are the type-7 definition; whiskers reach the furthest observation within ' +
            '1.5 interquartile ranges of the box.';
  
    var doubts = [];
    if (P.refused) {
      doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                  ' refused</i> for not being a finite number - counted, never silently dropped');
    }
    if (constants) {
      doubts.push(CK.esc(String(constants)) + ' group' + (constants === 1 ? ' is' : 's are') +
                  ' constant, so there is no box at all - the marker is the single value they all share');
    }
    if (zeroIqr) {
      doubts.push(CK.esc(String(zeroIqr)) + ' group' + (zeroIqr === 1 ? ' has' : 's have') +
                  ' a zero interquartile range with a non-zero spread, which puts both fences on the ' +
                  'quartiles and makes every value away from the median an outlier - that is what ' +
                  'the 1.5 IQR rule says, and it is why such a box is not worth reading');
    }
    if (cfg.notch && clamped) {
      doubts.push('the notch is wider than the box in ' + CK.esc(String(clamped)) + ' group' +
                  (clamped === 1 ? '' : 's') + ' and has been clamped to it - that is the sample ' +
                  'telling you the median is not pinned down');
    }
    if (cfg.notch) {
      doubts.push('the notch is med +/- 1.58 IQR / sqrt(n), which converts an IQR into a standard ' +
                  'deviation and so assumes rough normality; on a skewed sample read it as a hint');
    }
    if (thinned) {
      doubts.push('dots in ' + CK.esc(String(thinned)) + ' group' + (thinned === 1 ? '' : 's') +
                  ' were thinned to every k-th of the sorted sample, keeping both ends; the ' +
                  'quartiles and the outlier COUNT are from the whole sample either way');
    }
    if (cfg.points === 'none' && totalOut) {
      doubts.push('outliers are hidden, so the axis no longer has to reach them and the boxes have ' +
                  'their room back - ' + CK.esc(String(totalOut)) + ' point' + (totalOut === 1 ? ' is' : 's are') +
                  ' off the picture');
    }
  
    var caption = '<b>' + CK.esc(String(totalN)) + '</b> value' + (totalN === 1 ? '' : 's') +
      ' in <b>' + CK.esc(String(ng)) + '</b> group' + (ng === 1 ? '' : 's') + '. ' +
      'quartiles are <i>type 7</i> - the definition R, NumPy and pandas use - and whiskers reach the ' +
      'furthest observation within <i>1.5 IQR</i> of the box, never to the fence itself. ' +
      (live.length > 1
        ? 'widest box <b>' + CK.esc(wide.name) + '</b> at ' + CK.esc(CK.fmt(wide.iqr)) + CK.esc(unit) +
          ', narrowest <b>' + CK.esc(narrow.name) + '</b> at ' + CK.esc(CK.fmt(narrow.iqr)) + CK.esc(unit) + '. '
        : 'median <b>' + CK.esc(CK.fmt(live[0].med)) + '</b>' + CK.esc(unit) + ', IQR ' +
          CK.esc(CK.fmt(live[0].iqr)) + CK.esc(unit) + '. ') +
      (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');
  
    return { aria: aria, caption: caption };
  }
  
  function bxRender(P, cfg) {
    var horiz = cfg.orient === 'horizontal';
    var gs = P.groups, ng = gs.length;
    var marks = [], i, j, g;
  
    /* What the axis must reach. With points hidden the outliers are not drawn, so they are not
       allowed to stretch the axis either - the picture and the domain always agree. */
    var showOut = cfg.points !== 'none';
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < ng; i++) {
      g = gs[i];
      if (!g.n) { continue; }
      if (showOut) {
        if (g.min < lo) { lo = g.min; }
        if (g.max > hi) { hi = g.max; }
      } else {
        if (g.wlo < lo) { lo = g.wlo; }
        if (g.whi > hi) { hi = g.whi; }
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (!(hi > lo)) {
      /* Zero spread across every group: half the magnitude either side, so the flat summary has
         somewhere to sit and the axis has ticks. All-zero data has no magnitude to halve. */
      var e = Math.abs(lo) * 0.5 || 0.5;
      lo -= e; hi += e;
    }
  
    var ax = axisTicks(lo, hi, 5);
    var vLabels = [], cLabels = [];
    for (i = 0; i < ax.ticks.length; i++) { vLabels.push(CK.fmt(ax.ticks[i])); }
    for (i = 0; i < ng; i++) { cLabels.push(gs[i].name); }
  
    var leftTexts = horiz ? cLabels : vLabels;
    var leftW = 0;
    for (i = 0; i < leftTexts.length; i++) { leftW = Math.min(130, Math.max(leftW, tw(leftTexts[i]))); }
  
    var footCap = horiz
      ? (P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit)
      : '';
    var sideCap = horiz ? '' : (P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit);
  
    var padT = 14, padR = 16;
    var padB = 22 + (footCap ? 12 : 0);
    var padL = Math.round(leftW) + 12 + (sideCap ? 12 : 0);
  
    var W = P.W0, H = P.H0;
    if (horiz) {
      H = Math.max(180, padT + padB + ng * 30);
    } else if (ng) {
      var perSlot = Math.max(30, tw(clipTo(longestOf(cLabels), 90)) + 8);
      W = Math.min(P.wmax, Math.max(P.W0, padL + padR + ng * perSlot));
    }
  
    var plot = { x0: padL, y0: padT, x1: W - padR, y1: H - padB };
    var vS = horiz ? CK.scale([ax.lo, ax.hi], [plot.x0, plot.x1])
                   : CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
    var cA = horiz ? plot.y0 : plot.x0;
    var cB = horiz ? plot.y1 : plot.x1;
    var band = ng ? (cB - cA) / ng : cB - cA;
    var boxW = Math.max(4, Math.min(46, band * 0.52));
  
    /* Gridlines run across the value axis; the category axis gets no rules at all, because a box
       plot's categories are names rather than positions and a rule between them implies an order. */
    for (i = 0; i < ax.ticks.length; i++) {
      var vp = vS(ax.ticks[i]);
      if (horiz) {
        marks.push(mLine(vp, plot.y0, vp, plot.y1, 'ck-rule'));
        marks.push(mText(vp, plot.y1 + 13, vLabels[i], 'ck-tk', 'middle'));
      } else {
        marks.push(mLine(plot.x0, vp, plot.x1, vp, 'ck-rule'));
        marks.push(mText(plot.x0 - 6, vp + 3.2, vLabels[i], 'ck-tk', 'end'));
      }
    }
    marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
    marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));
  
    var drew = [];
    for (i = 0; i < ng; i++) {
      g = gs[i];
      var colour = CK.hue(i);
      var c = cA + (i + 0.5) * band;
      var kids = [];
      var info = { dots: 0, outliers: 0, thinned: false };
  
      /* The category label. Vertical plots put it under its lane and clip it to the lane, because
         a name that overruns lands on its neighbour's name and neither can be read. */
      if (horiz) {
        marks.push(mText(plot.x0 - 6, c + 3.2, clipTo(g.name, 126), 'ck-tk', 'end'));
      } else {
        marks.push(mText(c, plot.y1 + 13, clipTo(g.name, Math.max(16, band - 2)), 'ck-tk', 'middle'));
      }
  
      /* An empty group keeps its lane and its label and draws nothing in it. Collapsing the lane
         would renumber every group after it, and a reader comparing two renders of the same card
         would be comparing different positions. */
      if (!g.n) {
        marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: [] });
        drew.push(info);
        continue;
      }
  
      var pq1 = vS(g.q1), pq3 = vS(g.q3), pmed = vS(g.med);
      var pwlo = vS(g.wlo), pwhi = vS(g.whi);
      var half = boxW / 2;
  
      /* Whisker spine and its two caps. Drawn before the box so the box's fill covers the part of
         the spine that runs behind it. */
      if (horiz) {
        kids.push(mLine(pwlo, c, pwhi, c, 'ck-whisk'));
        kids.push(mLine(pwlo, c - half * 0.45, pwlo, c + half * 0.45, 'ck-whisk'));
        kids.push(mLine(pwhi, c - half * 0.45, pwhi, c + half * 0.45, 'ck-whisk'));
      } else {
        kids.push(mLine(c, pwlo, c, pwhi, 'ck-whisk'));
        kids.push(mLine(c - half * 0.45, pwlo, c + half * 0.45, pwlo, 'ck-whisk'));
        kids.push(mLine(c - half * 0.45, pwhi, c + half * 0.45, pwhi, 'ck-whisk'));
      }
  
      /* The box. A zero-IQR group has no box to draw, so it gets a bar two pixels thick instead:
         an invisible box and an absent group must not look the same. */
      var thick = Math.abs(pq3 - pq1) < 2;
      var boxAttrs = { fill: colour, 'fill-opacity': '0.28', stroke: colour, 'stroke-width': '1.4',
                       'class': 'ck-box' };
      if (cfg.notch && !thick) {
        kids.push(mPath(notchPath(horiz, c, half, pq1, pq3, pmed, vS(g.notchLo), vS(g.notchHi)), boxAttrs));
      } else if (horiz) {
        kids.push(mRect(Math.min(pq1, pq3), c - half, Math.max(2, Math.abs(pq3 - pq1)), boxW, boxAttrs));
      } else {
        kids.push(mRect(c - half, Math.min(pq1, pq3), boxW, Math.max(2, Math.abs(pq3 - pq1)), boxAttrs));
      }
  
      /* The median, at full strength: it is the one number on a box plot that everybody reads. */
      if (horiz) { kids.push(mLine(pmed, c - half, pmed, c + half, 'ck-med')); }
      else { kids.push(mLine(c - half, pmed, c + half, pmed, 'ck-med')); }
  
      if (cfg.points === 'all') {
        var pts = g.sample;
        info.thinned = g.sampleThinned;
        for (j = 0; j < pts.length; j++) {
          var off = vdc(j) * half * 0.8;
          var pv = vS(pts[j]);
          kids.push(mDot(horiz ? pv : c + off, horiz ? c + off : pv, 1.6,
                         { fill: colour, 'fill-opacity': '0.5', stroke: 'none', 'class': 'ck-obs' }));
          info.dots++;
        }
      }
  
      if (showOut) {
        var outs = g.outShown;
        for (j = 0; j < outs.length; j++) {
          var ov = vS(outs[j]);
          var od = mDot(horiz ? ov : c, horiz ? c : ov, 2.4,
                        { fill: 'none', stroke: colour, 'stroke-width': '1.2', 'class': 'ck-out' });
          od.ti = g.name + '  \u00b7  outlier  \u00b7  ' + CK.fmt(outs[j]) + (P.unit ? ' ' + P.unit : '');
          kids.push(od);
          info.outliers++;
        }
        if (g.outThinned) { info.thinned = true; }
      }
  
      /* One invisible fat target per group, carrying the whole summary. A 1.4px box edge is not a
         hit area, and a tooltip per mark would be a tooltip on a whisker cap. */
      var hit = horiz
        ? mRect(plot.x0, c - band / 2, plot.x1 - plot.x0, band, { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' })
        : mRect(c - band / 2, plot.y0, band, plot.y1 - plot.y0, { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
      hit.ti = g.name + '  \u00b7  n ' + g.n +
               '  \u00b7  min ' + CK.fmt(g.min) + '  \u00b7  Q1 ' + CK.fmt(g.q1) +
               '  \u00b7  med ' + CK.fmt(g.med) + '  \u00b7  Q3 ' + CK.fmt(g.q3) +
               '  \u00b7  max ' + CK.fmt(g.max) + '  \u00b7  IQR ' + CK.fmt(g.iqr) +
               '  \u00b7  mean ' + CK.fmt(g.mean) +
               (g.outCount ? '  \u00b7  ' + g.outCount + ' outliers' : '') +
               (g.refused ? '  \u00b7  ' + g.refused + ' refused' : '');
      kids.push(hit);
  
      marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
      drew.push(info);
    }
  
    if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, H - 4, footCap, 'ck-cap-ax', 'middle')); }
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
  
    return { W: W, H: H, marks: marks, note: bxNote(P, cfg, { lo: ax.lo, hi: ax.hi }, drew) };
  }

  /* One display-list entry as a real element. The attribute names are the SVG ones, so this
     stays a translator rather than a second place where box plot decisions live. */
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
     a render that added marks would stack a second set of boxes on the first every swap. */
  function render(cfg) {
    var out = bxRender(P, cfg), i;
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
