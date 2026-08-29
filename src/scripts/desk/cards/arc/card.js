/* arc card: node orders and crossing counts computed in Node; the line is laid out here
   because node spacing depends on the label setting and the card width. */
CK.build("arc", function (sec) {

function arcGeom(model, cfg) {
  var i, k;
  var nN = model.n;
  var key = cfg.side + '/' + cfg.order;
  var order = model.plans[key] ? model.plans[key] : model.plans['above/given'];
  var split = cfg.side === 'both';
  var labOn = cfg.labels !== false;

  function r2(v) { return Math.round(v * 100) / 100; }

  if (!nN) { return { w: 100, h: 40, marks: [] }; }

  var pos = [];
  for (k = 0; k < order.length; k++) { pos[order[k]] = k; }

  var gap = nN > 1 ? (model.w0 - model.margin * 2) / (nN - 1) : 0;
  if (gap < model.gapMin) { gap = model.gapMin; }
  if (gap > model.gapMax) { gap = model.gapMax; }
  var w = model.margin * 2 + (nN - 1) * gap;
  if (w < 120) { w = 120; }

  function xOf(node) { return model.margin + pos[node] * gap; }

  /* Both rail heights come from the arcs that will actually be drawn, so a diagram whose longest
     arc spans four nodes is four nodes tall rather than reserving room for a span it never has. */
  var topR = 0, botR = 0;
  for (k = 0; k < model.edges.length; k++) {
    var lowSide = split && model.below[k];
    var rx = Math.abs(xOf(model.edges[k][1]) - xOf(model.edges[k][0])) / 2;
    var ry = Math.min(rx, lowSide ? model.capBelow : model.capAbove);
    if (lowSide) { if (ry > botR) { botR = ry; } }
    else if (ry > topR) { topR = ry; }
  }
  if (model.loops.length && topR < 12) { topR = 12; }

  var labH = labOn ? model.labW + 8 : 6;
  var top = topR + 9;
  var labTop = top + 8;
  var rail2 = labTop + labH + 4;
  var h = split && botR > 0 ? rail2 + botR + 8 : labTop + labH + 4;

  var kids = [];

  kids.push({ t: 'line', a: { x1: r2(model.margin - 4), y1: r2(top), x2: r2(w - model.margin + 4),
                              y2: r2(top), "class": 'rail' } });
  if (split && botR > 0) {
    kids.push({ t: 'line', a: { x1: r2(model.margin - 4), y1: r2(rail2), x2: r2(w - model.margin + 4),
                                y2: r2(rail2), "class": 'rail' } });
  }

  for (k = 0; k < model.edges.length; k++) {
    var e = model.edges[k];
    var x1 = xOf(e[0]), x2 = xOf(e[1]);
    var low = split && model.below[k];
    var arx = Math.abs(x2 - x1) / 2;
    var ary = Math.min(arx, low ? model.capBelow : model.capAbove);
    var y = low ? rail2 : top;
    var d = 'M' + r2(x1) + ',' + r2(y) + 'A' + r2(arx) + ',' + r2(ary) + ' 0 0 ' +
            (low ? 0 : 1) + ' ' + r2(x2) + ',' + r2(y);
    kids.push({ t: 'path', a: { d: d, "class": 'edge', stroke: model.edgeCol[k],
                                'stroke-width': model.edgeW[k] }, ti: model.edgeTip[k] });
    if (low) {
      kids.push({ t: 'line', a: { x1: r2(x1), y1: r2(top), x2: r2(x1), y2: r2(rail2), "class": 'stem' } });
      kids.push({ t: 'line', a: { x1: r2(x2), y1: r2(top), x2: r2(x2), y2: r2(rail2), "class": 'stem' } });
    }
  }

  for (k = 0; k < model.loops.length; k++) {
    var lp = model.loops[k];
    kids.push({ t: 'circle', a: { cx: r2(xOf(lp[0])), cy: r2(top - 6), r: 5, "class": 'loop',
                                  stroke: model.nodeCol[lp[0]] }, ti: model.loopTip[k] });
  }

  for (i = 0; i < nN; i++) {
    kids.push({ t: 'circle', a: { cx: r2(xOf(i)), cy: r2(top), r: model.dotR[i], "class": 'dot',
                                  fill: model.nodeCol[i] }, ti: model.nodeTip[i] });
    if (!labOn) { continue; }
    var lx = xOf(i);
    kids.push({ t: 'text',
                a: { x: r2(lx), y: r2(labTop), "class": 'lab', 'text-anchor': 'end',
                     transform: 'rotate(-90 ' + r2(lx) + ',' + r2(labTop) + ')' },
                s: model.clipLab[i], ti: model.nodeTip[i] });
  }

  return { w: r2(w), h: r2(h), marks: kids };
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

  var MODEL = {"n":12,"w0":620,"margin":16,"gapMin":13,"gapMax":46,"capAbove":132,"capBelow":92,"labW":59.62,"clipLab":["CK.esc","CK.svg","CK.hue","CK.scale","CK.ticks","CK.fmt","CK.once","CK.spin","CK.timer","CK.settings","CK.net","CK.build"],"edges":[[0,2],[0,3],[0,4],[0,5],[0,6],[0,8],[0,9],[0,11],[2,3],[2,4],[2,5],[2,9],[2,11],[3,4],[3,5],[3,9],[3,11],[4,5],[4,9],[4,11],[5,9],[5,11],[6,8],[6,9],[6,11],[8,9],[8,11],[9,11]],"below":[0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,0,1,1,1,1,0,0,0,0,0,0],"edgeW":[2.33,1.9,1.04,2.76,2.48,1.33,4.91,5.2,1.47,1.04,2.33,2.19,2.48,1.04,1.62,1.62,1.9,1.04,0.9,1.04,2.48,2.76,0.9,2.19,2.62,1.33,1.33,5.2],"edgeCol":["var(--ck-s1)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ck-s2)","var(--ck-s2)","var(--ink-faint)","var(--ink-faint)","var(--ck-s2)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ink-faint)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)"],"edgeTip":["CK.esc — CK.hue · 17 types","CK.esc — CK.scale · 14 types","CK.esc — CK.ticks · 8 types","CK.esc — CK.fmt · 20 types","CK.esc — CK.once · 18 types","CK.esc — CK.timer · 10 types","CK.esc — CK.settings · 35 types","CK.esc — CK.build · 37 types","CK.hue — CK.scale · 11 types","CK.hue — CK.ticks · 8 types","CK.hue — CK.fmt · 17 types","CK.hue — CK.settings · 16 types","CK.hue — CK.build · 18 types","CK.scale — CK.ticks · 8 types","CK.scale — CK.fmt · 12 types","CK.scale — CK.settings · 12 types","CK.scale — CK.build · 14 types","CK.ticks — CK.fmt · 8 types","CK.ticks — CK.settings · 7 types","CK.ticks — CK.build · 8 types","CK.fmt — CK.settings · 18 types","CK.fmt — CK.build · 20 types","CK.once — CK.timer · 7 types","CK.once — CK.settings · 16 types","CK.once — CK.build · 19 types","CK.timer — CK.settings · 10 types","CK.timer — CK.build · 10 types","CK.settings — CK.build · 37 types"],"loops":[],"loopTip":[],"dotR":[4.93,2.2,3.69,3.42,3.01,3.83,3.23,2.2,2.84,4.79,2.2,5],"nodeCol":["var(--ck-s1)","var(--ck-s1)","var(--ck-s1)","var(--ck-s2)","var(--ck-s2)","var(--ck-s2)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)","var(--ck-s3)","var(--ck-s4)","var(--ck-s3)"],"nodeTip":["CK.esc · markup · 8 edges","CK.svg · markup · 0 edges","CK.hue · markup · 6 edges","CK.scale · geometry · 6 edges","CK.ticks · geometry · 6 edges","CK.fmt · geometry · 6 edges","CK.once · lifecycle · 4 edges","CK.spin · lifecycle · 0 edges","CK.timer · lifecycle · 4 edges","CK.settings · lifecycle · 8 edges","CK.net · network · 0 edges","CK.build · lifecycle · 8 edges"],"orders":["given","group","barycentre"],"sides":["above","both"],"plans":{"above/given":[0,1,2,3,4,5,6,7,8,9,10,11],"above/group":[0,1,2,3,4,5,6,7,9,8,11,10],"above/barycentre":[0,2,3,5,4,9,6,8,11,1,7,10],"both/given":[0,1,2,3,4,5,6,7,8,9,10,11],"both/group":[0,1,2,3,4,5,6,7,9,11,8,10],"both/barycentre":[0,3,5,2,4,9,11,6,8,1,7,10]},"notes":{"above/given":"every arc above the line: nodes in the order given; 64 crossings. 3 nodes touch no edge, so they have no barycentre and are held at the end.","above/group":"every arc above the line: nodes blocked by group, then tidied inside each block: crossings 64 to 60. the blocks themselves are not reordered, so this number is what your grouping costs, not what a layout could do. 3 nodes touch no edge, so they have no barycentre and are held at the end.","above/barycentre":"every arc above the line: crossings 64 to 48 (25% fewer) after 48 sweeps, 3 swaps and 0 relocations. 3 nodes touch no edge, so they have no barycentre and are held at the end.","both/given":"arcs within a group go above the line and bridges between groups below: nodes in the order given; 48 crossings. 3 nodes touch no edge, so they have no barycentre and are held at the end.","both/group":"arcs within a group go above the line and bridges between groups below: nodes blocked by group, then tidied inside each block: crossings 48 to 40. the blocks themselves are not reordered, so this number is what your grouping costs, not what a layout could do. 3 nodes touch no edge, so they have no barycentre and are held at the end.","both/barycentre":"arcs within a group go above the line and bridges between groups below: crossings 48 to 24 (50% fewer) after 48 sweeps, 7 swaps and 0 relocations. 3 nodes touch no edge, so they have no barycentre and are held at the end."},"arias":{"above/given":"Arc diagram of 12 nodes and 28 edges, every arc above the line. nodes in the order given; 64 crossings. 3 nodes touch no edge, so they have no barycentre and are held at the end.","above/group":"Arc diagram of 12 nodes and 28 edges, every arc above the line. nodes blocked by group, then tidied inside each block: crossings 64 to 60. the blocks themselves are not reordered, so this number is what your grouping costs, not what a layout could do. 3 nodes touch no edge, so they have no barycentre and are held at the end.","above/barycentre":"Arc diagram of 12 nodes and 28 edges, every arc above the line. crossings 64 to 48 (25% fewer) after 48 sweeps, 3 swaps and 0 relocations. 3 nodes touch no edge, so they have no barycentre and are held at the end.","both/given":"Arc diagram of 12 nodes and 28 edges, arcs within a group go above the line and bridges between groups below. nodes in the order given; 48 crossings. 3 nodes touch no edge, so they have no barycentre and are held at the end.","both/group":"Arc diagram of 12 nodes and 28 edges, arcs within a group go above the line and bridges between groups below. nodes blocked by group, then tidied inside each block: crossings 48 to 40. the blocks themselves are not reordered, so this number is what your grouping costs, not what a layout could do. 3 nodes touch no edge, so they have no barycentre and are held at the end.","both/barycentre":"Arc diagram of 12 nodes and 28 edges, arcs within a group go above the line and bridges between groups below. crossings 48 to 24 (50% fewer) after 48 sweeps, 7 swaps and 0 relocations. 3 nodes touch no edge, so they have no barycentre and are held at the end."}};
  var DEF = {"order":"barycentre","side":"above","labels":true};
  var box = sec.querySelector("svg.ck-ad");
  var note = sec.querySelector(".ck-ad-note");

  function pick(v, list, fallback) {
    for (var i = 0; i < list.length; i++) { if (list[i] === v) { return v; } }
    return fallback;
  }

  function draw(cfg) {
    var ord = pick(cfg.order, MODEL.orders, DEF.order);
    var side = pick(cfg.side, MODEL.sides, DEF.side);
    var key = side + "/" + ord;
    if (note) { note.textContent = MODEL.notes[key]; }
    if (!box || !MODEL.n) { return; }
    var got = arcGeom(MODEL, { order: ord, side: side, labels: cfg.labels !== false });
    paintList(box, got.marks);
    box.setAttribute("viewBox", "0 0 " + got.w + " " + got.h);
    box.style.minWidth = Math.ceil(got.w) + "px";
    box.setAttribute("aria-label", MODEL.arias[key]);
  }

  CK.settings(sec, DEF, draw);
});
