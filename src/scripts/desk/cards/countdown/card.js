(function () {
  'use strict';

  var ID     = "countdown";
  var TARGET = 1798761600000;
  var RAW    = "2027-01-01T00:00:00Z";
  var LABEL  = "UTC new year";
  var DEF    = {"unitsShown":"auto","seconds":true,"past":"up"};
  var TICK   = 250;
  var BACK   = 2000;
  var BADMSG = "the target could not be read as a moment in time";

  /* A local copy of CK.esc, so nothing written into the card can become an injection point
     even if the kit is ever loaded in a reduced form on some other desk. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function pad2(v) { return (v < 10 ? "0" : "") + v; }

  /* Thousand separators, hand-rolled. toLocaleString would group by the viewer locale, and
     these figures sit in a fixed row that should not change shape by region. */
  function group(n) {
    var s = String(n), out = "", i = s.length;
    while (i > 3) { out = "," + s.slice(i - 3, i) + out; i -= 3; }
    return s.slice(0, i) + out;
  }

  /* Days, hours, minutes and seconds of a DURATION — never of a calendar. A day here is
     86,400,000 milliseconds, full stop. Counting calendar days would need a zone, and a
     calendar day across a daylight-saving boundary is 23 hours or 25, so the figures under
     it would stop adding up to it twice a year and nothing would report an error. */
  function unitVals(ms, wantSeconds) {
    var t = Math.floor((ms > 0 ? ms : 0) / 1000);
    var out = [
      { k: "d", v: Math.floor(t / 86400) },
      { k: "h", v: Math.floor(t / 3600) % 24 },
      { k: "m", v: Math.floor(t / 60) % 60 }
    ];
    if (wantSeconds) out.push({ k: "s", v: t % 60 });
    return out;
  }

  /* "auto" reads as 0 here, and so does any value the panel could not have produced. */
  function pinOf(cfg) {
    var n = Math.floor(Number(cfg.unitsShown));
    if (!isFinite(n) || n < 2) return 0;
    return n > 4 ? 4 : n;
  }

  /* Which units to show. A pin takes that many from the top, zeroes included, because the
     reason to pin is to stop the card changing width. Auto drops leading zeroes but never
     the last unit, so a card that has run down to nothing still shows a nought rather than
     an empty row. */
  function pick(vals, pin) {
    var i = 0;
    if (pin > 0) return vals.slice(0, pin > vals.length ? vals.length : pin);
    while (i < vals.length - 1 && vals[i].v === 0) i += 1;
    return vals.slice(i);
  }

  /* Markup from numbers and fixed literals only: every value here came out of Math.floor a
     line ago, and the unit letters are literals written just above. Escaped anyway, because
     the day one of these arrives from data instead is the day that stops being true. */
  function blocks(list) {
    var out = "", i, u;
    for (i = 0; i < list.length; i += 1) {
      u = list[i];
      out += "<span class=\"ck-u\"><b>" + esc(i === 0 ? group(u.v) : pad2(u.v)) +
             "</b><i>" + esc(u.k) + "</i></span>";
    }
    return out;
  }

  CK.build(ID, function (sec) {

    var units = sec.querySelector(".ck-units"),
        when  = sec.querySelector(".ck-when"),
        cap   = sec.querySelector(".ck-cap");

    var cfg  = null;
    var prev = 0;
    var backwards = false;
    var whenFmt = null;
    var last = { units: "", when: "", cap: "", state: "", wide: "" };

    /* The wall-clock half, and the ONLY wall-clock half. Intl is asked in whatever zone the
       viewer is sitting in, because "when does this fall for me" is a question about a place
       — and the arithmetic above is deliberately not. */
    function whenText() {
      if (TARGET === null) return RAW ? ("the value given was: " + RAW) : "no target was given";
      try {
        if (!whenFmt) {
          whenFmt = new Intl.DateTimeFormat(undefined, {
            weekday: "short", year: "numeric", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit", timeZoneName: "short"
          });
        }
        return "target " + whenFmt.format(new Date(TARGET));
      } catch (e) {
        /* A target far enough out that a formatter refuses it is still a real instant, and
           the countdown above it is still correct; only this line has to give up. */
        return "target " + RAW;
      }
    }

    function caption(state, stop) {
      var bits = [];
      if (LABEL) bits.push("<b>" + esc(LABEL) + "</b>");
      if (TARGET === null) {
        bits.push("<i>nothing to count to</i>");
        return bits.join(" ");
      }
      if (state === "future") bits.push("<i>counting down</i>");
      else if (state === "now") bits.push("<i>the moment is now</i>");
      else bits.push(stop ? "<i>reached, and stopped at zero</i>"
                          : "<i>counting up since it passed</i>");
      bits.push("<span class=\"ck-aside\">days here are 24-hour spans; the line above is " +
                "your own wall clock</span>");
      if (backwards) {
        bits.push("<span class=\"ck-aside\">the device clock moved backwards, and this " +
                  "reading follows it</span>");
      }
      return bits.join(" ");
    }

    function setHTML(el, key, val) {
      if (last[key] === val) return;
      last[key] = val;
      if (el) el.innerHTML = val;
    }

    function setAttr(key, name, val) {
      if (last[key] === val) return;
      last[key] = val;
      sec.setAttribute(name, val);
    }

    function render() {
      if (!cfg) return;
      var now = Date.now();

      /* This card is a subtraction from the device clock, so it follows the clock exactly,
         including backwards. A viewer watching the figure climb when it should fall is owed
         the reason, and the reason is the machine rather than the card. */
      if (prev !== 0 && prev - now > BACK) backwards = true;
      prev = now;

      /* Written before the refusal branch and compared on the TEXT rather than on the raw
         target: an unreadable target is often an empty one, and comparing against the raw
         value meant the empty case matched the initial empty state and the line never got
         written at all. The card said nothing precisely where it had most to say. */
      var w = whenText();
      if (when && w !== last.when) { last.when = w; when.textContent = w; }

      if (TARGET === null) {
        setAttr("state", "data-state", "bad");
        setHTML(units, "units", "<span class=\"ck-bad\">" + esc(BADMSG) + "</span>");
        setHTML(cap, "cap", caption("bad", false));
        return;
      }

      /* Instants, both of them. Nothing here touches a calendar. */
      var diff = TARGET - now;
      var away = diff < 0 ? -diff : diff;
      var stop = cfg.past === "stop";
      var state = away < 1000 ? "now" : diff > 0 ? "future" : "past";

      /* Exactly at the target, and for the second either side of it, the card says so
         rather than flickering between a 1 and a 0 in the smallest unit shown. */
      var show = state === "future" ? diff : (state === "now" || stop) ? 0 : away;

      var list = pick(unitVals(show, !!cfg.seconds), pinOf(cfg));
      var mk = blocks(list);
      if (state === "past" && !stop) mk += "<span class=\"ck-ago\">ago</span>";
      setHTML(units, "units", mk);

      /* The leading figure is the only one that can grow without bound: a target a few
         thousand years out is a six-digit day count. Past four characters the row steps
         down a size instead of wrapping or pushing the card sideways. */
      var head = list.length ? group(list[0].v) : "";
      setAttr("wide", "data-wide", head.length > 4 ? "on" : "off");
      setAttr("state", "data-state", state === "past" && stop ? "reached" : state);

      setHTML(cap, "cap", caption(state, stop));
    }

    /* Settings first: the tick has to have a settled config to draw from. */
    CK.settings(sec, DEF, function (next) { cfg = next; render(); });

    /* CK.timer rather than setInterval, and rather than CK.once around a setInterval:
       once keys off the ELEMENT, and a main swap hands the builder a fresh element with an
       empty dataset, so the guard passes, a second interval starts, and the first one keeps
       running against a node nobody can see. The registry CK.timer keys into outlives the
       DOM, so the swap replaces the interval instead of stacking another one on it. */
    CK.timer(ID + ":tick", TICK, render);
  });
})();