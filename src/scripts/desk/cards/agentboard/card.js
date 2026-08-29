(function () {
  /* The four states this card understands, in the order the board groups them.
     Running leads because it is the only group whose numbers are still moving, and it is
     the group the reader opened the card for. Queued follows: not out yet, but promised.
     Failed comes before done because a failure is a thing to act on and a success is a
     thing to have. A state this card does not know ranks last and is grouped as "other" -
     it renders as the caller spelled it rather than being dropped, because the row is the
     reader's and the vocabulary is ours. */
  function ckRank(state) {
    if (state === "running") return 0;
    if (state === "queued")  return 1;
    if (state === "failed")  return 2;
    if (state === "done")    return 3;
    return 4;
  }

  /* The heading a state files under. Every unknown state shares one bucket rather than
     minting a heading each, so a source with a typo in it cannot shatter the board into
     one-row groups. */
  function ckGroup(state) {
    return ckRank(state) === 4 ? "other" : state;
  }

  /* Strip C0 control characters and DEL from caller text.
     Written as code-point arithmetic rather than as a character class on purpose: a class
     has to be spelled with escapes, and an escape decoded one step too early puts a raw
     control character into the file, where it is invisible in every editor, legal to the
     parser, and survives a syntax check. Comparing numbers cannot go wrong that way.
     Iterating by code unit is safe for astral characters: both halves of a surrogate pair
     are far above 32, so a pair is copied through intact. */
  function ckClean(v) {
    var s = v === null || v === undefined ? "" : String(v);
    var out = "", i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 32 || c === 127) continue;
      out += s.charAt(i);
    }
    return out;
  }

  /* Epoch milliseconds for a timestamp, or null when it cannot be read as one.
     A number is taken as epoch milliseconds; text goes through Date.parse, which means ISO
     strings are exact and everything else is at the engine's mercy. That is stated rather
     than hidden: feed ISO. Null rather than a guess, because a guessed start time produces
     a confident wrong duration, which is worse than an admitted missing one. */
  function ckTime(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "boolean") return null;
    var t = Date.parse(String(v));
    return isFinite(t) ? t : null;
  }

  /* The agent list, deduped and settled to strings and numbers.
     Returns null - not an empty array - when the value is not a board at all, so a live
     source answering with a stray object can be reported as "that was not a list of agents"
     rather than silently emptying the board, which would read as "everything finished".
     Duplicate ids are dropped rather than renamed: the id is how anything outside this card
     names a row, and two rows sharing one make every such reference ambiguous. A row with
     no id gets a synthetic one instead, because failing to name itself does not make a
     dispatched agent less real. Bookkeeping keys are prefixed so that an agent called
     "constructor" cannot collide with an inherited property of the plain object. */
  function ckNormalize(raw) {
    var list = raw;
    if (list && !Array.isArray(list) && Array.isArray(list.agents)) list = list.agents;
    if (!Array.isArray(list)) return null;
    var out = [], seen = {}, i, a, id, nm, st, auto = 0;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (!a || typeof a !== "object") continue;
      id = ckClean(a.id);
      if (id === "") { do { id = "a" + auto; auto = auto + 1; } while (seen["k" + id] === 1); }
      if (seen["k" + id] === 1) continue;
      seen["k" + id] = 1;
      nm = ckClean(a.name);
      st = ckClean(a.state).toLowerCase();
      out.push({
        i: out.length,
        id: id,
        name: nm === "" ? id : nm,
        task: ckClean(a.task),
        note: ckClean(a.note),
        state: st,
        known: ckRank(st) < 4,
        started: ckTime(a.started),
        finished: ckTime(a.finished)
      });
    }
    return out;
  }

  /* A duration in the largest two units that still carry information.
     An agent out for over a day is a real case and reads "2d 7h" rather than "191340s".
     A negative or unreadable span returns the empty string; every caller of this checks
     for that case first and says something specific instead, because a duration that came
     out blank is a fact about the data and deserves its own words. */
  function ckDur(ms) {
    var s = Math.floor(ms / 1000);
    if (!isFinite(s) || s < 0) return "";
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + r + "s";
    return r + "s";
  }

  /* What the duration column says for one agent, and why.
     The "why" becomes a title attribute and the "bad" flag becomes a visible mark plus a
     line in the caption, so every one of these cases is admitted on screen rather than
     rendered as a plausible-looking number.

     The cases, in the order they are tested:
       - a queued agent with no start has simply not started; that is normal, not a defect,
         and it gets an em dash rather than an alarm.
       - a finish earlier than its start is reported, never rendered as a negative duration:
         a minus sign in this column would read as a clock skew the viewer has to diagnose.
       - no start at all means no duration can be computed for anyone.
       - a finished agent with no finish time is NOT given a running clock. Counting up for
         something that has already come back is precisely the lie this card exists to avoid.
     Everything left is the ordinary case: now minus started while out, finished minus
     started once back. */
  function ckSpan(a, now) {
    if (a.state === "queued" && a.started === null) {
      return { text: "\u2014", why: "not started yet", bad: false };
    }
    if (a.started === null) {
      return { text: "n/r", why: "no start time was recorded", bad: true };
    }
    if (a.finished !== null && a.finished < a.started) {
      return { text: "n/a", why: "the finish time is earlier than the start time", bad: true };
    }
    var out = a.state === "running" || a.state === "queued";
    if (!out && a.finished === null) {
      return { text: "n/r", why: "no finish time was recorded", bad: true };
    }
    var ms = (out ? now : a.finished) - a.started;
    if (!isFinite(ms) || ms < 0) {
      return { text: "n/a", why: "the recorded times do not make a duration", bad: true };
    }
    return { text: ckDur(ms), why: "", bad: false };
  }

  /* The board order: by group, then by the thing the reader of that group wants first.
     Running sorts by start ascending, so the agent that has been out longest is at the top -
     it is the one you are most likely wondering about. Failed and done sort by finish
     descending, newest result first, because a result you have already seen is history.
     Queued keeps source order, which is dispatch order and therefore the order they will go.
     Every branch falls back to the source index, so the comparator is a total order and the
     result does not depend on the engine's sort algorithm. */
  function ckOrder(list) {
    var out = list.slice(0);
    out.sort(function (a, b) {
      var ra = ckRank(a.state), rb = ckRank(b.state);
      if (ra !== rb) return ra - rb;
      if (ra === 0) {
        if (a.started === null && b.started === null) return a.i - b.i;
        if (a.started === null) return 1;
        if (b.started === null) return -1;
        if (a.started !== b.started) return a.started - b.started;
        return a.i - b.i;
      }
      if (ra === 2 || ra === 3) {
        if (a.finished === null && b.finished === null) return a.i - b.i;
        if (a.finished === null) return 1;
        if (b.finished === null) return -1;
        if (a.finished !== b.finished) return b.finished - a.finished;
        return a.i - b.i;
      }
      return a.i - b.i;
    });
    return out;
  }

  var AB_GLYPH = {"running":"\u003csvg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"\u003e\u003ccircle cx=\"12\" cy=\"12\" r=\"7.2\"/\u003e\u003cpath d=\"M12 7.9V12l2.7 1.9\"/\u003e\u003c/svg\u003e","queued":"\u003csvg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"\u003e\u003ccircle cx=\"12\" cy=\"12\" r=\"7.2\"/\u003e\u003c/svg\u003e","failed":"\u003csvg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"\u003e\u003cpath d=\"M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6\"/\u003e\u003c/svg\u003e","done":"\u003csvg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"\u003e\u003cpath d=\"M5 12.6l4.6 4.6L19 7.2\"/\u003e\u003c/svg\u003e","other":"\u003csvg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"\u003e\u003ccircle cx=\"12\" cy=\"12\" r=\"7.2\"/\u003e\u003cpath d=\"M12 16.4v.01\"/\u003e\u003cpath d=\"M9.7 10.1a2.3 2.3 0 014.6 0c0 1.6-2.3 1.9-2.3 3.4\"/\u003e\u003c/svg\u003e"};
  var AB_POLL = 5000;

  CK.build("agentboard", function (sec) {
    var box = sec.querySelector(".ck-ab-list");
    if (!box) return;

    var stateEl = sec.querySelector(".ck-ab-state");
    var countEl = sec.querySelector(".ck-ab-count");
    var noneEl  = sec.querySelector(".ck-ab-none");
    var voidEl  = sec.querySelector(".ck-ab-void");

    var STATIC   = [{"i":0,"id":"a1","name":"reader A","task":"image, choice, molecule, formula, markdown, note","note":"found that molecule throws rather than degrading, and lists four presets","state":"done","known":true,"started":1788033424000,"finished":1788033626000},{"i":1,"id":"a2","name":"reader B","task":"ledger, rail, matrix, flow, graph","note":"returned the 125-glyph marker vocabulary and the two shapes seriation can find","state":"done","known":true,"started":1788033424000,"finished":1788033691000},{"i":2,"id":"a3","name":"reader C","task":"heatmap, ribbon, map, table, diff, code, snippet","note":"confirmed the unified-diff parser runs at build time and needs only an @@ hunk","state":"done","known":true,"started":1788033424000,"finished":1788033592000},{"i":3,"id":"a4","name":"reader D","task":"candles, chart, ticker, portfolio, waterfall","note":"found waterfall silently ignores a supplied end value, by design","state":"done","known":true,"started":1788033424000,"finished":1788033643000},{"i":4,"id":"a5","name":"reader E","task":"agentboard, audit, logtail, news, rss, weather, clock, countdown, timer","note":"mapped every live card to the route or proxy host it actually calls","state":"done","known":true,"started":1788033424000,"finished":1788033692000},{"i":5,"id":"w1","name":"adopt.mjs","task":"write all thirty-two cards into the deck","note":"the card you are reading is one of its outputs","state":"running","known":true,"started":1788034320000,"finished":null}];
    var SRC      = "";
    var SRC_NOTE = "no live source configured";

    /* view.live is the one flag that decides whether this card may imply it is current.
       Nothing sets it except a fetch that came back with a readable list of agents, and
       everything the caption says branches on it. A board that looks live and is not is
       the failure this card exists to avoid. */
    var view = { rows: STATIC, live: false, at: 0, err: "" };
    var cfg  = {"poll":true,"show":"all","dense":false};
    var stat = { total: 0, shown: 0, run: 0, bad: 0, unk: 0 };
    var groups = [];

    function ckNow() { return Date.now(); }

    function el(tag, cls) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      return e;
    }

    /* The only innerHTML in this card, and it is handed a value from AB_GLYPH - a literal
       written in this file and embedded as a whole object, never anything from the data or
       from the network. The state word beside it goes in through textContent, because that
       IS caller text and an unknown state is spelled however the source spelled it. */
    function pill(a) {
      var p = el("span", "ck-ab-pill"), b = document.createElement("b");
      p.innerHTML = AB_GLYPH[a.known ? a.state : "other"];
      b.textContent = a.state === "" ? "no state" : a.state;
      p.appendChild(b);
      return p;
    }

    function rowFor(a) {
      var r = el("div", "ck-ab-row ck-ab-s-" + (a.known ? a.state : "other"));
      var body = el("span", "ck-ab-body");
      var nm = el("span", "ck-ab-name");
      nm.textContent = a.name;
      body.appendChild(nm);
      if (a.task !== "") {
        var tk = el("span", "ck-ab-task");
        tk.textContent = a.task;
        tk.setAttribute("title", a.task);
        body.appendChild(tk);
      }
      if (a.note !== "") {
        var nt = el("span", "ck-ab-note");
        nt.textContent = a.note;
        body.appendChild(nt);
      }
      var d = el("span", "ck-ab-dur");
      r.appendChild(pill(a));
      r.appendChild(body);
      r.appendChild(d);
      return { el: r, dur: d, a: a };
    }

    function render(now) {
      var ordered = ckOrder(view.rows), frag = document.createDocumentFragment();
      var i, a, key, cur = null, h, lab, num, made;
      groups = [];
      for (i = 0; i < ordered.length; i++) {
        a = ordered[i];
        key = ckGroup(a.state);
        if (cur === null || cur.key !== key) {
          h = el("div", "ck-ab-head ck-h3");
          h.setAttribute("data-grp", key);
          lab = document.createElement("span");
          lab.textContent = key;
          num = document.createElement("b");
          h.appendChild(lab);
          h.appendChild(num);
          cur = { key: key, head: h, num: num, rows: [] };
          groups.push(cur);
          frag.appendChild(h);
        }
        made = rowFor(a);
        cur.rows.push(made);
        frag.appendChild(made.el);
      }
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(frag);
      paint(now);
      applyShow(now);
    }

    /* Every repaint subtracts a fresh clock reading from the recorded start. Nothing here
       adds a second to a running total, and that is the point: a tab that was throttled or
       asleep for ten minutes comes back showing ten more minutes, not the two hundred
       ticks it was actually given. An accumulator would understate the wait, which is the
       one direction that makes this card useless. */
    function paint(now) {
      var i, k, g, sp, cell;
      for (i = 0; i < groups.length; i++) {
        g = groups[i];
        for (k = 0; k < g.rows.length; k++) {
          sp = ckSpan(g.rows[k].a, now);
          cell = g.rows[k].dur;
          cell.textContent = sp.text;
          cell.className = "ck-ab-dur" + (sp.bad ? " ck-ab-odd" : "");
          if (sp.why !== "") cell.setAttribute("title", sp.why);
          else cell.removeAttribute("title");
        }
      }
    }

    function wanted(a) {
      if (cfg.show === "running") return a.state === "running";
      if (cfg.show === "unfinished") return a.state === "running" || a.state === "queued";
      return true;
    }

    function applyShow(now) {
      var i, k, g, vis, ok;
      stat = { total: view.rows.length, shown: 0, run: 0, bad: 0, unk: 0 };
      for (i = 0; i < view.rows.length; i++) {
        if (view.rows[i].state === "running") stat.run = stat.run + 1;
        if (ckSpan(view.rows[i], now).bad) stat.bad = stat.bad + 1;
        if (!view.rows[i].known) stat.unk = stat.unk + 1;
      }
      for (i = 0; i < groups.length; i++) {
        g = groups[i];
        vis = 0;
        for (k = 0; k < g.rows.length; k++) {
          ok = wanted(g.rows[k].a);
          g.rows[k].el.hidden = !ok;
          if (ok) vis = vis + 1;
        }
        /* A heading with nothing under it reads as a category the reader has to go and
           check, so an emptied group hides its heading too. */
        g.head.hidden = vis === 0;
        g.num.textContent = String(vis);
        stat.shown = stat.shown + vis;
      }
      if (voidEl) voidEl.hidden = stat.total !== 0;
      if (noneEl) noneEl.hidden = !(stat.total > 0 && stat.shown === 0);
      caption(now);
    }

    /* Where the rows came from, in words, every time anything changes. Each branch is a
       different sentence on purpose: "no source", "polling off", "not asked yet", "live",
       "was live and has gone quiet", and "never answered, so this is the static list" are
       six genuinely different situations and collapsing any pair of them would let the
       card imply currency it does not have. */
    function caption(now) {
      var ago = ckDur(Math.max(0, now - view.at)), fresh = view.live && view.err === "";
      var say;
      if (SRC === "") say = "static list \u2014 " + SRC_NOTE;
      else if (!cfg.poll) say = "static list \u2014 polling is off in the settings for this card";
      else if (fresh) say = "live \u2014 updated " + ago + " ago";
      else if (view.live) {
        say = "the live source stopped answering (" + view.err +
              ") \u2014 this is the list from " + ago + " ago";
      } else if (view.err !== "") {
        say = "showing a static list because no live source answered (" + view.err + ")";
      } else say = "static list \u2014 waiting for the first answer from " + SRC;

      if (stateEl) stateEl.textContent = say;
      sec.classList.toggle("ck-ab-stale", !fresh);

      if (!countEl) return;
      var parts = [stat.total + (stat.total === 1 ? " agent" : " agents")];
      if (stat.total > 0) parts.push(stat.run + " running");
      if (stat.shown !== stat.total) parts.push(stat.shown + " shown");
      if (stat.bad > 0) {
        parts.push(stat.bad + (stat.bad === 1 ? " row has unusable times"
                                             : " rows have unusable times"));
      }
      if (stat.unk > 0) {
        parts.push(stat.unk + (stat.unk === 1 ? " row carries an unknown state"
                                              : " rows carry unknown states"));
      }
      countEl.textContent = parts.join(" \u00b7 ");
    }

    /* A failed pull never leaves the old picture looking current. If nothing has ever come
       back, the board drops to the static list and the caption says why; if a good list is
       already on screen it stays - throwing away real data over one bad response would be
       worse - but the caption changes to say when it was last true. */
    function pull() {
      if (SRC === "" || !cfg.poll) return;
      fetch(SRC, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then(function (t) {
        var body = null, fine = true, rows;
        try { body = JSON.parse(t); } catch (bad) { fine = false; }
        if (!fine) throw new Error("the answer was not JSON");
        rows = ckNormalize(body);
        if (rows === null) throw new Error("the answer was not a list of agents");
        view.rows = rows;
        view.live = true;
        view.err = "";
        view.at = ckNow();
        render(view.at);
      }).catch(function (why) {
        view.err = why && why.message ? String(why.message) : "no answer";
        if (view.live) caption(ckNow());
        else { view.rows = STATIC; render(ckNow()); }
      });
    }

    CK.settings(sec, {"poll":true,"show":"all","dense":false}, function (got) {
      cfg = got;
      sec.classList.toggle("ck-ab-dense", !!cfg.dense);
      applyShow(ckNow());
    });

    render(ckNow());

    /* Both timers are created on every build and gated inside, rather than created only
       when wanted. CK.timer is keyed by name in a registry that outlives the DOM, so
       creating it again replaces the old one; skipping the call on a swap would leave the
       PREVIOUS interval running against a detached card forever, which is exactly the
       doubling CK.timer exists to prevent. An idle interval costs nothing; a leaked one
       costs a fetch every five seconds for the life of the tab. */
    CK.timer("agentboard:ab-tick", 1000, function () {
      var now = ckNow();
      paint(now);
      caption(now);
    });
    CK.timer("agentboard:ab-poll", AB_POLL, pull);
  });
})();
