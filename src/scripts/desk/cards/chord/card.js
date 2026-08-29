/* chord card: orders and ribbon widths computed in Node; the ring is drawn here because
   the pad angle is a viewer setting and cannot be precomputed. */
CK.build("chord", function (sec) {

function chordGeom(model, cfg) {
  var TAU = Math.PI * 2;
  var nEnt = model.n;
  var order = model.orders[cfg.sort] ? model.orders[cfg.sort] : model.orders.given;
  var i, j, k;

  var labOn = cfg.labels !== false;
  var room = labOn ? model.labW + 10 : 8;
  var size = 2 * (model.rOut + room);
  var out = { w: r2(size), h: r2(size), marks: [] };

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

  var MODEL = {"n":6,"rOut":120,"band":11,"labW":54.2,"total":120,"mass":[36,34,31,11,7,1],"ribs":[[0,1,34,0],[0,4,0,7],[0,5,2,1],[1,2,31,0],[1,5,3,0],[2,3,11,9],[2,4,19,0],[2,5,1,0],[3,4,2,0]],"inc":[[[0,1,34],[1,4,0],[2,5,2]],[[0,0,0],[3,2,31],[4,5,3]],[[3,1,0],[5,3,11],[6,4,19],[7,5,1]],[[5,2,9],[8,4,2]],[[1,0,7],[6,2,0],[8,3,0]],[[2,0,1],[4,1,0],[7,2,0]]],"hue":["var(--ck-s1)","var(--ck-s2)","var(--ck-s3)","var(--ck-s4)","var(--ck-s5)","var(--ck-s6)"],"ribHue":[0,4,0,1,1,2,2,2,3],"ribOp":[0.62,0.62,0.62,0.62,0.62,0.62,0.62,0.62,0.62],"tips":["queued → dispatched · 34 PRs   |   dispatched → queued · 0 PRs","queued → merged · 0 PRs   |   merged → queued · 7 PRs","queued → dropped · 2 PRs   |   dropped → queued · 1 PRs","dispatched → in review · 31 PRs   |   in review → dispatched · 0 PRs","dispatched → dropped · 3 PRs   |   dropped → dispatched · 0 PRs","in review → fix round · 11 PRs   |   fix round → in review · 9 PRs","in review → merged · 19 PRs   |   merged → in review · 0 PRs","in review → dropped · 1 PRs   |   dropped → in review · 0 PRs","fix round → merged · 2 PRs   |   merged → fix round · 0 PRs"],"arcTips":["queued · 36 PRs · 30%","dispatched · 34 PRs · 28%","in review · 31 PRs · 26%","fix round · 11 PRs · 9%","merged · 7 PRs · 6%","dropped · 1 PRs · 1%"],"clipLab":["queued","dispatched","in review","fix round","merged","dropped"],"sorts":["given","total","crossings"],"orders":{"given":[0,1,2,3,4,5],"total":[0,1,2,3,4,5],"crossings":[4,0,5,1,2,3]},"notes":{"given":"arcs in the order given; 2 ribbon crossings.","total":"arcs by total flow, largest first; crossings 2 to 2.","crossings":"crossings 2 to 1 after 48 sweeps, 2 swaps and 0 relocations."},"arias":{"given":"Chord diagram: 6 entities, 9 ribbons, 120 PRs of flow in all. directed: each pair is one ribbon, as wide at each end as the flow leaving that end, so a one-way flow tapers to a point where it arrives. arcs in the order given; 2 ribbon crossings.","total":"Chord diagram: 6 entities, 9 ribbons, 120 PRs of flow in all. directed: each pair is one ribbon, as wide at each end as the flow leaving that end, so a one-way flow tapers to a point where it arrives. arcs by total flow, largest first; crossings 2 to 2.","crossings":"Chord diagram: 6 entities, 9 ribbons, 120 PRs of flow in all. directed: each pair is one ribbon, as wide at each end as the flow leaving that end, so a one-way flow tapers to a point where it arrives. crossings 2 to 1 after 48 sweeps, 2 swaps and 0 relocations."}};
  var DEF = {"sort":"crossings","padAngle":2,"labels":true};
  var box = sec.querySelector("svg.ck-ch");
  var note = sec.querySelector(".ck-ch-note");

  function pick(v, list, fallback) {
    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }
    return fallback;
  }

  function draw(cfg) {
    var sort = pick(cfg.sort, MODEL.sorts, DEF.sort);
    if (note) { note.textContent = MODEL.notes[sort]; }
    if (!box || !MODEL.n) { return; }
    var pad = Number(cfg.padAngle);
    if (!isFinite(pad) || pad < 0) { pad = DEF.padAngle; }
    var got = chordGeom(MODEL, { sort: sort, padAngle: pad, labels: cfg.labels !== false });
    paintList(box, got.marks);
    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);
    box.setAttribute("aria-label", MODEL.arias[sort]);
  }

  CK.settings(sec, DEF, draw);
});
