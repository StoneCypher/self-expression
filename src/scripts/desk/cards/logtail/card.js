(function () {
  /* A carriage return and a line feed, made from their code points rather than written.
     Both are control characters. Building them arithmetically means no form of this file -
     not the source, not an editor round trip, not a mis-timed decode during emission - can
     end up holding the raw byte, which would be invisible on readback and legal to the
     parser. */
  var CK_LT_CR = String.fromCharCode(13);
  var CK_LT_LF = String.fromCharCode(10);

  /* The severity vocabulary. Substring rather than whole-word, on purpose: logs say "failed",
     "failure", "warning" and "refused", and a word matcher would find none of them. */
  var CK_LT_BAD  = ["error", "fail", "refused"];
  var CK_LT_WARN = ["warn"];

  /* The severity of one already-lowercased line: "err", "warn", or the empty string.
     Severity is drawn three ways in the CSS and only one of them is colour. */
  function ckSev(low) {
    var i;
    for (i = 0; i < CK_LT_BAD.length; i++)  if (low.indexOf(CK_LT_BAD[i]) >= 0)  return "err";
    for (i = 0; i < CK_LT_WARN.length; i++) if (low.indexOf(CK_LT_WARN[i]) >= 0) return "warn";
    return "";
  }

  /* Remove terminal escape sequences, count them, and drop every other C0 byte.

     The introducer is found by comparing a code point to 27. It is never written into a
     string and never spelled in a character class, because a written escape survives
     node --check, reads back as a space, and can be decoded one step early on the way to
     disk. A number can do none of those things.

     Tab, line feed and carriage return are kept: they are layout, not noise. The count is
     reported in the caption, because a log that had colour in it and now does not should say
     so rather than look like a log that never had any.

     Returns the cleaned text, the number of escape sequences removed, and the number of
     stray control bytes removed. */
  function ckAnsiStrip(s) {
    var out = [], ansi = 0, ctrl = 0, i = 0, L = s.length, plain = 0, c, j, k;
    while (i < L) {
      c = s.charCodeAt(i);
      if (c === 27) {
        out.push(s.slice(plain, i));
        ansi = ansi + 1;
        j = i + 1;
        if (j < L) {
          k = s.charCodeAt(j);
          if (k === 91) {
            /* CSI: parameter bytes 0x30..0x3f, intermediates 0x20..0x2f, one final byte. */
            j = j + 1;
            while (j < L) {
              k = s.charCodeAt(j);
              if (k >= 48 && k <= 63) { j = j + 1; continue; }
              if (k >= 32 && k <= 47) { j = j + 1; continue; }
              break;
            }
            if (j < L) j = j + 1;
          } else if (k === 93) {
            /* OSC: runs to a BEL, or to the two bytes that spell a string terminator. A
               window-title sequence in a build log is the common case. */
            j = j + 1;
            while (j < L) {
              k = s.charCodeAt(j);
              if (k === 7) { j = j + 1; break; }
              if (k === 27 && j + 1 < L && s.charCodeAt(j + 1) === 92) { j = j + 2; break; }
              j = j + 1;
            }
          } else if (k >= 32 && k <= 47) {
            /* Intermediates then a final byte: the shape of a charset selection. */
            while (j < L && s.charCodeAt(j) >= 32 && s.charCodeAt(j) <= 47) j = j + 1;
            if (j < L) j = j + 1;
          } else {
            j = j + 1;
          }
        }
        i = j;
        plain = i;
        continue;
      }
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
        out.push(s.slice(plain, i));
        ctrl = ctrl + 1;
        i = i + 1;
        plain = i;
        continue;
      }
      i = i + 1;
    }
    out.push(s.slice(plain, L));
    return { text: out.join(""), ansi: ansi, ctrl: ctrl };
  }

  /* Split a tail response into the lines to display.

     Exactly one trailing empty element is dropped. A file that ends in a newline is not a
     file with a blank last line, and a phantom row at the bottom of a tail is a row that
     appears and disappears every time the file grows.

     Where a line holds carriage returns, only what follows the LAST one is shown. That is
     what a terminal displays for a progress line rewriting itself in place, and showing the
     whole accumulation would be showing something nobody ever saw.

     A trailing carriage return is removed BEFORE that rule is applied, and the order is not
     cosmetic: a file written on Windows ends every line with one, so applying the rule first
     would take what follows the last CR of "a" plus CR, which is nothing at all, and render a
     CRLF log as a column of blank rows. Found exactly that way. */
  function ckSplit(text) {
    var raw = text.split(CK_LT_LF), out = [], i, s, cr;
    if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
    for (i = 0; i < raw.length; i++) {
      s = raw[i];
      if (s.length > 0 && s.charCodeAt(s.length - 1) === 13) s = s.slice(0, s.length - 1);
      cr = s.lastIndexOf(CK_LT_CR);
      out.push(cr < 0 ? s : s.slice(cr + 1));
    }
    return out;
  }

  /* True when prev, with its first d lines dropped, is a prefix of next.

     The final compared line may be a PREFIX of its counterpart rather than equal to it. A file
     whose last line has no newline yet grows in place: the row that read "abc" is now the row
     that reads "abcdef", and treating that as a different file would rebuild the window and
     renumber every row once a second for as long as something is writing to it. */
  function ckSame(prev, next, d) {
    var len = prev.length - d, k;
    if (len > next.length) return false;
    for (k = 0; k < len; k++) {
      if (prev[d + k] === next[k]) continue;
      if (k === len - 1 && next[k].indexOf(prev[d + k]) === 0) continue;
      return false;
    }
    return true;
  }

  /* How many lines fell off the top between two reads of the same window, or -1 when the two
     reads have nothing in common and the window has to be rebuilt.

     This is what lets the card keep its DOM: rows leave at the top, rows arrive at the bottom,
     and the two thousand rows in between are never touched. It is also what makes the scroll
     restore exact, because the pixels that left the top are the only ones that moved the
     content under a viewer who was reading it.

     The search abandons after 64 full comparisons. A log of ten thousand identical lines would
     otherwise make this quadratic every three seconds, and a rebuild is a cheap slightly-wrong
     answer where the alternative is a correct answer that drops frames. */
  function ckDropped(prev, next) {
    var d, tries = 0, one;
    if (prev.length === 0) return 0;
    for (d = 0; d < prev.length; d++) {
      if (prev.length - d > next.length) continue;
      one = prev.length - d === 1;
      if (prev[d] !== next[0] && !(one && next[0].indexOf(prev[d]) === 0)) continue;
      tries = tries + 1;
      if (tries > 64) return -1;
      if (ckSame(prev, next, d)) return d;
    }
    return -1;
  }

  CK.build("logtail", function (sec) {
    var view    = sec.querySelector(".ck-lt-view");
    var rowsEl  = sec.querySelector(".ck-lt-rows");
    var find    = sec.querySelector(".ck-lt-find");
    var countEl = sec.querySelector(".ck-lt-count");
    var noteEl  = sec.querySelector(".ck-lt-note");
    var liveEl  = sec.querySelector(".ck-lt-live");
    if (!view || !rowsEl) return;

    var PATH = "C:/Users/john/AppData/Local/Temp/claude/C--Users-john-projects-self-expression/58cf5997-1157-4c50-b520-91d7306fb59b/scratchpad/build.log";
    var TKEY = "logtail:logtail";

    /* base is the number carried by the first row still held. It counts UP as rows fall off
       the top, so a window that has been open for an hour shows how far the log has run
       rather than restarting at one every poll. A rebuild resets it, because after a rebuild
       the card genuinely does not know where it is any more. */
    var state = {
      rows: [], lines: [], base: 1, want: 500, shown: 0,
      q: find ? find.value.trim().toLowerCase() : "",
      ansi: 0, ctrl: 0, nl: true, mode: "wait", note: ""
    };

    /* The caption is rendered from state rather than written at each call site, so the
       filter changing the count cannot wipe out the note explaining a refusal. */
    function say() {
      var total = state.rows.length, count;
      if (state.mode === "nopath")            count = "no file";
      else if (state.mode === "refused")      count = "unreadable";
      else if (state.mode === "offline")      count = total > 0 ? total + " lines held" : "no data yet";
      else if (state.mode === "wait")         count = "reading";
      else if (total === 0)                   count = "0 lines";
      else if (state.q !== "")                count = "showing " + state.shown + " of " + total + " lines";
      else                                    count = total + (total === 1 ? " line" : " lines");
      if (countEl) countEl.textContent = count;
      if (noteEl)  noteEl.textContent  = state.note;
    }

    /* Write one line into an existing row. Used for new rows and for the one row that can
       change under us, so there is a single place where a log line becomes a row. */
    function fill(r, text, num) {
      var low = text.toLowerCase(), sev = ckSev(low);
      r.el.className = sev === "" ? "ck-lt-row" : "ck-lt-row sev-" + sev;
      r.n.textContent = String(num);
      r.m.textContent = sev === "err" ? "E" : sev === "warn" ? "W" : "";
      if (sev === "") r.m.removeAttribute("title");
      else r.m.setAttribute("title", sev === "err" ? "error" : "warning");
      /* textContent, never innerHTML. A log line that spells a script tag is a line of text
         ABOUT a script tag, and the only way to keep it that way is to never parse it. The
         desk renders text it did not write; this is where that promise is kept. */
      r.x.textContent = text;
      r.hay = low;
    }

    /* A row is five nodes and no listeners. Two thousand rows with a listener each is two
       thousand registrations to make and tear down on every rebuild; the card needs none, so
       it has none. */
    function makeRow(text, num) {
      var el = document.createElement("div");
      var g  = document.createElement("span");
      var n  = document.createElement("span");
      var m  = document.createElement("span");
      var x  = document.createElement("span");
      g.className = "ck-lt-g"; n.className = "ck-lt-n";
      m.className = "ck-lt-m"; x.className = "ck-lt-x";
      g.appendChild(n); g.appendChild(m);
      el.appendChild(g); el.appendChild(x);
      var r = { el: el, n: n, m: m, x: x, hay: "" };
      fill(r, text, num);
      return r;
    }

    /* Hiding rather than removing, so following and filtering do not have to know about each
       other: a poll appends rows and this decides which of them are visible. The haystack is
       the lowercased line, computed once when the row was made. */
    function applyFilter() {
      var q = state.q, i, r, hide, shown = 0;
      for (i = 0; i < state.rows.length; i++) {
        r = state.rows[i];
        hide = q !== "" && r.hay.indexOf(q) < 0;
        if (r.el.hidden !== hide) r.el.hidden = hide;
        if (!hide) shown = shown + 1;
      }
      state.shown = shown;
    }

    function render(next) {
      /* THE SCROLL RULE. This is the whole ergonomics of the card and it is four lines.

         Measured BEFORE the DOM changes and restored after. A viewer sitting at the bottom is
         FOLLOWING, so the view goes back to the bottom and new lines appear under the old
         ones - that is what a tail is for. A viewer who has scrolled up is READING, and
         dragging them to the end every three seconds makes the card useless for the single
         thing anybody opens a log to do. So their pixel offset is put back exactly, less the
         height of whatever fell off the top of the window, which is the only thing that
         legitimately moved the content underneath them.

         The four pixels of slack are not superstition: a fractional scrollHeight and a
         device-pixel-rounded scrollTop rarely add up to exactly zero, and a viewer who IS at
         the bottom must not be read as scrolled away because the numbers missed by half a
         pixel and then never follow again. */
      var pinned = view.scrollHeight - view.scrollTop - view.clientHeight <= 4;
      var top = view.scrollTop;
      var lost = 0, i, k;

      var d = ckDropped(state.lines, next);
      if (d < 0) {
        /* Nothing in common: the file was rotated, truncated or replaced. Rebuild, and admit
           it by restarting the numbering rather than pretending the count carried over. */
        while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);
        state.rows = []; state.lines = []; state.base = 1; d = 0;
      } else if (d > 0) {
        for (i = 0; i < d; i++) {
          lost = lost + state.rows[i].el.offsetHeight;
          rowsEl.removeChild(state.rows[i].el);
        }
        state.rows = state.rows.slice(d);
        state.base = state.base + d;
      }

      var keep = state.lines.length - d;
      /* The last kept row is rewritten rather than trusted: a final line with no newline
         grows in place, so the row that was "abc" is the row that is now "abcdef" and
         nothing else in this function would notice. */
      if (keep > 0) fill(state.rows[keep - 1], next[keep - 1], state.base + keep - 1);

      var frag = document.createDocumentFragment();
      for (k = keep; k < next.length; k++) {
        var r = makeRow(next[k], state.base + k);
        state.rows.push(r);
        frag.appendChild(r.el);
      }
      /* One insertion for the whole batch. Two thousand appendChild calls against a live tree
         is two thousand chances to relayout, and a poll that stutters is a poll the viewer
         feels every three seconds. */
      rowsEl.appendChild(frag);
      state.lines = next;

      applyFilter();
      if (pinned) view.scrollTop = view.scrollHeight;
      else view.scrollTop = top - lost;
    }

    function accept(body) {
      var strip = ckAnsiStrip(body);
      state.ansi = strip.ansi;
      state.ctrl = strip.ctrl;
      /* Code point 10 rather than a written newline. Comparing numerically is the one form
         of this test that cannot be corrupted into holding the byte it is looking for. */
      state.nl = body.length === 0 || body.charCodeAt(body.length - 1) === 10;
      render(ckSplit(strip.text));
      state.mode = "ok";
      var bits = [];
      if (state.rows.length === 0) bits.push("the file is empty");
      if (state.ansi > 0) bits.push(state.ansi + (state.ansi === 1 ? " ansi escape stripped" : " ansi escapes stripped"));
      if (state.ctrl > 0) bits.push(state.ctrl + (state.ctrl === 1 ? " control byte removed" : " control bytes removed"));
      if (!state.nl) bits.push("last line has no trailing newline");
      state.note = bits.join(" \u00b7 ");
      sec.classList.remove("ck-lt-bad");
      say();
    }

    function refuse(status, body) {
      /* The server explains itself in the body and its words go into the caption unchanged.
         "The desk is not allowed to read that", "no such file" and "the file is empty" are
         three different facts, and a generic failure message makes them one - which sends
         the reader hunting for a bug in the file when the answer was in the response all
         along. Nothing is rewritten here, not even the wording. */
      state.mode = "refused";
      state.note = body === "" ? "HTTP " + status : body;
      sec.classList.add("ck-lt-bad");
      say();
    }

    function offline() {
      /* Whatever was read last stays on screen. A log that blanks itself because the server
         was restarted has thrown away the only copy of what it was showing, and the timer
         is still running, so the next poll will simply succeed. */
      state.mode = "offline";
      state.note = "the desk is not answering \u00b7 still trying";
      sec.classList.add("ck-lt-bad");
      say();
    }

    function poll() {
      if (PATH === "") { state.mode = "nopath"; state.note = "this card was built without a path"; say(); return; }
      /* Plain fetch, not CK.net: /tail is the desk's own server on the same origin, and
         CK.net is the proxy for reaching somewhere else. The response is text, not JSON.

         The rejection handler is the SECOND argument to then rather than a catch on the end,
         so a bug thrown inside accept cannot be reported to the viewer as the server being
         down. Those two failures need different words and different actions. */
      fetch("/tail?f=" + encodeURIComponent(PATH) + "&n=" + state.want, { cache: "no-store" })
        .then(function (r) {
          var ok = r.ok, status = r.status;
          return r.text().then(function (body) { return { ok: ok, status: status, body: body }; });
        })
        .then(function (res) { if (res.ok) accept(res.body); else refuse(res.status, res.body); },
              function () { offline(); });
    }

    if (find) CK.once(find, "find", function () {
      find.addEventListener("input", function () {
        /* Filtering never touches the timer or the fetched window: it decides which of the
           rows already here are visible. Following a filtered log keeps working, and it
           keeps working on the rows that arrive next. */
        state.q = find.value.trim().toLowerCase();
        applyFilter();
        say();
      });
    });

    var was = null;
    CK.settings(sec, {"lines":500,"follow":true,"wrap":false,"interval":3}, function (c) {
      /* A select hands back a string. Every numeric setting is coerced here rather than
         trusted, because "2000" + 1 is "20001" and that is a query string asking the server
         for twenty thousand lines. Stored values are re-vetted for the same reason: local
         storage is a text file the viewer can edit. */
      var want = Number(c.lines);
      if (!isFinite(want) || want <= 0) want = 500;
      var secs = Number(c.interval);
      if (!isFinite(secs) || secs <= 0) secs = 3;
      var follow = !!c.follow;

      sec.classList.toggle("ck-lt-wrap", !!c.wrap);
      sec.classList.toggle("ck-lt-on", follow);
      if (liveEl) liveEl.textContent = follow ? "following" : "paused";
      state.want = want;

      /* Wrapping is a paint. Re-reading the file because somebody ticked a checkbox about
         line breaking would be a fetch nobody asked for, so only the settings that change
         what is fetched, or how often, restart the timer. */
      var moved = was === null || was.want !== want || was.secs !== secs || was.follow !== follow;
      was = { want: want, secs: secs, follow: follow };
      if (!moved) { say(); return; }
      if (PATH === "") { state.mode = "nopath"; state.note = "this card was built without a path"; say(); return; }

      /* CK.timer, never a bare setInterval. The desk swaps its main element and replays every
         builder, and CK.once cannot guard this: once keys off the ELEMENT, and a swap hands
         the builder a brand new one with an empty dataset, so the guard passes and a second
         interval starts while the first keeps polling at a detached tree. CK.timer keys off a
         name in a registry that outlives the DOM, so this replaces rather than stacks.

         With following switched off the same call is made and stopped immediately: CK.timer
         runs its work once before it schedules anything, so that reads the file exactly once
         and leaves no interval behind - including any interval a previous run started. */
      var stop = CK.timer(TKEY, secs * 1000, poll);
      if (!follow) stop();
    });
  });
})();
