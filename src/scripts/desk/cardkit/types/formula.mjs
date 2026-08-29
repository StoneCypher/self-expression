/**
 * The `formula` card type — TeX blocks rendered by KaTeX, coloured by TeX role.
 *
 * Two things about this type cost somebody an hour each, and both are the reason it exists as a
 * type rather than as another hand-written card.
 *
 * **The script tag.** KaTeX is served by the desk at `/katex/katex.min.js` and is deliberately
 * not loaded by default — it is a quarter of a megabyte that most desks never need. A card
 * therefore has to load it, and the obvious way is wrong: a `<script src>` that arrives as part
 * of a card's `html` **never executes**. The HTML parser marks a script element created by
 * fragment parsing as "already started", and the desk builds `<main>` by assigning markup, so
 * every such script is inert the moment it exists. It is not an error, nothing is logged, and
 * the card simply renders nothing forever. The only thing that runs is a script element built by
 * `document.createElement` and inserted into the document — which is what {@link LOADER_SRC}
 * does, from the card's `js`, where classic script is actually executed.
 *
 * **The delimiters.** Colouring by KaTeX's atom classes — `mord`, `mrel`, `mbin`, `mop`,
 * `mopen`, `mclose`, `mpunct` — works because those classes are the TeX grammar, so a palette
 * written against them generalises to expressions nobody has typed yet. Delimiters are the
 * exception, and quietly: `\left(` is emitted as nested `delimsizing` spans, and a `cases` brace
 * as `delimsizing mult` sitting inside an `minner`. Neither carries a role class of its own, so
 * both take the colour of whatever atom wraps them by inheritance — a `\left(` inside a fraction
 * comes out fraction-coloured, and the same expression recolours itself when you edit something
 * three tokens away. The palette therefore names the delimiter classes explicitly, and an
 * explicit rule on the descendant beats an inherited value from the ancestor every time.
 *
 * **What CSS cannot do.** A selector cannot match content, so no rule can say "the digits" or
 * "the Greek letters" — both are just `mord`. If you want them distinct you need a DOM pass, and
 * this card does one: after each render it walks the leaf `mord` spans and tags the ones whose
 * text is all digits, or holds a code point in a Greek block, so the palette has something to
 * select. Leaves only — tagging a group would paint everything inside it.
 *
 * Untrusted throughout, with one exception worth naming precisely: `tex` is **not** escaped,
 * because it is never interpolated into markup. It goes into a `data-tex` attribute (escaped
 * there) and is handed to `katex.render` as a string, which parses it as TeX. KaTeX's own
 * `trust` option — which would let `\href` and `\includegraphics` emit URLs of the author's
 * choosing — is left off, explicitly, at every call site.
 *
 * @see LOADER_SRC for the once-per-desk load guard
 * @see PALETTES for the role maps
 */

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * The palettes this type ships, as role-to-token maps.
 *
 * Keys are TeX roles, values are desk tokens. `none` exists as a real palette rather than as the
 * absence of one because "no colouring" is a choice a reader makes — a dense derivation is
 * easier to read in one ink, and a card that could not say so would be a card with an opinion.
 *
 * A palette name arriving from card data or from `localStorage` is checked against this object
 * and never used as a class name directly; that is the whole of the validation, and it is an
 * allowlist by construction rather than a filter that has to think of everything.
 *
 * @example Object.keys(PALETTES).indexOf('subtle') >= 0;   // true
 */
export const PALETTES = {
  /* Everything in one ink. The base rule already says this, so the palette adds nothing —
     it is listed so the name is real and the `<select>` can offer it. */
  none: {},

  /* Quiet: relations take the accent because they are where an equation turns, operators take
     one cool series colour, and everything structural recedes. Ordinary atoms stay --ink, so
     the expression still reads as text that happens to be coloured. */
  subtle: {
    rel: '--accent', bin: '--ink-dim', op: '--ck-s5',
    delim: '--ink-faint', punct: '--ink-faint',
    digit: '--ink-dim', greek: '--ck-s7',
  },

  /* Loud, for a card whose whole job is to show the grammar — teaching, or a diff of two
     expressions. Every role gets its own hue from the series, which is exactly the thing that
     would be exhausting on a page of them and is the point on one. */
  vivid: {
    rel: '--ck-s6', bin: '--ck-s1', op: '--ck-s4',
    delim: '--ck-s3', punct: '--ck-s2',
    digit: '--ck-s2', greek: '--ck-s7',
  },
};

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * These three keys and the `name` attributes in the card's `<div class="ck-set">` are one thing
 * seen twice, and the verifier checks it both ways: a field whose `name` has drifted is ignored
 * by `CK.settings` — correctly, and silently — and looks exactly like a control that does
 * nothing.
 *
 * `display` is on because a formula card is almost always a statement rather than a phrase, and
 * `numbered` is off because a number is a cross-reference: it is furniture until something else
 * refers to it, and unreferenced numbers make a card look like a page torn out of a paper.
 *
 * @example defaults.palette;   // 'subtle'
 */
export const defaults = { palette: 'subtle', display: true, numbered: false };

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * `shape` is a string and `defaults` is an object, per the contract: the first is read by a
 * person choosing a type and has to scan at a glance, the second is read by a machine checking a
 * panel's fields against it.
 *
 * @example meta.name;                    // 'formula'
 * @example Object.keys(meta.defaults);   // ['palette', 'display', 'numbered']
 */
export const meta = {
  name: 'formula',
  summary: 'TeX blocks rendered with KaTeX and coloured by TeX role, falling back to readable ' +
           'source when the library or the expression will not cooperate.',
  shape: '{ blocks: [{ tex, caption, display }], palette, caption } — ' +
         "palette is 'none' | 'subtle' | 'vivid'; a block's display overrides the setting, and " +
         'omitting it inherits',
  defaults: { ...defaults },
};

/** Where the desk serves KaTeX. Same-origin, so the CSP's `script-src 'self'` allows it. */
const KATEX_JS  = '/katex/katex.min.js';
const KATEX_CSS = '/katex/katex.min.css';

/* ── escaping and embedding ──────────────────────────────────────────────────────────────── */

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * Duplicated rather than imported because `kit.js` is a classic script and not a module. The two
 * must agree exactly: a card whose Node side and browser side disagree about what is safe is a
 * card with a hole in whichever side is more permissive.
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
 * backtick and the question mark are escaped for a different reason — this type's verifier
 * asserts the emitted script contains no template literals and no optional chaining, and a card
 * id containing a backtick would fail that check with a mystifying message about a rule it did
 * not break.
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
 * Drop C0 control characters and DEL from a caller's text, keeping tab and newline.
 *
 * Written as code-point arithmetic rather than as a character class on purpose, per contract
 * rule 6. A class like that has to be spelled with escapes, and an escape decoded one step too
 * early puts the raw control character into this file, where it is invisible in every editor,
 * legal to the parser, and survives `node --check`. Comparing numbers cannot go wrong that way.
 *
 * Tab and newline survive because they survive in TeX: a multi-line `aligned` environment is
 * written across lines, and flattening it would change nothing about the render but would make
 * the fallback source unreadable, which is the one job the fallback has.
 *
 * @param s the text to clean
 *
 * @example clean('a\u0000b');   // 'ab'
 */
function clean(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10) { out += ch; continue; }
    if (c < 32 || c === 127) continue;
    out += ch;
  }
  return out;
}

/**
 * A palette name the card is willing to use, falling back to the type's default.
 *
 * The name arrives from card data at build time and from `localStorage` at run time, and the
 * contract says to re-vet the second — it is a text file the viewer can edit. Both go through
 * here, so `ck-fx-p-` can be concatenated with the result without wondering what is in it.
 *
 * @param name the caller's or the viewer's palette name
 *
 * @example okPalette('vivid');     // 'vivid'
 * @example okPalette('rainbow');   // 'subtle'
 */
function okPalette(name) {
  const s = name == null ? '' : String(name);
  return Object.hasOwn(PALETTES, s) ? s : defaults.palette;
}

/**
 * Normalise the block list.
 *
 * A block with no `tex` at all is not dropped: it is kept, flagged, and rendered as an explicit
 * "empty formula" note. A caller emitting a block with nothing in it has a bug upstream — a
 * template that did not fill, a row that lost its column — and a card that silently renders four
 * formulas where five were asked for hides exactly the fact that would find it.
 *
 * @param list the caller's `blocks`
 * @returns `{ blocks, empties }` — each block carries `tex`, `caption` and `display` (`true`,
 *   `false`, or `null` to inherit the setting)
 *
 * @example normBlocks([{ tex: 'x^2' }])[0];        // undefined — the blocks are under .blocks
 * @example normBlocks([{ tex: '' }]).empties;      // 1
 * @example normBlocks([{ tex: 'x', display: false }]).blocks[0].display;   // false
 */
function normBlocks(list) {
  const blocks = [];
  let empties = 0;

  for (const raw of Array.isArray(list) ? list : []) {
    /* A bare string is a formula with no caption and no opinion about display; accepting it
       makes the common `{ blocks: ['E = mc^2'] }` call work rather than render nothing. */
    const b = typeof raw === 'string' ? { tex: raw } : raw;
    if (!b || typeof b !== 'object') continue;

    const tex = clean(b.tex).trim();
    if (tex === '') empties += 1;

    blocks.push({
      tex,
      caption: b.caption == null ? '' : clean(b.caption),
      display: b.display === true ? true : b.display === false ? false : null,
    });
  }

  return { blocks, empties };
}

/* ── the browser half ────────────────────────────────────────────────────────────────────── */

/**
 * The KaTeX loader and the post-render tagging pass, as browser source.
 *
 * Shipped verbatim inside `js` *and* exercised directly by this type's verifier through a stub
 * DOM, so the loader that is tested is textually the loader that runs. A Node-shaped twin of a
 * browser function will eventually disagree with it, and this particular function is one whose
 * disagreement would be invisible: a second script tag costs a second 280KB fetch and a race,
 * and nothing errors.
 *
 * Three properties it is written to guarantee:
 *
 *   - **The element is constructed, never parsed.** `document.createElement('script')` produces
 *     a script that runs when inserted. A `<script src>` that arrives as parsed markup — which
 *     is what any card `html` is, and what a `<main>` swap produces — is flagged "already
 *     started" by the parser and is inert forever, silently. That is the hour this comment is
 *     paying back.
 *   - **Once per desk, not once per card.** The registry hangs off `window`, which outlives the
 *     `<main>` swap that hands every builder a brand-new element; `CK.once` could not do this
 *     job, for exactly the reason `CK.timer` exists. Four formula cards produce one fetch.
 *   - **Failure is a state, not an exception.** A 404 or a blocked request fires `onerror`, the
 *     registry latches `failed`, and every waiting card — and every card built afterwards — is
 *     told so synchronously. The card then shows its TeX source, which is honest and still
 *     readable, instead of an empty box that looks like a rendering bug.
 *
 * @example LOADER_SRC.indexOf('createElement') >= 0;   // true
 */
export const LOADER_SRC = [
  '  /* One registry per document, on window so it survives the <main> swap that replaces every',
  '     card element. state is "idle" | "loading" | "ready" | "failed". */',
  '  function ckFxReg() {',
  '    if (!window.__ckFxKatex) window.__ckFxKatex = { state: "idle", waiting: [] };',
  '    return window.__ckFxKatex;',
  '  }',
  '',
  '  function ckFxDrain(reg, err) {',
  '    var q = reg.waiting, i;',
  '    reg.waiting = [];',
  '    for (i = 0; i < q.length; i++) q[i](err);',
  '  }',
  '',
  '  /**',
  '   * Ensure KaTeX is loaded, then call back with null, or with a reason it will not be.',
  '   */',
  '  function ckFxLoad(cb) {',
  '    var reg = ckFxReg();',
  '',
  '    /* Another card may already have loaded it, and after a swap this card certainly has.',
  '       Checking the global first is what makes the whole thing idempotent. */',
  '    if (window.katex) { reg.state = "ready"; cb(null); return; }',
  '    if (reg.state === "failed") { cb("katex could not be loaded"); return; }',
  '',
  '    reg.waiting.push(cb);',
  '    if (reg.state === "loading") return;',
  '    reg.state = "loading";',
  '',
  '    /* The stylesheet is not optional decoration: without it KaTeX output is a pile of',
  '       absolutely-positioned spans with no metrics, which is worse than the source. */',
  '    if (!document.getElementById("ck-fx-katex-css")) {',
  '      var link = document.createElement("link");',
  '      link.id = "ck-fx-katex-css";',
  '      link.rel = "stylesheet";',
  '      link.href = ' + jsStr(KATEX_CSS) + ';',
  '      document.head.appendChild(link);',
  '    }',
  '',
  '    /* CREATED, not parsed. A <script src> written into a card\'s html and inserted by a DOM',
  '       swap is flagged "already started" and never runs, with no error anywhere. This is the',
  '       only construction that executes. */',
  '    var s = document.createElement("script");',
  '    s.id = "ck-fx-katex-js";',
  '    s.src = ' + jsStr(KATEX_JS) + ';',
  '    s.async = true;',
  '    s.onload = function () {',
  '      var ok = !!window.katex;',
  '      reg.state = ok ? "ready" : "failed";',
  '      ckFxDrain(reg, ok ? null : "katex loaded but defined no global");',
  '    };',
  '    s.onerror = function () {',
  '      reg.state = "failed";',
  '      ckFxDrain(reg, "katex could not be fetched from " + ' + jsStr(KATEX_JS) + ');',
  '    };',
  '    document.head.appendChild(s);',
  '  }',
  '',
  '  /**',
  '   * Tag the leaf ordinary atoms whose CONTENT decides their role.',
  '   *',
  '   * CSS cannot match content, so digits and Greek letters — both plain "mord" to KaTeX —',
  '   * are indistinguishable to a stylesheet. This adds the class a selector can then use.',
  '   * Leaves only: an "mord" with element children is a group, and tagging it would paint',
  '   * everything inside it, including the relations and operators it wraps.',
  '   */',
  '  function ckFxTag(root) {',
  '    if (!root || !root.querySelectorAll) return;',
  '    var spans = root.querySelectorAll(".mord"), i, j, el, t, c, digits, greek;',
  '    for (i = 0; i < spans.length; i++) {',
  '      el = spans[i];',
  '      if (el.firstElementChild) continue;',
  '      t = el.textContent || "";',
  '      if (t === "") continue;',
  '      digits = true;',
  '      greek = false;',
  '      for (j = 0; j < t.length; j++) {',
  '        c = t.codePointAt(j);',
  '        if (c > 65535) j++;                       /* step over the low surrogate */',
  '        if (c >= 48 && c <= 57) continue;         /* 0-9 */',
  '        if (c === 46 || c === 44) continue;       /* the separators a number may carry */',
  '        digits = false;',
  '        /* Greek and Coptic, Greek Extended, and the mathematical Greek alphabets. Compared',
  '           numerically rather than with a character class, for the reason the contract',
  '           gives: an escape decoded one step early puts a raw byte in the source. */',
  '        if (c >= 880 && c <= 1023) greek = true;',
  '        if (c >= 7936 && c <= 8191) greek = true;',
  '        if (c >= 120488 && c <= 120779) greek = true;',
  '      }',
  '      if (!el.classList) continue;',
  '      if (digits) el.classList.add("ck-fx-digit");',
  '      else if (greek) el.classList.add("ck-fx-greek");',
  '    }',
  '  }'
].join('\n');

/**
 * The card's own browser half: settings, render, and the fallbacks.
 *
 * Classic script throughout — `var` and `function`, no arrows, no template literals, no optional
 * chaining — because every card's script is concatenated into one inline block and one
 * modern-syntax parse error takes the whole desk down.
 *
 * @param id      the card's `data-card` value, embedded as a literal
 * @param seeded  the settings defaults for this card, with `palette` seeded from its data
 *
 * @example main('euler', { palette: 'subtle', display: true, numbered: false })
 *   .indexOf('katex.render') >= 0;   // true
 */
function main(id, seeded) {
  return [
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var blocks = sec.querySelectorAll(".ck-fx-block");',
    '    var status = sec.querySelector(".ck-fx-status");',
    '    var cfgNow = null;',
    '',
    '    /* An allowlist by construction: the name is compared against three known values and',
    '       the class is built from the survivor, so nothing a viewer can type into',
    '       localStorage becomes part of a class name. */',
    '    var PALS = ' + JSON.stringify(Object.keys(PALETTES)) + ';',
    '    function palette(name) {',
    '      var i, use = ' + jsStr(defaults.palette) + ';',
    '      for (i = 0; i < PALS.length; i++) if (PALS[i] === name) use = name;',
    '      for (i = 0; i < PALS.length; i++) sec.classList.remove("ck-fx-p-" + PALS[i]);',
    '      sec.classList.add("ck-fx-p-" + use);',
    '    }',
    '',
    '    /* Display mode and equation numbers, both of which are knowable without KaTeX and are',
    '       therefore settled before it is asked for. Numbers are assigned over the blocks that',
    '       are ACTUALLY in display mode, in order, so an inline block in the middle does not',
    '       leave a gap in the sequence — which is how LaTeX numbers, and the only version a',
    '       reader can cross-reference. */',
    '    function frame(cfg) {',
    '      var i, b, want, disp, tag, n = 0;',
    '      for (i = 0; i < blocks.length; i++) {',
    '        b = blocks[i];',
    '        want = b.getAttribute("data-display");',
    '        disp = want === "1" ? true : want === "0" ? false : !!cfg.display;',
    '        b.classList.toggle("ck-fx-d", disp);',
    '        tag = b.querySelector(".ck-fx-num-tag");',
    '        if (tag) tag.textContent = disp ? "(" + (++n) + ")" : "";',
    '      }',
    '    }',
    '',
    '    /* The source, put back as text. Used before KaTeX arrives, when it never arrives, and',
    '       when it refuses one expression — three different failures with one honest answer,',
    '       because a card showing its TeX is still a card someone can read. */',
    '    function source(host, tex) {',
    '      var code = document.createElement("code");',
    '      code.className = "ck-fx-src";',
    '      code.textContent = tex;',
    '      host.textContent = "";',
    '      host.appendChild(code);',
    '    }',
    '',
    '    function render() {',
    '      if (!window.katex || !cfgNow) return;',
    '      var i, b, host, err, tex, disp;',
    '      for (i = 0; i < blocks.length; i++) {',
    '        b = blocks[i];',
    '        if (b.getAttribute("data-empty") === "1") continue;',
    '        host = b.querySelector(".ck-fx-render");',
    '        err  = b.querySelector(".ck-fx-err");',
    '        if (!host) continue;',
    '        tex  = b.getAttribute("data-tex");',
    '        disp = b.classList.contains("ck-fx-d");',
    '        try {',
    '          /* trust is OFF, explicitly and at the only call site there is. With it on,',
    '             \\href and \\includegraphics would let an expression emit a URL of its own',
    '             choosing — which is a link the reader did not write into a card whose whole',
    '             premise is that its data is untrusted. throwOnError is on for the opposite',
    '             reason: the default paints the bad token red and carries on, and a card that',
    '             renders three quarters of an equation is worse than one that says so. */',
    '          window.katex.render(tex, host, {',
    '            displayMode: disp, throwOnError: true, trust: false',
    '          });',
    '          if (err) { err.hidden = true; err.textContent = ""; }',
    '          ckFxTag(host);',
    '        } catch (e) {',
    '          source(host, tex);',
    '          if (err) {',
    '            err.hidden = false;',
    '            /* textContent, not innerHTML: a KaTeX error message quotes the offending TeX',
    '               back at you, so the message carries caller data. */',
    '            err.textContent = e && e.message ? e.message : String(e);',
    '          }',
    '        }',
    '      }',
    '    }',
    '',
    '    CK.settings(sec, ' + JSON.stringify(seeded) + ', function (cfg) {',
    '      cfgNow = cfg;',
    '      palette(cfg.palette);',
    '      sec.classList.toggle("ck-fx-numbered", !!cfg.numbered);',
    '      frame(cfg);',
    '',
    '      /* One path, always. ckFxLoad answers synchronously when KaTeX is already there —',
    '         which is the common case after the first card and after every <main> swap — so a',
    '         fast path here would only be a second version of the same decision, free to drift',
    '         from the one that matters. */',
    '      ckFxLoad(function (e) {',
    '        if (e) {',
    '          if (status) { status.hidden = false; status.textContent = e + "; showing the TeX source instead."; }',
    '          return;',
    '        }',
    '        if (status) status.hidden = true;',
    '        render();',
    '      });',
    '    });',
    '  });'
  ].join('\n');
}

/* ── the build ───────────────────────────────────────────────────────────────────────────── */

/**
 * One block's markup.
 *
 * The `<code>` fallback is written here rather than left for the script, so the card is readable
 * from the first paint, before KaTeX has been fetched at all — and stays readable if it never
 * is. A successful render replaces it. That ordering is the difference between "loading" being
 * invisible and "loading" being a blank rectangle.
 *
 * @param b the normalised block
 * @param i the block's zero-based position, for the numbering slot
 *
 * @example blockHtml({ tex: 'x^2', caption: '', display: null }, 0).indexOf('data-tex') >= 0;   // true
 */
function blockHtml(b, i) {
  const disp = b.display === null ? '' : b.display ? '1' : '0';
  const cap = b.caption === '' ? ''
    : '<div class="ck-fx-cap">' + esc(b.caption) + '</div>';

  if (b.tex === '') {
    return '<div class="ck-fx-block ck-fx-void" data-empty="1" data-display="' + disp + '" ' +
           'data-tex="">' +
           '<div class="ck-fx-render"><span class="ck-fx-warn">block ' + (i + 1) +
           ' has no tex</span></div>' +
           '<div class="ck-fx-num-tag"></div>' + cap + '</div>';
  }

  return '<div class="ck-fx-block" data-display="' + disp + '" data-tex="' + esc(b.tex) + '">' +
         '<div class="ck-fx-render ck-scroll"><code class="ck-fx-src">' + esc(b.tex) + '</code></div>' +
         '<div class="ck-fx-num-tag"></div>' +
         '<div class="ck-fx-err" hidden></div>' + cap +
         '</div>';
}

/**
 * The `<option>` list for the palette select, with the card's seeded value pre-selected.
 *
 * `CK.settings` reflects the stored value onto the control when the panel is built, so this only
 * matters before any script runs — but that is exactly the state a static render is in, and a
 * panel showing `subtle` for a card built as `vivid` is a panel that lies.
 *
 * @param sel the seeded palette name, already through {@link okPalette}
 *
 * @example options('none').indexOf('value="none" selected') >= 0;   // true
 */
function options(sel) {
  return Object.keys(PALETTES).map((k) =>
    '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(k) + '</option>'
  ).join('');
}

/**
 * Build one formula card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  `{ blocks, palette, caption }`; `tex` is handed to KaTeX, everything else is escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'euler', title: 'euler', ord: 1, data: {
 *   blocks: [{ tex: 'e^{i\\pi} + 1 = 0', caption: 'the identity' }],
 *   palette: 'subtle'
 * } }).html.indexOf('data-card="euler"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d = data && typeof data === 'object' ? data : {};

  const parsed = normBlocks(d.blocks);
  const blocks = parsed.blocks;
  const pal    = okPalette(d.palette);

  /* The card's own defaults, with `palette` seeded from its data. `meta.defaults` stays the
     type's answer — the panel's field NAMES are what has to match it, not their values — and
     this is the per-card answer, which is what `CK.settings` needs. */
  const seeded = { ...defaults, palette: pal };

  const body = blocks.map(blockHtml);

  const void_ = blocks.length === 0
    ? '<div class="ck-fx-none">nothing to render &mdash; this card has no formula blocks</div>'
    : '';

  const notes = [];
  if (parsed.empties) {
    notes.push(parsed.empties + (parsed.empties === 1 ? ' block has no tex' : ' blocks have no tex'));
  }

  const caption = (d.caption == null ? '' : esc(clean(d.caption)) + ' ') +
    (notes.length ? '<span class="ck-aside">' + esc(notes.join(' \u00b7 ')) + '</span>' : '');

  const html =
    '<section data-card="' + esc(id) + '" class="ck-formula ck-fx-p-' + esc(pal) + '">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-palette">palette</label>\n' +
    '    <select id="' + esc(id) + '-palette" name="palette">' + options(pal) + '</select>\n' +
    '    <label for="' + esc(id) + '-display">display mode</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-display" name="display">\n' +
    '    <label for="' + esc(id) + '-numbered">equation numbers</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-numbered" name="numbered">\n' +
    '    <div class="ck-set-foot">colour follows the tex grammar, not the characters: relations, operators and delimiters are separate roles.</div>\n' +
    '  </div>\n' +
    '  <div class="ck-fx-status" hidden></div>\n' +
    (void_ ? '  ' + void_ + '\n' : '') +
    (body.length ? '  ' + body.join('\n  ') + '\n' : '') +
    '  <div class="ck-cap">' + caption + '</div>\n' +
    '</section>\n';

  const js = '(function () {\n' + LOADER_SRC + '\n\n' + main(id, seeded) + '\n})();\n';

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/**
 * The palette rules, generated from {@link PALETTES} so the maps above are the single source.
 *
 * Every value is a desk token; there is not one literal colour in the file. The role variables
 * are declared on `.ck-formula` rather than on `:root` because they are indirections, not
 * colours — each resolves to a token that both themes already answer, so nothing here needs a
 * theme override and nothing keys off `prefers-color-scheme`.
 *
 * @example paletteCss().indexOf('--fx-rel') >= 0;   // true
 */
function paletteCss() {
  const rules = [];
  for (const name of Object.keys(PALETTES)) {
    const map = PALETTES[name];
    const decls = Object.keys(map).map((role) => '--fx-' + role + ': var(' + map[role] + ');');
    if (decls.length === 0) continue;
    rules.push('  .ck-formula.ck-fx-p-' + name + ' { ' + decls.join(' ') + ' }');
  }
  return rules.join('\n');
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch
   is the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The
   desk is one document open in two viewers who want different answers, and the OS only knows how
   to give both of them the same one. */
const CSS = `
  .ck-formula { position: relative; }

  /* Every role defaults to the body ink, so an unpainted role is invisible rather than absent
     and the "none" palette needs no rules of its own. */
  .ck-formula {
    --fx-ord: var(--ink);   --fx-rel: var(--ink);   --fx-bin: var(--ink);
    --fx-op: var(--ink);    --fx-delim: var(--ink); --fx-punct: var(--ink);
    --fx-digit: var(--ink); --fx-greek: var(--ink);
  }

${paletteCss()}

  /* ── blocks ─────────────────────────────────────────────────────────────────────────── */

  .ck-formula .ck-fx-block {
    display: grid; grid-template-columns: 1fr auto; align-items: center;
    gap: 2px 10px; margin: 14px 0;
  }
  .ck-formula .ck-fx-block + .ck-fx-block { border-top: 1px solid var(--hairline); padding-top: 14px; }

  /* Wide maths scrolls inside its own box; the desk column never moves sideways. */
  .ck-formula .ck-fx-render { min-width: 0; color: var(--fx-ord); }
  .ck-formula.ck-fx-p-none .ck-fx-render { color: var(--ink); }

  .ck-formula .ck-fx-cap {
    grid-column: 1 / -1; font-size: 11px; color: var(--ink-faint); line-height: 1.5;
  }

  /* ── equation numbers ───────────────────────────────────────────────────────────────── */

  /* Hidden by default and shown only for blocks actually in display mode: a number beside a
     phrase set inline is a cross-reference to something that is not a statement. */
  .ck-formula .ck-fx-num-tag {
    display: none; font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .ck-formula.ck-fx-numbered .ck-fx-block.ck-fx-d .ck-fx-num-tag { display: block; }

  /* ── the fallbacks ──────────────────────────────────────────────────────────────────── */

  /* The source, shown before KaTeX arrives, if it never does, and beside an expression it
     refused. It is the card's floor: there is no state in which this card is blank. */
  .ck-formula .ck-fx-src {
    font-family: var(--mono); font-size: 11.5px; line-height: 1.6;
    color: var(--ink-dim); background: var(--well);
    border: 1px solid var(--hairline); border-radius: 5px;
    padding: 6px 9px; display: block; white-space: pre-wrap; word-break: break-word;
  }
  .ck-formula .ck-fx-err {
    grid-column: 1 / -1;
    font-family: var(--mono); font-size: 10.5px; line-height: 1.5; color: var(--ck-s1);
    white-space: pre-wrap; word-break: break-word; margin-top: 3px;
  }
  .ck-formula .ck-fx-err[hidden] { display: none; }
  .ck-formula .ck-fx-status {
    font-family: var(--mono); font-size: 10.5px; color: var(--ck-s2);
    border-left: 2px solid var(--ck-s2); padding: 3px 0 3px 8px; margin: 10px 0;
  }
  .ck-formula .ck-fx-status[hidden] { display: none; }
  .ck-formula .ck-fx-warn, .ck-formula .ck-fx-none {
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }
  .ck-formula .ck-fx-none { margin: 10px 0; }

  /* ── the palette, applied to KaTeX's own atom classes ───────────────────────────────── */

  /* These class names are the TeX grammar, not KaTeX's implementation detail: mrel is a
     relation, mbin is a binary operator, mop is a large operator or a named function. Colouring
     by them generalises to every expression, including ones nobody has typed yet. */
  .ck-formula .katex { font-size: 1.06em; }
  .ck-formula .katex .mord   { color: var(--fx-ord); }
  .ck-formula .katex .mrel   { color: var(--fx-rel); }
  .ck-formula .katex .mbin   { color: var(--fx-bin); }
  .ck-formula .katex .mop    { color: var(--fx-op); }
  .ck-formula .katex .mpunct { color: var(--fx-punct); }

  /* Delimiters, named explicitly and last, and this is the trap the whole palette turns on.
     \\left( is emitted as nested "delimsizing" spans and a cases brace as "delimsizing mult";
     neither carries a role class, so both INHERIT whatever atom wraps them — the same bracket
     comes out one colour inside a fraction and another inside a sum, and editing a token three
     symbols away recolours it. An explicit rule on the descendant beats an inherited value from
     the ancestor, which is the entire fix. */
  .ck-formula .katex .mopen,
  .ck-formula .katex .mclose,
  .ck-formula .katex .delimcenter,
  .ck-formula .katex .delimsizing,
  .ck-formula .katex .delimsizinginner,
  .ck-formula .katex .delim-size1,
  .ck-formula .katex .delim-size4 { color: var(--fx-delim); }

  /* Content-derived roles, which no selector can find on its own — CSS cannot match text, and
     a digit and a variable are both "mord". The card's post-render pass adds these classes; see
     ckFxTag. Placed after the role rules so a tagged leaf wins over the group it sits in. */
  .ck-formula .katex .ck-fx-digit { color: var(--fx-digit); }
  .ck-formula .katex .ck-fx-greek { color: var(--fx-greek); }

  /* KaTeX sets its own display margins; the block's grid already owns the spacing. */
  .ck-formula .katex-display { margin: 0; }
  .ck-formula .katex-display > .katex { text-align: left; }
`;
