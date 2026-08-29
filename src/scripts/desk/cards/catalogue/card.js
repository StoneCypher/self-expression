(function () {
  /* Natural ordering for text: "item10" after "item2", and case is not a distinction worth
     reordering rows over. */
  var CK_T_TEXT = { numeric: true, sensitivity: "base" };

  function ckKeyNum(k) {
    if (k === null || k === undefined) return NaN;
    var s = String(k);
    if (s === "") return NaN;
    return Number(s);
  }

  function ckMakeCmp(type, dir, keyAt) {
    var numeric = type === "number" || type === "bar" || type === "date" || type === "bool";
    return function (a, b) {
      var r = 0;
      if (dir !== 0) {
        var ka = keyAt(a), kb = keyAt(b);
        if (numeric) {
          var x = ckKeyNum(ka), y = ckKeyNum(kb);
          var xb = !isFinite(x), yb = !isFinite(y);
          /* Blanks sink in both directions: absent is not small. Returned before the
             direction multiplier so reversing cannot lift them. */
          if (xb || yb) return xb && yb ? a.i - b.i : (xb ? 1 : -1);
          r = x < y ? -1 : (x > y ? 1 : 0);
        } else {
          var sa = ka === null || ka === undefined ? "" : String(ka);
          var sb = kb === null || kb === undefined ? "" : String(kb);
          if (sa === "" || sb === "") {
            if (sa === "" && sb === "") return a.i - b.i;
            return sa === "" ? 1 : -1;
          }
          r = sa.localeCompare(sb, undefined, CK_T_TEXT);
        }
        r = r * dir;
      }
      /* The stability guarantee, made explicit rather than borrowed from the engine. */
      return r !== 0 ? r : a.i - b.i;
    };
  }

  CK.build("catalogue", function (sec) {
    var table = sec.querySelector("table.ck-t");
    if (!table || !table.tHead || !table.tBodies[0]) return;

    var tbody   = table.tBodies[0];
    var headRow = table.tHead.rows[0];
    var tools   = sec.querySelector(".ck-t-tools");
    var find    = sec.querySelector(".ck-t-find");
    var pager   = sec.querySelector(".ck-t-page");
    var ofEl    = sec.querySelector(".ck-t-of");
    var prev    = sec.querySelector(".ck-t-prev");
    var next    = sec.querySelector(".ck-t-next");
    var countEl = sec.querySelector(".ck-t-count");
    var noneRow = tbody.querySelector(".ck-t-none");

    /* Captured once, in source order. The index is what the third click on a header
       restores, and what every tie in the comparator falls back to. */
    var items = [], all = tbody.rows, i;
    for (i = 0; i < all.length; i++) {
      if (all[i].className.indexOf("ck-t-none") >= 0) continue;
      items.push({ tr: all[i], i: items.length, hay: null });
    }

    var state = { col: -1, dir: 0, q: "", per: 0, at: 0 };

    function keyAt(it) {
      var td = it.tr.cells[state.col];
      if (!td) return "";
      var s = td.getAttribute("data-s");
      return s === null ? td.textContent : s;
    }

    /* Built once per row and kept: the filter runs on every keystroke across every row and
       every column, and re-reading textContent for that is the difference between a table
       that types smoothly and one that stutters at a few hundred rows. */
    function hay(it) {
      if (it.hay === null) {
        var out = [], cs = it.tr.cells, k;
        for (k = 0; k < cs.length; k++) {
          var q = cs[k].getAttribute("data-q");
          out.push(q === null ? cs[k].textContent.toLowerCase() : q);
        }
        it.hay = out;
      }
      return it.hay;
    }

    function hit(it, q) {
      var h = hay(it), k;
      for (k = 0; k < h.length; k++) if (h[k].indexOf(q) >= 0) return true;
      return false;
    }

    function typeOf(ci) {
      var th = headRow.cells[ci];
      return th ? (th.getAttribute("data-type") || "text") : "text";
    }

    function marks() {
      var k;
      for (k = 0; k < headRow.cells.length; k++) {
        var th = headRow.cells[k];
        var dir = k === state.col ? state.dir : 0;
        th.setAttribute("aria-sort", dir === 1 ? "ascending" : dir === -1 ? "descending" : "none");
      }
    }

    function apply() {
      var k, order = items.slice(0);
      order.sort(ckMakeCmp(typeOf(state.col), state.dir, keyAt));

      var pass = [];
      for (k = 0; k < order.length; k++) {
        if (state.q === "" || hit(order[k], state.q)) pass.push(order[k].tr);
        else order[k].tr.hidden = true;
      }

      var per   = state.per > 0 ? state.per : pass.length;
      var pages = per > 0 ? Math.ceil(pass.length / per) : 1;
      if (pages < 1) pages = 1;
      if (state.at >= pages) state.at = pages - 1;
      if (state.at < 0) state.at = 0;
      var from = state.at * per, to = per > 0 ? from + per : pass.length;
      for (k = 0; k < pass.length; k++) pass[k].hidden = k < from || k >= to;

      /* One reflow: every row is moved into a fragment in its new order and the fragment
         goes back in one call, rather than the table relaying out once per row. */
      var frag = document.createDocumentFragment();
      for (k = 0; k < order.length; k++) frag.appendChild(order[k].tr);
      tbody.insertBefore(frag, noneRow);
      if (noneRow) noneRow.hidden = pass.length !== 0;

      if (pager) {
        pager.hidden = state.per <= 0 || pass.length <= state.per;
        if (prev) prev.disabled = state.at <= 0;
        if (next) next.disabled = state.at >= pages - 1;
        if (ofEl) ofEl.textContent = pass.length === 0 ? "nothing to show"
          : (from + 1) + "\u2013" + Math.min(to, pass.length) + " of " + pass.length;
      }
      if (countEl) countEl.textContent = pass.length === items.length
        ? items.length + (items.length === 1 ? " row" : " rows")
        : pass.length + " of " + items.length + " rows";
    }

    /* Delegated, so the listener count does not track the column count. */
    CK.once(headRow, "sort", function () {
      headRow.addEventListener("click", function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest(".ck-t-sort") : null;
        if (!btn) return;
        var ci = btn.parentNode.cellIndex;
        /* Three states rather than two. A sorted table has lost the order the data came in,
           and that order is often the meaningful one — the order of the log, the order the
           author chose. The third click gives it back instead of making the reader reload. */
        if (state.col !== ci) { state.col = ci; state.dir = 1; }
        else if (state.dir === 1) { state.dir = -1; }
        else { state.col = -1; state.dir = 0; }
        state.at = 0;
        marks();
        apply();
      });
    });

    if (find) CK.once(find, "find", function () {
      find.addEventListener("input", function () {
        state.q = find.value.trim().toLowerCase();
        state.at = 0;
        apply();
      });
    });

    if (prev) CK.once(prev, "prev", function () {
      prev.addEventListener("click", function () { state.at = state.at - 1; apply(); });
    });
    if (next) CK.once(next, "next", function () {
      next.addEventListener("click", function () { state.at = state.at + 1; apply(); });
    });

    CK.settings(sec, {"dense":false,"filter":true,"page":0}, function (cfg) {
      sec.classList.toggle("ck-t-dense", !!cfg.dense);
      if (tools) tools.hidden = !cfg.filter;
      /* Hiding the box has to drop the filter with it. Rows missing for a reason the reader
         can no longer see is the worse of the two failures by a wide margin. */
      if (!cfg.filter && state.q !== "") { state.q = ""; if (find) find.value = ""; }
      var p = Math.floor(Number(cfg.page));
      state.per = isFinite(p) && p > 0 ? p : 0;
      state.at = 0;
      apply();
    });
  });
})();
