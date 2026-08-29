(function () {
  CK.build("rail", function (sec) {
    var listEl  = sec.querySelector(".ck-r-list");
    var benchEl = sec.querySelector(".ck-r-bench");
    var headEl  = sec.querySelector(".ck-r-benchhead");
    var noneEl  = sec.querySelector(".ck-r-none");
    var countEl = sec.querySelector(".ck-r-count");
    var capEl   = sec.querySelector(".ck-r-cap");
    if (!listEl || !benchEl) return;

    /* Its own key, not the settings key: what you have done and dismissed is a record, and
       how long you like the rail is a preference. Losing one must not take the other. */
    var KEY = "desk.rail." + "rail";

    /* Captured once, in source order — items then bench. That order IS the ranking, and
       everything below is a function of it plus which ids are gone. */
    var els = sec.querySelectorAll(".ck-r-row"), rows = [], known = {}, i;
    for (i = 0; i < els.length; i++) {
      var rid = els[i].getAttribute("data-id");
      rows.push({ el: els[i], id: rid });
      known[rid] = 1;
    }

    var cap = 5, showBench = false;

    /* Re-vetted, not trusted. localStorage is a text file the viewer can edit, and an id
       that is not on this rail would be a dismissal of a row that does not exist. The
       lookup is a strict === 1 rather than truthy, so an entry named "toString" cannot
       borrow Object.prototype and pass for a row. */
    function take(src, dst) {
      var k;
      if (Object.prototype.toString.call(src) !== "[object Array]") return;
      for (k = 0; k < src.length; k++) {
        if (typeof src[k] === "string" && known[src[k]] === 1) dst[src[k]] = 1;
      }
    }

    function load() {
      var raw = null, out = { done: {}, gone: {} };
      try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { raw = null; }
      if (!raw || typeof raw !== "object") return out;
      take(raw.done, out.done);
      take(raw.gone, out.gone);
      return out;
    }

    var state = load();

    /* Written back in rail order and only for rows that still exist, so the stored record
       cannot accumulate ids from a version of the data that is no longer being shown. */
    function save() {
      var d = [], g = [], k;
      for (k = 0; k < rows.length; k++) {
        if (state.done[rows[k].id] === 1) d.push(rows[k].id);
        if (state.gone[rows[k].id] === 1) g.push(rows[k].id);
      }
      try {
        localStorage.setItem(KEY, JSON.stringify({ done: d, gone: g }));
      } catch (e) { /* private window */ }
    }

    /* The refill rule, in four lines and no bookkeeping.

       A dismissed row is out of the sequence entirely; what is left is the live list, still
       in the original ranking. The first cap of those are the rail and the remainder is the
       bench — so dismissing a rail row shortens the prefix by one and the row that was
       first on the bench becomes last on the rail, which is the promotion, achieved by not
       having to do anything. When the bench is exhausted the slice is simply shorter than
       the cap and the rail shrinks, honestly, rather than padding itself back to length.

       Note what is NOT here: a stored bench index. It would be a second fact about the same
       thing, and the first time it disagreed with the dismissal list the rail would be
       wrong in a way nothing in this card could notice. */
    function apply() {
      var live = [], k, r;
      for (k = 0; k < rows.length; k++) {
        r = rows[k];
        r.el.hidden = state.gone[r.id] === 1;
        r.el.classList.toggle("ck-r-is-done", state.done[r.id] === 1);
        if (state.gone[r.id] !== 1) live.push(r);
      }

      var onRail  = cap > 0 ? live.slice(0, cap) : [];
      var onBench = live.slice(onRail.length);

      /* One fragment per list, one insertion each: moving rows one at a time would relayout
         the card once per row, and a long bench makes that visible. */
      var fr = document.createDocumentFragment();
      for (k = 0; k < onRail.length; k++) fr.appendChild(onRail[k].el);
      listEl.appendChild(fr);
      var fb = document.createDocumentFragment();
      for (k = 0; k < onBench.length; k++) fb.appendChild(onBench[k].el);
      benchEl.appendChild(fb);

      var showing = showBench && onBench.length > 0;
      benchEl.hidden = !showing;
      if (headEl) headEl.hidden = !showing;

      if (noneEl) {
        var why = "";
        if (rows.length === 0) why = "nothing on the rail and nothing on the bench";
        else if (cap <= 0) why = "the rail length is 0 \u2014 everything is on the bench";
        else if (onRail.length === 0) why = "every row has been removed";
        noneEl.textContent = why;
        noneEl.hidden = why === "";
      }

      if (countEl) countEl.textContent = summary(onRail.length, onBench.length);
    }

    /* Said in full, because every one of these states is a state the reader might otherwise
       read as a bug: a short rail, an empty rail, and rows that are simply gone. */
    function summary(nRail, nBench) {
      var gone = 0, k;
      for (k = 0; k < rows.length; k++) if (state.gone[rows[k].id] === 1) gone++;

      var out;
      if (rows.length === 0) out = "no items and no bench";
      else if (nRail === 0) out = "nothing on the rail";
      else out = nRail + " on the rail";

      if (nBench > 0) out += ", " + nBench + " on the bench";
      else if (nRail > 0 && cap > nRail) out += " of a cap of " + cap + ", and the bench is empty";
      if (gone > 0) out += "; " + gone + " removed";
      return out;
    }

    /* ONE listener on the section, not one per button. A rail plus its bench can be long,
       every row carries a verb for each verb in the list, and the rows move between two
       parents on every change — a listener bound to a button would have to be rebound or
       reasoned about every time, and delegation simply does not care. */
    CK.once(sec, "rail", function () {
      sec.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var li = t.closest(".ck-r-row");
        if (!li) return;
        var rid = li.getAttribute("data-id");

        /* Dismissal is bookkeeping and stays local: it changes what this card shows and
           nothing else. Verbs are messages and go out. */
        if (t.closest(".ck-r-kill")) {
          state.gone[rid] = 1;
          save();
          apply();
          return;
        }

        var btn = t.closest(".ck-r-verb");
        if (!btn) return;
        state.done[rid] = 1;
        save();
        apply();
        /* Dispatched AFTER the DOM has settled, so a listener that reads the card sees the
           state the click produced rather than the one it replaced. The card says what
           happened and to which row; what the verb MEANS is the page's business, which is
           why there is no allowlist of verbs here and no fetch anywhere in this file. */
        sec.dispatchEvent(new CustomEvent("ck-rail", {
          detail: { id: rid, verb: btn.getAttribute("data-verb") },
          bubbles: true
        }));
      });
    });

    CK.settings(sec, {"cap":5,"showBench":false,"strike":true}, function (cfg) {
      var c = Math.floor(Number(cfg.cap));
      cap = isFinite(c) && c > 0 ? c : 0;
      showBench = !!cfg.showBench;
      sec.classList.toggle("ck-r-strike", !!cfg.strike);
      /* The caption states the cap, so it has to be told when the cap changes: a caption
         claiming a rail of five over a rail of two is worse than no caption at all. */
      if (capEl) capEl.textContent = String(cap);
      apply();
    });
  });
})();
