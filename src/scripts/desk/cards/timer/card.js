(function () {
  'use strict';

  var ID      = "timer";
  var MODE    = "pomodoro";
  var LABEL   = "card review";
  var DEF     = {"work":25,"rest":5,"rounds":4,"chime":false};
  var KEY     = "desk.timer." + ID;
  var TICK    = 250;
  var FLASH   = 1400;
  var SLACK   = 1000;
  var MAXMIN  = 10080;
  var MAXRND  = 999;
  var CIRC    = 263.89;
  var CHIMSG  = "Chime flashes the card: a card has no audio channel on this desk, so it cannot make a sound.";

  /* A local copy of CK.esc, so the caption cannot become an injection point even if the
     kit is ever loaded in a reduced form on some other desk. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function pad2(v) { return (v < 10 ? "0" : "") + v; }

  /* Thousand separators, hand-rolled. toLocaleString would group by the viewer locale, and
     this number sits against a fixed-width HH:MM:SS that should not change shape by region. */
  function group(n) {
    var s = String(n), out = "", i = s.length;
    while (i > 3) { out = "," + s.slice(i - 3, i) + out; i -= 3; }
    return s.slice(0, i) + out;
  }

  /* A duration as text. Days appear only once there are days, so a two-minute stopwatch is
     not padded out with zeroes it has not earned, and a run left going over a long weekend
     reads as "2d 14:03:11" rather than as 62 hours or as an overflowing line. */
  function dur(ms) {
    var t = Math.floor((ms > 0 ? ms : 0) / 1000);
    var d = Math.floor(t / 86400);
    var h = Math.floor(t / 3600) % 24;
    var m = Math.floor(t / 60) % 60;
    var s = t % 60;
    if (d > 0) return group(d) + "d " + pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    if (h > 0) return pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    return pad2(m) + ":" + pad2(s);
  }

  /* A whole number, or the fallback. Used for rounds, where 0 is a real meaning; NOT used
     for work and rest, where a 0 has to reach the viewer as a refusal rather than be
     quietly rounded up into an interval nobody asked for. */
  function whole(v, fb) {
    var n = Math.floor(Number(v));
    return isFinite(n) ? n : fb;
  }

  function store() { try { return window.localStorage || null; } catch (e) { return null; } }

  function blank() { return { running: false, start: 0, banked: 0 }; }

  /* The run is persisted as an INSTANT plus a banked total, never as a remaining count.
     A remaining count has to be rewritten on every tick, so a reload lands on whichever
     write happened to be last; and while the tab is shut nothing is counting at all, so a
     session started before lunch would still claim sixteen minutes left an hour later —
     confidently wrong in exactly the situation the persistence was added for. An instant
     needs one write per button press and is still true after the machine has slept. */
  function save(st) {
    var s = store();
    if (!s) return;
    try {
      s.setItem(KEY, JSON.stringify({ v: 1, mode: MODE, running: !!st.running,
                                      start: st.start, banked: st.banked }));
    } catch (e) { /* private window: the timer still runs, it just will not outlive the tab */ }
  }

  /* Read the run back distrusting every field: this is a text file the viewer can open and
     edit, so a string where a number belongs, or a start instant sitting in next week, has
     to produce a working card and an explanation rather than a display of nonsense. */
  function load(now) {
    var s = store(), raw = null, o = null;
    if (!s) return { st: blank(), warn: "" };
    try { raw = s.getItem(KEY); } catch (e) { return { st: blank(), warn: "" }; }
    if (!raw) return { st: blank(), warn: "" };
    try { o = JSON.parse(raw); } catch (e) { return { st: blank(), warn: "stored" }; }
    if (!o || typeof o !== "object") return { st: blank(), warn: "stored" };
    if (o.mode !== MODE) return { st: blank(), warn: "" };
    var start = Number(o.start), banked = Number(o.banked);
    if (!isFinite(start) || !isFinite(banked) || start < 0 || banked < 0 || banked > 1e14) {
      return { st: blank(), warn: "stored" };
    }
    var st = { running: !!o.running, start: start, banked: banked };
    /* A stored start ahead of the clock cannot be a start: it means the device clock moved,
       or the file was edited. Either way the run is not measurable, so it is dropped and
       the caption says so rather than showing a negative or a plausible wrong number. */
    if (st.running && start - now > SLACK) return { st: blank(), warn: "future" };
    return { st: st, warn: "" };
  }

  CK.build(ID, function (sec) {

    var out   = sec.querySelector(".ck-elapsed"),
        arc   = sec.querySelector(".ck-arc-run"),
        ptext = sec.querySelector(".ck-phase-t"),
        rnds  = sec.querySelector(".ck-rounds"),
        cap   = sec.querySelector(".ck-cap"),
        go    = sec.querySelector(".ck-go"),
        rst   = sec.querySelector(".ck-reset");

    var boot   = load(Date.now());
    var st     = boot.st;
    var warn   = boot.warn;
    var cfg    = null;
    var lastKey = null;
    var alertT = 0;
    var last   = { txt: "", phase: "", rounds: "", cap: "", go: "", state: "" };

    /* Elapsed is a SUBTRACTION and never a sum. Nothing on this card is accumulated per
       tick, because a background tab has its intervals clamped to a second at best and to
       nothing at all while the machine sleeps — so a card adding its tick interval to a
       running total would under-count by minutes across a lunch break and then present
       that under-count as a finished twenty-five minute session. Storing the instant makes
       the tick a repaint rather than a measurement: miss a thousand of them and the next
       one still shows the truth. */
    function elapsed(now) {
      if (!st.running) return st.banked;
      var d = now - st.start;
      if (d < 0) d = 0;
      return st.banked + d;
    }

    /* Everything the card shows for one instant, derived rather than remembered.

       The pomodoro phase and round come out of the total elapsed by division, not out of a
       counter advanced at each transition. Same discipline as the readout and it matters
       for the same reason: a tab hidden through two whole intervals gets its next tick in
       the right phase of the right round, because nothing was ever counting transitions. */
    function plan(now) {
      var e = elapsed(now);
      var v = { e: e, frac: 0, phase: "none", round: 0, rounds: 0, done: false, bad: "" };

      if (MODE !== "pomodoro") {
        v.frac = (e % 60000) / 60000;
        return v;
      }

      var wm = whole(cfg.work, 0), rm = whole(cfg.rest, 0);
      if (wm > MAXMIN) wm = MAXMIN;
      if (rm > MAXMIN) rm = MAXMIN;
      /* A zero-length interval has no progress to draw and no moment to end on. Refused in
         front of the viewer, with the arc left at zero: nothing is divided here. */
      if (wm < 1 || rm < 1) {
        v.bad = "work and rest must each be at least one minute";
        return v;
      }

      var n = whole(cfg.rounds, 0);
      if (n < 0) n = 0;
      if (n > MAXRND) n = MAXRND;
      v.rounds = n;

      var w = wm * 60000, r = rm * 60000, cyc = w + r;
      if (n > 0 && e >= n * cyc) {
        v.done = true; v.round = n; v.phase = "rest"; v.frac = 1; v.e = n * cyc;
        return v;
      }

      var k = Math.floor(e / cyc), into = e - k * cyc;
      v.round = k + 1;
      if (into < w) { v.phase = "work"; v.frac = into / w; }
      else { v.phase = "rest"; v.frac = (into - w) / r; }
      return v;
    }

    /* The stand-in for a chime. A brief emphasis of the whole card, removed again on a
       timeout; under reduced motion the CSS drops the transition and it becomes a plain
       outline held for the same beat, which is the same signal without the movement. */
    function flash() {
      if (!sec.classList) return;
      sec.classList.add("ck-alert");
      clearTimeout(alertT);
      alertT = setTimeout(function () { sec.classList.remove("ck-alert"); }, FLASH);
    }

    function setText(el, key, val) {
      if (last[key] === val) return;
      last[key] = val;
      if (el) el.textContent = val;
    }

    function roundsMarkup(v) {
      if (MODE !== "pomodoro" || v.bad) return "";
      var text = v.done ? ("all " + v.rounds + " rounds done")
               : v.rounds > 0 ? ("round " + v.round + " of " + v.rounds)
               : ("round " + v.round + ", no limit");
      var dots = "", i, cls;
      /* Past a dozen the dots stop being a picture and start being a wall, so the count
         carries it alone. */
      if (v.rounds > 0 && v.rounds <= 12) {
        for (i = 1; i <= v.rounds; i++) {
          cls = (v.done || i < v.round) ? " on" : (i === v.round ? " now" : "");
          dots += "<i class=\"ck-dot" + cls + "\"></i>";
        }
      }
      return "<span>" + esc(text) + "</span>" + dots;
    }

    function caption(v) {
      var bits = [];
      if (LABEL) bits.push("<b>" + esc(LABEL) + "</b>");
      if (MODE === "pomodoro") {
        bits.push("<i>pomodoro " + esc(whole(cfg.work, 0)) + " + " + esc(whole(cfg.rest, 0)) +
                  " min" + (v.rounds > 0 ? (", " + v.rounds + " rounds") : ", no round limit") + "</i>");
      } else {
        bits.push("<i>stopwatch; the ring sweeps the current minute</i>");
      }
      if (v.bad) {
        bits.push("<span class=\"ck-aside\">" + esc(v.bad) +
                  ", so this session will not start</span>");
      }
      if (warn === "future") {
        bits.push("<span class=\"ck-aside\">the saved start was ahead of this device clock, " +
                  "so the clock changed and the run was reset</span>");
      }
      if (warn === "back") {
        bits.push("<span class=\"ck-aside\">the device clock moved backwards, so the run was " +
                  "reset rather than reported wrong</span>");
      }
      if (warn === "stored") {
        bits.push("<span class=\"ck-aside\">the saved run could not be read, so this starts " +
                  "from zero</span>");
      }
      if (cfg.chime) bits.push("<span class=\"ck-aside\">" + esc(CHIMSG) + "</span>");
      return bits.join(" ");
    }

    function render() {
      if (!cfg) return;
      var now = Date.now();

      /* A start instant ahead of the clock means the clock moved, not that time did.
         Carrying on would show a negative elapsed or, worse, a plausible wrong one. */
      if (st.running && st.start - now > SLACK) {
        st = blank(); warn = "back"; lastKey = null; save(st);
      }

      var v = plan(now);

      /* Finishing banks the exact session length, so the frozen readout is the session and
         not whenever the last tick happened to land. */
      if (v.done && st.running) {
        st.running = false; st.start = 0; st.banked = v.e; save(st);
      }

      var txt = dur(v.e);
      setText(out, "txt", txt);
      sec.setAttribute("data-wide", txt.length > 8 ? "on" : "off");

      var f = v.frac;
      if (!isFinite(f) || f < 0) f = 0;
      if (f > 1) f = 1;
      if (arc) {
        arc.setAttribute("stroke-dasharray",
                         (Math.round(CIRC * f * 100) / 100) + " " + CIRC);
      }

      sec.setAttribute("data-phase", MODE === "pomodoro" && !v.bad ? v.phase : "none");
      setText(ptext, "phase", MODE === "pomodoro" && !v.bad ? v.phase : "");

      var rm = roundsMarkup(v);
      if (rm !== last.rounds) { last.rounds = rm; if (rnds) rnds.innerHTML = rm; }

      var state = v.bad ? "refused" : v.done ? "done"
                : st.running ? "running" : (st.banked > 0 ? "paused" : "idle");
      if (state !== last.state) { last.state = state; sec.setAttribute("data-state", state); }

      var glabel = v.bad ? "start" : v.done ? "restart" : st.running ? "pause"
                 : (st.banked > 0 ? "resume" : "start");
      setText(go, "go", glabel);
      if (go) go.disabled = !!v.bad;

      var c = caption(v);
      if (c !== last.cap) { last.cap = c; if (cap) cap.innerHTML = c; }

      /* One key for "which interval of which round are we in". When it changes, an interval
         turned over. The first render after a build only establishes the baseline, so a
         page swap cannot flash a card at someone for standing still. */
      var key = MODE === "pomodoro"
              ? (v.bad ? "bad" : v.done ? "done" : v.phase + ":" + v.round) : "";
      if (lastKey === null) lastKey = key;
      else if (key !== lastKey) { lastKey = key; if (cfg.chime) flash(); }
    }

    function toggle() {
      var now = Date.now();
      var v = plan(now);
      if (v.bad) return;
      if (v.done) { st = blank(); st.running = true; st.start = now; }
      else if (st.running) { st.banked = elapsed(now); st.running = false; st.start = 0; }
      else { st.start = now; st.running = true; }
      warn = ""; lastKey = null;
      save(st);
      render();
    }

    function reset() {
      st = blank(); warn = ""; lastKey = null;
      save(st);
      render();
    }

    /* Settings first: the tick has to have a settled config to draw from. */
    CK.settings(sec, DEF, function (next) { cfg = next; lastKey = null; render(); });

    /* once keys off the element, and a swap hands over a brand new button with an empty
       dataset, so this attaches exactly one listener to whichever button is live. */
    CK.once(go, "go", function () { go.addEventListener("click", toggle); });
    CK.once(rst, "reset", function () { rst.addEventListener("click", reset); });

    /* CK.timer rather than setInterval, and rather than CK.once around a setInterval:
       once keys off the ELEMENT, and a main swap hands the builder a fresh element with an
       empty dataset, so the guard passes, a second interval starts, and the first one keeps
       running against a node nobody can see. The registry CK.timer keys into outlives the
       DOM, so the swap replaces the interval instead of stacking another one on it. */
    CK.timer(ID + ":tick", TICK, render);
  });
})();