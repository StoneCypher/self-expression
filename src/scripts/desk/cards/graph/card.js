/* graph card: draws coordinates that were computed when the card was built.
   Nothing is simulated here. That is the point — a force layout that ran on load would
   settle somewhere slightly different every time, and a diagram that is not the same
   diagram twice is not a picture anyone can point at. */
CK.build("graph", function (sec) {

  var NS = "http://www.w3.org/2000/svg";
  var MARKS = [{"t":"defs","kids":[{"t":"marker","a":{"id":"graph-arrow","viewBox":"0 0 10 10","refX":"9.5","refY":"5","markerWidth":"7","markerHeight":"7","markerUnits":"userSpaceOnUse","orient":"auto"},"kids":[{"t":"path","a":{"d":"M 0 0 L 10 5 L 0 10 z","class":"ck-arw"}}]}]},{"t":"g","a":{"class":"ck-edges"},"kids":[{"t":"path","a":{"d":"M 239.31 59.5 L 239.31 107","class":"ck-edge","data-e":"0","fill":"none","stroke-width":3.4,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"CONTRACT.md → types/*.mjs · 3"},{"t":"path","a":{"d":"M 160.63 58.52 L 229.07 112","class":"ck-edge","data-e":"1","fill":"none","stroke-width":2.15,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"kit.js → types/*.mjs · 2"},{"t":"path","a":{"d":"M 233.38 129.27 L 204.09 175.05","class":"ck-edge","data-e":"2","fill":"none","stroke-width":3.4,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"types/*.mjs → newcard.mjs · 3"},{"t":"path","a":{"d":"M 245.24 129.27 Q 281.54 186 318.74 244.14","class":"ck-edge","data-e":"3","fill":"none","stroke-width":2.15,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"types/*.mjs → check.mjs · 2"},{"t":"path","a":{"d":"M 191.15 195.27 L 159.88 244.14","class":"ck-edge","data-e":"4","fill":"none","stroke-width":2.15,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"newcard.mjs → adopt.mjs · 2"},{"t":"path","a":{"d":"M 206.84 191.08 L 315.49 247.69","class":"ck-edge","data-e":"5","fill":"none","stroke-width":0.9,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"newcard.mjs → check.mjs · 1"},{"t":"path","a":{"d":"M 160.63 256.52 L 230.51 311.12","class":"ck-edge","data-e":"6","fill":"none","stroke-width":3.4,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"adopt.mjs → cards/\u003cid\u003e/ · 3"},{"t":"path","a":{"d":"M 203.01 195.27 Q 239.31 252 239.31 306.83","class":"ck-edge","data-e":"7","fill":"none","stroke-width":2.15,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"newcard.mjs → cards/\u003cid\u003e/ · 2"},{"t":"path","a":{"d":"M 244.25 325.72 L 275.52 374.59","class":"ck-edge","data-e":"8","fill":"none","stroke-width":3.4,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"cards/\u003cid\u003e/ → deskcards.mjs · 3"},{"t":"path","a":{"d":"M 323.77 59.5 Q 323.77 120 344.89 153 Q 366 186 387.12 219 Q 408.23 252 366 285 Q 323.77 318 287.56 374.59","class":"ck-edge","data-e":"9","fill":"none","stroke-width":2.15,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"desk-shell → deskcards.mjs · 2"},{"t":"path","a":{"d":"M 281.54 393.17 L 281.54 437","class":"ck-edge","data-e":"10","fill":"none","stroke-width":3.4,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"deskcards.mjs → panel.mjs · 3"},{"t":"path","a":{"d":"M 154.85 61.33 Q 154.85 120 133.74 153 Q 112.62 186 91.51 219 Q 70.39 252 112.62 285 Q 154.85 318 175.97 351 Q 197.08 384 271.3 442","class":"ck-edge","data-e":"11","fill":"none","stroke-width":2.15,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"kit.js → panel.mjs · 2"},{"t":"path","a":{"d":"M 408.23 59.5 Q 408.23 120 429.35 153 Q 450.46 186 471.58 219 Q 492.69 252 450.46 285 Q 408.23 318 387.12 351 Q 366 384 291.78 442","class":"ck-edge","data-e":"12","fill":"none","stroke-width":2.15,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"kit.css → panel.mjs · 2"},{"t":"path","a":{"d":"M 290.21 456.77 L 357.2 509.12","class":"ck-edge","data-e":"13","fill":"none","stroke-width":3.4,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"panel.mjs → GET /desk · 3"},{"t":"path","a":{"d":"M 492.69 59.5 Q 492.69 120 513.8 153 Q 534.92 186 556.04 219 Q 577.15 252 534.92 285 Q 492.69 318 471.58 351 Q 450.46 384 408.23 417 Q 366 450 366 504.83","class":"ck-edge","data-e":"14","fill":"none","stroke-width":0.9,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"/net proxy → GET /desk · 1"},{"t":"path","a":{"d":"M 577.15 59.5 Q 577.15 120 598.27 153 Q 619.38 186 640.49 219 Q 661.61 252 619.38 285 Q 577.15 318 556.04 351 Q 534.92 384 492.69 417 Q 450.46 450 374.8 509.12","class":"ck-edge","data-e":"15","fill":"none","stroke-width":0.9,"stroke-linecap":"round","marker-end":"url(#graph-arrow)"},"ti":"/tail → GET /desk · 1"}]},{"t":"g","a":{"class":"ck-nodes"},"kids":[{"t":"g","a":{"class":"ck-node","data-n":"0"},"kids":[{"t":"circle","a":{"cx":239.31,"cy":54,"r":5.5,"fill":"var(--ck-s1)","class":"ck-disc"}}],"ti":"CONTRACT.md · catalogue · 1 connection"},{"t":"g","a":{"class":"ck-node","data-n":"1"},"kids":[{"t":"circle","a":{"cx":239.31,"cy":120,"r":11,"fill":"var(--ck-s1)","class":"ck-disc"}}],"ti":"types/*.mjs · catalogue · 4 connections"},{"t":"g","a":{"class":"ck-node","data-n":"2"},"kids":[{"t":"circle","a":{"cx":154.85,"cy":54,"r":7.33,"fill":"var(--ck-s1)","class":"ck-disc"}}],"ti":"kit.js · catalogue · 2 connections"},{"t":"g","a":{"class":"ck-node","data-n":"3"},"kids":[{"t":"circle","a":{"cx":408.23,"cy":54,"r":5.5,"fill":"var(--ck-s1)","class":"ck-disc"}}],"ti":"kit.css · catalogue · 1 connection"},{"t":"g","a":{"class":"ck-node","data-n":"4"},"kids":[{"t":"circle","a":{"cx":197.08,"cy":186,"r":11,"fill":"var(--ck-s1)","class":"ck-disc"}}],"ti":"newcard.mjs · catalogue · 4 connections"},{"t":"g","a":{"class":"ck-node","data-n":"5"},"kids":[{"t":"circle","a":{"cx":323.77,"cy":252,"r":7.33,"fill":"var(--ck-s1)","class":"ck-disc"}}],"ti":"check.mjs · catalogue · 2 connections"},{"t":"g","a":{"class":"ck-node","data-n":"6"},"kids":[{"t":"circle","a":{"cx":154.85,"cy":252,"r":7.33,"fill":"var(--ck-s1)","class":"ck-disc"}}],"ti":"adopt.mjs · catalogue · 2 connections"},{"t":"g","a":{"class":"ck-node","data-n":"7"},"kids":[{"t":"circle","a":{"cx":239.31,"cy":318,"r":9.17,"fill":"var(--ck-s2)","class":"ck-disc"}}],"ti":"cards/\u003cid\u003e/ · deck · 3 connections"},{"t":"g","a":{"class":"ck-node","data-n":"8"},"kids":[{"t":"circle","a":{"cx":281.54,"cy":384,"r":9.17,"fill":"var(--ck-s3)","class":"ck-disc"}}],"ti":"deskcards.mjs · server · 3 connections"},{"t":"g","a":{"class":"ck-node","data-n":"9"},"kids":[{"t":"circle","a":{"cx":323.77,"cy":54,"r":5.5,"fill":"var(--ck-s3)","class":"ck-disc"}}],"ti":"desk-shell · server · 1 connection"},{"t":"g","a":{"class":"ck-node","data-n":"10"},"kids":[{"t":"circle","a":{"cx":281.54,"cy":450,"r":11,"fill":"var(--ck-s3)","class":"ck-disc"}}],"ti":"panel.mjs · server · 4 connections"},{"t":"g","a":{"class":"ck-node","data-n":"11"},"kids":[{"t":"circle","a":{"cx":366,"cy":516,"r":9.17,"fill":"var(--ck-s4)","class":"ck-disc"}}],"ti":"GET /desk · browser · 3 connections"},{"t":"g","a":{"class":"ck-node","data-n":"12"},"kids":[{"t":"circle","a":{"cx":492.69,"cy":54,"r":5.5,"fill":"var(--ck-s3)","class":"ck-disc"}}],"ti":"/net proxy · server · 1 connection"},{"t":"g","a":{"class":"ck-node","data-n":"13"},"kids":[{"t":"circle","a":{"cx":577.15,"cy":54,"r":5.5,"fill":"var(--ck-s3)","class":"ck-disc"}}],"ti":"/tail · server · 1 connection"}]},{"t":"g","a":{"class":"ck-labels"},"kids":[{"t":"rect","a":{"x":207.5,"y":63,"width":63.62,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":239.31,"y":70.5,"class":"ck-lab","text-anchor":"middle","data-n":"0"},"s":"CONTRACT.md"},{"t":"rect","a":{"x":207.5,"y":134.5,"width":63.62,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":239.31,"y":142,"class":"ck-lab","text-anchor":"middle","data-n":"1"},"s":"types/*.mjs"},{"t":"rect","a":{"x":136.59,"y":64.83,"width":36.52,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":154.85,"y":72.33,"class":"ck-lab","text-anchor":"middle","data-n":"2"},"s":"kit.js"},{"t":"rect","a":{"x":387.26,"y":63,"width":41.94,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":408.23,"y":70.5,"class":"ck-lab","text-anchor":"middle","data-n":"3"},"s":"kit.css"},{"t":"rect","a":{"x":165.27,"y":200.5,"width":63.62,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":197.08,"y":208,"class":"ck-lab","text-anchor":"middle","data-n":"4"},"s":"newcard.mjs"},{"t":"rect","a":{"x":297.38,"y":262.83,"width":52.78,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":323.77,"y":270.33,"class":"ck-lab","text-anchor":"middle","data-n":"5"},"s":"check.mjs"},{"t":"rect","a":{"x":128.46,"y":262.83,"width":52.78,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":154.85,"y":270.33,"class":"ck-lab","text-anchor":"middle","data-n":"6"},"s":"adopt.mjs"},{"t":"rect","a":{"x":207.5,"y":330.67,"width":63.62,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":239.31,"y":338.17,"class":"ck-lab","text-anchor":"middle","data-n":"7"},"s":"cards/\u003cid\u003e/"},{"t":"rect","a":{"x":244.31,"y":396.67,"width":74.46,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":281.54,"y":404.17,"class":"ck-lab","text-anchor":"middle","data-n":"8"},"s":"deskcards.mjs"},{"t":"rect","a":{"x":294.67,"y":63,"width":58.2,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":323.77,"y":70.5,"class":"ck-lab","text-anchor":"middle","data-n":"9"},"s":"desk-shell"},{"t":"rect","a":{"x":255.15,"y":464.5,"width":52.78,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":281.54,"y":472,"class":"ck-lab","text-anchor":"middle","data-n":"10"},"s":"panel.mjs"},{"t":"rect","a":{"x":339.61,"y":528.67,"width":52.78,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":366,"y":536.17,"class":"ck-lab","text-anchor":"middle","data-n":"11"},"s":"GET /desk"},{"t":"rect","a":{"x":463.59,"y":63,"width":58.2,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":492.69,"y":70.5,"class":"ck-lab","text-anchor":"middle","data-n":"12"},"s":"/net proxy"},{"t":"rect","a":{"x":561.6,"y":63,"width":31.1,"height":10.5,"rx":"2","class":"ck-plate"}},{"t":"text","a":{"x":577.15,"y":70.5,"class":"ck-lab","text-anchor":"middle","data-n":"13"},"s":"/tail"}]}];
  var ADJ = [[0],[0,1,2,3],[1,11],[12],[2,4,5,7],[3,5],[4,6],[6,7,8],[8,9,10],[9],[10,11,12,13],[13,14,15],[14],[15]];

  var plot = sec.querySelector("svg.ck-plot");
  if (!plot) { return; }

  /* One display-list entry as a real element. Attribute names are the SVG ones, so this
     stays a translator rather than a second place where layout decisions live. */
  function node(m) {
    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;
    if (a) { for (k in a) { if (Object.hasOwn(a, k) && a[k] != null) { e.setAttribute(k, a[k]); } } }
    if (m.s != null) { e.textContent = m.s; }
    if (m.ti != null) {
      tip = document.createElementNS(NS, "title");
      tip.textContent = m.ti;
      e.appendChild(tip);
    }
    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }
    return e;
  }

  function render() {
    var i;
    while (plot.firstChild) { plot.removeChild(plot.firstChild); }
    for (i = 0; i < MARKS.length; i++) { plot.appendChild(node(MARKS[i])); }
    lit = -1;                      // the elements the last highlight referred to are gone
  }

  /* Pull one node's edges out of the mesh. A node in a dense diagram is a dot among dots;
     the question a reader actually has is what it touches, and dimming everything else is
     the cheapest honest answer to it. Nodes are addressed by index rather than by id, so no
     label text can end up inside a selector. */
  var lit = -1;

  function light(k) {
    var was, i, list, el;
    if (k === lit) { return; }
    lit = k;

    was = plot.querySelectorAll(".on");
    for (i = 0; i < was.length; i++) { was[i].classList.remove("on"); }
    if (k < 0 || !ADJ[k]) { plot.classList.remove("hi"); return; }

    plot.classList.add("hi");
    el = plot.querySelector('.ck-node[data-n="' + k + '"]');
    if (el) { el.classList.add("on"); }
    list = ADJ[k];
    for (i = 0; i < list.length; i++) {
      el = plot.querySelector('.ck-edge[data-e="' + list[i] + '"]');
      if (el) { el.classList.add("on"); }
    }
  }

  render();

  /* Two delegated listeners, guarded by CK.once: a <main> swap gives us a fresh section and
     wires it once; a replay on the same section wires nothing twice. */
  CK.once(sec, "graphhover", function () {
    plot.addEventListener("mousemove", function (ev) {
      var g = ev.target && ev.target.closest ? ev.target.closest("[data-n]") : null;
      light(g ? Number(g.getAttribute("data-n")) : -1);
    });
    plot.addEventListener("mouseleave", function () { light(-1); });
  });
});
