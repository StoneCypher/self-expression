(function () {
  CK.build("choice", function (sec) {
    var sheets  = sec.querySelectorAll(".ck-c-sheet");
    var listEl  = sec.querySelector(".ck-c-list");
    var sizeEl  = sec.querySelector(".ck-c-size");
    var countEl = sec.querySelector(".ck-c-count");

    /* Its own key, not the settings key: what you kept is an answer, and the size you
       judged it at is a preference. Losing one should never take the other with it. */
    var KEY = "desk.choice." + "choice";
    var NAT = { numeric: true, sensitivity: "base" };

    /* Tiles are captured once, per sheet, in source order. That index is what the "given"
       order restores and what every tie in a comparator falls back to, so each sort is a
       total order and re-sorting never quietly reshuffles equal tiles. */
    var groups = [], known = {}, total = 0, i, j;
    for (i = 0; i < sheets.length; i++) {
      var els = sheets[i].querySelectorAll(".ck-c-tile"), tiles = [];
      for (j = 0; j < els.length; j++) {
        var tid = els[j].getAttribute("data-id");
        tiles.push({ el: els[j], id: tid, i: j });
        known[tid] = 1;
      }
      total += tiles.length;
      groups.push({ host: sheets[i], tiles: tiles });
    }

    /* Natural order, then a raw tiebreak. "base" sensitivity makes A and a compare equal,
       and an engine is free to order equals however it likes — so the raw comparison is
       there to make this a total order rather than an almost-total one. */
    function cmpId(a, b) {
      var r = a.localeCompare(b, undefined, NAT);
      return r !== 0 ? r : (a < b ? -1 : a > b ? 1 : 0);
    }

    /* Re-vetted, not trusted. localStorage is a text file the viewer can edit, and an id
       that is not on this sheet would show up in the picked line as a value nobody chose.
       The lookup is a strict === 1 rather than truthy, so an entry named "toString" cannot
       borrow Object.prototype and pass for a candidate. */
    function load() {
      var raw = null, out = [], k, v;
      try { raw = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { raw = null; }
      if (Object.prototype.toString.call(raw) !== "[object Array]") return out;
      for (k = 0; k < raw.length; k++) {
        v = raw[k];
        if (typeof v === "string" && known[v] === 1 && out.indexOf(v) < 0) out.push(v);
      }
      return out;
    }

    var kept = load(), keptSet = {}, sortMode = "given";

    function reindex() {
      keptSet = {};
      for (var k = 0; k < kept.length; k++) keptSet[kept[k]] = 1;
    }
    reindex();

    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch (e) { /* private window */ }
    }

    function mark(el, on) {
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    }

    function applyMarks() {
      var gi, k, t;
      for (gi = 0; gi < groups.length; gi++) {
        t = groups[gi].tiles;
        for (k = 0; k < t.length; k++) mark(t[k].el, keptSet[t[k].id] === 1);
      }
    }

    /* The point of the whole card: a line you can read out loud. Sorted, because the order
       you happened to click in is not information and reading it back in click order makes
       two identical shortlists look different. */
    function paintPicks() {
      if (!listEl) return;
      var s = kept.slice(0).sort(cmpId);
      listEl.textContent = s.length ? s.join(", ") : "nothing yet";
      listEl.className = s.length ? "ck-c-list" : "ck-c-list ck-c-none";
    }

    function paintCount() {
      if (!countEl) return;
      countEl.textContent = total + (total === 1 ? " candidate" : " candidates") +
        (kept.length ? ", " + kept.length + " kept" : "");
    }

    /* One fragment per sheet and one insertion: three hundred tiles reordered one at a time
       is three hundred layouts. The "given" order needs no comparator at all: the list is
       already source order and re-appending in that order is what puts the sheet back. */
    function order(mode) {
      var gi, k, g, seq, frag;
      for (gi = 0; gi < groups.length; gi++) {
        g = groups[gi];
        seq = g.tiles.slice(0);
        if (mode === "id") {
          seq.sort(function (a, b) { var r = cmpId(a.id, b.id); return r !== 0 ? r : a.i - b.i; });
        } else if (mode === "kept") {
          seq.sort(function (a, b) {
            var ka = keptSet[a.id] === 1 ? 0 : 1, kb = keptSet[b.id] === 1 ? 0 : 1;
            return ka !== kb ? ka - kb : a.i - b.i;
          });
        }
        frag = document.createDocumentFragment();
        for (k = 0; k < seq.length; k++) frag.appendChild(seq[k].el);
        g.host.appendChild(frag);
      }
    }

    /* A class, not a style attribute: the desk serves under a CSP and a strict style-src
       refuses inline styles outright. Every other class on the section is preserved — the
       desk puts its own "away" class here and rewriting className blindly would drop it. */
    function px(n) {
      var cs = String(sec.className).split(/\s+/), out = [], k;
      for (k = 0; k < cs.length; k++) if (cs[k] && cs[k].indexOf("ck-c-px") !== 0) out.push(cs[k]);
      out.push("ck-c-px" + n);
      sec.className = out.join(" ");
    }

    /* ONE listener on the section, not one per tile. The sheet is built to hold three
       hundred candidates; three hundred registrations would be three hundred closures to
       tear down on every <main> swap, and the symptom of getting that wrong — a click
       firing four times an hour into a session — is miserable to trace back. Delegation
       also survives the reordering above, which moves the tiles out from under it. */
    CK.once(sec, "pick", function () {
      sec.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;

        if (t.closest(".ck-c-clear")) {
          kept = [];
          reindex(); save(); applyMarks(); paintPicks(); paintCount();
          if (sortMode === "kept") order(sortMode);
          return;
        }

        var tile = t.closest(".ck-c-tile");
        if (!tile) return;
        var cid = tile.getAttribute("data-id"), at = kept.indexOf(cid);
        if (at >= 0) kept.splice(at, 1); else kept.push(cid);
        reindex();
        mark(tile, at < 0);
        save(); paintPicks(); paintCount();
        /* In "kept" order the shortlist collects at the top as you build it, which means the
           tile you just clicked moves. That is the mode doing its job, not a glitch: the
           other two modes hold still, and they are what you use while still comparing. */
        if (sortMode === "kept") order(sortMode);
      });
    });

    CK.settings(sec, {"size":13,"showLarge":true,"sort":"given"}, function (cfg) {
      var n = Math.round(Number(cfg.size));
      if (!isFinite(n)) n = 13;
      if (n < 8) n = 8;
      if (n > 48) n = 48;
      px(n);
      /* The caption names the working size, so it has to be told when the size changes —
         a caption that says 13px over a sheet drawn at 24px is worse than no caption. */
      if (sizeEl) sizeEl.textContent = n + "px";
      sec.classList.toggle("ck-c-nolarge", !cfg.showLarge);
      sortMode = cfg.sort === "id" || cfg.sort === "kept" ? cfg.sort : "given";
      order(sortMode);
      applyMarks(); paintPicks(); paintCount();
    });
  });
})();
