/**
 * A state machine on the desk, as John's own workbench.
 *
 * This file used to be an 89 KB hand-written FSL parser, three layout engines and an SVG renderer.
 * All of it is gone, and none of it should come back. It was the ninth build of a visualiser for a
 * language that already ships a visualiser — a full workbench web component, `<fsl-instance>`, with
 * a live editor, a graphviz renderer, simulation, history and an export menu, written by the same
 * person who wrote the language. Every one of the nine was correct against the brief it was given;
 * the briefs were wrong. See the "State machines are not hand-drawn" section of CONTRACT.md, which
 * exists because of exactly this.
 *
 * So this type does not parse, lay out or draw anything. It emits the element, seeds it, sizes it,
 * and keeps its theme in step with the desk. That is the whole job.
 *
 * ## How the components arrive
 *
 * They are not imported here and must not be: a card's `js` is concatenated with every other card's
 * into ONE inline classic script, which cannot import. The page shell watches the DOM for
 * `fsl-instance, fsl-editor, jssm-editor, [data-needs-jssm]` and loads the library the first time
 * one appears, through a MutationObserver so a card arriving by hot swap is caught too. **The card
 * gets the components by existing.** `window.DESK.jssm()` is exposed for a card that wants to know
 * when the definitions have landed, and this one calls it for exactly that reason — never to load.
 *
 * ## Where the FSL goes, and why it is the attribute
 *
 * The element takes its source from exactly one of three channels — the `fsl` attribute/property, a
 * `<script type="text/fsl">` child, or its own light-DOM text — and using none or more than one is a
 * thrown error at connect. The seed goes in the `fsl` **attribute**, which Lit turns into the `fsl`
 * property during upgrade, before `connectedCallback` reads it. Not light-DOM text, which would be
 * the third channel and is the one every slotted child is deliberately stripped from.
 *
 * A seed the machine rejects therefore throws at connect, loudly, in the console — and that is the
 * behaviour worth having. The alternative, seeding a known-good placeholder and applying the real
 * source afterwards, never throws and always lies: it draws a machine that is not the one that was
 * asked for. The editor still shows the offending source with its lint marks either way, and the
 * card writes a line saying the machine did not compile, so the failure is visible without being
 * silent.
 *
 * ## What the viewer types is kept
 *
 * The desk's swap replaces any card whose markup differs from what the server sent, and a live
 * `<fsl-instance>` always differs — it reflects `current-state`, `legal-actions` and its resolved
 * theme onto itself. So an edit would be lost the next time any card on the desk changed. The text
 * is therefore kept per viewer, beside the card's settings, and re-applied on mount. It is keyed to
 * the seed it was edited from: a card rebuilt with a NEW seed drops the stale copy, so the server
 * can still change what the card says.
 *
 * @see CONTRACT.md — "State machines are not hand-drawn"
 * @see C:/Users/john/projects/jssm/src/ts/wc/fsl_instance_wc.ts — the element itself
 */

/**
 * Every setting the card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to read
 * it — `meta.defaults` must be reachable from `meta` or every validator refuses the type, and a
 * `meta` declared first could not reference this without a temporal-dead-zone error.
 */
export const defaults = { layout: 'lr', height: 320, editor: true, panels: false };

/** What the catalogue shows for this type. */
export const meta = {
  name: 'fsl',
  summary: 'A state machine in the FSL workbench, with a live editor and the graph beside it.',
  shape: '{ fsl, layout, height, editor, panels } — fsl is the machine source; layout is one of ' +
         'lr rl tb bt tabs viewer editor auto; height is the workbench height in pixels; editor ' +
         'and panels are booleans, and each is also a per-viewer setting',
  category: 'flow-and-relationship',
  defaults: { ...defaults },
};

/* ── constants shared by both sides ────────────────────────────────────────────────────────────
   Emitted to the browser as the same values the module computed with, rather than restated there:
   a private copy is a second source of truth and it drifts silently. */

/**
 * The `layout` values the shipped element accepts, minus `''`.
 *
 * The empty string is the element's own default and renders the stacked, gutterless arrangement.
 * It is deliberately not offered: every entry here is a workbench, and an empty option value in a
 * select reads as "nothing chosen" to everyone who meets it.
 */
const FSL_LAYOUTS = ['lr', 'rl', 'tb', 'bt', 'tabs', 'viewer', 'editor', 'auto'];

/**
 * The panels asked for when the extra-panels setting is on; each is a real slot on the element.
 *
 * Off by default, and the reason is space rather than taste. A card is a column on a desk, not a
 * tab in an IDE: at the default height the editor and the graph are already competing, and three
 * more panels take the room from the two that answer the question the card was opened for. They
 * remain one setting away, and the element's own toolbar can still raise them, because the mode is
 * `request` rather than a locked `show`.
 */
const FSL_PANELS = ['actions', 'history', 'simulation'];

/** Workbench height bounds, in pixels. Below the floor both split panes are unusable. */
const FSL_HMIN = 180;
const FSL_HMAX = 1200;
const FSL_HDEF = 320;

/** How much stored FSL to trust back out of a viewer's own storage. */
const FSL_CAP = 100000;

/**
 * The machine a card with no source of its own shows.
 *
 * Multi-line and column-aligned, with the action and arrow columns lined up even where the padding
 * overruns, because this is the first FSL most readers will meet and it is teaching a shape. The
 * `flow: right` line is an FSL machine property that becomes graphviz's `rankdir`; `right` suits the
 * short wide box a docked card gives it.
 */
const FSL_SEED = [
  'flow: right;',
  '',
  "red    'go'      -> green;",
  "green  'caution' -> yellow;",
  "yellow 'stop'    -> red;",
  '',
].join('\n');

/* ── functions that run in the browser ─────────────────────────────────────────────────────────
   Emitted verbatim via Function.prototype.toString(), so what Node exercises is textually what the
   browser runs. Classic script only: var and function, no arrows, no const/let, no template
   literals, no optional chaining — and no backtick in any comment here, because toString() ships
   the comments and one backtick closes the desk's whole inline block. */

/**
 * Drop the characters that are legal in a string and invisible on the page.
 *
 * Anything read back out of localStorage is a text file the viewer can edit, so it is re-vetted the
 * same way card data is. Compared numerically rather than matched against a character class,
 * because writing the class is how the class gets corrupted. Tab, newline and carriage return
 * survive: in a machine source those are text.
 *
 * @example fslClean('a\u0000b');   // 'ab'
 */
function fslClean(s) {
  var raw = String(s == null ? '' : s), out = '', i, c;
  for (i = 0; i < raw.length; i++) {
    c = raw.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
    if (c === 127 || c === 0x2028 || c === 0x2029) continue;
    out += raw.charAt(i);
  }
  return out;
}

/**
 * A layout the element will accept, falling back to the side-by-side workbench.
 *
 * Used on both sides: Node picks the value baked into the markup with it, and the browser re-checks
 * whatever came back out of the viewer's settings.
 *
 * @example fslLayoutOk('viewer');   // 'viewer'
 * @example fslLayoutOk('sideways'); // 'lr'
 */
function fslLayoutOk(v) {
  var s = String(v == null ? '' : v), i;
  for (i = 0; i < FSL_LAYOUTS.length; i++) if (FSL_LAYOUTS[i] === s) return s;
  return 'lr';
}

/**
 * A workbench height in pixels, inside the range the control offers.
 *
 * Every split layout divides the height it is given, so an unsized instance collapses and both
 * panes land near zero — the failure that looks like a broken component and is actually a missing
 * height.
 *
 * @example fslHeight(9000);   // 1200
 * @example fslHeight('x');    // 320
 */
function fslHeight(n) {
  var v = Math.round(Number(n));
  if (!isFinite(v)) return FSL_HDEF;
  return v < FSL_HMIN ? FSL_HMIN : v > FSL_HMAX ? FSL_HMAX : v;
}

/**
 * Which of the desk's two themes is showing.
 *
 * Never the OS preference: the desk is one document open in two viewers that want different
 * answers, and prefers-color-scheme gives both the same one. The desk's own accessor is asked
 * first, and the attribute it sets is read directly where a card has landed somewhere else.
 */
function fslTheme() {
  if (window.DESK && typeof DESK.theme === 'function') {
    return DESK.theme() === 'light' ? 'light' : 'dark';
  }
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Put the desk's theme on every workbench on the page.
 *
 * The element's own theme property is a MODE, not a palette name: light, dark, or system. Only the
 * first two are ever used here, because system is prefers-color-scheme wearing a different word.
 *
 * Written as an attribute rather than a property on purpose. The attribute is observed, so it is
 * read at upgrade and again on every later change; a property set before upgrade is stashed by Lit
 * and re-applied a tick later, which is a race this does not need to have.
 */
function fslPaintTheme() {
  var want = fslTheme(), all = document.querySelectorAll('section.ck-fsl fsl-instance'), i;
  for (i = 0; i < all.length; i++) {
    if (all[i].getAttribute('theme') !== want) all[i].setAttribute('theme', want);
  }
}

/**
 * Follow the desk's theme switch, once per page however many cards there are.
 *
 * The switch lives in the header and only toggles an attribute on the document element — it does
 * not replay the builders — so watching that attribute is the only version of this that stays
 * true. Guarded on a window flag rather than on the element, because a swap hands the builder a new
 * element with an empty dataset and CK.once would let a second observer through every time.
 */
function fslWatchTheme() {
  fslPaintTheme();
  if (window.__ckFslTheme) return;
  window.__ckFslTheme = 1;
  if (!window.MutationObserver) return;
  new MutationObserver(fslPaintTheme).observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });
}

/**
 * The settings that can be applied to the element as attributes, whether or not it has upgraded.
 *
 * Compared before written, every time: a builder replay must repaint rather than disturb, and
 * writing layout back onto a live instance for no reason costs a re-render.
 */
function fslShape(el, cfg) {
  var layout = fslLayoutOk(cfg.layout), mode = cfg.panels ? 'request' : 'default';
  if (el.getAttribute('layout') !== layout) el.setAttribute('layout', layout);
  if (el.getAttribute('panel-mode') !== mode) el.setAttribute('panel-mode', mode);
  el.style.setProperty('--ck-fsl-h', fslHeight(cfg.height) + 'px');
}

/**
 * The settings that only exist as properties, applied once the element has upgraded.
 *
 * requestedPanels and panelModes carry no attribute at all, and setPanelHidden is a method, so none
 * of this can be done from markup. Request mode rather than a locked show: a requested panel is
 * visible but the toolbar's own toggle still wins over it, which is what keeps the toolbar honest.
 */
function fslPanels(el, cfg) {
  var want = cfg.panels ? FSL_PANELS : [];
  if (String(el.requestedPanels) !== String(want)) el.requestedPanels = want;
  if (typeof el.setPanelHidden === 'function') el.setPanelHidden('editor', !cfg.editor);
}

/**
 * The FSL this viewer should see: what they last typed here, or the card's seed.
 *
 * Keyed to the seed it was edited from, so a card rebuilt with a new source drops the stale copy
 * instead of shadowing it forever. Everything about the stored value is re-checked — it is a text
 * file the viewer can edit, and a card that trusts it is a card that renders whatever is in it.
 */
function fslStored(ID, SEED) {
  var raw = null, got = null;
  try { raw = localStorage.getItem('desk.card.' + ID + '.fsl'); } catch (e) { return SEED; }
  if (typeof raw !== 'string' || !raw) return SEED;
  try { got = JSON.parse(raw); } catch (e) { return SEED; }
  if (!got || typeof got !== 'object') return SEED;
  if (got.seed !== SEED) return SEED;
  if (typeof got.fsl !== 'string' || got.fsl.length > FSL_CAP) return SEED;
  var text = fslClean(got.fsl);
  return text.replace(/\s/g, '') === '' ? SEED : text;
}

/**
 * Apply that text to the workbench, to the machine and to the editor's document.
 *
 * Both, because they are two different things: the host rebuilds its machine from its own fsl
 * property, while the editor seeds itself from the host once at connect and never looks again. Set
 * only the host and the graph moves while the editor still shows the seed.
 *
 * Compare-then-set is what makes a replay safe. Writing the same source back would rebuild the
 * machine, and a rebuild is a fresh machine at its start state — so an idle replay would silently
 * throw away wherever the viewer had walked to.
 */
function fslSeed(el, ID, SEED) {
  var want = fslStored(ID, SEED), ed = el.querySelector('fsl-editor');
  if (ed && ed.fsl !== want) ed.fsl = want;
  if (el.fsl !== want) el.fsl = want;
}

/**
 * Keep what the viewer types, per viewer, beside the card's other settings.
 *
 * The editor's change event is composed and bubbling, so one listener on the section catches every
 * accepted keystroke without reaching into the element. The settings panel's own change events
 * arrive here too and carry no detail, which is what distinguishes them.
 */
function fslSave(sec, ID, SEED) {
  CK.once(sec, 'fslsave', function () {
    sec.addEventListener('change', function (ev) {
      var d = ev.detail;
      if (!d || typeof d.fsl !== 'string' || d.fsl.length > FSL_CAP) return;
      try {
        localStorage.setItem('desk.card.' + ID + '.fsl',
                             JSON.stringify({ seed: SEED, fsl: d.fsl }));
      } catch (e) { /* private window, or full: the text lives in the editor and nowhere else */ }
    });
  });
}

/**
 * Run something once the element is defined AND has finished its first render.
 *
 * Both halves matter. Before the definition lands there is no property to set; before the first
 * update the element ignores a change to its source, because its own guard skips the rebuild until
 * it has rendered once — so a property written in between is accepted, stored, and never compiled.
 *
 * Nothing is imported here. DESK.jssm() is the page shell's loader, already triggered by this
 * card's markup existing; calling it is how a card asks when, not whether.
 */
function fslReady(el, fn) {
  var go = function () {
    var done = function () { try { fn(); } catch (e) { console.error('fsl:', e); } };
    if (el.updateComplete && typeof el.updateComplete.then === 'function') {
      el.updateComplete.then(done, done);
    } else { done(); }
  };
  var nap = function () { /* the library never arrived; the markup still stands on its own */ };
  var defined = window.customElements
    ? customElements.whenDefined('fsl-instance') : null;
  var loading = (window.DESK && typeof DESK.jssm === 'function') ? DESK.jssm() : null;

  if (loading && typeof loading.then === 'function' && defined) {
    loading.then(function () { return defined; }).then(go, nap);
  } else if (defined && typeof defined.then === 'function') {
    defined.then(go, nap);
  } else {
    go();
  }
}

/**
 * Say so when the machine did not compile, rather than leaving an empty pane to be interpreted.
 *
 * The element paints its current state onto itself as an attribute the moment it has a machine, so
 * the absence of one after a completed render is the signal — no parsing, and no second opinion
 * about what valid FSL is.
 */
function fslNote(sec, el) {
  var note = sec.querySelector('.ck-f-note');
  if (!note) return;
  var broken = !el.hasAttribute('current-state');
  note.textContent = broken
    ? 'this source did not compile — the editor holds it, with the error marked'
    : '';
  note.hidden = !broken;
}

/**
 * Wire one card: settings, theme, storage, and the element's own properties.
 *
 * Nothing is created here. The workbench is in the card's markup, which is what lets a replay be a
 * no-op instead of a second copy, and what lets the page shell see the element and fetch the
 * library before this ever runs.
 */
function fslMain(sec, ID, SEED, CFG) {
  var el = sec.querySelector('fsl-instance');
  if (!el) return;

  fslWatchTheme();
  fslSave(sec, ID, SEED);

  CK.settings(sec, CFG, function (cfg) {
    fslShape(el, cfg);
    fslReady(el, function () {
      fslPanels(el, cfg);
      fslSeed(el, ID, SEED);
      fslNote(sec, el);
    });
  });
}

/* ── the Node side ─────────────────────────────────────────────────────────────────────────── */

/** Every function the browser needs, in dependency order for readability rather than necessity. */
const BROWSER = [
  fslClean, fslLayoutOk, fslHeight, fslTheme, fslPaintTheme, fslWatchTheme,
  fslShape, fslPanels, fslStored, fslSeed, fslSave, fslReady, fslNote, fslMain,
];

/** Every shared constant, emitted as the same value the module computed with. */
const CONSTS = [
  ['FSL_LAYOUTS', FSL_LAYOUTS], ['FSL_PANELS', FSL_PANELS], ['FSL_HMIN', FSL_HMIN],
  ['FSL_HMAX', FSL_HMAX], ['FSL_HDEF', FSL_HDEF], ['FSL_CAP', FSL_CAP],
];

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * Duplicated rather than imported because `kit.js` is a classic script, not a module. Control
 * characters are dropped BEFORE the escaping, and the order is the whole point: escaping only the
 * five metacharacters passes NUL and DEL straight through, and a card that renders one has put a
 * byte on the page nobody can see or delete. Tab, newline and carriage return survive — the seed
 * is a multi-line attribute value and those are its shape.
 *
 * @example esc('</script>');   // '&lt;/script&gt;'
 */
function esc(s) {
  const raw = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
    if (c === 127 || c === 0x2028 || c === 0x2029) continue;
    out += raw.charAt(i);
  }
  return out
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A JavaScript string literal safe to paste into an inline `<script>` block.
 *
 * `JSON.stringify` alone is not enough, in four separate ways: `</` would close the element, U+2028
 * and U+2029 are line terminators to a JS parser but not to JSON, DEL is passed through raw, and a
 * seed holding a backtick or a question mark would trip this type's own guard with a message about
 * a rule the seed did not break.
 *
 * @example jsStr('a</script>');   // '"a\\u003c/script\\u003e"'
 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/`/g, '\\u0060').replace(/\?/g, '\\u003f')
    .replace(/\u007f/g, '\\u007f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Blank comment and string bodies while preserving offsets, so a keyword scan reads code only.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose, and a guard that cries
 * wolf is a guard that gets deleted. Regex literals are recognised too, because otherwise the
 * scanner desyncs on the quote inside `replace(/'/g, x)` and blanks real code — turning a false
 * positive into a far worse false negative.
 */
function blankNonCode(src) {
  const out = src.split('');
  let i = 0, prev = '';
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      blank(i + 1, k); i = k + 1; prev = ')'; continue;
    }
    if (c === '/' && !/[\w)\]]/.test(prev)) {
      let k = i + 1, cls = false;
      while (k < src.length && (cls || src[k] !== '/')) {
        if (src[k] === '\\') k++;
        else if (src[k] === '[') cls = true;
        else if (src[k] === ']') cls = false;
        k++;
      }
      blank(i + 1, k); i = k + 1; prev = ')'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/**
 * Refuse to emit a card whose browser source is not a classic script.
 *
 * A build-time guard rather than a test, because the blast radius is not this card: every card's
 * `js` is concatenated into ONE inline block, so a single template literal or arrow here takes down
 * the whole desk, and the symptom is a page of dead cards with nothing to say which one did it.
 * Failing at build time breaks exactly one card, and names it.
 *
 * The backtick is referred to by code point rather than written, so this function cannot itself be
 * the thing that introduces one. Control characters are compared numerically for the same reason.
 *
 * @param parts the `{ html, css, js }` about to be returned
 * @returns the same object, when it is safe
 * @throws {Error} naming the offending construct and quoting the source around it
 *
 * @example guard({ html: '', css: '', js: 'var a = 1;' });   // returns its argument
 */
export function guard(parts) {
  const tick = String.fromCharCode(96);
  const banned = [[tick, 'a backtick, so a template literal'], ['=>', 'an arrow function'],
                  ['?.', 'optional chaining']];
  const js = parts.js ?? '';
  for (const [needle, what] of banned) {
    const at = js.indexOf(needle);
    if (at >= 0) {
      throw new Error('fsl: emitted js contains ' + what + ' at ' + at + ' — near: ' +
                      JSON.stringify(js.slice(Math.max(0, at - 60), at + 60)));
    }
  }
  const code = blankNonCode(js);
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('(^|[^\\w$.])' + kw + '[\\s({]').exec(code);
    if (m) {
      throw new Error('fsl: emitted js declares ' + kw + ' at ' + m.index + ' — near: ' +
                      JSON.stringify(js.slice(Math.max(0, m.index - 60), m.index + 60)));
    }
  }
  for (const key of ['html', 'css', 'js']) {
    const s = parts[key] ?? '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127 || c === 0x2028 || c === 0x2029) {
        throw new Error('fsl: emitted ' + key + ' holds code point ' + c + ' at offset ' + i);
      }
    }
  }
  return parts;
}

/**
 * The card's browser source: constants, the functions verbatim, and the one call that starts it.
 *
 * Assembled from the live function objects rather than from strings, so what a Node harness
 * exercises is textually what the browser runs and a Node-shaped twin cannot drift from it.
 *
 * @example emit('m', 'a -> b;', defaults).indexOf('CK.build') > 0;   // true
 */
function emit(id, seed, cfg) {
  const lines = ['(function () {'];
  for (const [name, value] of CONSTS) {
    lines.push('  var ' + name + ' = ' + JSON.stringify(value) + ';');
  }
  lines.push('');
  for (const fn of BROWSER) lines.push(fn.toString(), '');
  lines.push('  CK.build(' + jsStr(id) + ', function (sec) {');
  lines.push('    fslMain(sec, ' + jsStr(id) + ', ' + jsStr(seed) + ', ' +
             JSON.stringify(cfg) + ');');
  lines.push('  });');
  lines.push('})();');
  return lines.join('\n') + '\n';
}

/**
 * One slotted child of the workbench.
 *
 * Every child carries a slot, without exception. The element's shadow tree has fourteen named slots
 * and NO default slot, so an unslotted child is upgraded, present in the DOM, and 0x0 with an empty
 * computed style — a failure with no error attached to it. An unslotted child is also the element's
 * third FSL channel, so it would either be read as machine source or collide with the attribute and
 * throw.
 *
 * @example slot('fsl-viz', 'viz');   // '<fsl-viz slot="viz"></fsl-viz>'
 */
function slot(tag, name) {
  return '<' + tag + ' slot="' + name + '"></' + tag + '>';
}

/** The workbench, with every named slot filled. */
function workbench(title, seed, cfg) {
  const rows = [
    ['fsl-toolbar', 'toolbar'],
    ['fsl-viz', 'viz'],
    ['fsl-editor', 'editor'],
    ['fsl-actions', 'actions'],
    ['fsl-info-panel', 'info-panel'],
    ['fsl-history', 'history'],
    ['fsl-data-inspector', 'data-inspector'],
    ['fsl-hook-log', 'hook-log'],
    ['fsl-effective-properties', 'effective-properties'],
    ['fsl-simulation', 'simulation'],
    ['fsl-stochastic', 'stochastic'],
    ['fsl-export', 'export'],
    ['fsl-footer', 'footer'],
  ];

  /* No `id` and no `uhash`: either one binds the instance to a URL-fragment segment and starts
     writing the machine into location.hash on every edit, which on a desk means two cards fighting
     over the fragment the desk is already using. The element is inert without them. */
  return '<fsl-instance class="ck-f-wb" layout="' + esc(fslLayoutOk(cfg.layout)) + '"' +
         ' theme="dark" panel-mode="' + (cfg.panels ? 'request' : 'default') + '"' +
         ' fsl="' + esc(seed) + '">' +
         '<span slot="title">' + esc(title) + '</span>' +
         rows.map(r => slot(r[0], r[1])).join('') +
         '</fsl-instance>';
}

/** The settings panel: the four things the element actually supports being told. */
function panel(id) {
  const opts = [
    ['lr', 'editor left, graph right'],
    ['rl', 'graph left, editor right'],
    ['tb', 'editor above graph'],
    ['bt', 'graph above editor'],
    ['tabs', 'one pane at a time'],
    ['viewer', 'graph only'],
    ['editor', 'editor only'],
    ['auto', 'by shape, restacks when narrow'],
  ];
  return '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-layout">arrangement</label>\n' +
    '    <select id="' + esc(id) + '-layout" name="layout">\n' +
    opts.map(o => '      <option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + esc(id) + '-height">height</label>\n' +
    '    <input type="number" id="' + esc(id) + '-height" name="height" min="' + FSL_HMIN +
           '" max="' + FSL_HMAX + '" step="10">\n' +
    '    <label for="' + esc(id) + '-editor">editor pane</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-editor" name="editor">\n' +
    '    <label for="' + esc(id) + '-panels">actions, history, simulation</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-panels" name="panels">\n' +
    '    <div class="ck-set-foot">the arrangement is the element' + '&#39;' + 's own: the two ' +
         'panes share a draggable gutter, and <i>by shape</i> restacks them below a square box, ' +
         'which is most of a docked card' + '&#39;' + 's life. the extra panels are requested ' +
         'rather than forced, so the toolbar can still close them.</div>\n' +
    '  </div>\n';
}

/** The card's markup: one section, the workbench, the panel, the caption. */
function cardHtml(id, title, seed, cfg) {
  return '<section data-card="' + esc(id) + '" class="ck-fsl">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    panel(id) +
    '  <div class="ck-f-box">' + workbench(title, seed, cfg) + '</div>\n' +
    '  <p class="ck-f-note" hidden></p>\n' +
    '  <div class="ck-cap">the machine is live: edit it and the graph follows, then walk it from ' +
         'the actions. <span class="ck-aside">this is the FSL workbench itself, not a drawing of ' +
         'one — the editor, the graphviz render, the simulation and the history are the ' +
         'language' + '&#39;' + 's own components. <b>what you type is kept in this browser</b> ' +
         'under this card' + '&#39;' + 's id, so a desk refresh does not take it back; a card ' +
         'rebuilt with a new source drops the old copy.</span></div>\n' +
    '</section>\n';
}

/**
 * Build one FSL workbench card.
 *
 * @param id    the card's directory name; becomes its `data-card`, its CSS scope and its storage key
 * @param title the heading, rendered as plain text in the card and in the workbench
 * @param data  `{ fsl, layout, height }`; a blank or absent `fsl` falls back to the traffic light
 * @param ord   the card's position on the desk; a non-number falls back to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the emitted script would not be a classic script, or holds a control
 *                 character — see {@link guard}
 *
 * @example
 * build({ id: 'turnstile', title: 'turnstile', ord: 18,
 *         data: { fsl: "locked 'coin' -> unlocked 'push' -> locked;" } })
 *   .html.indexOf('fsl-instance') > 0;   // true
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'fsl' : id);
  const heading = title == null ? cardId : String(title);
  const d = data && typeof data === 'object' ? data : {};

  /* Cleaned once, here, so the value written into the attribute and the value written into the
     script are the same string. `esc` drops control characters and `jsStr` escapes them, so an
     uncleaned seed would reach the two sides differently — and the script's copy is what the stored
     text is keyed against, which would then never match.

     An empty source is not a source, either: the element treats zero channels as an error and
     throws at connect, so a card with nothing to say gets something honest to say instead. */
  const given = typeof d.fsl === 'string' ? fslClean(d.fsl) : '';
  const seed = given.replace(/\s/g, '') === '' ? FSL_SEED : given;

  const cfg = {
    layout: fslLayoutOk(d.layout == null ? defaults.layout : d.layout),
    height: fslHeight(d.height == null ? defaults.height : d.height),
    editor: d.editor === undefined ? defaults.editor : d.editor !== false,
    panels: d.panels === undefined ? defaults.panels : d.panels !== false,
  };

  return Object.assign(
    { json: { ord: Number.isFinite(Number(ord)) ? Number(ord) : 50, type: 'fsl',
              layout: cfg.layout } },
    guard({ html: cardHtml(cardId, heading, seed, cfg), css: CSS,
            js: emit(cardId, seed, cfg) }));
}

/* Every colour here is a desk token, so the light switch is the only thing that has to know
   anything and nothing keys off prefers-color-scheme. The workbench's own interior wears the
   element's palette, driven by the theme mode the card sets from the desk — its two variants are
   the component's, deliberately, because this is John's tool wearing its own clothes inside the
   card rather than a repaint of it. */
const CSS = `
  .ck-fsl { position: relative; }

  /* The box exists so the height is stated in exactly one place and the corner can be clipped.
     Every split layout divides the height it is given: unsized, the container collapses and both
     panes land near zero, which reads as a broken component and is a missing number. */
  .ck-fsl .ck-f-box {
    margin: 10px 0 0; border: 1px solid var(--hairline); border-radius: 6px;
    overflow: hidden; background: var(--well);
  }

  .ck-fsl .ck-f-wb {
    display: block;
    height: var(--ck-fsl-h, clamp(260px, 40vh, 420px));
    width: 100%;
  }

  /* The panes are flex children of the workbench; the slotted content has to fill the pane it was
     given or the drag gutter has nothing to redistribute. */
  .ck-fsl fsl-viz, .ck-fsl fsl-editor { display: block; height: 100%; min-height: 0; }

  /* Before the definitions land the element is an unknown tag, which is inline and empty. Sizing it
     here keeps the card from jumping when the workbench arrives. */
  .ck-fsl fsl-instance:not(:defined) {
    display: block; position: relative;
    height: var(--ck-fsl-h, clamp(260px, 40vh, 420px));
  }
  .ck-fsl fsl-instance:not(:defined)::before {
    content: "loading the machine workbench";
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: var(--mono); font-size: 10.5px; color: var(--ink-faint);
  }
  .ck-fsl fsl-instance:not(:defined) > * { display: none; }

  .ck-fsl .ck-f-note {
    margin: 8px 0 0; font-family: var(--mono); font-size: 10.5px; color: var(--ink-dim);
  }
  .ck-fsl .ck-f-note[hidden] { display: none; }
`;
