(function () {
  'use strict';

  var ID = "waterfall";
  var DEFAULTS = {"showTotals":true,"sort":"given","unit":""};
  var DATA = {"unit":"$","start":{"label":"Q1 closing ARR","value":4820000},"steps":[{"label":"new logos","value":640000},{"label":"expansion","value":385000},{"label":"reactivated","value":72000},{"label":"downgrades","value":-158000},{"label":"churn","value":-411000},{"label":"FX","value":-46000}],"end":{"label":"Q2 closing ARR"}};
  var K = {"CHW":5.42,"TXT":9,"W0":640,"H0":300,"WMAX":2400,"MINSLOT":40,"MAXBAR":52,"LABCAP":96};
  var SORTS = {"given":1,"magnitude":1};

function cwN(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/waterfall: non-finite coordinate from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

function cwTw(s) { return String(s).length * K.CHW; }

function cwClip(s, max) {
  var str = String(s);
  var room = Math.floor(max / K.CHW);
  return str.length <= room ? str : str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

function cwPid(id) {
  return String(id == null ? 'waterfall' : id).replace(/[^A-Za-z0-9_-]/g, '-') + '-hatch';
}

function cwSettle(cfg) {
  var c = cfg && typeof cfg === 'object' ? cfg : {};
  var unit = c.unit == null ? '' : String(c.unit);
  return {
    showTotals: c.showTotals == null ? true : !!c.showTotals,
    sort: SORTS[c.sort] ? c.sort : 'given',
    unit: unit.length > 12 ? unit.slice(0, 12) : unit,
  };
}

function cwRead(data) {
  var d = data && typeof data === 'object' ? data : {};
  var s = d.start && typeof d.start === 'object' ? d.start : {};
  var e = d.end && typeof d.end === 'object' ? d.end : {};
  var src = Object.prototype.toString.call(d.steps) === '[object Array]' ? d.steps : [];
  var v0 = Number(s.value);
  var steps = [], dropped = 0, i, row, v;

  for (i = 0; i < src.length; i++) {
    row = src[i];
    if (!row || typeof row !== 'object') { dropped++; continue; }
    v = Number(row.value);
    if (!isFinite(v)) { dropped++; continue; }
    steps.push({ label: row.label == null ? 'step ' + (i + 1) : String(row.label), value: v });
  }

  return {
    start: { label: s.label == null ? 'start' : String(s.label), value: isFinite(v0) ? v0 : 0 },
    steps: steps,
    endLabel: e.label == null ? 'end' : String(e.label),
    unit: d.unit == null ? '' : String(d.unit),
    dropped: dropped,
  };
}

function cwUnit(v, unit, signed) {
  var neg = v < 0;
  var body = CK.fmt(Math.abs(v));
  var sign = neg ? '-' : (signed && v > 0 ? '+' : '');
  if (!unit) return sign + body;
  if (unit.indexOf('#') >= 0) return sign + unit.replace('#', body);
  if (/^[^A-Za-z0-9\s]{1,2}$/.test(unit)) return sign + unit + body;
  return sign + body + ' ' + unit;
}

function cwPad(lo, hi) {
  var e;
  if (lo < hi) return [lo, hi];
  e = Math.abs(lo) * 0.5 || 1;
  return [lo - e, hi + e];
}

function cwSnap(lo, hi, want) {
  var t = CK.ticks(lo, hi, want), step, nlo, nhi, ticks, k, v;
  if (t.length < 2) return { lo: lo, hi: hi, ticks: t };
  step = t[1] - t[0];
  if (!(step > 0)) return { lo: lo, hi: hi, ticks: t };
  nlo = Math.floor(lo / step) * step;
  nhi = Math.ceil(hi / step) * step;
  if (!(nhi > nlo)) return { lo: lo, hi: hi, ticks: t };

  ticks = [];
  for (k = 0; k < 400; k++) {
    v = nlo + k * step;
    if (v > nhi + step / 1e6) break;
    ticks.push(Math.round(v / step) * step);      // kill float drift at the tick
  }
  return { lo: nlo, hi: nhi, ticks: ticks };
}

function cwLine(x1, y1, x2, y2, cls) {
  return '<line x1="' + cwN(x1, 'line') + '" y1="' + cwN(y1, 'line') +
         '" x2="' + cwN(x2, 'line') + '" y2="' + cwN(y2, 'line') + '" class="' + cls + '"/>';
}

function cwRect(x, y, w, h, cls, extra) {
  return '<rect x="' + cwN(x, 'rect') + '" y="' + cwN(y, 'rect') +
         '" width="' + cwN(Math.max(0, w), 'rect') + '" height="' + cwN(Math.max(0, h), 'rect') +
         '" class="' + cls + '"' + (extra ? ' ' + extra : '') + '/>';
}

function cwText(x, y, s, cls, anchor) {
  return '<text x="' + cwN(x, 'text') + '" y="' + cwN(y, 'text') + '" class="' + cls + '"' +
         (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + CK.esc(s) + '</text>';
}

function cwPlacer(x0, y0, x1, y1) {
  var taken = [];
  return function (text, cands) {
    var w = cwTw(text), i, c, left, box, j, b, clash;
    for (i = 0; i < cands.length; i++) {
      c = cands[i];
      left = c.anchor === 'middle' ? c.x - w / 2 : c.anchor === 'end' ? c.x - w : c.x;
      box = { x0: left - 1.5, y0: c.y - K.TXT + 0.5, x1: left + w + 1.5, y1: c.y + 2.5 };
      if (box.x0 < x0 - 3 || box.x1 > x1 + 3) continue;
      if (box.y0 < y0 - 2 || box.y1 > y1 + 2) continue;
      clash = false;
      for (j = 0; j < taken.length; j++) {
        b = taken[j];
        if (box.x1 <= b.x0 || box.x0 >= b.x1 || box.y1 <= b.y0 || box.y0 >= b.y1) continue;
        clash = true;
        break;
      }
      if (clash) continue;
      taken.push(box);
      return c;
    }
    return null;
  };
}

function cwColumns(read, cfg) {
  var steps = read.steps.slice();
  var cols = [], run = read.start.value, ups = 0, downs = 0, i, v;

  if (cfg.sort === 'magnitude') {
    /* Array#sort has been required to be stable since ES2019, so equal magnitudes keep the order
       the author wrote them in. That matters more than it sounds: a bridge whose tied lines swap
       places between two renders looks like the data changed. */
    steps.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
  }

  cols.push({ kind: 'total', label: read.start.label, from: 0, to: run, value: run });

  for (i = 0; i < steps.length; i++) {
    v = steps[i].value;
    if (v > 0) ups++; else if (v < 0) downs++;
    cols.push({ kind: 'step', label: steps[i].label, from: run, to: run + v, value: v });
    run = run + v;
  }

  cols.push({ kind: 'total', label: read.endLabel, from: 0, to: run, value: run });
  return { cols: cols, endValue: run, ups: ups, downs: downs };
}

function cwFrame(cols) {
  var F = { n: cols.length }, lo = 0, hi = 0, i, c, p, sn, w, want;

  for (i = 0; i < cols.length; i++) {
    c = cols[i];
    lo = Math.min(lo, c.from, c.to);
    hi = Math.max(hi, c.from, c.to);
  }
  p = cwPad(lo, hi);
  sn = cwSnap(p[0], p[1], 5);
  F.dlo = sn.lo; F.dhi = sn.hi; F.ticks = sn.ticks;

  F.padT = 16;
  F.padB = 24;
  F.padR = 14;
  w = 0;
  for (i = 0; i < F.ticks.length; i++) w = Math.max(w, cwTw(CK.fmt(F.ticks[i])));
  F.padL = Math.round(Math.min(80, w)) + 12;

  w = 0;
  for (i = 0; i < cols.length; i++) w = Math.max(w, cwTw(cwClip(cols[i].label, K.LABCAP)));
  F.slotWant = Math.max(K.MINSLOT, w + 10);

  want = F.padL + F.padR + F.n * F.slotWant;
  F.W = Math.min(K.WMAX, Math.max(K.W0, want));
  F.H = K.H0;

  F.x0 = F.padL;
  F.x1 = F.W - F.padR;
  F.y0 = F.padT;
  F.y1 = F.H - F.padB;

  F.slot = (F.x1 - F.x0) / Math.max(1, F.n);
  F.barW = Math.max(2, Math.min(K.MAXBAR, F.slot * 0.62));

  /* CK.scale parks everything at the range midpoint when the domain has zero width, which is what
     keeps an all-zero bridge from dividing by zero — though cwPad has already widened that case,
     so the guard is a second line of defence rather than the first. */
  F.y = CK.scale([F.dlo, F.dhi], [F.y1, F.y0]);
  F.zero = F.y(0);

  /** Screen x of the centre of column number i. */
  F.cx = function (i) { return F.x0 + (i + 0.5) * F.slot; };

  /* The column labels thin out rather than rotate when they collide. A rotated axis buys about
     forty percent more labels and costs every reader a head tilt. */
  F.thin = Math.max(1, Math.ceil((w + 8) / Math.max(0.01, F.slot)));
  F.labW = Math.max(18, F.slot * F.thin - 4);

  return F;
}

function cwDrawGrid(F, unit) {
  var out = [], i, t, y, note;

  for (i = 0; i < F.ticks.length; i++) {
    t = F.ticks[i];
    y = F.y(t);
    if (y < F.y0 - 0.5 || y > F.y1 + 0.5) continue;
    if (Math.abs(t) > 1e-9) out.push(cwLine(F.x0, y, F.x1, y, 'ck-rule'));
    out.push(cwText(F.x0 - 6, y + 3.2, CK.fmt(t), 'ck-tk', 'end'));
  }

  out.push(cwLine(F.x0, F.y0, F.x0, F.y1, 'ck-axis'));
  if (F.zero >= F.y0 - 0.5 && F.zero <= F.y1 + 0.5) {
    out.push(cwLine(F.x0, F.zero, F.x1, F.zero, 'ck-axis'));
  }

  note = unit.replace('#', '').replace(/^\s+|\s+$/g, '');
  if (note) out.push(cwText(F.x0 - 6, F.y0 - 4, note, 'ck-tk', 'end'));

  return out.join('');
}

function cwDrawBars(F, cols, cfg, pid) {
  var out = [], subs = [], put = cwPlacer(0, F.y0 - 12, F.W, F.y1), i, c, yA, yB, top, bot;
  var cls, fill, txt, cands, spot, nx, lx0, lx1, sub, sy;

  /* Three passes, and the order of each matters for a different reason.
     Draw order: leaders first, so the bars paint over them — a leader is a thin connector and
     where it meets a bar the bar should win.
     Label order: bars first, so that when a subtotal and a bar value want the same square inch
     the bar keeps it. The bar's number is the claim the picture is making; the subtotal is
     bookkeeping, and bookkeeping yields. */
  for (i = 0; i < cols.length - 1; i++) {
    sy = F.y(cols[i].to);
    /* Between the bars, not across them: the leader's job is to carry the eye over the gap and
       show that the next contribution starts exactly where the last one finished. */
    lx0 = F.cx(i) + F.barW / 2;
    lx1 = F.cx(i + 1) - F.barW / 2;
    out.push(cwLine(lx0, sy, lx1, sy, 'ck-lead'));
  }

  for (i = 0; i < cols.length; i++) {
    c = cols[i];
    nx = F.cx(i);
    yA = F.y(c.from);
    yB = F.y(c.to);
    top = Math.min(yA, yB);
    bot = Math.max(yA, yB);

    /* A zero-height bar is invisible, and invisible is what "not in the data" looks like. Grow it
       one pixel in the direction the bar would have grown, so a zero never lands on the wrong
       side of its own baseline. */
    if (bot - top < 1) {
      if (c.value < 0) bot = top + 1; else top = bot - 1;
    }

    cls = c.kind === 'total' ? 'ck-tot' : c.value < 0 ? 'ck-neg' : 'ck-pos';
    fill = cls === 'ck-neg' ? 'fill="url(#' + pid + ')"' : '';
    out.push('<g class="ck-col"><title>' + CK.esc(c.label + '  ' +
             cwUnit(c.value, cfg.unit, c.kind === 'step')) + '</title>' +
             cwRect(nx - F.barW / 2, top, F.barW, bot - top, cls, fill) + '</g>');

    txt = cwUnit(c.value, cfg.unit, c.kind === 'step');
    /* Outside the far end first, then inside it when the plot edge is in the way. Screen y runs
       downward, so a bar that grew upward has its far end at the smaller y. */
    if (c.value < 0) {
      cands = [{ x: nx, y: bot + 11, anchor: 'middle' }, { x: nx, y: bot - 4, anchor: 'middle' }];
    } else {
      cands = [{ x: nx, y: top - 4, anchor: 'middle' }, { x: nx, y: top + 12, anchor: 'middle' }];
    }
    spot = put(txt, cands);
    if (spot) out.push(cwText(spot.x, spot.y, txt, c.kind === 'total' ? 'ck-valt' : 'ck-val', spot.anchor));

    /* Column labels thin from the left, but the last one is always kept: the end column is what
       the whole bridge is for, and an axis that stops naming things two bars early looks like
       data that stops two bars early. */
    if (i % F.thin === 0 || i === cols.length - 1) {
      out.push(cwText(nx, F.H - 8, cwClip(c.label, F.labW), 'ck-tk', 'middle'));
    }
  }

  /* The running subtotals, last, on whatever space the bars left. The final leader is skipped:
     it would print the end value an inch from the end column's own label, and two identical
     numbers that close together read as two different numbers somebody should reconcile. */
  for (i = 0; cfg.showTotals && i < cols.length - 2; i++) {
    sy = F.y(cols[i].to);
    sub = cwUnit(cols[i].to, cfg.unit, false);
    lx0 = F.cx(i) + F.barW / 2;
    lx1 = F.cx(i + 1) - F.barW / 2;
    /* Only when the gap between the two bars can actually hold it; a subtotal spilling over the
       bars it connects is worse than no subtotal. */
    if (cwTw(sub) + 6 > Math.max(0, lx1 - lx0)) continue;
    spot = put(sub, [{ x: (lx0 + lx1) / 2, y: sy - 4, anchor: 'middle' },
                     { x: (lx0 + lx1) / 2, y: sy + 11, anchor: 'middle' }]);
    if (spot) subs.push(cwText(spot.x, spot.y, sub, 'ck-sub', spot.anchor));
  }

  return out.join('') + subs.join('');
}

function cwDefs(pid) {
  return '<defs><pattern id="' + pid + '" width="6" height="6"' +
         ' patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
         '<rect class="ck-hatch-bg" x="0" y="0" width="6" height="6"/>' +
         '<line class="ck-hatch-ln" x1="0" y1="0" x2="0" y2="6"/>' +
         '</pattern></defs>';
}

function cwDescribe(read, built, cfg) {
  var cols = built.cols, k = read.steps.length;
  var s0 = read.start.value, s1 = built.endValue, net = s1 - s0;
  var pct = s0 !== 0 ? (net / Math.abs(s0)) * 100 : null;
  var dir = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
  var up = null, dn = null, i, c, aria, bits = [];

  for (i = 1; i < cols.length - 1; i++) {
    c = cols[i];
    if (c.value > 0 && (!up || c.value > up.value)) up = c;
    if (c.value < 0 && (!dn || c.value < dn.value)) dn = c;
  }

  aria = 'Waterfall bridge: ' + read.start.label + ' at ' + cwUnit(s0, cfg.unit, false) +
    (k ? ' through ' + k + ' contribution' + (k === 1 ? '' : 's') : ' with no contributions') +
    ' to ' + read.endLabel + ' at ' + cwUnit(s1, cfg.unit, false) + '. ' +
    (dir === 'flat'
      ? 'Net change is zero, so the bridge ends where it started'
      : 'Net change is ' + cwUnit(net, cfg.unit, true) + ', ' + dir +
        (pct == null ? '' : ' by ' + CK.fmt(Math.abs(pct)) + ' percent')) + '. ' +
    (built.ups ? built.ups + ' rise' + (built.ups === 1 ? '' : 's') + ' drawn solid' : '') +
    (built.ups && built.downs ? ' and ' : '') +
    (built.downs ? built.downs + ' fall' + (built.downs === 1 ? '' : 's') + ' drawn hatched' : '') +
    (built.ups || built.downs ? '. ' : '') +
    (up ? 'The largest rise is ' + up.label + ' at ' + cwUnit(up.value, cfg.unit, true) + '. ' : '') +
    (dn ? 'The largest fall is ' + dn.label + ' at ' + cwUnit(dn.value, cfg.unit, true) + '. ' : '') +
    (cfg.sort === 'magnitude' ? 'Contributions are ordered by size, not by sequence. ' : '');

  bits.push('<b>' + CK.esc(cwUnit(s0, cfg.unit, false)) + '</b> at ' + CK.esc(read.start.label) +
            ' &rarr; <b>' + CK.esc(cwUnit(s1, cfg.unit, false)) + '</b> at ' + CK.esc(read.endLabel));
  bits.push(dir === 'flat'
    ? '<i>the contributions cancel exactly</i>, so the bridge returns to where it started'
    : 'net ' + CK.esc(cwUnit(net, cfg.unit, true)) +
      (pct == null ? '' : ' (' + CK.esc(CK.fmt(Math.abs(pct))) + '%)') +
      ' across ' + CK.esc(String(k)) + ' contribution' + (k === 1 ? '' : 's'));

  if (built.ups || built.downs) {
    bits.push('<i>' + CK.esc(String(built.ups)) + ' up, solid &middot; ' +
              CK.esc(String(built.downs)) + ' down, hatched</i>');
  }
  if (!k) {
    bits.push('<span class="ck-aside">no contributions, so the bridge is its own two ends</span>');
  }
  if (cfg.sort === 'magnitude') {
    bits.push('<span class="ck-aside">sorted by size &mdash; the total is unchanged, but the ' +
              'subtotals on the leaders are no longer a sequence that ever happened</span>');
  }
  if (read.dropped) {
    bits.push('<b>' + CK.esc(String(read.dropped)) + '</b> step' + (read.dropped === 1 ? '' : 's') +
              ' dropped for a missing or non-numeric value');
  }

  return { aria: aria.trim(), caption: bits.join('. ') + '.' };
}

function cwPlan(data, cfg, id) {
  var c = cwSettle(cfg);
  var read = cwRead(data);
  var built = cwColumns(read, c);
  var F = cwFrame(built.cols);
  var pid = cwPid(id);
  var note = cwDescribe(read, built, c);

  return {
    w: cwN(F.W, 'view'),
    h: cwN(F.H, 'view'),
    svg: cwDefs(pid) + cwDrawGrid(F, c.unit) + cwDrawBars(F, built.cols, c, pid),
    aria: note.aria,
    caption: note.caption,
  };
}

  CK.build(ID, function (sec) {

    var plot = sec.querySelector("svg.ck-plot");
    var cap = sec.querySelector(".ck-cap");
    if (!plot) { return; }

    /* Redraw from data plus settings. Sorting moves every bar and every subtotal, and the
       unit changes how wide every label is, so there is nothing to patch in place: the
       honest move is to plan the picture again. */
    function apply(cfg) {
      var p;
      try {
        p = cwPlan(DATA, cfg, ID);
      } catch (e) {
        /* A throw here means the geometry went non-finite, which is a bug in this card and
           not in the data. Say so where somebody will see it rather than leaving the last
           good drawing up and pretending it is current. */
        if (cap) { cap.textContent = "this bridge could not be drawn: " + e.message; }
        return;
      }
      plot.setAttribute("viewBox", "0 0 " + p.w + " " + p.h);
      plot.setAttribute("aria-label", p.aria);
      plot.style.minWidth = p.w > K.W0 ? p.w + "px" : "";
      plot.innerHTML = p.svg;
      if (cap) { cap.innerHTML = p.caption; }
    }

    /* CK.settings wires the gear and the panel idempotently and calls back with the settled
       config immediately, so this one line is also the first redraw after a DOM swap. */
    CK.settings(sec, DEFAULTS, apply);
  });
})();
