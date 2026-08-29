/* histogram card: the bin rule, the counts and the caption are all decided by the very
   functions that drew this card at build time, shipped here rather than restated. A
   settings change re-runs them; it does not run a second implementation of them. */
CK.build("histogram", function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var P = {"W":640,"H":300,"nbCap":120,"nbHard":200,"tinyN":10,"unit":"modules","xLabel":"source lines in the module","refused":0,"thinned":false,"stride":1,"shipped":41,"lo":293,"hi":1422,"pool":{"n":41,"min":293,"max":1422,"iqr":419,"sd":286.89252257978967},"groups":[{"name":"has a gear","n":37,"refused":0,"sample":[293,410,512,559,602,634,672,686,729,730,791,825,839,871,884,926,934,972,991,1043,1073,1090,1099,1102,1105,1110,1120,1148,1158,1180,1229,1239,1243,1275,1295,1372,1380],"f":1},{"name":"no settings","n":4,"refused":0,"sample":[455,679,1071,1422],"f":1}]};
  var DEFAULTS = {"bins":0,"rule":"fd","cumulative":false};

  var plot = sec.querySelector("svg.ck-plot");
  var cap  = sec.querySelector(".ck-cap");
  if (!plot) { return; }

  function fin(v) {
    if (typeof v !== 'number' || !isFinite(v)) {
      throw new Error('cardkit/histogram: non-finite coordinate (' + v + ')');
    }
    return Math.round(v * 100) / 100;
  }
  
  function tw(s) { return String(s).length * 5.42; }
  
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
  
  function hgRule(P, cfg) {
    var pool = P.pool;
    var want = cfg.rule === 'scott' ? 'scott' : cfg.rule === 'sturges' ? 'sturges' : 'fd';
    var asked = Math.round(Number(cfg.bins));
    var r = { rule: want, nb: 1, h: 0, why: '' };
    if (!(asked > 0)) { asked = 0; }
  
    if (pool.n === 0) {
      r.rule = 'none'; r.nb = 0; r.h = 0;
      r.why = 'there is nothing to bin.';
      return r;
    }
  
    var span = pool.max - pool.min;
  
    if (asked > 0) {
      r.rule = 'explicit';
      r.nb = Math.min(P.nbHard, asked);
      r.h = span > 0 ? span / r.nb : 0;
      r.why = 'the bin count was set by hand to ' + asked +
              (r.nb !== asked ? ', clamped to ' + r.nb : '') + ', so no rule was consulted.';
      return r;
    }
  
    if (!(span > 0)) {
      r.rule = 'degenerate'; r.nb = 1; r.h = 0;
      r.why = 'every kept value is the same number, so all three rules ask for a bin of zero ' +
              'width and none of them is usable; one nominal bin holds the whole sample.';
      return r;
    }
  
    var sturges = Math.max(1, Math.ceil(Math.log(pool.n) / Math.LN2) + 1);
  
    if (pool.n < P.tinyN) {
      r.rule = 'sturges'; r.nb = sturges; r.h = span / sturges;
      r.why = 'n is ' + pool.n + ', under ' + P.tinyN + '. Freedman-Diaconis and Scott both scale ' +
              'as n^(-1/3) off an estimate of spread, and at this size that estimate has no ' +
              'precision left, so Sturges - which is a function of n alone - was used instead.';
      return r;
    }
  
    if (want === 'sturges') {
      r.nb = sturges; r.h = span / sturges;
      r.why = 'Sturges: bins = ceil(log2 n) + 1. It takes no notice of spread at all, so past ' +
              'about n = 200 it asks for too few bins and can smooth a two-humped sample into one.';
      return r;
    }
  
    var h = want === 'scott'
      ? 3.49 * pool.sd * Math.pow(pool.n, -1 / 3)
      : 2 * pool.iqr * Math.pow(pool.n, -1 / 3);
  
    if (!(h > 0)) {
      r.rule = 'sturges'; r.nb = sturges; r.h = span / sturges;
      r.why = (want === 'scott' ? 'Scott' : 'Freedman-Diaconis') + ' asked for a bin of zero ' +
              'width, because the ' + (want === 'scott' ? 'standard deviation' : 'interquartile range') +
              ' of this sample is zero - which happens when over half the values share one number - ' +
              'so Sturges was used instead.';
      return r;
    }
  
    var raw = Math.max(1, Math.ceil(span / h));
    r.h = h;
    r.nb = Math.max(1, Math.min(P.nbCap, raw));
    r.why = (want === 'scott'
      ? 'Scott: h = 3.49 s n^(-1/3), optimal for a normal sample and nothing else - the standard ' +
        'deviation is not robust, so one far-out value widens every bin.'
      : 'Freedman-Diaconis: h = 2 IQR n^(-1/3). The interquartile range ignores the tails, so an ' +
        'outlier cannot widen the bins, only the range.') +
      ' h = ' + CK.fmt(h) + ', which is ' + raw + ' bins' +
      (raw > r.nb ? ', capped at ' + r.nb + ' - the extra bins would all have been empty' : '') + '.';
    return r;
  }
  
  function hgCount(sample, lo, hi, nb) {
    var out = [], i, b;
    var w = nb > 0 ? (hi - lo) / nb : 0;
    for (i = 0; i < nb; i++) { out.push(0); }
    if (nb === 0) { return out; }
    for (i = 0; i < sample.length; i++) {
      if (!(w > 0)) { out[0]++; continue; }
      b = Math.floor((sample[i] - lo) / w);
      if (b < 0) { b = 0; }
      if (b >= nb) { b = nb - 1; }
      out[b]++;
    }
    return out;
  }
  
  function hgNote(P, cfg, rule, cnt, maxC, lo, hi) {
    var unit = P.unit ? ' ' + P.unit : '';
    var ng = P.groups.length;
    var cum = cfg.cumulative ? ' cumulative' : '';
    var i, j;
  
    if (P.pool.n === 0) {
      return {
        aria: 'Histogram with no data: ' + (P.refused
          ? P.refused + ' value' + (P.refused === 1 ? ' was' : 's were') + ' refused as non-numeric and nothing was left to bin.'
          : 'nothing was supplied.'),
        caption: 'a histogram with <b>no data</b> - the frame is drawn so the card keeps its place. ' +
          (P.refused ? '<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y was' : 'ies were') +
                       ' refused</i> for not being finite numbers. ' : '') +
          'nothing here is an estimate of anything.',
      };
    }
  
    /* The tallest bin, searched across every group, so a multi-group card names the peak that is
       actually the tallest thing drawn rather than the first group's peak. */
    var peak = { c: -1, g: 0, b: 0 };
    for (i = 0; i < cnt.length; i++) {
      for (j = 0; j < cnt[i].length; j++) {
        if (cnt[i][j] > peak.c) { peak = { c: cnt[i][j], g: i, b: j }; }
      }
    }
    var w = rule.nb > 0 ? (hi - lo) / rule.nb : 0;
    var pa = lo + peak.b * w;
    var pb = pa + w;
  
    var names = [];
    for (i = 0; i < P.groups.length; i++) { names.push(P.groups[i].name); }
  
    var aria = 'Histogram of ' + P.pool.n + ' value' + (P.pool.n === 1 ? '' : 's') +
      (ng > 1 ? ' in ' + ng + ' groups (' + names.join(', ') + ')' : '') +
      ' in ' + rule.nb + ' bin' + (rule.nb === 1 ? '' : 's') +
      ' from ' + CK.fmt(lo) + ' to ' + CK.fmt(hi) + unit +
      (P.xLabel ? ', measuring ' + P.xLabel : '') + '. ' +
      'The' + cum + ' counts run from 0 to ' + CK.fmt(maxC) + '. ' +
      'The tallest column is ' + CK.fmt(pa) + ' to ' + CK.fmt(pb) + unit +
      (ng > 1 ? ' in ' + names[peak.g] : '') + ', holding ' + CK.fmt(peak.c) + '. ' +
      'Bin width was chosen by ' + rule.rule + '.';
  
    var doubts = [];
    if (P.refused) {
      doubts.push('<i>' + CK.esc(String(P.refused)) + ' entr' + (P.refused === 1 ? 'y' : 'ies') +
                  ' refused</i> for not being a finite number - counted, never silently dropped');
    }
    if (P.thinned) {
      doubts.push('the sample was thinned to <b>' + CK.esc(String(P.shipped)) + '</b> values ' +
                  '(every ' + CK.esc(String(P.stride)) + 'th of the sorted sample) and the counts ' +
                  'scaled back up, so each column is within a few of its true height');
    }
    if (rule.rule === 'degenerate') {
      doubts.push('<i>zero spread</i> - one nominal bin, one column, and no shape to read');
    }
    if (rule.nb >= P.nbCap && rule.rule !== 'explicit') {
      doubts.push('the bin count hit its cap of ' + CK.esc(String(P.nbCap)));
    }
    if (ng > 1) {
      doubts.push('groups share one set of bin edges and are drawn as outlines, not filled bars, ' +
                  'because filled bars hide each other and the hidden one is always the shorter');
    }
  
    var caption = '<b>' + CK.esc(String(P.pool.n)) + '</b> value' + (P.pool.n === 1 ? '' : 's') +
      (ng > 1 ? ' in <b>' + CK.esc(String(ng)) + '</b> groups' : '') +
      ' in <b>' + CK.esc(String(rule.nb)) + '</b>' + cum + ' bin' + (rule.nb === 1 ? '' : 's') +
      ' of width ' + CK.esc(CK.fmt(w)) + CK.esc(unit) + '. ' +
      '<i>rule: ' + CK.esc(rule.rule) + '</i> - ' + CK.esc(rule.why) + ' ' +
      (doubts.length ? '<span class="ck-aside">' + doubts.join('; ') + '.</span>' : '');
  
    return { aria: aria, caption: caption };
  }
  
  function hgRender(P, cfg) {
    var rule = hgRule(P, cfg);
    var lo = P.lo, hi = P.hi, nb = rule.nb;
    var cum = !!cfg.cumulative;
    var marks = [], cnt = [], maxC = 0;
    var i, j, g, c, run;
  
    for (i = 0; i < P.groups.length; i++) {
      g = P.groups[i];
      c = hgCount(g.sample, lo, hi, nb);
      for (j = 0; j < c.length; j++) { c[j] = Math.round(c[j] * g.f); }
      if (cum) { run = 0; for (j = 0; j < c.length; j++) { run += c[j]; c[j] = run; } }
      for (j = 0; j < c.length; j++) { if (c[j] > maxC) { maxC = c[j]; } }
      cnt.push(c);
    }
  
    var ax = axisTicks(0, maxC > 0 ? maxC : 1, 5);
    var leftW = 0;
    for (i = 0; i < ax.ticks.length; i++) { leftW = Math.max(leftW, tw(CK.fmt(ax.ticks[i]))); }
  
    var footCap = P.xLabel ? (P.unit ? P.xLabel + ' (' + P.unit + ')' : P.xLabel) : P.unit;
    var sideCap = cum ? 'cumulative count' : 'count';
    var padT = 14, padR = 16;
    var padB = 22 + (footCap ? 12 : 0);
    var padL = Math.round(leftW) + 12 + 12;
    var plot = { x0: padL, y0: padT, x1: P.W - padR, y1: P.H - padB };
  
    var yS = CK.scale([ax.lo, ax.hi], [plot.y1, plot.y0]);
    var xS = CK.scale([lo, hi], [plot.x0, plot.x1]);
  
    /* Furniture first, so every drawn count sits on top of its own gridline rather than under it. */
    for (i = 0; i < ax.ticks.length; i++) {
      var yv = yS(ax.ticks[i]);
      marks.push(mLine(plot.x0, yv, plot.x1, yv, 'ck-rule'));
      marks.push(mText(plot.x0 - 6, yv + 3.2, CK.fmt(ax.ticks[i]), 'ck-tk', 'end'));
    }
    var xt = CK.ticks(lo, hi, 6);
    for (i = 0; i < xt.length; i++) {
      var xv = xS(xt[i]);
      if (xv < plot.x0 - 0.5 || xv > plot.x1 + 0.5) { continue; }
      marks.push(mText(xv, plot.y1 + 13, CK.fmt(xt[i]), 'ck-tk', 'middle'));
    }
    marks.push(mLine(plot.x0, plot.y0, plot.x0, plot.y1, 'ck-axis'));
    marks.push(mLine(plot.x0, plot.y1, plot.x1, plot.y1, 'ck-axis'));
  
    var w = nb > 0 ? (hi - lo) / nb : 0;
    var solo = P.groups.length === 1;
  
    for (i = 0; i < P.groups.length; i++) {
      var colour = CK.hue(i);
      var kids = [];
      for (j = 0; j < nb; j++) {
        var xa = xS(lo + j * w), xb = xS(lo + (j + 1) * w);
        var yb = yS(cnt[i][j]);
        if (solo) {
          /* A filled bar for a lone group: the count IS the area, and a filled area reads as one.
             An empty bin is left empty rather than drawn one pixel tall - zero and absent mean the
             same thing in a histogram, unlike in a bar chart. */
          if (cnt[i][j] > 0) {
            kids.push(mRect(xa + 0.5, yb, Math.max(0.5, xb - xa - 1), plot.y1 - yb,
                            { fill: colour, 'fill-opacity': '0.55', stroke: colour,
                              'stroke-width': '1', 'class': 'ck-bin' }));
          }
        }
      }
      if (!solo && nb > 0) {
        /* Two or more groups become step outlines over shared edges. Overlaid filled bars hide
           each other and the hidden one is always the shorter, which reverses the comparison the
           reader came for; an outline crosses another outline and stays readable. */
        var d = '';
        for (j = 0; j < nb; j++) {
          var ea = xS(lo + j * w), eb = xS(lo + (j + 1) * w), ey = yS(cnt[i][j]);
          d += (j === 0 ? 'M' + fin(ea) + ' ' + fin(plot.y1) + 'L' + fin(ea) + ' ' + fin(ey)
                        : 'L' + fin(ea) + ' ' + fin(ey));
          d += 'L' + fin(eb) + ' ' + fin(ey);
        }
        d += 'L' + fin(xS(hi)) + ' ' + fin(plot.y1);
        kids.push(mPath(d, { fill: 'none', stroke: colour, 'stroke-width': '1.6',
                             'stroke-linejoin': 'round', 'class': 'ck-step' }));
      }
      marks.push({ t: 'g', a: { 'data-series': String(i), 'class': 'ck-ser' }, kids: kids });
    }
  
    /* One invisible hit target per bin, carrying every group's count for that bin. A 4px column
       is not a hit area, and a tooltip per group per bin would be nb x groups elements. */
    for (j = 0; j < nb; j++) {
      var ha = xS(lo + j * w), hb = xS(lo + (j + 1) * w);
      var parts = [];
      for (i = 0; i < P.groups.length; i++) {
        parts.push((P.groups.length > 1 ? P.groups[i].name + ' ' : '') + CK.fmt(cnt[i][j]));
      }
      var hit = mRect(ha, plot.y0, Math.max(1, hb - ha), plot.y1 - plot.y0,
                      { fill: 'none', 'pointer-events': 'all', 'class': 'ck-hit' });
      hit.ti = CK.fmt(lo + j * w) + ' to ' + CK.fmt(lo + (j + 1) * w) +
               (P.unit ? ' ' + P.unit : '') + '  \u00b7  ' + parts.join('  \u00b7  ');
      marks.push(hit);
    }
  
    if (footCap) { marks.push(mText((plot.x0 + plot.x1) / 2, P.H - 4, footCap, 'ck-cap-ax', 'middle')); }
    marks.push(mText(10, (plot.y0 + plot.y1) / 2, sideCap, 'ck-cap-ax', 'middle',
                     { transform: 'rotate(-90 10 ' + fin((plot.y0 + plot.y1) / 2) + ')' }));
  
    if (P.pool.n === 0) {
      marks.push(mText((plot.x0 + plot.x1) / 2, (plot.y0 + plot.y1) / 2, 'no data', 'ck-empty', 'middle'));
    }
  
    return { W: P.W, H: P.H, marks: marks, note: hgNote(P, cfg, rule, cnt, maxC, lo, hi) };
  }

  /* One display-list entry as a real element. The attribute names are the SVG ones, so this
     stays a translator rather than a second place where histogram decisions live. */
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

  /* A repaint, not an append: the desk swaps <main> and replays every builder, and a render
     that added marks would draw a second histogram over the first on every swap. */
  function render(cfg) {
    var out = hgRender(P, cfg), i;
    while (plot.firstChild) { plot.removeChild(plot.firstChild); }
    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);
    plot.setAttribute("aria-label", out.note.aria);
    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }
    /* The caption is markup whose every data-derived value was escaped as it was built, so
       it may be assigned rather than parsed out of the data. */
    if (cap) { cap.innerHTML = out.note.caption; }
  }

  CK.settings(sec, DEFAULTS, render);
});
