(function () {
  CK.build("ledger", function (sec) {
    var list = sec.querySelector(".ck-lg-list");
    if (!list) return;

    var noneEl = list.querySelector(".ck-lg-none");
    var countEl = sec.querySelector(".ck-lg-count");

    /* Captured once, in source order: this is the order the card falls back to when
       grouping is off, and the order within every group when it is on. */
    var heads = [], rows = [], kids = list.children, i;
    for (i = 0; i < kids.length; i++) {
      if (kids[i].className.indexOf("ck-lg-head") >= 0) heads.push(kids[i]);
      else if (kids[i].className.indexOf("ck-lg-row") >= 0) rows.push(kids[i]);
    }

    function shown(r, cfg) {
      return cfg.showStruck || r.getAttribute("data-struck") !== "1";
    }

    function apply(cfg) {
      var k, r, frag = document.createDocumentFragment(), live = 0;

      for (k = 0; k < rows.length; k++) {
        r = rows[k];
        r.hidden = !shown(r, cfg);
        if (!r.hidden) live++;
      }

      /* Grouping needs at least one declared group to mean anything; with none, the
         heading pass is skipped entirely rather than emitting a lone "ungrouped".
         heads holds the declared groups in order with the "ungrouped" heading last, so
         the last entry is handled separately below. */
      var grouping = cfg.group && heads.length > 1;
      var anyHead = false;
      var key, mine, n;

      if (grouping) {
        for (k = 0; k < heads.length - 1; k++) {
          key = heads[k].getAttribute("data-grp");
          mine = [];
          for (n = 0; n < rows.length; n++) {
            if (rows[n].getAttribute("data-grp") === key && !rows[n].hidden) mine.push(rows[n]);
          }
          /* An empty group is hidden outright, never shown as a bare heading: a heading
             with nothing under it reads as a category the reader has to go and check, and
             emptiness is only knowable here because hiding struck rows can cause it. */
          if (mine.length === 0) { heads[k].hidden = true; continue; }
          heads[k].hidden = false;
          anyHead = true;
          frag.appendChild(heads[k]);
          for (n = 0; n < mine.length; n++) frag.appendChild(mine[n]);
        }

        mine = [];
        for (n = 0; n < rows.length; n++) {
          if (rows[n].getAttribute("data-grp") === "" && !rows[n].hidden) mine.push(rows[n]);
        }
        /* The "ungrouped" heading earns its place only when a named group got one too; on
           its own it would be a label meaning "everything", which is not a distinction —
           and it would be the empty-heading failure wearing a different word. The rows
           themselves are placed either way, so nothing is lost by withholding the label. */
        var tail = heads[heads.length - 1];
        if (mine.length === 0 || !anyHead) { tail.hidden = true; }
        else { tail.hidden = false; frag.appendChild(tail); }
        for (n = 0; n < mine.length; n++) frag.appendChild(mine[n]);
      } else {
        for (k = 0; k < heads.length; k++) heads[k].hidden = true;
        for (k = 0; k < rows.length; k++) if (!rows[k].hidden) frag.appendChild(rows[k]);
      }

      /* Hidden rows stay in the DOM, at the end, so nothing is lost by a setting: turning
         "show struck" back on has to bring the same elements back, not new ones. */
      for (k = 0; k < rows.length; k++) if (rows[k].hidden) frag.appendChild(rows[k]);

      /* One reflow: every element is moved in its new order inside a fragment, and the
         fragment goes back in one call. */
      list.insertBefore(frag, noneEl);
      if (noneEl) noneEl.hidden = live !== 0;

      if (countEl) {
        countEl.textContent = live === rows.length
          ? rows.length + (rows.length === 1 ? " row" : " rows")
          : live + " of " + rows.length + " rows shown";
      }
    }

    /* Delegated, so the listener count does not track the row count, and guarded by
       CK.once so a <main> swap replaces the wiring rather than stacking a second copy. */
    CK.once(list, "verbs", function () {
      list.addEventListener("click", function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest(".ck-lg-verb") : null;
        if (!btn) return;
        var tr = btn.closest(".ck-lg-row");
        if (!tr) return;
        /* The card says what happened and to which row, and stops. What the verb MEANS is
           the page's business — which is why there is no allowlist of verbs in this file
           and no fetch anywhere in it. Two desks can answer "snooze" differently. */
        sec.dispatchEvent(new CustomEvent("ck-ledger", {
          detail: { id: tr.getAttribute("data-id"), verb: btn.getAttribute("data-verb") },
          bubbles: true
        }));
      });
    });

    CK.settings(sec, {"dense":false,"showStruck":true,"group":true}, function (cfg) {
      sec.classList.toggle("ck-lg-dense", !!cfg.dense);
      apply(cfg);
    });
  });
})();
