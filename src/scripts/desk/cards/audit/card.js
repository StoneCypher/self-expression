(function () {
  var ID   = "audit";
  var BASE = "/audit\u003fn=200";
  var SEED = {"limit":200,"family":"all","live":false};
  var Q0   = "";
  var NOG  = "\u003csvg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" aria-hidden=\"true\"\u003e\u003ccircle cx=\"12\" cy=\"12\" r=\"8.6\"/\u003e\u003cpath d=\"M6.2 17.8L17.8 6.2\"/\u003e\u003c/svg\u003e";

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  /* Local time, always. The log stores UTC because a log has to be comparable across
     machines; a person reading it wants to know what time it was where they were sitting.
     The date is only shown when the record is not from today, so the common case stays a
     narrow column and the uncommon case is never mistaken for it. */
  function stamp(at) {
    if (at === null || at === undefined || at === "") return "--:--:--";
    var d = new Date(at);
    var ms = d.getTime();
    if (!isFinite(ms)) return "--:--:--";
    var now = new Date();
    var t = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    var today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
             && d.getDate() === now.getDate();
    return today ? t : pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + t;
  }

  function fullStamp(at) {
    if (at === null || at === undefined || at === "") return "no timestamp recorded";
    var d = new Date(at);
    return isFinite(d.getTime()) ? d.toLocaleString() : "unreadable timestamp";
  }

  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }

  /* A detail value rendered compactly, one level of structure at a time.
     String(v) on an object gives "[object Object]", which tells a reviewer that something was
     logged and nothing about what — the exact opposite of the job. Depth is bounded rather
     than recursive-until-done because a row is one line in a card, not a JSON viewer. */
  function val(v, depth) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    var t = typeof v;
    if (t === "string") return v;
    if (t === "number" || t === "boolean") return String(v);
    if (t === "function") return "function";
    if (isArr(v)) {
      if (v.length === 0) return "[]";
      if (depth <= 0) return "[" + v.length + " items]";
      var out = [], i;
      for (i = 0; i < v.length && i < 6; i++) out.push(val(v[i], depth - 1));
      if (v.length > 6) out.push("+" + (v.length - 6) + " more");
      return "[" + out.join(", ") + "]";
    }
    var keys;
    try { keys = Object.keys(v); } catch (e) { return "unreadable"; }
    if (keys.length === 0) return "{}";
    if (depth <= 0) return "{" + keys.length + " keys}";
    var parts = [], k;
    for (k = 0; k < keys.length && k < 6; k++) {
      parts.push(keys[k] + ": " + val(v[keys[k]], depth - 1));
    }
    if (keys.length > 6) parts.push("+" + (keys.length - 6) + " more");
    return "{" + parts.join(", ") + "}";
  }

  /* Long values are folded, not dropped: the whole thing stays on the row title. A log that
     truncates without saying so is a log that can hide the interesting half of a URL. */
  function clip(s) { return s.length > 160 ? s.slice(0, 159) + "\u2026" : s; }

  /* The detail, flattened. at and action are the row's own columns; everything else on
     the record came from the caller's detail object, because the server spreads it at the
     top level rather than nesting it. */
  function pairs(rec) {
    var keys = Object.keys(rec), out = [], i, k;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (k === "at" || k === "action") continue;
      out.push({ k: k, v: val(rec[k], 2) });
    }
    return out;
  }

  /* Refusal detection, on stems rather than whole words.
     The two costs are not symmetric. A false positive marks a row that did not need marking
     and a reader loses a second. A false negative lets "open.refusal" or "net.denial" render
     as one more grey line, which is the single failure this card exists to prevent. So the
     test is deliberately generous: refus*, deni*, deny. */
  function refused(action) {
    var a = String(action === null || action === undefined ? "" : action).toLowerCase();
    return a.indexOf("refus") >= 0 || a.indexOf("deni") >= 0 || a.indexOf("deny") >= 0;
  }

  /* The family is the part before the first dot. An action with no dot is its own family,
     which is right: "land" is a verb the desk has, not a malformed "land.something". */
  function famOf(action) {
    var a = String(action === null || action === undefined ? "" : action);
    var i = a.indexOf(".");
    return i < 0 ? (a === "" ? "(unnamed)" : a) : a.slice(0, i);
  }

  CK.build(ID, function (sec) {

    var logEl   = sec.querySelector(".ck-au-log");
    var noneEl  = sec.querySelector(".ck-au-none");
    var findEl  = sec.querySelector(".ck-au-find");
    var famSel  = sec.querySelector(".ck-au-famsel");
    var sCount  = sec.querySelector(".ck-au-s-count");
    var sFam    = sec.querySelector(".ck-au-s-fam");
    var sRef    = sec.querySelector(".ck-au-s-ref");
    var sBad    = sec.querySelector(".ck-au-s-bad");
    var sNote   = sec.querySelector(".ck-au-s-note");
    var readEl  = sec.querySelector(".ck-au-read");
    if (!logEl) return;

    /* recs is the rendered batch and groups the DOM built from it. Both are rebuilt only
       on a successful read — a failed read must not blank rows the viewer is still using. */
    var state = {
      recs: [], groups: [], bad: 0, refs: 0, fams: [],
      q: Q0.toLowerCase(), family: SEED.family, limit: SEED.limit, live: !!SEED.live,
      readAt: 0, ok: false, err: "", started: false, busy: false
    };

    /* Same-origin only, and said out loud when it is not.
       The page is served under connect-src 'self'. A cross-origin URL here would be blocked
       by the browser with nothing in the card to show for it, so the card checks first and
       explains, rather than presenting an empty log that looks like an empty history. */
    function endpoint() {
      var u;
      try { u = new URL(BASE, location.href); } catch (e) { return null; }
      if (u.origin !== location.origin) return null;
      try { u.searchParams.set("n", String(state.limit)); } catch (e) { return null; }
      return u.pathname + u.search;
    }

    function setText(el, s) { if (el) el.textContent = s; }

    function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

    /* ── building the DOM for one batch ─────────────────────────────────────────────── */

    function rowEl(r) {
      var row = document.createElement("div");
      row.className = r.no ? "ck-au-row ck-au-no" : "ck-au-row";

      var t = document.createElement("span");
      t.className = "ck-au-t";
      t.textContent = stamp(r.rec.at);
      t.setAttribute("title", fullStamp(r.rec.at));
      row.appendChild(t);

      var m = document.createElement("span");
      m.className = "ck-au-m";
      if (r.no) {
        /* The only innerHTML in the card, and it is fed a module constant with no data in
           it. Everything that came off the wire below is textContent. */
        m.innerHTML = NOG;
        var sr = document.createElement("span");
        sr.className = "ck-au-sr";
        sr.textContent = "refused";
        m.appendChild(sr);
      }
      row.appendChild(m);

      var a = document.createElement("span");
      a.className = "ck-au-a";
      a.textContent = r.action;
      row.appendChild(a);

      var d = document.createElement("span");
      d.className = "ck-au-d";
      var ps = r.pairs, i;
      if (ps.length === 0) {
        var em = document.createElement("i");
        em.className = "ck-au-bare";
        em.textContent = "no detail";
        d.appendChild(em);
      } else {
        for (i = 0; i < ps.length; i++) {
          var kv = document.createElement("span");
          kv.className = "ck-au-kv";
          var b = document.createElement("b");
          b.textContent = ps[i].k + "=";
          kv.appendChild(b);
          var v = document.createElement("span");
          v.textContent = clip(ps[i].v);
          if (ps[i].v.length > 160) v.setAttribute("title", ps[i].v);
          kv.appendChild(v);
          d.appendChild(kv);
        }
      }
      row.appendChild(d);
      return row;
    }

    /* Grouped by family, families ordered by their most recent record, rows newest first
       inside a family. Grouping trades the interleaved timeline for per-family legibility;
       every row keeps an absolute local time, so the global order is still recoverable by
       eye, and narrowing the family select to one family restores a pure stream. */
    function paint() {
      var byName = Object.create(null), order = [], i, r, g;
      for (i = 0; i < state.recs.length; i++) {
        r = state.recs[i];
        g = byName[r.family];
        if (!g) { g = { name: r.family, items: [], el: null, cEl: null, rEl: null }; byName[r.family] = g; order.push(g); }
        g.items.push(r);
      }

      var frag = document.createDocumentFragment();
      for (i = 0; i < order.length; i++) {
        g = order[i];
        var box = document.createElement("div");
        box.className = "ck-au-fam";

        var head = document.createElement("div");
        head.className = "ck-au-famh";
        var nm = document.createElement("span");
        nm.className = "ck-au-famn";
        nm.textContent = g.name;
        head.appendChild(nm);
        var ct = document.createElement("span");
        ct.className = "ck-au-famc";
        head.appendChild(ct);

        var nrefs = 0, j;
        for (j = 0; j < g.items.length; j++) if (g.items[j].no) nrefs++;
        var rf = document.createElement("span");
        rf.className = "ck-au-famr";
        if (nrefs > 0) rf.textContent = plural(nrefs, "refusal", "refusals");
        head.appendChild(rf);
        box.appendChild(head);

        for (j = 0; j < g.items.length; j++) {
          g.items[j].el = rowEl(g.items[j]);
          box.appendChild(g.items[j].el);
        }

        g.el = box; g.cEl = ct; g.rEl = rf;
        frag.appendChild(box);
      }

      /* One insertion for the whole batch. At a thousand rows the difference between this
         and appending row by row is the difference between a card that appears and a card
         that visibly assembles itself. */
      logEl.textContent = "";
      logEl.appendChild(frag);
      state.groups = order;
      refreshFamilies();
      applyFilter();
    }

    /* ── the family select ──────────────────────────────────────────────────────────── */

    function refreshFamilies() {
      if (!famSel) return;
      var names = [], i;
      for (i = 0; i < state.groups.length; i++) names.push(state.groups[i].name);
      names.sort();
      state.fams = names;

      famSel.textContent = "";
      var all = document.createElement("option");
      all.setAttribute("value", "all");
      all.textContent = "all";
      famSel.appendChild(all);
      for (i = 0; i < names.length; i++) {
        var o = document.createElement("option");
        o.setAttribute("value", names[i]);
        o.textContent = names[i];
        famSel.appendChild(o);
      }
      /* A stored family that this batch does not contain still gets an option, labelled as
         absent. Dropping it would blank the select while it was still filtering, and the
         viewer would be looking at an empty log with no control saying why. */
      if (state.family !== "all" && names.indexOf(state.family) < 0) {
        var miss = document.createElement("option");
        miss.setAttribute("value", state.family);
        miss.textContent = state.family + " (none in this batch)";
        famSel.appendChild(miss);
      }
      famSel.value = state.family;
    }

    /* ── filtering ──────────────────────────────────────────────────────────────────── */

    /* Rows are shown and hidden, never rebuilt. The filter runs on every keystroke across
       every row, and the haystack was built once when the batch arrived, so a thousand rows
       cost a thousand property writes rather than a thousand element constructions. */
    function applyFilter() {
      var shown = 0, refShown = 0, gShown = 0, i, j, g, r, vis, n;
      for (i = 0; i < state.groups.length; i++) {
        g = state.groups[i];
        n = 0;
        for (j = 0; j < g.items.length; j++) {
          r = g.items[j];
          vis = (state.family === "all" || r.family === state.family)
             && (state.q === "" || r.hay.indexOf(state.q) >= 0);
          r.el.hidden = !vis;
          if (vis) { n++; if (r.no) refShown++; }
        }
        g.el.hidden = n === 0;
        if (n > 0) gShown++;
        g.cEl.textContent = n === g.items.length ? String(n) : n + " of " + g.items.length;
        shown += n;
      }

      if (noneEl) {
        noneEl.hidden = shown !== 0;
        noneEl.textContent =
          state.recs.length === 0
            ? (state.ok ? "the log is empty \u2014 nothing has been recorded yet"
                        : "nothing read yet")
            : "no record matches that filter";
      }

      setText(sCount, state.recs.length === 0 ? "no records"
        : shown === state.recs.length ? plural(shown, "record", "records")
        : shown + " of " + state.recs.length + " records");
      setText(sFam, gShown === 0 ? "" : plural(gShown, "family", "families"));
      setText(sRef, refShown === 0 ? "" : plural(refShown, "refusal", "refusals"));
      setText(sBad, state.bad === 0 ? ""
        : plural(state.bad, "unreadable line skipped", "unreadable lines skipped"));
    }

    /* ── reading ────────────────────────────────────────────────────────────────────── */

    function said(msg) { setText(readEl, msg); }

    /* A failed read leaves the rows alone. The last good batch is still true about the past;
       blanking it would turn "I could not reach the server" into "nothing ever happened",
       which is the more alarming of the two and the wrong one. */
    function failed(why) {
      state.ok = false;
      state.err = why;
      setText(sNote, "read failed");
      said(state.recs.length === 0
        ? "could not read the log: " + why + ". no rows have been read yet."
        : "could not read the log: " + why + ". the rows below are the last good read, from "
          + fullStamp(state.readAt) + ".");
    }

    function accept(payload, from) {
      /* The route answers { rows, showing }; a bare array is accepted too, so this card
         also reads a plain dump of the same records without a wrapper being invented for it. */
      var rows = isArr(payload) ? payload
               : (payload && isArr(payload.rows) ? payload.rows : null);
      if (rows === null) { failed("the response had no rows array"); return; }

      var recs = [], bad = 0, refs = 0, i, rec, action, ps, hay, k;
      /* Newest first. The server sends the tail of the file in file order, which is oldest
         first; a log you are watching is read from the top. */
      for (i = rows.length - 1; i >= 0; i--) {
        rec = rows[i];
        if (!rec || typeof rec !== "object" || isArr(rec)) { bad++; continue; }
        action = rec.action === null || rec.action === undefined ? "" : String(rec.action);
        /* unparseable is the route's own label for a line it could not JSON.parse. It is
           counted and skipped rather than rendered: a damaged line has no action and no
           detail to show, and rendering it as a row would put a fake event in the history. */
        if (action === "unparseable") { bad++; continue; }
        ps = pairs(rec);
        hay = action;
        for (k = 0; k < ps.length; k++) hay += " " + ps[k].k + "=" + ps[k].v;
        var no = refused(action);
        if (no) refs++;
        recs.push({
          rec: rec, action: action === "" ? "(unnamed)" : action, family: famOf(action),
          pairs: ps, hay: hay.toLowerCase(), no: no, el: null
        });
      }

      state.recs = recs;
      state.bad = bad;
      state.refs = refs;
      state.ok = true;
      state.err = "";
      state.readAt = Date.now();
      setText(sNote, "");
      paint();
      said("read " + from + " at " + fullStamp(state.readAt)
        + (bad === 0 ? "." : ", skipping " + plural(bad, "unreadable line", "unreadable lines") + "."));
    }

    function load() {
      if (state.busy) return;
      var where = endpoint();
      if (where === null) {
        failed("the configured url is not on this desk\u2019s origin, so it is never requested");
        return;
      }
      state.busy = true;
      fetch(where, { cache: "no-store" }).then(function (r) {
        return r.text().then(function (body) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          var got;
          try { got = JSON.parse(body); }
          catch (e) { throw new Error("the response was not JSON"); }
          accept(got, where);
        });
      }).catch(function (e) {
        /* A dead server rejects the fetch outright; a wrong route resolves with a status.
           Both land here and both are reported in the caption in the same plain words. */
        failed(e && e.message ? e.message : "the server did not answer");
      }).then(function () { state.busy = false; }, function () { state.busy = false; });
    }

    /* ── wiring ─────────────────────────────────────────────────────────────────────── */

    if (findEl) {
      findEl.value = Q0;
      CK.once(findEl, "find", function () {
        findEl.addEventListener("input", function () {
          state.q = findEl.value.trim().toLowerCase();
          applyFilter();
        });
      });
    }

    CK.settings(sec, SEED, function (c) {
      var lim = Number(c.limit);
      var changed = isFinite(lim) && lim > 0 && lim !== state.limit;
      var wasLive = state.live;
      if (isFinite(lim) && lim > 0) state.limit = lim;
      state.family = c.family === null || c.family === undefined ? "all" : String(c.family);
      state.live = !!c.live;
      if (famSel && famSel.value !== state.family) famSel.value = state.family;
      applyFilter();
      /* The first callback fires during wiring, before the timer has read anything; the
         timer's immediate tick owns the first read so the two cannot both make one. */
      if (!state.started) return;
      if (changed || (state.live && !wasLive)) load();
    });

    /* One registered interval per card, by name, in a registry that outlives the DOM.
       CK.once cannot do this: it keys off the element, and a <main> swap hands the builder
       a new element with an empty dataset, so the guard passes and a second interval starts
       while the first is still polling against a detached node. CK.timer replaces instead.
       The tick reads state.live rather than being started and stopped, so toggling follow
       can never leave two intervals or none. */
    CK.timer(ID + ":audit", 15000, function () {
      if (!state.started) { state.started = true; load(); return; }
      if (state.live) load();
    });
  });
})();
