/**
 * The `choice` card type — a contact sheet for picking between n candidates.
 *
 * The card has exactly one thesis and everything in it serves that thesis: **a candidate is
 * judged at the size the decision is actually made at, among the things it will actually sit
 * beside.** So every tile shows its candidate twice. Once large, which is only there so you can
 * see what was drawn; and once at `size` inside `context`, which is the render that decides.
 * The caption says this out loud, because a reader who judges by the large one is reading the
 * card backwards and the card is the only thing in a position to tell them.
 *
 * It generalises the icon lab, which compared a hundred hand-drawn glyphs at 13px beside the
 * emoji they would share a button row with. Nothing here knows what a candidate is: `render` is
 * a string of HTML, and an SVG glyph, a colour swatch and a line of text are all the same to
 * this file. That is the generalisation — the lab's *procedure* survives, its subject does not.
 *
 * Three things about the implementation are worth saying before you read it:
 *
 *   1. **One listener, not n.** The sheet is built to hold three hundred tiles, and three
 *      hundred registrations is three hundred closures that all have to be torn down again on
 *      every `<main>` swap. A single delegated listener on the `<section>` costs one, is O(1) in
 *      the candidate count, and keeps working when the tiles are reordered underneath it.
 *   2. **Size is a class, not a style.** The desk serves under a CSP, and an inline `style`
 *      attribute is the first thing a strict `style-src` refuses. So the working size is a
 *      generated class per pixel value, `ck-c-px8` through `ck-c-px48`, and the browser half
 *      swaps one class on the section. One CSS property — `font-size` — drives it, and drawn
 *      renders follow because their `svg` is sized in `em`.
 *   3. **`render` and `context` are HTML by design.** They are the ONE exception to the "all
 *      data is untrusted" rule in the contract, and they are trusted-by-contract: the caller is
 *      handing this card markup on purpose, because a card that escaped its candidates could
 *      only ever compare strings. Every other field — `id`, `label`, group labels — is
 *      untrusted and escaped, and the keeps read back out of `localStorage` are re-vetted
 *      against the ids actually on the sheet before they are believed.
 *
 * @see meta for the accepted shape
 * @see defaults for the settings
 */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * `size` is the working size in pixels — the size the decision is made at, not a display
 * preference. It is a setting rather than a constant because the right answer is a property of
 * where the candidate will end up: 13px for a button-row glyph, 24px for a toolbar, 40px for a
 * tab strip. `data.size` overrides this per card; this is the type's fallback when neither
 * says.
 *
 * `sort` is `given` | `id` | `kept`. `given` is the order the caller wrote, which is usually
 * meaningful — a sheet of variants is written variant-next-to-original on purpose.
 *
 * Exported so the settings panel's field names can be checked against it in both directions: a
 * `name` in the markup that is not a key here is a control that silently does nothing, and
 * `CK.settings` — correctly — ignores it without complaining.
 *
 * Declared above {@link meta} so `meta.defaults` can be spread from it, which is where the
 * contract wants the settings to live; one written source, two places to read it.
 *
 * @example defaults.sort;   // 'given'
 */
export const defaults = { size: 13, showLarge: true, sort: 'given' };

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * `size` appears in both `shape` and `defaults` and means the same thing in each: the data may
 * state the working size the card was authored for, and the gear may then argue with it.
 *
 * @example meta.name;       // 'choice'
 * @example meta.defaults;   // { size: 13, showLarge: true, sort: 'given' }
 */
export const meta = {
  name: 'choice',
  summary: 'A contact sheet of candidates, each shown once to read and once at the size the decision is really made at.',
  shape: '{ candidates: [{ id, label, render }], size, context, groups: [{ label, members: [id] }] } — ' +
         'render and context are trusted HTML, everything else is escaped; size is the working pixel size',
  defaults: { ...defaults },
};

/** The working sizes the generated classes cover. Below 8px nothing is legible; above 48px the
 *  question is no longer "does this survive being small". The setting is clamped into this. */
const SIZE_MIN = 8;
const SIZE_MAX = 48;

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
 * The working size, rounded and clamped into the range the generated classes cover.
 *
 * Clamped rather than rejected: a caller who asks for 6px has said something meaningful about
 * intent — *very small* — and answering with the smallest legible size honours it. Answering
 * with a default would silently discard it.
 *
 * @param v        the caller's `size`, possibly absent or nonsense
 * @param fallback the value to use when `v` is not a number at all
 * @returns an integer between {@link SIZE_MIN} and {@link SIZE_MAX}
 *
 * @example clampSize(200, 13);     // 48
 * @example clampSize('big', 13);   // 13
 */
function clampSize(v, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
}

/**
 * The candidate list, normalised: every entry has a usable id, and no id appears twice.
 *
 * Duplicates are dropped rather than renamed, and the count comes back so the caption can admit
 * to it. Two tiles sharing an id would toggle together, because a keep is stored by id — the
 * viewer would click one tile and watch another light up, which reads as a bug in the card
 * rather than as a mistake in the data.
 *
 * A candidate with no `id` is given a synthetic one, because *not naming itself* is a different
 * failure from *colliding*: the row is still a real candidate and still deserves a tile. The
 * synthetic name is checked against the ids already taken, so an author who happens to use
 * `c0` loses nothing.
 *
 * @param list the caller's `candidates`, possibly absent or holding junk
 * @returns `{ cands, dupes }` — the surviving candidates in source order, and how many were dropped
 *
 * @example normCandidates([{ id: 'a', render: '<b>a</b>' }, { id: 'a' }]).dupes;   // 1
 */
function normCandidates(list) {
  const raw   = Array.isArray(list) ? list : [];
  const seen  = Object.create(null);
  const cands = [];
  let dupes = 0;
  let auto  = 0;

  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;

    let id = c.id == null ? '' : String(c.id);
    if (id === '') { do { id = 'c' + auto++; } while (seen[id]); }
    if (seen[id]) { dupes++; continue; }
    seen[id] = true;

    cands.push({
      id,
      label:  c.label == null ? '' : String(c.label),
      /* Trusted by contract. This is the one field the card does not escape, because escaping
         it would turn every candidate into a printout of its own source. */
      render: typeof c.render === 'string' ? c.render : '',
    });
  }

  return { cands, dupes };
}

/**
 * The sheet's sections: either one unlabelled section, or one per group plus the leftovers.
 *
 * A group naming an id that is not on the sheet is ignored, and an id claimed by two groups
 * lands in the first that claims it — a candidate can only be in one place, and the first claim
 * is the one the author wrote first. Candidates no group claims get a trailing section rather
 * than being dropped: a card that silently omits data it was handed is the worst failure
 * available to it.
 *
 * An empty group is dropped entirely, heading and all, for the reason the desk gives about its
 * own inbox: an empty heading is a small lie — it implies a category you have to check, when
 * the truthful state is silence.
 *
 * @param groups the caller's `groups`; `members` may also be spelled `ids`
 * @param cands  the normalised candidates
 * @returns `[{ label, list }]`, where an empty label means "no heading"
 *
 * @example
 * groupSections([{ label: 'land', members: ['a'] }], [{ id: 'a' }, { id: 'b' }])
 *   .map((s) => s.label);   // ['land', 'everything else']
 */
function groupSections(groups, cands) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && typeof g === 'object') : [];
  if (list.length === 0) return [{ label: '', list: cands }];

  const byId = new Map(cands.map((c) => [c.id, c]));
  const used = new Set();
  const out  = [];

  for (const g of list) {
    const members = Array.isArray(g.members) ? g.members : Array.isArray(g.ids) ? g.ids : [];
    const picked  = [];
    for (const m of members) {
      const key = m == null ? '' : String(m);
      if (!byId.has(key) || used.has(key)) continue;
      used.add(key);
      picked.push(byId.get(key));
    }
    if (picked.length > 0) out.push({ label: g.label == null ? '' : String(g.label), list: picked });
  }

  const rest = cands.filter((c) => !used.has(c.id));
  if (rest.length > 0) out.push({ label: out.length > 0 ? 'everything else' : '', list: rest });

  return out;
}

/**
 * The stand-in for a candidate whose `render` is empty.
 *
 * A blank tile would be indistinguishable from a tile that failed to draw, and the difference
 * matters when you are comparing drawings. A dashed box of exactly the render's size says "this
 * candidate is empty" rather than "something went wrong here".
 */
const BLANK = '<span class="ck-c-blank" aria-hidden="true"></span>';

/**
 * One tile: the candidate large, the candidate at working size among its neighbours, its id.
 *
 * The tile is a `<button>` because clicking it does something, which means `render` and
 * `context` must be inert phrasing content — a button cannot contain a control, and a caller
 * who puts one there gets invalid markup. That is a documented constraint on the trusted HTML,
 * not something this card can check.
 *
 * @param c   a normalised candidate
 * @param ctx the trusted context markup, or '' for none
 *
 * @example tile({ id: 'a', label: 'first', render: '<i>x</i>' }, '').indexOf('data-id="a"') >= 0;   // true
 */
function tile(c, ctx) {
  const art   = c.render === '' ? BLANK : c.render;
  const title = esc(c.id) + (c.label === '' ? '' : ' &mdash; ' + esc(c.label));

  return '<button type="button" class="ck-tile ck-c-tile" data-id="' + esc(c.id) + '"' +
         ' aria-pressed="false" title="' + title + '">' +
         '<span class="ck-c-big">' + art + '</span>' +
         '<span class="ck-c-row"><span class="ck-c-sm">' + art + '</span>' +
         (ctx === '' ? '' : '<span class="ck-c-ctx">' + ctx + '</span>') +
         '</span>' +
         '<span class="ck-c-id">' + esc(c.id) + '</span>' +
         '</button>';
}

/**
 * The card's browser half: keeping, ordering and sizing. Nothing is rendered here.
 *
 * Every tile already exists in the markup, in source order, escaped once in Node. The script
 * only ever *rearranges* and *marks* what is there — which means there is one place where data
 * becomes markup, and the sheet still says what it knows if the script never runs. A contact
 * sheet that needs JavaScript to show its candidates is a worse contact sheet.
 *
 * Written as one string wrapped in a function expression so nothing reaches the global scope:
 * the desk can hold two `choice` cards and a top-level `var` would have them sharing it.
 *
 * @param id      the card's `data-card` value, embedded as a literal
 * @param runtime the runtime defaults — the type's `defaults` with `size` replaced by `data.size`
 *
 * @example main('icons', { size: 13, showLarge: true, sort: 'given' }).indexOf('CK.build') >= 0;   // true
 */
function main(id, runtime) {
  return [
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var sheets  = sec.querySelectorAll(".ck-c-sheet");',
    '    var listEl  = sec.querySelector(".ck-c-list");',
    '    var sizeEl  = sec.querySelector(".ck-c-size");',
    '    var countEl = sec.querySelector(".ck-c-count");',
    '',
    '    /* Its own key, not the settings key: what you kept is an answer, and the size you',
    '       judged it at is a preference. Losing one should never take the other with it. */',
    '    var KEY = "desk.choice." + ' + jsStr(id) + ';',
    '    var NAT = { numeric: true, sensitivity: "base" };',
    '',
    '    /* Tiles are captured once, per sheet, in source order. That index is what the "given"',
    '       order restores and what every tie in a comparator falls back to, so each sort is a',
    '       total order and re-sorting never quietly reshuffles equal tiles. */',
    '    var groups = [], known = {}, total = 0, i, j;',
    '    for (i = 0; i < sheets.length; i++) {',
    '      var els = sheets[i].querySelectorAll(".ck-c-tile"), tiles = [];',
    '      for (j = 0; j < els.length; j++) {',
    '        var tid = els[j].getAttribute("data-id");',
    '        tiles.push({ el: els[j], id: tid, i: j });',
    '        known[tid] = 1;',
    '      }',
    '      total += tiles.length;',
    '      groups.push({ host: sheets[i], tiles: tiles });',
    '    }',
    '',
    '    /* Natural order, then a raw tiebreak. "base" sensitivity makes A and a compare equal,',
    '       and an engine is free to order equals however it likes — so the raw comparison is',
    '       there to make this a total order rather than an almost-total one. */',
    '    function cmpId(a, b) {',
    '      var r = a.localeCompare(b, undefined, NAT);',
    '      return r !== 0 ? r : (a < b ? -1 : a > b ? 1 : 0);',
    '    }',
    '',
    '    /* Re-vetted, not trusted. localStorage is a text file the viewer can edit, and an id',
    '       that is not on this sheet would show up in the picked line as a value nobody chose.',
    '       The lookup is a strict === 1 rather than truthy, so an entry named "toString" cannot',
    '       borrow Object.prototype and pass for a candidate. */',
    '    function load() {',
    '      var raw = null, out = [], k, v;',
    '      try { raw = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { raw = null; }',
    '      if (Object.prototype.toString.call(raw) !== "[object Array]") return out;',
    '      for (k = 0; k < raw.length; k++) {',
    '        v = raw[k];',
    '        if (typeof v === "string" && known[v] === 1 && out.indexOf(v) < 0) out.push(v);',
    '      }',
    '      return out;',
    '    }',
    '',
    '    var kept = load(), keptSet = {}, sortMode = "given";',
    '',
    '    function reindex() {',
    '      keptSet = {};',
    '      for (var k = 0; k < kept.length; k++) keptSet[kept[k]] = 1;',
    '    }',
    '    reindex();',
    '',
    '    function save() {',
    '      try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch (e) { /* private window */ }',
    '    }',
    '',
    '    function mark(el, on) {',
    '      el.classList.toggle("on", on);',
    '      el.setAttribute("aria-pressed", on ? "true" : "false");',
    '    }',
    '',
    '    function applyMarks() {',
    '      var gi, k, t;',
    '      for (gi = 0; gi < groups.length; gi++) {',
    '        t = groups[gi].tiles;',
    '        for (k = 0; k < t.length; k++) mark(t[k].el, keptSet[t[k].id] === 1);',
    '      }',
    '    }',
    '',
    '    /* The point of the whole card: a line you can read out loud. Sorted, because the order',
    '       you happened to click in is not information and reading it back in click order makes',
    '       two identical shortlists look different. */',
    '    function paintPicks() {',
    '      if (!listEl) return;',
    '      var s = kept.slice(0).sort(cmpId);',
    '      listEl.textContent = s.length ? s.join(", ") : "nothing yet";',
    '      listEl.className = s.length ? "ck-c-list" : "ck-c-list ck-c-none";',
    '    }',
    '',
    '    function paintCount() {',
    '      if (!countEl) return;',
    '      countEl.textContent = total + (total === 1 ? " candidate" : " candidates") +',
    '        (kept.length ? ", " + kept.length + " kept" : "");',
    '    }',
    '',
    '    /* One fragment per sheet and one insertion: three hundred tiles reordered one at a time',
    '       is three hundred layouts. The "given" order needs no comparator at all: the list is',
    '       already source order and re-appending in that order is what puts the sheet back. */',
    '    function order(mode) {',
    '      var gi, k, g, seq, frag;',
    '      for (gi = 0; gi < groups.length; gi++) {',
    '        g = groups[gi];',
    '        seq = g.tiles.slice(0);',
    '        if (mode === "id") {',
    '          seq.sort(function (a, b) { var r = cmpId(a.id, b.id); return r !== 0 ? r : a.i - b.i; });',
    '        } else if (mode === "kept") {',
    '          seq.sort(function (a, b) {',
    '            var ka = keptSet[a.id] === 1 ? 0 : 1, kb = keptSet[b.id] === 1 ? 0 : 1;',
    '            return ka !== kb ? ka - kb : a.i - b.i;',
    '          });',
    '        }',
    '        frag = document.createDocumentFragment();',
    '        for (k = 0; k < seq.length; k++) frag.appendChild(seq[k].el);',
    '        g.host.appendChild(frag);',
    '      }',
    '    }',
    '',
    '    /* A class, not a style attribute: the desk serves under a CSP and a strict style-src',
    '       refuses inline styles outright. Every other class on the section is preserved — the',
    '       desk puts its own "away" class here and rewriting className blindly would drop it. */',
    '    function px(n) {',
    '      var cs = String(sec.className).split(/\\s+/), out = [], k;',
    '      for (k = 0; k < cs.length; k++) if (cs[k] && cs[k].indexOf("ck-c-px") !== 0) out.push(cs[k]);',
    '      out.push("ck-c-px" + n);',
    '      sec.className = out.join(" ");',
    '    }',
    '',
    '    /* ONE listener on the section, not one per tile. The sheet is built to hold three',
    '       hundred candidates; three hundred registrations would be three hundred closures to',
    '       tear down on every <main> swap, and the symptom of getting that wrong — a click',
    '       firing four times an hour into a session — is miserable to trace back. Delegation',
    '       also survives the reordering above, which moves the tiles out from under it. */',
    '    CK.once(sec, "pick", function () {',
    '      sec.addEventListener("click", function (ev) {',
    '        var t = ev.target;',
    '        if (!t || !t.closest) return;',
    '',
    '        if (t.closest(".ck-c-clear")) {',
    '          kept = [];',
    '          reindex(); save(); applyMarks(); paintPicks(); paintCount();',
    '          if (sortMode === "kept") order(sortMode);',
    '          return;',
    '        }',
    '',
    '        var tile = t.closest(".ck-c-tile");',
    '        if (!tile) return;',
    '        var cid = tile.getAttribute("data-id"), at = kept.indexOf(cid);',
    '        if (at >= 0) kept.splice(at, 1); else kept.push(cid);',
    '        reindex();',
    '        mark(tile, at < 0);',
    '        save(); paintPicks(); paintCount();',
    '        /* In "kept" order the shortlist collects at the top as you build it, which means the',
    '           tile you just clicked moves. That is the mode doing its job, not a glitch: the',
    '           other two modes hold still, and they are what you use while still comparing. */',
    '        if (sortMode === "kept") order(sortMode);',
    '      });',
    '    });',
    '',
    '    CK.settings(sec, ' + JSON.stringify(runtime) + ', function (cfg) {',
    '      var n = Math.round(Number(cfg.size));',
    '      if (!isFinite(n)) n = ' + runtime.size + ';',
    '      if (n < ' + SIZE_MIN + ') n = ' + SIZE_MIN + ';',
    '      if (n > ' + SIZE_MAX + ') n = ' + SIZE_MAX + ';',
    '      px(n);',
    '      /* The caption names the working size, so it has to be told when the size changes —',
    '         a caption that says 13px over a sheet drawn at 24px is worse than no caption. */',
    '      if (sizeEl) sizeEl.textContent = n + "px";',
    '      sec.classList.toggle("ck-c-nolarge", !cfg.showLarge);',
    '      sortMode = cfg.sort === "id" || cfg.sort === "kept" ? cfg.sort : "given";',
    '      order(sortMode);',
    '      applyMarks(); paintPicks(); paintCount();',
    '    });',
    '  });',
  ].join('\n');
}

/**
 * Build one choice card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  `{ candidates, size, context, groups }`; `render` and `context` are trusted HTML,
 *              every other value in it is untrusted and escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'icons', title: 'pick a glyph', ord: 4, data: {
 *   size: 13,
 *   context: '<span>\u{1F916}</span><span>\u{1F5D1}</span>',
 *   candidates: [{ id: 'L03', label: 'into the tray', render: '<svg viewBox="0 0 24 24"></svg>' }]
 * } }).html.indexOf('data-id="L03"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d = data && typeof data === 'object' ? data : {};

  const { cands, dupes } = normCandidates(d.candidates);
  /* Trusted by contract, exactly like `render`: the caller is handing this card markup on
     purpose so a candidate can be judged beside its real neighbours. A string is required
     though — an object here would stringify to "[object Object]" inside every tile. */
  const ctx      = typeof d.context === 'string' ? d.context : '';
  const size     = clampSize(d.size, defaults.size);
  const sections = groupSections(d.groups, cands);

  const body = cands.length === 0
    ? '  <div class="ck-c-void">nothing to choose between &mdash; this card was given no candidates</div>\n'
    : sections.map((s) =>
        (s.label === '' ? '' : '  <div class="ck-h3">' + esc(s.label) + '</div>\n') +
        '  <div class="ck-grid ck-c-sheet">' + s.list.map((c) => tile(c, ctx)).join('') + '</div>\n'
      ).join('');

  /* Two asides, both admissions. One candidate is a sheet with nothing to compare against, and
     saying so is more useful than rendering a lonely tile as though it were a decision; dropped
     duplicates are data the caller handed over that is not on the sheet, and a card that
     silently omits what it was given is lying by omission. */
  const alone = cands.length === 1
    ? ' <span class="ck-aside">one candidate &mdash; there is nothing here to compare it against.</span>'
    : '';
  const dropped = dupes === 0
    ? ''
    : ' <span class="ck-aside">' + dupes + (dupes === 1 ? ' duplicate id' : ' duplicate ids') + ' dropped.</span>';

  const caption =
    'every candidate twice: large enough to read the idea, and again at ' +
    '<i class="ck-c-size">' + size + 'px</i> among the neighbours it will actually sit beside. ' +
    '<b>the small one is the only test that matters</b> &mdash; the large render is there so you ' +
    'can see what was drawn, not so it can be judged. click a tile to keep it; the picked line ' +
    'is what you read back.' + alone + dropped + ' <i class="ck-c-count"></i>';

  const html =
    '<section data-card="' + esc(id) + '" class="ck-choice ck-c-px' + size + '">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-size">working size</label>\n' +
    '    <input type="number" id="' + esc(id) + '-size" name="size" min="' + SIZE_MIN + '" max="' + SIZE_MAX + '" step="1">\n' +
    '    <label for="' + esc(id) + '-showLarge">large render</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-showLarge" name="showLarge">\n' +
    '    <label for="' + esc(id) + '-sort">order</label>\n' +
    '    <select id="' + esc(id) + '-sort" name="sort">\n' +
    '      <option value="given">as given</option>\n' +
    '      <option value="id">by id</option>\n' +
    '      <option value="kept">kept first</option>\n' +
    '    </select>\n' +
    '    <div class="ck-set-foot">the working size is the size the decision is made at, not a display preference. turning off the large render leaves only the test that counts.</div>\n' +
    '  </div>\n' +
    '  <div class="ck-cap">' + caption + '</div>\n' +
    body +
    '  <div class="ck-c-picks">picked: <span class="ck-c-list ck-c-none">nothing yet</span>' +
    '<button type="button" class="ck-c-clear">clear</button></div>\n' +
    '</section>\n';

  /* `size` from the data becomes this card's fallback, while the exported `defaults` stays the
     type's. The field NAMES are what has to agree with `defaults`, and they do; the values are
     per card by design, which is the whole reason `data.size` exists. */
  const js = '(function () {\n' + main(id, { ...defaults, size }) + '\n})();\n';

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/**
 * One CSS rule per working size, `ck-c-px8` through `ck-c-px48`.
 *
 * Generated rather than set inline because the desk serves under a CSP, and generated as a
 * range rather than as the single size this card was built with because `size` is a *setting*:
 * the viewer can change it after the card is built, and there is no rebuild between the change
 * and the redraw. Forty-one two-property rules is a rounding error in a stylesheet and buys
 * exact CSP compliance.
 *
 * `font-size` is the only property involved, deliberately. It sizes a text render directly, and
 * a drawn one follows because the `svg` below is sized in `em` — so one number governs a glyph,
 * a swatch and a line of prose without the card having to know which it was handed.
 *
 * @example sizeRules().indexOf('.ck-choice.ck-c-px13 .ck-c-row') >= 0;   // true
 */
function sizeRules() {
  const out = [];
  for (let n = SIZE_MIN; n <= SIZE_MAX; n++) {
    out.push('  .ck-choice.ck-c-px' + n + ' .ck-c-row { font-size: ' + n + 'px; }');
  }
  return out.join('\n');
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch
   is the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The
   desk is one document open in two viewers who want different answers, and the OS only knows
   how to give both of them the same one. */
const CSS = `
  .ck-choice { position: relative; }

  /* The grid, the tile and the kept state all come from kit.css: a contact sheet of glyphs and
     a contact sheet of colour swatches should not be able to disagree about what a tile is. */
  .ck-choice .ck-c-sheet { margin: 2px 0 4px; }

  /* Reading size, then working size. The large render is fixed — it is not a thing you tune,
     it is just "big enough to see" — while the small one is the setting, because the small one
     is the measurement. */
  .ck-choice .ck-c-big { font-size: 26px; line-height: 1; display: block; }
  .ck-choice.ck-c-nolarge .ck-c-big { display: none; }

  .ck-choice .ck-c-row { display: flex; align-items: center; gap: 3px; line-height: 1; font-size: 13px; }
  .ck-choice .ck-c-sm { display: block; }
  .ck-choice .ck-c-ctx { display: inline-flex; align-items: center; gap: 3px; }

  /* Sized in em so the rules above are the only place a number appears. vector-effect is
     deliberately not set: strokes should thin with the drawing, or the small render becomes a
     bolder picture rather than a smaller one — which would make the whole card lie. */
  .ck-choice .ck-c-big svg, .ck-choice .ck-c-big img,
  .ck-choice .ck-c-sm svg,  .ck-choice .ck-c-sm img { width: 1em; height: 1em; display: block; }

  /* The neighbours are the setting, not the subject, so they sit back until you are actually
     judging — and then they come fully forward, because a muted neighbour is a neighbour the
     comparison never really happened against. The mute lives on the context and never on the
     row: put it on the row and it drains the candidate of exactly the colour it was drawn to
     carry, and the sheet is then lying about how the real thing looks. */
  .ck-choice .ck-c-ctx { filter: grayscale(.55); opacity: .75; }
  .ck-choice .ck-c-tile:hover .ck-c-ctx,
  .ck-choice .ck-c-tile.on .ck-c-ctx { filter: none; opacity: 1; }

  /* An empty render, drawn as empty. A blank tile is indistinguishable from one that failed,
     and telling those apart is most of what a contact sheet is for. */
  .ck-choice .ck-c-blank {
    display: block; width: 1em; height: 1em;
    border: 1px dashed var(--rule); border-radius: 2px;
  }

  .ck-choice .ck-c-id { font: 400 9px/1 var(--mono); color: var(--ink-faint); letter-spacing: .04em; }
  .ck-choice .ck-c-tile.on .ck-c-id { color: var(--accent); }

  /* The line you read back. Set off by a rule because it is the card's output, not more card. */
  .ck-choice .ck-c-picks {
    margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--hairline);
    font: 400 12px/1.5 var(--mono); color: var(--accent);
  }
  .ck-choice .ck-c-picks .ck-c-none { color: var(--ink-faint); }
  .ck-choice .ck-c-clear {
    margin-left: 10px; font: inherit; font-family: var(--ui); font-size: 10px;
    padding: 2px 8px; cursor: pointer;
    background: var(--pill); color: var(--ink-dim);
    border: 1px solid var(--pill-edge); border-radius: 4px;
  }
  .ck-choice .ck-c-clear:hover { color: var(--accent); border-color: var(--accent); }

  .ck-choice .ck-c-void { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); margin: 10px 0; }
  .ck-choice .ck-c-count { color: var(--ink-faint); }

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box;
     it wants to be its own size, at the start of its column. */
  .ck-choice .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

${sizeRules()}
`;
