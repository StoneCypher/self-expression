/**
 * The `rail` card type — a ranked, capped list that refills from a bench.
 *
 * A rail is the shape of "the n things I would do next". It holds at most `cap` rows, and when
 * one is removed the head of the bench is promoted into the gap, so the list stays the length
 * it promised to be. When the bench runs out it gets **shorter**, and that is the whole point:
 * a rail that padded itself back to `cap` would be inventing work, and a list of suggestions
 * that invents entries is worse than a short one. It generalises the desk's "tickets i'd pick
 * up next", which did this by hand for GitHub issues.
 *
 * Four decisions are worth defending before you read the code:
 *
 *   1. **The card does not know what a verb means.** A verb click dispatches
 *      `CustomEvent('ck-rail', { detail: { id, verb }, bubbles: true })` on the `<section>` and
 *      stops. It does not know about GitHub, it does not fetch, and it holds no allowlist of
 *      verbs. That is what makes it a card type rather than a second copy of the inbox: the
 *      page decides what "next" or "drop" does, and two pages can decide differently.
 *   2. **Actioned is not removed.** A row you have acted on is struck and marked and stays
 *      where it is, because a row that vanished the moment you clicked it takes its own
 *      evidence with it — you cannot see what you just did, or undo the wrong click. It leaves
 *      only when dismissed, which is a separate, deliberate second gesture.
 *   3. **The bench position is derived, never stored.** What persists is which ids are done and
 *      which are dismissed; where the cap falls is recomputed from that. A stored index and a
 *      stored dismissal list are two facts about one thing, and the first time they disagree
 *      the rail is wrong in a way nothing in the card can detect. One fact, computed twice, is
 *      always cheaper than two facts kept in step.
 *   4. **Everything is rendered in Node, once.** Items and bench alike, escaped, in order. The
 *      browser half only moves rows between two lists and toggles classes. There is exactly one
 *      place where data becomes markup and exactly one escape to get right, and the card still
 *      says what it knows if the script never runs.
 *
 * `icon` on a verb is HTML when it starts with `<`, and that is the ONE exception to the
 * contract's "all data is untrusted" rule — it is trusted by contract, because the desk's own
 * verbs are hand-drawn SVG and no escaped string can be a glyph. Anything else, including a
 * plain emoji, goes in as escaped text. Every other field — `text`, `tag`, `title`, `key`, `id`
 * — is untrusted and escaped, `href` is allowlisted by parsing, and the state read back out of
 * `localStorage` is re-vetted against the ids actually on the rail before it is believed.
 *
 * @see meta for the accepted shape
 * @see defaults for the settings
 */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * `cap` is the rail's length. `data.cap` overrides this per card; this is the type's fallback
 * when neither says. A cap of 0 is legal and means "show nothing on the rail", which is a
 * useful state when the bench is being reviewed rather than worked.
 *
 * `showBench` is off by default because the bench is the card's mechanism, not its content:
 * the reader's question is "what next", and answering it with twenty rows they did not ask
 * about is answering a different question.
 *
 * Exported so the settings panel's field names can be checked against it in both directions: a
 * `name` in the markup that is not a key here is a control that silently does nothing, and
 * `CK.settings` — correctly — ignores it without complaining.
 *
 * Declared above {@link meta} so `meta.defaults` can be spread from it, which is where the
 * contract wants the settings to live; one written source, two places to read it.
 *
 * @example defaults.cap;   // 5
 */
export const defaults = { cap: 5, showBench: false, strike: true };

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * `cap` appears in both `shape` and `defaults` and means the same thing in each: the data may
 * state the length the rail was authored at, and the gear may then argue with it.
 *
 * @example meta.name;       // 'rail'
 * @example meta.defaults;   // { cap: 5, showBench: false, strike: true }
 */
export const meta = {
  name: 'rail',
  summary: 'A ranked list held to a fixed length: removing a row promotes the head of the bench, and an empty bench lets it shrink.',
  shape: '{ items: [{ id, text, href, tag }], bench: [{ id, text, href, tag }], cap, verbs: [{ key, title, icon }] } — ' +
         'a verb icon starting with < is trusted SVG markup, anything else is escaped text',
  defaults: { ...defaults },
};

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
 * A safe `href`, or '' when the value is not one.
 *
 * Allowlisted by parsing rather than blacklisted by matching, as the contract requires: a URL
 * is parsed and its protocol compared against exactly two values, so `javascript:`,
 * `data:`, `vbscript:` and every scheme nobody has thought of yet fail by default rather than
 * by being remembered. Relative URLs are rejected too — a desk card has no base worth guessing
 * at, and a link that resolves against whatever page happens to host the card is a link that
 * means something different on every desk.
 *
 * @param v the caller's `href`, possibly absent or hostile
 * @returns the normalised absolute URL, or '' when it must not be linked
 *
 * @example safeHref('https://example.com/x');    // 'https://example.com/x'
 * @example safeHref('javascript:alert(1)');      // ''
 * @example safeHref('/issues/3');                // ''
 */
function safeHref(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (s === '') return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

/**
 * The rail's rows in one ordered sequence: items first, then bench, deduped.
 *
 * Items beat bench and earlier beats later, because "first" is the only defensible tiebreak in
 * a list whose whole meaning is its order — and because an id appearing in both lists almost
 * always means the caller promoted something and forgot to remove it from the queue, where the
 * rail copy is the one they meant.
 *
 * Duplicates are dropped rather than renamed, and the count comes back so the caption can admit
 * to it. Two rows sharing an id would action and dismiss together, since state is stored by id:
 * the viewer would click one row and watch another strike itself out.
 *
 * A row with no `id` is a different failure and gets a different answer — a synthetic id,
 * checked against the ids already taken. Failing to name itself does not make a row less real,
 * and dropping it would lose content the caller handed over.
 *
 * @param items the caller's `items`
 * @param bench the caller's `bench`
 * @returns `{ rows, dupes }`; each row carries `id`, `text`, `tag`, `href` and `bench`
 *
 * @example normRows([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]).rows.map((r) => r.id);   // ['a', 'b']
 * @example normRows([{ id: 'a' }], [{ id: 'a' }]).dupes;                                // 1
 */
function normRows(items, bench) {
  const seen = Object.create(null);
  const rows = [];
  let dupes = 0;
  let auto  = 0;

  const take = (list, onBench) => {
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object') continue;

      let id = raw.id == null ? '' : String(raw.id);
      if (id === '') { do { id = 'r' + auto++; } while (seen[id]); }
      if (seen[id]) { dupes++; continue; }
      seen[id] = true;

      const href = safeHref(raw.href);
      /* An href with no tag would have nothing to hang on, and dropping it would throw away the
         only route back to the source. The id stands in — it is the row's name either way. */
      const tag = raw.tag == null || String(raw.tag) === ''
        ? (href === '' ? '' : id)
        : String(raw.tag);

      rows.push({ id, text: raw.text == null ? '' : String(raw.text), tag, href, bench: onBench });
    }
  };

  take(items, false);
  take(bench, true);
  return { rows, dupes };
}

/**
 * The verb list, normalised: every verb has a key, a title and something to draw.
 *
 * A verb with no `key` is dropped, because the key is the entire payload of the event this card
 * dispatches — a button that fires `{ verb: undefined }` is a button the page cannot act on and
 * cannot debug either.
 *
 * @param verbs the caller's `verbs`, possibly absent
 * @returns verbs with `key`, `title` and `icon` all settled to strings
 *
 * @example normVerbs([{ key: 'next' }])[0].title;   // 'next'
 */
function normVerbs(verbs) {
  const out = [];
  for (const v of Array.isArray(verbs) ? verbs : []) {
    if (!v || typeof v !== 'object') continue;
    const key = v.key == null ? '' : String(v.key);
    if (key === '') continue;
    out.push({
      key,
      title: v.title == null || String(v.title) === '' ? key : String(v.title),
      icon:  v.icon  == null ? '' : String(v.icon),
    });
  }
  return out;
}

/**
 * The mark an actioned row carries — drawn, not typed.
 *
 * A check emoji is a font lottery at 11px and picks up a colour this card did not choose; this
 * is the same shape in both themes and takes the token it is given.
 */
const DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
             '<path d="M5 12.5l4.5 4.5L19 7"/></svg>';

/**
 * One verb button.
 *
 * The icon is markup when it starts with `<` and escaped text otherwise, which is the desk's
 * own rule for its inbox buttons and is worth stating plainly: **this is the trusted-by-contract
 * exception**. A caller handing over `<svg>…</svg>` is handing over a drawing on purpose,
 * because no amount of escaping turns a string into a glyph. A caller handing over an emoji is
 * handing over text, and it is escaped like text. Nothing else on the row is ever markup.
 *
 * The two get different classes because they need opposite treatment. An emoji sits in a
 * cluster of emoji and is muted at rest; a drawn glyph must NOT be, because the grayscale that
 * calms an emoji eats exactly the hue the glyph was drawn to carry — so it rides a lower
 * opacity instead, which is the same restraint applied to a property that survives colour.
 *
 * @param v a normalised verb
 *
 * @example verbButton({ key: 'next', title: 'queue it', icon: '\u{1F916}' }).indexOf('ck-r-emo') >= 0;   // true
 */
function verbButton(v) {
  let face;
  if (v.icon.charAt(0) === '<') face = '<span class="ck-r-ico">' + v.icon + '</span>';
  else if (v.icon === '')       face = '<span class="ck-r-word">' + esc(v.key) + '</span>';
  else                          face = '<span class="ck-r-emo">' + esc(v.icon) + '</span>';

  return '<button type="button" class="ck-r-verb" data-verb="' + esc(v.key) + '"' +
         ' title="' + esc(v.title) + '" aria-label="' + esc(v.title) + '">' + face + '</button>';
}

/**
 * One row: its tag, its text, its done-mark, its verbs, and the dismiss it always has.
 *
 * The dismiss button is the card's own and is not one of `verbs`, for two reasons. It is the
 * only gesture that changes the *shape* of the rail — everything else is a message to the page
 * — and without a built-in one a card given `verbs: []` could never free a slot, which would
 * make the refill rule unreachable and untestable.
 *
 * @param r     a normalised row
 * @param verbs the normalised verb list, possibly empty
 *
 * @example row({ id: 'a', text: 'x', tag: '', href: '' }, []).indexOf('ck-r-kill') >= 0;   // true
 */
function row(r, verbs) {
  const tag = r.tag === ''
    ? ''
    : r.href === ''
      ? '<span class="ck-r-tag">' + esc(r.tag) + '</span>'
      : '<a class="ck-r-tag" href="' + esc(r.href) + '" target="_blank" rel="noopener noreferrer">' + esc(r.tag) + '</a>';

  return '<li class="ck-r-row" data-id="' + esc(r.id) + '">' +
         tag +
         '<span class="ck-r-text">' + esc(r.text) + '</span>' +
         '<span class="ck-r-mark" aria-hidden="true">' + DONE + '</span>' +
         '<span class="ck-r-verbs">' +
         verbs.map(verbButton).join('') +
         '<button type="button" class="ck-r-kill" title="remove from the rail"' +
         ' aria-label="remove from the rail">&times;</button>' +
         '</span></li>';
}

/**
 * The card's browser half: promotion, marking and persistence. Nothing is rendered here.
 *
 * Every row already exists in the markup, in rail-then-bench order, escaped once in Node. The
 * script moves rows between the two lists and toggles classes — so the promotion is literally a
 * node moving from the bench list into the rail list, which is both the cheapest implementation
 * and the one that is easiest to be sure about.
 *
 * Written as one string wrapped in a function expression so nothing reaches the global scope:
 * the desk can hold two `rail` cards and a top-level `var` would have them sharing it.
 *
 * @param id      the card's `data-card` value, embedded as a literal
 * @param runtime the runtime defaults — the type's `defaults` with `cap` replaced by `data.cap`
 *
 * @example main('next', { cap: 5, showBench: false, strike: true }).indexOf('ck-rail') >= 0;   // true
 */
function main(id, runtime) {
  return [
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var listEl  = sec.querySelector(".ck-r-list");',
    '    var benchEl = sec.querySelector(".ck-r-bench");',
    '    var headEl  = sec.querySelector(".ck-r-benchhead");',
    '    var noneEl  = sec.querySelector(".ck-r-none");',
    '    var countEl = sec.querySelector(".ck-r-count");',
    '    var capEl   = sec.querySelector(".ck-r-cap");',
    '    if (!listEl || !benchEl) return;',
    '',
    '    /* Its own key, not the settings key: what you have done and dismissed is a record, and',
    '       how long you like the rail is a preference. Losing one must not take the other. */',
    '    var KEY = "desk.rail." + ' + jsStr(id) + ';',
    '',
    '    /* Captured once, in source order — items then bench. That order IS the ranking, and',
    '       everything below is a function of it plus which ids are gone. */',
    '    var els = sec.querySelectorAll(".ck-r-row"), rows = [], known = {}, i;',
    '    for (i = 0; i < els.length; i++) {',
    '      var rid = els[i].getAttribute("data-id");',
    '      rows.push({ el: els[i], id: rid });',
    '      known[rid] = 1;',
    '    }',
    '',
    '    var cap = ' + runtime.cap + ', showBench = false;',
    '',
    '    /* Re-vetted, not trusted. localStorage is a text file the viewer can edit, and an id',
    '       that is not on this rail would be a dismissal of a row that does not exist. The',
    '       lookup is a strict === 1 rather than truthy, so an entry named "toString" cannot',
    '       borrow Object.prototype and pass for a row. */',
    '    function take(src, dst) {',
    '      var k;',
    '      if (Object.prototype.toString.call(src) !== "[object Array]") return;',
    '      for (k = 0; k < src.length; k++) {',
    '        if (typeof src[k] === "string" && known[src[k]] === 1) dst[src[k]] = 1;',
    '      }',
    '    }',
    '',
    '    function load() {',
    '      var raw = null, out = { done: {}, gone: {} };',
    '      try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { raw = null; }',
    '      if (!raw || typeof raw !== "object") return out;',
    '      take(raw.done, out.done);',
    '      take(raw.gone, out.gone);',
    '      return out;',
    '    }',
    '',
    '    var state = load();',
    '',
    '    /* Written back in rail order and only for rows that still exist, so the stored record',
    '       cannot accumulate ids from a version of the data that is no longer being shown. */',
    '    function save() {',
    '      var d = [], g = [], k;',
    '      for (k = 0; k < rows.length; k++) {',
    '        if (state.done[rows[k].id] === 1) d.push(rows[k].id);',
    '        if (state.gone[rows[k].id] === 1) g.push(rows[k].id);',
    '      }',
    '      try {',
    '        localStorage.setItem(KEY, JSON.stringify({ done: d, gone: g }));',
    '      } catch (e) { /* private window */ }',
    '    }',
    '',
    '    /* The refill rule, in four lines and no bookkeeping.',
    '',
    '       A dismissed row is out of the sequence entirely; what is left is the live list, still',
    '       in the original ranking. The first cap of those are the rail and the remainder is the',
    '       bench — so dismissing a rail row shortens the prefix by one and the row that was',
    '       first on the bench becomes last on the rail, which is the promotion, achieved by not',
    '       having to do anything. When the bench is exhausted the slice is simply shorter than',
    '       the cap and the rail shrinks, honestly, rather than padding itself back to length.',
    '',
    '       Note what is NOT here: a stored bench index. It would be a second fact about the same',
    '       thing, and the first time it disagreed with the dismissal list the rail would be',
    '       wrong in a way nothing in this card could notice. */',
    '    function apply() {',
    '      var live = [], k, r;',
    '      for (k = 0; k < rows.length; k++) {',
    '        r = rows[k];',
    '        r.el.hidden = state.gone[r.id] === 1;',
    '        r.el.classList.toggle("ck-r-is-done", state.done[r.id] === 1);',
    '        if (state.gone[r.id] !== 1) live.push(r);',
    '      }',
    '',
    '      var onRail  = cap > 0 ? live.slice(0, cap) : [];',
    '      var onBench = live.slice(onRail.length);',
    '',
    '      /* One fragment per list, one insertion each: moving rows one at a time would relayout',
    '         the card once per row, and a long bench makes that visible. */',
    '      var fr = document.createDocumentFragment();',
    '      for (k = 0; k < onRail.length; k++) fr.appendChild(onRail[k].el);',
    '      listEl.appendChild(fr);',
    '      var fb = document.createDocumentFragment();',
    '      for (k = 0; k < onBench.length; k++) fb.appendChild(onBench[k].el);',
    '      benchEl.appendChild(fb);',
    '',
    '      var showing = showBench && onBench.length > 0;',
    '      benchEl.hidden = !showing;',
    '      if (headEl) headEl.hidden = !showing;',
    '',
    '      if (noneEl) {',
    '        var why = "";',
    '        if (rows.length === 0) why = "nothing on the rail and nothing on the bench";',
    '        else if (cap <= 0) why = "the rail length is 0 \\u2014 everything is on the bench";',
    '        else if (onRail.length === 0) why = "every row has been removed";',
    '        noneEl.textContent = why;',
    '        noneEl.hidden = why === "";',
    '      }',
    '',
    '      if (countEl) countEl.textContent = summary(onRail.length, onBench.length);',
    '    }',
    '',
    '    /* Said in full, because every one of these states is a state the reader might otherwise',
    '       read as a bug: a short rail, an empty rail, and rows that are simply gone. */',
    '    function summary(nRail, nBench) {',
    '      var gone = 0, k;',
    '      for (k = 0; k < rows.length; k++) if (state.gone[rows[k].id] === 1) gone++;',
    '',
    '      var out;',
    '      if (rows.length === 0) out = "no items and no bench";',
    '      else if (nRail === 0) out = "nothing on the rail";',
    '      else out = nRail + " on the rail";',
    '',
    '      if (nBench > 0) out += ", " + nBench + " on the bench";',
    '      else if (nRail > 0 && cap > nRail) out += " of a cap of " + cap + ", and the bench is empty";',
    '      if (gone > 0) out += "; " + gone + " removed";',
    '      return out;',
    '    }',
    '',
    '    /* ONE listener on the section, not one per button. A rail plus its bench can be long,',
    '       every row carries a verb for each verb in the list, and the rows move between two',
    '       parents on every change — a listener bound to a button would have to be rebound or',
    '       reasoned about every time, and delegation simply does not care. */',
    '    CK.once(sec, "rail", function () {',
    '      sec.addEventListener("click", function (ev) {',
    '        var t = ev.target;',
    '        if (!t || !t.closest) return;',
    '        var li = t.closest(".ck-r-row");',
    '        if (!li) return;',
    '        var rid = li.getAttribute("data-id");',
    '',
    '        /* Dismissal is bookkeeping and stays local: it changes what this card shows and',
    '           nothing else. Verbs are messages and go out. */',
    '        if (t.closest(".ck-r-kill")) {',
    '          state.gone[rid] = 1;',
    '          save();',
    '          apply();',
    '          return;',
    '        }',
    '',
    '        var btn = t.closest(".ck-r-verb");',
    '        if (!btn) return;',
    '        state.done[rid] = 1;',
    '        save();',
    '        apply();',
    '        /* Dispatched AFTER the DOM has settled, so a listener that reads the card sees the',
    '           state the click produced rather than the one it replaced. The card says what',
    '           happened and to which row; what the verb MEANS is the page\'s business, which is',
    '           why there is no allowlist of verbs here and no fetch anywhere in this file. */',
    '        sec.dispatchEvent(new CustomEvent("ck-rail", {',
    '          detail: { id: rid, verb: btn.getAttribute("data-verb") },',
    '          bubbles: true',
    '        }));',
    '      });',
    '    });',
    '',
    '    CK.settings(sec, ' + JSON.stringify(runtime) + ', function (cfg) {',
    '      var c = Math.floor(Number(cfg.cap));',
    '      cap = isFinite(c) && c > 0 ? c : 0;',
    '      showBench = !!cfg.showBench;',
    '      sec.classList.toggle("ck-r-strike", !!cfg.strike);',
    '      /* The caption states the cap, so it has to be told when the cap changes: a caption',
    '         claiming a rail of five over a rail of two is worse than no caption at all. */',
    '      if (capEl) capEl.textContent = String(cap);',
    '      apply();',
    '    });',
    '  });',
  ].join('\n');
}

/**
 * Build one rail card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  `{ items, bench, cap, verbs }`; a verb `icon` starting with `<` is trusted markup
 *              and every other value in it is untrusted and escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'next', title: 'up next', ord: 9, data: {
 *   cap: 3,
 *   items: [{ id: '41', tag: '#41', text: 'the ascii renderers', href: 'https://example.com/41' }],
 *   bench: [{ id: '44', tag: '#44', text: 'the queue file' }],
 *   verbs: [{ key: 'next', title: 'queue it', icon: '<svg viewBox="0 0 24 24"></svg>' }]
 * } }).html.indexOf('data-verb="next"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d = data && typeof data === 'object' ? data : {};

  const { rows, dupes } = normRows(d.items, d.bench);
  const verbs = normVerbs(d.verbs);

  /* A cap that is not a number at all falls back to the type's default, because a caller who
     wrote `cap: 'five'` meant a length and showing them an empty rail answers a question they
     did not ask. A cap that IS a number and is zero or negative is honoured as zero: that is a
     legible instruction — "put everything on the bench" — and overriding it would be the card
     deciding it knows better than the caller about the caller's own list. */
  const capRaw = Math.floor(Number(d.cap));
  const cap    = Number.isFinite(capRaw) ? Math.max(0, capRaw) : defaults.cap;

  /* Rendered even when the bench is long: every row exists in the markup from the start, and
     the browser half only decides which list it is currently in. The alternative — rendering
     the rail and holding the bench as data for the script to build later — would put a second
     escape in a second place, which is exactly the hole the contract is written to prevent. */
  const body = rows.map((r) => row(r, verbs)).join('\n    ');

  const dropped = dupes === 0
    ? ''
    : ' <span class="ck-aside">' + dupes + (dupes === 1 ? ' duplicate id was' : ' duplicate ids were') +
      ' dropped; items win over the bench, and earlier wins over later.</span>';
  const noVerbs = verbs.length === 0
    ? ' <span class="ck-aside">no verbs were given, so a row can only be removed.</span>'
    : '';

  const caption =
    'at most <i class="ck-r-cap">' + cap + '</i> at a time. removing one promotes whatever is at ' +
    'the head of the bench, so the rail stays full &mdash; and when the bench is empty it ' +
    '<b>gets shorter rather than inventing filler</b>. acting on a row strikes it out and leaves ' +
    'it where it is; it goes away when you dismiss it.' + noVerbs + dropped +
    ' <i class="ck-r-count"></i>';

  /* Visible from the start when there is genuinely nothing, so the card says so without needing
     the script; the browser half rewrites and re-hides it from there. */
  const noneOpen = rows.length === 0;

  const html =
    '<section data-card="' + esc(id) + '" class="ck-rail ck-r-strike">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-cap">rail length</label>\n' +
    '    <input type="number" id="' + esc(id) + '-cap" name="cap" min="0" max="200" step="1">\n' +
    '    <label for="' + esc(id) + '-showBench">show the bench</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-showBench" name="showBench">\n' +
    '    <label for="' + esc(id) + '-strike">strike what is done</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-strike" name="strike">\n' +
    '    <div class="ck-set-foot">a rail length of 0 puts everything on the bench. the bench is what is queued behind the rail; it never invents rows to fill a gap.</div>\n' +
    '  </div>\n' +
    '  <div class="ck-cap">' + caption + '</div>\n' +
    '  <ol class="ck-r-list">' + (body === '' ? '' : '\n    ' + body + '\n  ') + '</ol>\n' +
    '  <div class="ck-r-none"' + (noneOpen ? '' : ' hidden') + '>' +
    (noneOpen ? 'nothing on the rail and nothing on the bench' : '') + '</div>\n' +
    '  <div class="ck-h3 ck-r-benchhead" hidden>on the bench</div>\n' +
    '  <ol class="ck-r-bench" hidden></ol>\n' +
    '</section>\n';

  /* `cap` from the data becomes this card's fallback, while the exported `defaults` stays the
     type's. The field NAMES are what has to agree with `defaults`, and they do; the values are
     per card by design, which is the whole reason `data.cap` exists. */
  const js = '(function () {\n' + main(id, { ...defaults, cap }) + '\n})();\n';

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch
   is the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The
   desk is one document open in two viewers who want different answers, and the OS only knows
   how to give both of them the same one. */
const CSS = `
  .ck-rail { position: relative; }

  .ck-rail .ck-r-list, .ck-rail .ck-r-bench { list-style: none; margin: 10px 0 0; padding: 0; }
  .ck-rail .ck-r-bench { margin-top: 4px; }
  .ck-rail .ck-r-bench[hidden], .ck-rail .ck-r-benchhead[hidden], .ck-rail .ck-r-none[hidden] { display: none; }

  /* Rows, not pills. The desk's tickets wrapped inline and needed a ground of their own to keep
     an edge across a line break; a rail is one row per line by definition, so a hairline is
     enough delimiter and costs far less ink at twenty rows. */
  .ck-rail .ck-r-row {
    display: flex; align-items: baseline; gap: 7px;
    padding: 4px 3px; border-bottom: 1px solid var(--hairline);
    font-size: 12px; color: var(--ink);
  }
  /* [hidden] and the display rule above tie on specificity, and this sheet loads after the UA's,
     so a dismissed row would stay visible without saying so. */
  .ck-rail .ck-r-row[hidden] { display: none; }
  .ck-rail .ck-r-row:hover { background: var(--pill); }

  /* The identifier gets its own node so it can carry its own colour: it is a name rather than
     part of the sentence, and tinting it lets the eye skip past it when reading the list and
     land on it when hunting for one. */
  .ck-rail .ck-r-tag {
    flex: none; font-family: var(--mono); font-size: 11px;
    color: var(--accent); text-decoration: none;
  }
  .ck-rail a.ck-r-tag:hover { text-decoration: underline; }

  .ck-rail .ck-r-text { flex: 1 1 auto; min-width: 0; }

  /* Done says itself twice, and deliberately. The strike is a setting and can be turned off;
     the mark cannot, because "you have already acted on this" is information the card must not
     be configurable into hiding. */
  .ck-rail .ck-r-mark { display: none; flex: none; color: var(--good); line-height: 0; }
  .ck-rail .ck-r-mark svg { width: 11px; height: 11px; display: block; }
  .ck-rail .ck-r-is-done { color: var(--ink-faint); }
  .ck-rail .ck-r-is-done .ck-r-mark { display: inline-flex; align-self: center; }
  .ck-rail.ck-r-strike .ck-r-is-done .ck-r-text { text-decoration: line-through; }

  .ck-rail .ck-r-verbs { flex: none; display: inline-flex; align-items: center; gap: 2px; }
  .ck-rail .ck-r-verb, .ck-rail .ck-r-kill {
    font: inherit; line-height: 1; padding: 0 3px; cursor: pointer;
    background: transparent; border: none;
  }

  /* An emoji sits in a cluster of emoji and is muted at rest so the row's words stay the loudest
     thing on it. A drawn glyph opts out of the grayscale entirely: it would eat exactly the hue
     the glyph was drawn to carry, and the button would then be a picture of a different icon. */
  .ck-rail .ck-r-emo { font-size: 12px; filter: grayscale(.55); opacity: .75; }
  .ck-rail .ck-r-verb:hover .ck-r-emo { filter: none; opacity: 1; }

  /* vertical-align because an inline-flex box has no baseline of its own to offer: an <svg> is
     not a baseline-bearing child, so the box aligns by its bottom margin edge and the glyph
     sits a few pixels high of the emoji beside it. The offset is the descender room the emoji
     occupy and the drawing does not. */
  .ck-rail .ck-r-ico {
    display: inline-flex; align-items: center; vertical-align: -2px;
    opacity: .85; color: var(--ink-dim);
  }
  .ck-rail .ck-r-ico svg { width: 13px; height: 13px; display: block; }
  .ck-rail .ck-r-verb:hover .ck-r-ico { opacity: 1; color: var(--accent); }

  /* A verb with no icon still needs a face, and the key is the truest one available: it is
     exactly the string the page will receive. */
  .ck-rail .ck-r-word {
    font: 700 9px/1 var(--ui); letter-spacing: .08em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  .ck-rail .ck-r-verb:hover .ck-r-word { color: var(--accent); }

  /* Faint like the card Xes, for the same reason: removal should be available, not advertised. */
  .ck-rail .ck-r-kill { font-size: 12px; color: var(--ink-faint); opacity: .55; }
  .ck-rail .ck-r-kill:hover { opacity: 1; color: var(--ink); }

  /* The bench is a preview of what is queued, not a second rail, so it reads quieter than the
     thing it is behind — and stays fully interactive, because dismissing something on the bench
     is a real decision about what gets promoted next. */
  .ck-rail .ck-r-bench .ck-r-row { opacity: .6; border-bottom-style: dashed; }
  .ck-rail .ck-r-bench .ck-r-row:hover { opacity: 1; }

  .ck-rail .ck-r-none { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); margin: 10px 0; }
  .ck-rail .ck-r-count { color: var(--ink-faint); }

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box;
     it wants to be its own size, at the start of its column. */
  .ck-rail .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }
`;
