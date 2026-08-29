(function () {
  'use strict';

  var ID = "portfolio";
  var DEFAULTS = {"group":"sector","showCash":true,"sort":"weight"};
  var GROUPS = { sector: 1, symbol: 1 };
  var SORTS = { weight: 1, symbol: 1, gain: 1 };

  /** A numeric attribute, or null when the row does not carry one. */
  function attrNum(el, name) {
    var v = el.getAttribute(name);
    if (v === null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function ixOf(tr) { return Number(tr.getAttribute('data-ix')) || 0; }

  /**
   * Compare two rows under one order, always falling back to the given order.
   *
   * Weight order is value order: every weight in a variant shares one denominator, so sorting on
   * the cents avoids re-reading a formatted percentage back out of the DOM. Rows with no value
   * and rows with no gain sort last in their respective orders rather than sorting as zero, which
   * would file an unknown between a loss and a profit.
   */
  function cmp(mode, a, b) {
    var d = 0, x, y, p, q;
    if (mode === 'symbol') {
      x = a.getAttribute('data-sym') || '';
      y = b.getAttribute('data-sym') || '';
      d = x < y ? -1 : x > y ? 1 : 0;
    } else {
      p = attrNum(a, mode === 'gain' ? 'data-g' : 'data-v');
      q = attrNum(b, mode === 'gain' ? 'data-g' : 'data-v');
      if (p === null && q === null) d = 0;
      else if (p === null) d = 1;
      else if (q === null) d = -1;
      else d = q - p;
    }
    return d !== 0 ? d : ixOf(a) - ixOf(b);
  }

  CK.build(ID, function (sec) {

    var body = sec.querySelector('.ck-pf-body');
    var rows = [];
    if (body) {
      var found = body.querySelectorAll('tr.ck-pf-row');
      for (var i = 0; i < found.length; i++) rows.push(found[i]);
    }

    var cash = sec.querySelector('tr.ck-pf-cash');

    /* Collected once. Every cell that changes with the cash sleeve carries both texts, so the
       swap is a copy out of an attribute and never a calculation. */
    var swaps = [];
    var marked = sec.querySelectorAll('[data-w0], [data-v0]');
    for (var j = 0; j < marked.length; j++) swaps.push(marked[j]);

    /** Reorder in place. appendChild moves a node it already owns, so this is a permutation. */
    function order(mode) {
      if (!body || rows.length < 2) return;
      var arr = rows.slice();
      arr.sort(function (a, b) { return cmp(mode, a, b); });
      for (var i = 0; i < arr.length; i++) body.appendChild(arr[i]);
    }

    /** Copy the variant's text into every dual-valued cell, with textContent and never markup. */
    function swap(on) {
      for (var i = 0; i < swaps.length; i++) {
        var el = swaps[i];
        var v = on ? (el.getAttribute('data-w1') || el.getAttribute('data-v1'))
                   : (el.getAttribute('data-w0') || el.getAttribute('data-v0'));
        if (v !== null) el.textContent = v;
      }
    }

    function apply(cfg) {
      var group = GROUPS[cfg.group] ? cfg.group : 'sector';
      var mode = SORTS[cfg.sort] ? cfg.sort : 'weight';
      var on = !!cfg.showCash;

      sec.dataset.group = group;
      sec.dataset.cash = on ? 'on' : 'off';
      sec.dataset.sort = mode;

      if (cash) cash.hidden = !on;
      swap(on);
      order(mode);
    }

    CK.settings(sec, DEFAULTS, apply);
  });
})();