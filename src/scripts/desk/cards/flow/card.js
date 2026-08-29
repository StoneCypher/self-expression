/* flow card: a precomputed sankey model, one shared scale, no layout in the browser. */
CK.build("flow", function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var M = {"W":640,"H":320,"hFloor":130,"minW":484,"nCols":2,"nwMin":4,"nwMax":40,"gapMax":40,"total":38748,"maxSlots":7,"heads":1,"unitSuffix":" lines","label":["structure","work","text","time","quantities","pictures","live","under 700 lines","700 to 1000 lines","over 1000 lines"],"short":["structure","work","text","time","quantities","pictures","live","under 700 lines","700 to 1000 lines","over 1000 lines"],"labW":92.14,"col":[0,0,0,0,0,0,0,1,1,1],"thr":[6601,3235,4897,4510,13044,2215,4246,5502,9492,23754],"leak":[0,0,0,0,0,0,0,0,0,0],"nodeTip":["structure · in 0 lines · out 6.6k lines","work · in 0 lines · out 3.2k lines","text · in 0 lines · out 4.9k lines","time · in 0 lines · out 4.5k lines","quantities · in 0 lines · out 13k lines","pictures · in 0 lines · out 2.2k lines","live · in 0 lines · out 4.2k lines","under 700 lines · in 5.5k lines · out 0 lines","700 to 1000 lines · in 9.5k lines · out 0 lines","over 1000 lines · in 23.8k lines · out 0 lines"],"cols":[{"nodes":[0,4,1,2,6,3,5],"slots":7,"shortfall":0,"shortText":"","head":"by desk group"},{"nodes":[9,8,7],"slots":3,"shortfall":0,"shortText":"","head":"by module size"}],"links":[{"s":0,"t":9,"v":6601,"so":0,"to":0,"hue":"var(--ck-s1)"},{"s":1,"t":9,"v":1090,"so":0,"to":17848,"hue":"var(--ck-s2)"},{"s":1,"t":7,"v":1306,"so":1929,"to":0,"hue":"var(--ck-s2)"},{"s":1,"t":8,"v":839,"so":1090,"to":1797,"hue":"var(--ck-s2)"},{"s":2,"t":7,"v":1014,"so":3883,"to":1306,"hue":"var(--ck-s3)"},{"s":2,"t":9,"v":1372,"so":0,"to":18938,"hue":"var(--ck-s3)"},{"s":2,"t":8,"v":2511,"so":1372,"to":2636,"hue":"var(--ck-s3)"},{"s":3,"t":7,"v":512,"so":3998,"to":3709,"hue":"var(--ck-s4)"},{"s":3,"t":8,"v":1656,"so":2342,"to":6902,"hue":"var(--ck-s4)"},{"s":3,"t":9,"v":2342,"so":0,"to":21412,"hue":"var(--ck-s4)"},{"s":4,"t":9,"v":11247,"so":0,"to":6601,"hue":"var(--ck-s5)"},{"s":4,"t":8,"v":1797,"so":11247,"to":0,"hue":"var(--ck-s5)"},{"s":5,"t":8,"v":934,"so":0,"to":8558,"hue":"var(--ck-s6)"},{"s":5,"t":7,"v":1281,"so":934,"to":4221,"hue":"var(--ck-s6)"},{"s":6,"t":9,"v":1102,"so":0,"to":20310,"hue":"var(--ck-s7)"},{"s":6,"t":8,"v":1755,"so":1102,"to":5147,"hue":"var(--ck-s7)"},{"s":6,"t":7,"v":1389,"so":2857,"to":2320,"hue":"var(--ck-s7)"}],"aria":"Sankey diagram: 38.7k lines moving through 2 stages, across 10 nodes and 17 flows. Every stage carries the whole 38.7k lines, so the ribbons meet their nodes exactly. Ordering the nodes within their columns cut ribbon crossings from 48 to 26."};
  var DEF = {"nodeWidth":14,"gap":8,"curve":0.5,"labels":true};

  var box = sec.querySelector("svg.ck-fl");

  /* One element, attributes set from a plain object. Text goes in with textContent, never
     innerHTML: every label here is data the card did not write. */
  function el(t, a, txt) {
    var e = document.createElementNS(NS, t), k;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function r1(v) { return Math.round(v * 10) / 10; }

  /* A stored setting is a string the viewer could have typed. Clamped rather than trusted, so
     a hand-edited value can make the diagram ugly but never non-finite. */
  function num(v, lo, hi, fallback) {
    var x = Number(v);
    if (!isFinite(x)) { return fallback; }
    if (x < lo) { return lo; }
    if (x > hi) { return hi; }
    return x;
  }

  /* Same idea for the checkbox: JSON round-trips a boolean, but a hand-edited "false" is a
     truthy string and would switch the labels back on. */
  function flag(v, fallback) {
    if (v === true || v === 1) { return true; }
    if (v === false || v === 0) { return false; }
    if (v === "true") { return true; }
    if (v === "false" || v === "") { return false; }
    return fallback;
  }

  function draw(cfg) {
    if (!box) { return; }

    var nw = Math.round(num(cfg.nodeWidth, M.nwMin, M.nwMax, DEF.nodeWidth));
    var gap = Math.round(num(cfg.gap, 0, M.gapMax, DEF.gap));
    var curve = num(cfg.curve, 0, 1, DEF.curve);
    var labels = flag(cfg.labels, DEF.labels);

    var padL = labels ? M.labW + 12 : 8;
    var padR = labels ? M.labW + 12 : 8;
    var padT = 8, padB = 8;
    var headT = labels && M.heads ? 15 : 0;

    var W = M.W;
    var span = W - padL - padR - nw;
    var step = M.nCols > 1 ? span / (M.nCols - 1) : 0;

    /* One scale factor for the whole card. Node heights and ribbon thicknesses both come
       from it, which is the only reason a ribbon can be compared to the bar it lands on. */
    var slack = M.H - padT - padB - headT - (M.maxSlots - 1) * gap;
    var k = M.total > 0 ? slack / M.total : 0;
    var floor = M.total > 0 ? M.hFloor / M.total : 0;
    if (k < floor) { k = floor; }
    var H = padT + padB + headT + M.total * k + (M.maxSlots - 1) * gap;

    function x0(col) { return padL + col * step; }

    /* Every column is drawn to exactly the same quantity -- its nodes plus its stub -- so the
       only thing that differs between columns is how many gaps they need, and that is what is
       centred out. */
    var tops = [], i, j;
    for (i = 0; i < M.cols.length; i++) {
      var slots = M.cols[i].slots;
      tops.push(padT + headT + ((M.maxSlots - slots) * gap) / 2);
    }

    /* Node tops in pixels, walked once so ribbons and bars cannot disagree about them. */
    var top = [];
    for (i = 0; i < M.cols.length; i++) {
      var at = tops[i], col = M.cols[i];
      for (j = 0; j < col.nodes.length; j++) {
        var ni = col.nodes[j];
        top[ni] = at;
        at += M.thr[ni] * k + gap;
      }
      col.stubTop = at;
    }

    var frag = document.createDocumentFragment();

    /* Ribbons first, then bars over them: a ribbon that overshoots its node by half a pixel
       should be hidden by the node, not drawn on top of it. */
    for (i = 0; i < M.links.length; i++) {
      var L = M.links[i];
      var ax = x0(M.col[L.s]) + nw, bx = x0(M.col[L.t]);
      var dx = bx - ax, t = curve * 0.5;
      var c0 = ax + dx * t, c1 = bx - dx * t;
      var ay = top[L.s] + L.so * k, by = top[L.t] + L.to * k;
      var th = L.v * k;
      var d = "M " + r1(ax) + " " + r1(ay) +
              " C " + r1(c0) + " " + r1(ay) + " " + r1(c1) + " " + r1(by) + " " + r1(bx) + " " + r1(by) +
              " L " + r1(bx) + " " + r1(by + th) +
              " C " + r1(c1) + " " + r1(by + th) + " " + r1(c0) + " " + r1(ay + th) + " " + r1(ax) + " " + r1(ay + th) +
              " Z";
      var rib = el("path", { "class": "ribbon", d: d, fill: L.hue, "fill-opacity": 0.34 });
      rib.appendChild(el("title", null,
        M.label[L.s] + " \u2192 " + M.label[L.t] + " \u00b7 " + CK.fmt(L.v) + M.unitSuffix));
      frag.appendChild(rib);
    }

    for (i = 0; i < M.thr.length; i++) {
      var h = M.thr[i] * k;
      if (h <= 0) { continue; }
      var bar = el("rect", { "class": "node", x: r1(x0(M.col[i])), y: r1(top[i]),
                             width: nw, height: r1(h) });
      bar.appendChild(el("title", null, M.nodeTip[i]));
      frag.appendChild(bar);

      /* The leak: the part of the bar no outgoing ribbon reaches, drawn where the ribbons
         actually stop rather than summarised somewhere else on the card. */
      if (M.leak[i] > 0) {
        frag.appendChild(el("rect", { "class": "stub", x: r1(x0(M.col[i])),
                                      y: r1(top[i] + h - M.leak[i] * k),
                                      width: nw, height: r1(M.leak[i] * k) }));
      }
    }

    /* The column stub: what this stage does not carry, so that every column really is drawn
       to the same total and the equality is a fact about the picture rather than a hope. */
    for (i = 0; i < M.cols.length; i++) {
      var sh = M.cols[i].shortfall;
      if (!(sh > 0)) { continue; }
      frag.appendChild(el("rect", { "class": "stub", x: r1(x0(i)), y: r1(M.cols[i].stubTop),
                                    width: nw, height: r1(sh * k) }));
      if (labels) {
        frag.appendChild(el("text", { "class": "short", x: r1(x0(i) + nw / 2),
                                      y: r1(M.cols[i].stubTop + sh * k / 2 + 3),
                                      "text-anchor": "middle", "font-size": 8.5 },
                            M.cols[i].shortText));
      }
    }

    if (labels) {
      for (i = 0; i < M.cols.length; i++) {
        if (M.heads) {
          frag.appendChild(el("text", { "class": "head", x: r1(x0(i) + nw / 2), y: r1(padT + 7),
                                        "text-anchor": "middle", "font-size": 8.5 },
                              M.cols[i].head));
        }
        var nodesIn = M.cols[i].nodes;
        for (j = 0; j < nodesIn.length; j++) {
          var q = nodesIn[j];
          if (!(M.thr[q] > 0)) { continue; }
          /* The first column's labels go outside on the left, into the margin reserved for
             them; every other column's go to the right of its bar. A middle column's label
             lies over the ribbons leaving it, which is what every sankey does and is why the
             labels are ink rather than a hue -- they have to read over colour. */
          var first = i === 0;
          var tx = first ? x0(i) - 6 : x0(i) + nw + 6;
          var anchor = first ? "end" : "start";
          var lab = el("text", { "class": "lab", x: r1(tx),
                                 y: r1(top[q] + M.thr[q] * k / 2 + 3),
                                 "text-anchor": anchor, "font-size": 9 }, M.short[q]);
          lab.appendChild(el("title", null, M.nodeTip[q]));
          frag.appendChild(lab);
        }
      }
    }

    while (box.firstChild) { box.removeChild(box.firstChild); }
    box.appendChild(frag);
    box.setAttribute("viewBox", "0 0 " + r1(W) + " " + r1(H));
    box.setAttribute("aria-label", M.aria);
    /* Below this the picture stops being readable, so the scroll box scrolls instead of the
       ribbons collapsing into lines. The desk column never widens either way. */
    box.style.minWidth = M.minW + "px";
  }

  CK.settings(sec, DEF, draw);
});
