(function () {
  'use strict';

  var ID = "ticker";
  var DEFAULTS = {"showLast":true,"showChange":true,"showPercent":true,"showSpark":true,"sort":"given","compact":false};
  var AS_OF = 1788033600000;
  var SORTS = { given: 1, symbol: 1, percent: 1 };

  /**
   * How long ago the data is, in words.
   *
   * Clamped at zero because a desk and a feed do not agree about the time to the second, and
   * "in 4 seconds" is a bug report waiting to happen where "just now" is the truth.
   *
   * @example agoText(Date.now() - 300000);   // '5 min ago'
   */
  function agoText(ms) {
    var d = Math.round((Date.now() - ms) / 1000);
    if (d < 0) d = 0;
    if (d < 45) return 'just now';
    if (d < 5400) return String(Math.round(d / 60)) + ' min ago';
    if (d < 172800) return String(Math.round(d / 3600)) + ' h ago';
    return String(Math.round(d / 86400)) + ' d ago';
  }

  /** The displayed percent hung on a row, or null when the row has none. */
  function pctOf(tr) {
    var v = tr.getAttribute('data-pct');
    if (v === null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function ixOf(tr) { return Number(tr.getAttribute('data-ix')) || 0; }

  /**
   * Compare two rows under one order, always falling back to the given order.
   *
   * The tiebreak is not decoration. Without it, two rows printing the same percent could swap
   * places between renders, and a strip that reshuffles when nothing changed reads as broken.
   */
  function cmp(mode, a, b) {
    var d = 0, x, y, p, q;
    if (mode === 'symbol') {
      x = a.getAttribute('data-sym') || '';
      y = b.getAttribute('data-sym') || '';
      d = x < y ? -1 : x > y ? 1 : 0;
    } else if (mode === 'percent') {
      p = pctOf(a);
      q = pctOf(b);
      if (p === null && q === null) d = 0;
      else if (p === null) d = 1;
      else if (q === null) d = -1;
      else d = q - p;
    }
    return d !== 0 ? d : ixOf(a) - ixOf(b);
  }

  CK.build(ID, function (sec) {

    var body = sec.querySelector('.ck-tk-body');
    var rows = [];
    if (body) {
      var found = body.querySelectorAll('tr.ck-tk-row');
      for (var i = 0; i < found.length; i++) rows.push(found[i]);
    }

    /** Reorder in place. appendChild moves a node it already owns, so this is a permutation. */
    function order(mode) {
      if (!body || rows.length < 2) return;
      var arr = rows.slice();
      arr.sort(function (a, b) { return cmp(mode, a, b); });
      for (var i = 0; i < arr.length; i++) body.appendChild(arr[i]);
    }

    function flag(v) { return v ? 'on' : 'off'; }

    function apply(cfg) {
      sec.dataset.last = flag(cfg.showLast);
      sec.dataset.change = flag(cfg.showChange);
      sec.dataset.percent = flag(cfg.showPercent);
      sec.dataset.spark = flag(cfg.showSpark);
      sec.dataset.compact = flag(cfg.compact);
      var mode = SORTS[cfg.sort] ? cfg.sort : 'given';
      sec.dataset.sort = mode;
      order(mode);
    }

    CK.settings(sec, DEFAULTS, apply);

    /* CK.timer and not setInterval, and not CK.once around a setInterval either. CK.once keys off
       the ELEMENT, and a <main> swap hands this builder a brand new section with an empty dataset
       — so the guard passes, a second interval starts, and the first one keeps running against a
       detached node. CK.timer is keyed by name in a registry that outlives the DOM, so the swap
       replaces rather than stacks.

       The callback re-finds the card instead of closing over the section for the same reason:
       between a swap and the builder replay, the node this closure captured is already garbage. */
    if (AS_OF !== null) {
      CK.timer(ID + ':asof', 60000, function () {
        var live = CK.card(ID);
        if (!live) return;
        var el = live.querySelector('.ck-tk-ago');
        if (el) el.textContent = agoText(AS_OF);
      });
    }
  });
})();