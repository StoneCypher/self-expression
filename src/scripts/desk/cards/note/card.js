(function () {
  var ID    = "note";
  var KEY   = "desk.note." + ID;
  var PROBE = "desk.note.probe";
  var SEED  = {"mono":false,"rows":7,"wrap":true};
  var MAX   = 100000;
  var MAXT  = "100,000";
  var WAIT  = 400;

  /* Reaching localStorage can itself throw: some browsers make the property access raise
     rather than returning a store that fails later. Every touch of it is guarded. */
  function getStore() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  /* Presence is not permission. A private window hands back a real-looking store whose first
     write throws, so the only honest test is a write. Done once, at wiring time, so the
     warning is on screen before anyone types instead of after they have lost the afternoon. */
  function canWrite() {
    var s = getStore();
    if (!s) return false;
    try { s.setItem(PROBE, "1"); s.removeItem(PROBE); return true; }
    catch (e) { return false; }
  }

  /* What is stored for this card, and in what condition.
     Four answers rather than a string-or-null, because the card says something different for
     each of them and a caller that cannot tell them apart would have to guess. */
  function readStored() {
    var s = getStore();
    if (!s) return { kind: "nostore" };
    var v;
    try { v = s.getItem(KEY); } catch (e) { return { kind: "nostore" }; }
    if (v === null || v === undefined) return { kind: "none" };
    /* Anything read back out of storage is re-vetted: it is a text file the viewer can edit,
       and a shim or a hand-edit can put a non-string there. */
    if (typeof v !== "string") return { kind: "junk" };
    if (v.length > MAX) return { kind: "big", text: v.slice(0, MAX), was: v.length };
    return { kind: "ok", text: v };
  }

  function words(t) {
    var trimmed = t.replace(/^\s+/, "").replace(/\s+$/, "");
    return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  CK.build(ID, function (sec) {

    var ta      = sec.querySelector(".ck-n-ta");
    var stateEl = sec.querySelector(".ck-n-state");
    var countEl = sec.querySelector(".ck-n-count");
    var noteEl  = sec.querySelector(".ck-n-note");
    var resetEl = sec.querySelector(".ck-n-reset");
    if (!ta) return;

    var seedText = ta.getAttribute("data-seed");
    if (seedText === null || seedText === undefined) seedText = "";

    var armed = false;

    /* The indicator, and the only place its three words are written.
       They are three because they are three different facts: the note is on disk, the note is
       about to be, or the note is not and will not be. Collapsing the third into either of the
       others is the lie this card exists to refuse. */
    function setState(kind, msg) {
      if (!stateEl) return;
      stateEl.className = "ck-n-state ck-n-" + kind;
      stateEl.textContent = msg;
    }

    function setNote(msg) { if (noteEl) noteEl.textContent = msg; }

    function recount() {
      if (!countEl) return;
      var t = ta.value;
      countEl.textContent = plural(words(t), "word", "words") + ", "
        + plural(t.length, "character", "characters");
    }

    /* The write. Every branch that fails to store something says which branch it was.
       An over-cap note is deliberately left in the box rather than trimmed: the text in front
       of the viewer is still theirs to copy out, and cutting it to fit would be this card
       destroying data to make its own storage problem go away. */
    function flush() {
      var t = ta.value;
      if (t.length > MAX) {
        setState("bad", "not saved \u2014 over the " + MAXT + " character cap");
        setNote("this note is " + t.length + " characters, past the " + MAXT
          + " character cap. nothing is being written; copy it somewhere else before you close the tab.");
        return;
      }
      var s = getStore();
      if (!s) { setState("bad", "not saved \u2014 storage is unavailable"); return; }
      try { s.setItem(KEY, t); }
      catch (e) {
        setState("bad", "not saved \u2014 storage is unavailable");
        setNote("the browser refused the write ("
          + (e && e.name ? e.name : "no reason given")
          + "). nothing typed here is being kept; copy it somewhere else.");
        return;
      }
      setState("ok", "saved");
      setNote("");
    }

    /* The debounce id lives in a registry that outlives the DOM, for the same reason CK.timer
       does. A main swap replaces this element while a write is still pending; the pending
       write closes over the OLD textarea and would put its stale text over the new one a few
       hundred milliseconds after the swap. Clearing by key at build time makes that impossible. */
    window.__ckNoteT = window.__ckNoteT || {};
    clearTimeout(window.__ckNoteT[KEY]);

    function schedule() {
      setState("busy", "saving\u2026");
      clearTimeout(window.__ckNoteT[KEY]);
      window.__ckNoteT[KEY] = setTimeout(flush, WAIT);
    }

    /* ── settling what the box holds ────────────────────────────────────────────────── */

    var writable = canWrite();
    var got = readStored();

    if (got.kind === "ok") {
      /* Stored beats seed. Always, including the empty string: a note someone deliberately
         cleared must stay cleared, or every reload undoes the clearing. */
      ta.value = got.text;
      setState("ok", got.text === "" ? "saved (empty)" : "saved");
      setNote("");
    } else if (got.kind === "big") {
      ta.value = got.text;
      setState("bad", "not saved \u2014 over the " + MAXT + " character cap");
      setNote("the stored note is " + got.was + " characters; the first " + MAXT
        + " are shown. editing here will overwrite the rest, so copy it out first if you want it.");
    } else if (got.kind === "junk") {
      /* The seed stands, and the card says why rather than appearing to have eaten the note. */
      setState("bad", "not saved \u2014 the stored note was unreadable");
      setNote("what was stored for this card was not text, so it is being ignored and the seed is shown. typing will replace it.");
    } else if (got.kind === "nostore" || !writable) {
      setState("bad", "not saved \u2014 storage is unavailable");
      setNote("this browser is not letting the desk store anything \u2014 a private window does this. what you type stays on screen and is gone when the card reloads.");
    } else {
      /* Nothing stored yet. Saying "saved" here would be a lie about text that exists only in
         the card definition, so the indicator says exactly what is true. */
      setState("seed", "not saved yet \u2014 this is the seed");
      setNote("");
    }
    recount();

    /* ── wiring ─────────────────────────────────────────────────────────────────────── */

    CK.once(ta, "edit", function () {
      ta.addEventListener("input", function () { recount(); schedule(); });
      /* Leaving the box flushes immediately. Closing a tab inside the debounce window would
         otherwise drop the last few hundred milliseconds of typing, which is exactly the kind
         of small silent loss this card is built to not have. */
      ta.addEventListener("blur", function () {
        clearTimeout(window.__ckNoteT[KEY]);
        flush();
      });
    });

    if (resetEl) CK.once(resetEl, "reset", function () {
      resetEl.addEventListener("click", function () {
        /* Two clicks, because this discards writing. The first arms and says so; the second
           does it. A card whose settings panel can destroy a note with one stray click is a
           card that will eventually destroy one. */
        if (!armed) {
          armed = true;
          resetEl.textContent = "click again to discard";
          resetEl.className = "ck-n-reset ck-n-armed";
          resetEl.__ckArm = setTimeout(function () {
            armed = false;
            resetEl.textContent = "reset to seed";
            resetEl.className = "ck-n-reset";
          }, 4000);
          return;
        }
        clearTimeout(resetEl.__ckArm);
        armed = false;
        resetEl.textContent = "reset to seed";
        resetEl.className = "ck-n-reset";
        ta.value = seedText;
        recount();
        clearTimeout(window.__ckNoteT[KEY]);
        flush();
      });
    });

    CK.settings(sec, SEED, function (c) {
      ta.classList.toggle("ck-n-mono", !!c.mono);
      var r = Math.floor(Number(c.rows));
      if (!isFinite(r) || r < 2) r = 2;
      if (r > 40) r = 40;
      ta.setAttribute("rows", String(r));
      /* The attribute is what a form control reads and the class is what CSS reads; both are
         set because the attribute alone does not reliably restyle a textarea already on the
         page, and the class alone would leave the control lying about itself. */
      var wrap = !!c.wrap;
      ta.setAttribute("wrap", wrap ? "soft" : "off");
      ta.classList.toggle("ck-n-nowrap", !wrap);
    });
  });
})();
