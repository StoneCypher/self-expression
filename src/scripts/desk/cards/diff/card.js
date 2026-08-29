(function () {
  /* Our own markup, not data: three round-capped zero-length strokes read as an ellipsis at
     any size, where a typed one is a font lottery and an emoji is worse. */
  var CK_D_DOTS = '<svg class="ck-df-dots" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>';

  CK.build("diff", function (sec) {
    var files = sec.querySelectorAll(".ck-df-file");

    /* Remembered across renders so that nudging the context setting does not slam every file
       the reader had opened by hand. Only a real change to collapsed speaks for all. */
    var lastCollapsed = null;

    function openFile(file, open) {
      file.setAttribute("data-open", open ? "1" : "0");
      var head = file.querySelector(".ck-df-head");
      if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function makeFold(gone) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ck-df-fold";
      b.insertAdjacentHTML("afterbegin", CK_D_DOTS);
      var label = document.createElement("span");
      label.textContent = gone.length + (gone.length === 1 ? " unchanged line" : " unchanged lines");
      b.appendChild(label);
      b.addEventListener("click", function () {
        for (var k = 0; k < gone.length; k++) gone[k].hidden = false;
        if (b.parentNode) b.parentNode.removeChild(b);
      });
      return b;
    }

    function unfold(root) {
      var olds = root.querySelectorAll(".ck-df-fold"), k;
      for (k = 0; k < olds.length; k++) olds[k].parentNode.removeChild(olds[k]);
      var rows = root.querySelectorAll(".ck-df-line");
      for (k = 0; k < rows.length; k++) rows[k].hidden = false;
    }

    function foldHunk(hunk, n) {
      var kids = hunk.children, runs = [], run = null, first = null, last = null, k;

      for (k = 0; k < kids.length; k++) {
        var el = kids[k];
        if (el.className.indexOf("ck-df-line") < 0) { run = null; continue; }
        if (!first) first = el;
        last = el;
        if (el.getAttribute("data-kind") === "ctx") {
          if (!run) { run = []; runs.push(run); }
          run.push(el);
        } else run = null;
      }

      for (k = 0; k < runs.length; k++) {
        var list = runs[k];
        /* A run at the top of a hunk has nothing above it to give context to, and one at the
           bottom nothing below, so those keep context on one side only. */
        var from = list[0] === first ? 0 : n;
        var to   = list[list.length - 1] === last ? list.length : list.length - n;
        /* Below two lines the fold button is taller than what it hides. */
        if (to - from < 2) continue;
        var gone = [], j;
        for (j = from; j < to; j++) { list[j].hidden = true; gone.push(list[j]); }
        hunk.insertBefore(makeFold(gone), gone[0]);
      }
    }

    function fold(n) {
      var i, k;
      for (i = 0; i < files.length; i++) {
        var body = files[i].querySelector(".ck-df-body");
        if (!body) continue;
        unfold(body);
        if (n <= 0) continue;
        var hunks = body.querySelectorAll(".ck-df-hunk");
        for (k = 0; k < hunks.length; k++) foldHunk(hunks[k], n);
      }
    }

    CK.once(sec, "dfhead", function () {
      sec.addEventListener("click", function (ev) {
        var head = ev.target && ev.target.closest ? ev.target.closest(".ck-df-head") : null;
        if (!head) return;
        var file = head.parentNode;
        openFile(file, file.getAttribute("data-open") === "0");
      });
    });

    CK.settings(sec, {"wrap":true,"context":0,"collapsed":false}, function (cfg) {
      sec.classList.toggle("ck-df-wrapped", !!cfg.wrap);
      var c = Math.floor(Number(cfg.context));
      fold(isFinite(c) && c > 0 ? c : 0);
      var want = !!cfg.collapsed;
      if (lastCollapsed !== want) {
        lastCollapsed = want;
        for (var i = 0; i < files.length; i++) openFile(files[i], !want);
      }
    });
  });
})();
