/**
 * The `audit` card type — the desk's own append-only log, made readable.
 *
 * `panel.mjs` writes one JSON object per line to `audit.jsonl` on every state-changing action and
 * serves the tail of it at `/audit?n=…`. Until this card existed, nothing on the desk read it back.
 * An audit trail nobody can read is a filing cabinet, not oversight: it satisfies the letter of
 * "the side effects are recorded" while leaving the actual review to whoever thinks to open a file
 * they have no reason to remember exists.
 *
 * Two design decisions carry most of the weight, and both are about what the log is FOR.
 *
 *   1. **Refusals are first-class.** The server's own comment says it: a record showing only
 *      successes cannot distinguish a well-guarded endpoint from one that was never tested. So the
 *      rows where something was *not* done are the rows a reviewer came for, and they must not be
 *      rendered as one more grey line among two hundred grey lines. They get a drawn mark, a rule
 *      down their left edge, a colour, a raised weight on the action, and an off-screen word for a
 *      reader who gets none of the visual treatment at all. Colour alone would fail a
 *      colour-blind reviewer silently, which is precisely the class of failure this card is about.
 *   2. **Everything the network hands back becomes DOM nodes, never markup.** The rows are built
 *      with `createElement` and `textContent`, so there is no escape to get right and no way for a
 *      logged value to become an element. The only `innerHTML` in the card is fed a module
 *      constant with no data in it.
 *
 * The record shape, read out of `panel.mjs`:
 *
 *   `audit(action, detail)` writes `{ ...detail, at, action }` — the detail's keys are spread at
 *   the TOP LEVEL of the row, not nested under a `detail` key. So "the detail" is every own key
 *   except `at` and `action`, which is exactly how this card flattens it. The route replaces a
 *   line it cannot parse with `{ at: null, action: 'unparseable', raw }` rather than dropping it,
 *   so damaged lines arrive as data and are counted here rather than silently vanishing.
 *
 * @see meta for the accepted shape
 * @see build for the emitted card
 */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Checked against the settings panel's field names in both directions by the panel and by this
 * type's own verification, so a `name` in the markup that is not a key here is a control that
 * would silently do nothing.
 *
 * Declared BEFORE `meta` and spread into it, per the contract. The order is load-bearing rather
 * than cosmetic: `meta.defaults` is what a validator reads and the separate export is what a
 * reader imports, but a `const` cannot be referenced from above its own declaration, so writing
 * `meta` first throws in the temporal dead zone instead of quietly working.
 *
 * `live` is off by default deliberately. A card that starts polling the moment it is placed is a
 * card that decides for the viewer that this log is worth 240 reads an hour; following is a thing
 * you turn on while you are watching something.
 *
 * @example defaults.limit;   // 200
 */
export const defaults = { limit: 200, family: 'all', live: false };

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * `shape` is a string, per the contract — it is read by a human choosing a type, so it reads as
 * source rather than as a schema.
 *
 * @example meta.name;              // 'audit'
 * @example meta.defaults.family;   // 'all'
 *
 * @see defaults, declared above it and spread into it
 */
export const meta = {
  name: 'audit',
  summary: 'The desk\u2019s append-only audit log, grouped by action family, with refusals marked.',
  shape: '{ url, limit, filter } \u2014 url defaults to /audit?n=200 and must be same-origin; ' +
         'limit seeds the records setting (50 | 200 | 1000); filter seeds the filter box',
  /* A copy, not the binding: a panel that mutates what it was handed cannot reach back into this
     module's exported object and change what the next card built from this type inherits. */
  defaults: { ...defaults }
};

/**
 * The record counts the settings select offers.
 *
 * The server clamps `n` to 500, so 1000 asks for more than it will ever give. That is stated in
 * the settings panel rather than quietly corrected: a control that silently means something other
 * than what it says is how a reader ends up believing they are looking at a thousand records.
 */
const LIMITS = [50, 200, 1000];

/** The default endpoint, matching the route `panel.mjs` serves. */
const DEFAULT_URL = '/audit?n=200';

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * Duplicated rather than imported because `kit.js` is a classic script and not a module. Only the
 * card's own shell is built here — every fetched row becomes DOM nodes in the browser — so this
 * runs over the title, the id and the seed filter and nothing else.
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
 * `JSON.stringify` alone is not enough for text that lands inside a `<script>` element: `</` would
 * close it, and U+2028/U+2029 are line terminators to a JS parser but not to JSON. The backtick
 * and the question mark are escaped for a second reason — this type's verification asserts the
 * emitted script contains no template literal and no optional chaining, and the default URL
 * contains a literal `?`. Escaping it means a URL of `/audit?.x` cannot spell `?.` and fail a rule
 * it did not break.
 *
 * @param s the text to embed
 *
 * @example jsStr('/audit?n=200').indexOf('?') < 0;   // true
 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/`/g, '\\u0060').replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Refuse to emit a card whose browser source is not a classic script.
 *
 * This is a build-time guard rather than a test, because the blast radius is not this card. Every
 * card's `js` is concatenated into ONE inline block, so a single template literal or arrow here
 * takes down the whole desk — every other card stops running too, and the visible symptom is a
 * page of dead cards with nothing to say which one did it. A type that cannot be emitted safely
 * must fail loudly at build time, where exactly one card is broken and it is named.
 *
 * The banned forms are checked as text, and the backtick is written as an escape rather than as
 * itself so this function cannot be the thing that introduces one. Control characters are checked
 * numerically for the same reason: a character class would have to contain the characters it is
 * looking for, and those are invisible on the page, invisible on readback, and legal to the parser.
 *
 * Duplicated in every type rather than imported because a type is a standalone module with no
 * dependencies; the cost of the copy is paid once and the alternative is a shared import that
 * makes a type unloadable on its own.
 *
 * @param parts the `{ html, css, js }` about to be returned
 * @returns the same object, when it is safe
 * @throws {Error} naming the offending construct and quoting the source around it
 *
 * @example guard({ html: '', css: '', js: 'var a = 1;' });   // returns its argument
 */
function guard(parts) {
  const banned = [
    ['`', 'a backtick, so a template literal'],   // written as an escape; see the docblock
    ['=>', 'an arrow function'],
    ['?.', 'optional chaining'],
  ];
  for (const [needle, what] of banned) {
    const at = parts.js.indexOf(needle);
    if (at >= 0) {
      throw new Error('audit: emitted js contains ' + what + ' at ' + at + ' — near: ' +
                      JSON.stringify(parts.js.slice(Math.max(0, at - 50), at + 50)));
    }
  }
  /* Keywords are looked for in CODE, with comments and string bodies blanked first. Scanning the
     raw text instead finds the English word "class" in a comment about a CSS class and refuses a
     perfectly good card — a guard that cries wolf is a guard that gets deleted. Offsets are
     preserved by the blanking, so the error still points at the real place. */
  const code = parts.js
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'");
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('\\b' + kw + '\\b').exec(code);
    if (m) {
      throw new Error('audit: emitted js contains "' + kw + '" at ' + m.index + ' — near: ' +
                      JSON.stringify(parts.js.slice(Math.max(0, m.index - 50), m.index + 50)));
    }
  }
  for (const key of ['html', 'css', 'js']) {
    const s = parts[key];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127 || c === 0x2028 || c === 0x2029) {
        throw new Error('audit: emitted ' + key + ' holds code point ' + c + ' at offset ' + i);
      }
    }
  }
  return parts;
}

/**
 * The nearest offered record count to what the card was configured with.
 *
 * A seed of 300 has no matching `<option>`, and a `<select>` set to a value it does not offer goes
 * blank — the viewer then sees an empty control that is nonetheless filtering. Snapping to the
 * nearest offered value keeps the control and the behaviour agreeing.
 *
 * @param n the configured count; anything unreadable falls back to the default
 *
 * @example snapLimit(300);   // 200
 * @example snapLimit('x');   // 200
 */
function snapLimit(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return defaults.limit;
  let best = LIMITS[0];
  for (const o of LIMITS) if (Math.abs(o - v) < Math.abs(best - v)) best = o;
  return best;
}

/**
 * The prohibition mark a refused row carries, drawn rather than typed.
 *
 * A 🚫 at 12px is a font lottery — it renders as a colour emoji on one platform, a box on another,
 * and the point of the mark is that it is legible everywhere. Drawn as a path it is the same shape
 * on every machine and it inherits `currentColor`, so the colour and the shape stay in agreement.
 */
const NO_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/>' +
  '<path d="M6.2 17.8L17.8 6.2"/></svg>';

/**
 * The card's browser half: fetch, group, mark, filter.
 *
 * Emitted as one string wrapped in an IIFE by {@link build} — nothing here reaches the global
 * scope, because a desk can hold two audit cards and a top-level `var` would have them sharing it.
 *
 * Written as an array of lines rather than a template literal for a reason that is not style: the
 * emitted text must contain no backtick at all, and a template literal in this file is one typo
 * away from putting one there.
 *
 * @param id    the card's `data-card` value, embedded as a literal
 * @param base  the endpoint to read, embedded as a literal
 * @param seed  the settled `{ limit, family, live }` this card starts from
 * @param q0    the seed filter text
 *
 * @example main('log', '/audit?n=200', { limit: 200, family: 'all', live: false }, '')
 *   .indexOf('CK.build') >= 0;   // true
 */
function main(id, base, seed, q0) {
  return [
    '  var ID   = ' + jsStr(id) + ';',
    '  var BASE = ' + jsStr(base) + ';',
    '  var SEED = ' + JSON.stringify(seed) + ';',
    '  var Q0   = ' + jsStr(q0) + ';',
    '  var NOG  = ' + jsStr(NO_GLYPH) + ';',
    '',
    '  function pad2(n) { return n < 10 ? "0" + n : String(n); }',
    '',
    '  /* Local time, always. The log stores UTC because a log has to be comparable across',
    '     machines; a person reading it wants to know what time it was where they were sitting.',
    '     The date is only shown when the record is not from today, so the common case stays a',
    '     narrow column and the uncommon case is never mistaken for it. */',
    '  function stamp(at) {',
    '    if (at === null || at === undefined || at === "") return "--:--:--";',
    '    var d = new Date(at);',
    '    var ms = d.getTime();',
    '    if (!isFinite(ms)) return "--:--:--";',
    '    var now = new Date();',
    '    var t = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());',
    '    var today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()',
    '             && d.getDate() === now.getDate();',
    '    return today ? t : pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + t;',
    '  }',
    '',
    '  function fullStamp(at) {',
    '    if (at === null || at === undefined || at === "") return "no timestamp recorded";',
    '    var d = new Date(at);',
    '    return isFinite(d.getTime()) ? d.toLocaleString() : "unreadable timestamp";',
    '  }',
    '',
    '  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }',
    '',
    '  /* A detail value rendered compactly, one level of structure at a time.',
    '     String(v) on an object gives "[object Object]", which tells a reviewer that something was',
    '     logged and nothing about what — the exact opposite of the job. Depth is bounded rather',
    '     than recursive-until-done because a row is one line in a card, not a JSON viewer. */',
    '  function val(v, depth) {',
    '    if (v === null) return "null";',
    '    if (v === undefined) return "undefined";',
    '    var t = typeof v;',
    '    if (t === "string") return v;',
    '    if (t === "number" || t === "boolean") return String(v);',
    '    if (t === "function") return "function";',
    '    if (isArr(v)) {',
    '      if (v.length === 0) return "[]";',
    '      if (depth <= 0) return "[" + v.length + " items]";',
    '      var out = [], i;',
    '      for (i = 0; i < v.length && i < 6; i++) out.push(val(v[i], depth - 1));',
    '      if (v.length > 6) out.push("+" + (v.length - 6) + " more");',
    '      return "[" + out.join(", ") + "]";',
    '    }',
    '    var keys;',
    '    try { keys = Object.keys(v); } catch (e) { return "unreadable"; }',
    '    if (keys.length === 0) return "{}";',
    '    if (depth <= 0) return "{" + keys.length + " keys}";',
    '    var parts = [], k;',
    '    for (k = 0; k < keys.length && k < 6; k++) {',
    '      parts.push(keys[k] + ": " + val(v[keys[k]], depth - 1));',
    '    }',
    '    if (keys.length > 6) parts.push("+" + (keys.length - 6) + " more");',
    '    return "{" + parts.join(", ") + "}";',
    '  }',
    '',
    '  /* Long values are folded, not dropped: the whole thing stays on the row title. A log that',
    '     truncates without saying so is a log that can hide the interesting half of a URL. */',
    '  function clip(s) { return s.length > 160 ? s.slice(0, 159) + "\\u2026" : s; }',
    '',
    '  /* The detail, flattened. at and action are the row\'s own columns; everything else on',
    '     the record came from the caller\'s detail object, because the server spreads it at the',
    '     top level rather than nesting it. */',
    '  function pairs(rec) {',
    '    var keys = Object.keys(rec), out = [], i, k;',
    '    for (i = 0; i < keys.length; i++) {',
    '      k = keys[i];',
    '      if (k === "at" || k === "action") continue;',
    '      out.push({ k: k, v: val(rec[k], 2) });',
    '    }',
    '    return out;',
    '  }',
    '',
    '  /* Refusal detection, on stems rather than whole words.',
    '     The two costs are not symmetric. A false positive marks a row that did not need marking',
    '     and a reader loses a second. A false negative lets "open.refusal" or "net.denial" render',
    '     as one more grey line, which is the single failure this card exists to prevent. So the',
    '     test is deliberately generous: refus*, deni*, deny. */',
    '  function refused(action) {',
    '    var a = String(action === null || action === undefined ? "" : action).toLowerCase();',
    '    return a.indexOf("refus") >= 0 || a.indexOf("deni") >= 0 || a.indexOf("deny") >= 0;',
    '  }',
    '',
    '  /* The family is the part before the first dot. An action with no dot is its own family,',
    '     which is right: "land" is a verb the desk has, not a malformed "land.something". */',
    '  function famOf(action) {',
    '    var a = String(action === null || action === undefined ? "" : action);',
    '    var i = a.indexOf(".");',
    '    return i < 0 ? (a === "" ? "(unnamed)" : a) : a.slice(0, i);',
    '  }',
    '',
    '  CK.build(ID, function (sec) {',
    '',
    '    var logEl   = sec.querySelector(".ck-au-log");',
    '    var noneEl  = sec.querySelector(".ck-au-none");',
    '    var findEl  = sec.querySelector(".ck-au-find");',
    '    var famSel  = sec.querySelector(".ck-au-famsel");',
    '    var sCount  = sec.querySelector(".ck-au-s-count");',
    '    var sFam    = sec.querySelector(".ck-au-s-fam");',
    '    var sRef    = sec.querySelector(".ck-au-s-ref");',
    '    var sBad    = sec.querySelector(".ck-au-s-bad");',
    '    var sNote   = sec.querySelector(".ck-au-s-note");',
    '    var readEl  = sec.querySelector(".ck-au-read");',
    '    if (!logEl) return;',
    '',
    '    /* recs is the rendered batch and groups the DOM built from it. Both are rebuilt only',
    '       on a successful read — a failed read must not blank rows the viewer is still using. */',
    '    var state = {',
    '      recs: [], groups: [], bad: 0, refs: 0, fams: [],',
    '      q: Q0.toLowerCase(), family: SEED.family, limit: SEED.limit, live: !!SEED.live,',
    '      readAt: 0, ok: false, err: "", started: false, busy: false',
    '    };',
    '',
    '    /* Same-origin only, and said out loud when it is not.',
    '       The page is served under connect-src \'self\'. A cross-origin URL here would be blocked',
    '       by the browser with nothing in the card to show for it, so the card checks first and',
    '       explains, rather than presenting an empty log that looks like an empty history. */',
    '    function endpoint() {',
    '      var u;',
    '      try { u = new URL(BASE, location.href); } catch (e) { return null; }',
    '      if (u.origin !== location.origin) return null;',
    '      try { u.searchParams.set("n", String(state.limit)); } catch (e) { return null; }',
    '      return u.pathname + u.search;',
    '    }',
    '',
    '    function setText(el, s) { if (el) el.textContent = s; }',
    '',
    '    function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }',
    '',
    '    /* ── building the DOM for one batch ─────────────────────────────────────────────── */',
    '',
    '    function rowEl(r) {',
    '      var row = document.createElement("div");',
    '      row.className = r.no ? "ck-au-row ck-au-no" : "ck-au-row";',
    '',
    '      var t = document.createElement("span");',
    '      t.className = "ck-au-t";',
    '      t.textContent = stamp(r.rec.at);',
    '      t.setAttribute("title", fullStamp(r.rec.at));',
    '      row.appendChild(t);',
    '',
    '      var m = document.createElement("span");',
    '      m.className = "ck-au-m";',
    '      if (r.no) {',
    '        /* The only innerHTML in the card, and it is fed a module constant with no data in',
    '           it. Everything that came off the wire below is textContent. */',
    '        m.innerHTML = NOG;',
    '        var sr = document.createElement("span");',
    '        sr.className = "ck-au-sr";',
    '        sr.textContent = "refused";',
    '        m.appendChild(sr);',
    '      }',
    '      row.appendChild(m);',
    '',
    '      var a = document.createElement("span");',
    '      a.className = "ck-au-a";',
    '      a.textContent = r.action;',
    '      row.appendChild(a);',
    '',
    '      var d = document.createElement("span");',
    '      d.className = "ck-au-d";',
    '      var ps = r.pairs, i;',
    '      if (ps.length === 0) {',
    '        var em = document.createElement("i");',
    '        em.className = "ck-au-bare";',
    '        em.textContent = "no detail";',
    '        d.appendChild(em);',
    '      } else {',
    '        for (i = 0; i < ps.length; i++) {',
    '          var kv = document.createElement("span");',
    '          kv.className = "ck-au-kv";',
    '          var b = document.createElement("b");',
    '          b.textContent = ps[i].k + "=";',
    '          kv.appendChild(b);',
    '          var v = document.createElement("span");',
    '          v.textContent = clip(ps[i].v);',
    '          if (ps[i].v.length > 160) v.setAttribute("title", ps[i].v);',
    '          kv.appendChild(v);',
    '          d.appendChild(kv);',
    '        }',
    '      }',
    '      row.appendChild(d);',
    '      return row;',
    '    }',
    '',
    '    /* Grouped by family, families ordered by their most recent record, rows newest first',
    '       inside a family. Grouping trades the interleaved timeline for per-family legibility;',
    '       every row keeps an absolute local time, so the global order is still recoverable by',
    '       eye, and narrowing the family select to one family restores a pure stream. */',
    '    function paint() {',
    '      var byName = Object.create(null), order = [], i, r, g;',
    '      for (i = 0; i < state.recs.length; i++) {',
    '        r = state.recs[i];',
    '        g = byName[r.family];',
    '        if (!g) { g = { name: r.family, items: [], el: null, cEl: null, rEl: null }; byName[r.family] = g; order.push(g); }',
    '        g.items.push(r);',
    '      }',
    '',
    '      var frag = document.createDocumentFragment();',
    '      for (i = 0; i < order.length; i++) {',
    '        g = order[i];',
    '        var box = document.createElement("div");',
    '        box.className = "ck-au-fam";',
    '',
    '        var head = document.createElement("div");',
    '        head.className = "ck-au-famh";',
    '        var nm = document.createElement("span");',
    '        nm.className = "ck-au-famn";',
    '        nm.textContent = g.name;',
    '        head.appendChild(nm);',
    '        var ct = document.createElement("span");',
    '        ct.className = "ck-au-famc";',
    '        head.appendChild(ct);',
    '',
    '        var nrefs = 0, j;',
    '        for (j = 0; j < g.items.length; j++) if (g.items[j].no) nrefs++;',
    '        var rf = document.createElement("span");',
    '        rf.className = "ck-au-famr";',
    '        if (nrefs > 0) rf.textContent = plural(nrefs, "refusal", "refusals");',
    '        head.appendChild(rf);',
    '        box.appendChild(head);',
    '',
    '        for (j = 0; j < g.items.length; j++) {',
    '          g.items[j].el = rowEl(g.items[j]);',
    '          box.appendChild(g.items[j].el);',
    '        }',
    '',
    '        g.el = box; g.cEl = ct; g.rEl = rf;',
    '        frag.appendChild(box);',
    '      }',
    '',
    '      /* One insertion for the whole batch. At a thousand rows the difference between this',
    '         and appending row by row is the difference between a card that appears and a card',
    '         that visibly assembles itself. */',
    '      logEl.textContent = "";',
    '      logEl.appendChild(frag);',
    '      state.groups = order;',
    '      refreshFamilies();',
    '      applyFilter();',
    '    }',
    '',
    '    /* ── the family select ──────────────────────────────────────────────────────────── */',
    '',
    '    function refreshFamilies() {',
    '      if (!famSel) return;',
    '      var names = [], i;',
    '      for (i = 0; i < state.groups.length; i++) names.push(state.groups[i].name);',
    '      names.sort();',
    '      state.fams = names;',
    '',
    '      famSel.textContent = "";',
    '      var all = document.createElement("option");',
    '      all.setAttribute("value", "all");',
    '      all.textContent = "all";',
    '      famSel.appendChild(all);',
    '      for (i = 0; i < names.length; i++) {',
    '        var o = document.createElement("option");',
    '        o.setAttribute("value", names[i]);',
    '        o.textContent = names[i];',
    '        famSel.appendChild(o);',
    '      }',
    '      /* A stored family that this batch does not contain still gets an option, labelled as',
    '         absent. Dropping it would blank the select while it was still filtering, and the',
    '         viewer would be looking at an empty log with no control saying why. */',
    '      if (state.family !== "all" && names.indexOf(state.family) < 0) {',
    '        var miss = document.createElement("option");',
    '        miss.setAttribute("value", state.family);',
    '        miss.textContent = state.family + " (none in this batch)";',
    '        famSel.appendChild(miss);',
    '      }',
    '      famSel.value = state.family;',
    '    }',
    '',
    '    /* ── filtering ──────────────────────────────────────────────────────────────────── */',
    '',
    '    /* Rows are shown and hidden, never rebuilt. The filter runs on every keystroke across',
    '       every row, and the haystack was built once when the batch arrived, so a thousand rows',
    '       cost a thousand property writes rather than a thousand element constructions. */',
    '    function applyFilter() {',
    '      var shown = 0, refShown = 0, gShown = 0, i, j, g, r, vis, n;',
    '      for (i = 0; i < state.groups.length; i++) {',
    '        g = state.groups[i];',
    '        n = 0;',
    '        for (j = 0; j < g.items.length; j++) {',
    '          r = g.items[j];',
    '          vis = (state.family === "all" || r.family === state.family)',
    '             && (state.q === "" || r.hay.indexOf(state.q) >= 0);',
    '          r.el.hidden = !vis;',
    '          if (vis) { n++; if (r.no) refShown++; }',
    '        }',
    '        g.el.hidden = n === 0;',
    '        if (n > 0) gShown++;',
    '        g.cEl.textContent = n === g.items.length ? String(n) : n + " of " + g.items.length;',
    '        shown += n;',
    '      }',
    '',
    '      if (noneEl) {',
    '        noneEl.hidden = shown !== 0;',
    '        noneEl.textContent =',
    '          state.recs.length === 0',
    '            ? (state.ok ? "the log is empty \\u2014 nothing has been recorded yet"',
    '                        : "nothing read yet")',
    '            : "no record matches that filter";',
    '      }',
    '',
    '      setText(sCount, state.recs.length === 0 ? "no records"',
    '        : shown === state.recs.length ? plural(shown, "record", "records")',
    '        : shown + " of " + state.recs.length + " records");',
    '      setText(sFam, gShown === 0 ? "" : plural(gShown, "family", "families"));',
    '      setText(sRef, refShown === 0 ? "" : plural(refShown, "refusal", "refusals"));',
    '      setText(sBad, state.bad === 0 ? ""',
    '        : plural(state.bad, "unreadable line skipped", "unreadable lines skipped"));',
    '    }',
    '',
    '    /* ── reading ────────────────────────────────────────────────────────────────────── */',
    '',
    '    function said(msg) { setText(readEl, msg); }',
    '',
    '    /* A failed read leaves the rows alone. The last good batch is still true about the past;',
    '       blanking it would turn "I could not reach the server" into "nothing ever happened",',
    '       which is the more alarming of the two and the wrong one. */',
    '    function failed(why) {',
    '      state.ok = false;',
    '      state.err = why;',
    '      setText(sNote, "read failed");',
    '      said(state.recs.length === 0',
    '        ? "could not read the log: " + why + ". no rows have been read yet."',
    '        : "could not read the log: " + why + ". the rows below are the last good read, from "',
    '          + fullStamp(state.readAt) + ".");',
    '    }',
    '',
    '    function accept(payload, from) {',
    '      /* The route answers { rows, showing }; a bare array is accepted too, so this card',
    '         also reads a plain dump of the same records without a wrapper being invented for it. */',
    '      var rows = isArr(payload) ? payload',
    '               : (payload && isArr(payload.rows) ? payload.rows : null);',
    '      if (rows === null) { failed("the response had no rows array"); return; }',
    '',
    '      var recs = [], bad = 0, refs = 0, i, rec, action, ps, hay, k;',
    '      /* Newest first. The server sends the tail of the file in file order, which is oldest',
    '         first; a log you are watching is read from the top. */',
    '      for (i = rows.length - 1; i >= 0; i--) {',
    '        rec = rows[i];',
    '        if (!rec || typeof rec !== "object" || isArr(rec)) { bad++; continue; }',
    '        action = rec.action === null || rec.action === undefined ? "" : String(rec.action);',
    '        /* unparseable is the route\'s own label for a line it could not JSON.parse. It is',
    '           counted and skipped rather than rendered: a damaged line has no action and no',
    '           detail to show, and rendering it as a row would put a fake event in the history. */',
    '        if (action === "unparseable") { bad++; continue; }',
    '        ps = pairs(rec);',
    '        hay = action;',
    '        for (k = 0; k < ps.length; k++) hay += " " + ps[k].k + "=" + ps[k].v;',
    '        var no = refused(action);',
    '        if (no) refs++;',
    '        recs.push({',
    '          rec: rec, action: action === "" ? "(unnamed)" : action, family: famOf(action),',
    '          pairs: ps, hay: hay.toLowerCase(), no: no, el: null',
    '        });',
    '      }',
    '',
    '      state.recs = recs;',
    '      state.bad = bad;',
    '      state.refs = refs;',
    '      state.ok = true;',
    '      state.err = "";',
    '      state.readAt = Date.now();',
    '      setText(sNote, "");',
    '      paint();',
    '      said("read " + from + " at " + fullStamp(state.readAt)',
    '        + (bad === 0 ? "." : ", skipping " + plural(bad, "unreadable line", "unreadable lines") + "."));',
    '    }',
    '',
    '    function load() {',
    '      if (state.busy) return;',
    '      var where = endpoint();',
    '      if (where === null) {',
    '        failed("the configured url is not on this desk\\u2019s origin, so it is never requested");',
    '        return;',
    '      }',
    '      state.busy = true;',
    '      fetch(where, { cache: "no-store" }).then(function (r) {',
    '        return r.text().then(function (body) {',
    '          if (!r.ok) throw new Error("HTTP " + r.status);',
    '          var got;',
    '          try { got = JSON.parse(body); }',
    '          catch (e) { throw new Error("the response was not JSON"); }',
    '          accept(got, where);',
    '        });',
    '      }).catch(function (e) {',
    '        /* A dead server rejects the fetch outright; a wrong route resolves with a status.',
    '           Both land here and both are reported in the caption in the same plain words. */',
    '        failed(e && e.message ? e.message : "the server did not answer");',
    '      }).then(function () { state.busy = false; }, function () { state.busy = false; });',
    '    }',
    '',
    '    /* ── wiring ─────────────────────────────────────────────────────────────────────── */',
    '',
    '    if (findEl) {',
    '      findEl.value = Q0;',
    '      CK.once(findEl, "find", function () {',
    '        findEl.addEventListener("input", function () {',
    '          state.q = findEl.value.trim().toLowerCase();',
    '          applyFilter();',
    '        });',
    '      });',
    '    }',
    '',
    '    CK.settings(sec, SEED, function (c) {',
    '      var lim = Number(c.limit);',
    '      var changed = isFinite(lim) && lim > 0 && lim !== state.limit;',
    '      var wasLive = state.live;',
    '      if (isFinite(lim) && lim > 0) state.limit = lim;',
    '      state.family = c.family === null || c.family === undefined ? "all" : String(c.family);',
    '      state.live = !!c.live;',
    '      if (famSel && famSel.value !== state.family) famSel.value = state.family;',
    '      applyFilter();',
    '      /* The first callback fires during wiring, before the timer has read anything; the',
    '         timer\'s immediate tick owns the first read so the two cannot both make one. */',
    '      if (!state.started) return;',
    '      if (changed || (state.live && !wasLive)) load();',
    '    });',
    '',
    '    /* One registered interval per card, by name, in a registry that outlives the DOM.',
    '       CK.once cannot do this: it keys off the element, and a <main> swap hands the builder',
    '       a new element with an empty dataset, so the guard passes and a second interval starts',
    '       while the first is still polling against a detached node. CK.timer replaces instead.',
    '       The tick reads state.live rather than being started and stopped, so toggling follow',
    '       can never leave two intervals or none. */',
    '    CK.timer(ID + ":audit", 15000, function () {',
    '      if (!state.started) { state.started = true; load(); return; }',
    '      if (state.live) load();',
    '    });',
    '  });'
  ].join('\n');
}

/**
 * Build one audit card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  `{ url, limit, filter }`; `url` defaults to `/audit?n=200` and must be same-origin
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'log', title: 'audit', ord: 40, data: { limit: 1000 } })
 *   .html.indexOf('data-card="log"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d     = data && typeof data === 'object' ? data : {};
  const url   = typeof d.url === 'string' && d.url.trim() !== '' ? d.url.trim() : DEFAULT_URL;
  const limit = snapLimit(d.limit == null ? defaults.limit : d.limit);
  const q0    = d.filter == null ? '' : String(d.filter);

  /* The seed is the exported defaults with this card's configured limit substituted. The KEYS
     are the exported defaults' keys and nothing else — the panel checks the settings panel's
     field names against `defaults` in both directions, and a seed that invented a key would pass
     a build and fail a validation. Only the value moves. */
  const seed = { limit, family: defaults.family, live: defaults.live };

  const options = LIMITS.map((n) =>
    '<option value="' + n + '"' + (n === limit ? ' selected' : '') + '>' + n + '</option>'
  ).join('');

  const html =
    '<section data-card="' + esc(id) + '" class="ck-audit">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-limit">records</label>\n' +
    '    <select id="' + esc(id) + '-limit" name="limit">' + options + '</select>\n' +
    '    <label for="' + esc(id) + '-family">family</label>\n' +
    '    <select id="' + esc(id) + '-family" name="family" class="ck-au-famsel">' +
         '<option value="all">all</option></select>\n' +
    '    <label for="' + esc(id) + '-live">follow</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-live" name="live">\n' +
    '    <div class="ck-set-foot">follow re-reads every 15 seconds. the server caps one read at 500 records, ' +
         'so 1000 asks for more than it will give.</div>\n' +
    '  </div>\n' +
    '  <div class="ck-au-tools">\n' +
    '    <input type="search" class="ck-au-find" placeholder="filter action or detail" ' +
         'aria-label="filter the log" autocomplete="off" spellcheck="false" value="' + esc(q0) + '">\n' +
    '  </div>\n' +
    '  <div class="ck-au-stat">\n' +
    '    <span class="ck-au-s-count"></span>\n' +
    '    <span class="ck-au-s-fam"></span>\n' +
    '    <span class="ck-au-s-ref"></span>\n' +
    '    <span class="ck-au-s-bad"></span>\n' +
    '    <span class="ck-au-s-note"></span>\n' +
    '  </div>\n' +
    '  <div class="ck-scroll ck-au-scroll">\n' +
    '    <div class="ck-au-log"></div>\n' +
    '    <div class="ck-au-none">nothing read yet</div>\n' +
    '  </div>\n' +
    '  <div class="ck-cap">the desk\u2019s own append-only log, grouped by action family, newest first ' +
         'inside a family. <b>refusals carry a mark, a rule and a colour</b> because a record showing only ' +
         'what was done cannot show what was stopped. <i class="ck-au-read"></i></div>\n' +
    '</section>\n';

  const js = '(function () {\n' + main(id, url, seed, q0) + '\n})();\n';

  /* Guarded on the way out, not tested afterwards: a bad emit must not reach a desk at all. */
  return Object.assign({ json: { ord: Number.isFinite(ord) ? ord : 0 } },
                       guard({ html, css: CSS, js }));
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch is
   the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The
   refusal treatment borrows `--ck-s1`, which is the series' warm end in both themes — so a refused
   row is warm against a cool log whichever way the desk is set, without this card defining a
   colour of its own. */
const CSS = `
  .ck-audit { position: relative; }

  /* ── the filter box ───────────────────────────────────────────────────────────────────── */

  .ck-audit .ck-au-tools { margin: 10px 0 7px; }
  .ck-audit .ck-au-find {
    font: inherit; font-family: var(--mono); font-size: 11px;
    width: 100%; box-sizing: border-box; padding: 5px 8px;
    background: var(--well); color: var(--ink);
    border: 1px solid var(--hairline); border-radius: 5px;
  }
  .ck-audit .ck-au-find:focus { outline: none; border-color: var(--accent); }
  .ck-audit .ck-au-find::placeholder { color: var(--ink-faint); }

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box; it
     wants to be its own size, at the start of its column. */
  .ck-audit .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

  /* ── the tally strip ──────────────────────────────────────────────────────────────────── */

  .ck-audit .ck-au-stat {
    display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 0 0 7px;
    font-family: var(--mono); font-size: 10px; color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  /* An empty span would still take its share of the gap and space the strip out as if something
     were there. Nothing to say, nothing shown. */
  .ck-audit .ck-au-stat span:empty { display: none; }
  .ck-audit .ck-au-s-ref  { color: var(--ck-s1); }
  .ck-audit .ck-au-s-bad  { color: var(--ck-s2); }
  .ck-audit .ck-au-s-note { color: var(--ck-s1); }

  /* ── the log ──────────────────────────────────────────────────────────────────────────── */

  /* The scroller owns both axes: a long log scrolls under its own family headers and a wide
     detail scrolls inside the card. Neither ever moves the desk column sideways. */
  .ck-audit .ck-au-scroll { max-height: 60vh; overflow-y: auto; }

  .ck-audit .ck-au-fam { margin: 0 0 9px; }
  .ck-audit .ck-au-fam[hidden] { display: none; }

  .ck-audit .ck-au-famh {
    position: sticky; top: 0; z-index: 1; background: var(--ground);
    display: flex; align-items: baseline; gap: 8px;
    padding: 4px 0 3px; border-bottom: 1px solid var(--rule);
  }
  .ck-audit .ck-au-famn {
    font: 700 10px/1.4 var(--ui); letter-spacing: .08em; text-transform: uppercase;
    color: var(--ink-dim);
  }
  .ck-audit .ck-au-famc { font-family: var(--mono); font-size: 10px; color: var(--ink-faint); }
  .ck-audit .ck-au-famr {
    margin-left: auto; font-family: var(--mono); font-size: 10px; color: var(--ck-s1);
  }

  .ck-audit .ck-au-row {
    display: grid; grid-template-columns: auto 14px auto minmax(0, 1fr);
    gap: 0 8px; align-items: baseline;
    padding: 3px 0 3px 7px;
    border-bottom: 1px solid var(--hairline);
    border-left: 2px solid transparent;
  }
  /* [hidden] and the display rule above it tie on specificity, and this sheet loads after the
     UA's, so a hidden row would stay visible without saying so. */
  .ck-audit .ck-au-row[hidden] { display: none; }
  .ck-audit .ck-au-row:hover { background: var(--pill); }

  .ck-audit .ck-au-t {
    font-family: var(--mono); font-size: 10px; color: var(--ink-faint);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .ck-audit .ck-au-m { position: relative; width: 14px; height: 14px; line-height: 0; align-self: center; }
  .ck-audit .ck-au-m svg { width: 13px; height: 13px; display: block; }
  .ck-audit .ck-au-a { font-family: var(--mono); font-size: 11px; color: var(--ink); white-space: nowrap; }
  .ck-audit .ck-au-d {
    min-width: 0; font-family: var(--mono); font-size: 10.5px; color: var(--ink-dim);
    overflow-wrap: anywhere;
  }
  .ck-audit .ck-au-kv { margin-right: 11px; }
  .ck-audit .ck-au-kv b { font-weight: 400; color: var(--ink-faint); }
  .ck-audit .ck-au-bare { font-style: normal; color: var(--ink-faint); }

  /* ── refusals ─────────────────────────────────────────────────────────────────────────── */

  /* Four signals, not one. The rule and the fill survive a colour-blind reader; the drawn mark
     survives a monochrome print; the off-screen word survives having no visual channel at all.
     A row that says something was stopped is the row a reviewer opened this card for, and it has
     to be findable by whatever channel that reviewer actually has. */
  .ck-audit .ck-au-no { border-left-color: var(--ck-s1); background: var(--well); }
  .ck-audit .ck-au-no .ck-au-m { color: var(--ck-s1); }
  .ck-audit .ck-au-no .ck-au-a { color: var(--ck-s1); font-weight: 700; }
  .ck-audit .ck-au-no .ck-au-t { color: var(--ink-dim); }

  /* Off screen, still in the accessibility tree. */
  .ck-audit .ck-au-sr {
    position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }

  .ck-audit .ck-au-none {
    padding: 14px 8px; text-align: center;
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }
  .ck-audit .ck-au-none[hidden] { display: none; }

  .ck-audit .ck-au-read { color: var(--ink-faint); font-style: normal; }
`;
