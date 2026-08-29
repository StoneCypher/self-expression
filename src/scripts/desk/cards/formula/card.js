(function () {
  /* One registry per document, on window so it survives the <main> swap that replaces every
     card element. state is "idle" | "loading" | "ready" | "failed". */
  function ckFxReg() {
    if (!window.__ckFxKatex) window.__ckFxKatex = { state: "idle", waiting: [] };
    return window.__ckFxKatex;
  }

  function ckFxDrain(reg, err) {
    var q = reg.waiting, i;
    reg.waiting = [];
    for (i = 0; i < q.length; i++) q[i](err);
  }

  /**
   * Ensure KaTeX is loaded, then call back with null, or with a reason it will not be.
   */
  function ckFxLoad(cb) {
    var reg = ckFxReg();

    /* Another card may already have loaded it, and after a swap this card certainly has.
       Checking the global first is what makes the whole thing idempotent. */
    if (window.katex) { reg.state = "ready"; cb(null); return; }
    if (reg.state === "failed") { cb("katex could not be loaded"); return; }

    reg.waiting.push(cb);
    if (reg.state === "loading") return;
    reg.state = "loading";

    /* The stylesheet is not optional decoration: without it KaTeX output is a pile of
       absolutely-positioned spans with no metrics, which is worse than the source. */
    if (!document.getElementById("ck-fx-katex-css")) {
      var link = document.createElement("link");
      link.id = "ck-fx-katex-css";
      link.rel = "stylesheet";
      link.href = "/katex/katex.min.css";
      document.head.appendChild(link);
    }

    /* CREATED, not parsed. A <script src> written into a card's html and inserted by a DOM
       swap is flagged "already started" and never runs, with no error anywhere. This is the
       only construction that executes. */
    var s = document.createElement("script");
    s.id = "ck-fx-katex-js";
    s.src = "/katex/katex.min.js";
    s.async = true;
    s.onload = function () {
      var ok = !!window.katex;
      reg.state = ok ? "ready" : "failed";
      ckFxDrain(reg, ok ? null : "katex loaded but defined no global");
    };
    s.onerror = function () {
      reg.state = "failed";
      ckFxDrain(reg, "katex could not be fetched from " + "/katex/katex.min.js");
    };
    document.head.appendChild(s);
  }

  /**
   * Tag the leaf ordinary atoms whose CONTENT decides their role.
   *
   * CSS cannot match content, so digits and Greek letters — both plain "mord" to KaTeX —
   * are indistinguishable to a stylesheet. This adds the class a selector can then use.
   * Leaves only: an "mord" with element children is a group, and tagging it would paint
   * everything inside it, including the relations and operators it wraps.
   */
  function ckFxTag(root) {
    if (!root || !root.querySelectorAll) return;
    var spans = root.querySelectorAll(".mord"), i, j, el, t, c, digits, greek;
    for (i = 0; i < spans.length; i++) {
      el = spans[i];
      if (el.firstElementChild) continue;
      t = el.textContent || "";
      if (t === "") continue;
      digits = true;
      greek = false;
      for (j = 0; j < t.length; j++) {
        c = t.codePointAt(j);
        if (c > 65535) j++;                       /* step over the low surrogate */
        if (c >= 48 && c <= 57) continue;         /* 0-9 */
        if (c === 46 || c === 44) continue;       /* the separators a number may carry */
        digits = false;
        /* Greek and Coptic, Greek Extended, and the mathematical Greek alphabets. Compared
           numerically rather than with a character class, for the reason the contract
           gives: an escape decoded one step early puts a raw byte in the source. */
        if (c >= 880 && c <= 1023) greek = true;
        if (c >= 7936 && c <= 8191) greek = true;
        if (c >= 120488 && c <= 120779) greek = true;
      }
      if (!el.classList) continue;
      if (digits) el.classList.add("ck-fx-digit");
      else if (greek) el.classList.add("ck-fx-greek");
    }
  }

  CK.build("formula", function (sec) {
    var blocks = sec.querySelectorAll(".ck-fx-block");
    var status = sec.querySelector(".ck-fx-status");
    var cfgNow = null;

    /* An allowlist by construction: the name is compared against three known values and
       the class is built from the survivor, so nothing a viewer can type into
       localStorage becomes part of a class name. */
    var PALS = ["none","subtle","vivid"];
    function palette(name) {
      var i, use = "subtle";
      for (i = 0; i < PALS.length; i++) if (PALS[i] === name) use = name;
      for (i = 0; i < PALS.length; i++) sec.classList.remove("ck-fx-p-" + PALS[i]);
      sec.classList.add("ck-fx-p-" + use);
    }

    /* Display mode and equation numbers, both of which are knowable without KaTeX and are
       therefore settled before it is asked for. Numbers are assigned over the blocks that
       are ACTUALLY in display mode, in order, so an inline block in the middle does not
       leave a gap in the sequence — which is how LaTeX numbers, and the only version a
       reader can cross-reference. */
    function frame(cfg) {
      var i, b, want, disp, tag, n = 0;
      for (i = 0; i < blocks.length; i++) {
        b = blocks[i];
        want = b.getAttribute("data-display");
        disp = want === "1" ? true : want === "0" ? false : !!cfg.display;
        b.classList.toggle("ck-fx-d", disp);
        tag = b.querySelector(".ck-fx-num-tag");
        if (tag) tag.textContent = disp ? "(" + (++n) + ")" : "";
      }
    }

    /* The source, put back as text. Used before KaTeX arrives, when it never arrives, and
       when it refuses one expression — three different failures with one honest answer,
       because a card showing its TeX is still a card someone can read. */
    function source(host, tex) {
      var code = document.createElement("code");
      code.className = "ck-fx-src";
      code.textContent = tex;
      host.textContent = "";
      host.appendChild(code);
    }

    function render() {
      if (!window.katex || !cfgNow) return;
      var i, b, host, err, tex, disp;
      for (i = 0; i < blocks.length; i++) {
        b = blocks[i];
        if (b.getAttribute("data-empty") === "1") continue;
        host = b.querySelector(".ck-fx-render");
        err  = b.querySelector(".ck-fx-err");
        if (!host) continue;
        tex  = b.getAttribute("data-tex");
        disp = b.classList.contains("ck-fx-d");
        try {
          /* trust is OFF, explicitly and at the only call site there is. With it on,
             \href and \includegraphics would let an expression emit a URL of its own
             choosing — which is a link the reader did not write into a card whose whole
             premise is that its data is untrusted. throwOnError is on for the opposite
             reason: the default paints the bad token red and carries on, and a card that
             renders three quarters of an equation is worse than one that says so. */
          window.katex.render(tex, host, {
            displayMode: disp, throwOnError: true, trust: false
          });
          if (err) { err.hidden = true; err.textContent = ""; }
          ckFxTag(host);
        } catch (e) {
          source(host, tex);
          if (err) {
            err.hidden = false;
            /* textContent, not innerHTML: a KaTeX error message quotes the offending TeX
               back at you, so the message carries caller data. */
            err.textContent = e && e.message ? e.message : String(e);
          }
        }
      }
    }

    CK.settings(sec, {"palette":"subtle","display":true,"numbered":false}, function (cfg) {
      cfgNow = cfg;
      palette(cfg.palette);
      sec.classList.toggle("ck-fx-numbered", !!cfg.numbered);
      frame(cfg);

      /* One path, always. ckFxLoad answers synchronously when KaTeX is already there —
         which is the common case after the first card and after every <main> swap — so a
         fast path here would only be a second version of the same decision, free to drift
         from the one that matters. */
      ckFxLoad(function (e) {
        if (e) {
          if (status) { status.hidden = false; status.textContent = e + "; showing the TeX source instead."; }
          return;
        }
        if (status) status.hidden = true;
        render();
      });
    });
  });
})();
