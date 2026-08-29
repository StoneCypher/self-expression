/**
 * The `note` card type — an editable scratch card that persists, and that says so honestly.
 *
 * Every other card on the desk renders something the desk already knows. This one is the only
 * place a viewer's own words live, which makes it the only card where a bug destroys something
 * that existed nowhere else. Two failures are therefore designed against explicitly, because both
 * are silent and both are unrecoverable:
 *
 *   1. **A save that did not happen and did not say so.** A private window throws on
 *      `localStorage.setItem`, and the usual shape — `try { save() } catch (e) {}` — produces a
 *      card that looks exactly like a working one while keeping nothing. The catch here is not
 *      empty: it turns into a visible "not saved — storage is unavailable", and the card probes
 *      storage once at wiring time so the warning is on screen *before* anyone types rather than
 *      after they have lost an afternoon. This is the whole failure the card must not have.
 *   2. **A seed overwriting a note.** `data.text` is a SEED, not content. The desk replays every
 *      builder after a `<main>` swap, so if the seed won on every build, every swap would silently
 *      restore the card's original text over whatever the viewer had written. The rule is
 *      therefore: stored beats seed, always, and the seed applies only when the key is absent
 *      entirely. An empty stored string is a stored string and it wins — otherwise clearing the
 *      note and reloading would resurrect the seed, which is the same data loss wearing a
 *      friendlier face. The rule is stated in the caption, and the seed stays reachable through an
 *      explicit "reset to seed" in the gear, so nothing is hidden and nothing is automatic.
 *
 * The note itself is stored under `desk.note.<id>`, beside — not inside — the settings blob
 * `CK.settings` keeps at `desk.card.<id>`. Two keys rather than one so a corrupt settings value
 * can be discarded without discarding what someone wrote.
 *
 * @see meta for the accepted shape
 * @see build for the emitted card
 */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Checked against the settings panel's field names in both directions, so a `name` in the markup
 * that is not a key here is a control that silently does nothing. The panel's "reset to seed"
 * button therefore deliberately carries no `name`: it is a verb, not a setting, and giving it one
 * would make the two lists disagree.
 *
 * Declared BEFORE `meta` and spread into it, per the contract. The order is load-bearing rather
 * than cosmetic: `meta.defaults` is what a validator reads and the separate export is what a
 * reader imports, but a `const` cannot be referenced from above its own declaration, so writing
 * `meta` first throws in the temporal dead zone instead of quietly working.
 *
 * @example defaults.rows;   // 6
 */
export const defaults = { mono: false, rows: 6, wrap: true };

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * `shape` is a string, per the contract — a human choosing a type reads it, so it reads as source.
 *
 * @example meta.name;           // 'note'
 * @example meta.defaults.rows;  // 6
 *
 * @see defaults, declared above it and spread into it
 */
export const meta = {
  name: 'note',
  summary: 'An editable scratch note that saves to this browser and tells you whether it worked.',
  shape: '{ text, placeholder, rows } \u2014 text is a SEED used only when nothing is stored for ' +
         'this card id; rows seeds the rows setting',
  /* A copy, not the binding: a panel that mutates what it was handed cannot reach back into this
     module's exported object and change what the next card built from this type inherits. */
  defaults: { ...defaults }
};

/**
 * The most text this card will keep, in characters.
 *
 * A cap exists because `localStorage` is a shared, small, synchronous store: one card that grows
 * without limit evicts every other card's settings and blocks the main thread doing it. 100,000
 * characters is roughly a 60-page document, which is far past what a scratch card is for, and the
 * card says the number out loud rather than truncating quietly.
 */
const MAX = 100000;

/** The cap as a human reads it, so the message and the constant cannot drift apart. */
const MAX_TEXT = '100,000';

/** How long after the last keystroke the note is written, in milliseconds. */
const DEBOUNCE = 400;

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * Duplicated rather than imported because `kit.js` is a classic script and not a module. This is
 * the function that stops a seed containing `</textarea>` from closing the element it is being
 * written into: `<` becomes `&lt;` before it ever reaches the markup, so the browser sees text
 * where a naive build would see a tag.
 *
 * @param s anything; null and undefined become the empty string rather than their names
 *
 * @example esc('</textarea><img>');   // '&lt;/textarea&gt;&lt;img&gt;'
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
 * emitted script contains no template literal and no optional chaining, and a card id holding
 * either would fail that check with a message about a rule it did not break.
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
      throw new Error('note: emitted js contains ' + what + ' at ' + at + ' — near: ' +
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
      throw new Error('note: emitted js contains "' + kw + '" at ' + m.index + ' — near: ' +
                      JSON.stringify(parts.js.slice(Math.max(0, m.index - 50), m.index + 50)));
    }
  }
  for (const key of ['html', 'css', 'js']) {
    const s = parts[key];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127 || c === 0x2028 || c === 0x2029) {
        throw new Error('note: emitted ' + key + ' holds code point ' + c + ' at offset ' + i);
      }
    }
  }
  return parts;
}

/**
 * A row count inside the range the control offers.
 *
 * @param n the configured count; anything unreadable falls back to the default
 *
 * @example clampRows(0);     // 2
 * @example clampRows('x');   // 6
 */
function clampRows(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return defaults.rows;
  return v < 2 ? 2 : v > 40 ? 40 : v;
}

/**
 * The card's browser half: storage, the honest indicator, the counts, the reset.
 *
 * Emitted as one string wrapped in an IIFE by {@link build} — nothing here reaches the global
 * scope, because a desk can hold two note cards and a top-level `var` would have them sharing it.
 *
 * Written as an array of lines rather than a template literal for a reason that is not style: the
 * emitted text must contain no backtick at all, and a template literal in this file is one typo
 * away from putting one there.
 *
 * @param id   the card's `data-card` value, embedded as a literal
 * @param seed the settled `{ mono, rows, wrap }` this card starts from
 *
 * @example main('scratch', { mono: false, rows: 6, wrap: true }).indexOf('CK.build') >= 0;   // true
 */
function main(id, seed) {
  return [
    '  var ID    = ' + jsStr(id) + ';',
    '  var KEY   = "desk.note." + ID;',
    '  var PROBE = "desk.note.probe";',
    '  var SEED  = ' + JSON.stringify(seed) + ';',
    '  var MAX   = ' + MAX + ';',
    '  var MAXT  = ' + jsStr(MAX_TEXT) + ';',
    '  var WAIT  = ' + DEBOUNCE + ';',
    '',
    '  /* Reaching localStorage can itself throw: some browsers make the property access raise',
    '     rather than returning a store that fails later. Every touch of it is guarded. */',
    '  function getStore() {',
    '    try { return window.localStorage || null; } catch (e) { return null; }',
    '  }',
    '',
    '  /* Presence is not permission. A private window hands back a real-looking store whose first',
    '     write throws, so the only honest test is a write. Done once, at wiring time, so the',
    '     warning is on screen before anyone types instead of after they have lost the afternoon. */',
    '  function canWrite() {',
    '    var s = getStore();',
    '    if (!s) return false;',
    '    try { s.setItem(PROBE, "1"); s.removeItem(PROBE); return true; }',
    '    catch (e) { return false; }',
    '  }',
    '',
    '  /* What is stored for this card, and in what condition.',
    '     Four answers rather than a string-or-null, because the card says something different for',
    '     each of them and a caller that cannot tell them apart would have to guess. */',
    '  function readStored() {',
    '    var s = getStore();',
    '    if (!s) return { kind: "nostore" };',
    '    var v;',
    '    try { v = s.getItem(KEY); } catch (e) { return { kind: "nostore" }; }',
    '    if (v === null || v === undefined) return { kind: "none" };',
    '    /* Anything read back out of storage is re-vetted: it is a text file the viewer can edit,',
    '       and a shim or a hand-edit can put a non-string there. */',
    '    if (typeof v !== "string") return { kind: "junk" };',
    '    if (v.length > MAX) return { kind: "big", text: v.slice(0, MAX), was: v.length };',
    '    return { kind: "ok", text: v };',
    '  }',
    '',
    '  function words(t) {',
    '    var trimmed = t.replace(/^\\s+/, "").replace(/\\s+$/, "");',
    '    return trimmed === "" ? 0 : trimmed.split(/\\s+/).length;',
    '  }',
    '',
    '  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }',
    '',
    '  CK.build(ID, function (sec) {',
    '',
    '    var ta      = sec.querySelector(".ck-n-ta");',
    '    var stateEl = sec.querySelector(".ck-n-state");',
    '    var countEl = sec.querySelector(".ck-n-count");',
    '    var noteEl  = sec.querySelector(".ck-n-note");',
    '    var resetEl = sec.querySelector(".ck-n-reset");',
    '    if (!ta) return;',
    '',
    '    var seedText = ta.getAttribute("data-seed");',
    '    if (seedText === null || seedText === undefined) seedText = "";',
    '',
    '    var armed = false;',
    '',
    '    /* The indicator, and the only place its three words are written.',
    '       They are three because they are three different facts: the note is on disk, the note is',
    '       about to be, or the note is not and will not be. Collapsing the third into either of the',
    '       others is the lie this card exists to refuse. */',
    '    function setState(kind, msg) {',
    '      if (!stateEl) return;',
    '      stateEl.className = "ck-n-state ck-n-" + kind;',
    '      stateEl.textContent = msg;',
    '    }',
    '',
    '    function setNote(msg) { if (noteEl) noteEl.textContent = msg; }',
    '',
    '    function recount() {',
    '      if (!countEl) return;',
    '      var t = ta.value;',
    '      countEl.textContent = plural(words(t), "word", "words") + ", "',
    '        + plural(t.length, "character", "characters");',
    '    }',
    '',
    '    /* The write. Every branch that fails to store something says which branch it was.',
    '       An over-cap note is deliberately left in the box rather than trimmed: the text in front',
    '       of the viewer is still theirs to copy out, and cutting it to fit would be this card',
    '       destroying data to make its own storage problem go away. */',
    '    function flush() {',
    '      var t = ta.value;',
    '      if (t.length > MAX) {',
    '        setState("bad", "not saved \\u2014 over the " + MAXT + " character cap");',
    '        setNote("this note is " + t.length + " characters, past the " + MAXT',
    '          + " character cap. nothing is being written; copy it somewhere else before you close the tab.");',
    '        return;',
    '      }',
    '      var s = getStore();',
    '      if (!s) { setState("bad", "not saved \\u2014 storage is unavailable"); return; }',
    '      try { s.setItem(KEY, t); }',
    '      catch (e) {',
    '        setState("bad", "not saved \\u2014 storage is unavailable");',
    '        setNote("the browser refused the write ("',
    '          + (e && e.name ? e.name : "no reason given")',
    '          + "). nothing typed here is being kept; copy it somewhere else.");',
    '        return;',
    '      }',
    '      setState("ok", "saved");',
    '      setNote("");',
    '    }',
    '',
    '    /* The debounce id lives in a registry that outlives the DOM, for the same reason CK.timer',
    '       does. A main swap replaces this element while a write is still pending; the pending',
    '       write closes over the OLD textarea and would put its stale text over the new one a few',
    '       hundred milliseconds after the swap. Clearing by key at build time makes that impossible. */',
    '    window.__ckNoteT = window.__ckNoteT || {};',
    '    clearTimeout(window.__ckNoteT[KEY]);',
    '',
    '    function schedule() {',
    '      setState("busy", "saving\\u2026");',
    '      clearTimeout(window.__ckNoteT[KEY]);',
    '      window.__ckNoteT[KEY] = setTimeout(flush, WAIT);',
    '    }',
    '',
    '    /* ── settling what the box holds ────────────────────────────────────────────────── */',
    '',
    '    var writable = canWrite();',
    '    var got = readStored();',
    '',
    '    if (got.kind === "ok") {',
    '      /* Stored beats seed. Always, including the empty string: a note someone deliberately',
    '         cleared must stay cleared, or every reload undoes the clearing. */',
    '      ta.value = got.text;',
    '      setState("ok", got.text === "" ? "saved (empty)" : "saved");',
    '      setNote("");',
    '    } else if (got.kind === "big") {',
    '      ta.value = got.text;',
    '      setState("bad", "not saved \\u2014 over the " + MAXT + " character cap");',
    '      setNote("the stored note is " + got.was + " characters; the first " + MAXT',
    '        + " are shown. editing here will overwrite the rest, so copy it out first if you want it.");',
    '    } else if (got.kind === "junk") {',
    '      /* The seed stands, and the card says why rather than appearing to have eaten the note. */',
    '      setState("bad", "not saved \\u2014 the stored note was unreadable");',
    '      setNote("what was stored for this card was not text, so it is being ignored and the seed is shown. typing will replace it.");',
    '    } else if (got.kind === "nostore" || !writable) {',
    '      setState("bad", "not saved \\u2014 storage is unavailable");',
    '      setNote("this browser is not letting the desk store anything \\u2014 a private window does this. what you type stays on screen and is gone when the card reloads.");',
    '    } else {',
    '      /* Nothing stored yet. Saying "saved" here would be a lie about text that exists only in',
    '         the card definition, so the indicator says exactly what is true. */',
    '      setState("seed", "not saved yet \\u2014 this is the seed");',
    '      setNote("");',
    '    }',
    '    recount();',
    '',
    '    /* ── wiring ─────────────────────────────────────────────────────────────────────── */',
    '',
    '    CK.once(ta, "edit", function () {',
    '      ta.addEventListener("input", function () { recount(); schedule(); });',
    '      /* Leaving the box flushes immediately. Closing a tab inside the debounce window would',
    '         otherwise drop the last few hundred milliseconds of typing, which is exactly the kind',
    '         of small silent loss this card is built to not have. */',
    '      ta.addEventListener("blur", function () {',
    '        clearTimeout(window.__ckNoteT[KEY]);',
    '        flush();',
    '      });',
    '    });',
    '',
    '    if (resetEl) CK.once(resetEl, "reset", function () {',
    '      resetEl.addEventListener("click", function () {',
    '        /* Two clicks, because this discards writing. The first arms and says so; the second',
    '           does it. A card whose settings panel can destroy a note with one stray click is a',
    '           card that will eventually destroy one. */',
    '        if (!armed) {',
    '          armed = true;',
    '          resetEl.textContent = "click again to discard";',
    '          resetEl.className = "ck-n-reset ck-n-armed";',
    '          resetEl.__ckArm = setTimeout(function () {',
    '            armed = false;',
    '            resetEl.textContent = "reset to seed";',
    '            resetEl.className = "ck-n-reset";',
    '          }, 4000);',
    '          return;',
    '        }',
    '        clearTimeout(resetEl.__ckArm);',
    '        armed = false;',
    '        resetEl.textContent = "reset to seed";',
    '        resetEl.className = "ck-n-reset";',
    '        ta.value = seedText;',
    '        recount();',
    '        clearTimeout(window.__ckNoteT[KEY]);',
    '        flush();',
    '      });',
    '    });',
    '',
    '    CK.settings(sec, SEED, function (c) {',
    '      ta.classList.toggle("ck-n-mono", !!c.mono);',
    '      var r = Math.floor(Number(c.rows));',
    '      if (!isFinite(r) || r < 2) r = 2;',
    '      if (r > 40) r = 40;',
    '      ta.setAttribute("rows", String(r));',
    '      /* The attribute is what a form control reads and the class is what CSS reads; both are',
    '         set because the attribute alone does not reliably restyle a textarea already on the',
    '         page, and the class alone would leave the control lying about itself. */',
    '      var wrap = !!c.wrap;',
    '      ta.setAttribute("wrap", wrap ? "soft" : "off");',
    '      ta.classList.toggle("ck-n-nowrap", !wrap);',
    '    });',
    '  });'
  ].join('\n');
}

/**
 * Build one note card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute and its storage key
 * @param title the card's heading, rendered as plain text
 * @param data  `{ text, placeholder, rows }`; `text` is a seed, never content — see the module note
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'scratch', title: 'note', ord: 20, data: { text: 'hello' } })
 *   .html.indexOf('data-seed="hello"') >= 0;   // true
 *
 * @example
 * // a seed cannot close the element it is written into
 * build({ id: 'x', title: 't', data: { text: '</textarea><img src=x>' } })
 *   .html.indexOf('</textarea><img') < 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d    = data && typeof data === 'object' ? data : {};
  const seed = d.text == null ? '' : String(d.text);
  const rows = clampRows(d.rows == null ? defaults.rows : d.rows);
  const ph   = d.placeholder == null
    ? 'a note to yourself. it stays in this browser.'
    : String(d.placeholder);

  /* The seed keys are the exported defaults' keys and nothing else — the panel checks the settings
     panel's field names against `defaults` in both directions, and a seed that invented a key
     would pass a build and fail a validation. Only the value of `rows` moves. */
  const settings = { mono: defaults.mono, rows, wrap: defaults.wrap };

  /* The seed is written twice, deliberately: once as the textarea's initial value so the card
     still shows something if the script never runs, and once in `data-seed` so "reset to seed"
     has something to reset TO after the stored note has replaced the box's contents. Both go
     through `esc`, so a seed of `</textarea>` is text in both places and a tag in neither. */
  const html =
    '<section data-card="' + esc(id) + '" class="ck-note">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-mono">monospace</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-mono" name="mono">\n' +
    '    <label for="' + esc(id) + '-rows">rows</label>\n' +
    '    <input type="number" id="' + esc(id) + '-rows" name="rows" min="2" max="40" step="1">\n' +
    '    <label for="' + esc(id) + '-wrap">wrap lines</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-wrap" name="wrap">\n' +
    '    <label>seed text</label>\n' +
    '    <button type="button" class="ck-n-reset">reset to seed</button>\n' +
    '    <div class="ck-set-foot">the seed is only used when nothing is stored for this card. ' +
         'reset discards what is written here and puts the seed back; it asks once before it does.</div>\n' +
    '  </div>\n' +
    '  <textarea class="ck-n-ta" rows="' + rows + '" wrap="soft" spellcheck="true" ' +
         'aria-label="note" placeholder="' + esc(ph) + '" data-seed="' + esc(seed) + '">' +
         esc(seed) + '</textarea>\n' +
    '  <div class="ck-n-foot">\n' +
    '    <span class="ck-n-count"></span>\n' +
    '    <span class="ck-n-state"></span>\n' +
    '  </div>\n' +
    '  <div class="ck-cap">what you type is saved in this browser only, under this card\u2019s id. ' +
         '<b>the card\u2019s seed text is used only when nothing is stored</b>, so rebuilding the card ' +
         'cannot overwrite what you wrote \u2014 a rebuild is not an edit. the seed stays reachable: ' +
         '<i>reset to seed</i> is in the gear. <i class="ck-n-note"></i></div>\n' +
    '</section>\n';

  const js = '(function () {\n' + main(id, settings) + '\n})();\n';

  /* Guarded on the way out, not tested afterwards: a bad emit must not reach a desk at all. */
  return Object.assign({ json: { ord: Number.isFinite(ord) ? ord : 0 } },
                       guard({ html, css: CSS, js }));
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch is
   the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The
   indicator's three states borrow `--good`, `--ink-faint` and `--ck-s1`, which stay legible in
   both themes — and each state also carries different words, so the colour is a second channel
   rather than the only one. */
const CSS = `
  .ck-note { position: relative; }

  .ck-note .ck-n-ta {
    display: block; width: 100%; box-sizing: border-box; margin: 10px 0 0;
    padding: 9px 11px; resize: vertical; min-height: 60px;
    font: inherit; font-size: 12.5px; line-height: 1.55;
    background: var(--well); color: var(--ink);
    border: 1px solid var(--hairline); border-radius: 6px;
  }
  .ck-note .ck-n-ta:focus { outline: none; border-color: var(--accent); }
  .ck-note .ck-n-ta::placeholder { color: var(--ink-faint); }
  .ck-note .ck-n-ta.ck-n-mono { font-family: var(--mono); font-size: 11.5px; }

  /* Wrapping off. The wrap ATTRIBUTE is set alongside this, but the attribute alone does not
     reliably restyle a textarea that is already on the page, so CSS carries it. The overflow is
     the textarea's own: a long line scrolls inside the box and never widens the desk column. */
  .ck-note .ck-n-ta.ck-n-nowrap { white-space: pre; overflow-x: auto; }

  .ck-note .ck-n-foot {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    margin-top: 6px; font-family: var(--mono); font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .ck-note .ck-n-count { color: var(--ink-faint); }

  /* The indicator. Three states, three colours, and three different sentences — the words are the
     channel that survives a monochrome screen or a colour-blind reader, and the colour is the one
     that is readable from across the room. Neither is asked to work alone. */
  .ck-note .ck-n-state { text-align: right; }
  .ck-note .ck-n-ok    { color: var(--good); }
  .ck-note .ck-n-busy  { color: var(--ink-faint); }
  .ck-note .ck-n-seed  { color: var(--ink-faint); }
  .ck-note .ck-n-bad   { color: var(--ck-s1); font-weight: 700; }

  /* ── the settings panel ───────────────────────────────────────────────────────────────── */

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box; it
     wants to be its own size, at the start of its column. */
  .ck-note .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

  .ck-note .ck-n-reset {
    justify-self: start; font: inherit; font-family: var(--mono); font-size: 10.5px;
    padding: 4px 9px; cursor: pointer;
    background: var(--ground); color: var(--ink-dim);
    border: 1px solid var(--rule); border-radius: 4px;
  }
  .ck-note .ck-n-reset:hover { color: var(--accent); border-color: var(--accent); }

  /* Armed, and it looks armed. The second click discards writing, so the control stops looking
     like the quiet one in the panel for as long as it will actually do that. */
  .ck-note .ck-n-reset.ck-n-armed {
    color: var(--ck-s1); border-color: var(--ck-s1); font-weight: 700;
  }

  .ck-note .ck-n-note { font-style: normal; color: var(--ck-s1); }
`;
