/* parallel card: domains, fractions and the axis order computed in Node; only the mapping
   from fraction to pixel happens here, because the plot width depends on the viewport. */
CK.build("parallel", function (sec) {

function parallelGeom(model, cfg) {
  var i, a, r;
  var order = model.orders[cfg.axisOrder] ? model.orders[cfg.axisOrder] : model.orders.given;
  var nA = order.length;
  var nR = model.vals.length;

  function r2(v) { return Math.round(v * 100) / 100; }

  if (!nA) { return { w: 100, h: 40, marks: [], pts: [] }; }

  var gap = nA > 1 ? (model.w0 - model.padL - model.padR) / (nA - 1) : 0;
  if (nA > 1 && gap < model.gapMin) { gap = model.gapMin; }
  var w = nA > 1 ? model.padL + model.padR + gap * (nA - 1) : model.padL + model.padR + 40;
  var h = model.h0;
  var y0 = model.padT;
  var y1 = h - model.padB;

  function xAt(slot) { return nA > 1 ? model.padL + slot * gap : w / 2; }
  function yAt(frac) { return y1 - frac * (y1 - y0); }

  var kids = [];

  for (i = 0; i < nA; i++) {
    a = order[i];
    var x = xAt(i);
    kids.push({ t: 'line', a: { x1: r2(x), y1: r2(y0), x2: r2(x), y2: r2(y1), "class": 'ax' } });
    for (var t = 0; t < model.ticks[a].length; t++) {
      var tf = model.ticks[a][t];
      kids.push({ t: 'line', a: { x1: r2(x - 3), y1: r2(yAt(tf[0])), x2: r2(x + 3),
                                  y2: r2(yAt(tf[0])), "class": 'tick' } });
    }
    kids.push({ t: 'text', a: { x: r2(x), y: r2(y0 - 15), "class": 'axlab', 'text-anchor': 'middle' },
                s: model.axClip[a], ti: model.axTip[a] });
    if (model.axFlat[a]) {
      kids.push({ t: 'text', a: { x: r2(x), y: r2(yAt(0.5) - 5), "class": 'axval',
                                  'text-anchor': 'middle' }, s: model.axHiLab[a] });
    } else {
      kids.push({ t: 'text', a: { x: r2(x), y: r2(y0 - 4), "class": 'axval', 'text-anchor': 'middle' },
                  s: model.axTopLab[a] });
      kids.push({ t: 'text', a: { x: r2(x), y: r2(y1 + 10), "class": 'axval', 'text-anchor': 'middle' },
                  s: model.axBotLab[a] });
    }
  }

  var op = Number(cfg.opacity);
  if (!(op > 0)) { op = 0.55; }
  if (op > 1) { op = 1; }

  var pts = [];
  for (r = 0; r < nR; r++) {
    var row = model.vals[r];
    var pl = [];
    for (i = 0; i < nA; i++) { pl.push([r2(xAt(i)), r2(yAt(row[order[i]]))]); }
    pts.push(pl);

    var d;
    if (nA === 1) {
      /* One axis is a strip of points, not a line: a path with a single M and no L renders as
         literally nothing, which is the most common way a plot comes out blank. */
      kids.push({ t: 'circle', a: { cx: pl[0][0], cy: pl[0][1], r: 2.6, "class": 'dot',
                                    fill: model.rowCol[r], opacity: r2(op) }, ti: model.rowTip[r] });
      continue;
    }
    d = 'M' + pl[0][0] + ',' + pl[0][1];
    for (i = 1; i < nA; i++) {
      if (cfg.curve) {
        var hx = r2((pl[i - 1][0] + pl[i][0]) / 2);
        d += 'C' + hx + ',' + pl[i - 1][1] + ' ' + hx + ',' + pl[i][1] + ' ' + pl[i][0] + ',' + pl[i][1];
      } else {
        d += 'L' + pl[i][0] + ',' + pl[i][1];
      }
    }
    /* Two paths per row inside one group: a fat invisible one that is easy to hover and a thin
       visible one that is easy to read. The highlight is then pure CSS -- the group dims when the
       plot is hovered and lifts when the group is -- with no listener to leak across a swap. */
    kids.push({ t: 'g', a: { "class": 'ln', opacity: r2(op) },
                kids: [
                  { t: 'path', a: { d: d, "class": 'hit' }, ti: model.rowTip[r] },
                  { t: 'path', a: { d: d, "class": 'wire', stroke: model.rowCol[r] } },
                ] });
  }

  return { w: r2(w), h: r2(h), marks: kids, pts: pts };
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

  var MODEL = {"nA":4,"w0":620,"h0":300,"padL":33,"padR":33,"padT":28,"padB":16,"gapMin":62,"axClip":["source li…","doc blocks","kit helpe…","settings"],"axTip":["source lines lines · 293 to 1.4k","doc blocks blocks · 9 to 44","kit helpers called of 12 · 0 to 12","settings knobs · 0 to 6"],"axFlat":[0,0,0,0],"axTopLab":["1.4k","44","12","6"],"axBotLab":["293","9","0","0"],"axHiLab":["1.4k","44","12","6"],"ticks":[[[0.1833,"500"],[0.6262,"1k"]],[[0.0286,"10"],[0.3143,"20"],[0.6,"30"],[0.8857,"40"]],[[0,"0"],[0.4167,"5"],[0.8333,"10"]],[[0,"0"],[0.3333,"2"],[0.6667,"4"],[1,"6"]]],"vals":[[0.7166,0.2857,0.3333,0.5],[0.8291,0.8571,0.5,0.5],[0.512,0.0857,0.4167,0.5],[0.7662,0.7143,0.5833,0.5],[0.7857,0.8,0.6667,0.6667],[0.6891,0.7429,0.5833,0],[0.302,0.1429,0.3333,0.5],[0.8875,0.8,0.4167,0.5],[0.194,0.4286,0.3333,0.6667],[0.9557,1,0.3333,0.5],[0.3871,0.4,0.4167,0.5],[0.4411,0.3143,0.3333,0.5],[0.8698,0.5714,0.4167,0.6667],[0.3862,0.2571,0.4167,0.5],[1,0.6857,0.5,0],[0.7139,0.8,0.3333,0.6667],[0.7192,0.6286,0.5833,0.5],[0.6014,0.7714,0.4167,0.5],[0.5678,0.4857,0.3333,0.5],[0.7059,0.4857,0.3333,0.5],[0.5235,0.1714,0.5,0.6667],[0.2737,0.1143,0.4167,0.5],[0.1435,0.3143,0.0833,0],[0.9628,0.7429,0.5,0.5],[0.3419,0.2286,0.25,0],[0,0,0.25,0.5],[0.2356,0.0857,0.4167,0.5],[0.7573,0.7143,0.5833,0.5],[0.6909,0.9714,0.4167,0.5],[0.3357,0.1143,0.3333,0.5],[0.8415,1,0.5833,0.5],[0.1036,0.0286,0.25,0.5],[0.6182,0.6857,0.3333,0.5],[0.7236,0.8571,0.4167,0.5],[0.4836,0.4571,0.4167,0.5],[0.4712,0.6571,0.5833,1],[0.5607,0.5143,0.4167,0.6667],[0.8379,0.8571,0.4167,0.5],[0.7325,0.7714,0.5833,0.5],[0.6643,0.7714,0.6667,0.5],[0.3481,0.5143,0.5833,0.5]],"rowCol":["var(--ck-s1)","var(--ck-s2)","var(--ck-s1)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)","var(--ck-s4)","var(--ck-s2)","var(--ck-s5)","var(--ck-s6)","var(--ck-s5)","var(--ck-s6)","var(--ck-s2)","var(--ck-s6)","var(--ck-s2)","var(--ck-s5)","var(--ck-s3)","var(--ck-s3)","var(--ck-s7)","var(--ck-s4)","var(--ck-s1)","var(--ck-s7)","var(--ck-s6)","var(--ck-s2)","var(--ck-s7)","var(--ck-s1)","var(--ck-s6)","var(--ck-s3)","var(--ck-s3)","var(--ck-s4)","var(--ck-s5)","var(--ck-s1)","var(--ck-s6)","var(--ck-s3)","var(--ck-s4)","var(--ck-s3)","var(--ck-s5)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)","var(--ck-s1)"],"rowTip":["live · source lines 1.1k lines · doc blocks 19 blocks · kit helpers called 4 of 12 · settings 3 knobs","structure · source lines 1.2k lines · doc blocks 39 blocks · kit helpers called 6 of 12 · settings 3 knobs","live · source lines 871 lines · doc blocks 12 blocks · kit helpers called 5 of 12 · settings 3 knobs","quantities · source lines 1.2k lines · doc blocks 34 blocks · kit helpers called 7 of 12 · settings 3 knobs","quantities · source lines 1.2k lines · doc blocks 37 blocks · kit helpers called 8 of 12 · settings 4 knobs","quantities · source lines 1.1k lines · doc blocks 35 blocks · kit helpers called 7 of 12 · settings 0 knobs","work · source lines 634 lines · doc blocks 14 blocks · kit helpers called 4 of 12 · settings 3 knobs","structure · source lines 1.3k lines · doc blocks 37 blocks · kit helpers called 5 of 12 · settings 3 knobs","time · source lines 512 lines · doc blocks 24 blocks · kit helpers called 4 of 12 · settings 4 knobs","text · source lines 1.4k lines · doc blocks 44 blocks · kit helpers called 4 of 12 · settings 3 knobs","time · source lines 730 lines · doc blocks 23 blocks · kit helpers called 5 of 12 · settings 3 knobs","text · source lines 791 lines · doc blocks 20 blocks · kit helpers called 4 of 12 · settings 3 knobs","structure · source lines 1.3k lines · doc blocks 29 blocks · kit helpers called 5 of 12 · settings 4 knobs","text · source lines 729 lines · doc blocks 18 blocks · kit helpers called 5 of 12 · settings 3 knobs","structure · source lines 1.4k lines · doc blocks 33 blocks · kit helpers called 6 of 12 · settings 0 knobs","time · source lines 1.1k lines · doc blocks 37 blocks · kit helpers called 4 of 12 · settings 4 knobs","quantities · source lines 1.1k lines · doc blocks 31 blocks · kit helpers called 7 of 12 · settings 3 knobs","quantities · source lines 972 lines · doc blocks 36 blocks · kit helpers called 5 of 12 · settings 3 knobs","pictures · source lines 934 lines · doc blocks 26 blocks · kit helpers called 4 of 12 · settings 3 knobs","work · source lines 1.1k lines · doc blocks 26 blocks · kit helpers called 4 of 12 · settings 3 knobs","live · source lines 884 lines · doc blocks 15 blocks · kit helpers called 6 of 12 · settings 4 knobs","pictures · source lines 602 lines · doc blocks 13 blocks · kit helpers called 5 of 12 · settings 3 knobs","text · source lines 455 lines · doc blocks 20 blocks · kit helpers called 1 of 12 · settings 0 knobs","structure · source lines 1.4k lines · doc blocks 35 blocks · kit helpers called 6 of 12 · settings 3 knobs","pictures · source lines 679 lines · doc blocks 17 blocks · kit helpers called 3 of 12 · settings 0 knobs","live · source lines 293 lines · doc blocks 9 blocks · kit helpers called 3 of 12 · settings 3 knobs","text · source lines 559 lines · doc blocks 12 blocks · kit helpers called 5 of 12 · settings 3 knobs","quantities · source lines 1.1k lines · doc blocks 34 blocks · kit helpers called 7 of 12 · settings 3 knobs","quantities · source lines 1.1k lines · doc blocks 43 blocks · kit helpers called 5 of 12 · settings 3 knobs","work · source lines 672 lines · doc blocks 13 blocks · kit helpers called 4 of 12 · settings 3 knobs","time · source lines 1.2k lines · doc blocks 44 blocks · kit helpers called 7 of 12 · settings 3 knobs","live · source lines 410 lines · doc blocks 10 blocks · kit helpers called 3 of 12 · settings 3 knobs","text · source lines 991 lines · doc blocks 33 blocks · kit helpers called 4 of 12 · settings 3 knobs","quantities · source lines 1.1k lines · doc blocks 39 blocks · kit helpers called 5 of 12 · settings 3 knobs","work · source lines 839 lines · doc blocks 25 blocks · kit helpers called 5 of 12 · settings 3 knobs","quantities · source lines 825 lines · doc blocks 32 blocks · kit helpers called 7 of 12 · settings 6 knobs","time · source lines 926 lines · doc blocks 27 blocks · kit helpers called 5 of 12 · settings 4 knobs","quantities · source lines 1.2k lines · doc blocks 39 blocks · kit helpers called 5 of 12 · settings 3 knobs","quantities · source lines 1.1k lines · doc blocks 36 blocks · kit helpers called 7 of 12 · settings 3 knobs","quantities · source lines 1k lines · doc blocks 36 blocks · kit helpers called 8 of 12 · settings 3 knobs","live · source lines 686 lines · doc blocks 27 blocks · kit helpers called 7 of 12 · settings 3 knobs"],"modes":["given","correlation"],"orders":{"given":[0,1,2,3],"correlation":[0,1,3,2]},"notes":{"given":"each axis is scaled on its own, from its own smallest value to its own largest, so a line high here and low there has not gone down -- it has moved between two ranges that have nothing to do with each other. axes in the order given; 464 crossings between neighbours.","correlation":"each axis is scaled on its own, from its own smallest value to its own largest, so a line high here and low there has not gone down -- it has moved between two ranges that have nothing to do with each other. axes reordered to cut crossings between neighbours from 464 to 435 (6% fewer)."},"arias":{"given":"Parallel coordinates, 41 rows across 4 axes. each axis is scaled on its own, from its own smallest value to its own largest, so a line high here and low there has not gone down -- it has moved between two ranges that have nothing to do with each other. axes in the order given; 464 crossings between neighbours.","correlation":"Parallel coordinates, 41 rows across 4 axes. each axis is scaled on its own, from its own smallest value to its own largest, so a line high here and low there has not gone down -- it has moved between two ranges that have nothing to do with each other. axes reordered to cut crossings between neighbours from 464 to 435 (6% fewer)."}};
  var DEF = {"curve":false,"axisOrder":"given","opacity":0.55};
  var box = sec.querySelector("svg.ck-pc");
  var note = sec.querySelector(".ck-pc-note");

  function pick(v, list, fallback) {
    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }
    return fallback;
  }

  function draw(cfg) {
    var ord = pick(cfg.axisOrder, MODEL.modes, DEF.axisOrder);
    if (note) { note.textContent = MODEL.notes[ord]; }
    if (!box || !MODEL.nA) { return; }
    var op = Number(cfg.opacity);
    if (!isFinite(op) || op <= 0 || op > 1) { op = DEF.opacity; }
    var got = parallelGeom(MODEL, { axisOrder: ord, curve: !!cfg.curve, opacity: op });
    paintList(box, got.marks);
    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);
    box.style.minWidth = Math.ceil(got.w) + "px";
    box.setAttribute("aria-label", MODEL.arias[ord]);
  }

  CK.settings(sec, DEF, draw);
});
