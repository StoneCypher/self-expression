/* matrix card: four precomputed orderings, one grid, no seriation in the browser. */
CK.build("matrix", function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var M = {"nR":41,"nC":12,"cellMin":9,"cellMax":28,"rowLab":["agentboard","arc","audit","boxplot","candles","chart","choice","chord","clock","code","countdown","diff","flow","formula","graph","heatmap","histogram","icicle","image","ledger","logtail","map","markdown","matrix","molecule","news","note","parallel","portfolio","rail","ribbon","rss","snippet","sunburst","table","ticker","timer","treemap","violin","waterfall","weather"],"colLab":["CK.esc","CK.svg","CK.hue","CK.scale","CK.ticks","CK.fmt","CK.once","CK.spin","CK.timer","CK.settings","CK.net","CK.build"],"rowClip":["agentboard","arc","audit","boxplot","candles","chart","choice","chord","clock","code","countdown","diff","flow","formula","graph","heatmap","histogram","icicle","image","ledger","logtail","map","markdown","matrix","molecule","news","note","parallel","portfolio","rail","ribbon","rss","snippet","sunburst","table","ticker","timer","treemap","violin","waterfall","weather"],"colClip":["CK.esc","CK.svg","CK.hue","CK.scale","CK.ticks","CK.fmt","CK.once","CK.spin","CK.timer","CK.settings","CK.net","CK.build"],"rowDeg":["4","6","5","7","8","7","4","5","4","4","5","4","5","5","6","4","7","5","4","4","6","5","1","6","3","3","5","7","5","4","7","3","4","5","5","7","5","5","7","8","7"],"colDeg":["38","2","18","14","8","20","19","2","10","37","3","40"],"accent":[0,0,0,0,0,0,0,0,1,0,1,0],"rowLabW":54.2,"colLabW":59.62,"rowDegW":5.42,"colDegW":10.84,"cells":[[0,0,1,null],[0,8,1,null],[0,9,1,null],[0,11,1,null],[1,0,1,null],[1,2,1,null],[1,3,1,null],[1,5,1,null],[1,9,1,null],[1,11,1,null],[2,0,1,null],[2,6,1,null],[2,8,1,null],[2,9,1,null],[2,11,1,null],[3,0,1,null],[3,2,1,null],[3,3,1,null],[3,4,1,null],[3,5,1,null],[3,9,1,null],[3,11,1,null],[4,0,1,null],[4,2,1,null],[4,3,1,null],[4,4,1,null],[4,5,1,null],[4,8,1,null],[4,9,1,null],[4,11,1,null],[5,0,1,null],[5,2,1,null],[5,3,1,null],[5,4,1,null],[5,5,1,null],[5,6,1,null],[5,11,1,null],[6,0,1,null],[6,6,1,null],[6,9,1,null],[6,11,1,null],[7,0,1,null],[7,2,1,null],[7,5,1,null],[7,9,1,null],[7,11,1,null],[8,0,1,null],[8,7,1,null],[8,9,1,null],[8,11,1,null],[9,0,1,null],[9,6,1,null],[9,9,1,null],[9,11,1,null],[10,0,1,null],[10,6,1,null],[10,8,1,null],[10,9,1,null],[10,11,1,null],[11,0,1,null],[11,6,1,null],[11,9,1,null],[11,11,1,null],[12,0,1,null],[12,2,1,null],[12,5,1,null],[12,9,1,null],[12,11,1,null],[13,0,1,null],[13,6,1,null],[13,8,1,null],[13,9,1,null],[13,11,1,null],[14,0,1,null],[14,2,1,null],[14,3,1,null],[14,5,1,null],[14,6,1,null],[14,11,1,null],[15,0,1,null],[15,5,1,null],[15,9,1,null],[15,11,1,null],[16,0,1,null],[16,2,1,null],[16,3,1,null],[16,4,1,null],[16,5,1,null],[16,9,1,null],[16,11,1,null],[17,0,1,null],[17,2,1,null],[17,5,1,null],[17,9,1,null],[17,11,1,null],[18,0,1,null],[18,6,1,null],[18,9,1,null],[18,11,1,null],[19,0,1,null],[19,6,1,null],[19,9,1,null],[19,11,1,null],[20,0,1,null],[20,6,1,null],[20,8,1,null],[20,9,1,null],[20,10,1,null],[20,11,1,null],[21,0,1,null],[21,3,1,null],[21,5,1,null],[21,9,1,null],[21,11,1,null],[22,0,1,null],[23,0,1,null],[23,2,1,null],[23,3,1,null],[23,5,1,null],[23,9,1,null],[23,11,1,null],[24,6,1,null],[24,7,1,null],[24,11,1,null],[25,9,1,null],[25,10,1,null],[25,11,1,null],[26,0,1,null],[26,6,1,null],[26,8,1,null],[26,9,1,null],[26,11,1,null],[27,0,1,null],[27,2,1,null],[27,3,1,null],[27,4,1,null],[27,5,1,null],[27,9,1,null],[27,11,1,null],[28,0,1,null],[28,2,1,null],[28,5,1,null],[28,9,1,null],[28,11,1,null],[29,0,1,null],[29,6,1,null],[29,9,1,null],[29,11,1,null],[30,0,1,null],[30,2,1,null],[30,3,1,null],[30,4,1,null],[30,5,1,null],[30,9,1,null],[30,11,1,null],[31,2,1,null],[31,9,1,null],[31,11,1,null],[32,0,1,null],[32,6,1,null],[32,9,1,null],[32,11,1,null],[33,0,1,null],[33,2,1,null],[33,5,1,null],[33,9,1,null],[33,11,1,null],[34,0,1,null],[34,5,1,null],[34,6,1,null],[34,9,1,null],[34,11,1,null],[35,0,1,null],[35,1,1,null],[35,3,1,null],[35,6,1,null],[35,8,1,null],[35,9,1,null],[35,11,1,null],[36,0,1,null],[36,6,1,null],[36,8,1,null],[36,9,1,null],[36,11,1,null],[37,0,1,null],[37,2,1,null],[37,5,1,null],[37,9,1,null],[37,11,1,null],[38,0,1,null],[38,2,1,null],[38,3,1,null],[38,4,1,null],[38,5,1,null],[38,9,1,null],[38,11,1,null],[39,0,1,null],[39,2,1,null],[39,3,1,null],[39,4,1,null],[39,5,1,null],[39,8,1,null],[39,9,1,null],[39,11,1,null],[40,0,1,null],[40,1,1,null],[40,3,1,null],[40,6,1,null],[40,9,1,null],[40,10,1,null],[40,11,1,null]],"groups":[{"s":1,"rows":[23,14,1,12,7]},{"s":2,"rows":[19,29,6,34]},{"s":3,"rows":[22,9,11,32,13,26]},{"s":4,"rows":[8,10,36,30,15]},{"s":5,"rows":[5,16,3,38,27,35,4,28,39,37,33,17]},{"s":6,"rows":[18,21,24]},{"s":7,"rows":[0,2,20,25,31,40]}],"labels":{"both":1,"rows":1,"none":1},"modes":{"both":{"rows":[14,5,3,16,27,30,38,1,23,4,39,21,7,12,17,28,33,37,31,22,15,34,6,9,11,18,19,29,32,40,35,0,2,10,13,26,36,20,25,8,24],"cols":[4,3,2,5,0,9,11,6,8,1,10,7],"note":"both axes seriated: 3 sweeps, converged; 5 swaps and 4 relocations. adjacency cost 383 to 141, down 63%. the 7 row groups came out in 26 runs.","aria":"Incidence matrix, 41 rows by 12 columns, 211 of 492 cells filled (43%), binary. Both axes seriated. 3 sweeps, converged; 5 swaps and 4 relocations. adjacency cost 383 to 141, down 63%. the 7 row groups came out in 26 runs."},"rows":{"rows":[14,5,3,16,27,30,38,1,23,4,39,7,12,17,28,33,37,21,35,40,34,15,8,22,6,9,11,18,19,29,32,2,10,13,26,36,20,0,31,25,24],"cols":[0,1,2,3,4,5,6,7,8,9,10,11],"note":"rows seriated, columns left alone: 1 sweep, converged; 4 swaps and 2 relocations. adjacency cost 383 to 289, down 25%. the 7 row groups came out in 25 runs.","aria":"Incidence matrix, 41 rows by 12 columns, 211 of 492 cells filled (43%), binary. Rows seriated, columns left alone. 1 sweep, converged; 4 swaps and 2 relocations. adjacency cost 383 to 289, down 25%. the 7 row groups came out in 25 runs."},"cols":{"rows":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40],"cols":[6,8,7,4,2,5,0,11,9,3,1,10],"note":"columns seriated, rows left alone: 1 sweep, converged; 3 swaps and 4 relocations. adjacency cost 383 to 255, down 33%. the 7 row groups came out in 35 runs.","aria":"Incidence matrix, 41 rows by 12 columns, 211 of 492 cells filled (43%), binary. Columns seriated, rows left alone. 1 sweep, converged; 3 swaps and 4 relocations. adjacency cost 383 to 255, down 33%. the 7 row groups came out in 35 runs."},"none":{"rows":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40],"cols":[0,1,2,3,4,5,6,7,8,9,10,11],"note":"given order kept: the 7 row groups came out in 35 runs.","aria":"Incidence matrix, 41 rows by 12 columns, 211 of 492 cells filled (43%), binary. Given order kept. the 7 row groups came out in 35 runs."}}};
  var DEF = {"seriate":"both","labels":"both","cell":14};

  /* Both may be absent: a matrix with no rows or no columns draws nothing and says so in
     markup instead. The script still runs, because the gear and its panel are wired by
     CK.settings and a card whose settings silently stopped opening would be a worse bug than
     an empty matrix. */
  var box = sec.querySelector("svg.ck-mx");
  var note = sec.querySelector(".ck-mx-note");

  /* One element, attributes set from a plain object. Text goes in with textContent, never
     innerHTML: every label here is data the card did not write. */
  function el(t, a, txt) {
    var e = document.createElementNS(NS, t), k;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function r1(v) { return Math.round(v * 10) / 10; }

  /* A setting out of localStorage is a string the viewer could have typed. Checked against
     the allowed list by hasOwn rather than by lookup, so "constructor" cannot select a plan
     off Object.prototype. */
  function pick(v, table, fallback) {
    return typeof v === "string" && Object.hasOwn(table, v) ? v : fallback;
  }

  function draw(cfg) {
    var mode = pick(cfg.seriate, M.modes, DEF.seriate);
    var lab = pick(cfg.labels, M.labels, DEF.labels);
    if (note) { note.textContent = M.modes[mode].note; }
    if (!box || !M.nR || !M.nC) { return; }

    var cell = Math.round(Number(cfg.cell));
    if (!isFinite(cell)) { cell = DEF.cell; }
    if (cell < M.cellMin) { cell = M.cellMin; }
    if (cell > M.cellMax) { cell = M.cellMax; }

    var P = M.modes[mode];
    var showRows = lab !== "none";
    var showCols = lab === "both";

    var gutL = showRows ? M.rowLabW + 12 : 6;
    var gutR = showRows ? M.rowDegW + 10 : 6;
    var headT = showCols ? M.colLabW + 8 : 6;
    var footB = showCols ? M.colDegW + 8 : 6;

    var nR = M.nR, nC = M.nC;
    var W = gutL + nC * cell + gutR;
    var H = headT + nR * cell + footB;

    /* Row labels are stacked one per cell, so their size is bounded by the cell and not the
       other way round. Nine and a half is the face's comfortable size; below that the text
       shrinks with the grid rather than overlapping it, and it never goes under seven. */
    var fs = Math.max(7, Math.min(9.5, cell - 3.5));
    var side = Math.max(3, cell - 3.5);

    var rpos = [], cpos = [], i, k;
    for (i = 0; i < P.rows.length; i++) { rpos[P.rows[i]] = i; }
    for (i = 0; i < P.cols.length; i++) { cpos[P.cols[i]] = i; }

    function cx(j) { return gutL + j * cell + cell / 2; }
    function cy(j) { return headT + j * cell + cell / 2; }

    var frag = document.createDocumentFragment();

    /* Alternating band first, then the flagged-column wash, then the squares. Order is the
       whole z-stack: SVG has no z-index and the last thing appended is the thing on top. */
    for (i = 0; i < nR; i += 2) {
      frag.appendChild(el("rect", { "class": "band", x: gutL, y: r1(headT + i * cell),
                                    width: nC * cell, height: cell }));
    }

    for (i = 0; i < nC; i++) {
      if (!M.accent[P.cols[i]]) { continue; }
      frag.appendChild(el("rect", { "class": "wash", x: r1(cx(i) - cell / 2), y: 0,
                                    width: cell, height: r1(H) }));
    }

    for (i = 0; i < M.cells.length; i++) {
      var c = M.cells[i];
      var x = cx(cpos[c[1]]), y = cy(rpos[c[0]]);
      var sq = el("rect", { "class": "cell", x: r1(x - side / 2), y: r1(y - side / 2),
                            width: r1(side), height: r1(side),
                            "fill-opacity": c[2] });
      sq.appendChild(el("title", null,
        M.rowLab[c[0]] + " \u00b7 " + M.colLab[c[1]] + (c[3] == null ? "" : " \u00b7 " + CK.fmt(c[3]))));
      frag.appendChild(sq);
    }

    frag.appendChild(el("line", { "class": "rule", x1: gutL, y1: r1(headT - 0.5),
                                  x2: r1(gutL + nC * cell), y2: r1(headT - 0.5) }));
    frag.appendChild(el("line", { "class": "rule", x1: gutL, y1: r1(headT + nR * cell + 0.5),
                                  x2: r1(gutL + nC * cell), y2: r1(headT + nR * cell + 0.5) }));

    if (showRows) {
      for (i = 0; i < nR; i++) {
        var ri = P.rows[i], ry = r1(cy(i) + fs * 0.35);
        frag.appendChild(el("text", { "class": "ax", x: r1(gutL - 9), y: ry,
                                      "text-anchor": "end", "font-size": r1(fs) },
                            M.rowClip[ri]));
        frag.appendChild(el("text", { "class": "axf", x: r1(W - 3), y: ry,
                                      "text-anchor": "end", "font-size": r1(fs) },
                            M.rowDeg[ri]));
      }
      /* Group tabs ride in the gutter between the label and the grid. They are an annotation
         the seriation was never told about, so a group that comes out as one run is a real
         result rather than a restatement of the input. */
      for (i = 0; i < M.groups.length; i++) {
        var g = M.groups[i];
        for (k = 0; k < g.rows.length; k++) {
          frag.appendChild(el("rect", { "class": "grp", "data-s": g.s,
                                        x: r1(gutL - 5), y: r1(headT + rpos[g.rows[k]] * cell + 1),
                                        width: 3, height: r1(cell - 2) }));
        }
      }
    }

    if (showCols) {
      for (i = 0; i < nC; i++) {
        var ci = P.cols[i], tx = r1(cx(i) + fs * 0.35), ty = r1(headT - 6);
        var t = el("text", { "class": M.accent[ci] ? "ax" : "axf", x: tx, y: ty,
                             "text-anchor": "start", "font-size": r1(fs),
                             transform: "rotate(-90 " + tx + " " + ty + ")" }, M.colClip[ci]);
        t.appendChild(el("title", null, M.colLab[ci]));
        frag.appendChild(t);

        var by = r1(headT + nR * cell + 6);
        frag.appendChild(el("text", { "class": "axf", x: tx, y: by, "text-anchor": "end",
                                      "font-size": r1(fs),
                                      transform: "rotate(-90 " + tx + " " + by + ")" },
                            M.colDeg[ci]));
      }
    }

    while (box.firstChild) { box.removeChild(box.firstChild); }
    box.appendChild(frag);
    box.setAttribute("viewBox", "0 0 " + r1(W) + " " + r1(H));
    box.setAttribute("aria-label", P.aria);
    /* The cells keep the size that was asked for: below this width the scroll container
       scrolls rather than the squares shrinking. Above it the matrix scales up, which is
       harmless -- a bigger square is still a square. */
    box.style.minWidth = Math.ceil(W) + "px";
  }

  CK.settings(sec, DEF, draw);
});
