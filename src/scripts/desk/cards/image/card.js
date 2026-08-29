/* image card: settings, enlarge in place, and a named placeholder when a file 404s. */
CK.build("image", function (sec) {
function imgDraw(sec, M, DEF) {
  var grid = sec.querySelector(".ck-img-grid");
  var note = sec.querySelector(".ck-img-note");

  /* A stored setting is a string out of localStorage, which is a text file the viewer can edit,
     so every one of these is re-derived rather than used. A select gives back a string even for
     a number, which is the ordinary case rather than the attack. */
  function colsOf(v) {
    var k = Math.round(Number(v));
    if (!isFinite(k)) { k = DEF.columns; }
    if (k < 1) { k = 1; }
    if (k > 4) { k = 4; }
    /* One image spanning a quarter of the card is a thumbnail of nothing. A gallery of one is
       just a picture, and a picture takes the whole row. */
    if (M.count < 2) { k = 1; }
    return k;
  }

  function fitOf(v) {
    if (v === "cover" || v === "contain") { return v; }
    return DEF.fit;
  }

  function flag(v, fallback) {
    if (v === true || v === "true" || v === 1) { return true; }
    if (v === false || v === "false" || v === 0) { return false; }
    return fallback;
  }

  /* An image can fail before this script ever runs, and a listener attached afterwards would
     then never fire -- the error event was dispatched at a moment nobody was listening. A
     finished load with no intrinsic width is the same fact, discovered late, so both are
     checked and the tile ends up in the same state either way. */
  function isBroken(img) {
    return img.complete && img.naturalWidth === 0;
  }

  /* The placeholder names the path. A frame that is merely empty tells the reader nothing they
     can act on; a frame that says which file did not arrive is a bug report. */
  function fail(fig) {
    var img = fig.querySelector("img");
    if (!img || fig.getAttribute("data-failed") === "1") { return; }
    var frame = img.parentNode;
    var box = document.createElement("div");
    var head = document.createElement("b");
    var body = document.createElement("span");
    box.className = "ck-img-bad";
    head.textContent = "this image did not load";
    body.textContent = img.getAttribute("data-src") || "no path recorded";
    box.appendChild(head);
    box.appendChild(body);
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", "an image failed to load: " + body.textContent);
    frame.replaceChild(box, img);
    fig.setAttribute("data-failed", "1");
    fig.setAttribute("data-big", "0");
  }

  function shrinkAll() {
    var figs = sec.querySelectorAll(".ck-img-fig");
    var i, btn;
    for (i = 0; i < figs.length; i++) {
      figs[i].setAttribute("data-big", "0");
      btn = figs[i].querySelector(".ck-img-tile");
      if (btn) { btn.setAttribute("aria-expanded", "false"); }
    }
  }

  /* One open tile at a time, on purpose: two half-page images stacked is a scroll, not a
     comparison, and the reader has to close one before the other is legible anyway. */
  function toggle(fig, btn) {
    var open = fig.getAttribute("data-big") === "1";
    shrinkAll();
    if (!open) {
      fig.setAttribute("data-big", "1");
      btn.setAttribute("aria-expanded", "true");
    }
  }

  function wire() {
    var figs = sec.querySelectorAll(".ck-img-fig");
    var i;
    for (i = 0; i < figs.length; i++) {
      wireOne(figs[i]);
    }
    sec.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { shrinkAll(); }
    });
  }

  function wireOne(fig) {
    var img = fig.querySelector("img");
    var btn = fig.querySelector(".ck-img-tile");
    if (img) {
      img.addEventListener("error", function () { fail(fig); });
      if (isBroken(img)) { fail(fig); }
    }
    if (btn) {
      btn.addEventListener("click", function () { toggle(fig, btn); });
    }
  }

  function draw(cfg) {
    var cols = colsOf(cfg.columns);
    var fit = fitOf(cfg.fit);
    var caps = flag(cfg.captions, DEF.captions);

    if (grid) {
      grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
      grid.setAttribute("data-fit", fit);
      grid.setAttribute("data-caps", caps ? "1" : "0");
    }
    if (note) {
      if (M.count) {
        note.textContent = cols + " across, " + fit +
          (caps ? ", captions on." : ", captions off.");
      } else {
        note.textContent = M.empty;
      }
    }

    /* Wiring runs once per element, not once per settings change. A swap of the desk's main
       element hands this builder a brand new section with an empty dataset, so the guard
       correctly lets the new one through and correctly refuses the old one a second listener. */
    CK.once(sec, "imgwire", wire);
  }

  CK.settings(sec, DEF, draw);
}
  imgDraw(sec, {"count":3,"shown":3,"empty":"no images were given to this card."}, {"columns":3,"fit":"contain","captions":true});
});
