(function () {
  CK.build("snippet", function (sec) {
    var pre     = sec.querySelector(".ck-sn-pre");
    var cut     = sec.querySelector(".ck-sn-cut");
    var cmdEl   = sec.querySelector(".ck-sn-cmd");
    var copyBtn = sec.querySelector(".ck-sn-copy");
    var copyLab = sec.querySelector(".ck-sn-copy-t");
    var cwdEl   = sec.querySelector(".ck-sn-cwd");
    var countEl = sec.querySelector(".ck-sn-count");
    var PRE_CLS = "ck-sn-pre";

    var LINES = [], i;
    if (pre) {
      for (i = 0; i < pre.children.length; i++) {
        if (pre.children[i].className.indexOf("ck-sn-l") >= 0) LINES.push(pre.children[i]);
      }
    }

    /* The fold. Head and tail rather than a head alone, because the end of a command run
       is where the failure usually is and a cap that kept only the beginning would hide
       exactly the part somebody opened the card to read.

       Whatever it hides, it says: the marker carries the number of folded lines and the
       line numbers on both sides of the fold, and the caption carries the count again. A
       truncation that does not announce itself is a lie about what the command printed,
       and this card is a record. */
    function fold(cap) {
      var n = LINES.length, k, head, tail, hidden, tailFrom, says;
      if (!countEl && !pre) return;

      if (cap <= 0 || n <= cap) {
        for (k = 0; k < n; k++) LINES[k].hidden = false;
        if (cut) cut.hidden = true;
        if (countEl) countEl.textContent = n + (n === 1 ? " line" : " lines");
        return;
      }

      head = Math.ceil(cap / 2);
      tail = cap - head;
      tailFrom = n - tail;
      hidden = n - cap;
      for (k = 0; k < n; k++) LINES[k].hidden = k >= head && k < tailFrom;

      if (cut) {
        says = "\u2026 " + hidden + (hidden === 1 ? " line" : " lines") +
               " folded away \u2014 showing 1\u2013" + head;
        if (tail > 0) says = says + " and " + (tailFrom + 1) + "\u2013" + n;
        cut.textContent = says + " \u2026";
        cut.hidden = false;
        /* The marker belongs between the two halves, so it has to move when the cap does.
           Moving the one element rather than minting a new one keeps it a single node no
           matter how many times the setting is changed. */
        pre.insertBefore(cut, LINES[head]);
      }
      if (countEl) {
        countEl.textContent = "showing " + cap + " of " + n + " lines \u2014 " + hidden +
                              " folded away in the middle";
      }
    }

    /* Copying is offered for the command and not for the output, which is deliberate: the
       command is the thing anyone wants to run again, and the output has already been
       edited by this card - escape sequences removed, control characters dropped - so
       handing it over as if it were what the program wrote would be a small forgery. */
    if (copyBtn && cmdEl) CK.once(copyBtn, "copy", function () {
      copyBtn.addEventListener("click", function () {
        var text = cmdEl.textContent;

        function said(m) {
          if (!copyLab) return;
          copyLab.textContent = m;
          setTimeout(function () { copyLab.textContent = "copy"; }, 1400);
        }

        /* Selecting the text is the fallback rather than a silent failure. A copy button
           that does nothing is worse than no copy button: the reader walks away believing
           the command is on the clipboard. */
        function pick() {
          try {
            var r = document.createRange(), s = window.getSelection();
            r.selectNodeContents(cmdEl);
            s.removeAllRanges();
            s.addRange(r);
            said("selected \u2014 copy it");
          } catch (no) { said("copy failed"); }
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { said("copied"); }, pick);
        } else pick();
      });
    });

    CK.settings(sec, {"wrap":false,"lines":200,"showCwd":true}, function (cfg) {
      var cap = Math.floor(Number(cfg.lines));
      if (!isFinite(cap) || cap < 0) cap = 0;
      if (pre) pre.className = PRE_CLS + (cfg.wrap ? " ck-sn-wrap" : "");
      if (cwdEl) cwdEl.hidden = !cfg.showCwd;
      fold(cap);
    });
  });
})();
