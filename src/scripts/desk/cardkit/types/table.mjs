/**
 * The `table` card type — typed columns, a stable typed sort, a filter, and optional paging.
 *
 * The whole table is rendered here, in Node, escaped, with every row present in source order.
 * The browser script then *rearranges* that markup rather than regenerating it: it reorders,
 * hides and reveals rows that already exist. Nothing about a row's content is ever recomputed
 * on the client, which means there is exactly one place where data becomes markup and exactly
 * one escape to get right. It also means the card still says what it knows if the script never
 * runs — a table is content, and content that needs a script to appear is a worse table.
 *
 * The sort is the reason this type exists rather than a `<pre>`. Two things about it are worth
 * saying out loud because both are common bugs:
 *
 *   1. It is typed. A `number` column sorted as strings gives 10 < 2 < 9, and that mistake is
 *      almost invisible in a small table and completely wrong in a large one. Every cell that
 *      belongs to a typed column carries a precomputed numeric sort key in `data-s`, worked out
 *      here in Node where parsing is easy, so the browser only ever compares numbers to numbers.
 *   2. It is stable, explicitly. The comparator falls back to the row's source index whenever
 *      the keys tie, so it is a total order and the result does not depend on the engine's sort
 *      algorithm. `Array.prototype.sort` has been required to be stable since ES2019, but a
 *      comparator that only *happens* to be stable is a comparator that quietly reshuffles
 *      equal rows the first time it meets an engine you did not test on.
 *   3. The source index it falls back to is `data-i`, WRITTEN INTO THE MARKUP, not counted off
 *      the DOM when the script starts. This is the whole of the third click's correctness. The
 *      desk swaps `<main>` and replays every builder, and its swap diffs rather than re-rendering
 *      from Node, so a replay after a sort is handed rows that are already permuted. A
 *      capture-order index taken at that moment redefines "as written" to mean "as it was last
 *      left", and the order the author actually chose can never be recovered — the bug is
 *      invisible until a swap happens to follow a sort, and then it is silent.
 *
 * @see meta for the accepted shape
 * @see ORDER_SRC for the comparator, which is shipped and tested as the same text
 */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Exported so the settings panel's field names can be checked against it rather than trusted:
 * a `name` in the markup that is not a key here is a control that silently does nothing, and
 * `CK.settings` — correctly — ignores it without complaining.
 *
 * `page` is a count of rows, not a page number; 0 means "every row on one page", which is the
 * right default for a desk card, where most tables are short enough that a pager is furniture.
 *
 * Declared above {@link meta} so `meta.defaults` can be spread from it. The contract wants the
 * settings on `meta`; this file wants them as a named export the emitter can reach. Spreading one
 * from the other means there is still only one place a default is written down.
 *
 * @example defaults.page;   // 0
 */
export const defaults = { dense: false, filter: true, page: 0 };

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * @example meta.name;       // 'table'
 * @example meta.defaults;   // { dense: false, filter: true, page: 0 }
 */
export const meta = {
  name: 'table',
  summary: 'A typed, sortable, filterable table that scrolls inside the card instead of widening the desk.',
  shape: '{ columns: [{ key, label, type, align }], rows: [{...}], caption } — ' +
         'type is text | number | date | bool | bar; columns may be omitted and are then inferred from the first row',
  category: 'work-and-lists',
  defaults: { ...defaults }
};

/** The column types that get typed treatment; anything else is handled as text. */
const TYPES = { text: 1, number: 1, date: 1, bool: 1, bar: 1 };

/** Explicit alignments a column may ask for. */
const ALIGN = { left: 'ck-a-l', right: 'ck-a-r', center: 'ck-a-c' };

/** Strings that mean false when a `bool` column is fed text rather than a boolean. */
const FALSEY = { '': 1, '0': 1, 'false': 1, 'no': 1, 'n': 1, 'off': 1, 'null': 1 };

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * Duplicated rather than imported because `kit.js` is a classic script and not a module. The
 * two must agree exactly: a card whose Node side and browser side disagree about what is safe
 * is a card with a hole in whichever side is more permissive.
 *
 * @param s anything; null and undefined become the empty string rather than their names
 *
 * @example esc('a<b & "c"');   // 'a&lt;b &amp; &quot;c&quot;'
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A JavaScript string literal for a value, safe to paste into the emitted classic script.
 *
 * `JSON.stringify` alone is not enough for text that lands inside a `<script>` element: `</`
 * would close it, and U+2028/U+2029 are line terminators to a JS parser but not to JSON. The
 * backtick and the question mark are escaped for a different reason — the type's own tests
 * assert that the emitted script contains no template literals and no optional chaining, and a
 * card id containing a backtick would fail that check with a mystifying message about a rule it
 * did not break. Cheaper to make the data unable to spell the forbidden tokens at all.
 *
 * @param s the text to embed
 *
 * @example jsStr('a</script>b');   // '"a\\u003c/script\\u003eb"'
 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/`/g, '\\u0060').replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A number, or null when the value is not one.
 *
 * Commas are treated as group separators and dropped, because a table fed `"1,234"` from a
 * spreadsheet export should still sort numerically. That is a deliberate anglophone bet: in a
 * locale where the comma is the decimal separator this reads 1,5 as fifteen. Feed real numbers
 * and the question never arises.
 *
 * @param v anything
 * @returns the finite number, or null for blanks, non-numeric text and infinities
 *
 * @example toNumber('1,234');   // 1234
 * @example toNumber('n/a');     // null
 */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null || typeof v === 'boolean') return null;
  const t = String(v).replace(/[,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Epoch milliseconds for a date-ish value, or null when it cannot be read as a date.
 *
 * A bare number is taken as epoch milliseconds rather than as a year, because a table column
 * declared `date` and holding numbers is overwhelmingly a timestamp column. Text goes through
 * `Date.parse`, which means ISO strings are exact and everything else is at the engine's mercy;
 * that is stated rather than hidden, and ISO is the format to feed it.
 *
 * @param v a Date, epoch-millisecond number, or date string
 *
 * @example toEpoch('2026-08-27');   // 1787788800000
 * @example toEpoch('someday');      // null
 */
function toEpoch(v) {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * True, false, or null when the cell is simply empty.
 *
 * The three-way answer matters: an empty `bool` cell is not `false`, and sorting it as false
 * would claim the row said something it did not.
 *
 * @param v anything
 *
 * @example toBool('no');   // false
 * @example toBool(null);   // null
 */
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v !== 0 : null;
  const t = String(v).trim().toLowerCase();
  if (t === '') return null;
  return !FALSEY[t];
}

/**
 * A compact number for a bar's label, matching `CK.fmt` so the desk reads consistently.
 *
 * @param n a finite number
 *
 * @example compact(1200);   // '1.2k'
 */
function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'b';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n * 100) / 100);
}

/** Two decimal places at most, with no trailing zeroes, for SVG geometry. */
const g = (n) => String(Math.round(n * 100) / 100);

/**
 * The sort key a cell carries in `data-s`, or null for columns compared as text.
 *
 * Returning a *string* rather than a number is not laziness: it goes into an HTML attribute, so
 * it would become a string anyway, and having Node decide its exact spelling means the browser
 * never has to reproduce this parsing. An empty string means "no value here", which the
 * comparator sinks to the bottom in both directions.
 *
 * @param type the column's declared type
 * @param v    the raw cell value
 *
 * @example sortKey('number', '1,234');   // '1234'
 * @example sortKey('bool', false);       // '0'
 * @example sortKey('text', 'zebra');     // null
 */
function sortKey(type, v) {
  if (type === 'number' || type === 'bar') { const n = toNumber(v); return n === null ? '' : String(n); }
  if (type === 'date')  { const t = toEpoch(v); return t === null ? '' : String(t); }
  if (type === 'bool')  { const b = toBool(v);  return b === null ? '' : (b ? '1' : '0'); }
  return null;
}

/**
 * The text a cell shows, before any bar or glyph is drawn around it.
 *
 * Numbers are printed as they were authored rather than reformatted. A table is often something
 * to copy out of, and a thousands separator this code invented is a separator the reader then
 * has to strip. Dates are only reformatted when the source was a Date or a timestamp, where
 * there is no authored spelling to preserve.
 *
 * @param type the column's declared type
 * @param v    the raw cell value
 *
 * @example cellText('date', 0);        // '1970-01-01'
 * @example cellText('number', 1200);   // '1200'
 */
function cellText(type, v) {
  if (v == null) return '';
  if (type === 'date') {
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : '';
    if (typeof v === 'number') {
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : String(v);
    }
  }
  return String(v);
}

/**
 * Normalise the column list, inventing one from the first row when none was given.
 *
 * Inference is a convenience for the common `{ rows }`-only call and it only sniffs the first
 * row: a column whose first value is a number is a number column. That is wrong for a column
 * that starts with a number and continues with text, which is exactly why declaring `columns`
 * exists — but a card that renders nothing because it was handed bare rows is worse than a card
 * that guesses and says so in its caption.
 *
 * @param cols the caller's `columns`, possibly absent
 * @param rows the caller's `rows`, used only when `cols` is empty
 * @returns column descriptors with `key`, `label`, `type` and `cls` all settled
 *
 * @example normColumns(null, [{ n: 2 }])[0].type;   // 'number'
 */
function normColumns(cols, rows) {
  let list = Array.isArray(cols) ? cols.filter((c) => c && typeof c === 'object') : [];

  if (list.length === 0 && rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
    list = Object.keys(rows[0]).map((k) => {
      const v = rows[0][k];
      const type = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : 'text';
      return { key: k, label: k, type };
    });
  }

  return list.map((c, i) => {
    const key   = c.key == null ? String(i) : String(c.key);
    const type  = TYPES[c.type] ? String(c.type) : 'text';
    const label = c.label == null ? key : String(c.label);
    const want  = ALIGN[String(c.align)];
    /* Numbers and bars right, booleans centred, everything else left — the alignment that lets
       a column of digits be compared by eye down its last place. `align` overrides it. */
    const cls = want || (type === 'number' || type === 'bar' ? 'ck-a-r' : type === 'bool' ? 'ck-a-c' : 'ck-a-l');
    return { key, label, type, cls };
  });
}

/**
 * The domain a `bar` column draws against: `[lo, hi]`, always including zero.
 *
 * Zero is forced into the domain so a bar's length is proportional to its value rather than to
 * its distance from the smallest value in the column — otherwise the smallest row draws nothing
 * and every other bar overstates its size. When the column holds negatives the zero lands
 * somewhere in the middle and bars grow both ways from it.
 *
 * @param rows the table's rows
 * @param key  the bar column's key
 *
 * @example barDomain([{ v: 4 }, { v: -2 }], 'v');   // [-2, 4]
 */
function barDomain(rows, key) {
  let lo = 0, hi = 0;
  for (const row of rows) {
    const n = toNumber(row && row[key]);
    if (n === null) continue;
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  return [lo, hi];
}

/**
 * One in-cell bar as inline SVG.
 *
 * SVG geometry attributes rather than a `style` attribute, deliberately: the desk serves its
 * pages under a CSP, and a `style` attribute is the first thing a strict `style-src` refuses.
 * `width="42"` on a `<rect>` is not a style, so a bar drawn this way keeps working under a
 * policy that would blank one drawn with `style="width:42%"`.
 *
 * @param n      the cell's value, already known to be a number
 * @param domain `[lo, hi]` from {@link barDomain}
 *
 * @example bar(5, [0, 10]);   // an <svg> whose rect runs half the track
 */
function bar(n, domain) {
  const lo = domain[0], hi = domain[1], span = hi - lo;
  const at = span === 0 ? 0 : (n - lo) / span * 100;
  const zero = span === 0 ? 0 : (0 - lo) / span * 100;
  let x = Math.min(zero, at), w = Math.abs(at - zero);
  if (n !== 0 && w < 0.8) { w = 0.8; }                      // a tiny value still deserves a tick
  if (x + w > 100) x = 100 - w;

  /* The baseline is only drawn when there is something on both sides of it: on an all-positive
     column a rule at the left edge is noise pretending to be information. */
  const base = lo < 0
    ? '<line class="z" x1="' + g(zero) + '" y1="0" x2="' + g(zero) + '" y2="10" vector-effect="non-scaling-stroke"/>'
    : '';

  return '<svg class="ck-t-barv" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">' +
         base + '<rect x="' + g(x) + '" y="1.5" width="' + g(w) + '" height="7"/></svg>';
}

/** The drawn sort chevron. An emoji arrow is a font lottery at 11px; this is the same shape everywhere. */
const CHEV = '<svg class="ck-t-dir" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
             'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
             '<path d="M6 15l6-6 6 6"/></svg>';

/** Drawn yes/no marks, for the same reason: a check and a dash read at 11px, ✅ does not. */
const YES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const NO  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
            'stroke-linecap="round" aria-hidden="true"><path d="M7 12h10"/></svg>';

/** The pager's drawn chevrons. */
const PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6l6 6-6 6"/></svg>';

/**
 * One `<td>`, with its sort key, its filter haystack and its drawn contents.
 *
 * `data-q` is only emitted where the displayed text differs from the source value — a bar shows
 * `1.2k` for 1200, a boolean shows a glyph — so that typing `1200` into the filter finds the row
 * that holds 1200. Where display and source agree, the cell's own text is the haystack and the
 * attribute would be dead weight on every row.
 *
 * @param col the normalised column
 * @param v   the raw cell value
 * @param dom the bar domain, for `bar` columns only
 *
 * @example cell({ key: 'ok', type: 'bool', cls: 'ck-a-c' }, true);
 * // '<td class="ck-a-c" data-s="1" data-q="yes">…</td>'
 */
function cell(col, v, dom) {
  const key = sortKey(col.type, v);
  const txt = cellText(col.type, v);
  const num = col.type === 'number' || col.type === 'date' || col.type === 'bar';
  const cls = col.cls + (num ? ' ck-t-num' : '') + (col.type === 'text' ? ' ck-t-txt' : '');

  let attrs = ' class="' + cls + '"';
  if (key !== null) attrs += ' data-s="' + esc(key) + '"';

  if (col.type === 'bool') {
    const b = toBool(v);
    if (b === null) return '<td' + attrs + ' data-q=""></td>';
    const word = b ? 'yes' : 'no';
    return '<td' + attrs + ' data-q="' + word + '">' +
           '<span class="ck-t-bool ' + (b ? 'on' : 'off') + '">' + (b ? YES : NO) + '</span>' +
           '<span class="ck-sr">' + word + '</span></td>';
  }

  if (col.type === 'bar') {
    const n = toNumber(v);
    if (n === null) return '<td' + attrs + ' data-q=""></td>';
    return '<td' + attrs + ' data-q="' + esc(String(v).toLowerCase()) + '">' +
           '<span class="ck-t-bar">' + bar(n, dom) + '<b>' + esc(compact(n)) + '</b></span></td>';
  }

  /* A long text cell is ellipsised rather than allowed to set the table's width; the full value
     stays in `title`, so nothing is lost, only folded away. */
  const title = col.type === 'text' && txt.length > 34 ? ' title="' + esc(txt) + '"' : '';
  return '<td' + attrs + title + '>' + esc(txt) + '</td>';
}

/**
 * The ordering core, as browser source.
 *
 * This string is shipped verbatim inside `js` *and* exercised directly by the type's tests
 * through `new Function`, so the comparator that is tested is textually the comparator that
 * runs. A second Node-side copy of "the same" logic would be a copy that drifts.
 *
 * Two properties it is written to guarantee:
 *
 *   - **Stable.** Ties fall back to `a.i - b.i`, the row's source position, so the comparator is
 *     a total order. Equal rows keep the order the data arrived in, on every engine, forever.
 *   - **Typed.** Numeric columns compare numbers; text compares with `localeCompare`. Missing
 *     values sink to the bottom in *both* directions, because a blank cell is not a small value
 *     and reversing the sort should not bring a wall of blanks to the top.
 *
 * `keyAt` is a parameter rather than a closure over the DOM so the same function can be driven
 * from a plain array in a test.
 *
 * @example
 * const cmp = new Function(ORDER_SRC + ' return ckMakeCmp;')()('number', 1, (o) => o.k);
 * [{k:'2',i:0},{k:'10',i:1},{k:'9',i:2}].sort(cmp).map((o) => o.k);   // ['2','9','10']
 */
export const ORDER_SRC = [
  '  /* Natural ordering for text: "item10" after "item2", and case is not a distinction worth',
  '     reordering rows over. */',
  '  var CK_T_TEXT = { numeric: true, sensitivity: "base" };',
  '',
  '  function ckKeyNum(k) {',
  '    if (k === null || k === undefined) return NaN;',
  '    var s = String(k);',
  '    if (s === "") return NaN;',
  '    return Number(s);',
  '  }',
  '',
  '  function ckMakeCmp(type, dir, keyAt) {',
  '    var numeric = type === "number" || type === "bar" || type === "date" || type === "bool";',
  '    return function (a, b) {',
  '      var r = 0;',
  '      if (dir !== 0) {',
  '        var ka = keyAt(a), kb = keyAt(b);',
  '        if (numeric) {',
  '          var x = ckKeyNum(ka), y = ckKeyNum(kb);',
  '          var xb = !isFinite(x), yb = !isFinite(y);',
  '          /* Blanks sink in both directions: absent is not small. Returned before the',
  '             direction multiplier so reversing cannot lift them. */',
  '          if (xb || yb) return xb && yb ? a.i - b.i : (xb ? 1 : -1);',
  '          r = x < y ? -1 : (x > y ? 1 : 0);',
  '        } else {',
  '          var sa = ka === null || ka === undefined ? "" : String(ka);',
  '          var sb = kb === null || kb === undefined ? "" : String(kb);',
  '          if (sa === "" || sb === "") {',
  '            if (sa === "" && sb === "") return a.i - b.i;',
  '            return sa === "" ? 1 : -1;',
  '          }',
  '          r = sa.localeCompare(sb, undefined, CK_T_TEXT);',
  '        }',
  '        r = r * dir;',
  '      }',
  '      /* The stability guarantee, made explicit rather than borrowed from the engine. */',
  '      return r !== 0 ? r : a.i - b.i;',
  '    };',
  '  }'
].join('\n');

/**
 * The card's browser half: wiring, not rendering.
 *
 * Written as one string so the whole thing can be wrapped in a function expression — nothing
 * this card defines should reach the global scope, since a desk can hold two tables and a
 * top-level `var` would have them sharing it.
 *
 * @param id the card's `data-card` value, embedded as a literal
 *
 * @example main('runs').indexOf('CK.build') >= 0;   // true
 */
function main(id) {
  return [
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var table = sec.querySelector("table.ck-t");',
    '    if (!table || !table.tHead || !table.tBodies[0]) return;',
    '',
    '    var tbody   = table.tBodies[0];',
    '    var headRow = table.tHead.rows[0];',
    '    var tools   = sec.querySelector(".ck-t-tools");',
    '    var find    = sec.querySelector(".ck-t-find");',
    '    var pager   = sec.querySelector(".ck-t-page");',
    '    var ofEl    = sec.querySelector(".ck-t-of");',
    '    var prev    = sec.querySelector(".ck-t-prev");',
    '    var next    = sec.querySelector(".ck-t-next");',
    '    var countEl = sec.querySelector(".ck-t-count");',
    '    var noneRow = tbody.querySelector(".ck-t-none");',
    '',
    '    /* The source index is READ FROM THE MARKUP, never counted off the DOM. The index is what',
    '       the third click on a header restores and what every tie in the comparator falls back',
    '       to, so it has to mean "where this row was in the data" and keep meaning that. The desk',
    '       swaps <main> and replays every builder, and its swap DIFFS rather than re-rendering, so',
    '       a replay after a sort sees the rows already permuted: counting position at that moment',
    '       makes "as written" mean "as it was last left", and the order the author chose can never',
    '       be recovered. A missing or unreadable attribute falls back to position, which is the',
    '       old behaviour and is right for markup that predates the attribute. */',
    '    function srcIndex(tr, fallback) {',
    '      var raw = tr.getAttribute("data-i");',
    '      if (raw === null || raw === "") return fallback;',
    '      var v = Number(raw);',
    '      return isFinite(v) ? v : fallback;',
    '    }',
    '',
    '    var items = [], all = tbody.rows, i;',
    '    for (i = 0; i < all.length; i++) {',
    '      if (all[i].className.indexOf("ck-t-none") >= 0) continue;',
    '      items.push({ tr: all[i], i: srcIndex(all[i], items.length), hay: null });',
    '    }',
    '',
    '    var state = { col: -1, dir: 0, q: "", per: 0, at: 0 };',
    '',
    '    function keyAt(it) {',
    '      var td = it.tr.cells[state.col];',
    '      if (!td) return "";',
    '      var s = td.getAttribute("data-s");',
    '      return s === null ? td.textContent : s;',
    '    }',
    '',
    '    /* Built once per row and kept: the filter runs on every keystroke across every row and',
    '       every column, and re-reading textContent for that is the difference between a table',
    '       that types smoothly and one that stutters at a few hundred rows. */',
    '    function hay(it) {',
    '      if (it.hay === null) {',
    '        var out = [], cs = it.tr.cells, k;',
    '        for (k = 0; k < cs.length; k++) {',
    '          var q = cs[k].getAttribute("data-q");',
    '          out.push(q === null ? cs[k].textContent.toLowerCase() : q);',
    '        }',
    '        it.hay = out;',
    '      }',
    '      return it.hay;',
    '    }',
    '',
    '    function hit(it, q) {',
    '      var h = hay(it), k;',
    '      for (k = 0; k < h.length; k++) if (h[k].indexOf(q) >= 0) return true;',
    '      return false;',
    '    }',
    '',
    '    function typeOf(ci) {',
    '      var th = headRow.cells[ci];',
    '      return th ? (th.getAttribute("data-type") || "text") : "text";',
    '    }',
    '',
    '    function marks() {',
    '      var k;',
    '      for (k = 0; k < headRow.cells.length; k++) {',
    '        var th = headRow.cells[k];',
    '        var dir = k === state.col ? state.dir : 0;',
    '        th.setAttribute("aria-sort", dir === 1 ? "ascending" : dir === -1 ? "descending" : "none");',
    '      }',
    '    }',
    '',
    '    function apply() {',
    '      var k, order = items.slice(0);',
    '      order.sort(ckMakeCmp(typeOf(state.col), state.dir, keyAt));',
    '',
    '      var pass = [];',
    '      for (k = 0; k < order.length; k++) {',
    '        if (state.q === "" || hit(order[k], state.q)) pass.push(order[k].tr);',
    '        else order[k].tr.hidden = true;',
    '      }',
    '',
    '      var per   = state.per > 0 ? state.per : pass.length;',
    '      var pages = per > 0 ? Math.ceil(pass.length / per) : 1;',
    '      if (pages < 1) pages = 1;',
    '      if (state.at >= pages) state.at = pages - 1;',
    '      if (state.at < 0) state.at = 0;',
    '      var from = state.at * per, to = per > 0 ? from + per : pass.length;',
    '      for (k = 0; k < pass.length; k++) pass[k].hidden = k < from || k >= to;',
    '',
    '      /* One reflow: every row is moved into a fragment in its new order and the fragment',
    '         goes back in one call, rather than the table relaying out once per row. */',
    '      var frag = document.createDocumentFragment();',
    '      for (k = 0; k < order.length; k++) frag.appendChild(order[k].tr);',
    '      tbody.insertBefore(frag, noneRow);',
    '      if (noneRow) noneRow.hidden = pass.length !== 0;',
    '',
    '      if (pager) {',
    '        pager.hidden = state.per <= 0 || pass.length <= state.per;',
    '        if (prev) prev.disabled = state.at <= 0;',
    '        if (next) next.disabled = state.at >= pages - 1;',
    '        if (ofEl) ofEl.textContent = pass.length === 0 ? "nothing to show"',
    '          : (from + 1) + "\\u2013" + Math.min(to, pass.length) + " of " + pass.length;',
    '      }',
    '      if (countEl) countEl.textContent = pass.length === items.length',
    '        ? items.length + (items.length === 1 ? " row" : " rows")',
    '        : pass.length + " of " + items.length + " rows";',
    '    }',
    '',
    '    /* Delegated, so the listener count does not track the column count. */',
    '    CK.once(headRow, "sort", function () {',
    '      headRow.addEventListener("click", function (ev) {',
    '        var btn = ev.target && ev.target.closest ? ev.target.closest(".ck-t-sort") : null;',
    '        if (!btn) return;',
    '        var ci = btn.parentNode.cellIndex;',
    '        /* Three states rather than two. A sorted table has lost the order the data came in,',
    '           and that order is often the meaningful one — the order of the log, the order the',
    '           author chose. The third click gives it back instead of making the reader reload. */',
    '        if (state.col !== ci) { state.col = ci; state.dir = 1; }',
    '        else if (state.dir === 1) { state.dir = -1; }',
    '        else { state.col = -1; state.dir = 0; }',
    '        state.at = 0;',
    '        marks();',
    '        apply();',
    '      });',
    '    });',
    '',
    '    if (find) CK.once(find, "find", function () {',
    '      find.addEventListener("input", function () {',
    '        state.q = find.value.trim().toLowerCase();',
    '        state.at = 0;',
    '        apply();',
    '      });',
    '    });',
    '',
    '    if (prev) CK.once(prev, "prev", function () {',
    '      prev.addEventListener("click", function () { state.at = state.at - 1; apply(); });',
    '    });',
    '    if (next) CK.once(next, "next", function () {',
    '      next.addEventListener("click", function () { state.at = state.at + 1; apply(); });',
    '    });',
    '',
    '    CK.settings(sec, ' + JSON.stringify(defaults) + ', function (cfg) {',
    '      sec.classList.toggle("ck-t-dense", !!cfg.dense);',
    '      if (tools) tools.hidden = !cfg.filter;',
    '      /* Hiding the box has to drop the filter with it. Rows missing for a reason the reader',
    '         can no longer see is the worse of the two failures by a wide margin. */',
    '      if (!cfg.filter && state.q !== "") { state.q = ""; if (find) find.value = ""; }',
    '      var p = Math.floor(Number(cfg.page));',
    '      state.per = isFinite(p) && p > 0 ? p : 0;',
    '      state.at = 0;',
    '      apply();',
    '    });',
    '  });'
  ].join('\n');
}

/**
 * Build one table card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  `{ columns, rows, caption }`; every value in it is untrusted and escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'runs', title: 'runs', ord: 10, data: {
 *   columns: [{ key: 'n', label: 'count', type: 'number' }],
 *   rows: [{ n: 2 }, { n: 10 }, { n: 9 }]
 * } }).html.indexOf('data-s="10"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d    = data && typeof data === 'object' ? data : {};
  const rows = Array.isArray(d.rows) ? d.rows.filter((r) => r && typeof r === 'object') : [];
  const cols = normColumns(d.columns, rows);

  /* Bar domains are per column and computed once over the whole column, not per row: a bar
     whose scale changed between rows would be a picture of nothing. */
  const domains = {};
  for (const c of cols) if (c.type === 'bar') domains[c.key] = barDomain(rows, c.key);

  const head = cols.map((c) =>
    '<th class="' + c.cls + '" data-key="' + esc(c.key) + '" data-type="' + c.type + '" aria-sort="none" scope="col">' +
    '<button type="button" class="ck-t-sort"><span>' + esc(c.label) + '</span>' + CHEV + '</button></th>'
  ).join('');

  /* `data-i` is the row's position IN THE DATA, baked into the markup rather than counted from
     the DOM when the script starts. It is what the third click on a header restores and what every
     tie in the comparator falls back to, and it has to survive the desk swapping <main> and
     replaying this builder over markup the previous run already permuted — which a capture-order
     index does not, so "as written" quietly became "as it was left". */
  const body = rows.map((r, i) =>
    '<tr data-i="' + i + '">' + cols.map((c) => cell(c, r[c.key], domains[c.key])).join('') + '</tr>'
  ).join('\n      ');

  const span = Math.max(1, cols.length);
  const none = '<tr class="ck-t-none" hidden><td colspan="' + span + '">no rows match that filter</td></tr>';

  const empty = cols.length === 0
    ? '<div class="ck-t-void">nothing to render &mdash; this card has no columns</div>'
    : '';

  const caption = d.caption == null ? '' : esc(String(d.caption)) + ' ';

  const html =
    '<section data-card="' + esc(id) + '" class="ck-table">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-dense">dense rows</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-dense" name="dense">\n' +
    '    <label for="' + esc(id) + '-filter">filter box</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-filter" name="filter">\n' +
    '    <label for="' + esc(id) + '-page">rows / page</label>\n' +
    '    <input type="number" id="' + esc(id) + '-page" name="page" min="0" max="1000" step="1">\n' +
    '    <div class="ck-set-foot">0 rows per page shows every row. sorting and filtering run over the whole table, not one page.</div>\n' +
    '  </div>\n' +
    (empty ? '  ' + empty + '\n' : '') +
    '  <div class="ck-t-tools">\n' +
    '    <input type="search" class="ck-t-find" placeholder="filter" aria-label="filter rows" autocomplete="off" spellcheck="false">\n' +
    '  </div>\n' +
    '  <div class="ck-scroll ck-t-scroll">\n' +
    '    <table class="ck-t">\n' +
    '      <thead><tr>' + head + '</tr></thead>\n' +
    '      <tbody>\n      ' + (body ? body + '\n      ' : '') + none + '\n      </tbody>\n' +
    '    </table>\n' +
    '  </div>\n' +
    '  <div class="ck-t-page" hidden>\n' +
    '    <button type="button" class="ck-t-prev" aria-label="previous page">' + PREV + '</button>\n' +
    '    <span class="ck-t-of"></span>\n' +
    '    <button type="button" class="ck-t-next" aria-label="next page">' + NEXT + '</button>\n' +
    '  </div>\n' +
    '  <div class="ck-cap">' + caption + '<i class="ck-t-count"></i></div>\n' +
    '</section>\n';

  const js = '(function () {\n' + ORDER_SRC + '\n\n' + main(id) + '\n})();\n';

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch
   is the only thing that has to know anything and nothing keys off `prefers-color-scheme`.
   The desk is one document open in two viewers who want different answers, and the OS only
   knows how to give both of them the same one. */
const CSS = `
  .ck-table { position: relative; }

  /* ── the filter box ─────────────────────────────────────────────────────────────────── */

  .ck-table .ck-t-tools { margin: 10px 0 7px; }
  .ck-table .ck-t-tools[hidden] { display: none; }
  .ck-table .ck-t-find {
    font: inherit; font-family: var(--mono); font-size: 11px;
    width: 100%; box-sizing: border-box; padding: 5px 8px;
    background: var(--well); color: var(--ink);
    border: 1px solid var(--hairline); border-radius: 5px;
  }
  .ck-table .ck-t-find:focus { outline: none; border-color: var(--accent); }
  .ck-table .ck-t-find::placeholder { color: var(--ink-faint); }

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box;
     it wants to be its own size, at the start of its column. */
  .ck-table .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

  /* ── the table ──────────────────────────────────────────────────────────────────────── */

  /* The scroller owns both axes. A wide table scrolls itself and a long one scrolls under its
     own header, so neither ever moves the desk column sideways or grows the card without limit. */
  .ck-table .ck-t-scroll { max-height: 62vh; overflow-y: auto; }

  /* border-collapse is separate, not collapse: a collapsed border belongs to the table rather
     than to the cell, and a sticky header's bottom border scrolls away with the body when it
     does — which looks exactly like the header losing its rule at the top of the scroll. */
  .ck-table table.ck-t { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }

  .ck-table .ck-t th {
    position: sticky; top: 0; z-index: 1;
    padding: 0; white-space: nowrap;
    background: var(--ground);
    border-bottom: 1px solid var(--rule);
  }
  .ck-table .ck-t td {
    padding: 5px 9px; vertical-align: top;
    border-bottom: 1px solid var(--hairline);
  }
  .ck-table .ck-t tbody tr:hover td { background: var(--pill); }

  /* [hidden] and the display rules below it tie on specificity, and this sheet loads after the
     UA's, so a hidden row would stay visible without saying so. */
  .ck-table .ck-t tr[hidden] { display: none; }

  .ck-table.ck-t-dense .ck-t td { padding: 2px 8px; }
  .ck-table.ck-t-dense .ck-t .ck-t-sort { padding: 4px 8px; }

  .ck-table .ck-a-l { text-align: left; }
  .ck-table .ck-a-r { text-align: right; }
  .ck-table .ck-a-c { text-align: center; }

  /* Tabular figures so a column of numbers lines up on its last place and can be compared by
     eye down the column, which is most of the reason to put numbers in a table at all. */
  .ck-table .ck-t td.ck-t-num { font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums; }

  /* Long prose is folded rather than allowed to set the table's width; the title attribute on
     the cell keeps the rest, so nothing is lost, only put away. */
  .ck-table .ck-t td.ck-t-txt { max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── the header buttons ─────────────────────────────────────────────────────────────── */

  .ck-table .ck-t-sort {
    display: flex; align-items: center; gap: 5px; width: 100%;
    font: 700 10px/1 var(--ui); letter-spacing: .07em; text-transform: uppercase;
    color: var(--ink-dim); background: none; border: 0; padding: 8px 9px;
    cursor: pointer; text-align: inherit;
  }
  .ck-table th.ck-a-r .ck-t-sort { justify-content: flex-end; }
  .ck-table th.ck-a-c .ck-t-sort { justify-content: center; }
  .ck-table .ck-t-sort:hover { color: var(--accent); }
  .ck-table .ck-t-sort:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }

  /* Faint on hover, solid once sorting: the glyph says "you can sort by this" before it says
     "you are". Descending is the same chevron turned over, so there is one shape to learn. */
  .ck-table .ck-t-dir { width: 11px; height: 11px; flex: none; opacity: 0; transition: opacity .12s, transform .12s; }
  .ck-table .ck-t-sort:hover .ck-t-dir { opacity: .35; }
  .ck-table th[aria-sort="ascending"] .ck-t-dir  { opacity: 1; }
  .ck-table th[aria-sort="descending"] .ck-t-dir { opacity: 1; transform: rotate(180deg); }
  .ck-table th[aria-sort="ascending"] .ck-t-sort,
  .ck-table th[aria-sort="descending"] .ck-t-sort { color: var(--accent); }

  /* ── cell furniture ─────────────────────────────────────────────────────────────────── */

  .ck-table .ck-t-bool { display: inline-block; width: 13px; height: 13px; line-height: 0; }
  .ck-table .ck-t-bool svg { width: 13px; height: 13px; display: block; }
  .ck-table .ck-t-bool.on  { color: var(--good); }
  .ck-table .ck-t-bool.off { color: var(--ink-faint); }

  .ck-table .ck-t-bar { display: flex; align-items: center; gap: 7px; justify-content: flex-end; }
  .ck-table .ck-t-bar b { font-weight: 400; font-variant-numeric: tabular-nums; }
  .ck-table .ck-t-barv { width: 54px; height: 8px; flex: none; display: block; }
  .ck-table .ck-t-barv rect { fill: var(--accent); }
  .ck-table .ck-t-barv .z { stroke: var(--rule); }

  /* Off-screen but still in the accessibility tree and still in textContent, which is what the
     filter reads: a boolean column drawn as a glyph is still findable by typing "yes". */
  .ck-table .ck-sr {
    position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }

  .ck-table .ck-t-none td {
    padding: 15px 9px; text-align: center;
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }
  .ck-table .ck-t-void { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); margin: 10px 0; }

  /* ── the pager ──────────────────────────────────────────────────────────────────────── */

  .ck-table .ck-t-page {
    display: flex; align-items: center; justify-content: flex-end; gap: 9px; margin-top: 8px;
    font-family: var(--mono); font-size: 10.5px; color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .ck-table .ck-t-page[hidden] { display: none; }
  .ck-table .ck-t-page button {
    width: 20px; height: 20px; padding: 0; line-height: 0;
    background: transparent; color: var(--ink-dim);
    border: 1px solid var(--pill-edge); border-radius: 4px; cursor: pointer;
  }
  .ck-table .ck-t-page button svg { width: 13px; height: 13px; display: block; margin: 0 auto; }
  .ck-table .ck-t-page button:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .ck-table .ck-t-page button:disabled { opacity: .3; cursor: default; }

  .ck-table .ck-t-count { color: var(--ink-faint); }

  @media (prefers-reduced-motion: reduce) {
    /* The chevron's flip is decoration; aria-sort and the colour carry the meaning. */
    .ck-table .ck-t-dir { transition: none; }
  }
`;
